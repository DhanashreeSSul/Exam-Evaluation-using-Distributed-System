import { useState, useRef } from "react";
import { FileText, PenLine, UploadCloud, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../api";

const EXAMPLE_SHEET = `Question 1: A
Question 2: B
Question 3: C
Question 4: D
Question 5: A`;

export default function SubmitForm({ onSubmitted }) {
  const [mode, setMode] = useState("manual"); // "manual" | "upload"

  // manual mode state
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [answers, setAnswers] = useState("A,B,C,D,A");

  // upload mode state
  const [uploadName, setUploadName] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }
  const [submitting, setSubmitting] = useState(false);

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!name || !studentId || !answers) {
      setMessage({ type: "error", text: "Please fill in all fields." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitSheet({
        student_name: name,
        student_id: studentId,
        answers,
      });
      setMessage({ type: "success", text: `Submitted to coordinator — Task ID: ${res.task_id}` });
      setName("");
      setStudentId("");
      setAnswers("A,B,C,D,A");
      onSubmitted && onSubmitted();
    } catch (err) {
      setMessage({ type: "error", text: "Error submitting answer sheet." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadSubmit(e) {
    e.preventDefault();
    if (!uploadName || !uploadId || !file) {
      setMessage({ type: "error", text: "Please enter student details and choose a file." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitFile(uploadName, uploadId, file);
      setMessage({
        type: res.count > 0 ? "success" : "error",
        text: res.count > 0
          ? `Uploaded and submitted ${res.count} answer sheet(s). Task ID(s): ${res.task_ids.join(", ")}`
          : "No answer sheets found in the file. Check the format.",
      });
      setUploadName("");
      setUploadId("");
      setFile(null);
      onSubmitted && onSubmitted();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "Error uploading answer sheet." });
    } finally {
      setSubmitting(false);
    }
  }

  function onFileChosen(f) {
    if (f) setFile(f);
  }

  return (
    <div className="panel">
      <h2>
        <UploadCloud /> Submit Answer Sheet
      </h2>
      <p className="panel-sub">
        Submit answers manually, or upload a text-based answer sheet. Either way, the
        coordinator assigns the task to a worker via Round Robin load balancing.
      </p>

      <div className="segmented">
        <div className={`seg ${mode === "manual" ? "active" : ""}`} onClick={() => setMode("manual")}>
          <PenLine size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Manual Entry
        </div>
        <div className={`seg ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")}>
          <FileText size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          Upload File
        </div>
      </div>

      {mode === "manual" && (
        <form onSubmit={handleManualSubmit}>
          <div className="form-row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">Student Name</label>
              <input
                style={{ width: "100%" }}
                placeholder="e.g. Alice Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">Student ID</label>
              <input
                style={{ width: "100%" }}
                placeholder="e.g. S101"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="field-label">Answers (comma separated)</label>
              <input
                style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                placeholder="A,B,C,D,A"
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit to Coordinator"}
          </button>
        </form>
      )}

      {mode === "upload" && (
        <form onSubmit={handleUploadSubmit}>
          <div className="form-row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">Student Name</label>
              <input
                style={{ width: "100%" }}
                placeholder="e.g. Bob Verma"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="field-label">Student ID</label>
              <input
                style={{ width: "100%" }}
                placeholder="e.g. S102"
                value={uploadId}
                onChange={(e) => setUploadId(e.target.value)}
              />
            </div>
          </div>

          <label className="field-label">Answer Sheet File (.txt)</label>
          <div
            className={`dropzone ${dragOver ? "dragover" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFileChosen(e.dataTransfer.files?.[0]);
            }}
          >
            <UploadCloud />
            <div>
              <strong>Click to choose a file</strong> or drag it here
            </div>
            <div className="muted">Plain text file, one question per line</div>
            {file && (
              <div className="filename">
                <FileText size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {file.name}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              style={{ display: "none" }}
              onChange={(e) => onFileChosen(e.target.files?.[0])}
            />
          </div>

          <label className="field-label">Expected format</label>
          <div className="file-example">{EXAMPLE_SHEET}</div>

          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? "Uploading..." : "Upload & Submit to Coordinator"}
            </button>
          </div>
        </form>
      )}

      {message && (
        <div className={`message-box ${message.type}`}>
          {message.type === "success" ? (
            <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          ) : (
            <XCircle size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />
          )}
          {message.text}
        </div>
      )}
    </div>
  );
}