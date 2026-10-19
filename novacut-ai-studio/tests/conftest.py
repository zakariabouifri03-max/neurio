"""Pytest fixtures: isolated app dirs, headless Qt, real FFmpeg, test media."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Headless Qt: the sandbox lacks system GL/dbus libraries. A stub lib dir may
# be provided via NOVACUT_STUB_LIB; on a normal desktop this is simply unused.
stub = os.environ.get("NOVACUT_STUB_LIB")
if stub and os.path.isdir(stub):
    existing = os.environ.get("LD_LIBRARY_PATH", "")
    if stub not in existing.split(os.pathsep):
        os.environ["LD_LIBRARY_PATH"] = os.pathsep.join(
            p for p in (stub, existing) if p)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from novacut.core import paths  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_app_dirs(tmp_path):
    paths.override_root(tmp_path / "appdata")
    yield tmp_path


@pytest.fixture(scope="session")
def qapp():
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication(["novacut-test"])
    yield app


@pytest.fixture(scope="session")
def ffmpeg_exe():
    from novacut.core.ffmpeg import find_ffmpeg
    exe = find_ffmpeg()
    if exe is None:
        pytest.skip("FFmpeg not available")
    return exe


@pytest.fixture(scope="session")
def ffprobe_exe():
    from novacut.core.ffmpeg import find_ffprobe
    return find_ffprobe()  # may be None; tests must handle gracefully


@pytest.fixture(scope="session")
def media_factory(tmp_path_factory):
    """Generate small, legal, synthetic test media with the bundled FFmpeg."""
    from novacut.core.ffmpeg import find_ffmpeg
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        pytest.skip("FFmpeg not available")
    base = tmp_path_factory.mktemp("media")

    def _run(args):
        import subprocess
        proc = subprocess.run([str(ffmpeg), "-y", "-hide_banner", "-loglevel",
                               "error", *args], capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr

    def make(name: str, kind: str = "video", duration: float = 4.0,
             size: str = "640x360", rate: int = 30) -> Path:
        out = base / name
        if kind == "video":
            _run(["-f", "lavfi", "-i",
                  f"testsrc2=size={size}:rate={rate}:duration={duration}",
                  "-f", "lavfi", "-i",
                  f"sine=frequency=440:duration={duration}",
                  "-c:v", "libx264", "-pix_fmt", "yuv420p",
                  "-c:a", "aac", "-shortest", str(out)])
        elif kind == "silent_video":
            _run(["-f", "lavfi", "-i",
                  f"testsrc2=size={size}:rate={rate}:duration={duration}",
                  "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)])
        elif kind == "audio":
            _run(["-f", "lavfi", "-i",
                  f"sine=frequency=330:duration={duration}",
                  "-c:a", "pcm_s16le", str(out)])
        elif kind == "image":
            _run(["-f", "lavfi", "-i", "color=c=red:size=320x240",
                  "-frames:v", "1", str(out)])
        return out

    return make
