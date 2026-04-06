import React, { createContext, useContext } from "react";

interface RasterContextProps {
  plotBand: string;
  setPlotBand: (band: string) => void;
  rasterMinMax: number[];
  setRasterMinMax: React.Dispatch<React.SetStateAction<number[]>>;
  plotMin: number;
  setPlotMin: React.Dispatch<React.SetStateAction<number>>;
  plotMax: number;
  setPlotMax: React.Dispatch<React.SetStateAction<number>>;
}

export const RasterContext = createContext<RasterContextProps>({
  plotBand: "aggregated",
  setPlotBand: () => null,
  rasterMinMax: [0, 100],
  setRasterMinMax: () => null,
  plotMin: 0,
  setPlotMin: () => null,
  plotMax: 0,
  setPlotMax: () => null,
});

export const useRasterContext = () => {
  const context = useContext<RasterContextProps>(RasterContext);

  if (!context) {
    throw Error("raster context is not valid!");
  }
  return context;
};
