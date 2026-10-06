# NEXUS GRAPHICS ENGINE

**Real-Time 3D Game Graphics Enhancer — a real Windows application.**

`release/NexusGraphicsEngine.exe` (x64, Windows 10 1903+ / Windows 11) is a self-contained
desktop application that enhances the *actual live presentation* of PC games in real time:

```
GAME  →  GAME RENDERING  →  NEXUS GRAPHICS ENGINE  →  ENHANCED FRAME  →  DISPLAY
```

It is **not** a screenshot tool, not a video filter, and not a pre-rendered demo.
Every enabled feature runs real GPU processing on every frame, continuously, while the
game stays fully playable.

---

## What it actually does (honest engineering)

Nexus captures the game's rendered frames **live** via the Windows Desktop Duplication API,
processes **each frame** through a DirectX 11 compute-shader pipeline, and presents the
enhanced result in a topmost window aligned over the game (the same proven architecture as
mainstream "scaler/enhancer" tools — nothing is injected into the game and no game files are
touched, which keeps it safe with anti-cheat systems).

### The enhancement pipeline (all real, all measured)

| Pass | What it computes |
|---|---|
| **Motion estimation** | Hierarchical block-matching (coarse ±6 px search + refinement) on quarter-resolution luma between the previous and current frame |
| **Temporal reconstruction** | Motion-compensated accumulation of history with neighborhood clamping, disocclusion rejection and thin-geometry protection — rebuilds stable detail from *multiple frames* |
| **Edge-directed upscaling** | Direction-adaptive cubic reconstruction (sharper kernel across detected edges, smoother along them) + anti-ring soft clamping — 720p→1080p/1440p/4K etc. are real reconstructions, not bilinear stretches |
| **Anti-aliasing** | Luma-edge detection with edge-tangent blending; OFF/LOW/MEDIUM/HIGH/ULTRA/EXTREME change real thresholds, kernel radii and strength |
| **Detail engine** | Multi-scale detail recovery (fine + mid bands), local contrast (CLAHE-like), distant-detail restoration (atmospheric-perspective dehaze-lite), edge-aware denoise, deband dither |
| **Shadow / AO / lighting** | Screen-space shadow masks with temporal stabilization, in-mask detail recovery, contact/crease occlusion proxy, exposure + highlight compression, specular stabilization |
| **Scene-adaptive pass** | Vegetation shimmer control, particle contrast/flicker smoothing, water streak sharpening, skin/character protection |
| **Color engine** | Brightness, contrast, saturation, highlights, shadows, gamma, temperature, HDR-like filmic shoulder — plus real scRGB HDR output when the desktop is actually in HDR mode |
| **Final** | Overshoot-controlled sharpening (soft-clamped against the local min/max), dithering, ORIGINAL/SPLIT comparison mux |

Every pass is skipped entirely when its feature is set to OFF — disabling features gives
back real GPU time.

### What post-processing *cannot* do (we don't claim otherwise)

* It cannot add polygons, raise native texture/shadow-map resolution, or enable ray tracing.
* AO-proxy and reflection enhancement are estimates from the captured image — no depth
  buffer exists in capture mode, and the UI says so plainly.
* HDR output is only offered when Windows reports the display is genuinely in HDR mode.
* The FPS, GPU time, latency, dropped-frame and VRAM numbers shown in the app are real
  measurements (QPC/D3D timestamp queries, Desktop Duplication counters, PDH, DXGI memory
  queries) — never simulated.

---

## Feature map (spec → implementation)

| Spec section | Where it lives |
|---|---|
| 1. Modular enhancement engine | `src/shaders.h` (14 compute kernels), `src/engine.cpp` (orchestration) |
| 2. Texture enhancer | `CS_DETAIL` (texture clarity, fine detail, temporal accumulation) |
| 3. Super resolution 720p→4K | `CS_UPSCALE` + profile input/output resolution pairs in the GAMES tab |
| 4. Temporal reconstruction | `CS_MOTION` + `CS_TEMPORAL` (OFF…EXTREME) |
| 5. Next-gen AA | `CS_AA` (OFF/LOW/MEDIUM/HIGH/ULTRA/EXTREME) |
| 6. Smart shadow enhancer | `CS_LIGHT` (quality/detail/stability/softness/contact — not a darken slider) |
| 7. Lighting enhancer | `CS_LIGHT` (quality/local contrast/light detail/exposure/dynamic range) |
| 8. AO enhancer | `CS_LIGHT` crease+contact proxy (OFF…EXTREME, halo-guarded) |
| 9. Reflection enhancer | `CS_LIGHT` specular stabilize + sharpen (honest screen-space) |
| 10. Global detail boost | 0–100 slider driving reconstruction/detail/edge parameters together |
| 11. Long distance detail | `CS_DETAIL` haze-masked distant restoration |
| 12. LOD enhancement | temporal reconstruction + distant detail reduce visible LOD popping harshness (no game assets are modified) |
| 13. Vegetation enhancer | `CS_SCENE` vegetation mask (stability, AA, shimmer control) |
| 14. Character quality | skin mask protects faces from overshoot; edges stabilized temporally |
| 15. Particle enhancer | `CS_SCENE` bright-blob contrast + flicker smoothing |
| 16. Water enhancement | `CS_SCENE` blue/streak mask sharpening |
| 17. Image quality engine | sliders bound 1:1 to shader uniforms |
| 18. Color engine + presets | `CS_COLOR` + Natural/Cinematic/Vivid/Realistic/Competitive |
| 19. HDR / display | advanced-color detection; scRGB FP16 swapchain only when HDR is active |
| 20. Quality presets | LOW ENHANCEMENT / QUALITY / ULTRA / EXTREME / REALISTIC / CINEMATIC / MAX GRAPHICS / CUSTOM |
| 21. Master graphics slider | 0–100% master scaling of all strengths (0% = untouched original) |
| 22. Advanced control panel | ENHANCEMENT tab, every module OFF…EXTREME where meaningful |
| 23. Before/after + split | **CTRL+F9** instant ORIGINAL↔ENHANCED, **CTRL+F10** split view with draggable divider (enable *overlay interaction* in SETTINGS, or click through disabled) |
| 24. In-game overlay | GDI+ HUD with game name, preset, in/out resolution, module levels, real FPS/ms |
| 25. Game profiles | per-game INI in `%APPDATA%\NexusGraphicsEngine\profiles` |
| 26. Auto-detect / manual add | process scanning + **Add game manually** (.exe picker) |
| 27. Hardware detection | GPU/VRAM/CPU/RAM/DirectX feature level/Vulkan/monitor/refresh/HDR + computed recommendation |
| 28. Performance monitor | real FPS, frame time, GPU/CPU %, VRAM, processing ms, dropped frames, latency + graphs |
| 29. Auto optimization | target-FPS feedback loop (30/60/90/120/144) adjusting real module levels from measured GPU time |
| 30. Real-time processing | continuous capture→process→present loop; a built-in **GPU self-test** runs the full pipeline on a synthetic scene to prove it |
| 31. Compatibility | DX11-based (FL 11.0+); unsupported features degrade honestly with status messages |
| 32. Anti-cheat safety | fully external: no injection, no hooks into the game, no protected-file writes |
| 33. Local/offline | 100% local. HLSL compiled at runtime by the OS `d3dcompiler_47.dll` |
| 34. Post vs. actual graphics | About tab states exactly what screen-space processing can and cannot claim |

---

## Using it

1. Run `NexusGraphicsEngine.exe`.
2. **GAMES** tab → add your game (browse to its `.exe`; auto-detect also lists running games).
3. Choose the resolution pair (e.g. `1280x720 → 1920x1080`) and a preset such as
   **MAX GRAPHICS**.
4. **HOME** → `ACTIVATE`. Launch (or switch to) the game — Nexus attaches to its window and
   the enhanced image appears over it. The game remains playable (mouse/keyboard pass
   through).
5. **CTRL+F9** anywhere in Windows flips between ORIGINAL and NEXUS ENHANCED.
   **CTRL+F10** enables a draggable split view. **CTRL+F11** toggles the HUD.
6. PERFORMANCE tab → enable *Auto optimizer* with a target FPS to let Nexus find the
   strongest settings that hold your frame rate.

> **Best results:** run games in **windowed** or **borderless** mode at the render
> resolution you want enhanced (e.g. 1280×720). Exclusive-fullscreen games bypass the
> Windows compositor and cannot be overlaid — switch them to borderless.

Run the pipeline verification without any game:

```
NexusGraphicsEngine.exe --smoke-test
```

This compiles every shader, executes the full enhancement pipeline for 150 synthetic
frames (moving geometry, fine checker, vegetation strip, particles) and prints
`PASS` with the measured GPU cost per frame.

## Hotkeys

| Hotkey | Action |
|---|---|
| `CTRL+F9` | Original ↔ Enhanced (instant) |
| `CTRL+F10` | Split view on/off (divider draggable when overlay interaction is enabled) |
| `CTRL+F11` | HUD on/off |
| `CTRL+F12` | Activate/stop enhancement for the selected profile |

## Building from source

Everything is plain C++17 + HLSL (compiled at runtime — no shader build step) and Dear
ImGui (vendored).

**On Linux** (cross-compile, exactly how `release/NexusGraphicsEngine.exe` is produced):

```bash
pip install ziglang        # LLVM/clang/lld toolchain + mingw-w64 headers/libs
./build.sh                 # → release/NexusGraphicsEngine.exe (resources embedded)
```

**On Windows** (MSVC):

```bat
cl /std:c++17 /O2 /EHsc /DUNICODE /D_UNICODE /Isrc /Ithird_party\imgui ^
   /Ithird_party\imgui\backends src\*.cpp src\generated\*.cpp ^
   third_party\imgui\imgui.cpp third_party\imgui\imgui_draw.cpp ^
   third_party\imgui\imgui_tables.cpp third_party\imgui\imgui_widgets.cpp ^
   third_party\imgui\backends\imgui_impl_win32.cpp third_party\imgui\backends\imgui_impl_dx11.cpp ^
   /link /SUBSYSTEM:WINDOWS d3d11.lib dxgi.lib d3dcompiler_47.lib dwmapi.lib pdh.lib ^
   gdiplus.lib imm32.lib shell32.lib shlwapi.lib comdlg32.lib ole32.lib advapi32.lib gdi32.lib user32.lib
```

(Windows builds can use `rc.exe` for the icon/manifest instead of `tools/add_resources.py`.)

## Repository layout

```
nexus/
├── build.sh                    # one-command cross-build (+ PE resource embedding)
├── tools/add_resources.py      # adds icon/manifest/version resources to the exe
├── assets/                     # logo, multi-size .ico, UI font (DejaVu Sans)
├── release/NexusGraphicsEngine.exe
├── src/
│   ├── main.cpp                # entry, panel window, global hotkeys, CLI self-test
│   ├── engine.{h,cpp}          # capture → pipeline → present loop, auto-optimize, stats
│   ├── shaders.h               # the 14 real compute kernels (HLSL)
│   ├── d3d.{h,cpp}             # device helpers, runtime HLSL compile, GPU timer
│   ├── config.{h,cpp}          # presets, profiles (INI), app settings
│   ├── games.{h,cpp}           # process auto-detect, launching
│   ├── hwinfo.{h,cpp}          # hardware detection + recommendations + HDR state
│   ├── perfmon.{h,cpp}         # PDH CPU/GPU %, VRAM via DXGI
│   ├── overlay.{h,cpp}         # in-game HUD (GDI+ layered window)
│   ├── ui.cpp / ui_tabs.cpp    # control panel (Dear ImGui): Home/Games/Enhancement/Color/Performance/Settings/About
│   └── generated/              # embedded logo/font arrays
└── third_party/imgui/          # Dear ImGui 1.90.9 (MIT)
```

## Licenses

* Nexus Graphics Engine source: MIT.
* Dear ImGui: MIT (see `third_party/imgui/LICENSE.txt`).
* `stb_image.h`: public domain / MIT.
* DejaVu Sans font: free license (Bitstream Vera derivative), embedded unmodified.
