"""The AI Animation Assistant panel plus the pose / inbetween / lip sync tools."""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import (QComboBox, QDoubleSpinBox, QFormLayout, QFrame, QHBoxLayout,
                               QLabel, QLineEdit, QListWidget, QListWidgetItem, QPlainTextEdit,
                               QPushButton, QSlider, QSpinBox, QTabWidget, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from ..ai.poses import POSE_CATEGORIES, POSES
from .theme import C, get_icon

EXAMPLES = [
    "walk left to right, stop, wave, then keep walking",
    "jump with anticipation and a soft landing",
    "run for 3 seconds",
    "wave the right hand twice",
    "sit down, wait, then stand up and stretch",
    "text to animation: a robot walks to school",
    "zoom in on the character and shake the camera",
    "make her dance in the classroom",
]


class AIPanel(QWidget):
    """Natural language → editable animation data (never a rendered video)."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setAcceptDrops(False)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs)
        self.tabs.addTab(self._build_assistant(), "Assistant")
        self.tabs.addTab(self._build_pose(), "Pose")
        self.tabs.addTab(self._build_motion(), "Motion")
        self.tabs.addTab(self._build_inbetween(), "Inbetween")
        self.tabs.addTab(self._build_lipsync(), "Lip Sync")

        session.ai_message.connect(self._on_message)
        session.project_changed.connect(self._refresh_target)
        session.layer_selected.connect(lambda *_: self._refresh_target())
        session.assets_changed.connect(self._refresh_audio)
        self._refresh_target()
        self._refresh_audio()

    # -------------------------------------------------------------- assistant
    def _build_assistant(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        self.provider_label = QLabel("")
        self.provider_label.setObjectName("hint")
        lay.addWidget(self.provider_label)

        row = QHBoxLayout()
        self.instruction = QLineEdit()
        self.instruction.setPlaceholderText("Describe the animation… e.g. 'walk right then jump'")
        self.instruction.setToolTip("The assistant converts this into editable keyframes")
        self.instruction.returnPressed.connect(self.plan)
        row.addWidget(self.instruction, 1)
        plan_btn = QPushButton("Plan")
        plan_btn.setToolTip("Build a plan without touching your project")
        plan_btn.clicked.connect(self.plan)
        row.addWidget(plan_btn)
        self.apply_btn = QPushButton("Apply")
        self.apply_btn.setObjectName("primary")
        self.apply_btn.setToolTip("Insert the plan as keyframes (undoable with Ctrl+Z)")
        self.apply_btn.clicked.connect(self.apply_plan)
        self.apply_btn.setEnabled(False)
        row.addWidget(self.apply_btn)
        lay.addLayout(row)

        self.examples = QComboBox()
        self.examples.addItem("Example instructions…", "")
        for example in EXAMPLES:
            self.examples.addItem(example, example)
        self.examples.currentIndexChanged.connect(self._use_example)
        lay.addWidget(self.examples)

        self.plan_list = QListWidget()
        self.plan_list.setAlternatingRowColors(True)
        self.plan_list.setToolTip("Every row becomes editable keyframes when you press Apply")
        lay.addWidget(self.plan_list, 1)

        self.chat = QPlainTextEdit()
        self.chat.setReadOnly(True)
        self.chat.setFixedHeight(96)
        self.chat.setPlaceholderText("The assistant's notes appear here.")
        lay.addWidget(self.chat)

        bottom = QHBoxLayout()
        select_btn = QPushButton("Select all")
        select_btn.setToolTip("Re-enable every row of the plan")
        select_btn.clicked.connect(lambda: self._set_all(True))
        bottom.addWidget(select_btn)
        deselect_btn = QPushButton("Deselect all")
        deselect_btn.clicked.connect(lambda: self._set_all(False))
        bottom.addWidget(deselect_btn)
        settings_btn = QPushButton("AI settings…")
        settings_btn.setToolTip("Choose the provider and enter your own API key")
        settings_btn.clicked.connect(self._open_settings)
        bottom.addWidget(settings_btn)
        lay.addLayout(bottom)
        return holder

    def _use_example(self, index: int) -> None:
        text = self.examples.itemData(index)
        if text:
            self.instruction.setText(text)
            self.instruction.setFocus()

    def _open_settings(self) -> None:
        from .dialogs import AISettingsDialog
        dialog = AISettingsDialog(self.session, self)
        if dialog.exec():
            self.session.reload_ai()
            self._refresh_target()

    def plan(self) -> None:
        text = self.instruction.text().strip()
        if not text:
            return
        plan = self.session.ai_plan(text)
        self.plan_list.clear()
        if plan is None:
            return
        for action in plan.actions:
            item = QListWidgetItem(f"{action.describe()}")
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked)
            item.setData(Qt.UserRole, action)
            item.setToolTip(f"frames {action.start}–{action.end}")
            self.plan_list.addItem(item)
        self.apply_btn.setEnabled(bool(plan.actions))
        self.chat.appendPlainText(plan.summary)
        self.session.pending_plan = plan
        self.tabs.setCurrentIndex(0)

    def _set_all(self, checked: bool) -> None:
        state = Qt.Checked if checked else Qt.Unchecked
        for i in range(self.plan_list.count()):
            self.plan_list.item(i).setCheckState(state)

    def apply_plan(self) -> None:
        plan = self.session.pending_plan
        if plan is None:
            return
        selected = []
        for i in range(self.plan_list.count()):
            item = self.plan_list.item(i)
            if item.checkState() == Qt.Checked:
                selected.append(item.data(Qt.UserRole))
        if not selected:
            self.session.status("Select at least one action to apply")
            return
        plan.actions = [a for a in plan.actions if a in selected]
        self.session.ai_apply(plan)
        self.apply_btn.setEnabled(False)

    def _on_message(self, role: str, text: str) -> None:
        prefix = {"assistant": "AI", "user": "You", "error": "⚠"}.get(role, role)
        self.chat.appendPlainText(f"{prefix}: {text}")

    def _refresh_target(self) -> None:
        from ..ai.providers import load_ai_settings
        settings = load_ai_settings()
        provider = settings.get("provider", "offline")
        model = settings.get("model", "")
        label = {"offline": "Offline director (no internet needed)",
                 "openai": f"OpenAI compatible · {model or 'gpt-4o-mini'}",
                 "local": f"Local server · {settings.get('base_url', '')}",
                 "custom": "Custom provider"}.get(provider, provider)
        self.provider_label.setText(f"Provider: {label}")
        rig = self.session.active_rig()
        self.chat.setPlaceholderText(
            f"Rig detected: {rig.name}" if rig else
            "No rig on this layer — the assistant will animate the layer transform instead.")

    # ------------------------------------------------------------------- pose
    def _build_pose(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        lay.addWidget(QLabel("Describe a pose"))
        row = QHBoxLayout()
        self.pose_input = QLineEdit()
        self.pose_input.setPlaceholderText("running, jumping, sitting, fighting, waving…")
        self.pose_input.returnPressed.connect(self.generate_pose)
        row.addWidget(self.pose_input, 1)
        gen = QPushButton("Generate")
        gen.setObjectName("primary")
        gen.setToolTip("Generate a pose you can tweak by hand")
        gen.clicked.connect(self.generate_pose)
        row.addWidget(gen)
        lay.addLayout(row)

        self.pose_category = QComboBox()
        self.pose_category.addItem("All categories", None)
        for key in POSE_CATEGORIES:
            self.pose_category.addItem(key, key)
        self.pose_category.currentIndexChanged.connect(self._fill_pose_list)
        lay.addWidget(self.pose_category)

        self.pose_list = QListWidget()
        self.pose_list.itemDoubleClicked.connect(self._apply_listed_pose)
        lay.addWidget(self.pose_list, 1)

        row2 = QHBoxLayout()
        key_btn = QPushButton("Apply at playhead")
        key_btn.setToolTip("Key the listed pose at the playhead")
        key_btn.clicked.connect(self._apply_listed_pose)
        row2.addWidget(key_btn)
        key_hold = QPushButton("Key over 12 frames")
        key_hold.setToolTip("Insert the pose and hold it for 12 frames")
        key_hold.clicked.connect(lambda: self._apply_listed_pose(12))
        row2.addWidget(key_hold)
        lay.addLayout(row2)
        self._fill_pose_list()
        return holder

    def _fill_pose_list(self) -> None:
        category = self.pose_category.currentData()
        self.pose_list.clear()
        for name in sorted(POSES.keys()):
            if category and name not in POSE_CATEGORIES.get(category, []):
                continue
            item = QListWidgetItem(name)
            item.setData(Qt.UserRole, name)
            self.pose_list.addItem(item)

    def generate_pose(self) -> None:
        text = self.pose_input.text().strip()
        if not text:
            return
        self.session.ai_pose(self.session.active_rig(), text)
        names = [self.pose_list.item(i).data(Qt.UserRole) for i in range(self.pose_list.count())]
        for i, name in enumerate(sorted(POSES.keys())):
            if text.lower() in name.lower() and name not in names:
                item = QListWidgetItem(name)
                item.setData(Qt.UserRole, name)
                self.pose_list.insertItem(0, item)

    def _apply_listed_pose(self, hold: int = 0) -> None:
        item = self.pose_list.currentItem()
        if item is None:
            return
        name = item.data(Qt.UserRole)
        self.session.apply_pose(name)
        if hold:
            self.session.set_exposure(int(hold))

    # ----------------------------------------------------------------- motion
    def _build_motion(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        lay.addWidget(QLabel("Motion generator — pose A → pose B inbetweens"))
        form = QFormLayout()
        form.setSpacing(4)
        self.motion_a = QComboBox()
        self.motion_b = QComboBox()
        for name in sorted(POSES.keys()):
            self.motion_a.addItem(name, name)
            self.motion_b.addItem(name, name)
        self.motion_a.setCurrentIndex(min(1, self.motion_a.count() - 1))
        self.motion_b.setCurrentIndex(min(2, self.motion_b.count() - 1))
        form.addRow("Pose A", self.motion_a)
        form.addRow("Pose B", self.motion_b)
        self.motion_start = QSpinBox()
        self.motion_start.setRange(0, 100000)
        self.motion_start.setToolTip("First frame")
        form.addRow("Start frame", self.motion_start)
        self.motion_end = QSpinBox()
        self.motion_end.setRange(1, 100000)
        self.motion_end.setValue(24)
        form.addRow("End frame", self.motion_end)
        self.motion_steps = QSpinBox()
        self.motion_steps.setRange(1, 24)
        self.motion_steps.setValue(3)
        self.motion_steps.setToolTip("How many interpolated poses to insert")
        form.addRow("Inbetweens", self.motion_steps)
        self.motion_arc = QDoubleSpinBox()
        self.motion_arc.setRange(-400, 400)
        self.motion_arc.setToolTip("Arc height added to the motion path (px)")
        form.addRow("Arc", self.motion_arc)
        self.motion_easing = QComboBox()
        for key, label in (("linear", "Linear"), ("ease_in", "Ease In"), ("ease_out", "Ease Out"),
                           ("ease_in_out", "Ease In-Out"), ("bounce", "Bounce"),
                           ("elastic", "Elastic"), ("back", "Back")):
            self.motion_easing.addItem(label, key)
        self.motion_easing.setCurrentIndex(3)
        form.addRow("Easing", self.motion_easing)
        lay.addLayout(form)

        generate = QPushButton("Generate inbetweens")
        generate.setObjectName("primary")
        generate.setToolTip("Create the keyframes between the two poses")
        generate.clicked.connect(self.generate_motion)
        lay.addWidget(generate)

        bake = QPushButton("Bake rig keys (every frame)")
        bake.setToolTip("Convert the poses into a key on every single frame")
        bake.clicked.connect(self._bake_rig)
        lay.addWidget(bake)
        lay.addStretch(1)
        return holder

    def generate_motion(self) -> None:
        rig = self.session.active_rig()
        if rig is None:
            self.session.status("Select a character layer first")
            return
        start = self.motion_start.value()
        end = max(start + 1, self.motion_end.value())
        self.session.ai_generate_motion(rig, self.motion_a.currentData(),
                                        self.motion_b.currentData(), start, end,
                                        steps=self.motion_steps.value(),
                                        easing=self.motion_easing.currentData(),
                                        arc=self.motion_arc.value())

    def _bake_rig(self) -> None:
        rig = self.session.active_rig()
        if rig is None:
            return
        self.session.bake_rig_to_layer(rig)
        self.session.status("Rig baked into keys")

    # -------------------------------------------------------------- inbetween
    def _build_inbetween(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        lay.addWidget(QLabel("Auto inbetween the drawing on this layer"))
        self.inbetween_info = QLabel("")
        self.inbetween_info.setObjectName("hint")
        self.inbetween_info.setWordWrap(True)
        lay.addWidget(self.inbetween_info)

        row = QHBoxLayout()
        self.inbetween_count = QComboBox()
        for count in (4, 8, 12, 24):
            self.inbetween_count.addItem(f"{count} inbetweens", count)
        self.inbetween_count.setCurrentIndex(1)
        row.addWidget(self.inbetween_count, 1)
        gen = QPushButton("Generate")
        gen.setObjectName("primary")
        gen.setToolTip("Interpolate the shapes between the first and the last drawing")
        gen.clicked.connect(self.run_inbetween)
        row.addWidget(gen)
        lay.addLayout(row)

        regen = QPushButton("Regenerate (new variation)")
        regen.setToolTip("Re-run with a different seed for a different interpretation")
        regen.clicked.connect(lambda: self.run_inbetween(reseed=True))
        lay.addWidget(regen)

        self.inbetween_boil = QSlider(Qt.Horizontal)
        self.inbetween_boil.setRange(0, 100)
        self.inbetween_boil.setToolTip("Adds a hand-drawn wobble to the inbetweens")
        lay.addWidget(QLabel("Line boil"))
        lay.addWidget(self.inbetween_boil)

        self.inbetween_layer_only = QComboBox()
        self.inbetween_layer_only.addItem("This layer only", True)
        self.inbetween_layer_only.addItem("All drawing layers", False)
        lay.addWidget(self.inbetween_layer_only)
        lay.addStretch(1)
        session = self.session
        session.frame_changed.connect(lambda *_: self._refresh_inbetween())
        session.layer_selected.connect(lambda *_: self._refresh_inbetween())
        session.timeline_changed.connect(self._refresh_inbetween)
        self._refresh_inbetween()
        return holder

    def _refresh_inbetween(self) -> None:
        layer = self.session.active_layer()
        if layer is None:
            self.inbetween_info.setText("No layer")
            return
        keys = layer.cel_keys()
        self.inbetween_info.setText(
            f"{layer.name}: {len(keys)} drawing(s) — {keys[:8]}{'…' if len(keys) > 8 else ''}\n"
            "The tool interpolates every pair of neighbouring drawings.")

    def run_inbetween(self, reseed: bool = False) -> None:
        count = int(self.inbetween_count.currentData() or 8)
        layer = self.session.active_layer()
        if layer is None:
            return
        seed = 0
        if reseed:
            self._seed = getattr(self, "_seed", 0) + 1
            seed = self._seed
        self.session.ai_inbetween(count, layer=layer, seed=seed,
                                  boil=self.inbetween_boil.value() / 100.0)

    # ---------------------------------------------------------------- lipsync
    def _build_lipsync(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        lay.addWidget(QLabel("Smart lip sync"))
        row = QHBoxLayout()
        self.audio_combo = QComboBox()
        self.audio_combo.setToolTip("Pick an imported audio asset")
        row.addWidget(self.audio_combo, 1)
        import_btn = QPushButton("Import audio…")
        import_btn.clicked.connect(self._import_audio)
        row.addWidget(import_btn)
        lay.addLayout(row)

        row2 = QHBoxLayout()
        self.lipsync_start = QSpinBox()
        self.lipsync_start.setRange(0, 100000)
        self.lipsync_start.setToolTip("Frame where the audio starts")
        row2.addWidget(QLabel("Start"))
        row2.addWidget(self.lipsync_start)
        run = QPushButton("Generate lip sync")
        run.setObjectName("primary")
        run.setToolTip("Analyse the audio and create editable mouth shapes")
        run.clicked.connect(self.run_lipsync)
        row2.addWidget(run, 1)
        lay.addLayout(row2)

        self.mouth_layer_check = QComboBox()
        self.mouth_layer_check.addItem("Create an editable Mouth layer", True)
        self.mouth_layer_check.addItem("Only key the mouth bones", False)
        lay.addWidget(self.mouth_layer_check)

        self.viseme_table = QTableWidget(0, 4)
        self.viseme_table.setHorizontalHeaderLabels(["Frame", "Length", "Mouth shape",
                                                     "Confidence"])
        self.viseme_table.horizontalHeader().setStretchLastSection(True)
        self.viseme_table.setAlternatingRowColors(True)
        self.viseme_table.setToolTip("Change a mouth shape and press Apply to edit the result")
        lay.addWidget(self.viseme_table, 1)

        row3 = QHBoxLayout()
        apply_btn = QPushButton("Apply edits")
        apply_btn.setToolTip("Rebuild the mouth animation from the table above")
        apply_btn.clicked.connect(self._apply_table_edits)
        row3.addWidget(apply_btn)
        export_btn = QPushButton("Export cues…")
        export_btn.setToolTip("Save the viseme list as a text file")
        export_btn.clicked.connect(self._export_cues)
        row3.addWidget(export_btn)
        lay.addLayout(row3)
        return holder

    def _import_audio(self) -> None:
        from PySide6.QtWidgets import QFileDialog
        paths, _f = QFileDialog.getOpenFileNames(self, "Import audio", "",
                                                 "Audio (*.wav *.mp3 *.ogg *.m4a *.flac)")
        if paths:
            self.session.import_paths(paths)

    def _refresh_audio(self) -> None:
        self.audio_combo.clear()
        for asset in self.session.project.assets.values():
            if asset.kind == "audio":
                self.audio_combo.addItem(asset.name, asset.uid)

    def run_lipsync(self) -> None:
        uid = self.audio_combo.currentData()
        if not uid:
            self.session.status("Import an audio file first")
            return
        track = self.session.ai_lipsync(uid, use_mouth_layer=bool(self.mouth_layer_check
                                                                 .currentData()),
                                        start_frame=self.lipsync_start.value())
        self._fill_table(track)

    def _fill_table(self, track) -> None:
        self.viseme_table.setRowCount(0)
        if track is None:
            return
        from ..ai.lipsync import VISEME_LABELS
        for cue in track.cues:
            row = self.viseme_table.rowCount()
            self.viseme_table.insertRow(row)
            self.viseme_table.setItem(row, 0, QTableWidgetItem(str(cue.start)))
            self.viseme_table.setItem(row, 1, QTableWidgetItem(str(cue.end - cue.start + 1)))
            combo = QComboBox()
            for label in VISEME_LABELS:
                combo.addItem(label, label)
            index = combo.findData(cue.label)
            combo.setCurrentIndex(max(0, index))
            self.viseme_table.setCellWidget(row, 2, combo)
            self.viseme_table.setItem(row, 3, QTableWidgetItem(f"{cue.confidence:.2f}"))

    def _apply_table_edits(self) -> None:
        track = self.session.current_lipsync()
        if track is None:
            self.session.status("Generate a lip sync first")
            return
        for row in range(self.viseme_table.rowCount()):
            widget = self.viseme_table.cellWidget(row, 2)
            if widget is not None and row < len(track.cues):
                track.cues[row].label = widget.currentData()
        self.session.reapply_lipsync(track)
        self.session.status("Mouth shapes updated")

    def _export_cues(self) -> None:
        from PySide6.QtWidgets import QFileDialog
        track = self.session.current_lipsync()
        if track is None:
            return
        path, _f = QFileDialog.getSaveFileName(self, "Export cues", "lipsync.txt",
                                              "Text (*.txt)")
        if not path:
            return
        with open(path, "w", encoding="utf8") as fh:
            fh.write("frame\tlength\tlabel\tconfidence\n")
            for cue in track.cues:
                fh.write(f"{cue.start}\t{cue.end - cue.start + 1}\t{cue.label}\t"
                         f"{cue.confidence:.2f}\n")
        self.session.status(f"Cues exported to {path}")


_ = (QFrame, QSize, Signal)
