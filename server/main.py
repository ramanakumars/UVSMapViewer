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

RASTER_PATH = Path(__file__).parent.parent.parent / "data" / "projected"
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

_BAND_LUT: dict[str, tuple[np.ndarray, str]] = {
    "aggregated": (PLASMA_LUT, "log"),
    "colorRatio": (JET_LUT, "log"),
}


def _band_from_raw(raw: np.ndarray, band: str) -> np.ndarray:
    """Reduce a (count, H, W) float32 array to a (H, W) band value."""
    if band == "aggregated":
        return np.nansum(raw, axis=0)
    if band == "colorRatio":
        return np.nansum(raw[10:50], axis=0) / (np.nansum(raw[50:100], axis=0) + 1e-6)
    return raw[0]


# ---------------------------------------------------------------------------
# Raster metadata (cached — no pixel data retained after first call)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=8)
def _raster_meta(perijove: int, band: str) -> dict:
    """
    Load raster metadata and band statistics.  Pixel data is read once at
    a low resolution to compute min/max, then discarded — only scalars and
    projection info are cached.
    """
    raster_path = RASTER_PATH / f"PJ{perijove}" / "jupiter_uv_cube.tif"
    aggregated_path = RASTER_PATH / f"PJ{perijove}" / "jupiter_uv_cube.aggregated.tif"
    with rasterio.open(aggregated_path) as src:
        tf = src.transform
        crs = src.crs
        nodata = src.nodata
        W, H = src.width, src.height

        # Read a 256×256 thumbnail to estimate min/max cheaply.
        thumb = src.read(1 if band == "aggregated" else 1)

    if nodata is not None:
        thumb[thumb == nodata] = np.nan
    thumb[~np.isfinite(thumb)] = np.nan

    max_val = float(np.nanmax(thumb)) * 1.1
    min_val = float(np.nanmin(thumb) + 1e-10)
    del thumb

    xmin: float = tf.c
    ymax: float = tf.f
    pixel_width: float = tf.a
    pixel_height: float = abs(tf.e)
    xmax = xmin + W * pixel_width
    ymin = ymax - H * pixel_height

    proj4str: str = crs.to_proj4()
    epsg = crs.to_epsg()
    crs_code: str = f"EPSG:{epsg}" if epsg else proj4str

    extent = max(xmax - xmin, ymax - ymin)
    base_res = extent / TILE_SIZE
    resolutions = [base_res / (2**i) for i in range(N_ZOOM)]

    return dict(
        path=str(raster_path),
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
        nodata=nodata,
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
    valid = np.isfinite(chunk) & (chunk > min_val)
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


@lru_cache(maxsize=8)
def _render_tile(
    z: int,
    tx: int,
    ty: int,
    perijove: int,
    band: str,
    min_val: float | None = None,
    max_val: float | None = None,
) -> bytes:
    meta = _raster_meta(perijove, band)
    if min_val is None:
        min_val = meta["min_val"]
    if max_val is None:
        max_val = meta["max_val"]

    lut, scale = _BAND_LUT.get(band, (PLASMA_LUT, "linear"))
    res = meta["resolutions"][z]

    # Map tile (tx, ty) → native pixel window.
    # ov_w_exp is the expected overview width at this zoom; the native raster
    # has meta["W"] pixels, so scale = W / ov_w_exp converts tile pixels → native pixels.
    ov_w_exp = max(1, round(meta["W"] * meta["pixel_width"] / res))
    ov_h_exp = max(1, round(meta["H"] * meta["pixel_height"] / res))
    scale_x = meta["W"] / ov_w_exp
    scale_y = meta["H"] / ov_h_exp

    c0 = round(tx * TILE_SIZE * scale_x)
    r0 = round(ty * TILE_SIZE * scale_y)
    c1 = min(meta["W"], round((tx + 1) * TILE_SIZE * scale_x))
    r1 = min(meta["H"], round((ty + 1) * TILE_SIZE * scale_y))

    if c0 >= meta["W"] or r0 >= meta["H"] or c1 <= c0 or r1 <= r0:
        img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    else:
        # Tile-pixel dimensions for this window (< TILE_SIZE only for edge tiles).
        tw = min(TILE_SIZE, max(1, round((c1 - c0) / scale_x)))
        th = min(TILE_SIZE, max(1, round((r1 - r0) / scale_y)))

        window = rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0)
        with rasterio.open(meta["path"]) as src:
            # rasterio resamples the window to (tw, th) — handles both
            # downsampling (low zoom, large window) and upsampling (high zoom).
            raw = src.read(
                window=window,
            )
        #
        nodata = meta["nodata"]
        if nodata is not None:
            raw[raw == nodata] = np.nan
        raw[~np.isfinite(raw)] = np.nan

        try:
            data2d = _band_from_raw(raw, band)

            if band == "aggregated":
                rgba = _apply_colormap(data2d, min_val, max_val, lut, scale)
            else:
                print(raw.min(), raw.max(), raw.shape, data2d.min(), data2d.max())
                rgba = _apply_colormap(data2d, 0, 5, lut, "linear")

            chunk_img = Image.fromarray(rgba, "RGBA").resize(
                (TILE_SIZE, TILE_SIZE), Image.Resampling.HAMMING
            )

            if tw < TILE_SIZE or th < TILE_SIZE:
                img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
                img.paste(chunk_img, (0, 0))
            else:
                img = chunk_img
        except Exception as e:
            print(e)
            raise

    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="UVS Tile Server")


@app.on_event("startup")
def _warmup() -> None:
    """Pre-load metadata so the first tile request doesn't pay the file-open cost."""
    _raster_meta(3, "aggregated")
    # _raster_meta(3, "colorRatio")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/raster/info")
def raster_info(perijove: int = Query(...), band: str = Query(...)):
    m = _raster_meta(perijove, band)
    return {
        "width": m["W"],
        "height": m["H"],
        "xmin": m["xmin"],
        "xmax": m["xmax"],
        "ymin": m["ymin"],
        "ymax": m["ymax"],
        "pixel_width": m["pixel_width"],
        "pixel_height": m["pixel_height"],
        "proj4str": m["proj4str"],
        "crs_code": m["crs_code"],
        "max_val": m["max_val"],
        "min_val": m["min_val"],
        "resolutions": m["resolutions"],
    }


@app.get("/raster/pixel")
def pixel_value(
    lat: float = Query(...), lon: float = Query(...), perijove: int = Query(...)
):
    """Return the raster value at a Jupiter geographic lat/lon (degrees)."""
    m = _raster_meta(perijove, "aggregated")
    geo_crs = m["crs"].geodetic_crs
    try:
        xs, ys = warp_transform(geo_crs, m["crs"], [lon], [lat])
        x, y = xs[0], ys[0]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Projection error: {exc}") from exc

    col = round((x - m["xmin"]) / m["pixel_width"])
    row = round((m["ymax"] - y) / m["pixel_height"])

    if 0 <= row < m["H"] and 0 <= col < m["W"]:
        window = rasterio.windows.Window(col, row, 1, 1)
        with rasterio.open(m["path"]) as src:
            raw = src.read(window=window).astype(np.float32)
        nodata = m["nodata"]
        if nodata is not None:
            raw[raw == nodata] = np.nan
        raw[~np.isfinite(raw)] = np.nan
        v = float(np.nansum(raw))
        return {"value": v if v > 0 else None}
    return {"value": None}


@app.get("/tiles/{z}/{x}/{y}.png")
def get_tile(
    z: int,
    x: int,
    y: int,
    perijove: int = Query(...),
    band: str = Query(...),
    min_val: float | None = None,
    max_val: float | None = None,
):
    if z < 0 or z >= N_ZOOM:
        raise HTTPException(status_code=404, detail="zoom out of range")
    try:
        png = _render_tile(z, x, y, perijove, band, min_val, max_val)
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
