import { useEffect, useState, useCallback } from "react";
import {
  LayoutDashboard,
  Server,
  ListChecks,
  Activity,
  UploadCloud,
  ShieldAlert,
  ClipboardCheck,
  GraduationCap,
  FileText,
} from "lucide-react";
import { api } from "./api";
import Dashboard from "./components/Dashboard";
import WorkerTable from "./components/WorkerTable";
import TaskTable from "./components/TaskTable";
import EventsPanel from "./components/EventsPanel";
import SubmitForm from "./components/SubmitForm";
import FailurePanel from "./components/FailurePanel";
import MarkingDashboard from "./components/MarkingDashboard";
import ExamManager from "./components/ExamManager";

const TABS = [
  { key: "Dashboard", icon: LayoutDashboard },
  { key: "Workers", icon: Server },
  { key: "Tasks", icon: ListChecks },
  { key: "Marking Dashboard", icon: ClipboardCheck },
  { key: "Exams", icon: FileText },
  { key: "Events", icon: Activity },
  { key: "Submit", icon: UploadCloud },
  { key: "Failure Simulation", icon: ShieldAlert },
];

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [state, setState] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [electionLogs, setElectionLogs] = useState([]);
  const [markingSummary, setMarkingSummary] = useState(null);
  const [connected, setConnected] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const [s, w, t, e, el, ms] = await Promise.all([
        api.getState(),
        api.getWorkers(),
        api.getTasks(),
        api.getEvents(),
        api.getElectionLogs(),
        api.getMarkingSummary(),
      ]);
      setState(s);
      setWorkers(w);
      setTasks(t);
      setEvents(e);
      setElectionLogs(el);
      setMarkingSummary(ms);
      setConnected(true);
    } catch (err) {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
    // Fallback polling: still used for tabs like Dashboard/Workers/Tasks
    // that aggregate state rather than append events.
    const interval = setInterval(refreshAll, 2000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    // Message-oriented live channel: the coordinator pushes each event the
    // instant it's logged, so the Events tab updates with zero polling
    // delay - a genuinely different communication pattern from the
    // request/response calls above.
    const close = api.connectEventStream(
      (message) => {
        if (message.type === "event") {
          setEvents((prev) => [
            {
              event: message.event,
              process: message.process,
              lamport_clock: message.lamport_clock,
              timestamp: message.timestamp,
            },
            ...prev,
          ].slice(0, 100));
        }
      },
      (isOpen) => setLiveConnected(isOpen)
    );
    return close;
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-header-top">
          <GraduationCap size={26} />
          <h1>Distributed Exam Evaluation System</h1>
        </div>
        <p className="subtitle">Teacher Dashboard — Coordinator, Workers &amp; Marking, all in one place</p>
        <span className={`connection-pill ${connected ? "online" : "offline"}`}>
          <span className="dot" />
          {connected ? "Connected to Coordinator (localhost:8000)" : "Cannot reach Coordinator — is it running?"}
        </span>
        <span className={`connection-pill ${liveConnected ? "online" : "offline"}`} style={{ marginLeft: 8 }}>
          <span className="dot" />
          {liveConnected ? "Live event stream connected (WebSocket)" : "Live event stream offline"}
        </span>
      </div>

      <div className="tabs">
        {TABS.map(({ key, icon: Icon }) => (
          <div key={key} className={`tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            <Icon />
            {key}
          </div>
        ))}
      </div>

      {tab === "Dashboard" && <Dashboard state={state} />}
      {tab === "Workers" && <WorkerTable workers={workers} />}
      {tab === "Tasks" && <TaskTable tasks={tasks} />}
      {tab === "Marking Dashboard" && <MarkingDashboard summary={markingSummary} tasks={tasks} />}
      {tab === "Exams" && <ExamManager onExamActivated={refreshAll} />}
      {tab === "Events" && <EventsPanel events={events} electionLogs={electionLogs} />}
      {tab === "Submit" && <SubmitForm onSubmitted={refreshAll} />}
      {tab === "Failure Simulation" && <FailurePanel workers={workers} onAction={refreshAll} />}
    </div>
  );
}