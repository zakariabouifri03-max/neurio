"""Dark / light theme styling (Qt stylesheet)."""

from __future__ import annotations

DARK = """
:root { color-scheme: dark; }
* { font-family: 'Segoe UI', 'Inter', sans-serif; }
QWidget { background: #1d1f24; color: #e6e8ee; font-size: 13px; }
QMainWindow, QDialog { background: #1d1f24; }
QMenuBar { background: #17181c; border-bottom: 1px solid #2a2d34; padding: 2px; }
QMenuBar::item:selected { background: #2f333c; border-radius: 4px; }
QMenu { background: #23262c; border: 1px solid #33373f; padding: 4px; }
QMenu::item { padding: 6px 24px; border-radius: 4px; }
QMenu::item:selected { background: #3b6ef5; color: white; }
QMenu::separator { height: 1px; background: #33373f; margin: 4px 8px; }
QPushButton { background: #2f333c; border: 1px solid #3a3f49; border-radius: 6px;
              padding: 6px 14px; }
QPushButton:hover { background: #383d47; }
QPushButton:pressed { background: #24272e; }
QPushButton:disabled { color: #6b7078; background: #23252b; }
QPushButton#primary { background: #3b6ef5; border: none; color: white; font-weight: 600; }
QPushButton#primary:hover { background: #4f7df8; }
QPushButton#danger { background: #b3372f; border: none; color: white; }
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QTextEdit, QPlainTextEdit {
    background: #14161a; border: 1px solid #33373f; border-radius: 6px;
    padding: 5px 8px; selection-background-color: #3b6ef5; }
QComboBox::drop-down { border: none; width: 22px; }
QComboBox QAbstractItemView { background: #23262c; border: 1px solid #33373f; }
QCheckBox { spacing: 8px; }
QCheckBox::indicator, QRadioButton::indicator { width: 16px; height: 16px;
    border: 1px solid #4a4f59; border-radius: 4px; background: #14161a; }
QCheckBox::indicator:checked { background: #3b6ef5; border-color: #3b6ef5; }
QTabWidget::pane { border: 1px solid #2a2d34; border-radius: 6px; background: #1d1f24; }
QTabBar::tab { background: #23262c; padding: 7px 16px; border-top-left-radius: 6px;
               border-top-right-radius: 6px; margin-right: 2px; color: #aab0bb; }
QTabBar::tab:selected { background: #2f333c; color: white; }
QTreeWidget, QTableWidget, QListWidget, QListView {
    background: #17181c; border: 1px solid #2a2d34; border-radius: 6px;
    alternate-background-color: #1b1d22; }
QHeaderView::section { background: #23262c; padding: 5px; border: none;
                       border-bottom: 1px solid #33373f; color: #aab0bb; }
QScrollBar:vertical { background: #17181c; width: 12px; }
QScrollBar::handle:vertical { background: #3a3f49; border-radius: 5px; min-height: 30px; }
QScrollBar::handle:horizontal { background: #3a3f49; border-radius: 5px; min-width: 30px; }
QScrollBar:horizontal { background: #17181c; height: 12px; }
QScrollBar::add-line, QScrollBar::sub-line { height: 0; width: 0; }
QProgressBar { background: #14161a; border: 1px solid #33373f; border-radius: 6px;
               text-align: center; color: #e6e8ee; height: 18px; }
QProgressBar::chunk { background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
    stop:0 #3b6ef5, stop:1 #7a5cf0); border-radius: 5px; }
QSlider::groove:horizontal { height: 5px; background: #33373f; border-radius: 2px; }
QSlider::handle:horizontal { width: 14px; height: 14px; margin: -5px 0;
    background: #3b6ef5; border-radius: 7px; }
QGroupBox { border: 1px solid #2a2d34; border-radius: 8px; margin-top: 12px;
            padding-top: 6px; font-weight: 600; }
QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #aab0bb; }
QStatusBar { background: #17181c; color: #aab0bb; }
QToolTip { background: #23262c; color: #e6e8ee; border: 1px solid #3b6ef5; padding: 4px 8px; }
QSplitter::handle { background: #2a2d34; }
QLabel#sidebar-title { font-size: 15px; font-weight: 700; color: white; }
QLabel#hint { color: #8a909c; font-size: 12px; }
QLabel#badge-local { color: #58c470; font-weight: 600; }
QLabel#badge-api { color: #e0a63f; font-weight: 600; }
QLabel#badge-unavailable { color: #8a909c; font-weight: 600; }
QLabel#badge-free { color: #6fb3f0; font-weight: 600; }
"""

LIGHT = """
* { font-family: 'Segoe UI', 'Inter', sans-serif; }
QWidget { background: #f4f5f7; color: #22252b; font-size: 13px; }
QMenuBar { background: #ffffff; border-bottom: 1px solid #dcdfe5; padding: 2px; }
QMenuBar::item:selected { background: #e8ebf1; border-radius: 4px; }
QMenu { background: #ffffff; border: 1px solid #dcdfe5; padding: 4px; }
QMenu::item { padding: 6px 24px; border-radius: 4px; }
QMenu::item:selected { background: #3b6ef5; color: white; }
QPushButton { background: #ffffff; border: 1px solid #cfd4dd; border-radius: 6px;
              padding: 6px 14px; }
QPushButton:hover { background: #eef1f6; }
QPushButton#primary { background: #3b6ef5; border: none; color: white; font-weight: 600; }
QPushButton#primary:hover { background: #4f7df8; }
QPushButton#danger { background: #c0392b; border: none; color: white; }
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QTextEdit, QPlainTextEdit {
    background: #ffffff; border: 1px solid #cfd4dd; border-radius: 6px; padding: 5px 8px; }
QTreeWidget, QTableWidget, QListView, QListWidget {
    background: #ffffff; border: 1px solid #dcdfe5; border-radius: 6px; }
QHeaderView::section { background: #eef1f6; padding: 5px; border: none;
                       border-bottom: 1px solid #dcdfe5; }
QProgressBar { background: #e8ebf1; border-radius: 6px; text-align: center; height: 18px; }
QProgressBar::chunk { background: #3b6ef5; border-radius: 5px; }
QGroupBox { border: 1px solid #dcdfe5; border-radius: 8px; margin-top: 12px; padding-top: 6px; }
QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #555b66; }
QStatusBar { background: #ffffff; color: #555b66; }
QLabel#hint { color: #6a7080; font-size: 12px; }
"""


def stylesheet(theme: str) -> str:
    return DARK if theme == "dark" else LIGHT
