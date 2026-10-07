"""The main window: menus, tool rail, docks, playback bar and every action."""
from __future__ import annotations

import os

from PySide6.QtCore import QPoint, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QAction, QActionGroup, QColor, QKeySequence, QShortcut
from PySide6.QtWidgets import (QAbstractItemView, QApplication, QDockWidget, QFileDialog, QFrame,
                               QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QMainWindow, QMenu, QMessageBox, QProgressBar, QPushButton,
                               QSizePolicy, QSlider, QSpinBox, QStatusBar, QToolBar, QToolButton,
                               QVBoxLayout, QWidget)

from .. import APP_NAME, ORG_NAME, __version__
from ..engine.exporter import ExportSettings, ExportThread
from ..model.document import Project
from .ai_panel import AIPanel
from .assets_panel import AssetsPanel, SceneBar
from .canvas import CanvasView
from .character_panel import CharacterPanel
from .dialogs import (AISettingsDialog, AboutDialog, ExportDialog, NewProjectDialog,
                      PreferencesDialog, RecoveryDialog)
from .graph_editor import GraphEditor
from .layers_panel import LayersPanel
from .properties import PropertiesPanel
from .theme import C, app_icon, get_icon


class ToolRail(QWidget):
    """Vertical tool buttons with tooltips (Selection, Brush, … Zoom)."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.buttons: dict[str, QToolButton] = {}
        lay = QVBoxLayout(self)
        lay.setContentsMargins(4, 6, 4, 6)
        lay.setSpacing(3)
        tools = [
            ("select", "Selection", "Select and move (V)", "V"),
            ("brush", "Brush", "Pressure sensitive brush (B)", "B"),
            ("pencil", "Pencil", "Hard pencil line (P)", "P"),
            ("ink", "Ink", "Inking brush with a clean taper (I)", "I"),
            ("marker", "Marker", "Flat marker (M)", "M"),
            ("soft", "Soft brush", "Airbrush style soft brush (S)", "S"),
            ("airbrush", "Airbrush", "Very soft spray (A)", "A"),
            ("charcoal", "Charcoal", "Textured charcoal (C)", "C"),
            ("eraser", "Eraser", "Erase pixels (E)", "E"),
            ("fill", "Fill", "Bucket fill a region (G)", "G"),
            ("shape", "Shape", "Line, rectangle, circle, polygon, bezier (U)", "U"),
            ("text", "Text", "Add text (T)", "T"),
            ("transform", "Transform", "Move / rotate / scale the drawing (W)", "W"),
            ("bone", "Bone / Rig", "Draw and pose bones (N)", "N"),
            ("hand", "Hand", "Pan the canvas (H)", "H"),
            ("zoom", "Zoom", "Zoom the canvas (Z)", "Z"),
        ]
        group = QActionGroup(self)
        for key, label, tip, shortcut in tools:
            button = QToolButton()
            button.setCheckable(True)
            button.setIcon(get_icon(key, C.text_dim))
            button.setIconSize(QSize(20, 20))
            button.setToolTip(f"{label}  —  {tip}\nShortcut: {shortcut}")
            button.setFixedSize(36, 32)
            button.clicked.connect(lambda _c=False, k=key: self.session.set_tool(k))
            lay.addWidget(button)
            self.buttons[key] = button
        lay.addStretch(1)
        self.color_swatch = QToolButton()
        self.color_swatch.setFixedSize(36, 32)
        self.color_swatch.setToolTip("Primary colour (click to pick, X swaps)")
        self.color_swatch.clicked.connect(self._pick_color)
        lay.addWidget(self.color_swatch)
        session.tool_changed.connect(self.sync)
        session.brush_changed.connect(self._update_swatch)
        self.sync(session.tool)
        self._update_swatch()

    def sync(self, tool: str) -> None:
        for key, button in self.buttons.items():
            button.setChecked(key == tool)
        self._update_swatch()

    def _update_swatch(self) -> None:
        color = self.session.primary_color.name()
        self.color_swatch.setStyleSheet(
            f"background:{color};border:2px solid {C.border_light};border-radius:4px;")

    def _pick_color(self) -> None:
        from PySide6.QtWidgets import QColorDialog
        color = QColorDialog.getColor(self.session.primary_color, self, "Primary colour")
        if color.isValid():
            self.session.primary_color = color
            self.session.set_brush_prop("color", (color.red(), color.green(), color.blue(),
                                                  color.alpha()))
            self._update_swatch()


class PlaybackBar(QWidget):
    """Play / pause / stop / loop / step / first / last, fps and frame fields."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        lay = QHBoxLayout(self)
        lay.setContentsMargins(8, 4, 8, 4)
        lay.setSpacing(4)

        def button(icon_name, tip, slot, checkable=False) -> QToolButton:
            btn = QToolButton()
            btn.setIcon(get_icon(icon_name, C.text))
            btn.setIconSize(QSize(17, 17))
            btn.setToolTip(tip)
            btn.setCheckable(checkable)
            btn.clicked.connect(slot)
            lay.addWidget(btn)
            return btn

        button("first", "First frame (Home)", lambda: session.set_frame(session.scene.frame_start))
        button("prev", "Previous frame (←)", lambda: session.step_frame(-1))
        self.play_btn = button("play", "Play / Pause (Space)", session.play_pause)
        self.stop_btn = button("stop", "Stop and rewind", session.stop)
        button("next", "Next frame (→)", lambda: session.step_frame(1))
        button("last", "Last frame (End)", lambda: session.set_frame(session.scene.total_frames()))
        self.loop_btn = button("loop", "Loop playback", self._toggle_loop, True)
        self.loop_btn.setChecked(True)

        lay.addSpacing(6)
        self.frame_spin = QSpinBox()
        self.frame_spin.setRange(0, 1000000)
        self.frame_spin.setFixedWidth(72)
        self.frame_spin.setToolTip("Current frame")
        self.frame_spin.valueChanged.connect(lambda v: session.set_frame(v))
        lay.addWidget(QLabel("Frame"))
        lay.addWidget(self.frame_spin)
        self.total_label = QLabel("/ 0")
        self.total_label.setObjectName("hint")
        lay.addWidget(self.total_label)

        self.fps_spin = QSpinBox()
        self.fps_spin.setRange(1, 120)
        self.fps_spin.setFixedWidth(66)
        self.fps_spin.setToolTip("Frame rate 1–120 fps (default 24)")
        self.fps_spin.valueChanged.connect(lambda v: session.set_fps(int(v)))
        lay.addSpacing(6)
        lay.addWidget(QLabel("FPS"))
        lay.addWidget(self.fps_spin)

        lay.addSpacing(6)
        self.quality_combo = QComboBoxFactory(session).combo
        lay.addWidget(QLabel("Quality"))
        lay.addWidget(self.quality_combo)

        lay.addSpacing(6)
        self.onion_btn = QToolButton()
        self.onion_btn.setIcon(get_icon("onion", C.text))
        self.onion_btn.setIconSize(QSize(17, 17))
        self.onion_btn.setCheckable(True)
        self.onion_btn.setToolTip("Onion skin (O)")
        self.onion_btn.clicked.connect(lambda: session.toggle_onion(self.onion_btn.isChecked()))
        lay.addWidget(self.onion_btn)

        self.rig_btn = QToolButton()
        self.rig_btn.setIcon(get_icon("bone", C.text))
        self.rig_btn.setIconSize(QSize(17, 17))
        self.rig_btn.setCheckable(True)
        self.rig_btn.setChecked(True)
        self.rig_btn.setToolTip("Show the rig overlay (R)")
        self.rig_btn.clicked.connect(self._toggle_rig)
        lay.addWidget(self.rig_btn)

        self.camera_btn = QToolButton()
        self.camera_btn.setIcon(get_icon("camera", C.text))
        self.camera_btn.setIconSize(QSize(17, 17))
        self.camera_btn.setCheckable(True)
        self.camera_btn.setToolTip("Look through the camera (export preview)")
        self.camera_btn.clicked.connect(self._toggle_camera)
        lay.addWidget(self.camera_btn)

        lay.addStretch(1)
        self.time_label = QLabel("0:00.0 / 0:00.0")
        self.time_label.setObjectName("hint")
        lay.addWidget(self.time_label)

        session.frame_changed.connect(self._on_frame)
        session.timeline_changed.connect(self.sync)
        session.play_state_changed.connect(self._on_play)
        session.brush_changed.connect(self.sync)
        session.scene_changed.connect(self.sync)
        self.sync()

    def _toggle_loop(self) -> None:
        self.session.set_loop(self.loop_btn.isChecked())

    def _toggle_rig(self) -> None:
        self.session.show_rig = self.rig_btn.isChecked()
        self.session.canvas_changed.emit()

    def _toggle_camera(self) -> None:
        self.session.camera_view = self.camera_btn.isChecked()
        self.session.canvas_changed.emit()

    def _on_frame(self, frame: float) -> None:
        if self.frame_spin.value() != int(round(frame)):
            self.frame_spin.blockSignals(True)
            self.frame_spin.setValue(int(round(frame)))
            self.frame_spin.blockSignals(False)
        fps = max(1, self.session.fps)
        position = (frame - self.session.scene.frame_start) / fps
        total = max(0, self.session.scene.total_frames() - self.session.scene.frame_start) / fps
        self.time_label.setText(f"{_mmss(position)} / {_mmss(total)}")

    def _on_play(self, playing: bool) -> None:
        self.play_btn.setIcon(get_icon("pause" if playing else "play", C.text))

    def sync(self) -> None:
        session = self.session
        self.frame_spin.blockSignals(True)
        self.frame_spin.setValue(session.frame)
        self.frame_spin.blockSignals(False)
        self.total_label.setText(f"/ {session.scene.total_frames()}")
        self.fps_spin.blockSignals(True)
        self.fps_spin.setValue(session.fps)
        self.fps_spin.blockSignals(False)
        self.onion_btn.setChecked(bool(session.project.settings.get("onion", {})
                                       .get("enabled", True)))
        self.camera_btn.setChecked(session.camera_view)
        index = self.quality_combo.findData(session.preview_quality)
        self.quality_combo.blockSignals(True)
        self.quality_combo.setCurrentIndex(max(0, index))
        self.quality_combo.blockSignals(False)


class QComboBoxFactory:
    """Small helper that keeps the preview-quality combo wired to the session."""

    def __init__(self, session):
        from PySide6.QtWidgets import QComboBox
        self.combo = QComboBox()
        for key, label in (("draft", "Draft"), ("normal", "Normal"), ("high", "High"),
                           ("final", "Final")):
            self.combo.addItem(label, key)
        self.combo.setToolTip("Preview quality — Draft is fastest, Final is exact")
        self.combo.currentIndexChanged.connect(
            lambda: session.set_preview_quality(self.combo.currentData()))


def _mmss(seconds: float) -> str:
    seconds = max(0.0, seconds)
    return f"{int(seconds // 60)}:{seconds % 60:04.1f}"


class MainWindow(QMainWindow):
    """The MotionForge Studio shell."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle(f"{APP_NAME} — {session.project.name}")
        self.setWindowIcon(app_icon())
        self.resize(1600, 950)
        self.setDockOptions(QMainWindow.AnimatedDocks | QMainWindow.AllowTabbedDocks)

        self.canvas = CanvasView(session)
        wrapper = QWidget()
        wrap_lay = QHBoxLayout(wrapper)
        wrap_lay.setContentsMargins(0, 0, 0, 0)
        wrap_lay.setSpacing(0)
        self.tool_rail = ToolRail(session)
        wrap_lay.addWidget(self.tool_rail)
        central = QWidget()
        central_lay = QVBoxLayout(central)
        central_lay.setContentsMargins(0, 0, 0, 0)
        central_lay.setSpacing(0)
        self.scene_bar = SceneBar(session)
        central_lay.addWidget(self.scene_bar)
        central_lay.addWidget(self.canvas, 1)
        wrap_lay.addWidget(central, 1)
        self.setCentralWidget(wrapper)

        # ------------------------------------------------------------ docks
        self.timeline = None
        from .timeline import TimelineWidget
        self.timeline = TimelineWidget(session)
        self.timeline_dock = self._dock("Timeline", self.timeline, Qt.BottomDockWidgetArea, 250)

        self.graph = GraphEditor(session)
        self.graph_dock = self._dock("Motion editor", self.graph, Qt.BottomDockWidgetArea, 200)
        self.graph_dock.setVisible(not session.beginner_mode)
        self.tabifyDockWidget(self.timeline_dock, self.graph_dock)
        self.timeline_dock.raise_()

        self.layers_panel = LayersPanel(session)
        self.layers_dock = self._dock("Layers", self.layers_panel, Qt.RightDockWidgetArea, 250)
        self.properties = PropertiesPanel(session)
        self.properties_dock = self._dock("Properties", self.properties, Qt.RightDockWidgetArea, 280)
        self.character = CharacterPanel(session)
        self.character_dock = self._dock("Character", self.character, Qt.RightDockWidgetArea, 280)
        self.ai_panel = AIPanel(session)
        self.ai_dock = self._dock("AI Assistant", self.ai_panel, Qt.RightDockWidgetArea, 300)
        self.assets = AssetsPanel(session)
        self.assets_dock = self._dock("Assets", self.assets, Qt.LeftDockWidgetArea, 260)

        self._build_statusbar()
        self._build_toolbar()
        self._build_menus()
        self._build_shortcuts()

        session.status_message.connect(self._show_status)
        session.modified_changed.connect(self._on_modified)
        session.frame_changed.connect(lambda *_: self._update_title())
        session.project_changed.connect(self._on_project_changed)
        session.tool_changed.connect(lambda *_: self._update_title())
        self._update_title()
        self._apply_mode()

    # ------------------------------------------------------------------ docks
    def _dock(self, title: str, widget: QWidget, area, height: int) -> QDockWidget:
        dock = QDockWidget(title, self)
        dock.setObjectName(title.replace(" ", ""))
        dock.setWidget(widget)
        dock.setAllowedAreas(Qt.AllDockWidgetAreas)
        self.addDockWidget(area, dock)
        if area in (Qt.BottomDockWidgetArea, Qt.TopDockWidgetArea):
            dock.setMinimumHeight(120)
            self.resizeDocks([dock], [height], Qt.Vertical)
        else:
            dock.setMinimumWidth(200)
            self.resizeDocks([dock], [260], Qt.Horizontal)
        return dock

    def _build_statusbar(self) -> None:
        bar = QStatusBar()
        self.setStatusBar(bar)
        self.status_label = QLabel("Ready")
        bar.addWidget(self.status_label, 1)
        self.coord_label = QLabel("")
        self.coord_label.setObjectName("hint")
        bar.addPermanentWidget(self.coord_label)
        self.zoom_label = QLabel("100%")
        self.zoom_label.setObjectName("hint")
        bar.addPermanentWidget(self.zoom_label)
        self.history_label = QLabel("")
        self.history_label.setObjectName("hint")
        bar.addPermanentWidget(self.history_label)
        self.progress = QProgressBar()
        self.progress.setFixedWidth(180)
        self.progress.setVisible(False)
        bar.addPermanentWidget(self.progress)

        self.canvas.cursor_moved.connect(
            lambda x, y: self.coord_label.setText(f"x {x:.0f}  y {y:.0f}"))
        self.canvas.zoom_changed.connect(
            lambda z: self.zoom_label.setText(f"{z * 100:.0f}%"))
        self.session.history_changed.connect(self._update_history_label)
        self.session.export_progress.connect(self._on_export_progress)
        self.session.export_finished.connect(self._on_export_finished)
        self._update_history_label()

    def _on_export_progress(self, done: int, total: int, message: str) -> None:
        self.progress.setVisible(True)
        self.progress.setMaximum(max(1, total))
        self.progress.setValue(done)
        self.status_label.setText(message)
        if done >= total:
            QTimer.singleShot(1200, lambda: self.progress.setVisible(False))

    def _on_export_finished(self, path: str) -> None:
        self.progress.setVisible(False)
        self.status_label.setText(f"Exported to {path}")

    def _update_history_label(self) -> None:
        history = self.session.history
        self.history_label.setText(f"undo: {len(history.undo_stack)}  "
                                   f"redo: {len(history.redo_stack)}")

    def _build_toolbar(self) -> None:
        bar = QToolBar("Main")
        bar.setObjectName("MainToolBar")
        bar.setIconSize(QSize(18, 18))
        bar.setMovable(False)
        self.addToolBar(bar)

        def add(icon_name: str, text: str, tip: str, slot, checkable=False):
            action = QAction(get_icon(icon_name, C.text), text, self)
            action.setToolTip(tip)
            action.setStatusTip(tip)
            action.setCheckable(checkable)
            action.triggered.connect(slot)
            bar.addAction(action)
            return action

        add("new", "New", "New project (Ctrl+N)", self.new_project)
        add("open", "Open", "Open a .mfs project (Ctrl+O)", self.open_project)
        add("save", "Save", "Save the project (Ctrl+S)", self.save_project)
        bar.addSeparator()
        self.undo_action = add("undo", "Undo", "Undo (Ctrl+Z)", self.session.undo)
        self.redo_action = add("redo", "Redo", "Redo (Ctrl+Y)", self.session.redo)
        bar.addSeparator()
        add("character", "Character", "Add a ready-made character",
            lambda: self.session.add_character(True))
        add("bone", "Auto Rig", "Auto rig the character on this layer",
            lambda: self.session.auto_rig_character())
        add("pose", "Pose", "Apply a pose preset", self._pose_menu)
        add("motion", "Animate", "Open the AI assistant", self._focus_ai)
        bar.addSeparator()
        add("export", "Export", "Export the animation (Ctrl+E)", self.export_dialog)
        bar.addSeparator()
        spacer = QWidget()
        spacer.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        bar.addWidget(spacer)
        self.mode_button = QPushButton("Beginner mode")
        self.mode_button.setToolTip("Switch between Beginner and Pro interface")
        self.mode_button.clicked.connect(self._toggle_mode)
        bar.addWidget(self.mode_button)
        self.playback = PlaybackBar(self.session)
        bar.addWidget(self.playback)

    # ------------------------------------------------------------------ menus
    def _build_menus(self) -> None:
        menu = self.menuBar()

        file_menu = menu.addMenu("&File")
        self._act(file_menu, "New project…", "Ctrl+N", self.new_project)
        self._act(file_menu, "Templates…", "", self._focus_templates)
        self._act(file_menu, "Open…", "Ctrl+O", self.open_project)
        sub = file_menu.addMenu("Open recent")
        self.recent_menu = sub
        sub.aboutToShow.connect(self._fill_recent)
        file_menu.addSeparator()
        self._act(file_menu, "Save", "Ctrl+S", self.save_project)
        self._act(file_menu, "Save as…", "Ctrl+Shift+S", lambda: self.save_project(True))
        self._act(file_menu, "Save a backup copy", "", self.backup_project)
        self._act(file_menu, "Recover autosave…", "", self.recover_autosave)
        file_menu.addSeparator()
        self._act(file_menu, "Import files…", "Ctrl+I", self.import_files)
        self._act(file_menu, "Export animation…", "Ctrl+E", self.export_dialog)
        self._act(file_menu, "Export current frame as PNG…", "", self.export_frame)
        file_menu.addSeparator()
        self._act(file_menu, "Preferences…", "Ctrl+,", self.preferences)
        self._act(file_menu, "Exit", "Ctrl+Q", self.close)

        edit_menu = menu.addMenu("&Edit")
        self._act(edit_menu, "Undo", "Ctrl+Z", self.session.undo)
        self._act(edit_menu, "Redo", "Ctrl+Y", self.session.redo)
        edit_menu.addSeparator()
        self._act(edit_menu, "Copy keys", "Ctrl+C", self.session.copy_keys)
        self._act(edit_menu, "Paste keys", "Ctrl+V", self.session.paste_keys)
        self._act(edit_menu, "Paste keys mirrored", "", lambda: self.session.paste_keys(True))
        edit_menu.addSeparator()
        self._act(edit_menu, "Clear frame", "Backspace+Ctrl", self.session.clear_cel)
        self._act(edit_menu, "Key transform", "K", self.session.key_transform)
        self._act(edit_menu, "Delete keys at playhead", "", self.session.delete_keys_at)
        self._act(edit_menu, "Convert drawing to vector", "", self.session.convert_cel_to_vector)

        view_menu = menu.addMenu("&View")
        for dock in self.findChildren(QDockWidget):
            view_menu.addAction(dock.toggleViewAction())
        view_menu.addSeparator()
        self._act(view_menu, "Zoom in", "Ctrl+=", self.canvas.zoom_in)
        self._act(view_menu, "Zoom out", "Ctrl+-", self.canvas.zoom_out)
        self._act(view_menu, "Fit to window", "Ctrl+0", self.canvas.fit_to_window)
        self._act(view_menu, "Reset zoom", "", self.canvas.reset_zoom)
        view_menu.addSeparator()
        grid = self._act(view_menu, "Show grid", "Ctrl+'", self._toggle_grid, checkable=True)
        grid.setChecked(bool(self.session.project.settings.get("grid", {}).get("visible", False)))
        self.grid_action = grid
        checker = self._act(view_menu, "Transparency checkerboard", "",
                            lambda: self._toggle_setting("canvas", "checker"), checkable=True)
        checker.setChecked(bool(self.session.project.settings.get("canvas", {})
                                .get("checker", True)))
        rec_check = self._act(view_menu, "Show recording frame", "",
                              lambda: self._toggle_setting("canvas", "safe_area"), checkable=True)
        rec_check.setChecked(bool(self.session.project.settings.get("canvas", {})
                                  .get("safe_area", True)))
        rig_check = self._act(view_menu, "Show rig overlay", "R", self._toggle_rig, checkable=True)
        rig_check.setChecked(True)
        view_menu.addSeparator()
        self._act(view_menu, "Beginner mode", "", lambda: self._set_mode(True), checkable=True)
        self._act(view_menu, "Pro mode", "", lambda: self._set_mode(False), checkable=True)

        anim_menu = menu.addMenu("&Animation")
        self._act(anim_menu, "Play / Pause", "Space", self.session.play_pause)
        self._act(anim_menu, "Stop", "", self.session.stop)
        self._act(anim_menu, "Next frame", "→", lambda: self.session.step_frame(1))
        self._act(anim_menu, "Previous frame", "←", lambda: self.session.step_frame(-1))
        self._act(anim_menu, "Next keyframe", "Shift+→", lambda: self.session.next_key(1))
        self._act(anim_menu, "Previous keyframe", "Shift+←", lambda: self.session.next_key(-1))
        anim_menu.addSeparator()
        self._act(anim_menu, "Add blank keyframe", "F", self.session.add_frame)
        self._act(anim_menu, "Duplicate keyframe", "D", self.session.duplicate_frame)
        self._act(anim_menu, "Delete frame", "Delete", self.session.delete_frame)
        self._act(anim_menu, "Insert frame", "Ctrl+F", lambda: self.session.insert_frame(1))
        exp = anim_menu.addMenu("Frame exposure")
        for hold in (1, 2, 3, 4, 6, 8, 12):
            exp.addAction(f"{hold} frame{'s' if hold > 1 else ''}",
                          lambda h=hold: self.session.set_exposure(h))
        anim_menu.addSeparator()
        onion = anim_menu.addMenu("Onion skin")
        onion.addAction("Enable / disable (O)", lambda: self.session.toggle_onion())
        onion.addAction("More previous frames",
                        lambda: self.session.set_onion_prop(
                            "prev_frames", int(self.session.project.settings.get("onion", {})
                                               .get("prev_frames", 2)) + 1))
        onion.addAction("Fewer previous frames",
                        lambda: self.session.set_onion_prop(
                            "prev_frames", max(0, int(self.session.project.settings.get("onion", {})
                                                      .get("prev_frames", 2)) - 1)))
        onion.addAction("Toggle next frames",
                        lambda: self.session.set_onion_prop(
                            "show_next", not self.session.project.settings.get("onion", {})
                            .get("show_next", True)))
        onion.addAction("Toggle tint",
                        lambda: self.session.set_onion_prop(
                            "tint", not self.session.project.settings.get("onion", {})
                            .get("tint", True)))
        anim_menu.addSeparator()
        self._act(anim_menu, "Auto inbetween 4 frames", "",
                  lambda: self.session.ai_inbetween(4))
        self._act(anim_menu, "Auto inbetween 8 frames", "",
                  lambda: self.session.ai_inbetween(8))
        self._act(anim_menu, "Auto inbetween 12 frames", "",
                  lambda: self.session.ai_inbetween(12))
        self._act(anim_menu, "Auto inbetween 24 frames", "",
                  lambda: self.session.ai_inbetween(24))
        self._act(anim_menu, "Auto smoothing on the current layer", "",
                  lambda: self.session.apply_auto_smoothing(True))

        char_menu = menu.addMenu("&Character")
        self._act(char_menu, "Add stick figure", "",
                  lambda: self.session.add_character(True, style="stick"))
        self._act(char_menu, "Add cartoon character", "",
                  lambda: self.session.add_character(True, style="cartoon"))
        self._act(char_menu, "Auto Rig Character", "", lambda: self.session.auto_rig_character())
        self._act(char_menu, "Detect body parts on this layer",
                  "", lambda: self.session.detect_character_parts())
        char_menu.addSeparator()
        self._act(char_menu, "New empty rig", "", self.session.create_rig_for_active_layer)
        self._act(char_menu, "Key whole pose", "Shift+K", self.session.key_bone_pose)
        self._act(char_menu, "Reset pose", "", self.session.reset_pose)
        self._act(char_menu, "Mirror pose", "", self.session.mirror_pose)
        self._act(char_menu, "Store current pose in the library", "", self._store_pose)
        char_menu.addSeparator()
        pose_menu = char_menu.addMenu("Apply pose")
        from ..ai.poses import POSES
        for name in sorted(POSES.keys()):
            pose_menu.addAction(name, lambda n=name: self.session.apply_pose(n))

        ai_menu = menu.addMenu("&AI")
        self._act(ai_menu, "AI assistant panel", "", self._focus_ai)
        self._act(ai_menu, "Plan from text…", "", self._ai_prompt)
        self._act(ai_menu, "AI pose generator…", "", self._focus_ai_pose)
        self._act(ai_menu, "Motion generator (pose A → pose B)…", "", self._focus_ai_motion)
        self._act(ai_menu, "Smart lip sync from audio…", "", self._focus_ai_lipsync)
        self._act(ai_menu, "Text → animation (multi-track)…", "", self._text_to_animation)
        ai_menu.addSeparator()
        self._act(ai_menu, "AI provider settings…", "", self._ai_settings)

        export_menu = menu.addMenu("E&xport")
        self._act(export_menu, "Export animation…", "Ctrl+E", self.export_dialog)
        for fmt, label in (("mp4", "MP4 (video)"), ("webm", "WebM (video)"), ("gif", "GIF"),
                           ("png", "PNG sequence"), ("jpeg", "JPEG sequence")):
            export_menu.addAction(label, lambda f=fmt: self.export_dialog(f))
        export_menu.addSeparator()
        self._act(export_menu, "Export current frame as PNG", "", self.export_frame)
        self._act(export_menu, "Export contact sheet…", "", self.export_contact_sheet)
        sheet = export_menu.addMenu("Storyboard of every scene")
        sheet.addAction("Save PNG…", self.export_storyboard)

        settings_menu = menu.addMenu("&Settings")
        self._act(settings_menu, "Preferences…", "Ctrl+,", self.preferences)
        self._act(settings_menu, "AI settings…", "", self._ai_settings)
        self._act(settings_menu, "Keyboard shortcuts…", "", self.preferences)
        settings_menu.addSeparator()
        self._act(settings_menu, "Switch to Beginner mode", "", lambda: self._set_mode(True))
        self._act(settings_menu, "Switch to Pro mode", "", lambda: self._set_mode(False))
        settings_menu.addSeparator()
        self._act(settings_menu, f"About {APP_NAME}", "", self.about)

        help_menu = menu.addMenu("&Help")
        self._act(help_menu, "Quick start (5 steps)", "", self.quick_start)
        self._act(help_menu, "Shortcut cheat sheet…", "", self.preferences)
        self._act(help_menu, f"About {APP_NAME}", "", self.about)

    def _act(self, menu: QMenu, text: str, shortcut: str, slot, checkable: bool = False) -> QAction:
        action = QAction(text, self)
        if shortcut:
            action.setShortcut(QKeySequence(shortcut))
        action.setCheckable(checkable)
        action.triggered.connect(slot)
        menu.addAction(action)
        return action

    def _build_shortcuts(self) -> None:
        bindings = [
            ("Space", self.session.play_pause),
            ("Left", lambda: self.session.step_frame(-1)),
            ("Right", lambda: self.session.step_frame(1)),
            ("Shift+Left", lambda: self.session.next_key(-1)),
            ("Shift+Right", lambda: self.session.next_key(1)),
            ("Home", lambda: self.session.set_frame(self.session.scene.frame_start)),
            ("End", lambda: self.session.set_frame(self.session.scene.total_frames())),
            ("F", self.session.add_frame),
            ("D", self.session.duplicate_frame),
            ("Delete", self.session.delete_frame),
            ("Ctrl+F", lambda: self.session.insert_frame(1)),
            ("K", self.session.key_transform),
            ("Shift+K", self.session.key_bone_pose),
            ("O", lambda: self.session.toggle_onion()),
            ("R", self._toggle_rig),
            ("Ctrl+'", lambda: self._toggle_grid()),
            ("B", lambda: self.session.set_tool("brush")),
            ("P", lambda: self.session.set_tool("pencil")),
            ("I", lambda: self.session.set_tool("ink")),
            ("M", lambda: self.session.set_tool("marker")),
            ("S", lambda: self.session.set_tool("soft")),
            ("A", lambda: self.session.set_tool("airbrush")),
            ("C", lambda: self.session.set_tool("charcoal")),
            ("E", lambda: self.session.set_tool("eraser")),
            ("G", lambda: self.session.set_tool("fill")),
            ("U", lambda: self.session.set_tool("shape")),
            ("T", lambda: self.session.set_tool("text")),
            ("W", lambda: self.session.set_tool("transform")),
            ("N", lambda: self.session.set_tool("bone")),
            ("V", lambda: self.session.set_tool("select")),
            ("H", lambda: self.session.set_tool("hand")),
            ("Z", lambda: self.session.set_tool("zoom")),
            ("X", self._swap_colors),
            ("[", lambda: self._nudge_brush(-2)),
            ("]", lambda: self._nudge_brush(2)),
        ]
        self.shortcuts = []
        for sequence, slot in bindings:
            shortcut = QShortcut(QKeySequence(sequence), self)
            shortcut.activated.connect(slot)
            shortcut.setContext(Qt.WindowShortcut)
            self.shortcuts.append(shortcut)
        QShortcut(QKeySequence("Ctrl+E"), self).activated.connect(self.export_dialog)
        QShortcut(QKeySequence("Ctrl+N"), self).activated.connect(self.new_project)
        QShortcut(QKeySequence("Ctrl+O"), self).activated.connect(self.open_project)
        QShortcut(QKeySequence("Ctrl+S"), self).activated.connect(lambda: self.save_project())
        QShortcut(QKeySequence("Ctrl+I"), self).activated.connect(self.import_files)

    # ------------------------------------------------------------------ state
    def _update_title(self) -> None:
        session = self.session
        mark = "•" if session.project.dirty else ""
        self.setWindowTitle(f"{APP_NAME} — {session.project.name}{mark}  ·  "
                            f"{session.scene.name}  ·  {session.tool}")

    def _on_modified(self, dirty: bool) -> None:
        self._update_title()

    def _on_project_changed(self) -> None:
        self.canvas.fit_to_window()
        self.graph.fit()
        self._update_title()
        self.assets.rebuild()
        self.character.sync()
        self.properties.sync()

    def _show_status(self, text: str) -> None:
        self.status_label.setText(text)
        QTimer.singleShot(6000, lambda: self.status_label.setText("Ready"))

    def _apply_mode(self) -> None:
        beginner = self.session.beginner_mode
        self.mode_button.setText("Beginner mode" if beginner else "Pro mode")
        self.graph_dock.setVisible(not beginner)
        self.character_dock.setVisible(not beginner)
        self.assets_dock.setVisible(not beginner)
        self.properties_dock.setVisible(True)
        self.properties.tabs.setTabVisible(3, not beginner)
        self.properties.tabs.setTabVisible(4, True)
        self.playback.quality_combo.setVisible(not beginner)

    def _toggle_mode(self) -> None:
        self._set_mode(not self.session.beginner_mode)

    def _set_mode(self, beginner: bool) -> None:
        self.session.set_mode(beginner)
        self._apply_mode()
        self.session.status(f"{'Beginner' if beginner else 'Pro'} mode")

    def _swap_colors(self) -> None:
        primary = self.session.primary_color
        self.session.primary_color = self.session.secondary_color
        self.session.secondary_color = primary
        color = self.session.primary_color
        self.session.set_brush_prop("color", (color.red(), color.green(), color.blue(),
                                             color.alpha()))
        self.tool_rail._update_swatch()
        self.session.status("Swapped the primary and secondary colours")

    def _nudge_brush(self, direction: int) -> None:
        brush = self.session.brush
        size = max(1.0, brush.size + direction * max(1.0, brush.size * 0.15))
        self.session.set_brush_prop("size", size)
        self.session.status(f"Brush size {size:.0f} px")

    def _toggle_grid(self) -> None:
        self._toggle_setting("grid", "visible")
        self.grid_action.setChecked(bool(self.session.project.settings.get("grid", {})
                                         .get("visible", False)))

    def _toggle_rig(self) -> None:
        self.session.show_rig = not self.session.show_rig
        self.session.canvas_changed.emit()
        self.session.status("Rig overlay " + ("on" if self.session.show_rig else "off"))

    def _toggle_setting(self, section: str, key: str) -> None:
        data = self.session.project.settings.setdefault(section, {})
        data[key] = not data.get(key, False)
        self.session.canvas_changed.emit()

    # ------------------------------------------------------------------ files
    def _confirm_discard(self) -> bool:
        if not self.session.project.dirty:
            return True
        answer = QMessageBox.question(
            self, "Unsaved changes",
            "Save the current project before continuing?",
            QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if answer == QMessageBox.Cancel:
            return False
        if answer == QMessageBox.Save:
            return self.save_project()
        return True

    def new_project(self) -> None:
        if not self._confirm_discard():
            return
        dialog = NewProjectDialog(self.session, self)
        if not dialog.exec():
            return
        self.session.new_project(dialog.template(), size=dialog.size_combo.currentData(),
                                 fps=dialog.fps_spin.value(), name=dialog.name_edit.text())
        self.canvas.fit_to_window()
        self._update_title()

    def open_project(self, path: str | None = None) -> None:
        if not self._confirm_discard():
            return
        if not path:
            path, _f = QFileDialog.getOpenFileName(self, "Open project", "",
                                                   f"{APP_NAME} project (*.mfs);;All files (*)")
        if not path:
            return
        if self.session.open_project(path):
            self.canvas.fit_to_window()
            self.status_label.setText(f"Opened {os.path.basename(path)}")
            self._update_title()

    def save_project(self, save_as: bool = False) -> bool:
        path = self.session.project.path
        if save_as or not path:
            suggested = path or f"{self.session.project.name}.mfs"
            path, _f = QFileDialog.getSaveFileName(self, "Save project", suggested,
                                                   f"{APP_NAME} project (*.mfs)")
        if not path:
            return False
        ok = self.session.save_project(path)
        if ok:
            self.status_label.setText(f"Saved {os.path.basename(path)}")
            self._update_title()
        return ok

    def backup_project(self) -> None:
        from ..io import project_file
        path, _f = QFileDialog.getSaveFileName(self, "Save a backup copy",
                                               f"{self.session.project.name} backup.mfs",
                                               f"{APP_NAME} project (*.mfs)")
        if path:
            project_file.save_project(self.session.project, path)
            self.status_label.setText(f"Backup written to {path}")

    def recover_autosave(self) -> None:
        from ..io.project_file import list_autosaves
        entries = list_autosaves()
        if not entries:
            QMessageBox.information(self, "Recovery", "No autosaved projects were found.")
            return
        dialog = RecoveryDialog(entries, self)
        if dialog.exec():
            entry = dialog.chosen()
            if entry:
                self.open_project(entry["path"])

    def _fill_recent(self) -> None:
        from ..io.project_file import load_recent_files
        self.recent_menu.clear()
        entries = load_recent_files()
        if not entries:
            self.recent_menu.addAction("(nothing yet)").setEnabled(False)
            return
        for entry in entries[:12]:
            path = entry.get("path", "")
            self.recent_menu.addAction(entry.get("name", path),
                                       lambda p=path: self.open_project(p))

    def import_files(self) -> None:
        paths, _f = QFileDialog.getOpenFileNames(
            self, "Import", "",
            "Media (*.png *.jpg *.jpeg *.bmp *.gif *.svg *.webp *.wav *.mp3 *.ogg *.mp4 *.mov "
            "*.webm);;Images (*.png *.jpg *.jpeg *.bmp *.gif *.svg *.webp);;"
            "Audio (*.wav *.mp3 *.ogg);;Video (*.mp4 *.mov *.webm);;All files (*)")
        if paths:
            self.session.import_paths(paths)
            self.status_label.setText(f"Imported {len(paths)} file(s)")

    def export_dialog(self, fmt: str | None = None) -> None:
        dialog = ExportDialog(self.session, self)
        if fmt:
            index = dialog.format_combo.findData(fmt)
            if index >= 0:
                dialog.format_combo.setCurrentIndex(index)
        dialog.exec()

    def export_frame(self) -> None:
        from ..engine.render import RenderOptions, render_scene
        path, _f = QFileDialog.getSaveFileName(self, "Export frame", "frame.png",
                                               "PNG image (*.png)")
        if not path:
            return
        scene = self.session.scene
        options = RenderOptions(frame=self.session.frame, size=(scene.width, scene.height),
                                background=True, camera=False, quality="final",
                                for_export=True)
        image = render_scene(scene, self.session.project, options)
        image.save(path, "PNG")
        self.status_label.setText(f"Frame exported to {path}")

    def export_contact_sheet(self) -> None:
        from ..engine.exporter import export_preview_sheet
        path, _f = QFileDialog.getSaveFileName(self, "Export contact sheet", "sheet.png",
                                               "PNG image (*.png)")
        if not path:
            return
        scene = self.session.scene
        total = scene.total_frames()
        step = max(1, total // 12)
        frames = list(range(scene.frame_start, total + 1, step))[:12]
        export_preview_sheet(scene, self.session.project, path, frames)
        self.status_label.setText(f"Contact sheet saved to {path}")

    def export_storyboard(self) -> None:
        from ..engine.exporter import export_preview_sheet
        from ..engine.render import RenderOptions, render_scene
        path, _f = QFileDialog.getSaveFileName(self, "Storyboard", "storyboard.png",
                                               "PNG image (*.png)")
        if not path:
            return
        project = self.session.project
        for scene in project.scenes:
            options = RenderOptions(frame=scene.frame_start, size=(480, 270), background=True,
                                    camera=True, quality="high")
            _ = render_scene(scene, project, options)
        export_preview_sheet(project.active_scene, project, path,
                             [scene.frame_start for scene in project.scenes])
        self.status_label.setText(f"Storyboard saved to {path}")

    def preferences(self) -> None:
        PreferencesDialog(self.session, self).exec()

    def about(self) -> None:
        AboutDialog(self).exec()

    # -------------------------------------------------------------------- AI
    def _focus_ai(self) -> None:
        self.ai_dock.show()
        self.ai_dock.raise_()
        self.ai_panel.tabs.setCurrentIndex(0)

    def _focus_ai_pose(self) -> None:
        self._focus_ai()
        self.ai_panel.tabs.setCurrentIndex(1)

    def _focus_ai_motion(self) -> None:
        self._focus_ai()
        self.ai_panel.tabs.setCurrentIndex(2)

    def _focus_ai_lipsync(self) -> None:
        self._focus_ai()
        self.ai_panel.tabs.setCurrentIndex(4)

    def _focus_templates(self) -> None:
        self.assets_dock.show()
        self.assets_dock.raise_()
        self.assets.tabs.setCurrentIndex(2)

    def _ai_prompt(self) -> None:
        from PySide6.QtWidgets import QInputDialog
        self._focus_ai()
        text, ok = QInputDialog.getText(self, "AI animation assistant",
                                        "Describe the animation:",
                                        QLineEdit.Normal,
                                        self.ai_panel.instruction.text())
        if ok and text.strip():
            self.ai_panel.instruction.setText(text)
            self.ai_panel.plan()

    def _text_to_animation(self) -> None:
        from PySide6.QtWidgets import QInputDialog
        text, ok = QInputDialog.getMultiLineText(
            self, "Text → animation",
            "Describe the whole sequence (one action per line works best):",
            "a robot walks to school\nwave at the teacher\nsit down and open a book")
        if not ok or not text.strip():
            return
        self.session.ai_text_to_animation(text)

    def _ai_settings(self) -> None:
        if AISettingsDialog(self.session, self).exec():
            self.session.reload_ai()

    def _pose_menu(self) -> None:
        from ..ai.poses import POSES
        menu = QMenu(self)
        for name in sorted(POSES.keys()):
            menu.addAction(name, lambda n=name: self.session.apply_pose(n))
        menu.exec(self.mapToGlobal(self.rect().center()))

    def _store_pose(self) -> None:
        from PySide6.QtWidgets import QInputDialog
        name, ok = QInputDialog.getText(self, "Store pose", "Pose name:", QLineEdit.Normal,
                                        "My Pose")
        if ok and name.strip():
            self.session.store_pose(name.strip())

    # -------------------------------------------------------------- lifecycle
    def quick_start(self) -> None:
        QMessageBox.information(
            self, "Quick start",
            "1. Draw your character with the Brush (B) on the canvas.\n"
            "2. Press F for a new frame, draw the next pose (O shows onion skin).\n"
            "3. Press Space to play it back.\n"
            "4. Select the layer and press K to key the transform, or Auto Rig to animate a "
            "skeleton.\n"
            "5. Ctrl+S saves the .mfs project and Ctrl+E exports MP4, WebM, GIF or a PNG "
            "sequence.")

    def closeEvent(self, event) -> None:
        if not self._confirm_discard():
            event.ignore()
            return
        self.session.close()
        event.accept()
