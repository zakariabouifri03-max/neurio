# 🎬 Bash Baqi Racing — promo cartoon (60 s)

A one-minute vertical (1080×1920, 24 fps) cartoon trailer with a full synthesised
soundtrack — **generated entirely from code**, no external assets, no stock audio.

**▶ Output:** [`../../video/bash-baqi-racing-60s.mp4`](../../video/bash-baqi-racing-60s.mp4)
(27 MB, 1080×1920) · mobile copy [`bash-baqi-racing-60s-720p.mp4`](../../video/bash-baqi-racing-60s-720p.mp4) (10 MB)
· watch page [`video/index.html`](../../video/index.html)

---

## What's in the video

| # | Time | Scene |
|---|------|-------|
| 1 | 0–6 s | Sunrise beach, **title card** (`BASH BAQI RACING` + `سباق الباغي على الشاطئ`) |
| 2 | 6–18 s | Buggy **cruises** along the beach, palms & island parallax, seagulls |
| 3 | 18–30 s | **Ramp jump + backflip**, `WHOOSH!`, `BAM!`, `PERFECT LANDING` |
| 4 | 30–42 s | **Duel with the blue rival** → `?` item box → `TURBO!` overtake, HUD shows `2 → 1` |
| 5 | 42–52 s | **FINISH!** gantry, confetti, `1st PLACE!` / `المركز الأول!`, trophy, `+1000 COINS` |
| 6 | 52–60 s | Sunset logo card + `50 CARS` / `10 WORLDS` / `PLAY FREE`, fade to black |

## Re-render it

```bash
# 1. soundtrack (numpy synth -> 44.1 kHz stereo wav)
python3 tools/video/audio.py --out /tmp/track.wav

# 2. render + encode (Pillow frames are piped straight into libx264, one pass)
python3 tools/video/cartoon.py --encode video/bash-baqi-racing-60s.mp4 --audio /tmp/track.wav --workers 2
```

`ffmpeg` is taken from `$FFMPEG` when set, otherwise the binary shipped with
`imageio-ffmpeg` is used. Install the Python deps with:

```bash
pip install pillow numpy arabic-reshaper python-bidi imageio-ffmpeg
```

Handy flags:

```bash
# look at individual frames while tweaking (writes /tmp/preview/t*.png)
python3 tools/video/cartoon.py --preview 3,10,22,35,47,55

# render a slice only, or dump PNGs instead of an mp4
python3 tools/video/cartoon.py --encode /tmp/part.mp4 --start 0 --end 240
python3 tools/video/cartoon.py --start 0 --end 240 --outdir /tmp/frames
```

A full pass is ~1440 frames; on 2 vCPU it takes roughly 10 minutes.

A lighter 720×1280 copy for phones / WhatsApp:

```bash
ffmpeg -i video/bash-baqi-racing-60s.mp4 -vf "scale=720:1280:flags=lanczos" \
  -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k video/bash-baqi-racing-60s-720p.mp4
```

`video/index.html` is a standalone player page (video + download buttons) — it works
straight from GitHub Pages or any static server.  To preview it locally with proper
HTTP Range support (so the player can seek):

```bash
python3 tools/video/serve.py 8000 .      # then open http://localhost:8000/video/
```

## Where to tweak things

| Want to change | Look at |
|---|---|
| Scene order / lengths | `SCENES` list at the bottom of `cartoon.py` (each scene is a `scene_*()` function) |
| Colours, sky moods, sea & sand | `MOODS`, `sea_color()`, `sand_color()`, `SAND` constants |
| The buggy itself | `draw_buggy()` (side view, rotates via `angle`, wheels spin via `spin`) |
| Palm trees / island / clouds | `palm()`, `frond()`, `island()`, `cloud()`, `silhouette()` |
| Comic SFX words (`WHOOSH!`, `TURBO!`…) | `comic_word()` calls inside each scene |
| Music tempo / chords / melody | `BPM`, `PROG`, `CHORDS`, `MELODY*` in `audio.py` |
| Drum patterns, bass, arrangements | `build()` in `audio.py` (`intro / drop / build_up / quiet / full2 / final / outro`) |
| Sound effects timeline | the `# ---------------- sfx ----------------` block in `audio.py` |

Text is drawn with `DejaVuSans-Bold` (it carries Arabic glyphs); Arabic strings are
shaped with `arabic-reshaper` + `python-bidi` through the `ar()` helper.

> Note: keep the video out of the game's service-worker cache list — it is not needed offline.

---

## 🥊 Stick Rivals — 60 s stickman fight

A second short film: a **landscape** (1920×1080, 24 fps) cinematic stickman
fight, [`../../video/stickman-fight-60s.mp4`](../../video/stickman-fight-60s.mp4),
built with the same Pillow → numpy → libx264 pipeline.

```bash
python3 tools/video/stickfight_audio.py --out /tmp/fight.wav        # score + SFX
python3 tools/video/stickfight.py --encode video/stickman-fight-60s.mp4 \
        --audio /tmp/fight.wav --workers 2
python3 tools/video/stickfight.py --preview 2,18,28,40.45,55         # peek at frames
```

`stickfight.py` holds a small skeletal rig (forward-kinematics stickmen), a
per-fighter action scheduler, a moving camera, and comic-book FX.
`stickfight_audio.py` synthesises the tense fight score and times every
impact/whoosh to the same `HITS` list the renderer uses, so picture and sound
land on the same frame.

| Want to change | Look at |
|---|---|
| Choreography — who attacks when | `RONIN_ACTIONS` / `BLAZE_ACTIONS` |
| Landed hits, comic words, damage | `HITS` (shared with the audio for sync) |
| Whiffing strikes · anime impact-beats | `WHOOSHES` · `FREEZES` |
| Poses (jab / hook / kick / KO / victory…) | `pose_action()` + guard base `base_guard()` |
| Fighter look & colours | `FIGHTERS`, `draw_fighter()`, `draw_head()` |
| Camera moves per act · hit shake/zoom | `scene_bounds()` / `camera()` / `hit_pulse()` |
| Backdrop (sky, city, crowd, embers) | `MOODS`, `draw_sun/ridge/city/floor/crowd/embers` |
| Fight music & SFX | `stickfight_audio.py` (`intensity()`, `clang()`, …) |
