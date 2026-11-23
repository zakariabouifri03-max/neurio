# The $200 Machine That Was "Cute" — 3-minute episode

**Finished film:** [`out/the-toaster-1975.mp4`](out/the-toaster-1975.mp4) — 2:59, 1920×1080, 30 fps, −15.8 LUFS.

Topic: in December 1975 a Kodak engineer built the first digital camera, and management
called it "cute" and told him not to tell anyone. The film also says out loud what the
popular version gets wrong — Kodak did not ignore digital.

| File | What it is |
|---|---|
| `script.txt` | Spoken script: one paragraph per line, `#` lines are silent chapter cards |
| `PLAN.md` | Visual plan, fact ledger, recording tips, render notes |
| `story.json` | Concept storyboard (superseded by the renderer's timeline) |
| `timing.json` | Sentence timings from `align.py` (`method=pause`) |
| `voice/a-d.mp3` | Narration, four parts |
| `out/the-toaster-1975.mp4` | The film |

## Storyboard as rendered — 35 shots

| # | Shot | Content |
|---|---|---|
| 00 | Chapter | **The Toaster** / Rochester 1975 |
| 01 | Lab | Sasson at the bench; `DECEMBER 1975` |
| 02 | Closeup | Sasson; tag "Steve Sasson, 24" |
| 03 | Graphic | Sensor · cassette · camera |
| 04 | Closeup | The camera next to `8 LBS`, "size of a toaster" |
| 05 | Closeup | Pointing it at a colleague |
| 06 | Black card | "Then he waited." |
| 07 | Graphic | Counter to `23` · `SECONDS` |
| 08 | Graphic | `100 × 100` pixel grid · `0.01 MP` · black & white · mostly static |
| 09 | Split | A perfect film photo beside 100×100 static: `FILM` / `NO FILM` |
| 10 | Board | The people who ran Kodak, the camera on the table |
| 11 | Closeup | Kellner; "Nobody gasped." tag + his question |
| 12 | Graphic | "What do you think this is going to do to our film business?" |
| 13 | Closeup | "I don't know — but I know it works." |
| 14 | Chapter | **The Room** |
| 15 | Board | `CUTE.` lands as a lime stamp |
| 16 | Board | `DON'T TELL ANYONE.` in red, ringed around the camera |
| 17 | Graphic | Chart: 90% of US film |
| 18 | Graphic | Camera · canister · print · chemical — "the machine erased all four" |
| 19 | Chapter | **The Thirty-Seven Years** |
| 20 | Graphic | "Kodak did not ignore digital / that part is a myth" |
| 21 | Document | Patent US 4,131,919, stamped 1977 |
| 22 | Graphic | Money into digital R&D; #1 in US digital cameras |
| 23 | Closeup | Kellner holding a film canister; "The margin" |
| 24 | Closeup | Tag: "Built by their own engineer" |
| 25 | Document | Newspaper front page, `CHAPTER 11` stamp |
| 26 | Black card | The company that invented the digital photograph could not survive it |
| 27 | Day set | National Medal of Technology, 2009; "for the invention that undid his employer" |
| 28 | Chapter | **What the Line Means** |
| 29 | Black card | "Cute. / Do not tell anyone." |
| 30 | Graphic | Four toys: robot · brick phone · PC · the camera |
| 31 | Graphic | "It's who owns the money it threatens" |
| 32 | Board | "Not stupid. Just doing the arithmetic." |
| 33 | Graphic | "Someone built the future. Someone else did the arithmetic." |
| 34 | Polaroid | Pull-out, shutter, "The arithmetic won." |

## Rebuild

```bash
# alignment (only needed if the narration changes)
python3 tools/longform/align.py   projects/cute-camera
python3 tools/longform/plan.py    projects/cute-camera      # timeline check, no gaps/overlaps
python3 tools/longform/film.py    projects/cute-camera --stills   # contact sheets -> work/sheet/
python3 tools/longform/film.py    projects/cute-camera            # ~2 min on 2 cores
python3 tools/longform/audio.py   projects/cute-camera --music-db -20
ffmpeg -i projects/cute-camera/out/picture.mp4 -i projects/cute-camera/work/mix.wav \
       -c:v copy -c:a aac -b:a 192k -ar 48000 \
       -af "loudnorm=I=-14.5:TP=-1.5:LRA=11" -shortest \
       projects/cute-camera/out/the-toaster-1975.mp4
```

`ffmpeg` is bundled via `imageio-ffmpeg`; python deps: `pillow`, `numpy`, `soundfile`, `imageio-ffmpeg`.
