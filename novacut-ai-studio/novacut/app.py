"""Application bootstrap: logging, config, theme, main window."""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QApplication

from . import APP_NAME, ORG_NAME, __version__
from .core import paths
from .core.config import Config
from .core.logging_setup import setup_logging, get_logger
from .ui.controller import ProjectController
from .ui.main_window import MainWindow
from .ui.theme import QSS


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    paths.ensure_dirs()
    logger = setup_logging()
    logger.info("Starting %s v%s", APP_NAME, __version__)

    app = QApplication(argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName(ORG_NAME)
    app.setStyle("Fusion")
    icon_path = paths.RESOURCES_DIR / "novacut.png"
    if icon_path.exists():
        from PySide6.QtGui import QIcon
        app.setWindowIcon(QIcon(str(icon_path)))
    scale = 1.0
    try:
        scale = float(Config().get("ui_scale", 1.0))
    except (TypeError, ValueError):
        pass
    if scale != 1.0:
        font = QFont(app.font())
        font.setPointSizeF(font.pointSizeF() * scale)
        app.setFont(font)
    app.setStyleSheet(QSS)

    config = Config()
    controller = ProjectController(config)
    window = MainWindow(controller)
    window.show()

    # Open a project passed on the command line (file association support).
    for arg in argv[1:]:
        if arg.lower().endswith(".novacut") and Path(arg).exists():
            try:
                controller.open_project(arg)
                window.timeline.refresh()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to open %s", arg)
            break

    logger.info("UI ready")
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
