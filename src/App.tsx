import { useState, useCallback } from 'react';
import MapView from './components/MapView';
import PointsSidebar from './components/PointsSidebar';
import type { MapPoint } from './lib/api';
import './App.css';

export default function App() {
  const [points, setPoints] = useState<MapPoint[]>([]);

  const handlePointAdded = useCallback((pt: MapPoint) => {
    setPoints((prev) => [...prev, pt]);
  }, []);

  const handleClear = useCallback(() => {
    setPoints([]);
  }, []);

  return (
    <div className="app">
      <PointsSidebar points={points} onClear={handleClear} />
      <div className="map-container">
        <MapView points={points} onPointAdded={handlePointAdded} />
      </div>
    </div>
  );
}
