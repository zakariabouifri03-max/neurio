"""Custom widgets: multi-track timeline, canvas view with mouse mapping, waveform."""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QSizePolicy, QWidget

from ..video.model import Timeline

TRACK_H = 46
RULER_H = 22
LABEL_W = 56
PX_PER_S_DEFAULT = 60.0
KIND_COLORS = {"video": "#3d6ee0", "image": "#2f9e8f", "audio": "#3ecf8e", "text": "#c084fc"}


class TimelineWidget(QWidget):
    selectionChanged = Signal(str)
    playheadChanged = Signal(float)
    clipMoved = Signal(str, float, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.timeline = Timeline()
        self.px_per_s = PX_PER_S_DEFAULT
        self.playhead = 0.0
        self.selected: str = ""
        self._drag: tuple[str, float, float] | None = None  # clip id, press x, original start
        self._override: tuple[str, float, int] | None = None  # live drag position (clip id, start, track)
        self.setMinimumHeight(RULER_H + 4 * TRACK_H + 8)
        self.setMouseTracking(True)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.setToolTip("Click a clip to select it. Drag to move. Click the ruler to move the playhead.")

    def set_timeline(self, tl: Timeline) -> None:
        self.timeline = tl
        self.setMinimumWidth(int(LABEL_W + max(tl.duration() + 10, 20) * self.px_per_s))
        self.update()

    def set_zoom(self, px_per_s: float) -> None:
        self.px_per_s = max(10.0, min(300.0, px_per_s))
        self.setMinimumWidth(int(LABEL_W + max(self.timeline.duration() + 10, 20) * self.px_per_s))
        self.update()

    def _x_for(self, t: float) -> float:
        return LABEL_W + t * self.px_per_s

    def _t_for(self, x: float) -> float:
        return max(0.0, (x - LABEL_W) / self.px_per_s)

    def _clip_rect(self, c) -> QRectF:
        start, track = c.start, c.track
        if self._override and self._override[0] == c.id:
            start, track = self._override[1], self._override[2]
        return QRectF(self._x_for(start), RULER_H + 4 + track * TRACK_H + 4,
                      max(4.0, c.duration * self.px_per_s), TRACK_H - 8)

    def clip_at(self, pos: QPointF):
        for c in reversed(self.timeline.sorted_clips()):
            if self._clip_rect(c).contains(pos):
                return c
        return None

    def paintEvent(self, _event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.fillRect(self.rect(), QColor("#101216"))
        font = QFont()
        font.setPointSize(8)
        p.setFont(font)
        # ruler
        p.fillRect(0, 0, self.width(), RULER_H, QColor("#1b1d22"))
        step = 1 if self.px_per_s >= 40 else (5 if self.px_per_s >= 12 else 10)
        t = 0
        while self._x_for(t) < self.width():
            x = self._x_for(t)
            p.setPen(QColor("#5a6172"))
            p.drawLine(int(x), RULER_H - 6, int(x), RULER_H)
            p.drawText(int(x) + 2, RULER_H - 7, f"{t}s")
            t += step
        # tracks
        tracks = max([c.track for c in self.timeline.clips], default=0) + 1
        tracks = max(tracks, 4)
        for i in range(tracks):
            y = RULER_H + 4 + i * TRACK_H
            p.fillRect(QRectF(0, y, self.width(), TRACK_H - 2), QColor("#16181d" if i % 2 else "#1a1c22"))
            p.setPen(QColor("#6b7180"))
            p.drawText(6, int(y + TRACK_H / 2), f"V{i + 1}")
        for c in self.timeline.sorted_clips():
            r = self._clip_rect(c)
            col = QColor(KIND_COLORS.get(c.kind, "#888"))
            if c.id == self.selected:
                p.setPen(QPen(QColor("#ffffff"), 2))
            else:
                p.setPen(QPen(col.darker(140), 1))
            p.setBrush(col.darker(160) if c.kind == "audio" else col)
            p.drawRoundedRect(r, 4, 4)
            p.setPen(QColor("#ffffff"))
            label = c.text[:24] if c.kind == "text" else (c.src.replace("\\", "/").split("/")[-1] or c.kind)
            p.drawText(r.adjusted(6, 0, -4, 0), Qt.AlignVCenter | Qt.AlignLeft, label)
        # playhead
        x = self._x_for(self.playhead)
        p.setPen(QPen(QColor("#ff5a5f"), 2))
        p.drawLine(int(x), 0, int(x), self.height())
        p.end()

    def mousePressEvent(self, e) -> None:
        if e.position().y() < RULER_H:
            self.playhead = self._t_for(e.position().x())
            self.playheadChanged.emit(self.playhead)
            self.update()
            return
        c = self.clip_at(e.position())
        self.selected = c.id if c else ""
        self.selectionChanged.emit(self.selected)
        if c:
            self._drag = (c.id, e.position().x(), c.start)
        self.update()

    def mouseMoveEvent(self, e) -> None:
        if self._drag:
            cid, x0, start0 = self._drag
            new_start = max(0.0, start0 + (e.position().x() - x0) / self.px_per_s)
            new_start = round(new_start * 20) / 20  # snap to 0.05 s
            track = max(0, min(3, int((e.position().y() - RULER_H - 4) // TRACK_H)))
            self._override = (cid, new_start, track)
            self.update()

    def mouseReleaseEvent(self, _e) -> None:
        if self._drag and self._override:
            cid, start, track = self._override
            self._drag = None
            self._override = None
            self.clipMoved.emit(cid, start, track)
        else:
            self._drag = None
            self._override = None
        self.update()

    def mouseDoubleClickEvent(self, e) -> None:
        if e.position().y() >= RULER_H:
            self.playhead = self._t_for(e.position().x())
            self.playheadChanged.emit(self.playhead)
            self.update()


class CanvasView(QWidget):
    """Shows a QImage scaled to fit; reports mouse positions in image pixel coordinates."""
    pressed = Signal(int, int)
    moved = Signal(int, int)
    released = Signal(int, int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._image = None
        self._img_w = 1
        self._img_h = 1
        self.setMinimumSize(320, 220)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMouseTracking(False)
        self._drawing = False

    def set_image(self, qimage, img_w: int, img_h: int) -> None:
        self._image = qimage
        self._img_w, self._img_h = max(1, img_w), max(1, img_h)
        self.update()

    def _rect(self) -> QRectF:
        if self._image is None:
            return QRectF()
        s = min(self.width() / self._img_w, self.height() / self._img_h)
        w, h = self._img_w * s, self._img_h * s
        return QRectF((self.width() - w) / 2, (self.height() - h) / 2, w, h)

    def _to_img(self, pos: QPointF) -> tuple[int, int]:
        r = self._rect()
        if r.width() <= 0:
            return 0, 0
        x = (pos.x() - r.x()) / r.width() * self._img_w
        y = (pos.y() - r.y()) / r.height() * self._img_h
        return int(max(0, min(self._img_w - 1, x))), int(max(0, min(self._img_h - 1, y)))

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#0c0d10"))
        if self._image is not None:
            p.drawImage(self._rect(), self._image)
        p.end()

    def mousePressEvent(self, e) -> None:
        if self._image is not None and e.button() == Qt.LeftButton:
            self._drawing = True
            self.pressed.emit(*self._to_img(e.position()))

    def mouseMoveEvent(self, e) -> None:
        if self._drawing:
            self.moved.emit(*self._to_img(e.position()))

    def mouseReleaseEvent(self, e) -> None:
        if self._drawing:
            self._drawing = False
            self.released.emit(*self._to_img(e.position()))


class WaveformWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.peaks = None
        self.setMinimumHeight(140)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

    def set_peaks(self, peaks) -> None:
        self.peaks = peaks
        self.update()

    def paintEvent(self, _e) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#0c0d10"))
        if self.peaks is not None and len(self.peaks):
            mid = self.height() / 2
            n = len(self.peaks)
            p.setPen(QPen(QColor("#3ecf8e"), 1))
            for i, v in enumerate(self.peaks):
                x = i / n * self.width()
                h = float(v) * (self.height() / 2 - 4)
                p.drawLine(QPointF(x, mid - h), QPointF(x, mid + h))
        else:
            p.setPen(QColor("#6b7180"))
            p.drawText(self.rect(), Qt.AlignCenter, "Open an audio or video file to see its waveform")
        p.end()
