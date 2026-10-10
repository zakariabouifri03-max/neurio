"""Animation & motion graphics: keyframed objects → GIF / PNG sequence.

A deliberately honest scope: 2D keyframe animation of position, scale,
rotation and opacity for text/shape objects, rendered frame-by-frame with
Pillow and exported as an animated GIF (or PNG sequence).  This is not a 3D
engine and doesn't pretend to be one.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw
from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout,
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPushButton,
    QSpinBox, QVBoxLayout, QWidget,
)

from ...core.jobs import Job
from ...services.timeline import Keyframe, keyframe_value


class AnimationPanel(QWidget):
    def __init__(self, runner, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.tr = tr
        self.objects: list[dict] = []
        self.active = -1
        self.width, self.height, self.fps, self.duration = 640, 360, 15, 3.0
        self.presets = {
            "slide in": {"x": [Keyframe(0, -1.0), Keyframe(0.8, 0.0)]},
            "pop": {"scale": [Keyframe(0, 0.0), Keyframe(0.5, 1.2), Keyframe(0.8, 1.0)]},
            "fade in": {"opacity": [Keyframe(0, 0.0), Keyframe(1.0, 1.0)]},
            "spin": {"rotation": [Keyframe(0, 0.0), Keyframe(2.0, 360.0)]},
        }
        self._build()
        self.runner.job_finished.connect(self._done)

    def _build(self):
        root = QHBoxLayout(self)
        left = QVBoxLayout()

        props = QGroupBox("Canvas")
        pf = QFormLayout(props)
        self.cw = QSpinBox(); self.cw.setRange(64, 4096); self.cw.setValue(self.width)
        self.ch = QSpinBox(); self.ch.setRange(64, 4096); self.ch.setValue(self.height)
        self.fps_spin = QSpinBox(); self.fps_spin.setRange(5, 60); self.fps_spin.setValue(self.fps)
        self.dur_spin = QDoubleSpinBox(); self.dur_spin.setRange(0.5, 30)
        self.dur_spin.setValue(self.duration)
        pf.addRow("Width", self.cw); pf.addRow("Height", self.ch)
        pf.addRow("FPS", self.fps_spin); pf.addRow("Duration (s)", self.dur_spin)
        left.addWidget(props)

        obj = QGroupBox("Objects")
        ov = QVBoxLayout(obj)
        add_row = QHBoxLayout()
        self.obj_type = QComboBox(); self.obj_type.addItems(["text", "rect", "ellipse"])
        self.obj_text = QLineEdit("ADZAK")
        b_add = QPushButton("Add")
        b_add.clicked.connect(self.add_object)
        add_row.addWidget(self.obj_type); add_row.addWidget(b_add)
        ov.addLayout(add_row)
        ov.addWidget(self.obj_text)
        self.obj_list = QListWidget()
        self.obj_list.currentRowChanged.connect(self._select)
        ov.addWidget(self.obj_list, 1)
        b_del = QPushButton("Delete object")
        b_del.clicked.connect(self.delete_object)
        ov.addWidget(b_del)
        left.addWidget(obj)

        kf = QGroupBox("Keyframes / motion preset")
        kv = QFormLayout(kf)
        self.preset = QComboBox(); self.preset.addItems(list(self.presets))
        b_preset = QPushButton("Apply preset")
        b_preset.clicked.connect(self.apply_preset)
        kv.addRow(self.preset, b_preset)
        self.kf_prop = QComboBox()
        self.kf_prop.addItems(["x", "y", "scale", "rotation", "opacity"])
        self.kf_t = QDoubleSpinBox(); self.kf_t.setRange(0, 60)
        self.kf_v = QDoubleSpinBox(); self.kf_v.setRange(-5, 3600); self.kf_v.setDecimals(2)
        b_kf = QPushButton("Set keyframe (t, value)")
        b_kf.clicked.connect(self.set_keyframe)
        kv.addRow("Property", self.kf_prop)
        kv.addRow("Time (s)", self.kf_t)
        kv.addRow("Value", self.kf_v)
        kv.addRow(b_kf)
        self.kf_info = QLabel(""); self.kf_info.setObjectName("hint")
        self.kf_info.setWordWrap(True)
        kv.addRow(self.kf_info)
        left.addWidget(kf)

        exp = QHBoxLayout()
        b_gif = QPushButton("Export GIF…"); b_gif.setObjectName("primary")
        b_seq = QPushButton("PNG sequence…")
        b_gif.clicked.connect(lambda: self.export("gif"))
        b_seq.clicked.connect(lambda: self.export("png"))
        exp.addWidget(b_gif); exp.addWidget(b_seq)
        left.addLayout(exp)
        left.addStretch(1)

        self.canvas = QLabel(alignment=Qt.AlignCenter)
        self.canvas.setStyleSheet("background:#0c0d10; border-radius:8px;")
        self.canvas.setMinimumSize(420, 280)

        lw = QWidget(); lw.setLayout(left); lw.setMaximumWidth(360)
        root.addWidget(lw); root.addWidget(self.canvas, 1)

    # ------------------------------------------------------------------
    def add_object(self):
        kind = self.obj_type.currentText()
        self.objects.append({
            "type": kind, "text": self.obj_text.text() or "ADZAK",
            "color": "#3b6ef5", "size": 1.0,
            "kf": {"x": [], "y": [], "scale": [], "rotation": [], "opacity": []},
            "cx": 0.5, "cy": 0.5,  # normalised base position
        })
        self._refresh_list()
        self.active = len(self.objects) - 1
        self.obj_list.setCurrentRow(self.active)
        self.preview(0.0)

    def delete_object(self):
        if 0 <= self.active < len(self.objects):
            self.objects.pop(self.active)
            self.active = -1
            self._refresh_list()
            self.preview(0.0)

    def _refresh_list(self):
        self.obj_list.blockSignals(True)
        self.obj_list.clear()
        for o in self.objects:
            self.obj_list.addItem(f"{o['type']}: {o['text'][:18]}")
        self.obj_list.blockSignals(False)

    def _select(self, row):
        self.active = row
        self._kf_info()
        self.preview(0.0)

    def _kf_info(self):
        if 0 <= self.active < len(self.objects):
            o = self.objects[self.active]
            parts = [f"{k}:{len(v)}" for k, v in o["kf"].items() if v]
            self.kf_info.setText(", ".join(parts) or "no keyframes — static object")

    def set_keyframe(self):
        if not (0 <= self.active < len(self.objects)):
            return
        o = self.objects[self.active]
        prop = self.kf_prop.currentText()
        keys = o["kf"][prop]
        t, v = self.kf_t.value(), self.kf_v.value()
        for kf in keys:
            if abs(kf.time - t) < 0.01:
                kf.value = v
                break
        else:
            keys.append(Keyframe(t, v))
            keys.sort(key=lambda k: k.time)
        self._kf_info()
        self.preview(min(t, self.duration))

    def apply_preset(self):
        if not (0 <= self.active < len(self.objects)):
            return
        preset = self.presets[self.preset.currentText()]
        o = self.objects[self.active]
        for prop, keys in preset.items():
            o["kf"][prop] = [Keyframe(k.time, k.value) for k in keys]
        self._kf_info()
        self.preview(0.0)

    # ------------------------------------------------------------------
    def defaults(self):
        return {"x": 0.0, "y": 0.0, "scale": 1.0, "rotation": 0.0, "opacity": 1.0}

    def eval_object(self, o: dict, t: float) -> dict:
        d = self.defaults()
        for prop, default in d.items():
            d[prop] = keyframe_value(o["kf"].get(prop, []), t, default)
        return d

    def render_frame(self, t: float, size: tuple[int, int] | None = None) -> Image.Image:
        w = size[0] if size else self.cw.value()
        h = size[1] if size else self.ch.value()
        img = Image.new("RGBA", (w, h), (24, 26, 30, 255))
        draw = ImageDraw.Draw(img)
        for o in self.objects:
            d = self.eval_object(o, t)
            cx = (o["cx"] + d["x"]) * w
            cy = (o["cy"] + d["y"]) * h
            s = max(0.01, o["size"] * d["scale"])
            base = min(w, h) * 0.18 * s
            alpha = int(255 * max(0.0, min(1.0, d["opacity"])))
            color = tuple(int(o["color"][i:i + 2], 16) for i in (1, 3, 5)) + (alpha,)
            layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            if o["type"] == "rect":
                ld.rectangle([cx - base, cy - base * 0.6, cx + base, cy + base * 0.6], fill=color)
            elif o["type"] == "ellipse":
                ld.ellipse([cx - base, cy - base, cx + base, cy + base], fill=color)
            else:
                try:
                    from PIL import ImageFont
                    font = ImageFont.truetype("arial.ttf", int(base))
                except OSError:
                    font = None
                ld.text((cx, cy), o["text"], fill=color, font=font, anchor="mm")
            if d["rotation"]:
                layer = layer.rotate(-d["rotation"], resample=Image.BICUBIC)
            img = Image.alpha_composite(img, layer)
        return img

    def preview(self, t: float):
        img = self.render_frame(t, (480, 270))
        qimg = QImage(img.tobytes(), img.width, img.height, QImage.Format_RGBA8888).copy()
        self.canvas.setPixmap(QPixmap.fromImage(qimg).scaled(
            self.canvas.size() or QSize(480, 270), Qt.KeepAspectRatio,
            Qt.SmoothTransformation))

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self.preview(0.0)

    # ------------------------------------------------------------------
    def export(self, mode: str):
        if not self.objects:
            QMessageBox.warning(self, self.tr("common.warning"), "Add an object first.")
            return
        if mode == "gif":
            dest, _ = QFileDialog.getSaveFileName(self, "Export GIF", "animation.gif",
                                                  "GIF (*.gif)")
        else:
            dest = QFileDialog.getExistingDirectory(self, "PNG output folder")
        if not dest:
            return
        width, height = self.cw.value(), self.ch.value()
        if width * height > 1920 * 1080:
            reply = QMessageBox.question(
                self, "Large canvas",
                f"{width}×{height} frames may use a lot of RAM on low-end PCs. "
                "Continue?")
            if reply != QMessageBox.StandardButton.Yes:
                return
        fps, duration = self.fps_spin.value(), self.dur_spin.value()

        def fn(report, cancel):
            frames = []
            n = max(1, int(fps * duration))
            for i in range(n):
                if cancel.is_set():
                    raise RuntimeError("cancelled")
                frames.append(self.render_frame(i / fps, (width, height)).convert("RGB"))
                report((i + 1) / n, f"frame {i + 1}/{n}")
            if mode == "gif":
                frames[0].save(dest, save_all=True, append_images=frames[1:],
                               duration=int(1000 / fps), loop=0, optimize=True)
                return dest
            out = Path(dest)
            for i, f in enumerate(frames):
                f.save(out / f"frame_{i:04d}.png")
            return str(out)

        self.runner.submit(Job(fn=fn, title=f"Render {mode.upper()}"))

    def _done(self, job: Job):
        if not job.title.startswith("Render"):
            return
        if job.result and job.result.ok:
            QMessageBox.information(self, self.tr("common.info"),
                                    f"Saved: {job.result.value}")
        elif job.result and job.result.error != "cancelled":
            QMessageBox.critical(self, self.tr("common.error"), job.result.error)
