from typing import List, Optional
from pydantic import BaseModel


class WorkerRegister(BaseModel):
    worker_id: int
    port: int


class HeartbeatIn(BaseModel):
    lamport_clock: int = 0


class AnswerSheet(BaseModel):
    student_name: str
    student_id: str
    answers: str  # comma separated e.g. "A,B,C,D,A"
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
    correct_answer: str


class ExamCreate(BaseModel):
    name: str
    questions: List[QuestionIn]


class ExamActivate(BaseModel):
    exam_id: str