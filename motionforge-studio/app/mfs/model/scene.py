"""Scenes: a self contained stage (layers, rigs, cameras, audio, storyboard)."""
from __future__ import annotations

from dataclasses import dataclass, field

from .audio import AudioTrack
from .camera import Camera, Shot
from .keyframe import new_id
from .layer import Layer
from .rig import Rig

DEFAULT_FPS = 24
DEFAULT_SIZE = (1920, 1080)


@dataclass
class Marker:
    frame: int
    name: str
    color: str = "#ffd166"
    uid: str = field(default_factory=lambda: new_id("mk"))

    def to_dict(self) -> dict:
        return {"uid": self.uid, "frame": self.frame, "name": self.name, "color": self.color}

    @classmethod
    def from_dict(cls, d: dict) -> "Marker":
        m = cls(int(d.get("frame", 1)), d.get("name", "Marker"), d.get("color", "#ffd166"))
        m.uid = d.get("uid") or m.uid
        return m


class Scene:
    """One stage of the project.  Scenes are switched from the scene bar."""

    def __init__(self, name: str = "Scene 1", size: tuple[int, int] = DEFAULT_SIZE,
                 fps: int = DEFAULT_FPS):
        self.uid: str = new_id("scene")
        self.name = name
        self.width, self.height = int(size[0]), int(size[1])
        self.fps = int(fps)
        self.frame_start = 1
        self.frame_end = 72
        self.background_color = "#ffffff"
        self.layers: list[Layer] = []
        self.rigs: dict[str, Rig] = {}
        self.cameras: list[Camera] = [Camera("Camera 1", (self.width, self.height))]
        self.active_camera_uid: str = self.cameras[0].uid
        self.shots: list[Shot] = []
        self.audio_tracks: list[AudioTrack] = []
        self.markers: list[Marker] = []
        self.notes: str = ""
        self.thumbnail: str = ""

    # ---------------------------------------------------------------- layers
    def size(self) -> tuple[int, int]:
        return self.width, self.height

    def add_layer(self, layer: Layer, index: int | None = None,
                  parent: str | None = None) -> Layer:
        if parent:
            layer.parent_uid = parent
            p = self.layer(parent)
            if p is not None and layer.uid not in p.children:
                p.children.append(layer.uid)
        if index is None or index < 0 or index > len(self.layers):
            self.layers.append(layer)
        else:
            self.layers.insert(index, layer)
        return layer

    def new_layer(self, name: str = "Layer", kind: str = "raster",
                  index: int | None = None, parent: str | None = None) -> Layer:
        return self.add_layer(Layer(name, kind, (self.width, self.height)), index, parent)

    def layer(self, uid: str) -> Layer | None:
        for lay in self.layers:
            if lay.uid == uid:
                return lay
        return None

    def layer_index(self, uid: str) -> int:
        for i, lay in enumerate(self.layers):
            if lay.uid == uid:
                return i
        return -1

    def root_layers(self) -> list[Layer]:
        return [lay for lay in self.layers if not lay.parent_uid]

    def children_of(self, uid: str | None) -> list[Layer]:
        return [lay for lay in self.layers if lay.parent_uid == uid]

    def remove_layer(self, uid: str, recursive: bool = True) -> list[Layer]:
        """Remove a layer (returns everything that was removed)."""
        lay = self.layer(uid)
        if lay is None:
            return []
        removed: list[Layer] = []
        if recursive:
            for child in list(self.children_of(uid)):
                removed.extend(self.remove_layer(child.uid, True))
        if lay.parent_uid:
            parent = self.layer(lay.parent_uid)
            if parent and uid in parent.children:
                parent.children.remove(uid)
        if lay.uid in [l.uid for l in self.layers]:
            self.layers = [l for l in self.layers if l.uid != uid]
        removed.append(lay)
        if lay.kind == "rig" and lay.rig_id and lay.rig_id in self.rigs:
            del self.rigs[lay.rig_id]
        return removed

    def move_layer(self, uid: str, new_index: int) -> bool:
        i = self.layer_index(uid)
        if i < 0:
            return False
        lay = self.layers.pop(i)
        new_index = max(0, min(len(self.layers), new_index))
        self.layers.insert(new_index, lay)
        return True

    def set_parent(self, uid: str, parent_uid: str | None) -> bool:
        lay = self.layer(uid)
        if lay is None or uid == parent_uid:
            return False
        # no cycles
        cur = parent_uid
        while cur:
            if cur == uid:
                return False
            p = self.layer(cur)
            cur = p.parent_uid if p else None
        if lay.parent_uid:
            old = self.layer(lay.parent_uid)
            if old and uid in old.children:
                old.children.remove(uid)
        lay.parent_uid = parent_uid
        if parent_uid:
            p = self.layer(parent_uid)
            if p and uid not in p.children:
                p.children.append(uid)
        return True

    def duplicate_layer(self, uid: str, deep: bool = True) -> Layer | None:
        lay = self.layer(uid)
        if lay is None:
            return None
        copy = lay.clone()
        copy.name = f"{lay.name} copy"
        index = self.layer_index(uid) + 1
        self.add_layer(copy, index, lay.parent_uid)
        if deep:
            for child in self.children_of(uid):
                child_copy = child.clone()
                child_copy.name = child.name
                self.add_layer(child_copy, self.layer_index(child_copy.uid), copy.uid)
        if lay.kind == "rig" and lay.rig_id in self.rigs:
            rig_copy = self.rigs[lay.rig_id].clone()
            self.rigs[rig_copy.uid] = rig_copy
            copy.rig_id = rig_copy.uid
        return copy

    # ----------------------------------------------------------------- rigs
    def add_rig(self, rig: Rig) -> Rig:
        self.rigs[rig.uid] = rig
        return rig

    def attach_rig_layer(self, rig: Rig, name: str | None = None,
                         index: int | None = None) -> Layer:
        self.add_rig(rig)
        lay = Layer(name or rig.name, "rig", (self.width, self.height))
        lay.rig_id = rig.uid
        self.add_layer(lay, index)
        return lay

    def rig_of_layer(self, lay: Layer) -> Rig | None:
        if lay.rig_id:
            return self.rigs.get(lay.rig_id)
        return None

    # -------------------------------------------------------------- cameras
    def camera(self, uid: str | None = None) -> Camera:
        uid = uid or self.active_camera_uid
        for cam in self.cameras:
            if cam.uid == uid:
                return cam
        if not self.cameras:
            self.cameras.append(Camera("Camera 1", self.size()))
        self.active_camera_uid = self.cameras[0].uid
        return self.cameras[0]

    def add_camera(self, name: str | None = None) -> Camera:
        cam = Camera(name or f"Camera {len(self.cameras) + 1}", self.size())
        cam.pos_x.default = self.width / 2
        cam.pos_y.default = self.height / 2
        self.cameras.append(cam)
        return cam

    def remove_camera(self, uid: str) -> bool:
        if len(self.cameras) <= 1:
            return False
        self.cameras = [c for c in self.cameras if c.uid != uid]
        self.shots = [s for s in self.shots if s.camera_uid != uid]
        if self.active_camera_uid == uid:
            self.active_camera_uid = self.cameras[0].uid
        return True

    def camera_at(self, frame: int) -> Camera:
        for shot in sorted(self.shots, key=lambda s: s.start):
            if shot.contains(frame) and shot.camera_uid:
                return self.camera(shot.camera_uid)
        return self.camera()

    # ---------------------------------------------------------------- audio
    def add_audio(self, track: AudioTrack) -> AudioTrack:
        self.audio_tracks.append(track)
        return track

    def remove_audio(self, uid: str) -> bool:
        before = len(self.audio_tracks)
        self.audio_tracks = [t for t in self.audio_tracks if t.uid != uid]
        return len(self.audio_tracks) != before

    def has_solo(self) -> bool:
        return any(t.solo for t in self.audio_tracks)

    # -------------------------------------------------------------- helpers
    def total_frames(self) -> int:
        end = self.frame_end
        for lay in self.layers:
            end = max(end, lay.last_frame())
            for prop in lay.transform.tracks.values():
                r = prop.range()
                if r:
                    end = max(end, r[1])
        for rig in self.rigs.values():
            r = rig.frame_range()
            if r:
                end = max(end, r[1])
        for track in self.audio_tracks:
            end = max(end, track.end_frame(self.fps))
        for cam in self.cameras:
            frames = cam.key_frames()
            if frames:
                end = max(end, max(frames))
        for shot in self.shots:
            end = max(end, shot.end)
        return max(end, self.frame_start + 1)

    def duration_frames(self) -> int:
        return self.total_frames() - self.frame_start + 1

    def shift_all_frames(self, offset: int) -> None:
        for lay in self.layers:
            lay.shift_frames(offset)
        for rig in self.rigs.values():
            rig.shift_keys(offset)
        for cam in self.cameras:
            for t in (cam.pos_x, cam.pos_y, cam.zoom, cam.rotation):
                for k in t.keys:
                    k.frame += offset
        for track in self.audio_tracks:
            track.start_frame = max(1, track.start_frame + offset)
        for shot in self.shots:
            shot.start = max(1, shot.start + offset)
            shot.end = max(shot.start + 1, shot.end + offset)
        for mk in self.markers:
            mk.frame = max(1, mk.frame + offset)

    def scenes_rig_ids(self) -> list[str]:
        return list(self.rigs.keys())

    def key_frames(self) -> set[int]:
        frames: set[int] = set()
        for lay in self.layers:
            frames |= lay.key_frames()
        for rig in self.rigs.values():
            for b in rig.bones.values():
                for t in (b.rotation, b.offset_x, b.offset_y):
                    frames.update(t.frames())
        for cam in self.cameras:
            frames |= cam.key_frames()
        frames.update(t.start_frame for t in self.audio_tracks)
        return frames

    def clone(self, new_uid: bool = True) -> "Scene":
        sc = Scene.from_dict(self.to_dict())
        if new_uid:
            sc.uid = new_id("scene")
        return sc

    # ------------------------------------------------------------------- io
    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name, "width": self.width, "height": self.height,
            "fps": self.fps, "frame_start": self.frame_start, "frame_end": self.frame_end,
            "background_color": self.background_color,
            "layers": [l.to_dict() for l in self.layers],
            "rigs": {k: v.to_dict() for k, v in self.rigs.items()},
            "cameras": [c.to_dict() for c in self.cameras],
            "active_camera_uid": self.active_camera_uid,
            "shots": [s.to_dict() for s in self.shots],
            "audio_tracks": [a.to_dict() for a in self.audio_tracks],
            "markers": [m.to_dict() for m in self.markers],
            "notes": self.notes,
            "thumbnail": self.thumbnail,
        }

    @classmethod
    def from_dict(cls, d: dict, payload_reader=None) -> "Scene":
        sc = cls(d.get("name", "Scene"), (d.get("width", 1920), d.get("height", 1080)),
                 int(d.get("fps", DEFAULT_FPS)))
        sc.uid = d.get("uid") or sc.uid
        sc.frame_start = int(d.get("frame_start", 1))
        sc.frame_end = int(d.get("frame_end", 72))
        sc.background_color = d.get("background_color", "#ffffff")
        sc.layers = [Layer.from_dict(x, payload_reader) for x in d.get("layers", [])]
        sc.rigs = {k: Rig.from_dict(v) for k, v in (d.get("rigs") or {}).items()}
        cams = [Camera.from_dict(c) for c in d.get("cameras", [])]
        sc.cameras = cams or [Camera("Camera 1", (sc.width, sc.height))]
        sc.active_camera_uid = d.get("active_camera_uid") or sc.cameras[0].uid
        sc.shots = [Shot.from_dict(s) for s in d.get("shots", [])]
        sc.audio_tracks = [AudioTrack.from_dict(a) for a in d.get("audio_tracks", [])]
        sc.markers = [Marker.from_dict(m) for m in d.get("markers", [])]
        sc.notes = d.get("notes", "")
        sc.thumbnail = d.get("thumbnail", "")
        return sc
