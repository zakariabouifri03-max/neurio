"""Application entry point.

Handles: logging bootstrap, single-instance guard (lock file), Qt high-DPI,
crash hook that writes the last autosave note, and the main window.
"""

from __future__ import annotations

import os
import sys
import traceback

from .core import paths
from .core.logging_setup import get_logger, setup_logging


def main(argv: list[str] | None = None) -> int:
    setup_logging()
    log = get_logger("app")
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")

    from PySide6.QtWidgets import QApplication, QMessageBox

    from . import APP_NAME
    from .core.ffmpeg import find_ffmpeg

    app = QApplication(argv or sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("Adzak")

    from .ui.main_window import MainWindow

    window = MainWindow()
    window.show()

    if not find_ffmpeg():
        QMessageBox.warning(
            window, APP_NAME,
            "FFmpeg was not found.\n\nVideo/audio processing is disabled until you "
            "install FFmpeg (https://ffmpeg.org) or set its path in Settings.\n"
            "Photo editing, design, animation and utilities keep working.")
    log.info("started %s", APP_NAME)
    try:
        return app.exec()
    except Exception:
        crash = paths.logs_dir() / "crash.log"
        with crash.open("a", encoding="utf-8") as fh:
            traceback.print_exc(file=fh)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
