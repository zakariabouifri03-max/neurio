# ADZAK Creative Studio — feature status, tests and limitations

Status legend: ✅ implemented and covered by automated tests · 🟨 implemented, UI not interactively verified or partial ·
⛔ not implemented in this release (shown as "Not available" in the app; nothing is faked).

## Core platform

| Item | Status | Notes |
|---|---|---|
| Project manager, recent projects (SQLite) | ✅ | `ProjectDB`, tests `test_db_projects_and_settings` |
| Video project files (`.adzproj`), image projects (`.adzimg`) | ✅ | save/load round-trip and damaged-file tests |
| Autosave and crash recovery | ✅ | snapshot write/find/clear tested; recovery prompt in UI 🟨 |
| Undo / redo (timeline and images) | ✅ | `History` tests; UI wiring 🟨 |
| Structured logs with secret redaction | ✅ | `RedactFilter` tests |
| Secrets: env var or OS credential store, never plaintext | ✅ | no key in DB/logs; Settings UI 🟨 |
| FFmpeg discovery (env, bundled, PATH, imageio) and cancellable runs | ✅ | exercised by all FFmpeg tests |
| Languages EN / FR / ES / AR with RTL layout | 🟨 | translated strings for menus and main labels; some dialogs remain English. Language applies after restart |
| Dark and light themes | 🟨 | stylesheets provided |
| Low-memory mode, preview height, render threads, cache limit | 🟨 | settings wired to preview size, encode preset, cache cleanup (`enforce_cache_limit`) |

## Video Studio

| Item | Status | Notes |
|---|---|---|
| Import MP4, MOV, MKV, AVI, WebM (anything FFmpeg reads) | ✅ | `probe` tests on real media |
| Multi-track timeline (clips on tracks V1–V4, audio tracks) | ✅ render, 🟨 UI | multi-track overlay export verified |
| Split, trim, move, delete | ✅ | timeline tests; drag/keys in UI 🟨 |
| Speed 0.25×–4×, slow motion, reverse | ✅ | render tests |
| Rotate, crop, resize to aspect (16:9, 9:16, 1:1, 4:5) | ✅ | canvas size tests; rotate/crop render 🟨 |
| Brightness, contrast, saturation, exposure (gamma), opacity | ✅ | filtergraph (`eq`, `colorchannelmixer`) |
| Green-screen chroma key | ✅ | render test uses a generated green clip |
| Stabilisation | 🟨 | FFmpeg `deshake` (basic only, no two-pass vid.stab) |
| Fade in / out (video and audio) | ✅ | render test |
| Volume, audio mixing | ✅ | render test |
| Text titles and captions (outline, shadow, position) | ✅ | rendered with Pillow, overlaid |
| Transitions between clips, keyframe animation | ⛔ | not implemented |
| Voice-over recording | ⛔ | not implemented |
| Music / sound-effects library | ⛔ | no bundled assets; import your own |
| Silence detection and removal | ✅ | `silencedetect` tests; "Remove silence" splits clip |
| Scene-change detection | ✅ | `select=gt(scene)` run on real video |
| Highlight extraction, long-video → shorts | ⛔ | not implemented |
| Preview frames, preview proxies | ✅ | proxy and preview tests |
| Export presets: YouTube 1080p/4K, TikTok/Reels/Shorts, Instagram 1:1 and 4:5, archive H.265, web VP9 | ✅ | presets tested for sizes; export tested for H.264 and VP9 |
| Export up to 4K | 🟨 | size supported; 4K encodes are slow on UHD 620 (CPU encode) |
| Hardware encoding (Intel Quick Sync `h264_qsv`/`hevc_qsv`) | 🟨 | used only if FFmpeg lists the encoder |
| Real-time playback | ⛔ | frame preview only |

## Photo & Design

| Item | Status | Notes |
|---|---|---|
| Layers: raster, text, shape, adjustment; order, visibility, opacity, duplicate, merge, delete | ✅ | document tests |
| Crop to selection, rotate 90°, resize canvas | ✅ | tests |
| Brush and eraser | ✅ | tests on the document; mouse painting 🟨 |
| Rectangular selection, fill, erase, layer mask from selection | ✅ | tests |
| Brightness, contrast, saturation, hue, curves | ✅ | adjustment tests |
| Filters: blur, sharpen, grayscale, sepia, invert, edges, posterize | ✅ | applied via `FILTERS` |
| Text and shapes, outline and shadow | ✅ | text rendering |
| Background removal | 🟨 | GrabCut inside a box; test with synthetic image; quality depends on contrast |
| Object removal (inpainting) | ✅ | OpenCV Telea test |
| Before / after comparison | 🟨 | toggle in UI |
| PNG transparency; JPG, PNG, WebP, BMP, TIFF, PDF export with quality and scale | ✅ | export tests |
| SVG export | ⛔ | explicitly refused with a message |
| Design templates (YouTube thumbnail, banner, social, poster, flyer, T-shirt, logo, product) | ✅ | sizes defined in `DESIGN_TEMPLATES` |
| Brand kit | 🟨 | colours and font stored in settings; not yet applied automatically |

## Media Converter and Utilities

| Item | Status | Notes |
|---|---|---|
| Video convert (MP4/MKV/MOV/WebM) | ✅ | tests |
| Video compressor (CRF, max height) | ✅ | size reduction test |
| Audio convert (WAV, MP3, M4A/AAC, FLAC, OGG, Opus) | ✅ | tests |
| Image convert, image compressor | ✅ | tests |
| Batch resize, batch rename (preview, collision-safe two-phase rename) | ✅ | tests |
| GIF from video and from images | ✅ | tests |
| Frame extraction and thumbnails | ✅ | tests |
| Subtitles SRT ↔ VTT, timing shift | ✅ | tests |
| Metadata viewer (video, audio, image + EXIF basics) | ✅ | tests |
| File size estimate | ✅ | formula-based estimate |
| Downloadable export presets (JSON) | ✅ | round-trip test |
| Media download from websites | ⛔ | intentionally not included |

## Audio Studio

| Item | Status | Notes |
|---|---|---|
| Waveform visualisation | ✅ | peak extraction tested; drawing 🟨 |
| Trim, merge, normalise loudness (LUFS target), noise reduction, bass/treble, volume, fades | ✅ | `audio.process` and `trim`/`merge` tests |
| Extract audio from video | ✅ | test |
| Export WAV, MP3, AAC/M4A, FLAC, OGG, Opus | ✅ | encoder mapping |
| Equaliser beyond bass/treble | ⛔ | not implemented |
| Speech-to-text, subtitle sync from speech | ⛔ | no speech model bundled |
| Text-to-speech, voice recording | ⛔ | not implemented |

## Animation, motion graphics

| Item | Status |
|---|---|
| Keyframes, motion presets, shape animation, animated titles | ⛔ |
| GIF creation | ✅ (see converter) |
| Transparent video export | ⛔ (WebM VP9 alpha is not wired up) |

## AI features

| Item | Status | Notes |
|---|---|---|
| Offline assistant: how-to answers, titles, hashtags, script outlines, image prompts, export advice | ✅ | tests |
| Online assistant via OpenAI-compatible HTTPS endpoint with user's key | 🟨 | request/error mapping tested with a mocked HTTP layer; not run against a live provider |
| AI image generation, inpainting with AI models, outpainting | ⛔ | not implemented |
| AI text-to-video, image-to-video (Runway, Kling, etc.) | ⛔ | requires provider credentials and integration |
| Automatic subtitles / transcription | ⛔ | not implemented |

## Test results (automated)

Run with `python -m pytest -q` against FFmpeg 7.0.2 (imageio-ffmpeg build) on Linux, Python 3.11, Pillow 12.3,
OpenCV headless 4.x:

```
66 passed
```

Test modules: `test_timeline.py` (model, split/trim, validation, serialisation), `test_ffmpeg_render.py` (probing,
multi-track export with effects, VP9 WebM, progress, preview frames, silence and scene detection, proxies, error paths),
`test_image.py` (layers, undo, compositing, adjustments, transforms, brush, selection, inpainting, GrabCut, save/load,
exports), `test_converters_audio.py` (converters, compressor, batch tools, GIF, frames, metadata, audio tools, subtitles),
`test_core.py` (database, projects, autosave, history, redaction, secrets, i18n, assistant, provider error mapping,
capability labels, presets).

Windows: the CI workflow runs the same suite on `windows-latest` before building the installer.
UI: not covered by automated tests in this release.

## Dependencies and licences

See [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md). FFmpeg GPL obligations apply to the default installer build.
