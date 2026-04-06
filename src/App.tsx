import { useState, useCallback } from "react";
import MapView from "./components/MapView";
import PointsSidebar from "./components/PointsSidebar";
import type { MapPoint } from "./lib/api";
import "./App.css";
import { RasterContext } from "./contexts/rasterContext";
import MapController from "./components/MapController";

export default function App() {
  const [points, setPoints] = useState<MapPoint[]>([]);

  const handlePointAdded = useCallback((pt: MapPoint) => {
    setPoints((prev) => [...prev, pt]);
  }, []);

  const handleClear = useCallback(() => {
    setPoints([]);
  }, []);

  const [plotBand, setPlotBand] = useState<string>("aggregated");
  const [rasterMinMax, setRasterMinMax] = useState<Array<number>>([0, 100]);
  const [plotMin, setPlotMin] = useState<number>(0);
  const [plotMax, setPlotMax] = useState<number>(100);
  return (
    <div className="app">
      <PointsSidebar points={points} onClear={handleClear} />
      <div className="map-container">
        <RasterContext.Provider
          value={{
            plotBand: plotBand,
            setPlotBand: setPlotBand,
            rasterMinMax: rasterMinMax,
            setRasterMinMax: setRasterMinMax,
            plotMin: plotMin,
            setPlotMin: setPlotMin,
            plotMax: plotMax,
            setPlotMax: setPlotMax,
          }}
        >
          <MapController />
          <MapView points={points} onPointAdded={handlePointAdded} />
        </RasterContext.Provider>
      </div>
    </div>
  );
}
