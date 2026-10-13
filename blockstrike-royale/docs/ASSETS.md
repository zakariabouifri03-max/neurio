# Asset provenance

Every asset in `assets/` is original, machine-generated content made for this
project by the scripts in `tools/assets/` (pure Python standard library, no
external images, no downloaded samples, deterministic output).

| Folder | Contents | Generator |
|---|---|---|
| `assets/textures/` | 26 tile PNGs (24 tiles at 16x16, crate and target at 32x32) plus `atlas.png` (96x64, 6x4 grid) and `atlas.json` (UV table) | `tools/assets/gen_textures.py` |
| `assets/audio/` | 40 mono 16-bit 22 050 Hz WAV files (weapon fire, impacts, UI, music beds, footsteps, zone warning, match start, victory/defeat) | `tools/assets/gen_audio.py` |
| `assets/icons/` | 512 master icon, Android launcher icons (192/144 px), adaptive foreground/background (432 px) | `tools/assets/gen_icons.py` |
| `assets/icons/ui/` | 42 flat UI icons (weapon categories, HUD, menu, shop, rank) | `tools/assets/gen_ui_icons.py` |
| `icon.png` | 512x512 master app icon | `tools/assets/gen_icons.py` |

Regenerate everything with:

```bash
python3 tools/assets/gen_textures.py --out blockstrike-royale/assets/textures
python3 tools/assets/gen_audio.py    --out blockstrike-royale/assets/audio
python3 tools/assets/gen_icons.py    --out blockstrike-royale
python3 tools/assets/gen_ui_icons.py --out blockstrike-royale/assets/icons/ui
```

Preview sheets used during review live in `docs/preview/`.

## Third-party components

None. The project uses no third-party art, audio, font, plugin or code
dependency; the only external requirement is the Godot engine itself, which is
not vendored here. Engine version target: **4.4.1-stable**.

## Sounds and music

All audio is synthesised (oscillators, noise, envelopes) - no recorded samples.
Music tracks are short original loops generated the same way, intended as
placeholders that still fit the game, with a real music pass scheduled for the
audio phase.
