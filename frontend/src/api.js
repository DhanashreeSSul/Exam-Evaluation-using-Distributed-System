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