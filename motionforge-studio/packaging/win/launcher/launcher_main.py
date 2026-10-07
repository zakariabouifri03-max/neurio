"""MotionForge Studio - the program the user actually starts.

This tiny executable is built by PyInstaller (see ``tools/build_win.py``) and
sits next to the studio's portable runtime folder.  It does not contain the
studio itself: it finds the interpreter that ships in the same folder and hands
the work over to it, so the window, the canvas and the exporter run on the
bundled CPython + Qt without anything being installed on the machine.

    MotionForge Studio.exe           double click / GUI
    MotionForge Studio.exe --selftest   prints a report, returns its exit code

The console runtime is used automatically whenever a switch is passed that
writes to stdout, which keeps ``--render``, ``--selftest`` and ``--version``
usable from a terminal or a build script.
"""
from __future__ import annotations

import os
import subprocess
import sys

GUI_RUNTIME = "MotionForge runtime.exe"
CONSOLE_RUNTIME = "MotionForge runtime console.exe"
SCRIPT = "MotionForge.py"

#: switches that talk to the console instead of opening the editor
CONSOLE_FLAGS = ("--selftest", "--render", "--version", "--paths", "--check",
                 "--help", "-h", "-?")


def _home() -> str:
    return os.path.dirname(os.path.abspath(sys.executable))


def _fail(message: str) -> int:
    """Report a broken installation.  The GUI build has no console of its own."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "MotionForge Studio", 0x10)
    except Exception:
        sys.stderr.write(message + "\n")
    return 1


def _interpreter(home: str, console: bool) -> str | None:
    order = ((CONSOLE_RUNTIME, GUI_RUNTIME) if console
             else (GUI_RUNTIME, CONSOLE_RUNTIME))
    for name in order:
        path = os.path.join(home, name)
        if os.path.exists(path):
            return path
    return None


def main(argv: list[str]) -> int:
    home = _home()
    console = any(arg in CONSOLE_FLAGS for arg in argv[1:])
    runtime = _interpreter(home, console)
    if runtime is None:
        return _fail(
            "The MotionForge Studio runtime is missing from\n\n"
            f"{home}\n\n"
            "This usually means the portable folder was not unpacked "
            "completely.  Please unpack the ZIP again and keep the whole "
            "folder together.")
    script = os.path.join(home, SCRIPT)
    if not os.path.exists(script):
        return _fail(f"{SCRIPT} is missing from\n\n{home}\n\nThe installation "
                     "looks incomplete - please reinstall MotionForge Studio.")
    cmd = [runtime, script] + list(argv[1:])
    try:
        return subprocess.call(cmd, cwd=home)
    except OSError as exc:
        return _fail(f"MotionForge Studio could not be started:\n\n{exc}")


if __name__ == "__main__":
    sys.exit(main(sys.argv))
