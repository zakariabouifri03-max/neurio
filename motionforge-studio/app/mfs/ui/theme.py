"""Dark professional theme + generated vector icons (no image files needed)."""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QColor, QFont, QFontDatabase, QIcon, QLinearGradient, QPainter,
                           QPainterPath, QPen, QPixmap, QPolygonF)

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------
class C:
    bg = "#15171f"
    bg_alt = "#191c25"
    panel = "#1d212c"
    panel_alt = "#222633"
    panel_high = "#2a3040"
    border = "#2c3140"
    border_light = "#3a4157"
    text = "#e6e9f2"
    text_dim = "#9aa3b8"
    text_faint = "#6b7488"
    accent = "#4f8cff"
    accent_dim = "#3568c9"
    accent_soft = "#1f2c4a"
    good = "#3ddc97"
    warn = "#ffcc66"
    bad = "#ff6b6b"
    timeline_bg = "#171a23"
    timeline_row = "#1b1f2a"
    timeline_row_alt = "#1f2430"
    timeline_key = "#ffd166"
    timeline_playhead = "#ff5c7a"
    canvas_bg = "#0f1116"
    onion_prev = "#ff5c7a"
    onion_next = "#42d9a0"
    bone = "#ffb347"
    bone_ik = "#ff6b6b"
    selection = "#4f8cff"


def base_font() -> QFont:
    for name in ("Segoe UI Variable", "Segoe UI", "Inter", "DejaVu Sans", "Noto Sans"):
        if name in QFontDatabase.families():
            f = QFont(name, 9)
            f.setHintingPreference(QFont.PreferFullHinting)
            return f
    return QFont("sans-serif", 9)


MONO_FONT = "Consolas"


def stylesheet(dense: bool = False) -> str:
    pad = "4px" if dense else "6px"
    return f"""
    QWidget {{
        background: {C.bg};
        color: {C.text};
        font-family: "Segoe UI", "Inter", "Noto Sans", sans-serif;
        font-size: 12px;
    }}
    QMainWindow, QDialog {{ background: {C.bg}; }}
    QMenuBar {{ background: {C.bg_alt}; color: {C.text}; border-bottom: 1px solid {C.border}; }}
    QMenuBar::item {{ padding: 5px 10px; background: transparent; }}
    QMenuBar::item:selected {{ background: {C.accent_soft}; border-radius: 4px; }}
    QMenu {{ background: {C.panel}; border: 1px solid {C.border}; padding: 5px; }}
    QMenu::item {{ padding: 5px 24px 5px 22px; border-radius: 4px; }}
    QMenu::item:selected {{ background: {C.accent_soft}; }}
    QMenu::separator {{ height: 1px; background: {C.border}; margin: 4px 8px; }}

    QToolBar {{ background: {C.bg_alt}; border: 0px; border-bottom: 1px solid {C.border};
                padding: 3px; spacing: 3px; }}
    QToolButton {{ background: transparent; border: 1px solid transparent; border-radius: 6px;
                   padding: 5px; color: {C.text_dim}; }}
    QToolButton:hover {{ background: {C.panel_high}; color: {C.text}; }}
    QToolButton:checked {{ background: {C.accent_soft}; border-color: {C.accent}; color: {C.text}; }}
    QToolButton:disabled {{ color: {C.text_faint}; }}

    QPushButton {{ background: {C.panel_alt}; border: 1px solid {C.border}; border-radius: 6px;
                   padding: {pad} 12px; color: {C.text}; }}
    QPushButton:hover {{ background: {C.panel_high}; border-color: {C.border_light}; }}
    QPushButton:pressed {{ background: {C.accent_soft}; border-color: {C.accent}; }}
    QPushButton:checked {{ background: {C.accent_soft}; border-color: {C.accent}; }}
    QPushButton:disabled {{ color: {C.text_faint}; background: {C.bg_alt}; }}
    QPushButton#primary {{ background: {C.accent}; border-color: {C.accent}; color: #ffffff;
                           font-weight: 600; }}
    QPushButton#primary:hover {{ background: #6a9dff; }}
    QPushButton#danger:hover {{ background: #40232b; border-color: {C.bad}; }}

    QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {{
        background: {C.bg_alt}; border: 1px solid {C.border}; border-radius: 6px;
        padding: {pad}; selection-background-color: {C.accent};
    }}
    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus, QSpinBox:focus,
    QDoubleSpinBox:focus, QComboBox:focus {{ border-color: {C.accent}; }}
    QComboBox::drop-down {{ border: 0px; width: 18px; }}
    QComboBox QAbstractItemView {{ background: {C.panel}; border: 1px solid {C.border};
                                   selection-background-color: {C.accent_soft}; }}
    QSpinBox::up-button, QSpinBox::down-button, QDoubleSpinBox::up-button,
    QDoubleSpinBox::down-button {{ width: 14px; background: {C.panel_alt}; border: 0px; }}

    QCheckBox, QRadioButton {{ spacing: 6px; }}
    QCheckBox::indicator, QRadioButton::indicator {{ width: 14px; height: 14px;
        border: 1px solid {C.border_light}; border-radius: 3px; background: {C.bg_alt}; }}
    QCheckBox::indicator:checked {{ background: {C.accent}; border-color: {C.accent}; }}
    QRadioButton::indicator {{ border-radius: 7px; }}
    QRadioButton::indicator:checked {{ background: {C.accent}; border-color: {C.accent}; }}

    QSlider::groove:horizontal {{ height: 4px; background: {C.panel_high}; border-radius: 2px; }}
    QSlider::handle:horizontal {{ background: {C.accent}; width: 12px; margin: -5px 0;
                                  border-radius: 6px; }}
    QSlider::sub-page:horizontal {{ background: {C.accent_dim}; border-radius: 2px; }}

    QTabWidget::pane {{ border: 1px solid {C.border}; border-radius: 6px; background: {C.panel}; }}
    QTabBar::tab {{ background: {C.bg_alt}; color: {C.text_dim}; padding: 6px 12px; margin-right: 2px;
                    border-top-left-radius: 6px; border-top-right-radius: 6px; }}
    QTabBar::tab:selected {{ background: {C.panel}; color: {C.text}; border-bottom: 2px solid {C.accent}; }}
    QTabBar::tab:hover {{ background: {C.panel_alt}; }}

    QListWidget, QTreeWidget, QTableWidget, QListView, QTreeView {{
        background: {C.panel}; border: 1px solid {C.border}; border-radius: 6px;
        alternate-background-color: {C.panel_alt}; outline: none;
    }}
    QListWidget::item, QTreeWidget::item, QTableWidget::item {{ padding: 4px 6px; border-radius: 4px; }}
    QListWidget::item:selected, QTreeWidget::item:selected, QTableWidget::item:selected {{
        background: {C.accent_soft}; color: {C.text}; }}
    QListWidget::item:hover, QTreeWidget::item:hover {{ background: {C.panel_high}; }}
    QHeaderView::section {{ background: {C.bg_alt}; color: {C.text_dim}; padding: 5px;
                            border: 0px; border-right: 1px solid {C.border};
                            border-bottom: 1px solid {C.border}; }}

    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 0; }}
    QScrollBar::handle:vertical {{ background: {C.panel_high}; border-radius: 5px; min-height: 24px; }}
    QScrollBar::handle:vertical:hover {{ background: {C.border_light}; }}
    QScrollBar:horizontal {{ background: transparent; height: 10px; }}
    QScrollBar::handle:horizontal {{ background: {C.panel_high}; border-radius: 5px; min-width: 24px; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

    QSplitter::handle {{ background: {C.border}; }}
    QSplitter::handle:horizontal {{ width: 2px; }}
    QSplitter::handle:vertical {{ height: 2px; }}
    QSplitter::handle:hover {{ background: {C.accent_dim}; }}

    QDockWidget {{ titlebar-close-icon: none; titlebar-normal-icon: none; }}
    QDockWidget::title {{ background: {C.bg_alt}; padding: 6px; border-bottom: 1px solid {C.border}; }}

    QProgressBar {{ background: {C.bg_alt}; border: 1px solid {C.border}; border-radius: 6px;
                    text-align: center; color: {C.text}; height: 16px; }}
    QProgressBar::chunk {{ background: {C.accent}; border-radius: 5px; }}

    QGroupBox {{ border: 1px solid {C.border}; border-radius: 6px; margin-top: 10px; padding-top: 6px; }}
    QGroupBox::title {{ subcontrol-origin: margin; left: 8px; padding: 0 4px;
                        color: {C.text_dim}; }}
    QToolTip {{ background: {C.panel_high}; color: {C.text}; border: 1px solid {C.border_light};
                padding: 4px 6px; border-radius: 4px; }}
    QStatusBar {{ background: {C.bg_alt}; color: {C.text_dim}; border-top: 1px solid {C.border}; }}
    QStatusBar::item {{ border: 0px; }}
    QLabel#hint {{ color: {C.text_faint}; font-size: 11px; }}
    QLabel#section {{ color: {C.text_dim}; font-weight: 600; text-transform: uppercase;
                      font-size: 10px; letter-spacing: 1px; }}
    QLabel#title {{ font-size: 15px; font-weight: 700; }}
    QFrame#card {{ background: {C.panel}; border: 1px solid {C.border}; border-radius: 8px; }}
    """


# --------------------------------------------------------------------------
# icons (drawn on the fly - crisp at every DPI, no external files)
# --------------------------------------------------------------------------
def _icon_pixmap(name: str, size: int = 24, color: str = C.text) -> QPixmap:
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing, True)
    s = size
    ink = QColor(color)
    pen = QPen(ink, max(1.4, s * 0.075), Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin)
    p.setPen(pen)
    p.setBrush(Qt.NoBrush)
    m = s * 0.18

    if name == "select":
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        poly = QPolygonF([QPointF(s * 0.28, s * 0.14), QPointF(s * 0.28, s * 0.78),
                          QPointF(s * 0.44, s * 0.63), QPointF(s * 0.56, s * 0.88),
                          QPointF(s * 0.68, s * 0.82), QPointF(s * 0.56, s * 0.58),
                          QPointF(s * 0.76, s * 0.55)])
        p.drawPolygon(poly)
    elif name in ("brush", "pencil", "ink", "marker", "soft", "airbrush", "charcoal"):
        p.drawLine(QPointF(s * 0.2, s * 0.8), QPointF(s * 0.62, s * 0.28))
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        tip = QPolygonF([QPointF(s * 0.16, s * 0.7), QPointF(s * 0.2, s * 0.86),
                         QPointF(s * 0.36, s * 0.82)])
        p.drawPolygon(tip)
        p.setPen(pen)
        p.drawLine(QPointF(s * 0.58, s * 0.24), QPointF(s * 0.78, s * 0.42))
        if name in ("soft", "airbrush"):
            p.setPen(QPen(ink, max(1.0, s * 0.05)))
            for r, alpha in ((0.86, 60), (0.72, 40)):
                c = QColor(ink)
                c.setAlpha(alpha)
                p.setPen(QPen(c, max(1.0, s * 0.05)))
                p.drawArc(QRectF(s * (0.5 - r / 2 + 0.28), s * (0.5 - r / 2 + 0.28), s * r, s * r),
                          -40 * 16, 90 * 16)
    elif name == "eraser":
        p.setBrush(QColor(ink.red(), ink.green(), ink.blue(), 40))
        p.drawRoundedRect(QRectF(s * 0.2, s * 0.36, s * 0.6, s * 0.4), s * 0.08, s * 0.08)
        p.drawLine(QPointF(s * 0.2, s * 0.66), QPointF(s * 0.8, s * 0.66))
        p.drawLine(QPointF(s * 0.32, s * 0.76), QPointF(s * 0.68, s * 0.76))
    elif name == "fill":
        path = QPainterPath()
        path.moveTo(s * 0.24, s * 0.5)
        path.lineTo(s * 0.5, s * 0.24)
        path.lineTo(s * 0.78, s * 0.52)
        path.lineTo(s * 0.52, s * 0.78)
        path.closeSubpath()
        p.setBrush(QColor(ink.red(), ink.green(), ink.blue(), 70))
        p.drawPath(path)
        p.setBrush(ink)
        c = QColor(ink)
        c.setAlpha(120)
        p.setBrush(c)
        p.drawEllipse(QPointF(s * 0.8, s * 0.78), s * 0.1, s * 0.14)
    elif name == "shape":
        p.drawRect(QRectF(s * 0.18, s * 0.26, s * 0.42, s * 0.42))
        p.drawEllipse(QRectF(s * 0.42, s * 0.42, s * 0.42, s * 0.42))
    elif name == "text":
        p.drawLine(QPointF(s * 0.24, s * 0.26), QPointF(s * 0.76, s * 0.26))
        p.drawLine(QPointF(s * 0.5, s * 0.26), QPointF(s * 0.5, s * 0.78))
        p.drawLine(QPointF(s * 0.36, s * 0.78), QPointF(s * 0.64, s * 0.78))
    elif name == "transform":
        p.drawRect(QRectF(s * 0.26, s * 0.26, s * 0.48, s * 0.48))
        p.setBrush(ink)
        for x, y in ((0.26, 0.26), (0.74, 0.26), (0.26, 0.74), (0.74, 0.74), (0.5, 0.5)):
            p.drawEllipse(QPointF(s * x, s * y), s * 0.055, s * 0.055)
    elif name == "bone":
        p.drawLine(QPointF(s * 0.22, s * 0.78), QPointF(s * 0.5, s * 0.5))
        p.drawLine(QPointF(s * 0.5, s * 0.5), QPointF(s * 0.78, s * 0.28))
        p.setBrush(ink)
        for x, y in ((0.22, 0.78), (0.5, 0.5), (0.78, 0.28)):
            p.drawEllipse(QPointF(s * x, s * y), s * 0.07, s * 0.07)
    elif name == "hand":
        p.setBrush(QColor(ink.red(), ink.green(), ink.blue(), 60))
        p.drawRoundedRect(QRectF(s * 0.28, s * 0.42, s * 0.44, s * 0.4), s * 0.1, s * 0.1)
        for i in range(3):
            p.drawRoundedRect(QRectF(s * (0.3 + i * 0.13), s * 0.2, s * 0.1, s * 0.3),
                              s * 0.05, s * 0.05)
    elif name == "zoom":
        p.drawEllipse(QRectF(s * 0.2, s * 0.2, s * 0.42, s * 0.42))
        p.drawLine(QPointF(s * 0.6, s * 0.6), QPointF(s * 0.82, s * 0.82))
        p.drawLine(QPointF(s * 0.3, s * 0.41), QPointF(s * 0.52, s * 0.41))
        p.drawLine(QPointF(s * 0.41, s * 0.3), QPointF(s * 0.41, s * 0.52))
    elif name == "eyedropper":
        p.drawLine(QPointF(s * 0.26, s * 0.78), QPointF(s * 0.62, s * 0.4))
        p.drawRoundedRect(QRectF(s * 0.56, s * 0.2, s * 0.24, s * 0.24), s * 0.05, s * 0.05)
    elif name in ("play", "pause", "stop", "first", "last", "prev", "next", "loop"):
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        if name == "play":
            p.drawPolygon(QPolygonF([QPointF(s * 0.3, s * 0.22), QPointF(s * 0.8, s * 0.5),
                                     QPointF(s * 0.3, s * 0.78)]))
        elif name == "pause":
            p.drawRect(QRectF(s * 0.28, s * 0.24, s * 0.14, s * 0.52))
            p.drawRect(QRectF(s * 0.58, s * 0.24, s * 0.14, s * 0.52))
        elif name == "stop":
            p.drawRoundedRect(QRectF(s * 0.28, s * 0.28, s * 0.44, s * 0.44), s * 0.06, s * 0.06)
        elif name == "first":
            p.drawRect(QRectF(s * 0.24, s * 0.22, s * 0.1, s * 0.56))
            p.drawPolygon(QPolygonF([QPointF(s * 0.78, s * 0.24), QPointF(s * 0.38, s * 0.5),
                                     QPointF(s * 0.78, s * 0.76)]))
        elif name == "last":
            p.drawRect(QRectF(s * 0.66, s * 0.22, s * 0.1, s * 0.56))
            p.drawPolygon(QPolygonF([QPointF(s * 0.22, s * 0.24), QPointF(s * 0.62, s * 0.5),
                                     QPointF(s * 0.22, s * 0.76)]))
        elif name == "prev":
            p.drawPolygon(QPolygonF([QPointF(s * 0.7, s * 0.24), QPointF(s * 0.32, s * 0.5),
                                     QPointF(s * 0.7, s * 0.76)]))
        elif name == "next":
            p.drawPolygon(QPolygonF([QPointF(s * 0.3, s * 0.24), QPointF(s * 0.68, s * 0.5),
                                     QPointF(s * 0.3, s * 0.76)]))
        elif name == "loop":
            p.setBrush(Qt.NoBrush)
            p.setPen(pen)
            p.drawArc(QRectF(s * 0.2, s * 0.2, s * 0.6, s * 0.6), 30 * 16, 300 * 16)
            p.setBrush(ink)
            p.setPen(Qt.NoPen)
            p.drawPolygon(QPolygonF([QPointF(s * 0.68, s * 0.12), QPointF(s * 0.86, s * 0.26),
                                     QPointF(s * 0.66, s * 0.34)]))
    elif name == "layers":
        for i, y in enumerate((0.24, 0.44, 0.64)):
            p.setBrush(QColor(ink.red(), ink.green(), ink.blue(), 90 - i * 25))
            p.drawRoundedRect(QRectF(s * 0.2, s * y, s * 0.6, s * 0.16), s * 0.03, s * 0.03)
    elif name == "onion":
        p.setBrush(QColor(C.onion_prev))
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(s * 0.32, s * 0.5), s * 0.09, s * 0.09)
        p.setBrush(ink)
        p.drawEllipse(QPointF(s * 0.5, s * 0.5), s * 0.12, s * 0.12)
        p.setBrush(QColor(C.onion_next))
        p.drawEllipse(QPointF(s * 0.68, s * 0.5), s * 0.09, s * 0.09)
    elif name == "ai":
        p.setPen(QPen(QColor(C.accent), max(1.4, s * 0.08), Qt.SolidLine, Qt.RoundCap))
        p.drawLine(QPointF(s * 0.5, s * 0.18), QPointF(s * 0.5, s * 0.3))
        p.drawLine(QPointF(s * 0.22, s * 0.5), QPointF(s * 0.34, s * 0.5))
        p.drawLine(QPointF(s * 0.66, s * 0.5), QPointF(s * 0.78, s * 0.5))
        p.drawLine(QPointF(s * 0.32, s * 0.32), QPointF(s * 0.4, s * 0.4))
        p.drawLine(QPointF(s * 0.68, s * 0.32), QPointF(s * 0.6, s * 0.4))
        p.setBrush(QColor(C.accent))
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(s * 0.5, s * 0.52), s * 0.14, s * 0.14)
        p.setBrush(QColor(C.good))
        p.drawEllipse(QPointF(s * 0.5, s * 0.22), s * 0.05, s * 0.05)
    elif name == "export":
        p.drawLine(QPointF(s * 0.5, s * 0.2), QPointF(s * 0.5, s * 0.6))
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygonF([QPointF(s * 0.36, s * 0.48), QPointF(s * 0.64, s * 0.48),
                                 QPointF(s * 0.5, s * 0.68)]))
        p.setPen(pen)
        p.setBrush(Qt.NoBrush)
        p.drawLine(QPointF(s * 0.24, s * 0.8), QPointF(s * 0.76, s * 0.8))
    elif name == "save":
        p.drawRoundedRect(QRectF(s * 0.2, s * 0.2, s * 0.6, s * 0.6), s * 0.06, s * 0.06)
        p.setBrush(ink)
        p.drawRect(QRectF(s * 0.32, s * 0.2, s * 0.36, s * 0.22))
        p.setBrush(Qt.NoBrush)
        p.drawRect(QRectF(s * 0.3, s * 0.56, s * 0.4, s * 0.24))
    elif name == "new":
        p.drawRoundedRect(QRectF(s * 0.22, s * 0.18, s * 0.56, s * 0.64), s * 0.06, s * 0.06)
        p.drawLine(QPointF(s * 0.5, s * 0.34), QPointF(s * 0.5, s * 0.66))
        p.drawLine(QPointF(s * 0.34, s * 0.5), QPointF(s * 0.66, s * 0.5))
    elif name == "open":
        p.drawPath(_folder_path(s))
    elif name == "settings":
        p.drawEllipse(QRectF(s * 0.32, s * 0.32, s * 0.36, s * 0.36))
        for i in range(6):
            import math
            a = i * math.pi / 3
            p.drawLine(QPointF(s * 0.5 + math.cos(a) * s * 0.24, s * 0.5 + math.sin(a) * s * 0.24),
                       QPointF(s * 0.5 + math.cos(a) * s * 0.38, s * 0.5 + math.sin(a) * s * 0.38))
    elif name == "graph":
        path = QPainterPath()
        path.moveTo(s * 0.18, s * 0.74)
        path.cubicTo(QPointF(s * 0.4, s * 0.74), QPointF(s * 0.42, s * 0.3), QPointF(s * 0.62, s * 0.3))
        path.cubicTo(QPointF(s * 0.78, s * 0.3), QPointF(s * 0.8, s * 0.6), QPointF(s * 0.86, s * 0.6))
        p.drawPath(path)
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(s * 0.18, s * 0.74), s * 0.05, s * 0.05)
        p.drawEllipse(QPointF(s * 0.86, s * 0.6), s * 0.05, s * 0.05)
    elif name == "record":
        p.setBrush(QColor(C.bad))
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(s * 0.5, s * 0.5), s * 0.26, s * 0.26)
    elif name == "eye":
        path = QPainterPath()
        path.moveTo(s * 0.16, s * 0.5)
        path.quadTo(QPointF(s * 0.5, s * 0.18), QPointF(s * 0.84, s * 0.5))
        path.quadTo(QPointF(s * 0.5, s * 0.82), QPointF(s * 0.16, s * 0.5))
        p.drawPath(path)
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        p.drawEllipse(QPointF(s * 0.5, s * 0.5), s * 0.1, s * 0.1)
    elif name == "eye_off":
        p.setPen(QPen(QColor(C.text_faint), max(1.4, s * 0.08)))
        path = QPainterPath()
        path.moveTo(s * 0.16, s * 0.5)
        path.quadTo(QPointF(s * 0.5, s * 0.18), QPointF(s * 0.84, s * 0.5))
        path.quadTo(QPointF(s * 0.5, s * 0.82), QPointF(s * 0.16, s * 0.5))
        p.drawPath(path)
        p.drawLine(QPointF(s * 0.22, s * 0.78), QPointF(s * 0.78, s * 0.22))
    elif name == "lock":
        p.drawRoundedRect(QRectF(s * 0.3, s * 0.46, s * 0.4, s * 0.34), s * 0.05, s * 0.05)
        p.drawArc(QRectF(s * 0.37, s * 0.24, s * 0.26, s * 0.3), 0, 180 * 16)
    elif name == "unlock":
        p.drawRoundedRect(QRectF(s * 0.3, s * 0.46, s * 0.4, s * 0.34), s * 0.05, s * 0.05)
        p.drawArc(QRectF(s * 0.26, s * 0.24, s * 0.26, s * 0.3), 30 * 16, 150 * 16)
    elif name == "add":
        p.drawLine(QPointF(s * 0.5, s * 0.24), QPointF(s * 0.5, s * 0.76))
        p.drawLine(QPointF(s * 0.24, s * 0.5), QPointF(s * 0.76, s * 0.5))
    elif name == "duplicate":
        p.drawRoundedRect(QRectF(s * 0.2, s * 0.2, s * 0.42, s * 0.42), s * 0.05, s * 0.05)
        p.drawRoundedRect(QRectF(s * 0.38, s * 0.38, s * 0.42, s * 0.42), s * 0.05, s * 0.05)
    elif name == "trash":
        p.drawLine(QPointF(s * 0.24, s * 0.3), QPointF(s * 0.76, s * 0.3))
        p.drawRoundedRect(QRectF(s * 0.3, s * 0.3, s * 0.4, s * 0.5), s * 0.05, s * 0.05)
        p.drawLine(QPointF(s * 0.42, s * 0.24), QPointF(s * 0.58, s * 0.24))
    elif name == "camera":
        p.drawRoundedRect(QRectF(s * 0.18, s * 0.32, s * 0.5, s * 0.4), s * 0.06, s * 0.06)
        p.setBrush(ink)
        p.drawPolygon(QPolygonF([QPointF(s * 0.7, s * 0.44), QPointF(s * 0.86, s * 0.34),
                                 QPointF(s * 0.86, s * 0.7), QPointF(s * 0.7, s * 0.6)]))
    elif name == "character":
        p.drawEllipse(QRectF(s * 0.34, s * 0.14, s * 0.32, s * 0.32))
        p.drawLine(QPointF(s * 0.5, s * 0.46), QPointF(s * 0.5, s * 0.72))
        p.drawLine(QPointF(s * 0.3, s * 0.56), QPointF(s * 0.7, s * 0.56))
        p.drawLine(QPointF(s * 0.5, s * 0.72), QPointF(s * 0.34, s * 0.9))
        p.drawLine(QPointF(s * 0.5, s * 0.72), QPointF(s * 0.66, s * 0.9))
    elif name == "keyframe":
        p.setBrush(ink)
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygonF([QPointF(s * 0.5, s * 0.2), QPointF(s * 0.8, s * 0.5),
                                 QPointF(s * 0.5, s * 0.8), QPointF(s * 0.2, s * 0.5)]))
    elif name == "grid":
        for i in range(1, 3):
            p.drawLine(QPointF(s * (0.2 + i * 0.2), s * 0.2), QPointF(s * (0.2 + i * 0.2), s * 0.8))
            p.drawLine(QPointF(s * 0.2, s * (0.2 + i * 0.2)), QPointF(s * 0.8, s * (0.2 + i * 0.2)))
    else:
        p.drawEllipse(QRectF(m, m, s - 2 * m, s - 2 * m))
    p.end()
    return pm


def _folder_path(s: float) -> QPainterPath:
    path = QPainterPath()
    path.moveTo(s * 0.16, s * 0.32)
    path.lineTo(s * 0.44, s * 0.32)
    path.lineTo(s * 0.5, s * 0.4)
    path.lineTo(s * 0.84, s * 0.4)
    path.lineTo(s * 0.8, s * 0.76)
    path.lineTo(s * 0.18, s * 0.76)
    path.closeSubpath()
    return path


def icon(name: str, color: str = C.text) -> QIcon:
    ic = QIcon()
    for size in (16, 20, 24, 32, 48):
        ic.addPixmap(_icon_pixmap(name, size, color))
    return ic


_ICON_CACHE: dict[tuple[str, str], QIcon] = {}


def get_icon(name: str, color: str = C.text) -> QIcon:
    key = (name, color)
    if key not in _ICON_CACHE:
        _ICON_CACHE[key] = icon(name, color)
    return _ICON_CACHE[key]


def app_icon() -> QIcon:
    """Application icon drawn procedurally (used for the .exe and window)."""
    ic = QIcon()
    for size in (16, 32, 48, 64, 128, 256):
        pm = QPixmap(size, size)
        pm.fill(Qt.transparent)
        p = QPainter(pm)
        p.setRenderHint(QPainter.Antialiasing, True)
        grad = QLinearGradient(0, 0, size, size)
        grad.setColorAt(0.0, QColor("#2b3a63"))
        grad.setColorAt(1.0, QColor("#141824"))
        p.setBrush(grad)
        p.setPen(Qt.NoPen)
        r = size * 0.22
        p.drawRoundedRect(QRectF(size * 0.04, size * 0.04, size * 0.92, size * 0.92), r, r)
        # film-strip / keyframe motif
        pen = QPen(QColor("#4f8cff"), max(1.5, size * 0.07), Qt.SolidLine, Qt.RoundCap)
        p.setPen(pen)
        p.drawLine(QPointF(size * 0.22, size * 0.66), QPointF(size * 0.5, size * 0.34))
        p.drawLine(QPointF(size * 0.5, size * 0.34), QPointF(size * 0.78, size * 0.58))
        p.setBrush(QColor("#ffd166"))
        p.setPen(Qt.NoPen)
        for x, y in ((0.22, 0.66), (0.5, 0.34), (0.78, 0.58)):
            p.drawEllipse(QPointF(size * x, size * y), size * 0.075, size * 0.075)
        p.setBrush(QColor("#3ddc97"))
        p.drawRoundedRect(QRectF(size * 0.2, size * 0.76, size * 0.6, size * 0.08),
                          size * 0.04, size * 0.04)
        p.end()
        ic.addPixmap(pm)
    return ic


def color_swatch(color: str, size: int = 16) -> QPixmap:
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing, True)
    p.setBrush(QColor(color))
    p.setPen(QPen(QColor(C.border_light), 1))
    p.drawRoundedRect(QRectF(0.5, 0.5, size - 1, size - 1), 3, 3)
    p.end()
    return pm
