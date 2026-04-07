import { useState, useCallback, useEffect } from "react";
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

  const [plotBand, setPlotBand] = useState<string>("aggregated");
  const [rasterMinMax, setRasterMinMax] = useState<Array<number>>([0, 100]);
  const [plotMin, setPlotMin] = useState<number>(0);
  const [plotMax, setPlotMax] = useState<number>(100);

  const handlePointAdded = useCallback((pt: MapPoint) => {
    setPoints((prev) => [...prev, pt]);
  }, []);

  if (!subject) {
    return null;
  }

  return null;

  // return (
  //   <div className="classifier">
  //     <PointsSidebar points={points} onClear={handleClear} />
  //     <div className="map-container">
  //       <RasterContext.Provider
  //         value={{
  //           perijove: Number(subject.metadata.perijove),
  //           plotBand: plotBand,
  //           setPlotBand: setPlotBand,
  //           rasterMinMax: rasterMinMax,
  //           setRasterMinMax: setRasterMinMax,
  //           plotMin: plotMin,
  //           setPlotMin: setPlotMin,
  //           plotMax: plotMax,
  //           setPlotMax: setPlotMax,
  //         }}
  //       >
  //         <MapController />
  //         <MapView
  //           points={points}
  //           onPointAdded={handlePointAdded}
  //           plotBand={"aggregated"}
  //         />
  //         <MapView
  //           points={points}
  //           onPointAdded={handlePointAdded}
  //           plotBand={"colorRatio"}
  //         />
  //       </RasterContext.Provider>
  //     </div>
  //   </div>
  // );
}
