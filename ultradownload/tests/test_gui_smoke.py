"""End-to-end GUI smoke test (offscreen).

Boots the real MainWindow against the local range server, adds a
download through the real manager, verifies the dashboard card, the
details part grid and the history table all update through Qt signals,
and checks settings/theme changes work.
"""

from __future__ import annotations

import os
import time
from typing import Callable

import pytest

PySide6 = pytest.importorskip("PySide6")
from PySide6.QtWidgets import QApplication  # noqa: E402

from ultradownload.db import Database  # noqa: E402
from ultradownload.gui import theme  # noqa: E402
from ultradownload.gui.main_window import MainWindow  # noqa: E402
from ultradownload.manager import DownloadManager  # noqa: E402
from ultradownload.models import DownloadStatus  # noqa: E402
from tests.range_server import verify_file_content  # noqa: E402


@pytest.fixture(scope="module")
def qapp():
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    app = QApplication.instance() or QApplication([])
    theme.apply_theme(app, "purple")
    yield app


def spin_until(cond: Callable[[], bool], timeout: float = 60.0) -> bool:
    app = QApplication.instance()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if cond():
            return True
        time.sleep(0.01)
    return cond()


@pytest.fixture
def window(qapp, tmp_path):
    db = Database(str(tmp_path / "gui.db"))
    mgr = DownloadManager(db)
    mgr.update_settings({"default_parts": 8, "max_simultaneous": 3,
                         "connect_timeout": 5, "read_timeout": 10})
    theme.apply_theme(qapp, mgr.settings.get("accent", "purple"))
    win = MainWindow(mgr)
    win.show()
    yield win
    # cancel anything still running so closeEvent never shows the
    # "downloads in progress?" modal (nobody would click it in tests)
    for tid in [t.id for t in mgr.tasks.values()
                if not t.status.is_finished]:
        mgr.cancel(tid, delete_temp=True)
    spin_until(lambda: all(t.status.is_finished for t in mgr.tasks.values()),
               timeout=30)
    qapp.processEvents()
    win.close()
    try:
        mgr.shutdown(wait_seconds=5)
    except Exception:
        pass


class TestGuiSmoke:
    def test_window_boot_and_navigation(self, window, qapp):
        assert window.windowTitle().startswith("UltraDownload")
        # navigate every page; no exceptions allowed
        for idx in (1, 2, 0):
            window._navigate(idx)
            qapp.processEvents()
        assert window.stack.currentIndex() == 0

    def test_full_download_through_ui(self, window, server_factory, qapp,
                                      tmp_path):
        size = 6 * 1024 * 1024
        srv = server_factory(size=size, mode="slow", throttle_bps=100 * 1024)
        ws = str(tmp_path / "dl")
        os.makedirs(ws, exist_ok=True)

        task = window.manager.add_download(srv.file_url, ws)
        # dashboard shows a card for it
        assert spin_until(lambda: task.id in window.dashboard.cards)
        card = window.dashboard.cards[task.id]
        assert card.filename_lbl.text() == "file.bin"

        # open details → part grid exists with one row per part
        window.show_details(task.id)
        assert window.stack.currentIndex() == 3
        assert window.details.table.rowCount() >= 1
        assert spin_until(lambda: window.details.progress.value() > 0,
                          timeout=40)
        # some part rows show live progress
        assert spin_until(lambda: any(
            window.details.table.cellWidget(i, 2).value() > 0
            for i in range(window.details.table.rowCount())), timeout=40)

        # pause via the card button, then resume via details button
        assert spin_until(lambda: task.status == DownloadStatus.ACTIVE,
                          timeout=30)
        card = window.dashboard.cards[task.id]   # refresh: card may be rebuilt
        card.pause_btn.click()
        assert spin_until(lambda: task.status == DownloadStatus.PAUSED,
                          timeout=20)
        window.details.btn_resume.click()
        assert spin_until(lambda: task.status == DownloadStatus.ACTIVE,
                          timeout=20)

        # completes; history records it; final file exact
        assert spin_until(lambda: task.status == DownloadStatus.COMPLETED,
                          timeout=90)
        window._navigate(1)
        qapp.processEvents()
        assert window.history.table.rowCount() == 1
        assert window.history.table.item(0, 0).text() == "COMPLETED"
        assert verify_file_content(os.path.join(ws, "file.bin"), size)

        # dashboard stats reflect it
        stats = window.manager.stats()
        assert stats["completed"] == 1
        assert stats["total_downloaded"] >= size

    def test_details_part_grid_shows_ranges(self, window, server_factory,
                                            tmp_path, qapp):
        size = 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        ws = str(tmp_path / "dl2")
        os.makedirs(ws, exist_ok=True)
        task = window.manager.add_download(srv.file_url, ws, part_count=8)
        window.show_details(task.id)
        assert window.details.table.rowCount() == 8
        assert spin_until(lambda: task.status == DownloadStatus.COMPLETED,
                          timeout=40)
        qapp.processEvents()
        first_range = window.details.table.item(0, 1).text()
        assert first_range.startswith("0 – ")
        last_start = int(window.details.table.item(7, 1).text()
                         .split("–")[0].strip().replace(",", ""))
        assert last_start == size - size // 8

    def test_add_dialog_validates_urls(self, window, qapp):
        from ultradownload.gui.add_dialog import AddDownloadDialog
        dlg = AddDownloadDialog(window.manager, parent=window)
        dlg.url_edit.setText("ftp://nope/file.bin")
        dlg._on_accept()
        assert dlg.url_hint.isVisibleTo(dlg)
        assert "Unsupported protocol" in dlg.url_hint.text()
        dlg.url_edit.setText("")
        dlg._on_accept()
        assert "enter a download URL" in dlg.url_hint.text()
        dlg.deleteLater()

    def test_add_dialog_probe_and_parts(self, window, server_factory, qapp,
                                        tmp_path):
        from ultradownload.gui.add_dialog import AddDownloadDialog
        size = 4 * 1024 * 1024
        srv = server_factory(size=size, mode="normal")
        dlg = AddDownloadDialog(window.manager, preset_url=srv.file_url,
                                parent=window)
        # wait for the background probe to land
        assert spin_until(lambda: dlg.probe_result is not None, timeout=20)
        assert dlg.probe_result.total_size == size
        assert dlg.probe_panel.isVisibleTo(dlg)
        assert "parallel parts available" in dlg.probe_range.text()
        dlg.dest_edit.setText(str(tmp_path / "dlg"))
        os.makedirs(str(tmp_path / "dlg"), exist_ok=True)
        # the combo follows the configured default (8 in this fixture);
        # explicitly pick 40 to verify the selector is honoured
        dlg.parts_combo.setCurrentIndex(dlg.parts_combo.findData(40))
        dlg._on_accept()
        assert dlg.result() == 1  # accepted
        tasks = list(window.manager.tasks.values())
        assert tasks and tasks[-1].part_count == 40
        assert len(tasks[-1].parts) == 40

    def test_no_range_server_disables_parts(self, window, server_factory,
                                            qapp):
        from ultradownload.gui.add_dialog import AddDownloadDialog
        srv = server_factory(size=512 * 1024, mode="no_range")
        dlg = AddDownloadDialog(window.manager, preset_url=srv.file_url,
                                parent=window)
        assert spin_until(lambda: dlg.probe_result is not None, timeout=20)
        assert not dlg.parts_combo.isEnabled()
        assert dlg.parts_combo.currentData() == 1
        dlg.deleteLater()

    def test_theme_switch(self, window, qapp):
        theme.apply_theme(qapp, "blue")
        qapp.processEvents()
        qss = qapp.styleSheet()
        assert "#3b82f6" in qss
        theme.apply_theme(qapp, "purple")
        qss = qapp.styleSheet()
        assert "#7c5cff" in qss

    def test_settings_page_controls(self, window, qapp):
        window._navigate(2)
        qapp.processEvents()
        page = window.settings
        page.max_sim.setValue(5)
        qapp.processEvents()
        assert window.manager.setting_int("max_simultaneous") == 5
        page.speed_limit.setValue(1024)
        qapp.processEvents()
        assert window.manager.setting_int("global_speed_limit") == 1024 * 1024
        assert window.manager.global_limiter.rate == 1024 * 1024
