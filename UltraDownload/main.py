import sys
from pathlib import Path
from PySide6.QtCore import QLockFile, QTimer
from PySide6.QtWidgets import QApplication, QMessageBox
from app.database import Database
from app.download_manager import DownloadManager
from app.main_window import MainWindow
from app.settings import Settings, data_directory
from app.theme import apply_theme


def main():
    app = QApplication(sys.argv)
    app.setApplicationName('UltraDownload')
    app.setOrganizationName('UltraDownload')
    root = data_directory()
    lock = QLockFile(str(root / 'application.lock'))
    if not lock.tryLock(0):
        QMessageBox.information(None, 'UltraDownload', 'UltraDownload is already running for this user.')
        return 1
    try:
        path = root / 'settings.json'
        settings = Settings.load(path)
        apply_theme(app, settings.theme)
        db = Database(root / 'downloads.sqlite3')
        manager = DownloadManager(db, settings)
        window = MainWindow(manager, path)
        window.show()
        if '--smoke-test' in sys.argv:
            QTimer.singleShot(600, window.close)
        result = app.exec()
        manager.dispose()
        db.close()
        return result
    except Exception:
        if '--smoke-test' in sys.argv:
            import traceback
            traceback.print_exc()
            return 1
        QMessageBox.critical(None, 'UltraDownload startup failed',
            'Could not initialize the application. Check per-user data-directory permissions and settings.json. No downloads were changed.')
        return 1
    finally:
        lock.unlock()


if __name__ == '__main__':
    sys.exit(main())
