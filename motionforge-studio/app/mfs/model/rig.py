"""2D bone rigging: FK, IK, constraints, poses.

Coordinate system: screen space, Y grows downwards, angles in degrees,
0 degrees points to the right (+X) and grows clockwise (so 90 degrees points
down).  Every bone owns animated tracks which makes rig animation editable
exactly like any other property in the timeline.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .keyframe import Track, new_id
from .easing import clamp


CONSTRAINT_TYPES = [
    ("none", "None"),
    ("limit", "Rotation limit"),
    ("dampen", "Dampen (half follow)"),
    ("lock", "Lock (no rotation)"),
    ("copy", "Copy parent rotation"),
    ("pin", "Pin world angle"),
]

#: Maps a body part to the bone name it should follow (used by Auto Rig and the
#: part binding UI).  Auto Rig Character detects these parts from layer names.
PART_BONE_MAP = {
    "head": "Head",
    "hair": "Head",
    "body": "Chest",
    "pelvis": "Pelvis",
    "arm_l": "L Elbow",
    "arm_r": "R Elbow",
    "hand_l": "L Hand",
    "hand_r": "R Hand",
    "leg_l": "L Knee",
    "leg_r": "R Knee",
    "foot_l": "L Foot",
    "foot_r": "R Foot",
    "eyes": "Head",
    "mouth": "Head",
    "accessory": "Chest",
}

PART_ALIASES = {
    "head": ("head", "face", "skull"),
    "hair": ("hair", "bang", "ponytail"),
    "body": ("body", "torso", "chest", "shirt", "jacket", "dress"),
    "pelvis": ("pelvis", "hip", "waist", "skirt", "pants"),
    "arm_l": ("l arm", "left arm", "arm_l", "upper arm l", "arml"),
    "arm_r": ("r arm", "right arm", "arm_r", "upper arm r", "armr"),
    "hand_l": ("l hand", "left hand", "hand_l", "handl", "glove l"),
    "hand_r": ("r hand", "right hand", "hand_r", "handr", "glove r"),
    "leg_l": ("l leg", "left leg", "leg_l", "legl", "thigh l"),
    "leg_r": ("r leg", "right leg", "leg_r", "legr", "thigh r"),
    "foot_l": ("l foot", "left foot", "foot_l", "footl", "shoe l", "boot l"),
    "foot_r": ("r foot", "right foot", "foot_r", "footr", "shoe r", "boot r"),
    "eyes": ("eye", "eyes", "iris", "pupil", "brow"),
    "mouth": ("mouth", "lip", "jaw", "teeth", "tongue"),
}


def _rad(deg: float) -> float:
    return deg * math.pi / 180.0


def _deg(rad: float) -> float:
    return rad * 180.0 / math.pi


@dataclass
class BoneWorld:
    head: tuple[float, float]
    tail: tuple[float, float]
    world_angle: float
    local_angle: float
    length: float
    scale: float = 1.0

    @property
    def mid(self) -> tuple[float, float]:
        return ((self.head[0] + self.tail[0]) * 0.5, (self.head[1] + self.tail[1]) * 0.5)


class Bone:
    """A single bone. ``x``/``y`` are the head offset in parent space."""

    def __init__(self, name: str = "bone", parent: str | None = None,
                 x: float = 0.0, y: float = 0.0, length: float = 100.0,
                 angle: float = 0.0):
        self.uid: str = new_id("bone")
        self.name = name
        self.parent: str | None = parent
        self.x = float(x)
        self.y = float(y)
        self.length = float(length)
        self.angle = float(angle)

        self.rotation = Track("rotation", 0.0, angular=True, unit="deg")
        self.offset_x = Track("offset.x", 0.0, unit="px")
        self.offset_y = Track("offset.y", 0.0, unit="px")
        self.scale = Track("scale", 100.0, unit="%")

        self.min_angle: float | None = None
        self.max_angle: float | None = None
        self.constraint: str = "none"    # see CONSTRAINT_TYPES
        self.ik_pin = False              # tip pinned by an IK target
        self.stretch = False
        self.inherit_rotation = True
        self.visible = True
        self.color = "#ffb347"

        # attached artwork (puppet parts) - transforms are in bone space where
        # the bone head is the origin and +Y is along the bone.
        self.asset_id: str | None = None
        self.asset_offset = (0.0, 0.0)
        self.asset_scale = 1.0
        self.asset_angle = 0.0
        self.z_order = 0

    # ------------------------------------------------------------------ util
    @property
    def animated(self) -> bool:
        return bool(self.rotation.keys or self.offset_x.keys or self.offset_y.keys
                    or self.scale.keys)

    def children_of(self, rig: "Rig") -> list[str]:
        return [b.uid for b in rig.bones.values() if b.parent == self.uid]

    # constraint helpers -------------------------------------------------
    @property
    def limit_min(self) -> float:
        return -360.0 if self.min_angle is None else float(self.min_angle)

    @limit_min.setter
    def limit_min(self, value: float) -> None:
        self.min_angle = float(value)

    @property
    def limit_max(self) -> float:
        return 360.0 if self.max_angle is None else float(self.max_angle)

    @limit_max.setter
    def limit_max(self, value: float) -> None:
        self.max_angle = float(value)

    def apply_constraint(self, rotation_deg: float, parent_rotation: float = 0.0,
                         world_rest_angle: float = 0.0, world_angle: float = 0.0) -> float:
        """Return the rotation after this bone's constraint is applied."""
        kind = self.constraint or "none"
        if kind == "lock":
            return 0.0
        if kind == "copy":
            return parent_rotation
        if kind == "dampen":
            return self.clamp_rotation(rotation_deg) * 0.5
        if kind == "pin":
            return self.clamp_rotation(rotation_deg)
        return self.clamp_rotation(rotation_deg)

    def clamp_rotation(self, rotation_deg: float) -> float:
        """Limits are expressed as a delta from the rest pose (like a rig in
        any DCC tool): -120..120 means 'can swing 120 degrees either way'."""
        if self.min_angle is None and self.max_angle is None:
            return rotation_deg
        lo = self.min_angle if self.min_angle is not None else -360.0
        hi = self.max_angle if self.max_angle is not None else 360.0
        return clamp(rotation_deg, lo, hi)

    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name, "parent": self.parent,
            "x": self.x, "y": self.y, "length": self.length, "angle": self.angle,
            "rotation": self.rotation.to_dict(),
            "offset_x": self.offset_x.to_dict(),
            "offset_y": self.offset_y.to_dict(),
            "scale": self.scale.to_dict(),
            "min_angle": self.min_angle, "max_angle": self.max_angle,
            "constraint": self.constraint,
            "ik_pin": self.ik_pin, "stretch": self.stretch,
            "inherit_rotation": self.inherit_rotation, "visible": self.visible,
            "color": self.color, "asset_id": self.asset_id,
            "asset_offset": list(self.asset_offset), "asset_scale": self.asset_scale,
            "asset_angle": self.asset_angle, "z_order": self.z_order,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Bone":
        b = cls(d.get("name", "bone"), d.get("parent"), d.get("x", 0.0), d.get("y", 0.0),
                d.get("length", 100.0), d.get("angle", 0.0))
        b.uid = d.get("uid") or b.uid
        b.rotation = Track.from_dict(d.get("rotation", {}))
        b.offset_x = Track.from_dict(d.get("offset_x", {}))
        b.offset_y = Track.from_dict(d.get("offset_y", {}))
        b.scale = Track.from_dict(d.get("scale", {})) if d.get("scale") else Track("scale", 100.0)
        b.min_angle = d.get("min_angle")
        b.max_angle = d.get("max_angle")
        b.constraint = d.get("constraint", "none")
        b.ik_pin = bool(d.get("ik_pin", False))
        b.stretch = bool(d.get("stretch", False))
        b.inherit_rotation = bool(d.get("inherit_rotation", True))
        b.visible = bool(d.get("visible", True))
        b.color = d.get("color", "#ffb347")
        b.asset_id = d.get("asset_id")
        b.asset_offset = tuple(d.get("asset_offset", (0.0, 0.0)))  # type: ignore[arg-type]
        b.asset_scale = float(d.get("asset_scale", 1.0))
        b.asset_angle = float(d.get("asset_angle", 0.0))
        b.z_order = int(d.get("z_order", 0))
        return b

    def clone(self, new_uid: bool = True) -> "Bone":
        b = Bone.from_dict(self.to_dict())
        if new_uid:
            b.uid = new_id("bone")
        return b


def _wrap_delta(a: float, b: float) -> float:
    """Shortest angular delta from a to b."""
    d = (b - a) % 360.0
    if d > 180.0:
        d -= 360.0
    return d


@dataclass
class IKChain:
    """An IK chain: a list of bone uids from root to effector + a target."""

    name: str = "IK"
    bones: list[str] = field(default_factory=list)
    target_x = None
    target_y = None
    enabled: bool = True
    rest_target: tuple[float, float] | None = None   # where the effector rests
    pole: float = 1.0          # +1 / -1 : which way the knee/elbow bends
    softness: float = 0.15
    uid: str = field(default_factory=lambda: new_id("ik"))

    def __post_init__(self) -> None:
        if self.target_x is None:
            self.target_x = Track("target.x", 0.0, unit="px")
        if self.target_y is None:
            self.target_y = Track("target.y", 0.0, unit="px")

    def to_dict(self) -> dict:
        return {"uid": self.uid, "name": self.name, "bones": list(self.bones),
                "target_x": self.target_x.to_dict(), "target_y": self.target_y.to_dict(),
                "enabled": self.enabled, "pole": self.pole, "softness": self.softness,
                "rest_target": list(self.rest_target) if self.rest_target else None}

    @classmethod
    def from_dict(cls, d: dict) -> "IKChain":
        c = cls(d.get("name", "IK"), list(d.get("bones", [])), enabled=bool(d.get("enabled", True)),
               pole=float(d.get("pole", 1.0)), softness=float(d.get("softness", 0.15)))
        rest = d.get("rest_target")
        c.rest_target = tuple(rest) if rest else None
        c.uid = d.get("uid") or c.uid
        c.target_x = Track.from_dict(d.get("target_x", {}))
        c.target_y = Track.from_dict(d.get("target_y", {}))
        return c


# --------------------------------------------------------------------------
# pose helpers
# --------------------------------------------------------------------------
Pose = dict[str, tuple[float, float, float]]      # bone uid -> (rotation, off_x, off_y)
#: Pose values may also be PartPose-like objects (``rot`` / ``ox`` / ``oy``); both
#: are accepted everywhere a pose is written back into a rig.


def _pose_values(entry) -> tuple[float, float, float]:
    if hasattr(entry, "rot"):
        return (float(entry.rot), float(getattr(entry, "ox", 0.0)),
                float(getattr(entry, "oy", 0.0)))
    if isinstance(entry, dict):
        return (float(entry.get("rot", 0.0)), float(entry.get("ox", 0.0)),
                float(entry.get("oy", 0.0)))
    values = list(entry) + [0.0, 0.0]
    return float(values[0]), float(values[1]), float(values[2])


class Rig:
    """A character skeleton with animation data."""

    def __init__(self, name: str = "Character"):
        self.uid: str = new_id("rig")
        self.name = name
        self.bones: dict[str, Bone] = {}
        self.order: list[str] = []            # draw order (root first)
        self.ik_chains: list[IKChain] = []
        self.pose_keys: dict[int, Pose] = {}  # frame accurate poses (optional)
        self.root_offset = (0.0, 0.0)
        self.scale = 100.0
        self.visible = True
        self.pinned = False                   # pin the roots so the body cannot slide
        self.part_bindings: dict[str, str] = {}   # part key -> layer uid
        self.auto_rigged = False

    # ------------------------------------------------------------- topology
    def add_bone(self, bone: Bone) -> Bone:
        self.bones[bone.uid] = bone
        if bone.uid not in self.order:
            self.order.append(bone.uid)
        return bone

    def create_bone(self, name: str, parent: str | None = None, **kw) -> Bone:
        return self.add_bone(Bone(name=name, parent=parent, **kw))

    def remove_bone(self, uid: str, reparent_children: bool = True) -> bool:
        bone = self.bones.get(uid)
        if bone is None:
            return False
        for child in list(self.bones.values()):
            if child.parent == uid:
                if reparent_children:
                    child.parent = bone.parent
                    if bone.parent in self.bones:
                        pb = self.bones[bone.parent]
                        child.x += bone.x + math.cos(_rad(bone.angle)) * bone.length
                        child.y += bone.y + math.sin(_rad(bone.angle)) * bone.length
                else:
                    child.parent = None
        del self.bones[uid]
        if uid in self.order:
            self.order.remove(uid)
        for chain in self.ik_chains:
            chain.bones = [b for b in chain.bones if b != uid]
        self.ik_chains = [c for c in self.ik_chains if c.bones]
        return True

    def reparent(self, uid: str, new_parent: str | None) -> bool:
        bone = self.bones.get(uid)
        if bone is None or uid == new_parent:
            return False
        if new_parent and self._is_descendant(new_parent, uid):
            return False
        bone.parent = new_parent
        return True

    def _is_descendant(self, candidate: str, ancestor: str) -> bool:
        cur = candidate
        guard = 0
        while cur and guard < 512:
            if cur == ancestor:
                return True
            b = self.bones.get(cur)
            cur = b.parent if b else None
            guard += 1
        return False

    # ------------------------------------------------------- rest geometry
    def rest_world_angle(self, bone: Bone) -> float:
        """World angle of a bone in rest pose (used by world-space authoring)."""
        if not bone.parent or bone.parent not in self.bones:
            return bone.angle
        return self.rest_world_angle(self.bones[bone.parent]) + bone.angle

    def create_bone_world(self, name: str, parent_uid: str | None, world_angle: float,
                          length: float, x: float = 0.0, y: float = 0.0, **kw) -> Bone:
        """Create a bone by pointing at a world space angle (much easier to
        script and to drive from the AI planner than raw local angles)."""
        base = self.rest_world_angle(self.bones[parent_uid]) if parent_uid in self.bones else 0.0
        local = world_angle - base
        return self.create_bone(name, parent_uid, x=x, y=y, length=length, angle=local, **kw)

    def world_angle_of(self, bone_uid: str, frame: float, worlds=None) -> float:
        worlds = worlds or self.solve(frame)
        w = worlds.get(bone_uid)
        return w.world_angle if w else 0.0

    def bone_by_name(self, name: str) -> Bone | None:
        return self.find(name)

    # ------------------------------------------------------------------- IK
    def add_ik_chain(self, root_name: str, mid_name: str, effector_name: str,
                     target_angle_deg: float | None = None, name: str = "IK") -> IKChain | None:
        """Create a 2 bone IK chain from three bone names (shoulder/elbow/wrist)."""
        root, mid, eff = (self.find(root_name), self.find(mid_name), self.find(effector_name))
        if not (root and mid and eff):
            return None
        chain = IKChain(name=name, bones=[root.uid, mid.uid, eff.uid])
        self.ik_chains.append(chain)
        if target_angle_deg is not None:
            chain.pole = 1.0 if target_angle_deg >= 0 else -1.0
        return chain

    def ik_target_tip(self, chain: IKChain) -> Bone | None:
        if not chain.bones:
            return None
        return self.bones.get(chain.bones[-1])

    def bake_ik(self, chain: IKChain, frames: range) -> int:
        """Write the IK result back as keyframes (so it becomes FK editable)."""
        count = 0
        for f in frames:
            worlds = self.solve(float(f))
            for uid in chain.bones:
                bone = self.bones.get(uid)
                w = worlds.get(uid)
                if bone is None or w is None:
                    continue
                parent_world = 0.0
                if bone.parent in worlds:
                    pw = worlds[bone.parent]
                    parent_world = pw.world_angle
                rest = bone.angle if bone.inherit_rotation else 0.0
                bone.rotation.set_key(int(f), w.world_angle - parent_world - rest)
                count += 1
        chain.enabled = False
        return count

    def bake_ik_to_pose(self, chain: IKChain, frames: range) -> None:
        self.bake_ik(chain, frames)

    def children(self, uid: str | None) -> list[Bone]:
        return [b for b in self.bones.values() if b.parent == uid]

    def roots(self) -> list[Bone]:
        return [b for b in self.bones.values() if not b.parent or b.parent not in self.bones]

    def ordered_bones(self) -> list[Bone]:
        """Depth first (parent before child) ordering."""
        out: list[Bone] = []

        def walk(bone: Bone) -> None:
            out.append(bone)
            for child in sorted(self.children(bone.uid), key=lambda b: self.order.index(b.uid)
                                if b.uid in self.order else 0):
                walk(child)
        for root in self.roots():
            walk(root)
        return out

    def depth_of(self, bone_uid: str) -> int:
        depth = 0
        bone = self.bones.get(bone_uid)
        guard = 0
        while bone is not None and bone.parent in self.bones and guard < 64:
            depth += 1
            bone = self.bones[bone.parent]
            guard += 1
        return depth

    def bind_part(self, part_key: str, layer_uid: str | None) -> None:
        if layer_uid is None:
            self.part_bindings.pop(part_key, None)
        else:
            self.part_bindings[part_key] = layer_uid

    def part_for_layer(self, layer_uid: str) -> str | None:
        for part, uid in self.part_bindings.items():
            if uid == layer_uid:
                return part
        return None

    def find(self, name_or_uid: str) -> Bone | None:
        if name_or_uid in self.bones:
            return self.bones[name_or_uid]
        low = name_or_uid.lower()
        for b in self.bones.values():
            if b.name.lower() == low:
                return b
        for b in self.bones.values():
            if low in b.name.lower():
                return b
        return None

    @property
    def animated(self) -> bool:
        return any(b.animated for b in self.bones.values()) or bool(self.pose_keys)

    def frame_range(self) -> tuple[int, int] | None:
        frames: list[int] = list(self.pose_keys.keys())
        for b in self.bones.values():
            for t in (b.rotation, b.offset_x, b.offset_y, b.scale):
                frames.extend(t.frames())
        for c in self.ik_chains:
            frames.extend(c.target_x.frames())
            frames.extend(c.target_y.frames())
        if not frames:
            return None
        return min(frames), max(frames)

    # -------------------------------------------------------------- solving
    def solve(self, frame: float, apply_ik: bool = True) -> dict[str, BoneWorld]:
        """Forward kinematics (+ IK where enabled) at ``frame``."""
        if apply_ik:
            for chain in self.ik_chains:
                if self.chain_active(chain):
                    continue  # IK handled below in a second pass
        worlds: dict[str, BoneWorld] = {}

        def walk(bone: Bone, parent: BoneWorld | None, parent_rotation: float = 0.0) -> None:
            if parent is None:
                pin = 1.0 if self.pinned else 0.0
                base_head = (self.root_offset[0] + bone.x + bone.offset_x.value_at(frame) * (1.0 - pin),
                             self.root_offset[1] + bone.y + bone.offset_y.value_at(frame) * (1.0 - pin))
                base_angle = 0.0
            else:
                ox = bone.offset_x.value_at(frame)
                oy = bone.offset_y.value_at(frame)
                c, s = math.cos(_rad(parent.world_angle)), math.sin(_rad(parent.world_angle))
                bx, by = bone.x + ox, bone.y + oy
                base_head = (parent.tail[0] + bx * c - by * s, parent.tail[1] + bx * s + by * c)
                base_angle = parent.world_angle if bone.inherit_rotation else 0.0
            rot = bone.apply_constraint(bone.rotation.value_at(frame), parent_rotation)
            local = bone.angle + rot
            world_angle = base_angle + local
            scale = bone.scale.value_at(frame) / 100.0
            length = bone.length * scale
            tail = (base_head[0] + math.cos(_rad(world_angle)) * length,
                    base_head[1] + math.sin(_rad(world_angle)) * length)
            worlds[bone.uid] = BoneWorld(base_head, tail, world_angle, local, length, scale)
            for child in self.children(bone.uid):
                walk(child, worlds[bone.uid], rot)

        for root in self.roots():
            walk(root, None, 0.0)

        if apply_ik:
            for chain in self.ik_chains:
                if self.chain_active(chain):
                    self._solve_chain(chain, frame, worlds)
        return worlds

    @staticmethod
    def chain_active(chain: IKChain) -> bool:
        """An IK chain drives the rig only when it is on *and* has targets."""
        return bool(chain.enabled and len(chain.bones) >= 2 and chain.target_x.keys
                    and chain.target_y.keys)

    # ------------------------------------------------------------------- IK
    def _solve_chain(self, chain: IKChain, frame: float, worlds: dict[str, BoneWorld]) -> None:
        bones = [self.bones.get(u) for u in chain.bones]
        bones = [b for b in bones if b is not None]
        if len(bones) < 2:
            return
        root = bones[0]
        root_world = worlds.get(root.uid)
        if root_world is None:
            return
        target = (chain.target_x.value_at(frame), chain.target_y.value_at(frame))
        if len(bones) == 2:
            self._solve_two_bone(bones, root_world.head, target, chain, worlds)
        else:
            self._solve_fabrik(bones, root_world.head, target, chain, worlds)
        # children follow the modified chain
        for bone in bones:
            w = worlds.get(bone.uid)
            if w is None:
                continue
            for child in self.children(bone.uid):
                if child.uid in chain.bones:
                    continue
                self._update_subtree(child, w, frame, worlds)

    def _update_subtree(self, bone: Bone, parent: BoneWorld, frame: float,
                        worlds: dict[str, BoneWorld]) -> None:
        ox = bone.offset_x.value_at(frame)
        oy = bone.offset_y.value_at(frame)
        c, s = math.cos(_rad(parent.world_angle)), math.sin(_rad(parent.world_angle))
        bx, by = bone.x + ox, bone.y + oy
        head = (parent.tail[0] + bx * c - by * s, parent.tail[1] + bx * s + by * c)
        rot = bone.apply_constraint(bone.rotation.value_at(frame),
                                    parent.local_angle if bone.inherit_rotation else 0.0)
        local = bone.angle + rot
        wa = parent.world_angle + local if bone.inherit_rotation else local
        length = bone.length * bone.scale.value_at(frame) / 100.0
        tail = (head[0] + math.cos(_rad(wa)) * length, head[1] + math.sin(_rad(wa)) * length)
        worlds[bone.uid] = BoneWorld(head, tail, wa, local, length)
        for child in self.children(bone.uid):
            self._update_subtree(child, worlds[bone.uid], frame, worlds)

    def _solve_two_bone(self, bones: list[Bone], root_head: tuple[float, float],
                        target: tuple[float, float], chain: IKChain,
                        worlds: dict[str, BoneWorld]) -> None:
        a, b = bones[0], bones[1]
        l1 = a.length * a.scale.value_at(0) / 100.0
        l2 = b.length * b.scale.value_at(0) / 100.0
        dx = target[0] - root_head[0]
        dy = target[1] - root_head[1]
        dist = math.hypot(dx, dy)
        dist = max(1e-3, min(dist, (l1 + l2) * 0.999))
        if dist < abs(l1 - l2) + 1e-3:
            dist = abs(l1 - l2) + 1e-3
        base_angle = _deg(math.atan2(dy, dx))
        # law of cosines
        cos_a = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1.0, 1.0)
        ang_a = _deg(math.acos(cos_a))
        a_local_world = base_angle + ang_a * chain.pole
        cos_b = clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1.0, 1.0)
        ang_b = 180.0 - _deg(math.acos(cos_b))
        b_local_world = a_local_world - ang_b * chain.pole
        self._set_world_angle(a, a_local_world, worlds)
        elbow_head = worlds[a.uid].tail
        new_b = BoneWorld(elbow_head,
                          (elbow_head[0] + math.cos(_rad(b_local_world)) * l2,
                           elbow_head[1] + math.sin(_rad(b_local_world)) * l2),
                          b_local_world, b_local_world - a_local_world, l2)
        worlds[b.uid] = new_b

    def _set_world_angle(self, bone: Bone, world_angle: float, worlds: dict[str, BoneWorld]) -> None:
        w = worlds[bone.uid]
        parent_angle = w.world_angle - w.local_angle
        rest = bone.angle if bone.inherit_rotation else 0.0
        want_local = world_angle - parent_angle
        clamped = rest + bone.clamp_rotation(want_local - rest)
        w.world_angle = parent_angle + clamped
        w.local_angle = clamped
        w.tail = (w.head[0] + math.cos(_rad(w.world_angle)) * w.length,
                  w.head[1] + math.sin(_rad(w.world_angle)) * w.length)

    def _solve_fabrik(self, bones: list[Bone], root_head: tuple[float, float],
                      target: tuple[float, float], chain: IKChain,
                      worlds: dict[str, BoneWorld]) -> None:
        points = [root_head] + [worlds[b.uid].tail for b in bones]
        lengths = [math.dist(points[i], points[i + 1]) for i in range(len(bones))]
        total = sum(lengths)
        if math.dist(points[0], target) > total:
            direction = math.atan2(target[1] - points[0][1], target[0] - points[0][0])
            pts = [points[0]]
            for ln in lengths:
                px, py = pts[-1]
                pts.append((px + math.cos(direction) * ln, py + math.sin(direction) * ln))
            points = pts
        else:
            base = points[0]
            for _ in range(24):
                points[-1] = target
                for i in range(len(points) - 2, -1, -1):
                    d = math.dist(points[i], points[i + 1])
                    if d < 1e-9:
                        continue
                    ln = lengths[i]
                    points[i] = (points[i + 1][0] + (points[i][0] - points[i + 1][0]) * ln / d,
                                 points[i + 1][1] + (points[i][1] - points[i + 1][1]) * ln / d)
                points[0] = base
                for i in range(len(points) - 1):
                    d = math.dist(points[i], points[i + 1])
                    if d < 1e-9:
                        continue
                    ln = lengths[i]
                    points[i + 1] = (points[i][0] + (points[i + 1][0] - points[i][0]) * ln / d,
                                     points[i][1] + (points[i + 1][1] - points[i][1]) * ln / d)
                if math.dist(points[-1], target) < 0.5:
                    break
        for i, bone in enumerate(bones):
            head, tail = points[i], points[i + 1]
            world_angle = _deg(math.atan2(tail[1] - head[1], tail[0] - head[0]))
            w = worlds[bone.uid]
            parent_angle = w.world_angle - w.local_angle
            rest = bone.angle if bone.inherit_rotation else 0.0
            local = rest + bone.clamp_rotation(world_angle - parent_angle - rest)
            worlds[bone.uid] = BoneWorld(head, tail, parent_angle + local, local,
                                         math.dist(head, tail))

    # ---------------------------------------------------------------- poses
    def capture_pose(self, frame: float) -> Pose:
        return {
            b.uid: (b.rotation.value_at(frame), b.offset_x.value_at(frame),
                    b.offset_y.value_at(frame))
            for b in self.bones.values()
        }

    def apply_pose(self, pose: Pose, frame: int, key: bool = True, replace: bool = False) -> None:
        if replace:
            for b in self.bones.values():
                b.rotation.remove_key(frame)
                b.offset_x.remove_key(frame)
                b.offset_y.remove_key(frame)
        for uid, entry in pose.items():
            rot, ox, oy = _pose_values(entry)
            bone = self.bones.get(uid)
            if bone is None:
                bone = self.find(uid)
            if bone is None:
                continue
            if key:
                bone.rotation.set_key(int(frame), float(rot))
                if abs(ox) > 1e-6 or abs(oy) > 1e-6 or bone.offset_x.keys:
                    bone.offset_x.set_key(int(frame), float(ox))
                    bone.offset_y.set_key(int(frame), float(oy))
            else:
                bone.rotation.default = float(rot)
                bone.offset_x.default = float(ox)
                bone.offset_y.default = float(oy)

    def clear_pose_keys(self) -> None:
        for b in self.bones.values():
            b.rotation.clear()
            b.offset_x.clear()
            b.offset_y.clear()
        self.pose_keys.clear()

    def shift_keys(self, offset: int) -> None:
        for b in self.bones.values():
            for t in (b.rotation, b.offset_x, b.offset_y, b.scale):
                for k in t.keys:
                    k.frame += offset
        self.pose_keys = {k + offset: v for k, v in self.pose_keys.items()}

    def scale_keys(self, factor: float) -> None:
        for b in self.bones.values():
            for t in (b.rotation, b.offset_x, b.offset_y, b.scale):
                t.retime(factor)

    # ------------------------------------------------------------------ io
    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name,
            "bones": [b.to_dict() for b in self.ordered_bones()],
            "order": list(self.order),
            "ik_chains": [c.to_dict() for c in self.ik_chains],
            "root_offset": list(self.root_offset),
            "scale": self.scale, "visible": self.visible,
            "pinned": self.pinned,
            "part_bindings": dict(self.part_bindings),
            "auto_rigged": self.auto_rigged,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Rig":
        rig = cls(d.get("name", "Character"))
        rig.uid = d.get("uid") or rig.uid
        for bd in d.get("bones", []):
            rig.add_bone(Bone.from_dict(bd))
        rig.order = [u for u in d.get("order", []) if u in rig.bones] or list(rig.bones.keys())
        rig.ik_chains = [IKChain.from_dict(c) for c in d.get("ik_chains", [])]
        rig.root_offset = tuple(d.get("root_offset", (0.0, 0.0)))  # type: ignore[arg-type]
        rig.scale = float(d.get("scale", 100.0))
        rig.visible = bool(d.get("visible", True))
        rig.pinned = bool(d.get("pinned", False))
        rig.part_bindings = dict(d.get("part_bindings", {}))
        rig.auto_rigged = bool(d.get("auto_rigged", False))
        return rig

    def clone(self, new_uid: bool = True) -> "Rig":
        rig = Rig.from_dict(self.to_dict())
        if new_uid:
            rig.uid = new_id("rig")
            remap = {b.uid: new_id("bone") for b in rig.bones.values()}
            for old_uid, new_uid_ in remap.items():
                bone = rig.bones.pop(old_uid)
                bone.uid = new_uid_
                rig.bones[new_uid_] = bone
            for b in rig.bones.values():
                if b.parent in remap:
                    b.parent = remap[b.parent]
            for c in rig.ik_chains:
                c.bones = [remap.get(x, x) for x in c.bones]
                c.uid = new_id("ik")
        return rig

    # ----------------------------------------------------------- niceties
    def bone_at_point(self, pos: tuple[float, float], worlds: dict[str, BoneWorld],
                      tolerance: float = 12.0) -> Bone | None:
        best, best_d = None, tolerance
        for uid, w in worlds.items():
            d = _point_segment_distance(pos, w.head, w.tail)
            if d < best_d:
                best, best_d = self.bones.get(uid), d
        return best

    def hit_test_head(self, pos: tuple[float, float], worlds: dict[str, BoneWorld],
                      radius: float = 10.0) -> Bone | None:
        for uid, w in worlds.items():
            if math.dist(pos, w.head) <= radius or math.dist(pos, w.tail) <= radius:
                return self.bones.get(uid)
        return None


def _point_segment_distance(p: tuple[float, float], a: tuple[float, float],
                            b: tuple[float, float]) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = clamp(t, 0.0, 1.0)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))
