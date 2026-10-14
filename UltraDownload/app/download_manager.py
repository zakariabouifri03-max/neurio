import json
import threading
import uuid
from dataclasses import replace
from pathlib import Path

from .bandwidth import ConnectionBudget, RateLimiter
from .database import Database
from .download_engine import DownloadEngine
from .file_utils import check_space, remove_owned, safe_filename, validate_url
from .integrity import validate_checksum
from .models import RemoteInfo


class DownloadManager:
    """UI-independent persistent queue. One coordinator, bounded file/connection pools."""

    def __init__(self, root, settings, notify=None):
        self.root = Path(root)
        self.temp = self.root / "downloads_temp"
        self.temp.mkdir(parents=True, exist_ok=True)
        self.db = Database(self.root / "downloads.sqlite3")
        self.db.interrupted()
        self.settings = settings.validate()
        self.notify = notify or (lambda identifier, snapshot: None)
        self.budget = ConnectionBudget(settings.global_connections)
        self.limiter = RateLimiter(settings.global_bandwidth)
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.closing = False
        self.active = {}
        self.session_info = {}
        self.coordinator = threading.Thread(
            target=self._coordinate, name="download-queue", daemon=False
        )
        self.coordinator.start()

    def add(self, info, directory, filename, checksum="", allow_single=False):
        if not info.ranges and not allow_single:
            raise ValueError("Confirm single-stream fallback before adding this URL")
        checksum = validate_checksum(checksum)
        destination = Path(directory).expanduser().resolve() / safe_filename(filename)
        check_space(self.temp, destination.parent, info.size)
        if destination.exists():
            raise FileExistsError(
                "A file with this name already exists. Choose a different filename."
            )
        with self.lock:
            if self.closing:
                raise ValueError("Application is closing")
            if any(
                Path(r["destination"]) == destination
                and r["status"] not in ("completed", "cancelled")
                for r in self.db.downloads()
            ):
                raise ValueError(
                    "This destination is already reserved by another download"
                )
            identifier = uuid.uuid4().hex
            self.db.create(
                identifier, info, destination, checksum, self.settings.file_bandwidth
            )
            self.session_info[identifier] = info
            self.wake.set()
        return identifier

    def _coordinate(self):
        while True:
            with self.lock:
                for identifier, (_, thread) in list(self.active.items()):
                    if not thread.is_alive():
                        thread.join()
                        del self.active[identifier]
                if self.closing:
                    if not self.active:
                        return
                else:
                    available = self.settings.simultaneous_files - len(self.active)
                    if available > 0:
                        for row in self.db.downloads():
                            if available <= 0:
                                break
                            if row["status"] != "queued" or row["id"] in self.active:
                                continue
                            engine = DownloadEngine(
                                self.db,
                                row["id"],
                                self.temp,
                                replace(self.settings),
                                self.session_info.get(row["id"]),
                                self.budget,
                                self.limiter,
                                self.notify,
                            )
                            thread = threading.Thread(
                                target=engine.run, name=f"download-{row['id'][:6]}"
                            )
                            self.active[row["id"]] = engine, thread
                            thread.start()
                            available -= 1
            self.wake.wait(0.1)
            self.wake.clear()

    def pause(self, identifier):
        with self.lock:
            if identifier in self.active:
                engine, _ = self.active[identifier]
                # The engine owns status transitions. Writing 'pausing' here can
                # race publication and overwrite a just-completed history record.
                engine.pause()
            elif self.db.get(identifier)["status"] == "queued":
                self.db.update(identifier, status="paused")

    def resume(self, identifier, url=None, retry=False):
        with self.lock:
            if identifier in self.active:
                return
            row = self.db.get(identifier)
            if row["status"] == "completed":
                return
            if any(
                r["id"] != identifier
                and r["destination"] == row["destination"]
                and r["status"] not in ("completed", "cancelled")
                for r in self.db.downloads()
            ):
                raise ValueError(
                    "Another transfer now reserves this destination. Cancel it before resuming."
                )
            info = self.session_info.get(identifier) or RemoteInfo(
                **json.loads(row["info"])
            )
            if url:
                url = validate_url(url)
                if info.url and url != info.url:
                    raise ValueError(
                        "The URL differs from the original. Add it as a new download instead."
                    )
                info = replace(info, url=url)
                self.session_info[identifier] = info
            if not info.url:
                raise ValueError(
                    "Supply the original direct URL again; query URLs are not stored on disk."
                )
            if retry:
                self.db.reset_failed(identifier)
            self.db.update(identifier, status="queued", error="")
            self.wake.set()

    def cancel(self, identifier, delete=False):
        with self.lock:
            if identifier in self.active:
                self.active[identifier][0].cancel(delete)
            else:
                if self.db.get(identifier)["status"] == "completed":
                    return
                if delete:
                    remove_owned(self.temp, identifier)
                self.db.update(
                    identifier,
                    status="cancelled",
                    **({"downloaded": 0} if delete else {}),
                )

    def pause_all(self):
        with self.lock:
            for row in self.db.downloads():
                self.pause(row["id"])

    def resume_all(self):
        skipped = 0
        with self.lock:
            for row in self.db.downloads():
                if row["status"] in ("paused", "failed"):
                    try:
                        self.resume(row["id"], retry=True)
                    except ValueError:
                        skipped += 1
        return skipped

    def prioritize(self, identifier):
        with self.lock:
            maximum = max((r["priority"] for r in self.db.downloads()), default=0)
            self.db.update(identifier, priority=maximum + 1)
            self.wake.set()

    def set_bandwidth(self, identifier, rate):
        if rate < 0:
            raise ValueError("Bandwidth cannot be negative")
        with self.lock:
            self.db.update(identifier, bandwidth=rate)
            if identifier in self.active:
                limiter = self.active[identifier][0].file_limiter
                limiter.set_rate(rate)

    def apply_settings(self, settings):
        with self.lock:
            if self.active:
                raise ValueError(
                    "Pause active downloads and wait for them to stop before changing settings."
                )
            self.settings = settings.validate()
            self.budget = ConnectionBudget(settings.global_connections)
            self.limiter = RateLimiter(settings.global_bandwidth)
            settings.save(self.root / "settings.json")
            self.wake.set()

    def request_shutdown(self):
        with self.lock:
            self.closing = True
            self.pause_all()
            self.wake.set()

    def close(self):
        self.request_shutdown()
        self.coordinator.join()
        self.db.close()
