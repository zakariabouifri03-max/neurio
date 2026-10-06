# Build system

NovaForge has no CMake dependency. Two small drivers do everything:

| Driver | Purpose |
|---|---|
| `tools/build.py` | builds the engine library, the editor, the runtime and the tools for the current host or for Windows |
| `tools/package_windows.py` | turns the Windows build into the two downloadable packages (`dist/`) |
| `engine/src/buildsystem/BuildSystem.cpp` | the *in-engine* build system used by the editor's **Build Game** button (staging, compiling, verifying, reporting) |

## Toolchains

`tools/build.py --target windows` looks for a compiler in this order:

1. `$NOVAFORGE_ZIG` (explicit path)
2. `zig` / `zig.exe` next to the executable (a bundled toolchain)
3. `zig` on `PATH`
4. `python -m ziglang` (the `ziglang` PyPI wheel - `python3 -m pip install ziglang`)
5. `cl` (MSVC), 6. `g++` (MinGW)

Native builds use `clang++`, `g++`, or `zig c++` for the host, whichever is found first.

Zig is the recommended toolchain because one download cross-compiles genuine Windows PE64
executables from Linux or macOS, with no Visual Studio and no Wine, and it ships MinGW-w64
headers/libs for the Windows API, OpenGL, DirectShow audio and the C++ standard library.

The in-engine build system detects the same toolchains (plus `NOVAFORGE_ZIG`) so **Build Game**
inside the editor works on a machine that only has Python + `pip install ziglang`.

## Targets

```bash
python3 tools/build.py --list                        # show every product for the current target

python3 tools/build.py --target native --config debug
#   build/debug/nfengine/libnfengine.a   engine library (also used by tests and tools)
#   build/debug/nftests/nftests          native unit tests (tests/CoreTests.cpp)
#   build/debug/nftool/nftool            headless tool: project, import, sim, render, test

python3 tools/build.py --target windows --config release
#   build/exe/release/NovaForge/NovaForge.exe         4.1 MB  (windows-gui subsystem)
#   build/exe/release/NovaForgeGame/NovaForgeGame.exe 4.0 MB  (console subsystem, console hidden)
```

Useful switches: `--jobs N` (parallel compile units), `--no-unity` (file-by-file compilation, used
to catch missing includes), `--only <product>`, `-v`.

### Rebuilding a shipped package

Every build produced by **Build Game** contains real rebuild scripts:

```
<Project>/
  <Project>.exe          the game
  project.json           project + game settings
  Assets/  Settings/     content
  Engine/Source/         the engine sources used for this build
  Engine/Generated/BuildConfig.h
  Build.bat              Windows: python Engine\Source\tools\build.py --target windows --stage . --exe-name <Project>
  build.sh               Linux/macOS: python3 Engine/Source/tools/build.py --target windows --stage . --exe-name <Project>
  BuildReport.txt        what was verified
```

`tools/build.py --stage <dir> --exe-name <name>` cross-compiles the packaged sources and copies the
resulting `<name>.exe` into `<dir>` - verified by the test suite, so the scripts are not decorative.

## What `Build Game` actually does

1. **Validate** the project (project.json, start scene, referenced assets, missing-file warnings).
2. **Stage** into `<outputDir>/<ExeName>/`: assets, `project.json`, `Settings/`, engine sources,
   `Engine/Generated/BuildConfig.h`, rebuild scripts.
3. **Compile** every engine source file (editor sources excluded, Win32 platform backend included)
   plus ImGui/miniaudio/stb with the detected toolchain - one process per file, parallel workers,
   progress reported through the same callback the editor UI uses.
4. **Link** `<ExeName>.exe` with `-static -static-libgcc` and the Win32/OpenGL/DirectSound import
   libraries, then delete intermediate objects and the `.pdb` to keep the package lean.
5. **Verify** the package: `project.json`, start scene, `Assets/`, the executable exists, and the
   binary is a valid 64-bit PE image (MZ + PE + machine `0x8664`).
6. **Report**: `BuildReport.txt` with toolchain, sizes, verification results, asset warnings and
   run/rebuild instructions.

There is no fake stage: if compilation or linking fails, the build fails, the reason is printed in
the panel/console *and* written to the report, and the editor keeps the staged package so you can
run `Build.bat` to see the full compiler diagnostics.

## Requirements

* **Python 3.9+** for the build drivers (stdlib only - no pip packages required).
* **A C++20 compiler**: Zig (recommended), MSVC 2019+, or MinGW-w64 g++ 11+.
* Windows executables additionally need the OpenGL 3.3 driver of the target machine at runtime,
  and nothing else - the UCRT ships with Windows 10/11.
* Optional: `dotnet`/`wine` are **not** required anywhere.

## Vendored dependencies

| Library | Location | Why |
|---|---|---|
| Dear ImGui (docking branch) | `vendor/imgui` + `vendor/imgui/backends` | editor UI and the in-game HUD |
| stb_image / stb_image_write / stb_truetype / stb_rect_pack | `vendor/stb` | texture import and PNG export |
| miniaudio | `vendor/miniaudio` | audio device + decoders (WAV/MP3/FLAC/OGG) |

All three are header/source drops inside the repository - there is no package manager step and no
network access during a build. GLB/GLTF/OBJ/FBX importers, the physics solver, the scene format,
the scripting layer and the AI assistant are original code in `engine/src`.
