import argparse
import random
import threading
import time
from typing import List

import requests
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from evaluator import evaluate_answers
from lamport_clock import LamportClock

app = FastAPI(title="Exam Evaluation Worker")

clock = LamportClock()
state = {"status": "ACTIVE", "worker_id": None, "port": None, "coordinator": None}


class EvaluateRequest(BaseModel):
    task_id: str
    student_id: str
    answers: str
    answer_key: List[str]
    lamport_clock: int


@app.post("/evaluate")
def evaluate(req: EvaluateRequest):
    if state["status"] != "ACTIVE":
        return {"task_id": req.task_id, "status": "rejected", "reason": "worker is down"}

    clock.update(req.lamport_clock)
    clock.tick()  # "evaluation started" event

    # Artificial delay so parallel processing is visible across workers
    time.sleep(random.uniform(2, 5))

    student_answers = req.answers.split(",")
    score, total, breakdown = evaluate_answers(student_answers, req.answer_key)

    clock.tick()  # "evaluation completed" event

    return {
        "task_id": req.task_id,
        "worker_id": state["worker_id"],
        "score": score,
        "total": total,
        "breakdown": breakdown,
        "status": "completed",
        "lamport_clock": clock.value,
    }


@app.post("/simulate-failure")
def simulate_failure():
    state["status"] = "DOWN"
    return {"worker_id": state["worker_id"], "status": "DOWN"}


@app.post("/recover")
def recover():
    state["status"] = "ACTIVE"
    return {"worker_id": state["worker_id"], "status": "ACTIVE"}


@app.get("/status")
def status():
    return {
        "worker_id": state["worker_id"],
        "port": state["port"],
        "status": state["status"],
        "lamport_clock": clock.value,
    }


def heartbeat_loop(coordinator_url: str, worker_id: int):
    while True:
        try:
            if state["status"] == "ACTIVE":
                requests.post(
                    f"{coordinator_url}/workers/{worker_id}/heartbeat",
                    json={"lamport_clock": clock.value},
                    timeout=2,
                )
        except Exception:
            pass  # coordinator might be temporarily unreachable; keep trying
        time.sleep(3)


def register_with_coordinator(coordinator_url: str, worker_id: int, port: int):
    try:
        requests.post(
            f"{coordinator_url}/workers/register",
            json={"worker_id": worker_id, "port": port},
            timeout=3,
        )
        print(f"[Worker {worker_id}] Registered with coordinator at {coordinator_url}")
    except Exception as e:
        print(f"[Worker {worker_id}] Could not register with coordinator: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Distributed Exam Evaluation Worker")
    parser.add_argument("--id", type=int, required=True, help="Unique worker ID")
    parser.add_argument("--port", type=int, required=True, help="Port to run this worker on")
    parser.add_argument("--coordinator", type=str, default="http://localhost:8000", help="Coordinator base URL")
    args = parser.parse_args()

    state["worker_id"] = args.id
    state["port"] = args.port
    state["coordinator"] = args.coordinator

    register_with_coordinator(args.coordinator, args.id, args.port)

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop, args=(args.coordinator, args.id), daemon=True
    )
    heartbeat_thread.start()

    print(f"[Worker {args.id}] Starting on port {args.port} ...")
    uvicorn.run(app, host="0.0.0.0", port=args.port)
