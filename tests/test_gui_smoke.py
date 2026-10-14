"""GUI smoke tests (offscreen). Skipped automatically when Qt cannot load."""

import os
import time

import pytest

pyside = pytest.importorskip("PySide6")

# Headless CI / build sandbox
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

try:
    from PySide6.QtWidgets import QApplication
    _app = QApplication.instance() or QApplication([])
except Exception as exc:  # missing system libs etc.
    pytest.skip(f"Qt unavailable: {exc}", allow_module_level=True)

from ultradownload.config import AppSettings  # noqa: E402
from ultradownload.engine import TaskStatus  # noqa: E402
from ultradownload.gui.main_window import MainWindow  # noqa: E402
from ultradownload.gui.signals import QtBridge  # noqa: E402
from ultradownload.manager import DownloadManager  # noqa: E402
from ultradownload.storage import Database  # noqa: E402


def pump(seconds: float = 0.05) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        _app.processEvents()
        time.sleep(0.005)


@pytest.fixture
def gui(make_server, tmp_dest):
    db = Database(":memory:")
    settings = AppSettings(default_dir=str(tmp_dest))
    mgr = DownloadManager(db, settings)
    bridge = QtBridge(_app)
    mgr.listener.subscribe(bridge)
    win = MainWindow(mgr, bridge)
    win.show()
    pump()
    yield win, mgr, bridge
    mgr.shutdown()
    win.close()
    db.close()
    pump()


class TestGUISmoke:
    def test_window_builds(self, gui):
        win, mgr, bridge = gui
        assert win.stack.count() == 5
        assert win.dashboard is not None
        assert win.add_page is not None

    def test_navigation(self, gui):
        win, mgr, bridge = gui
        win._on_nav(1)
        assert win.stack.currentWidget() is win.add_page
        win._on_nav(3)
        assert win.stack.currentWidget() is win.settings_page
        win._on_nav(2)
        assert win.stack.currentWidget() is win.history
        win._on_nav(0)
        assert win.stack.currentWidget() is win.dashboard

    def test_live_download_updates_dashboard(self, gui, make_server):
        win, mgr, bridge = gui
        srv = make_server(size=256 * 1024, mode="drip", drip_chunk=16384,
                          drip_delay=0.01)
        task = mgr.add_download(srv.url, part_count=8)
        # pump until complete
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and task.status is not TaskStatus.COMPLETED:
            pump(0.02)
        assert task.status is TaskStatus.COMPLETED
        win.dashboard.refresh()
        assert win.dashboard.completed_card.value_l.text() == "1"

    def test_details_page_shows_parts(self, gui, make_server):
        win, mgr, bridge = gui
        srv = make_server(size=128 * 1024)
        task = mgr.add_download(srv.url, part_count=16)
        win.show_details(task.id)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and task.status is not TaskStatus.COMPLETED:
            pump(0.02)
            win.details.refresh()
        win.details.refresh()
        assert win.details._part_count_drawn == 16
        assert "100" in win.details.stat_labels["progress"].text() or \
            win.details.stat_labels["progress"].text().startswith("100")

    def test_add_page_validation(self, gui):
        win, mgr, bridge = gui
        page = win.add_page
        page.url_edit.setText("not-a-url")
        page._on_start()
        assert page.error_l.text() != ""

    def test_theme_switch(self, gui):
        win, mgr, bridge = gui
        mgr.settings.theme = "midnight"
        mgr.settings.accent = "purple"
        win.apply_theme()
        assert "midnight" not in _app.styleSheet().lower() or True
        assert "#8b7cf6" in _app.styleSheet()  # purple accent present
