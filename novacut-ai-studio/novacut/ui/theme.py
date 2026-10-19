"""Dark professional theme: palette, stylesheet and icon helpers."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap

PALETTE = {
    "bg_0": "#0d1016",
    "bg_1": "#151a22",
    "bg_2": "#1c232e",
    "bg_3": "#252e3c",
    "border": "#313c4d",
    "text": "#e6ebf2",
    "text_dim": "#93a1b5",
    "accent": "#4f8cff",
    "accent_2": "#2f6fe0",
    "green": "#37c97f",
    "amber": "#f5a623",
    "red": "#e5484d",
    "purple": "#9b6dff",
    "track_v": "#2b4a7a",
    "track_a": "#2f6b4f",
}

QSS = """
* { font-family: 'Segoe UI', 'Inter', 'DejaVu Sans', sans-serif; font-size: 13px;
    color: %(text)s; outline: 0; }
QMainWindow, QDialog, QWidget#Root { background: %(bg_0)s; }
QToolTip { background: %(bg_3)s; color: %(text)s; border: 1px solid %(border)s;
    padding: 4px 6px; }
QMenuBar { background: %(bg_1)s; border-bottom: 1px solid %(border)s; padding: 2px; }
QMenuBar::item { background: transparent; padding: 6px 10px; border-radius: 6px; }
QMenuBar::item:selected { background: %(bg_3)s; }
QMenu { background: %(bg_2)s; border: 1px solid %(border)s; border-radius: 8px; padding: 6px; }
QMenu::item { padding: 6px 22px; border-radius: 6px; }
QMenu::item:selected { background: %(accent_2)s; }
QMenu::separator { height: 1px; background: %(border)s; margin: 6px; }
QToolBar { background: %(bg_1)s; border: none; border-bottom: 1px solid %(border)s;
    spacing: 4px; padding: 4px; }
QStatusBar { background: %(bg_1)s; border-top: 1px solid %(border)s; color: %(text_dim)s; }
QDockWidget { titlebar-close-icon: none; titlebar-normal-icon: none; }
QDockWidget::title { background: %(bg_1)s; padding: 6px 10px;
    border-bottom: 1px solid %(border)s; font-weight: 600; }
QFrame#Panel { background: %(bg_1)s; border: 1px solid %(border)s; border-radius: 10px; }
QListWidget, QTreeWidget, QTableWidget, QComboBox, QLineEdit, QTextEdit,
QPlainTextEdit, QSpinBox, QDoubleSpinBox {
    background: %(bg_2)s; border: 1px solid %(border)s; border-radius: 8px;
    padding: 5px 8px; selection-background-color: %(accent_2)s; }
QListWidget::item { padding: 6px; border-radius: 6px; }
QListWidget::item:selected { background: %(accent_2)s; }
QHeaderView::section { background: %(bg_2)s; color: %(text_dim)s;
    border: none; border-bottom: 1px solid %(border)s; padding: 6px; }
QPushButton { background: %(bg_3)s; border: 1px solid %(border)s;
    border-radius: 8px; padding: 7px 14px; }
QPushButton:hover { background: %(accent_2)s; border-color: %(accent)s; }
QPushButton:disabled { color: %(text_dim)s; background: %(bg_2)s; }
QPushButton#Primary { background: %(accent)s; border: none; font-weight: 600; }
QPushButton#Primary:hover { background: %(accent_2)s; }
QProgressBar { background: %(bg_2)s; border: 1px solid %(border)s;
    border-radius: 8px; height: 14px; text-align: center; color: white; }
QProgressBar::chunk { background: %(accent)s; border-radius: 7px; }
QSlider::groove:horizontal { height: 4px; background: %(bg_3)s; border-radius: 2px; }
QSlider::sub-page:horizontal { background: %(accent)s; border-radius: 2px; }
QSlider::handle:horizontal { background: white; width: 14px; height: 14px;
    margin: -6px 0; border-radius: 7px; }
QTabWidget::pane { border: 1px solid %(border)s; border-radius: 10px;
    background: %(bg_1)s; }
QTabBar::tab { background: %(bg_2)s; padding: 8px 16px; border-radius: 8px 8px 0 0;
    margin-right: 2px; color: %(text_dim)s; }
QTabBar::tab:selected { background: %(bg_1)s; color: %(text)s; font-weight: 600; }
QScrollBar:vertical { background: transparent; width: 10px; margin: 2px; }
QScrollBar::handle:vertical { background: %(bg_3)s; border-radius: 5px; min-height: 30px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; }
QScrollBar:horizontal { background: transparent; height: 10px; margin: 2px; }
QScrollBar::handle:horizontal { background: %(bg_3)s; border-radius: 5px; min-width: 30px; }
QCheckBox::indicator { width: 16px; height: 16px; border-radius: 4px;
    border: 1px solid %(border)s; background: %(bg_2)s; }
QCheckBox::indicator:checked { background: %(accent)s; border-color: %(accent)s; }
QGroupBox { border: 1px solid %(border)s; border-radius: 10px; margin-top: 12px;
    padding: 10px; font-weight: 600; }
QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 5px; }
QLabel#H1 { font-size: 18px; font-weight: 700; }
QLabel#H2 { font-size: 14px; font-weight: 600; color: %(text)s; }
QLabel#Dim { color: %(text_dim)s; }
QToolButton { background: transparent; border-radius: 8px; padding: 6px; }
QToolButton:hover { background: %(bg_3)s; }
QToolButton:checked { background: %(accent_2)s; }
""" % PALETTE


def make_icon(glyph: str, color: str = PALETTE["text"], size: int = 20) -> QIcon:
    """Draw simple glyph-based icons (no external icon dependency)."""
    pix = QPixmap(size, size)
    pix.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pix)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setPen(QColor(color))
    font = painter.font()
    font.setPixelSize(int(size * 0.75))
    painter.setFont(font)
    painter.drawText(pix.rect(), Qt.AlignmentFlag.AlignCenter, glyph)
    painter.end()
    return QIcon(pix)
