# Piano Pro

A lightweight, offline **88-key virtual piano** for Windows.

Play with the computer keyboard, the mouse, or an external MIDI keyboard.
Record real performances, save them as standard MIDI files, and play them back.
No account, no internet, no cloud.

**Download:** `dist/PianoPro.exe` (portable) or `dist/PianoPro_Setup.exe` (installer).

---

## Features

- **88 keys** A0–C8 with velocity-sensitive playback
- **Real local audio** — additive grand piano, FM electric piano, Hammond-style organ, soft piano
- **Polyphony** — 64 voices with voice stealing
- **Sustain** — on-screen button, Spacebar, MIDI sustain pedal (CC64)
- **Computer keyboard** — `A W S E D F T G Y H U J` plus octave `Z` / `X`
- **Mouse** — click and drag keys; optional velocity from vertical position
- **MIDI input** — device picker, velocity, sustain pedal
- **Recording** — record / stop / play, elapsed time, save & load `.mid`
- **Metronome** — 40–240 BPM with audible clicks
- **Practice mode** — type a note sequence (`C4 E4 G4 C5`); the next key is highlighted
- **Audio settings** — device, sample rate, buffer size, master volume, mute
- **Dark / light theme**, UI scale, persistent settings (`%APPDATA%\PianoPro\settings.ini`)

The application never contacts the network. Recordings stay on your computer.

---

## Run (Windows)

### Portable

1. Copy `PianoPro.exe` anywhere.
2. Double-click it.
3. Grant microphone/MIDI access only if Windows asks (MIDI is optional).

### Installer

1. Keep `PianoPro.exe` and `PianoPro_Setup.exe` in the same folder.
2. Run `PianoPro_Setup.exe`.
3. Optionally create a desktop shortcut.
4. Start Menu → **Piano Pro**.

Uninstall from **Settings → Apps**, or run the installer with `/uninstall`.

---

## Play

| Input | Action |
|---|---|
| `A S D F G H J K` | White keys (C major from the current octave) |
| `W E T Y U` | Black keys |
| `Z` / `X` | Octave down / up |
| `Space` | Sustain (momentary) |
| `Esc` | All notes off |
| Mouse | Click a key; drag across keys |
| MIDI keyboard | Notes + velocity + sustain pedal |

---

## Build from source

### Option A — Visual Studio / MSVC

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

Output: `build/Release/PianoPro.exe`

### Option B — Zig (cross-compile from Linux/macOS/Windows)

Zig ships a MinGW sysroot, so you can produce a real `PianoPro.exe` without Visual Studio:

```bash
pip install ziglang          # or install zig from ziglang.org
bash tools/build.sh
```

Output: `dist/PianoPro.exe` and `dist/PianoPro_Setup.exe`

### Option C — MinGW-w64

```bash
x86_64-w64-mingw32-g++ -std=c++17 -O2 -DUNICODE -D_UNICODE -DNOMINMAX \
  Source/*.cpp -o PianoPro.exe \
  -luser32 -lgdi32 -lwinmm -lole32 -luuid -lcomdlg32 -lcomctl32 \
  -lshell32 -lshlwapi -ldwmapi -ladvapi32 -loleaut32 -lpropsys -static
```

---

## Architecture

Native Win32 C++17. Audio is WASAPI (shared mode) with `waveOut` fallback.
MIDI uses `winmm`. The piano tone is synthesized locally — no sample pack and
no JUCE runtime — which keeps RAM, CPU, and the `.exe` small.

```
Source/
  Main.cpp              WinMain, DPI awareness
  App.cpp / App.h       Main window, settings, input, practice
  PianoKeyboard.cpp     88-key layout, hit-test, drawing
  PianoEngine.cpp       Thread-safe command queue into the synth
  Synth.cpp             64-voice instruments + metronome
  AudioEngine.cpp       WASAPI + waveOut
  MidiManager.cpp       MIDI input devices
  RecordingManager.cpp  Record / playback / Standard MIDI files
  SettingsManager.cpp   %APPDATA%\PianoPro\settings.ini
installer/Setup.cpp     Start Menu + desktop shortcuts, uninstall
```

---

## Testing

See **[docs/TESTING.md](docs/TESTING.md)** for the full checklist
(audio, keyboard, recording, MIDI, installer, missing files).

Host-side synth + MIDI roundtrip (no Windows required):

```bash
g++ -std=c++17 -O2 tools/synth_preview.cpp -o /tmp/synth_preview
/tmp/synth_preview    # writes /tmp/pianopro_preview.wav and a MIDI file
```

---

## License

MIT — see [LICENSE](LICENSE).
