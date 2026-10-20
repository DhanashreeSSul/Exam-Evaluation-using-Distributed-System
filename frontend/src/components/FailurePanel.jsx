import { useState } from "react";
import { ShieldAlert, Vote as VoteIcon, Power, RotateCcw, Server } from "lucide-react";
import { api } from "../api";

const SHOW_UNIT_3_4 = true;

export default function FailurePanel({ workers, onAction }) {
  const [message, setMessage] = useState("");

  async function fail(workerId) {
    try {
      const res = await api.failWorker(workerId);
      setMessage(
        `Worker ${workerId} failed. Reassigned tasks: ${
          res.reassigned_tasks?.length ? res.reassigned_tasks.join(", ") : "none"
        }`
      );
      onAction && onAction();
    } catch {
      setMessage("Error failing worker.");
    }
  }

  async function recover(workerId) {
    try {
      await api.recoverWorker(workerId);
      setMessage(`Worker ${workerId} recovered.`);
      onAction && onAction();
    } catch {
      setMessage("Error recovering worker.");
    }
  }

  async function election() {
    try {
      const res = await api.startElection();
      setMessage(
        res.winner != null
          ? `New Coordinator: Worker ${res.winner}`
          : "Election failed - no active workers."
      );
      onAction && onAction();
    } catch {
      setMessage("Error starting election.");
    }
  }

  return (
    <div className="panel">
      <h2><ShieldAlert /> Failure Simulation</h2>
      <p className="panel-sub">
        Kill a worker to watch its in-flight tasks get reassigned, then recover it or trigger a
        leader election. Watch the Dashboard cluster map while you do this.
      </p>

      {workers.length === 0 && (
        <div className="empty-state"><Server /><div>No workers registered yet.</div></div>
      )}

      <div className="fail-grid">
        {workers.map((w) => {
          const up = w.status === "ACTIVE";
          return (
            <div key={w.worker_id} className={`fail-card ${up ? "" : "is-down"}`}>
              <div className="fail-head">
                <span className={`dot ${up ? "ok" : "bad"}`} />
                <strong>Worker {w.worker_id}</strong>
                <span className={`status-badge status-${w.status}`}>{w.status}</span>
              </div>
              <div className="muted">Workload {w.workload} · Completed {w.completed}</div>
              {up ? (
                <button className="danger" onClick={() => fail(w.worker_id)}>
                  <Power /> Kill worker
                </button>
              ) : (
                <button className="secondary" onClick={() => recover(w.worker_id)}>
                  <RotateCcw /> Recover worker
                </button>
              )}
            </div>
          );
        })}
      </div>

      {SHOW_UNIT_3_4 && (
        <div className="danger-zone">
          <p>
            Simulate the coordinator going down. Active workers run the Bully algorithm and the
            highest-ID worker becomes the new leader.
          </p>
          <button className="danger" onClick={election}>
            <VoteIcon /> Start election
          </button>
        </div>
      )}

      {message && <div className="message-box info">{message}</div>}
    </div>
  );
}