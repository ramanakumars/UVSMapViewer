import { useState } from 'react';
import type { MapPoint } from '../lib/api';
import { sendPoints } from '../lib/api';

interface Props {
  points: MapPoint[];
  onClear: () => void;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function PointsSidebar({ points, onClear }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSend = async () => {
    if (points.length === 0) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      await sendPoints(points);
      setStatus('success');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  return (
    <aside className="sidebar">
      <h2>Juno UVS Aurora Viewer</h2>
      <p className="subtitle">Click the map to place measurement points</p>

      <div className="points-list">
        {points.length === 0 ? (
          <p className="empty">No points placed yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Lat</th>
                <th>Lon</th>
                <th>UV count</th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt, idx) => (
                <tr key={pt.id}>
                  <td>{idx + 1}</td>
                  <td>{pt.lat.toFixed(3)}°</td>
                  <td>{pt.lng.toFixed(3)}°</td>
                  <td>{pt.value != null ? pt.value.toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="actions">
        <button
          className="btn-send"
          onClick={handleSend}
          disabled={points.length === 0 || status === 'loading'}
        >
          {status === 'loading' ? 'Sending…' : `Send ${points.length} point${points.length !== 1 ? 's' : ''} to API`}
        </button>
        <button
          className="btn-clear"
          onClick={() => { onClear(); setStatus('idle'); }}
          disabled={points.length === 0}
        >
          Clear all
        </button>
      </div>

      {status === 'success' && <p className="msg-success">Sent successfully.</p>}
      {status === 'error' && <p className="msg-error">{errorMsg}</p>}

      <div className="legend">
        <div className="legend-gradient" />
        <div className="legend-labels">
          <span>0</span>
          <span>UV photon count (max)</span>
        </div>
      </div>
    </aside>
  );
}
