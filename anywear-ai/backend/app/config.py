"""Environment-driven configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # monorepo root


@dataclass
class Settings:
    app_name: str = "Anywear AI Backend"
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", BASE_DIR / "backend" / "data")))

    # Security
    api_key: str = field(default_factory=lambda: os.getenv("API_KEY", ""))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "12")))
    max_person_mb: int = field(default_factory=lambda: int(os.getenv("MAX_PERSON_MB", "8")))
    max_garment_mb: int = field(default_factory=lambda: int(os.getenv("MAX_GARMENT_MB", "8")))
    allowed_formats: tuple = ("image/jpeg", "image/png", "image/webp")

    # CORS: comma-separated origins. Defaults to dev-friendly local origins.
    cors_origins: list = field(
        default_factory=lambda: [
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173",
            ).split(",")
            if o.strip()
        ]
    )

    # Request limits
    rate_limit_rpm: int = field(default_factory=lambda: int(os.getenv("RATE_LIMIT_RPM", "30")))
    job_timeout_s: int = field(default_factory=lambda: int(os.getenv("JOB_TIMEOUT_S", "120")))

    # AI provider (see ai-engine docs)
    ai_provider: str = field(default_factory=lambda: os.getenv("AI_PROVIDER", "dev-composite"))
    ai_engine_url: str = field(default_factory=lambda: os.getenv("AI_ENGINE_URL", ""))
    ai_engine_api_key: str = field(default_factory=lambda: os.getenv("AI_ENGINE_API_KEY", ""))

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def results_dir(self) -> Path:
        return self.data_dir / "results"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "anywear.db"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.results_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
