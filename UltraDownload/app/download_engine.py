from collections import deque
from pathlib import Path
import os
import random
import threading
import time
import httpx
from .assembler import assemble, InvalidChunk
from .chunk_scheduler import schedule
from .file_utils import prepare_directory, check_space, cleanup
from .http_client import HTTPClient, Interrupted, TransferError, ProtocolError, ResourceChanged, RateLimiter
from .integrity import sha256_file
from .models import chunk_range


def public_error(error):
    # HTTPX exception messages can contain signed URLs; never persist or display them.
    if isinstance(error, httpx.HTTPError):
        return f"Network failure ({type(error).__name__}). Check connection, TLS certificate, or source availability."
    if isinstance(error, FileExistsError):
        return "Destination already exists. Choose a different filename; no file was overwritten."
    if isinstance(error, OSError):
        return f"Disk/permission failure ({type(error).__name__}, errno {error.errno}). Check free space and destination permissions."
    if isinstance(error, (ProtocolError, TransferError, InvalidChunk, ValueError)):
        return str(error)
    return f"Operation failed ({type(error).__name__}). Local data has been retained."


class DownloadEngine:
    def __init__(self, db, download, settings, global_slots=None, global_limiter=None, callback=None):
        settings.validate()
        self.db, self.d, self.settings = db, download, settings
        self.global_slots = global_slots or threading.BoundedSemaphore(settings.global_connections)
        self.global_limiter = global_limiter or RateLimiter(settings.global_bandwidth)
        self.limiter = RateLimiter(download.bandwidth or settings.per_download_bandwidth)
        self.callback = callback or (lambda snapshot: None)
        self.stop = threading.Event()
        self.cancelled = self.delete_on_cancel = False
        self.lock = threading.RLock()
        self.progress, self.completed, self.failed = {}, set(), set()
        self.active = self.transferred = self.last_emit = 0
        self.samples = deque()
        self.client = None

    def pause(self):
        self.stop.set()

    def cancel(self, delete=False):
        self.cancelled, self.delete_on_cancel = True, delete
        self.stop.set()

    def emit(self, force=False):
        with self.lock:
            now = time.monotonic()
            if not force and now - self.last_emit < .2:
                return
            self.last_emit = now
            self.samples.append((now, self.transferred))
            while len(self.samples) > 2 and self.samples[1][0] < now - 3:
                self.samples.popleft()
            elapsed = now - self.samples[0][0]
            speed = (self.transferred-self.samples[0][1])/elapsed if elapsed > .05 else 0
            if self.d.status != "downloading":
                speed = 0
            total, downloaded = self.d.size, sum(self.progress.values())
            if total is not None:
                downloaded = min(total, downloaded)
            snapshot = dict(id=self.d.id, status=self.d.status, downloaded=downloaded, total=total,
                            percent=(100*downloaded/total if total else (100 if total == 0 else 0)),
                            speed=speed, eta=(max(0, total-downloaded)/speed if speed and total is not None else None),
                            active=self.active, completed=len(self.completed), failed=len(self.failed),
                            pending=max(0, self.d.count-len(self.completed)-self.active-len(self.failed)), error=self.d.error)
        self.callback(snapshot)

    def state(self, status):
        self.d.status = status
        self.db.save(self.d)
        self.emit(True)

    def run(self):
        try:
            destination = Path(self.d.destination)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if (self.d.sha256 and destination.is_file() and not destination.is_symlink()
                        and destination.stat().st_size == self.d.size
                        and sha256_file(destination, self.stop) == self.d.sha256):
                    self.progress[0] = self.d.size
                    self.state("completed")
                    return
                raise FileExistsError()
            self.state("verifying")
            self.root = prepare_directory(self.d)
            self.client = HTTPClient(self.settings)
            original, _ = self.db.urls(self.d.id)
            self.remote = self.inspect_with_retry(original)
            if ((self.remote.size is not None and self.remote.size != self.d.size) or self.remote.ranges != self.d.ranges
                    or (self.d.etag and self.remote.etag != self.d.etag)
                    or (self.d.modified and self.remote.modified != self.d.modified)):
                raise ResourceChanged("Remote file changed. Restart with a new inspection; existing chunks were not mixed.")
            self.db.vault.put(self.d.id + ":resolved", self.remote.url)
            self.recover_chunks()
            if self.d.size is not None:
                check_space(destination.parent, max(0, 2*self.d.size-sum(self.progress.values())))
            if self.stop.is_set():
                raise Interrupted()
            self.d.error = ""
            self.state("downloading")
            if self.d.ranges:
                schedule((i for i in range(self.d.count) if i not in self.completed), self.worker,
                         self.stop, self.settings.connections)
            elif self.d.size != 0 and 0 not in self.completed:
                self.worker(0)
            self.state("assembling")
            self.d.sha256 = assemble(self.d, self.db, self.root, self.stop)
            self.state("completed")
            if self.settings.cleanup_completed:
                try:
                    cleanup(self.d)
                except (OSError, ValueError, KeyError):
                    self.d.error = "Download complete; temporary cleanup failed. Data retained."
                    self.db.save(self.d)
        except Interrupted:
            self.state("cancelled" if self.cancelled else "paused")
        except Exception as error:
            if isinstance(error, InvalidChunk):
                self.db.chunk(self.d.id, error.index, "failed", 0)
            self.d.error = public_error(error)
            self.state("failed")
        finally:
            if self.client:
                self.client.close()
            if self.cancelled and self.delete_on_cancel:
                try:
                    cleanup(self.d)
                    self.db.clear_chunks(self.d.id)
                    self.progress.clear()
                except Exception:
                    self.d.error = "Temporary cleanup failed; data retained for safety."
                    self.db.save(self.d)
            self.emit(True)

    def inspect_with_retry(self, url):
        for attempt in range(self.settings.retries+1):
            if self.stop.is_set():
                raise Interrupted()
            try:
                self.acquire_slot()
                try:
                    return self.client.inspect(url)
                finally:
                    self.global_slots.release()
            except (httpx.TransportError, TransferError) as error:
                self.backoff(error, attempt)

    def acquire_slot(self):
        while not self.global_slots.acquire(timeout=.1):
            if self.stop.is_set():
                raise Interrupted()
        if self.stop.is_set():
            self.global_slots.release()
            raise Interrupted()

    def backoff(self, error, attempt):
        if (isinstance(error, TransferError) and not error.retryable) or attempt >= self.settings.retries:
            raise error
        delay = max(getattr(error, "delay", 0), min(60, self.settings.retry_delay*2**attempt)*random.uniform(.8, 1.2))
        if self.stop.wait(delay):
            raise Interrupted()

    def recover_chunks(self):
        for row in self.db.chunks(self.d.id):
            if self.stop.is_set():
                raise Interrupted()
            index = row["idx"]
            if index >= self.d.count:
                raise ValueError("Chunk metadata does not match manifest")
            bounds = chunk_range(self.d.size, index) if self.d.ranges else (0, (self.d.size or 0)-1)
            expected = bounds[1]-bounds[0]+1
            complete = self.root / "chunks" / f"{index:06d}.part"
            partial = complete.with_suffix(".tmp")
            valid = bool(self.remote.validator and ((self.d.etag and not self.d.etag.startswith("W/")) or self.d.modified))
            if (valid and row["status"] == "complete" and complete.is_file() and not complete.is_symlink()
                    and complete.stat().st_size == expected and sha256_file(complete, self.stop) == row["digest"]):
                self.completed.add(index)
                self.progress[index] = expected
                continue
            if complete.exists() or complete.is_symlink():
                complete.unlink()
            if (valid and self.d.ranges and partial.is_file() and not partial.is_symlink()
                    and 0 < partial.stat().st_size < expected and partial.stat().st_size == row["bytes"]
                    and row["digest"] and sha256_file(partial, self.stop) == row["digest"]):
                self.progress[index] = partial.stat().st_size
                self.db.chunk(self.d.id, index, "partial", self.progress[index], row["retries"], row["digest"])
            else:
                partial.unlink(missing_ok=True)
                self.db.chunk(self.d.id, index, "pending", 0, row["retries"])
            self.emit()

    def worker(self, index):
        part = self.root / "chunks" / f"{index:06d}.part"
        tmp = part.with_suffix(".tmp")
        records = self.db.chunks(self.d.id, index, 1)
        retries = records[0]["retries"] if records and records[0]["idx"] == index else 0
        try:
            for attempt in range(self.settings.retries+1):
                if self.stop.is_set():
                    raise Interrupted()
                try:
                    self.transfer(index, tmp)
                    digest = sha256_file(tmp, self.stop)
                    os.replace(tmp, part)
                    size = part.stat().st_size
                    self.db.chunk(self.d.id, index, "complete", size, retries, digest)
                    with self.lock:
                        self.progress[index] = size
                        self.completed.add(index)
                    self.emit()
                    return
                except (httpx.TransportError, TransferError) as error:
                    retries += 1
                    self.save_partial(index, tmp, retries, "retrying")
                    self.backoff(error, attempt)
        except Interrupted:
            self.save_partial(index, tmp, retries, "partial")
            raise
        except Exception:
            self.save_partial(index, tmp, retries, "failed")
            with self.lock:
                self.failed.add(index)
            raise

    def save_partial(self, index, path, retries, status):
        size = path.stat().st_size if path.is_file() and not path.is_symlink() else 0
        digest = sha256_file(path) if size and self.d.ranges else ""
        self.db.chunk(self.d.id, index, status, size, retries, digest)
        with self.lock:
            self.progress[index] = size

    def transfer(self, index, tmp):
        if tmp.is_symlink():
            raise OSError("Unsafe chunk path")
        start, end, offset = None, None, 0
        if self.d.ranges:
            start, end = chunk_range(self.d.size, index)
            expected = end-start+1
            if tmp.exists() and self.remote.validator and 0 < tmp.stat().st_size < expected:
                offset = tmp.stat().st_size
            else:
                tmp.unlink(missing_ok=True)
            start += offset
        else:
            tmp.unlink(missing_ok=True)
            expected = self.d.size
        with self.lock:
            self.progress[index] = offset
        self.acquire_slot()
        try:
            with self.client.stream(self.remote.url, self.remote, start, end) as response:
                self.client.validate_response(response, self.remote, start, end)
                with self.lock:
                    self.active += 1
                try:
                    self.db.chunk(self.d.id, index, "active", offset)
                    with tmp.open("ab" if offset else "wb") as stream:
                        for block in response.iter_raw(64*1024):
                            if self.stop.is_set():
                                raise Interrupted()
                            if expected is not None and offset+len(block) > expected:
                                raise ProtocolError("Response body exceeds expected size")
                            self.global_limiter.consume(len(block), self.stop)
                            self.limiter.consume(len(block), self.stop)
                            stream.write(block)
                            offset += len(block)
                            with self.lock:
                                self.progress[index] = offset
                                self.transferred += len(block)
                            self.emit()
                        stream.flush()
                        os.fsync(stream.fileno())
                    if expected is not None and offset != expected:
                        raise TransferError("Truncated response body", retryable=True)
                    if self.d.size is None:
                        self.d.size = offset
                        import json
                        manifest = self.root / "manifest.json"
                        value = json.loads(manifest.read_text())
                        value["size"] = offset
                        staging = manifest.with_suffix(".tmp")
                        staging.write_text(json.dumps(value))
                        os.replace(staging, manifest)
                        self.db.save(self.d)
                finally:
                    with self.lock:
                        self.active -= 1
        finally:
            self.global_slots.release()
