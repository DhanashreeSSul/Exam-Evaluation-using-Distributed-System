# ============================================
# NEW FILE: coordinator/vector_clock.py
# ============================================
import json

class VectorClock:
    def __init__(self, process_id, all_ids):
        self.process_id = str(process_id)
        self.clock = {str(pid): 0 for pid in all_ids}

    def tick(self):
        self.clock[self.process_id] += 1
        return dict(self.clock)

    def update(self, received_clock):
        for pid, val in received_clock.items():
            self.clock[pid] = max(self.clock.get(pid, 0), val)
        self.clock[self.process_id] += 1
        return dict(self.clock)

    def to_json(self):
        return json.dumps(self.clock)

    @staticmethod
    def from_json(s, process_id, all_ids):
        vc = VectorClock(process_id, all_ids)
        if s:
            try:
                data = json.loads(s)
                vc.clock.update(data)
            except Exception:
                pass
        return vc