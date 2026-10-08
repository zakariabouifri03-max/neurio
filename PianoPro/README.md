# Piano Pro

A native C++17/JUCE Windows desktop piano. It renders local SoundFont samples through TinySoundFont, accepts mouse/computer-keyboard/MIDI input, and records actual MIDI performance events for playback and Standard MIDI File export. The app itself makes no network requests and does not need an account, cloud service, telemetry, or an internet connection after installation.

> **Build status:** the headless MIDI, SoundFont and audio-engine tests are intended to run on Windows or Linux. This checkout does not include a Windows-built `.exe`; use the Windows build script or the GitHub Actions workflow to produce and validate the Windows executable and installer. The current Linux environment has no Windows compiler/runtime, so native Windows GUI/device behavior still requires a Windows smoke test.

## Features

- Full 88-key A0–C8 keyboard, with mouse, computer-keyboard and optional external MIDI input.
- Four real sampled instruments: Grand Piano, Electric Piano and Organ from GeneralUser GS; Soft Piano from the FreePats Upright piano KW SoundFont.
- 128 available SoundFont voices; velocity-sensitive note-on, natural releases, software sustain and MIDI CC64 sustain.
- Computer-keyboard mapping for one selected octave: `A W S E D F T G Y H U J K` maps from C through the next C; `Z` / `X` step the octave, and `Space` toggles sustain. Click the piano once to give the keyboard focus to note input. Octave, velocity, volume, mute, instrument, sustain and device choices are also available in the UI/settings.
- Real-time recording and playback of note, velocity, duration, sustain and program-change events. **Recording is MIDI performance data, not a WAV/audio bounce.** Save and open standard `.mid` files; the reader supports standard format 0/1 files with PPQ timing.
- Metronome with adjustable tempo and level; practice sequence checker with note-name parsing (for example `C4 E4 G4 C5`, including sharps and flats).
- Audio device, sample-rate, buffer-size and MIDI-input selection; graceful missing-sample/device/file messages; user settings saved locally.
- Resizable dark/light UI, UI scale setting, and locally bundled sample banks. No in-app downloading or external asset URLs.

## Windows build

### Requirements

- 64-bit Windows 10 or later.
- Visual Studio 2022 with **Desktop development with C++** and a Windows 10/11 SDK.
- CMake 3.22 or later and Git on `PATH`.
- Inno Setup 6 only if you want to build the setup installer.

A first CMake configure fetches JUCE 9.0.3 from its pinned upstream Git tag. This is a build-time dependency only. If you have a local JUCE 9 source tree or package, provide it through `JUCE_DIR` or CMake's `FETCHCONTENT_SOURCE_DIR_JUCE` to avoid fetching it.

### Configure, build and test

From the `PianoPro` directory in PowerShell:

```powershell
cmake -S . -B build -A x64 -DPIANOPRO_BUILD_DESKTOP_APP=ON -DPIANOPRO_BUILD_TESTS=ON
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

The Visual Studio multi-configuration build places the executable at `build\bin\Release\PianoPro.exe` and copies the local sample banks to `build\bin\Release\assets\sounds`. Keep the `assets` directory beside the executable when using the portable build. CMake installation creates a portable directory containing the executable, SoundFonts and license/readme files:

```powershell
cmake --install build --config Release --prefix build\stage
```

### Build the Windows installer

With Inno Setup 6 installed:

```powershell
.\installer\build-installer.ps1
```

The script configures and builds the Release app, runs tests, stages a portable app, then compiles `installer\PianoPro.iss` into `build\installer\PianoPro_Setup.exe`. The installer includes both local SoundFonts, their attribution/license files, the TinySoundFont license and project notices. Installation defaults to Program Files and creates a Start Menu shortcut; a desktop shortcut is optional.

A GitHub Actions workflow at `../.github/workflows/pianopro-windows.yml` builds/tests the Windows app and uploads the portable stage, `.exe` and installer as a workflow artifact on changes under `PianoPro/` or via manual dispatch.

## Tests

The headless CMake tests are independent of JUCE GUI/device libraries:

- `PianoPro.MidiRoundTrip` — records events, writes and reloads Standard MIDI, checks event timing/velocity/sustain/program changes, and rejects malformed input without replacing the current performance.
- `PianoPro.SoundFontPlayback` — decodes the shipped SoundFonts, finds the required piano/EP/organ presets, renders non-silent finite samples, checks 32+ simultaneous voices, and exercises note release.
- `PianoPro.AudioEngine` — exercises the actual engine adapter for sound output, instrument bank/program selection, sustain, MIDI-sequence playback, metronome output, and missing/partial SoundFont diagnostics.

Run all of them with `ctest --test-dir build -C Release --output-on-failure` after building. To build only these headless tests on a non-Windows machine (without configuring JUCE), use:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DPIANOPRO_BUILD_DESKTOP_APP=OFF -DPIANOPRO_BUILD_TESTS=ON
cmake --build build --parallel
ctest --test-dir build --output-on-failure
```

Passing headless tests does not replace listening to the app and checking Windows audio/MIDI devices on a real Windows machine.

## First-run and manual smoke test

1. Launch `PianoPro.exe`; confirm the audio indicator reports a selected/ready device (otherwise open **Settings** and choose an output).
2. Play with the mouse and the computer keyboard; verify the key highlights and audible velocity-sensitive sample. Try every instrument and octave.
3. Hold/release the on-screen sustain toggle or Space; if available, repeat with a MIDI keyboard/pedal. Test mute, master volume and metronome tempo/level.
4. Enter `C4 E4 G4 C5`, start practice, and play the highlighted notes in sequence.
5. Record several notes, release them, stop, play the performance, save a `.mid`, then open it again and replay.
6. Restart the app and verify preferences persist. Disconnect an audio/MIDI device and verify the app reports the issue without crashing.

## Offline, settings and files

SoundFonts are loaded only from `assets\sounds` beside the executable. No sample is downloaded at runtime. Local preferences (including device choices, volume, selected instrument, octave, sustain, metronome and UI settings) are stored in the current user's application-data area. MIDI files are read/written only when the user chooses a file in the native file dialog.

The project disables JUCE browser, cURL and app-usage reporting build definitions. Installing or compiling JUCE does not itself grant a redistribution license; review the JUCE licensing note in `THIRD-PARTY-NOTICES.md` before distributing binaries. See `LICENSE` for original Piano Pro code and the SoundFont-specific license files in `assets/sounds/` for the audio assets.
