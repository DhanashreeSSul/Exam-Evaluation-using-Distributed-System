import threading


class LamportClock:
    """A simple thread-safe Lamport logical clock."""

    def __init__(self):
        self._clock = 0
        self._lock = threading.Lock()

    def tick(self) -> int:
        """Call before a local event or before sending a message."""
        with self._lock:
            self._clock += 1
            return self._clock

    def update(self, received_clock: int) -> int:
        """Call when receiving a message that carries a remote clock value."""
        with self._lock:
            self._clock = max(self._clock, received_clock) + 1
            return self._clock

    @property
    def value(self) -> int:
        with self._lock:
            return self._clock
