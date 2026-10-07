"""Automatic lip sync.

The audio is analysed with a small formant tracker: for every 20 ms window we
estimate the fundamental spectral envelope, locate the first two formants and
map them onto the classic viseme chart (A E I O U M F L + Rest).  The resulting
cue list is editable and can be applied either to mouth bones of a rig or as a
mouth-layer animation using the generated mouth chart.
"""
from __future__ import annotations

import math
import os
import tempfile
from dataclasses import dataclass, field

from PySide6.QtCore import Qt

from ..engine.media import decode_audio, have_ffmpeg

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore

VISEME_LABELS = ["Rest", "A", "E", "I", "O", "U", "M", "F", "L"]

# jaw opening / corner spread per viseme (used when driving bones)
VISEME_JAW = {
    "Rest": 0.0, "A": 26.0, "E": 14.0, "I": 8.0, "O": 20.0, "U": 10.0,
    "M": -3.0, "F": 5.0, "L": 12.0,
}
VISEME_CORNER = {
    "Rest": 0.0, "A": 8.0, "E": 14.0, "I": 18.0, "O": -6.0, "U": -14.0,
    "M": 0.0, "F": 6.0, "L": 4.0,
}

MOUTH_BONE_NAMES = {
    "jaw": ["jaw", "mouth", "chin", "lower jaw", "mouth_open"],
    "corner_l": ["l mouth", "left mouth", "mouth l", "corner l", "l corner"],
    "corner_r": ["r mouth", "right mouth", "mouth r", "corner r", "r corner"],
}


@dataclass
class VisemeCue:
    start: int                     # frame (absolute on the timeline)
    end: int
    label: str = "Rest"
    confidence: float = 0.6

    @property
    def duration(self) -> int:
        return max(1, self.end - self.start + 1)

    def to_dict(self) -> dict:
        return {"start": self.start, "end": self.end, "label": self.label,
                "confidence": self.confidence}

    @classmethod
    def from_dict(cls, d: dict) -> "VisemeCue":
        return cls(int(d.get("start", 1)), int(d.get("end", 1)), str(d.get("label", "Rest")),
                   float(d.get("confidence", 0.6)))


@dataclass
class LipSyncTrack:
    asset_id: str = ""
    audio_name: str = ""
    fps: int = 24
    start_frame: int = 1
    cues: list[VisemeCue] = field(default_factory=list)
    applied_layer_uid: str = ""
    method: str = "formant"        # formant | energy | manual
    notes: str = ""

    def label_at(self, frame: int) -> str:
        for cue in self.cues:
            if cue.start <= frame <= cue.end:
                return cue.label
        return "Rest"

    def rebuild_holds(self) -> None:
        self.cues.sort(key=lambda c: c.start)

    def set_cue(self, index: int, label: str | None = None, start: int | None = None,
                end: int | None = None) -> None:
        if not (0 <= index < len(self.cues)):
            return
        cue = self.cues[index]
        if label:
            cue.label = label
        if start is not None:
            cue.start = int(start)
        if end is not None:
            cue.end = max(cue.start, int(end))
        self.rebuild_holds()

    def to_dict(self) -> dict:
        return {"asset_id": self.asset_id, "audio_name": self.audio_name, "fps": self.fps,
                "start_frame": self.start_frame, "method": self.method,
                "applied_layer_uid": self.applied_layer_uid, "notes": self.notes,
                "cues": [c.to_dict() for c in self.cues]}

    @classmethod
    def from_dict(cls, d: dict) -> "LipSyncTrack":
        t = cls(d.get("asset_id", ""), d.get("audio_name", ""), int(d.get("fps", 24)),
                int(d.get("start_frame", 1)), [VisemeCue.from_dict(c) for c in d.get("cues", [])],
                d.get("applied_layer_uid", ""), d.get("method", "formant"), d.get("notes", ""))
        return t


# --------------------------------------------------------------------------
# analysis
# --------------------------------------------------------------------------
class LipSyncAnalyzer:
    def __init__(self, fps: int = 24, window_ms: float = 32.0, hop_ms: float = 12.0):
        self.fps = max(1, fps)
        self.window_ms = window_ms
        self.hop_ms = hop_ms

    # ------------------------------------------------------------ helpers
    def _materialise(self, project, asset) -> str | None:
        if asset is None:
            return None
        if asset.source_path and os.path.isfile(asset.source_path) and not asset.data:
            return asset.source_path
        if not asset.data:
            return None
        suffix = asset.ext or ".wav"
        path = os.path.join(tempfile.gettempdir(), f"mfs_lipsync_{asset.uid}{suffix}")
        if not os.path.exists(path):
            with open(path, "wb") as fh:
                fh.write(asset.data)
        return path

    def analyze(self, project, asset, start_frame: int = 1, threshold: float = 0.08,
                min_cue_frames: int = 2) -> LipSyncTrack:
        track = LipSyncTrack(asset_id=getattr(asset, "uid", ""), audio_name=getattr(asset, "name", ""),
                             fps=self.fps, start_frame=start_frame)
        path = self._materialise(project, asset)
        if not path or not have_ffmpeg():
            track.notes = ("Audio analysis needs the bundled FFmpeg.  You can still edit "
                           "the mouth shapes manually.")
            track.method = "manual"
            return track
        samples, rate = decode_audio(path, 22050)
        if len(samples) == 0:
            track.notes = "Could not decode this audio file."
            track.method = "manual"
            return track
        if np is None:
            track.notes = "Numpy is required for the spectral analysis."
            track.method = "manual"
            return track
        labels, times, conf = self._classify(np.asarray(samples, dtype="float32"), rate, threshold)
        frames: list[VisemeCue] = []
        for label, t0, t1, cf in zip(labels, times[0], times[1], conf):
            start = start_frame + int(round(t0 * self.fps))
            end = start_frame + max(1, int(round(t1 * self.fps))) - 1
            if end < start:
                end = start
            if frames and frames[-1].label == label and frames[-1].end + 1 >= start:
                frames[-1].end = max(frames[-1].end, end)
                frames[-1].confidence = max(frames[-1].confidence, cf)
            else:
                frames.append(VisemeCue(start, end, label, cf))
        # enforce a minimum exposure so the mouth does not flicker
        cleaned: list[VisemeCue] = []
        for cue in frames:
            if cleaned and cue.duration < min_cue_frames:
                cleaned[-1].end = max(cleaned[-1].end, cue.end)
            else:
                cleaned.append(cue)
        track.cues = cleaned
        track.method = "formant"
        track.notes = f"{len(cleaned)} visemes detected in {len(samples) / rate:.1f} s of audio."
        return track

    def _classify(self, samples, rate: int, threshold: float):
        win = int(rate * self.window_ms / 1000.0)
        hop = max(1, int(rate * self.hop_ms / 1000.0))
        n = len(samples)
        labels: list[str] = []
        t0: list[float] = []
        t1: list[float] = []
        conf: list[float] = []
        if n < win:
            return ["Rest"], [0.0], [n / float(rate)], [0.3]
        window = np.hanning(win).astype("float32")
        freqs = np.fft.rfftfreq(win, 1.0 / rate)
        energies = []
        spectra = []
        for start in range(0, n - win, hop):
            chunk = samples[start:start + win] * window
            spec = np.abs(np.fft.rfft(chunk))
            spectra.append(spec)
            energies.append(float(np.sqrt((chunk ** 2).mean())))
        energies_arr = np.asarray(energies)
        peak = float(energies_arr.max()) if energies_arr.size else 1.0
        norm = energies_arr / peak if peak > 0 else energies_arr
        # median smoothing keeps the cues stable
        if norm.size >= 5:
            kernel = np.ones(3) / 3.0
            smooth = np.convolve(norm, kernel, mode="same")
        else:
            smooth = norm
        prev_label = "Rest"
        for i, spec in enumerate(spectra):
            energy = float(smooth[i]) if i < len(smooth) else float(norm[i])
            t_start = (i * hop) / float(rate)
            t_end = t_start + hop / float(rate)
            if energy < threshold:
                label = "Rest"
                cf = 0.4
            else:
                label, cf = self._spec_to_viseme(spec, freqs, energy)
            # avoid 1-frame flicker
            if label != prev_label and labels and len(labels) >= 2 and labels[-1] != prev_label:
                pass
            labels.append(label)
            t0.append(t_start)
            t1.append(t_end)
            conf.append(cf)
            prev_label = label
        return labels, (t0, t1), conf

    def _spec_to_viseme(self, spec, freqs, energy: float) -> tuple[str, float]:
        # remove the low frequency rumble and normalise
        mask = freqs > 90
        f = freqs[mask]
        s = spec[mask]
        if s.size == 0 or s.max() <= 0:
            return "Rest", 0.3
        s = s / s.max()
        # zero crossing rate proxy: spectral flatness
        flatness = float(np.exp(np.log(s + 1e-6).mean()) / (s.mean() + 1e-6))
        centroid = float((f * s).sum() / (s.sum() + 1e-6))
        band = (f > 150) & (f < 3500)
        fb = f[band]
        sb = s[band]
        if fb.size == 0:
            return "Rest", 0.3
        # smooth the envelope and find the strongest peaks (formant candidates)
        kernel = np.ones(3) / 3.0
        env = np.convolve(sb, kernel, mode="same")
        f1_candidates = fb[(fb > 200) & (fb < 1100)]
        f2_candidates = fb[(fb > 700) & (fb < 3200)]
        def _peak(axis_freqs):
            if axis_freqs.size == 0:
                return 0.0, 0.0
            idx = np.searchsorted(fb, axis_freqs)
            idx = np.clip(idx, 0, env.size - 1)
            vals = env[idx]
            j = int(np.argmax(vals))
            return float(axis_freqs[j]), float(vals[j])
        f1, a1 = _peak(f1_candidates)
        f2, a2 = _peak(f2_candidates)
        if f2 <= f1:
            f2 = max(f1 * 1.8, centroid * 1.4)
        conf = float(min(1.0, 0.4 + 0.6 * (a1 + a2) / 2.0))
        if flatness > 0.42 or centroid > 2600:
            return "F", conf * 0.9
        if energy < 0.18 and centroid < 900:
            return "M", conf
        if f1 < 420 and f2 > 1900:
            return "I", conf
        if f1 < 650 and f2 > 1300:
            return "E", conf
        if f1 < 700 and f2 < 1100 and centroid < 1200:
            return "U", conf
        if f1 < 750 and f2 < 1400:
            return "O", conf
        return "A", conf


# --------------------------------------------------------------------------
# applying lip sync
# --------------------------------------------------------------------------
def bones_for_mouth(rig) -> dict[str, object]:
    found: dict[str, object] = {}
    lowered = {b.name.lower(): b for b in rig.bones.values()}
    for slot, names in MOUTH_BONE_NAMES.items():
        for name in names:
            hit = None
            for bname, bone in lowered.items():
                if name in bname:
                    hit = bone
                    break
            if hit is not None:
                found[slot] = hit
                break
    return found


def apply_to_rig(track: LipSyncTrack, rig, easing: str = "linear") -> int:
    """Key the mouth/jaw bones of a rig from the viseme track."""
    bones = bones_for_mouth(rig)
    if not bones:
        return 0
    count = 0
    for cue in track.cues:
        label = cue.label
        frame = cue.start
        if "jaw" in bones:
            bones["jaw"].rotation.set_key(frame, VISEME_JAW.get(label, 0.0), easing=easing)
            count += 1
        spread = VISEME_CORNER.get(label, 0.0)
        if "corner_l" in bones:
            bones["corner_l"].rotation.set_key(frame, -spread, easing=easing)
        if "corner_r" in bones:
            bones["corner_r"].rotation.set_key(frame, spread, easing=easing)
    # close at the end so the mouth returns to rest
    last = track.cues[-1].end if track.cues else track.start_frame
    if "jaw" in bones:
        bones["jaw"].rotation.set_key(last + 2, 0.0, easing=easing)
    return count


def apply_mouth_layer(track: LipSyncTrack, scene, project, mouth_images: dict,
                      head_offset: tuple[float, float] | None = None,
                      layer_name: str = "Mouth") -> object | None:
    """Create (or update) a mouth layer animated with the viseme cels."""
    from ..model.cel import BitmapCel
    from PySide6.QtGui import QPainter

    if not track.cues:
        return None
    layer = None
    for lay in scene.layers:
        if lay.name == layer_name:
            layer = lay
            break
    if layer is None:
        layer = scene.new_layer(layer_name, "raster", len(scene.layers))
    layer.cels.clear()
    pos = head_offset or (scene.width * 0.5, scene.height * 0.38)
    for cue in track.cues:
        img = mouth_images.get(cue.label) or mouth_images.get("Rest")
        if img is None:
            continue
        cel = BitmapCel((scene.width, scene.height))
        p = QPainter(cel.image)
        p.setRenderHint(QPainter.SmoothPixmapTransform, True)
        w = scene.width * 0.09
        h = w * img.height() / max(1, img.width())
        scaled = img.scaled(int(w), int(h), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
        p.drawImage(int(pos[0] - scaled.width() / 2), int(pos[1] - scaled.height() / 2), scaled)
        p.end()
        layer.set_cel(cue.start, cel, hold=max(0, cue.end - cue.start))
    track.applied_layer_uid = layer.uid
    return layer
