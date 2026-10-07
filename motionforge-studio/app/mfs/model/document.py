"""The project document: scenes, assets and global settings."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

from .camera import Camera
from .keyframe import new_id
from .layer import Layer
from .rig import Bone, Rig
from .scene import DEFAULT_FPS, DEFAULT_SIZE, Scene
from .audio import AudioTrack

ASSET_KINDS = ("image", "svg", "audio", "video", "brush", "pose", "animation",
               "character", "background", "prop", "palette", "other")

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".tif", ".tiff"}
VECTOR_EXT = {".svg"}
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".avi", ".mkv"}


def kind_from_ext(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VECTOR_EXT:
        return "svg"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    return "other"


@dataclass
class Asset:
    """A binary resource stored inside the project (or referenced on disk)."""

    name: str
    kind: str = "image"
    data: bytes | None = None
    source_path: str | None = None
    tags: list[str] = field(default_factory=list)
    folder: str = "Library"
    meta: dict = field(default_factory=dict)
    uid: str = field(default_factory=lambda: new_id("asset"))
    created: float = field(default_factory=time.time)

    @property
    def ext(self) -> str:
        if self.source_path:
            return os.path.splitext(self.source_path)[1].lower()
        return {"image": ".png", "audio": ".wav", "video": ".mp4", "svg": ".svg"}.get(self.kind, ".bin")

    @property
    def archive_name(self) -> str:
        return f"assets/{self.uid}{self.ext}"

    def size_bytes(self) -> int:
        return len(self.data) if self.data else 0

    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name, "kind": self.kind,
            "source_path": self.source_path, "tags": list(self.tags),
            "folder": self.folder, "meta": dict(self.meta),
            "archive_name": self.archive_name, "created": self.created,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Asset":
        a = cls(d.get("name", "asset"), d.get("kind", "image"),
                source_path=d.get("source_path"), tags=list(d.get("tags", [])),
                folder=d.get("folder", "Library"), meta=dict(d.get("meta", {})))
        a.uid = d.get("uid") or a.uid
        a.created = float(d.get("created", time.time()))
        return a


DEFAULT_SETTINGS = {
    "onion": {
        "enabled": True,
        "prev_frames": 2,
        "next_frames": 1,
        "opacity": 45,
        "prev_color": "#ff5c7a",
        "next_color": "#42d9a0",
        "show_prev": True,
        "show_next": True,
        "tint": True,
        "alpha_falloff": True,
    },
    "grid": {"visible": False, "spacing": 80, "subdivisions": 4, "color": "#3a3f52"},
    "canvas": {"checker": True, "show_bounds": True, "quality": "normal", "reflection": False},
    "autosave": {"enabled": True, "interval_sec": 180, "keep_backups": 8},
    "export": {"preset": "1080p", "fps": 24, "format": "mp4", "quality": 90,
               "transparent": False, "range": "all"},
    "preview": {"mode": "pro", "loop": True, "quality": "normal"},
    "drawing": {"pressure": True, "smoothing": 0.35, "stabilize": 0.25,
                "stabilizer_visible": False, "tablet_eraser": True},
}


def default_settings() -> dict:
    import copy
    return copy.deepcopy(DEFAULT_SETTINGS)


class Project:
    """Everything the user can save into a single ``.mfs`` file."""

    def __init__(self, name: str = "Untitled", size: tuple[int, int] = DEFAULT_SIZE,
                 fps: int = DEFAULT_FPS):
        self.name = name
        self.width, self.height = int(size[0]), int(size[1])
        self.fps = int(fps)
        self.scenes: list[Scene] = [Scene("Scene 1", (self.width, self.height), self.fps)]
        self.active_scene_uid: str = self.scenes[0].uid
        self.assets: dict[str, Asset] = {}
        self.settings: dict = default_settings()
        self.meta: dict = {
            "created": time.time(),
            "modified": time.time(),
            "app_version": "",
            "author": "",
            "description": "",
        }
        self.ai_log: list[dict] = []
        self.path: str | None = None
        self.dirty: bool = False

    # --------------------------------------------------------------- scenes
    @property
    def active_scene(self) -> Scene:
        for sc in self.scenes:
            if sc.uid == self.active_scene_uid:
                return sc
        if not self.scenes:
            self.scenes.append(Scene("Scene 1", (self.width, self.height), self.fps))
        self.active_scene_uid = self.scenes[0].uid
        return self.scenes[0]

    def scene(self, uid: str) -> Scene | None:
        for sc in self.scenes:
            if sc.uid == uid:
                return sc
        return None

    def add_scene(self, name: str | None = None, index: int | None = None) -> Scene:
        sc = Scene(name or f"Scene {len(self.scenes) + 1}", (self.width, self.height), self.fps)
        if index is None:
            self.scenes.append(sc)
        else:
            self.scenes.insert(index, sc)
        return sc

    def scene_by_name(self, name: str) -> Scene | None:
        low = name.lower().strip()
        for sc in self.scenes:
            if sc.name.lower() == low:
                return sc
        for sc in self.scenes:
            if low and low in sc.name.lower():
                return sc
        return None

    def duplicate_scene(self, uid: str) -> Scene | None:
        src = self.scene(uid)
        if src is None:
            return None
        copy = Scene.from_dict(src.to_dict())
        copy.uid = new_id("scene")
        copy.name = f"{src.name} copy"
        # remap rig + camera references (layer dict copy already deep copied data)
        self.scenes.append(copy)
        return copy

    def remove_scene(self, uid: str) -> bool:
        if len(self.scenes) <= 1:
            return False
        self.scenes = [s for s in self.scenes if s.uid != uid]
        if self.active_scene_uid == uid:
            self.active_scene_uid = self.scenes[0].uid
        return True

    # --------------------------------------------------------------- assets
    def add_asset(self, name: str, kind: str, data: bytes | None = None,
                  source_path: str | None = None, tags: list[str] | None = None,
                  folder: str = "Library", meta: dict | None = None) -> Asset:
        asset = Asset(name, kind, data, source_path, tags or [], folder, meta or {})
        self.assets[asset.uid] = asset
        return asset

    def add_asset_from_file(self, path: str, name: str | None = None,
                            kind: str | None = None) -> Asset:
        with open(path, "rb") as fh:
            data = fh.read()
        asset = self.add_asset(name or os.path.basename(path), kind or kind_from_ext(path),
                               data, source_path=path)
        return asset

    def asset(self, uid: str | None) -> Asset | None:
        if not uid:
            return None
        return self.assets.get(uid)

    def remove_asset(self, uid: str) -> bool:
        if uid in self.assets:
            del self.assets[uid]
            return True
        return False

    def find_assets(self, kind: str | None = None, query: str = "") -> list[Asset]:
        out = []
        q = query.lower()
        for a in self.assets.values():
            if kind and a.kind != kind:
                continue
            if q and q not in a.name.lower() and not any(q in t.lower() for t in a.tags):
                continue
            out.append(a)
        return sorted(out, key=lambda a: (a.folder, a.name.lower()))

    def asset_folders(self) -> list[str]:
        return sorted({a.folder or "Library" for a in self.assets.values()})

    def assets_size(self) -> int:
        return sum(a.size_bytes() for a in self.assets.values())

    # -------------------------------------------------------------- content
    def all_characters(self) -> list[tuple[Scene, Layer, Rig]]:
        out = []
        for sc in self.scenes:
            for lay in sc.layers:
                if lay.kind == "rig":
                    rig = sc.rigs.get(lay.rig_id or "")
                    if rig:
                        out.append((sc, lay, rig))
        return out

    def total_frames(self) -> int:
        return max((sc.total_frames() for sc in self.scenes), default=1)

    def resolution_presets(self) -> list[tuple[str, tuple[int, int]]]:
        return [
            ("480p  (854x480)", (854, 480)),
            ("720p  (1280x720)", (1280, 720)),
            ("1080p (1920x1080)", (1920, 1080)),
            ("1440p (2560x1440)", (2560, 1440)),
            ("4K    (3840x2160)", (3840, 2160)),
            ("Square (1080x1080)", (1080, 1080)),
            ("Vertical (1080x1920)", (1080, 1920)),
        ]

    def touch(self) -> None:
        self.meta["modified"] = time.time()
        self.dirty = True

    # ------------------------------------------------------------------- io
    def to_dict(self) -> dict:
        return {
            "name": self.name, "width": self.width, "height": self.height, "fps": self.fps,
            "scenes": [s.to_dict() for s in self.scenes],
            "active_scene_uid": self.active_scene_uid,
            "assets": [a.to_dict() for a in self.assets.values()],
            "settings": self.settings,
            "meta": self.meta,
            "ai_log": self.ai_log[-200:],
        }

    @classmethod
    def from_dict(cls, d: dict, payload_reader=None) -> "Project":
        p = cls(d.get("name", "Untitled"), (d.get("width", 1920), d.get("height", 1080)),
                int(d.get("fps", DEFAULT_FPS)))
        scenes = [Scene.from_dict(s, payload_reader) for s in d.get("scenes", [])]
        if scenes:
            p.scenes = scenes
        p.active_scene_uid = d.get("active_scene_uid") or p.scenes[0].uid
        p.assets = {}
        for ad in d.get("assets", []):
            a = Asset.from_dict(ad)
            if payload_reader is not None:
                a.data = payload_reader(ad.get("archive_name", ""))
            p.assets[a.uid] = a
        settings = default_settings()
        for section, values in (d.get("settings") or {}).items():
            if isinstance(values, dict) and isinstance(settings.get(section), dict):
                settings[section].update(values)
            else:
                settings[section] = values
        p.settings = settings
        p.meta.update(d.get("meta", {}))
        p.ai_log = list(d.get("ai_log", []))
        return p


# --------------------------------------------------------------------------
def new_stick_rig(name: str = "Stick Figure", height: float = 420.0,
                  origin: tuple[float, float] = (0.0, 0.0)) -> Rig:
    """A ready-to-animate humanoid skeleton.

    Bones are authored in *world* space (``create_bone_world``) because that is
    far easier to reason about - 0 degrees points right, 90 degrees points down.
    """
    rig = Rig(name)
    ox, oy = origin
    hip_y = oy - height * 0.18
    arm = height * 0.19
    leg = height * 0.25
    shoulder_w = height * 0.11

    pelvis = rig.create_bone_world("Pelvis", None, -90.0, height * 0.12, x=ox, y=hip_y)
    spine = rig.create_bone_world("Spine", pelvis.uid, -90.0, height * 0.20)
    chest = rig.create_bone_world("Chest", spine.uid, -90.0, height * 0.16)
    neck = rig.create_bone_world("Neck", chest.uid, -90.0, height * 0.05)
    head = rig.create_bone_world("Head", neck.uid, -90.0, height * 0.15)
    for b in (pelvis, spine, chest, neck):
        b.color = "#8ea2ff"
    head.color = "#ffd166"
    pelvis.min_angle, pelvis.max_angle = -60, 60
    spine.min_angle, spine.max_angle = -45, 45
    chest.min_angle, chest.max_angle = -45, 45
    neck.min_angle, neck.max_angle = -70, 70
    head.min_angle, head.max_angle = -70, 70

    for side in ("L", "R"):
        up = rig.create_bone_world(f"{side} Shoulder", chest.uid, 0.0 if side == "L" else 180.0,
                                   shoulder_w)
        fore = rig.create_bone_world(f"{side} Elbow", up.uid,
                                     0.0 if side == "L" else 180.0, arm * 0.85)
        hand = rig.create_bone_world(f"{side} Hand", fore.uid,
                                     0.0 if side == "L" else 180.0, arm * 0.45)
        up.color = fore.color = "#7ee0c1"
        hand.color = "#ffb347"
        up.min_angle, up.max_angle = -125, 125
        fore.min_angle, fore.max_angle = (-150, 5) if side == "L" else (-5, 150)
        hand.min_angle, hand.max_angle = -60, 60

        thigh = rig.create_bone_world(f"{side} Hip", pelvis.uid, 90.0, leg)
        shin = rig.create_bone_world(f"{side} Knee", thigh.uid, 90.0, leg * 0.95)
        foot = rig.create_bone_world(f"{side} Foot", shin.uid, 0.0 if side == "L" else 180.0,
                                     leg * 0.32)
        thigh.color = shin.color = "#f78fb3"
        foot.color = "#ffd166"
        thigh.min_angle, thigh.max_angle = -95, 45
        shin.min_angle, shin.max_angle = (-150, 5) if side == "L" else (-5, 150)
        foot.min_angle, foot.max_angle = -35, 35

    # IK chains for both arms and legs.  They start disabled and without target
    # keys, so plain FK poses and the premade clips work untouched; switching a
    # chain on (Character panel ▸ IK, or dragging the effector in IK mode) makes
    # the limb follow the target.
    rest = rig.solve(0)
    for side in ("L", "R"):
        for label, root, mid, tip in (
            (f"{side} Arm IK", f"{side} Shoulder", f"{side} Elbow", f"{side} Hand"),
            (f"{side} Leg IK", f"{side} Hip", f"{side} Knee", f"{side} Foot"),
        ):
            chain = rig.add_ik_chain(root, mid, tip, name=label)
            if chain is None:
                continue
            chain.enabled = False
            effector = rig.find(tip)
            world = rest.get(effector.uid) if effector is not None else None
            if world is not None:
                chain.rest_target = (world.tail[0], world.tail[1])
    return rig
