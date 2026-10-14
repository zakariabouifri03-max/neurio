from dataclasses import dataclass, asdict, fields
from pathlib import Path
import json
import os


def data_directory() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share"))
    path = base / "UltraDownload"
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Settings:
    directory: str = str(Path.home() / "Downloads")
    connections: int = 10
    simultaneous_files: int = 2
    global_connections: int = 20
    connect_timeout: float = 15
    read_timeout: float = 30
    retries: int = 4
    retry_delay: float = 1
    global_bandwidth: int = 0
    per_download_bandwidth: int = 0
    cleanup_completed: bool = True
    theme: str = "Midnight"

    def validate(self):
        if not 1 <= self.connections <= 10:
            raise ValueError("Connections must be between 1 and 10")
        if not 1 <= self.simultaneous_files <= 10 or not 1 <= self.global_connections <= 100:
            raise ValueError("Invalid global concurrency limits")
        if self.connect_timeout <= 0 or self.read_timeout <= 0:
            raise ValueError("Timeouts must be positive")
        if not 0 <= self.retries <= 20 or not 0 <= self.retry_delay <= 300:
            raise ValueError("Invalid retry policy")
        if self.global_bandwidth < 0 or self.per_download_bandwidth < 0:
            raise ValueError("Bandwidth limits cannot be negative")

    @classmethod
    def load(cls, path):
        if not path.exists():
            return cls()
        obj = cls(**{k: v for k, v in json.loads(path.read_text()).items() if k in {f.name for f in fields(cls)}})
        obj.validate()
        return obj

    def save(self, path):
        self.validate()
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        os.replace(tmp, path)
