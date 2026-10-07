"""The motion engine: poses -> keyframes, cycles, in-betweens, layer motion.

Everything the AI assistant and the animation library produce goes through this
module, which means AI output is always *plain editable animation data*.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage, QPainter, QTransform

from ..model.cel import BitmapCel, Cel, VectorCel
from ..model.easing import clamp, lerp
from ..model.keyframe import Track
from ..model.rig import Rig
from ..engine import vector as vec
from ..engine.render import paint_cel

# mapping from pose part names to the bone names used by the built-in rigs and
# by automatically generated characters
PART_ALIASES: dict[str, list[str]] = {
    "Pelvis": ["pelvis", "hip root", "root", "hips"],
    "Spine": ["spine", "torso", "body", "abdomen"],
    "Chest": ["chest", "upper torso"],
    "Neck": ["neck"],
    "Head": ["head", "skull"],
    "L Shoulder": ["l shoulder", "left shoulder", "l upper arm", "left upper arm", "l arm", "left arm"],
    "R Shoulder": ["r shoulder", "right shoulder", "r upper arm", "right upper arm", "r arm", "right arm"],
    "L Elbow": ["l elbow", "left elbow", "l forearm", "left forearm"],
    "R Elbow": ["r elbow", "right elbow", "r forearm", "right forearm"],
    "L Hand": ["l hand", "left hand", "l wrist", "left wrist"],
    "R Hand": ["r hand", "right hand", "r wrist", "right wrist"],
    "L Hip": ["l hip", "left hip", "l thigh", "left thigh", "l leg", "left leg"],
    "R Hip": ["r hip", "right hip", "r thigh", "right thigh", "r leg", "right leg"],
    "L Knee": ["l knee", "left knee", "l shin", "left shin", "l calf", "left calf"],
    "R Knee": ["r knee", "right knee", "r shin", "right shin", "r calf", "right calf"],
    "L Foot": ["l foot", "left foot", "l ankle", "left ankle"],
    "R Foot": ["r foot", "right foot", "r ankle", "right ankle"],
}


def resolve_bone(rig: Rig, part_name: str):
    """Find the bone that matches a pose-library part name."""
    if part_name in rig.bones:
        return rig.bones[part_name]
    candidates = PART_ALIASES.get(part_name, [part_name.lower()])
    lowered = {b.name.lower(): b for b in rig.bones.values()}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    for cand in candidates:
        for name, bone in lowered.items():
            if cand in name or name in cand:
                return bone
    low = part_name.lower()
    for name, bone in lowered.items():
        if low in name:
            return bone
    return None


@dataclass
class MotionPreset:
    """A named, ready to apply animation (walk, run, jump...)."""

    name: str = "Motion"
    description: str = ""
    category: str = "General"
    frames: int = 24
    loop: bool = True
    kind: str = "pose_cycle"           # pose_cycle | pose_sequence | procedural
    poses: list[tuple[str, float]] = field(default_factory=list)   # (pose name, time 0..1)
    layer_motion: dict = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)


class MotionGenerator:
    """Writes animation onto rigs and layers."""

    def __init__(self, fps: int = 24):
        self.fps = max(1, int(fps))

    # ------------------------------------------------------------- poses
    def apply_pose(self, rig: Rig, pose: dict, frame: int, easing: str = "ease_in_out",
                   only_existing: bool = True) -> int:
        """Key a pose at ``frame``.  Returns how many bones were keyed."""
        from ..ai.poses import PartPose
        count = 0
        for part_name, part in pose.items():
            bone = resolve_bone(rig, part_name)
            if bone is None:
                continue
            if isinstance(part, PartPose):
                rot, ox, oy = part.as_tuple()
            elif isinstance(part, (list, tuple)):
                vals = list(part) + [0.0, 0.0]
                rot, ox, oy = float(vals[0]), float(vals[1]), float(vals[2])
            else:
                continue
            bone.rotation.set_key(int(frame), float(rot), easing=easing)
            if abs(ox) > 1e-6 or abs(oy) > 1e-6 or bone.offset_x.keys or bone.offset_y.keys:
                bone.offset_x.set_key(int(frame), float(ox), easing=easing)
                bone.offset_y.set_key(int(frame), float(oy), easing=easing)
            count += 1
        _ = only_existing
        return count

    def apply_pose_sequence(self, rig: Rig, frames_poses: list[tuple[int, dict]],
                           easing: str = "ease_in_out") -> int:
        total = 0
        for frame, pose in frames_poses:
            total += self.apply_pose(rig, pose, frame, easing)
        return total

    def motion_between(self, rig: Rig, pose_a: dict, pose_b: dict, start: int, end: int,
                       steps: int = 3, easing: str = "ease_in_out", arc: float = 0.0) -> int:
        """Interpolate between two poses with optional arc (limb follow-through)."""
        from ..ai.poses import blend_poses
        end = max(start + 1, end)
        count = 0
        for i in range(steps + 1):
            t = i / float(max(1, steps))
            pose = blend_poses(pose_a, pose_b, _ease_t(t, easing))
            frame = int(round(start + (end - start) * t))
            if arc and 0 < i < steps:
                pose = _add_arc(pose, arc * math.sin(math.pi * t))
            count += self.apply_pose(rig, pose, frame, "linear" if 0 < steps else easing)
        return count

    # ------------------------------------------------------------ cycles
    def generate_cycle(self, rig: Rig, poses: list[str], start: int, cycle_len: int,
                       cycles: int = 1, easing: str = "ease_in_out",
                       mirror_second_half: bool = True) -> int:
        """Key a looping cycle (walk, run, dance...) over ``cycles`` repetitions."""
        from ..ai.poses import POSES, mirror_pose, resolve_pose
        resolved = []
        for name in poses:
            pose = resolve_pose(name)
            if pose is None:
                pose = POSES.get(name, {})
            resolved.append(pose)
        if not resolved:
            return 0
        per = max(1, cycle_len // max(1, len(resolved)))
        total = 0
        for c in range(cycles):
            for i, pose in enumerate(resolved):
                frame = start + c * cycle_len + i * per
                use = pose
                if mirror_second_half and c % 2 == 1:
                    use = mirror_pose(pose)
                total += self.apply_pose(rig, use, frame, easing)
            if mirror_second_half and c % 2 == 1:
                continue
        # close the loop so playback is seamless
        end_frame = start + cycles * cycle_len
        first = resolved[0]
        total += self.apply_pose(rig, first, end_frame, easing)
        return total

    def procedural_walk(self, rig: Rig, start: int, cycle_len: int, cycles: int = 1,
                        stride: float = 1.0, bounce: float = 1.0) -> int:
        """Sine based walk - smooth and instantly readable."""
        hip_l = resolve_bone(rig, "L Hip")
        hip_r = resolve_bone(rig, "R Hip")
        knee_l = resolve_bone(rig, "L Knee")
        knee_r = resolve_bone(rig, "R Knee")
        sh_l = resolve_bone(rig, "L Shoulder")
        sh_r = resolve_bone(rig, "R Shoulder")
        pelvis = resolve_bone(rig, "Pelvis")
        frames = max(2, cycle_len * max(1, cycles))
        for i in range(frames + 1):
            f = start + i
            t = (i % cycle_len) / float(cycle_len)
            a = t * math.tau
            if hip_l:
                hip_l.rotation.set_key(f, 30 * stride * math.sin(a), easing="linear")
            if hip_r:
                hip_r.rotation.set_key(f, -30 * stride * math.sin(a), easing="linear")
            if knee_l:
                knee_l.rotation.set_key(f, -28 * stride * max(0.0, math.sin(a + 2.2)), easing="linear")
            if knee_r:
                knee_r.rotation.set_key(f, -28 * stride * max(0.0, math.sin(a + 2.2 + math.pi)),
                                        easing="linear")
            if sh_l:
                sh_l.rotation.set_key(f, -22 * stride * math.sin(a), easing="linear")
            if sh_r:
                sh_r.rotation.set_key(f, 22 * stride * math.sin(a), easing="linear")
            if pelvis:
                pelvis.offset_y.set_key(f, -abs(math.sin(a)) * 10 * bounce, easing="linear")
        return frames

    def procedural_run(self, rig: Rig, start: int, cycle_len: int, cycles: int = 1) -> int:
        frames = self.procedural_walk(rig, start, cycle_len, cycles, stride=1.8, bounce=1.8)
        lean = resolve_bone(rig, "Spine")
        if lean:
            for i in range(frames + 1):
                lean.rotation.set_key(start + i, 14, easing="linear")
        return frames

    # ------------------------------------------------------- layer motion
    def key_layer(self, layer, prop: str, frame: int, value: float,
                  easing: str = "ease_in_out") -> None:
        layer.transform[prop].set_key(int(frame), float(value), easing=easing)

    def move_layer(self, layer, start: int, end: int, x: float | None = None,
                   y: float | None = None, easing: str = "ease_in_out",
                   relative: bool = True) -> None:
        base_x = layer.transform["pos.x"].value_at(start) if relative else 0.0
        base_y = layer.transform["pos.y"].value_at(start) if relative else 0.0
        layer.transform["pos.x"].set_key(int(start), base_x, easing=easing)
        layer.transform["pos.y"].set_key(int(start), base_y, easing=easing)
        if x is not None:
            layer.transform["pos.x"].set_key(int(end), base_x + x if relative else x, easing=easing)
        if y is not None:
            layer.transform["pos.y"].set_key(int(end), base_y + y if relative else y, easing=easing)

    def shake_layer(self, layer, start: int, end: int, amplitude: float = 8.0,
                    frequency: float = 3.0, seed: int = 7) -> None:
        rng = random.Random(seed)
        track = layer.transform["pos.x"]
        for f in range(int(start), int(end) + 1):
            phase = (f - start) * frequency * math.tau / max(1, self.fps)
            track.set_key(f, math.sin(phase) * amplitude + track.value_at(f), easing="linear")
            layer.transform["pos.y"].set_key(
                f, math.cos(phase * 1.3) * amplitude * 0.6, easing="linear")
        _ = rng

    def bounce_in(self, layer, frame: int, height: float = 40.0, duration: int = 18,
                  squash: float = 12.0, easing: str = "ease_out") -> None:
        """Classic squash & stretch entrance."""
        t = layer.transform
        t["scale.x"].set_key(frame, 100 + squash * 1.6, easing="ease_out")
        t["scale.y"].set_key(frame, 100 - squash * 1.6, easing="ease_out")
        t["scale.x"].set_key(frame + duration // 3, 100 - squash, easing="ease_in_out")
        t["scale.y"].set_key(frame + duration // 3, 100 + squash, easing="ease_in_out")
        t["scale.x"].set_key(frame + duration, 100, easing="ease_out")
        t["scale.y"].set_key(frame + duration, 100, easing="ease_out")
        t["pos.y"].set_key(frame, t["pos.y"].value_at(frame) - height, easing="ease_in")
        t["pos.y"].set_key(frame + duration, t["pos.y"].value_at(frame + duration), easing="ease_out")

    # ------------------------------------------------------- in-betweens
    def inbetween_vector(self, a: VectorCel, b: VectorCel, t: float) -> VectorCel:
        """Interpolate two vector drawings (real in-betweening for line art)."""
        out = VectorCel(a.size)
        left = list(a.strokes)
        right = list(b.strokes)
        if not left:
            for s in right:
                out.add_stroke(_scale_stroke(s, 0.999))
            return out
        if not right:
            for s in left:
                out.add_stroke(_scale_stroke(s, 0.999))
            return out
        for i in range(max(len(left), len(right))):
            sa = left[i % len(left)]
            sb = right[i % len(right)]
            out.add_stroke(_blend_stroke(sa, sb, t))
        return out

    def inbetween_bitmap(self, a: BitmapCel, b: BitmapCel, t: float,
                         seed: int = 0, boil: float = 0.0) -> BitmapCel:
        """Shape aware dissolve - warps each drawing toward the other."""
        size = a.size if a.width * a.height >= b.width * b.height else b.size
        out = BitmapCel(size)
        img = out.image
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing, True)
        p.setRenderHint(QPainter.SmoothPixmapTransform, True)
        ba = a.content_bounds()
        bb = b.content_bounds()
        for cel, other, alpha in ((a, bb, 1.0 - t), (b, ba, t)):
            if alpha <= 0.01:
                continue
            src = cel.image
            target = QTransform()
            ob = other
            my = cel.content_bounds()
            if my and ob:
                cx_my, cy_my = my.center().x(), my.center().y()
                cx_ob, cy_ob = ob.center().x(), ob.center().y()
                dx = (cx_ob - cx_my) * (1.0 - 2 * abs(t - 0.5)) * 0.5
                dy = (cy_ob - cy_my) * (1.0 - 2 * abs(t - 0.5)) * 0.5
                sx = 1.0 + ((ob.width() / max(1, my.width())) - 1.0) * 0.08
                sy = 1.0 + ((ob.height() / max(1, my.height())) - 1.0) * 0.08
                target.translate(cx_my + dx, cy_my + dy)
                target.scale(sx, sy)
                target.translate(-cx_my, -cy_my)
            p.setOpacity(alpha)
            p.setTransform(target, False)
            p.drawImage(0, 0, src)
            p.setTransform(QTransform())
        if boil > 0.0:
            rng = random.Random(seed + int(round(t * 100)))
            jitter = QImage(img)
            p.setOpacity(1.0)
            for i in range(int(boil * 3)):
                ang = rng.uniform(-0.02, 0.02)
                dx = rng.uniform(-boil, boil)
                dy = rng.uniform(-boil, boil)
                p.setTransform(QTransform().translate(dx, dy).rotateRadians(ang), False)
                p.setOpacity(0.16)
                p.drawImage(0, 0, jitter)
        p.end()
        return out

    def create_inbetweens(self, layer, frame_a: int, frame_b: int, count: int,
                          seed: int = 0, boil: float = 0.0,
                          replace: bool = True) -> list[int]:
        """Generate ``count`` in-between cels between two drawings.

        Vector layers are interpolated stroke by stroke; raster layers use a
        shape aware dissolve.  Either way the result is normal editable cels.
        """
        hit_a = layer.cel_at(frame_a)
        hit_b = layer.cel_at(frame_b)
        if hit_a is None or hit_b is None or count <= 0:
            return []
        cel_a = hit_a[1].cel
        cel_b = hit_b[1].cel
        created: list[int] = []
        for i in range(1, count + 1):
            t = i / float(count + 1)
            frame = int(round(frame_a + (frame_b - frame_a) * t))
            if frame in (frame_a, frame_b):
                continue
            if replace and frame in layer.cels:
                del layer.cels[frame]
            if isinstance(cel_a, VectorCel) and isinstance(cel_b, VectorCel):
                new_cel = self.inbetween_vector(cel_a, cel_b, t)
            elif isinstance(cel_a, BitmapCel) and isinstance(cel_b, BitmapCel):
                new_cel = self.inbetween_bitmap(cel_a, cel_b, t, seed=seed, boil=boil)
            else:
                continue
            layer.set_cel(frame, new_cel)
            created.append(frame)
        return created

    def tween_layer(self, layer, start: int, end: int, ease: str = "ease_in_out") -> None:
        """Ensure a value exists at the beginning and end of an existing range."""
        props = layer.transform.animated_props()
        for prop in props:
            track = layer.transform[prop]
            v0 = track.value_at(start)
            v1 = track.value_at(end)
            track.set_key(start, v0, easing=ease)
            track.set_key(end, v1, easing=ease)

    # ------------------------------------------------------------ camera
    def move_camera(self, camera, start: int, end: int, x: float | None = None,
                    y: float | None = None, zoom: float | None = None,
                    rotation: float | None = None, easing: str = "ease_in_out") -> None:
        for track, value in ((camera.pos_x, x), (camera.pos_y, y), (camera.zoom, zoom),
                             (camera.rotation, rotation)):
            if value is None:
                continue
            track.set_key(int(start), track.value_at(start), easing=easing)
            track.set_key(int(end), float(value), easing=easing)

    def camera_zoom(self, camera, start: int, end: int, factor: float,
                    easing: str = "ease_in_out") -> None:
        base = camera.zoom.value_at(start)
        camera.zoom.set_key(int(start), base, easing=easing)
        camera.zoom.set_key(int(end), clamp(base * factor, 5.0, 800.0), easing=easing)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _ease_t(t: float, easing: str) -> float:
    from ..model.easing import apply_easing
    return apply_easing(easing, t)


def _add_arc(pose: dict, amount: float) -> dict:
    """Push limb rotations sideways so motion follows an arc instead of a line."""
    from ..ai.poses import PartPose, P
    out = dict(pose)
    for key in list(out.keys()):
        if key.startswith(("L ", "R ")) and ("Shoulder" in key or "Hip" in key):
            part = out[key]
            if isinstance(part, PartPose):
                out[key] = P(part.rot + amount, part.ox, part.oy)
            elif isinstance(part, (list, tuple)):
                out[key] = P(float(part[0]) + amount, float(part[1]), float(part[2]))
    return out


def _scale_stroke(stroke: dict, factor: float) -> dict:
    import copy as _copy
    s = _copy.deepcopy(stroke)
    s["uid"] = None
    from ..model.keyframe import new_id
    s["uid"] = new_id("s")
    s["points"] = [[p[0] * factor, p[1] * factor] + list(p[2:]) for p in stroke.get("points", [])]
    return s


def _blend_stroke(sa: dict, sb: dict, t: float) -> dict:
    """Blend two strokes, keeping geometry comparable (resampling as needed)."""
    import copy as _copy
    from ..model.keyframe import new_id
    pa = [list(p) for p in sa.get("points", [])]
    pb = [list(p) for p in sb.get("points", [])]
    if not pa:
        out = _copy.deepcopy(sb)
    elif not pb:
        out = _copy.deepcopy(sa)
    else:
        n = max(len(pa), len(pb))
        ra = _resample(pa, n)
        rb = _resample(pb, n)
        out = _copy.deepcopy(sa if len(sa.get("points", [])) >= len(sb.get("points", [])) else sb)
        out["points"] = [[lerp(ra[i][0], rb[i][0], t), lerp(ra[i][1], rb[i][1], t),
                          lerp(_p(ra[i]), _p(rb[i]), t)] for i in range(n)]
    out["uid"] = new_id("s")
    return out


def _p(point: list) -> float:
    return float(point[2]) if len(point) > 2 else 1.0


def _resample(points: list[list], count: int) -> list[list]:
    if len(points) == count:
        return points
    if len(points) == 1:
        return [points[0] for _ in range(count)]
    out = []
    for i in range(count):
        t = i / float(max(1, count - 1)) * (len(points) - 1)
        i0 = int(math.floor(t))
        i1 = min(len(points) - 1, i0 + 1)
        f = t - i0
        a, b = points[i0], points[i1]
        out.append([lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(_p(a), _p(b), f)])
    return out


def bake_rig_to_layer(rig: Rig, layer, project, scene, size: tuple[int, int] | None = None,
                      frame_start: int = 1, frame_end: int = 48, fps: int = 24,
                      transparent: bool = True, progress=None) -> int:
    """Flatten an animated rig into per-frame raster cels (paint-over workflow)."""
    from ..engine.render import RenderOptions, paint_rig, scene_to_output
    size = size or (scene.width, scene.height)
    made = 0
    for frame in range(frame_start, frame_end + 1):
        img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing, True)
        p.setRenderHint(QPainter.SmoothPixmapTransform, True)
        p.setTransform(scene_to_output(scene, frame, size), True)
        paint_rig(p, rig, project, float(frame))
        p.end()
        cel = BitmapCel(size, image=img)
        layer.set_cel(frame, cel)
        made += 1
        if progress and frame % 4 == 0:
            progress(frame - frame_start, frame_end - frame_start)
    _ = RenderOptions
    return made


_ = (Cel, vec, paint_cel, Track)
