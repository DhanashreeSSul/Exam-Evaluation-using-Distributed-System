const BASE_URL = "http://localhost:8000";
const WS_URL = "ws://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${path} (${res.status})`);
  }
  return res.json();
}

export const api = {
  getState: () => request("/state"),
  getWorkers: () => request("/workers"),
  getTasks: (examId) => request(examId ? `/tasks?exam_id=${examId}` : "/tasks"),
  getEvents: () => request("/events"),
  getElectionLogs: () => request("/election/logs"),
  getCoordinator: () => request("/coordinator"),
  getLockStatus: () => request("/lock/status"),
  getAnswerKey: () => request("/answer-key"),

  submitSheet: (sheet) =>
    request("/submit", { method: "POST", body: JSON.stringify(sheet) }),

  submitFile: async (studentName, studentId, file, examId) => {
    const formData = new FormData();
    formData.append("student_name", studentName);
    formData.append("student_id", studentId);
    formData.append("file", file);
    if (examId) formData.append("exam_id", examId);
    const res = await fetch(`${BASE_URL}/submit-file`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Upload failed");
    }
    return data;
  },

  getMarkingSummary: (examId) =>
    request(examId ? `/marking-summary?exam_id=${examId}` : "/marking-summary"),

  failWorker: (workerId) =>
    request(`/workers/${workerId}/fail`, { method: "POST" }),

  recoverWorker: (workerId) =>
    request(`/workers/${workerId}/recover`, { method: "POST" }),

  startElection: () => request("/election/start", { method: "POST" }),

  // ---------- exams & question bank ----------

  createExam: (name, questions) =>
    request("/exams", { method: "POST", body: JSON.stringify({ name, questions }) }),

  // Accepts .txt, .csv, .pdf, or .docx - the server auto-detects format
  // from the file extension and extracts question text accordingly.
  uploadExamFile: async (name, file) => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", file);
    const res = await fetch(`${BASE_URL}/exams/upload`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    return data;
  },

  listExams: () => request("/exams"),
  getExamQuestions: (examId, revealAnswers = false) =>
    request(`/exams/${examId}/questions${revealAnswers ? "?reveal_answers=true" : ""}`),
  activateExam: (examId) =>
    request("/exams/activate", { method: "POST", body: JSON.stringify({ exam_id: examId }) }),
  getActiveExam: () => request("/exams/active"),

  // ---------- manual review ----------
  // Read-only task detail view (question text joined in), used by an
  // optional "view submission" screen. Does not touch task dispatch, load
  // balancing, or any other DS mechanism.
  getTaskDetail: (taskId) => request(`/tasks/${taskId}`),

  // Message-oriented / stream-oriented channel: opens a persistent WebSocket
  // to the coordinator and invokes onEvent(message) for every event the
  // coordinator publishes, in real time - no polling involved.
  connectEventStream: (onEvent, onStatusChange) => {
    let socket;
    let closedByClient = false;

    const open = () => {
      socket = new WebSocket(`${WS_URL}/ws/events`);
      socket.onopen = () => onStatusChange && onStatusChange(true);
      socket.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data));
        } catch (e) {
          // ignore malformed message
        }
      };
      socket.onclose = () => {
        onStatusChange && onStatusChange(false);
        if (!closedByClient) {
          // auto-reconnect, e.g. if the coordinator restarts
          setTimeout(open, 2000);
        }
      };
      socket.onerror = () => socket.close();
    };

    open();

    return () => {
      closedByClient = true;
      if (socket) socket.close();
    };
  },
};