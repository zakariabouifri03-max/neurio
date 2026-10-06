# NEXUS GRAPHICS ENGINE

A local, offline, real-time **screen-space post-processing enhancer** for Windows games.
It captures the desktop composition surface that contains your game window (D3D11
desktop duplication), enhances the frame on-GPU with a 24-pass D3D11 compute pipeline,
and presents the enhanced frame in a top-level window positioned exactly over the game.

## Download

See the GitHub **Releases** page — `nexus.exe` (Windows x64, no install needed).

## What it really does (honest scope)

Nexus is a **post-processing** system. It operates on the already-rendered image:

**Genuine, on-GPU, real-time:**
- Super-resolution upscale (720p/900p/1080p → 1080p/1440p/4K target, edge-aware guided filter)
- Temporal accumulation with motion-gated re-projection (reduces flicker/shimmer)
- FXAA-style anti-aliasing pass, screen-space ambient occlusion (halo-controlled)
- Adaptive local-contrast / detail / texture-clarity / denoise passes
- Shadow-region and lighting local contrast (never a global darken/brighten)
- Color engine: brightness, contrast, saturation (clamped by default), highlights,
  shadows, gamma, temperature, HDR tone mapping; presets Natural/Cinematic/Vivid/Realistic/Competitive
- HDR output on monitors that support it (color space switched only when supported)
- Real performance monitoring (FPS, frame time, PDH GPU/CPU/VRAM, processing ms)
- Before/after comparison (CTRL+F9) and draggable split view
- Per-game profiles, auto-detect + manual add, hardware detection with recommended settings

**What it does NOT do (and will never claim):**
- It does not increase the game's native polygon count, shadow-map resolution, or
  ray-tracing quality — no graphics API exists that lets an external tool do that.
- It does not modify game files, bypass anti-cheat, or inject into game processes.
- If a feature is not supported on your hardware (e.g. no D3D11, no duplication access
  for a protected window), Nexus says so in the log instead of faking it.

## How to use

1. Run `nexus.exe` (Windows 10/11 x64, any D3D11 GPU).
2. Select your game (auto-detected from running processes, or add the .exe manually).
3. Choose a preset (or **MAX GRAPHICS**) and the output resolution.
4. Start the game and press **Start Session** — the enhanced output window covers the
   game window; the game stays fully playable.
5. **CTRL+F9** — instant before/after. The overlay HUD shows game name, preset,
   input→output resolution, per-feature levels, real FPS and real processing time.

## Requirements

- Windows 10/11 x64, D3D11-capable GPU (DirectX 11 / 12 / Vulkan games all render to a
  surface Nexus can observe; no in-game integration needed)
- The game must not be running in exclusive full-screen with DRM protection (use
  borderless windowed if a game blocks screen capture)

## Building

```bash
bash build.sh   # requires a Zig (>=0.14) toolchain; cross-compiles x86_64-windows-gnu
```

All sources are C++20 in `src/`, shaders are HLSL compiled at runtime by
`d3dcompiler_47.dll` (the only runtime dependency besides standard Windows system DLLs).
No external AI services, no model downloads, fully offline.

## Files

| File | Purpose |
|---|---|
| `src/engine.*` | D3D11 device, 24-pass compute pipeline, shaders, stats |
| `src/capture.*` | Desktop-duplication capture + per-window crop |
| `src/app.*` | Main window, pages, overlay, sessions, hotkeys |
| `src/ui.*`, `src/text.*`, `src/bmp.*` | UI toolkit, font rasterizer, BMP I/O |
| `src/platform.*` | Hardware detection, PDH perf counters, profiles |
| `src/settings.*`, `src/json.*` | Settings model, JSON profiles |
| `dist/nexus.exe` | Built release binary (x64 GUI) |
