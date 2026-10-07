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


def _watched() -> bool:
    """True when somebody can see our output (a console, a pipe or a file).

    A dialog must never be opened in that case: on a build agent or in a script
    there is nobody to click it and the process would hang until it is killed.
    """
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        for ident in (-10, -11, -12):        # stdin, stdout, stderr
            handle = kernel32.GetStdHandle(ident)
            if handle not in (0, -1, None):
                return True
    except Exception:
        return True
    return False


def _fail(message: str) -> int:
    """Report a broken installation, on screen when possible and in a log always."""
    written = ""
    try:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        folder = os.path.join(base, "MotionForgeStudio", "logs")
        os.makedirs(folder, exist_ok=True)
        written = os.path.join(folder, "launcher.log")
        with open(written, "a", encoding="utf-8") as fh:
            fh.write(message + "\n")
    except OSError:
        written = ""
    if written:
        message += f"\n\nDetails were written to\n{written}"
    try:
        sys.stderr.write(message + "\n")
    except Exception:
        pass
    if not _watched():
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, message, "MotionForge Studio", 0x10)
        except Exception:
            pass
    return 1


def _child_stdio() -> dict:
    """Hand the inherited standard handles to the child process.

    A windowed programme has no console, so Windows would give the child a brand
    new - invisible - one and everything the application prints (``--selftest``,
    ``--render``, ``--version``) would disappear.  Reusing the handles we
    inherited keeps redirection such as ``MotionForge Studio.exe --selftest >
    log.txt`` and any build-script capture working.
    """
    stdio: dict = {}
    try:
        import ctypes
        import msvcrt
        kernel32 = ctypes.windll.kernel32
        for name, ident, flags in (("stdin", -10, os.O_RDONLY),
                                   ("stdout", -11, os.O_WRONLY),
                                   ("stderr", -12, os.O_WRONLY)):
            handle = kernel32.GetStdHandle(ident)
            if handle in (0, -1, None):
                continue
            stdio[name] = msvcrt.open_osfhandle(handle, flags)
    except Exception:
        return {}
    return stdio


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
        return subprocess.call(cmd, cwd=home, **_child_stdio())
    except OSError as exc:
        return _fail(f"MotionForge Studio could not be started with\n\n{cmd[0]}\n\n{exc}")
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main(sys.argv))
