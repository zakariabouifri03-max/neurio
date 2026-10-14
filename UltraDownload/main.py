import argparse
import sys
from pathlib import Path

from PySide6.QtCore import QLockFile, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication, QMessageBox

from app.main_window import MainWindow
from app.settings import Settings, data_directory


def main():
    parser = argparse.ArgumentParser(
        description="UltraDownload desktop download manager"
    )
    parser.add_argument(
        "--data-dir", type=Path, help="Override per-user application data directory"
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Launch real Qt window and exit automatically",
    )
    parser.add_argument(
        "--self-test",
        type=Path,
        metavar="REPORT_JSON",
        help="Run a real local range download and write a verification report",
    )
    args = parser.parse_args()
    if args.self_test:
        from app.self_test import run_self_test

        return run_self_test(args.self_test)
    app = QApplication(sys.argv[:1])
    app.setApplicationName("UltraDownload")
    app.setOrganizationName("UltraDownload")
    app.setApplicationVersion("1.0.0")
    app.setStyle("Fusion")
    icon_path = Path(__file__).parent / "assets" / "app_icon.ico"
    app.setWindowIcon(QIcon(str(icon_path)))
    root = args.data_dir or data_directory()
    root.mkdir(parents=True, exist_ok=True)
    lock = QLockFile(str(root / "instance.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        QMessageBox.warning(
            None,
            "UltraDownload is already running",
            "Only one instance can use this profile at a time.",
        )
        return 1
    try:
        settings = Settings.load(root / "settings.json")
    except (ValueError, OSError, TypeError) as exc:
        QMessageBox.warning(
            None,
            "Settings could not be loaded",
            f"Default settings will be used.\n{exc}",
        )
        settings = Settings()
    window = MainWindow(root, settings)
    window.show()
    if args.smoke_test:
        QTimer.singleShot(800, window.close)
    result = app.exec()
    if not window.closed:
        window.manager.close()
    lock.unlock()
    return result


if __name__ == "__main__":
    sys.exit(main())
