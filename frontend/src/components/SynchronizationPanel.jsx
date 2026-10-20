import { useState } from "react";
import { GitBranch, Clock, Camera, RefreshCw } from "lucide-react";

const COORDINATOR_URL = "http://localhost:8000";
const label = (pid) => (pid === "coordinator" ? "Coordinator" : `Worker ${pid}`);

export default function SynchronizationPanel() {
  const [vectorClock, setVectorClock] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const call = async (fn) => {
    setLoading(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("Could not reach the coordinator.");
    }
    setLoading(false);
  };

  const fetchVectorClock = () =>
    call(async () => {
      const res = await fetch(`${COORDINATOR_URL}/vector-clock`);
      const data = await res.json();
      setVectorClock(data.vector_clock);
    });

  const runSync = () =>
    call(async () => {
      const res = await fetch(`${COORDINATOR_URL}/clock-sync/run`, { method: "POST" });
      setSyncResult(await res.json());
    });

  const captureSnapshot = () =>
    call(async () => {
      const res = await fetch(`${COORDINATOR_URL}/snapshot/capture`, { method: "POST" });
      setSnapshot(await res.json());
    });

  return (
    <div className="stack">
      {error && <div className="message-box error">{error}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2><GitBranch /> Vector Clock</h2>
          <button className="secondary" onClick={fetchVectorClock} disabled={loading}>
            <RefreshCw /> Refresh
          </button>
        </div>
        {vectorClock ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Object.entries(vectorClock).map(([pid, val]) => (
              <span key={pid} className="chip">
                {label(pid)} <strong>{val}</strong>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">Click Refresh to view the current vector clock.</p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2><Clock /> Clock Synchronization (Berkeley)</h2>
          <button onClick={runSync} disabled={loading}>Run sync</button>
        </div>
        {syncResult ? (
          <>
            <p style={{ margin: "0 0 12px" }}>
              Average network time <span className="hash">{syncResult.average_time.toFixed(3)}</span>
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {Object.entries(syncResult.offsets).map(([pid, offset]) => (
                <span key={pid} className="chip">
                  {label(pid)} <strong>{offset > 0 ? "+" : ""}{offset}s</strong>
                </span>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Synced at {new Date(syncResult.synced_at).toLocaleTimeString()}
            </p>
          </>
        ) : (
          <p className="muted">
            Simulates per-worker clock drift and computes the Berkeley average and per-process offsets.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2><Camera /> Global State Snapshot</h2>
          <button onClick={captureSnapshot} disabled={loading}>Capture snapshot</button>
        </div>
        {snapshot ? (
          <>
            <p style={{ margin: "0 0 6px" }}>
              Snapshot <span className="hash">#{snapshot.snapshot_id}</span> at{" "}
              {new Date(snapshot.timestamp).toLocaleTimeString()}
            </p>
            <p className="muted">
              In-transit tasks (channel state): {snapshot.channel_state.in_transit_tasks.length}
            </p>
            <details>
              <summary>View full state</summary>
              <pre className="code-block">{JSON.stringify(snapshot, null, 2)}</pre>
            </details>
          </>
        ) : (
          <p className="muted">
            Captures a consistent global state across the coordinator and all workers, including
            tasks mid-flight (channel state), Chandy-Lamport style.
          </p>
        )}
      </div>
    </div>
  );
}