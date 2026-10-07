"""Audio playback + waveform analysis.

Uses QtMultimedia when it is available (the normal Windows build), and simply
stays silent otherwise - everything else in the app keeps working.
"""
from __future__ import annotations

import os
import tempfile

from PySide6.QtCore import QObject, QTimer, QUrl, Signal

from .media import decode_audio, have_ffmpeg, probe_duration

try:  # QtMultimedia ships with PySide6-Addons
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
    HAVE_MULTIMEDIA = True
except Exception:  # pragma: no cover
    QMediaPlayer = None  # type: ignore
    QAudioOutput = None  # type: ignore
    HAVE_MULTIMEDIA = False

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore


class AudioEngine(QObject):
    """Keeps the audio tracks of the active scene in sync with the timeline."""

    ready = Signal()
    error = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.scene = None
        self.project = None
        self.fps = 24
        self._players: list[tuple[object, object, object]] = []   # (track, player, output)
        self._enabled = HAVE_MULTIMEDIA
        self._volume = 1.0
        self._scratch: dict[str, str] = {}
        self._sync_timer = QTimer(self)
        self._sync_timer.setInterval(250)
        self._sync_timer.timeout.connect(self._periodic_sync)

    # ------------------------------------------------------------------ util
    @property
    def available(self) -> bool:
        return self._enabled

    def status(self) -> str:
        if self._enabled:
            return "Qt Multimedia ready"
        if not HAVE_MULTIMEDIA:
            return "Qt Multimedia not installed - audio preview disabled (export still works)"
        return "Audio disabled"

    def set_volume(self, value: float) -> None:
        """0..1 master volume for preview."""
        self._volume = max(0.0, min(1.0, value))
        for _t, _p, out in self._players:
            if out is not None:
                out.setVolume(self._volume)

    # ------------------------------------------------------------------ load
    def load_scene(self, project, scene, fps: int) -> None:
        self.stop()
        self.project = project
        self.scene = scene
        self.fps = max(1, fps)
        self._players.clear()
        if not self._enabled or scene is None or project is None:
            return
        for track in scene.audio_tracks:
            out = QAudioOutput()
            out.setVolume(self._volume * max(0.0, min(1.0, track.volume / 100.0)))
            player = QMediaPlayer()
            player.setAudioOutput(out)
            path = self._materialise(track)
            if not path:
                continue
            player.setSource(QUrl.fromLocalFile(path))
            self._players.append((track, player, out))
        self.ready.emit()

    def _materialise(self, track) -> str | None:
        """Write the track bytes to a temp file the media player can open."""
        asset = self.project.asset(track.asset_id) if self.project else None
        if asset is None:
            return None
        if asset.source_path and os.path.isfile(asset.source_path) and not asset.data:
            return asset.source_path
        if not asset.data:
            return None
        cached = self._scratch.get(track.asset_id)
        if cached and os.path.exists(cached):
            return cached
        suffix = asset.ext or ".wav"
        path = os.path.join(tempfile.gettempdir(), f"mfs_play_{asset.uid}{suffix}")
        try:
            with open(path, "wb") as fh:
                fh.write(asset.data)
        except Exception as exc:
            self.error.emit(str(exc))
            return None
        self._scratch[track.asset_id] = path
        return path

    # -------------------------------------------------------------- playback
    def play(self, frame: float) -> None:
        if not self._players:
            return
        self.sync(frame)
        for track, player, out in self._players:
            if self.scene is not None and self.scene.has_solo() and not track.solo:
                continue
            if out is not None:
                out.setVolume(self._volume * max(0.0, min(1.0, track.volume / 100.0)))
            player.play()
        self._sync_timer.start()

    def pause(self) -> None:
        for _t, player, _o in self._players:
            player.pause()
        self._sync_timer.stop()

    def stop(self) -> None:
        for _t, player, _o in self._players:
            player.stop()
        self._sync_timer.stop()

    def sync(self, frame: float) -> None:
        """Seek every player so it matches the timeline position."""
        if not self._players:
            return
        for track, player, _out in self._players:
            offset_frames = frame - track.start_frame
            seconds = offset_frames / max(1, self.fps) + track.trim_start
            if seconds < -0.05:
                player.stop()
                continue
            target = max(0.0, seconds)
            pos = int(target * 1000)
            if abs(player.position() - pos) > 90:
                player.setPosition(pos)

    def _periodic_sync(self) -> None:
        if self.scene is None:
            return
        # drift correction happens from the timeline side (player.frame)

    def close(self) -> None:
        self.stop()
        self._players.clear()


# --------------------------------------------------------------------------
# waveforms
# --------------------------------------------------------------------------
def waveform_for_asset(asset, buckets: int = 3000) -> dict:
    """Analyse an audio asset (peaks + duration) using the bundled ffmpeg."""
    out = {"peaks": [], "duration": 0.0, "rate": 22050}
    if asset is None or not asset.data or not have_ffmpeg():
        return out
    suffix = asset.ext or ".wav"
    path = os.path.join(tempfile.gettempdir(), f"mfs_wave_{asset.uid}{suffix}")
    if not os.path.exists(path):
        try:
            with open(path, "wb") as fh:
                fh.write(asset.data)
        except Exception:
            return out
    samples, rate = decode_audio(path, 22050)
    if samples is None or len(samples) == 0:
        out["duration"] = probe_duration(path)
        return out
    n = len(samples)
    out["duration"] = n / float(rate)
    out["rate"] = rate
    step = max(1, n // max(1, buckets))
    if np is not None:
        arr = np.asarray(samples)
        trimmed = arr[: (n // step) * step].reshape(-1, step)
        peaks = np.abs(trimmed).max(axis=1)
        peak = float(peaks.max()) if peaks.size else 1.0
        peaks = peaks / peak if peak > 0 else peaks
        out["peaks"] = [round(float(p), 4) for p in peaks]
    else:
        peaks = []
        peak = 1e-6
        for i in range(0, n - step, step):
            m = max(abs(float(x)) for x in samples[i:i + step])
            peak = max(peak, m)
            peaks.append(m)
        out["peaks"] = [round(min(1.0, p / peak), 4) for p in peaks]
    return out


def detect_speech_segments(samples, rate: int, threshold: float = 0.06,
                           min_silence: float = 0.08, hop: float = 0.01) -> list[tuple[float, float]]:
    """Very small energy based voice-activity detector (used by lip sync)."""
    if len(samples) == 0:
        return []
    hop_n = max(1, int(rate * hop))
    win_n = hop_n * 2
    rms: list[tuple[float, float]] = []
    i = 0
    while i + win_n < len(samples):
        chunk = samples[i:i + win_n]
        if np is not None:
            arr = np.asarray(chunk, dtype="float32")
            e = float((arr * arr).mean()) ** 0.5
        else:
            e = (sum(float(x) * float(x) for x in chunk) / len(chunk)) ** 0.5
        rms.append((i / float(rate), e))
        i += hop_n
    if not rms:
        return []
    peak = max(e for _t, e in rms) or 1.0
    segments: list[tuple[float, float]] = []
    start = None
    silence = 0.0
    for t, e in rms:
        if e / peak >= threshold:
            if start is None:
                start = t
            silence = 0.0
        elif start is not None:
            silence = t - start if silence == 0.0 else silence
            if t - _last_voiced(rms, t, threshold, peak) > min_silence:
                segments.append((start, t))
                start = None
    if start is not None:
        segments.append((start, rms[-1][0]))
    return segments


def _last_voiced(rms, t: float, threshold: float, peak: float) -> float:
    last = 0.0
    for ts, e in rms:
        if ts > t:
            break
        if e / peak >= threshold:
            last = ts
    return last
