# 🧩 Offline Coder — games & apps بلا API

A small **desktop coder** that builds **complete games and apps** as single HTML files.
Everything runs **on your PC**: no API key, no account, no internet needed while it generates.

- 🎮 **10 games:** Snake · Pong · Breakout · Tic-Tac-Toe (vs computer) · Memory · Flappy · Shooter · Catch · Whack-a-Mole · Simon
- 📱 **9 apps:** To-Do · Calculator · Pomodoro · Expense tracker (+ CSV) · Password generator · Notes · Converter · Dice · Stopwatch
- 🎨 **Themes from your words:** `space`, `beach`, `jungle`, `night`, `desert`, `candy`, `snow`, `fire` change colours and emoji (`space shooter`, `لعبة ثعبان فالشاطئ`, `jungle pong`)
- ⚡ **Difficulty from your words:** `hard` / `صعب` (faster), `easy` / `سهل` (slower)
- 🗣️ Understands English, French, Arabic and Darija (`lo3ba dyal snake`, `app dyal notes`, `لعبة ثعبان`, `mot de passe`)
- 🔒 **No AI model, no download, no API.** Everything is rule-based and runs on your PC. Optional: a local Ollama model for ideas that match nothing (see below).

Every generated file is standalone (inline CSS + JS, no CDN). Double-click it to play/use it, even offline.

---

## Option 1 — the `.exe` (Windows, no install)

1. Go to the repo's **Actions** tab → **Build Offline Coder (.exe)** → latest run → download the **OfflineCoder-windows** artifact.
2. Unzip → double-click **`OfflineCoder.exe`**.
3. A small console window opens and your browser opens **http://127.0.0.1:8765**. Keep the console open while you use it.
4. Type what you want (or click a suggestion) → **Generate** → **Download .html** or **Open in tab**.

> Windows SmartScreen may warn about an unsigned app: *More info → Run anyway*.

## Option 2 — Python (any OS, no build)

Python 3.9+ only; no packages to install.

```bash
cd tools/coder
python main.py                         # web UI at http://127.0.0.1:8765
python main.py "snake game" -o snake.html
python main.py "app dyal to-do" -o todo.html
python main.py "لعبة ثعبان"            # saves snake.html
python main.py --list                  # templates + Ollama status
```

Run the tests (stdlib only):

```bash
python -m unittest -v tools/coder/test_coder.py
```

## Optional — local model with Ollama (only for ideas outside the templates)

```bash
ollama pull qwen2.5-coder:7b          # once, downloads the model to your PC
ollama serve                          # usually already running after install
```

Then pick **Local AI (Ollama)** or **Auto** in the UI. Ideas that don't match a template go to the local model.
Settings (environment variables, optional):

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_HOST` | `127.0.0.1:11434` | Must be this PC (`127.0.0.1`/`localhost`); remote hosts are refused |
| `CODER_MODEL` | `qwen2.5-coder:7b` | Model to use when several are installed |

## Build the `.exe` yourself

On Windows (Python 3.12):

```powershell
cd tools\coder
python -m pip install pyinstaller
pyinstaller --onefile --console --name OfflineCoder --add-data "ui.html;." --noconfirm --clean main.py
# → dist\OfflineCoder.exe
```

The same steps run automatically in `.github/workflows/build-coder-exe.yml`.

## How it works

```
prompt ──► engine.generate()
            ├─ 1. match_template()  keywords in EN/FR/AR/Darija → templates.py (offline, instant)
            └─ 2. (no match) local Ollama on 127.0.0.1, if running → HTML validated by extract_html()
      ──► one self-contained .html  (+ preview, download, open)
```

| File | Role |
|---|---|
| `main.py` | CLI + starts the local UI and opens the browser |
| `engine.py` | prompt matching, Ollama client, HTML validation |
| `templates.py` | the 19 game/app templates, themes, difficulty words + keywords |
| `server.py` | local HTTP server (binds to `127.0.0.1` only) + JSON API |
| `ui.html` | the web UI (single file, no dependencies) |
| `test_coder.py` | unit + API tests (uses a fake Ollama, no real model needed) |

## Add your own template

In `templates.py`, write a function `def mygame(theme=None, level=1.0)` that returns a full HTML page using `_page(title, css, body, script, theme, level)`. Inside scripts you can use `THEME.accent`, `THEME.field`, `THEME.icon`, `THEME.enemy`, `THEME.item` and `LEVEL` (speed multiplier). Then register it:

```python
_reg("mygame", "My Game", "game", ["mygame", "my game", "لعبتي"], mygame)
```

Add a test case to `MatchingTests.CASES` in `test_coder.py`, and run the tests.

## Limits (honest)

- It is **not an AI that invents code**. It picks one of the 19 templates from your words, then applies a theme and a difficulty. Ideas outside those 19 are not built unless you add a template (or use the optional local Ollama model).
- A small local model is weaker than a large cloud model. Good prompts (what it does, controls, colours) work best.
- The Windows `.exe` is built by GitHub Actions; the sandbox used to write this could not produce a Windows binary itself.
