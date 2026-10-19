"""Reusable dark-theme editor widgets: media bin, multitrack timeline, dialogs."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QMimeData, QPoint, QRectF, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QDrag, QFont, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QFileDialog, QFormLayout,
    QFrame, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMenu, QMessageBox, QProgressBar, QPushButton, QScrollArea,
    QSlider, QSpinBox, QTextEdit, QVBoxLayout, QWidget,
)

from .ai import MODEL_CATALOG, download_model, model_path
from .exporter import ExportSettings, ExportThread
from .media import find_ffmpeg
from .models import Project
from .workers import Worker


class MediaListWidget(QListWidget):
    filesDropped = Signal(list)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setDragEnabled(True)
        self.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
        self.setDefaultDropAction(Qt.DropAction.CopyAction)
        self.setStyleSheet("QListWidget { border: 0; background: #141820; }")

    def mimeData(self, items):
        mime = QMimeData()
        urls = []
        for item in items:
            path = item.data(Qt.ItemDataRole.UserRole)
            if path:
                urls.append(QUrl.fromLocalFile(str(path)))
        mime.setUrls(urls)
        return mime

    def startDrag(self, supported_actions):
        items = self.selectedItems()
        if not items:
            return
        mime = self.mimeData(items)
        drag = QDrag(self)
        drag.setMimeData(mime)
        drag.exec(Qt.DropAction.CopyAction)

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragEnterEvent(event)

    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragMoveEvent(event)

    def dropEvent(self, event):
        if event.mimeData().hasUrls():
            self.filesDropped.emit([url.toLocalFile() for url in event.mimeData().urls() if url.isLocalFile()])
            event.acceptProposedAction()
        else:
            super().dropEvent(event)


class TimelineCanvas(QWidget):
    selectionChanged = Signal(str)
    playheadChanged = Signal(float)
    clipMoved = Signal(str, float, str)
    clipDropped = Signal(list, float, str)
    operationRequested = Signal(str, str)
    trackAction = Signal(str, str)
    markerRequested = Signal(float)

    LEFT = 156
    RULER = 32
    ROW = 58

    def __init__(self, parent=None):
        super().__init__(parent)
        self.project: Project | None = None
        self.selected_id = ""
        self.playhead = 0.0
        self.pixels_per_second = 90.0
        self.snap_enabled = True
        self._drag_mode = ""
        self._drag_id = ""
        self._drag_start = 0.0
        self._drag_track = ""
        self._mouse_down = QPoint()
        self._temporary_start: float | None = None
        self._temporary_track = ""
        self.setMouseTracking(True)
        self.setAcceptDrops(True)
        self.setMinimumSize(900, self.RULER + self.ROW * 3)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setCursor(Qt.CursorShape.ArrowCursor)

    def set_project(self, project: Project, selected_id: str = "") -> None:
        self.project = project
        self.selected_id = selected_id
        self._resize_to_project()
        self.update()

    def set_selection(self, clip_id: str) -> None:
        self.selected_id = clip_id
        self.update()

    def set_playhead(self, seconds: float, notify: bool = False) -> None:
        self.playhead = max(0.0, float(seconds))
        self.update()
        if notify:
            self.playheadChanged.emit(self.playhead)

    def set_zoom(self, pixels_per_second: float) -> None:
        self.pixels_per_second = min(240.0, max(20.0, float(pixels_per_second)))
        self._resize_to_project()
        self.update()

    def _resize_to_project(self) -> None:
        tracks = len(self.project.tracks) if self.project else 0
        duration = max(60.0, (self.project.duration + 20.0) if self.project else 60.0)
        width = min(2_000_000, max(1100, self.LEFT + int(duration * self.pixels_per_second)))
        height = max(260, self.RULER + max(3, tracks) * self.ROW)
        self.setFixedSize(width, height)

    def _x_time(self, x: float) -> float:
        return max(0.0, (x - self.LEFT) / self.pixels_per_second)

    def _clip_rect(self, clip) -> QRectF:
        x = self.LEFT + clip.start * self.pixels_per_second
        width = max(8.0, clip.duration * self.pixels_per_second)
        index = next((i for i, track in enumerate(self.project.tracks) if track.id == clip.track_id), 0)
        y = self.RULER + index * self.ROW + 6
        return QRectF(x, y, width, self.ROW - 12)

    def _track_for_y(self, y: float):
        if not self.project or y < self.RULER:
            return None
        index = int((y - self.RULER) // self.ROW)
        return self.project.tracks[index] if 0 <= index < len(self.project.tracks) else None

    def _hit_clip(self, point: QPoint):
        if not self.project:
            return None
        for clip in reversed(sorted(self.project.clips, key=lambda c: (c.start, c.id))):
            if self._clip_rect(clip).contains(point):
                return clip
        return None

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor("#11151c"))
        painter.fillRect(QRectF(0, 0, self.width(), self.RULER), QColor("#1c222d"))
        if not self.project:
            painter.setPen(QColor("#778194"))
            painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "Create or open a project to start editing")
            return

        duration = max(60.0, self.width() / self.pixels_per_second)
        major = 5 if self.pixels_per_second < 65 else 1
        painter.setFont(QFont("Segoe UI", 9))
        for second in range(0, int(duration) + major, 1):
            x = self.LEFT + second * self.pixels_per_second
            if x > self.width():
                break
            if second % major == 0:
                painter.setPen(QPen(QColor("#424b5b"), 1))
                painter.drawLine(int(x), self.RULER, int(x), self.height())
                painter.setPen(QColor("#aab5c4"))
                painter.drawText(int(x + 4), 20, f"{second // 60:02d}:{second % 60:02d}")
            else:
                painter.setPen(QPen(QColor("#2a303b"), 1))
                painter.drawLine(int(x), self.RULER + 1, int(x), self.height())

        for index, track in enumerate(self.project.tracks):
            top = self.RULER + index * self.ROW
            background = QColor("#171d26" if index % 2 == 0 else "#141a22")
            painter.fillRect(QRectF(0, top, self.width(), self.ROW), background)
            painter.fillRect(QRectF(0, top, self.LEFT - 1, self.ROW), QColor("#202733"))
            painter.setPen(QPen(QColor("#303846"), 1))
            painter.drawLine(0, top + self.ROW, self.width(), top + self.ROW)
            painter.setFont(QFont("Segoe UI", 9, QFont.Weight.DemiBold))
            painter.setPen(QColor("#d4dbe5" if not track.locked else "#7f8897"))
            painter.drawText(12, int(top + 23), track.name)
            painter.setFont(QFont("Segoe UI", 8, QFont.Weight.Bold))
            muted = track.muted if track.kind == "audio" else not track.visible
            painter.setPen(QColor("#f1c45b" if muted else "#8a95a5"))
            painter.drawText(self.LEFT - 62, int(top + 43), "M" if track.kind == "audio" else "V")
            painter.setPen(QColor("#f1c45b" if track.locked else "#8a95a5"))
            painter.drawText(self.LEFT - 34, int(top + 43), "L" if track.locked else "·")

        for clip in self.project.clips:
            rect = self._clip_rect(clip)
            if clip.id == self._drag_id and self._temporary_start is not None:
                rect.moveLeft(self.LEFT + self._temporary_start * self.pixels_per_second)
                if self._temporary_track:
                    index = next((i for i, t in enumerate(self.project.tracks) if t.id == self._temporary_track), 0)
                    rect.moveTop(self.RULER + index * self.ROW + 6)
            asset = self.project.asset(clip.media_id) if clip.type != "title" else None
            if clip.type == "title":
                fill = QColor("#7149a9")
            elif asset and asset.kind == "audio":
                fill = QColor("#266f68")
            elif asset and asset.kind == "image":
                fill = QColor("#89652f")
            else:
                fill = QColor("#2f5f9f")
            if clip.id == self.selected_id:
                fill = fill.lighter(122)
            painter.setPen(QPen(QColor("#6de6c6" if clip.id == self.selected_id else fill.lighter(150)), 2 if clip.id == self.selected_id else 1))
            painter.setBrush(fill)
            painter.drawRoundedRect(rect, 6, 6)
            label_left = rect.left() + 8
            if asset and asset.thumbnail_path and asset.kind in {"video", "image"} and rect.width() > 72:
                thumb = QPixmap(asset.thumbnail_path)
                if not thumb.isNull():
                    thumb_rect = QRectF(rect.left() + 3, rect.top() + 3, min(64, rect.width() - 8), rect.height() - 6)
                    painter.setOpacity(0.8)
                    painter.drawPixmap(thumb_rect.toRect(), thumb)
                    painter.setOpacity(1.0)
                    label_left = thumb_rect.right() + 6
            if asset and asset.kind == "audio" and asset.waveform and rect.width() > 28:
                usable_width = max(1, int(rect.width() - 10))
                painter.setPen(QPen(QColor("#a7f0d0"), 1))
                center = rect.center().y()
                stride = max(1, len(asset.waveform) // usable_width)
                for x_offset in range(usable_width):
                    value = asset.waveform[min(len(asset.waveform) - 1, x_offset * stride)]
                    amplitude = max(1.0, value * (rect.height() - 15) * 0.45)
                    x = int(rect.left() + 5 + x_offset)
                    painter.drawLine(x, int(center - amplitude), x, int(center + amplitude))
                label_left = rect.left() + 8
            label = self.project.clip_label(clip)
            if clip.type == "title":
                label = "T  " + label
            painter.setFont(QFont("Segoe UI", 9, QFont.Weight.DemiBold))
            painter.setPen(QColor("#f8fbff"))
            text_rect = QRectF(label_left, rect.top() + 2, max(0, rect.right() - label_left - 5), rect.height() - 4)
            painter.drawText(text_rect, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft,
                             painter.fontMetrics().elidedText(label, Qt.TextElideMode.ElideRight, int(text_rect.width())))

        for marker in self.project.markers:
            x = self.LEFT + float(marker.get("time", 0)) * self.pixels_per_second
            painter.setPen(QPen(QColor("#f4c75a"), 1))
            painter.setBrush(QColor("#f4c75a"))
            painter.drawPolygon([QPoint(int(x), 0), QPoint(int(x + 8), 0), QPoint(int(x), 9)])
            painter.setPen(QColor("#f4c75a"))
            painter.drawLine(int(x), self.RULER, int(x), self.height())

        play_x = int(self.LEFT + self.playhead * self.pixels_per_second)
        painter.setPen(QPen(QColor("#ff6d73"), 2))
        painter.drawLine(play_x, 0, play_x, self.height())
        painter.setBrush(QColor("#ff6d73"))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawPolygon([QPoint(play_x - 6, 0), QPoint(play_x + 6, 0), QPoint(play_x, 10)])
        painter.end()

    def mousePressEvent(self, event):
        if not self.project:
            return
        point = event.position().toPoint()
        if event.button() == Qt.MouseButton.RightButton:
            clip = self._hit_clip(point)
            if clip:
                self.selected_id = clip.id
                self.selectionChanged.emit(clip.id)
                menu = QMenu(self)
                split = menu.addAction("Split at playhead")
                duplicate = menu.addAction("Duplicate clip")
                ripple = menu.addAction("Ripple delete")
                menu.addSeparator()
                delete = menu.addAction("Delete clip")
                chosen = menu.exec(event.globalPosition().toPoint())
                if chosen is split:
                    self.operationRequested.emit("split", clip.id)
                elif chosen is duplicate:
                    self.operationRequested.emit("duplicate", clip.id)
                elif chosen is ripple:
                    self.operationRequested.emit("ripple_delete", clip.id)
                elif chosen is delete:
                    self.operationRequested.emit("delete", clip.id)
            return
        if event.button() != Qt.MouseButton.LeftButton:
            return
        self._mouse_down = point
        if point.y() < self.RULER and point.x() >= self.LEFT:
            self._drag_mode = "playhead"
            self.set_playhead(self._x_time(point.x()), notify=True)
            return
        if point.x() < self.LEFT:
            track = self._track_for_y(point.y())
            if track:
                if self.LEFT - 45 <= point.x() < self.LEFT - 18:
                    self.trackAction.emit(track.id, "lock")
                elif self.LEFT - 72 <= point.x() < self.LEFT - 45:
                    self.trackAction.emit(track.id, "mute")
            return
        clip = self._hit_clip(point)
        if clip:
            self.selected_id = clip.id
            self.selectionChanged.emit(clip.id)
            self._drag_mode = "clip"
            self._drag_id = clip.id
            self._drag_start = clip.start
            self._drag_track = clip.track_id
            self._temporary_start = clip.start
            self._temporary_track = clip.track_id
            track = self.project.track(clip.track_id)
            if track and track.locked:
                self._drag_mode = ""
            self.set_playhead(max(clip.start, min(clip.end, self._x_time(point.x()))), notify=True)
        else:
            self._drag_mode = "playhead"
            self.set_playhead(self._x_time(point.x()), notify=True)

    def mouseMoveEvent(self, event):
        if not self.project or not self._drag_mode:
            return
        point = event.position().toPoint()
        if self._drag_mode == "playhead":
            self.set_playhead(self._x_time(point.x()), notify=True)
        elif self._drag_mode == "clip" and self._temporary_start is not None:
            delta = (point.x() - self._mouse_down.x()) / self.pixels_per_second
            self._temporary_start = max(0.0, self._drag_start + delta)
            target = self._track_for_y(point.y())
            if target:
                self._temporary_track = target.id
            self.update()

    def mouseReleaseEvent(self, event):
        if self._drag_mode == "clip" and self._temporary_start is not None and self._drag_id:
            if abs(self._temporary_start - self._drag_start) > 0.015 or self._temporary_track != self._drag_track:
                self.clipMoved.emit(self._drag_id, self._temporary_start, self._temporary_track or self._drag_track)
        self._drag_mode = ""
        self._drag_id = ""
        self._temporary_start = None
        self._temporary_track = ""
        self.update()

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event):
        if not self.project or not event.mimeData().hasUrls():
            event.ignore()
            return
        point = event.position().toPoint()
        track = self._track_for_y(point.y())
        if not track:
            track = next((t for t in reversed(self.project.tracks) if t.kind == "video"), self.project.tracks[0])
        paths = [url.toLocalFile() for url in event.mimeData().urls() if url.isLocalFile()]
        if paths:
            self.clipDropped.emit(paths, self._x_time(point.x()), track.id)
            event.acceptProposedAction()
        else:
            event.ignore()


class TimelineWidget(QWidget):
    selectionChanged = Signal(str)
    playheadChanged = Signal(float)
    clipMoved = Signal(str, float, str)
    clipDropped = Signal(list, float, str)
    operationRequested = Signal(str, str)
    trackAction = Signal(str, str)
    markerRequested = Signal(float)
    trackRequested = Signal(str)
    titleRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.project: Project | None = None
        self.canvas = TimelineCanvas(self)
        self.scroll = QScrollArea(self)
        self.scroll.setWidget(self.canvas)
        self.scroll.setWidgetResizable(False)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.scroll.setStyleSheet("QScrollArea { background: #11151c; border: 0; }")
        self.zoom = QSlider(Qt.Orientation.Horizontal)
        self.zoom.setRange(20, 200)
        self.zoom.setValue(90)
        self.zoom.setFixedWidth(130)
        self.snap = QCheckBox("Snap")
        self.snap.setChecked(True)
        self.split_button = QPushButton("Split")
        self.duplicate_button = QPushButton("Duplicate")
        self.ripple_button = QPushButton("Ripple delete")
        self.add_video_button = QPushButton("+ Video")
        self.add_audio_button = QPushButton("+ Audio")
        self.marker_button = QPushButton("Marker")
        self.title_button = QPushButton("+ Title")
        self.split_button.setToolTip("Split selected clip at the playhead (S)")
        self.ripple_button.setToolTip("Delete selected clip and close the gap on its track")
        for widget in (self.split_button, self.duplicate_button, self.ripple_button,
                       self.add_video_button, self.add_audio_button, self.marker_button, self.title_button):
            widget.setFixedHeight(27)
        row = QHBoxLayout()
        row.setContentsMargins(10, 6, 10, 6)
        row.setSpacing(6)
        label = QLabel("TIMELINE")
        label.setObjectName("sectionTitle")
        row.addWidget(label)
        row.addSpacing(12)
        row.addWidget(self.split_button)
        row.addWidget(self.duplicate_button)
        row.addWidget(self.ripple_button)
        row.addWidget(self.add_video_button)
        row.addWidget(self.add_audio_button)
        row.addWidget(self.title_button)
        row.addWidget(self.marker_button)
        row.addStretch(1)
        row.addWidget(self.snap)
        row.addWidget(QLabel("−"))
        row.addWidget(self.zoom)
        row.addWidget(QLabel("+"))
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addLayout(row)
        layout.addWidget(self.scroll, 1)

        self.canvas.selectionChanged.connect(self.selectionChanged)
        self.canvas.playheadChanged.connect(self.playheadChanged)
        self.canvas.clipMoved.connect(self.clipMoved)
        self.canvas.clipDropped.connect(self.clipDropped)
        self.canvas.operationRequested.connect(self.operationRequested)
        self.canvas.trackAction.connect(self.trackAction)
        self.zoom.valueChanged.connect(self.canvas.set_zoom)
        self.snap.toggled.connect(lambda value: setattr(self.canvas, "snap_enabled", value))
        self.split_button.clicked.connect(lambda: self.operationRequested.emit("split", self.canvas.selected_id))
        self.duplicate_button.clicked.connect(lambda: self.operationRequested.emit("duplicate", self.canvas.selected_id))
        self.ripple_button.clicked.connect(lambda: self.operationRequested.emit("ripple_delete", self.canvas.selected_id))
        self.add_video_button.clicked.connect(lambda: self.trackRequested.emit("video"))
        self.add_audio_button.clicked.connect(lambda: self.trackRequested.emit("audio"))
        self.marker_button.clicked.connect(lambda: self.markerRequested.emit(self.canvas.playhead))
        self.title_button.clicked.connect(self.titleRequested)

    @property
    def selected_id(self) -> str:
        return self.canvas.selected_id

    @property
    def playhead(self) -> float:
        return self.canvas.playhead

    @property
    def pixels_per_second(self) -> float:
        return self.canvas.pixels_per_second

    def set_project(self, project: Project, selected_id: str = "") -> None:
        self.project = project
        self.canvas.set_project(project, selected_id)

    def set_playhead(self, seconds: float, notify: bool = False) -> None:
        self.canvas.set_playhead(seconds, notify)

    def set_selection(self, clip_id: str) -> None:
        self.canvas.set_selection(clip_id)

    def scroll_to_time(self, seconds: float) -> None:
        x = self.canvas.LEFT + int(seconds * self.canvas.pixels_per_second)
        self.scroll.ensureVisible(x, 0, 120, 20)


class ModelManagerDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Local Model Manager · NovaCut")
        self.setMinimumSize(660, 490)
        self.worker: Worker | None = None
        self._close_after_download = False
        self._download_key = ""
        self.models = QListWidget()
        for spec in MODEL_CATALOG:
            installed = model_path(spec.key).is_file()
            label = f"{spec.name}  ·  {spec.size_bytes / 1024**2:.0f} MB  ·  {spec.resources}"
            item = QListWidgetItem(("✓  " if installed else "○  ") + label)
            item.setData(Qt.ItemDataRole.UserRole, spec.key)
            item.setToolTip(spec.license_note + "\n" + spec.url)
            self.models.addItem(item)
        self.models.setCurrentRow(0)
        self.status = QLabel("Models are optional and never downloaded automatically.")
        self.status.setWordWrap(True)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.detail = QTextEdit()
        self.detail.setReadOnly(True)
        self.detail.setFixedHeight(100)
        self.download_button = QPushButton("Download selected model…")
        self.cancel_button = QPushButton("Cancel download")
        self.cancel_button.setEnabled(False)
        close = QPushButton("Close")
        self.download_button.clicked.connect(self._download)
        self.cancel_button.clicked.connect(self._cancel)
        close.clicked.connect(self.close)
        row = QHBoxLayout()
        row.addWidget(self.download_button)
        row.addWidget(self.cancel_button)
        row.addStretch(1)
        row.addWidget(close)
        layout = QVBoxLayout(self)
        intro = QLabel(
            "Choose a model only when you need it. NovaCut checks free disk space, shows progress, and keeps each file local. "
            "Model terms belong to their upstream authors; review them before use or redistribution."
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)
        layout.addWidget(self.models, 1)
        layout.addWidget(self.status)
        layout.addWidget(self.progress)
        layout.addWidget(self.detail)
        layout.addLayout(row)
        self.models.currentRowChanged.connect(self._selection_changed)
        self._selection_changed(self.models.currentRow())

    def _selected_key(self) -> str:
        item = self.models.currentItem()
        return str(item.data(Qt.ItemDataRole.UserRole)) if item else ""

    def _selection_changed(self, _row: int) -> None:
        key = self._selected_key()
        spec = next((item for item in MODEL_CATALOG if item.key == key), None)
        if not spec:
            return
        path = model_path(key)
        self.status.setText(
            f"{spec.license_note}\nExpected location: {path}\nSource: {spec.url}"
        )

    def _download(self) -> None:
        key = self._selected_key()
        spec = next((item for item in MODEL_CATALOG if item.key == key), None)
        if not spec:
            return
        answer = QMessageBox.question(
            self, "Download optional model?",
            f"Download {spec.name} ({spec.size_bytes / 1024**2:.0f} MB)?\n\n"
            "This sends a request to the model's upstream host. Nothing is downloaded until you confirm here.\n\n"
            f"{spec.license_note}",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel,
            QMessageBox.StandardButton.Cancel,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        self._download_key = key
        self.progress.setValue(0)
        self.detail.clear()
        self.status.setText("Connecting to upstream model host…")
        self.download_button.setEnabled(False)
        self.cancel_button.setEnabled(True)

        def work(cancel_event, signals):
            return download_model(
                key,
                progress=lambda percent, message: signals.progress.emit(percent, message),
                cancel_event=cancel_event,
            )
        self.worker = Worker(work)
        self.worker.signals.progress.connect(self._progress)
        self.worker.signals.result.connect(self._downloaded)
        self.worker.signals.error.connect(self._download_error)
        self.worker.signals.finished.connect(self._download_finished)
        from PySide6.QtCore import QThreadPool
        QThreadPool.globalInstance().start(self.worker)

    def _progress(self, value: int, message: str) -> None:
        self.progress.setValue(value)
        self.status.setText(message)

    def _downloaded(self, path) -> None:
        self.detail.append(f"Installed model: {path}")
        row = self.models.currentRow()
        item = self.models.item(row)
        if item and not item.text().startswith("✓"):
            item.setText("✓  " + item.text()[3:])

    def _download_error(self, message: str) -> None:
        self.detail.append(message.split("\n\nTraceback", 1)[0])
        self.status.setText("Download did not complete.")

    def _download_finished(self) -> None:
        self.download_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.worker = None
        if self._close_after_download:
            self.accept()

    def _cancel(self) -> None:
        if self.worker:
            self.worker.cancel()
            self.status.setText("Cancelling after the current network read…")

    def closeEvent(self, event):
        if self.worker:
            answer = QMessageBox.question(self, "Cancel download?", "A model is still downloading. Cancel it and close?",
                                          QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            self.worker.cancel()
            self._close_after_download = True
            self.status.setText("Cancelling download; this window will close when the current network read finishes…")
            event.ignore()
            return
        event.accept()

    def reject(self):
        self.close()


class ExportDialog(QDialog):
    def __init__(self, project: Project, ffmpeg_path: str = "", parent=None):
        super().__init__(parent)
        self.project = project
        self.ffmpeg_path = ffmpeg_path or find_ffmpeg() or ""
        self.thread: ExportThread | None = None
        self.setWindowTitle("Export Timeline · NovaCut")
        self.setMinimumWidth(590)
        self.resize(650, 690)
        form = QFormLayout()
        self.output = QLineEdit()
        default_name = Path(project.path).with_suffix(".mp4").name if project.path else "NovaCut-Export.mp4"
        self.output.setText(str(Path.home() / "Videos" / default_name))
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        output_row = QHBoxLayout()
        output_row.addWidget(self.output, 1)
        output_row.addWidget(browse)
        form.addRow("Output file", output_row)

        self.preset = QComboBox()
        for label, width, height in (
            ("Project settings", project.width, project.height),
            ("480p · 16:9", 854, 480),
            ("720p · 16:9", 1280, 720),
            ("1080p · 16:9", 1920, 1080),
            ("1440p · 16:9", 2560, 1440),
            ("4K · 16:9", 3840, 2160),
            ("Vertical · 9:16", 1080, 1920),
            ("Square · 1:1", 1080, 1080),
        ):
            self.preset.addItem(label, (width, height))
        self.preset.setCurrentIndex(0)
        form.addRow("Resolution", self.preset)

        self.container = QComboBox()
        for name in ("mp4", "mkv", "mov", "webm"):
            self.container.addItem(name.upper(), name)
        form.addRow("Container", self.container)
        self.video_codec = QComboBox()
        self.video_codec.addItem("H.264 · AVC", "h264")
        self.video_codec.addItem("H.265 · HEVC", "h265")
        self.video_codec.addItem("VP9", "vp9")
        form.addRow("Video codec", self.video_codec)
        self.fps = QComboBox()
        for rate in (24, 25, 30, 50, 60):
            self.fps.addItem(f"{rate} FPS", rate)
        nearest = min(range(self.fps.count()), key=lambda i: abs(self.fps.itemData(i) - project.fps))
        self.fps.setCurrentIndex(nearest)
        form.addRow("Frame rate", self.fps)
        self.quality_mode = QComboBox()
        self.quality_mode.addItem("Constant quality", True)
        self.quality_mode.addItem("Target bitrate", False)
        form.addRow("Rate control", self.quality_mode)
        self.quality = QSpinBox()
        self.quality.setRange(0, 51)
        self.quality.setValue(20)
        self.quality.setToolTip("Lower CRF means larger, higher-quality output. Typical H.264: 18–24.")
        form.addRow("Quality / CRF", self.quality)
        self.bitrate = QSpinBox()
        self.bitrate.setRange(100, 200000)
        self.bitrate.setValue(12000)
        self.bitrate.setSuffix(" kb/s")
        form.addRow("Video bitrate", self.bitrate)
        self.audio_codec = QComboBox()
        for label, code in (("AAC", "aac"), ("Opus", "opus"), ("MP3", "mp3"), ("PCM", "pcm_s16le"), ("No audio", "none")):
            self.audio_codec.addItem(label, code)
        form.addRow("Audio codec", self.audio_codec)
        self.audio_bitrate = QSpinBox()
        self.audio_bitrate.setRange(32, 1024)
        self.audio_bitrate.setValue(192)
        self.audio_bitrate.setSuffix(" kb/s")
        form.addRow("Audio bitrate", self.audio_bitrate)
        self.sample_rate = QComboBox()
        for value in (32000, 44100, 48000, 96000):
            self.sample_rate.addItem(f"{value} Hz", value)
        self.sample_rate.setCurrentIndex(2)
        form.addRow("Audio sample rate", self.sample_rate)
        self.hardware = QCheckBox("Use NVIDIA hardware encoding when available (CPU fallback enabled)")
        self.hardware.setEnabled(bool(self.ffmpeg_path))
        self.hardware.setToolTip("Encoder support is checked in the background. If NVENC is missing or fails, NovaCut retries with the CPU encoder.")
        form.addRow("Acceleration", self.hardware)

        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setValue(0)
        self.status = QLabel(f"Timeline duration: {project.duration:.2f} s · all visible tracks will be rendered.")
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumHeight(110)
        self.start_button = QPushButton("Start export")
        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.setEnabled(False)
        self.close_button = QPushButton("Close")
        self.start_button.clicked.connect(self._start)
        self.cancel_button.clicked.connect(self._cancel)
        self.close_button.clicked.connect(self.reject)
        buttons = QHBoxLayout()
        buttons.addStretch(1)
        buttons.addWidget(self.start_button)
        buttons.addWidget(self.cancel_button)
        buttons.addWidget(self.close_button)
        self.quality_mode.currentIndexChanged.connect(self._sync_rate_controls)
        self.container.currentIndexChanged.connect(self._container_changed)
        self._sync_rate_controls()
        layout = QVBoxLayout(self)
        title = QLabel("Render the complete editable timeline")
        title.setObjectName("sectionTitle")
        layout.addWidget(title)
        layout.addLayout(form)
        layout.addWidget(self.progress)
        layout.addWidget(self.status)
        layout.addWidget(self.log)
        layout.addLayout(buttons)

    def _sync_rate_controls(self):
        quality = bool(self.quality_mode.currentData())
        self.quality.setEnabled(quality)
        self.bitrate.setEnabled(not quality)

    def _container_changed(self, _index: int):
        container = str(self.container.currentData() or "mp4")
        path = Path(self.output.text()).expanduser()
        if path.suffix.lower() != f".{container}":
            self.output.setText(str(path.with_suffix(f".{container}")))
        if container == "webm":
            self.video_codec.setCurrentIndex(max(0, self.video_codec.findData("vp9")))
            self.audio_codec.setCurrentIndex(max(0, self.audio_codec.findData("opus")))
        elif self.video_codec.currentData() == "vp9" and container in {"mp4", "mov"}:
            self.video_codec.setCurrentIndex(max(0, self.video_codec.findData("h264")))

    def _browse(self):
        ext = self.container.currentData()
        path, _ = QFileDialog.getSaveFileName(self, "Export video", self.output.text(), f"{ext.upper()} video (*.{ext});;All files (*)")
        if path:
            self.output.setText(path)
            self.container.setCurrentIndex(max(0, self.container.findData(Path(path).suffix.lstrip(".").lower())))

    def _build_settings(self) -> ExportSettings:
        width, height = self.preset.currentData()
        container = str(self.container.currentData())
        path = Path(self.output.text()).expanduser()
        path = path.with_suffix("." + container)
        return ExportSettings(
            output_path=str(path), container=str(self.container.currentData()),
            video_codec=str(self.video_codec.currentData()), width=int(width), height=int(height),
            fps=float(self.fps.currentData()), quality=self.quality.value(), bitrate_kbps=self.bitrate.value(),
            quality_mode=bool(self.quality_mode.currentData()), audio_codec=str(self.audio_codec.currentData()),
            audio_bitrate_kbps=self.audio_bitrate.value(), sample_rate=int(self.sample_rate.currentData()),
            use_hardware=self.hardware.isChecked(),
        )

    def _start(self):
        if not self.ffmpeg_path:
            QMessageBox.warning(self, "FFmpeg not found", "Install FFmpeg or set its path in Settings before exporting.")
            return
        try:
            settings = self._build_settings()
            settings.validate()
            if settings.container not in {"mp4", "mkv", "mov", "webm"}:
                raise ValueError("Choose an output file with an MP4, MKV, MOV, or WEBM extension.")
        except Exception as exc:
            QMessageBox.warning(self, "Export settings", str(exc))
            return
        if Path(settings.output_path).exists():
            answer = QMessageBox.question(self, "Replace existing file?", f"{settings.output_path} already exists. Replace it after a successful render?",
                                          QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel,
                                          QMessageBox.StandardButton.Cancel)
            if answer != QMessageBox.StandardButton.Yes:
                return
        self.start_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.close_button.setEnabled(False)
        self.log.clear()
        self.status.setText("Preparing full timeline render…")
        self.thread = ExportThread(self.project, settings, self.ffmpeg_path)
        self.thread.progress.connect(self._progress)
        self.thread.log_line.connect(self.log.append)
        self.thread.succeeded.connect(self._success)
        self.thread.failed.connect(self._failure)
        self.thread.start()

    def _progress(self, value: int, eta: str):
        self.progress.setValue(value)
        self.status.setText(f"Rendering… {value}% · {eta}")

    def _success(self, path: str):
        self.status.setText(f"Export complete · {path}")
        self.log.append(f"Saved: {path}")
        self.start_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.close_button.setEnabled(True)
        self.close_button.setText("Done")
        self.close_button.clicked.disconnect()
        self.close_button.clicked.connect(self.accept)

    def _failure(self, message: str):
        self.status.setText("Export cancelled." if message.startswith("Export cancelled") else "Export failed.")
        self.log.append(message)
        self.start_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.close_button.setEnabled(True)
        if not message.startswith("Export cancelled"):
            QMessageBox.critical(self, "Export failed", message[:3000])

    def _cancel(self):
        if self.thread and self.thread.isRunning():
            self.thread.cancel()
            self.status.setText("Stopping FFmpeg and removing the incomplete temporary output…")
            self.cancel_button.setEnabled(False)

    def closeEvent(self, event):
        if self.thread and self.thread.isRunning():
            answer = QMessageBox.question(self, "Cancel export?", "The render is still running. Cancel and close?",
                                          QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            self.thread.cancel()
            self.thread.wait(8000)
        event.accept()
