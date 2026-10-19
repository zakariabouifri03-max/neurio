"""Local AI tools: real analyses plus honest unavailable/missing-model states."""
import http.server
import json
import subprocess
import threading
from functools import partial
from pathlib import Path

import pytest

from novacut.ai import model_manager
from novacut.ai.assistant import LocalAssistant, AssistantMessage
from novacut.ai.audio_cleanup import AudioCleanup
from novacut.ai.background import BackgroundRemover
from novacut.ai.reframe import SmartReframe
from novacut.ai.scenes import SceneDetector
from novacut.ai.separation import AudioSeparator
from novacut.ai.silence import SilenceDetector
from novacut.ai.subtitles import (SubtitleEngine, SubtitleSegment, SubtitleStyle,
                                 write_srt, write_vtt, write_ass)
from novacut.core.commands import UndoStack
from novacut.models.enums import ClipKind
from novacut.models.timeline import Clip, Timeline


# --------------------------------------------------------------------- silence
def _make_gapped_audio(ffmpeg_exe, out: Path) -> Path:
    cmd = [
        str(ffmpeg_exe), "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-filter_complex",
        "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
        "-map", "[out]", str(out),
    ]
    subprocess.run(cmd, check=True)
    return out


def test_silence_detection_real(ffmpeg_exe, tmp_path):
    wav = _make_gapped_audio(ffmpeg_exe, tmp_path / "gapped.wav")
    detector = SilenceDetector()
    assert detector.check().available
    intervals = detector.detect(str(wav), threshold_db=-35, min_duration=0.4)
    assert len(intervals) == 1
    iv = intervals[0]
    assert 0.8 < iv.start < 1.3 and 1.8 < iv.end < 2.3


def test_silence_cut_macro_undo_redo(ffmpeg_exe, tmp_path):
    wav = _make_gapped_audio(ffmpeg_exe, tmp_path / "gapped2.wav")
    tl = Timeline.new_default()
    track = tl.audio_tracks()[0]
    clip = Clip(kind=ClipKind.AUDIO.value, start=0.0, duration=3.0,
                source_in=0.0, source_duration=3.0)
    tl.add_clip(clip, track.id)
    before = tl.duration()
    macro = SilenceDetector().cut_commands(
        tl, clip.id, [type("I", (), {"start": 1.0, "end": 2.0})()])
    stack = UndoStack()
    stack.push(macro)
    assert tl.duration() == pytest.approx(before - 1.0, abs=0.05)
    stack.undo()
    assert tl.duration() == pytest.approx(before, abs=0.05)


# ----------------------------------------------------------------------- scenes
def test_scene_detection_real(ffmpeg_exe, tmp_path):
    out = tmp_path / "scenes.mp4"
    cmd = [
        str(ffmpeg_exe), "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
        "-f", "lavfi", "-i", "color=c=green:s=320x240:d=1",
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
        "-map", "[v]", "-pix_fmt", "yuv420p", str(out),
    ]
    subprocess.run(cmd, check=True)
    detector = SceneDetector()
    assert detector.check().available
    boundaries = detector.detect(str(out), threshold=0.25, sample_fps=4.0)
    assert len(boundaries) >= 2
    tl = Timeline.new_default()
    markers = detector.apply_as_markers(tl, boundaries)
    assert len(markers) == len(boundaries)


# --------------------------------------------------------------------- reframe
def test_smart_reframe_suggestions(ffmpeg_exe, media_factory):
    video = media_factory("motion.mp4", duration=3.0, size="320x180")
    tool = SmartReframe()
    status = tool.check()
    assert status.available and "not perfect" in status.resource_note.lower()
    kfs = tool.track(str(video), sample_fps=3.0, width=160, height=90)
    assert len(kfs) >= 5
    times = [k.time for k in kfs]
    assert times == sorted(times)
    assert all(0.0 <= k.center_x <= 1.0 and 0.0 <= k.center_y <= 1.0 for k in kfs)


# ------------------------------------------------------------- audio cleanup
def test_audio_cleanup_and_preview(ffmpeg_exe, tmp_path):
    wav = tmp_path / "voice.wav"
    subprocess.run([str(ffmpeg_exe), "-y", "-loglevel", "error",
                    "-f", "lavfi", "-i", "sine=frequency=300:duration=2",
                    str(wav)], check=True)
    tool = AudioCleanup()
    assert tool.check().available
    out = tool.process(str(wav), str(tmp_path / "clean.wav"), intensity=0.7)
    assert Path(out).exists() and Path(out).stat().st_size > 1000
    orig, processed = tool.preview_pair(str(wav), intensity=0.4, seconds=1.0)
    assert Path(orig).exists() and Path(processed).exists()


# ------------------------------------------------------------------ subtitles
def test_subtitle_writers(tmp_path):
    segs = [SubtitleSegment(0.0, 1.25, "Hello world"),
            SubtitleSegment(1.5, 3.0, "Second line")]
    srt = write_srt(segs, str(tmp_path / "s.srt"))
    text = Path(srt).read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:01,250" in text and "Hello world" in text
    vtt = write_vtt(segs, str(tmp_path / "s.vtt"))
    assert "WEBVTT" in Path(vtt).read_text()
    ass = write_ass(segs, str(tmp_path / "s.ass"), SubtitleStyle(font_size=52),
                    1080, 1920)
    ass_text = Path(ass).read_text(encoding="utf-8")
    assert "[V4+ Styles]" in ass_text and "Dialogue:" in ass_text


def test_subtitle_engine_unavailable_without_whisper():
    engine = SubtitleEngine()
    status = engine.check()
    # faster-whisper/openai-whisper are intentionally not installed in CI.
    if not (engine.module_available("faster_whisper")
            or engine.module_available("whisper")):
        assert not status.available
        with pytest.raises(RuntimeError):
            engine.transcribe("whatever.mp4")
    else:
        assert status.available


def test_subtitle_bad_export_ext(tmp_path):
    with pytest.raises(ValueError):
        SubtitleEngine().export([], str(tmp_path / "x.txt"))


# ------------------------------------------------------- background / separation
def test_optional_models_have_honest_unavailable_state():
    bg = BackgroundRemover()
    status = bg.check()
    assert isinstance(status.available, bool)
    if not status.available:
        assert status.reason
    sep = AudioSeparator()
    status = sep.check()
    assert isinstance(status.available, bool)
    if not status.available:
        assert "demucs" in status.reason.lower()


# ------------------------------------------------------------------- assistant
class _OllamaHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/api/tags":
            body = json.dumps({"models": [{"name": "llama3.2:3b"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(
            {"message": {"role": "assistant",
                         "content": "Suggestion: split at 2s (not applied)."}}).encode())


@pytest.fixture
def ollama_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _OllamaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_assistant_local_server(ollama_server):
    assistant = LocalAssistant(host=ollama_server, model="llama3.2:3b")
    assert assistant.check().available
    reply = assistant.chat([AssistantMessage("user", "How do I cut a clip?")])
    assert "Suggestion" in reply


def test_assistant_rejects_remote_host():
    assistant = LocalAssistant(host="https://api.example.com", model="x")
    assert not assistant.check().available
    with pytest.raises(PermissionError):
        assistant.chat([AssistantMessage("user", "hi")])


# --------------------------------------------------------------- model manager
def test_model_manager_install_and_cancel(tmp_path, monkeypatch):
    payload = b"fake-model-bytes" * 100
    src = tmp_path / "model.bin"
    src.write_bytes(payload)
    spec = model_manager.spec("whisper-tiny")
    monkeypatch.setattr(spec, "url", src.as_uri())
    monkeypatch.setattr(spec, "size_bytes", len(payload))
    seen = []
    target = model_manager.install_model(
        "whisper-tiny", progress=lambda f, m: seen.append(f))
    assert target.exists() and target.read_bytes() == payload
    assert seen[-1] == 1.0
    assert model_manager.installed(spec)
    assert model_manager.remove_model("whisper-tiny")

    # Cancellation must leave no partial file.
    monkeypatch.setattr(spec, "url", src.as_uri())
    with pytest.raises(RuntimeError):
        model_manager.install_model("whisper-tiny", should_cancel=lambda: True)
    assert not spec.target.exists()


def test_model_manager_disk_space_guard(monkeypatch):
    spec = model_manager.spec("whisper-base")
    monkeypatch.setattr(spec, "size_bytes", 10 ** 15)
    ok, free, needed = model_manager.free_space_for(spec)
    assert not ok and needed > free


def test_dependency_report_keys():
    report = model_manager.dependency_report()
    assert {"cv2", "numpy", "faster_whisper", "rembg", "demucs"} <= set(report)
