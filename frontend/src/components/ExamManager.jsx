import { useEffect, useState } from "react";
import { FileText, Plus, CheckCircle2, Trash2, UploadCloud } from "lucide-react";
import { api } from "../api";

export default function ExamManager({ onExamActivated }) {
  const [exams, setExams] = useState([]);
  const [activeExam, setActiveExam] = useState(null);
  const [message, setMessage] = useState("");

  // upload form state
  const [uploadExamName, setUploadExamName] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // manual entry form state
  const [showManual, setShowManual] = useState(false);
  const [examName, setExamName] = useState("");
  const [questions, setQuestions] = useState([
    { question_number: 1, question_text: "", correct_answer: "" },
  ]);

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
    setQuestions((prev) => [
      ...prev,
      { question_number: prev.length + 1, question_text: "", correct_answer: "" },
    ]);
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
      setQuestions([{ question_number: 1, question_text: "", correct_answer: "" }]);
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
        <div className="stat-card good" style={{ marginBottom: 16 }}>
          <div className="label">Active Exam</div>
          <div className="value" style={{ fontSize: 18 }}>
            {activeExam.name || activeExam.active_exam_id}
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 15 }}>Upload Question Bank</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Accepts <strong>.txt</strong>, <strong>.csv</strong>, <strong>.pdf</strong>, or{" "}
        <strong>.docx</strong>. One question per line, either style:
        <br />
        <code>1,What is the time complexity of binary search?,B</code>
        <br />
        <code>1. What is the time complexity of binary search? - B</code>
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
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <span style={{ width: 24 }}>{q.question_number}.</span>
              <input
                type="text"
                placeholder="Question text"
                value={q.question_text}
                onChange={(e) => updateQuestion(idx, "question_text", e.target.value)}
                style={{ flex: 3 }}
              />
              <input
                type="text"
                placeholder="Answer"
                value={q.correct_answer}
                onChange={(e) => updateQuestion(idx, "correct_answer", e.target.value)}
                style={{ flex: 1, maxWidth: 80 }}
              />
              <button type="button" className="btn-small danger" onClick={() => removeQuestionRow(idx)}>
                <Trash2 size={14} />
              </button>
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

      {message && <p className="muted" style={{ marginBottom: 16 }}>{message}</p>}

      <h3 style={{ fontSize: 15 }}>Existing Exams</h3>
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
            <tr key={e.exam_id}>
              <td>{e.name}</td>
              <td>{e.exam_id}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}