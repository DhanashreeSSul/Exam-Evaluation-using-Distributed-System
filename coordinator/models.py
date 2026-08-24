from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from database import Base


class Worker(Base):
    __tablename__ = "workers"
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(Integer, unique=True, index=True)
    port = Column(Integer)
    status = Column(String, default="ACTIVE")  # ACTIVE, FAILED, DOWN
    workload = Column(Integer, default=0)
    completed = Column(Integer, default=0)
    last_heartbeat = Column(DateTime, default=datetime.utcnow)
    lamport_clock = Column(Integer, default=0)


class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, unique=True, index=True)
    student_name = Column(String)
    student_id = Column(String)
    answers = Column(String)
    assigned_worker = Column(Integer, nullable=True)
    status = Column(String, default="PENDING")  # PENDING, PROCESSING, COMPLETED, FAILED, REASSIGNED
    score = Column(Integer, nullable=True)
    total = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)
    lamport_clock = Column(Integer, default=0)
    breakdown = Column(String, nullable=True)  # JSON string: per-question marking detail
    source = Column(String, default="manual")  # "manual" or "upload"


class Result(Base):
    __tablename__ = "results"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    worker_id = Column(Integer)
    score = Column(Integer)
    total = Column(Integer)
    status = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)


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
