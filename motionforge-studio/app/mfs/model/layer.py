"""Animation layers: cel containers + transform animation + grouping."""
from __future__ import annotations

import copy as _copy
from dataclasses import dataclass, field

from .cel import BitmapCel, Cel, VectorCel
from .keyframe import TransformTracks, TransformValue, new_id

LAYER_KINDS = ("raster", "vector", "rig", "group", "camera", "audio", "reference", "text")

BLEND_MODES = [
    ("normal", "Normal"),
    ("multiply", "Multiply"),
    ("screen", "Screen"),
    ("overlay", "Overlay"),
    ("darken", "Darken"),
    ("lighten", "Lighten"),
    ("color_dodge", "Color Dodge"),
    ("color_burn", "Color Burn"),
    ("hard_light", "Hard Light"),
    ("soft_light", "Soft Light"),
    ("difference", "Difference"),
    ("exclusion", "Exclusion"),
    ("add", "Linear Add"),
]


@dataclass
class CelRef:
    """A cel placed on a frame, together with its exposure (hold length)."""

    cel: Cel
    hold: int = 0      # explicit extra hold frames (0 = show until next cel)

    def to_dict(self) -> dict:
        return {"cel": self.cel.to_dict(), "hold": self.hold}


class Layer:
    """A layer can hold either cels (raster/vector frames) or a rig."""

    def __init__(self, name: str = "Layer", kind: str = "raster",
                 size: tuple[int, int] = (1920, 1080)):
        self.uid: str = new_id("layer")
        self.name = name
        self.kind = kind if kind in LAYER_KINDS else "raster"
        self.size = (int(size[0]), int(size[1]))

        self.visible = True
        self.locked = False
        self.alpha_lock = False
        self.clipping = False
        self.collapsed = False
        self.color_tag: str = "#4f8cff"
        self.opacity = 100.0
        self.blend_mode = "normal"
        self.parent_uid: str | None = None
        self.children: list[str] = []

        self.transform = TransformTracks()
        self.cels: dict[int, CelRef] = {}

        # rig layers
        self.rig_id: str | None = None
        # image / reference layers
        self.asset_id: str | None = None
        # audio layers reference an audio track id inside the scene
        self.audio_track_id: str | None = None

        self.notes: str = ""

    # ------------------------------------------------------------- identity
    def __repr__(self) -> str:
        return f"<Layer {self.name!r} {self.kind} cels={len(self.cels)}>"

    # ---------------------------------------------------------------- cels
    def cel_keys(self) -> list[int]:
        return sorted(self.cels.keys())

    def last_frame(self) -> int:
        keys = self.cel_keys()
        if not keys:
            return 0
        last = keys[-1]
        return last + self.cels[last].hold

    def cel_at(self, frame: int) -> tuple[int, CelRef] | None:
        """Return ``(key_frame, CelRef)`` visible on ``frame`` or ``None``."""
        keys = self.cel_keys()
        best: int | None = None
        for k in keys:
            if k <= frame:
                best = k
            else:
                break
        if best is None:
            return None
        return best, self.cels[best]

    def cel_span(self, frame: int) -> tuple[int, int] | None:
        """Start/end frame of the cel block containing ``frame``."""
        hit = self.cel_at(frame)
        if hit is None:
            return None
        start, ref = hit
        keys = self.cel_keys()
        idx = keys.index(start)
        end = start + ref.hold
        if ref.hold == 0 and idx + 1 < len(keys):
            end = keys[idx + 1] - 1
        elif ref.hold == 0:
            end = start
        return start, end

    def is_hold_frame(self, frame: int) -> bool:
        hit = self.cel_at(frame)
        return bool(hit and hit[0] != frame)

    def first_cel(self) -> Cel | None:
        """The drawing on the earliest keyframe (used when binding bone art)."""
        keys = self.cel_keys()
        return self.cels[keys[0]].cel if keys else None

    def first_drawable_cel(self) -> Cel | None:
        """Earliest cel that actually contains artwork."""
        for k in self.cel_keys():
            cel = self.cels[k].cel
            if cel is not None and not cel.is_empty():
                return cel
        return self.first_cel()

    def next_cel_frame(self, frame: int) -> int | None:
        for k in self.cel_keys():
            if k > frame:
                return k
        return None

    def prev_cel_frame(self, frame: int) -> int | None:
        prev = None
        for k in self.cel_keys():
            if k < frame:
                prev = k
            else:
                break
        return prev

    def set_cel(self, frame: int, cel: Cel, hold: int = 0) -> Cel:
        self.cels[int(frame)] = CelRef(cel, hold)
        return cel

    def new_cel(self, frame: int, kind: str | None = None, blank: bool = False,
                copy_from: int | None = None) -> Cel:
        """Create (or replace) the cel at ``frame``."""
        kind = kind or ("vector" if self.kind == "vector" else "bitmap")
        if copy_from is not None:
            hit = self.cel_at(copy_from)
            source = hit[1].cel if hit else None
            cel = source.copy_as_new() if source else self._blank(kind)
        elif blank:
            cel = self._blank(kind)
        else:
            cel = self._blank(kind)
        self.cels[int(frame)] = CelRef(cel)
        return cel

    def _blank(self, kind: str) -> Cel:
        if kind == "vector":
            return VectorCel(self.size)
        if kind == "text":
            from .cel import TextCel
            return TextCel(self.size)
        return BitmapCel(self.size)

    def duplicate_cel(self, frame: int, to_frame: int | None = None) -> int | None:
        hit = self.cel_at(frame)
        if hit is None:
            return None
        key, ref = hit
        target = frame + 1 if to_frame is None else to_frame
        while target in self.cels:
            target += 1
        self.cels[target] = CelRef(ref.cel.copy_as_new(), ref.hold)
        return target

    def remove_cel(self, frame: int) -> bool:
        hit = self.cel_at(frame)
        if hit is None:
            return False
        del self.cels[hit[0]]
        return True

    def clear_cel_content(self, frame: int) -> bool:
        hit = self.cel_at(frame)
        if hit is None:
            return False
        cel = hit[1].cel
        if isinstance(cel, BitmapCel):
            cel.clear()
        elif isinstance(cel, VectorCel):
            cel.strokes.clear()
        elif isinstance(cel, Cel):
            hit[1].cel = self._blank(self.kind)
        return True

    def move_cel(self, frame: int, new_frame: int) -> bool:
        hit = self.cel_at(frame)
        if hit is None or new_frame < 0:
            return False
        key, ref = hit
        if new_frame in self.cels:
            return False
        del self.cels[key]
        self.cels[int(new_frame)] = ref
        return True

    def insert_frame(self, frame: int, count: int = 1, all_layers_of=None) -> None:
        """Push every cel >= ``frame`` forward (classic frame insert)."""
        self.transform.shift(count)
        moved = {}
        for k in self.cel_keys():
            new_k = k + count if k >= frame else k
            moved[new_k] = self.cels[k]
        self.cels = moved

    def delete_frame(self, frame: int, count: int = 1, keep_hold: bool = True) -> None:
        """Ripple delete: remove the exposure at ``frame`` and pull later keys left.

        * a key frame is removed (its drawing goes away) and, with ``keep_hold``,
          the previous drawing is extended so no blank hole remains;
        * a hold frame simply shortens the exposure of the drawing it belongs to.
        """
        count = max(1, int(count))
        hit = self.cel_at(frame)
        keys = self.cel_keys()
        if hit is None or not keys:
            return
        key, ref = hit
        is_key = key == frame
        previous = None
        for k in keys:
            if k < frame:
                previous = k
        new_cels: dict[int, CelRef] = {}
        for k in keys:
            if k == frame and is_key:
                continue                       # the drawing itself is deleted
            new_key = k - count if k > frame else k
            new_cels[new_key] = self.cels[k]
        if not is_key and ref.hold:
            ref.hold = max(0, ref.hold - count)   # shorter hold, no art lost
        if is_key and keep_hold and previous is not None:
            prev_ref = new_cels.get(previous)
            if prev_ref is not None:
                span = (frame + count - 1) - previous
                prev_ref.hold = max(prev_ref.hold, span)
        self.cels = new_cels
        for track in self.transform.tracks.values():
            for keyframe in list(track.keys):
                if keyframe.frame >= frame:
                    keyframe.frame = max(0, keyframe.frame - count)
        if self.rig_id:
            pass

    def set_exposure(self, frame: int, hold: int) -> None:
        hit = self.cel_at(frame)
        if hit is None:
            return
        key, ref = hit
        ref.hold = max(0, int(hold))
        # pushing the next cel forward so the exposure is visible
        keys = self.cel_keys()
        idx = keys.index(key)
        if idx + 1 < len(keys) and hold:
            nxt = keys[idx + 1]
            if nxt <= key + hold:
                self.move_cel(nxt, key + hold + 1)

    def exposure_of(self, frame: int) -> int:
        span = self.cel_span(frame)
        if span is None:
            return 0
        return span[1] - span[0] + 1

    def total_frames(self) -> int:
        return max(1, self.last_frame() + 1)

    def shift_frames(self, offset: int) -> None:
        if offset == 0:
            return
        self.cels = {max(0, k + offset): v for k, v in self.cels.items()}
        self.transform.shift(offset)

    def scale_frames(self, factor: float) -> None:
        self.cels = {max(0, int(round(k * factor))): v for k, v in self.cels.items()}
        self.transform.retime(factor)

    # ------------------------------------------------------------- helpers
    def is_animated(self) -> bool:
        return bool(self.cels) or bool(self.transform.animated_props())

    def key_frames(self) -> set[int]:
        return set(self.cel_keys()) | self.transform.key_frames()

    def transform_at(self, frame: float) -> TransformValue:
        return self.transform.value_at(frame)

    def clone(self, new_uid: bool = True) -> "Layer":
        lay = Layer(self.name, self.kind, self.size)
        if not new_uid:
            lay.uid = self.uid
        lay.visible = self.visible
        lay.locked = self.locked
        lay.alpha_lock = self.alpha_lock
        lay.clipping = self.clipping
        lay.collapsed = self.collapsed
        lay.color_tag = self.color_tag
        lay.opacity = self.opacity
        lay.blend_mode = self.blend_mode
        lay.parent_uid = self.parent_uid
        lay.children = list(self.children)
        lay.transform = self.transform.copy()
        lay.cels = {k: CelRef(v.cel.copy_as_new(), v.hold) for k, v in self.cels.items()}
        lay.rig_id = self.rig_id
        lay.asset_id = self.asset_id
        lay.audio_track_id = self.audio_track_id
        lay.notes = self.notes
        return lay

    # ------------------------------------------------------------------- io
    def to_dict(self) -> dict:
        return {
            "uid": self.uid,
            "name": self.name,
            "kind": self.kind,
            "size": list(self.size),
            "visible": self.visible,
            "locked": self.locked,
            "alpha_lock": self.alpha_lock,
            "clipping": self.clipping,
            "collapsed": self.collapsed,
            "color_tag": self.color_tag,
            "opacity": self.opacity,
            "blend_mode": self.blend_mode,
            "parent_uid": self.parent_uid,
            "children": list(self.children),
            "transform": self.transform.to_dict(),
            "cels": {str(k): v.to_dict() for k, v in sorted(self.cels.items())},
            "rig_id": self.rig_id,
            "asset_id": self.asset_id,
            "audio_track_id": self.audio_track_id,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, d: dict, payload_reader=None) -> "Layer":
        lay = cls(d.get("name", "Layer"), d.get("kind", "raster"),
                  tuple(d.get("size", (1920, 1080))))  # type: ignore[arg-type]
        lay.uid = d.get("uid") or lay.uid
        lay.visible = bool(d.get("visible", True))
        lay.locked = bool(d.get("locked", False))
        lay.alpha_lock = bool(d.get("alpha_lock", False))
        lay.clipping = bool(d.get("clipping", False))
        lay.collapsed = bool(d.get("collapsed", False))
        lay.color_tag = d.get("color_tag", "#4f8cff")
        lay.opacity = float(d.get("opacity", 100.0))
        lay.blend_mode = d.get("blend_mode", "normal")
        lay.parent_uid = d.get("parent_uid")
        lay.children = list(d.get("children", []))
        lay.transform = TransformTracks.from_dict(d.get("transform", {}))
        for k, v in (d.get("cels") or {}).items():
            cel = Cel.from_dict(v.get("cel", {}), payload_reader)
            lay.cels[int(k)] = CelRef(cel, int(v.get("hold", 0)))
        lay.rig_id = d.get("rig_id")
        lay.asset_id = d.get("asset_id")
        lay.audio_track_id = d.get("audio_track_id")
        lay.notes = d.get("notes", "")
        return lay
