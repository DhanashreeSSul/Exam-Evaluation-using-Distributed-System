# ============================================
# NEW FILE: coordinator/snapshot.py
# ============================================
from datetime import datetime

class SnapshotManager:
    def __init__(self):
        self.snapshots = []

    def capture(self, coordinator_state, worker_states):
        snap = {
            "snapshot_id": len(self.snapshots) + 1,
            "timestamp": datetime.utcnow().isoformat(),
            "coordinator_state": coordinator_state,
            "worker_states": worker_states,
            "channel_state": {
                "in_transit_tasks": [
                    t for t in coordinator_state.get("tasks", [])
                    if t.get("status") == "PROCESSING"
                ]
            },
        }
        self.snapshots.append(snap)
        return snap

    def get_all(self):
        return self.snapshots

    def get_latest(self):
        return self.snapshots[-1] if self.snapshots else None