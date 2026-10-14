import random
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import httpx
from .models import InvalidResponse, Stopped, TransientError


class ChunkScheduler:
    """SQLite is the queue. At most `workers` futures exist, including running work."""

    def __init__(self, engine):
        self.e = engine
        self.max_submitted = 0

    def run(self):
        e = self.e
        futures = {}
        cooldown = 0.0
        fatal = None
        with ThreadPoolExecutor(
            max_workers=e.settings.connections, thread_name_prefix="chunk"
        ) as pool:
            while True:
                if not e.stop.is_set() and time.time() >= cooldown:
                    slots = e.settings.connections - len(futures)
                    for row in e.db.next_pending(e.identifier, slots) if slots else []:
                        e.db.chunk(e.identifier, row["idx"], status="active")
                        futures[pool.submit(e.transfer_chunk, row)] = row
                    self.max_submitted = max(self.max_submitted, len(futures))
                e.emit()
                if not futures:
                    if e.stop.is_set():
                        break
                    counts = e.db.counts(e.identifier)
                    if not counts.get("pending", (0, 0))[0]:
                        break
                    e.stop.wait(0.05)
                    continue
                done, _ = wait(futures, timeout=0.1, return_when=FIRST_COMPLETED)
                for future in done:
                    row = futures.pop(future)
                    index = row["idx"]
                    try:
                        future.result()
                        e.completed += 1
                        e.verified += row["expected"]
                        e.clear_partial(index)
                    except Stopped:
                        e.db.chunk(e.identifier, index, status="pending")
                    except (
                        TransientError,
                        httpx.TimeoutException,
                        httpx.NetworkError,
                        httpx.RemoteProtocolError,
                    ) as exc:
                        attempts = row["retries"] + 1
                        retry_delay = max(
                            getattr(exc, "retry_after", 0),
                            min(60, e.settings.retry_delay * 2 ** row["retries"])
                            * random.uniform(0.8, 1.2),
                        )
                        if isinstance(exc, TransientError) and exc.retry_after:
                            cooldown = max(cooldown, time.time() + retry_delay)
                        e.db.chunk(
                            e.identifier,
                            index,
                            status="pending"
                            if attempts <= e.settings.retries
                            else "failed",
                            retries=attempts,
                            retry_at=time.time() + retry_delay,
                        )
                        if attempts > e.settings.retries:
                            e.failed += 1
                            e.last_error = f"Chunk {index} exhausted its retry budget"
                            fatal = InvalidResponse(e.last_error)
                            e.stop.set()
                    except Exception as exc:
                        e.db.chunk(e.identifier, index, status="failed")
                        e.failed += 1
                        fatal = exc
                        # Protocol, resource-version and disk failures must not fan out.
                        e.stop.set()
                if e.stop.is_set() and not futures:
                    break
        if fatal:
            raise fatal
        if e.stop.is_set():
            raise Stopped()
        if e.failed:
            raise InvalidResponse(e.last_error)
