# Neurio Coder — local desktop code studio

Neurio Coder is a small Windows desktop app for building and changing game/app projects with a **local coding model**. It has no cloud backend, API key field, telemetry, or automatic code execution. The app uses the Ollama command-line program on the same computer and only offers models Ollama already has installed.

The project includes offline starter templates for a 2D browser game, a web app, a Python desktop app, and a small Python game. Choose a folder, describe the feature you want, review the answer, and press **Apply files** to write it into the workspace.

> **The model is not bundled.** A general-purpose coding assistant needs a language model. Neurio Coder runs that model locally through Ollama; it does not send prompts to a hosted API. Download a model once, then Ollama can run it offline.

## Build `NeurioCoder.exe` on Windows

1. Install Python 3.10 or newer, including Tcl/Tk (the normal python.org installer includes it), and enable the Python Launcher.
2. Double-click `build_windows.bat` in this folder. The script installs PyInstaller if needed and builds a standalone app.
3. Find the result at `local-coder/dist/NeurioCoder.exe`.

Or build from PowerShell:

```powershell
py -m pip install pyinstaller
py -m PyInstaller --noconfirm --clean --onefile --windowed --name NeurioCoder neurio_coder.py
```

For a quick run from source, use `py neurio_coder.py`.

## Install a local coding model

1. Install Ollama for Windows and start it.
2. In PowerShell, download a model once, for example:

   ```powershell
   ollama pull qwen2.5-coder:3b
   ```

3. Open Neurio Coder and press the refresh button beside **Local model**. Select a model shown in the list.

The 3B model is a relatively small starting point. Larger models may produce stronger code, but need more disk space and memory. Ollama must be installed separately; neither it nor the model is packed into the EXE. Neurio Coder deliberately does **not** run `ollama pull` or fetch a missing model for you.

## Use it

1. Press **New project** to create a starter, or **Choose existing folder** to use your own code.
2. Describe the game, application, bug, or feature in the prompt box. For edits, leave **Include project source as context** enabled.
3. Wait for the local model to answer. It will usually return one or more `<file path="...">` sections.
4. Review the answer, then press **Apply files**. Existing files require confirmation. Output paths are checked so generated files cannot escape the selected workspace.

The app does not build, run, or install the generated project. Inspect generated code before running it yourself. Context is limited to source/text files; hidden folders, build outputs, and common secret files such as `.env` are skipped. Do not store passwords or private keys in source files.

## Local-only behavior

- Neurio Coder itself contains no HTTP client, remote model URL, API-key setting, or telemetry.
- It calls `ollama list` and `ollama run <installed-model>` as local commands. It refuses missing models instead of triggering a download, and filters Ollama entries marked as cloud models.
- The first Ollama/model download and the one-time PyInstaller build may need internet. Normal coding after setup can be offline.
- Prompts, project context, and generated output stay on this computer, in the app and the local Ollama runtime.

## Files

- `neurio_coder.py` — Tkinter desktop interface and local Ollama runner.
- `core.py` — output parsing, safe workspace paths, and bounded source-context collection.
- `build_windows.bat` — creates the Windows EXE.
- `tests/` — standard-library unit tests for file parsing and path safety.
