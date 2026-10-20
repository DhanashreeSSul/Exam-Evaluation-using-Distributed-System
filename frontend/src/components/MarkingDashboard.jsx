import { Fragment, useState } from "react";
import { ClipboardCheck, ChevronDown, ChevronRight } from "lucide-react";

export default function MarkingDashboard({ summary, tasks }) {
  const [expanded, setExpanded] = useState(null);

  const completedTasks = tasks.filter((t) => t.status === "COMPLETED");

  if (!summary) return <p className="muted">Loading marking summary...</p>;

  return (
    <>
      <div className="panel">
        <h2>
          <ClipboardCheck /> Marking System Dashboard
        </h2>
        <p className="panel-sub">
          Aggregated evaluation results across every task the workers have marked, using
          answer key: <code>{summary.answer_key?.join(", ")}</code>
        </p>

        <div className="grid">
          <div className="stat-card accent">
            <div className="label">Sheets Evaluated</div>
            <div className="value">{summary.evaluated_count}</div>
          </div>
          <div className="stat-card good">
            <div className="label">Average Score</div>
            <div className="value">{summary.average_score} / {summary.total_questions}</div>
          </div>
          <div className="stat-card good">
            <div className="label">Highest Score</div>
            <div className="value">{summary.highest_score} / {summary.total_questions}</div>
          </div>
          <div className="stat-card bad">
            <div className="label">Lowest Score</div>
            <div className="value">{summary.lowest_score} / {summary.total_questions}</div>
          </div>
        </div>

        <h3 style={{ fontSize: 15, margin: "4px 0 14px" }}>Question-wise Accuracy</h3>
        {summary.question_stats?.length === 0 && (
          <p className="muted">No evaluated sheets yet — question stats will appear here.</p>
        )}
        {summary.question_stats?.map((q) => (
          <div className="qbar-row" key={q.question}>
            <div className="qbar-label">
              Q{q.question} ({q.correct_answer})
            </div>
            <div className="qbar-track">
              <div className="qbar-fill" style={{ width: `${q.accuracy_pct}%` }} />
            </div>
            <div className="qbar-pct">{q.accuracy_pct}%</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Per-Student Marking Detail</h2>
        <p className="panel-sub">Click a row to see exactly which questions were marked right or wrong.</p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Task ID</th>
                <th>Student</th>
                <th>Worker</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {completedTasks.length === 0 && (
                <tr>
                  <td colSpan="5" className="muted">
                    No completed evaluations yet.
                  </td>
                </tr>
              )}
              {completedTasks.map((t) => (
                <Fragment key={t.task_id}>
                  <tr
                    className="task-detail-row"
                    onClick={() => setExpanded(expanded === t.task_id ? null : t.task_id)}
                  >
                    <td>{expanded === t.task_id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{t.task_id}</td>
                    <td>
                      {t.student_name}{" "}
                      <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>
                        ({t.student_id})
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>W{t.assigned_worker}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>
                      {t.score}/{t.total}
                    </td>
                  </tr>
                  {expanded === t.task_id && t.breakdown && (
                    <tr>
                      <td colSpan="5" style={{ padding: 0, border: "none" }}>
                        <div className="breakdown-box">
                          <div className="breakdown-grid">
                            {t.breakdown.map((b) => (
                              <div
                                key={b.question}
                                className={`breakdown-cell ${b.is_correct ? "correct" : "incorrect"}`}
                              >
                                <strong>Q{b.question}:</strong> {b.student_answer}
                                {!b.is_correct && (
                                  <span className="muted"> (correct: {b.correct_answer})</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}