# ============================================
# coordinator/models.py — FULL FILE (with host column added to Worker)
# ============================================
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from database import Base

class Worker(Base):
    __tablename__ = "workers"
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, unique=True, index=True)
    port = Column(Integer)
    host = Column(String, default="localhost")
    status = Column(String, default="ACTIVE")  # ACTIVE, FAILED, DOWN
    workload = Column(Integer, default=0)
    completed = Column(Integer, default=0)
    last_heartbeat = Column(DateTime, default=datetime.utcnow)
    lamport_clock = Column(Integer, default=0)

class Exam(Base):
    __tablename__ = "exams"
    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(String, unique=True, index=True)
    name = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Integer, default=0)

class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(String, index=True)
    question_number = Column(Integer)
    question_text = Column(String)
    option_a = Column(String, nullable=True)
    option_b = Column(String, nullable=True)
    option_c = Column(String, nullable=True)
    option_d = Column(String, nullable=True)
    correct_answer = Column(String)

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, unique=True, index=True)
    exam_id = Column(String, index=True, nullable=True)
    student_name = Column(String)
    student_id = Column(String)
    answers = Column(String)
    assigned_worker = Column(Integer, nullable=True)
    status = Column(String, default="PENDING")
    score = Column(Integer, nullable=True)
    total = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)
    lamport_clock = Column(Integer, default=0)
    vector_clock = Column(String, nullable=True)
    breakdown = Column(String, nullable=True)
    source = Column(String, default="manual")

class Result(Base):
    __tablename__ = "results"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    worker_id = Column(Integer)
    score = Column(Integer)
    total = Column(Integer)
    status = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)
    prev_hash = Column(String, nullable=True)
    result_hash = Column(String, nullable=True)

class DistributedEvent(Base):
    __tablename__ = "distributed_events"
    id = Column(Integer, primary_key=True, index=True)
    event = Column(String)
    process = Column(String)
    lamport_clock = Column(Integer)
    timestamp = Column(DateTime, default=datetime.utcnow)

class ElectionLog(Base):
    __tablename__ = "election_logs"
    id = Column(Integer, primary_key=True, index=True)
    message = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

class Snapshot(Base):
    __tablename__ = "snapshots"
    id = Column(Integer, primary_key=True, index=True)
    snapshot_data = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)