"""Offscreen Qt tests run on Windows CI; skip only when native Qt libraries are absent."""
import os
import time
from pathlib import Path
import pytest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
QtWidgets = pytest.importorskip('PySide6.QtWidgets', exc_type=ImportError)
from PySide6.QtCore import QEventLoop, QTimer
from app.download_manager import DownloadManager
from app.main_window import MainWindow
from app.dialogs import AddDownloadDialog, SettingsDialog
from app.theme import apply_theme
from app.http_client import HTTPClient


@pytest.fixture(scope='module')
def qapp():
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    apply_theme(app)
    return app


def wait_until(predicate, timeout=15000):
    loop = QEventLoop()
    poll = QTimer()
    poll.timeout.connect(lambda: loop.quit() if predicate() else None)
    poll.start(20)
    QTimer.singleShot(timeout, loop.quit)
    loop.exec()
    poll.stop()
    assert predicate(), 'Timed out waiting for Qt operation'


def test_window_and_virtual_chunks(qapp, server, setup_download, tmp_path):
    db, d, settings = setup_download(server)
    manager = DownloadManager(db, settings)
    window = MainWindow(manager, tmp_path/'settings.json')
    window.show()
    qapp.processEvents()
    assert window.model.rowCount() == 1
    window.table.selectRow(0)
    window.toggle_chunks(True)
    qapp.processEvents()
    assert window.chunk_model.rowCount() == d.count
    assert window.chunk_model.index(0, 1).data() == '0–1,048,575'
    assert window.selected_id == d.id
    manager.resume(d.id)
    wait_until(lambda: db.get(d.id).status == 'completed' and manager.idle())
    qapp.processEvents()
    window.refresh()
    assert window.metrics[3].text() == '1'
    assert Path(d.destination).read_bytes() == server.data
    screenshot = os.environ.get('ULTRADOWNLOAD_SCREENSHOT')
    if screenshot:
        window.grab().save(screenshot)
    window.close()
    manager.dispose()


def test_add_dialog_inspection_and_settings(qapp, server, setup_download, tmp_path):
    db, d, settings = setup_download(server)
    manager = DownloadManager(db, settings)
    dialog = AddDownloadDialog(manager)
    dialog.url.setText(server.url)
    dialog.inspect()
    wait_until(lambda: dialog.remote is not None)
    assert dialog.remote.size == len(server.data)
    assert dialog.filename.text() == 'test.bin'
    assert dialog.start.isEnabled()
    dialog.reject()
    preferences = SettingsDialog(settings)
    preferences.controls['connections'].setValue(5)
    preferences.save()
    assert preferences.result_settings.connections == 5
    assert preferences.result_settings.global_connections == 20
    wait_until(manager.idle)
    manager.dispose()


def test_queue_priority_and_simultaneous_file_limit(qapp, server, setup_download, tmp_path):
    db, d, settings = setup_download(server, simultaneous_files=1, connections=3)
    manager = DownloadManager(db, settings)
    client = HTTPClient(settings)
    remote = client.inspect(server.url)
    client.close()
    first = manager.add(server.url, remote, tmp_path, 'first.bin')
    second = manager.add(server.url, remote, tmp_path, 'second.bin')
    third = manager.add(server.url, remote, tmp_path, 'third.bin')
    manager.prioritize(third.id)
    order = []
    def collect(snapshot):
        if snapshot['status'] == 'downloading' and snapshot['id'] not in order:
            order.append(snapshot['id'])
        assert len(manager.running) <= 1
    manager.signals.progress.connect(collect)
    wait_until(lambda: all(db.get(x.id).status == 'completed' for x in (first, second, third)) and manager.idle())
    assert order.index(third.id) < order.index(second.id)
    assert server.peak <= 3
    manager.dispose()
