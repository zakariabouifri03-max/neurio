"""The pose library.

Poses are expressed as *rotations relative to the rest pose* (degrees) plus an
optional root offset, keyed by a body part name.  Names are resolved against
the rig with fuzzy matching, so the library works with the built-in stick
figure, AI generated characters and any rig the user builds with the same
part naming (Shoulder / Elbow / Hand / Hip / Knee / Foot / Head / Spine ...).

Angle convention: 0 degrees points right (+X), 90 degrees points down (+Y),
so a leg pointing down is 90 and a raised arm is around -90 / 270.
"""
from __future__ import annotations

from dataclasses import dataclass

Pose = dict[str, "PartPose"]


@dataclass
class PartPose:
    rot: float = 0.0
    ox: float = 0.0
    oy: float = 0.0

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.rot, self.ox, self.oy)

    def blended(self, other: "PartPose", t: float) -> "PartPose":
        return PartPose(self.rot + (other.rot - self.rot) * t,
                        self.ox + (other.ox - self.ox) * t,
                        self.oy + (other.oy - self.oy) * t)


def P(rot: float = 0.0, ox: float = 0.0, oy: float = 0.0) -> PartPose:
    return PartPose(rot, ox, oy)


# --------------------------------------------------------------------------
# base poses
# --------------------------------------------------------------------------
POSES: dict[str, Pose] = {
    "Standing": {
        "Pelvis": P(0, 0, 0), "Spine": P(0), "Chest": P(0), "Neck": P(0), "Head": P(0),
        "L Shoulder": P(-6), "R Shoulder": P(6),
        "L Elbow": P(-8), "R Elbow": P(8),
        "L Hip": P(0), "R Hip": P(0), "L Knee": P(0), "R Knee": P(0),
    },
    "Idle": {
        "Pelvis": P(0, 0, 2), "Spine": P(2), "Chest": P(-2), "Neck": P(-1), "Head": P(1),
        "L Shoulder": P(-10), "R Shoulder": P(10),
        "L Elbow": P(-22), "R Elbow": P(22),
        "L Hip": P(-2), "R Hip": P(2), "L Knee": P(-4), "R Knee": P(-4),
    },
    "Idle B": {
        "Pelvis": P(0, 0, 6), "Spine": P(-1), "Chest": P(3), "Neck": P(2), "Head": P(-3),
        "L Shoulder": P(-14), "R Shoulder": P(6),
        "L Elbow": P(-30), "R Elbow": P(16),
        "L Hip": P(-3), "R Hip": P(1), "L Knee": P(-6), "R Knee": P(-2),
    },
    "Wave Up": {
        "R Shoulder": P(78), "R Elbow": P(52), "R Hand": P(-18),
        "L Shoulder": P(-12), "L Elbow": P(-26),
        "Chest": P(-4), "Head": P(-3),
    },
    "Wave Out": {
        "R Shoulder": P(66), "R Elbow": P(30), "R Hand": P(16),
        "L Shoulder": P(-10), "L Elbow": P(-24),
        "Chest": P(-3), "Head": P(-2),
    },
    "Wave Down": {
        "R Shoulder": P(74), "R Elbow": P(58), "R Hand": P(-8),
        "L Shoulder": P(-11), "L Elbow": P(-25),
        "Chest": P(-4), "Head": P(-4),
    },
    "Walk Contact L": {
        "L Hip": P(28), "L Knee": P(-10), "L Foot": P(-8),
        "R Hip": P(-26), "R Knee": P(-14), "R Foot": P(12),
        "Spine": P(3), "Chest": P(-2),
        "L Shoulder": P(20), "L Elbow": P(-30),
        "R Shoulder": P(-22), "R Elbow": P(34),
        "Pelvis": P(0, 0, -6),
    },
    "Walk Down L": {
        "L Hip": P(14), "L Knee": P(-18), "L Foot": P(4),
        "R Hip": P(-12), "R Knee": P(-42), "R Foot": P(18),
        "Spine": P(5), "Chest": P(-3),
        "L Shoulder": P(10), "L Elbow": P(-24),
        "R Shoulder": P(-12), "R Elbow": P(30),
        "Pelvis": P(0, 0, 2),
    },
    "Walk Pass L": {
        "L Hip": P(-2), "L Knee": P(-6), "L Foot": P(0),
        "R Hip": P(6), "R Knee": P(-58), "R Foot": P(6),
        "Spine": P(3), "Chest": P(-2),
        "L Shoulder": P(-4), "L Elbow": P(-20),
        "R Shoulder": P(4), "R Elbow": P(22),
        "Pelvis": P(0, 0, 6),
    },
    "Walk Up L": {
        "L Hip": P(-12), "L Knee": P(-4), "L Foot": P(-10),
        "R Hip": P(-18), "R Knee": P(-36), "R Foot": P(20),
        "Spine": P(4), "Chest": P(-2),
        "L Shoulder": P(6), "L Elbow": P(-22),
        "R Shoulder": P(-8), "R Elbow": P(26),
        "Pelvis": P(0, 0, 10),
    },
    "Run Contact L": {
        "L Hip": P(42), "L Knee": P(-24), "L Foot": P(-14),
        "R Hip": P(-44), "R Knee": P(-30), "R Foot": P(16),
        "Spine": P(12), "Chest": P(-6), "Neck": P(-6),
        "L Shoulder": P(46), "L Elbow": P(-84),
        "R Shoulder": P(-52), "R Elbow": P(88),
        "Pelvis": P(0, 0, -10),
    },
    "Run Push L": {
        "L Hip": P(18), "L Knee": P(-16), "L Foot": P(10),
        "R Hip": P(-40), "R Knee": P(-96), "R Foot": P(22),
        "Spine": P(14), "Chest": P(-8), "Neck": P(-8),
        "L Shoulder": P(52), "L Elbow": P(-92),
        "R Shoulder": P(-44), "R Elbow": P(76),
        "Pelvis": P(0, 0, 4),
    },
    "Run Air L": {
        "L Hip": P(-16), "L Knee": P(-52), "L Foot": P(-10),
        "R Hip": P(30), "R Knee": P(-70), "R Foot": P(18),
        "Spine": P(10), "Chest": P(-6), "Neck": P(-6),
        "L Shoulder": P(30), "L Elbow": P(-70),
        "R Shoulder": P(-36), "R Elbow": P(66),
        "Pelvis": P(0, 0, 16),
    },
    "Jump Anticipation": {
        "Pelvis": P(0, 0, 46), "Spine": P(14), "Chest": P(6), "Head": P(-8),
        "L Hip": P(52), "L Knee": P(-92), "L Foot": P(-18),
        "R Hip": P(48), "R Knee": P(-88), "R Foot": P(-14),
        "L Shoulder": P(-46), "L Elbow": P(-16),
        "R Shoulder": P(46), "R Elbow": P(16),
    },
    "Jump Up": {
        "Pelvis": P(0, 0, -18), "Spine": P(-8), "Chest": P(-6), "Head": P(6),
        "L Hip": P(-14), "L Knee": P(-8), "L Foot": P(26),
        "R Hip": P(-8), "R Knee": P(-14), "R Foot": P(24),
        "L Shoulder": P(-120), "L Elbow": P(-18),
        "R Shoulder": P(120), "R Elbow": P(18),
    },
    "Jump Peak": {
        "Pelvis": P(0, 0, -26), "Spine": P(-2), "Chest": P(0), "Head": P(2),
        "L Hip": P(34), "L Knee": P(-72), "L Foot": P(-6),
        "R Hip": P(30), "R Knee": P(-64), "R Foot": P(-4),
        "L Shoulder": P(-96), "L Elbow": P(-26),
        "R Shoulder": P(96), "R Elbow": P(26),
    },
    "Jump Fall": {
        "Pelvis": P(0, 0, -6), "Spine": P(-6), "Chest": P(-2),
        "L Hip": P(-18), "L Knee": P(-22), "L Foot": P(18),
        "R Hip": P(-12), "R Knee": P(-16), "R Foot": P(16),
        "L Shoulder": P(-58), "L Elbow": P(-40),
        "R Shoulder": P(58), "R Elbow": P(40),
    },
    "Jump Land": {
        "Pelvis": P(0, 0, 62), "Spine": P(18), "Chest": P(10), "Head": P(-10),
        "L Hip": P(60), "L Knee": P(-104), "L Foot": P(-20),
        "R Hip": P(56), "R Knee": P(-100), "R Foot": P(-16),
        "L Shoulder": P(-62), "L Elbow": P(-22),
        "R Shoulder": P(62), "R Elbow": P(22),
    },
    "Jump Recovery": {
        "Pelvis": P(0, 0, 22), "Spine": P(8), "Chest": P(4),
        "L Hip": P(24), "L Knee": P(-44), "L Foot": P(-6),
        "R Hip": P(22), "R Knee": P(-40), "R Foot": P(-4),
        "L Shoulder": P(-24), "L Elbow": P(-20),
        "R Shoulder": P(24), "R Elbow": P(20),
    },
    "Squash": {
        "Pelvis": P(0, 0, 40), "Spine": P(10), "Chest": P(8), "Head": P(-6),
        "L Hip": P(46), "L Knee": P(-80), "R Hip": P(44), "R Knee": P(-78),
        "L Shoulder": P(-30), "R Shoulder": P(30),
    },
    "Stretch": {
        "Pelvis": P(0, 0, -40), "Spine": P(-8), "Chest": P(-4), "Head": P(6),
        "L Hip": P(-10), "L Knee": P(-6), "R Hip": P(-10), "R Knee": P(-6),
        "L Shoulder": P(-150), "R Shoulder": P(150),
    },
    "Sit": {
        "Pelvis": P(0, 0, 70), "Spine": P(6), "Chest": P(4), "Head": P(2),
        "L Hip": P(96), "L Knee": P(-92), "L Foot": P(-16),
        "R Hip": P(94), "R Knee": P(-90), "R Foot": P(-14),
        "L Shoulder": P(18), "L Elbow": P(-52),
        "R Shoulder": P(-18), "R Elbow": P(52),
    },
    "Sit Cross": {
        "Pelvis": P(0, 0, 70), "Spine": P(4), "Chest": P(2),
        "L Hip": P(70), "L Knee": P(-118), "L Foot": P(-24),
        "R Hip": P(64), "R Knee": P(-112), "R Foot": P(-20),
        "L Shoulder": P(24), "L Elbow": P(-64),
        "R Shoulder": P(-24), "R Elbow": P(64),
    },
    "Fighting": {
        "Pelvis": P(0, 0, 18), "Spine": P(10), "Chest": P(-6), "Neck": P(-4), "Head": P(2),
        "L Hip": P(26), "L Knee": P(-52), "L Foot": P(-8),
        "R Hip": P(-18), "R Knee": P(-30), "R Foot": P(10),
        "L Shoulder": P(-82), "L Elbow": P(-86), "L Hand": P(-10),
        "R Shoulder": P(96), "R Elbow": P(104), "R Hand": P(8),
    },
    "Punch": {
        "Pelvis": P(0, 0, 14), "Spine": P(8), "Chest": P(12),
        "L Hip": P(20), "L Knee": P(-44),
        "R Hip": P(-14), "R Knee": P(-24),
        "R Shoulder": P(-176), "R Elbow": P(-6),
        "L Shoulder": P(120), "L Elbow": P(96),
    },
    "Kick": {
        "Pelvis": P(0, 0, 24), "Spine": P(-8), "Chest": P(-6),
        "L Hip": P(-92), "L Knee": P(-14), "L Foot": P(18),
        "R Hip": P(16), "R Knee": P(-30),
        "L Shoulder": P(-60), "R Shoulder": P(70), "R Elbow": P(40),
    },
    "Dance A": {
        "Pelvis": P(0, 0, 10), "Spine": P(-8), "Chest": P(10), "Head": P(-8),
        "L Hip": P(16), "L Knee": P(-30), "L Foot": P(-6),
        "R Hip": P(-10), "R Knee": P(-52), "R Foot": P(14),
        "L Shoulder": P(-140), "L Elbow": P(-40),
        "R Shoulder": P(40), "R Elbow": P(70),
    },
    "Dance B": {
        "Pelvis": P(0, 0, 6), "Spine": P(10), "Chest": P(-10), "Head": P(6),
        "L Hip": P(-8), "L Knee": P(-40), "L Foot": P(10),
        "R Hip": P(14), "R Knee": P(-26), "R Foot": P(-6),
        "L Shoulder": P(-36), "L Elbow": P(-76),
        "R Shoulder": P(146), "R Elbow": P(34),
    },
    "Point": {
        "L Shoulder": P(-14), "L Elbow": P(-30),
        "R Shoulder": P(-150), "R Elbow": P(-8), "R Hand": P(-4),
        "Spine": P(4), "Chest": P(6), "Head": P(4),
    },
    "Talk A": {
        "Head": P(-4), "Neck": P(2), "Chest": P(-3),
        "L Shoulder": P(-24), "L Elbow": P(-58),
        "R Shoulder": P(20), "R Elbow": P(50),
        "R Hand": P(-16),
    },
    "Talk B": {
        "Head": P(5), "Neck": P(-3), "Chest": P(2),
        "L Shoulder": P(-18), "L Elbow": P(-46),
        "R Shoulder": P(34), "R Elbow": P(70),
        "R Hand": P(20),
    },
    "Surprised": {
        "Pelvis": P(0, 0, -14), "Spine": P(-10), "Chest": P(-8), "Neck": P(8), "Head": P(10),
        "L Shoulder": P(-120), "L Elbow": P(-60),
        "R Shoulder": P(120), "R Elbow": P(60),
        "L Hip": P(-6), "R Hip": P(-4), "L Knee": P(-10), "R Knee": P(-10),
    },
    "Sleeping": {
        "Pelvis": P(0, 0, 60), "Spine": P(22), "Chest": P(30), "Neck": P(20), "Head": P(30),
        "L Shoulder": P(20), "L Elbow": P(-80),
        "R Shoulder": P(-20), "R Elbow": P(80),
        "L Hip": P(80), "L Knee": P(-80),
        "R Hip": P(70), "R Knee": P(-70),
    },
    "Thinking": {
        "Pelvis": P(0, 0, 6), "Spine": P(4), "Chest": P(-4), "Neck": P(4), "Head": P(8),
        "R Shoulder": P(120), "R Elbow": P(120), "R Hand": P(20),
        "L Shoulder": P(-12), "L Elbow": P(-40),
    },
    "Laughing": {
        "Spine": P(-6), "Chest": P(-10), "Neck": P(14), "Head": P(18),
        "L Shoulder": P(-40), "L Elbow": P(-70),
        "R Shoulder": P(40), "R Elbow": P(70),
        "Pelvis": P(0, 0, 10),
    },
    "Turn Away": {
        "Pelvis": P(0, 0, 4), "Spine": P(-4), "Chest": P(-8), "Neck": P(-14), "Head": P(-18),
        "L Shoulder": P(-16), "R Shoulder": P(16),
        "L Hip": P(6), "R Hip": P(-6),
    },
}

# aliases so the AI (and the user) can be loose with naming
POSE_ALIASES = {
    "stand": "Standing", "idle": "Idle", "breathing": "Idle", "wave": "Wave Up",
    "waving": "Wave Up", "walk": "Walk Contact L", "walking": "Walk Contact L",
    "run": "Run Contact L", "running": "Run Contact L", "jog": "Run Contact L",
    "jump": "Jump Up", "jumping": "Jump Up", "leap": "Jump Up",
    "crouch": "Jump Anticipation", "squat": "Jump Anticipation",
    "land": "Jump Land", "fall": "Jump Fall", "falling": "Jump Fall",
    "sit": "Sit", "sitting": "Sit", "seated": "Sit",
    "fight": "Fighting", "fighting": "Fighting", "boxing": "Fighting",
    "punch": "Punch", "kick": "Kick", "dance": "Dance A", "dancing": "Dance A",
    "point": "Point", "pointing": "Point", "talk": "Talk A", "talking": "Talk A",
    "speak": "Talk A", "surprise": "Surprised", "surprised": "Surprised",
    "shocked": "Surprised", "sleep": "Sleeping", "sleeping": "Sleeping",
    "think": "Thinking", "thinking": "Thinking", "laugh": "Laughing",
    "laughing": "Laughing", "turn": "Turn Away", "turning": "Turn Away",
    "back": "Turn Away", "stretch": "Stretch", "squash": "Squash",
}

POSE_CATEGORIES = {
    "Basic": ["Standing", "Idle", "Idle B", "Squash", "Stretch", "Turn Away"],
    "Locomotion": ["Walk Contact L", "Walk Down L", "Walk Pass L", "Walk Up L",
                   "Run Contact L", "Run Push L", "Run Air L"],
    "Action": ["Jump Anticipation", "Jump Up", "Jump Peak", "Jump Fall", "Jump Land",
               "Jump Recovery", "Kick", "Punch", "Fighting"],
    "Gestures": ["Wave Up", "Wave Out", "Wave Down", "Point", "Talk A", "Talk B",
                 "Thinking", "Laughing", "Surprised"],
    "Poses": ["Sit", "Sit Cross", "Sleeping", "Dance A", "Dance B"],
}


def resolve_pose(name: str) -> Pose | None:
    if not name:
        return None
    if name in POSES:
        return POSES[name]
    low = name.strip().lower()
    for key, pose in POSES.items():
        if key.lower() == low:
            return pose
    alias = POSE_ALIASES.get(low)
    if alias:
        return POSES.get(alias)
    if low in POSES:
        return POSES[low]
    for key, pose in POSES.items():
        if low in key.lower():
            return pose
    return None


def pose_names() -> list[str]:
    return list(POSES.keys())


def blend_poses(a: Pose, b: Pose, t: float) -> Pose:
    out: Pose = {}
    for name in set(a) | set(b):
        pa = a.get(name, P())
        pb = b.get(name, P())
        out[name] = pa.blended(pb, t)
    return out


def get_pose(name: str) -> Pose | None:
    """Look a pose up by name, mirroring an *L* pose for the *R* variant.

    Only the left side of every cycle is authored by hand; "Walk Contact R"
    is produced by mirroring "Walk Contact L", exactly like animators do.
    """
    if not name:
        return None
    if name in POSES:
        return POSES[name]
    for suffix, other in ((" R", " L"), (" L", " R")):
        if name.endswith(suffix):
            base = name[:-len(suffix)]
            if base + other in POSES:
                return mirror_pose(POSES[base + other])
    return None


def mirror_pose(pose: Pose) -> Pose:
    """Mirror a pose left/right (used for walk/run cycle halves)."""
    out: Pose = {}
    for name, part in pose.items():
        swapped = name
        if name.startswith("L "):
            swapped = "R " + name[2:]
        elif name.startswith("R "):
            swapped = "L " + name[2:]
        elif name.startswith("Left"):
            swapped = "Right" + name[4:]
        elif name.startswith("Right"):
            swapped = "Left" + name[5:]
        out[swapped] = PartPose(-part.rot, -part.ox, part.oy)
    return out


def _values(entry):
    if isinstance(entry, (tuple, list)):
        vals = list(entry) + [0.0, 0.0]
        return float(vals[0]), float(vals[1]), float(vals[2])
    if isinstance(entry, dict):
        return (float(entry.get("rot", 0.0)), float(entry.get("ox", 0.0)),
                float(entry.get("oy", 0.0)))
    return float(entry.rot), float(entry.ox), float(entry.oy)


def pose_to_dict(pose: Pose) -> dict:
    """Serialise a pose, accepting PartPose objects, tuples or dicts."""
    out = {}
    for k, v in pose.items():
        r, ox, oy = _values(v)
        out[k] = [r, ox, oy]
    return out


def pose_from_dict(d: dict) -> Pose:
    out: Pose = {}
    for k, v in (d or {}).items():
        if isinstance(v, (list, tuple)):
            vals = list(v) + [0.0, 0.0]
            out[k] = P(float(vals[0]), float(vals[1]), float(vals[2]))
        elif isinstance(v, dict):
            out[k] = P(float(v.get("rot", 0.0)), float(v.get("ox", 0.0)), float(v.get("oy", 0.0)))
    return out
