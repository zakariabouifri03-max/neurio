# ADZAK CREATIVE STUDIO — Features & Known Limitations

This document lists exactly what works, what needs configuration, and what is
**not** implemented yet. Nothing in the product claims a capability that is
absent from the "Implemented" column below.

## Legend

- **Local/Offline** — runs on your machine, free, no account needed.
- **Free (FFmpeg)** — offline, uses the bundled/system FFmpeg.
- **API** — requires your own provider credentials (Settings → AI Providers).
- **Planned** — visible in the capability matrix but disabled with an explanation.

---

## 1. Application shell

| Feature | Status |
|---|---|
| Dark professional theme + light mode | Implemented |
| Sidebar with icons + searchable tools | Implemented |
| Project dashboard with recent projects | Implemented |
| Menus, keyboard shortcuts (Ctrl+N/O/S/Z/Y/Q/T, F1), tooltips, context menus | Implemented |
| Undo/redo history (video & photo editors) | Implemented |
| Autosave every 45 s + crash-recovery snapshots (5 kept per project) | Implemented |
| English / Arabic (RTL) / French / Spanish, switchable live | Implemented |
| Progress indicators for long tasks | Implemented |
| Settings persisted in SQLite | Implemented |

## 2. Video editor

Implemented: import (MP4, MOV, MKV, AVI, WebM, MPG, WMV…), multi-track
timeline, click/drag clip move with overlap rejection, edge trim, split at
playhead, ripple delete, speed 0.25–4× incl. reverse, per-clip volume &
opacity, effects (brightness, contrast, saturation, exposure/gamma, hue,
rotate 90/180, crop params, chroma key, denoise, single-pass stabilize,
video/audio fade-in), transitions (fade-in on cut), aspect ratios 16:9, 9:16,
1:1, 4:5, 4:3, 21:9, preview frame at playhead with quality setting,
voice-over recording (Windows DirectShow), project save/reopen, real FFmpeg
render pipeline (H.264/H.265, CRF, thread control, subtitle burn-in, GIF),
platform presets with estimated file size.

Known limitations:
- Preview is a frame-at-playhead scrub (not real-time playback of filters).
- Keyframe animation of clip properties exists in the model (used by the
  Animation studio) but the video editor UI exposes fades rather than a full
  keyframe graph.
- Two-pass stabilize (vid.stab) and proxy-file generation are not in this
  release; denoise and single-pass deshake are offered instead.
- Cross-track overlapping clips are serialised in export order (documented).

## 3. Photo editor

Implemented: RGBA layer stack with reordering/opacity/delete/flatten, open
PNG/JPG/WebP/BMP/TIFF/GIF, brush & eraser painting, crop by dragging, rotate,
flip, resize, brightness/contrast/saturation/hue/gamma adjustments, curves,
13 filters, text with outline, shapes, uniform-colour and flood-fill
background removal, before/after hold button, undo/redo, export in 5 formats.

Known limitations:
- Background removal is algorithmic (chroma/flood-fill), not ML segmentation
  — best on flat backgrounds.
- No selection marquee/magic wand yet; crop and flood-fill cover most cases.

## 4. Graphic design

Implemented: 6 original bundled templates (YouTube thumbnail & banner,
Instagram post & story, A4 poster, logo), text/rect/ellipse/image items,
position/size/colour/outline/shadow properties, canvas presets incl. custom,
brand colour kit, export PNG/JPG/PDF.

Known limitations: no full vector path editor (shapes are parametric), SVG
export not implemented.

## 5. AI Image Studio

Implemented: provider-based text-to-image via OpenAI-compatible
`/images/generations` (works with OpenAI, OpenRouter, Stable Diffusion WebUI
APIs, etc.), negative prompt passthrough, size & count selection, local
Lanczos enlarge/restore, capability matrix rendered in-panel.

Honest behaviour: with no provider configured, the generate button shows a
dialog explaining what is needed — **it never produces fake output**.
Inpainting/outpainting are listed as *Planned*, disabled.

## 6. AI Video Studio

Implemented (offline): silence detection & removal, scene-change detection,
clip extraction for shorts workflows — all real FFmpeg pipelines.
Implemented (UI): job queue with explicit "needs API credentials" status for
text-to-video / image-to-video providers (Runway/Kling via their official
APIs when credentials exist — none are bundled).
Planned (disabled, labelled): automatic subtitles (needs Whisper), speech-to-
text, translation, video background removal, highlight extraction.

## 7. Audio studio

Implemented: waveform display, trim, loudness normalisation, fade in/out,
3-band parametric EQ, tempo change without pitch shift, silence detection &
removal, microphone recording, audio extraction from video, export to
MP3/AAC/Opus/WAV/FLAC.

## 8. Animation

Implemented: keyframed position/scale/rotation/opacity, motion presets
(slide-in, pop, fade-in, spin), text & shape objects, GIF export, PNG-sequence
export. Not a 3D engine and does not claim to be one.

## 9. Converter & utilities

Implemented: video conversion (MP4/MKV/WebM/GIF/AVI), CRF quality tiers,
resize, two-pass target-size compression, audio conversion (6 presets), image
conversion & batch resize, GIF maker (palette-based), frame & thumbnail
extraction, video/image metadata viewers (incl. EXIF), batch rename with
patterns (dry-run preview), subtitle conversion SRT⇄VTT⇄TXT with time shift.

## 10. Assistant

Implemented offline: how-to knowledge base, title/hashtag generators, script
outlines, image-prompt builder, export-settings advisor. With a chat provider
configured, free-form questions route to it and answers are labelled
`[provider answer]` vs `[offline knowledge base]`.

## 11. Low-end PC optimisations

Implemented: Low-Memory Mode switch, preview quality (full/half/quarter),
render thread control, cache size limit + one-click cleanup, background job
queue (serial by default), file-size estimates before rendering, honest RAM
warnings for large animation canvases. Optional hardware acceleration is
listed but ADZAK defaults to CPU encoding because UHD-620-class iGPUs vary
widely in driver support — this is a deliberate reliability choice.

## 12. Security & honesty guarantees

- No hardcoded secrets; DPAPI-encrypted key store; log redaction of
  secret-like strings.
- Exports always produce a real file or raise with the FFmpeg error text.
- AI features never simulate success: unconfigured providers show why.
- No media downloading from platforms is included (ToS/rights risk).
