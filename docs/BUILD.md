# Building Piano Pro

Piano Pro is a native Win32 C++17 application. The only runtime dependency is
Windows 7 or later (WASAPI + `winmm`).

## Visual Studio 2022

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

## Zig cross-compile (recommended from Linux)

```bash
pip install ziglang
bash tools/build.sh
```

Produces `dist/PianoPro.exe` and `dist/PianoPro_Setup.exe`.

## GitHub Actions

Pushing to `main` (or running the workflow manually) builds the same binaries
on `windows-latest` with MSVC. See `.github/workflows/build-windows.yml`.
