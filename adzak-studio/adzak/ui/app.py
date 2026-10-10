from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    from PySide6.QtCore import Qt
    from PySide6.QtWidgets import QApplication

    from ..core.db import open_default_db
    from ..core.i18n import is_rtl, set_language
    from ..core.log import setup_logging
    from ..core.paths import app_data_dir, cleanup_temp
    from .main_window import MainWindow
    from .theme import apply_theme

    setup_logging(app_data_dir() / "logs")
    cleanup_temp()
    app = QApplication(argv if argv is not None else sys.argv)
    app.setApplicationName("ADZAK Creative Studio")
    app.setOrganizationName("ADZAK")
    db = open_default_db()
    set_language(db.get_setting("language"))
    app.setLayoutDirection(Qt.RightToLeft if is_rtl() else Qt.LeftToRight)
    apply_theme(app, db.get_setting("theme"))
    win = MainWindow(db)
    win.show()
    code = app.exec()
    db.close()
    return code
