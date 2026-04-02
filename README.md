# Jupiter Aurora Viewer

Interactive map viewer for Juno UVS Jupiter aurora data. Displays a single-band UV photon count GeoTIFF in a Leaflet map using Jupiter's native north polar stereographic projection. Users can click to place measurement points that capture Jupiter latitude/longitude and UV photon count, then submit them to an external API.

## Architecture

```
webapp/
├── src/          # React + TypeScript frontend (Vite)
├── server/       # Python tile server (FastAPI)
└── data/         # GeoTIFF data files (not tracked in git)
```

The FastAPI backend reads the GeoTIFF with rasterio and serves 256×256 PNG tiles rendered with a plasma colormap. The frontend uses Leaflet with a proj4leaflet CRS built from the projection embedded in the TIFF — no hardcoded CRS parameters. Clicking the map queries the backend for the pixel value at that Jupiter lat/lon.

## Data

Place the aggregated single-band GeoTIFF at:

```
data/jupiter_aurora.tif
```

Expected format: single-band Float32, Jupiter north polar stereographic (EPSG:32767), ~50 km/pixel.

## Setup

**Frontend**

```bash
npm install
```

**Backend**

```bash
cd server && uv sync
```

## Running

### Development (two terminals)

```bash
# Terminal 1 — tile server on :8080
cd server && uv run uvicorn main:app --port 8080 --reload

# Terminal 2 — Vite dev server on :5173
npm run dev
```

Open `http://localhost:5173`. The Vite proxy forwards `/tiles`, `/raster`, and `/api` to the backend.

### Production (single server)

```bash
npm run build
cd server && uv run uvicorn main:app --port 8080 --host 0.0.0.0
```

Open `http://localhost:8080`.

## API

| Endpoint | Description |
|---|---|
| `GET /raster/info` | Raster metadata: dimensions, CRS, proj4 string, resolution levels |
| `GET /tiles/{z}/{x}/{y}.png` | 256×256 RGBA PNG tile (plasma colormap, 8 zoom levels) |
| `GET /raster/pixel?lat=&lon=` | UV photon count at a Jupiter geographic coordinate |
| `POST /api/points` | Submit placed points `{ points: [{ latitude, longitude, uv_photon_count }] }` |
