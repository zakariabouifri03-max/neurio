"""Application bootstrap: database, manager, theme, main window."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from . import __app_name__, __version__
from .config import load_settings
from .manager import DownloadManager
from .storage import Database
from .utils import app_data_dir

log = logging.getLogger("ultradownload")


def _setup_logging() -> None:
    log_dir = app_data_dir()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stderr),
            logging.FileHandler(log_dir / "ultradownload.log", encoding="utf-8"),
        ],
    )


def _resource_path(relative: str) -> Path:
    """Resolve bundled resources for both source and PyInstaller builds."""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    else:
        base = Path(__file__).resolve().parent.parent
    return base / relative


def main() -> int:
    _setup_logging()
    log.info("starting %s %s", __app_name__, __version__)

    from PySide6.QtGui import QFont, QIcon
    from PySide6.QtWidgets import QApplication

    from .gui.main_window import MainWindow
    from .gui.signals import QtBridge
    from .gui.theme import build_qss

    app = QApplication(sys.argv)
    app.setApplicationName(__app_name__)
    app.setApplicationDisplayName("UltraDownload")
    app.setApplicationVersion(__version__)
    app.setOrganizationName("UltraDownload")

    icon_path = _resource_path("assets/icon.png")
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    db = Database(app_data_dir() / "ultradownload.sqlite3")
    settings = load_settings(db)
    manager = DownloadManager(db, settings)

    app.setStyleSheet(build_qss(settings.theme, settings.accent))
    font = QFont("Segoe UI", 10)
    font.setStyleStrategy(QFont.PreferAntialias)
    app.setFont(font)

    bridge = QtBridge(app)
    manager.listener.subscribe(bridge)

    window = MainWindow(manager, bridge)
    if not settings.start_minimized:
        window.show()

    code = app.exec()
    manager.shutdown()
    db.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
