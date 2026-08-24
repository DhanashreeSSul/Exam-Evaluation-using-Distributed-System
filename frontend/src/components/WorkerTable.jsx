import { Server } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "-";
  const diff = (Date.now() - new Date(iso + "Z").getTime()) / 1000;
  if (diff < 5) return "Just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export default function WorkerTable({ workers }) {
  return (
    <div className="panel">
      <h2>
        <Server /> Worker Monitoring
      </h2>
      <table>
        <thead>
          <tr>
            <th>Worker</th>
            <th>Port</th>
            <th>Status</th>
            <th>Workload</th>
            <th>Completed</th>
            <th>Last Heartbeat</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 && (
            <tr>
              <td colSpan="6" className="muted">
                No workers registered yet. Start worker processes to see them here.
              </td>
            </tr>
          )}
          {workers.map((w) => (
            <tr key={w.worker_id}>
              <td>Worker {w.worker_id}</td>
              <td>{w.port}</td>
              <td>
                <span className={`status-badge status-${w.status}`}>{w.status}</span>
              </td>
              <td>{w.workload}</td>
              <td>{w.completed}</td>
              <td>{timeAgo(w.last_heartbeat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
