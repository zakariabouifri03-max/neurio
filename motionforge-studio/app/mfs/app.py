"""MotionForge Studio entry point.

Usage::

    MotionForge.exe                     # normal start
    MotionForge.exe project.mfs         # open a project
    MotionForge.exe --selftest          # head-less self test, prints a report
    MotionForge.exe --render in.mfs out.mp4
"""
from __future__ import annotations

import os
import sys
import time

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PACKAGE_ROOT = os.path.dirname(APP_DIR)
if PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, PACKAGE_ROOT)


def _reentry() -> None:
    """``python app/mfs/app.py`` (frozen or script) → run as a package module."""
    if __package__:
        return
    import importlib
    module = importlib.import_module("mfs.app")
    raise SystemExit(module.main(sys.argv))


def _setup_windows() -> None:
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("MotionForge.Studio.1")
    except Exception:
        pass
    # High DPI + OpenGL software fallback so the canvas works on every machine
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
    os.environ.setdefault("QT_OPENGL", "software")


def _apply_style(app, session) -> None:
    from .ui.theme import stylesheet
    app.setStyleSheet(stylesheet(dense=not session.beginner_mode))
    app.setWindowIcon(__import__("mfs.ui.theme", fromlist=["app_icon"]).app_icon())


def run_selftest() -> int:
    """Head-less smoke test used by CI and by the installer's post-check."""
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from .ui.canvas import CanvasView
    from .ui.session import EditorSession

    started = time.time()
    session = EditorSession()
    report = []
    report.append(f"project: {session.project.name} "
                  f"({len(session.scene.layers)} layers, {session.fps} fps)")
    canvas = CanvasView(session)
    canvas.resize(1280, 720)
    canvas.fit_to_window()
    report.append(f"canvas: zoom {canvas.zoom:.2f}, {canvas.out_size()}")
    session.add_character(True)
    rig = session.active_rig()
    report.append(f"rig: {len(rig.bones)} bones, {len(rig.ik_chains)} IK chains")
    session.set_frame(1)
    session.apply_pose("Wave Up")
    session.set_frame(24)
    session.apply_pose("Walk Contact R")
    report.append("poses: applied Wave Up / Walk Contact R")
    plan = session.ai_plan("walk left to right, stop, wave, then keep walking")
    session.ai_apply(plan)
    report.append(f"ai: {len(plan.actions)} actions applied")
    from .engine.exporter import ExportSettings, export_frames_sync
    out = os.path.join(os.environ.get("TEMP", "/tmp"), "mfs_selftest.png")
    settings = ExportSettings(path=out, fmt="png", width=320, height=180, fps=12,
                              frame_start=1, frame_end=4)
    frames = export_frames_sync(session.project, settings)
    report.append(f"export: {frames} frames rendered")
    report.append(f"time: {time.time() - started:.2f}s")
    _ = app
    print("MotionForge self test")
    for line in report:
        print("  " + line)
    print("  RESULT: OK")
    return 0


def run_render(path_in: str, path_out: str, fmt: str = "") -> int:
    """Batch render: MotionForge.exe --render project.mfs out.mp4"""
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtWidgets import QApplication
    QApplication.instance() or QApplication([])
    from .engine.exporter import ExportSettings, export_frames_sync
    from .io.project_file import load_project
    from .ui.session import EditorSession

    session = EditorSession(load_project(path_in))
    scene = session.scene
    ext = os.path.splitext(path_out)[1].lower().lstrip(".")
    fmt = fmt or ("jpeg" if ext in ("jpg", "jpeg") else ext or "mp4")
    settings = ExportSettings(path=path_out, fmt=fmt, width=scene.width, height=scene.height,
                              fps=scene.fps, frame_start=scene.frame_start,
                              frame_end=max(scene.total_frames(), scene.frame_end))

    def progress(done: int, total: int, message: str) -> None:
        print(f"  {done}/{total} {message}", flush=True)

    frames = export_frames_sync(session.project, settings, on_progress=progress)
    print(f"Wrote {path_out} ({frames} frames)")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    _setup_windows()
    if "--selftest" in argv:
        return run_selftest()
    if "--render" in argv:
        index = argv.index("--render")
        try:
            return run_render(argv[index + 1], argv[index + 2])
        except Exception as exc:
            print(f"Render failed: {exc}", file=sys.stderr)
            return 2

    from PySide6.QtWidgets import QApplication, QMessageBox
    from . import APP_NAME, ORG_NAME, __version__
    QApplication.setApplicationName(APP_NAME)
    QApplication.setOrganizationName(ORG_NAME)
    QApplication.setApplicationVersion(__version__)
    app = QApplication(argv)

    from .ui.main_window import MainWindow
    from .ui.session import EditorSession

    session = EditorSession()
    _apply_style(app, session)

    window = MainWindow(session)
    window.show()

    # drag & drop of project files onto the window is handled by the canvas, but
    # a project path passed on the command line opens straight away
    for arg in argv[1:]:
        if arg.lower().endswith(".mfs") and os.path.isfile(arg):
            session.open_project(arg)
            window.canvas.fit_to_window()
            break
    else:
        from .io.project_file import list_autosaves
        autosaves = list_autosaves()
        if autosaves and session.project.settings.get("autosave", {}).get("offer_recovery", True):
            from .ui.dialogs import RecoveryDialog
            dialog = RecoveryDialog(autosaves, window)
            if dialog.exec():
                entry = dialog.chosen()
                if entry:
                    session.open_project(entry["path"])
                    window.canvas.fit_to_window()
    try:
        session.start_autosave()
    except Exception:
        QMessageBox.warning(window, APP_NAME, "Autosave could not be started — the project is "
                                              "still safe, keep saving manually.")
    return app.exec()


if __name__ == "__main__":
    if not __package__:
        _reentry()
    raise SystemExit(main())
