"""Push-mode PCM audio feed: FFmpeg stdout -> QAudioSink."""
from __future__ import annotations

import subprocess
import threading
from typing import Optional

from PySide6.QtCore import QObject, QThread, Signal

from ..core.ffmpeg import find_ffmpeg
from ..core.logging_setup import get_logger

log = get_logger("audio-feed")


class _PcmReader(QThread):
    failed = Signal(str)

    def __init__(self, proc, sink_io, sink, chunk=8192, parent=None):
        super().__init__(parent)
        self._proc, self._io, self._sink = proc, sink_io, sink
        self._chunk = chunk
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        assert self._proc.stdout is not None
        try:
            while not self._stop:
                data = self._proc.stdout.read(self._chunk)
                if not data:
                    break
                # Simple backpressure so we don't buffer minutes of audio.
                waited = 0
                while not self._stop and self._sink.bytesInUs() > 300_000 and waited < 100:
                    self.msleep(20)
                    waited += 1
                if self._stop:
                    break
                self._io.write(data)
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(str(exc))


class AudioFeed(QObject):
    """Best-effort audio preview; failures degrade gracefully to silence."""

    def __init__(self, project, input_args: list[str], script_path: str,
                 start_at: float = 0.0, parent=None):
        super().__init__(parent)
        self._project = project
        self._input_args = input_args
        self._script_path = script_path
        self._start_at = start_at
        self._proc: Optional[subprocess.Popen] = None
        self._reader: Optional[_PcmReader] = None
        self._sink = None
        self._io = None

    def start(self) -> None:
        try:
            from PySide6.QtMultimedia import QAudioFormat, QAudioSink
            from PySide6.QtCore import QAudioDevice
        except Exception as exc:  # noqa: BLE001
            log.warning("Qt Multimedia unavailable: %s", exc)
            return
        fmt = QAudioFormat()
        fmt.setSampleRate(self._project.settings.sample_rate)
        fmt.setChannelCount(min(2, self._project.settings.audio_channels))
        fmt.setSampleFormat(QAudioFormat.SampleFormat.Int16)
        try:
            self._sink = QAudioSink(fmt, self)
        except Exception as exc:  # noqa: BLE001 - no audio backend
            log.warning("Could not create audio sink: %s", exc)
            return
        self._io = self._sink.start()
        if self._io is None:
            log.warning("QAudioSink.start() returned no device")
            return

        ffmpeg = find_ffmpeg()
        if ffmpeg is None:
            return
        # Locate the final audio label in the filter script.
        script = open(self._script_path, "r", encoding="utf-8").read()
        import re
        m = re.findall(r"\[(aout_\d+)\]", script)
        if not m:
            log.warning("No audio output label in preview graph.")
            return
        cmd = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin"]
        cmd += self._input_args
        cmd += ["-filter_complex_script", self._script_path]
        if self._start_at > 0:
            cmd += ["-ss", f"{self._start_at:.3f}"]
        cmd += ["-map", "[" + m[-1] + "]", "-f", "s16le", "-acodec", "pcm_s16le",
                "-ar", str(self._project.settings.sample_rate),
                "-ac", str(fmt.channelCount()), "-"]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=creationflags)
        self._reader = _PcmReader(self._proc, self._io, self._sink)
        self._reader.start()

    def stop(self) -> None:
        if self._reader:
            self._reader.stop()
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=2)
            except Exception:  # noqa: BLE001
                try:
                    self._proc.kill()
                except Exception:
                    pass
        if self._reader:
            self._reader.wait(1500)
            self._reader = None
        if self._sink:
            self._sink.stop()
            self._sink = None
        self._io = None
