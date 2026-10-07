"""Audio tracks for the animation timeline."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .keyframe import Track, new_id


@dataclass
class AudioTrack:
    name: str = "Audio"
    asset_id: str = ""
    start_frame: int = 1          # position on the timeline
    trim_start: float = 0.0       # seconds trimmed from the source head
    duration: float = 0.0         # seconds (0 = full asset)
    volume: float = 100.0         # %
    muted: bool = False
    solo: bool = False
    pan: float = 0.0              # -100 (L) .. +100 (R)
    fade_in: int = 0              # frames
    fade_out: int = 0             # frames
    uid: str = field(default_factory=lambda: new_id("aud"))
    loop: bool = False
    volume_track: Track = field(default_factory=lambda: Track("volume", 100.0, unit="%"))

    # cached analysis
    waveform: list[float] = field(default_factory=list)
    sample_rate: int = 44100
    channels: int = 2
    _frames: int = 0

    # ------------------------------------------------------------------ util
    def frames(self, fps: int) -> int:
        if self.duration > 0:
            return max(1, int(round(self.duration * fps)))
        if self._frames:
            return self._frames
        return 0

    def end_frame(self, fps: int) -> int:
        return self.start_frame + max(0, self.frames(fps))

    def set_frames(self, frames: int) -> None:
        self._frames = int(frames)

    def trim_to(self, frames: int, fps: int | None = None) -> None:
        """Trim the clip so it stops after ``frames`` timeline frames."""
        frames = max(1, int(frames))
        self._frames = frames
        if fps and fps > 0:
            self.duration = frames / float(fps)

    def trim_from(self, seconds: float) -> None:
        """Skip ``seconds`` from the head of the source audio."""
        self.trim_start = max(0.0, float(seconds))

    def clear_trim(self) -> None:
        self.trim_start = 0.0
        self.duration = 0.0

    def gain_at(self, frame: float, fps: int) -> float:
        """Linear gain 0..1 including fades and volume automation."""
        if self.muted:
            return 0.0
        base = self.volume_track.value_at(frame) if self.volume_track.keys else self.volume
        gain = max(0.0, base) / 100.0
        rel = frame - self.start_frame
        total = max(1, self.frames(fps))
        if self.fade_in > 0 and rel < self.fade_in:
            gain *= max(0.0, rel / self.fade_in)
        if self.fade_out > 0 and rel > total - self.fade_out:
            gain *= max(0.0, (total - rel) / self.fade_out)
        return max(0.0, min(4.0, gain))

    def key_frames(self) -> set[int]:
        return set(self.volume_track.frames())

    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name, "asset_id": self.asset_id,
            "start_frame": self.start_frame, "trim_start": self.trim_start,
            "duration": self.duration, "volume": self.volume, "muted": self.muted,
            "solo": self.solo, "pan": self.pan, "fade_in": self.fade_in,
            "fade_out": self.fade_out, "loop": self.loop,
            "volume_track": self.volume_track.to_dict(),
            "waveform": self.waveform, "sample_rate": self.sample_rate,
            "channels": self.channels, "frames": self._frames,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AudioTrack":
        t = cls(
            name=d.get("name", "Audio"), asset_id=d.get("asset_id", ""),
            start_frame=int(d.get("start_frame", 1)), trim_start=float(d.get("trim_start", 0.0)),
            duration=float(d.get("duration", 0.0)), volume=float(d.get("volume", 100.0)),
            muted=bool(d.get("muted", False)), solo=bool(d.get("solo", False)),
            pan=float(d.get("pan", 0.0)), fade_in=int(d.get("fade_in", 0)),
            fade_out=int(d.get("fade_out", 0)), loop=bool(d.get("loop", False)),
        )
        t.uid = d.get("uid") or t.uid
        if d.get("volume_track"):
            t.volume_track = Track.from_dict(d["volume_track"])
        t.waveform = [float(x) for x in d.get("waveform", [])]
        t.sample_rate = int(d.get("sample_rate", 44100))
        t.channels = int(d.get("channels", 2))
        t._frames = int(d.get("frames", 0))
        return t

    def clone(self) -> "AudioTrack":
        t = AudioTrack.from_dict(self.to_dict())
        t.uid = new_id("aud")
        return t


def compute_waveform(samples, buckets: int = 2000) -> list[float]:
    """Down-sample raw mono float samples into peak buckets (0..1)."""
    n = len(samples)
    if n == 0 or buckets <= 0:
        return []
    step = max(1, n // buckets)
    out: list[float] = []
    peak = 1e-6
    for i in range(0, n, step):
        chunk = samples[i:i + step]
        try:
            m = max(abs(float(x)) for x in chunk)
        except TypeError:
            m = max(abs(x) for x in chunk)
        peak = max(peak, m)
        out.append(m)
    if peak > 0:
        out = [min(1.0, v / peak) for v in out]
    return out


def rms_energy(samples, window: int = 512, hop: int = 256) -> list[float]:
    out: list[float] = []
    n = len(samples)
    i = 0
    while i + window <= n:
        s = 0.0
        for j in range(i, i + window):
            v = float(samples[j])
            s += v * v
        out.append(math.sqrt(s / window))
        i += hop
    return out
