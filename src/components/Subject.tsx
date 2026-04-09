import { useState, useCallback, useRef, type MutableRefObject } from "react";
import L from "leaflet";
import { type SubjectInfo, type MapPoint } from "../services/interfaces";
import { RasterContext } from "../contexts/rasterContext";
import MapController from "../components/MapController";
import MapView from "../components/MapView";
import PointsSidebar from "../components/PointsSidebar";

export default function Subject({ subject }: { subject: SubjectInfo | null }) {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const handleClear = useCallback(() => {
    setPoints([]);
  }, []);

  const [rasterMinMax, setRasterMinMax] = useState<Array<number>>([0, 100]);
  const [plotMin, setPlotMin] = useState<number>(0);
  const [plotMax, setPlotMax] = useState<number>(100);

  const handlePointAdded = useCallback((pt: MapPoint) => {
    setPoints((prev) => [...prev, pt]);
  }, []);

  const map1Ref = useRef<L.Map | null>(null);
  const map2Ref = useRef<L.Map | null>(null);

  function handleMapReady(map: L.Map, other: MutableRefObject<L.Map | null>) {
    map.on("move", () => {
      if (other.current) {
        other.current.setView(map.getCenter(), map.getZoom(), { animate: false });
      }
    });
  }

  if (!subject) {
    return null;
  }

  const perijove = Number(subject.metadata.perijove);

  return (
    <div className="classifier">
      <PointsSidebar points={points} onClear={handleClear} />
      <div className="map-container">
        <RasterContext.Provider
          value={{
            rasterMinMax: rasterMinMax,
            setRasterMinMax: setRasterMinMax,
            plotMin: plotMin,
            setPlotMin: setPlotMin,
            plotMax: plotMax,
            setPlotMax: setPlotMax,
          }}
        >
          <MapController />
          <MapView
            points={points}
            onPointAdded={handlePointAdded}
            plotBand={"aggregated"}
            perijove={perijove}
            onMapReady={(m) => { map1Ref.current = m; handleMapReady(m, map2Ref); }}
          />
          <MapView
            perijove={perijove}
            points={points}
            onPointAdded={handlePointAdded}
            plotBand={"colorRatio"}
            onMapReady={(m) => { map2Ref.current = m; handleMapReady(m, map1Ref); }}
          />
        </RasterContext.Provider>
      </div>
    </div>
  );
}
