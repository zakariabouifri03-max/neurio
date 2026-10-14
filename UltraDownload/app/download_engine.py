import hashlib
import json
import os
import threading
import time
from collections import deque
from dataclasses import replace
from pathlib import Path

from .assembler import BadChunk, assemble
from .bandwidth import ConnectionBudget, RateLimiter
from .chunk_scheduler import ChunkScheduler
from .file_utils import publish_no_replace, remove_owned, sync_file
from .http_client import (
    check_status,
    check_validator,
    client,
    compare_remote,
    identity,
    inspect_url,
    validate_range,
)
from .integrity import sha256_file, verify_checksum
from .models import (
    CHUNK_SIZE,
    DownloadError,
    InvalidResponse,
    RemoteInfo,
    Stopped,
    TransientError,
    chunk_count,
    chunk_range,
)


class DownloadEngine:
    def __init__(
        self,
        db,
        identifier,
        temp_root,
        settings,
        info=None,
        budget=None,
        limiter=None,
        notify=None,
    ):
        self.db, self.identifier, self.settings = db, identifier, settings.validate()
        self.temp_root = Path(temp_root)
        self.folder = self.temp_root / identifier
        self.chunks = self.folder / "chunks"
        self.record = db.get(identifier)
        self.info = info or RemoteInfo(**json.loads(self.record["info"]))
        self.destination = Path(self.record["destination"])
        self.stop = threading.Event()
        self.cancelled = False
        self.delete_on_cancel = False
        self.budget = budget or ConnectionBudget(settings.global_connections)
        self.global_limiter = limiter or RateLimiter(settings.global_bandwidth)
        self.file_limiter = RateLimiter(self.record["bandwidth"])
        self.notify = notify or (lambda identifier, snapshot: None)
        self.lock = threading.Lock()
        self.partial = {}
        self.active = 0
        self.completed = self.verified = self.failed = self.wire_bytes = 0
        self.last_error = ""
        self.last_emit = 0.0
        self.samples = deque()
        self.status = "recovering"
        self.scheduler = ChunkScheduler(self)
        self.http = None

    def pause(self):
        self.stop.set()

    def cancel(self, delete=False):
        self.cancelled, self.delete_on_cancel = True, delete
        self.stop.set()

    def clear_partial(self, index):
        with self.lock:
            self.partial.pop(index, None)

    def progress(self, index, amount, new_bytes):
        with self.lock:
            self.partial[index] = amount
            self.wire_bytes += new_bytes

    def emit(self, force=False):
        now = time.monotonic()
        if not force and now - self.last_emit < 0.2:
            return
        self.last_emit = now
        with self.lock:
            total = self.verified + sum(self.partial.values())
            active = self.active
            wire = self.wire_bytes
        if self.info.size is not None:
            total = min(total, self.info.size)
        self.samples.append((now, wire))
        while len(self.samples) > 2 and self.samples[1][0] < now - 3:
            self.samples.popleft()
        dt = now - self.samples[0][0]
        speed = (wire - self.samples[0][1]) / dt if dt > 0 else 0
        if self.status != "downloading":
            speed = 0
        self.db.update(self.identifier, downloaded=total)
        self.notify(
            self.identifier,
            dict(
                status=self.status,
                downloaded=total,
                size=self.info.size,
                speed=speed,
                active=active,
                completed=self.completed,
                failed=self.failed,
                pending=max(
                    0, self.record["chunks"] - self.completed - self.failed - active
                ),
                chunks=self.record["chunks"],
                error=self.last_error,
            ),
        )

    def set_status(self, status):
        self.status = status
        self.db.update(self.identifier, status=status)
        self.emit(True)

    def recover(self):
        expected_count = chunk_count(self.info.size) if self.info.ranges else 0
        if (
            self.record["chunk_size"] != CHUNK_SIZE
            or self.record["chunks"] != expected_count
        ):
            raise DownloadError("Saved chunk plan violates the fixed 1 MiB format")
        self.chunks.mkdir(parents=True, exist_ok=True)
        manifest = self.folder / "manifest.json"
        expected = dict(
            id=self.identifier,
            info=self.info.public_dict(),
            chunk_size=self.record["chunk_size"],
            chunks=self.record["chunks"],
        )
        if manifest.exists():
            saved = json.loads(manifest.read_text(encoding="utf-8"))
            # Session-only URLs may be resupplied, but byte identity metadata cannot change.
            for key in ("id", "chunk_size", "chunks"):
                if saved.get(key) != expected[key]:
                    raise DownloadError("Manifest does not match the saved download")
            if saved["info"].get("url") and saved["info"]["url"] != self.info.url:
                raise DownloadError(
                    "Manifest original URL does not match this download"
                )
            for key in ("size", "etag", "modified", "ranges"):
                if saved["info"].get(key) != expected["info"].get(key):
                    raise DownloadError(
                        "Manifest resource metadata does not match SQLite"
                    )
        else:
            tmp = manifest.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(expected, f)
                sync_file(f)
            os.replace(tmp, manifest)
            # New plans need no per-chunk fsyncs or nonexistent-file probes.
            counts = self.db.counts(self.identifier)
            if counts == {"pending": (self.record["chunks"], 0)} or (
                not counts and expected_count == 0
            ):
                return
        # Without a strong validator, resuming chunks across sessions is unsafe.
        reusable = bool(
            (self.info.etag and not self.info.etag.startswith("W/"))
            or self.info.modified
        )
        seen = 0
        for row in self.db.iter_chunks(self.identifier):
            start, end = chunk_range(seen, self.info.size)
            if (row["idx"], row["start"], row["end"], row["expected"]) != (
                seen,
                start,
                end,
                end - start + 1,
            ):
                raise DownloadError("Saved chunk byte ranges are inconsistent")
            seen += 1
            if self.stop.is_set():
                raise Stopped()
            path = self.chunks / f"{row['idx']:08d}.part"
            valid = (
                reusable
                and row["status"] == "complete"
                and path.is_file()
                and path.stat().st_size == row["expected"]
            )
            if valid:
                valid = sha256_file(path, self.stop) == row["sha256"]
            if valid:
                self.completed += 1
                self.verified += row["expected"]
            else:
                path.unlink(missing_ok=True)
                if row["status"] != "pending" or row["partial"] or row["sha256"]:
                    self.db.chunk(
                        self.identifier,
                        row["idx"],
                        status="pending",
                        partial=0,
                        sha256="",
                    )
            # Partial chunks are intentionally restarted, never blindly appended.
            path.with_suffix(".tmp").unlink(missing_ok=True)
            self.emit()
        if seen != self.record["chunks"]:
            raise DownloadError("Saved chunk plan has missing rows")

    def transfer_chunk(self, row):
        index = row["idx"]
        temporary = self.chunks / f"{index:08d}.tmp"
        final = temporary.with_suffix(".part")
        self.progress(index, 0, 0)
        headers = {"Range": f"bytes={row['start']}-{row['end']}"}
        validator = (
            self.info.etag
            if self.info.etag and not self.info.etag.startswith("W/")
            else self.info.modified
        )
        if validator:
            headers["If-Range"] = validator
        count = 0
        digest = hashlib.sha256()
        with self.budget.acquire(self.stop):
            with self.lock:
                self.active += 1
            try:
                with self.http.stream(
                    "GET", self.info.url, headers=headers
                ) as response:
                    validate_range(response, row["start"], row["end"], self.info.size)
                    check_validator(self.info, response)
                    with temporary.open("wb") as f:
                        for data in response.iter_raw():
                            if self.stop.is_set():
                                raise Stopped()
                            if count + len(data) > row["expected"]:
                                raise InvalidResponse(
                                    "Chunk body exceeded its assigned range"
                                )
                            self.global_limiter.consume(len(data), self.stop)
                            self.file_limiter.consume(len(data), self.stop)
                            f.write(data)
                            digest.update(data)
                            count += len(data)
                            self.progress(index, count, len(data))
                        if count != row["expected"]:
                            raise TransientError("Truncated chunk body")
                        sync_file(f)
                os.replace(temporary, final)
                self.db.chunk(
                    self.identifier,
                    index,
                    status="complete",
                    partial=count,
                    sha256=digest.hexdigest(),
                )
            finally:
                with self.lock:
                    self.active -= 1
                # Persists partial byte counts even for pause/network failures.
                self.db.chunk(self.identifier, index, partial=count)

    def single_stream(self, output):
        digest = hashlib.sha256()
        count = 0
        with (
            self.budget.acquire(self.stop),
            self.http.stream("GET", self.info.url) as response,
        ):
            check_status(response)
            identity(response)
            check_validator(self.info, response)
            if response.status_code != 200:
                raise InvalidResponse("Single-stream transfer requires HTTP 200")
            if (
                self.info.size is not None
                and response.headers.get("Content-Length") is not None
            ):
                if response.headers["Content-Length"] != str(self.info.size):
                    raise InvalidResponse("Single-stream Content-Length changed")
            with self.lock:
                self.active = 1
            try:
                with output.open("wb") as f:
                    for data in response.iter_raw():
                        if self.stop.is_set():
                            raise Stopped()
                        count += len(data)
                        if self.info.size is not None and count > self.info.size:
                            raise InvalidResponse(
                                "Single-stream response exceeded expected size"
                            )
                        self.global_limiter.consume(len(data), self.stop)
                        self.file_limiter.consume(len(data), self.stop)
                        f.write(data)
                        digest.update(data)
                        self.progress(0, count, len(data))
                        self.emit()
                    sync_file(f)
            finally:
                with self.lock:
                    self.active = 0
        if self.info.size is not None and count != self.info.size:
            raise TransientError("Truncated single-stream response")
        verify_checksum(digest.hexdigest(), self.record["checksum"])
        return digest.hexdigest(), count

    def cleanup_chunks(self):
        if self.settings.cleanup_completed:
            try:
                remove_owned(self.temp_root, self.identifier)
            except OSError:
                self.db.update(
                    self.identifier,
                    error="File completed and verified; temporary chunks could not be removed.",
                )

    def run(self):
        output = (
            self.destination.parent / f".ultradownload-{self.identifier}.assembling"
        )
        try:
            self.set_status("recovering")
            # Complete a crash-interrupted publication only with a persisted digest.
            if self.destination.exists():
                if (
                    self.record["publish_hash"]
                    and sha256_file(self.destination, self.stop)
                    == self.record["publish_hash"]
                ):
                    self.verified = self.destination.stat().st_size
                    self.db.update(
                        self.identifier, actual_hash=self.record["publish_hash"]
                    )
                    self.set_status("completed")
                    self.cleanup_chunks()
                    return
                raise FileExistsError(
                    "Destination already exists; choose a different filename"
                )
            if not self.info.url:
                raise DownloadError(
                    "This URL was session-only. Supply its direct URL again to resume."
                )
            with self.budget.acquire(self.stop):
                current = inspect_url(self.info.url, self.settings)
            compare_remote(self.info, current)
            self.info = replace(self.info, resolved_url=current.resolved_url)
            self.db.update(self.identifier, info=json.dumps(self.info.public_dict()))
            self.recover()
            # Only remaining chunks need additional temporary space on resume.
            required = max(0, (self.info.size or 0) - self.verified)
            self.destination.parent.mkdir(parents=True, exist_ok=True)
            import shutil

            same = self.folder.stat().st_dev == self.destination.parent.stat().st_dev
            if self.info.size is not None:
                need = self.info.size + (required if same else 0)
                if shutil.disk_usage(self.destination.parent).free < need:
                    raise OSError(
                        "Insufficient destination disk space for assembly and remaining chunks"
                    )
                if not same and shutil.disk_usage(self.folder).free < required:
                    raise OSError("Insufficient temporary disk space")
            if self.stop.is_set():
                raise Stopped()
            self.set_status("downloading")
            with client(self.settings) as self.http:
                if self.info.ranges:
                    self.scheduler.run()
                    self.set_status("assembling")
                    digest = assemble(
                        self.db,
                        self.identifier,
                        self.chunks,
                        output,
                        self.info.size,
                        self.record["checksum"],
                        self.stop,
                    )
                    final_size = self.info.size
                else:
                    import random
                    import httpx

                    for attempt in range(self.settings.retries + 1):
                        try:
                            digest, final_size = self.single_stream(output)
                            break
                        except (
                            TransientError,
                            httpx.TimeoutException,
                            httpx.NetworkError,
                            httpx.RemoteProtocolError,
                        ) as exc:
                            if attempt == self.settings.retries:
                                raise DownloadError(
                                    "Single-stream transfer exhausted its retry budget"
                                ) from exc
                            self.clear_partial(0)
                            delay = max(
                                getattr(exc, "retry_after", 0),
                                min(60, self.settings.retry_delay * 2**attempt)
                                * random.uniform(0.8, 1.2),
                            )
                            if self.stop.wait(delay):
                                raise Stopped()
            if self.stop.is_set():
                raise Stopped()
            self.db.update(self.identifier, publish_hash=digest, status="publishing")
            publish_no_replace(output, self.destination)
            self.partial.clear()
            self.verified = final_size
            self.db.update(self.identifier, actual_hash=digest, error="")
            self.set_status("completed")
            self.cleanup_chunks()
        except Stopped:
            self.set_status("cancelled" if self.cancelled else "paused")
            if self.cancelled and self.delete_on_cancel:
                remove_owned(self.temp_root, self.identifier)
                self.db.update(self.identifier, downloaded=0)
        except Exception as exc:
            if isinstance(exc, BadChunk):
                self.db.chunk(self.identifier, exc.index, status="failed", partial=0)
            # HTTP client exceptions often contain signed URLs; don't expose those.
            self.last_error = (
                str(exc)
                if isinstance(exc, (DownloadError, OSError, ValueError))
                else f"Transfer failed ({type(exc).__name__})"
            )
            self.db.update(self.identifier, error=self.last_error)
            self.set_status("failed")
        finally:
            try:
                output.unlink(missing_ok=True)
            except OSError:
                # A cleanup failure must not erase the transfer's original outcome.
                self.db.update(
                    self.identifier,
                    error=self.db.get(self.identifier)["error"]
                    or "Temporary assembly output could not be removed.",
                )
