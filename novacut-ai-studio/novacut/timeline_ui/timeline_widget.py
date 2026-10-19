"""Multitrack timeline: tracks, clips, ruler, playhead, markers and DnD.

All mutations leave the scene through controller.execute(...) so every edit is
undoable and serialised into the project document.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np
from PySide6.QtCore import (QEvent, QPointF, QRectF, Qt, Signal, QMimeData,
                            QLineF)
from PySide6.QtGui import (QAction, QBrush, QColor, QDrag, QFont, QPainter,
                           QPen, QPixmap)
from PySide6.QtWidgets import (QGraphicsItem, QGraphicsLineItem,
                               QGraphicsRectItem, QGraphicsScene,
                               QGraphicsView, QMenu, QSizePolicy, QWidget,
                               QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
                               QDoubleSpinBox)

from ..core.timecode import fmt_timecode
from ..editing.operations import (AddClipCommand, MoveClipCommand,
                                  TrimClipCommand, SplitClipCommand,
                                  RippleDeleteCommand, DuplicateClipCommand,
                                  RemoveClipCommand, AddMarkerCommand,
                                  SetClipPropertyCommand)
from ..editing.snapping import SnappingEngine
from ..media import cache, thumbnails
from ..models.enums import ClipKind, TrackKind, MarkerColor
from ..models.timeline import Clip
from ..ui import theme

TRACK_HEIGHT = 64
HEADER_WIDTH = 132
RULER_HEIGHT = 30
MIME_MEDIA = "application/x-novacut-media"


# --------------------------------------------------------------------- items
class ClipItem(QGraphicsRectItem):
    def __init__(self, clip: Clip, scene: "TimelineScene"):
        super().__init__()
        self.clip = clip
        self.scene_ref = scene
        self.setRect(0, 0, 10, TRACK_HEIGHT - 10)
        self.setAcceptHoverEvents(True)
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable, True)
        self.setZValue(2)
        self._drag_mode: Optional[str] = None
        self._press_pos = QPointF()
        self._press_start = 0.0
        self._press_track = ""
        self._press_rect = QRectF()
        self._press_source_in = 0.0
        self._press_source_duration = 0.0
        self._thumbs: list[QPixmap] = []
        self._wave: Optional[np.ndarray] = None
        self._load_assets()

    # ------------------------------------------------------------ assets
    def _load_assets(self) -> None:
        project = self.scene_ref.project
        item = project.get_media(self.clip.media_id) if project else None
        if item is None:
            return
        try:
            strip = cache.get_asset(item.file_hash, "thumbstrip", "6")
            if strip and Path(strip).exists():
                data = json.loads(Path(strip).read_text(encoding="utf-8"))
                self._thumbs = [QPixmap(p) for p in data if Path(p).exists()]
            elif item.kind in ("video", "image"):
                thumb = cache.get_asset(item.file_hash, "thumb",
                                        f"{160}x{90}@0.000")
                if thumb:
                    self._thumbs = [QPixmap(thumb)]
            wave = cache.get_asset(item.file_hash, "waveform", "96")
            if wave and Path(wave).exists():
                self._wave = np.load(wave)
        except Exception:  # noqa: BLE001 - painting must never crash
            self._thumbs, self._wave = [], None

    # ------------------------------------------------------------ geometry
    def apply_geometry(self, pixels_per_second: float, track_y: int) -> None:
        self.setPos(self.clip.start * pixels_per_second, track_y + 5)
        self.prepareGeometryChange()
        self.setRect(0, 0, max(6, self.clip.duration * pixels_per_second),
                     TRACK_HEIGHT - 10)
        self.setBrush(QBrush(self._base_color()))
        pen = QPen(QColor(theme.PALETTE["accent"]) if self.isSelected()
                   else QColor(theme.PALETTE["border"]), 1.5 if self.isSelected() else 1)
        self.setPen(pen)
        self.setOpacity(0.45 if not self.clip.enabled else 1.0)
        self.update()

    def _base_color(self) -> QColor:
        if self.clip.kind == ClipKind.AUDIO.value:
            return QColor(theme.PALETTE["track_a"])
        if self.clip.kind == ClipKind.TITLE.value:
            return QColor(theme.PALETTE["purple"])
        if self.clip.kind == ClipKind.COLOR.value:
            return QColor(theme.PALETTE["amber"])
        return QColor(theme.PALETTE["track_v"])

    # ------------------------------------------------------------ painting
    def paint(self, painter: QPainter, option, widget=None) -> None:
        rect = self.rect()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(self.brush())
        painter.drawRoundedRect(rect, 8, 8)
        # Thumbnail strip for visual clips.
        if self._thumbs and self.clip.kind in (ClipKind.VIDEO.value,
                                               ClipKind.IMAGE.value):
            x = 4.0
            tw = max(40.0, rect.width() / max(1, len(self._thumbs)))
            for pix in self._thumbs:
                target = QRectF(x, 3, tw - 2, rect.height() - 6)
                painter.setOpacity(0.85)
                painter.drawPixmap(target, pix, QRectF(pix.rect()))
                painter.setOpacity(1.0)
                x += tw
                if x > rect.right():
                    break
        # Audio waveform.
        if self._wave is not None and self.clip.kind == ClipKind.AUDIO.value:
            painter.setPen(QPen(QColor(theme.PALETTE["green"]), 1.4))
            mid = rect.height() / 2
            step = rect.width() / max(1, len(self._wave))
            for i, v in enumerate(self._wave):
                h = float(v) * (rect.height() / 2 - 4)
                x = i * step
                painter.drawLine(QLineF(x, mid - h, x, mid + h))
        # Label.
        painter.setPen(QPen(QColor(theme.PALETTE["text"])))
        font = painter.font()
        font.setPixelSize(11)
        painter.setFont(font)
        label = self.clip.name or self.clip.kind
        painter.drawText(rect.adjusted(8, 4, -8, -4),
                         Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop,
                         label[:40])
        if abs(self.clip.speed - 1.0) > 0.01:
            painter.setPen(QPen(QColor(theme.PALETTE["amber"])))
            painter.drawText(rect.adjusted(6, 0, -6, -3),
                             Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignBottom,
                             f"{self.clip.speed:g}x")
        # Trim handles.
        painter.setBrush(QColor(theme.PALETTE["text_dim"]))
        for hx in (rect.left() + 2, rect.right() - 5):
            painter.drawRoundedRect(QRectF(hx, rect.height() / 2 - 8, 3, 16), 2, 2)
        if self.isSelected():
            painter.setPen(QPen(QColor(theme.PALETTE["accent"]), 2))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRoundedRect(rect, 8, 8)

    # ------------------------------------------------------------ mouse
    def hoverMoveEvent(self, event):
        pos = event.pos()
        if pos.x() < 8:
            self.setCursor(Qt.CursorShape.SizeHorCursor)
        elif pos.x() > self.rect().width() - 8:
            self.setCursor(Qt.CursorShape.SizeHorCursor)
        else:
            self.setCursor(Qt.CursorShape.OpenHandCursor)
        super().hoverMoveEvent(event)

    def mousePressEvent(self, event):
        if event.button() != Qt.MouseButton.LeftButton:
            super().mousePressEvent(event)
            return
        self.setCursor(Qt.CursorShape.ClosedHandCursor)
        self._press_pos = event.scenePos()
        self._press_start = self.clip.start
        self._press_track = self.clip.track_id
        self._press_rect = QRectF(self.rect())
        self._press_source_in = self.clip.source_in
        self._press_source_duration = self.clip.source_duration
        if event.pos().x() < 8:
            self._drag_mode = "trim-left"
        elif event.pos().x() > self.rect().width() - 8:
            self._drag_mode = "trim-right"
        else:
            self._drag_mode = "move"
        event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_mode is None:
            return
        pps = self.scene_ref.pixels_per_second
        delta = (event.scenePos().x() - self._press_pos.x()) / pps
        snapped = self.scene_ref.snap_time_for(self.clip, delta, self._drag_mode)
        if self._drag_mode == "move":
            self.clip.start = max(0.0, self._press_start + snapped)
        elif self._drag_mode == "trim-left":
            new_start = max(0.0, self._press_start + snapped)
            new_end = self._press_start + self._press_rect.width() / pps
            self.clip.start = min(new_start, new_end - 0.1)
        elif self._drag_mode == "trim-right":
            width = max(0.1, self._press_rect.width() / pps + snapped)
            self.clip.duration = width
        self.scene_ref.update_geometries()

    def mouseReleaseEvent(self, event):
        self.setCursor(Qt.CursorShape.OpenHandCursor)
        mode, self._drag_mode = self._drag_mode, None
        if mode is None:
            return
        final_start = self.clip.start
        project = self.scene_ref.project
        media = project.get_media(self.clip.media_id) if project else None
        limit = media.effective_duration() if media and media.kind != "image" else None
        from ..editing.operations import TrimState
        before = TrimState(self._press_start, self._press_rect.width() / pps,
                           self._press_source_in, self._press_source_duration)
        if mode == "move":
            if abs(final_start - self._press_start) > 1e-4:
                self.scene_ref.request_command(
                    MoveClipCommand(project.timeline, self.clip.id, final_start,
                                    old_start=self._press_start,
                                    old_track_id=self._press_track))
            else:
                self.scene_ref.refresh()
        elif mode == "trim-left":
            self.scene_ref.request_command(TrimClipCommand(
                project.timeline, self.clip.id,
                new_start=final_start, new_end=final_start + self.clip.duration,
                source_limit=limit, before=before))
        elif mode == "trim-right":
            self.scene_ref.request_command(TrimClipCommand(
                project.timeline, self.clip.id,
                new_start=self.clip.start,
                new_end=self.clip.start + self.clip.duration,
                source_limit=limit, before=before))
        self.scene_ref.refresh()


# ---------------------------------------------------------------------- scene
class TimelineScene(QGraphicsScene):
    commandRequested = Signal(object)
    seekRequested = Signal(float)
    selectionChangedSignal = Signal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.project = None
        self.pixels_per_second = 40.0
        self.track_y: dict[str, int] = {}
        self._clip_items: dict[str, ClipItem] = {}
        self._playhead: Optional[QGraphicsLineItem] = None
        self._ruler_rect: Optional[QGraphicsRectItem] = None
        self.snapping: Optional[SnappingEngine] = None
        self.setSceneRect(0, 0, 12_000, 600)

    def set_project(self, project) -> None:
        self.project = project
        self.snapping = SnappingEngine(project.timeline,
                                      enabled=True,
                                      tolerance_s=0.25)
        self.refresh()

    # ------------------------------------------------------------ rebuild
    def refresh(self) -> None:
        if self.project is None:
            return
        self.clear()
        # clear() destroys every C++ graphics item, including the playhead.
        self._playhead = None
        self._clip_items.clear()
        self.track_y.clear()
        width = max(2000, (self.project.timeline.duration() + 30)
                    * self.pixels_per_second)
        y = RULER_HEIGHT
        for track in self.project.timeline.tracks:
            self._draw_track(track, y)
            self.track_y[track.id] = y
            for clip in track.clips:
                item = ClipItem(clip, self)
                self.addItem(item)
                self._clip_items[clip.id] = item
            y += TRACK_HEIGHT
        self._draw_ruler(width)
        self._draw_markers()
        self.setSceneRect(0, 0, width, y + 40)
        self.update_geometries()
        self.update_playhead(self._playhead_time())

    def _draw_track(self, track, y: int) -> None:
        bg = QGraphicsRectItem(0, y, int(self.sceneRect().width()), TRACK_HEIGHT)
        color = (theme.PALETTE["track_v"] if track.kind == TrackKind.VIDEO.value
                 else theme.PALETTE["track_a"])
        bg.setBrush(QColor(color))
        bg.setOpacity(0.18 if not track.locked else 0.08)
        bg.setPen(QPen(QColor(theme.PALETTE["border"])))
        bg.setZValue(0)
        self.addItem(bg)
        label = self.addText(("🔒 " if track.locked else "") + track.name,
                             QFont("Segoe UI", 9))
        label.setDefaultTextColor(QColor(theme.PALETTE["text_dim"]))
        label.setPos(8, y + 6)
        label.setZValue(3)

    def _draw_ruler(self, width: int) -> None:
        rect = QGraphicsRectItem(0, 0, width, RULER_HEIGHT)
        rect.setBrush(QColor(theme.PALETTE["bg_1"]))
        rect.setPen(QPen(QColor(theme.PALETTE["border"])))
        rect.setZValue(4)
        self.addItem(rect)
        step = 1.0 if self.pixels_per_second > 30 else 5.0
        t = 0.0
        while t * self.pixels_per_second < width:
            x = t * self.pixels_per_second
            line = QGraphicsLineItem(x, RULER_HEIGHT - 8, x, RULER_HEIGHT)
            line.setPen(QPen(QColor(theme.PALETTE["border"])))
            line.setZValue(4)
            self.addItem(line)
            if int(t) % max(1, int(step * 2)) == 0:
                txt = self.addText(fmt_timecode(t, self.project.settings.fps),
                                   QFont("Segoe UI", 8))
                txt.setDefaultTextColor(QColor(theme.PALETTE["text_dim"]))
                txt.setPos(x + 3, 2)
                txt.setZValue(4)
            t += step

    def _draw_markers(self) -> None:
        for marker in self.project.timeline.markers:
            x = marker.time * self.pixels_per_second
            line = QGraphicsLineItem(x, RULER_HEIGHT, x, self.sceneRect().height())
            line.setPen(QPen(QColor(marker.color), 2, Qt.PenStyle.DashLine))
            line.setZValue(1)
            self.addItem(line)

    def update_geometries(self) -> None:
        for cid, item in self._clip_items.items():
            track = self.project.timeline.track_by_id(item.clip.track_id)
            if track:
                item.apply_geometry(self.pixels_per_second,
                                    self.track_y.get(track.id, RULER_HEIGHT))

    # ------------------------------------------------------------ helpers
    def request_command(self, command) -> None:
        self.commandRequested.emit(command)

    def snap_time_for(self, clip: Clip, delta: float, mode: str) -> float:
        if self.snapping is None or not self.snapping.enabled:
            return delta
        base = self._press_start if mode == "move" else clip.start
        target = base + delta
        result = self.snapping.snap_time(target, clip.id)
        return result.time - base if result.snapped else delta

    def clip_at_view(self, pos: QPointF) -> Optional[ClipItem]:
        for item in self.items(pos):
            if isinstance(item, ClipItem):
                return item
        return None

    def track_at_y(self, y: float) -> Optional[str]:
        for tid, ty in self.track_y.items():
            if ty <= y < ty + TRACK_HEIGHT:
                return tid
        return None

    def time_at_x(self, x: float) -> float:
        return max(0.0, x / self.pixels_per_second)

    # ------------------------------------------------------------ playhead
    def _playhead_time(self) -> float:
        return getattr(self, "_playhead_t", 0.0)

    def update_playhead(self, time_s: float) -> None:
        self._playhead_t = time_s
        if self._playhead is not None:
            self.removeItem(self._playhead)
        x = time_s * self.pixels_per_second
        self._playhead = QGraphicsLineItem(x, RULER_HEIGHT, x,
                                           self.sceneRect().height())
        self._playhead.setPen(QPen(QColor(theme.PALETTE["red"]), 2))
        self._playhead.setZValue(5)
        self.addItem(self._playhead)

    def set_zoom(self, pps: float) -> None:
        self.pixels_per_second = max(8.0, min(400.0, pps))
        self.refresh()
        self.update_playhead(self._playhead_time())


# ----------------------------------------------------------------------- view
class TimelineView(QGraphicsView):
    clipSelected = Signal(object)
    seekRequested = Signal(float)
    commandRequested = Signal(object)

    def __init__(self, scene: TimelineScene, parent=None):
        super().__init__(scene, parent)
        self.setAcceptDrops(True)
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.setStyleSheet(f"background:{theme.PALETTE['bg_0']};border:none;")
        self._scene = scene

    def wheelEvent(self, event):
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
            self._scene.set_zoom(self._scene.pixels_per_second * factor)
        else:
            super().wheelEvent(event)

    def mousePressEvent(self, event):
        item = self._scene.clip_at_view(self.mapToScene(event.pos()))
        if item is None and event.button() == Qt.MouseButton.LeftButton:
            t = self._scene.time_at_x(self.mapToScene(event.pos()).x())
            if self.mapToScene(event.pos()).y() <= RULER_HEIGHT:
                self.seekRequested.emit(t)
                return
        super().mousePressEvent(event)
        if item:
            self.clipSelected.emit(item.clip)

    def contextMenuEvent(self, event):
        scene_pos = self.mapToScene(event.pos())
        item = self._scene.clip_at_view(scene_pos)
        menu = QMenu(self)
        if item:
            clip = item.clip
            act_split = QAction("Split at playhead", self)
            act_split.triggered.connect(lambda: self.commandRequested.emit(
                SplitClipCommand(self._scene.project.timeline, clip.id,
                                 self._scene._playhead_time())))
            menu.addAction(act_split)
            act_dup = QAction("Duplicate", self)
            act_dup.triggered.connect(lambda: self.commandRequested.emit(
                DuplicateClipCommand(self._scene.project.timeline, clip.id)))
            menu.addAction(act_dup)
            act_ripple = QAction("Ripple delete", self)
            act_ripple.triggered.connect(lambda: self.commandRequested.emit(
                RippleDeleteCommand(self._scene.project.timeline, clip.id)))
            menu.addAction(act_ripple)
            act_del = QAction("Delete", self)
            act_del.triggered.connect(lambda: self.commandRequested.emit(
                RemoveClipCommand(self._scene.project.timeline, clip.id)))
            menu.addAction(act_del)
            menu.addSeparator()
            enabled = "Disable" if clip.enabled else "Enable"
            menu.addAction(enabled, lambda: self.commandRequested.emit(
                SetClipPropertyCommand(self._scene.project.timeline, clip.id,
                                       "enabled", not clip.enabled, "Toggle clip")))
        else:
            t = self._scene.time_at_x(scene_pos.x())
            menu.addAction("Add marker", lambda: self.commandRequested.emit(
                AddMarkerCommand(self._scene.project.timeline, t, "Marker")))
        menu.exec(event.globalPos())

    # ------------------------------------------------------------ DnD
    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat(MIME_MEDIA):
            event.acceptProposedAction()

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat(MIME_MEDIA):
            event.acceptProposedAction()

    def dropEvent(self, event):
        if not event.mimeData().hasFormat(MIME_MEDIA):
            return
        media_id = json.loads(bytes(event.mimeData().data(MIME_MEDIA)))[0]
        project = self._scene.project
        media = project.get_media(media_id)
        if media is None:
            return
        scene_pos = self.mapToScene(event.pos())
        t = self._scene.time_at_x(scene_pos.x())
        tracks = (project.timeline.audio_tracks() if media.kind == "audio"
                  else project.timeline.video_tracks())
        target = next((tr for tr in tracks
                       if tr.id == self._scene.track_at_y(scene_pos.y())),
                      tracks[0] if tracks else None)
        if target is None:
            return
        duration = 5.0 if media.kind == "image" else min(5.0, media.effective_duration())
        clip = Clip(kind=media.kind if media.kind in (ClipKind.AUDIO.value,
                    ClipKind.IMAGE.value) else ClipKind.VIDEO.value,
                    media_id=media.id, name=media.name, start=t,
                    duration=duration, source_in=0.0, source_duration=duration)
        self.commandRequested.emit(AddClipCommand(project.timeline, clip, target.id))
        event.acceptProposedAction()
