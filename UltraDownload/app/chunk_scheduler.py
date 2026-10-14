from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from .http_client import Interrupted


def schedule(indices, worker, stop, connections=10):
    """Only `connections` futures exist. No unbounded executor work queue."""
    if not 1 <= connections <= 10:
        raise ValueError("Expected 1–10 workers")
    pending = iter(indices)
    with ThreadPoolExecutor(max_workers=connections, thread_name_prefix="chunk") as pool:
        active = {}

        def fill():
            while len(active) < connections and not stop.is_set():
                try:
                    index = next(pending)
                except StopIteration:
                    break
                active[pool.submit(worker, index)] = index

        fill()
        first_error = None
        while active:
            done, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in done:
                active.pop(future)
                try:
                    future.result()
                except Exception as error:
                    first_error = first_error or error
                    stop.set()
            fill()
        if first_error:
            raise first_error
        if stop.is_set():
            raise Interrupted()
