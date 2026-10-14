"""Application entry point: wires database, manager and GUI together."""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys

from . import __app_name__, __version__
from .db import Database
from .manager import DownloadManager
from .utils import app_data_dir


def setup_logging(data_dir: str) -> None:
    log_path = os.path.join(data_dir, "ultradownload.log")
    handlers = [
        logging.handlers.RotatingFileHandler(
            log_path, maxBytes=2 * 1024 * 1024, backupCount=3,
            encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=handlers)
    # Quiet noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def resource_path(relative: str) -> str:
    """Path to a bundled resource (works from source and from PyInstaller)."""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return os.path.join(base, relative)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, relative)


def main(argv=None) -> int:
    argv = list(argv if argv is not None else sys.argv)
    data_dir = app_data_dir(__app_name__)
    setup_logging(data_dir)
    log = logging.getLogger("main")
    log.info("Starting %s %s (data dir: %s)", __app_name__, __version__,
             data_dir)

    from PySide6.QtCore import Qt
    from PySide6.QtGui import QIcon
    from PySide6.QtWidgets import QApplication

    # High-DPI rounding behavior is the Qt6 default; keep attribute set
    # before app construction for platforms that still honor it.
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)

    app = QApplication(argv)
    app.setApplicationName(__app_name__)
    app.setApplicationVersion(__version__)
    app.setOrganizationName(__app_name__)
    app.setQuitOnLastWindowClosed(True)

    icon_path = resource_path(os.path.join("assets", "icon.png"))
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))

    from .gui import theme
    from .gui.main_window import MainWindow

    db = Database(os.path.join(data_dir, "downloads.db"))
    manager = DownloadManager(db)
    manager.load_and_recover()

    accent = manager.settings.get("accent", "purple")
    theme.apply_theme(app, accent)

    window = MainWindow(manager, icon_path=icon_path)
    manager.sig_settings_changed.connect(
        lambda: None)  # settings already applied where relevant

    if manager.setting_bool("start_minimized") and window.tray is not None:
        window.hide()
        window.tray.showMessage(
            __app_name__, "Running in the background — click the tray icon "
            "to open.", 3000)
    else:
        window.show()

    code = app.exec()
    log.info("Exiting with code %s", code)
    return code


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
