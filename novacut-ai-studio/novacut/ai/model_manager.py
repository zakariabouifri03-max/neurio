"""Optional local-AI model registry and explicit, cancellable downloads.

No model is ever downloaded silently. Every download is triggered by the user
in the Model Manager dialog, preceded by a free-space check, and reports
progress. Models live under the per-user application data directory.
"""
from __future__ import annotations

import os
import shutil
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from ..core import paths
from ..core.logging_setup import get_logger

log = get_logger("model-manager")


@dataclass
class ModelSpec:
    id: str
    label: str
    kind: str                      # whisper | rembg | demucs
    filename: str
    url: str
    size_bytes: int
    license: str
    note: str = ""
    sha256: str = ""

    @property
    def target(self) -> Path:
        return paths.MODELS_DIR / self.kind / self.filename


# Sizes are approximate (used for disk-space warnings and UI badges).
MODEL_REGISTRY: list[ModelSpec] = [
    ModelSpec(
        "whisper-tiny", "Whisper tiny (≈39 MB, EN/multilingual, fastest)",
        "whisper", "faster-whisper-tiny.bin",
        "https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/model.bin",
        39_000_000, "MIT (model: MIT)",
        "Good for drafts and fast CPUs; lowest accuracy."),
    ModelSpec(
        "whisper-base", "Whisper base (≈145 MB, balanced)",
        "whisper", "faster-whisper-base.bin",
        "https://huggingface.co/Systran/faster-whisper-base/resolve/main/model.bin",
        145_000_000, "MIT", "Recommended starting point for most projects."),
    ModelSpec(
        "whisper-small", "Whisper small (≈480 MB, accurate)",
        "whisper", "faster-whisper-small.bin",
        "https://huggingface.co/Systran/faster-whisper-small/resolve/main/model.bin",
        480_000_000, "MIT", "Notably better on accents; needs ~2 GB RAM."),
    ModelSpec(
        "whisper-medium", "Whisper medium (≈1.5 GB, high accuracy)",
        "whisper", "faster-whisper-medium.bin",
        "https://huggingface.co/Systran/faster-whisper-medium/resolve/main/model.bin",
        1_500_000_000, "MIT", "Best used on machines with 8+ GB RAM."),
    ModelSpec(
        "rembg-u2net", "U2Net segmentation (≈176 MB, background removal)",
        "rembg", "u2net.onnx",
        "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
        176_000_000, "Apache-2.0 (model: non-commercial notice, see docs)",
        "General-purpose salient-object segmentation."),
    ModelSpec(
        "demucs-hybrid", "Demucs hybrid transformer (≈80 MB per split model)",
        "demucs", "htdemucs.yaml",
        "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th",
        330_000_000, "MIT (Demucs); model weights under research license",
        "Downloaded on first run by the Demucs engine itself."),
]


def specs(kind: Optional[str] = None) -> list[ModelSpec]:
    return [m for m in MODEL_REGISTRY if kind is None or m.kind == kind]


def spec(model_id: str) -> Optional[ModelSpec]:
    return next((m for m in MODEL_REGISTRY if m.id == model_id), None)


def installed(spec_obj: ModelSpec) -> bool:
    p = spec_obj.target
    return p.exists() and p.stat().st_size > 1024


def free_space_for(spec_obj: ModelSpec) -> tuple[bool, int, int]:
    free = shutil.disk_usage(str(paths.MODELS_DIR)).free
    needed = int(spec_obj.size_bytes * 1.1)
    return free >= needed, free, needed


def install_model(model_id: str,
                  progress: Optional[Callable[[float, str], None]] = None,
                  should_cancel: Optional[Callable[[], bool]] = None) -> Path:
    """Download a model. Explicit user action only - never call automatically."""
    model = spec(model_id)
    if model is None:
        raise KeyError(f"Unknown model {model_id}")
    ok, free, needed = free_space_for(model)
    if not ok:
        raise RuntimeError(
            f"Not enough disk space: need ~{needed // 1_000_000} MB, "
            f"{free // 1_000_000} MB free.")
    target = model.target
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    log.info("Downloading model %s from %s", model.id, model.url)
    req = urllib.request.Request(model.url, headers={"User-Agent": "NovaCut-AI-Studio"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length", model.size_bytes))
        got = 0
        with open(tmp, "wb") as f:
            while True:
                if should_cancel and should_cancel():
                    f.close()
                    tmp.unlink(missing_ok=True)
                    raise RuntimeError("Download cancelled")
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if progress:
                    progress(min(1.0, got / max(1, total)),
                             f"{got // 1_000_000}/{max(1, total) // 1_000_000} MB")
    os.replace(tmp, target)
    log.info("Model installed: %s (%d bytes)", target, target.stat().st_size)
    if progress:
        progress(1.0, "Done")
    return target


def remove_model(model_id: str) -> bool:
    model = spec(model_id)
    if model and model.target.exists():
        model.target.unlink()
        return True
    return False


def dependency_report() -> dict[str, bool]:
    import importlib.util
    return {
        "faster_whisper": importlib.util.find_spec("faster_whisper") is not None,
        "whisper": importlib.util.find_spec("whisper") is not None,
        "rembg": importlib.util.find_spec("rembg") is not None,
        "onnxruntime": importlib.util.find_spec("onnxruntime") is not None,
        "demucs": importlib.util.find_spec("demucs") is not None,
        "torch": importlib.util.find_spec("torch") is not None,
        "cv2": importlib.util.find_spec("cv2") is not None,
        "numpy": importlib.util.find_spec("numpy") is not None,
    }


def models_root() -> Path:
    paths.ensure_dirs()
    return paths.MODELS_DIR
