"""Test configuration: make the src/ layout importable and force offscreen Qt."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture(scope="session")
def ffmpeg_path():
    from adzak.core.ffmpeg import find_ffmpeg
    path = find_ffmpeg()
    if not path:
        pytest.skip("ffmpeg not available in this environment")
    return path


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory, ffmpeg_path):
    """A real 2-second 320×240 H.264 test video with a sine-wave audio track."""
    out = tmp_path_factory.mktemp("media") / "sample.mp4"
    import subprocess
    subprocess.run([
        ffmpeg_path, "-hide_banner", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(out),
    ], check=True, capture_output=True)
    return out


@pytest.fixture(scope="session")
def silent_video(tmp_path_factory, ffmpeg_path):
    """A 3-second video: 1 s tone, 1 s silence, 1 s tone (for silence tests)."""
    out = tmp_path_factory.mktemp("media") / "silent.mp4"
    import subprocess
    subprocess.run([
        ffmpeg_path, "-hide_banner", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=15:d=3",
        "-f", "lavfi", "-i",
        "sine=frequency=440:duration=1[a];anullsrc=d=1[b];sine=frequency=660:duration=1[c];[a][b][c]concat=n=3:v=0:a=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(out),
    ], check=True, capture_output=True)
    return out


@pytest.fixture(scope="session")
def sample_image(tmp_path_factory):
    from PIL import Image
    out = tmp_path_factory.mktemp("img") / "sample.png"
    img = Image.new("RGB", (220, 140), (200, 40, 40))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    d.rectangle([60, 30, 160, 110], fill=(30, 60, 200))
    img.save(out)
    return out


@pytest.fixture()
def tmp_home(tmp_path, monkeypatch):
    """Redirect ADZAK's data directory into a temp folder."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path
