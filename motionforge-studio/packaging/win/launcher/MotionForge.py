"""MotionForge Studio - Windows launcher.

This is the first thing that runs when the user double-clicks *MotionForge
Studio.exe* (a renamed ``pythonw.exe`` with the studio's icon and version info).
It wires up the isolated interpreter layout shipped next to it::

    app/    the application package (mfs)
    lib/    PySide6, numpy, imageio-ffmpeg, msvc runtime
    Lib/    the CPython standard library

so that no Python installation is required on the machine.  Command line
switches of the application itself (``--selftest``, ``--render``, ``.mfs``
files) are forwarded untouched, and a console is attached on demand when the
app is used from a terminal.
"""
from __future__ import annotations

import os
import sys
import traceback

APP_NAME = "MotionForge Studio"


def _exe_dir() -> str:
    return os.path.dirname(os.path.abspath(sys.executable))


ROOT = _exe_dir()


def _bootstrap_paths() -> None:
    for sub in ("lib", "app"):
        path = os.path.join(ROOT, sub)
        if os.path.isdir(path) and path not in sys.path:
            sys.path.insert(0, path)
    os.environ["MFS_HOME"] = ROOT
    os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "1")
    # portable mode: keep settings, autosaves and caches inside the folder
    if not os.environ.get("MFS_PORTABLE") and os.path.exists(os.path.join(ROOT, "portable.txt")):
        os.environ["MFS_PORTABLE"] = "1"
    if os.environ.get("MFS_PORTABLE") in ("1", "true", "yes"):
        data = os.path.join(ROOT, "data")
        try:
            os.makedirs(data, exist_ok=True)
            os.environ["APPDATA"] = data
        except OSError:
            pass


STD_HANDLES = {"stdin": -10, "stdout": -11, "stderr": -12}


def _adopt_handles() -> None:
    """Adopt redirected standard handles (pythonw drops them to ``None``).

    This is what makes ``MotionForge Studio.exe --selftest > log.txt`` and the
    installer's output capture work with a GUI-subsystem executable.
    """
    if os.name != "nt":
        return
    import ctypes
    import io
    for name, ident in STD_HANDLES.items():
        if getattr(sys, name) is not None:
            continue
        try:
            handle = ctypes.windll.kernel32.GetStdHandle(ident)
            if not handle or handle == -1:
                continue
            fd = ctypes.msvcrt.open_osfhandle(handle, 0)
            mode = "r" if ident == -10 else "w"
            stream = io.open(fd, mode, encoding="utf-8", errors="replace",
                             buffering=1, closefd=False)
            setattr(sys, name, stream)
        except Exception:
            continue


def _attach_console() -> bool:
    """Give the GUI process a console when it was started from a terminal."""
    if os.name != "nt":
        return sys.stdout is not None
    _adopt_handles()
    if sys.stdout is not None and sys.stderr is not None:
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        if not kernel32.AttachConsole(ctypes.c_uint32(-1).value):
            kernel32.AllocConsole()
        sys.stdout = open("CONOUT$", "w", encoding="utf-8", buffering=1, errors="replace")
        sys.stderr = open("CONOUT$", "w", encoding="utf-8", buffering=1, errors="replace")
        sys.stdin = open("CONIN$", "r", encoding="utf-8", errors="replace")
        return True
    except Exception:
        return False


def _wants_console(argv: list[str]) -> bool:
    flags = ("--selftest", "--render", "--help", "-h", "--version", "--check", "--paths")
    return any(a in flags for a in argv[1:])


def _crash_log(text: str) -> str:
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    folder = os.path.join(base, "MotionForgeStudio", "logs")
    try:
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "crash.log")
        with open(path, "a", encoding="utf-8") as fh:
            import time
            fh.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n{text}\n")
        return path
    except OSError:
        return ""


def _watched() -> bool:
    """True when a console, pipe or file is attached to our output.

    A dialog must not be opened in that case: on a build agent or inside a
    scripted run there is nobody to click it away.
    """
    if os.name != "nt":
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        for ident in (-10, -11, -12):
            handle = kernel32.GetStdHandle(ident)
            if handle not in (0, -1, None):
                return True
    except Exception:
        return True
    return False


def _report(text: str) -> None:
    log = _crash_log(text)
    tail = text.strip().splitlines()[-12:]
    message = "MotionForge Studio could not start.\n\n" + "\n".join(tail)
    if log:
        message += f"\n\nA full report was written to:\n{log}"
    try:
        sys.stderr.write(message + "\n")
    except Exception:
        pass
    if _watched():
        return
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, f"{APP_NAME} - startup error", 0x10)
    except Exception:
        pass


def main(argv: list[str]) -> int:
    _bootstrap_paths()
    if _wants_console(argv):
        _attach_console()
    if "--version" in argv:
        from mfs import APP_NAME as name, __version__
        print(f"{name} {__version__}")
        return 0
    if "--paths" in argv:
        print(f"home     : {ROOT}")
        print(f"python   : {sys.version}")
        print(f"package  : {os.path.join(ROOT, 'app')}")
        print(f"libraries: {os.path.join(ROOT, 'lib')}")
        return 0
    from mfs.app import main as app_main
    return app_main(argv)


if __name__ == "__main__":
    try:
        raise SystemExit(main(list(sys.argv)))
    except SystemExit:
        raise
    except KeyboardInterrupt:
        raise SystemExit(130)
    except BaseException:  # noqa: BLE001 - last resort, must never be silent
        _report(traceback.format_exc())
        raise SystemExit(1)
