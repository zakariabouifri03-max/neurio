from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import uuid
from PySide6.QtCore import QObject, QTimer
from .database import Database
from .download_engine import DownloadEngine, public_error
from .file_utils import safe_filename, cleanup
from .http_client import HTTPClient, validate_url, RateLimiter
from .integrity import validate_checksum
from .models import Download
from .signals import Signals


class DownloadManager(QObject):
    def __init__(self, database, settings, parent=None):
        super().__init__(parent)
        self.db, self.settings = database, settings
        self.signals = Signals(self)
        self.pool = ThreadPoolExecutor(max_workers=10, thread_name_prefix="file")
        self.inspect_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="inspection")
        self.inspections = []
        self.running, self.snapshots = {}, {}
        self.closing = False
        self.configure(settings)
        self.db.recover()
        self.signals.progress.connect(self.receive_progress)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.pump)
        self.timer.start(250)

    def configure(self, settings):
        if getattr(self, 'running', {}):
            raise ValueError("Pause active downloads before applying settings")
        settings.validate()
        self.settings = settings
        self.slots = threading.BoundedSemaphore(settings.global_connections)
        self.limiter = RateLimiter(settings.global_bandwidth)

    def inspect(self, url):
        validate_url(url)
        if any(not f.done() for f in self.inspections):
            raise ValueError("An inspection is already running")
        def work():
            client = HTTPClient(self.settings)
            try:
                # Inspection shares the same global connection budget as downloads.
                with self.slots:
                    remote = client.inspect(url)
                self.signals.inspected.emit(remote, "")
            except Exception as error:
                self.signals.inspected.emit(None, public_error(error))
            finally:
                client.close()
        self.inspections = [self.inspect_pool.submit(work)]

    def add(self, url, remote, directory, filename, checksum='', bandwidth=0):
        validate_url(url)
        directory = Path(directory).expanduser().resolve()
        directory.mkdir(parents=True, exist_ok=True)
        filename = safe_filename(filename)
        destination = directory / filename
        if destination.exists():
            raise ValueError("A file with that name already exists. Choose a new filename.")
        if any(d.destination.casefold() == str(destination).casefold() for d in self.db.downloads()):
            raise ValueError("That destination is already in download history. Choose a new filename.")
        d = Download(str(uuid.uuid4()), filename, str(destination), remote.size, remote.ranges,
                     remote.etag, remote.modified, validate_checksum(checksum), bandwidth=bandwidth)
        try:
            self.db.add(d, url, remote.url)
        except Exception:
            raise ValueError("Could not save download securely. Check OS credential-store availability and local database permissions.") from None
        self.signals.changed.emit()
        self.pump()
        return d

    def receive_progress(self, snapshot):
        self.snapshots[snapshot['id']] = snapshot
        self.signals.changed.emit()

    def pump(self):
        finished = [id for id, (_, future) in self.running.items() if future.done()]
        for id in finished:
            _, future = self.running.pop(id)
            try:
                future.result()
            except Exception as error:
                self.signals.error.emit(public_error(error))
        if finished:
            self.signals.changed.emit()
        for engine, _ in list(self.running.values()):
            engine.emit()
        if self.closing:
            return
        for d in sorted(self.db.downloads(), key=lambda d: -d.priority):
            if len(self.running) >= self.settings.simultaneous_files:
                break
            if d.status == 'queued' and d.id not in self.running:
                engine = DownloadEngine(self.db, d, self.settings, self.slots, self.limiter,
                                        self.signals.progress.emit)
                self.running[d.id] = engine, self.pool.submit(engine.run)

    def pause(self, id):
        if id in self.running:
            self.running[id][0].pause()
        else:
            d = self.db.get(id)
            if d.status == 'queued':
                d.status = 'paused'
                self.db.save(d)
        self.signals.changed.emit()

    def resume(self, id):
        if id in self.running:
            return
        d = self.db.get(id)
        if d.status != 'completed':
            d.status, d.error = 'queued', ''
            self.db.save(d)
            self.signals.changed.emit()
            self.pump()

    def cancel(self, id, delete=False):
        if id in self.running:
            self.running[id][0].cancel(delete)
        else:
            d = self.db.get(id)
            if d.status == 'completed':
                return
            if delete:
                cleanup(d)
                self.db.clear_chunks(id)
                self.snapshots.pop(id, None)
            d.status = 'cancelled'
            self.db.save(d)
        self.signals.changed.emit()

    def prioritize(self, id):
        d = self.db.get(id)
        d.priority = max([x.priority for x in self.db.downloads()], default=0)+1
        self.db.save(d)
        self.signals.changed.emit()

    def pause_all(self):
        for d in self.db.downloads():
            if d.status in ('queued', 'downloading', 'verifying', 'assembling'):
                self.pause(d.id)

    def resume_all(self):
        for d in self.db.downloads():
            if d.status in ('paused', 'interrupted'):
                self.resume(d.id)

    def restart(self, id, remote, checksum=''):
        if id in self.running:
            raise ValueError("Wait for active requests to stop first")
        d = self.db.get(id)
        if d.status == 'completed':
            raise ValueError("Completed files cannot be restarted in place")
        cleanup(d)
        self.db.clear_chunks(id)
        self.snapshots.pop(id, None)
        d.size, d.ranges, d.etag, d.modified = remote.size, remote.ranges, remote.etag, remote.modified
        d.sha256 = d.error = ''
        d.expected_sha256 = validate_checksum(checksum)
        d.status = 'paused'
        self.db.save(d)
        self.db.vault.put(id+':resolved', remote.url)
        self.resume(id)

    def shutdown(self):
        self.closing = True
        self.pause_all()

    def idle(self):
        return not self.running and all(f.done() for f in self.inspections)

    def dispose(self):
        self.timer.stop()
        self.pool.shutdown(wait=True)
        self.inspect_pool.shutdown(wait=True)
