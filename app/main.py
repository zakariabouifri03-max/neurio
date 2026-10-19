#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Neurio — Hayed Background + Zid Quality
App PC (exe) — PySide6 GUI

Features:
- Drag & Drop taswira
- Hayed background b rembg (U2Net) + fallback
- Zid quality: upscale 2x/4x, denoise, sharpen, color boost
- Preview qbel w men ba3d (checkerboard for transparency)
- Save PNG/JPG/WEBP
- Batch? single file v1
- CLI mode for headless

Run: python app/main.py
CLI: python app/main.py --cli input.jpg -o out.png --scale 2
"""

import sys
import os
import io
import traceback
from pathlib import Path

# Allow imports when run as script
sys.path.insert(0, str(Path(__file__).parent))

from processor import process_image, remove_background_pil, enhance_quality, save_image_pil, HAS_REMBG, HAS_CV2
from PIL import Image, ImageOps

IS_CLI = "--cli" in sys.argv or "--headless" in sys.argv

if IS_CLI:
    # CLI mode — no GUI imports
    import argparse
    parser = argparse.ArgumentParser(description="Neurio CLI — remove bg + enhance")
    parser.add_argument("--cli", action="store_true", help="CLI mode")
    parser.add_argument("input", nargs="?", help="input image")
    parser.add_argument("-o", "--output", default=None, help="output path")
    parser.add_argument("--no-bg", action="store_true", help="skip bg removal")
    parser.add_argument("--no-enhance", action="store_true", help="skip enhancement")
    parser.add_argument("--scale", type=int, choices=[1,2,4], default=2, help="upscale factor")
    parser.add_argument("--sharpen", type=float, default=1.35, help="sharpen 0.5-2.5")
    parser.add_argument("--denoise", action="store_true", help="enable denoise (default on if enhance)")
    parser.add_argument("--no-denoise", action="store_true")
    parser.add_argument("--model", default="u2net", help="rembg model u2net/u2net_human_seg/isnet-general-use")
    args = parser.parse_args()

    # Support both: python main.py --cli input.jpg  OR  python main.py --cli --input input.jpg
    input_path = args.input
    if not input_path:
        print("Usage: python app/main.py --cli input.jpg -o out.png [--scale 2] [--no-bg]")
        sys.exit(1)

    input_path = Path(input_path)
    if not input_path.exists():
        print(f"File not found: {input_path}")
        sys.exit(1)

    out_path = args.output
    if not out_path:
        suffix = input_path.suffix if input_path.suffix else ".png"
        # default: add suffix
        out_path = str(input_path.with_name(input_path.stem + f"_neurio_{args.scale}x.png"))
    
    denoise = True
    if args.no_denoise:
        denoise = False
    elif args.denoise:
        denoise = True
    else:
        # default handled by process_image
        pass

    print(f"[Neurio] Input: {input_path}")
    print(f"[Neurio] Output: {out_path} | scale={args.scale} sharpen={args.sharpen} bg={not args.no_bg} enhance={not args.no_enhance}")
    try:
        img = process_image(
            str(input_path),
            remove_bg=not args.no_bg,
            enhance=not args.no_enhance,
            scale=args.scale,
            sharpen=args.sharpen,
            denoise=denoise,
            color_boost=not args.no_enhance,
            model=args.model,
        )
        save_image_pil(img, out_path)
        print(f"[✓] Saved: {out_path} | {img.size[0]}x{img.size[1]} {img.mode}")
    except Exception as e:
        traceback.print_exc()
        print(f"[X] Failed: {e}")
        sys.exit(1)
    sys.exit(0)


# ========== GUI MODE ==========
try:
    from PySide6.QtWidgets import (
        QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
        QLabel, QPushButton, QComboBox, QSlider, QCheckBox,
        QFileDialog, QFrame, QSplitter, QProgressBar, QScrollArea,
        QMessageBox, QGraphicsDropShadowEffect, QSizePolicy
    )
    from PySide6.QtCore import Qt, QThread, Signal, QSize, QMimeData, QUrl, QTimer
    from PySide6.QtGui import QPixmap, QImage, QPainter, QColor, QFont, QAction, QIcon, QDragEnterEvent, QDropEvent
    HAS_PYSIDE = True
except ImportError as e:
    print(f"PySide6 not available: {e}")
    HAS_PYSIDE = False
    sys.exit(1)

# Helper: PIL -> QPixmap
def pil_to_qpixmap(pil_img: Image.Image, max_size=(900, 700)) -> QPixmap:
    """Convert PIL to QPixmap for preview, keep aspect."""
    if pil_img.mode == "RGBA":
        data = pil_img.tobytes("raw", "RGBA")
        qimg = QImage(data, pil_img.width, pil_img.height, QImage.Format_RGBA8888)
    elif pil_img.mode == "RGB":
        data = pil_img.tobytes("raw", "RGB")
        qimg = QImage(data, pil_img.width, pil_img.height, QImage.Format_RGB888)
    elif pil_img.mode == "L":
        data = pil_img.tobytes("raw", "L")
        qimg = QImage(data, pil_img.width, pil_img.height, QImage.Format_Grayscale8)
    else:
        pil_img = pil_img.convert("RGBA")
        data = pil_img.tobytes("raw", "RGBA")
        qimg = QImage(data, pil_img.width, pil_img.height, QImage.Format_RGBA8888)

    pix = QPixmap.fromImage(qimg)
    # Scale down for preview if too large (keep HQ for save)
    if pix.width() > max_size[0] or pix.height() > max_size[1]:
        pix = pix.scaled(max_size[0], max_size[1], Qt.KeepAspectRatio, Qt.SmoothTransformation)
    return pix

def make_checkerboard(w=320, h=220):
    """Create checkerboard QPixmap for transparent BG preview."""
    pix = QPixmap(w, h)
    pix.fill(QColor("#2a2f3a"))
    painter = QPainter(pix)
    tile = 16
    c1 = QColor("#3a4050")
    c2 = QColor("#2a2f3a")
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            is_dark = ((x // tile) + (y // tile)) % 2 == 0
            painter.fillRect(x, y, tile, tile, c1 if is_dark else c2)
    painter.end()
    return pix

class BgRemoveWorker(QThread):
    finished = Signal(object)  # PIL image
    error = Signal(str)
    progress = Signal(str)

    def __init__(self, pil_image: Image.Image, model="u2net", alpha_matting=False):
        super().__init__()
        self.pil_image = pil_image
        self.model = model
        self.alpha_matting = alpha_matting

    def run(self):
        try:
            self.progress.emit("Kayhayed background... ⏳")
            result = remove_background_pil(self.pil_image, model=self.model, alpha_matting=self.alpha_matting)
            self.finished.emit(result)
        except Exception as e:
            traceback.print_exc()
            self.error.emit(str(e))

class EnhanceWorker(QThread):
    finished = Signal(object)
    error = Signal(str)
    progress = Signal(str)

    def __init__(self, pil_image: Image.Image, scale=2, sharpen=1.35, denoise=True, color_boost=True):
        super().__init__()
        self.pil_image = pil_image
        self.scale = scale
        self.sharpen = sharpen
        self.denoise = denoise
        self.color_boost = color_boost

    def run(self):
        try:
            self.progress.emit(f"Kayzid quality {self.scale}x... ✨")
            color_f = 1.15 if self.color_boost else 1.0
            contrast_f = 1.12 if self.color_boost else 1.0
            brightness_f = 1.02 if self.color_boost else 1.0
            result = enhance_quality(
                self.pil_image,
                scale=self.scale,
                sharpen_factor=self.sharpen,
                color_factor=color_f,
                contrast_factor=contrast_f,
                brightness_factor=brightness_f,
                denoise=self.denoise,
                auto_color=self.color_boost,
            )
            self.finished.emit(result)
        except Exception as e:
            traceback.print_exc()
            self.error.emit(str(e))

class ComboWorker(QThread):
    finished = Signal(object)
    error = Signal(str)
    progress = Signal(str)

    def __init__(self, input_path: str, scale, sharpen, denoise, color_boost, model):
        super().__init__()
        self.input_path = input_path
        self.scale = scale
        self.sharpen = sharpen
        self.denoise = denoise
        self.color_boost = color_boost
        self.model = model

    def run(self):
        try:
            self.progress.emit("Hayed BG + Zid Quality... ⏳✨")
            img = process_image(
                self.input_path,
                remove_bg=True,
                enhance=True,
                scale=self.scale,
                sharpen=self.sharpen,
                denoise=self.denoise,
                color_boost=self.color_boost,
                model=self.model,
            )
            self.finished.emit(img)
        except Exception as e:
            traceback.print_exc()
            self.error.emit(str(e))

class ImageCard(QFrame):
    clicked = Signal()

    def __init__(self, title: str, subtitle: str, is_output=False, parent=None):
        super().__init__(parent)
        self.is_output = is_output
        self.setObjectName("card")
        self.setAcceptDrops(True)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        # Header
        head = QHBoxLayout()
        title_lbl = QLabel(title)
        title_lbl.setObjectName("cardTitle")
        head.addWidget(title_lbl)
        head.addStretch()
        badge = QLabel("INPUT" if not is_output else "OUTPUT")
        badge.setObjectName("badge")
        head.addWidget(badge)
        layout.addLayout(head)

        sub = QLabel(subtitle)
        sub.setObjectName("cardSub")
        sub.setWordWrap(True)
        layout.addWidget(sub)

        # Image area with checkerboard if output
        self.image_label = QLabel()
        self.image_label.setObjectName("imagePreview")
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setMinimumHeight(260)
        self.image_label.setWordWrap(True)
        if is_output:
            self.image_label.setStyleSheet("""
                background: qlineargradient(x1:0,y1:0,x2:1,y2:1, stop:0 #2a2f3a, stop:1 #1e222c);
                border: 2px dashed #3a4050;
                border-radius: 14px;
                padding: 10px;
                color: #8a90a5;
            """)
        else:
            self.image_label.setStyleSheet("""
                background: #1a1e29;
                border: 2px dashed #3a4050;
                border-radius: 14px;
                padding: 10px;
                color: #8a90a5;
            """)
        self.image_label.setText("📁\n\nJor taswira hna\nDrag & Drop\n\naw klick 'Khtar Taswira'")
        layout.addWidget(self.image_label, stretch=1)

        # Info line
        self.info = QLabel("" if not is_output else "Natija ghadi tban hna ✨")
        self.info.setObjectName("infoLine")
        self.info.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.info)

    def set_pil_image(self, pil_img: Image.Image, info_text=""):
        pix = pil_to_qpixmap(pil_img)
        self.image_label.setPixmap(pix)
        # Remove dashed border after image set, keep rounded
        if info_text:
            self.info.setText(info_text)
        else:
            self.info.setText(f"{pil_img.width} × {pil_img.height} px • {pil_img.mode}")

    def set_placeholder(self, text):
        self.image_label.clear()
        self.image_label.setText(text)
        self.info.setText("")

    def mousePressEvent(self, event):
        self.clicked.emit()
        super().mousePressEvent(event)

class NeurioWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Neurio — Hayed Background + Zid Quality ✨")
        self.setMinimumSize(1080, 680)
        self.resize(1180, 760)
        self.setAcceptDrops(True)

        # State
        self.input_path: Path | None = None
        self.input_pil: Image.Image | None = None
        self.output_pil: Image.Image | None = None
        self.workers = []  # keep refs

        self._build_ui()
        self._apply_styles()
        self.status("Marhba! Khtar taswira bach tbda ✨")

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(12)

        # ===== Header =====
        header = QFrame()
        header.setObjectName("header")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(16, 10, 16, 10)

        # Logo area
        logo_text = QLabel("◆ NEURIO")
        logo_text.setObjectName("logo")
        hl.addWidget(logo_text)

        tag = QLabel("Hayed Background • Zid Quality • HD 4K")
        tag.setObjectName("tagline")
        hl.addWidget(tag)
        hl.addSpacing(12)
        dash = QLabel("— Kaykhdem offline 100% — sari3 bzzaf ⚡")
        dash.setObjectName("dashNote")
        hl.addWidget(dash)

        hl.addStretch()

        # Model selector mini
        self.model_combo = QComboBox()
        self.model_combo.addItems(["u2net (3am)", "u2net_human_seg (bnadem)", "isnet-general-use (pro)"])
        self.model_combo.setCurrentIndex(0)
        self.model_combo.setObjectName("miniCombo")
        self.model_combo.setToolTip("Model dyal hayed background")
        hl.addWidget(self.model_combo)

        # Help
        help_btn = QPushButton("❔")
        help_btn.setObjectName("iconBtn")
        help_btn.setToolTip("Mosa3ada")
        help_btn.clicked.connect(self.show_help)
        hl.addWidget(help_btn)

        root.addWidget(header)

        # ===== Top toolbar =====
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        self.btn_pick = QPushButton("📁 Khtar Taswira")
        self.btn_pick.setObjectName("primary")
        self.btn_pick.clicked.connect(self.pick_image)
        toolbar.addWidget(self.btn_pick)

        self.btn_remove = QPushButton("✂️ Hayed Background")
        self.btn_remove.setObjectName("secondary")
        self.btn_remove.clicked.connect(self.do_remove_bg)
        self.btn_remove.setEnabled(False)
        toolbar.addWidget(self.btn_remove)

        self.btn_enhance = QPushButton("✨ Zid Quality")
        self.btn_enhance.setObjectName("accent")
        self.btn_enhance.clicked.connect(self.do_enhance)
        self.btn_enhance.setEnabled(False)
        toolbar.addWidget(self.btn_enhance)

        self.btn_combo = QPushButton("⚡ Bjouj (BG + HD)")
        self.btn_combo.setObjectName("gold")
        self.btn_combo.clicked.connect(self.do_both)
        self.btn_combo.setEnabled(False)
        # Make it prominent
        self.btn_combo.setToolTip("Hayed background + zed quality f nafs lwa9t (asra3)")
        toolbar.addWidget(self.btn_combo)

        toolbar.addStretch()

        self.btn_save = QPushButton("💾 Hfed / Save")
        self.btn_save.setObjectName("saveBtn")
        self.btn_save.clicked.connect(self.save_output)
        self.btn_save.setEnabled(False)
        toolbar.addWidget(self.btn_save)

        self.btn_reset = QPushButton("↺")
        self.btn_reset.setObjectName("iconBtn")
        self.btn_reset.setToolTip("Reset")
        self.btn_reset.clicked.connect(self.reset_all)
        toolbar.addWidget(self.btn_reset)

        root.addLayout(toolbar)

        # ===== Middle: two cards =====
        splitter = QSplitter(Qt.Horizontal)
        splitter.setHandleWidth(10)

        self.input_card = ImageCard("🖼️ Taswira L-asliya", "Drag & drop aw klick bach tkhtar fichier (JPG, PNG, WEBP)", is_output=False)
        self.input_card.clicked.connect(self.pick_image)
        splitter.addWidget(self.input_card)

        self.output_card = ImageCard("✨ Natija (Transparent)", "Background mhayed + quality mziyada — jahza l save", is_output=True)
        splitter.addWidget(self.output_card)

        splitter.setSizes([560, 560])
        splitter.setStyleSheet("QSplitter::handle { background: #232836; border-radius: 4px; }")
        root.addWidget(splitter, stretch=1)

        # ===== Controls row =====
        controls = QFrame()
        controls.setObjectName("controls")
        cl = QHBoxLayout(controls)
        cl.setContentsMargins(12, 10, 12, 10)
        cl.setSpacing(14)

        # Scale
        lab_scale = QLabel("📐 Tkabir (Upscale):")
        lab_scale.setObjectName("ctrlLabel")
        cl.addWidget(lab_scale)
        self.combo_scale = QComboBox()
        self.combo_scale.addItems(["1× Asli", "2× HD (ns7ek)", "4× Ultra HD"])
        self.combo_scale.setCurrentIndex(1)
        self.combo_scale.setObjectName("ctrlCombo")
        cl.addWidget(self.combo_scale)

        # Separator
        sep = QFrame()
        sep.setFrameShape(QFrame.VLine)
        sep.setStyleSheet("color: #3a4050;")
        cl.addWidget(sep)

        # Sharpen
        lab_sh = QLabel("🪞 Sharpen:")
        lab_sh.setObjectName("ctrlLabel")
        cl.addWidget(lab_sh)
        self.slider_sharpen = QSlider(Qt.Horizontal)
        self.slider_sharpen.setRange(0, 100)
        self.slider_sharpen.setValue(55)  # ~1.35
        self.slider_sharpen.setFixedWidth(110)
        self.slider_sharpen.setObjectName("ctrlSlider")
        cl.addWidget(self.slider_sharpen)
        self.lbl_sh_val = QLabel("1.35×")
        self.lbl_sh_val.setObjectName("valLabel")
        self.lbl_sh_val.setFixedWidth(42)
        cl.addWidget(self.lbl_sh_val)
        self.slider_sharpen.valueChanged.connect(self.update_sharpen_label)

        # Denoise
        self.chk_denoise = QCheckBox("🧹 Denoise")
        self.chk_denoise.setChecked(True)
        self.chk_denoise.setObjectName("ctrlCheck")
        cl.addWidget(self.chk_denoise)

        # Color boost
        self.chk_color = QCheckBox("🎨 Zid Lawn")
        self.chk_color.setChecked(True)
        self.chk_color.setObjectName("ctrlCheck")
        self.chk_color.setToolTip("Auto color + contrast boost")
        cl.addWidget(self.chk_color)

        cl.addStretch()

        # Format
        lab_fmt = QLabel("Save as:")
        lab_fmt.setObjectName("ctrlLabel")
        cl.addWidget(lab_fmt)
        self.combo_format = QComboBox()
        self.combo_format.addItems(["PNG (transparent)", "JPG (blanc)", "WEBP (sghir)"])
        self.combo_format.setObjectName("ctrlCombo")
        cl.addWidget(self.combo_format)

        root.addWidget(controls)

        # ===== Status + Progress =====
        status_row = QHBoxLayout()
        self.status_lbl = QLabel("Jahz ✅")
        self.status_lbl.setObjectName("statusLbl")
        status_row.addWidget(self.status_lbl)
        status_row.addStretch()
        self.progress = QProgressBar()
        self.progress.setObjectName("prog")
        self.progress.setFixedHeight(8)
        self.progress.setTextVisible(False)
        self.progress.setRange(0, 0)  # indeterminate
        self.progress.hide()
        status_row.addWidget(self.progress, stretch=0)

        # Engine badge
        eng = "rembg ✅" if HAS_REMBG else "rembg ❌ (fallback)"
        eng += " • OpenCV ✅" if HAS_CV2 else " • OpenCV ❌"
        eng_lbl = QLabel(eng)
        eng_lbl.setObjectName("engineBadge")
        status_row.addWidget(eng_lbl)

        root.addLayout(status_row)

    def _apply_styles(self):
        # Modern dark theme with gradients
        self.setStyleSheet("""
            QMainWindow { background: #0f111a; }
            #header {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #1a1e2e, stop:0.5 #1e2a4a, stop:1 #1a1e2e);
                border: 1px solid #252a3a;
                border-radius: 12px;
            }
            #logo { color: #6ee7b7; font-size: 18px; font-weight: 800; letter-spacing: 1px; }
            #tagline { color: #a5b4fc; font-size: 12px; font-weight: 600; }
            #dashNote { color: #6b7285; font-size: 11px; }
            QComboBox#miniCombo {
                background: #232836; color: #d1d5db; border: 1px solid #2d3346; border-radius: 8px;
                padding: 6px 10px; min-width: 170px; font-size: 11px;
            }
            QComboBox#miniCombo::drop-down { border: none; }
            QComboBox#miniCombo QAbstractItemView { background: #1e222c; color: #e5e7eb; selection-background-color: #3b82f6; }

            QPushButton {
                border-radius: 10px; padding: 10px 16px; font-weight: 700; font-size: 12px;
            }
            QPushButton#primary {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #3b82f6, stop:1 #2563eb);
                color: white; border: 1px solid #3b82f6;
            }
            QPushButton#primary:hover { background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #60a5fa, stop:1 #3b82f6); }
            QPushButton#secondary {
                background: #232836; color: #e5e7eb; border: 1px solid #2d3346;
            }
            QPushButton#secondary:hover { background: #2d3346; border-color: #3b82f6; }
            QPushButton#accent {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #8b5cf6, stop:1 #7c3aed);
                color: white; border: 1px solid #8b5cf6;
            }
            QPushButton#accent:hover { background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #a78bfa, stop:1 #8b5cf6); }
            QPushButton#gold {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #f59e0b, stop:1 #d97706);
                color: white; border: 1px solid #f59e0b;
            }
            QPushButton#gold:hover { background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #fbbf24, stop:1 #f59e0b); }
            QPushButton#saveBtn {
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #10b981, stop:1 #059669);
                color: white; border: 1px solid #10b981; padding: 10px 22px;
            }
            QPushButton#saveBtn:hover { background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #34d399, stop:1 #10b981); }
            QPushButton#saveBtn:disabled { background: #1e222c; color: #4b5563; border-color: #2d3346; }
            QPushButton#iconBtn { background: #232836; color: #9ca3af; border: 1px solid #2d3346; padding: 8px 12px; font-size: 14px; }
            QPushButton#iconBtn:hover { background: #2d3346; color: #e5e7eb; }
            QPushButton:disabled { color: #5a6478; background: #1a1e29; border-color: #232a3a; }

            #card {
                background: #161a27; border: 1px solid #232a3a; border-radius: 16px;
            }
            #cardTitle { color: #f3f4f6; font-size: 13px; font-weight: 800; }
            #cardSub { color: #6b7280; font-size: 11px; }
            #badge { background: #1e2435; color: #60a5fa; border: 1px solid #2d3a5e; border-radius: 6px; padding: 2px 8px; font-size: 10px; font-weight: 700; }
            #infoLine { color: #9ca3af; font-size: 11px; background: #1e222c; border-radius: 8px; padding: 6px; }

            #controls { background: #161a27; border: 1px solid #232a3a; border-radius: 12px; }
            #ctrlLabel { color: #9ca3af; font-size: 11px; font-weight: 600; }
            #valLabel { color: #e5e7eb; font-size: 11px; font-weight: 700; background: #1e222c; border-radius: 6px; padding: 4px 6px; }
            QComboBox#ctrlCombo {
                background: #1e222c; color: #e5e7eb; border: 1px solid #2d3346; border-radius: 8px;
                padding: 6px 10px; min-width: 120px; font-size: 11px; font-weight: 600;
            }
            QComboBox#ctrlCombo::drop-down { border: none; }
            QComboBox#ctrlCombo QAbstractItemView { background: #1e222c; color: #e5e7eb; selection-background-color: #3b82f6; }
            QSlider#ctrlSlider::groove:horizontal { height: 6px; background: #232836; border-radius: 3px; }
            QSlider#ctrlSlider::handle:horizontal { width: 14px; height: 14px; margin: -4px 0; background: #3b82f6; border-radius: 7px; border: 2px solid white; }
            QSlider#ctrlSlider::sub-page:horizontal { background: #3b82f6; border-radius: 3px; }
            QCheckBox#ctrlCheck { color: #d1d5db; font-size: 11px; font-weight: 600; spacing: 6px; }
            QCheckBox#ctrlCheck::indicator { width: 16px; height: 16px; border-radius: 4px; border: 1px solid #3a4050; background: #1e222c; }
            QCheckBox#ctrlCheck::indicator:checked { background: #3b82f6; border-color: #3b82f6; }

            #statusLbl { color: #9ca3af; font-size: 11px; font-weight: 600; }
            #engineBadge { color: #6b7280; font-size: 10px; background: #1a1e29; border: 1px solid #232a3a; border-radius: 6px; padding: 4px 8px; }
            QProgressBar#prog { background: #1e222c; border: 1px solid #232a3a; border-radius: 4px; }
            QProgressBar#prog::chunk { background: qlineargradient(x1:0,y1:0,x2:1,y2:0, stop:0 #3b82f6, stop:1 #8b5cf6); border-radius: 3px; }
        """)

    # ===== Helpers =====
    def status(self, text):
        self.status_lbl.setText(text)

    def busy(self, on=True):
        for btn in [self.btn_pick, self.btn_remove, self.btn_enhance, self.btn_combo, self.btn_save, self.btn_reset]:
            btn.setEnabled(not on if btn != self.btn_save else (not on and self.output_pil is not None))
        # Re-enable pick logic
        if not on:
            has_input = self.input_pil is not None
            self.btn_remove.setEnabled(has_input)
            self.btn_enhance.setEnabled(has_input)
            self.btn_combo.setEnabled(has_input)
            self.btn_save.setEnabled(self.output_pil is not None)
            self.progress.hide()
        else:
            self.progress.show()

    def get_scale(self) -> int:
        idx = self.combo_scale.currentIndex()
        return [1, 2, 4][idx]

    def get_sharpen(self) -> float:
        v = self.slider_sharpen.value()  # 0-100
        # map 0->0.5, 50->1.3, 100->2.5
        if v <= 50:
            return 0.5 + (v / 50) * 0.8  # 0.5 to 1.3
        else:
            return 1.3 + ((v - 50) / 50) * 1.2  # 1.3 to 2.5

    def update_sharpen_label(self):
        self.lbl_sh_val.setText(f"{self.get_sharpen():.2f}×")

    def get_model(self):
        idx = self.model_combo.currentIndex()
        return ["u2net", "u2net_human_seg", "isnet-general-use"][idx]

    # ===== File ops =====
    def pick_image(self):
        fname, _ = QFileDialog.getOpenFileName(
            self, "Khtar Taswira — Choisir Image", str(Path.home()),
            "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tiff);;All files (*.*)"
        )
        if fname:
            self.load_image(Path(fname))

    def load_image(self, path: Path):
        if not path.exists():
            QMessageBox.warning(self, "Erreur", f"Fichier makaynach:\n{path}")
            return
        try:
            pil = Image.open(path)
            pil = ImageOps.exif_transpose(pil)
            # Convert to RGB/RGBA for display
            # Keep original for processing
            self.input_path = path
            self.input_pil = pil.convert("RGBA") if pil.mode in ("P", "LA") else pil
            if self.input_pil.mode == "P":
                self.input_pil = self.input_pil.convert("RGBA")
            self.output_pil = None
            self.input_card.set_pil_image(self.input_pil, f"{self.input_pil.width}×{self.input_pil.height} • {path.name}")
            self.output_card.set_placeholder("✨\nNatija ghadi tban hna\nClick 'Hayed Background' aw 'Zid Quality'")
            self.status(f"Loaded: {path.name} — {self.input_pil.width}×{self.input_pil.height} ✅")
            self.busy(False)
        except Exception as e:
            traceback.print_exc()
            QMessageBox.critical(self, "Erreur", f"Ma9darnach n9raw taswira:\n{e}")

    # Drag & Drop
    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent):
        urls = event.mimeData().urls()
        if urls:
            path = Path(urls[0].toLocalFile())
            if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"):
                self.load_image(path)
        event.acceptProposedAction()

    # ===== Processing =====
    def do_remove_bg(self):
        if not self.input_pil:
            return
        self.busy(True)
        self.status("Kayhayed background... ⏳")
        w = BgRemoveWorker(self.input_pil, model=self.get_model())
        w.progress.connect(self.status)
        w.finished.connect(self.on_bg_done)
        w.error.connect(self.on_error)
        # keep ref
        self.workers.append(w)
        w.finished.connect(lambda: self.workers.remove(w) if w in self.workers else None)
        w.start()

    def on_bg_done(self, pil_img: Image.Image):
        self.output_pil = pil_img
        self.output_card.set_pil_image(pil_img, f"{pil_img.width}×{pil_img.height} • transparent PNG ✅")
        self.status(f"Background mhayed ✅ — {pil_img.width}×{pil_img.height}")
        self.busy(False)

    def do_enhance(self):
        if not self.input_pil:
            return
        self.busy(True)
        src = self.output_pil if self.output_pil is not None else self.input_pil
        # If we have output from bg removal, enhance that, else enhance input
        # But user might want to enhance input without bg removal -> use input
        # We'll enhance the chosen src
        w = EnhanceWorker(
            src,
            scale=self.get_scale(),
            sharpen=self.get_sharpen(),
            denoise=self.chk_denoise.isChecked(),
            color_boost=self.chk_color.isChecked(),
        )
        w.progress.connect(self.status)
        w.finished.connect(self.on_enhance_done)
        w.error.connect(self.on_error)
        self.workers.append(w)
        w.finished.connect(lambda: self.workers.remove(w) if w in self.workers else None)
        w.start()

    def on_enhance_done(self, pil_img: Image.Image):
        self.output_pil = pil_img
        self.output_card.set_pil_image(pil_img, f"{pil_img.width}×{pil_img.height} • HD ✨")
        self.status(f"Quality tzadet ✅ — {pil_img.width}×{pil_img.height}")
        self.busy(False)

    def do_both(self):
        if not self.input_pil or not self.input_path:
            return
        self.busy(True)
        w = ComboWorker(
            str(self.input_path),
            scale=self.get_scale(),
            sharpen=self.get_sharpen(),
            denoise=self.chk_denoise.isChecked(),
            color_boost=self.chk_color.isChecked(),
            model=self.get_model(),
        )
        w.progress.connect(self.status)
        w.finished.connect(self.on_both_done)
        w.error.connect(self.on_error)
        self.workers.append(w)
        w.finished.connect(lambda: self.workers.remove(w) if w in self.workers else None)
        w.start()

    def on_both_done(self, pil_img: Image.Image):
        self.output_pil = pil_img
        self.output_card.set_pil_image(pil_img, f"{pil_img.width}×{pil_img.height} • BG mhayed + HD ✨")
        self.status(f"Kamel ✅ — {pil_img.width}×{pil_img.height} — Qabel l save 💾")
        self.busy(False)

    def on_error(self, msg):
        self.busy(False)
        self.status(f"Erreur ❌ — {msg[:80]}")
        QMessageBox.critical(self, "Erreur", f"Erreur f traitement:\n{msg}")

    def save_output(self):
        if not self.output_pil:
            QMessageBox.warning(self, "Aucune image", "Mazal madarti hta traitement — klick 'Hayed Background' loul!")
            return

        # Determine default name
        stem = self.input_path.stem if self.input_path else "neurio_output"
        fmt_idx = self.combo_format.currentIndex()
        ext_map = {0: ".png", 1: ".jpg", 2: ".webp"}
        default_ext = ext_map[fmt_idx]
        default_name = f"{stem}_neurio{default_ext}"

        fname, selected_filter = QFileDialog.getSaveFileName(
            self, "Hfed Natija — Save Result", str(Path.home() / default_name),
            "PNG transparent (*.png);;JPEG blanc (*.jpg *.jpeg);;WEBP optimisé (*.webp);;All (*.*)"
        )
        if not fname:
            return
        # Ensure correct extension based on selected filter or combo
        p = Path(fname)
        if p.suffix == "":
            p = p.with_suffix(default_ext)
            fname = str(p)

        # If user picked filter, respect it
        try:
            save_image_pil(self.output_pil, fname)
            self.status(f"Thfedat ✅ — {fname}")
            QMessageBox.information(self, "Thfedat ✅", f"Taswira thfedat:\n{fname}\n\n{self.output_pil.width}×{self.output_pil.height} px")
        except Exception as e:
            traceback.print_exc()
            QMessageBox.critical(self, "Erreur Save", str(e))

    def reset_all(self):
        self.input_path = None
        self.input_pil = None
        self.output_pil = None
        self.input_card.set_placeholder("📁\n\nJor taswira hna\nDrag & Drop\n\naw klick 'Khtar Taswira'")
        self.output_card.set_placeholder("✨\nNatija ghadi tban hna\nClick 'Hayed Background' aw 'Zid Quality'")
        self.status("Reset ✅ — Khtar taswira jdida")
        self.busy(False)
        # Disable action buttons until new input
        self.btn_remove.setEnabled(False)
        self.btn_enhance.setEnabled(False)
        self.btn_combo.setEnabled(False)
        self.btn_save.setEnabled(False)

    def show_help(self):
        QMessageBox.information(self, "Kifach tkhdem Neurio — Guide",
            "◆ NEURIO — Hayed Background + Zid Quality\n\n"
            "1️⃣ KHTAR TASWIRA: Click 'Khtar Taswira' aw jor fichier l lwindow (drag & drop)\n"
            "2️⃣ HAYED BACKGROUND: Kayhayed l'arrière-plan w kaykhlli ghir shakhs/objet — natija PNG transparent\n"
            "3️⃣ ZID QUALITY: Kaykebber taswira 2×/4×, kayn9iha (denoise), kayzid sharpness w lawn\n"
            "4️⃣ BJOUJ: Asra3 — kaydirhom bjouj f nafs lwa9t ⏳✨\n"
            "5️⃣ HFED: Khtar format PNG (transparent) / JPG / WEBP w hfed\n\n"
            "⚙️ Options:\n"
            "• Upscale: 1× (asli) / 2× HD / 4× Ultra\n"
            "• Sharpen: 0.5× tal 2.5× (1.35 recommended)\n"
            "• Denoise: kayn9i hab rqiq\n"
            "• Zid Lawn: auto color/contrast\n\n"
            "🧠 Models:\n"
            "• u2net — 3am, mzyan l kolchi\n"
            "• u2net_human_seg — special l bnadm\n"
            "• isnet — ahsan quality (t9il chwiya)\n\n"
            "💡 Tip: l awal marra, model kayt-téléchargi (176MB) — khelli internet.\n"
            "Melli t-télécharga, kaykhdem offline 100%!\n\n"
            "CLI: python app/main.py --cli input.jpg -o out.png --scale 2\n"
        )

def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    # App font — modern
    f = QFont("Segoe UI", 9)
    app.setFont(f)

    win = NeurioWindow()
    win.show()

    # Optional: auto-load image if passed as arg
    if len(sys.argv) > 1:
        p = Path(sys.argv[1])
        if p.exists() and p.suffix.lower() in (".png",".jpg",".jpeg",".webp",".bmp",".tiff"):
            QTimer.singleShot(300, lambda: win.load_image(p))

    sys.exit(app.exec())

if __name__ == "__main__":
    main()
