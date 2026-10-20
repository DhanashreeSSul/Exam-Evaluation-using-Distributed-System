# ============================================
# coordinator/main.py — FULL FILE (consolidated with all fixes)
# ============================================

import asyncio
import io
import json
import re
import uuid
from datetime import datetime
from typing import List, Optional

import httpx
from fastapi import (
    FastAPI, Depends, BackgroundTasks, HTTPException,
    UploadFile, File, Form, WebSocket, WebSocketDisconnect
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models
import schemas
import hashlib
from database import Base, engine, get_db, SessionLocal
from vector_clock import VectorClock
from clock_sync import BerkeleyClockSync
from snapshot import SnapshotManager
from heartbeat import HEARTBEAT_TIMEOUT_SECONDS, CHECK_INTERVAL_SECONDS, start_heartbeat_monitor
from election import run_bully_election
from distributed_lock import DistributedLock

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import docx
except ImportError:
    docx = None

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Distributed Exam Evaluation Coordinator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import ledger_demo                       # <-- ADD
app.include_router(ledger_demo.router)   # <-- ADD

# ---------------- WebSocket Connection Manager ----------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop):
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
        if not self.active_connections or self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast_async(message), self.loop)

manager = ConnectionManager()

# ---------------- Unit 3: Vector Clocks / Clock Sync / Snapshot ----------------

PROCESS_IDS = ["coordinator", "1", "2", "3"]
coordinator_vc = VectorClock("coordinator", PROCESS_IDS)
clock_sync = BerkeleyClockSync()
snapshot_manager = SnapshotManager()

# ---------------- Distributed Lock ----------------

lock = DistributedLock()

# ---------------- Event logging ----------------

def log_event(db: Session, event: str, process: str, lamport_clock: int = None):
    if lamport_clock is None:
        lamport_clock = coordinator_vc.clock["coordinator"]
    entry = models.DistributedEvent(event=event, process=process, lamport_clock=lamport_clock)
    db.add(entry)
    db.commit()
    manager.publish({
        "type": "event",
        "event": event,
        "process": process,
        "lamport_clock": lamport_clock,
        "vector_clock": coordinator_vc.clock,
        "timestamp": datetime.utcnow().isoformat(),
    })

def log_event_static(db: Session, event: str, process: str, lamport_clock: int = None):
    log_event(db, event, process, lamport_clock)

# ---------------- Question bank parsing ----------------

def parse_question_bank_text(text: str):
    questions = []
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    csv_like = [l for l in lines if l.count(",") >= 6]
    if csv_like and len(csv_like) == len(lines):
        for l in lines:
            parts = [p.strip() for p in l.split(",")]
            if len(parts) >= 7:
                questions.append({
                    "question_number": int(parts[0]),
                    "question_text": parts[1],
                    "option_a": parts[2], "option_b": parts[3],
                    "option_c": parts[4], "option_d": parts[5],
                    "correct_answer": parts[6].upper(),
                })
        if questions:
            return questions

    legacy_csv = [l for l in lines if l.count(",") == 2]
    if legacy_csv and len(legacy_csv) == len(lines):
        for l in lines:
            parts = [p.strip() for p in l.split(",")]
            questions.append({
                "question_number": int(parts[0]),
                "question_text": parts[1],
                "option_a": None, "option_b": None,
                "option_c": None, "option_d": None,
                "correct_answer": parts[2].upper(),
            })
        if questions:
            return questions

    block_pattern = re.compile(r"^(\d+)[\.\)]\s*(.+)$")
    option_pattern = re.compile(r"^([A-Da-d])[\.\)]\s*(.+)$")
    answer_pattern = re.compile(r"^Answer\s*[:\-]\s*([A-Da-d])", re.IGNORECASE)

    current = None
    for l in lines:
        opt_m = option_pattern.match(l)
        m = block_pattern.match(l)
        ans_m = answer_pattern.match(l)

        if m and not opt_m:
            if current:
                questions.append(current)
            current = {
                "question_number": int(m.group(1)),
                "question_text": m.group(2).strip(),
                "option_a": None, "option_b": None,
                "option_c": None, "option_d": None,
                "correct_answer": None,
            }
        elif opt_m and current:
            letter = opt_m.group(1).upper()
            current[f"option_{letter.lower()}"] = opt_m.group(2).strip()
        elif ans_m and current:
            current["correct_answer"] = ans_m.group(1).upper()

    if current:
        questions.append(current)

    if questions and any(q["correct_answer"] for q in questions):
        return questions

    questions = []
    dash_pattern = re.compile(r"^(\d+)[\.\)]\s*(.+?)\s*-\s*([A-Da-d])\s*$")
    for l in lines:
        m = dash_pattern.match(l)
        if m:
            questions.append({
                "question_number": int(m.group(1)),
                "question_text": m.group(2).strip(),
                "option_a": None, "option_b": None,
                "option_c": None, "option_d": None,
                "correct_answer": m.group(3).upper(),
            })

    return questions

def extract_text_from_upload(filename: str, raw: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        if PdfReader is None:
            raise HTTPException(status_code=500, detail="pypdf not installed")
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif lower.endswith(".docx"):
        if docx is None:
            raise HTTPException(status_code=500, detail="python-docx not installed")
        document = docx.Document(io.BytesIO(raw))
        return "\n".join(p.text for p in document.paragraphs)
    else:
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw.decode("latin-1")

# ---------------- Active exam tracking ----------------

ACTIVE_EXAM_ID = None

# ---------------- Legacy answer key ----------------

LEGACY_ANSWER_KEY = ["A", "B", "C", "D", "A"]

def get_answer_key_for_exam(db: Session, exam_id: Optional[str]) -> List[str]:
    if not exam_id:
        return LEGACY_ANSWER_KEY
    questions = db.query(models.Question).filter(
        models.Question.exam_id == exam_id
    ).order_by(models.Question.question_number.asc()).all()
    if not questions:
        return LEGACY_ANSWER_KEY
    return [q.correct_answer.upper() for q in questions]

# ---------------- Task creation / dispatch ----------------

def create_task_and_dispatch(db: Session, background_tasks: BackgroundTasks,
                              student_name: str, student_id: str,
                              answers: str, exam_id: Optional[str] = None,
                              source: str = "manual"):
    task_id = str(uuid.uuid4())[:8]

    coordinator_vc.clock["coordinator"] += 1

    final_exam_id = exam_id or ACTIVE_EXAM_ID
    total_questions = db.query(models.Question).filter(
        models.Question.exam_id == final_exam_id
    ).count() if final_exam_id else 5

    task = models.Task(
        task_id=task_id,
        exam_id=final_exam_id,
        student_name=student_name,
        student_id=student_id,
        answers=answers,
        status="PENDING",
        total=total_questions or 5,
        lamport_clock=coordinator_vc.clock["coordinator"],
        vector_clock=json.dumps(coordinator_vc.clock),
        source=source,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    log_event(db, f"TASK_CREATED:{task_id}", "coordinator", task.lamport_clock)

    background_tasks.add_task(evaluate_task_background, task_id)
    return task

async def send_task_to_worker(worker_host: str, worker_port: int, task_id: str, student_id: str,
                               answers: str, answer_key: List[str], lamport_clock: int):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"http://{worker_host}:{worker_port}/evaluate",
            json={
                "task_id": task_id,
                "student_id": student_id,
                "answers": answers,
                "answer_key": answer_key,
                "lamport_clock": lamport_clock,
            },
        )
        resp.raise_for_status()
        return resp.json()

def evaluate_task_background(task_id: str):
    db = SessionLocal()
    try:
        task = db.query(models.Task).filter(models.Task.task_id == task_id).first()
        if not task:
            return

        attempts = 0
        max_attempts = 3

        while attempts < max_attempts:
            attempts += 1
            worker = (
                db.query(models.Worker)
                .filter(models.Worker.status == "ACTIVE")
                .order_by(models.Worker.workload.asc())
                .first()
            )
            if not worker:
                task.status = "FAILED"
                db.commit()
                log_event_static(db, f"TASK_FAILED:{task_id}:NO_WORKERS", "coordinator")
                return

            worker.workload += 1
            task.status = "PROCESSING"
            task.assigned_worker = worker.worker_id
            db.commit()
            log_event_static(db, f"TASK_ASSIGNED:{task_id}:WORKER_{worker.worker_id}", "coordinator")

            try:
                answer_key = get_answer_key_for_exam(db, task.exam_id)
                result = asyncio.run(send_task_to_worker(
                    worker.host, worker.port, task_id, task.student_id, task.answers, answer_key, task.lamport_clock
                ))

                if result.get("status") != "completed":
                    raise Exception("Worker did not complete the task")
                
                task.score = result.get("score")
                task.breakdown = json.dumps(result.get("breakdown", []))
                task.status = "COMPLETED"
                worker.workload = max(0, worker.workload - 1)
                worker.completed += 1

                coordinator_vc.clock[str(worker.worker_id)] += 1
                coordinator_vc.clock["coordinator"] += 1
                task.vector_clock = json.dumps(coordinator_vc.clock)
                task.lamport_clock = coordinator_vc.clock["coordinator"]

                db.commit()

                ts = datetime.utcnow()
                prev_result = db.query(models.Result).order_by(models.Result.id.desc()).first()
                prev_hash = prev_result.result_hash if prev_result and prev_result.result_hash else "0" * 64
                payload = f"{task_id}|{worker.worker_id}|{task.score}|{task.total}|COMPLETED|{ts.isoformat()}|{prev_hash}"
                result_hash = hashlib.sha256(payload.encode()).hexdigest()

                db.add(models.Result(
                    task_id=task_id, worker_id=worker.worker_id,
                    score=task.score, total=task.total, status="COMPLETED",
                    timestamp=ts, prev_hash=prev_hash, result_hash=result_hash,
                ))
                db.commit()

                log_event_static(db, f"TASK_COMPLETED:{task_id}:WORKER_{worker.worker_id}", "coordinator", task.lamport_clock)
                return

            except Exception:
                worker.workload = max(0, worker.workload - 1)
                worker.status = "FAILED"
                task.status = "REASSIGNED"
                db.commit()
                log_event_static(db, f"TASK_REASSIGNED:{task_id}:WORKER_{worker.worker_id}_FAILED", "coordinator")
                continue

        task.status = "FAILED"
        db.commit()
        log_event_static(db, f"TASK_FAILED:{task_id}:MAX_RETRIES", "coordinator")
    finally:
        db.close()

# ---------------- Worker endpoints ----------------

@app.post("/workers/register")
def register_worker(payload: schemas.WorkerRegister, db: Session = Depends(get_db)):
    existing = db.query(models.Worker).filter(models.Worker.worker_id == payload.worker_id).first()
    if existing:
        existing.port = payload.port
        existing.host = payload.host
        existing.status = "ACTIVE"
        existing.last_heartbeat = datetime.utcnow()
        db.commit()
        return {"status": "re-registered", "worker_id": payload.worker_id}

    worker = models.Worker(worker_id=payload.worker_id, port=payload.port, host=payload.host, status="ACTIVE")
    db.add(worker)
    db.commit()
    log_event(db, f"WORKER_REGISTERED:{payload.worker_id}", "coordinator")
    return {"status": "registered", "worker_id": payload.worker_id}

@app.post("/workers/{worker_id}/heartbeat")
def worker_heartbeat(worker_id: int, payload: schemas.HeartbeatIn, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    worker.last_heartbeat = datetime.utcnow()
    if worker.status in ("DOWN", "FAILED"):
        worker.status = "ACTIVE"
    worker.lamport_clock = max(worker.lamport_clock, payload.lamport_clock)
    db.commit()
    return {"status": "ok"}

@app.get("/workers")
def list_workers(db: Session = Depends(get_db)):
    workers = db.query(models.Worker).all()
    return [
        {
            "worker_id": w.worker_id, "port": w.port, "status": w.status,
            "workload": w.workload, "completed": w.completed,
            "last_heartbeat": w.last_heartbeat.isoformat() if w.last_heartbeat else None,
            "lamport_clock": w.lamport_clock,
        }
        for w in workers
    ]

@app.post("/workers/{worker_id}/fail")
def fail_worker(worker_id: int, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Tasks currently running on this worker; the retry loop will move them
    in_flight = [
        t.task_id for t in db.query(models.Task).filter(
            models.Task.assigned_worker == worker_id,
            models.Task.status == "PROCESSING",
        ).all()
    ]

    worker.status = "FAILED"
    db.commit()

    # Make the worker really stop: it stops heartbeating and aborts its tasks
    try:
        httpx.post(f"http://{worker.host}:{worker.port}/simulate-failure", timeout=3.0)
    except Exception:
        pass  # worker already unreachable, which is also a failure

    log_event(db, f"WORKER_FAILED:{worker_id}", "coordinator")
    return {"status": "failed", "worker_id": worker_id, "reassigned_tasks": in_flight}

@app.post("/workers/{worker_id}/recover")
def recover_worker(worker_id: int, db: Session = Depends(get_db)):
    worker = db.query(models.Worker).filter(models.Worker.worker_id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    try:
        httpx.post(f"http://{worker.host}:{worker.port}/recover", timeout=3.0)
    except Exception:
        pass  # if the process is dead, the heartbeat monitor will fail it again

    worker.status = "ACTIVE"
    worker.last_heartbeat = datetime.utcnow()
    db.commit()
    log_event(db, f"WORKER_RECOVERED:{worker_id}", "coordinator")
    return {"status": "recovered", "worker_id": worker_id}

# ---------------- Submission endpoints ----------------

@app.post("/submit")
def submit_answer_sheet(payload: schemas.AnswerSheet, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    task = create_task_and_dispatch(db, background_tasks, payload.student_name, payload.student_id, payload.answers, exam_id=payload.exam_id)
    return {"task_id": task.task_id, "status": task.status}

@app.post("/submit-bulk")
def submit_bulk(payload: schemas.BulkSubmit, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    task_ids = []
    for sheet in payload.sheets:
        task = create_task_and_dispatch(db, background_tasks, sheet.student_name, sheet.student_id, sheet.answers, exam_id=sheet.exam_id)
        task_ids.append(task.task_id)
    return {"task_ids": task_ids}

@app.post("/submit-file")
async def submit_file(background_tasks: BackgroundTasks, file: UploadFile = File(...),
                      student_name: Optional[str] = Form(None),
                      student_id: Optional[str] = Form(None),
                      exam_id: Optional[str] = Form(None), db: Session = Depends(get_db)):
    raw = await file.read()
    text = extract_text_from_upload(file.filename, raw)

    sheets = []
    current = {}
    answer_list: List[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^Student\s*Name\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
        if m:
            if current.get("student_name"):
                current["answers"] = ",".join(answer_list)
                sheets.append(current)
            current = {"student_name": m.group(1).strip()}
            answer_list = []
            continue
        m = re.match(r"^Student\s*ID\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
        if m:
            current["student_id"] = m.group(1).strip()
            continue
        m = re.match(r"^Question\s*(\d+)\s*[:\-]\s*([A-Da-d])", line, re.IGNORECASE)
        if m:
            answer_list.append(m.group(2).upper())

    if current.get("student_name"):
        current["answers"] = ",".join(answer_list)
        sheets.append(current)

    # Single-student file with only "Question N: X" lines: use the form fields
    if not sheets and answer_list:
        sheets.append({
            "student_name": student_name or "Unknown",
            "student_id": student_id or "N/A",
            "answers": ",".join(answer_list),
        })

    task_ids = []
    for s in sheets:
        task = create_task_and_dispatch(
            db, background_tasks, s.get("student_name", "Unknown"), s.get("student_id", "N/A"),
            s.get("answers", ""), exam_id=exam_id, source="file",
        )
        task_ids.append(task.task_id)

    return {"task_ids": task_ids, "count": len(task_ids)}

@app.get("/tasks")
def get_tasks(exam_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(models.Task)
    if exam_id:
        query = query.filter(models.Task.exam_id == exam_id)
    tasks = query.order_by(models.Task.created_at.desc()).all()
    return [
        {
            "task_id": t.task_id, "exam_id": t.exam_id,
            "student_name": t.student_name, "student_id": t.student_id,
            "status": t.status, "score": t.score, "total": t.total,
            "assigned_worker": t.assigned_worker,
            "lamport_clock": t.lamport_clock,
            "vector_clock": json.loads(t.vector_clock) if t.vector_clock else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tasks
    ]

@app.get("/tasks/{task_id}")
def get_task_detail(task_id: str, db: Session = Depends(get_db)):
    task = db.query(models.Task).filter(models.Task.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "task_id": task.task_id, "exam_id": task.exam_id,
        "student_name": task.student_name, "student_id": task.student_id,
        "answers": task.answers, "status": task.status,
        "score": task.score, "total": task.total,
        "breakdown": json.loads(task.breakdown) if task.breakdown else [],
        "assigned_worker": task.assigned_worker,
        "lamport_clock": task.lamport_clock,
        "vector_clock": json.loads(task.vector_clock) if task.vector_clock else None,
    }

@app.get("/marking-summary")
def marking_summary(exam_id: Optional[str] = None, db: Session = Depends(get_db)):
    final_exam_id = exam_id or ACTIVE_EXAM_ID
    base_query = db.query(models.Task).filter(models.Task.status == "COMPLETED")
    if final_exam_id:
        base_query = base_query.filter(models.Task.exam_id == final_exam_id)
    tasks = base_query.all()

    questions = db.query(models.Question).filter(models.Question.exam_id == final_exam_id).all() if final_exam_id else []
    question_text_by_number = {q.question_number: q.question_text for q in questions}

    per_question_correct = {}
    per_question_total = {}

    for t in tasks:
        breakdown_list = json.loads(t.breakdown) if t.breakdown else []
        for item in breakdown_list:
            qn = item["question"]
            per_question_total[qn] = per_question_total.get(qn, 0) + 1
            if item["is_correct"]:
                per_question_correct[qn] = per_question_correct.get(qn, 0) + 1

    question_stats = [
        {
            "question_number": qn,
            "question_text": question_text_by_number.get(qn, ""),
            "correct": per_question_correct.get(qn, 0),
            "total": per_question_total.get(qn, 0),
            "accuracy": round(100 * per_question_correct.get(qn, 0) / per_question_total[qn], 1) if per_question_total.get(qn) else 0,
        }
        for qn in sorted(per_question_total.keys())
    ]

    scores = [t.score for t in tasks if t.score is not None]
    avg_score = round(sum(scores) / len(scores), 2) if scores else 0
    total_questions = max((t.total for t in tasks if t.total), default=0)

    return {
        "total_submissions": len(tasks),
        "evaluated_count": len(tasks),
        "average_score": avg_score,
        "highest_score": max(scores) if scores else 0,
        "lowest_score": min(scores) if scores else 0,
        "total_questions": total_questions,
        "question_stats": question_stats,
        "students": [
            {
                "task_id": t.task_id, "student_name": t.student_name,
                "student_id": t.student_id, "score": t.score, "total": t.total,
                "breakdown": json.loads(t.breakdown) if t.breakdown else [],
            }
            for t in tasks
        ],
    }

@app.get("/answer-key")
def get_answer_key():
    return {"answer_key": LEGACY_ANSWER_KEY}

@app.post("/answer-key")
def set_answer_key(payload: schemas.AnswerKeyIn):
    global LEGACY_ANSWER_KEY
    LEGACY_ANSWER_KEY = payload.answer_key
    return {"status": "updated", "answer_key": LEGACY_ANSWER_KEY}

# ---------------- Exam endpoints ----------------

@app.post("/exams")
def create_exam(payload: schemas.ExamCreate, db: Session = Depends(get_db)):
    exam_id = str(uuid.uuid4())[:8]
    exam = models.Exam(exam_id=exam_id, name=payload.name)
    db.add(exam)

    for q in payload.questions:
        db.add(models.Question(
            exam_id=exam_id, question_number=q.question_number, question_text=q.question_text,
            option_a=q.option_a, option_b=q.option_b, option_c=q.option_c, option_d=q.option_d,
            correct_answer=q.correct_answer.upper(),
        ))

    db.commit()
    log_event(db, f"EXAM_CREATED:{exam_id}", "coordinator")
    return {"exam_id": exam_id, "name": payload.name, "question_count": len(payload.questions)}

@app.post("/exams/upload")
async def upload_exam(name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = await file.read()
    text = extract_text_from_upload(file.filename, raw)
    parsed = parse_question_bank_text(text)

    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse any questions from the file")

    exam_id = str(uuid.uuid4())[:8]
    exam = models.Exam(exam_id=exam_id, name=name)
    db.add(exam)

    for q in parsed:
        db.add(models.Question(
            exam_id=exam_id, question_number=q["question_number"], question_text=q["question_text"],
            option_a=q.get("option_a"), option_b=q.get("option_b"),
            option_c=q.get("option_c"), option_d=q.get("option_d"),
            correct_answer=(q.get("correct_answer") or "").upper(),
        ))

    db.commit()
    log_event(db, f"EXAM_UPLOADED:{exam_id}", "coordinator")
    return {"exam_id": exam_id, "name": name, "question_count": len(parsed)}

@app.get("/exams")
def list_exams(db: Session = Depends(get_db)):
    exams = db.query(models.Exam).order_by(models.Exam.created_at.desc()).all()
    return [
        {"exam_id": e.exam_id, "name": e.name, "is_active": bool(e.is_active),
         "created_at": e.created_at.isoformat() if e.created_at else None}
        for e in exams
    ]

@app.get("/exams/{exam_id}/questions")
def get_exam_questions(exam_id: str, reveal_answers: bool = False, db: Session = Depends(get_db)):
    questions = db.query(models.Question).filter(
        models.Question.exam_id == exam_id
    ).order_by(models.Question.question_number.asc()).all()

    return [
        {
            "question_number": q.question_number, "question_text": q.question_text,
            "option_a": q.option_a, "option_b": q.option_b,
            "option_c": q.option_c, "option_d": q.option_d,
            **({"correct_answer": q.correct_answer} if reveal_answers else {}),
        }
        for q in questions
    ]

@app.post("/exams/activate")
def activate_exam(payload: schemas.ExamActivate, db: Session = Depends(get_db)):
    global ACTIVE_EXAM_ID
    exam = db.query(models.Exam).filter(models.Exam.exam_id == payload.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    db.query(models.Exam).update({models.Exam.is_active: 0})
    exam.is_active = 1
    db.commit()

    ACTIVE_EXAM_ID = payload.exam_id
    log_event(db, f"EXAM_ACTIVATED:{payload.exam_id}", "coordinator")
    return {"status": "activated", "exam_id": payload.exam_id}

@app.get("/exams/active")
def get_active_exam(db: Session = Depends(get_db)):
    if not ACTIVE_EXAM_ID:
        return {"exam_id": None}
    exam = db.query(models.Exam).filter(models.Exam.exam_id == ACTIVE_EXAM_ID).first()
    if not exam:
        return {"exam_id": None}
    return {"exam_id": exam.exam_id, "name": exam.name}

# ---------------- State / Events ----------------

@app.get("/state")
def get_state(db: Session = Depends(get_db)):
    workers = db.query(models.Worker).all()
    tasks = db.query(models.Task).all()
    return {
        "workers": [
            {"worker_id": w.worker_id, "status": w.status, "workload": w.workload, "completed": w.completed}
            for w in workers
        ],
        "task_counts": {
            "total": len(tasks),
            "pending": len([t for t in tasks if t.status == "PENDING"]),
            "processing": len([t for t in tasks if t.status == "PROCESSING"]),
            "completed": len([t for t in tasks if t.status == "COMPLETED"]),
            "failed": len([t for t in tasks if t.status == "FAILED"]),
            "reassigned": len([t for t in tasks if t.status == "REASSIGNED"]),
        },
        "lamport_clock": coordinator_vc.clock["coordinator"],
        "vector_clock": coordinator_vc.clock,
    }

@app.get("/events")
def get_events(limit: int = 50, db: Session = Depends(get_db)):
    events = db.query(models.DistributedEvent).order_by(models.DistributedEvent.timestamp.desc()).limit(limit).all()
    return [
        {"event": e.event, "process": e.process, "lamport_clock": e.lamport_clock,
         "timestamp": e.timestamp.isoformat() if e.timestamp else None}
        for e in reversed(events)
    ]

# ---------------- Election ----------------

@app.post("/election/start")
def start_election(db: Session = Depends(get_db)):
    active_workers = db.query(models.Worker).filter(models.Worker.status == "ACTIVE").all()

    def log(message: str):
        entry = models.ElectionLog(message=message)
        db.add(entry)
        db.commit()
        manager.publish({
            "type": "election",
            "message": message,
            "timestamp": datetime.utcnow().isoformat(),
        })

    leader = run_bully_election(active_workers, log)

    if leader is None:
        log_event(db, "ELECTION_FAILED:NO_ACTIVE_WORKERS", "coordinator")
        return {"winner": None}

    log_event(db, f"ELECTION_COMPLETED:WINNER_{leader.worker_id}", "coordinator")
    return {"winner": leader.worker_id}

@app.get("/election/logs")
def get_election_logs(db: Session = Depends(get_db)):
    logs = db.query(models.ElectionLog).order_by(models.ElectionLog.timestamp.desc()).limit(20).all()
    return [
        {"message": l.message, "timestamp": l.timestamp.isoformat() if l.timestamp else None}
        for l in reversed(logs)
    ]

@app.get("/coordinator")
def get_coordinator_info():
    return {"role": "coordinator", "lamport_clock": coordinator_vc.clock["coordinator"]}

# ---------------- Distributed Mutual Exclusion ----------------

@app.post("/lock/request")
def request_lock(payload: schemas.LockRequest):
    granted = lock.request(payload.worker_id)
    return {"granted": granted, "holder": lock.holder}

@app.post("/lock/release")
def release_lock(payload: schemas.LockRequest):
    released = lock.release(payload.worker_id)
    return {"released": released, "holder": lock.holder}

@app.get("/lock/status")
def lock_status():
    return {"holder": lock.holder}

# ---------------- Unit 3: Vector Clock / Clock Sync / Snapshot ----------------

@app.get("/vector-clock")
def get_vector_clock():
    return {"vector_clock": coordinator_vc.clock}

@app.post("/clock-sync/run")
def run_clock_sync(db: Session = Depends(get_db)):
    workers = db.query(models.Worker).filter(models.Worker.status == "ACTIVE").all()
    worker_ids = [w.worker_id for w in workers]
    result = clock_sync.run_sync(worker_ids)
    log_event(db, "CLOCK_SYNC_RUN", "coordinator")
    return result

@app.get("/clock-sync/status")
def get_clock_sync_status():
    return {"last_sync": clock_sync.last_sync.isoformat() if clock_sync.last_sync else None, "offsets": clock_sync.offsets}

@app.post("/snapshot/capture")
def capture_snapshot(db: Session = Depends(get_db)):
    workers = db.query(models.Worker).all()
    tasks = db.query(models.Task).all()
    coordinator_state = {
        "vector_clock": coordinator_vc.clock,
        "tasks": [{"task_id": t.task_id, "status": t.status, "assigned_worker": t.assigned_worker} for t in tasks],
    }
    worker_states = [
        {"worker_id": w.worker_id, "status": w.status, "workload": w.workload, "completed": w.completed}
        for w in workers
    ]
    snap = snapshot_manager.capture(coordinator_state, worker_states)

    db_snap = models.Snapshot(snapshot_data=json.dumps(snap))
    db.add(db_snap)
    db.commit()

    log_event(db, "SNAPSHOT_CAPTURED", "coordinator")
    return snap

@app.get("/snapshot/all")
def get_all_snapshots():
    return {"snapshots": snapshot_manager.get_all()}

@app.get("/snapshot/latest")
def get_latest_snapshot():
    snap = snapshot_manager.get_latest()
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshots yet")
    return snap


@app.get("/ledger")
def get_ledger(db: Session = Depends(get_db)):
    results = db.query(models.Result).order_by(models.Result.id.asc()).all()
    return [
        {
            "id": r.id, "task_id": r.task_id, "worker_id": r.worker_id,
            "score": r.score, "total": r.total, "status": r.status,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "prev_hash": r.prev_hash, "result_hash": r.result_hash,
        }
        for r in results
    ]

@app.get("/ledger/verify")
def verify_ledger(db: Session = Depends(get_db)):
    results = db.query(models.Result).order_by(models.Result.id.asc()).all()
    broken = []
    expected_prev = "0" * 64
    for r in results:
        payload = f"{r.task_id}|{r.worker_id}|{r.score}|{r.total}|{r.status}|{r.timestamp.isoformat() if r.timestamp else ''}|{r.prev_hash}"
        recomputed = hashlib.sha256(payload.encode()).hexdigest()
        issue = None
        if r.prev_hash != expected_prev:
            issue = "prev_hash mismatch (chain broken before this entry)"
        elif recomputed != r.result_hash:
            issue = "stored hash does not match recomputed hash (data tampered)"
        if issue:
            broken.append({"id": r.id, "task_id": r.task_id, "issue": issue})
        expected_prev = r.result_hash
    return {
        "total_checked": len(results),
        "valid": len(broken) == 0,
        "broken_entries": broken,
    }

# ---------------- Startup / WebSocket ----------------

@app.on_event("startup")
def on_startup():
    manager.set_loop(asyncio.get_event_loop())
    start_heartbeat_monitor(SessionLocal, models.Worker, log_event)

@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)