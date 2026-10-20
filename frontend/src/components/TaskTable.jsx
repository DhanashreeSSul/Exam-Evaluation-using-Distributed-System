import { ListChecks, FileText, PenLine } from "lucide-react";

export default function TaskTable({ tasks }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <ListChecks /> Task Monitoring
        </h2>
        <span className="chip">
          <strong>{tasks.length}</strong> tasks
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Task ID</th>
              <th>Student</th>
              <th>Source</th>
              <th>Assigned Worker</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan="6" className="muted">
                  No answer sheets submitted yet.
                </td>
              </tr>
            )}
            {tasks.map((t) => (
              <tr key={t.task_id}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{t.task_id}</td>
                <td>
                  {t.student_name}{" "}
                  <span className="muted" style={{ fontFamily: "var(--font-mono)" }}>
                    ({t.student_id})
                  </span>
                </td>
                <td className="muted">
                  {t.source === "upload" ? (
                    <>
                      <FileText size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      Upload
                    </>
                  ) : (
                    <>
                      <PenLine size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      Manual
                    </>
                  )}
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                  {t.assigned_worker ? `W${t.assigned_worker}` : "-"}
                </td>
                <td>
                  <span className={`status-badge status-${t.status}`}>{t.status}</span>
                </td>
                <td style={{ fontFamily: "var(--font-mono)" }}>
                  {t.score !== null && t.score !== undefined ? `${t.score}/${t.total}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}