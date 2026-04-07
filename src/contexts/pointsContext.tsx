import { createContext, useContext } from "react";
import { MapPoint } from "../services/interfaces";

interface PointContextProps {
  points: MapPoint[];
  setPoints: React.Dispatch<React.SetStateAction<MapPoint[]>>;
}

export const pointContext = createContext<PointContextProps>({
  points: [],
  setPoints: () => null
});

export const usePointsContext = () => {
  const context = useContext<PointContextProps>(pointContext);

  if (!context) {
    throw Error("raster context is not valid!");
  }
  return context;
};

