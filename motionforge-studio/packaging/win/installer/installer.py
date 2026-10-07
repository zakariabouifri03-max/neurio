"""MotionForge Studio - Windows installer / uninstaller.

One executable handles both jobs:

    MotionForge-Studio-Setup-1.0.0.exe                graphical setup
    ... /silent [/dir "C:\\Apps\\MotionForge"]        unattended setup
    ... /portable                                     extract only, no registry
    ... --uninstall --dir <install dir>               remove everything

The installer is self contained: the whole application (embedded CPython, Qt,
libraries, app code) travels inside ``payload.py`` as the very same ZIP that is
published as the portable download, so what you install is byte for byte what
you can also unzip by hand.

Everything is written per user (``%LOCALAPPDATA%\\Programs``), so no
administrator rights are needed, and the uninstaller is registered under
``HKCU\\...\\Uninstall`` so it shows up in *Apps & features*.
"""
from __future__ import annotations

import ctypes
import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile

APP_NAME = "MotionForge Studio"
APP_EXE = "MotionForge Studio.exe"
PUBLISHER = "MotionForge Labs"
APP_ID = "MotionForgeStudio"
EXE_NAME_SETUP = "MotionForge-Studio-Setup"
FILE_EXT = ".mfs"
PROG_ID = "MotionForge.Project"

try:
    import payload as _payload
    PAYLOAD_ZIP = getattr(_payload, "PAYLOAD_ZIP", b"")
    PAYLOAD_NAME = getattr(_payload, "PAYLOAD_NAME", "MotionForge-Studio-portable.zip")
except Exception:  # pragma: no cover - running without a payload
    PAYLOAD_ZIP = b""
    PAYLOAD_NAME = "MotionForge-Studio-portable.zip"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def app_version() -> str:
    try:
        from mfs import __version__          # noqa: WPS433
        return __version__
    except Exception:
        return "1.0.0"


def default_install_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Programs", APP_NAME)


def is_windows() -> bool:
    return os.name == "nt"


def _log(msg: str, sink=None) -> None:
    if sink is not None:
        sink(msg)
    else:
        try:
            print(msg, flush=True)
        except Exception:
            pass


def human(size: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}".replace(".0 ", " ")
        size /= 1024.0
    return f"{size:.1f} GB"


# ---------------------------------------------------------------------------
# shortcuts (IShellLink through ctypes - no external dependencies)
# ---------------------------------------------------------------------------
class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, text: str) -> "_GUID":
        text = text.strip("{}")
        parts = text.split("-")
        g = cls()
        g.Data1 = int(parts[0], 16)
        g.Data2 = int(parts[1], 16)
        g.Data3 = int(parts[2], 16)
        tail = parts[3] + parts[4]
        for i in range(8):
            g.Data4[i] = int(tail[2 * i:2 * i + 2], 16)
        return g


CLSID_SHELLLINK = _GUID.parse("00021401-0000-0000-C000-000000000046")
IID_ISHELLLINKW = _GUID.parse("000214F9-0000-0000-C000-000000000046")
IID_IPERSISTFILE = _GUID.parse("0000010B-0000-0000-C000-000000000046")
CLSCTX_INPROC_SERVER = 1


def _method(ptr, index, restype, argtypes):
    vtable = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    return proto(vtable[index])


def create_shortcut(path: str, target: str, arguments: str = "", workdir: str = "",
                    icon: str = "", description: str = "") -> bool:
    """Create a .lnk file.  Returns True on success."""
    if not is_windows():
        return False
    ole32 = ctypes.windll.ole32
    try:
        ole32.CoInitialize(None)
    except Exception:
        pass
    link = ctypes.c_void_p()
    try:
        hr = ole32.CoCreateInstance(ctypes.byref(CLSID_SHELLLINK), None, CLSCTX_INPROC_SERVER,
                                    ctypes.byref(IID_ISHELLLINKW), ctypes.byref(link))
        if hr != 0 or not link:
            return _powershell_shortcut(path, target, arguments, workdir, icon, description)
        set_path = _method(link, 20, ctypes.c_long, [ctypes.c_wchar_p])
        set_args = _method(link, 11, ctypes.c_long, [ctypes.c_wchar_p])
        set_work = _method(link, 9, ctypes.c_long, [ctypes.c_wchar_p])
        set_desc = _method(link, 7, ctypes.c_long, [ctypes.c_wchar_p])
        set_icon = _method(link, 17, ctypes.c_long, [ctypes.c_wchar_p, ctypes.c_int])
        set_path(link, target)
        if arguments:
            set_args(link, arguments)
        if workdir:
            set_work(link, workdir)
        if description:
            set_desc(link, description)
        if icon:
            set_icon(link, icon, 0)
        persist = ctypes.c_void_p()
        hr = _method(link, 0, ctypes.c_long,
                     [ctypes.POINTER(_GUID), ctypes.POINTER(ctypes.c_void_p)])(
            link, ctypes.byref(IID_IPERSISTFILE), ctypes.byref(persist))
        if hr != 0 or not persist:
            return _powershell_shortcut(path, target, arguments, workdir, icon, description)
        save = _method(persist, 6, ctypes.c_long, [ctypes.c_wchar_p, ctypes.c_int])
        ok = save(persist, path, 1) == 0
        _method(persist, 2, ctypes.c_ulong, [])()
        _method(link, 2, ctypes.c_ulong, [])()
        return bool(ok)
    except Exception:
        return _powershell_shortcut(path, target, arguments, workdir, icon, description)


def _powershell_shortcut(path: str, target: str, arguments: str, workdir: str,
                         icon: str, description: str) -> bool:
    """Fallback shortcut creation that works on every Windows install."""
    if not is_windows():
        return False
    ps = (
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');"
        "$s.TargetPath='%s';" % (path.replace("'", "''"), target.replace("'", "''"))
    )
    if arguments:
        ps += "$s.Arguments='%s';" % arguments.replace("'", "''")
    if workdir:
        ps += "$s.WorkingDirectory='%s';" % workdir.replace("'", "''")
    if icon:
        ps += "$s.IconLocation='%s';" % icon.replace("'", "''")
    if description:
        ps += "$s.Description='%s';" % description.replace("'", "''")
    ps += "$s.Save()"
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       check=False, timeout=60,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return os.path.exists(path)
    except Exception:
        return False


def start_menu_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)


def desktop_dir() -> str:
    try:
        buf = ctypes.create_unicode_buffer(512)
        ctypes.windll.shell32.SHGetFolderPathW(None, 0, None, 0, buf)
        if buf.value:
            return buf.value
    except Exception:
        pass
    return os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Desktop")


def notify_shell() -> None:
    try:
        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0x1000, None, None)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------
def _winreg():
    import winreg
    return winreg


def register_install(install_dir: str, version: str, size: int) -> None:
    if not is_windows():
        return
    winreg = _winreg()
    exe = os.path.join(install_dir, APP_EXE)
    uninstaller = os.path.join(install_dir, "Uninstall.exe")
    key_path = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
        def setv(name, value, kind=winreg.REG_SZ):
            winreg.SetValueEx(key, name, 0, kind, value)
        setv("DisplayName", APP_NAME)
        setv("DisplayVersion", version)
        setv("Publisher", PUBLISHER)
        setv("DisplayIcon", f"{exe},0")
        setv("InstallLocation", install_dir)
        setv("UninstallString", f'"{uninstaller}" --uninstall --dir "{install_dir}"')
        setv("QuietUninstallString", f'"{uninstaller}" --uninstall --silent --dir "{install_dir}"')
        setv("InstallDate", time.strftime("%Y%m%d"))
        setv("EstimatedSize", int(max(0, size // 1024)), winreg.REG_DWORD)
        setv("NoModify", 1, winreg.REG_DWORD)
        setv("NoRepair", 1, winreg.REG_DWORD)
        setv("URLInfoAbout", "https://github.com/zakariabouifri03-max/neurio")
    # .mfs file association
    classes = r"Software\Classes"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,
                            rf"{classes}\{PROG_ID}\shell\open\command", 0,
                            winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f'"{exe}" "%1"')
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, rf"{classes}\{PROG_ID}\DefaultIcon", 0,
                            winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f"{exe},0")
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, rf"{classes}\{PROG_ID}", 0,
                            winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "MotionForge Studio project")
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, rf"{classes}\{FILE_EXT}", 0,
                            winreg.KEY_WRITE) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, PROG_ID)
    notify_shell()


def unregister_install() -> None:
    if not is_windows():
        return
    winreg = _winreg()
    def drop(path):
        try:
            winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, path, winreg.KEY_WRITE)
        except OSError:
            pass
        try:                       # a subkey may still be there - walk down
            sub, _i, _j = winreg.QueryInfoKey(
                winreg.OpenKey(winreg.HKEY_CURRENT_USER, path))
        except OSError:
            return
        _ = sub
    def remove_tree(path):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_ALL_ACCESS) as key:
                while True:
                    try:
                        sub = winreg.EnumKey(key, 0)
                    except OSError:
                        break
                    remove_tree(path + "\\" + sub)
        except OSError:
            return
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
        except OSError:
            pass
    _ = drop
    remove_tree(rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_NAME}")
    remove_tree(rf"Software\Classes\{PROG_ID}")
    # only drop the extension key when it still points at us
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{FILE_EXT}") as key:
            value, _kind = winreg.QueryValueEx(key, "")
        if value == PROG_ID:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{FILE_EXT}")
    except OSError:
        pass
    notify_shell()


# ---------------------------------------------------------------------------
# install / uninstall work
# ---------------------------------------------------------------------------
def extract_payload(install_dir: str, progress=None, dry_run: bool = False) -> int:
    """Unpack the embedded portable build; returns the number of files written."""
    if not PAYLOAD_ZIP:
        raise RuntimeError("this installer was built without an application payload")
    os.makedirs(install_dir, exist_ok=True)
    written = 0
    with zipfile.ZipFile(io.BytesIO(PAYLOAD_ZIP)) as zf:
        infos = zf.infolist()
        total = len(infos)
        root = os.path.basename(install_dir.rstrip("\\/"))
        for i, info in enumerate(infos):
            if info.is_dir():
                continue
            name = info.filename
            # the archive holds "<App folder>/..." - install it flat
            if "/" in name:
                head, rest = name.split("/", 1)
                if rest:
                    name = rest
                if head != root and not rest:
                    continue
            target = os.path.join(install_dir, *name.split("/"))
            if dry_run:
                written += 1
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 512)
            written += 1
            if progress and (i % 25 == 0 or i == total - 1):
                progress(i + 1, total, name)
    return written


def make_shortcuts(install_dir: str, desktop: bool = True, start_menu: bool = True,
                   version: str = "") -> list[str]:
    exe = os.path.join(install_dir, APP_EXE)
    icon = os.path.join(install_dir, "motionforge.ico")
    made = []
    if desktop:
        path = os.path.join(desktop_dir(), f"{APP_NAME}.lnk")
        if create_shortcut(path, exe, "", install_dir, icon, f"{APP_NAME} {version}".strip()):
            made.append(path)
    if start_menu:
        folder = start_menu_dir()
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{APP_NAME}.lnk")
        if create_shortcut(path, exe, "", install_dir, icon, f"{APP_NAME} {version}".strip()):
            made.append(path)
        uninstaller = os.path.join(install_dir, "Uninstall.exe")
        if os.path.exists(uninstaller):
            upath = os.path.join(folder, f"Uninstall {APP_NAME}.lnk")
            if create_shortcut(upath, uninstaller, f'--uninstall --dir "{install_dir}"',
                              install_dir, icon, f"Remove {APP_NAME}"):
                made.append(upath)
    return made


def remove_shortcuts() -> None:
    desktop_link = os.path.join(desktop_dir(), f"{APP_NAME}.lnk")
    for path in (desktop_link,):
        try:
            os.remove(path)
        except OSError:
            pass
    shutil.rmtree(start_menu_dir(), ignore_errors=True)


def install(install_dir: str, version: str, desktop: bool = True, start_menu: bool = True,
            progress=None, portable: bool = False, log=None) -> dict:
    """Full install: files, shortcuts, registry, uninstaller, self test."""
    result = {"dir": install_dir, "files": 0, "shortcuts": [], "selftest": None}
    if log:
        log(f"Installing to {install_dir}")
    result["files"] = extract_payload(install_dir, progress=progress)
    if log:
        log(f"{result['files']} files written")
    # the uninstaller is a copy of this very executable
    try:
        me = sys.executable
        target = os.path.join(install_dir, "Uninstall.exe")
        shutil.copy2(me, target)
        if log:
            log("Uninstaller installed")
        result["shortcuts"] = make_shortcuts(install_dir, desktop, start_menu, version)
        if log:
            log(f"{len(result['shortcuts'])} shortcut(s) created")
    except OSError as exc:
        if log:
            log(f"warning: {exc}")
    if not portable:
        try:
            size = sum(os.path.getsize(os.path.join(b, f))
                       for b, _d, fs in os.walk(install_dir) for f in fs)
        except OSError:
            size = 0
        register_install(install_dir, version, size)
        if log:
            log("Registered in Apps & features")
    result["selftest"] = run_selftest(install_dir, log)
    return result


def run_selftest(install_dir: str, log=None) -> dict:
    exe = os.path.join(install_dir, APP_EXE)
    if not os.path.exists(exe):
        return {"ok": False, "output": "executable missing"}
    try:
        proc = subprocess.run([exe, "--selftest"], capture_output=True, text=True, timeout=300,
                              cwd=install_dir,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        out = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0 and "RESULT: OK" in out
        if log:
            log("Self test: " + ("OK" if ok else f"failed (exit {proc.returncode})"))
            for line in out.strip().splitlines()[-6:]:
                log("   " + line)
        return {"ok": ok, "output": out}
    except Exception as exc:
        if log:
            log(f"Self test could not run: {exc}")
        return {"ok": False, "output": str(exc)}


def uninstall(install_dir: str, log=None, cleanup_exe: str = "", silent: bool = False) -> bool:
    if log:
        log(f"Removing {install_dir}")
    remove_shortcuts()
    unregister_install()
    keep = {"Uninstall.exe"}
    self_path = os.path.abspath(sys.executable)
    failures = []
    for base, dirs, files in os.walk(install_dir, topdown=False):
        for f in files:
            path = os.path.join(base, f)
            if f in keep or os.path.abspath(path) == self_path:
                continue
            try:
                os.remove(path)
            except OSError as exc:
                failures.append(f"{path}: {exc}")
        for d in dirs:
            try:
                os.rmdir(os.path.join(base, d))
            except OSError:
                pass
    try:
        os.rmdir(install_dir)
    except OSError:
        pass
    if log:
        if failures:
            log(f"{len(failures)} file(s) could not be removed (they may be in use)")
        log("Uninstall complete")
    if cleanup_exe:
        # the copy in %TEMP% removes itself after this process is gone
        try:
            subprocess.Popen(["cmd", "/c", "start", "/b", "", "cmd", "/c",
                              f'timeout /t 2 >nul & del /f /q "{cleanup_exe}"'],
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            pass
    return not failures


def relaunch_from_temp(args: list[str]) -> None:
    """Copy ourselves to %TEMP% and run there (needed to delete our own folder)."""
    temp_exe = os.path.join(tempfile.gettempdir(), f"{APP_ID}-uninstall.exe")
    try:
        shutil.copy2(sys.executable, temp_exe)
    except OSError:
        temp_exe = sys.executable
    cmd = [temp_exe] + args + ["--cleanup", sys.executable]
    subprocess.Popen(cmd, close_fds=True,
                     creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))


# ---------------------------------------------------------------------------
# graphical setup
# ---------------------------------------------------------------------------
class SetupWindow:
    """Small, dependency free Tk wizard: pick a folder, install, done."""

    def __init__(self, version: str, args: dict):
        import tkinter as tk
        from tkinter import filedialog, ttk
        self.tk = tk
        self.ttk = ttk
        self.filedialog = filedialog
        self.version = version
        self.args = args
        self.queue: list[tuple[str, object]] = []
        self.lock = threading.Lock()
        self.root = tk.Tk()
        self.root.title(f"{APP_NAME} {version} Setup")
        self.root.geometry("640x420")
        self.root.resizable(False, False)
        self.install_dir = tk.StringVar(value=args.get("dir") or default_install_dir())
        self.desktop = tk.BooleanVar(value=True)
        self.start_menu = tk.BooleanVar(value=True)
        self.launch = tk.BooleanVar(value=True)
        self._build()
        self.root.after(80, self._pump)

    # -- ui --------------------------------------------------------------
    def _build(self) -> None:
        tk, ttk = self.tk, self.ttk
        head = tk.Frame(self.root, bg="#12141a", height=80)
        head.pack(fill="x")
        tk.Label(head, text=f"{APP_NAME} {self.version}", bg="#12141a", fg="#ffffff",
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", padx=20, pady=(14, 0))
        tk.Label(head, text="Professional 2D animation studio - drawing, rigging, AI animation",
                 bg="#12141a", fg="#9fb4d8", font=("Segoe UI", 9)).pack(anchor="w", padx=20)

        body = tk.Frame(self.root, padx=20, pady=14)
        body.pack(fill="both", expand=True)
        tk.Label(body, text="Install folder", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        row = tk.Frame(body)
        row.pack(fill="x", pady=(2, 10))
        self.dir_entry = tk.Entry(row, textvariable=self.install_dir, font=("Segoe UI", 9))
        self.dir_entry.pack(side="left", fill="x", expand=True, ipady=3)
        tk.Button(row, text="Browse…", command=self._browse).pack(side="left", padx=(6, 0))

        opts = tk.LabelFrame(body, text=" Options ", padx=10, pady=6)
        opts.pack(fill="x")
        tk.Checkbutton(opts, text="Create a desktop shortcut",
                       variable=self.desktop).grid(row=0, column=0, sticky="w")
        tk.Checkbutton(opts, text="Add to the Start menu (with an uninstall shortcut)",
                       variable=self.start_menu).grid(row=1, column=0, sticky="w")
        tk.Checkbutton(opts, text=f"Launch {APP_NAME} when setup finishes",
                       variable=self.launch).grid(row=2, column=0, sticky="w")

        self.status = tk.Label(body, text="Ready to install.", anchor="w",
                               font=("Segoe UI", 9))
        self.status.pack(fill="x", pady=(10, 2))
        self.progress = ttk.Progressbar(body, mode="determinate", maximum=100)
        self.progress.pack(fill="x")
        self.log_box = tk.Text(body, height=8, font=("Consolas", 8), bg="#0f1116",
                               fg="#c8d4e8", relief="flat", state="disabled")
        self.log_box.pack(fill="both", expand=True, pady=(8, 0))

        buttons = tk.Frame(self.root, padx=20, pady=12)
        buttons.pack(fill="x")
        self.install_btn = tk.Button(buttons, text="Install", width=14,
                                     command=self._start, font=("Segoe UI", 9, "bold"))
        self.install_btn.pack(side="right")
        self.close_btn = tk.Button(buttons, text="Cancel", width=10, command=self.root.destroy)
        self.close_btn.pack(side="right", padx=(0, 8))
        self.uninstall_btn = None
        if self.args.get("uninstall"):
            self.install_btn.configure(text="Remove", command=self._start)

    def _browse(self) -> None:
        path = self.filedialog.askdirectory(title="Choose the install folder",
                                           initialdir=os.path.dirname(self.install_dir.get()))
        if path:
            self.install_dir.set(os.path.join(path, APP_NAME))

    # -- logging / progress ----------------------------------------------
    def log(self, message: str) -> None:
        with self.lock:
            self.queue.append(("log", message))

    def progress_cb(self, done: int, total: int, name: str) -> None:
        with self.lock:
            self.queue.append(("progress", (done, total, name)))

    def _pump(self) -> None:
        with self.lock:
            items, self.queue = self.queue, []
        for kind, value in items:
            if kind == "log":
                self.log_box.configure(state="normal")
                self.log_box.insert("end", str(value) + "\n")
                self.log_box.see("end")
                self.log_box.configure(state="disabled")
            elif kind == "progress":
                done, total, name = value  # type: ignore[misc]
                self.progress.configure(value=int(done * 100 / max(1, total)))
                self.status.configure(text=f"Installing… {done}/{total}  {name[-52:]}")
            elif kind == "done":
                self._finish(value)  # type: ignore[arg-type]
        self.root.after(80, self._pump)

    # -- work ------------------------------------------------------------
    def _start(self) -> None:
        self.install_btn.configure(state="disabled")
        self.close_btn.configure(state="disabled")
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self) -> None:
        target = self.install_dir.get().strip() or default_install_dir()
        try:
            if self.args.get("uninstall"):
                ok = uninstall(target, log=self.log, silent=False)
                with self.lock:
                    self.queue.append(("done", {"uninstall": True, "ok": ok, "dir": target}))
                return
            result = install(target, self.version, desktop=self.desktop.get(),
                             start_menu=self.start_menu.get(), progress=self.progress_cb,
                             portable=bool(self.args.get("portable")), log=self.log)
            with self.lock:
                self.queue.append(("done", result))
        except Exception as exc:  # noqa: BLE001 - report instead of dying silently
            import traceback
            self.log(f"ERROR: {exc}")
            self.log(traceback.format_exc())
            with self.lock:
                self.queue.append(("done", {"error": str(exc)}))

    def _finish(self, result: dict) -> None:
        self.close_btn.configure(state="normal", text="Close")
        if result.get("uninstall"):
            self.status.configure(text="Removed." if result.get("ok") else "Removed with warnings.")
            self.install_btn.configure(state="disabled")
            return
        if result.get("error"):
            self.status.configure(text="Setup failed - see the log above.")
            self.log(f"Failed: {result['error']}")
            self.install_btn.configure(state="normal", text="Retry")
            return
        self.progress.configure(value=100)
        ok = (result.get("selftest") or {}).get("ok")
        self.status.configure(text=("Installed. Self test passed." if ok else
                                    "Installed - the self test reported a problem."))
        self.log(f"Shortcuts: {len(result.get('shortcuts', []))}")
        self.install_btn.configure(state="disabled", text="Installed")
        if self.launch.get() and not self.args.get("portable"):
            exe = os.path.join(result["dir"], APP_EXE)
            if os.path.exists(exe):
                try:
                    subprocess.Popen([exe], cwd=result["dir"],
                                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
                    self.log("Launched " + APP_EXE)
                except Exception as exc:
                    self.log(f"Could not launch: {exc}")

    def run(self) -> int:
        self.root.mainloop()
        return 0


# ---------------------------------------------------------------------------
# command line
# ---------------------------------------------------------------------------
def parse_args(argv: list[str]) -> dict:
    args = {"silent": False, "dir": "", "portable": False, "uninstall": False,
            "cleanup": "", "desktop": True, "start_menu": True, "launch": False}
    i = 1
    while i < len(argv):
        a = argv[i]
        low = a.lower()
        if low in ("/silent", "/s", "--silent", "-s"):
            args["silent"] = True
        elif low in ("--uninstall", "/uninstall", "/remove"):
            args["uninstall"] = True
        elif low in ("/portable", "--portable"):
            args["portable"] = True
        elif low in ("/dir", "--dir", "/d") and i + 1 < len(argv):
            i += 1
            args["dir"] = argv[i]
        elif low in ("/cleanup", "--cleanup") and i + 1 < len(argv):
            i += 1
            args["cleanup"] = argv[i]
        elif low in ("/nodesktop", "--no-desktop"):
            args["desktop"] = False
        elif low in ("/nostartmenu", "--no-start-menu"):
            args["start_menu"] = False
        i += 1
    return args


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    args = parse_args(argv)
    version = app_version()
    target = args["dir"] or default_install_dir()

    if args["silent"]:
        _log(f"{APP_NAME} {version} - silent setup")
        if args["uninstall"]:
            if is_windows() and os.path.abspath(sys.executable).lower().startswith(
                    os.path.abspath(target).lower()):
                relaunch_from_temp(["--uninstall", "--silent", "--dir", target])
                return 0
            ok = uninstall(target, log=_log, cleanup_exe=args["cleanup"], silent=True)
            return 0 if ok else 1
        result = install(target, version, desktop=args["desktop"], start_menu=args["start_menu"],
                         progress=lambda d, t, n: None, portable=args["portable"], log=_log)
        return 0 if (result.get("selftest") or {}).get("ok", True) else 1

    if not is_windows():
        _log("The graphical setup runs on Windows only; use --silent for a console install.")
        return 2
    if args["uninstall"] and os.path.abspath(sys.executable).lower().startswith(
            os.path.abspath(target).lower()):
        # we cannot delete the folder we are running from - do it from %TEMP%
        relaunch_from_temp(["--uninstall", "--dir", target])
        return 0
    try:
        window = SetupWindow(version, args)
    except Exception as exc:   # no display / tkinter missing
        _log(f"Graphical setup unavailable ({exc}); falling back to silent install.")
        result = install(target, version, progress=lambda d, t, n: None, log=_log)
        return 0 if (result.get("selftest") or {}).get("ok", True) else 1
    return window.run()


if __name__ == "__main__":
    raise SystemExit(main())
