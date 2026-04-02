/// <reference types="vite/client" />

// proj4leaflet ships no types
declare module "proj4leaflet" {
  import * as L from "leaflet";
  namespace Proj {
    interface CRSOptions {
      origin?: [number, number];
      bounds?: L.Bounds;
      resolutions?: number[];
    }
    class CRS extends L.CRS {
      constructor(code: string, proj4def: string, options?: CRSOptions);
    }
  }
  export = Proj;
}
