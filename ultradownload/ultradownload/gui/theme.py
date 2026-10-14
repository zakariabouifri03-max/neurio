"""Dark, premium application theme (QSS) with selectable accent color.

Palette: deep charcoal backgrounds, soft panel borders, one saturated
accent (purple or blue), semantic success/warning/error colors.
"""

from __future__ import annotations

ACCENTS = {
    "purple": {
        "accent": "#7c5cff",
        "accent_hover": "#9278ff",
        "accent_pressed": "#6344e0",
        "accent_soft": "rgba(124, 92, 255, 0.16)",
        "accent_grad_top": "#8f6fff",
        "accent_grad_bottom": "#5f3fe0",
    },
    "blue": {
        "accent": "#3b82f6",
        "accent_hover": "#5b9bf8",
        "accent_pressed": "#2563d6",
        "accent_soft": "rgba(59, 130, 246, 0.16)",
        "accent_grad_top": "#5ea0ff",
        "accent_grad_bottom": "#2563eb",
    },
}

BASE = {
    "bg": "#101218",
    "bg_alt": "#14171f",
    "panel": "#1a1e28",
    "panel_alt": "#202532",
    "border": "#2a3040",
    "border_soft": "#232838",
    "text": "#e9ebf2",
    "text_muted": "#9298ab",
    "text_dim": "#626a80",
    "success": "#34d399",
    "warning": "#fbbf24",
    "error": "#f87171",
    "chip": "#232a3a",
}

FONT_FAMILY = '"Segoe UI", "Inter", "Roboto", "Helvetica Neue", Arial, sans-serif'


def build_qss(accent_name: str = "purple") -> str:
    a = ACCENTS.get(accent_name, ACCENTS["purple"])
    c = {**BASE, **a}
    return f"""
* {{
    font-family: {FONT_FAMILY};
    color: {c['text']};
    outline: none;
}}

QWidget {{
    background-color: {c['bg']};
    font-size: 13px;
}}

QMainWindow, QDialog {{
    background-color: {c['bg']};
}}

/* ---------- sidebar ---------- */
#Sidebar {{
    background-color: {c['bg_alt']};
    border-right: 1px solid {c['border_soft']};
}}
#AppTitle {{
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.4px;
}}
#AppTitleAccent {{
    color: {c['accent']};
    font-size: 17px;
    font-weight: 700;
}}
#AppSubtitle {{
    color: {c['text_dim']};
    font-size: 10px;
    letter-spacing: 2.2px;
}}
#NavButton {{
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 10px 14px;
    text-align: left;
    color: {c['text_muted']};
    font-size: 13px;
    font-weight: 600;
}}
#NavButton:hover {{
    background-color: {c['panel']};
    color: {c['text']};
}}
#NavButton[checked="true"] {{
    background-color: {c['accent_soft']};
    color: {c['accent']};
}}
#SidebarFooter {{
    color: {c['text_dim']};
    font-size: 10px;
}}

/* ---------- top bar ---------- */
#TopBar {{
    background-color: {c['bg']};
    border-bottom: 1px solid {c['border_soft']};
}}
#PageTitle {{
    font-size: 18px;
    font-weight: 700;
}}
#GlobalChip {{
    background-color: {c['panel']};
    border: 1px solid {c['border']};
    border-radius: 12px;
    padding: 4px 12px;
    color: {c['text_muted']};
    font-size: 11px;
    font-weight: 600;
}}
#GlobalChipValue {{
    color: {c['text']};
    font-weight: 700;
}}

/* ---------- panels & cards ---------- */
#Panel, #StatCard, #DownloadCard, #DetailsHeader {{
    background-color: {c['panel']};
    border: 1px solid {c['border']};
    border-radius: 12px;
}}
#StatCardTitle {{
    color: {c['text_dim']};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
}}
#StatCardValue {{
    font-size: 20px;
    font-weight: 800;
}}
#StatCardSub {{
    color: {c['text_muted']};
    font-size: 10px;
}}
#SectionTitle {{
    font-size: 13px;
    font-weight: 700;
    color: {c['text_muted']};
    letter-spacing: 0.6px;
}}

#CardFilename {{
    font-size: 14px;
    font-weight: 700;
}}
#CardMeta {{
    color: {c['text_muted']};
    font-size: 11px;
}}
#CardSpeed {{
    color: {c['accent']};
    font-size: 12px;
    font-weight: 700;
}}

#StatusChip {{
    border-radius: 9px;
    padding: 2px 10px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.8px;
    background-color: {c['chip']};
    color: {c['text_muted']};
}}
#StatusChip[status="active"] {{
    background-color: {c['accent_soft']};
    color: {c['accent']};
}}
#StatusChip[status="completed"] {{
    background-color: rgba(52, 211, 153, 0.14);
    color: {c['success']};
}}
#StatusChip[status="paused"] {{
    background-color: rgba(251, 191, 36, 0.14);
    color: {c['warning']};
}}
#StatusChip[status="failed"] {{
    background-color: rgba(248, 113, 113, 0.14);
    color: {c['error']};
}}
#StatusChip[status="queued"] {{
    background-color: {c['chip']};
    color: {c['text_muted']};
}}
#StatusChip[status="cancelled"] {{
    background-color: {c['chip']};
    color: {c['text_dim']};
}}

/* ---------- buttons ---------- */
QPushButton {{
    background-color: {c['panel_alt']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 7px 16px;
    font-weight: 600;
    color: {c['text']};
}}
QPushButton:hover {{
    background-color: #262c3c;
    border-color: #343c52;
}}
QPushButton:pressed {{
    background-color: #1c2130;
}}
QPushButton:disabled {{
    color: {c['text_dim']};
    background-color: {c['panel']};
    border-color: {c['border_soft']};
}}
QPushButton#PrimaryButton {{
    background-color: {c['accent']};
    border: none;
    color: #ffffff;
    font-weight: 700;
    padding: 9px 20px;
}}
QPushButton#PrimaryButton:hover {{
    background-color: {c['accent_hover']};
}}
QPushButton#PrimaryButton:pressed {{
    background-color: {c['accent_pressed']};
}}
QPushButton#PrimaryButton:disabled {{
    background-color: {c['panel_alt']};
    color: {c['text_dim']};
}}
QPushButton#DangerButton {{
    background-color: transparent;
    border: 1px solid rgba(248, 113, 113, 0.4);
    color: {c['error']};
}}
QPushButton#DangerButton:hover {{
    background-color: rgba(248, 113, 113, 0.12);
}}
QPushButton#GhostButton {{
    background: transparent;
    border: 1px solid {c['border']};
    color: {c['text_muted']};
}}
QPushButton#GhostButton:hover {{
    color: {c['text']};
    border-color: #343c52;
}}
QPushButton#CardButton {{
    background: transparent;
    border: 1px solid {c['border']};
    border-radius: 7px;
    padding: 4px 10px;
    color: {c['text_muted']};
    font-size: 11px;
}}
QPushButton#CardButton:hover {{
    color: {c['text']};
    background-color: {c['panel_alt']};
}}

/* ---------- inputs ---------- */
QLineEdit, QComboBox, QSpinBox, QPlainTextEdit, QTextEdit {{
    background-color: {c['bg_alt']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    padding: 8px 10px;
    selection-background-color: {c['accent']};
    selection-color: #fff;
}}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus,
QPlainTextEdit:focus, QTextEdit:focus {{
    border: 1px solid {c['accent']};
}}
QLineEdit:disabled, QComboBox:disabled, QSpinBox:disabled {{
    color: {c['text_dim']};
}}
QComboBox::drop-down {{
    border: none;
    width: 24px;
}}
QComboBox::down-arrow {{
    image: none;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid {c['text_muted']};
    margin-right: 10px;
}}
QComboBox QAbstractItemView {{
    background-color: {c['panel']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    selection-background-color: {c['accent_soft']};
    selection-color: {c['accent']};
    padding: 4px;
}}
QCheckBox {{
    spacing: 8px;
    color: {c['text_muted']};
}}
QCheckBox::indicator {{
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid {c['border']};
    background: {c['bg_alt']};
}}
QCheckBox::indicator:checked {{
    background: {c['accent']};
    border-color: {c['accent']};
}}

/* ---------- progress ---------- */
QProgressBar {{
    background-color: {c['bg_alt']};
    border: 1px solid {c['border_soft']};
    border-radius: 6px;
    text-align: center;
    color: {c['text_muted']};
    font-size: 10px;
    font-weight: 700;
    height: 12px;
}}
QProgressBar::chunk {{
    border-radius: 5px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 {c['accent_grad_bottom']}, stop:1 {c['accent_grad_top']});
}}
QProgressBar#BigProgress {{
    height: 20px;
    border-radius: 10px;
    font-size: 11px;
}}
QProgressBar#BigProgress::chunk {{
    border-radius: 9px;
}}
QProgressBar#PartProgress {{
    height: 8px;
    border-radius: 4px;
    border: none;
}}
QProgressBar#PartProgress::chunk {{
    border-radius: 4px;
}}

/* ---------- tables ---------- */
QTableWidget, QTableView {{
    background-color: {c['bg_alt']};
    alternate-background-color: {c['panel']};
    border: 1px solid {c['border']};
    border-radius: 10px;
    gridline-color: {c['border_soft']};
    selection-background-color: {c['accent_soft']};
    selection-color: {c['text']};
}}
QHeaderView::section {{
    background-color: {c['panel']};
    color: {c['text_dim']};
    border: none;
    border-bottom: 1px solid {c['border']};
    padding: 8px 10px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1px;
}}
QTableCornerButton::section {{
    background-color: {c['panel']};
    border: none;
}}
QTableWidget::item {{
    padding: 4px;
    border: none;
}}

/* ---------- scrollbars ---------- */
QScrollBar:vertical {{
    background: transparent;
    width: 10px;
    margin: 2px;
}}
QScrollBar::handle:vertical {{
    background: {c['border']};
    border-radius: 4px;
    min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{
    background: #3a4258;
}}
QScrollBar::add-line, QScrollBar::sub-line {{
    height: 0; width: 0;
}}
QScrollBar:horizontal {{
    background: transparent;
    height: 10px;
    margin: 2px;
}}
QScrollBar::handle:horizontal {{
    background: {c['border']};
    border-radius: 4px;
    min-width: 30px;
}}

/* ---------- misc ---------- */
QToolTip {{
    background-color: {c['panel_alt']};
    color: {c['text']};
    border: 1px solid {c['border']};
    border-radius: 6px;
    padding: 6px 8px;
}}
QStatusBar {{
    background-color: {c['bg_alt']};
    color: {c['text_muted']};
    border-top: 1px solid {c['border_soft']};
    font-size: 11px;
}}
QMessageBox {{
    background-color: {c['panel']};
}}
#ErrorBanner {{
    background-color: rgba(248, 113, 113, 0.10);
    border: 1px solid rgba(248, 113, 113, 0.35);
    border-radius: 8px;
    color: {c['error']};
    padding: 8px 12px;
    font-size: 12px;
}}
#InfoBanner {{
    background-color: {c['accent_soft']};
    border: 1px solid {c['border']};
    border-radius: 8px;
    color: {c['text_muted']};
    padding: 8px 12px;
    font-size: 12px;
}}
#LogArea {{
    background-color: {c['bg_alt']};
    border: 1px solid {c['border_soft']};
    border-radius: 8px;
    color: {c['text_muted']};
    font-family: "Cascadia Mono", "Consolas", monospace;
    font-size: 11px;
}}
#DetailLabel {{
    color: {c['text_dim']};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
}}
#DetailValue {{
    font-size: 13px;
    font-weight: 600;
}}
"""


def apply_theme(app, accent_name: str = "purple") -> None:
    """Apply the stylesheet globally."""
    app.setStyleSheet(build_qss(accent_name))
