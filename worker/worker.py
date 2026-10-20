# ============================================
# worker/worker.py — FULL FILE
# Supports both docker-compose (CLI flags) and Kubernetes (env vars / pod name)
# ============================================
import argparse
import os
import random
import re
import socket
import threading
import time
from typing import List

import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from evaluator import evaluate_answers
from lamport_clock import LamportClock

app = FastAPI(title="Exam Evaluation Worker")

clock = LamportClock()
state = {"status": "ACTIVE", "worker_id": None, "port": None, "coordinator": None, "host": None}


class EvaluateRequest(BaseModel):
    task_id: str
    student_id: str
    answers: str
    answer_key: List[str]
    lamport_clock: int


@app.post("/evaluate")
def evaluate(req: EvaluateRequest):
    if state["status"] != "ACTIVE":
        raise HTTPException(status_code=503, detail="worker is down")

    clock.update(req.lamport_clock)
    clock.tick()  # "evaluation started" event

    # Artificial delay so parallel processing is visible across workers
    time.sleep(random.uniform(6, 10))

    if state["status"] != "ACTIVE":
        raise HTTPException(status_code=503, detail="worker failed during evaluation")

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


registered = {"done": False}


def heartbeat_loop(coordinator_url: str, worker_id: int, port: int, host: str):
    while True:
        try:
            if not registered["done"]:
                resp = requests.post(
                    f"{coordinator_url}/workers/register",
                    json={"worker_id": worker_id, "port": port, "host": host},
                    timeout=3,
                )
                if resp.status_code == 200:
                    registered["done"] = True
                    print(f"[Worker {worker_id}] Registered with coordinator at {coordinator_url}")
            elif state["status"] == "ACTIVE":
                resp = requests.post(
                    f"{coordinator_url}/workers/{worker_id}/heartbeat",
                    json={"lamport_clock": clock.value},
                    timeout=2,
                )
                # Coordinator restarted with a fresh database -> register again
                if resp.status_code == 404:
                    registered["done"] = False
                    print(f"[Worker {worker_id}] Coordinator lost us, re-registering...")
        except Exception:
            pass
        time.sleep(1)


def resolve_worker_id():
    """WORKER_ID env var, else the number at the end of the pod name (worker-0 -> 1)."""
    env_id = os.environ.get("WORKER_ID")
    if env_id:
        return int(env_id)
    name = os.environ.get("POD_NAME") or socket.gethostname()
    match = re.search(r"-(\d+)$", name)
    return int(match.group(1)) + 1 if match else None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Distributed Exam Evaluation Worker")
    parser.add_argument("--id", type=int, default=resolve_worker_id(),
                        help="Unique worker ID (default: WORKER_ID env or pod ordinal + 1)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("WORKER_PORT", 8001)),
                        help="Port to run this worker on (default: WORKER_PORT env or 8001)")
    parser.add_argument("--coordinator", type=str,
                        default=os.environ.get("COORDINATOR_URL", "http://localhost:8000"),
                        help="Coordinator base URL (default: COORDINATOR_URL env)")
    parser.add_argument("--host", type=str,
                        default=os.environ.get("WORKER_HOST", "localhost"),
                        help="Hostname this worker is reachable at (default: WORKER_HOST env)")
    args = parser.parse_args()

    if args.id is None:
        parser.error("Worker ID required: pass --id, set WORKER_ID, or run as a StatefulSet pod (worker-N).")

    state["worker_id"] = args.id
    state["port"] = args.port
    state["coordinator"] = args.coordinator
    state["host"] = args.host

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop, args=(args.coordinator, args.id, args.port, args.host), daemon=True
    )
    heartbeat_thread.start()

    print(f"[Worker {args.id}] Starting on port {args.port} (host {args.host}) ...")
    uvicorn.run(app, host="0.0.0.0", port=args.port)