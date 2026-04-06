import { useRasterContext } from "../contexts/rasterContext";

export default function MapController() {
  const { setPlotBand, rasterMinMax, plotMin, setPlotMin, plotMax, setPlotMax } =
    useRasterContext();

  const safeMin = Math.max(1e-10, rasterMinMax[0]);
  const safeMax = Math.max(safeMin + 1e-10, rasterMinMax[1]);
  const logMin = Math.log10(safeMin);
  const logMax = Math.log10(safeMax);
  const step = (logMax - logMin) / 200;

  const fmt = (v: number) =>
    v >= 1000 || v < 0.01 ? v.toExponential(1) : v.toPrecision(3);

  return (
    <div className="map-controller">
      <div className="controller-band">
        <label className="radio-label">
          <input
            type="radio"
            name="plotBand"
            onChange={() => setPlotBand("aggregated")}
            defaultChecked
          />
          Aggregated
        </label>
        <label className="radio-label">
          <input
            type="radio"
            name="plotBand"
            onChange={() => setPlotBand("colorRatio")}
          />
          Color Ratio
        </label>
      </div>

      <div className="controller-ranges">
        <div className="range-row">
          <span className="range-label">Min</span>
          <input
            type="range"
            min={logMin}
            max={logMax}
            step={step}
            value={Math.log10(Math.max(safeMin, plotMin))}
            onChange={(e) => setPlotMin(Math.pow(10, Number(e.target.value)))}
          />
          <span className="range-value">{fmt(plotMin)}</span>
        </div>
        <div className="range-row">
          <span className="range-label">Max</span>
          <input
            type="range"
            min={logMin}
            max={logMax}
            step={step}
            value={Math.log10(Math.max(safeMin, plotMax))}
            onChange={(e) => setPlotMax(Math.pow(10, Number(e.target.value)))}
          />
          <span className="range-value">{fmt(plotMax)}</span>
        </div>
      </div>
    </div>
  );
}
