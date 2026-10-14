"""SQLite metadata. URLs live in the OS credential store, never in this database."""
from pathlib import Path
import json
import sqlite3
import threading
import time
from .models import Download


class URLVault:
    """Explicit secure OS backend: never falls back to a plaintext keyring."""
    def __init__(self):
        import sys
        if sys.platform == "win32":
            from keyring.backends.Windows import WinVaultKeyring
            self.backend = WinVaultKeyring()
        elif sys.platform == "darwin":
            from keyring.backends.macOS import Keyring
            self.backend = Keyring()
        else:
            from keyring.backends.SecretService import Keyring
            self.backend = Keyring()

    def put(self, key, value):
        self.backend.set_password("UltraDownload", key, value)

    def get(self, key):
        value = self.backend.get_password("UltraDownload", key)
        if value is None:
            raise ValueError("URL missing from OS credential store; add this download again")
        return value


class Database:
    def __init__(self, path, vault=None):
        self.vault = vault if vault is not None else URLVault()
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.conn:
            self.conn.executescript('''
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS downloads (
                    id TEXT PRIMARY KEY, destination TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS chunks (
                    download_id TEXT NOT NULL, idx INTEGER NOT NULL, status TEXT NOT NULL,
                    bytes INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
                    digest TEXT NOT NULL DEFAULT '', PRIMARY KEY(download_id, idx));
            ''')

    def add(self, download, original_url, resolved_url):
        self.vault.put(download.id + ":original", original_url)
        self.vault.put(download.id + ":resolved", resolved_url)
        with self.lock, self.conn:
            self.conn.execute("INSERT INTO downloads VALUES (?,?,?)",
                              (download.id, download.destination, json.dumps(download.as_dict())))

    def urls(self, id):
        return self.vault.get(id + ":original"), self.vault.get(id + ":resolved")

    def save(self, download):
        download.updated = time.time()
        with self.lock, self.conn:
            self.conn.execute("UPDATE downloads SET data=? WHERE id=?",
                              (json.dumps(download.as_dict()), download.id))

    def get(self, id):
        with self.lock:
            row = self.conn.execute("SELECT data FROM downloads WHERE id=?", (id,)).fetchone()
        if row is None:
            raise KeyError(id)
        return Download(**json.loads(row[0]))

    def downloads(self):
        with self.lock:
            rows = self.conn.execute("SELECT data FROM downloads ORDER BY rowid").fetchall()
        return [Download(**json.loads(row[0])) for row in rows]

    def chunk(self, id, index, status, size, retries=0, digest=""):
        with self.lock, self.conn:
            self.conn.execute("INSERT OR REPLACE INTO chunks VALUES (?,?,?,?,?,?)",
                              (id, index, status, size, retries, digest))

    def chunks(self, id, start=0, limit=None):
        with self.lock:
            return [dict(r) for r in self.conn.execute(
                "SELECT * FROM chunks WHERE download_id=? AND idx>=? ORDER BY idx LIMIT ?",
                (id, start, -1 if limit is None else limit)).fetchall()]

    def clear_chunks(self, id):
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM chunks WHERE download_id=?", (id,))

    def recover(self):
        for d in self.downloads():
            if d.status in ("downloading", "verifying", "assembling", "pausing", "queued"):
                d.status = "interrupted"
                d.error = "Interrupted session. Resume will validate the remote file and local chunks."
                self.save(d)

    def close(self):
        with self.lock:
            self.conn.close()
