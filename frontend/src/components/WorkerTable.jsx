import { Server, Crown, HeartPulse } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "-";
  const diff = (Date.now() - new Date(iso + "Z").getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export default function WorkerTable({ workers, state }) {
  const maxLoad = Math.max(5, ...workers.map((w) => w.workload || 0));
  const activeIds = workers.filter((w) => w.status === "ACTIVE").map((w) => w.worker_id);
  const leaderId = state?.current_coordinator ?? (activeIds.length ? Math.max(...activeIds) : null);

  if (workers.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          <Server />
          <div>No workers registered yet. Start worker processes to see them here.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="worker-grid">
      {workers.map((w) => {
        const up = w.status === "ACTIVE";
        const isLeader = String(w.worker_id) === String(leaderId);
        return (
          <div
            key={w.worker_id}
            className={`worker-card ${up ? "" : "is-down"} ${isLeader && up ? "is-leader" : ""}`}
          >
            <div className="worker-top">
              <div className="worker-name">
                <span className={`dot ${up ? "ok" : "bad"}`} />
                Worker {w.worker_id}
                {isLeader && up && <Crown />}
              </div>
              <span className={`status-badge status-${w.status}`}>{w.status}</span>
            </div>

            <div className="worker-meta">
              <div><div className="k">Port</div><div className="v">{w.port}</div></div>
              <div><div className="k">Completed</div><div className="v">{w.completed}</div></div>
            </div>

            <div className="k" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 6 }}>
              Workload · {w.workload}
            </div>
            <div className="load-track">
              <div className="load-fill" style={{ width: `${Math.min(100, ((w.workload || 0) / maxLoad) * 100)}%` }} />
            </div>

            <div className="hb">
              <HeartPulse size={13} /> heartbeat {timeAgo(w.last_heartbeat)}
            </div>
          </div>
        );
      })}
    </div>
  );
}