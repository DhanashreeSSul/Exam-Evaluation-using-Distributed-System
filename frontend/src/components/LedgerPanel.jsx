// ============================================
// NEW FILE: frontend/src/components/LedgerPanel.jsx
// ============================================
import { useState } from "react";
import { Link2, ShieldCheck, ShieldAlert } from "lucide-react";

const COORDINATOR_URL = "http://localhost:8000";

export default function LedgerPanel() {
  const [ledger, setLedger] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchLedger = async () => {
    setLoading(true);
    const res = await fetch(`${COORDINATOR_URL}/ledger`);
    const data = await res.json();
    setLedger(data);
    setLoading(false);
  };

  const verifyLedger = async () => {
    setLoading(true);
    const res = await fetch(`${COORDINATOR_URL}/ledger/verify`);
    const data = await res.json();
    setVerifyResult(data);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 size={18} /> Result Ledger (Hash Chain)
          </h2>
          <div className="flex gap-2">
            <button onClick={fetchLedger} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">
              Refresh Ledger
            </button>
            <button onClick={verifyLedger} disabled={loading} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">
              Verify Ledger Integrity
            </button>
          </div>
        </div>

        {verifyResult && (
          <div className={`mb-4 p-3 rounded flex items-center gap-2 text-sm ${verifyResult.valid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {verifyResult.valid ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
            {verifyResult.valid
              ? `Ledger intact — ${verifyResult.total_checked} results verified`
              : `Tampering detected in ${verifyResult.broken_entries.length} entr${verifyResult.broken_entries.length === 1 ? "y" : "ies"}`}
            {!verifyResult.valid && (
              <ul className="ml-2 list-disc">
                {verifyResult.broken_entries.map((b) => (
                  <li key={b.id}>Result #{b.id} (task {b.task_id}): {b.issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {ledger ? (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Task</th>
                  <th className="py-2 pr-4">Worker</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Prev Hash</th>
                  <th className="py-2 pr-4">Result Hash</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 pr-4">{r.id}</td>
                    <td className="py-2 pr-4 font-mono">{r.task_id}</td>
                    <td className="py-2 pr-4">Worker {r.worker_id}</td>
                    <td className="py-2 pr-4">{r.score}/{r.total}</td>
                    <td className="py-2 pr-4 font-mono">{r.prev_hash?.slice(0, 12)}...</td>
                    <td className="py-2 pr-4 font-mono">{r.result_hash?.slice(0, 12)}...</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Click Refresh Ledger to view the result chain.</p>
        )}
      </div>
    </div>
  );
}