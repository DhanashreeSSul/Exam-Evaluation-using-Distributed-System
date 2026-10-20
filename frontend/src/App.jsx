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
  GitBranch,
  Link2,
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
import SynchronizationPanel from "./components/SynchronizationPanel";
import LedgerPanel from "./components/LedgerPanel";

const NAV = [
  {
    section: "Monitor",
    items: [
      { key: "Dashboard", icon: LayoutDashboard },
      { key: "Workers", icon: Server },
      { key: "Tasks", icon: ListChecks },
      { key: "Events", icon: Activity },
    ],
  },
  {
    section: "Exam",
    items: [
      { key: "Exams", icon: FileText },
      { key: "Submit", icon: UploadCloud },
      { key: "Marking Dashboard", icon: ClipboardCheck },
    ],
  },
  {
    section: "Distributed",
    items: [
      { key: "Sync", icon: GitBranch },
      { key: "Ledger", icon: Link2 },
      { key: "Failure Simulation", icon: ShieldAlert },
    ],
  },
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
    const interval = setInterval(refreshAll, 2000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    // Live channel: coordinator pushes each event the instant it is logged.
    const close = api.connectEventStream(
      (message) => {
        if (message.type === "event") {
          setEvents((prev) =>
            [
              {
                event: message.event,
                process: message.process,
                lamport_clock: message.lamport_clock,
                timestamp: message.timestamp,
              },
              ...prev,
            ].slice(0, 100)
          );
        }
      },
      (isOpen) => setLiveConnected(isOpen)
    );
    return close;
  }, []);

  const section = NAV.find((g) => g.items.some((i) => i.key === tab))?.section;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={21} />
          </div>
          <div>
            <div className="brand-name">Exam Control Room</div>
            <div className="brand-sub">Distributed Evaluation</div>
          </div>
        </div>

        {NAV.map((group) => (
          <div key={group.section} style={{ display: "contents" }}>
            <div className="nav-section">{group.section}</div>
            {group.items.map(({ key, icon: Icon }) => (
              <div
                key={key}
                role="button"
                tabIndex={0}
                className={`nav-item ${tab === key ? "active" : ""}`}
                onClick={() => setTab(key)}
                onKeyDown={(e) => e.key === "Enter" && setTab(key)}
              >
                <Icon />
                {key}
              </div>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">coordinator · localhost:8000</div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <div className="crumb">{section}</div>
            <h1>{tab}</h1>
          </div>
          <div className="topbar-chips">
            <span className={`connection-pill ${connected ? "online" : "offline"}`}>
              <span className="dot" />
              {connected ? "Coordinator online" : "Coordinator unreachable"}
            </span>
            <span className={`connection-pill ${liveConnected ? "online" : "offline"}`}>
              <span className="dot" />
              {liveConnected ? "Live stream" : "Stream offline"}
            </span>
          </div>
        </div>

        {tab === "Dashboard" && <Dashboard state={state} workers={workers} />}
        {tab === "Workers" && <WorkerTable workers={workers} state={state} />}
        {tab === "Tasks" && <TaskTable tasks={tasks} />}
        {tab === "Marking Dashboard" && <MarkingDashboard summary={markingSummary} tasks={tasks} />}
        {tab === "Exams" && <ExamManager onExamActivated={refreshAll} />}
        {tab === "Events" && <EventsPanel events={events} electionLogs={electionLogs} />}
        {tab === "Submit" && <SubmitForm onSubmitted={refreshAll} />}
        {tab === "Failure Simulation" && <FailurePanel workers={workers} onAction={refreshAll} />}
        {tab === "Sync" && <SynchronizationPanel />}
        {tab === "Ledger" && <LedgerPanel />}
      </main>
    </div>
  );
}