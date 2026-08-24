import json
import re
import uuid
from datetime import datetime

import httpx
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, SessionLocal, get_db
from lamport_clock import LamportClock
from load_balancer import RoundRobinBalancer
from heartbeat import start_heartbeat_monitor
from election import run_bully_election
from distributed_lock import DistributedLock

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Distributed Exam Evaluation Coordinator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

clock = LamportClock()
balancer = RoundRobinBalancer()
lock = DistributedLock()

ANSWER_KEY = ["A", "B", "C", "D", "A"]
CURRENT_COORDINATOR = "Main Coordinator"


# ---------- helpers ----------

def log_event(db: Session, event: str, process: str):
    tick = clock.tick()
    ev = models.DistributedEvent(event=event, process=process, lamport_clock=tick)
    db.add(ev)
    db.commit()
    return tick


def log_event_static(db: Session, event: str, process: str):
    # used by heartbeat monitor thread (has its own db session)
    tick = clock.tick()
    ev = models.DistributedEvent(event=event, process=process, lamport_clock=tick)
    db.add(ev)
    db.commit()
    return tick


def get_active_workers(db: Session):
    return db.query(models.Worker).filter(models.Worker.status == "ACTIVE").order_by(models.Worker.worker_id).all()


def parse_answer_sheet_text(content: str) -> list:
    """Parses a simple text answer sheet of the form:
        Question 1: A
        Question 2: B
        ...
    Falls back to accepting bare option lines or a single comma-separated line.
    """
    answers = []
    text = content.strip()

    # Comma-separated single line, e.g. "A,B,C,D,A"
    if "\n" not in text and "," in text:
        return [a.strip().upper() for a in text.split(",") if a.strip()]

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r"(?:question\s*\d+\s*[:.\-]?\s*)([A-Za-z0-9]+)", line, re.IGNORECASE)
        if match:
            answers.append(match.group(1).strip().upper())
            continue
        # bare short token like "A" or "1" on its own line
        if re.match(r"^[A-Za-z0-9]{1,3}$", line):
            answers.append(line.strip().upper())

    return answers


def create_task_and_dispatch(
    db: Session,
    background_tasks: BackgroundTasks,
    student_name: str,
    student_id: str,
    answers: list,
    source: str = "manual",
):
    task_id = str(uuid.uuid4())[:8]
    task = models.Task(
        task_id=task_id,
        student_name=student_name,
        student_id=student_id,
        answers=",".join(answers),
        status="PENDING",
        total=len(ANSWER_KEY),
        source=source,
    )
    db.add(task)
    db.commit()
    log_event(db, f"Answer Sheet Submitted ({source}) - Task {task_id}", "Coordinator")
    background_tasks.add_task(evaluate_task_background, task_id)
    return task_id


async def send_task_to_worker(worker: models.Worker, task: models.Task, db: Session):
    """Sends the evaluation request to a worker over HTTP. Returns True on success."""
    tick = clock.tick()
    log_event(db, f"Task Assigned to Worker {worker.worker_id}", "Coordinator")
    url = f"http://localhost:{worker.port}/evaluate"
    payload = {
        "task_id": task.task_id,
        "student_id": task.student_id,
        "answers": task.answers,
        "answer_key": ANSWER_KEY,
        "lamport_clock": tick,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()
            if data.get("status") != "completed":
                return False, data
            clock.update(data.get("lamport_clock", tick))
            return True, data
    except Exception as e:
        return False, {"error": str(e)}


async def evaluate_task_background(task_id: str):
    """Background job: assign task to a worker, handle failure + reassignment."""
    db = SessionLocal()
    try:
        task = db.query(models.Task).filter(models.Task.task_id == task_id).first()
        if not task:
            return

        attempts = 0
        max_attempts = 3
        tried_worker_ids = set()

        while attempts < max_attempts:
            attempts += 1
            active_workers = [w for w in get_active_workers(db) if w.worker_id not in tried_worker_ids]
            if not active_workers:
                task.status = "FAILED"
                db.commit()
                log_event(db, f"Task {task.task_id} FAILED - no active workers", "Coordinator")
                return

            worker = balancer.get_next_worker(active_workers)
            tried_worker_ids.add(worker.worker_id)

            task.assigned_worker = worker.worker_id
            task.status = "PROCESSING"
            worker.workload += 1
            db.commit()

            success, data = await send_task_to_worker(worker, task, db)

            worker.workload = max(0, worker.workload - 1)

            if success:
                task.status = "COMPLETED"
                task.score = data.get("score")
                task.total = data.get("total")
                task.breakdown = json.dumps(data.get("breakdown", []))
                task.lamport_clock = clock.value
                worker.completed += 1
                db.commit()

                result = models.Result(
                    task_id=task.task_id,
                    worker_id=worker.worker_id,
                    score=data.get("score"),
                    total=data.get("total"),
                    status="completed",
                )
                db.add(result)
                db.commit()
                log_event(db, f"Result Received from Worker {worker.worker_id}", "Coordinator")
                return
            else:
                worker.status = "FAILED"
                db.commit()
                log_event(
                    db,
                    f"Worker {worker.worker_id} failed while processing Task {task.task_id} - reassigning",
                    "Coordinator",
                )
                task.status = "REASSIGNED"
                db.commit()
                # loop will retry with another active worker

        task.status = "FAILED"
        db.commit()
        log_event(db, f"Task {task.task_id} FAILED after {max_attempts} attempts", "Coordinator")
    finally:
        db.close()


# ---------- worker registration & heartbeat ----------

@app.post("/workers/register")
def register_worker(payload: schemas.WorkerRegister, db: Session = Depends(get_db)):
    existing = db.query(models.Worker).filter(models.Worker.worker_id == payload.worker_id).first()
    if existing:
        existing.port = payload.port
        existing.status = "ACTIVE"
        existing.last_heartbeat = datetime.utcnow()
        db.commit()
        log_event(db, f"Worker {payload.worker_id} Re-registered", f"Worker {payload.worker_id}")
        return {"message": "worker re-registered"}

    worker = models.Worker(worker_id=payload.worker_id, port=payload.port, status="ACTIVE")
    db.add(worker)
    db.commit()
    log_event(db, f"Worker {payload.worker_id} Registered", f"Worker {payload.worker_id}")
    return {"message": "worker registered"}


@app.post("/workers/{worker_id}/heartbeat")
def heartbeat(worker_id: int, payload: schemas.HeartbeatIn, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="worker not found")
    was_failed = worker.status == "FAILED"
    worker.last_heartbeat = datetime.utcnow()
    if worker.status != "DOWN":
        worker.status = "ACTIVE"
    clock.update(payload.lamport_clock)
    db.commit()
    if was_failed:
        log_event(db, f"Worker {worker_id} recovered (heartbeat resumed)", f"Worker {worker_id}")
    return {"status": "ok"}


@app.get("/workers")
def list_workers(db: Session = Depends(get_db)):
    workers = db.query(models.Worker).order_by(models.Worker.worker_id).all()
    return [
        {
            "worker_id": w.worker_id,
            "port": w.port,
            "status": w.status,
            "workload": w.workload,
            "completed": w.completed,
            "last_heartbeat": w.last_heartbeat.isoformat() if w.last_heartbeat else None,
        }
        for w in workers
    ]


@app.post("/workers/{worker_id}/fail")
async def fail_worker(worker_id: int, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="worker not found")

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(f"http://localhost:{worker.port}/simulate-failure")
    except Exception:
        pass

    worker.status = "FAILED"
    db.commit()
    log_event(db, f"Worker {worker_id} Failure Simulated", "Coordinator")

    # reassign any pending/processing tasks
    stuck_tasks = db.query(models.Task).filter(
        models.Task.assigned_worker == worker_id,
        models.Task.status.in_(["PENDING", "PROCESSING"]),
    ).all()
    reassigned_ids = [t.task_id for t in stuck_tasks]
    for t in stuck_tasks:
        t.status = "REASSIGNED"
    db.commit()

    return {"message": f"worker {worker_id} marked FAILED", "reassigned_tasks": reassigned_ids}


@app.post("/workers/{worker_id}/recover")
async def recover_worker(worker_id: int, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="worker not found")

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(f"http://localhost:{worker.port}/recover")
    except Exception:
        pass

    worker.status = "ACTIVE"
    worker.last_heartbeat = datetime.utcnow()
    db.commit()
    log_event(db, f"Worker {worker_id} Recovered", "Coordinator")
    return {"message": f"worker {worker_id} recovered"}


# ---------- answer sheet submission ----------

@app.post("/submit")
def submit_answer_sheet(sheet: schemas.AnswerSheet, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    answers = [a.strip().upper() for a in sheet.answers.split(",") if a.strip()]
    task_id = create_task_and_dispatch(
        db, background_tasks, sheet.student_name, sheet.student_id, answers, source="manual"
    )
    return {"task_id": task_id, "message": "submitted"}


@app.post("/submit-bulk")
def submit_bulk(payload: schemas.BulkSubmit, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    task_ids = []
    for sheet in payload.sheets:
        answers = [a.strip().upper() for a in sheet.answers.split(",") if a.strip()]
        task_id = create_task_and_dispatch(
            db, background_tasks, sheet.student_name, sheet.student_id, answers, source="manual"
        )
        task_ids.append(task_id)
    return {"task_ids": task_ids}


@app.post("/submit-file")
async def submit_file(
    background_tasks: BackgroundTasks,
    student_name: str = Form(...),
    student_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="ignore")

    answers = parse_answer_sheet_text(content)
    if not answers:
        raise HTTPException(
            status_code=400,
            detail="Could not parse any answers from the uploaded file. "
            "Expected lines like 'Question 1: A' or a comma-separated list.",
        )

    task_id = create_task_and_dispatch(
        db, background_tasks, student_name, student_id, answers, source="upload"
    )
    return {"task_id": task_id, "message": "submitted", "parsed_answers": answers}


@app.get("/tasks")
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.query(models.Task).order_by(models.Task.id.desc()).all()
    return [
        {
            "task_id": t.task_id,
            "student_name": t.student_name,
            "student_id": t.student_id,
            "assigned_worker": t.assigned_worker,
            "status": t.status,
            "score": t.score,
            "total": t.total,
            "source": t.source,
            "answers": t.answers,
            "breakdown": json.loads(t.breakdown) if t.breakdown else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tasks
    ]


@app.get("/marking-summary")
def marking_summary(db: Session = Depends(get_db)):
    """Aggregate marking statistics across all completed tasks - powers the
    Marking Dashboard on the frontend."""
    completed = db.query(models.Task).filter(models.Task.status == "COMPLETED").all()

    if not completed:
        return {
            "evaluated_count": 0,
            "average_score": 0,
            "highest_score": 0,
            "lowest_score": 0,
            "question_stats": [],
            "answer_key": ANSWER_KEY,
        }

    scores = [t.score for t in completed if t.score is not None]
    total_q = len(ANSWER_KEY)
    question_correct_counts = [0] * total_q
    question_attempts = [0] * total_q

    for t in completed:
        if not t.breakdown:
            continue
        breakdown = json.loads(t.breakdown)
        for item in breakdown:
            idx = item["question"] - 1
            if 0 <= idx < total_q:
                question_attempts[idx] += 1
                if item["is_correct"]:
                    question_correct_counts[idx] += 1

    question_stats = [
        {
            "question": i + 1,
            "correct_answer": ANSWER_KEY[i],
            "attempts": question_attempts[i],
            "correct": question_correct_counts[i],
            "accuracy_pct": round((question_correct_counts[i] / question_attempts[i]) * 100)
            if question_attempts[i] > 0
            else 0,
        }
        for i in range(total_q)
    ]

    return {
        "evaluated_count": len(completed),
        "average_score": round(sum(scores) / len(scores), 2) if scores else 0,
        "highest_score": max(scores) if scores else 0,
        "lowest_score": min(scores) if scores else 0,
        "question_stats": question_stats,
        "answer_key": ANSWER_KEY,
    }


# ---------- answer key ----------

@app.get("/answer-key")
def get_answer_key():
    return {"answer_key": ANSWER_KEY}


@app.post("/answer-key")
def set_answer_key(payload: schemas.AnswerKeyIn):
    global ANSWER_KEY
    ANSWER_KEY = [a.upper() for a in payload.answer_key]
    return {"answer_key": ANSWER_KEY}


# ---------- global state ----------

@app.get("/state")
def global_state(db: Session = Depends(get_db)):
    tasks = db.query(models.Task).all()
    workers = db.query(models.Worker).all()
    return {
        "total_tasks": len(tasks),
        "pending": len([t for t in tasks if t.status == "PENDING"]),
        "processing": len([t for t in tasks if t.status == "PROCESSING"]),
        "completed": len([t for t in tasks if t.status == "COMPLETED"]),
        "failed": len([t for t in tasks if t.status == "FAILED"]),
        "reassigned": len([t for t in tasks if t.status == "REASSIGNED"]),
        "active_workers": len([w for w in workers if w.status == "ACTIVE"]),
        "failed_workers": len([w for w in workers if w.status == "FAILED"]),
        "current_coordinator": CURRENT_COORDINATOR,
        "lamport_clock": clock.value,
    }


# ---------- distributed events ----------

@app.get("/events")
def list_events(db: Session = Depends(get_db)):
    events = db.query(models.DistributedEvent).order_by(models.DistributedEvent.id.desc()).limit(100).all()
    return [
        {
            "event": e.event,
            "process": e.process,
            "lamport_clock": e.lamport_clock,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in events
    ]


# ---------- leader election ----------

@app.post("/election/start")
def start_election(db: Session = Depends(get_db)):
    global CURRENT_COORDINATOR
    active_workers = get_active_workers(db)

    def log(msg):
        entry = models.ElectionLog(message=msg)
        db.add(entry)
        db.commit()

    log_event(db, "Coordinator Failure Simulated - Election Triggered", "Coordinator")
    leader = run_bully_election(active_workers, log)
    if leader:
        CURRENT_COORDINATOR = f"Worker {leader.worker_id}"
        return {"new_coordinator": CURRENT_COORDINATOR}
    return {"new_coordinator": None, "message": "no active workers to elect"}


@app.get("/election/logs")
def election_logs(db: Session = Depends(get_db)):
    logs = db.query(models.ElectionLog).order_by(models.ElectionLog.id.desc()).limit(50).all()
    return [{"message": l.message, "timestamp": l.timestamp.isoformat()} for l in logs]


@app.get("/coordinator")
def current_coordinator():
    return {"current_coordinator": CURRENT_COORDINATOR}


# ---------- distributed mutual exclusion ----------

@app.post("/lock/request")
def request_lock(payload: schemas.LockRequest, db: Session = Depends(get_db)):
    granted = lock.request(payload.worker_id)
    if granted:
        log_event(db, f"Worker {payload.worker_id} requested and was GRANTED the lock", f"Worker {payload.worker_id}")
    else:
        log_event(db, f"Worker {payload.worker_id} requested the lock - DENIED (held by {lock.holder})", f"Worker {payload.worker_id}")
    return {"granted": granted, "holder": lock.holder}


@app.post("/lock/release")
def release_lock(payload: schemas.LockRequest, db: Session = Depends(get_db)):
    released = lock.release(payload.worker_id)
    if released:
        log_event(db, f"Worker {payload.worker_id} released the lock", f"Worker {payload.worker_id}")
    return {"released": released, "holder": lock.holder}


@app.get("/lock/status")
def lock_status():
    return {"holder": lock.holder}


# ---------- startup ----------

@app.on_event("startup")
def on_startup():
    start_heartbeat_monitor(SessionLocal, models.Worker, log_event_static)


@app.get("/")
def root():
    return {"message": "Distributed Exam Evaluation Coordinator is running"}
