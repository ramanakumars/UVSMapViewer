"""
Jupiter Aurora tile server.

Endpoints
---------
GET  /raster/info              → raster metadata + resolutions array
GET  /raster/pixel?lat=&lon=   → pixel value at Jupiter geographic coords
GET  /tiles/{z}/{x}/{y}.png    → 256×256 RGBA PNG tile (plasma colormap)
POST /api/points               → accept submitted map points

In production, also serves the built React app from ../dist/.
"""

from __future__ import annotations

import io
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel
from rasterio.warp import transform as warp_transform

RASTER_PATH = Path(__file__).parent.parent / "data" / "jupiter_aurora_all.tif"
TILE_SIZE = 256
N_ZOOM = 8

# Colormap stops (float32 for interpolation)
_PLASMA_STOPS = np.array(
    [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
    dtype=np.float32,
)
_JET_STOPS = np.array(
    [[0, 0, 128], [0, 0, 255], [0, 255, 255], [255, 255, 0], [255, 0, 0], [128, 0, 0]],
    dtype=np.float32,
)


def _build_lut(stops: np.ndarray, n: int = 256) -> np.ndarray:
    """Interpolate colormap stops into an n-entry uint8 LUT."""
    t = np.linspace(0, len(stops) - 1, n)
    lo = np.floor(t).astype(int).clip(0, len(stops) - 2)
    hi = lo + 1
    frac = (t - lo)[:, None]
    return (stops[lo] + (stops[hi] - stops[lo]) * frac).round().astype(np.uint8)


# Pre-computed 256-entry lookup tables
PLASMA_LUT: np.ndarray = _build_lut(_PLASMA_STOPS)
JET_LUT: np.ndarray = _build_lut(_JET_STOPS)


# ---------------------------------------------------------------------------
# Raster loading (cached for the lifetime of the process)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=4)
def _raster(band: str) -> dict:
    with rasterio.open(RASTER_PATH) as src:
        data = src.read().astype(np.float32)
        tf = src.transform
        crs = src.crs
        nodata = src.nodata

    N, H, W = data.shape
    if band == "aggregated":
        data = np.nansum(data, axis=0)
    elif band == "colorRatio":
        data = np.nansum(data[10:50], axis=0) / (np.nansum(data[50:100], axis=0) + 1e-6)
    xmin: float = tf.c
    ymax: float = tf.f
    pixel_width: float = tf.a
    pixel_height: float = abs(tf.e)
    xmax = xmin + W * pixel_width
    ymin = ymax - H * pixel_height

    if nodata is not None:
        data[data == nodata] = np.nan
    data[~np.isfinite(data)] = np.nan

    max_val = float(np.nanmax(data))
    min_val = float(np.nanmin(data) + 1e-10)

    proj4str: str = crs.to_proj4()
    # Prefer EPSG code string; fall back to proj4 if unavailable
    epsg = crs.to_epsg()
    crs_code: str = f"EPSG:{epsg}" if epsg else proj4str

    # Resolutions array: zoom 0 = full raster in one tile, each level halves
    extent = max(xmax - xmin, ymax - ymin)
    base_res = extent / TILE_SIZE
    resolutions = [base_res / (2**i) for i in range(N_ZOOM)]

    return dict(
        data=data,
        W=W,
        H=H,
        xmin=xmin,
        xmax=xmax,
        ymin=ymin,
        ymax=ymax,
        pixel_width=pixel_width,
        pixel_height=pixel_height,
        proj4str=proj4str,
        crs_code=crs_code,
        crs=crs,
        min_val=min_val,
        max_val=max_val,
        resolutions=resolutions,
    )


# ---------------------------------------------------------------------------
# Colormap
# ---------------------------------------------------------------------------


def _apply_colormap(
    chunk: np.ndarray,
    min_val: float,
    max_val: float,
    lut: np.ndarray,
    scale: str = "linear",
) -> np.ndarray:
    """Map a 2-D float array to RGBA using a pre-built 256-entry LUT."""
    H, W = chunk.shape
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    valid = np.isfinite(chunk) & (chunk > min_val) & (chunk < max_val)
    if not valid.any():
        return rgba

    v = chunk[valid]
    if scale == "log":
        t = (np.log10(v) - np.log10(min_val)) / (np.log10(max_val) - np.log10(min_val))
    else:
        t = (v - min_val) / (max_val - min_val)
    idx = (np.clip(t, 0.0, 1.0) * 255).astype(np.uint8)
    rgba[valid, :3] = lut[idx]
    rgba[valid, 3] = 255
    return rgba


# ---------------------------------------------------------------------------
# Per-zoom overview cache (downsampled rasters, computed once per band+zoom)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=64)
def _overview(band: str, z: int) -> np.ndarray:
    """
    Return the raster pre-scaled to zoom level z.

    At low zoom the raster needs heavy downsampling — doing that once here
    and slicing 256×256 tiles directly is much faster than resizing per tile.
    At high zoom the overview equals the original data (no upsampling).
    """
    r = _raster(band)
    data = r["data"]
    res = r["resolutions"][z]
    ov_w = max(1, round(r["W"] * r["pixel_width"] / res))
    ov_h = max(1, round(r["H"] * r["pixel_height"] / res))

    if ov_w >= r["W"] and ov_h >= r["H"]:
        return data  # native resolution — no upsampling

    # NaN-safe bilinear downsample via PIL mode 'F'
    nan_mask = ~np.isfinite(data)
    filled = np.where(nan_mask, 0.0, data).astype(np.float32)

    ov = np.array(
        Image.fromarray(filled, mode="F").resize((ov_w, ov_h), Image.BILINEAR)
    )
    # Restore NaN where the majority of source pixels were invalid
    ov_nan = np.array(
        Image.fromarray(nan_mask.astype(np.uint8) * 255).resize(
            (ov_w, ov_h), Image.NEAREST
        )
    ) > 127
    ov[ov_nan] = np.nan
    return ov


# ---------------------------------------------------------------------------
# Tile rendering
# ---------------------------------------------------------------------------

_BAND_LUT: dict[str, tuple[np.ndarray, str]] = {
    "aggregated": (PLASMA_LUT, "log"),
    "colorRatio": (JET_LUT, "log"),
}


def _render_tile(
    z: int,
    tx: int,
    ty: int,
    band: str,
    min_val: float | None = None,
    max_val: float | None = None,
) -> bytes:
    r = _raster(band)
    if min_val is None:
        min_val = r["min_val"]
    if max_val is None:
        max_val = r["max_val"]

    lut, scale = _BAND_LUT.get(band, (PLASMA_LUT, "linear"))
    ov = _overview(band, z)
    ov_h, ov_w = ov.shape

    # Tile (tx, ty) maps directly to a TILE_SIZE×TILE_SIZE slice of the overview
    c0, r0 = tx * TILE_SIZE, ty * TILE_SIZE
    c1, r1 = min(ov_w, c0 + TILE_SIZE), min(ov_h, r0 + TILE_SIZE)

    if c0 >= ov_w or r0 >= ov_h:
        img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    else:
        chunk = ov[r0:r1, c0:c1]
        rgba = _apply_colormap(chunk, min_val, max_val, lut, scale)
        img = Image.fromarray(rgba, "RGBA")
        # Only resize when the chunk is smaller than a full tile (edge tiles or
        # high-zoom where the overview equals the original native resolution)
        if chunk.shape != (TILE_SIZE, TILE_SIZE):
            img = img.resize((TILE_SIZE, TILE_SIZE), Image.BILINEAR)

    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="UVS Tile Server")


@app.on_event("startup")
def _warmup() -> None:
    """Pre-compute all overviews so tile requests are fast from the first hit."""
    for band in _BAND_LUT:
        for z in range(N_ZOOM):
            _overview(band, z)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/raster/info/{band}")
def raster_info(band: str):
    r = _raster(band)
    return {
        "width": r["W"],
        "height": r["H"],
        "xmin": r["xmin"],
        "xmax": r["xmax"],
        "ymin": r["ymin"],
        "ymax": r["ymax"],
        "pixel_width": r["pixel_width"],
        "pixel_height": r["pixel_height"],
        "proj4str": r["proj4str"],
        "crs_code": r["crs_code"],
        "max_val": r["max_val"],
        "min_val": r["min_val"],
        "resolutions": r["resolutions"],
    }


@app.get("/raster/pixel")
def pixel_value(lat: float = Query(...), lon: float = Query(...)):
    """Return the raster value at a Jupiter geographic lat/lon (degrees)."""
    r = _raster("aggregated")
    geo_crs = r["crs"].geodetic_crs
    try:
        xs, ys = warp_transform(geo_crs, r["crs"], [lon], [lat])
        x, y = xs[0], ys[0]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Projection error: {exc}") from exc

    col = round((x - r["xmin"]) / r["pixel_width"])
    row = round((r["ymax"] - y) / r["pixel_height"])

    if 0 <= row < r["H"] and 0 <= col < r["W"]:
        v = float(r["data"][row, col])
        return {"value": v if v > 0 else None}
    return {"value": None}


@app.get("/tiles/{z}/{x}/{y}.png")
def get_tile(
    z: int,
    x: int,
    y: int,
    band: str,
    min_val: float | None = None,
    max_val: float | None = None,
):
    if z < 0 or z >= N_ZOOM:
        raise HTTPException(status_code=404, detail="zoom out of range")
    try:
        png = _render_tile(z, x, y, band, min_val, max_val)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


class _Point(BaseModel):
    latitude: float
    longitude: float
    uv_photon_count: float | None = None


class _Payload(BaseModel):
    points: list[_Point]


@app.post("/api/points")
def post_points(payload: _Payload):
    # TODO: forward to external API / persist
    return {"status": "ok", "count": len(payload.points)}


# Production: serve the built React app (dist/ lives one level up)
_DIST = Path(__file__).parent.parent / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="static")
