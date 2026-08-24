const BASE_URL = "http://localhost:8000";

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
  getTasks: () => request("/tasks"),
  getEvents: () => request("/events"),
  getElectionLogs: () => request("/election/logs"),
  getCoordinator: () => request("/coordinator"),
  getLockStatus: () => request("/lock/status"),
  getAnswerKey: () => request("/answer-key"),

  submitSheet: (sheet) =>
    request("/submit", { method: "POST", body: JSON.stringify(sheet) }),

  submitFile: async (studentName, studentId, file) => {
    const formData = new FormData();
    formData.append("student_name", studentName);
    formData.append("student_id", studentId);
    formData.append("file", file);
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

  getMarkingSummary: () => request("/marking-summary"),

  failWorker: (workerId) =>
    request(`/workers/${workerId}/fail`, { method: "POST" }),

  recoverWorker: (workerId) =>
    request(`/workers/${workerId}/recover`, { method: "POST" }),

  startElection: () => request("/election/start", { method: "POST" }),
};
