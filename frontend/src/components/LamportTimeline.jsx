import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import "./LamportTimeline.css";

const COL_W = 68;
const HEAD = 34;
const LANE_H = 66;
const PAD_X = 44;

const KINDS = {
  task: { color: "#60a5fa", name: "Task created" },
  assign: { color: "#f5b841", name: "Dispatch to worker" },
  done: { color: "#34d399", name: "Result / recovery" },
  register: { color: "#c084fc", name: "Worker registered" },
  election: { color: "#2dd4bf", name: "Election result" },
  fail: { color: "#f87171", name: "Failure / reassign" },
  system: { color: "#8a95aa", name: "System event" },
};

const short = (id) => (id ? `#${String(id).slice(-4)}` : "");

function laneFromProcess(p = "") {
  const m = String(p).match(/worker[\s_-]*(\d+)/i);
  return m ? `W${m[1]}` : "coordinator";
}

// Turns a logged event name into: which lane it sits on, which other
// process is involved in the message, and how to draw it.
function parseEvent(e) {
  const name = String(e.event || "");
  const base = {
    lane: laneFromProcess(e.process),
    peer: null,
    dir: null, // "out" = coordinator -> worker, "in" = worker -> coordinator
    kind: "system",
    label: name.split(":")[0].toLowerCase().replace(/_/g, " ").slice(0, 11),
    taskId: null,
  };
  let m;
  if ((m = name.match(/^TASK_CREATED:(.+)$/)))
    return { ...base, kind: "task", label: "created", taskId: m[1] };
  if ((m = name.match(/^TASK_ASSIGNED:(.+):WORKER_(\d+)$/)))
    return { ...base, kind: "assign", label: "assign", taskId: m[1], peer: `W${m[2]}`, dir: "out" };
  if ((m = name.match(/^TASK_COMPLETED:(.+):WORKER_(\d+)$/)))
    return { ...base, kind: "done", label: "result", taskId: m[1], peer: `W${m[2]}`, dir: "in" };
  if ((m = name.match(/^TASK_REASSIGNED:(.+):WORKER_(\d+)_FAILED$/)))
    return { ...base, kind: "fail", label: "reassign", taskId: m[1], peer: `W${m[2]}` };
  if ((m = name.match(/^TASK_FAILED:([^:]+)/)))
    return { ...base, kind: "fail", label: "task failed", taskId: m[1] };
  if ((m = name.match(/^WORKER_REGISTERED:(\d+)$/)))
    return { ...base, kind: "register", label: "register", peer: `W${m[1]}`, dir: "in" };
  if ((m = name.match(/^WORKER_FAILED:(\d+)$/)))
    return { ...base, kind: "fail", label: "w. failed", peer: `W${m[1]}` };
  if ((m = name.match(/^WORKER_RECOVERED:(\d+)$/)))
    return { ...base, kind: "done", label: "recovered", peer: `W${m[1]}`, dir: "in" };
  if ((m = name.match(/^ELECTION_COMPLETED:WINNER_(\d+)$/)))
    return { ...base, kind: "election", label: "elected", peer: `W${m[1]}`, dir: "out" };
  if (name.startsWith("ELECTION_FAILED")) return { ...base, kind: "fail", label: "no leader" };
  if (name === "CLOCK_SYNC_RUN") return { ...base, label: "clock sync" };
  if (name === "SNAPSHOT_CAPTURED") return { ...base, label: "snapshot" };
  if (name.startsWith("EXAM_")) return { ...base, label: "exam" };
  return base;
}

function arrow(x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = x2 - ux * r;
  const ty = y2 - uy * r;
  const bx = tx - ux * 8;
  const by = ty - uy * 8;
  const nx = -uy * 4;
  const ny = ux * 4;
  return `${tx},${ty} ${bx + nx},${by + ny} ${bx - nx},${by - ny}`;
}

export default function LamportTimeline({ events }) {
  const [order, setOrder] = useState("lamport"); // "lamport" | "arrival"
  const [windowSize, setWindowSize] = useState(24);
  const [selected, setSelected] = useState(null);
  const scrollRef = useRef(null);

  const items = useMemo(() => {
    // Chronological order by timestamp (events arrive from both polling and the live stream)
    const withIdx = events.map((e, i) => ({ ...e, _i: i }));
    withIdx.sort(
      (a, b) =>
        String(a.timestamp || "").localeCompare(String(b.timestamp || "")) || a._i - b._i
    );
    const recent = withIdx
      .slice(-windowSize)
      .map((e, k) => ({ ...e, ...parseEvent(e), _arrival: k }));

    if (order === "lamport") {
      recent.sort(
        (a, b) => (a.lamport_clock ?? 0) - (b.lamport_clock ?? 0) || a._arrival - b._arrival
      );
    }

    const seen = {};
    return recent.map((e, col) => {
      const base = `${e.timestamp}|${e.event}|${e.lamport_clock}`;
      seen[base] = (seen[base] || 0) + 1;
      return { ...e, col, key: `${base}#${seen[base]}` };
    });
  }, [events, order, windowSize]);

  const lanes = useMemo(() => {
    const set = new Set(["coordinator"]);
    items.forEach((i) => {
      set.add(i.lane);
      if (i.peer) set.add(i.peer);
    });
    const workers = [...set]
      .filter((l) => l !== "coordinator")
      .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    return ["coordinator", ...workers];
  }, [items]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items.length, order]);

  const x = (col) => PAD_X + col * COL_W;
  const laneY = (lane) => HEAD + lanes.indexOf(lane) * LANE_H + LANE_H / 2;
  const width = PAD_X * 2 + Math.max(items.length, 1) * COL_W;
  const height = HEAD + lanes.length * LANE_H + 6;

  const selectedItem = items.find((i) => i.key === selected) || null;
  const activeTask = selectedItem?.taskId || null;
  const isLit = (i) =>
    !selectedItem || i.key === selected || (activeTask && i.taskId === activeTask);

  const chain = activeTask
    ? items.filter((i) => i.taskId === activeTask).sort((a, b) => a._arrival - b._arrival)
    : [];
  const chainValues = chain.map((c) => c.lamport_clock);
  const chainOk = chainValues.every((v, i) => i === 0 || v >= chainValues[i - 1]);

  const laneName = (l) => (l === "coordinator" ? "Coordinator" : `Worker ${l.slice(1)}`);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <GitBranch /> Lamport Timeline
        </h2>
        <div className="tl-controls">
          <div className="segmented">
            <div className={`seg ${order === "lamport" ? "active" : ""}`} onClick={() => setOrder("lamport")}>
              Lamport order
            </div>
            <div className={`seg ${order === "arrival" ? "active" : ""}`} onClick={() => setOrder("arrival")}>
              Arrival order
            </div>
          </div>
          <div className="segmented">
            {[12, 24, 48].map((n) => (
              <div key={n} className={`seg ${windowSize === n ? "active" : ""}`} onClick={() => setWindowSize(n)}>
                Last {n}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="panel-sub">
        Each lane is a process. Events are placed left to right by their Lamport value, so if event A
        happened-before event B, A is always to the left of B. Click any event to trace its task.
      </p>

      {items.length === 0 ? (
        <div className="empty-state">
          <GitBranch />
          <div>No events yet. Submit an answer sheet and watch the timeline fill in.</div>
        </div>
      ) : (
        <>
          <div className="tl-wrap">
            <div className="tl-labels" style={{ paddingTop: HEAD }}>
              {lanes.map((l) => (
                <div key={l} className={`tl-label ${l === "coordinator" ? "coord" : ""}`} style={{ height: LANE_H }}>
                  <span className={`dot ${l === "coordinator" ? "" : "ok"}`} style={l === "coordinator" ? { background: "var(--accent)" } : undefined} />
                  {laneName(l)}
                </div>
              ))}
            </div>

            <div className="tl-scroll" ref={scrollRef}>
              <svg className="tl-svg" width={width} height={height}>
                {lanes.map((l) => (
                  <line key={l} className="tl-lane" x1="0" x2={width} y1={laneY(l)} y2={laneY(l)} />
                ))}

                {items.map((i) => (
                  <g key={`ax-${i.key}`}>
                    <line className="tl-guide" x1={x(i.col)} x2={x(i.col)} y1={HEAD - 6} y2={height - 4} />
                    <text className="tl-axis" x={x(i.col)} y={HEAD - 14}>
                      L{i.lamport_clock ?? "?"}
                    </text>
                  </g>
                ))}

                {items.map((i) => {
                  const c = KINDS[i.kind].color;
                  const x0 = x(i.col);
                  const y0 = laneY(i.lane);
                  let peer = null;
                  if (i.peer && i.peer !== i.lane) {
                    peer = {
                      px: x0 + (i.dir === "out" ? 18 : i.dir === "in" ? -18 : 0),
                      py: laneY(i.peer),
                    };
                  }
                  return (
                    <g
                      key={i.key}
                      className="tl-node"
                      style={{ opacity: isLit(i) ? 1 : 0.2 }}
                      onClick={() => setSelected((prev) => (prev === i.key ? null : i.key))}
                    >
                      <title>{`${i.event}  ·  L=${i.lamport_clock}  ·  ${i.process}`}</title>
                      <circle cx={x0} cy={y0} r="14" fill="transparent" />

                      {peer && i.dir === "out" && (
                        <>
                          <line x1={x0} y1={y0} x2={peer.px} y2={peer.py} stroke={c} strokeWidth="1.5" />
                          <polygon points={arrow(x0, y0, peer.px, peer.py, 6)} fill={c} />
                        </>
                      )}
                      {peer && i.dir === "in" && (
                        <>
                          <line x1={peer.px} y1={peer.py} x2={x0} y2={y0} stroke={c} strokeWidth="1.5" />
                          <polygon points={arrow(peer.px, peer.py, x0, y0, 8)} fill={c} />
                        </>
                      )}
                      {peer && !i.dir && (
                        <line x1={x0} y1={y0} x2={peer.px} y2={peer.py} stroke={c} strokeWidth="1.2" strokeDasharray="3 3" />
                      )}

                      {peer &&
                        (i.kind === "fail" ? (
                          <g stroke={c} strokeWidth="2" strokeLinecap="round">
                            <line x1={peer.px - 4} y1={peer.py - 4} x2={peer.px + 4} y2={peer.py + 4} />
                            <line x1={peer.px - 4} y1={peer.py + 4} x2={peer.px + 4} y2={peer.py - 4} />
                          </g>
                        ) : (
                          <circle cx={peer.px} cy={peer.py} r="5" stroke={c} strokeWidth="1.5" style={{ fill: "var(--bg-2)" }} />
                        ))}

                      {i.kind === "election" && (
                        <circle cx={x0} cy={y0} r="11" fill="none" stroke={c} strokeDasharray="3 3" />
                      )}
                      {i.key === selected && <circle className="tl-sel" cx={x0} cy={y0} r="11" />}

                      <circle cx={x0} cy={y0} r="6.5" fill={c} />
                      <text className="tl-lbl" x={x0} y={y0 - 14}>
                        {i.label}
                      </text>
                      {i.taskId && (
                        <text className="tl-sub" x={x0} y={y0 + 21}>
                          {short(i.taskId)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="tl-info">
            {selectedItem ? (
              <>
                <div>
                  <code>{selectedItem.event}</code>
                  <span className="chip">
                    Lamport <strong>{selectedItem.lamport_clock}</strong>
                  </span>
                  <span className="chip">{selectedItem.process}</span>
                </div>
                {activeTask && (
                  <div className="tl-chain">
                    Causal chain for task <strong>{short(activeTask)}</strong>:{" "}
                    {chainValues.map((v, k) => (
                      <span key={k}>
                        {k > 0 && " → "}L{v}
                      </span>
                    ))}{" "}
                    <span className={chainOk ? "tl-ok" : "tl-bad"}>
                      {chainOk ? "✓ never goes backwards" : "✗ order violated"}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <span className="muted">
                Filled circle = event logged by that process. Hollow circle = the other process in the
                message. Arrows show direction.
              </span>
            )}
          </div>

          <div className="tl-legend">
            {Object.entries(KINDS).map(([k, v]) => (
              <span key={k}>
                <i style={{ background: v.color }} />
                {v.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}