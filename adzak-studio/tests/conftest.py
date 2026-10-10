import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _ffmpeg_exe() -> str:
    from adzak.core.ffmpeg import find_ffmpeg
    return find_ffmpeg()


@pytest.fixture(scope="session")
def media(tmp_path_factory):
    """Generated test media: a 6 s video with a tone, a 4 s green-screen clip, a silent-gap WAV, a still PNG."""
    d = tmp_path_factory.mktemp("media")
    ff = _ffmpeg_exe()

    def run(args):
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

    a = d / "a.mp4"
    run(["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
         "-t", "6", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(a)])
    b = d / "green.mp4"
    run(["-f", "lavfi", "-i", "color=c=0x00ff00:s=320x240:r=30:d=4", "-t", "4", "-c:v", "libx264", str(b)])
    w = d / "gaps.wav"
    # 1 s tone, 1.5 s silence, 1 s tone (16 kHz mono PCM)
    import wave
    import numpy as np
    sr = 16000
    t = np.arange(sr) / sr
    tone = (0.5 * np.sin(2 * np.pi * 300 * t) * 32767).astype("<i2")
    audio = np.concatenate([tone, np.zeros(int(1.5 * sr), "<i2"), tone])
    with wave.open(str(w), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio.tobytes())
    p = d / "still.png"
    from PIL import Image
    im = Image.new("RGB", (400, 300), (30, 120, 200))
    im.save(p)
    return {"video": a, "green": b, "wav": w, "png": p, "dir": d}


@pytest.fixture(autouse=True)
def tmp_data_dir(tmp_path, monkeypatch):
    """Isolate per-user data (DB, autosave, temp, logs) into a temp folder for every test."""
    d = tmp_path / "appdata"
    monkeypatch.setenv("ADZAK_DATA_DIR", str(d))
    return d
