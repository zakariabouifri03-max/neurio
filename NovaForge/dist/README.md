# dist/ - downloads

## Playable Windows game (no build needed)

`NovaForge-SampleIsland-win64-0.1.0.zip` (1.5 MB) is the **SampleIsland** project
exported as a standalone 64-bit Windows game: `SampleIsland.exe`, `game.json`,
the `Assets/` folder, a `README.txt` with the controls and `BUILD_INFO.txt`.
Unzip it anywhere and double-click the exe - Windows 10 or newer, no installer,
no editor, no runtime to install. It is the same export the editor's
**BUILD GAME** button produces (`engine/buildsys/build_system.cpp`).

Direct download:

```
https://github.com/zakariabouifri03-max/neurio/raw/arena/7a4391b3-neurio/NovaForge/dist/NovaForge-SampleIsland-win64-0.1.0.zip
```

Verify it on a machine without a display, or if the window does not appear:

```
SampleIsland.exe --headless --seconds 5 --screenshot shot.png
```

That runs the same simulation without a window and writes `Logs/runtime.log`,
which records every startup step. You can also force a resolution:

```
SampleIsland.exe --width 1920 --height 1080
```

## Engine source snapshot

`NovaForge-<version>-snapshot.zip` is a **lean archive of the engine sources**
(tracked files only: `engine/`, `tests/`, `third_party/`, `build.py`, docs -
no build output, no object files, no binaries). It is regenerated with

```
python3 build.py --snapshot
```

Direct download:

```
https://github.com/zakariabouifri03-max/neurio/raw/arena/7a4391b3-neurio/NovaForge/dist/NovaForge-0.1.0-snapshot.zip
```

Or clone just this folder without pulling the rest of the repository:

```
git clone --depth 1 --filter=blob:none --sparse \
    -b arena/7a4391b3-neurio https://github.com/zakariabouifri03-max/neurio.git
cd neurio && git sparse-checkout set NovaForge
```

Then build it (Linux/macOS/Windows, needs Python 3 and ~1 GB of disk):

```
cd NovaForge
python3 -m pip install ziglang        # the zig cc toolchain used by build.py
python3 build.py --target tests --jobs 4
./build/tests/novaforge_tests
```
