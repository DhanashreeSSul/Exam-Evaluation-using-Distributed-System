# ============================================
# coordinator/ledger_demo.py
# DEMO ONLY: lets you tamper with a stored result so you can show the hash chain catching it.
# Original values are saved to a file so "Restore" always works, even after a pod restart.
# ============================================
import hashlib
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db, DB_DIR

router = APIRouter(prefix="/ledger", tags=["ledger-demo"])

BACKUP_PATH = os.path.join(DB_DIR, "ledger_tamper_backup.json")


def _load_backup() -> dict:
    try:
        with open(BACKUP_PATH) as f:
            return {int(k): v for k, v in json.load(f).items()}
    except Exception:
        return {}


def _save_backup(data: dict) -> None:
    with open(BACKUP_PATH, "w") as f:
        json.dump(data, f)


def _hash(r: models.Result) -> str:
    # Same payload format the coordinator uses when it creates and verifies blocks
    ts = r.timestamp.isoformat() if r.timestamp else ""
    payload = f"{r.task_id}|{r.worker_id}|{r.score}|{r.total}|{r.status}|{ts}|{r.prev_hash}"
    return hashlib.sha256(payload.encode()).hexdigest()


class TamperRequest(BaseModel):
    result_id: int
    new_score: int
    recompute_hash: bool = False  # True = "smart attacker" who also rewrites the block's own hash


@router.post("/tamper")
def tamper(req: TamperRequest, db: Session = Depends(get_db)):
    r = db.query(models.Result).filter(models.Result.id == req.result_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Result not found")

    backup = _load_backup()
    if r.id not in backup:  # keep the ORIGINAL values even if tampered twice
        backup[r.id] = {"score": r.score, "result_hash": r.result_hash}
        _save_backup(backup)

    old_score = r.score
    r.score = req.new_score
    if req.recompute_hash:
        r.result_hash = _hash(r)
    db.commit()
    return {
        "result_id": r.id,
        "old_score": old_score,
        "new_score": r.score,
        "hash_recomputed": req.recompute_hash,
    }


@router.post("/restore")
def restore(db: Session = Depends(get_db)):
    backup = _load_backup()
    restored = 0
    for rid, original in backup.items():
        r = db.query(models.Result).filter(models.Result.id == rid).first()
        if r:
            r.score = original["score"]
            r.result_hash = original["result_hash"]
            restored += 1
    db.commit()
    _save_backup({})
    return {"restored": restored}


@router.get("/tamper-status")
def tamper_status():
    return {"tampered_ids": list(_load_backup().keys())}