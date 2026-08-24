def run_bully_election(active_workers: list, log):
    """Simplified Bully Algorithm.

    active_workers: list of Worker ORM objects (must have .worker_id)
    log: callable(message: str) -> None, used to record each step
    Returns the elected leader Worker object, or None if no workers are active.
    """
    log("Election Started")

    if not active_workers:
        log("No active workers available. Election failed.")
        return None

    sorted_workers = sorted(active_workers, key=lambda w: w.worker_id)

    for i in range(len(sorted_workers) - 1):
        lower = sorted_workers[i]
        higher = sorted_workers[i + 1]
        log(f"Worker {lower.worker_id} contacted Worker {higher.worker_id}")

    leader = sorted_workers[-1]
    log(f"Worker {leader.worker_id} became Coordinator")
    log("New Coordinator Announced")
    return leader
