"""Multi-track timeline widget.

Renders tracks/clips from the model, supports:
- click to select, double-click to rename (via editor panel),
- horizontal drag to move clips (with overlap rejection),
- edge drag to trim in/out,
- playhead scrubbing on the ruler,
- context menu (split, delete, speed…),
- zoom (pixels per second) with Ctrl+wheel.
"""

from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QBrush, QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ...services.timeline import Clip, Timeline, Track

TRACK_H = 44
RULER_H = 26
TRACK_GAP = 4
LABEL_W = 90

VIDEO_COLORS = ["#3b6ef5", "#7a5cf0", "#2fa36b", "#e0a63f"]
AUDIO_COLOR = "#1f9d8b"


class TimelineWidget(QWidget):
    playhead_changed = Signal(float)
    selection_changed = Signal(str)          # clip id or ""
    clip_moved = Signal(str, float)          # clip id, new start
    clip_trimmed = Signal(str, str, float)   # clip id, "in"/"out", new value
    context_menu_requested = Signal(str, object)  # clip id, QPoint

    def __init__(self, parent=None):
        super().__init__(parent)
        self.timeline: Timeline | None = None
        self.playhead = 0.0
        self.pps = 60.0                      # pixels per second
        self.selected_clip: str | None = None
        self.setMinimumHeight(180)
        self.setMouseTracking(True)
        self._drag: dict | None = None
        self.setFocusPolicy(Qt.StrongFocus)

    # ------------------------------------------------------------------
    def set_timeline(self, tl: Timeline) -> None:
        self.timeline = tl
        self.update()

    def _track_rect(self, i: int) -> QRectF:
        y = RULER_H + i * (TRACK_H + TRACK_GAP)
        return QRectF(LABEL_W, y, max(self.width() - LABEL_W, 200), TRACK_H)

    def _clip_rect(self, track_idx: int, clip: Clip) -> QRectF:
        r = self._track_rect(track_idx)
        x = r.x() + clip.start * self.pps
        return QRectF(x, r.y() + 3, max(clip.duration * self.pps, 6), TRACK_H - 6)

    def time_at(self, x: float) -> float:
        return max(0.0, (x - LABEL_W) / self.pps)

    # ------------------------------------------------------------------
    def paintEvent(self, ev) -> None:  # noqa: N802
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#17181c"))
        if self.timeline is None:
            p.setPen(QColor("#8a909c"))
            p.drawText(self.rect(), Qt.AlignCenter, "Open or create a video project to edit")
            return

        # ruler
        p.fillRect(0, 0, self.width(), RULER_H, QColor("#23262c"))
        p.setPen(QColor("#8a909c"))
        step = max(1, int(50 / self.pps))
        t = 0.0
        while LABEL_W + t * self.pps < self.width():
            x = LABEL_W + t * self.pps
            p.drawLine(QPointF(x, RULER_H - 6), QPointF(x, RULER_H))
            p.drawText(QRectF(x + 2, 0, 80, RULER_H - 8), Qt.AlignLeft | Qt.AlignVCenter,
                       f"{int(t // 60)}:{t % 60:04.1f}")
            t += step

        for i, track in enumerate(self.timeline.tracks):
            r = self._track_rect(i)
            p.fillRect(0, r.y(), LABEL_W, TRACK_H, QColor("#23262c"))
            p.setPen(QColor("#c6cad2"))
            p.drawText(QRectF(6, r.y(), LABEL_W - 10, TRACK_H),
                       Qt.AlignLeft | Qt.AlignVCenter,
                       f"{'🎬' if track.kind == 'video' else '🔊'} {track.name}")
            p.fillRect(r, QColor("#1b1d22"))
            for ci, clip in enumerate(track.sorted_clips()):
                cr = self._clip_rect(i, clip)
                if not cr.intersects(self.rect().adjusted(-50, 0, 50, 0)):
                    continue
                color = VIDEO_COLORS[ci % len(VIDEO_COLORS)] if track.kind == "video" else AUDIO_COLOR
                p.setPen(Qt.NoPen)
                p.setBrush(QBrush(QColor(color)))
                p.drawRoundedRect(cr, 5, 5)
                if clip.id == self.selected_clip:
                    p.setPen(QPen(QColor("#ffffff"), 2))
                    p.setBrush(Qt.NoBrush)
                    p.drawRoundedRect(cr.adjusted(1, 1, -1, -1), 5, 5)
                p.setPen(QColor("#f2f4f8"))
                p.drawText(cr.adjusted(6, 2, -6, -2), Qt.AlignLeft | Qt.AlignVCenter,
                           clip.name or clip.source.split("/")[-1][:22])
                # trim handles
                p.fillRect(cr.adjusted(0, 4, -(cr.width() - 4), -4), QColor("#ffffffaa"))
                p.fillRect(cr.adjusted(cr.width() - 4, 4, 0, -4), QColor("#ffffffaa"))

        # playhead
        px = LABEL_W + self.playhead * self.pps
        p.setPen(QPen(QColor("#ff5d5d"), 2))
        p.drawLine(QPointF(px, 0), QPointF(px, self.height()))
        p.end()

    # ------------------------------------------------------------------
    def _hit_clip(self, pos) -> tuple[int, Clip | None, str]:
        """Return (track_idx, clip, zone) where zone is in/left-edge/right-edge."""
        if not self.timeline:
            return -1, None, ""
        for i, track in enumerate(self.timeline.tracks):
            for clip in track.clips:
                cr = self._clip_rect(i, clip)
                if cr.contains(pos):
                    if pos.x() - cr.left() < 8:
                        return i, clip, "left"
                    if cr.right() - pos.x() < 8:
                        return i, clip, "right"
                    return i, clip, "body"
        return -1, None, ""

    def mousePressEvent(self, ev) -> None:  # noqa: N802
        if self.timeline is None:
            return
        if ev.button() == Qt.LeftButton and ev.position().y() < RULER_H:
            self.playhead = self.time_at(ev.position().x())
            self.playhead_changed.emit(self.playhead)
            self._drag = {"mode": "scrub"}
            self.update()
            return
        i, clip, zone = self._hit_clip(ev.position())
        if clip is None:
            self.selected_clip = None
            self.selection_changed.emit("")
            self.update()
            return
        self.selected_clip = clip.id
        self.selection_changed.emit(clip.id)
        if ev.button() == Qt.LeftButton:
            self._drag = {"mode": zone, "clip": clip.id,
                          "start_x": ev.position().x(),
                          "orig_start": clip.start,
                          "orig_in": clip.in_resolved,
                          "orig_out": clip.out_resolved}
        self.update()

    def mouseMoveEvent(self, ev) -> None:  # noqa: N802
        if not self._drag or not self.timeline:
            return
        mode = self._drag["mode"]
        if mode == "scrub":
            self.playhead = self.time_at(ev.position().x())
            self.playhead_changed.emit(self.playhead)
            self.update()
            return
        loc = self.timeline.find_clip(self._drag["clip"])
        if not loc:
            return
        _, clip = loc
        dt = (ev.position().x() - self._drag["start_x"]) / self.pps
        if mode == "body":
            new_start = max(0.0, self._drag["orig_start"] + dt)
            if abs(new_start - clip.start) > 0.01:
                self.clip_moved.emit(clip.id, new_start)
                self.update()
        elif mode == "left":
            new_in = max(0.0, self._drag["orig_in"] + dt * abs(clip.speed))
            self.clip_trimmed.emit(clip.id, "in", new_in)
            self.update()
        elif mode == "right":
            new_out = self._drag["orig_out"] + dt * abs(clip.speed)
            self.clip_trimmed.emit(clip.id, "out", max(new_out, clip.in_resolved + 0.1))
            self.update()

    def mouseReleaseEvent(self, ev) -> None:  # noqa: N802
        self._drag = None

    def wheelEvent(self, ev) -> None:  # noqa: N802
        if ev.modifiers() & Qt.ControlModifier:
            factor = 1.15 if ev.angleDelta().y() > 0 else 1 / 1.15
            self.pps = max(8.0, min(400.0, self.pps * factor))
            self.update()
            ev.accept()
        else:
            super().wheelEvent(ev)

    def contextMenuEvent(self, ev) -> None:  # noqa: N802
        i, clip, _ = self._hit_clip(ev.pos())
        self.context_menu_requested.emit(clip.id if clip else "", ev.globalPos())

    def keyPressEvent(self, ev) -> None:  # noqa: N802
        if ev.key() == Qt.Key_Delete and self.selected_clip:
            self.context_menu_requested.emit(self.selected_clip, None)
        else:
            super().keyPressEvent(ev)
