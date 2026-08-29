import asyncio
import io
import json
import re
import uuid
from datetime import datetime
from typing import Optional

import httpx
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
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
ACTIVE_EXAM_ID = None  # None = legacy mode (no exam scoping yet)


# ---------- message-oriented / stream-oriented communication ----------
# Publish/subscribe layer: the coordinator publishes distributed events as
# messages the moment they happen; connected clients (dashboards) subscribe
# over a persistent WebSocket connection and receive them as a continuous
# stream, with no request initiating each individual message. This is
# independent of the request/response (RPC-style) HTTP calls used elsewhere
# in the system.

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def _broadcast_async(self, message: dict):
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead.append(connection)
        for d in dead:
            self.disconnect(d)

    def publish(self, message: dict):
        """Publish a message to all subscribers. Safe to call from either the
        main event loop (request handlers) or a background thread (heartbeat
        monitor), matching how log_event() is used in both contexts."""
        if not self.active_connections or self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast_async(message), self.loop)


manager = ConnectionManager()


# ---------- helpers ----------

def log_event(db: Session, event: str, process: str):
    tick = clock.tick()
    ev = models.DistributedEvent(event=event, process=process, lamport_clock=tick)
    db.add(ev)
    db.commit()
    manager.publish({
        "type": "event",
        "event": event,
        "process": process,
        "lamport_clock": tick,
        "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
    })
    return tick


def log_event_static(db: Session, event: str, process: str):
    # used by heartbeat monitor thread (has its own db session)
    tick = clock.tick()
    ev = models.DistributedEvent(event=event, process=process, lamport_clock=tick)
    db.add(ev)
    db.commit()
    manager.publish({
        "type": "event",
        "event": event,
        "process": process,
        "lamport_clock": tick,
        "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
    })
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


def parse_question_bank_text(text: str) -> list:
    """Parses a question bank from plain text extracted from a .txt, .csv,
    .pdf, or .docx file. Two line formats are accepted:

        1,What is the time complexity of binary search?,B
        1. What is the time complexity of binary search? - B

    A header row (e.g. "question_number,question_text,correct_answer") is
    auto-skipped if the first token on line 1 isn't a number.
    """
    questions = []
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]

    for line_num, line in enumerate(lines, start=1):
        # CSV style: number,text,answer  (answer is the LAST comma-separated field)
        if "," in line:
            parts = [p.strip() for p in line.split(",")]
            first_token = parts[0].replace(".", "").replace(")", "")
            if first_token.isdigit() and len(parts) >= 3:
                q_num = int(first_token)
                answer = parts[-1].strip().upper()
                q_text = ",".join(parts[1:-1]).strip()
                if q_text and answer:
                    questions.append({
                        "question_number": q_num,
                        "question_text": q_text,
                        "correct_answer": answer,
                    })
                continue
            if line_num == 1:
                # looked like a header row (e.g. "question_number,question_text,correct_answer")
                continue

        # "1. Question text - B"  or  "1) Question text – B"
        match = re.match(
            r"^(\d+)[\.\)]\s*(.+?)\s*[-–—]\s*([A-Za-z0-9]{1,3})\s*$",
            line,
        )
        if match:
            questions.append({
                "question_number": int(match.group(1)),
                "question_text": match.group(2).strip(),
                "correct_answer": match.group(3).strip().upper(),
            })

    return questions


def extract_text_from_upload(filename: str, raw: bytes) -> str:
    """Extracts plain text from an uploaded question-bank file, supporting
    .txt, .csv, .pdf, and .docx."""
    lower = filename.lower()

    if lower.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            raise HTTPException(status_code=500, detail="Server is missing the 'pypdf' package needed to read PDF files.")
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    if lower.endswith(".docx"):
        try:
            import docx
        except ImportError:
            raise HTTPException(status_code=500, detail="Server is missing the 'python-docx' package needed to read Word files.")
        document = docx.Document(io.BytesIO(raw))
        return "\n".join(p.text for p in document.paragraphs)

    # .txt, .csv, or anything else: treat as plain text
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="ignore")


def create_task_and_dispatch(
    db: Session,
    background_tasks: BackgroundTasks,
    student_name: str,
    student_id: str,
    answers: list,
    source: str = "manual",
    exam_id: str = None,
):
    task_id = str(uuid.uuid4())[:8]
    task = models.Task(
        task_id=task_id,
        exam_id=exam_id or ACTIVE_EXAM_ID,
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
        db, background_tasks, sheet.student_name, sheet.student_id, answers,
        source="manual", exam_id=sheet.exam_id,
    )
    return {"task_id": task_id, "message": "submitted"}


@app.post("/submit-bulk")
def submit_bulk(payload: schemas.BulkSubmit, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    task_ids = []
    for sheet in payload.sheets:
        answers = [a.strip().upper() for a in sheet.answers.split(",") if a.strip()]
        task_id = create_task_and_dispatch(
            db, background_tasks, sheet.student_name, sheet.student_id, answers,
            source="manual", exam_id=sheet.exam_id,
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
def list_tasks(exam_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Task)
    if exam_id:
        query = query.filter(models.Task.exam_id == exam_id)
    tasks = query.order_by(models.Task.id.desc()).all()
    return [
        {
            "task_id": t.task_id,
            "exam_id": t.exam_id,
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
def marking_summary(exam_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Aggregate marking statistics across completed tasks - powers the
    Marking Dashboard on the frontend. Pass ?exam_id=... to scope to one exam."""
    query = db.query(models.Task).filter(models.Task.status == "COMPLETED")
    if exam_id:
        query = query.filter(models.Task.exam_id == exam_id)
    completed = query.all()

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

    questions = db.query(models.Question).filter(models.Question.exam_id == (exam_id or ACTIVE_EXAM_ID)).all()
    question_text_by_number = {q.question_number: q.question_text for q in questions}

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
            "question_text": question_text_by_number.get(i + 1),
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


# ---------- answer key (legacy, still supported for simple single-exam use) ----------

@app.get("/answer-key")
def get_answer_key():
    return {"answer_key": ANSWER_KEY}


@app.post("/answer-key")
def set_answer_key(payload: schemas.AnswerKeyIn):
    global ANSWER_KEY
    ANSWER_KEY = [a.upper() for a in payload.answer_key]
    return {"answer_key": ANSWER_KEY}


# ---------- exams & question bank (multi-exam support) ----------

@app.post("/exams")
def create_exam(payload: schemas.ExamCreate, db: Session = Depends(get_db)):
    """Create an exam from a JSON list of questions (used by the manual
    question-entry form in the frontend)."""
    exam_id = str(uuid.uuid4())[:8]
    exam = models.Exam(exam_id=exam_id, name=payload.name, is_active=0)
    db.add(exam)
    for q in sorted(payload.questions, key=lambda q: q.question_number):
        db.add(models.Question(
            exam_id=exam_id,
            question_number=q.question_number,
            question_text=q.question_text,
            correct_answer=q.correct_answer.upper(),
        ))
    db.commit()
    log_event(db, f"Exam Created: {payload.name} ({exam_id}) - {len(payload.questions)} questions", "Coordinator")
    return {"exam_id": exam_id, "name": payload.name, "question_count": len(payload.questions)}


@app.post("/exams/upload")
async def upload_exam_questions(
    name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Bulk-create an exam's question bank from an uploaded file.
    Supports .txt, .csv, .pdf, and .docx.

    Expected content, one question per line, either style:
        1,What is the time complexity of binary search?,B
        1. What is the time complexity of binary search? - B
    A CSV header row is auto-skipped if present.
    """
    raw = await file.read()
    text = extract_text_from_upload(file.filename, raw)
    questions = parse_question_bank_text(text)

    if not questions:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not parse any questions from the uploaded file. "
                "Expected lines like '1,Question text,A' or '1. Question text - A'."
            ),
        )

    exam_id = str(uuid.uuid4())[:8]
    exam = models.Exam(exam_id=exam_id, name=name, is_active=0)
    db.add(exam)
    for q in sorted(questions, key=lambda q: q["question_number"]):
        db.add(models.Question(
            exam_id=exam_id,
            question_number=q["question_number"],
            question_text=q["question_text"],
            correct_answer=q["correct_answer"],
        ))
    db.commit()
    log_event(db, f"Exam Uploaded: {name} ({exam_id}) - {len(questions)} questions from {file.filename}", "Coordinator")
    return {"exam_id": exam_id, "name": name, "question_count": len(questions)}


@app.get("/exams")
def list_exams(db: Session = Depends(get_db)):
    exams = db.query(models.Exam).order_by(models.Exam.created_at.desc()).all()
    return [
        {
            "exam_id": e.exam_id,
            "name": e.name,
            "is_active": bool(e.is_active),
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in exams
    ]


@app.get("/exams/{exam_id}/questions")
def get_exam_questions(exam_id: str, db: Session = Depends(get_db)):
    qs = (
        db.query(models.Question)
        .filter(models.Question.exam_id == exam_id)
        .order_by(models.Question.question_number)
        .all()
    )
    return [
        {"question_number": q.question_number, "question_text": q.question_text, "correct_answer": q.correct_answer}
        for q in qs
    ]


@app.post("/exams/activate")
def activate_exam(payload: schemas.ExamActivate, db: Session = Depends(get_db)):
    """Marks one exam active: its answer key becomes ANSWER_KEY, and new
    submissions default to this exam_id unless one is given explicitly."""
    global ANSWER_KEY, ACTIVE_EXAM_ID
    exam = db.query(models.Exam).filter(models.Exam.exam_id == payload.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="exam not found")

    db.query(models.Exam).update({models.Exam.is_active: 0})
    exam.is_active = 1
    db.commit()

    qs = (
        db.query(models.Question)
        .filter(models.Question.exam_id == exam.exam_id)
        .order_by(models.Question.question_number)
        .all()
    )
    if qs:
        ANSWER_KEY = [q.correct_answer for q in qs]
    ACTIVE_EXAM_ID = exam.exam_id
    log_event(db, f"Exam Activated: {exam.name} ({exam.exam_id})", "Coordinator")
    return {"active_exam_id": ACTIVE_EXAM_ID, "answer_key": ANSWER_KEY}


@app.get("/exams/active")
def get_active_exam(db: Session = Depends(get_db)):
    if not ACTIVE_EXAM_ID:
        return {"active_exam_id": None, "name": None, "answer_key": ANSWER_KEY}
    exam = db.query(models.Exam).filter(models.Exam.exam_id == ACTIVE_EXAM_ID).first()
    return {
        "active_exam_id": ACTIVE_EXAM_ID,
        "name": exam.name if exam else None,
        "answer_key": ANSWER_KEY,
    }


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
    manager.set_loop(asyncio.get_event_loop())
    start_heartbeat_monitor(SessionLocal, models.Worker, log_event_static)


# ---------- WebSocket: live event stream (message-oriented communication) ----------

@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """Clients (e.g. the teacher dashboard) subscribe here to receive every
    distributed event pushed the instant it happens, instead of polling
    /events on a timer. The coordinator is the publisher; each connected
    client is a subscriber - a simple pub/sub messaging pattern layered on
    top of a persistent (stream-oriented) WebSocket connection."""
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect client -> server messages, but keep the socket
            # alive and detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


@app.get("/")
def root():
    return {"message": "Distributed Exam Evaluation Coordinator is running"}