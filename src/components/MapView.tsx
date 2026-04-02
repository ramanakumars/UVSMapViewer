import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import proj4 from "proj4";
import "proj4leaflet";
import { fetchRasterInfo } from "../lib/api";
import type { MapPoint, RasterInfo } from "../lib/api";

interface Props {
  points: MapPoint[];
  onPointAdded: (point: MapPoint) => void;
}

export default function MapView({ points, onPointAdded }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  // Ref so the click handler always uses the latest callback without re-binding
  const onPointAddedRef = useRef(onPointAdded);
  useEffect(() => {
    onPointAddedRef.current = onPointAdded;
  }, [onPointAdded]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    fetchRasterInfo()
      .then((info: RasterInfo) => {
        if (cancelled || !containerRef.current) return;

        // Register the projection so proj4leaflet can use it
        proj4.defs(info.crs_code, info.proj4str);

        // Build a Leaflet CRS from the native raster projection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const crs: L.CRS = new (L as any).Proj.CRS(info.crs_code, info.proj4str, {
          origin: [info.xmin, info.ymax] as [number, number],
          bounds: L.bounds([info.xmin, info.ymin], [info.xmax, info.ymax]),
          resolutions: info.resolutions,
        });

        // Compute geographic bounds for the north polar stereographic raster.
        // All 4 projected corners sit at nearly the same latitude (equidistant
        // from the pole) but span all longitudes, so we must use all 4 corners
        // to find the true southern extent and cover the full 360° of longitude.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proj = (crs as any).projection;
        const corners = [
          [info.xmin, info.ymin], [info.xmax, info.ymin],
          [info.xmin, info.ymax], [info.xmax, info.ymax],
        ].map(([x, y]) => proj.unproject(L.point(x, y)));
        const minLat = Math.min(...corners.map((c) => c.lat));
        const bounds = L.latLngBounds(L.latLng(minLat, -180), L.latLng(90, 180));

        const map = L.map(containerRef.current!, {
          crs,
          minZoom: 2,
          maxZoom: info.resolutions.length - 1,
          zoomControl: true,
          center: [90, 0],
          attributionControl: false,
        });

        console.log(bounds.getCenter())

        map.getContainer().style.background = "#0a0a1a";
        markersLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        L.tileLayer("/tiles/{z}/{x}/{y}.png", {
          tileSize: 256,
          minZoom: 2,
          maxZoom: info.resolutions.length - 1,
          noWrap: true,
          opacity: 1.,
        }).addTo(map);

        map.setView([90, 0], 0);

        // ── Lat/lon graticule ────────────────────────────────────────────────
        const GRID = { color: "#ffffff", weight: 0.5, opacity: 0.25, interactive: false } as const;
        const LABEL_STYLE = "color:rgba(255,255,255,0.5);font-size:10px;line-height:1;white-space:nowrap";
        const graticule = L.layerGroup().addTo(map);
        const outerLat = Math.ceil(minLat);

        // Parallels — sampled every 2° of longitude to render as smooth arcs
        for (let lat = Math.ceil(minLat / 10) * 10; lat < 90; lat += 10) {
          const pts: L.LatLngExpression[] = [];
          for (let lon = -180; lon <= 180; lon += 2) pts.push([lat, lon]);
          L.polyline(pts, GRID).addTo(graticule);
          L.marker([lat, 0] as L.LatLngExpression, {
            interactive: false,
            icon: L.divIcon({ html: `<span style="${LABEL_STYLE}">${lat}°</span>`, className: "", iconAnchor: [0, 6] }),
          }).addTo(graticule);
        }

        // Meridians — straight in polar stereographic, so 2 points suffice
        for (let crsLon = -180; crsLon < 180; crsLon += 30) {
          L.polyline([[outerLat, crsLon], [89, crsLon]], GRID).addTo(graticule);
          const userLon = ((180 - crsLon) % 360 + 360) % 360;
          L.marker([outerLat + 2, crsLon] as L.LatLngExpression, {
            interactive: false,
            icon: L.divIcon({ html: `<span style="${LABEL_STYLE}">${userLon}°</span>`, className: "", iconAnchor: [12, 6] }),
          }).addTo(graticule);
        }

        // Click: proj4leaflet returns Jupiter geographic lat/lon directly in e.latlng
        map.on("click", async (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng;
          let value: number | null = null;
          try {
            const res = await fetch(`/raster/pixel?lat=${lat}&lon=${lng}`);
            const data = await res.json();
            value = data.value ?? null;
          } catch {
            // value stays null
          }
          onPointAddedRef.current({ id: crypto.randomUUID(), lat, lng: 180 - lng, value });
        });
      })
      .catch((err) => {
        if (!cancelled) console.error("[MapView] Failed to load raster info:", err);
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers whenever points change
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    points.forEach((pt, idx) => {
      L.circleMarker([pt.lat, 180 - pt.lng] as L.LatLngExpression, {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#facc15",
        fillOpacity: 0.9,
      })
        .bindTooltip(
          `#${idx + 1}  val: ${pt.value != null ? pt.value.toFixed(1) : "N/A"}`,
        )
        .addTo(layer);
    });
  }, [points]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
