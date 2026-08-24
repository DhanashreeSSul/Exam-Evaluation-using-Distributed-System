import threading


class DistributedLock:
    """A simple coordinator-managed mutual exclusion lock.
    Only one worker may hold it at a time (e.g. while updating a shared result)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._holder = None
        self._guard = threading.Lock()  # protects _holder

    def request(self, worker_id: int) -> bool:
        acquired = self._lock.acquire(blocking=False)
        if acquired:
            with self._guard:
                self._holder = worker_id
            return True
        return False

    def release(self, worker_id: int) -> bool:
        with self._guard:
            if self._holder != worker_id:
                return False
            self._holder = None
        try:
            self._lock.release()
        except RuntimeError:
            pass
        return True

    @property
    def holder(self):
        with self._guard:
            return self._holder
