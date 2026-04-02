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
from PIL import Image
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from rasterio.warp import transform as warp_transform

RASTER_PATH = Path(__file__).parent.parent / "data" / "jupiter_aurora.tif"
TILE_SIZE = 256
N_ZOOM = 8

# 5-stop plasma colormap — must match the frontend's PLASMA_STOPS
PLASMA = np.array(
    [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
    dtype=np.float32,
)


# ---------------------------------------------------------------------------
# Raster loading (cached for the lifetime of the process)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _raster() -> dict:
    with rasterio.open(RASTER_PATH) as src:
        data = src.read(1).astype(np.float32)
        tf = src.transform
        crs = src.crs
        nodata = src.nodata

    H, W = data.shape
    xmin: float = tf.c
    ymax: float = tf.f
    pixel_width: float = tf.a
    pixel_height: float = abs(tf.e)
    xmax = xmin + W * pixel_width
    ymin = ymax - H * pixel_height

    if nodata is not None:
        data[data == nodata] = 0.0
    data[~np.isfinite(data)] = 0.0

    max_val = float(np.nanmax(data))

    proj4str: str = crs.to_proj4()
    # Prefer EPSG code string; fall back to proj4 if unavailable
    epsg = crs.to_epsg()
    crs_code: str = f"EPSG:{epsg}" if epsg else proj4str

    # Resolutions array: zoom 0 = full raster in one tile, each level halves
    extent = max(xmax - xmin, ymax - ymin)
    base_res = extent / TILE_SIZE
    resolutions = [base_res / (2**i) for i in range(N_ZOOM)]

    return dict(
        data=data, W=W, H=H,
        xmin=xmin, xmax=xmax, ymin=ymin, ymax=ymax,
        pixel_width=pixel_width, pixel_height=pixel_height,
        proj4str=proj4str, crs_code=crs_code,
        crs=crs, max_val=max_val,
        resolutions=resolutions,
    )


# ---------------------------------------------------------------------------
# Colormap
# ---------------------------------------------------------------------------

def _plasma_rgba(chunk: np.ndarray, max_val: float) -> np.ndarray:
    H, W = chunk.shape
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    valid = (chunk > 0) & np.isfinite(chunk)
    if not valid.any():
        return rgba
    t = np.sqrt(chunk[valid] / max_val).clip(0.0, 1.0)
    scaled = t * (len(PLASMA) - 1)
    lo = np.floor(scaled).astype(int).clip(0, len(PLASMA) - 2)
    hi = lo + 1
    frac = (scaled - lo)[:, None]
    rgb = (PLASMA[lo] + (PLASMA[hi] - PLASMA[lo]) * frac).round().astype(np.uint8)
    rgba[valid, :3] = rgb
    rgba[valid, 3] = 255
    return rgba


# ---------------------------------------------------------------------------
# Tile rendering
# ---------------------------------------------------------------------------

def _render_tile(z: int, tx: int, ty: int) -> bytes:
    r = _raster()
    data, W, H = r["data"], r["W"], r["H"]
    pw, ph = r["pixel_width"], r["pixel_height"]
    res: float = r["resolutions"][z]

    # Raster pixels covered by this tile.
    # In proj4leaflet: origin = (xmin, ymax); container pixel → projected:
    #   x = xmin + px * res,  y = ymax - py * res
    # → col = px * res / pw,  row = py * res / ph
    pixels_per_tile_col = TILE_SIZE * res / pw
    pixels_per_tile_row = TILE_SIZE * res / ph

    c0 = max(0, math.floor(tx * pixels_per_tile_col))
    r0 = max(0, math.floor(ty * pixels_per_tile_row))
    c1 = min(W, math.ceil((tx + 1) * pixels_per_tile_col))
    r1 = min(H, math.ceil((ty + 1) * pixels_per_tile_row))

    if c0 >= c1 or r0 >= r1:
        img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    else:
        chunk = data[r0:r1, c0:c1]
        rgba = _plasma_rgba(chunk, r["max_val"])
        img = Image.fromarray(rgba, "RGBA")
        img = img.resize((TILE_SIZE, TILE_SIZE), Image.BILINEAR)

    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="UVS Tile Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/raster/info")
def raster_info():
    r = _raster()
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
        "resolutions": r["resolutions"],
    }


@app.get("/raster/pixel")
def pixel_value(lat: float = Query(...), lon: float = Query(...)):
    """Return the raster value at a Jupiter geographic lat/lon (degrees)."""
    r = _raster()
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
def get_tile(z: int, x: int, y: int):
    if z < 0 or z >= N_ZOOM:
        raise HTTPException(status_code=404, detail="zoom out of range")
    try:
        png = _render_tile(z, x, y)
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
