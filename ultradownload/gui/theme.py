"""UltraDownload dark theme — charcoal surfaces, blue/purple accents."""

from __future__ import annotations

ACCENTS = {
    "blue": {
        "accent": "#4f8cff",
        "accent_hover": "#6ba1ff",
        "accent_press": "#3d74e0",
        "glow": "rgba(79, 140, 255, 0.35)",
    },
    "purple": {
        "accent": "#8b7cf6",
        "accent_hover": "#a394ff",
        "accent_press": "#7161e0",
        "glow": "rgba(139, 124, 246, 0.35)",
    },
}

THEMES = {
    "dark": {
        "bg": "#16181d",
        "bg_panel": "#1e222a",
        "bg_card": "#232833",
        "bg_input": "#2a303c",
        "bg_hover": "#2c3342",
        "border": "#323a49",
        "text": "#e8ecf4",
        "text_dim": "#9aa4b8",
        "text_faint": "#6b7488",
        "ok": "#3ddc84",
        "warn": "#ffb02e",
        "err": "#ff5c6c",
    },
    "midnight": {
        "bg": "#0d1117",
        "bg_panel": "#131922",
        "bg_card": "#1a2230",
        "bg_input": "#212b3b",
        "bg_hover": "#243044",
        "border": "#2b3750",
        "text": "#e6edf7",
        "text_dim": "#8b98ad",
        "text_faint": "#5d6b82",
        "ok": "#3ddc84",
        "warn": "#ffb02e",
        "err": "#ff6b7a",
    },
}

FONT_STACK = '"Segoe UI", "Noto Sans", "DejaVu Sans", sans-serif'


def build_qss(theme: str = "dark", accent: str = "blue") -> str:
    t = THEMES.get(theme, THEMES["dark"])
    a = ACCENTS.get(accent, ACCENTS["blue"])
    return f"""
* {{
    font-family: {FONT_STACK};
    font-size: 13px;
    color: {t["text"]};
}}
QMainWindow, QWidget#root {{
    background: {t["bg"]};
}}
QWidget#sidebar {{
    background: {t["bg_panel"]};
    border-right: 1px solid {t["border"]};
}}
QLabel#appTitle {{
    font-size: 20px;
    font-weight: 700;
    color: {t["text"]};
    padding: 8px 4px;
}}
QLabel#appSubtitle {{
    font-size: 11px;
    color: {t["text_faint"]};
    padding: 0 4px 12px 4px;
}}
QPushButton#navButton {{
    text-align: left;
    padding: 11px 16px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: {t["text_dim"]};
    font-size: 14px;
    margin: 2px 8px;
}}
QPushButton#navButton:hover {{
    background: {t["bg_hover"]};
    color: {t["text"]};
}}
QPushButton#navButton:checked {{
    background: {a["accent"]};
    color: white;
    font-weight: 600;
}}
QFrame#panel, QWidget#panel {{
    background: {t["bg_panel"]};
    border: 1px solid {t["border"]};
    border-radius: 14px;
}}
QWidget#card, QFrame#card {{
    background: {t["bg_card"]};
    border: 1px solid {t["border"]};
    border-radius: 12px;
}}
QLabel#pageTitle {{
    font-size: 22px;
    font-weight: 700;
}}
QLabel#sectionTitle {{
    font-size: 15px;
    font-weight: 600;
    color: {t["text"]};
}}
QLabel#statValue {{
    font-size: 24px;
    font-weight: 700;
    color: {a["accent"]};
}}
QLabel#statTitle {{
    font-size: 11px;
    color: {t["text_dim"]};
}}
QLabel#dim {{ color: {t["text_dim"]}; }}
QLabel#faint {{ color: {t["text_faint"]}; font-size: 11px; }}
QLabel#error {{ color: {t["err"]}; }}
QLabel#ok {{ color: {t["ok"]}; }}
QLabel#warn {{ color: {t["warn"]}; }}

QPushButton#primary {{
    background: {a["accent"]};
    color: white;
    border: none;
    border-radius: 10px;
    padding: 11px 22px;
    font-weight: 600;
    font-size: 14px;
}}
QPushButton#primary:hover {{ background: {a["accent_hover"]}; }}
QPushButton#primary:pressed {{ background: {a["accent_press"]}; }}
QPushButton#primary:disabled {{ background: {t["bg_input"]}; color: {t["text_faint"]}; }}

QPushButton#secondary, QPushButton#toolButton {{
    background: {t["bg_input"]};
    color: {t["text"]};
    border: 1px solid {t["border"]};
    border-radius: 10px;
    padding: 9px 16px;
}}
QPushButton#secondary:hover, QPushButton#toolButton:hover {{
    background: {t["bg_hover"]};
    border-color: {a["accent"]};
}}
QPushButton#secondary:disabled, QPushButton#toolButton:disabled {{
    color: {t["text_faint"]};
    background: {t["bg_panel"]};
}}
QPushButton#danger {{
    background: transparent;
    color: {t["err"]};
    border: 1px solid {t["err"]};
    border-radius: 10px;
    padding: 9px 16px;
}}
QPushButton#danger:hover {{ background: {t["err"]}; color: white; }}

QPushButton#smallTool {{
    background: {t["bg_input"]};
    border: 1px solid {t["border"]};
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
}}
QPushButton#smallTool:hover {{ background: {t["bg_hover"]}; }}

QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QPlainTextEdit, QTextEdit {{
    background: {t["bg_input"]};
    border: 1px solid {t["border"]};
    border-radius: 10px;
    padding: 9px 12px;
    selection-background-color: {a["accent"]};
    selection-color: white;
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus,
QPlainTextEdit:focus, QTextEdit:focus {{
    border: 1px solid {a["accent"]};
}}
QLineEdit:disabled, QComboBox:disabled, QSpinBox:disabled {{
    color: {t["text_faint"]};
}}
QComboBox::drop-down {{ border: none; width: 28px; }}
QComboBox::down-arrow {{
    image: none;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid {t["text_dim"]};
    margin-right: 12px;
}}
QComboBox QAbstractItemView {{
    background: {t["bg_card"]};
    border: 1px solid {t["border"]};
    selection-background-color: {a["accent"]};
    selection-color: white;
    border-radius: 8px;
    padding: 4px;
}}

QProgressBar {{
    background: {t["bg_input"]};
    border: none;
    border-radius: 6px;
    min-height: 12px;
    max-height: 12px;
    text-align: center;
    font-size: 10px;
    color: transparent;
}}
QProgressBar::chunk {{
    border-radius: 6px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 {a["accent"]}, stop:1 {a["accent_hover"]});
}}
QProgressBar#mini {{
    min-height: 6px;
    max-height: 6px;
    border-radius: 3px;
}}
QProgressBar#mini::chunk {{ border-radius: 3px; }}
QProgressBar#big {{
    min-height: 16px;
    max-height: 16px;
    border-radius: 8px;
}}
QProgressBar#big::chunk {{ border-radius: 8px; }}

QScrollArea {{ border: none; background: transparent; }}
QScrollArea > QWidget > QWidget {{ background: transparent; }}
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 2px;
}}
QScrollBar::handle:vertical {{
    background: {t["border"]};
    border-radius: 5px;
    min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{ background: {t["text_faint"]}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
QScrollBar:horizontal {{
    background: transparent;
    height: 10px;
    margin: 2px;
}}
QScrollBar::handle:horizontal {{
    background: {t["border"]};
    border-radius: 5px;
    min-width: 30px;
}}

QTableWidget {{
    background: {t["bg_panel"]};
    border: 1px solid {t["border"]};
    border-radius: 12px;
    gridline-color: {t["border"]};
    alternate-background-color: {t["bg_card"]};
}}
QHeaderView::section {{
    background: {t["bg_card"]};
    border: none;
    border-bottom: 1px solid {t["border"]};
    padding: 10px;
    font-weight: 600;
    color: {t["text_dim"]};
}}
QTableWidget::item {{ padding: 6px; border: none; }}
QTableWidget::item:selected {{ background: {a["accent"]}; color: white; }}

QCheckBox {{ spacing: 8px; }}
QCheckBox::indicator {{
    width: 18px; height: 18px;
    border-radius: 6px;
    border: 1px solid {t["border"]};
    background: {t["bg_input"]};
}}
QCheckBox::indicator:checked {{
    background: {a["accent"]};
    border-color: {a["accent"]};
}}
QToolTip {{
    background: {t["bg_card"]};
    color: {t["text"]};
    border: 1px solid {t["border"]};
    padding: 6px;
    border-radius: 6px;
}}
QStatusBar {{ background: {t["bg_panel"]}; color: {t["text_dim"]}; }}
QMessageBox {{ background: {t["bg_panel"]}; }}
"""
