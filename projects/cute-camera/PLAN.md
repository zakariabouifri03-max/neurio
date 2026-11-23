# The $200 Machine That Was "Cute" — 3-minute episode

Project folder: `projects/cute-camera/`

| File | What it is |
|---|---|
| `script.txt` | The spoken script, one paragraph per line, `# ` lines are silent chapter cards |
| `PLAN.md` | Visual plan, fact ledger, recording tips, render notes |
| `story.json` | **Draft storyboard** — needs `python3 -m engine align` first (see Render) |

- Length: **3 min** · 467 spoken words (≈3:07 at 150 wpm, +3.8% of the 450 target)
- Chapter cards: **The Toaster** · **The Room** · **The Thirty-Seven Years** · **What the Line Means**

---

## The spoken script

> Copy this block and record it. The `#` titles are silent cards and are not read.

```
In December of nineteen seventy-five, a young engineer at Kodak was handed a strange assignment. Find out if a new light sensor was good for anything. His name was Steve Sasson. He worked in Rochester, New York, for a company that sold film.

Sasson wired the sensor to a lens, a dozen circuit boards, and a cassette recorder. The result weighed about eight pounds. It was roughly the size of a toaster. He pointed it at a colleague, and pressed the button.

Then he waited.

Twenty-three seconds. That's how long it took to write one picture onto tape. The image was one hundred pixels wide by one hundred pixels tall. A hundredth of a megapixel. Black and white. Mostly static.

By every normal measure, it was a terrible camera. And the first one that did not need film.

Sasson showed it to the people who ran Kodak. They sat in a conference room and watched a picture appear on a television set. Nobody gasped. One executive, Walter Kellner, asked him a question. What do you think this is going to do to our film business?

Sasson did not know. But he knew it worked.

Management's reaction became the line that made this story famous. They told him it was cute. And then they told him not to tell anyone about it.

Think about what that room was protecting. Kodak sold about ninety percent of the film in America. Every roll was a camera sale, a development fee, a print, and a chemical. The machine on that table erased all four at once.

Kodak did not ignore digital. That part of the story is a myth, and it is worth saying out loud. The company patented Sasson's camera in nineteen seventy-seven. It poured money into digital research. For a while, it sold more digital cameras in America than anyone else.

But it kept choosing the roll of film. The margin was too good to walk away from, and the machine that threatened it had been built by their own engineer.

In twenty twelve, Kodak filed for bankruptcy. The company that invented the digital photograph could not survive the digital photograph.

In two thousand nine, Steve Sasson received the National Medal of Technology. He was honoured for the invention that undid his employer.

Cute. Do not tell anyone.

Every industry has one of these objects. A toy that is really a warning. The giveaway is never the quality of the toy. The giveaway is who owns the money it threatens.

Those executives were not stupid. They saw the future clearly, in a conference room, in nineteen seventy-five, and they put it next to the film they already had.

That is the whole story. Someone built the future in a back room. Someone else did the arithmetic. The arithmetic won.
```

---

## Visual plan (5 lines)

1. **Cast:** SASS0N — young engineer, round head, cream shirt, thin tie, floppy 70s hair, always holding a toaster-shaped camera. KELLNER — older executive, dark suit, glasses, permanent frown. Two silent BOARD MEMBERS as silhouettes.
2. **The Toaster:** night lab set, one warm lamp pool, the camera drawn as a boxy grey toaster with a lens and a cassette deck. Counters and labels pop: `8 LBS`, `100 × 100 PIXELS`, `23 SECONDS`, `0.01 MP`.
3. **The Room:** boardroom at night, a chart of film revenue on the wall, the small camera on the long table. The line `"CUTE."` and `"DON'T TELL ANYONE."` arrive as stamps, the second one in red marker.
4. **The Thirty-Seven Years:** three flat beats — a document stamping `PATENTED 1977`, a slide rule of film margin, then a newspaper front page `BANKRUPTCY 2012`.
5. **The ending:** empty conference room, the camera still on the table, a polaroid pull-out, then the closing card `THE ARITHMETIC WON.`

---

## Facts — verified vs. not

**Verified (web-checked before scripting):**

- December 1975; Steve Sasson, then 24–25, an electrical engineer two years into his Kodak career.
- The prototype weighed ~8 lb (3.6 kg), used a Fairchild CCD at 100 × 100 pixels (0.01 MP), took ~23 s to record one black-and-white image to cassette tape, and needed a separate playback rig for a TV. First subject was lab technician Joy Marshall.
- Patent: **US 4,131,919**, "electronic still camera", filed 1977.
- Walter K. Kellner (then Director of Advanced Technology) asked, per Sasson's 2012 *IEEE Spectrum* interview: "What do you think this is going to do to our film business?" Sasson: "I don't know — but I know it works."
- The "that's cute, but don't tell anyone about it" reaction is Sasson's own account of management's response (he has repeated it to the *New York Times* and elsewhere).
- Kodak held roughly 90% of the US film market and ~85% of camera sales in that era.
- Kodak filed for Chapter 11 in **January 2012**.
- Sasson received the **National Medal of Technology** from President Obama in **2009**; National Inventors Hall of Fame in 2011.

**Deliberately excluded as shakier than the legend:**

- "Kodak buried digital and that's why it died." Kodak patented Sasson's work, invested heavily in digital, built early professional digital SLRs, and for a period sold more consumer digital cameras in the US than anyone. The script says this out loud, which is the point of the episode.
- Any exact figure for how much the film business was worth per year, and any claim about what individual executives intended. Keep it on the margin logic.
- The "how do we kill this digital thing?" quote that circulates online — **not verified**, do not use.

**Nothing else in the script is a claim that needs a citation.** No invented statistics or chart numbers; every number on screen above is sourced.

---

## Recording tips

- **One voice, no music, no noise reduction.** Read it exactly as written — the alignment engine matches words, so ad-libs cost accuracy.
- Export **mp3, wav or m4a**. 44.1 kHz or 48 kHz, mono or stereo both fine.
- Numbers are already written as words, so just read them naturally: "nineteen seventy-five", "twenty-three seconds", "one hundred pixels".
- Keep the pauses at the full stops — the picture cuts on them. Leave ~1 s of silence at the start and end.
- **ElevenLabs** (if you're using it): Stability ~45, Similarity ~75, Style ~15, Speaker Boost on, speed ~0.95. Generate the whole thing as one file, not per paragraph.
- Aim for a calm, slightly dry delivery. This is a story told at a desk, not a trailer.

---

## Render notes

The engine isn't in this repo yet — only `SKILL.md` and `CREDITS.md` were attached, so `engine/`, `references/` and `scripts/setup.sh` are missing.

Once the skill folder is added:

```bash
cd <skill>                                  # folder containing engine/ and scripts/
bash scripts/setup.sh                       # skia-python, numpy, scipy, soundfile, sherpa-onnx
python3 -m engine sentences projects/cute-camera     # word count + chapter check
# drop your voiceover in as projects/cute-camera/voice.mp3, then:
python3 -m engine align  projects/cute-camera        # expect method=asr matched=85%+
python3 -m engine plan   projects/cute-camera         # fix every warning from story.json
python3 -m engine stills projects/cute-camera         # contact sheets -> work/sheet_N.jpg
python3 -m engine render projects/cute-camera         # 3 min @1080p ≈ 10-15 min on this box
python3 -m engine audio  projects/cute-camera         # music bed + SFX, ducked, ~-14 LUFS
python3 -m engine final  projects/cute-camera
```

**Speed estimate for this sandbox:** 2 CPU cores. The skill's measured rate is 3–4 min of render per minute of video on 8 cores, so expect roughly **4× that** here — about 36–48 minutes for a 3-minute 1080p render, or ~20 minutes with `--res 720`. For a 3-minute video I'd do the full 1080p and let it run.

**`story.json` is a draft.** `plan` will warn about the `sent` ranges until the shot count is matched to the real sentence list from `sentences`/`align`; the timings must come from the actual voiceover, so nothing here has fake numbers pasted into it. Fix the ranges, not the writing.

---

*ReachMora 2D Long-Form. Made by ReachMora. Third-party credits: `CREDITS.md`.*
