import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import time
import pytest

# Linux needs the native Qt dependencies listed in README; Windows wheels include Qt.
from PySide6.QtCore import QThreadPool
from PySide6.QtWidgets import QApplication
from app.dialogs import AddDialog, SettingsDialog
from app.main_window import MainWindow
from app.models import CHUNK_SIZE
from .local_range_server import range_server


@pytest.fixture(scope="module")
def application():
    app = QApplication.instance() or QApplication([])
    yield app
    QThreadPool.globalInstance().waitForDone(10000)


def pump_until(app, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Qt condition timed out")


def test_real_ui_inspect_start_complete(application, tmp_path, settings):
    settings.directory = str(tmp_path / "files")
    with range_server(b"z" * (CHUNK_SIZE * 12 + 11), delay=0.1) as server:
        window = MainWindow(tmp_path / "profile", settings)
        window.show()
        try:
            add = AddDialog(window.manager, window)
            add.show()
            add.url.setText(server.url)
            assert not add.start.isEnabled()
            add.inspect_link()
            pump_until(application, lambda: add.info is not None)
            assert add.filename.text() == "test-file.bin"
            assert add.start.isEnabled()
            add.start_download()
            pump_until(application, lambda: len(window.manager.db.downloads()) == 1)
            identifier = window.manager.db.downloads()[0]["id"]
            pump_until(
                application,
                lambda: window.manager.db.get(identifier)["status"] == "completed",
            )
            pump_until(
                application,
                lambda: window.snapshots.get(identifier, {}).get("status")
                == "completed",
            )
            window.refresh()
            assert window.model.rowCount() == 1
            assert window.stats["completed"].text() == "1"
            assert window.progress.value() == 1000
            assert (tmp_path / "files" / "test-file.bin").read_bytes() == server.data
            window.show_chunks.setChecked(True)
            application.processEvents()
            assert window.chunk_model.rowCount() == 13
            assert (
                window.chunk_model.data(window.chunk_model.index(12, 5)) == "Complete"
            )
            window.set_filter("Failed")
            assert window.model.rowCount() == 0
            window.set_filter("Completed")
            assert window.model.rowCount() == 1
        finally:
            window.close()
            pump_until(application, lambda: window.closed)


def test_settings_and_invalid_url(application, tmp_path, settings):
    window = MainWindow(tmp_path / "profile", settings)
    try:
        dialog = SettingsDialog(settings, window)
        assert dialog.values().connections == 10
        assert dialog.fields["connections"].maximum() == 10
        dialog.fields["global_connections"].setValue(5)
        new = dialog.values()
        window.manager.apply_settings(new)
        assert window.manager.settings.global_connections == 5
        assert (tmp_path / "profile" / "settings.json").exists()
        add = AddDialog(window.manager, window)
        add.url.setText("not a URL")
        add.inspect_link()
        assert add.error.text()
        assert not add.start.isEnabled()
    finally:
        window.close()
        pump_until(application, lambda: window.closed)
