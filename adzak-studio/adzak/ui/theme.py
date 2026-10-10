from __future__ import annotations

DARK = """
QWidget { background: #1b1d22; color: #e6e8ee; font-size: 13px; }
QMainWindow, QDialog { background: #15171b; }
QMenuBar { background: #15171b; }
QMenuBar::item:selected, QMenu::item:selected { background: #2c3f66; }
QMenu { background: #1f2227; border: 1px solid #2f333b; }
QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background: #101216; border: 1px solid #343944; border-radius: 4px; padding: 4px; }
QPushButton { background: #2a2e37; border: 1px solid #3a404c; border-radius: 5px; padding: 6px 12px; }
QPushButton:hover { background: #343a46; }
QPushButton:disabled { color: #6b7180; }
QPushButton#primary { background: #3d6ee0; border-color: #4d7ef0; color: white; font-weight: 600; }
QPushButton#primary:hover { background: #4b7cf0; }
QListWidget, QTableWidget, QTreeWidget { background: #101216; border: 1px solid #2f333b; }
QListWidget::item:selected, QTableWidget::item:selected { background: #2c3f66; }
QTabWidget::pane { border: 1px solid #2f333b; }
QTabBar::tab { background: #1f2227; padding: 6px 12px; }
QTabBar::tab:selected { background: #2c3f66; }
QProgressBar { border: 1px solid #343944; border-radius: 4px; text-align: center; background: #101216; }
QProgressBar::chunk { background: #3d6ee0; }
QCheckBox::indicator, QRadioButton::indicator { width: 14px; height: 14px; }
QToolTip { background: #2a2e37; color: #e6e8ee; border: 1px solid #3a404c; }
QLabel#title { font-size: 20px; font-weight: 600; }
QLabel#muted { color: #8b93a3; }
QLabel#warn { color: #f0b429; }
QLabel#ok { color: #3ecf8e; }
QFrame#panel { background: #1f2227; border: 1px solid #2f333b; border-radius: 6px; }
QLineEdit#search { padding-left: 8px; }
"""

LIGHT = """
QWidget { background: #f4f5f8; color: #1d2430; font-size: 13px; }
QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QComboBox {
    background: #ffffff; border: 1px solid #c8ccd6; border-radius: 4px; padding: 4px; }
QPushButton { background: #ffffff; border: 1px solid #c8ccd6; border-radius: 5px; padding: 6px 12px; }
QPushButton#primary { background: #3d6ee0; color: white; border-color: #3d6ee0; font-weight: 600; }
QListWidget, QTableWidget { background: #ffffff; border: 1px solid #c8ccd6; }
QListWidget::item:selected, QTableWidget::item:selected { background: #cfdcf8; color: #1d2430; }
QLabel#title { font-size: 20px; font-weight: 600; }
QLabel#muted { color: #667085; }
QFrame#panel { background: #ffffff; border: 1px solid #d6dae3; border-radius: 6px; }
"""


def apply_theme(app, theme: str) -> None:
    app.setStyleSheet(LIGHT if theme == "light" else DARK)
