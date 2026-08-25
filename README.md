# Distributed Exam Evaluation and Result Processing System

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green)](#license)

A simplified, fully local implementation of a **distributed exam evaluation
system**, built to demonstrate core Distributed Systems concepts end to end —
from load balancing and fault tolerance to leader election and mutual
exclusion — behind a polished React teacher dashboard.

No Docker, Kubernetes, Kafka, RabbitMQ, or cloud services are used.
Everything runs as plain local Python and Node processes, so every message
between independent processes is real and observable.

---

## Table of Contents

1. [Core Concepts Demonstrated](#1-core-concepts-demonstrated)
2. [Project Structure](#2-project-structure)
3. [Prerequisites](#3-prerequisites)
4. [Setup](#4-setup-one-time)
5. [Running the System](#5-running-the-system)
6. [Using the Dashboard](#6-using-the-dashboard)
7. [Demonstration Scenarios](#7-demonstration-scenarios)
8. [API Reference](#8-api-reference-coordinator-port-8000)
9. [Design Notes](#9-notes-on-design-choices-for-your-reportviva)
10. [Troubleshooting](#10-troubleshooting)
11. [License](#11-license)

---

## 1. Core Concepts Demonstrated

| Concept | Where it lives |
|---|---|
| Load balancing (Round Robin) | `coordinator/load_balancer.py` |
| Parallel processing across independent worker processes | `worker/worker.py` (run 3x) |
| Heartbeat / failure detection | `coordinator/heartbeat.py` |
| Fault tolerance with automatic task reassignment | `coordinator/main.py` |
| Lamport logical clocks | `coordinator/lamport_clock.py`, `worker/lamport_clock.py` |
| Leader election (simplified Bully Algorithm) | `coordinator/election.py` |
| Distributed mutual exclusion (coordinator-managed lock) | `coordinator/distributed_lock.py` |
| Global state tracking | `coordinator/main.py` (`/state`) |
| React dashboard for teachers — answer-sheet upload, marking analytics | `frontend/` |

---

## 2. Project Structure

```
Exam-Evaluation-using-Distributed-System/
├── coordinator/            FastAPI coordinator server (port 8000)
│   ├── main.py              all API endpoints, wiring
│   ├── database.py          SQLite / SQLAlchemy setup
│   ├── models.py            ORM models
│   ├── schemas.py           Pydantic request/response models
│   ├── load_balancer.py     Round Robin balancer
│   ├── heartbeat.py         background heartbeat monitor thread
│   ├── lamport_clock.py     Lamport clock implementation
│   ├── election.py          Bully election logic
│   ├── distributed_lock.py  Mutual exclusion lock
│   └── requirements.txt
│
├── worker/                 Independent evaluation worker (run 3x)
│   ├── worker.py             FastAPI app + heartbeat thread + CLI args
│   ├── evaluator.py          scoring logic (modular, swappable for AI later)
│   ├── lamport_clock.py
│   └── requirements.txt
│
├── frontend/                React + Vite teacher dashboard
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   ├── index.css
│   │   └── components/
│   │       ├── Dashboard.jsx
│   │       ├── WorkerTable.jsx
│   │       ├── TaskTable.jsx
│   │       ├── EventsPanel.jsx
│   │       ├── MarkingDashboard.jsx
│   │       ├── SubmitForm.jsx
│   │       └── FailurePanel.jsx
│   └── package.json
│
├── database/                exam_system.db is created here automatically
├── README.md
└── .gitignore
```

---

## 3. Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- Five free terminal windows/tabs (1 coordinator + 3 workers + 1 frontend)

---

## 4. Setup (one-time)

### 4.1 Backend (coordinator + worker share one virtual environment)

From the project root:

```bash
python3 -m venv venv

# Activate it
source venv/bin/activate        # macOS / Linux
venv\Scripts\activate           # Windows

pip install -r coordinator/requirements.txt
pip install -r worker/requirements.txt
```

### 4.2 Frontend

```bash
cd frontend
npm install
```

---

## 5. Running the System

You need **5 terminals total**: 1 for the coordinator, 3 for workers, 1 for
the frontend. Activate the same Python virtual environment in the
coordinator and worker terminals.

### Terminal 1 — Coordinator (start this first)

```bash
cd coordinator
source ../venv/bin/activate     # if not already active
uvicorn main:app --port 8000
```

You should see `Uvicorn running on http://0.0.0.0:8000`. The SQLite
database file is created automatically at `database/exam_system.db`.

### Terminal 2 — Worker 1

```bash
cd worker
source ../venv/bin/activate
python worker.py --id 1 --port 8001
```

### Terminal 3 — Worker 2

```bash
cd worker
source ../venv/bin/activate
python worker.py --id 2 --port 8002
```

### Terminal 4 — Worker 3

```bash
cd worker
source ../venv/bin/activate
python worker.py --id 3 --port 8003
```

Each worker registers itself with the coordinator on startup and begins
sending a heartbeat every 3 seconds.

### Terminal 5 — Frontend

```bash
cd frontend
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**) in your browser.

---

## 6. Using the Dashboard

The dashboard has six tabs:

1. **Dashboard** — global counters (tasks, workers, current coordinator,
   Lamport clock), auto-refreshing every 2 seconds.
2. **Workers** — table of all workers: port, status, workload, completed
   count, last heartbeat.
3. **Tasks** — every submitted answer sheet, its assigned worker, status,
   and score.
4. **Events** — the distributed event log (task assignment, results,
   failures, reassignment), each tagged with its Lamport clock value, plus
   the election log.
5. **Marking Dashboard** — aggregated evaluation results: sheets evaluated,
   average/highest/lowest score, a question-wise accuracy bar for every
   question in the answer key, and a per-student table you can expand to
   see exactly which questions each student got right or wrong.
6. **Submit** — two modes:
   - **Manual Entry** — enter student name, ID, and comma-separated answers
     (e.g. `A,B,C,D,A`).
   - **Upload File** — enter student name/ID and drag-and-drop (or browse)
     a plain `.txt` answer sheet in the format:
     ```
     Question 1: A
     Question 2: B
     Question 3: C
     Question 4: D
     Question 5: A
     ```
     The coordinator parses the file, creates a task, and assigns it to a
     worker via the same Round Robin load balancer as manual submissions —
     nothing about the distributed pipeline changes based on how the sheet
     arrived.
7. **Failure Simulation** — buttons to fail/recover each worker and to
   trigger a simulated coordinator failure + leader election.

The default answer key is `A,B,C,D,A` (5 questions). Change it via the API:
`POST /answer-key` with body `{"answer_key": ["A","B","C","D","A"]}`.

---

## 7. Demonstration Scenarios

**Parallel processing / load balancing**
Submit several answer sheets quickly from the Submit tab (or via the
`/submit-bulk` endpoint). Watch the Workers tab — tasks are handed out
round robin, and each worker takes 2–5 seconds (artificial delay) to
"evaluate," so multiple tasks show `PROCESSING` on different workers at once.

**Fault tolerance**
Submit an answer sheet, then quickly click "Fail Worker X" for the worker
it was assigned to (before it completes). The coordinator detects the
failed response and reassigns the task to another active worker — visible
in the Events tab and the task's status (`REASSIGNED` → `COMPLETED`). You
can also just stop a worker process (Ctrl+C in its terminal) — after 8
seconds without a heartbeat, the coordinator marks it `FAILED` automatically.

**Leader election**
Click "Simulate Coordinator Failure / Start Election" on the Failure
Simulation tab. The system runs a simplified Bully Algorithm among active
workers, and the highest-ID active worker becomes the new coordinator —
see the Election Logs section under the Events tab.

**Mutual exclusion**
Exercised via `POST /lock/request` and `POST /lock/release` (see API
reference below) — only one worker can hold the lock at a time, and the
request/grant/release sequence is written to the Events log.

**Lamport clocks**
Every distributed event recorded in the Events tab carries a Lamport clock
value. Watch the values increase as tasks are assigned, evaluated, and
results returned — the classic "happens-before" ordering plays out live.

---

## 8. API Reference (coordinator, port 8000)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/workers/register` | Worker self-registration |
| POST | `/workers/{id}/heartbeat` | Worker heartbeat ping |
| GET | `/workers` | List all workers + status |
| POST | `/workers/{id}/fail` | Simulate worker failure + reassign tasks |
| POST | `/workers/{id}/recover` | Recover a failed worker |
| POST | `/submit` | Submit a single answer sheet (manual) |
| POST | `/submit-bulk` | Submit multiple answer sheets (manual) |
| POST | `/submit-file` | Upload a text answer sheet (multipart) |
| GET | `/tasks` | List all tasks (includes marking breakdown) |
| GET | `/marking-summary` | Aggregated marking stats for the dashboard |
| GET | `/answer-key` | Get current answer key |
| POST | `/answer-key` | Set a new answer key |
| GET | `/state` | Global system state / counters |
| GET | `/events` | Distributed event log (with Lamport clock) |
| POST | `/election/start` | Trigger leader election |
| GET | `/election/logs` | Election step-by-step log |
| GET | `/coordinator` | Current coordinator name |
| POST | `/lock/request` | Request the mutual exclusion lock |
| POST | `/lock/release` | Release the mutual exclusion lock |
| GET | `/lock/status` | Current lock holder |
| WS | `/ws/events` | Live WebSocket stream of the event log |

Interactive API docs are also available at **http://localhost:8000/docs**
(FastAPI's built-in Swagger UI) once the coordinator is running.

---

## 9. Notes on Design Choices (for your report/viva)

- **Why HTTP instead of raw sockets?** FastAPI + HTTP keeps every process
  independently runnable and easy to inspect (curl, Swagger UI) while still
  genuinely demonstrating inter-process communication between separate
  Python processes on different ports — the core requirement.
- **Where the Lamport clock lives**: each process (coordinator and every
  worker) keeps its own clock. `tick()` is called before local/send events,
  and `update()` implements `clock = max(local, received) + 1` on every
  received message, matching the classic algorithm.
- **Bully election simplification**: since the coordinator process itself
  keeps running the API even during a "coordinator failure" demo (needed so
  the frontend keeps working), the election is coordinator-orchestrated: it
  contacts active workers in ascending ID order the way the algorithm
  specifies, and the highest-ID active worker is declared the winner. This
  preserves the message-passing pattern of the Bully Algorithm while
  staying simple enough to run and observe locally.
- **Mutual exclusion**: implemented as a single coordinator-held lock
  (`threading.Lock`) with request/release endpoints, modeling a centralized
  mutual exclusion algorithm — the simplest of the classic approaches and
  appropriate for this scale.
- **Evaluation logic is isolated in `worker/evaluator.py`** specifically so
  it can be swapped for an AI-based evaluator later without touching any
  networking, load balancing, or fault-tolerance code.

