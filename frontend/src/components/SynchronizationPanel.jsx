import { useState } from "react";
import { GitBranch, Clock, Camera } from "lucide-react";

const COORDINATOR_URL = "http://localhost:8000";

export default function SynchronizationPanel() {
  const [vectorClock, setVectorClock] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchVectorClock = async () => {
    const res = await fetch(`${COORDINATOR_URL}/vector-clock`);
    const data = await res.json();
    setVectorClock(data.vector_clock);
  };

  const runSync = async () => {
    setLoading(true);
    const res = await fetch(`${COORDINATOR_URL}/clock-sync/run`, { method: "POST" });
    const data = await res.json();
    setSyncResult(data);
    setLoading(false);
  };

  const captureSnapshot = async () => {
    setLoading(true);
    const res = await fetch(`${COORDINATOR_URL}/snapshot/capture`, { method: "POST" });
    const data = await res.json();
    setSnapshot(data);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch size={18} /> Vector Clock
          </h2>
          <button onClick={fetchVectorClock} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">
            Refresh
          </button>
        </div>
        {vectorClock ? (
          <div className="flex gap-3 flex-wrap">
            {Object.entries(vectorClock).map(([pid, val]) => (
              <div key={pid} className="px-3 py-2 bg-gray-100 rounded text-sm">
                <span className="font-mono font-semibold">
                  {pid === "coordinator" ? "Coordinator" : `Worker ${pid}`}
                </span>: {val}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Click Refresh to view the current vector clock.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock size={18} /> Clock Synchronization (Berkeley Algorithm)
          </h2>
          <button onClick={runSync} disabled={loading} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">
            Run Sync
          </button>
        </div>
        {syncResult ? (
          <div className="text-sm space-y-2">
            <p>Average network time: <span className="font-mono">{syncResult.average_time.toFixed(3)}</span></p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(syncResult.offsets).map(([pid, offset]) => (
                <div key={pid} className="px-3 py-2 bg-gray-100 rounded">
                  {pid === "coordinator" ? "Coordinator" : `Worker ${pid}`} offset: {offset > 0 ? "+" : ""}{offset}s
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">Synced at {new Date(syncResult.synced_at).toLocaleTimeString()}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Simulates per-worker clock drift and computes the Berkeley average + per-process offsets.</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Camera size={18} /> Global State Snapshot
          </h2>
          <button onClick={captureSnapshot} disabled={loading} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
            Capture Snapshot
          </button>
        </div>
        {snapshot ? (
          <div className="text-sm space-y-2">
            <p>Snapshot #{snapshot.snapshot_id} at {new Date(snapshot.timestamp).toLocaleTimeString()}</p>
            <p>In-transit tasks (channel state): {snapshot.channel_state.in_transit_tasks.length}</p>
            <details>
              <summary className="cursor-pointer text-blue-600">View full state</summary>
              <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto mt-2">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Captures a consistent global state across coordinator and all workers, including tasks mid-flight (channel state), Chandy-Lamport style.
          </p>
        )}
      </div>
    </div>
  );
}