import { LayoutDashboard, Server, ServerCrash, Crown, Clock3 } from "lucide-react";

export default function Dashboard({ state }) {
  if (!state) return <p className="muted">Loading global state...</p>;

  const cards = [
    { label: "Total Tasks", value: state.total_tasks },
    { label: "Pending", value: state.pending },
    { label: "Processing", value: state.processing },
    { label: "Completed", value: state.completed, cls: "good" },
    { label: "Failed", value: state.failed, cls: state.failed > 0 ? "bad" : "" },
    { label: "Reassigned", value: state.reassigned },
    { label: "Active Workers", value: state.active_workers, cls: "good" },
    { label: "Failed Workers", value: state.failed_workers, cls: state.failed_workers > 0 ? "bad" : "" },
  ];

  return (
    <div className="panel">
      <h2>
        <LayoutDashboard /> Dashboard
      </h2>
      <div className="grid">
        {cards.map((c) => (
          <div className={`stat-card ${c.cls || ""}`} key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="button-row" style={{ marginTop: 4 }}>
        <span className="connection-pill" style={{ background: "var(--accent-light)", color: "var(--accent-dark)" }}>
          <Crown size={14} /> Coordinator: <strong>{state.current_coordinator}</strong>
        </span>
        <span className="connection-pill" style={{ background: "var(--accent-light)", color: "var(--accent-dark)" }}>
          <Clock3 size={14} /> Lamport Clock: <strong>{state.lamport_clock}</strong>
        </span>
        <span className="connection-pill" style={{ background: "var(--accent-light)", color: "var(--accent-dark)" }}>
          <Server size={14} /> Active: <strong>{state.active_workers}</strong>
        </span>
        {state.failed_workers > 0 && (
          <span className="connection-pill" style={{ background: "var(--danger-bg)", color: "var(--danger-text)" }}>
            <ServerCrash size={14} /> Failed: <strong>{state.failed_workers}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
