import threading
import time
from datetime import datetime, timedelta

HEARTBEAT_TIMEOUT_SECONDS = 4
CHECK_INTERVAL_SECONDS = 1


def start_heartbeat_monitor(session_factory, worker_model, log_event_func):
    """Runs forever in a background thread. Marks workers FAILED if their
    last heartbeat is older than HEARTBEAT_TIMEOUT_SECONDS."""

    def monitor():
        while True:
            time.sleep(CHECK_INTERVAL_SECONDS)
            db = session_factory()
            try:
                cutoff = datetime.utcnow() - timedelta(seconds=HEARTBEAT_TIMEOUT_SECONDS)
                workers = db.query(worker_model).all()
                for w in workers:
                    if w.status == "ACTIVE" and w.last_heartbeat and w.last_heartbeat < cutoff:
                        w.status = "FAILED"
                        log_event_func(db, "Worker Heartbeat Timeout", f"Worker {w.worker_id}")
                db.commit()
            except Exception as e:
                print("Heartbeat monitor error:", e)
            finally:
                db.close()

    t = threading.Thread(target=monitor, daemon=True)
    t.start()
    return t
