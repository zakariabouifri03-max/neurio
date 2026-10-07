"""Premade animation library + project templates + starter asset library."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..engine import artgen
from ..model.document import Project, new_stick_rig
from ..model.layer import Layer
from ..model.scene import Scene
from .motion import MotionGenerator
from .poses import POSES, pose_from_dict, pose_to_dict


# --------------------------------------------------------------------------
# animation library
# --------------------------------------------------------------------------
@dataclass
class LibraryAnimation:
    name: str
    category: str = "General"
    description: str = ""
    frames: int = 24
    loop: bool = True
    poses: list[tuple[str, float]] = field(default_factory=list)   # (pose, t 0..1)
    cycle: bool = False                                            # auto-mirror halves
    layer_motion: dict = field(default_factory=dict)

    def duration_frames(self, fps: int = 24) -> int:
        return self.frames


def _cycle(poses: list[tuple[str, float]]) -> LibraryAnimation:
    raise NotImplementedError


ANIMATION_LIBRARY: list[LibraryAnimation] = [
    LibraryAnimation("Walk", "Locomotion", "Classic 24 frame walk cycle", 24, True,
                     poses=[("Walk Contact L", 0.0), ("Walk Down L", 0.125), ("Walk Pass L", 0.25),
                            ("Walk Up L", 0.375), ("Walk Contact L", 0.5), ("Walk Down L", 0.625),
                            ("Walk Pass L", 0.75), ("Walk Up L", 0.875)],
                     cycle=True, layer_motion={"distance": 420}),
    LibraryAnimation("Run", "Locomotion", "Fast 16 frame run with forward lean", 16, True,
                     poses=[("Run Contact L", 0.0), ("Run Push L", 0.25), ("Run Air L", 0.5),
                            ("Run Contact L", 0.75)],
                     cycle=True, layer_motion={"distance": 620}),
    LibraryAnimation("Jump", "Action", "Anticipation, take off, peak, land, recover", 36, False,
                     poses=[("Standing", 0.0), ("Jump Anticipation", 0.14), ("Jump Up", 0.28),
                            ("Jump Peak", 0.45), ("Jump Fall", 0.62), ("Jump Land", 0.78),
                            ("Jump Recovery", 0.9), ("Standing", 1.0)],
                     layer_motion={"height": 220}),
    LibraryAnimation("Idle", "Basic", "Soft breathing loop", 48, True,
                     poses=[("Idle", 0.0), ("Idle B", 0.5)]),
    LibraryAnimation("Wave", "Gesture", "Friendly wave with the right hand", 36, False,
                     poses=[("Standing", 0.0), ("Wave Up", 0.18), ("Wave Out", 0.36),
                            ("Wave Up", 0.54), ("Wave Out", 0.72), ("Wave Down", 0.86),
                            ("Standing", 1.0)]),
    LibraryAnimation("Sit", "Pose", "Sit down and settle", 30, False,
                     poses=[("Standing", 0.0), ("Sit", 0.7), ("Sit", 1.0)],
                     layer_motion={"move": 40}),
    LibraryAnimation("Stand Up", "Pose", "Stand up from a chair", 26, False,
                     poses=[("Sit", 0.0), ("Sit", 0.2), ("Standing", 0.85), ("Standing", 1.0)],
                     layer_motion={"move": -40}),
    LibraryAnimation("Dance", "Fun", "Two beat dance loop", 32, True,
                     poses=[("Dance A", 0.0), ("Idle", 0.25), ("Dance B", 0.5), ("Idle", 0.75)]),
    LibraryAnimation("Point", "Gesture", "Point forward and hold", 28, False,
                     poses=[("Standing", 0.0), ("Point", 0.45), ("Point", 1.0)]),
    LibraryAnimation("Talk", "Gesture", "Talking gestures loop", 40, True,
                     poses=[("Talk A", 0.0), ("Talk B", 0.33), ("Talk A", 0.66)]),
    LibraryAnimation("Turn Around", "Locomotion", "Turn away and back", 32, False,
                     poses=[("Standing", 0.0), ("Turn Away", 0.35), ("Turn Away", 0.6),
                            ("Standing", 1.0)],
                     layer_motion={"mirror": True}),
    LibraryAnimation("Fighting", "Action", "Guard stance with punches", 36, True,
                     poses=[("Fighting", 0.0), ("Punch", 0.25), ("Fighting", 0.5), ("Kick", 0.75)]),
    LibraryAnimation("Surprised", "Emotion", "Startled jump and settle", 26, False,
                     poses=[("Standing", 0.0), ("Surprised", 0.25), ("Surprised", 0.5),
                            ("Standing", 1.0)],
                     layer_motion={"height": 60}),
    LibraryAnimation("Laughing", "Emotion", "Happy laugh loop", 30, True,
                     poses=[("Laughing", 0.0), ("Idle", 0.4), ("Laughing", 0.7)]),
    LibraryAnimation("Sleep", "Pose", "Lie down and sleep", 48, True,
                     poses=[("Standing", 0.0), ("Sleeping", 0.5), ("Sleeping", 1.0)]),
    LibraryAnimation("Thinking", "Emotion", "Thinking pose", 40, True,
                     poses=[("Idle", 0.0), ("Thinking", 0.5)]),
    LibraryAnimation("Stretch", "Action", "Stretch up then relax", 40, False,
                     poses=[("Standing", 0.0), ("Stretch", 0.4), ("Stretch", 0.6),
                            ("Standing", 1.0)]),
    LibraryAnimation("Entrance Bounce", "Fun", "Squash and stretch entrance", 30, False,
                     poses=[("Squash", 0.0), ("Standing", 0.5), ("Stretch", 0.75),
                            ("Standing", 1.0)],
                     layer_motion={"height": 160}),
    LibraryAnimation("Flying", "Action", "Float upwards with arms out", 48, True,
                     poses=[("Idle", 0.0), ("Stretch", 0.5)],
                     layer_motion={"float": True}),
    LibraryAnimation("Kick", "Action", "Roundhouse kick", 28, False,
                     poses=[("Fighting", 0.0), ("Kick", 0.4), ("Fighting", 0.85),
                            ("Standing", 1.0)]),
]

LIBRARY_CATEGORIES = ["All", "Locomotion", "Action", "Gesture", "Pose", "Emotion", "Basic",
                      "Fun"]


def library_by_name(name: str) -> LibraryAnimation | None:
    low = name.lower()
    for anim in ANIMATION_LIBRARY:
        if anim.name.lower() == low:
            return anim
    for anim in ANIMATION_LIBRARY:
        if low in anim.name.lower():
            return anim
    return None


def apply_animation(anim: LibraryAnimation, target_layer, scene, project,
                    start_frame: int = 1, fps: int = 24, loops: int = 1) -> str:
    """Apply a library animation to a rig layer or a raster layer."""
    motion = MotionGenerator(fps)
    rig = None
    if getattr(target_layer, "kind", "") == "rig":
        rig = scene.rigs.get(target_layer.rig_id or "")
    total = anim.frames * max(1, loops)
    step = anim.frames / max(1, len(anim.poses) - 1) if len(anim.poses) > 1 else anim.frames
    applied = 0
    if rig is not None:
        for loop in range(max(1, loops)):
            offset = loop * anim.frames
            for i, (pose_name, t) in enumerate(anim.poses):
                pose = POSES.get(pose_name)
                if pose is None:
                    continue
                frame = start_frame + offset + int(round(t * anim.frames))
                if anim.cycle and loop % 2 == 1 and i > 0:
                    from .poses import mirror_pose
                    pose = mirror_pose(pose)
                applied += motion.apply_pose(rig, pose, frame, "ease_in_out")
        if anim.cycle:
            # resample with the procedural cycle for perfectly smooth loops
            cycle = anim.frames
            if anim.name == "Walk":
                motion.procedural_walk(rig, start_frame, cycle, max(1, loops))
            elif anim.name == "Run":
                motion.procedural_run(rig, start_frame, cycle, max(1, loops))
    else:
        # no rig: animate the layer itself (movement + squash for weight)
        lm = anim.layer_motion
        if lm.get("distance"):
            motion.move_layer(target_layer, start_frame, start_frame + total,
                              x=float(lm["distance"]) * max(1, loops))
        if lm.get("height"):
            motion.bounce_in(target_layer, start_frame, float(lm["height"]), total // 3)
        elif lm.get("float"):
            base = target_layer.transform["pos.y"].value_at(start_frame)
            target_layer.transform["pos.y"].set_key(start_frame, base, easing="ease_in_out")
            target_layer.transform["pos.y"].set_key(start_frame + total, base - 120,
                                                    easing="ease_in_out")
        else:
            motion.bounce_in(target_layer, start_frame, 28.0, max(8, total // 3))
    scene.frame_end = max(scene.frame_end, start_frame + total)
    return f"{anim.name}: {applied} keyed values over {total} frames"


# --------------------------------------------------------------------------
# project templates
# --------------------------------------------------------------------------
@dataclass
class TemplateInfo:
    name: str
    description: str
    size: tuple[int, int] = (1920, 1080)
    fps: int = 24
    build: str = ""
    palette: str = "Cartoon Bright"


def _add_bg(scene: Scene, project: Project, kind: str, palette_name: str,
            frame_end: int) -> Layer:
    img = artgen.background(kind, (scene.width, scene.height), palette_name)
    asset = project.add_asset(f"bg_{kind}.png", "image", artgen.image_to_png(img),
                              folder="Backgrounds", tags=[kind.lower(), "background"], meta={})
    layer = scene.new_layer(f"Background · {kind}", "raster", 0)
    from ..model.cel import BitmapCel
    cel = BitmapCel((scene.width, scene.height), image=img)
    layer.set_cel(scene.frame_start, cel, hold=max(0, frame_end - scene.frame_start))
    return layer


def _add_character(scene: Scene, project: Project, name: str, height: float,
                   x: float, palette_name: str, style: str = "round",
                   rigged: bool = True) -> Layer:
    if not rigged:
        img = artgen.stick_figure(height)
        asset = project.add_asset(f"{name}_stick.png", "image", artgen.image_to_png(img),
                                  folder="Characters", tags=["stick", "character"], meta={})
        layer = scene.new_layer(name, "raster", len(scene.layers))
        from ..model.cel import BitmapCel
        cel = BitmapCel((scene.width, scene.height))
        from PySide6.QtGui import QPainter
        p = QPainter(cel.image)
        p.drawImage(int(x), int(scene.height * 0.9 - height), img)
        p.end()
        layer.set_cel(scene.frame_start, cel, hold=max(0, scene.frame_end - scene.frame_start))
        return layer
    rig = new_stick_rig(name, height, (0.0, 0.0))
    layer = scene.attach_rig_layer(rig, name, len(scene.layers))
    layer.transform["pos.x"].set_key(scene.frame_start, x, easing="ease_in_out")
    layer.transform["pos.y"].set_key(scene.frame_start, scene.height * 0.86, easing="ease_in_out")
    _ = palette_name, style
    return layer


def _add_title(scene: Scene, project: Project, text: str, subtitle: str, palette_name: str) -> Layer:
    from ..model.cel import BitmapCel
    img = artgen.title_card(text, (scene.width, scene.height), None, "#ffffff", subtitle)
    layer = scene.new_layer("Title", "raster", len(scene.layers))
    cel = BitmapCel((scene.width, scene.height), image=img)
    layer.set_cel(scene.frame_start, cel, hold=48)
    layer.transform["opacity"].set_key(scene.frame_start, 0, easing="ease_out")
    layer.transform["opacity"].set_key(scene.frame_start + 12, 100, easing="ease_in_out")
    layer.transform["opacity"].set_key(scene.frame_start + 48, 0, easing="ease_in")
    return layer


TEMPLATES: list[TemplateInfo] = [
    TemplateInfo("2D Cartoon", "Bird's eye intro: background, rigged character, title card",
                 (1920, 1080), 24, "cartoon"),
    TemplateInfo("Anime-style 2D", "Painted background with a rigged pastel character",
                 (1920, 1080), 24, "anime", "Anime Pastel"),
    TemplateInfo("Stick Figure", "Fast to draw, perfect for action tests", (1280, 720), 24,
                 "stick", "Noir"),
    TemplateInfo("Motion Graphics", "Bold shapes, camera moves and a graph editor friendly setup",
                 (1920, 1080), 30, "motion", "Neon"),
    TemplateInfo("Explainer Video", "Clean background, several scenes and a caption layer",
                 (1920, 1080), 30, "explainer", "Cartoon Bright"),
    TemplateInfo("Character Animation", "Full rig, side view and 24 fps timing sheet",
                 (1920, 1080), 24, "character", "Cartoon Bright"),
    TemplateInfo("Social Media Animation", "Square format for feed posts", (1080, 1080), 30,
                 "social", "Sunset"),
]


def template_names() -> list[str]:
    return [t.name for t in TEMPLATES]


def template_by_name(name: str) -> TemplateInfo | None:
    for t in TEMPLATES:
        if t.name.lower() == name.lower():
            return t
    return None


def build_template(info: TemplateInfo | str) -> Project:
    """Create a ready to animate project from a template."""
    if isinstance(info, str):
        info = template_by_name(info) or TEMPLATES[0]
    project = Project(info.name, info.size, info.fps)
    scene = project.active_scene
    scene.name = "Scene 1"
    scene.frame_end = 96
    style = info.build or "cartoon"

    if style == "stick":
        scene.background_color = "#f7f7f5"
        _add_bg(scene, project, "Gradient", info.palette, 96)
        _add_character(scene, project, "Stick Hero", 420, scene.width * 0.3, info.palette,
                       rigged=True)
        project.notes = "Draw on the layers, animate the rig or use the AI assistant."
    elif style == "anime":
        _add_bg(scene, project, "Sky", info.palette, 96)
        _add_character(scene, project, "Hero", 460, scene.width * 0.3, info.palette, "anime")
        _add_title(scene, project, "Episode 1", "MotionForge Studio", info.palette)
    elif style == "motion":
        scene.background_color = "#0d0f17"
        _add_bg(scene, project, "Space", info.palette, 96)
        cam = scene.camera()
        cam.zoom.set_key(1, 140, easing="ease_in_out")
        cam.zoom.set_key(48, 100, easing="ease_in_out")
        cam.pos_x.set_key(1, scene.width * 0.45)
        cam.pos_x.set_key(48, scene.width * 0.55, easing="ease_in_out")
        title = _add_title(scene, project, "MOTION", "graphics demo", info.palette)
        title.transform["scale.x"].set_key(1, 60, easing="back_out")
        title.transform["scale.y"].set_key(1, 60, easing="back_out")
        title.transform["scale.x"].set_key(24, 100, easing="ease_in_out")
        title.transform["scale.y"].set_key(24, 100, easing="ease_in_out")
        for i, kind in enumerate(("Star", "Balloon", "Heart")):
            img = artgen.prop(kind, 200)
            asset = project.add_asset(f"{kind}.png", "image", artgen.image_to_png(img),
                                      folder="Props", tags=["prop", kind.lower()])
            layer = scene.new_layer(f"Prop · {kind}", "raster", len(scene.layers))
            from ..model.cel import BitmapCel
            from PySide6.QtGui import QPainter
            cel = BitmapCel((scene.width, scene.height))
            p = QPainter(cel.image)
            p.drawImage(int(scene.width * (0.2 + i * 0.25)), int(scene.height * 0.6), img)
            p.end()
            layer.set_cel(scene.frame_start, cel, hold=95)
            layer.transform["pos.y"].set_key(1, 0, easing="ease_out")
            layer.transform["pos.y"].set_key(48, -80 - i * 30, easing="ease_in_out")
            layer.transform["pos.y"].set_key(96, 0, easing="ease_in")
            layer.transform["rotation"].set_key(1, -20 + i * 20, easing="ease_in_out")
            layer.transform["rotation"].set_key(96, 20 - i * 20, easing="ease_in_out")
            _ = asset
    elif style == "explainer":
        _add_bg(scene, project, "Office", info.palette, 96)
        scene2 = project.add_scene("Scene 2")
        scene2.width, scene2.height = scene.width, scene.height
        _add_bg(scene2, project, "School", info.palette, 96)
        _add_character(scene, project, "Presenter", 430, scene.width * 0.25, info.palette)
        _add_title(scene, project, "How it works", "3 quick steps", info.palette)
    elif style == "social":
        _add_bg(scene, project, "Beach", info.palette, 60)
        _add_character(scene, project, "Star", 380, scene.width * 0.3, info.palette)
        _add_title(scene, project, "NEW!", "swipe up", info.palette)
    elif style == "character":
        scene.background_color = "#f4f1ec"
        _add_bg(scene, project, "Gradient", info.palette, 96)
        layout = scene.new_layer("Layout · ground", "raster", 1)
        from ..model.cel import BitmapCel, VectorCel
        lay_cel = VectorCel((scene.width, scene.height))
        ground_y = scene.height * 0.86
        lay_cel.add_stroke({"kind": "line", "points": [[0, ground_y, 1.0], [scene.width, ground_y, 1.0]],
                            "brush": {"size": 3, "color": [90, 100, 120, 255]},
                            "color": [140, 150, 175, 255]})
        layout.set_cel(scene.frame_start, lay_cel, hold=95)
        hero = _add_character(scene, project, "Hero", 470, scene.width * 0.35, info.palette)
        rig = scene.rigs.get(hero.rig_id or "")
        if rig is not None:
            motion = MotionGenerator(scene.fps)
            motion.apply_pose(rig, POSES["Standing"], 1, "ease_in_out")
            motion.apply_pose(rig, POSES["Idle B"], 24, "ease_in_out")
            motion.apply_pose(rig, POSES["Standing"], 48, "ease_in_out")
    else:  # cartoon
        _add_bg(scene, project, "Forest", info.palette, 96)
        _add_character(scene, project, "Hero", 450, scene.width * 0.3, info.palette)
        _add_title(scene, project, "MotionForge", "2D animation studio", info.palette)

    project.meta["template"] = info.name
    project.meta["description"] = info.description
    project.settings["background_color"] = scene.background_color
    return project


# --------------------------------------------------------------------------
# starter brush / asset library
# --------------------------------------------------------------------------
def install_default_assets(project: Project) -> None:
    """Fill the asset browser with brushes, palettes, mouth charts and props."""
    from ..engine.brushes import default_brushes
    for brush in default_brushes():
        project.add_asset(brush.name, "brush", data=None, folder="Brushes",
                          tags=["brush", brush.kind], meta={"brush": brush.to_dict()})
    for name, colors in artgen.PALETTES.items():
        project.add_asset(name, "palette", data=None, folder="Palettes", tags=["palette"],
                          meta={"colors": colors})
    from ..model.cel import BrushSettings  # noqa: F401
    mouths = artgen.mouth_shapes(180, 120)
    for label, img in mouths.items():
        project.add_asset(f"Mouth {label}", "image", artgen.image_to_png(img),
                          folder="Lip Sync", tags=["mouth", "lipsync", label.lower()],
                          meta={"viseme": label, "width": img.width(), "height": img.height()})
    for label, img in artgen.eye_shapes(110).items():
        project.add_asset(f"Eye {label}", "image", artgen.image_to_png(img),
                          folder="Lip Sync", tags=["eye", label.lower()], meta={})
    for kind in ("Chair", "Table", "Ball", "Tree", "Cloud", "Star", "Heart", "Box", "Arrow",
                 "Balloon", "Flower", "Rock"):
        img = artgen.prop(kind, 220)
        project.add_asset(kind, "image", artgen.image_to_png(img), folder="Props",
                          tags=["prop", kind.lower()], meta={"prop": kind})
    for kind in artgen.BACKGROUND_KINDS:
        img = artgen.background(kind, (960, 540))
        project.add_asset(f"BG {kind}", "image", artgen.image_to_png(img), folder="Backgrounds",
                          tags=["background", kind.lower()], meta={"background": kind})
    stick = artgen.stick_figure(400)
    project.add_asset("Stick Figure", "image", artgen.image_to_png(stick), folder="Characters",
                      tags=["character", "stick"], meta={})
    for name, pose in POSES.items():
        project.add_asset(name, "pose", data=None, folder="Poses", tags=["pose", name.lower()],
                          meta={"pose": pose_to_dict(pose)})
    for anim in ANIMATION_LIBRARY:
        project.add_asset(anim.name, "animation", data=None, folder="Animations",
                          tags=["animation", anim.category.lower()],
                          meta={"frames": anim.frames, "loop": anim.loop,
                                "poses": anim.poses, "category": anim.category,
                                "description": anim.description})


_ = (pose_from_dict, _cycle)
