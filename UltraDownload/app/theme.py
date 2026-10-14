BASE = """
QWidget { background: #101218; color: #e9edf6; font-family: 'Segoe UI'; font-size: 13px; }
QMainWindow, QDialog { background: #101218; }
QLabel { background: transparent; }
QLabel#muted { color: #8f9aad; }
QLabel#eyebrow { color: #a9a0ff; font-size: 11px; font-weight: 700; }
QLabel#title { font-size: 29px; font-weight: 700; }
QLabel#brand { font-size: 19px; font-weight: 700; }
QLabel#stat { font-size: 25px; font-weight: 600; }
QFrame#panel { background: #191c25; border: 1px solid #292e3b; border-radius: 12px; }
QFrame#sidebar { background: #151820; border-right: 1px solid #292e3b; }
QPushButton { background: #232836; border: 1px solid #343b4d; border-radius: 7px; padding: 9px 14px; font-weight: 600; }
QPushButton:hover { background: #30374a; border-color: #657092; }
QPushButton:pressed { background: #3c4360; }
QPushButton:disabled { color: #687186; background: #1b1e28; border-color: #272c39; }
QPushButton#primary { background: #7c6aef; border-color: #9281ff; color: white; }
QPushButton#primary:hover { background: #8c7cf9; }
QPushButton#nav { text-align: left; border: none; background: transparent; padding: 12px 16px; color: #aeb7c8; }
QPushButton#nav:checked { color: #d3ccff; background: #292440; border-left: 3px solid #9c8dff; }
QPushButton#nav:hover { background: #252938; }
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox { background: #10141d; border: 1px solid #343b4d; border-radius: 6px; padding: 9px; selection-background-color: #6654c5; }
QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus { border: 1px solid #9587ff; }
QTableView { background: #161922; alternate-background-color: #1b1f29; border: 1px solid #2b3140; border-radius: 8px; gridline-color: #262c3a; selection-background-color: #302a4e; selection-color: #fff; }
QTableView::item { padding: 8px; border-bottom: 1px solid #262b38; }
QHeaderView::section { background: #1f2430; color: #9aa5bb; padding: 11px 8px; border: none; font-size: 11px; font-weight: 600; }
QTableCornerButton::section { background: #1f2430; border: none; }
QProgressBar { border: none; background: #2b3142; border-radius: 4px; min-height: 8px; max-height: 8px; text-align: center; }
QProgressBar::chunk { background: #9381ff; border-radius: 4px; }
QCheckBox { spacing: 8px; background: transparent; }
QCheckBox::indicator { width: 16px; height: 16px; }
QScrollBar:vertical { background: #171b25; width: 9px; border: none; }
QScrollBar::handle:vertical { background: #42495e; border-radius: 4px; min-height: 24px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QToolTip { background: #2a3040; color: white; border: 1px solid #525d79; padding: 6px; }
QStatusBar { background: #151820; color: #8f9aad; border-top: 1px solid #292e3b; }
QScrollArea { border: none; }
QMessageBox QLabel { min-width: 280px; }
"""


def stylesheet(theme="Midnight"):
    return (
        BASE
        if theme == "Midnight"
        else BASE.replace("#7c6aef", "#326db3")
        .replace("#9381ff", "#69adf5")
        .replace("#a9a0ff", "#83b8f2")
        .replace("#d3ccff", "#c9e2ff")
    )
