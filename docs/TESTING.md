# Piano Pro — testing instructions

Run these checks on a Windows PC with a working sound device.

## Audio

1. Launch `PianoPro.exe`. You should hear nothing until a key is pressed (idle CPU stays low).
2. Click middle-C. A piano tone starts on mouse-down and releases on mouse-up.
3. Hold a chord of 6+ notes. All notes sound together (polyphony).
4. Drag across keys. Notes change without sticking.
5. Toggle **Sustain** (or hold Space). Released notes continue, then damp when sustain is lifted.
6. Move **Vol** 0–100 and **Mute**. Level changes without crackle at normal settings.
7. Switch **Grand Piano / Electric Piano / Organ / Soft Piano**. Each instrument is a different timbre. Organ holds until release.

If the device is missing, a dialog says: *Audio device unavailable. Please select another output device.* The window still opens.

## Keyboard

1. Play `A W S E D F T G Y H U J`. White and black keys light up.
2. `Z` / `X` change the octave display and transpose the map. Range stays inside A0–C8.
3. Hold several keys, then Alt-Tab away. Notes must stop (no stuck keys).
4. `Esc` silences everything.

## Recording

1. **Record** → play a short phrase → **Stop**. Status shows `Recording...` and elapsed time while armed.
2. **Play** reproduces the same notes, timing, and sustain.
3. **Save** writes `My_Piano_Song.mid`. Open it in any DAW or in Piano Pro via **Open**.
4. **Open** a Type-0 or Type-1 MIDI file and **Play**.

## MIDI

1. Settings → MIDI input → select your keyboard.
2. Play notes: they sound with incoming velocity.
3. Press the sustain pedal if you have one (CC 64).
4. Unplug the device: the app stays up and shows *MIDI device disconnected.*

## Practice

1. Enable **Practice**. Default sequence is `C4 E4 G4 C5`.
2. The next key is outlined. Playing it advances `Next Note: …`.
3. Edit the field (`G4 B4 D5`) and press Enter.

## Metronome

1. Toggle **Metronome**. You hear a click.
2. Change BPM with − / + (40–240). Accent on beat 1 is slightly higher.

## Settings persistence

1. Change volume, instrument, octave, theme, scale.
2. Quit and relaunch. Values come back from `%APPDATA%\PianoPro\settings.ini`.

## Stability

- Hold 32+ notes (MIDI or mouse chords + sustain). The app must not crash (voice stealing at 64).
- Invalid MIDI file → error dialog, no crash.
- Uninstall via `PianoPro_Setup.exe /uninstall` removes Start Menu + install folder.

## Installer

1. Run `PianoPro_Setup.exe` with `PianoPro.exe` beside it.
2. Confirm Start Menu shortcut and optional desktop shortcut.
3. First launch plays immediately, offline.
4. Uninstall cleans the install directory.
