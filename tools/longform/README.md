# Long-form renderer (ReachMora look)

The ReachMora skill ships an `engine/` built on skia-python. skia needs `libEGL.so.1`,
which is not installable in this sandbox (no root), so this is a compatible
reimplementation of the same look using PIL + numpy:

- `kit.py` — palette, easing, ink shapes, night lighting (`night_light` multiplies the
  frame down and punches warm lamp pools back in), grade, vignette, grain, the puppet
  `draw_char()` (outfits, hair, glasses, expressions, arm poses, seated) and the icon set.
- `sets.py` — lab, boardroom, desk, portrait, black.
- `fx.py` — pop labels, stamps, marker rings, lower thirds, chapter cards, polaroid.
- `shots.py` — shot kinds: Chapter, Lab, Board, Close, Graphic, Document, Black, Split, Polaroid, Medal.
- `plan.py` — THE storyboard and the one timeline shared by picture and sound. Silent
  chapter cards are inserted and shift everything after them; shots are then stretched
  to meet each other so there are never gaps or overlaps.
- `align.py` — ffmpeg `silencedetect` spans + a character-weighted DP to time each script
  sentence (the skill's documented fallback when the ASR model is unavailable).
- `film.py` — renders frames in parallel, encodes per-shot segments, concatenates.
- `audio.py` — original music bed (Am–F–C–G, 92 bpm, arrangement changes every 8 bars),
  synthesised SFX cued from each shot's own words, voice-following duck, master.

Style rules kept: one near-black ink line on everything, flat fills with one hard shadow,
navy night with warm lamp pools, lime and cream hand-lettering with a thick ink stroke,
red marker rings and stamps, black chapter cards in white handwriting, every shot slowly
pushing in, a polaroid ending.

Fonts in `fonts/` are Caveat Brush and Kalam (SIL OFL) and Permanent Marker (Apache 2.0),
from Google Fonts; licences sit beside them.

Not included: skia-python, sherpa-onnx word alignment, and the skill's music/SFX library.
