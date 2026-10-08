# ============================================
# NEW FILE: coordinator/clock_sync.py
# ============================================
import random
import time
from datetime import datetime

class BerkeleyClockSync:
    def __init__(self):
        self.last_sync = None
        self.offsets = {}

    def simulate_worker_times(self, worker_ids):
        base = time.time()
        times = {}
        for wid in worker_ids:
            drift = random.uniform(-5, 5)
            times[wid] = base + drift
        return base, times

    def compute_average(self, coordinator_time, worker_times):
        all_times = [coordinator_time] + list(worker_times.values())
        avg = sum(all_times) / len(all_times)
        offsets = {"coordinator": round(avg - coordinator_time, 3)}
        for wid, t in worker_times.items():
            offsets[str(wid)] = round(avg - t, 3)
        return avg, offsets

    def run_sync(self, worker_ids):
        coordinator_time, worker_times = self.simulate_worker_times(worker_ids)
        avg, offsets = self.compute_average(coordinator_time, worker_times)
        self.last_sync = datetime.utcnow()
        self.offsets = offsets
        return {
            "coordinator_time": coordinator_time,
            "worker_times": worker_times,
            "average_time": avg,
            "offsets": offsets,
            "synced_at": self.last_sync.isoformat(),
        }