# 🧁 Cupcat — the montage as a PC app

A small Windows app (`Cupcat.exe`) that plays the 30-second **Cupcat montage**
(the promo for the Offline Coder). It runs a tiny server on **127.0.0.1** and opens the
app in your browser. Nothing is sent anywhere.

## Run it (Windows, no install)

1. Repo **Actions** → **Build Cupcat (.exe)** → latest run → artifact **Cupcat-windows**,
   or the direct-download release `cupcat-latest` (see the Releases page).
2. Unzip → double-click **`Cupcat.exe`**. Your browser opens the montage. Keep the console window open while you watch.

Keys: `Space` play/pause · `R` replay.

## Run it from Python (any OS)

```bash
cd tools/cupcat
python main.py                 # opens the app in your browser
python main.py --check         # self-test (files + server)
```

## Build the .exe yourself (Windows)

```powershell
cd tools\cupcat
python -m pip install pyinstaller
pyinstaller --onefile --console --name Cupcat --add-data "assets\cupcat.png;." --add-data "index.html;." --add-data "..\..\video\cupcat-montage-30s.mp4;." --noconfirm --clean main.py
# -> dist\Cupcat.exe
```

Files: `main.py` (server + self-test) · `index.html` (the player page) · `assets/cupcat.png` (mascot) ·
the montage itself lives in `video/cupcat-montage-30s.mp4` and is bundled into the exe.
