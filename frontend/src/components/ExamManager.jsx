import { Fragment, useEffect, useState } from "react";
import { FileText, Plus, CheckCircle2, Trash2, UploadCloud } from "lucide-react";
import { api } from "../api";

const emptyQuestion = (n) => ({
  question_number: n,
  question_text: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "",
});

export default function ExamManager({ onExamActivated }) {
  const [exams, setExams] = useState([]);
  const [activeExam, setActiveExam] = useState(null);
  const [message, setMessage] = useState("");
  const [expandedExamId, setExpandedExamId] = useState(null);
  const [expandedQuestions, setExpandedQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // upload form state
  const [uploadExamName, setUploadExamName] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // manual entry form state
  const [showManual, setShowManual] = useState(false);
  const [examName, setExamName] = useState("");
  const [questions, setQuestions] = useState([emptyQuestion(1)]);

  const refresh = async () => {
    try {
      const [list, active] = await Promise.all([api.listExams(), api.getActiveExam()]);
      setExams(list);
      setActiveExam(active);
    } catch (e) {
      // coordinator may be unreachable; ignore
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!uploadExamName.trim() || !uploadFile) {
      setMessage("Give the exam a name and choose a file first.");
      return;
    }
    setUploading(true);
    try {
      const result = await api.uploadExamFile(uploadExamName.trim(), uploadFile);
      setMessage(`"${uploadExamName}" uploaded — ${result.question_count} questions parsed from ${uploadFile.name}.`);
      setUploadExamName("");
      setUploadFile(null);
      refresh();
    } catch (err) {
      setMessage("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const addQuestionRow = () => {
    setQuestions((prev) => [...prev, emptyQuestion(prev.length + 1)]);
  };

  const removeQuestionRow = (idx) => {
    setQuestions((prev) =>
      prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, question_number: i + 1 }))
    );
  };

  const updateQuestion = (idx, field, value) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, [field]: value } : q)));
  };

  const handleCreateExam = async (e) => {
    e.preventDefault();
    if (!examName.trim()) {
      setMessage("Give the exam a name first.");
      return;
    }
    const cleaned = questions
      .filter((q) => q.question_text.trim() && q.correct_answer.trim())
      .map((q) => ({ ...q, correct_answer: q.correct_answer.trim().toUpperCase() }));
    if (cleaned.length === 0) {
      setMessage("Add at least one question with a correct answer.");
      return;
    }
    try {
      const result = await api.createExam(examName.trim(), cleaned);
      setMessage(`Exam "${examName}" created with ${result.question_count} questions.`);
      setExamName("");
      setQuestions([emptyQuestion(1)]);
      refresh();
    } catch (err) {
      setMessage("Failed to create exam: " + err.message);
    }
  };

  const handleActivate = async (examId) => {
    await api.activateExam(examId);
    setMessage("Exam activated — new submissions will be marked against this question set.");
    refresh();
    onExamActivated && onExamActivated();
  };

  const handleToggleView = async (examId) => {
    if (expandedExamId === examId) {
      setExpandedExamId(null);
      setExpandedQuestions([]);
      return;
    }
    setExpandedExamId(examId);
    setLoadingQuestions(true);
    try {
      const qs = await api.getExamQuestions(examId);
      setExpandedQuestions(qs);
    } catch (err) {
      setMessage("Failed to load questions: " + err.message);
    } finally {
      setLoadingQuestions(false);
    }
  };

  return (
    <div className="panel">
      <h2>
        <FileText /> Exam &amp; Question Bank
      </h2>
      <p className="panel-sub">
        Upload a question paper (or add questions manually), then activate the
        exam so new answer sheet submissions are marked against it.
      </p>

      {activeExam?.active_exam_id && (
        <div className="stat-card good" style={{ marginBottom: 20 }}>
          <div className="label">Active Exam</div>
          <div className="value" style={{ fontSize: 20 }}>
            {activeExam.name || activeExam.active_exam_id}
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 15 }}>Upload Question Bank</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.9 }}>
        Accepts <strong>.txt</strong>, <strong>.csv</strong>, <strong>.pdf</strong>, or{" "}
        <strong>.docx</strong>. Preferred format — a numbered question with
        options and an answer line:
        <br />
        <code>1. What is the time complexity of binary search?</code>
        <br />
        <code>A. O(n)&nbsp;&nbsp;B. O(log n)&nbsp;&nbsp;C. O(n^2)&nbsp;&nbsp;D. O(1)</code>
        <br />
        <code>Answer: B</code>
      </p>
      <form
        onSubmit={handleFileUpload}
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}
      >
        <input
          type="text"
          placeholder="Exam name (e.g. Midterm - Distributed Systems)"
          value={uploadExamName}
          onChange={(e) => setUploadExamName(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <input
          type="file"
          accept=".txt,.csv,.pdf,.docx"
          onChange={(e) => setUploadFile(e.target.files[0])}
        />
        <button type="submit" className="btn-primary" disabled={uploading}>
          <UploadCloud size={14} /> {uploading ? "Uploading..." : "Upload"}
        </button>
      </form>

      <button
        type="button"
        className="btn-small"
        onClick={() => setShowManual((v) => !v)}
        style={{ marginBottom: 16 }}
      >
        {showManual ? "Hide manual entry" : "Or enter questions manually"}
      </button>

      {showManual && (
        <form onSubmit={handleCreateExam} style={{ marginBottom: 20 }}>
          <input
            type="text"
            placeholder="Exam name"
            value={examName}
            onChange={(e) => setExamName(e.target.value)}
            style={{ width: "100%", marginBottom: 12 }}
          />

          {questions.map((q, idx) => (
            <div
              key={idx}
              style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <span style={{ width: 24, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                  {q.question_number}.
                </span>
                <input
                  type="text"
                  placeholder="Question text"
                  value={q.question_text}
                  onChange={(e) => updateQuestion(idx, "question_text", e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-small danger" onClick={() => removeQuestionRow(idx)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, paddingLeft: 32, flexWrap: "wrap" }}>
                <input type="text" placeholder="Option A" value={q.option_a} onChange={(e) => updateQuestion(idx, "option_a", e.target.value)} style={{ flex: 1, minWidth: 100 }} />
                <input type="text" placeholder="Option B" value={q.option_b} onChange={(e) => updateQuestion(idx, "option_b", e.target.value)} style={{ flex: 1, minWidth: 100 }} />
                <input type="text" placeholder="Option C" value={q.option_c} onChange={(e) => updateQuestion(idx, "option_c", e.target.value)} style={{ flex: 1, minWidth: 100 }} />
                <input type="text" placeholder="Option D" value={q.option_d} onChange={(e) => updateQuestion(idx, "option_d", e.target.value)} style={{ flex: 1, minWidth: 100 }} />
                <input
                  type="text"
                  placeholder="Correct (A/B/C/D)"
                  value={q.correct_answer}
                  onChange={(e) => updateQuestion(idx, "correct_answer", e.target.value)}
                  style={{ width: 130 }}
                />
              </div>
            </div>
          ))}

          <button type="button" className="btn-small" onClick={addQuestionRow} style={{ marginBottom: 12 }}>
            <Plus size={14} /> Add Question
          </button>

          <div>
            <button type="submit" className="btn-primary">Create Exam</button>
          </div>
        </form>
      )}

      {message && <div className="message-box info" style={{ marginBottom: 16 }}>{message}</div>}

      <h3 style={{ fontSize: 15, marginTop: 8 }}>Existing Exams</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Click an exam's name to view its question paper.
      </p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Exam ID</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {exams.length === 0 && (
            <tr>
              <td colSpan="4" className="muted">No exams created yet.</td>
            </tr>
          )}
          {exams.map((e) => (
            <Fragment key={e.exam_id}>
              <tr>
                <td>
                  <span
                    onClick={() => handleToggleView(e.exam_id)}
                    style={{ cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, fontWeight: 600 }}
                  >
                    {e.name}
                  </span>
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{e.exam_id}</td>
                <td>
                  {e.is_active ? (
                    <span className="badge good">ACTIVE</span>
                  ) : (
                    <span className="muted">inactive</span>
                  )}
                </td>
                <td>
                  {!e.is_active && (
                    <button className="btn-small" onClick={() => handleActivate(e.exam_id)}>
                      <CheckCircle2 size={14} /> Activate
                    </button>
                  )}
                </td>
              </tr>
              {expandedExamId === e.exam_id && (
                <tr>
                  <td colSpan="4" style={{ background: "var(--bg-2)" }}>
                    {loadingQuestions ? (
                      <p className="muted">Loading questions…</p>
                    ) : expandedQuestions.length === 0 ? (
                      <p className="muted">No questions found for this exam.</p>
                    ) : (
                      <div style={{ padding: "8px 4px" }}>
                        {expandedQuestions.map((q) => (
                          <div key={q.question_number} style={{ marginBottom: 14 }}>
                            <div style={{ fontWeight: 600 }}>
                              {q.question_number}. {q.question_text}
                            </div>
                            {(q.option_a || q.option_b || q.option_c || q.option_d) && (
                              <div style={{ paddingLeft: 16, marginTop: 4, fontSize: 14, color: "var(--muted)" }}>
                                {q.option_a && <div>A. {q.option_a}</div>}
                                {q.option_b && <div>B. {q.option_b}</div>}
                                {q.option_c && <div>C. {q.option_c}</div>}
                                {q.option_d && <div>D. {q.option_d}</div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}