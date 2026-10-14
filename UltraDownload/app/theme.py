from PySide6.QtGui import QPalette, QColor


def apply_theme(app, name='Midnight'):
    accent = '#9381ff' if name == 'Midnight' else '#5caaff'
    app.setStyle('Fusion')
    palette = QPalette()
    for role, color in [(QPalette.Window, '#101217'), (QPalette.WindowText, '#edf0f7'),
                        (QPalette.Base, '#171a22'), (QPalette.Text, '#edf0f7'),
                        (QPalette.Button, '#242938'), (QPalette.ButtonText, '#edf0f7'),
                        (QPalette.Highlight, '#353057'), (QPalette.HighlightedText, '#ffffff'),
                        (QPalette.ToolTipBase, '#242938'), (QPalette.ToolTipText, '#edf0f7')]:
        palette.setColor(role, QColor(color))
    app.setPalette(palette)
    app.setStyleSheet('''
        QWidget { font-family: "Segoe UI", "Inter", sans-serif; font-size: 13px; color: #e9edf7; }
        QMainWindow, QDialog { background: #101217; }
        QLabel#muted { color: #8d97ac; }
        QLabel#title { font-size: 27px; font-weight: 700; }
        QLabel#brand { font-size: 20px; font-weight: 700; }
        QLabel#metric { font-size: 24px; font-weight: 650; }
        QFrame#panel { background: #191c25; border: 1px solid #292e3c; border-radius: 12px; }
        QFrame#sidebar { background: #14171e; border-right: 1px solid #252a35; }
        QPushButton { background: #242938; border: 1px solid #343b4e; border-radius: 7px; padding: 9px 15px; }
        QPushButton:hover { background: #30374a; border-color: ACCENT; }
        QPushButton:pressed { background: #3d365c; }
        QPushButton:disabled { color: #697183; border-color: #282d3a; background: #1a1e27; }
        QPushButton#primary { background: ACCENT; color: #11131a; border: none; font-weight: 700; }
        QPushButton#nav { background: transparent; border: none; text-align: left; padding: 13px 17px; }
        QPushButton#nav:checked { background: #2a263f; color: ACCENT; }
        QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox { background: #151922; border: 1px solid #363d50; border-radius: 6px; padding: 9px; selection-background-color: #514675; }
        QLineEdit:focus { border-color: ACCENT; }
        QTableView { background: #171a22; alternate-background-color: #1a1e27; border: none; gridline-color: #272d3a; selection-background-color: #29253f; }
        QHeaderView::section { background: #191d27; color: #919db4; border: none; border-bottom: 1px solid #2d3341; padding: 11px 8px; text-align: left; }
        QProgressBar { border: none; background: #2a2f3e; height: 7px; border-radius: 3px; color: transparent; }
        QProgressBar::chunk { background: ACCENT; border-radius: 3px; }
        QScrollBar:vertical { background: #151922; width: 9px; }
        QScrollBar::handle:vertical { background: #3b4356; border-radius: 4px; min-height: 25px; }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        QToolTip { background: #242938; color: #edf0f7; border: 1px solid #444c62; padding: 6px; }
        QCheckBox { spacing: 9px; padding: 5px; }
    '''.replace('ACCENT', accent))
