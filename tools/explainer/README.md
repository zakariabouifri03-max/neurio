# 🎬 "Lock the Clock" — a 60-second editorial explainer (4K vertical)

A Vox-style documentary short about the **1974 permanent-Daylight-Saving-Time
experiment**, rendered entirely from code (no stock footage/music):

> In 1974, amid the oil embargo, America made daylight saving time **year-round**.
> Sunrise slid past 9 a.m. in the north, kids walked to school in the dark, eight
> Florida schoolchildren died on the morning commute, support collapsed 79% → 42%,
> and Congress rolled the clocks back in **294 days**. In 2026 the same bill is back.

**▶ Output:** [`../../video/lock-the-clock-4k.mp4`](../../video/lock-the-clock-4k.mp4)
(2160×3840 · 30 fps · 60 s) · subtitles [`lock-the-clock.srt`](lock-the-clock.srt)
· fact ledger [`research.md`](research.md)

---

## Pipeline (everything is generated)

```bash
# 0. narration takes (10 clips) are produced with the session TTS voice -> narr/NN.wav

# 1. trim silence + pace to 60s -> narr_proc/ + timeline.json (real start/end per line)
python3 tools/explainer/prepare_narration.py --target 55.5 \
    --timeline tools/explainer/timeline.json

# 2. documentary underscore + SFX (numpy) mixed UNDER the narration -> master.wav
python3 tools/explainer/audio.py --timeline tools/explainer/timeline.json \
    --narr tools/explainer/narr_proc --out tools/explainer/audio/master.wav

# 3. render + encode Pillow frames -> libx264 (4K master)
python3 tools/explainer/render.py --encode video/lock-the-clock-4k.mp4 \
    --audio tools/explainer/audio/master.wav

# optional stills while tweaking
python3 tools/explainer/render.py --preview 2.5,10,22,30,40,46,54,59
```

A lighter 1080p copy for phones:

```bash
ffmpeg -i video/lock-the-clock-4k.mp4 -vf "scale=1080:1920:flags=lanczos" \
  -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k video/lock-the-clock-1080p.mp4
```

## What's inside

| # | Time | Beat |
|---|------|------|
| 1 | 0–4.5 | Hook: clock whips forward, "AMERICA TRIED TO LOCK THE CLOCK" |
| 2 | 5–13 | 1973 oil embargo, gas lines, "150,000 barrels/day" count-up |
| 3 | 13–18 | Jan 6 1974, 2:00 AM — clocks jump; "the sun didn't move, we did" |
| 4 | 18–24 | **Albers-projected US map** with real computed sunrises (Detroit 9:00, Fargo 9:11…) |
| 5 | 24–32 | Florida: 8 vs 2 kids-killed bars (+ "link disputed" footnote) |
| 6 | 32–39 | Approval collapse line chart 79→42 + "DAYLIGHT DISASTER TIME" stamp |
| 7 | 39–44 | Energy verdict: "1%" — DOT 1975 vs 1976 federal review |
| 8 | 44–52 | Retreat: clocks roll back, 294-day counter |
| 9 | 52–56 | 2026: House 308–117 Sunshine Protection Act; Senate pending |
| 10 | 56–60 | "The sun hasn't changed. Only the argument has." + sources |

Design system: deep navy / white / red-accent / gray, **Barlow Condensed** display +
**Inter** data type (both instanced/`fontTools`), word-level caption karaoke synced to
the narration, dip-to-navy transitions, real GeoJSON basemap, NOAA-computed sunrises.

All facts are sourced in [`research.md`](research.md). The map & sunrise numbers were
computed (NOAA sunrise equation) rather than quoted, so they're internally consistent.
