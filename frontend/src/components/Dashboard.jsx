import { useEffect, useRef, useState } from "react";
import {
  Server,
  ServerCrash,
  Crown,
  Clock3,
  ListChecks,
  CheckCircle2,
  Network,
  Vote,
} from "lucide-react";
import { api } from "../api";
import "./ElectionMap.css";

const STEP_MS = 1100; // time per election step. Raise it (e.g. 1600) for a slower demo.

const R = 52;
const C = 2 * Math.PI * R;

function Donut({ segments, total }) {
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="donut">
      <circle cx="70" cy="70" r={R} className="donut-track" />
      {total > 0 &&
        segments.map((s) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
      <text x="70" y="70" textAnchor="middle" className="donut-num">{total}</text>
      <text x="70" y="86" textAnchor="middle" className="donut-cap">TASKS</text>
    </svg>
  );
}

function arrow(x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = x2 - ux * r;
  const ty = y2 - uy * r;
  const bx = tx - ux * 9;
  const by = ty - uy * 9;
  const nx = -uy * 4.5;
  const ny = ux * 4.5;
  return `${tx},${ty} ${bx + nx},${by + ny} ${bx - nx},${by - ny}`;
}

// A message packet that travels from one node to another
function Packet({ from, to, color }) {
  const dur = `${(STEP_MS * 0.8) / 1000}s`;
  return (
    <circle r="5.5" fill={color} cx={from.x} cy={from.y} style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
      <animate attributeName="cx" from={from.x} to={to.x} dur={dur} fill="freeze" />
      <animate attributeName="cy" from={from.y} to={to.y} dur={dur} fill="freeze" />
    </circle>
  );
}

function ClusterMap({ workers, leaderId, election }) {
  const W = 640, H = 330, cx = W / 2, cy = H / 2, rx = 235, ry = 112;

  if (workers.length === 0) {
    return (
      <div className="empty-state">
        <Network />
        <div>No workers registered yet. Start worker processes to see the cluster.</div>
      </div>
    );
  }

  const pts = workers.map((w, i) => {
    const a = (2 * Math.PI * i) / workers.length - Math.PI / 2;
    return { ...w, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  const pos = {};
  pts.forEach((p) => {
    pos[p.worker_id] = p;
  });

  const running = !!election?.running;
  const steps = election?.steps || [];
  const cur = running && election.idx >= 0 ? steps[election.idx] : null;

  const pastContacts = running
    ? steps
        .slice(0, Math.max(election.idx, 0))
        .filter((s) => s.type === "contact" && pos[s.from] && pos[s.to])
    : [];

  const hot = new Set();
  if (cur?.type === "contact") {
    hot.add(String(cur.from));
    hot.add(String(cur.to));
  }

  const leaderPos = running && election.leader != null ? pos[election.leader] : null;
  const announceTargets =
    cur?.type === "announce" && leaderPos
      ? pts.filter((p) => p.status === "ACTIVE" && String(p.worker_id) !== String(election.leader))
      : [];

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="cluster-svg">
        {pts.map((p) => (
          <line
            key={`l${p.worker_id}`}
            x1={cx} y1={cy} x2={p.x} y2={p.y}
            className={p.status === "ACTIVE" ? "link-active" : "link-down"}
            style={running ? { opacity: 0.25 } : undefined}
          />
        ))}

        {pastContacts.map((s, i) => (
          <line
            key={`pc${i}`}
            className="edge-elect-old"
            x1={pos[s.from].x} y1={pos[s.from].y}
            x2={pos[s.to].x} y2={pos[s.to].y}
          />
        ))}

        {cur?.type === "contact" && pos[cur.from] && pos[cur.to] && (
          <g key={`cur${election.idx}`}>
            <line
              className="edge-elect-now"
              x1={pos[cur.from].x} y1={pos[cur.from].y}
              x2={pos[cur.to].x} y2={pos[cur.to].y}
            />
            <polygon
              points={arrow(pos[cur.from].x, pos[cur.from].y, pos[cur.to].x, pos[cur.to].y, 29)}
              fill="#f5b841"
            />
          </g>
        )}

        {announceTargets.map((t) => (
          <line
            key={`ae${t.worker_id}`}
            className="edge-announce"
            x1={leaderPos.x} y1={leaderPos.y}
            x2={t.x} y2={t.y}
          />
        ))}

        <circle cx={cx} cy={cy} r="40" className="node-hub" />
        <text x={cx} y={cy - 2} className="hub-label">COORD</text>
        <text x={cx} y={cy + 12} className="node-sub">:8000</text>

        {pts.map((p) => {
          const up = p.status === "ACTIVE";
          const isLeader = String(p.worker_id) === String(leaderId);
          let cls = up ? "node-active" : "node-down";
          if (hot.has(String(p.worker_id))) cls = "node-hot";
          if (running && election.revealed && String(p.worker_id) === String(election.leader)) {
            cls = "node-won";
          }
          return (
            <g key={p.worker_id}>
              {isLeader && <circle cx={p.x} cy={p.y} r="35" className="node-leader-ring" />}
              <circle cx={p.x} cy={p.y} r="27" className={cls} />
              <text x={p.x} y={p.y + 4} className="node-label">W{p.worker_id}</text>
              <text x={p.x} y={p.y + 46} className="node-sub">
                {up ? `load ${p.workload ?? 0}` : "DOWN"}
              </text>
            </g>
          );
        })}

        {cur?.type === "contact" && pos[cur.from] && pos[cur.to] && (
          <Packet key={`pk-${election.idx}`} from={pos[cur.from]} to={pos[cur.to]} color="#f5b841" />
        )}

        {announceTargets.map((t) => (
          <Packet key={`an-${election.idx}-${t.worker_id}`} from={leaderPos} to={t} color="#2dd4bf" />
        ))}

        {cur?.type === "leader" && leaderPos && (
          <circle
            key={`pulse-${election.idx}`}
            cx={leaderPos.x}
            cy={leaderPos.y}
            r="27"
            fill="none"
            stroke="#2dd4bf"
            strokeWidth="2"
          >
            <animate attributeName="r" from="27" to="54" dur="0.9s" repeatCount="2" />
            <animate attributeName="opacity" from="0.9" to="0" dur="0.9s" repeatCount="2" />
          </circle>
        )}
      </svg>

      <div className="legend">
        <span><i style={{ background: "var(--success)" }} /> active</span>
        <span><i style={{ background: "var(--danger)" }} /> failed</span>
        <span><i style={{ background: "var(--accent)" }} /> election message / leader ring</span>
        <span><i style={{ background: "#2dd4bf" }} /> new coordinator announcement</span>
      </div>
    </>
  );
}

// Turns the coordinator's real election log lines into animation steps
function buildSteps(logs, winner) {
  const msgs = logs.map((l) => l.message);
  const start = msgs.lastIndexOf("Election Started");
  const run = start >= 0 ? msgs.slice(start) : msgs;

  const steps = [{ type: "start", text: "Election Started" }];
  run.forEach((m) => {
    let r;
    if ((r = m.match(/^Worker (\d+) contacted Worker (\d+)$/))) {
      steps.push({ type: "contact", from: Number(r[1]), to: Number(r[2]), text: m });
    } else if ((r = m.match(/^Worker (\d+) became Coordinator$/))) {
      steps.push({ type: "leader", id: Number(r[1]), text: m });
    } else if (m === "New Coordinator Announced") {
      steps.push({ type: "announce", text: m });
    }
  });

  if (!steps.some((s) => s.type === "leader")) {
    steps.push({ type: "leader", id: winner, text: `Worker ${winner} became Coordinator` });
  }
  if (!steps.some((s) => s.type === "announce")) {
    steps.push({ type: "announce", text: "New Coordinator Announced" });
  }
  return steps;
}

export default function Dashboard({ state, workers = [] }) {
  const [election, setElection] = useState(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (!state) return <p className="muted">Loading global state...</p>;

  // Supports both response shapes: flat fields or nested task_counts.
  const tc = state.task_counts || {};
  const n = (key, flat = key) => state[flat] ?? tc[key] ?? 0;

  const total = n("total", "total_tasks");
  const pending = n("pending");
  const processing = n("processing");
  const completed = n("completed");
  const failed = n("failed");
  const reassigned = n("reassigned");

  const activeList = workers.filter((w) => w.status === "ACTIVE");
  const activeWorkers = state.active_workers ?? activeList.length;
  const failedWorkers = state.failed_workers ?? workers.filter((w) => w.status !== "ACTIVE").length;

  // Bully algorithm: highest active worker id is the leader.
  const leaderId =
    state.current_coordinator ??
    (activeList.length ? Math.max(...activeList.map((w) => w.worker_id)) : null);

  const electing = !!election?.running && !election.revealed;

  async function runElection() {
    if (election?.running) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setElection({ running: true, steps: [], idx: -1, revealed: false, leader: null, done: false, error: null });

    try {
      const res = await api.startElection();
      if (res.winner == null) {
        setElection({ running: false, steps: [], idx: -1, revealed: false, leader: null, done: false, error: "Election failed: no active workers." });
        return;
      }
      const logs = await api.getElectionLogs();
      const steps = buildSteps(logs, res.winner);

      setElection({ running: true, steps, idx: -1, revealed: false, leader: res.winner, done: false, error: null });

      steps.forEach((_, k) => {
        timers.current.push(
          setTimeout(() => {
            setElection((p) => (p ? { ...p, idx: k, revealed: p.revealed || steps[k].type === "leader" } : p));
          }, k * STEP_MS)
        );
      });
      timers.current.push(
        setTimeout(() => {
          setElection((p) => (p ? { ...p, running: false, done: true } : p));
        }, steps.length * STEP_MS + 400)
      );
    } catch {
      setElection({ running: false, steps: [], idx: -1, revealed: false, leader: null, done: false, error: "Could not reach the coordinator." });
    }
  }

  const segments = [
    { label: "Completed", value: completed, color: "#34d399" },
    { label: "Processing", value: processing, color: "#60a5fa" },
    { label: "Pending", value: pending, color: "#fbbf24" },
    { label: "Reassigned", value: reassigned, color: "#c084fc" },
    { label: "Failed", value: failed, color: "#f87171" },
  ];

  const cur = election && election.idx >= 0 ? election.steps[election.idx] : null;

  return (
    <>
      <div className="grid">
        <div className="stat-card accent">
          <div className="stat-top"><span className="label">Total Tasks</span><ListChecks /></div>
          <div className="value">{total}</div>
        </div>
        <div className="stat-card good">
          <div className="stat-top"><span className="label">Completed</span><CheckCircle2 /></div>
          <div className="value">{completed}</div>
        </div>
        <div className="stat-card good">
          <div className="stat-top"><span className="label">Active Workers</span><Server /></div>
          <div className="value">{activeWorkers}</div>
        </div>
        <div className={`stat-card ${failedWorkers > 0 ? "bad" : ""}`}>
          <div className="stat-top"><span className="label">Failed Workers</span><ServerCrash /></div>
          <div className="value">{failedWorkers}</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h2><Network /> Cluster Topology</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="chip accent">
                <Crown size={13} /> Leader{" "}
                <strong>{electing ? "electing…" : leaderId != null ? `W${leaderId}` : "none"}</strong>
              </span>
              {state.lamport_clock !== undefined && (
                <span className="chip">
                  <Clock3 size={13} /> Lamport <strong>{state.lamport_clock}</strong>
                </span>
              )}
              <button
                className="outline"
                onClick={runElection}
                disabled={!!election?.running || workers.length === 0}
              >
                <Vote /> {election?.running ? "Electing…" : "Run election"}
              </button>
            </div>
          </div>

          <ClusterMap
            workers={workers}
            leaderId={electing ? null : leaderId}
            election={election}
          />

          <div className={`election-ticker ${election?.running ? "live" : ""}`}>
            {!election && (
              <span className="muted">
                Click “Run election” to watch the Bully algorithm run on the live cluster.
              </span>
            )}
            {election?.error && <span style={{ color: "var(--danger-text)" }}>{election.error}</span>}
            {election && !election.error && election.running && !cur && (
              <span className="muted">Asking the coordinator to start an election…</span>
            )}
            {election && !election.error && election.running && cur && (
              <>
                <span className="step">step {election.idx + 1}/{election.steps.length}</span>
                <span>{cur.text}</span>
              </>
            )}
            {election?.done && (
              <span className="won">✓ Worker {election.leader} is the new coordinator</span>
            )}
          </div>

          {election && election.steps.length > 0 && election.idx >= 0 && (
            <div className="election-log">
              {election.steps.slice(0, election.idx + 1).map((s, i, arr) => (
                <div
                  key={i}
                  className={i === arr.length - 1 && election.running ? "now" : s.type === "leader" ? "win" : ""}
                >
                  {`> ${s.text}`}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h2><ListChecks /> Task Status</h2>
          <Donut segments={segments} total={total} />
          <div className="donut-legend">
            {segments.map((s) => (
              <div key={s.label}>
                <span className="name"><i style={{ background: s.color }} />{s.label}</span>
                <b>{s.value}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}