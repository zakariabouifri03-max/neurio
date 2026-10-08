# Piano Pro installer

`PianoPro_Setup.exe` is a native Win32 installer (no NSIS, no internet).

## Behaviour

- Default location: `%LOCALAPPDATA%\Programs\PianoPro`
- Copies `PianoPro.exe` and `assets/` from the same folder as the setup program
- Start Menu shortcut: **Piano Pro**
- Optional desktop shortcut (checkbox)
- Writes an Add/Remove Programs entry under the current user
- Uninstall: `PianoPro_Setup.exe /uninstall` or Windows Settings → Apps

No administrator rights are required for the per-user install.

## Build

Produced automatically by `tools/build.sh` or the CMake `PianoPro_Setup` target.
