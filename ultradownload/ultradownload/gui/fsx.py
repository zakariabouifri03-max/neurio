"""Filesystem helpers for the GUI (open folder / launch file).

UltraDownload never executes downloaded files automatically; opening or
launching a file only happens on an explicit, confirmed user action.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys

from PySide6.QtWidgets import QMessageBox, QWidget

log = logging.getLogger(__name__)


def open_in_file_manager(path: str, select: bool = True) -> None:
    """Open the folder containing ``path`` (never executes the file)."""
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    if not folder:
        return
    try:
        if sys.platform.startswith("win"):
            if select and os.path.isfile(path):
                subprocess.Popen(["explorer", "/select,",
                                  os.path.normpath(path)])
            else:
                os.startfile(folder)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":  # pragma: no cover
            subprocess.Popen(["open", "-R", path] if select
                             else ["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])
    except OSError:
        log.warning("Could not open folder %s", folder)


def open_file(path: str, parent: QWidget) -> None:
    """Explicitly user-invoked launch of a downloaded file."""
    if not os.path.isfile(path):
        QMessageBox.warning(parent, "UltraDownload",
                            "The file no longer exists at that location.")
        return
    answer = QMessageBox.question(
        parent, "Open downloaded file",
        f"Launch '{os.path.basename(path)}' now?\n\n"
        "Only run files from sources you trust. UltraDownload never "
        "executes downloads automatically.",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        QMessageBox.StandardButton.No)
    if answer != QMessageBox.StandardButton.Yes:
        return
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":  # pragma: no cover
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except OSError as exc:
        QMessageBox.critical(parent, "UltraDownload",
                             f"Could not open the file: {exc}")
