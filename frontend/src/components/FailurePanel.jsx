import { useState } from "react";
import { ShieldAlert, Vote as VoteIcon } from "lucide-react";
import { api } from "../api";

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
        res.new_coordinator
          ? `New Coordinator: ${res.new_coordinator}`
          : "Election failed - no active workers."
      );
      onAction && onAction();
    } catch {
      setMessage("Error starting election.");
    }
  }

  return (
    <div className="panel">
      <h2>
        <ShieldAlert /> Failure Simulation
      </h2>
      <div className="button-row">
        {workers.map((w) => (
          <button key={w.worker_id} className="danger" onClick={() => fail(w.worker_id)}>
            Fail Worker {w.worker_id}
          </button>
        ))}
      </div>
      <div className="button-row">
        {workers.map((w) => (
          <button key={w.worker_id} className="secondary" onClick={() => recover(w.worker_id)}>
            Recover Worker {w.worker_id}
          </button>
        ))}
      </div>
      <div className="button-row">
        <button onClick={election}>
          <VoteIcon size={14} /> Simulate Coordinator Failure / Start Election
        </button>
      </div>
      {message && <div className="message-box info">{message}</div>}
    </div>
  );
}
