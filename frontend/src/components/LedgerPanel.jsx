import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2,
  Unlink,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Hammer,
  RotateCcw,
  Check,
  X,
  Blocks,
} from "lucide-react";
import "./LedgerPanel.css";

const COORDINATOR_URL = "http://localhost:8000";
const ZERO_HASH = "0".repeat(64);

const shortHash = (h) => (h ? `${h.slice(0, 10)}…` : "—");
const swatch = (h) => (h && /^[0-9a-f]{6}/i.test(h) ? `#${h.slice(0, 6)}` : "transparent");
const fmtTime = (ts) =>
  ts ? new Date(ts + "Z").toLocaleTimeString([], { hour12: false }) : "--:--:--";

export default function LedgerPanel() {
  const [ledger, setLedger] = useState([]);
  const [verify, setVerify] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [newScore, setNewScore] = useState("");
  const [recompute, setRecompute] = useState(false);
  const [hasTamper, setHasTamper] = useState(false);

  const scrollRef = useRef(null);

  const loadLedger = useCallback(async (silent = true) => {
    try {
      const res = await fetch(`${COORDINATOR_URL}/ledger`);
      setLedger(await res.json());
      if (!silent) setError("");
    } catch {
      if (!silent) setError("Could not reach the coordinator.");
    }
  }, []);

  useEffect(() => {
    loadLedger(false);
    fetch(`${COORDINATOR_URL}/ledger/tamper-status`)
      .then((r) => r.json())
      .then((d) => setHasTamper((d.tampered_ids || []).length > 0))
      .catch(() => {});
    const t = setInterval(() => loadLedger(true), 4000);
    return () => clearInterval(t);
  }, [loadLedger]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [ledger.length]);

  const runVerify = async () => {
    setLoading(true);
    setError("");
    setNote("");
    try {
      await loadLedger(false);
      const res = await fetch(`${COORDINATOR_URL}/ledger/verify`);
      setVerify(await res.json());
    } catch {
      setError("Could not reach the coordinator.");
    }
    setLoading(false);
  };

  const selectBlock = (r) => {
    if (selectedId === r.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(r.id);
    setNewScore(String(r.score === r.total ? 0 : r.total)); // classic cheat: give full marks
  };

  const doTamper = async () => {
    if (selectedId == null || newScore === "") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${COORDINATOR_URL}/ledger/tamper`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result_id: selectedId,
          new_score: Number(newScore),
          recompute_hash: recompute,
        }),
      });
      if (!res.ok) throw new Error("tamper endpoint missing");
      const d = await res.json();
      setVerify(null); // old verification no longer applies
      setHasTamper(true);
      setNote(
        `Block #${d.result_id}: score changed ${d.old_score} → ${d.new_score}` +
          (d.hash_recomputed ? " and its hash recomputed." : ".") +
          " Nothing has noticed yet. Click Verify integrity."
      );
      await loadLedger(false);
    } catch {
      setError(
        "Tamper failed. Make sure ledger_demo.py is added to the coordinator and the coordinator image was rebuilt."
      );
    }
    setLoading(false);
  };

  const doRestore = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${COORDINATOR_URL}/ledger/restore`, { method: "POST" });
      if (!res.ok) throw new Error();
      setVerify(null);
      setHasTamper(false);
      setNote("Original data restored. Verify again to see the chain intact.");
      await loadLedger(false);
    } catch {
      setError("Restore failed. Is the coordinator running the updated code?");
    }
    setLoading(false);
  };

  const brokenMap = useMemo(() => {
    const m = {};
    (verify?.broken_entries || []).forEach((b) => (m[b.id] = b));
    return m;
  }, [verify]);

  const checked = verify ? verify.total_checked : 0;
  const statusOf = (idx, r) => {
    if (!verify || idx >= checked) return "unverified";
    return brokenMap[r.id] ? "broken" : "valid";
  };
  const linkStatus = (idx) => {
    const next = ledger[idx + 1];
    if (!verify || idx + 1 >= checked) return "pending";
    const b = brokenMap[next.id];
    return b && b.issue.startsWith("prev_hash") ? "cut" : "ok";
  };

  const selected = ledger.find((r) => r.id === selectedId) || null;
  const selectedIsLast = selected && ledger.length > 0 && ledger[ledger.length - 1].id === selected.id;

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>
            <Blocks /> Result Ledger (Hash Chain)
          </h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {verify ? (
              verify.valid ? (
                <span className="chip">
                  <span className="dot ok" /> Chain intact
                </span>
              ) : (
                <span className="chip danger">
                  <ShieldAlert size={13} /> Tampering detected
                </span>
              )
            ) : (
              <span className="chip">Not verified yet</span>
            )}
            <button className="secondary" onClick={() => loadLedger(false)} disabled={loading}>
              <RefreshCw /> Refresh
            </button>
            <button onClick={runVerify} disabled={loading || ledger.length === 0}>
              <ShieldCheck /> Verify integrity
            </button>
          </div>
        </div>

        <p className="panel-sub">
          Every result stores the hash of the block before it. Change any past score and its hash no
          longer matches, which breaks the chain from that point on. The coloured square on each hash
          is just its first 6 hex digits, so a linked pair should always show the same colour.
        </p>

        {error && <div className="message-box error">{error}</div>}
        {note && !error && <div className="message-box info">{note}</div>}

        {verify && !verify.valid && (
          <div className="message-box error" style={{ marginBottom: 14 }}>
            <ShieldAlert size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            {verify.broken_entries.length} block{verify.broken_entries.length === 1 ? "" : "s"} failed
            verification:
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {verify.broken_entries.map((b) => (
                <li key={b.id}>
                  Block #{b.id} (task {String(b.task_id).slice(-6)}): {b.issue}
                </li>
              ))}
            </ul>
          </div>
        )}
        {verify && verify.valid && (
          <div className="message-box success" style={{ marginBottom: 14 }}>
            <ShieldCheck size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            Ledger intact. All {verify.total_checked} blocks verified.
          </div>
        )}

        {ledger.length === 0 ? (
          <div className="empty-state">
            <Link2 />
            <div>No results yet. Each completed evaluation appends a block here.</div>
          </div>
        ) : (
          <div className="chain-wrap" ref={scrollRef}>
            <div className="genesis">
              <div className="genesis-title">GENESIS</div>
              <div className="hash-line">
                <span className="hash-swatch" style={{ background: "#000000" }} />
                <span>{shortHash(ZERO_HASH)}</span>
              </div>
            </div>

            {ledger.map((r, idx) => {
              const st = statusOf(idx, r);
              const issue = brokenMap[r.id]?.issue;
              return (
                <div key={r.id} style={{ display: "contents" }}>
                  <div className={`chain-link ${idx === 0 ? "pending" : linkStatus(idx - 1)}`}>
                    <div className="bar" />
                    {idx > 0 && linkStatus(idx - 1) === "cut" ? <Unlink /> : <Link2 />}
                  </div>

                  <div
                    className={`block ${st} ${selectedId === r.id ? "selected" : ""}`}
                    onClick={() => selectBlock(r)}
                  >
                    <div className="block-head">
                      <span className="block-num">Block #{r.id}</span>
                      {st === "valid" && <Check size={16} color="var(--success)" />}
                      {st === "broken" && <X size={16} color="var(--danger)" />}
                    </div>

                    <div className="block-row">
                      <span className="k">Task</span>
                      <span className="mono">{String(r.task_id).slice(-6)}</span>
                    </div>
                    <div className="block-row">
                      <span className="k">Worker</span>
                      <span className="mono">W{r.worker_id}</span>
                    </div>
                    <div className="block-row">
                      <span className="k">Score</span>
                      <span className={`mono ${st === "broken" ? "bad" : ""}`}>
                        {r.score}/{r.total}
                      </span>
                    </div>
                    <div className="block-row">
                      <span className="k">Time</span>
                      <span className="mono">{fmtTime(r.timestamp)}</span>
                    </div>

                    <div className="hash-line" title={r.prev_hash}>
                      <span className="lbl">prev</span>
                      <span className="hash-swatch" style={{ background: swatch(r.prev_hash) }} />
                      <span>{shortHash(r.prev_hash)}</span>
                    </div>
                    <div className="hash-line" title={r.result_hash}>
                      <span className="lbl">hash</span>
                      <span className="hash-swatch" style={{ background: swatch(r.result_hash) }} />
                      <span>{shortHash(r.result_hash)}</span>
                    </div>

                    {issue && <div className="block-issue">{issue}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>
          <Hammer /> Tamper Demo
        </h2>
        <p className="panel-sub">
          Pretend to be a dishonest insider. Click a block above to select it, change its score, then
          run Verify integrity to see if the chain notices.
        </p>

        <div className="tamper-bar">
          <div>
            <label className="field-label">Selected block</label>
            <div className="tamper-sel">{selected ? `Block #${selected.id}` : "click a block above"}</div>
          </div>
          <div>
            <label className="field-label">New score</label>
            <input
              type="number"
              style={{ width: 110, minWidth: 0 }}
              value={newScore}
              onChange={(e) => setNewScore(e.target.value)}
              disabled={!selected}
            />
          </div>
          <label className="tamper-check">
            <input
              type="checkbox"
              checked={recompute}
              onChange={(e) => setRecompute(e.target.checked)}
              style={{ flex: "none", minWidth: 0 }}
            />
            Also recompute this block's hash (smarter attacker)
          </label>
          <button className="danger" onClick={doTamper} disabled={!selected || newScore === "" || loading}>
            <Hammer /> Tamper with block
          </button>
          <button className="secondary" onClick={doRestore} disabled={!hasTamper || loading}>
            <RotateCcw /> Restore original
          </button>
        </div>

        {recompute && selectedIsLast && (
          <div className="message-box info">
            This is the last block. Nobody points at its hash yet, so a recomputed tamper here would go
            undetected. Pick an earlier block, or submit another sheet first.
          </div>
        )}

        <div className="tamper-notes">
          <div>
            <strong>Without recompute:</strong> the stored hash no longer matches the data, so
            verification flags <em>that exact block</em>.
          </div>
          <div>
            <strong>With recompute:</strong> that block looks valid on its own, but the next block still
            holds the old hash, so verification flags the <em>block after it</em> and the link turns
            red. That is why each block includes the previous hash.
          </div>
        </div>
      </div>
    </div>
  );
}