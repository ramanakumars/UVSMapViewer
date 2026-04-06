export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  value: number | null;
}

export interface RasterInfo {
  width: number;
  height: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  pixel_width: number;
  pixel_height: number;
  proj4str: string;
  crs_code: string;
  min_val: number;
  max_val: number;
  resolutions: number[];
}

export async function fetchRasterInfo(band: string): Promise<RasterInfo> {
  const res = await fetch(`/raster/info/${band}`);
  if (!res.ok) throw new Error(`Failed to load raster info: HTTP ${res.status}`);
  return res.json();
}

// Set VITE_API_URL in .env to override
const API_URL = import.meta.env.VITE_API_URL ?? "/api/points";

export async function sendPoints(points: MapPoint[]): Promise<void> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      points: points.map((p) => ({
        latitude: p.lat,
        longitude: p.lng,
        uv_photon_count: p.value,
      })),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
}
