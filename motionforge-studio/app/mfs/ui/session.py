"""Editor session: the single source of truth the whole UI binds to.

All document mutations go through here, which is what makes undo/redo,
autosave, the AI assistant and the panels consistent.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from PySide6.QtCore import QObject, QTimer, Signal
from PySide6.QtGui import QColor

from .. import APP_NAME, __version__
from ..ai.assistant import AIAssistant, ApplyTarget, Plan
from ..ai.lipsync import LipSyncAnalyzer, LipSyncTrack, apply_mouth_layer, apply_to_rig
from ..ai.library import LibraryAnimation, apply_animation, build_template, install_default_assets
from ..ai.motion import MotionGenerator, resolve_bone
from ..ai.poses import POSES, get_pose, pose_from_dict, pose_to_dict
from ..engine import artgen
from ..engine.audio_engine import AudioEngine
from ..engine.history import FuncCommand, History, MacroCommand
from ..engine.player import Player
from ..engine.render import clear_asset_cache
from ..io import project_file
from ..io.importers import import_any, split_character_assets, detect_character_parts, load_image
from ..model.cel import BitmapCel, BrushSettings, Cel, ImageCel, TextCel, VectorCel
from ..model.document import Project, new_stick_rig
from ..model.keyframe import PROP_LABELS
from ..model.layer import LAYER_KINDS, Layer
from ..model.rig import Bone, IKChain, Rig
from ..model.scene import Scene


def plan_frame_end(actions) -> int:
    return max([a.end for a in actions], default=1)


@dataclass
class ExportJob:
    settings: object
    thread: object


class EditorSession(QObject):
    project_changed = Signal()
    scene_changed = Signal()
    layers_changed = Signal()
    layer_selected = Signal(str)
    frame_changed = Signal(float)
    timeline_changed = Signal()
    canvas_changed = Signal()
    tool_changed = Signal(str)
    brush_changed = Signal()
    selection_changed = Signal()
    status_message = Signal(str)
    modified_changed = Signal(bool)
    history_changed = Signal()
    play_state_changed = Signal(bool)
    rig_changed = Signal()
    assets_changed = Signal()
    ai_message = Signal(str, str)          # role, text
    export_progress = Signal(int, int, str)
    export_finished = Signal(str)
    export_failed = Signal(str)

    def __init__(self, project: Project | None = None, parent=None):
        super().__init__(parent)
        self.project: Project = project or build_template("2D Cartoon")
        install_default_assets(self.project)
        self.history = History()
        self.player = Player(self)
        self.audio = AudioEngine(self)
        self.ai = AIAssistant(fps=self.project.fps,
                              scene_size=self.project.active_scene.size())

        self.active_layer_uid: str = ""
        self.selected_bones: list[str] = []
        self.active_ik_chain: str = ""
        self.ik_mode: bool = True
        self.auto_key: bool = True
        self.selected_cels: list[tuple[str, int]] = []
        self.tool = "brush"
        self.brush = BrushSettings()
        self.primary_color = QColor("#20222c")
        self.secondary_color = QColor("#ffffff")
        self.auto_key = True
        self.beginner_mode = self.project.settings.get("preview", {}).get("mode", "pro") != "pro"
        self.preview_quality = "normal"
        self.show_rig = True
        self.show_gizmos = True
        self.playing = False
        self.camera_view = False
        self.current_frame = float(self.project.active_scene.frame_start)
        self.autosave_timer = QTimer(self)
        self.autosave_timer.setInterval(int(self.project.settings.get("autosave", {})
                                            .get("interval_sec", 180)) * 1000)
        self.autosave_timer.timeout.connect(self.autosave)
        self._dirty = False
        self.pending_plan: Plan | None = None
        self.lipsync_tracks: dict[str, LipSyncTrack] = {}
        self._export_thread = None

        self.player.frame_changed.connect(self._on_player_frame)
        self.player.playing_changed.connect(self._on_playing)
        self.project.dirty = False
        self.history.changed.connect(lambda: self.history_changed.emit())
        self.history.action_done.connect(self._on_history_done)
        self._ensure_active_layer()

    # =====================================================================
    # basic state
    # =====================================================================
    @property
    def scene(self) -> Scene:
        return self.project.active_scene

    @property
    def fps(self) -> int:
        return self.scene.fps

    @property
    def frame(self) -> int:
        return int(round(self.current_frame))

    def active_layer(self) -> Layer | None:
        lay = self.scene.layer(self.active_layer_uid)
        if lay is None:
            self._ensure_active_layer()
            lay = self.scene.layer(self.active_layer_uid)
        return lay

    def _ensure_active_layer(self) -> None:
        if not self.scene.layers:
            self.scene.new_layer("Layer 1", "raster")
        if not self.scene.layer(self.active_layer_uid):
            drawable = [lay for lay in self.scene.layers if lay.kind in ("raster", "vector", "text")]
            target = drawable[-1] if drawable else self.scene.layers[0]
            self.active_layer_uid = target.uid

    def active_rig(self) -> Rig | None:
        lay = self.active_layer()
        if lay is not None and lay.kind == "rig":
            return self.scene.rigs.get(lay.rig_id or "")
        if self.selected_bones:
            for rig in self.scene.rigs.values():
                if any(b in rig.bones for b in self.selected_bones):
                    return rig
        return None

    def rig_layer_for(self, rig: Rig) -> Layer | None:
        for lay in self.scene.layers:
            if lay.rig_id == rig.uid:
                return lay
        return None

    def mark_dirty(self, dirty: bool = True) -> None:
        if self._dirty != dirty:
            self._dirty = dirty
            self.project.dirty = dirty
            self.modified_changed.emit(dirty)

    def push(self, cmd, merge: bool = False) -> None:
        self.history.push(cmd, merge)
        self.mark_dirty(True)
        self.canvas_changed.emit()
        self.timeline_changed.emit()

    def command(self, label: str, undo_fn, redo_fn, merge: bool = False) -> None:
        self.push(FuncCommand(label, undo_fn, redo_fn), merge)

    def _on_history_done(self, label: str, is_redo: bool) -> None:
        self.mark_dirty(True)
        for sig in (self.layers_changed, self.timeline_changed, self.canvas_changed,
                    self.rig_changed, self.assets_changed):
            sig.emit()
        self.status_message.emit(("Redid " if is_redo else "Undid ") + label)

    def undo(self) -> None:
        label = self.history.undo()
        if label is None:
            self.status_message.emit("Nothing to undo")

    def redo(self) -> None:
        label = self.history.redo()
        if label is None:
            self.status_message.emit("Nothing to redo")

    # =====================================================================
    # frame / playback
    # =====================================================================
    def _on_player_frame(self, frame: float) -> None:
        self.current_frame = frame
        self.frame_changed.emit(frame)
        self.canvas_changed.emit()
        if self.audio.available and self.playing:
            self.audio.sync(frame)

    def _on_playing(self, playing: bool) -> None:
        self.playing = playing
        self.play_state_changed.emit(playing)
        if playing:
            self.audio.load_scene(self.project, self.scene, self.fps)
            self.audio.play(self.current_frame)
            self.status_message.emit("Playing…")
        else:
            self.audio.pause()
            self.status_message.emit("Paused")

    def set_frame(self, frame: float, pause: bool = True) -> None:
        if pause:
            self.player.pause()
        self.player.seek(frame)

    def step_frame(self, delta: int) -> None:
        self.set_frame(self.current_frame + delta)

    def next_key(self, direction: int = 1) -> None:
        frames = sorted(self.scene.key_frames())
        cur = self.frame
        if direction > 0:
            for f in frames:
                if f > cur:
                    self.set_frame(f)
                    return
            self.set_frame(self.scene.frame_end)
        else:
            for f in reversed(frames):
                if f < cur:
                    self.set_frame(f)
                    return
            self.set_frame(self.scene.frame_start)

    def play_pause(self) -> None:
        self._sync_player_range()
        self.player.toggle()

    def _sync_player_range(self) -> None:
        self.player.set_fps(self.scene.fps)
        self.player.set_range(self.scene.frame_start, max(self.scene.frame_end,
                                                          self.scene.total_frames()))

    def set_fps(self, fps: int) -> None:
        old = self.scene.fps
        fps = max(1, min(120, int(fps)))
        if fps == old:
            return

        def do(value: int):
            self.scene.fps = value
            self.project.fps = value
            self._sync_player_range()
            self.mark_dirty(True)

        do(fps)
        self.command(f"FPS → {fps}", lambda: do(old), lambda: do(fps))
        self._sync_player_range()
        self.canvas_changed.emit()

    def set_loop(self, loop: bool) -> None:
        self.player.loop = loop
        self.project.settings["preview"]["loop"] = loop

    def set_scene_range(self, start: int, end: int) -> None:
        start, end = int(start), max(int(start) + 1, int(end))
        old = (self.scene.frame_start, self.scene.frame_end)

        def do(value):
            self.scene.frame_start, self.scene.frame_end = value
            self._sync_player_range()

        do((start, end))
        self.command("Timeline range", lambda: do(old), lambda: do((start, end)))
        self._sync_player_range()

    # =====================================================================
    # scenes
    # =====================================================================
    def select_scene(self, uid: str) -> None:
        if uid == self.project.active_scene_uid:
            return
        self.project.active_scene_uid = uid
        self.active_layer_uid = ""
        self.selected_bones = []
        self._ensure_active_layer()
        self._sync_player_range()
        self.set_frame(self.scene.frame_start)
        self.scene_changed.emit()
        self.layers_changed.emit()
        self.canvas_changed.emit()
        self.timeline_changed.emit()
        self.status_message.emit(f"Scene: {self.scene.name}")

    def add_scene(self, name: str | None = None, switch: bool = True) -> Scene:
        scene = self.project.add_scene(name)
        index = len(self.project.scenes) - 1

        def undo():
            self.project.remove_scene(scene.uid)

        def redo():
            if scene not in self.project.scenes:
                self.project.scenes.insert(index, scene)

        self.command(f"Add scene '{scene.name}'", undo, redo)
        if switch:
            self.select_scene(scene.uid)
        return scene

    def duplicate_scene(self, uid: str | None = None) -> None:
        uid = uid or self.scene.uid
        copy = self.project.duplicate_scene(uid)
        if copy is None:
            return
        self.command(f"Duplicate scene '{copy.name}'",
                     lambda: self.project.remove_scene(copy.uid),
                     lambda: self.project.scenes.append(copy))
        self.select_scene(copy.uid)

    def remove_scene(self, uid: str | None = None) -> None:
        uid = uid or self.scene.uid
        if len(self.project.scenes) <= 1:
            self.status_message.emit("A project needs at least one scene")
            return
        scene = self.project.scene(uid)
        if scene is None:
            return
        index = self.project.scenes.index(scene)

        def undo():
            self.project.scenes.insert(index, scene)
            self.project.active_scene_uid = scene.uid
            self.scene_changed.emit()
            self.layers_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()
            self.mark_dirty(True)

        def redo():
            self.project.remove_scene(uid)
            if self.project.scene(self.project.active_scene_uid) is None:
                self.project.active_scene_uid = self.project.scenes[
                    min(index, len(self.project.scenes) - 1)].uid
            self._ensure_active_layer()
            self.scene_changed.emit()
            self.layers_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()
            self.mark_dirty(True)

        self.command(f"Delete scene '{scene.name}'", undo, redo)
        redo()
        self.status_message.emit(f"Scene '{scene.name}' deleted")

    def rename_scene(self, uid: str, name: str) -> None:
        scene = self.project.scene(uid)
        if scene is None or scene.name == name:
            return
        old = scene.name
        scene.name = name
        self.command("Rename scene", lambda: setattr(scene, "name", old),
                     lambda: setattr(scene, "name", name))
        self.scene_changed.emit()
        self.mark_dirty(True)

    def set_scene_background(self, color: str) -> None:
        old = self.scene.background_color

        def do(value):
            self.scene.background_color = value
            self.canvas_changed.emit()

        do(color)
        self.command("Background colour", lambda: do(old), lambda: do(color))

    # =====================================================================
    # layers
    # =====================================================================
    def add_layer(self, kind: str = "raster", name: str | None = None,
                  index: int | None = None, parent: str | None = None) -> Layer:
        count = len([l for l in self.scene.layers if l.kind == kind])
        label = name or {
            "raster": f"Drawing {count + 1}", "vector": f"Vector {count + 1}",
            "group": f"Group {count + 1}", "rig": "Character", "text": "Text",
        }.get(kind, f"Layer {len(self.scene.layers) + 1}")
        layer = self.scene.new_layer(label, kind, index, parent)
        if kind in ("raster", "vector", "text") and not layer.cels:
            layer.new_cel(self.scene.frame_start, kind="vector" if kind == "vector" else
                          ("text" if kind == "text" else "bitmap"))
        self.active_layer_uid = layer.uid

        def undo():
            self.scene.remove_layer(layer.uid)

        def redo():
            if self.scene.layer(layer.uid) is None:
                self.scene.layers.insert(min(index if index is not None else len(self.scene.layers),
                                             len(self.scene.layers)), layer)

        self.command(f"Add layer '{layer.name}'", undo, redo)
        self.layers_changed.emit()
        self.layer_selected.emit(layer.uid)
        return layer

    def remove_layer(self, uid: str | None = None) -> None:
        uid = uid or self.active_layer_uid
        layer = self.scene.layer(uid)
        if layer is None:
            return
        if len([l for l in self.scene.layers if l.kind in ("raster", "vector", "text")]) <= 1 \
                and layer.kind in ("raster", "vector", "text"):
            self.status_message.emit("At least one drawing layer must stay")
            return
        scene = self.scene
        snapshot = (list(scene.layers),
                    {l.uid: list(l.children) for l in scene.layers},
                    {l.uid: l.parent_uid for l in scene.layers},
                    dict(scene.rigs))
        removed = scene.remove_layer(uid, recursive=True)
        after = (list(scene.layers),
                 {l.uid: list(l.children) for l in scene.layers},
                 {l.uid: l.parent_uid for l in scene.layers},
                 dict(scene.rigs))

        def do(state):
            scene.layers[:] = state[0]
            for lay in scene.layers:
                lay.children = list(state[1].get(lay.uid, lay.children))
                lay.parent_uid = state[2].get(lay.uid, lay.parent_uid)
            scene.rigs = dict(state[3])
            self._ensure_active_layer()
            self.layers_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()
            self.rig_changed.emit()

        self.command(f"Delete layer '{layer.name}'", lambda: do(snapshot), lambda: do(after))
        self._ensure_active_layer()
        self.layers_changed.emit()
        self.layer_selected.emit(self.active_layer_uid)
        self.rig_changed.emit()
        _ = removed

    def duplicate_layer(self, uid: str | None = None) -> None:
        uid = uid or self.active_layer_uid
        copy = self.scene.duplicate_layer(uid)
        if copy is None:
            return
        self.command(f"Duplicate '{copy.name}'",
                     lambda: self.scene.remove_layer(copy.uid),
                     lambda: self.scene.add_layer(copy, self.scene.layer_index(uid) + 1))
        self.active_layer_uid = copy.uid
        self.layers_changed.emit()
        self.layer_selected.emit(copy.uid)

    def rename_layer(self, uid: str, name: str) -> None:
        layer = self.scene.layer(uid)
        if layer is None or layer.name == name:
            return
        old = layer.name
        layer.name = name
        self.command("Rename layer", lambda: setattr(layer, "name", old),
                     lambda: setattr(layer, "name", name))
        self.layers_changed.emit()
        self.mark_dirty(True)

    def set_layer_prop(self, uid: str, prop: str, value, label: str | None = None,
                       merge: bool = False) -> None:
        layer = self.scene.layer(uid)
        if layer is None:
            return
        old = getattr(layer, prop, None)
        if old == value:
            return

        def do(v):
            setattr(layer, prop, v)
            self.layers_changed.emit()
            self.canvas_changed.emit()

        do(value)          # apply first, then register the undoable command
        self.push(FuncCommand(label or f"Layer {prop}", lambda: do(old), lambda: do(value)), merge)

    def move_layer(self, uid: str, new_index: int) -> None:
        old = self.scene.layer_index(uid)
        if old < 0 or old == new_index:
            return
        self.scene.move_layer(uid, new_index)
        now = self.scene.layer_index(uid)
        self.command("Reorder layer",
                     lambda: self.scene.move_layer(uid, old),
                     lambda: self.scene.move_layer(uid, now))
        self.layers_changed.emit()

    def set_layer_parent(self, uid: str, parent: str | None) -> None:
        layer = self.scene.layer(uid)
        if layer is None:
            return
        old = layer.parent_uid
        if not self.scene.set_parent(uid, parent):
            return
        self.command("Reparent layer", lambda: self.scene.set_parent(uid, old),
                     lambda: self.scene.set_parent(uid, parent))
        self.layers_changed.emit()
        self.canvas_changed.emit()

    def group_selected(self) -> None:
        scene = self.scene
        before = (list(scene.layers), {l.uid: list(l.children) for l in scene.layers},
                  {l.uid: l.parent_uid for l in scene.layers})
        group = scene.new_layer("Group", "group", len(scene.layers))
        members = [l for l in scene.layers if l.parent_uid is None and l.uid != group.uid
                   and l.kind != "group"]
        if not members:
            scene.remove_layer(group.uid)
            self.status_message.emit("Nothing to group — select some layers first")
            return
        for member in members:
            scene.set_parent(member.uid, group.uid)
        after = (list(scene.layers), {l.uid: list(l.children) for l in scene.layers},
                 {l.uid: l.parent_uid for l in scene.layers})

        def do(state):
            scene.layers[:] = state[0]
            for lay in scene.layers:
                lay.children = list(state[1].get(lay.uid, lay.children))
                lay.parent_uid = state[2].get(lay.uid, lay.parent_uid)
            self.layers_changed.emit()
            self.canvas_changed.emit()

        self.command("Group layers", lambda: do(before), lambda: do(after))
        self.layers_changed.emit()
        self.status_message.emit(f"Grouped {len(members)} layer(s)")

    # =====================================================================
    # drawing / cels
    # =====================================================================
    def current_cel(self, create: bool = False, layer: Layer | None = None,
                    frame: int | None = None, new_key_on_hold: bool = True) -> Cel | None:
        """The cel to draw on.

        Drawing on a frame that only shows the previous drawing's hold creates a
        fresh keyframe there (that is what every 2D package does), so the
        timeline always reflects what the user painted.
        """
        layer = layer or self.active_layer()
        if layer is None or layer.locked:
            return None
        frame = self.frame if frame is None else frame
        hit = layer.cel_at(frame)
        if hit is not None and not (create and new_key_on_hold and hit[0] != frame):
            return hit[1].cel
        if not create:
            return None
        kind = "vector" if layer.kind == "vector" else "bitmap"
        before = dict(layer.cels)
        cel = layer.new_cel(frame, kind=kind, copy_from=None)
        after = dict(layer.cels)

        def do(state):
            layer.cels = dict(state)
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command("New keyframe", lambda: do(before), lambda: do(after))
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.status_message.emit(f"New keyframe on '{layer.name}' at frame {frame}")
        return cel

    def add_frame(self, blank: bool = True, count: int = 1) -> None:
        layer = self.active_layer()
        if layer is None:
            return
        frame = self.frame
        before = dict(layer.cels)
        kind = "vector" if layer.kind == "vector" else "bitmap"
        for i in range(count):
            layer.new_cel(frame + i, kind=kind, blank=True)
        after = dict(layer.cels)
        self.command("Add frame", lambda: setattr(layer, "cels", dict(before)),
                     lambda: setattr(layer, "cels", dict(after)))
        self.set_frame(frame + count)
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def duplicate_frame(self, all_layers: bool = False) -> None:
        layers = self.scene.layers if all_layers else [self.active_layer()]
        before, after = {}, {}
        target = None
        for layer in layers:
            if layer is None:
                continue
            before[layer.uid] = dict(layer.cels)
            new_frame = layer.duplicate_cel(self.frame)
            if new_frame is not None and target is None:
                target = new_frame
        if not before:
            return
        for layer in layers:
            if layer is not None:
                after[layer.uid] = dict(layer.cels)

        def do(state, forward):
            for uid, cels in state.items():
                lay = self.scene.layer(uid)
                if lay is not None:
                    lay.cels = dict(cels)
            self.timeline_changed.emit()
            self.canvas_changed.emit()
            _ = forward

        self.command("Duplicate frame", lambda: do(before, False), lambda: do(after, True))
        if target is not None:
            self.set_frame(target)
        self.status_message.emit("Frame duplicated")

    def delete_frame(self, all_layers: bool = False, keep_art: bool = True) -> None:
        layers = self.scene.layers if all_layers else [self.active_layer()]
        before = self._cel_state(layers)
        for layer in layers:
            if layer is None:
                continue
            layer.delete_frame(self.frame, keep_hold=keep_art)
        after = self._cel_state(layers)

        def do(state):
            self._restore_cel_state(state)

        self.command("Delete frame", lambda: do(before), lambda: do(after))
        self.status_message.emit("Frame deleted")

    def insert_frame(self, count: int = 1, all_layers: bool = True) -> None:
        layers = self.scene.layers if all_layers else [self.active_layer()]
        before = {l.uid: (dict(l.cels), l.transform.copy()) for l in layers if l is not None}
        for layer in layers:
            if layer is not None:
                layer.insert_frame(self.frame, count)
        after = {l.uid: (dict(l.cels), l.transform.copy()) for l in layers if l is not None}

        def do(state):
            for uid, (cels, transform) in state.items():
                lay = self.scene.layer(uid)
                if lay is not None:
                    lay.cels = dict(cels)
                    lay.transform = transform.copy()
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command("Insert frame", lambda: do(before), lambda: do(after))

    def move_frame(self, from_frame: int, to_frame: int, all_layers: bool = True) -> None:
        layers = self.scene.layers if all_layers else [self.active_layer()]
        before = {l.uid: dict(l.cels) for l in layers if l is not None}
        for layer in layers:
            if layer is not None:
                layer.move_cel(from_frame, to_frame)
        after = {l.uid: dict(l.cels) for l in layers if l is not None}

        def do(state):
            for uid, cels in state.items():
                lay = self.scene.layer(uid)
                if lay is not None:
                    lay.cels = dict(cels)
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command("Move frame", lambda: do(before), lambda: do(after))
        self.set_frame(to_frame)

    def _cel_state(self, layers) -> dict:
        state = {}
        for layer in layers:
            if layer is None:
                continue
            state[layer.uid] = {frame: (ref.cel, ref.hold) for frame, ref in layer.cels.items()}
        return state

    def _restore_cel_state(self, state) -> None:
        for uid, cels in state.items():
            layer = self.scene.layer(uid)
            if layer is None:
                continue
            restored = {}
            for frame, (cel, hold) in cels.items():
                ref = layer.cels.get(frame)
                if ref is None:
                    from ..model.layer import CelRef
                    ref = CelRef(cel, hold)
                else:
                    ref.cel = cel
                    ref.hold = hold
                restored[frame] = ref
            layer.cels = restored
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def set_exposure(self, hold: int, all_layers: bool = False) -> None:
        layers = self.scene.layers if all_layers else [self.active_layer()]
        before = self._cel_state(layers)
        for layer in layers:
            if layer is not None:
                layer.set_exposure(self.frame, hold)
        after = self._cel_state(layers)

        def do(state):
            self._restore_cel_state(state)

        self.command(f"Exposure ×{hold}", lambda: do(before), lambda: do(after))
        self.status_message.emit(f"Exposure set to {hold} frames")

    def clear_cel(self) -> None:
        layer = self.active_layer()
        if layer is None:
            return
        hit = layer.cel_at(self.frame)
        if hit is None:
            return
        key, ref = hit
        if isinstance(ref.cel, BitmapCel):
            before = ref.cel.image.copy()
            ref.cel.clear()

            def undo():
                ref.cel.image = before.copy()

            def redo():
                ref.cel.clear()

            self.command("Clear cel", undo, redo)
        else:
            import copy as _copy
            before = _copy.deepcopy(getattr(ref.cel, "strokes", []))
            if hasattr(ref.cel, "strokes"):
                ref.cel.strokes.clear()

            def undo():
                if hasattr(ref.cel, "strokes"):
                    ref.cel.strokes = _copy.deepcopy(before)

            def redo():
                if hasattr(ref.cel, "strokes"):
                    ref.cel.strokes = []
            self.command("Clear cel", undo, redo)
        self.canvas_changed.emit()
        _ = key

    def convert_cel_to_vector(self) -> None:
        self.status_message.emit("Vector layers are created with the 'Vector' button in Layers")

    # =====================================================================
    # transform + keyframes
    # =====================================================================
    def set_transform_prop(self, layer: Layer, prop: str, value: float,
                           force_key: bool = False, merge: bool = False,
                           frame: int | None = None) -> None:
        if layer is None:
            return
        frame = self.frame if frame is None else frame
        track = layer.transform[prop]
        before = track.to_dict()
        if track.animated or self.auto_key or force_key:
            track.set_key(frame, value)
        else:
            track.default = value
        after = track.to_dict()
        self.canvas_changed.emit()
        self.timeline_changed.emit()

        def do(state):
            restored = track.__class__.from_dict(state)
            layer.transform[prop] = restored
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        label = PROP_LABELS.get(prop, prop)
        self.push(FuncCommand(f"{label}", lambda: do(before), lambda: do(after)), merge)

    def set_bone_rotation(self, bone: Bone, value: float, merge: bool = False,
                          frame: int | None = None) -> None:
        frame = self.frame if frame is None else frame
        old = bone.rotation.value_at(frame)
        trigger = bone.rotation.animated or self.auto_key
        if trigger:
            bone.rotation.set_key(frame, value)
        else:
            old = bone.rotation.default
            bone.rotation.default = value

        def do(new_value: float, forward: bool):
            if trigger and forward:
                bone.rotation.set_key(frame, new_value)
            else:
                bone.rotation.default = new_value
            self.canvas_changed.emit()
            self.timeline_changed.emit()
            self.rig_changed.emit()

        self.push(FuncCommand(f"{bone.name} rotation", lambda: do(old, False),
                              lambda: do(value, True)), merge)

    def key_bone_pose(self, bone_uid: str | None = None, props: tuple[str, ...] = ("rotation",)) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        bones = [rig.bones[bone_uid]] if bone_uid and bone_uid in rig.bones else \
            [rig.bones[u] for u in (self.selected_bones or list(rig.bones)) if u in rig.bones]
        frame = self.frame
        saved = []
        for bone in bones:
            for prop in props:
                track = getattr(bone, prop, None)
                if track is None:
                    continue
                saved.append((bone.uid, prop, frame in track.frames(),
                              track.value_at(frame), dict(track.to_dict())))
                track.set_key(frame, track.value_at(frame))

        def do(state, forward):
            for uid, prop, had, value, snapshot in state:
                b = rig.bones.get(uid)
                if b is None:
                    continue
                track = getattr(b, prop)
                if forward:
                    track.set_key(frame, value)
                else:
                    restored = track.__class__.from_dict(snapshot)
                    setattr(b, prop, restored)
            self.timeline_changed.emit()
            self.canvas_changed.emit()
            _ = had

        self.command("Key pose", lambda: do(saved, False), lambda: do(saved, True))
        self.status_message.emit(f"Keyed {len(bones)} bone(s) at frame {frame}")

    def key_transform(self, prop: str | None = None) -> None:
        layer = self.active_layer()
        rig = self.active_rig()
        if rig is not None and self.selected_bones:
            self.key_bone_pose()
            return
        if layer is None:
            return
        props = [prop] if prop else layer.transform.animated_props() or ["pos.x", "pos.y"]
        frame = self.frame
        before = {p: layer.transform[p].to_dict() for p in props}
        for p in props:
            track = layer.transform[p]
            track.set_key(frame, track.value_at(frame))
        after = {p: layer.transform[p].to_dict() for p in props}

        def do(state):
            for p, snap in state.items():
                layer.transform[p] = layer.transform[p].__class__.from_dict(snap)
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.command("Key transform", lambda: do(before), lambda: do(after))
        self.status_message.emit(f"Keyed {', '.join(props)} at frame {frame}")

    def delete_keys_at(self, frame: int | None = None) -> None:
        frame = self.frame if frame is None else frame
        layer = self.active_layer()
        removed = []
        rig = self.active_rig()
        if layer is not None:
            for prop, track in layer.transform.tracks.items():
                key = track.key_at(frame)
                if key is not None:
                    removed.append((layer.uid, None, prop, [key.to_dict()]))
        if rig is not None:
            for bone in rig.bones.values():
                for prop in ("rotation", "offset_x", "offset_y", "scale"):
                    track = getattr(bone, prop)
                    key = track.key_at(frame)
                    if key is not None:
                        removed.append((None, bone.uid, prop, [key.to_dict()]))
        if not removed:
            self.status_message.emit(f"No keys at frame {frame}")
            return
        self._remove_keys_state(removed)
        self.command(f"Delete {len(removed)} key(s)",
                     lambda: self._restore_keys_state(removed),
                     lambda: self._remove_keys_state(removed))
        self.status_message.emit(f"Deleted {len(removed)} key(s)")

    # =====================================================================
    # tool edits (undo units produced by engine.tools)
    # =====================================================================
    def apply_edits(self, edits: list, label: str | None = None) -> None:
        """Push the edits a tool produced as one undoable action."""
        edits = [e for e in edits if e is not None]
        if not edits:
            return
        if len(edits) == 1 and label is None:
            self.push(edits[0])
        else:
            macro = MacroCommand(label or getattr(edits[0], "label", "Draw"))
            for edit in edits:
                macro.add(edit)
            self.push(macro)
        self.mark_dirty(True)
        self.canvas_changed.emit()
        self.timeline_changed.emit()

    def _track_for(self, layer_uid: str | None, bone_uid: str | None, prop: str):
        """Resolve the live Track object for a (layer|bone, prop) pair."""
        if layer_uid:
            lay = self.scene.layer(layer_uid)
            if lay is None:
                lay = next((l for sc in self.project.scenes for l in sc.layers
                            if l.uid == layer_uid), None)
            if lay is not None:
                return lay.transform[prop] if prop in lay.transform.tracks else lay.transform[prop]
            return None
        if bone_uid:
            for rig in self.scene.rigs.values():
                bone = rig.bones.get(bone_uid)
                if bone is not None:
                    return getattr(bone, prop, None)
        return None

    def _remove_keys_state(self, state) -> None:
        """Drop the captured keys again (mutates the live tracks in place)."""
        for layer_uid, bone_uid, prop, keys in state:
            track = self._track_for(layer_uid, bone_uid, prop)
            if track is None:
                continue
            for data in keys:
                track.remove_key(int(data["frame"]))
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def _restore_keys_state(self, state) -> None:
        """Re-insert the captured keys (the track objects never change identity)."""
        for layer_uid, bone_uid, prop, keys in state:
            track = self._track_for(layer_uid, bone_uid, prop)
            if track is None:
                continue
            for data in keys:
                track.restore_key(data)
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def set_key_easing(self, easing: str, bezier=None, selected_frame: int | None = None) -> None:
        frame = self.frame if selected_frame is None else selected_frame
        changed = []
        rig = self.active_rig()
        layer = self.active_layer()
        targets = []
        if rig is not None:
            bones = [rig.bones[u] for u in self.selected_bones if u in rig.bones] or list(rig.bones.values())
            for bone in bones:
                targets += [getattr(bone, p) for p in ("rotation", "offset_x", "offset_y")]
        if layer is not None:
            targets += list(layer.transform.tracks.values())
        for track in targets:
            key = track.key_at(frame)
            if key is None:
                continue
            changed.append((track, key.easing, key.bezier, easing, bezier or key.bezier))
        if not changed:
            self.status_message.emit("No key on this frame")
            return
        for track, _old_e, _old_b, new_e, new_b in changed:
            key = track.key_at(frame)
            key.easing = new_e
            key.bezier = new_b
        self.command(f"Easing → {easing}",
                     lambda: [setattr(t.key_at(frame), "easing", oe) for t, oe, ob, ne, nb in changed
                              if t.key_at(frame)],
                     lambda: [setattr(t.key_at(frame), "easing", ne) for t, oe, ob, ne, nb in changed
                              if t.key_at(frame)])
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def set_key_bezier(self, track, key, handle: int, value: float) -> None:
        if key is None or track is None:
            return
        before = tuple(key.bezier)
        after = list(before)
        after[handle] = max(0.0, min(1.0, float(value)))
        key.bezier = tuple(after)  # type: ignore[assignment]
        key.easing = "custom"

        def do(values):
            key.bezier = tuple(values)  # type: ignore[assignment]
            key.easing = "custom"
            self.timeline_changed.emit()

        self.command("Bezier handle", lambda: do(before), lambda: do(after), merge=True)

    def copy_keys(self) -> None:
        layer = self.active_layer()
        rig = self.active_rig()
        payload = {"layer": None, "bones": {}, "frame": self.frame}
        if layer is not None:
            payload["layer"] = layer.transform.to_dict()
        if rig is not None:
            payload["bones"] = {uid: rig.bones[uid].to_dict() for uid in rig.bones}
        self._clipboard = payload
        self.status_message.emit("Animation copied")

    def paste_keys(self, mirrored: bool = False) -> None:
        data = getattr(self, "_clipboard", None)
        if not data:
            self.status_message.emit("Nothing copied yet")
            return
        layer = self.active_layer()
        rig = self.active_rig()
        offset = self.frame - int(data.get("frame", self.frame))
        if layer is not None and data.get("layer"):
            from ..model.keyframe import TransformTracks
            old = layer.transform.to_dict()
            tracks = TransformTracks.from_dict(data["layer"])
            tracks.shift(offset)
            if mirrored:
                for prop in ("pos.x", "rotation", "scale.x", "skew.x"):
                    for key in tracks[prop].keys:
                        key.value = -key.value
            layer.transform = tracks

            def undo():
                from ..model.keyframe import TransformTracks as TT
                layer.transform = TT.from_dict(old)
                self.canvas_changed.emit()

            self.command("Paste animation", undo, lambda: None)
            self.canvas_changed.emit()
            self.timeline_changed.emit()
        if rig is not None and data.get("bones"):
            snapshots = {uid: bone.to_dict() for uid, bone in rig.bones.items()}
            for uid, bdata in data["bones"].items():
                bone = rig.bones.get(uid)
                if bone is None:
                    continue
                c = Bone.from_dict(bdata)
                for prop in ("rotation", "offset_x", "offset_y", "scale"):
                    src = getattr(c, prop)
                    dst = getattr(bone, prop)
                    src_keys = src.sorted_keys()
                    for key in src_keys:
                        value = -key.value if (mirrored and prop in ("rotation", "offset_x")) else key.value
                        dst.set_key(key.frame + offset, value, key.easing)
            after = {uid: bone.to_dict() for uid, bone in rig.bones.items()}

            def undo_b():
                for uid, bdata in snapshots.items():
                    if uid in rig.bones:
                        new_bone = Bone.from_dict(bdata)
                        rig.bones[uid] = new_bone
                self.rig_changed.emit()

            self.command("Paste animation", undo_b, lambda: None)
            self.rig_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()

    # =====================================================================
    # rig
    # =====================================================================
    def add_character(self, rigged: bool = True, name: str = "Character",
                      style: str = "stick", palette: str = "Cartoon Bright") -> Layer:
        from ..engine import artgen as _art
        height = self.scene.height * 0.42
        if rigged:
            rig = new_stick_rig(name, height, (0.0, 0.0))
            layer = self.scene.attach_rig_layer(rig, name, len(self.scene.layers))
            layer.transform["pos.x"].set_key(self.scene.frame_start, self.scene.width * 0.4)
            layer.transform["pos.y"].set_key(self.scene.frame_start, self.scene.height * 0.86)
            if style in ("cartoon", "anime"):
                self.attach_part_art_to_rig(rig, style, palette)
            self.rig_changed.emit()
        else:
            layer = self.scene.new_layer(name, "raster", len(self.scene.layers))
            img = _art.stick_figure(height)
            asset = self.project.add_asset(f"{name}.png", "image", _art.image_to_png(img),
                                           folder="Characters", tags=["character"])
            from PySide6.QtGui import QPainter
            cel = BitmapCel((self.scene.width, self.scene.height))
            p = QPainter(cel.image)
            p.drawImage(int(self.scene.width * 0.4 - img.width() / 2),
                        int(self.scene.height * 0.86 - height), img)
            p.end()
            layer.set_cel(self.scene.frame_start, cel,
                          hold=max(0, self.scene.frame_end - self.scene.frame_start))
            _ = asset

        def undo():
            self.scene.remove_layer(layer.uid)

        def redo():
            if self.scene.layer(layer.uid) is None:
                self.scene.layers.append(layer)

        self.command(f"Add character '{name}'", undo, redo)
        self.active_layer_uid = layer.uid
        self.layers_changed.emit()
        self.layer_selected.emit(layer.uid)
        self.assets_changed.emit()
        return layer

    def attach_part_art_to_rig(self, rig: Rig, style: str = "cartoon",
                               palette: str = "Cartoon Bright", height: float | None = None) -> int:
        """Give every bone a generated body part image (instant puppet)."""
        height = height or self.scene.height * 0.42
        parts = artgen.cartoon_character(height, palette, "anime" if style == "anime" else "round")
        attached = 0
        # bones are laid out head->tail; artwork hangs from the bone head
        for bone in rig.ordered_bones():
            part = parts.get(bone.name)
            if part is None:
                continue
            asset = self.project.add_asset(f"{rig.name} · {part.name}", "image",
                                           artgen.image_to_png(part.image),
                                           folder="Character Parts",
                                           tags=["character", "part", part.name.lower()])
            # bone art is drawn along +X of the bone space, so rotate the part
            # so its own "down" axis follows the bone
            img_w, img_h = part.image.width(), part.image.height()
            bone.asset_id = asset.uid
            bone.asset_offset = (-img_w * part.pivot[0], -img_h * part.pivot[1])
            bone.asset_scale = 1.0
            bone.asset_angle = 90.0 if part.angle == 90 else 0.0
            attached += 1
        return attached

    def add_bone(self, name: str | None = None, parent_uid: str | None = None,
                 x: float = 0.0, y: float = 0.0, length: float = 100.0,
                 angle: float = 0.0) -> Bone | None:
        rig = self.active_rig()
        if rig is None:
            self.status_message.emit("Select a character layer first")
            return None
        count = len(rig.bones)
        bone = rig.create_bone(name or f"Bone {count + 1}", parent_uid, x=x, y=y,
                               length=length, angle=angle)

        def undo():
            rig.remove_bone(bone.uid)

        def redo():
            rig.add_bone(bone)

        self.command("Add bone", undo, redo)
        self.selected_bones = [bone.uid]
        self.rig_changed.emit()
        self.selection_changed.emit()
        return bone

    def delete_bone(self, uid: str) -> None:
        rig = self.active_rig()
        if rig is None or uid not in rig.bones:
            return
        snapshot = rig.to_dict()
        rig.remove_bone(uid)

        def undo():
            restored = Rig.from_dict(snapshot)
            rig.bones = restored.bones
            rig.order = restored.order
            rig.ik_chains = restored.ik_chains
            self.rig_changed.emit()

        self.command("Delete bone", undo, lambda: self.rig_changed.emit())
        self.selected_bones = [u for u in self.selected_bones if u != uid]
        self.rig_changed.emit()
        self.selection_changed.emit()

    def set_bone_prop(self, uid: str, prop: str, value, merge: bool = False) -> None:
        rig = self.active_rig()
        if rig is None or uid not in rig.bones:
            return
        bone = rig.bones[uid]
        old = getattr(bone, prop, None)
        if old == value:
            return

        def do(v):
            setattr(bone, prop, v)
            self.rig_changed.emit()
            self.canvas_changed.emit()

        do(value)
        self.command(f"Bone {prop}", lambda: do(old), lambda: do(value), merge)

    def reparent_bone(self, uid: str, parent: str | None) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        bone = rig.bones.get(uid)
        if bone is None:
            return
        old = bone.parent
        if not rig.reparent(uid, parent):
            return
        self.command("Reparent bone", lambda: rig.reparent(uid, old),
                     lambda: rig.reparent(uid, parent))
        self.rig_changed.emit()

    def add_ik_chain(self, root: str, mid: str, effect=None) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        chain = IKChain("IK", [root, mid])
        tip = rig.bones.get(mid)
        if tip is not None:
            worlds = rig.solve(self.frame)
            w = worlds.get(mid)
            if w is not None:
                chain.target_x.default = w.tail[0]
                chain.target_y.default = w.tail[1]
        rig.ik_chains.append(chain)

        def undo():
            if chain in rig.ik_chains:
                rig.ik_chains.remove(chain)

        def redo():
            if chain not in rig.ik_chains:
                rig.ik_chains.append(chain)

        self.command("Add IK chain", undo, redo)
        self.rig_changed.emit()
        self.status_message.emit("IK chain added - drag the red target on the canvas")

    def remove_ik_chain(self, uid: str) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        chain = next((c for c in rig.ik_chains if c.uid == uid), None)
        if chain is None:
            return
        index = rig.ik_chains.index(chain)
        rig.ik_chains.remove(chain)
        self.command("Remove IK", lambda: rig.ik_chains.insert(index, chain),
                     lambda: rig.ik_chains.remove(chain) if chain in rig.ik_chains else None)
        self.rig_changed.emit()

    def bake_ik(self, uid: str | None = None) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        chains = [c for c in rig.ik_chains if uid is None or c.uid == uid]
        if not chains:
            return
        before = rig.to_dict()
        count = 0
        for chain in chains:
            frames = range(self.scene.frame_start, self.scene.frame_end + 1)
            count += rig.bake_ik(chain, frames)
        after = rig.to_dict()

        def undo():
            restored = Rig.from_dict(before)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            self.rig_changed.emit()
            self.timeline_changed.emit()

        self.command("Bake IK", undo, lambda: None)
        self.rig_changed.emit()
        self.timeline_changed.emit()
        self.status_message.emit(f"Baked {count} bone keys from IK")

    def capture_pose(self) -> dict:
        rig = self.active_rig()
        if rig is None:
            return {}
        return {b.uid: (b.rotation.value_at(self.frame), b.offset_x.value_at(self.frame),
                        b.offset_y.value_at(self.frame)) for b in rig.bones.values()}

    def apply_saved_pose(self, pose: dict, frame: int | None = None) -> None:
        rig = self.active_rig()
        if rig is None or not pose:
            return
        frame = self.frame if frame is None else frame
        before = rig.to_dict()
        rig.apply_pose(pose, frame, key=True)
        after = rig.to_dict()

        def undo():
            restored = Rig.from_dict(before)
            rig.bones = restored.bones
            self.rig_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command("Apply pose", undo, lambda: None)
        self.rig_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def mirror_pose_selected(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        pose = {}
        for bone in rig.bones.values():
            name = bone.name
            if name.startswith("L "):
                other = rig.find("R " + name[2:])
            elif name.startswith("R "):
                other = rig.find("L " + name[2:])
            else:
                other = None
            if other is not None:
                pose[other.uid] = (-bone.rotation.value_at(self.frame),
                                   -bone.offset_x.value_at(self.frame),
                                   bone.offset_y.value_at(self.frame))
        if pose:
            self.apply_saved_pose(pose)
            self.status_message.emit("Pose mirrored")

    # =====================================================================
    # characters / assets
    # =====================================================================
    def import_paths(self, paths: list[str]) -> None:
        added = []
        for path in paths:
            asset = import_any(self.project, path)
            if asset is not None:
                added.append(asset)
        if not added:
            self.status_message.emit("Nothing imported")
            return

        def undo():
            for a in added:
                self.project.remove_asset(a.uid)
            clear_asset_cache()
            self.assets_changed.emit()

        def redo():
            for a in added:
                self.project.assets[a.uid] = a
            clear_asset_cache()
            self.assets_changed.emit()

        self.command(f"Import {len(added)} asset(s)", undo, redo)
        self.assets_changed.emit()
        self.status_message.emit(f"Imported {', '.join(a.name for a in added[:4])}")

    def place_asset(self, asset_id: str, pos: tuple[float, float] | None = None,
                    layer: Layer | None = None) -> None:
        asset = self.project.asset(asset_id)
        if asset is None:
            return
        if asset.kind == "brush":
            brush = BrushSettings.from_dict(asset.meta.get("brush", {}))
            self.set_brush(brush)
            return
        if asset.kind == "palette":
            self.status_message.emit(f"Palette '{asset.name}' selected")
            return
        if asset.kind == "pose":
            from ..ai.poses import pose_from_dict
            self.apply_saved_pose(pose_from_dict(asset.meta.get("pose", {})))
            return
        if asset.kind == "animation":
            self.apply_library_animation(asset.name)
            return
        if asset.kind == "audio":
            self.add_audio_asset(asset.uid)
            return
        target = layer or self.active_layer()
        if target is None:
            self.status_message.emit("No layer to place into")
            return
        meta = asset.meta or {}
        fit = "native" if asset.kind in ("image", "svg") else "fit"
        cel = ImageCel(target.size, asset.uid, fit=fit, scale=1.0,
                       offset=pos or (0.0, 0.0))
        if meta.get("offset") and pos is None:
            cel.offset = tuple(meta["offset"])  # type: ignore[assignment]
        if asset.kind == "image" and (meta.get("width", 0) > self.scene.width or
                                      meta.get("height", 0) > self.scene.height):
            cel.fit = "fit"
        before = dict(target.cels)
        target.set_cel(self.frame, cel)
        after = dict(target.cels)

        def do(state):
            target.cels = dict(state)
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.command(f"Place '{asset.name}'", lambda: do(before), lambda: do(after))
        self.canvas_changed.emit()
        self.timeline_changed.emit()

    def add_audio_asset(self, asset_id: str, start_frame: int | None = None):
        asset = self.project.asset(asset_id)
        if asset is None:
            return None
        from ..engine.audio_engine import waveform_for_asset
        from ..model.audio import AudioTrack
        info = waveform_for_asset(asset)
        track = AudioTrack(asset.name, asset_id, start_frame or self.scene.frame_start)
        track.waveform = info.get("peaks", [])
        duration = info.get("duration") or asset.meta.get("duration", 0.0)
        track.duration = float(duration)
        track.set_frames(int(round(duration * self.fps)))
        self.scene.add_audio(track)
        index = len(self.scene.audio_tracks) - 1

        def undo():
            self.scene.audio_tracks.pop(index)

        def redo():
            self.scene.audio_tracks.insert(index, track)

        self.command(f"Add audio '{asset.name}'", undo, redo)
        self.timeline_changed.emit()
        if duration:
            self.scene.frame_end = max(self.scene.frame_end,
                                       track.end_frame(self.fps))
        self.status_message.emit(f"Audio '{asset.name}' added ({duration:.1f}s)")
        return track

    def add_audio_from_file(self, path: str):
        asset = import_any(self.project, path)
        if asset is None:
            return None
        self.assets_changed.emit()
        return self.add_audio_asset(asset.uid)

    # =====================================================================
    # animation helpers (library / AI / motion)
    # =====================================================================
    def apply_library_animation(self, name: str, loops: int = 1,
                                layer: Layer | None = None) -> None:
        from ..ai.library import library_by_name
        anim = library_by_name(name)
        target = layer or self.active_layer()
        if anim is None or target is None:
            self.status_message.emit("Select a layer first")
            return
        before = (target.transform.to_dict(), self._rig_snapshot(target))
        message = apply_animation(anim, target, self.scene, self.project,
                                  self.frame, self.fps, loops)
        after = (target.transform.to_dict(), self._rig_snapshot(target))

        def do(state):
            self._restore_rig_snapshot(target, state[1])
            from ..model.keyframe import TransformTracks
            target.transform = TransformTracks.from_dict(state[0])
            self.rig_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.command(f"Animation '{anim.name}'", lambda: do(before), lambda: do(after))
        self.layers_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.status_message.emit(message)

    def _rig_snapshot(self, layer: Layer):
        rig = self.scene.rigs.get(layer.rig_id or "") if layer.kind == "rig" else None
        return rig.to_dict() if rig else None

    def _restore_rig_snapshot(self, layer: Layer, snap) -> None:
        if snap is None:
            return
        rig = self.scene.rigs.get(layer.rig_id or "")
        if rig is None:
            return
        restored = Rig.from_dict(snap)
        rig.bones = restored.bones
        rig.order = restored.order
        rig.ik_chains = restored.ik_chains

    def ai_target(self) -> ApplyTarget:
        layer = self.active_layer()
        rig = self.active_rig()
        return ApplyTarget(self.project, self.scene, layer, rig, self.fps, self.scene.size())

    def ai_plan(self, instruction: str) -> Plan:
        target = self.ai_target()
        self.ai.fps = self.fps
        self.ai.canvas = self.scene.size()
        plan = self.ai.plan(instruction, target)
        self.pending_plan = plan
        return plan

    def ai_apply(self, plan: Plan | None = None) -> None:
        plan = plan or self.pending_plan
        if plan is None:
            return
        before = self._document_snapshot()
        messages = self.ai.apply(plan, self.ai_target())
        after = self._document_snapshot()
        self._register_snapshot_command(f"AI: {plan.instruction[:40]}", before, after)
        self.scene.frame_end = max(self.scene.frame_end, plan.frame_end)
        self._sync_player_range()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.layers_changed.emit()
        self.rig_changed.emit()
        for line in messages:
            self.ai_message.emit("assistant", "• " + line)

    def _document_snapshot(self) -> dict:
        return {sc.uid: {"layers": [l.to_dict() for l in sc.layers],
                         "rigs": {k: v.to_dict() for k, v in sc.rigs.items()},
                         "cameras": [c.to_dict() for c in sc.cameras],
                         "frame_end": sc.frame_end,
                         "audio": [a.to_dict() for a in sc.audio_tracks],
                         "shots": [s.to_dict() for s in sc.shots]}
                for sc in self.project.scenes}

    def _restore_document_snapshot(self, snap: dict) -> None:
        from ..model.audio import AudioTrack
        from ..model.camera import Camera, Shot
        from ..model.layer import Layer as L
        for sc in self.project.scenes:
            data = snap.get(sc.uid)
            if not data:
                continue
            sc.layers = [L.from_dict(d) for d in data["layers"]]
            sc.rigs = {k: Rig.from_dict(v) for k, v in data["rigs"].items()}
            sc.cameras = [Camera.from_dict(c) for c in data["cameras"]]
            sc.audio_tracks = [AudioTrack.from_dict(a) for a in data.get("audio", [])]
            sc.shots = [Shot.from_dict(s) for s in data.get("shots", [])]
            sc.frame_end = data.get("frame_end", sc.frame_end)
        self.scene_changed.emit()
        self.layers_changed.emit()
        self.rig_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def _register_snapshot_command(self, label: str, before: dict, after: dict) -> None:
        self.command(label, lambda: self._restore_document_snapshot(before),
                     lambda: self._restore_document_snapshot(after))

    def ai_pose(self, rig: Rig, description: str):
        pose, message = self.ai.generate_pose(rig, description)
        if pose is None:
            self.ai_message.emit("assistant", "⚠ " + message)
            return None
        self.apply_saved_pose(self._pose_to_dict(pose))
        self.ai_message.emit("assistant", "✓ " + message)
        return pose

    def _pose_to_dict(self, pose: dict) -> dict:
        out = {}
        for name, part in pose.items():
            if hasattr(part, "as_tuple"):
                out[name] = part.as_tuple()
            elif isinstance(part, (list, tuple)):
                out[name] = tuple(part)
        return out

    def ai_generate_motion(self, rig: Rig, a: str, b: str, start: int, end: int,
                           steps: int = 3, easing: str = "ease_in_out", arc: float = 0.0) -> None:
        before = rig.to_dict()
        message = self.ai.generate_motion(rig, a, b, start, end, steps, easing, arc)
        after = rig.to_dict()

        def undo():
            restored = Rig.from_dict(before)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            self.rig_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command("Generate motion", undo, lambda: None)
        self.rig_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.ai_message.emit("assistant", "✓ " + message)

    def ai_inbetween(self, count: int, layer: Layer | None = None, frame_a: int | None = None,
                     frame_b: int | None = None, seed: int = 0, boil: float = 0.0) -> None:
        layer = layer or self.active_layer()
        if layer is None:
            return
        keys = layer.cel_keys()
        if len(keys) < 2:
            self.ai_message.emit("assistant", "⚠ This layer needs at least two drawings "
                                              "(press F to add a frame).")
            return
        if frame_a is None or frame_b is None:
            later = [k for k in keys if k > self.frame]
            frame_a = self.frame if layer.cel_at(self.frame) else keys[0]
            frame_b = later[0] if later else keys[-1]
        if frame_a == frame_b:
            self.ai_message.emit("assistant", "⚠ Pick two different frames for in-betweening.")
            return
        before = dict(layer.cels)
        motion = MotionGenerator(self.fps)
        created = motion.create_inbetweens(layer, int(frame_a), int(frame_b), int(count),
                                           seed=seed, boil=boil)
        after = dict(layer.cels)

        def do(state):
            layer.cels = dict(state)
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.command(f"Inbetween ×{len(created)}", lambda: do(before), lambda: do(after))
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.ai_message.emit("assistant",
                             f"✓ Generated {len(created)} in-between frame(s) between "
                             f"frame {frame_a} and {frame_b}. Regenerate any time - "
                             f"press Ctrl+Z to undo.")

    def ai_lipsync(self, asset_id: str, target_layer: Layer | None = None,
                   use_mouth_layer: bool = True, start_frame: int | None = None) -> LipSyncTrack:
        track = self.lipsync_tracks.get(asset_id)
        if track is None:
            analyzer = LipSyncAnalyzer(self.fps)
            track = analyzer.analyze(self.project, self.project.asset(asset_id),
                                     start_frame or self.frame)
            self.lipsync_tracks[asset_id] = track
        self._last_lipsync_asset = asset_id
        layer = target_layer or self.active_layer()
        rig = self.active_rig()
        before = self._document_snapshot()
        if use_mouth_layer or rig is None:
            mouths = self._mouth_images()
            if not mouths:
                self.ai_message.emit("assistant", "⚠ No mouth chart found in the asset library.")
                return track
            pos = self._mouth_position(layer)
            apply_mouth_layer(track, self.scene, self.project, mouths, pos)
        else:
            apply_to_rig(track, rig)
        after = self._document_snapshot()
        self._register_snapshot_command("Lip sync", before, after)
        self.layers_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.ai_message.emit("assistant",
                            f"✓ Lip sync applied: {len(track.cues)} mouth shapes. "
                            f"{track.notes}")
        return track

    def _mouth_images(self):
        out = {}
        for asset in self.project.assets.values():
            viseme = (asset.meta or {}).get("viseme")
            if viseme and asset.data:
                from ..engine.render import load_asset_image
                img = load_asset_image(self.project, asset.uid)
                if img is not None and not img.isNull():
                    out[viseme] = img
        return out

    def _mouth_position(self, layer: Layer | None) -> tuple[float, float]:
        pos = (self.scene.width * 0.5, self.scene.height * 0.36)
        rig = self.active_rig()
        if rig is not None:
            head = resolve_bone(rig, "Head")
            if head is not None:
                worlds = rig.solve(self.frame)
                w = worlds.get(head.uid)
                rig_layer = self.rig_layer_for(rig)
                if w is not None:
                    ox = oy = 0.0
                    if rig_layer is not None:
                        tr = rig_layer.transform.value_at(self.frame)
                        ox, oy = tr.x, tr.y
                    pos = (w.tail[0] + ox, w.tail[1] + oy)
        elif layer is not None:
            bounds = None
            hit = layer.cel_at(self.frame)
            if hit is not None:
                bounds = hit[1].cel.content_bounds()
            if bounds is not None:
                pos = (bounds.center().x(), bounds.top() + bounds.height() * 0.35)
        return pos

    # =====================================================================
    # tools
    # =====================================================================
    def set_tool(self, tool: str) -> None:
        if tool == self.tool:
            return
        self.tool = tool
        self.tool_changed.emit(tool)
        self.canvas_changed.emit()
        self.status_message.emit(f"Tool: {tool.title()}")

    def set_brush(self, brush: BrushSettings | None = None, **kw) -> None:
        if brush is not None:
            self.brush = brush.copy()
        for key, value in kw.items():
            if hasattr(self.brush, key):
                setattr(self.brush, key, value)
        self.brush_changed.emit()
        self.canvas_changed.emit()

    def set_brush_prop(self, prop: str, value, merge: bool = True) -> None:
        old = getattr(self.brush, prop, None)
        if old == value:
            return

        def do(v):
            setattr(self.brush, prop, v)
            self.brush_changed.emit()
            self.canvas_changed.emit()

        self.command(f"Brush {prop}", lambda: do(old), lambda: do(value), merge)

    def set_preview_quality(self, quality: str) -> None:
        self.preview_quality = quality
        self.project.settings["canvas"]["quality"] = quality
        self.canvas_changed.emit()

    def toggle_onion(self, enabled: bool | None = None) -> None:
        onion = self.project.settings.setdefault("onion", {})
        onion["enabled"] = (not onion.get("enabled", True)) if enabled is None else bool(enabled)
        self.canvas_changed.emit()
        self.status_message.emit(f"Onion skin {'on' if onion['enabled'] else 'off'}")

    def set_onion_prop(self, prop: str, value) -> None:
        onion = self.project.settings.setdefault("onion", {})
        onion[prop] = value
        self.canvas_changed.emit()

    def set_mode(self, beginner: bool) -> None:
        self.beginner_mode = beginner
        self.project.settings.setdefault("preview", {})["mode"] = "beginner" if beginner else "pro"
        self.status_message.emit("Beginner mode" if beginner else "Pro mode")

    # =====================================================================
    # document io
    # =====================================================================
    def new_project(self, template: str | None = None, size=None, fps: int | None = None,
                    name: str = "Untitled") -> None:
        if template:
            project = build_template(template)
        else:
            project = Project(name, size or (1920, 1080), fps or 24)
            project.active_scene.new_layer("Background", "raster")
            project.active_scene.new_layer("Character", "raster")
        install_default_assets(project)
        self.set_project(project)

    def set_project(self, project: Project) -> None:
        self.project = project
        self.active_layer_uid = ""
        self.selected_bones = []
        self._ensure_active_layer()
        self.history.clear()
        self._sync_player_range()
        self.set_frame(project.active_scene.frame_start)
        clear_asset_cache()
        self.mark_dirty(False)
        self.project_changed.emit()
        self.scene_changed.emit()
        self.layers_changed.emit()
        self.assets_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.rig_changed.emit()
        self.tool_changed.emit(self.tool)

    def open_project(self, path: str) -> bool:
        try:
            project = project_file.load_project(path)
        except project_file.ProjectError as exc:
            self.status_message.emit(f"⚠ {exc}")
            return False
        install_default_assets(project)
        self.set_project(project)
        project_file.push_recent_file(path)
        self.status_message.emit(f"Opened {os.path.basename(path)}")
        self.autosave_timer.start()
        return True

    def save_project(self, path: str | None = None) -> bool:
        path = path or self.project.path
        if not path:
            return False
        try:
            project_file.save_project(self.project, path,
                                      thumbnail=project_file.project_thumbnail(self.project))
        except Exception as exc:
            self.status_message.emit(f"⚠ Could not save: {exc}")
            return False
        project_file.push_recent_file(path)
        self.mark_dirty(False)
        self.status_message.emit(f"Saved {os.path.basename(path)}")
        return True

    def autosave(self) -> None:
        if not self.project.settings.get("autosave", {}).get("enabled", True):
            return
        if not self._dirty:
            return
        try:
            project_file.write_autosave(self.project)
            self.status_message.emit("Autosaved (recovery copy)")
        except Exception as exc:
            print("[mfs] autosave failed:", exc)

    def start_autosave(self) -> None:
        interval = int(self.project.settings.get("autosave", {}).get("interval_sec", 180))
        self.autosave_timer.setInterval(max(30, interval) * 1000)
        self.autosave_timer.start()

    # =====================================================================
    # export
    # =====================================================================
    def start_export(self, settings) -> bool:
        from ..engine.exporter import ExportThread
        if self._export_thread is not None and self._export_thread.isRunning():
            self.status_message.emit("An export is already running")
            return False
        thread = ExportThread(self.project, settings, self)
        thread.progress.connect(self.export_progress.emit)
        thread.finished_ok.connect(self._on_export_done)
        thread.failed.connect(self._on_export_failed)
        self._export_thread = thread
        thread.start()
        return True

    def cancel_export(self) -> None:
        if self._export_thread is not None:
            self._export_thread.cancel()

    def _on_export_done(self, path: str, seconds: float) -> None:
        self.export_finished.emit(path)
        self.status_message.emit(f"Exported to {path} in {seconds:.1f}s")

    def _on_export_failed(self, message: str) -> None:
        self.export_failed.emit(message)
        self.status_message.emit(f"⚠ Export failed: {message}")

    def export_running(self) -> bool:
        return self._export_thread is not None and self._export_thread.isRunning()

    # =====================================================================
    # convenience
    # =====================================================================

    # =====================================================================
    # rig / character conveniences used by the character panel
    # =====================================================================
    def rigs_in_scene(self) -> list[Rig]:
        return list(self.scene.rigs.values())

    def ensure_rig(self, name: str = "Character") -> Rig:
        """Return the rig of the active layer, creating one when missing."""
        rig = self.active_rig()
        if rig is not None:
            return rig
        return self.create_rig_for_active_layer(name)

    def create_rig_for_active_layer(self, name: str = "Character") -> Rig:
        from ..model.document import new_stick_rig
        rig = new_stick_rig(name, self.scene.height * 0.45, (0.0, 0.0))
        layer = self.scene.attach_rig_layer(rig, name, len(self.scene.layers))
        layer.transform["pos.x"].set_key(self.scene.frame_start, self.scene.width * 0.45)
        layer.transform["pos.y"].set_key(self.scene.frame_start, self.scene.height * 0.9)
        snapshot = rig.to_dict()

        def undo():
            self.scene.rigs.pop(rig.uid, None)
            self.scene.remove_layer(layer.uid)
            self.layers_changed.emit()
            self.rig_changed.emit()

        def redo():
            self.scene.rigs[rig.uid] = rig
            self.scene.layers.append(layer)
            self.active_layer_uid = layer.uid
            self.layers_changed.emit()
            self.rig_changed.emit()

        self.active_layer_uid = layer.uid
        self.push(FuncCommand(f"New rig '{name}'", undo, redo))
        self.rig_changed.emit()
        self.layer_selected.emit(layer.uid)
        self.status_message.emit(f"Rig '{name}' created — use the Bone tool to draw bones")
        _ = snapshot
        return rig

    def auto_rig_from_scene(self, name: str = "Auto Character") -> Rig | None:
        """Build a character rig and bind the existing part layers to it."""
        from ..model.document import new_stick_rig
        from ..model.rig import PART_ALIASES
        rig = new_stick_rig(name, self.scene.height * 0.45, (0.0, 0.0))
        layer = self.scene.attach_rig_layer(rig, name, len(self.scene.layers))
        layer.transform["pos.x"].set_key(self.scene.frame_start, self.scene.width * 0.45)
        layer.transform["pos.y"].set_key(self.scene.frame_start, self.scene.height * 0.9)
        matched = self._bind_parts_by_name(rig)
        rig.auto_rigged = True

        def undo():
            self.scene.rigs.pop(rig.uid, None)
            self.scene.layers[:] = [l for l in self.scene.layers if l.uid != layer.uid]
            self._ensure_active_layer()
            self.rig_changed.emit()
            self.layers_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        def redo():
            self.scene.rigs[rig.uid] = rig
            if self.scene.layer(layer.uid) is None:
                self.scene.layers.append(layer)
            self.active_layer_uid = layer.uid
            self.rig_changed.emit()
            self.layers_changed.emit()
            self.canvas_changed.emit()

        self.active_layer_uid = layer.uid
        self.push(FuncCommand(f"Auto Rig '{name}'", undo, redo))
        self.rig_changed.emit()
        self.layers_changed.emit()
        self.layer_selected.emit(layer.uid)
        self.canvas_changed.emit()
        self.mark_dirty(True)
        self.status_message.emit(
            f"Auto Rig: {len(rig.bones)} bones created, {matched} part(s) bound "
            f"({len(rig.ik_chains)} IK chains)"
        )
        return rig

    def _bind_parts_by_name(self, rig: Rig) -> int:
        from ..model.rig import PART_ALIASES, PART_BONE_MAP
        matched = 0
        rig_layer = self.rig_layer_for(rig)
        rig_layer_uid = rig_layer.uid if rig_layer is not None else None
        for lay in self.scene.layers:
            if rig_layer_uid is not None and lay.uid == rig_layer_uid:
                continue
            if lay.kind == "group":
                continue
            low = lay.name.lower()
            for part, aliases in PART_ALIASES.items():
                if any(alias in low for alias in aliases):
                    rig.bind_part(part, lay.uid)
                    bone_name = PART_BONE_MAP.get(part)
                    bone = rig.find(bone_name) if bone_name else None
                    cel = lay.first_cel()
                    if bone is not None and cel is not None:
                        asset_id = self._cel_as_asset(lay, cel)
                        if asset_id:
                            bone.asset_id = asset_id
                        bone.z_order = self.scene.layers.index(lay)
                    matched += 1
                    break
        return matched

    def _cel_as_asset(self, layer: Layer, cel) -> str | None:
        """Artwork for a bone: use the cel's own asset, else bake the drawing once."""
        asset_id = getattr(cel, "asset_id", None)
        if asset_id and self.project.asset(asset_id) is not None:
            return asset_id
        image = getattr(cel, "image", None)
        if image is None or image.isNull() or not getattr(cel, "has_content", lambda: False)():
            return None
        from PySide6.QtCore import QBuffer
        buf = QBuffer()
        buf.open(QBuffer.WriteOnly)
        image.save(buf, "PNG")
        data = bytes(buf.data())
        existing = next((a for a in self.project.assets.values()
                         if a.kind == "image" and a.meta.get("source_layer") == layer.uid), None)
        if existing is not None:
            existing.data = data
            return existing.uid
        asset = self.project.add_asset(f"{layer.name} · part", "image", data,
                                       folder="Character Parts",
                                       tags=["character", "part", layer.name.lower()],
                                       meta={"source_layer": layer.uid})
        return asset.uid

    def detect_character_parts(self) -> int:
        rig = self.active_rig()
        if rig is None:
            self.status_message.emit("Create a rig first (Character ▸ Auto Rig Character)")
            return 0
        count = self._bind_parts_by_name(rig)
        rig.auto_rigged = True
        self.rig_changed.emit()
        self.canvas_changed.emit()
        self.status_message.emit(f"Detected and bound {count} body part layer(s)")
        return count

    def set_bone_parent(self, uid: str, parent_uid: str | None) -> None:
        self.reparent_bone(uid, parent_uid)

    def set_part_offset(self, part_key: str, x: float, y: float, rot: float) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        from ..model.rig import PART_BONE_MAP
        bone = rig.find(PART_BONE_MAP.get(part_key, "") or "")
        if bone is None:
            self.status_message.emit("Bind that part to a bone first")
            return
        before = (bone.asset_offset, bone.asset_angle, bone.asset_scale)
        bone.asset_offset = (float(x), float(y))
        bone.asset_angle = float(rot)
        after = (bone.asset_offset, bone.asset_angle, bone.asset_scale)

        def do(state):
            bone.asset_offset, bone.asset_angle, bone.asset_scale = state
            self.canvas_changed.emit()

        self.push(FuncCommand("Part offset", lambda: do(before), lambda: do(after)))
        self.canvas_changed.emit()

    def pose_names(self) -> list[str]:
        return sorted(POSES.keys())

    def apply_pose(self, name: str, frame: int | None = None, key: bool = True) -> bool:
        rig = self.active_rig()
        if rig is None:
            self.status_message.emit("Select a rig layer to apply a pose")
            return False
        pose = get_pose(name)
        if pose is None:
            self.status_message.emit(f"Unknown pose '{name}'")
            return False
        target = self.frame if frame is None else int(frame)
        before = rig.to_dict()
        rig.apply_pose(pose, target, key=key, replace=True)
        after = rig.to_dict()

        def do(state):
            restored = Rig.from_dict(state)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            rig.order = restored.order
            self.rig_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.push(FuncCommand(f"Pose '{name}'", lambda: do(before), lambda: do(after)))
        self.rig_changed.emit()
        self.canvas_changed.emit()
        self.timeline_changed.emit()
        self.status_message.emit(f"Pose '{name}' applied at frame {target}")
        return True

    def store_pose(self, name: str) -> None:
        rig = self.active_rig()
        if rig is None:
            self.status_message.emit("Select a rig layer first")
            return
        pose = pose_to_dict(rig.capture_pose(self.frame))
        asset = self.project.add_asset(name, "pose", data=None, folder="Poses",
                                       tags=["pose", name.lower()],
                                       meta={"pose": pose, "bones": len(rig.bones),
                                             "scene": self.scene.name})
        self.assets_changed.emit()
        self.mark_dirty(True)
        self.status_message.emit(f"Pose saved to the library as '{name}' ({asset.name})")

    def apply_stored_pose(self, asset_id: str, frame: int | None = None) -> bool:
        asset = self.project.asset(asset_id)
        rig = self.active_rig()
        if asset is None or rig is None:
            return False
        raw = asset.meta.get("pose") or {}
        if not raw:
            self.status_message.emit("That library pose is empty")
            return False
        target = self.frame if frame is None else int(frame)
        before = rig.to_dict()
        rig.apply_pose(pose_from_dict(raw), target, key=True, replace=True)
        after = rig.to_dict()

        def do(state):
            restored = Rig.from_dict(state)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            rig.order = restored.order
            self.rig_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.push(FuncCommand(f"Pose '{asset.name}'", lambda: do(before), lambda: do(after)))
        self.rig_changed.emit()
        self.canvas_changed.emit()
        self.timeline_changed.emit()
        self.status_message.emit(f"Applied stored pose '{asset.name}' at frame {target}")
        return True

    def reset_pose(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        before = rig.to_dict()
        rig.clear_pose_keys()
        after = rig.to_dict()

        def do(state):
            restored = Rig.from_dict(state)
            rig.bones = restored.bones
            self.rig_changed.emit()
            self.canvas_changed.emit()
            self.timeline_changed.emit()

        self.push(FuncCommand("Reset pose", lambda: do(before), lambda: do(after)))
        self.rig_changed.emit()
        self.canvas_changed.emit()
        self.status_message.emit("Pose reset to rest")

    def mirror_pose(self) -> None:
        self.mirror_pose_selected()

    def auto_rig_character(self, asset_id: str | None = None, name: str = "Auto Character"):
        """Auto Rig: from an imported image asset, or from the scene's part layers."""
        if asset_id:
            return self._auto_rig_from_asset(asset_id, name)
        return self.auto_rig_from_scene(name)

    def _auto_rig_asset(self, asset_id: str, name: str = "Auto Character"):
        """Split an imported character image into parts and rig it."""
        asset = self.project.asset(asset_id)
        if asset is None or not asset.data:
            self.status_message.emit("Import a character image first")
            return None
        path = None
        if asset.source_path and os.path.exists(asset.source_path):
            path = asset.source_path
        else:
            import tempfile
            handle = tempfile.NamedTemporaryFile(suffix=asset.ext or ".png", delete=False)
            handle.write(asset.data)
            handle.close()
            path = handle.name
        image = load_image(path)
        if image is None or image.isNull():
            self.status_message.emit("Could not read that image")
            return None
        parts = detect_character_parts(image)
        new_assets = split_character_assets(self.project, image, parts, folder=f"{name} Parts")
        rig = self.auto_rig_from_scene(name)
        # attach the freshly split parts to the matching bones
        rig_layer = self.rig_layer_for(rig) if rig is not None else None
        for part_asset in (new_assets or []):
            bone = rig.find(part_asset.name) if rig is not None else None
            if bone is None:
                continue
            bone.asset_id = part_asset.uid
            width = part_asset.meta.get("width", image.width())
            height = part_asset.meta.get("height", image.height())
            bone.asset_offset = (-width * 0.5, -height * 0.5)
            bone.asset_angle = 90.0
        _ = rig_layer
        self.assets_changed.emit()
        self.rig_changed.emit()
        self.status_message.emit(f"Auto rig: {len(parts)} part(s) detected from '{asset.name}'")
        return rig

    # ---- pose capture / IK helpers used by the canvas and panels ----
    def capture_pose_for(self, frame: int | None = None) -> dict:
        rig = self.active_rig()
        if rig is None:
            return {}
        return pose_to_dict(rig.capture_pose(self.frame if frame is None else frame))

    def key_bones(self, uids: list[str] | None = None) -> None:
        self.key_bone_pose(uids[0] if uids and len(uids) == 1 else None)

    def set_bone_constraint(self, uid: str, kind: str) -> None:
        self.set_bone_prop(uid, "constraint", kind)

    def set_bone_limits(self, uid: str, lo: float, hi: float) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        bone = rig.bones.get(uid)
        if bone is None:
            return
        before = (bone.min_angle, bone.max_angle)
        bone.min_angle, bone.max_angle = float(lo), float(hi)
        after = (bone.min_angle, bone.max_angle)

        def do(state):
            bone.min_angle, bone.max_angle = state
            self.canvas_changed.emit()

        self.push(FuncCommand("Rotation limits", lambda: do(before), lambda: do(after)), merge=True)
        self.canvas_changed.emit()


    # =====================================================================
    # AI panel helpers
    # =====================================================================
    def reload_ai(self) -> None:
        """Rebuild the assistant with the current provider settings."""
        self.ai = AIAssistant(fps=self.fps, scene_size=self.scene.size())
        self.ai_message.emit("assistant", f"AI provider reloaded: {self.ai.provider.name}")

    def current_lipsync(self):
        uid = getattr(self, "_last_lipsync_asset", "")
        track = self.lipsync_tracks.get(uid)
        if track is None and self.lipsync_tracks:
            track = list(self.lipsync_tracks.values())[-1]
        return track

    def reapply_lipsync(self, track) -> None:
        """Re-create the mouth animation after the viseme list was edited by hand."""
        if track is None:
            return
        before = self._document_snapshot()
        layer_name = getattr(track, "applied_layer_uid", "")
        rig = self.active_rig()
        mouths = self._mouth_images()
        if layer_name:
            layer = self.scene.layer(layer_name)
            if layer is not None:
                self.scene.remove_layer(layer.uid)
        if mouths and (not rig or not apply_to_rig(track, rig)):
            pos = self._mouth_position(self.active_layer())
            apply_mouth_layer(track, self.scene, self.project, mouths, pos)
        elif rig is not None:
            apply_to_rig(track, rig)
        after = self._document_snapshot()
        self._register_snapshot_command("Edit lip sync", before, after)
        self.layers_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()

    def bake_rig_to_layer(self, rig: Rig) -> None:
        """Sample the rig on every frame and keep the rotation keys (freeze)."""
        before = rig.to_dict()
        start, end = self.scene.frame_start, max(self.scene.total_frames(), self.scene.frame_end)
        for f in range(start, end + 1):
            worlds = rig.solve(float(f))
            for bone in rig.bones.values():
                world = worlds.get(bone.uid)
                if world is None:
                    continue
                parent_world = 0.0
                if bone.parent in worlds:
                    parent_world = worlds[bone.parent].world_angle
                rest = bone.angle if bone.inherit_rotation else 0.0
                bone.rotation.set_key(f, world.world_angle - parent_world - rest)
        for chain in rig.ik_chains:
            chain.enabled = False
        after = rig.to_dict()

        def do(state):
            restored = Rig.from_dict(state)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            self.rig_changed.emit()
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.push(FuncCommand("Bake rig", lambda: do(before), lambda: do(after)))
        self.rig_changed.emit()
        self.timeline_changed.emit()
        self.status_message.emit(f"Rig baked for frames {start}–{end}")

    def set_provider(self, provider_id: str) -> None:
        from ..ai.providers import load_ai_settings, save_ai_settings
        settings = load_ai_settings()
        settings["provider"] = provider_id
        save_ai_settings(settings)
        self.reload_ai()


    def apply_auto_smoothing(self, enabled: bool = True) -> None:
        """Turn the automatic smoothing on/off for the active layer's curves."""
        layer = self.active_layer()
        if layer is None:
            return
        before = layer.transform.to_dict()
        for track in layer.transform.tracks.values():
            for key in track.keys:
                key.easing = "ease_in_out" if enabled else "linear"
                if enabled:
                    key.bezier = (0.42, 0.0, 0.58, 1.0)
        after = layer.transform.to_dict()

        def do(state):
            layer.transform = type(layer.transform).from_dict(state)
            self.timeline_changed.emit()
            self.canvas_changed.emit()

        self.push(FuncCommand("Auto smoothing" + (" on" if enabled else " off"),
                              lambda: do(before), lambda: do(after)))
        self.status_message.emit("Auto smoothing " + ("enabled" if enabled else "disabled"))


    def stop(self) -> None:
        self.player.stop()
        self.playing = False
        self.play_state_changed.emit(False)
        self.frame_changed.emit(self.current_frame)

    # =====================================================================
    # Text → animation (multi-track)
    # =====================================================================
    def ai_text_to_animation(self, text: str, start_frame: int | None = None,
                             add_character_if_missing: bool = True) -> Plan | None:
        """Turn a multi line description into a sequence of animation actions.

        Character motion lands on the character rig layer, camera moves on the
        camera track, backgrounds, props and text each get their own layer so the
        timeline shows the four separate tracks.
        """
        from ..ai.assistant import Action, ApplyTarget, Plan, PlanApplier
        from ..ai.assistant import OfflineDirector

        lines = [line.strip(" -•\t") for line in text.splitlines() if line.strip()]
        if not lines:
            self.ai_message.emit("assistant", "⚠ Nothing to animate — the description was empty.")
            return None

        self._ensure_active_layer()
        rig = self.active_rig()
        if rig is None and add_character_if_missing:
            self.add_character(True, name="Character")
            rig = self.active_rig()

        director = OfflineDirector(fps=self.fps, scene_size=self.scene.size(),
                                   has_rig=rig is not None)
        actions: list[Action] = []
        cursor = int(start_frame if start_frame is not None else self.scene.frame_start)
        for line in lines:
            plan = director.plan(line)
            if not plan.actions:
                continue
            shift = cursor - plan.actions[0].start
            for action in plan.actions:
                action.start += shift
                action.end  # noqa: B018 - keeps the property in sync
                action.start = int(action.start)
                actions.append(action)
            cursor = max(a.end for a in actions) + max(2, self.fps // 4)

        if not actions:
            self.ai_message.emit("assistant", "⚠ I could not understand any of those lines.")
            return None

        buckets: dict[str, list[Action]] = {"character": [], "camera": [], "background": [],
                                          "props": [], "text": [], "scene": []}
        for action in actions:
            if action.kind in ("zoom", "pan", "camera_cut", "camera_shake"):
                buckets["camera"].append(action)
            elif action.kind == "background":
                buckets["background"].append(action)
            elif action.kind in ("prop", "add_prop"):
                buckets["props"].append(action)
            elif action.kind == "text_layer":
                buckets["text"].append(action)
            elif action.kind in ("scene", "add_character"):
                buckets["scene"].append(action)
            else:
                buckets["character"].append(action)

        summary = ", ".join(f"{len(v)} {k}" for k, v in buckets.items() if v)
        plan = Plan(instruction=text, actions=actions,
                    summary=f"Text → animation: {len(actions)} actions ({summary}) over "
                            f"{plan_frame_end(actions)} frames at {self.fps} fps.",
                    created_by="offline-text2animation")
        before = self._document_snapshot()
        total_note = []
        for name in ("scene", "background", "props", "text", "character", "camera"):
            group = buckets[name]
            if not group:
                continue
            layer = self.active_layer()
            target_layer = layer
            if name == "character" and rig is not None:
                target_layer = self.rig_layer_for(rig) or layer
            sub = Plan(instruction=f"{text} [{name}]", actions=group,
                       summary=f"{name} track", created_by=plan.created_by)
            applier = PlanApplier(ApplyTarget(project=self.project, scene=self.scene,
                                              layer=target_layer, rig=rig if name == "character"
                                              else None,
                                              fps=self.fps, canvas=self.scene.size()))
            notes = applier.apply(sub)
            total_note.append(f"{name}: {len(notes)}")
        after = self._document_snapshot()
        self._register_snapshot_command("Text → animation", before, after)
        self.layers_changed.emit()
        self.timeline_changed.emit()
        self.canvas_changed.emit()
        self.rig_changed.emit()
        self.ai_message.emit("assistant", "✓ " + plan.summary + "  ·  " + ", ".join(total_note))
        self.status_message.emit(f"Text → animation applied ({len(actions)} actions)")
        return plan

    def status(self, text: str) -> None:
        self.status_message.emit(text)

    def close(self) -> None:
        self.autosave_timer.stop()
        self.audio.close()
        self.player.pause()


def load_image_from_asset(project, asset_id: str):
    from ..engine.render import load_asset_image
    return load_asset_image(project, asset_id)


_ = (APP_NAME, __version__, LAYER_KINDS, TextCel, VectorCel, Cel, Scene, POSES, pose_to_dict,
     LibraryAnimation, apply_animation, IKChain, new_stick_rig)
