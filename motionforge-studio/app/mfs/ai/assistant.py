"""The AI Animation Assistant.

Two planners cooperate:

* :class:`OfflineDirector` - a deterministic natural-language director that
  turns sentences like *"walk left to right, stop in the middle, wave, then
  keep walking"* into concrete, editable keyframes.  It always works, with no
  internet connection and no API key.
* :class:`LLMPlanner` - optional: when the user configures a provider, the same
  sentence plus a description of the scene is sent to the model, which answers
  with the *same* action JSON schema.  The result is applied through exactly the
  same code path, so the output is always normal keyframes the user can edit.

Nothing here renders video: the assistant only ever writes keyframes, poses and
layer transforms.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from ..model.rig import Rig
from . import poses as pose_lib
from .motion import MotionGenerator, resolve_bone
from .providers import AIError, AIProvider, OfflineProvider

JUMP_STAGES = [
    ("squash", 0.12, "Squash"),
    ("anticipation", 0.14, "Jump Anticipation"),
    ("rise", 0.18, "Jump Up"),
    ("peak", 0.16, "Jump Peak"),
    ("fall", 0.15, "Jump Fall"),
    ("land", 0.12, "Jump Land"),
    ("recovery", 0.13, "Jump Recovery"),
]

ACTION_KINDS = [
    "walk", "run", "jump", "jump_squash", "jump_anticipation", "jump_rise", "jump_peak",
    "jump_fall", "jump_land", "jump_recovery",
    "wave", "idle", "sit", "stand", "dance", "point", "talk",
    "turn", "laugh", "surprise", "sleep", "think", "kick", "punch", "fight", "stretch",
    "squash", "move", "rotate", "scale", "fade_in", "fade_out", "bounce", "shake",
    "zoom", "pan", "camera_cut", "camera_shake", "background", "prop", "text_layer",
    "pose", "wait", "loop", "scene", "add_character", "add_prop", "lipsync",
]

VERB_TABLE: list[tuple[str, list[str]]] = [
    ("jump", ["jump", "leap", "hop", "bounce up", "skip"]),
    ("run", ["run", "sprint", "rush", "dash", "jog"]),
    ("walk", ["walk", "walks", "walking", "stroll", "march", "step forward", "move forward",
              "move right", "move left"]),
    ("wave", ["wave", "waving", "greet", "hello gesture"]),
    ("dance", ["dance", "dancing", "groove", "boogie"]),
    ("sit", ["sit", "sits", "sitting", "take a seat", "sit down"]),
    ("stand", ["stand", "stands", "standing up", "get up", "stand up"]),
    ("sleep", ["sleep", "sleeping", "lie down", "nap"]),
    ("laugh", ["laugh", "laughing", "giggle", "chuckle"]),
    ("surprise", ["surprised", "surprise", "shocked", "startled", "amazed"]),
    ("think", ["think", "thinking", "ponder", "wonder", "consider"]),
    ("point", ["point", "pointing", "indicate", "show"]),
    ("talk", ["talk", "talking", "speak", "say", "chat", "explain"]),
    ("turn", ["turn around", "turn away", "turn", "face away", "rotate body"]),
    ("kick", ["kick", "kicks", "kicking"]),
    ("punch", ["punch", "punches", "jab", "strike"]),
    ("fight", ["fight", "fighting", "combat", "box", "battle"]),
    ("stretch", ["stretch", "reach up", "warm up"]),
    ("squash", ["squash", "crouch", "squat", "bend down"]),
    ("idle", ["idle", "breathe", "breathing", "wait patiently", "stand still"]),
    ("shake", ["shake", "shiver", "tremble", "vibrate"]),
    ("zoom", ["zoom in", "zoom out", "zoom", "close up", "close-up", "push in"]),
    ("pan", ["pan", "truck", "camera move", "follow"]),
    ("camera_shake", ["camera shake", "screen shake", "earthquake"]),
    ("camera_cut", ["cut to", "switch camera", "change camera", "camera 2"]),
    ("fade_in", ["fade in", "appear", "fade up"]),
    ("fade_out", ["fade out", "disappear", "fade to black"]),
    ("rotate", ["spin", "rotate", "twirl", "flip"]),
    ("scale", ["scale", "grow", "shrink", "get bigger", "get smaller", "enlarge"]),
    ("loop", ["loop", "repeat", "again", "over and over"]),
    ("wait", ["wait", "pause", "hold", "delay"]),
]

DIRECTION_WORDS = {
    "left": ("x", -1.0), "right": ("x", 1.0), "up": ("y", -1.0), "down": ("y", 1.0),
    "upwards": ("y", -1.0), "downwards": ("y", 1.0), "forward": ("x", 1.0),
    "backward": ("x", -1.0), "backwards": ("x", -1.0), "behind": ("x", -1.0),
}

BACKGROUND_WORDS = {
    "street": "Street", "road": "Street", "city": "City Night", "house": "House",
    "home": "House", "room": "Room", "office": "Office", "school": "School",
    "classroom": "School", "beach": "Beach", "sea": "Beach", "ocean": "Beach",
    "forest": "Forest", "woods": "Forest", "park": "Forest", "space": "Space",
    "night sky": "Space", "stage": "Stage", "theater": "Stage", "theatre": "Stage",
    "sky": "Sky",
}

PROP_WORDS = {
    "chair": "Chair", "seat": "Chair", "table": "Table", "desk": "Table", "ball": "Ball",
    "tree": "Tree", "cloud": "Cloud", "star": "Star", "heart": "Heart", "box": "Box",
    "crate": "Box", "arrow": "Arrow", "sign": "Sign", "book": "Book", "flower": "Flower",
    "rock": "Rock", "balloon": "Balloon", "balloons": "Balloon",
}

# default durations in seconds for every action
DEFAULT_SECONDS = {
    "walk": 1.0, "run": 0.7, "jump": 1.3, "wave": 1.2, "idle": 2.0, "sit": 1.5,
    "stand": 1.2, "dance": 2.0, "point": 0.8, "talk": 1.6, "turn": 0.9, "laugh": 1.2,
    "surprise": 0.7, "sleep": 2.0, "think": 1.5, "kick": 0.8, "punch": 0.6,
    "fight": 1.6, "stretch": 1.4, "squash": 0.5, "shake": 0.8, "zoom": 1.0, "pan": 1.2,
    "camera_shake": 0.5, "camera_cut": 0.1, "fade_in": 0.8, "fade_out": 0.8,
    "rotate": 1.0, "scale": 0.8, "bounce": 0.8, "wait": 1.0, "move": 1.0, "background": 0.1,
    "prop": 0.1, "text_layer": 0.1, "pose": 0.6, "loop": 1.0, "scene": 0.1,
    "lipsync": 0.0, "add_character": 0.1, "add_prop": 0.1,
}


@dataclass
class Action:
    kind: str
    start: int
    duration: int
    params: dict = field(default_factory=dict)
    label: str = ""

    @property
    def end(self) -> int:
        return self.start + max(0, self.duration)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "start": self.start, "duration": self.duration,
                "params": self.params, "label": self.label}

    @classmethod
    def from_dict(cls, d: dict, default_start: int = 1) -> "Action":
        return cls(str(d.get("kind", "wait")), int(d.get("start", default_start)),
                   int(d.get("duration", 12)), dict(d.get("params") or {}),
                   str(d.get("label", "")))

    def describe(self) -> str:
        if self.label:
            return self.label
        return f"{self.kind} ({self.duration} frames)"


@dataclass
class Plan:
    instruction: str
    actions: list[Action] = field(default_factory=list)
    summary: str = ""
    created_by: str = "offline"
    notes: list[str] = field(default_factory=list)

    @property
    def frame_end(self) -> int:
        return max([a.end for a in self.actions], default=1)

    def describe(self) -> str:
        if self.summary:
            return self.summary
        lines = []
        for i, a in enumerate(self.actions, 1):
            lines.append(f"{i}. {a.describe()}  ·  frames {a.start}–{a.end}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {"instruction": self.instruction, "created_by": self.created_by,
                "actions": [a.to_dict() for a in self.actions], "summary": self.summary,
                "notes": self.notes}

    @classmethod
    def from_dict(cls, d: dict) -> "Plan":
        return cls(str(d.get("instruction", "")),
                   [Action.from_dict(a) for a in d.get("actions", [])],
                   str(d.get("summary", "")), str(d.get("created_by", "offline")),
                   list(d.get("notes", [])))


# --------------------------------------------------------------------------
# natural language helpers
# --------------------------------------------------------------------------
NUMBER_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twice": 2, "thrice": 3, "once": 1,
    "couple": 2, "few": 3, "several": 4, "half": 0.5,
}

STEP_SPLIT = re.compile(r"\s*(?:,|;|\bthen\b|\band then\b|\bafter that\b|\bnext\b|\bfollowed by\b"
                        r"|\bafterwards?\b|\bfinally\b|\band\s+then\b|\n)\s*", re.IGNORECASE)


def split_steps(text: str) -> list[str]:
    parts = [p.strip(" .!?") for p in STEP_SPLIT.split(text or "")]
    out = []
    for p in parts:
        if not p:
            continue
        # "walk and wave" should stay together only if it is one phrase; keep
        # "and" separated unless it joins a noun phrase
        out.append(p)
    return out


def parse_number_of(text: str, default: float) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if m:
        return float(m.group(1))
    for word, value in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", text):
            return float(value)
    return default


def parse_seconds(text: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|secs\b|second|seconds)", text)
    if m:
        return float(m.group(1))
    m = re.search(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|half)\s+"
                  r"(?:second|seconds)\b", text)
    if m:
        return float(NUMBER_WORDS.get(m.group(1), 1.0))
    return None


def parse_frames(text: str) -> int | None:
    m = re.search(r"(\d+)\s*(?:f\b|frames?\b)", text)
    return int(m.group(1)) if m else None


def detect_direction(text: str) -> tuple[str, float] | None:
    low = text.lower()
    for word, axis in DIRECTION_WORDS.items():
        if re.search(rf"\b{word}\b", low):
            return axis
    return None


def detect_speed(text: str) -> float:
    low = text.lower()
    if re.search(r"\b(slow|slowly|gently|softly|relaxed)\b", low):
        return 1.6
    if re.search(r"\b(fast|quickly|quick|rapid|speed|speedy|snappy)\b", low):
        return 0.6
    if re.search(r"\bvery fast\b|\bblazing\b", low):
        return 0.4
    return 1.0


def detect_repeats(text: str) -> int:
    low = text.lower()
    m = re.search(r"(\d+)\s*(?:times|x\b|repeats?)", low)
    if m:
        return max(1, min(24, int(m.group(1))))
    for word in ("twice", "thrice", "again", "repeatedly", "over and over", "several times"):
        if word in low:
            return 2 if word in ("twice", "again") else 3
    return 1


def detect_style(text: str) -> str:
    low = text.lower()
    if "smooth" in low or "smoothly" in low or "soft" in low:
        return "ease_in_out"
    if "snappy" in low or "sharp" in low or "punchy" in low:
        return "back_out"
    if "bouncy" in low or "bounce" in low or "cartoony" in low or "cartoon" in low:
        return "bounce_out"
    if "elastic" in low or "springy" in low:
        return "elastic_out"
    if "linear" in low or "constant" in low:
        return "linear"
    return "ease_in_out"


# --------------------------------------------------------------------------
# offline director
# --------------------------------------------------------------------------
class OfflineDirector:
    """Rule based natural-language director (no network, no key)."""

    def __init__(self, fps: int = 24, scene_size: tuple[int, int] = (1920, 1080),
                 has_rig: bool = True):
        self.fps = max(1, int(fps))
        self.width, self.height = scene_size
        self.has_rig = has_rig
        self.motion = MotionGenerator(self.fps)

    # ------------------------------------------------------------ planning
    def plan(self, instruction: str, start_frame: int = 1) -> Plan:
        plan = Plan(instruction=instruction, created_by="offline")
        steps = split_steps(instruction)
        if not steps:
            plan.notes.append("I could not find an action in that sentence.")
            return plan
        cursor = int(start_frame)
        for step in steps:
            actions, cursor, notes = self._plan_step(step, cursor, plan)
            plan.actions.extend(actions)
            plan.notes.extend(notes)
        plan.summary = self._summarise(plan)
        return plan

    def _plan_step(self, step: str, cursor: int, plan: Plan) -> tuple[list[Action], int, list[str]]:
        low = step.lower()
        notes: list[str] = []
        actions: list[Action] = []
        seconds = parse_seconds(low)
        frames_override = parse_frames(low)
        speed = detect_speed(low)
        easing = detect_style(low)
        repeats = detect_repeats(low)
        direction = detect_direction(low)

        # background / scene switches happen before the main verb
        for word, kind in BACKGROUND_WORDS.items():
            if re.search(rf"\b{re.escape(word)}\b", low):
                adds = []
                if re.search(r"\b(room|house|stage|school|office|street|park|forest|beach)\b", low) \
                        and not re.search(r"\b(camera|zoom|pan)\b", low):
                    adds.append(Action("background", cursor, max(1, self.fps // 4),
                                       {"kind": kind}, f"Background → {kind}"))
                if adds:
                    actions.extend(adds)
                    plan.notes.append(f"Background set to {kind}.")
                break

        prop_kind = None
        for word, kind in PROP_WORDS.items():
            if re.search(rf"\b{word}\b", low):
                prop_kind = kind
                break

        verb, matched = self._match_verb(low)
        if verb is None and prop_kind:
            verb, matched = "prop", prop_kind.lower()
        if verb is None:
            pose = pose_lib.resolve_pose(strip_fillers(low))
            if pose is not None:
                verb = "pose"
                notes.append(f"Interpreted as pose '{strip_fillers(low)}'.")

        if verb is None:
            if re.search(r"\b(walk|move)\b", low):
                verb = "walk"
            else:
                notes.append(f"Skipped '{step}' - no known action.")
                return actions, cursor, notes

        seconds = seconds or DEFAULT_SECONDS.get(verb, 1.0) * speed
        duration = frames_override or max(2, int(round(seconds * self.fps)))

        # camera verbs
        if verb in ("zoom", "pan", "camera_shake", "camera_cut"):
            actions.append(Action(verb, cursor, max(1, duration),
                                  {"direction": direction, "factor": 1.6 if "in" in low else 0.7,
                                   "amount": self.width * 0.25, "easing": easing,
                                   "speed": speed}, self._label(verb, low, duration)))
            return actions, cursor + duration, notes

        # placement / layer verbs
        if verb == "wait":
            return actions, cursor + duration, notes

        # character verbs
        params = {"direction": direction, "easing": easing, "repeats": repeats,
                  "speed": speed, "prop": prop_kind}
        if verb == "walk" or verb == "run":
            dist = self.width * (0.45 if verb == "walk" else 0.6)
            dist *= speed if speed > 1 else 1.0
            axis = direction[0] if direction else "x"
            sign = direction[1] if direction else 1.0
            params["axis"] = axis
            params["distance"] = dist * sign
        if verb == "jump":
            params["height"] = self.height * 0.22
            # A jump is expanded into its seven animation stages so every part of
            # the motion (squash, anticipation, rise, peak, fall, land, recovery)
            # arrives in the timeline as editable keyframes.
            stages_beaten = 0
            stage_cursor = cursor
            for stage, weight, pose_name in JUMP_STAGES:
                span = max(2, int(round(duration * weight)))
                stage_params = dict(params)
                stage_params["pose"] = pose_name
                stage_params["height"] = self.height * 0.22
                actions.append(Action(f"jump_{stage}", stage_cursor, span, stage_params,
                                      f"Jump {stage} · {pose_name} · {span} f"))
                stage_cursor += span
                stages_beaten += span
            _ = stages_beaten
            return actions, stage_cursor, notes
        if verb == "sit" and prop_kind == "Chair":
            actions.append(Action("prop", cursor, 1, {"kind": "Chair", "side": "behind"},
                                  "Place a chair"))
        if verb == "turn":
            params["direction"] = direction or ("x", 1.0)
        actions.append(Action(verb, cursor, max(2, duration), params,
                              self._label(verb, low, duration)))
        return actions, cursor + duration, notes

    def _match_verb(self, low: str) -> tuple[str | None, str]:
        best: tuple[str | None, str, int] = (None, "", -1)
        for verb, words in VERB_TABLE:
            for word in words:
                idx = low.find(word)
                if idx < 0:
                    continue
                if idx > best[2]:
                    best = (verb, word, idx)
        return best[0], best[1]

    def _label(self, verb: str, text: str, duration: int) -> str:
        nice = verb.replace("_", " ").title()
        direction = detect_direction(text)
        extra = ""
        if direction and verb in ("walk", "run", "move"):
            extra = f" {str(direction[1] and ('right' if direction[1] > 0 else 'left'))}"
        return f"{nice}{extra}  ·  {duration} f"

    def _summarise(self, plan: Plan) -> str:
        parts = []
        for i, a in enumerate(plan.actions, 1):
            parts.append(f"{i}. {a.describe()}  (frames {a.start}–{a.end})")
        total = plan.frame_end
        head = (f"{len(plan.actions)} action(s), {total} frames "
                f"({total / self.fps:.1f} s at {self.fps} fps):")
        return head + "\n" + "\n".join(parts)


def strip_fillers(text: str) -> str:
    out = text.lower()
    for word in ("make the character", "make him", "make her", "make it", "have the character",
                 "the character should", "please", "can you", "he should", "she should",
                 "should", "create an animation where", "animate", "the", "a ", "an "):
        out = out.replace(word, " ")
    return " ".join(out.split()).strip()


# --------------------------------------------------------------------------
# LLM planner
# --------------------------------------------------------------------------
SYSTEM_PROMPT = """You are the animation director inside MotionForge Studio, a 2D animation app.
Convert the user's request into a list of animation actions.

Answer with JSON only, using this schema:
{"summary": "one short paragraph describing the animation",
 "actions": [
   {"kind": "<one of: KIND_LIST>",
    "start": <1-based start frame>,
    "duration": <frames>,
    "params": {"direction": ["x", 1.0], "distance": 600, "axis": "x", "height": 200,
               "repeats": 2, "factor": 1.6, "kind": "Chair", "easing": "ease_in_out"},
    "label": "short human readable label"}
 ]}

Rules:
- Output keyframes for a rig or a layer, never video.
- start frames must be sequential and non overlapping.
- Keep durations in frames for the given fps.
- Use only bone/layer driven actions from the list.
"""


class LLMPlanner:
    """Asks a configured provider for an action list, then validates it."""

    def __init__(self, provider: AIProvider, fps: int = 24,
                 scene_size: tuple[int, int] = (1920, 1080)):
        self.provider = provider
        self.fps = fps
        self.width, self.height = scene_size

    def plan(self, instruction: str, context: str = "", start_frame: int = 1) -> Plan:
        system = SYSTEM_PROMPT.replace("KIND_LIST", ", ".join(ACTION_KINDS))
        user = (f"Frames per second: {self.fps}.  Canvas: {self.width}x{self.height}.\n"
                f"Start frame: {start_frame}.\n")
        if context:
            user += f"Scene context:\n{context}\n"
        user += f"\nUser request: {instruction}"
        raw = self.provider.complete(system, user, json_mode=True, temperature=0.3)
        data = _extract_json(raw)
        plan = Plan(instruction=instruction, created_by=self.provider.name)
        for item in data.get("actions", []):
            kind = str(item.get("kind", "")).strip().lower()
            if kind not in ACTION_KINDS:
                continue
            plan.actions.append(Action(kind, int(item.get("start", start_frame)),
                                       int(item.get("duration", 12)),
                                       dict(item.get("params") or {}),
                                       str(item.get("label", ""))))
        plan.summary = str(data.get("summary", "")) or OfflineDirector(
            self.fps, (self.width, self.height))._summarise(plan)
        if not plan.actions:
            raise AIError("The model did not return any usable action.")
        return plan


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError as exc:
            raise AIError(f"Could not parse the model answer as JSON: {exc}") from exc
    raise AIError("The model answer contained no JSON object.")


def scene_context(scene, project, active_layer=None, rig=None, limit_assets: int = 24) -> str:
    """Compact description of the scene handed to the language model."""
    lines = []
    lines.append(f"Scenes: {', '.join(s.name for s in project.scenes)}")
    if scene:
        lines.append(f"Active scene: {scene.name} ({scene.width}x{scene.height}, "
                     f"{scene.fps} fps, frames {scene.frame_start}-{scene.frame_end})")
        chars = [lay.name for lay in scene.layers if lay.kind == "rig"]
        if chars:
            lines.append(f"Characters (rig layers): {', '.join(chars)}")
        rasters = [lay.name for lay in scene.layers if lay.kind in ("raster", "vector")]
        if rasters:
            lines.append(f"Drawing layers: {', '.join(rasters[:12])}")
    if rig is not None:
        names = [b.name for b in rig.ordered_bones()]
        lines.append(f"Selected character bones: {', '.join(names)}")
    if project:
        assets = [a.name for a in list(project.assets.values())[:limit_assets]]
        if assets:
            lines.append(f"Available assets: {', '.join(assets)}")
    if active_layer is not None:
        lines.append(f"Selected layer: {active_layer.name} ({active_layer.kind})")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# applying a plan to the document
# --------------------------------------------------------------------------
@dataclass
class ApplyTarget:
    project: object
    scene: object
    layer: object | None = None
    rig: Rig | None = None
    fps: int = 24
    canvas: tuple[int, int] = (1920, 1080)


class PlanApplier:
    """Turns a :class:`Plan` into keyframes / poses / scene changes."""

    def __init__(self, target: ApplyTarget):
        self.t = target
        self.fps = max(1, target.fps)
        self.motion = MotionGenerator(self.fps)

    # ------------------------------------------------------------- helpers
    def _rig(self) -> Rig | None:
        if self.t.rig is not None:
            return self.t.rig
        lay = self.t.layer
        if lay is not None and lay.kind == "rig" and self.t.scene is not None:
            self.t.rig = self.t.scene.rigs.get(lay.rig_id or "")
        return self.t.rig

    def _layer(self):
        return self.t.layer

    def _pose(self, names: list[str], start: int, per: int, easing: str,
              mirror: bool = False, cycles: int = 1) -> int:
        rig = self._rig()
        if rig is None:
            return 0
        count = 0
        for c in range(max(1, cycles)):
            for i, name in enumerate(names):
                pose = pose_lib.resolve_pose(name)
                if pose is None:
                    continue
                use = pose_lib.mirror_pose(pose) if (mirror and c % 2 == 1) else pose
                count += self.motion.apply_pose(rig, use, start + c * per * len(names) + i * per,
                                                easing)
        return count

    def _pose_sequence(self, items: list[tuple[str, int]], easing: str) -> int:
        rig = self._rig()
        if rig is None:
            return 0
        count = 0
        for name, frame in items:
            pose = pose_lib.resolve_pose(name)
            if pose is not None:
                count += self.motion.apply_pose(rig, pose, frame, easing)
        return count

    def _layer_motion(self, start: int, end: int, axis: str | None, amount: float,
                      easing: str, relative: bool = True) -> None:
        lay = self._layer()
        if lay is None or axis is None or abs(amount) < 0.5:
            return
        prop = "pos.x" if axis == "x" else "pos.y"
        base = lay.transform[prop].value_at(start)
        extra = lay.transform[prop].value_at(end) - base if not relative else 0.0
        lay.transform[prop].set_key(int(start), base, easing=easing)
        lay.transform[prop].set_key(int(end), base + amount + extra, easing=easing)

    def _bob(self, start: int, end: int, amount: float) -> None:
        """Vertical bob used when a layer has no rig (drawing based walk)."""
        lay = self._layer()
        if lay is None:
            return
        mid = (start + end) // 2
        base = lay.transform["pos.y"].value_at(start)
        lay.transform["pos.y"].set_key(start, base, easing="ease_in_out")
        lay.transform["pos.y"].set_key(mid, base - amount, easing="ease_in_out")
        lay.transform["pos.y"].set_key(end, base, easing="ease_in_out")

    # ------------------------------------------------------------- apply
    def apply(self, plan: Plan) -> list[str]:
        applied: list[str] = []
        for action in plan.actions:
            try:
                note = self.apply_action(action)
            except Exception as exc:  # never break the document
                note = f"⚠ {action.kind} failed: {exc}"
            if note:
                applied.append(note)
        if self.t.scene is not None:
            end = max(self.t.scene.total_frames(), plan.frame_end)
            self.t.scene.frame_end = end
        return applied

    def apply_action(self, a: Action) -> str:
        kind = a.kind
        start = int(a.start)
        end = int(a.end)
        duration = max(2, int(a.duration))
        params = a.params or {}
        easing = str(params.get("easing", "ease_in_out"))
        direction = params.get("direction")
        axis = params.get("axis") or (direction[0] if direction else None)
        sign = direction[1] if direction else 1.0

        if kind == "walk":
            amount = float(params.get("distance", self.t.canvas[0] * 0.45)) * (1 if not direction else sign)
            if axis == "y":
                amount = float(params.get("distance", self.t.canvas[1] * 0.3)) * sign
            if self._rig() is not None:
                self.motion.procedural_walk(self._rig(), start, max(6, int(self.fps * 0.6)),
                                            max(1, int(duration / max(1, self.fps * 0.6))))
                self._layer_motion(start, end, axis or "x", amount, easing)
            else:
                self._layer_motion(start, end, axis or "x", amount, easing)
                self._bob(start, end, 10.0)
            return f"Walk {('right' if (amount or 0) > 0 else 'left')} over {duration} frames"

        if kind == "run":
            amount = float(params.get("distance", self.t.canvas[0] * 0.7)) * (1 if not direction else sign)
            if self._rig() is not None:
                cycle = max(5, int(self.fps * 0.45))
                self.motion.procedural_run(self._rig(), start, cycle, max(1, int(duration / cycle)))
                self._layer_motion(start, end, axis or "x", amount, easing)
            else:
                self._layer_motion(start, end, axis or "x", amount, easing)
                self._bob(start, end, 18.0)
            return f"Run over {duration} frames"

        if kind.startswith("jump_"):
            stage = kind.split("_", 1)[1]
            pose_name = params.get("pose") or {
                "squash": "Squash", "anticipation": "Jump Anticipation", "rise": "Jump Up",
                "peak": "Jump Peak", "fall": "Jump Fall", "land": "Jump Land",
                "recovery": "Jump Recovery",
            }.get(stage, "Jump Peak")
            rig = self._rig()
            if rig is not None:
                self._pose_sequence([(pose_name, start), (pose_name, end)], easing)
            lay = self._layer()
            if lay is not None:
                base = lay.transform["pos.y"].value_at(start) if lay.transform["pos.y"].keys \
                    else lay.transform["pos.y"].value_at(end)
                height = float(params.get("height", self.t.canvas[1] * 0.22))
                offsets = {"squash": 0.0, "anticipation": 0.12, "rise": -0.35, "peak": -1.0,
                           "fall": -0.45, "land": 0.0, "recovery": 0.0}
                target_y = base + height * offsets.get(stage, 0.0)
                lay.transform["pos.y"].set_key(start, base,
                                               easing="ease_in" if stage in ("rise", "fall")
                                               else "ease_out")
                lay.transform["pos.y"].set_key(end, target_y,
                                               easing="ease_out" if stage == "peak"
                                               else "ease_in_out")
                if stage in ("squash", "land"):
                    lay.transform["scale.x"].set_key(start, 100, easing="ease_out")
                    lay.transform["scale.y"].set_key(start, 100, easing="ease_out")
                    lay.transform["scale.x"].set_key(end, 112, easing="ease_out")
                    lay.transform["scale.y"].set_key(end, 88, easing="ease_out")
                elif stage == "rise":
                    lay.transform["scale.x"].set_key(start, 112, easing="ease_out")
                    lay.transform["scale.y"].set_key(start, 88, easing="ease_out")
                    lay.transform["scale.x"].set_key(end, 96, easing="ease_out")
                    lay.transform["scale.y"].set_key(end, 104, easing="ease_out")
                elif stage == "recovery":
                    lay.transform["scale.x"].set_key(start, 96, easing="ease_out")
                    lay.transform["scale.y"].set_key(start, 104, easing="ease_out")
                    lay.transform["scale.x"].set_key(end, 100, easing="ease_out")
                    lay.transform["scale.y"].set_key(end, 100, easing="ease_out")
            return f"Jump stage '{stage}' ({pose_name})"

        if kind == "jump":
            height = float(params.get("height", self.t.canvas[1] * 0.22))
            anticipation = max(2, duration // 5)
            if self._rig() is not None:
                self._pose_sequence([
                    ("Jump Anticipation", start),
                    ("Jump Up", start + anticipation),
                    ("Jump Peak", start + int(duration * 0.45)),
                    ("Jump Fall", start + int(duration * 0.68)),
                    ("Jump Land", start + int(duration * 0.82)),
                    ("Jump Recovery", end),
                ], easing)
            lay = self._layer()
            if lay is not None:
                base = lay.transform["pos.y"].value_at(start)
                lay.transform["pos.y"].set_key(start, base, easing="ease_in")
                lay.transform["pos.y"].set_key(start + anticipation, base + height * 0.18,
                                               easing="ease_out")
                lay.transform["pos.y"].set_key(start + int(duration * 0.45), base - height,
                                               easing="ease_in_out")
                lay.transform["pos.y"].set_key(start + int(duration * 0.82), base, easing="ease_in")
                lay.transform["pos.y"].set_key(end, base, easing="ease_out")
                # squash & stretch on take off / landing
                for prop in ("scale.x", "scale.y"):
                    lay.transform[prop].set_key(start, 100, easing="ease_out")
                lay.transform["scale.x"].set_key(start + anticipation, 108, easing="ease_out")
                lay.transform["scale.y"].set_key(start + anticipation, 92, easing="ease_out")
                lay.transform["scale.x"].set_key(start + int(duration * 0.82), 112, easing="ease_out")
                lay.transform["scale.y"].set_key(start + int(duration * 0.82), 88, easing="ease_out")
                lay.transform["scale.x"].set_key(end, 100, easing="ease_out")
                lay.transform["scale.y"].set_key(end, 100, easing="ease_out")
            return "Jump with anticipation, peak and landing squash"

        if kind == "wave":
            repeats = max(1, int(params.get("repeats", 1)) * 2)
            span = max(2, duration // (repeats + 1))
            seq: list[tuple[str, int]] = [("Wave Up", start)]
            cursor = start + span
            for i in range(repeats):
                seq.append(("Wave Out" if i % 2 == 0 else "Wave Up", cursor))
                cursor += span
            seq.append(("Wave Down", min(cursor, end)))
            seq.append(("Standing", end))
            if self._rig() is None:
                lay = self._layer()
                if lay is not None:
                    lay.transform["rotation"].set_key(start, 0, easing="ease_out")
                    for i in range(repeats):
                        lay.transform["rotation"].set_key(
                            start + span * (i + 1), 7 if i % 2 == 0 else -7, easing="ease_in_out")
                    lay.transform["rotation"].set_key(end, 0, easing="ease_out")
                return f"Wave ×{repeats // 2} (rotation wobble - no rig on this layer)"
            self._pose_sequence(seq, easing)
            return f"Wave ×{repeats // 2} with the arm"

        if kind == "idle":
            if self._rig() is not None:
                cycle = max(8, int(self.fps))
                cycles = max(1, int(round(duration / cycle)))
                self._pose(["Idle", "Idle B"], start, max(4, cycle // 2), easing, False, cycles)
            return f"Idle breathing for {duration} frames"

        if kind == "dance":
            if self._rig() is not None:
                self._pose(["Dance A", "Dance B"], start, max(4, int(self.fps // 3)), easing,
                           False, max(1, int(duration / max(1, self.fps / 1.5))))
            else:
                self._bob(start, end, 16.0)
            return "Dance cycle"

        if kind in ("sit", "stand", "sleep", "laugh", "surprise", "think", "kick", "punch",
                    "fight", "stretch", "squash", "turn", "talk", "point", "pose"):
            pose_name = {
                "sit": "Sit", "stand": "Standing", "sleep": "Sleeping", "laugh": "Laughing",
                "surprise": "Surprised", "think": "Thinking", "kick": "Kick", "punch": "Punch",
                "fight": "Fighting", "stretch": "Stretch", "squash": "Squash",
                "turn": "Turn Away", "talk": "Talk A", "point": "Point",
            }.get(kind)
            if kind == "pose":
                pose_name = params.get("pose") or pose_lib.POSE_ALIASES.get(
                    str(params.get("name", "")).lower()) or str(params.get("name", "Standing"))
            if self._rig() is not None and pose_name:
                pose = pose_lib.resolve_pose(pose_name)
                if pose is not None:
                    if kind in ("talk", "laugh"):
                        alt = pose_lib.resolve_pose("Talk B" if kind == "talk" else "Laughing")
                        mid = start + duration // 2
                        self.motion.apply_pose(self._rig(), pose, start, easing)
                        if alt:
                            self.motion.apply_pose(self._rig(), alt, mid, easing)
                        self.motion.apply_pose(self._rig(), pose, end, easing)
                    else:
                        self.motion.apply_pose(self._rig(), pose, start, easing)
                        if kind in ("sit", "sleep", "fight"):
                            self.motion.apply_pose(self._rig(), pose, end, "ease_in_out")
                        else:
                            rest = pose_lib.resolve_pose("Standing") or {}
                            self.motion.apply_pose(self._rig(), rest, end, easing)
                    return f"Pose {pose_name}"
            lay = self._layer()
            if lay is not None and kind == "turn":
                base = lay.transform["scale.x"].value_at(start)
                lay.transform["scale.x"].set_key(start, base, easing="ease_in_out")
                lay.transform["scale.x"].set_key(start + duration // 2, -abs(base), easing="ease_in_out")
                lay.transform["scale.x"].set_key(end, base, easing="ease_in_out")
                return "Turn around (mirror)"
            return f"{kind.title()} (needs a character rig - applied what was possible)"

        if kind in ("move", "rotate", "scale", "fade_in", "fade_out", "bounce", "shake"):
            lay = self._layer()
            if lay is None:
                return f"{kind}: no layer selected"
            if kind == "move":
                amount = float(params.get("distance", self.t.canvas[0] * 0.4)) * (sign or 1.0)
                self._layer_motion(start, end, axis or "x", amount, easing)
                return f"Move layer {'+' if amount > 0 else ''}{amount:.0f}px"
            if kind == "rotate":
                lay.transform["rotation"].set_key(start, 0, easing=easing)
                lay.transform["rotation"].set_key(end, float(params.get("amount", 360)), easing=easing)
                return "Rotate"
            if kind == "scale":
                factor = float(params.get("factor", 1.25)) * 100
                lay.transform["scale.x"].set_key(start, 100, easing=easing)
                lay.transform["scale.y"].set_key(start, 100, easing=easing)
                lay.transform["scale.x"].set_key(end, factor, easing=easing)
                lay.transform["scale.y"].set_key(end, factor, easing=easing)
                return "Scale"
            if kind in ("fade_in", "fade_out"):
                target = 100.0 if kind == "fade_in" else 0.0
                other = 0.0 if kind == "fade_in" else 100.0
                lay.transform["opacity"].set_key(start, other, easing="ease_in_out")
                lay.transform["opacity"].set_key(end, target, easing="ease_in_out")
                return f"{kind.replace('_', ' ').title()}"
            if kind == "bounce":
                self.motion.bounce_in(lay, start, float(params.get("height", 40.0)), duration)
                return "Bounce"
            if kind == "shake":
                self.motion.shake_layer(lay, start, end, float(params.get("amplitude", 9.0)))
                return "Shake"

        if kind in ("zoom", "pan", "camera_cut", "camera_shake"):
            scene = self.t.scene
            if scene is None:
                return "camera: no scene"
            cam = scene.camera()
            if kind == "zoom":
                self.motion.camera_zoom(cam, start, end, float(params.get("factor", 1.6)), easing)
                return "Camera zoom"
            if kind == "pan":
                amount = float(params.get("amount", self.t.canvas[0] * 0.25)) * (sign or 1.0)
                self.motion.move_camera(cam, start, end, x=cam.pos_x.value_at(start) + amount,
                                        easing=easing)
                return "Camera pan"
            if kind == "camera_cut":
                cam2 = scene.add_camera()
                from ..model.camera import Shot
                scene.shots.append(Shot(f"Shot {len(scene.shots) + 1}", start, max(start + 1, end + 60),
                                        cam2.uid))
                return "Camera cut (new shot)"
            if kind == "camera_shake":
                cam.add_shake(start, float(params.get("amplitude", 18.0)),
                              max(2, duration), float(params.get("frequency", 8.0)))
                scene.active_camera_uid = cam.uid
                return "Camera shake"

        if kind in ("background", "prop", "text_layer", "add_prop", "add_character"):
            return self._add_scenery(kind, a)

        if kind == "scene":
            name = str(params.get("name", "")).strip()
            scene = self.t.project.scene_by_name(name) if (self.t.project and name) else None
            if scene is None and self.t.project is not None and name:
                scene = self.t.project.add_scene(name)
            if scene is not None and self.t.project is not None:
                self.t.project.active_scene_uid = scene.uid
                self.t.scene = scene
                return f"Switched to scene '{scene.name}'"
            return "Scene: nothing to switch to"

        if kind == "wait":
            return f"Hold for {duration} frames"

        if kind == "loop":
            return "Loop - apply the previous action repeatedly"

        return f"{kind}: applied"

    # --------------------------------------------------------- scenery
    def _add_scenery(self, kind: str, a: Action) -> str:
        from ..engine import artgen
        from ..model.cel import ImageCel
        scene = self.t.scene
        project = self.t.project
        if scene is None or project is None:
            return f"{kind}: no scene"
        params = a.params or {}
        if kind == "background":
            bg_kind = str(params.get("kind", "Gradient"))
            layer = scene.new_layer(f"Background · {bg_kind}", "raster", 0)
            asset = project.add_asset(f"bg_{bg_kind}.png", "image",
                                      artgen.image_to_png(artgen.background(
                                          bg_kind, (scene.width, scene.height))),
                                      folder="Backgrounds", tags=[bg_kind.lower(), "background"],
                                      meta={"width": scene.width, "height": scene.height})
            from ..model.cel import BitmapCel
            cel = BitmapCel((scene.width, scene.height),
                            image=_image_from_asset(project, asset.uid))
            layer.set_cel(scene.frame_start, cel)
            return f"Added '{bg_kind}' background layer"
        if kind in ("prop", "add_prop"):
            prop_kind = str(params.get("kind", "Chair"))
            size = scene.height * 0.28
            layer = scene.new_layer(f"Prop · {prop_kind}", "raster", len(scene.layers))
            img = artgen.prop(prop_kind, size)
            from ..model.cel import BitmapCel
            cel = BitmapCel((scene.width, scene.height))
            p = None
            from PySide6.QtGui import QPainter
            p = QPainter(cel.image)
            p.drawImage(int(scene.width * 0.62), int(scene.height * 0.55), img)
            p.end()
            layer.set_cel(scene.frame_start, cel)
            return f"Added prop '{prop_kind}'"
        if kind == "add_character":
            from ..model.document import new_stick_rig
            rig = new_stick_rig("New Character", scene.height * 0.45,
                                (scene.width * 0.35, scene.height * 0.8))
            lay = scene.attach_rig_layer(rig, "Character")
            return "Added a rigged character"
        if kind == "text_layer":
            from ..model.cel import TextCel
            text = str(params.get("text", "Text"))
            layer = scene.new_layer(f"Text · {text[:14]}", "text", len(scene.layers))
            cel = TextCel((scene.width, scene.height), text,
                          (scene.width * 0.1, scene.height * 0.12))
            cel.pixel_size = int(scene.height * 0.09)
            layer.set_cel(scene.frame_start, cel)
            return f"Added text '{text}'"
        return f"{kind}: nothing to add"


def _image_from_asset(project, asset_id: str):
    from ..engine.render import load_asset_image
    img = load_asset_image(project, asset_id)
    return img


# --------------------------------------------------------------------------
# high level facade used by the UI
# --------------------------------------------------------------------------
class AIAssistant:
    """Owns the provider, the planner and the applier."""

    def __init__(self, provider: AIProvider | None = None, fps: int = 24,
                 scene_size: tuple[int, int] = (1920, 1080)):
        self.provider = provider or OfflineProvider()
        self.fps = fps
        self.canvas = scene_size
        self.last_plan: Plan | None = None
        self.last_error = ""

    @property
    def uses_llm(self) -> bool:
        return not isinstance(self.provider, OfflineProvider) and self.provider.configured

    def plan(self, instruction: str, target: ApplyTarget) -> Plan:
        """Plan with the LLM when available, always falling back to offline."""
        self.last_error = ""
        offline = OfflineDirector(self.fps, self.canvas, has_rig=target.rig is not None)
        if self.uses_llm:
            try:
                context = scene_context(target.scene, target.project, target.layer, target.rig)
                planner = LLMPlanner(self.provider, self.fps, self.canvas)
                plan = planner.plan(instruction, context)
                plan.notes.append("Planned by " + self.provider.name)
                self.last_plan = plan
                return plan
            except AIError as exc:
                self.last_error = str(exc)
                fallback = offline.plan(instruction)
                fallback.notes.append(f"Provider unavailable ({exc}) - used the built-in director.")
                self.last_plan = fallback
                return fallback
        plan = offline.plan(instruction)
        self.last_plan = plan
        return plan

    def apply(self, plan: Plan, target: ApplyTarget) -> list[str]:
        applier = PlanApplier(target)
        result = applier.apply(plan)
        if target.project is not None:
            target.project.ai_log.append({
                "instruction": plan.instruction, "summary": plan.summary,
                "created_by": plan.created_by, "actions": len(plan.actions),
                "frames": plan.frame_end,
            })
        return result

    # --------------------------------------------------------- pose helpers
    def generate_pose(self, rig: Rig, description: str) -> tuple[dict | None, str]:
        pose = pose_lib.resolve_pose(description)
        if pose is None:
            return None, f"No pose matched '{description}'."
        return pose, f"Pose '{description}' generated - adjust it with the bone tools."

    def generate_motion(self, rig: Rig, pose_a: str, pose_b: str, start: int, end: int,
                        steps: int = 3, easing: str = "ease_in_out",
                        arc: float = 0.0) -> str:
        pa = pose_lib.resolve_pose(pose_a) or {}
        pb = pose_lib.resolve_pose(pose_b) or {}
        motion = MotionGenerator(self.fps)
        count = motion.motion_between(rig, pa, pb, start, end, steps, easing, arc)
        return (f"Generated {count} keyed bones between '{pose_a}' and '{pose_b}' "
                f"(frames {start}-{end}).")


_ = (re, field)
