# ============================================
# coordinator/schemas.py — FULL FILE (with host field added to WorkerRegister)
# ============================================
from typing import List, Optional
from pydantic import BaseModel

class WorkerRegister(BaseModel):
    worker_id: int
    port: int
    host: str = "localhost"

class HeartbeatIn(BaseModel):
    lamport_clock: int = 0

class AnswerSheet(BaseModel):
    student_name: str
    student_id: str
    answers: str
    exam_id: Optional[str] = None

class BulkSubmit(BaseModel):
    sheets: List[AnswerSheet]

class AnswerKeyIn(BaseModel):
    answer_key: List[str]

class LockRequest(BaseModel):
    worker_id: int

class QuestionIn(BaseModel):
    question_number: int
    question_text: str
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    correct_answer: str

class ExamCreate(BaseModel):
    name: str
    questions: List[QuestionIn]

class ExamActivate(BaseModel):
    exam_id: str