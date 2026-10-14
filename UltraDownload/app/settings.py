import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path


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
    connect_timeout: float = 15.0
    read_timeout: float = 30.0
    retries: int = 4
    retry_delay: float = 1.0
    global_bandwidth: int = 0
    file_bandwidth: int = 0
    cleanup_completed: bool = True
    theme: str = "Midnight"

    def validate(self):
        if not 1 <= self.connections <= 10:
            raise ValueError("Connections must be between 1 and 10")
        if (
            not 1 <= self.simultaneous_files <= 16
            or not 1 <= self.global_connections <= 160
        ):
            raise ValueError("Invalid file or global connection limit")
        if self.connect_timeout <= 0 or self.read_timeout <= 0 or self.retry_delay < 0:
            raise ValueError(
                "Timeouts must be positive; retry delay cannot be negative"
            )
        if (
            not 0 <= self.retries <= 20
            or min(self.global_bandwidth, self.file_bandwidth) < 0
        ):
            raise ValueError("Invalid retry or bandwidth limit")
        return self

    @classmethod
    def load(cls, path: Path):
        if not path.exists():
            return cls()
        return cls(**json.loads(path.read_text(encoding="utf-8"))).validate()

    def save(self, path: Path):
        self.validate()
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        os.replace(tmp, path)
