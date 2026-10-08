"""Neurio Coder: a local-first desktop coding assistant for Windows.

The app talks to the local Ollama command-line program only. It has no cloud
backend, API key, telemetry, or automatic code execution.
"""
from __future__ import annotations

import codecs
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from core import parse_generated_files, parse_ollama_models, safe_workspace_target, workspace_context


APP_NAME = "Neurio Coder"
DEFAULT_MODEL = "qwen2.5-coder:3b"
MODEL_NAME_RE = re.compile(r"[A-Za-z0-9._:/-]+")
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

COLORS = {
    "bg": "#0b1020",
    "sidebar": "#0e1728",
    "panel": "#111c2e",
    "panel2": "#172439",
    "input": "#0c1525",
    "border": "#24334a",
    "text": "#eef4ff",
    "muted": "#97a8c1",
    "accent": "#66e4bd",
    "accent_dark": "#102f2d",
    "blue": "#8dbbff",
    "warning": "#f4c879",
    "red": "#ff8585",
}

SYSTEM_PROMPT = """You are Neurio Coder, a careful senior coding partner running on the user's own computer.
You have no internet access. Work with the user's request and the supplied workspace context only.
Do not ask for or add cloud API keys, remote AI services, telemetry, or network calls. Prefer simple local code and explain any dependency that is genuinely needed.

When the task asks you to create or change code, return a short explanation followed by one block for every file that should be created or updated, in exactly this format:
<file path="relative/path/to/file.ext">
raw complete file contents here
</file>
Do not put Markdown fences around the contents inside a file block. Use paths relative to the workspace; never use an absolute path or '..'. Return complete file contents, not partial diffs. If the user is asking a question rather than requesting code, answer normally and do not invent files.

Keep explanations concise and in the language/style of the user's request. Use clear English names in source code. Do not claim that you ran code or tests. Never execute commands or modify files yourself; the desktop app will only save files after the user presses Apply files."""


TEMPLATE_LABELS = [
    "2D Browser Game (Canvas)",
    "Web App (HTML / CSS / JavaScript)",
    "Python Desktop App (Tkinter)",
    "Python Mini Game (Tkinter Canvas)",
]


def project_templates(kind: str) -> dict[str, str]:
    """Return a small dependency-free starter project for the chosen template."""
    if kind == TEMPLATE_LABELS[0]:
        return {
            "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#10182b">
  <title>My Canvas Game</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="game-shell">
    <header><span class="eyebrow">YOUR NEXT BIG IDEA</span><h1>My Canvas Game</h1></header>
    <canvas id="game" aria-label="Game canvas"></canvas>
    <p class="hint">Move with WASD or the arrow keys. Edit <code>game.js</code> to get started.</p>
  </main>
  <script src="game.js"></script>
</body>
</html>
""",
            "style.css": """* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #eef4ff; background: radial-gradient(circle at top, #203554, #0b1020 65%); font: 16px/1.5 system-ui, sans-serif; }
.game-shell { width: min(900px, 100%); text-align: center; }
.eyebrow { color: #66e4bd; font-size: 12px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 6px 0 20px; font-size: clamp(28px, 5vw, 48px); }
canvas { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid #344967; border-radius: 18px; background: #101b2f; box-shadow: 0 24px 80px #0008; }
.hint { color: #a9b9cf; } code { color: #66e4bd; }
""",
            "game.js": """const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const keys = new Set();
const player = { x: 120, y: 120, size: 28, speed: 4 };

function resize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('keydown', event => keys.add(event.key.toLowerCase()));
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
resize();

function frame() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (keys.has('arrowleft') || keys.has('a')) player.x -= player.speed;
  if (keys.has('arrowright') || keys.has('d')) player.x += player.speed;
  if (keys.has('arrowup') || keys.has('w')) player.y -= player.speed;
  if (keys.has('arrowdown') || keys.has('s')) player.y += player.speed;
  player.x = Math.max(player.size, Math.min(width - player.size, player.x));
  player.y = Math.max(player.size, Math.min(height - player.size, player.y));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#15243a';
  for (let x = 20; x < width; x += 40) for (let y = 20; y < height; y += 40) {
    ctx.fillStyle = '#253751'; ctx.fillRect(x, y, 2, 2);
  }
  ctx.fillStyle = '#66e4bd';
  ctx.beginPath(); ctx.roundRect(player.x - player.size / 2, player.y - player.size / 2, player.size, player.size, 8); ctx.fill();
  requestAnimationFrame(frame);
}
frame();
""",
            "README.md": """# My Canvas Game

A tiny, dependency-free HTML Canvas starter. Open `index.html` in a browser. Move the square with WASD or the arrow keys.

Ask Neurio Coder to turn this starter into the game you have in mind. Generated files are only written after you review and press **Apply files**.
""",
        }
    if kind == TEMPLATE_LABELS[1]:
        return {
            "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#10182b">
  <title>My New App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <span class="eyebrow">A FRESH START</span>
    <h1>My New App</h1>
    <p>Your idea starts here. Ask Neurio Coder to build the next feature.</p>
    <button id="action">Try the button</button>
    <p id="message" role="status"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>
""",
            "style.css": """* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #eef4ff; background: radial-gradient(circle at top, #203554, #0b1020 70%); font: 16px/1.5 system-ui, sans-serif; }
.card { width: min(560px, 100%); padding: clamp(28px, 7vw, 56px); border: 1px solid #344967; border-radius: 24px; background: #111c2eee; box-shadow: 0 28px 90px #0008; }
.eyebrow { color: #66e4bd; font-size: 12px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 10px 0; font-size: clamp(32px, 7vw, 54px); }
p { color: #a9b9cf; }
button { margin-top: 12px; padding: 12px 18px; border: 0; border-radius: 12px; color: #0b1722; background: #66e4bd; font: inherit; font-weight: 800; cursor: pointer; }
button:hover { filter: brightness(1.08); }
""",
            "app.js": """const button = document.querySelector('#action');
const message = document.querySelector('#message');
button.addEventListener('click', () => {
  message.textContent = 'It works — now make it yours!';
});
""",
            "README.md": """# My New App

A dependency-free HTML, CSS, and JavaScript starter. Open `index.html` in a browser.

Use Neurio Coder to describe features or changes. Review generated files before applying them.
""",
        }
    if kind == TEMPLATE_LABELS[2]:
        return {
            "main.py": """import tkinter as tk
from tkinter import ttk


def main():
    root = tk.Tk()
    root.title("My Desktop App")
    root.geometry("520x360")
    root.minsize(360, 260)

    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        pass

    frame = ttk.Frame(root, padding=32)
    frame.pack(expand=True, fill="both")
    ttk.Label(frame, text="My Desktop App", font=("Segoe UI", 22, "bold")).pack(anchor="w")
    ttk.Label(frame, text="Tell Neurio Coder what you would like this app to do.").pack(anchor="w", pady=(8, 20))
    status = ttk.Label(frame, text="Ready")
    status.pack(anchor="w", pady=(8, 0))
    ttk.Button(frame, text="Click me", command=lambda: status.config(text="Button clicked!")).pack(anchor="w")
    root.mainloop()


if __name__ == "__main__":
    main()
""",
            "README.md": """# My Desktop App

A standard-library Tkinter desktop app. Run it with `python main.py` on a Python installation that includes Tkinter.

Ask Neurio Coder for new screens or behavior, then review and apply the generated files.
""",
        }
    if kind == TEMPLATE_LABELS[3]:
        return {
            "main.py": """import tkinter as tk

WIDTH, HEIGHT = 720, 440
SPEED = 6


class MiniGame:
    def __init__(self, root):
        root.title("My Mini Game")
        root.configure(bg="#0b1020")
        self.canvas = tk.Canvas(root, width=WIDTH, height=HEIGHT, bg="#142137", highlightthickness=0)
        self.canvas.pack(padx=20, pady=(20, 8))
        self.canvas.create_text(18, 18, anchor="nw", text="Move with WASD or the arrow keys", fill="#b8c8df", font=("Segoe UI", 12))
        self.player = self.canvas.create_oval(80, 180, 116, 216, fill="#66e4bd", outline="")
        self.keys = set()
        root.bind("<KeyPress>", self.key_down)
        root.bind("<KeyRelease>", self.key_up)
        self.step()

    def key_down(self, event):
        self.keys.add(event.keysym.lower())

    def key_up(self, event):
        self.keys.discard(event.keysym.lower())

    def step(self):
        dx = (SPEED if "right" in self.keys or "d" in self.keys else 0) - (SPEED if "left" in self.keys or "a" in self.keys else 0)
        dy = (SPEED if "down" in self.keys or "s" in self.keys else 0) - (SPEED if "up" in self.keys or "w" in self.keys else 0)
        self.canvas.move(self.player, dx, dy)
        x1, y1, x2, y2 = self.canvas.coords(self.player)
        if x1 < 0: self.canvas.move(self.player, -x1, 0)
        if y1 < 42: self.canvas.move(self.player, 0, 42 - y1)
        if x2 > WIDTH: self.canvas.move(self.player, WIDTH - x2, 0)
        if y2 > HEIGHT: self.canvas.move(self.player, 0, HEIGHT - y2)
        self.canvas.after(16, self.step)


if __name__ == "__main__":
    window = tk.Tk()
    MiniGame(window)
    window.mainloop()
""",
            "README.md": """# My Mini Game

A tiny desktop game using only the Python standard library and Tkinter. Start it with `python main.py`.

Ask Neurio Coder to add the rules, levels, art, or controls you want.
""",
        }
    raise ValueError("Unknown project template.")


class NeurioCoderApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.events: queue.Queue = queue.Queue()
        self.workspace: Path | None = None
        self.installed_models: list[str] = []
        self.conversation: list[tuple[str, str]] = []
        self.last_answer = ""
        self.current_output = ""
        self.process: subprocess.Popen | None = None
        self.busy = False
        self.cancel_requested = threading.Event()

        self.root.title(f"{APP_NAME} — local code studio")
        self.root.geometry("1160x790")
        self.root.minsize(850, 630)
        self.root.configure(bg=COLORS["bg"])
        self._configure_styles()
        self._build_ui()
        self._show_welcome()
        self.root.after(100, self._drain_events)
        self.root.after(350, self.refresh_models)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _configure_styles(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "TCombobox",
            fieldbackground=COLORS["input"],
            background=COLORS["panel2"],
            foreground=COLORS["text"],
            arrowcolor=COLORS["accent"],
            bordercolor=COLORS["border"],
            lightcolor=COLORS["border"],
            darkcolor=COLORS["border"],
            padding=8,
        )
        style.map(
            "TCombobox",
            fieldbackground=[("readonly", COLORS["input"])],
            foreground=[("readonly", COLORS["text"])],
        )

    def _build_ui(self) -> None:
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        header = tk.Frame(self.root, bg=COLORS["bg"], height=72)
        header.grid(row=0, column=0, sticky="ew", padx=24, pady=(16, 10))
        header.grid_propagate(False)
        brand = tk.Frame(header, bg=COLORS["bg"])
        brand.pack(side="left", fill="y")
        tk.Label(brand, text="N", bg=COLORS["accent"], fg="#09231d", font=("Segoe UI", 17, "bold"), width=2, height=1).pack(side="left", padx=(0, 11), pady=10)
        brand_text = tk.Frame(brand, bg=COLORS["bg"])
        brand_text.pack(side="left", pady=8)
        tk.Label(brand_text, text="NEURIO CODER", bg=COLORS["bg"], fg=COLORS["text"], font=("Segoe UI", 16, "bold")).pack(anchor="w")
        tk.Label(brand_text, text="LOCAL CODE STUDIO", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 8, "bold")).pack(anchor="w")

        badge = tk.Frame(header, bg=COLORS["accent_dark"], padx=12, pady=8)
        badge.pack(side="right", pady=12)
        tk.Label(badge, text="●  LOCAL ONLY  ·  NO API KEY", bg=COLORS["accent_dark"], fg=COLORS["accent"], font=("Segoe UI", 9, "bold")).pack()

        body = tk.Frame(self.root, bg=COLORS["bg"])
        body.grid(row=1, column=0, sticky="nsew", padx=24, pady=(0, 20))
        body.grid_rowconfigure(0, weight=1)
        body.grid_columnconfigure(1, weight=1)

        self.sidebar = tk.Frame(body, bg=COLORS["sidebar"], width=250, highlightthickness=1, highlightbackground=COLORS["border"])
        self.sidebar.grid(row=0, column=0, sticky="nsw", padx=(0, 16))
        self.sidebar.grid_propagate(False)
        self._build_sidebar()

        self.main = tk.Frame(body, bg=COLORS["bg"])
        self.main.grid(row=0, column=1, sticky="nsew")
        self.main.grid_rowconfigure(1, weight=1)
        self.main.grid_columnconfigure(0, weight=1)
        self._build_main()

    def _build_sidebar(self) -> None:
        pad = 18
        tk.Label(self.sidebar, text="WORKSPACE", bg=COLORS["sidebar"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=pad, pady=(20, 10))

        self.workspace_title = tk.Label(self.sidebar, text="No project selected", bg=COLORS["sidebar"], fg=COLORS["text"], font=("Segoe UI", 11, "bold"), anchor="w", wraplength=208)
        self.workspace_title.pack(fill="x", padx=pad)
        self.workspace_path_label = tk.Label(self.sidebar, text="Create a starter or choose a folder", bg=COLORS["sidebar"], fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w", justify="left", wraplength=208)
        self.workspace_path_label.pack(fill="x", padx=pad, pady=(4, 13))

        self._button(self.sidebar, "＋   New project", self.open_new_project, primary=True).pack(fill="x", padx=pad, pady=(0, 8))
        self._button(self.sidebar, "Choose existing folder", self.choose_workspace).pack(fill="x", padx=pad, pady=(0, 8))
        self._button(self.sidebar, "Open folder", self.open_workspace_folder).pack(fill="x", padx=pad, pady=(0, 18))

        self._divider(self.sidebar, pad)
        model_heading = tk.Frame(self.sidebar, bg=COLORS["sidebar"])
        model_heading.pack(fill="x", padx=pad, pady=(17, 7))
        tk.Label(model_heading, text="LOCAL MODEL", bg=COLORS["sidebar"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold")).pack(side="left")
        self.refresh_button = self._button(model_heading, "↻", self.refresh_models, compact=True)
        self.refresh_button.pack(side="right")

        self.model_var = tk.StringVar(value=DEFAULT_MODEL)
        self.model_box = ttk.Combobox(self.sidebar, textvariable=self.model_var, values=[], state="normal", font=("Segoe UI", 10))
        self.model_box.pack(fill="x", padx=pad, pady=(0, 6))
        self.model_box.bind("<Return>", lambda _event: self.on_generate())
        self.model_status = tk.Label(self.sidebar, text="Checking Ollama…", bg=COLORS["sidebar"], fg=COLORS["muted"], font=("Segoe UI", 9), anchor="w", wraplength=208, justify="left")
        self.model_status.pack(fill="x", padx=pad, pady=(0, 16))

        self._divider(self.sidebar, pad)
        guide = tk.Frame(self.sidebar, bg=COLORS["panel"], highlightthickness=1, highlightbackground=COLORS["border"])
        guide.pack(fill="x", padx=pad, pady=(17, 11))
        tk.Label(guide, text="LOCAL SETUP", bg=COLORS["panel"], fg=COLORS["accent"], font=("Segoe UI", 9, "bold")).pack(anchor="w", padx=12, pady=(12, 5))
        tk.Label(guide, text="Install Ollama + one coding model. Prompts stay on this PC.", bg=COLORS["panel"], fg=COLORS["muted"], font=("Segoe UI", 9), wraplength=180, justify="left").pack(anchor="w", padx=12)
        self._button(guide, "Setup instructions", self.show_setup_guide, compact=False).pack(fill="x", padx=10, pady=10)

        safe = tk.Frame(self.sidebar, bg=COLORS["accent_dark"], padx=12, pady=11)
        safe.pack(fill="x", padx=pad, pady=(3, 0))
        tk.Label(safe, text="SAFE BY DEFAULT", bg=COLORS["accent_dark"], fg=COLORS["accent"], font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(safe, text="Code is not run automatically. Review it, then choose Apply files.", bg=COLORS["accent_dark"], fg="#bad6d0", font=("Segoe UI", 9), wraplength=184, justify="left").pack(anchor="w", pady=(5, 0))

        tk.Label(self.sidebar, text="Local model · your files stay yours", bg=COLORS["sidebar"], fg="#6f819b", font=("Segoe UI", 8)).pack(side="bottom", anchor="w", padx=pad, pady=15)

    def _build_main(self) -> None:
        top = tk.Frame(self.main, bg=COLORS["bg"], height=52)
        top.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        top.grid_propagate(False)
        title_area = tk.Frame(top, bg=COLORS["bg"])
        title_area.pack(side="left", fill="y")
        tk.Label(title_area, text="Your coding session", bg=COLORS["bg"], fg=COLORS["text"], font=("Segoe UI", 15, "bold")).pack(anchor="w")
        tk.Label(title_area, text="Build games and apps with a model running on your computer", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9)).pack(anchor="w")
        self.session_status = tk.Label(top, text="READY", bg=COLORS["panel"], fg=COLORS["accent"], padx=11, pady=6, font=("Segoe UI", 8, "bold"))
        self.session_status.pack(side="right", pady=8)

        chat_shell = tk.Frame(self.main, bg=COLORS["panel"], highlightthickness=1, highlightbackground=COLORS["border"])
        chat_shell.grid(row=1, column=0, sticky="nsew")
        chat_shell.grid_rowconfigure(0, weight=1)
        chat_shell.grid_columnconfigure(0, weight=1)
        self.chat = tk.Text(
            chat_shell,
            bg=COLORS["panel"], fg=COLORS["text"], insertbackground=COLORS["accent"],
            selectbackground="#25445a", relief="flat", wrap="word", padx=20, pady=18,
            font=("Segoe UI", 10), spacing1=2, spacing3=3, state="disabled",
        )
        self.chat.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(chat_shell, orient="vertical", command=self.chat.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.chat.configure(yscrollcommand=scrollbar.set)
        self.chat.tag_configure("user_label", foreground=COLORS["accent"], font=("Segoe UI", 10, "bold"), spacing1=12)
        self.chat.tag_configure("assistant_label", foreground=COLORS["blue"], font=("Segoe UI", 10, "bold"), spacing1=12)
        self.chat.tag_configure("body", foreground=COLORS["text"], font=("Segoe UI", 10), lmargin1=2, lmargin2=2, spacing3=8)
        self.chat.tag_configure("muted", foreground=COLORS["muted"], font=("Segoe UI", 9), lmargin1=2, lmargin2=2, spacing3=6)
        self.chat.tag_configure("code", foreground="#d4e6ff", font=("Consolas", 9), lmargin1=12, lmargin2=12, spacing1=4, spacing3=7)

        controls = tk.Frame(self.main, bg=COLORS["bg"])
        controls.grid(row=2, column=0, sticky="ew", pady=(10, 0))
        controls.grid_columnconfigure(0, weight=1)
        settings = tk.Frame(controls, bg=COLORS["bg"])
        settings.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 7))

        self.context_var = tk.BooleanVar(value=True)
        self.context_check = tk.Checkbutton(
            settings, text="Include project source as context", variable=self.context_var,
            bg=COLORS["bg"], fg=COLORS["muted"], activebackground=COLORS["bg"],
            activeforeground=COLORS["text"], selectcolor=COLORS["panel"],
            font=("Segoe UI", 9), highlightthickness=0,
        )
        self.context_check.pack(side="left")
        tk.Label(settings, text="Save single-file reply as", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9)).pack(side="left", padx=(16, 7))
        self.target_var = tk.StringVar(value="main.py")
        self.target_entry = tk.Entry(
            settings, textvariable=self.target_var, bg=COLORS["input"], fg=COLORS["text"],
            insertbackground=COLORS["accent"], relief="flat", font=("Consolas", 9),
            highlightthickness=1, highlightbackground=COLORS["border"], highlightcolor=COLORS["accent"], width=22,
        )
        self.target_entry.pack(side="left", ipady=6)

        input_shell = tk.Frame(controls, bg=COLORS["input"], highlightthickness=1, highlightbackground=COLORS["border"])
        input_shell.grid(row=1, column=0, sticky="ew")
        input_shell.grid_columnconfigure(0, weight=1)
        self.prompt_input = tk.Text(
            input_shell, height=4, bg=COLORS["input"], fg=COLORS["text"], insertbackground=COLORS["accent"],
            selectbackground="#25445a", relief="flat", wrap="word", padx=13, pady=11,
            font=("Segoe UI", 10),
        )
        self.prompt_input.grid(row=0, column=0, sticky="nsew")
        self.prompt_input.insert("1.0", "Describe a game or app you want to build…")
        self.prompt_input.configure(fg=COLORS["muted"])
        self.prompt_input.bind("<FocusIn>", self._clear_placeholder)
        self.prompt_input.bind("<Control-Return>", self._send_shortcut)

        button_row = tk.Frame(controls, bg=COLORS["bg"])
        button_row.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(9, 0))
        button_row.grid_columnconfigure(0, weight=1)
        left_buttons = tk.Frame(button_row, bg=COLORS["bg"])
        left_buttons.grid(row=0, column=0, sticky="w")
        self.clear_button = self._button(left_buttons, "Clear chat", self.clear_chat)
        self.clear_button.pack(side="left", padx=(0, 7))
        self.copy_button = self._button(left_buttons, "Copy answer", self.copy_answer)
        self.copy_button.pack(side="left", padx=(0, 7))
        self.apply_button = self._button(left_buttons, "Apply files", self.apply_files)
        self.apply_button.pack(side="left")

        right_buttons = tk.Frame(button_row, bg=COLORS["bg"])
        right_buttons.grid(row=0, column=1, sticky="e")
        self.stop_button = self._button(right_buttons, "Stop", self.stop_generation, danger=True)
        self.generate_button = self._button(right_buttons, "Generate code  ↗", self.on_generate, primary=True)
        self.stop_button.pack(side="left", padx=(0, 8))
        self.generate_button.pack(side="left")
        self.stop_button.configure(state="disabled")
        self.apply_button.configure(state="disabled")

    def _button(self, parent, text, command, primary=False, danger=False, compact=False):
        bg = COLORS["accent"] if primary else ("#472229" if danger else COLORS["panel2"])
        fg = "#09231d" if primary else ("#ffb5b5" if danger else COLORS["text"])
        padx, pady = (9, 5) if compact else (12, 8)
        return tk.Button(
            parent, text=text, command=command, bg=bg, fg=fg,
            activebackground=("#82f0ce" if primary else COLORS["border"]),
            activeforeground=fg, relief="flat", borderwidth=0, padx=padx, pady=pady,
            cursor="hand2", font=("Segoe UI", 9, "bold" if primary else "normal"),
            disabledforeground="#607086",
        )

    @staticmethod
    def _divider(parent, padx: int) -> None:
        tk.Frame(parent, bg=COLORS["border"], height=1).pack(fill="x", padx=padx)

    def _clear_placeholder(self, _event=None) -> None:
        if self.prompt_input.get("1.0", "end-1c") == "Describe a game or app you want to build…":
            self.prompt_input.delete("1.0", "end")
            self.prompt_input.configure(fg=COLORS["text"])

    def _send_shortcut(self, _event=None):
        self.on_generate()
        return "break"

    def _show_welcome(self) -> None:
        self._clear_chat_widget()
        self._append_text("NEURIO CODER  ·  LOCAL", "assistant_label")
        self._append_text(
            "\nYour private coding desk is ready. Create a starter project or choose a folder, select a model installed on this computer, then describe the game or app you want.\n\n"
            "No API key. No cloud calls. Generated code is never run automatically — inspect it and press Apply files when you are ready.\n\n"
            "Tip: try “Make a small 2D platform game with keyboard controls and a score screen.”",
            "body",
        )

    def _clear_chat_widget(self) -> None:
        self.chat.configure(state="normal")
        self.chat.delete("1.0", "end")
        self.chat.configure(state="disabled")

    def _append_text(self, text: str, tag: str = "body") -> None:
        self.chat.configure(state="normal")
        self.chat.insert("end", text, tag)
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _append_message(self, label: str, text: str, tag: str) -> None:
        self.chat.configure(state="normal")
        self.chat.insert("end", f"\n\n{label}\n", tag)
        self.chat.insert("end", text, "body")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _append_assistant_header(self) -> None:
        self.chat.configure(state="normal")
        self.chat.insert("end", "\n\nNEURIO CODER  ·  LOCAL MODEL\n", "assistant_label")
        self.chat.configure(state="disabled")

    def _append_stream(self, text: str) -> None:
        if not text:
            return
        self.current_output += text
        self.chat.configure(state="normal")
        self.chat.insert("end", text, "body")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _reset_chat(self, message: str | None = None) -> None:
        self.conversation.clear()
        self.last_answer = ""
        self.current_output = ""
        self.apply_button.configure(state="disabled")
        self._clear_chat_widget()
        if message:
            self._append_message("WORKSPACE READY", message, "muted")
        else:
            self._show_welcome()

    def _set_workspace(self, folder: str | Path) -> None:
        path = Path(folder).expanduser().resolve()
        if not path.is_dir():
            messagebox.showerror(APP_NAME, "Please choose an existing folder.", parent=self.root)
            return
        self.workspace = path
        self.workspace_title.configure(text=path.name or str(path))
        self.workspace_path_label.configure(text=str(path))
        self._reset_chat(f"Workspace set to {path}. Project source can be included as read-only context; generated files are only saved when you apply them.")

    def choose_workspace(self) -> None:
        chosen = filedialog.askdirectory(title="Choose a project folder", parent=self.root)
        if chosen:
            self._set_workspace(chosen)

    def open_workspace_folder(self) -> None:
        if not self.workspace or not self.workspace.is_dir():
            messagebox.showinfo(APP_NAME, "Create or choose a workspace folder first.", parent=self.root)
            return
        try:
            if sys.platform == "win32":
                os.startfile(self.workspace)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(self.workspace)])
            else:
                subprocess.Popen(["xdg-open", str(self.workspace)])
        except (OSError, AttributeError) as exc:
            messagebox.showerror(APP_NAME, f"Could not open the folder:\n{exc}", parent=self.root)

    def open_new_project(self) -> None:
        dialog = tk.Toplevel(self.root)
        dialog.title("Create a local project")
        dialog.configure(bg=COLORS["bg"])
        dialog.geometry("520x430")
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.grab_set()

        shell = tk.Frame(dialog, bg=COLORS["bg"], padx=24, pady=22)
        shell.pack(fill="both", expand=True)
        tk.Label(shell, text="Start a new project", bg=COLORS["bg"], fg=COLORS["text"], font=("Segoe UI", 19, "bold")).pack(anchor="w")
        tk.Label(shell, text="Choose a local starter. Neurio can build on it after creation.", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9)).pack(anchor="w", pady=(4, 18))

        tk.Label(shell, text="PROJECT NAME", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(0, 6))
        name_var = tk.StringVar(value="my-game")
        name_entry = tk.Entry(shell, textvariable=name_var, bg=COLORS["input"], fg=COLORS["text"], insertbackground=COLORS["accent"], relief="flat", font=("Segoe UI", 10), highlightthickness=1, highlightbackground=COLORS["border"], highlightcolor=COLORS["accent"])
        name_entry.pack(fill="x", ipady=8)

        tk.Label(shell, text="STARTER TYPE", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(15, 6))
        kind_var = tk.StringVar(value=TEMPLATE_LABELS[0])
        kind_box = ttk.Combobox(shell, textvariable=kind_var, values=TEMPLATE_LABELS, state="readonly", font=("Segoe UI", 10))
        kind_box.pack(fill="x")

        destination = {"path": Path.home() / "Documents" / "NeurioProjects"}
        tk.Label(shell, text="CREATE INSIDE", bg=COLORS["bg"], fg=COLORS["muted"], font=("Segoe UI", 9, "bold")).pack(anchor="w", pady=(15, 6))
        dest_row = tk.Frame(shell, bg=COLORS["bg"])
        dest_row.pack(fill="x")
        dest_label = tk.Label(dest_row, text=str(destination["path"]), bg=COLORS["panel"], fg=COLORS["text"], anchor="w", padx=10, pady=9, font=("Segoe UI", 9), wraplength=330)
        dest_label.pack(side="left", fill="x", expand=True)

        def browse_destination():
            current = destination["path"]
            chosen = filedialog.askdirectory(title="Choose where to create the project", initialdir=str(current if current.exists() else Path.home()), parent=dialog)
            if chosen:
                destination["path"] = Path(chosen)
                dest_label.configure(text=chosen)

        self._button(dest_row, "Browse", browse_destination).pack(side="left", padx=(8, 0))

        actions = tk.Frame(shell, bg=COLORS["bg"])
        actions.pack(fill="x", side="bottom", pady=(20, 0))
        self._button(actions, "Cancel", dialog.destroy).pack(side="right", padx=(8, 0))

        def create_project():
            raw_name = name_var.get().strip()
            slug = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip(".-_")
            if not slug:
                messagebox.showerror(APP_NAME, "Enter a project name with at least one letter or number.", parent=dialog)
                return
            root = destination["path"].expanduser().resolve()
            project = root / slug
            if project.exists():
                messagebox.showerror(APP_NAME, f"This folder already exists:\n{project}\n\nChoose another name or location.", parent=dialog)
                return
            try:
                project.mkdir(parents=True, exist_ok=False)
                files = project_templates(kind_var.get())
                for relative, content in files.items():
                    target = safe_workspace_target(project, relative)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(content, encoding="utf-8", newline="\n")
            except (OSError, ValueError) as exc:
                messagebox.showerror(APP_NAME, f"Could not create the project:\n{exc}", parent=dialog)
                return
            dialog.destroy()
            self._set_workspace(project)
            self.target_var.set(next(iter(files)))
            self._append_text(f"\n\nCreated {kind_var.get()} starter with {len(files)} files. Describe the next feature you want to add.", "muted")

        self._button(actions, "Create project", create_project, primary=True).pack(side="right")
        name_entry.focus_set()

    def show_setup_guide(self) -> None:
        dialog = tk.Toplevel(self.root)
        dialog.title("Local model setup")
        dialog.configure(bg=COLORS["bg"])
        dialog.geometry("600x450")
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.grab_set()
        frame = tk.Frame(dialog, bg=COLORS["bg"], padx=24, pady=22)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text="Run your coder locally", bg=COLORS["bg"], fg=COLORS["text"], font=("Segoe UI", 19, "bold")).pack(anchor="w")
        text = (
            "1. Install Ollama for Windows from its official installer.\n\n"
            "2. Open PowerShell once and download a coding model, for example:\n"
            "   ollama pull qwen2.5-coder:3b\n\n"
            "3. Keep Ollama running, return here, and press ↻ to list installed models.\n\n"
            "After the model has been downloaded, Neurio Coder uses the local Ollama CLI only. It does not send prompts to a cloud service and does not need an API key. The first model download needs internet; offline use works afterward.\n\n"
            "Khadam local: ma kayn la API key la cloud. L-code ma kayt-runach bo7do — chofou qbel ma t-applyh.\n\n"
            "Tip: the 3B model is a smaller starting point. Larger local models may give stronger results but need more memory."
        )
        box = tk.Text(frame, height=14, bg=COLORS["panel"], fg=COLORS["text"], relief="flat", wrap="word", padx=14, pady=12, font=("Segoe UI", 10))
        box.pack(fill="both", expand=True, pady=(15, 14))
        box.insert("1.0", text)
        box.configure(state="disabled")
        self._button(frame, "Done", dialog.destroy, primary=True).pack(anchor="e")

    def refresh_models(self) -> None:
        self.refresh_button.configure(state="disabled")
        self.model_status.configure(text="Checking local Ollama…", fg=COLORS["muted"])
        threading.Thread(target=self._refresh_models_worker, daemon=True).start()

    def _refresh_models_worker(self) -> None:
        ollama = shutil.which("ollama")
        if not ollama:
            self.events.put(("models", [], "Ollama not found. Install it, then restart or refresh."))
            return
        try:
            result = subprocess.run([ollama, "list"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=12, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            self.events.put(("models", [], f"Could not check Ollama: {exc}"))
            return
        if result.returncode != 0:
            message = (result.stderr or result.stdout or "Ollama is not responding.").strip()
            self.events.put(("models", [], f"Ollama isn't ready: {message[:180]}"))
            return
        models = parse_ollama_models(result.stdout)
        self.events.put(("models", models, ""))

    def _drain_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "models":
                    self.installed_models = event[1]
                    error = event[2]
                    self.model_box.configure(values=self.installed_models)
                    self.refresh_button.configure(state="disabled" if self.busy else "normal")
                    if error:
                        self.model_status.configure(text=error, fg=COLORS["warning"])
                    elif self.installed_models:
                        self.model_status.configure(text=f"Ready · {len(self.installed_models)} model(s) installed", fg=COLORS["accent"])
                    else:
                        self.model_status.configure(text="Ollama is ready, but no local models are installed yet.", fg=COLORS["warning"])
                elif kind == "chunk":
                    self._append_stream(event[1])
                elif kind == "done":
                    self._generation_finished(event[1], event[2])
                elif kind == "generation_error":
                    self._generation_failed(event[1])
        except queue.Empty:
            pass
        if self.root.winfo_exists():
            self.root.after(80, self._drain_events)

    def _build_model_prompt(self, user_request: str) -> str:
        lines = [SYSTEM_PROMPT, "\nCURRENT WORKSPACE: " + str(self.workspace or "(none)")]
        if self.context_var.get() and self.workspace:
            lines.append(workspace_context(self.workspace))
        history = self.conversation[:-1][-8:]
        if history:
            lines.append("\nRECENT CONVERSATION:")
            for role, content in history:
                label = "USER" if role == "user" else "ASSISTANT"
                lines.append(f"\n{label}:\n{content[-4500:]}")
        lines.append("\nLATEST USER REQUEST:\n" + user_request)
        lines.append("\nRemember: never invent absolute paths; use complete <file path=...> blocks for requested code changes.")
        return "\n".join(lines)

    def on_generate(self) -> None:
        if self.busy:
            return
        if not self.workspace or not self.workspace.is_dir():
            messagebox.showinfo(APP_NAME, "Create a project or choose a workspace folder first.", parent=self.root)
            return
        user_request = self.prompt_input.get("1.0", "end-1c").strip()
        if user_request == "Describe a game or app you want to build…":
            user_request = ""
        if not user_request:
            messagebox.showinfo(APP_NAME, "Describe what you want the local coder to make or change.", parent=self.root)
            self.prompt_input.focus_set()
            return
        model = self.model_var.get().strip()
        if not model or not MODEL_NAME_RE.fullmatch(model) or model.startswith("-"):
            messagebox.showerror(APP_NAME, "Enter a valid local Ollama model name.", parent=self.root)
            return

        self.prompt_input.delete("1.0", "end")
        self.prompt_input.configure(fg=COLORS["text"])
        self._append_message("YOU", user_request, "user_label")
        self.conversation.append(("user", user_request))
        self.current_output = ""
        self._append_assistant_header()
        self.busy = True
        self.cancel_requested.clear()
        self.generate_button.configure(state="disabled")
        self.stop_button.configure(state="normal")
        self.refresh_button.configure(state="disabled")
        self.apply_button.configure(state="disabled")
        self.session_status.configure(text="GENERATING LOCALLY…", fg=COLORS["warning"])
        prompt = self._build_model_prompt(user_request)
        threading.Thread(target=self._run_model, args=(model, prompt), daemon=True).start()

    def _run_model(self, model: str, prompt: str) -> None:
        chunks: list[str] = []
        try:
            ollama = shutil.which("ollama")
            if not ollama:
                raise RuntimeError("Ollama was not found. Install it and use Setup instructions.")

            # Re-check immediately before generation; ollama run can otherwise
            # try to fetch a model name that is no longer present locally.
            listing = subprocess.run(
                [ollama, "list"], capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=12, check=False,
            )
            if listing.returncode != 0:
                detail = (listing.stderr or listing.stdout or "Ollama is not responding.").strip()
                raise RuntimeError(f"Ollama isn't ready: {detail[:180]}")
            available = parse_ollama_models(listing.stdout)
            self.events.put(("models", available, ""))
            if model not in available and not (":" not in model and f"{model}:latest" in available):
                raise RuntimeError(f"'{model}' is not installed locally. Run `ollama pull {model}` once, then refresh models. Neurio will not download models automatically.")
            if self.cancel_requested.is_set():
                raise RuntimeError("Generation stopped.")

            process = subprocess.Popen(
                [ollama, "run", model],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
            self.process = process
            if self.cancel_requested.is_set():
                process.terminate()
            assert process.stdin is not None
            try:
                process.stdin.write(prompt.encode("utf-8"))
                process.stdin.close()
            except OSError:
                if not self.cancel_requested.is_set():
                    raise

            decoder = codecs.getincrementaldecoder("utf-8")("replace")
            assert process.stdout is not None
            while True:
                raw = process.stdout.read(2048)
                if not raw:
                    break
                text = decoder.decode(raw)
                if text:
                    chunks.append(text)
                    self.events.put(("chunk", text))
            tail = decoder.decode(b"", final=True)
            if tail:
                chunks.append(tail)
                self.events.put(("chunk", tail))
            returncode = process.wait()
            answer = ANSI_RE.sub("", "".join(chunks)).strip()
            self.events.put(("done", returncode, answer))
        except Exception as exc:  # surface local runtime errors in the app
            if self.cancel_requested.is_set():
                answer = ANSI_RE.sub("", "".join(chunks)).strip()
                self.events.put(("done", -1, answer))
            else:
                self.events.put(("generation_error", str(exc)))
        finally:
            self.process = None

    def _generation_finished(self, returncode: int, answer: str) -> None:
        self.busy = False
        self.generate_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.refresh_button.configure(state="normal")
        if returncode == 0 and answer:
            self.last_answer = answer
            self.conversation.append(("assistant", answer))
            self.session_status.configure(text="DONE · REVIEW BEFORE APPLY", fg=COLORS["accent"])
            self.apply_button.configure(state="normal")
        elif self.cancel_requested.is_set():
            self._append_text("\n\nGeneration stopped.", "muted")
            self.session_status.configure(text="STOPPED", fg=COLORS["warning"])
        else:
            self._append_text("\n\nThe local model returned no code. Check Ollama and the selected model, then try again.", "muted")
            self.session_status.configure(text="NO RESPONSE", fg=COLORS["warning"])
        self.cancel_requested.clear()

    def _generation_failed(self, error: str) -> None:
        self.busy = False
        self.generate_button.configure(state="normal")
        self.stop_button.configure(state="disabled")
        self.refresh_button.configure(state="normal")
        if self.cancel_requested.is_set():
            self._append_text("\n\nGeneration stopped.", "muted")
            self.session_status.configure(text="STOPPED", fg=COLORS["warning"])
        else:
            self._append_text(f"\n\nLocal setup error: {error}", "muted")
            self.session_status.configure(text="LOCAL MODEL NOT READY", fg=COLORS["warning"])
        self.cancel_requested.clear()

    def stop_generation(self) -> None:
        if not self.busy:
            return
        self.cancel_requested.set()
        process = self.process
        if process and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass
        self.stop_button.configure(state="disabled")
        self.session_status.configure(text="STOPPING…", fg=COLORS["warning"])

    def apply_files(self) -> None:
        if self.busy:
            return
        if not self.workspace or not self.workspace.is_dir():
            messagebox.showerror(APP_NAME, "Choose a workspace before applying generated files.", parent=self.root)
            return
        response = self.last_answer.strip()
        if not response:
            messagebox.showinfo(APP_NAME, "There is no completed answer to apply yet.", parent=self.root)
            return
        target_name = self.target_var.get().strip()
        outputs = parse_generated_files(response, target_name)
        if not outputs:
            messagebox.showinfo(
                APP_NAME,
                "I couldn't find a file block to apply. Ask the model to return complete files using <file path=\"...\"> blocks, or return one fenced code block.",
                parent=self.root,
            )
            return

        resolved: list[tuple[Path, str]] = []
        try:
            for relative, content in outputs.items():
                path = safe_workspace_target(self.workspace, relative)
                if len(content.encode("utf-8")) > 2_000_000:
                    raise ValueError(f"{relative} is over the 2 MB per-file safety limit.")
                resolved.append((path, content))
        except (ValueError, OSError) as exc:
            messagebox.showerror(APP_NAME, f"A generated file path was rejected:\n{exc}", parent=self.root)
            return

        existing = [path for path, _ in resolved if path.exists()]
        if existing:
            names = "\n".join(f"• {path.relative_to(self.workspace)}" for path in existing[:8])
            if len(existing) > 8:
                names += f"\n• …and {len(existing) - 8} more"
            confirm = messagebox.askyesno(
                APP_NAME,
                f"These files already exist and will be overwritten:\n\n{names}\n\nContinue?",
                parent=self.root,
            )
            if not confirm:
                return

        try:
            for path, content in resolved:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8", newline="\n")
        except OSError as exc:
            messagebox.showerror(APP_NAME, f"Could not save generated files:\n{exc}", parent=self.root)
            return

        names = ", ".join(path.relative_to(self.workspace).as_posix() for path, _ in resolved)
        self._append_text(f"\n\nApplied {len(resolved)} file(s): {names}", "muted")
        self.session_status.configure(text="FILES SAVED", fg=COLORS["accent"])
        messagebox.showinfo(APP_NAME, f"Saved {len(resolved)} file(s) to:\n{self.workspace}\n\n{names}", parent=self.root)

    def copy_answer(self) -> None:
        if not self.last_answer:
            messagebox.showinfo(APP_NAME, "There is no completed answer to copy yet.", parent=self.root)
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.last_answer)
        self.session_status.configure(text="ANSWER COPIED", fg=COLORS["accent"])

    def clear_chat(self) -> None:
        if self.busy:
            messagebox.showinfo(APP_NAME, "Stop the current generation before clearing the chat.", parent=self.root)
            return
        self._reset_chat()
        self.session_status.configure(text="READY", fg=COLORS["accent"])

    def on_close(self) -> None:
        self.cancel_requested.set()
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
            except OSError:
                pass
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    NeurioCoderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
