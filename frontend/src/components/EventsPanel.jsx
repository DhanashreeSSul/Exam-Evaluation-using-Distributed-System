import { useMemo, useState } from "react";
import { Activity, Vote, Terminal, GitBranch } from "lucide-react";
import LamportTimeline from "./LamportTimeline";

const SHOW_UNIT_3_4 = true;

function tone(text = "") {
  if (/fail|down|error|timeout/i.test(text)) return "bad";
  if (/elect|coordinator|leader/i.test(text)) return "lead";
  if (/complet|success|recover|registered/i.test(text)) return "ok";
  return "";
}

const fmt = (ts) => (ts ? new Date(ts + "Z").toLocaleTimeString([], { hour12: false }) : "--:--:--");

export default function EventsPanel({ events, electionLogs }) {
  const [view, setView] = useState("timeline"); // "timeline" | "log"

  // Newest first, regardless of whether events came from polling or the live stream
  const sorted = useMemo(
    () =>
      events
        .map((e, i) => ({ e, i }))
        .sort(
          (a, b) =>
            String(b.e.timestamp || "").localeCompare(String(a.e.timestamp || "")) || b.i - a.i
        )
        .map((x) => x.e),
    [events]
  );

  return (
    <div className="stack">
      <div className="segmented" style={{ marginBottom: 0, alignSelf: "flex-start" }}>
        <div className={`seg ${view === "timeline" ? "active" : ""}`} onClick={() => setView("timeline")}>
          <GitBranch size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Timeline
        </div>
        <div className={`seg ${view === "log" ? "active" : ""}`} onClick={() => setView("log")}>
          <Terminal size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Event log
        </div>
      </div>

      {view === "timeline" && <LamportTimeline events={events} />}

      {view === "log" && (
        <div className="panel">
          <div className="panel-head">
            <h2>
              <Activity /> Distributed Events
            </h2>
            <span className="chip">
              <span className="dot ok" /> live
            </span>
          </div>
          <div className="terminal">
            <div className="term-bar">
              <Terminal size={13} /> event stream
            </div>
            {sorted.length === 0 && <div className="term-empty">$ waiting for events...</div>}
            {sorted.map((e, i) => (
              <div className="term-row" key={i}>
                <span className="term-time">{fmt(e.timestamp)}</span>
                {SHOW_UNIT_3_4 ? <span className="term-clock">L:{e.lamport_clock}</span> : <span />}
                <span className="term-proc">{e.process}</span>
                <span className={`term-msg ${tone(e.event)}`}>{e.event}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {SHOW_UNIT_3_4 && electionLogs && electionLogs.length > 0 && (
        <div className="panel">
          <h2>
            <Vote /> Election Logs
          </h2>
          <div className="terminal">
            {electionLogs.map((l, i) => (
              <div className="term-row" key={i}>
                <span className="term-time">{fmt(l.timestamp)}</span>
                <span />
                <span className="term-proc">election</span>
                <span className={`term-msg ${tone(l.message)}`}>{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}