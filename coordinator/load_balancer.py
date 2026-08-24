import threading


class RoundRobinBalancer:
    """Picks the next active worker in round-robin order."""

    def __init__(self):
        self._index = 0
        self._lock = threading.Lock()

    def get_next_worker(self, active_workers: list):
        if not active_workers:
            return None
        with self._lock:
            worker = active_workers[self._index % len(active_workers)]
            self._index += 1
            return worker
