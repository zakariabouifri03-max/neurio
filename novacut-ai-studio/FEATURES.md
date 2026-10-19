# Feature status

Status legend: ✅ implemented and covered by tests · 🟡 implemented with
limitations · ⬜ not implemented in this version.

## Core editing

| Feature | Status | Notes |
|---|---|---|
| Import video/audio/image, ffprobe metadata, SQLite cache | ✅ | `novacut/media/` |
| Non-destructive, versioned `.novacut` project format (ZIP) | ✅ | v1, with migration hook |
| Portable/relative media references + missing-media flags | ✅ | relink file or whole folder |
| Save / Save As / open / bundle media into archive | ✅ | |
| Autosave + crash recovery dialog | ✅ | rotated, 5 kept by default |
| Multitrack timeline (multiple video + audio tracks) | ✅ | 2+2 default, add/remove tracks |
| Drag-and-drop from media bin to tracks | ✅ | custom MIME, typed track routing |
| Move, trim (both edges), split, ripple delete, duplicate, delete | ✅ | all undoable |
| Undo / redo (bounded, command coalescing) | ✅ | 300 steps |
| Snapping to edges/markers/playhead, zoom (Ctrl+wheel), scroll | ✅ | |
| Markers (add via menu/M key, rendered on ruler) | ✅ | |
| Track lock / hide flags | ✅ | locked tracks render at reduced opacity |
| Timeline thumbnails and audio waveforms | 🟡 | cached strips/envelopes; generated in background after import |
| Play/pause/seek/frame stepping/playback position | ✅ | FFmpeg pipe preview, WYSIWYG graph |
| Preview audio | 🟡 | QAudioSink push feed when Qt Multimedia backend exists; video never depends on it |
| Proxy generation (720p H.264/AAC) | ✅ | manual per item; export/preview can use proxies |
| Vertical/square/landscape presets | ✅ | 8 presets |
| Speed changes (0.1x–16x) | ✅ | setpts + chained atempo |

## Effects, titles, color

| Feature | Status | Notes |
|---|---|---|
| Keyframes for opacity, position, scale, rotation, gain | ✅ | piecewise-linear, render expressions |
| Transform: position/scale/rotation/anchor | ✅ | rotate + overlay expressions |
| Opacity + video fades | ✅ | geq for keyframed alpha |
| Color correction (exposure/contrast/saturation/temperature/tint/highlights/shadows) | ✅ | eq + colorbalance |
| LUT `.cube/.3dl` with intensity blend | ✅ | lut3d + blend |
| Chroma key | ✅ | chromakey filter |
| Rectangle/ellipse masks with feather/invert | ✅ | alphamerge |
| Blur, sharpen, vignette, denoise | ✅ | gblur/unsharp/vignette/hqdn3d |
| Transitions: fade/dissolve/wipe/slide/zoom | ✅ | xfade between touching clips |
| Animated titles (fade/slide/pop/typewriter) | 🟡 | full animation with drawtext builds; Qt PNG fallback (fade only) when FFmpeg lacks libfreetype |
| Text styling (font, size, color, stroke, alignment, bold/italic) | ✅ | |
| Crop controls | ✅ | |
| Audio gain automation, fades, mute, 3-band EQ | ✅ | volume/afade/equalizer |
| Noise reduction / voice enhancement filters | ✅ | afftdn/anlmdn/highpass/compressor |

## Local AI studio

| Tool | Status | Backend |
|---|---|---|
| A. Automatic subtitles, editable segments, SRT/VTT/ASS export, burn-in path | ✅ engine adapters; model installed on demand | faster-whisper (preferred) / openai-whisper |
| B. Silence detection + preview + undoable ripple cuts | ✅ | FFmpeg silencedetect (no model) |
| C. Background removal (image + clip, transparent/replacement) | ✅ when rembg+u2net installed; honest unavailable state otherwise | rembg/ONNX Runtime |
| D. Vocal/accompaniment separation | ✅ when Demucs+Torch installed | Demucs htdemucs two-stems |
| E. Scene detection → markers | ✅ | OpenCV HSV histogram distance |
| F. Smart reframe tracking → editable position keyframes | ✅ | OpenCV TrackerMIL, CamShift fallback; UI states tracking is imperfect |
| G. Audio cleanup with intensity + A/B preview | ✅ | FFmpeg DSP, no model |
| H. Local assistant (loopback only, suggestions only) | ✅ | Ollama `/api/chat`; never edits timeline |
| Model Manager: size/license/disk check/progress/cancel, never silent | ✅ | |

## Export

| Feature | Status | Notes |
|---|---|---|
| Full timeline render (all enabled tracks/effects/titles/audio) | ✅ | filter_complex script |
| MP4/MOV/MKV/WebM/AVI/WAV | ✅ | subject to FFmpeg build |
| H.264/H.265 CPU + NVENC/QuickSync/AMF with auto CPU fallback | ✅ | encoder availability probed at runtime |
| 480p–4K presets, 24–60 fps, CRF/bitrate, audio codec/sample rate | ✅ | |
| Progress, ETA, cancel, diagnostics | ✅ | |
| Burned-in subtitles | ✅ | subtitles/ass filter via Export dialog |
| Alpha-channel export | 🟡 | data model + rgba path; container/codec choices limited by FFmpeg |

## Platform / delivery

| Item | Status | Notes |
|---|---|---|
| Windows x64 installer + portable folder | 🟡 | build scripts, PyInstaller spec, Inno Setup script and GitHub Actions workflow included and ready; actual EXE must be produced on a Windows runner (see README) |
| Linux/macOS developer runs | ✅ | same codebase, headless-tested on Linux |
| Offline operation | ✅ | no network use except explicit model installs |
| Automated tests | ✅ | 55+ tests, including real FFmpeg renders |
| UI scaling, 1366×768 minimum | ✅ | Fusion style + QSS, scrollable panels |
| GPU decode acceleration | 🟡 | flags prepared; encoder side fully implemented, decoder auto flags conservative |
