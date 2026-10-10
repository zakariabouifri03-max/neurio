# Test plan & results

## Automated (run in CI on every push — `.github/workflows/ai-vibes-apk.yml`)

1. `:app:testDebugUnitTest` — 8 JVM DSP tests (`app/src/test/.../DspTest.kt`):
   * peaking/low-shelf/high-shelf magnitude responses at expected frequencies
   * FFT peak-bin accuracy for a 1 kHz sine
   * limiter keeps |sample| ≤ 1.05 with maximum EQ/bass/preamp boosts
   * spatial width increases side-channel energy
   * analyser returns an EMPTY snapshot with no audio (no fabricated data)
   * analyser reports real energy for a real signal
   * neutral config is near-transparent (mean error < 0.01)
2. `:app:assembleDebug` + `:app:assembleRelease` — full compilation of the
   Kotlin/Compose/Media3 app; APKs uploaded as artifacts and release assets.

## Local authoring checks (same tests + extra)

* `tools/dsp-selfcheck/DspSelfCheck.kt` — numeric mirror of the unit tests,
  executed on a stock JVM (all passing at authoring time).
* `tools/compile-check/run.sh` — type-checks the engine layer (dsp, audio,
  playback, headphones, settings, ai) against API stubs copied from the real
  androidx/media 1.4.1 sources plus an API-34 `android.jar`.
* `tools/static_check.py` — bracket balance, project-import resolution,
  `R.*` references, XML well-formedness (33 Kotlin files, 0 errors).

## Manual device checklist (for a real phone)

- [ ] Onboarding: 4 steps, permission prompts explained before requesting
- [ ] Library lists MediaStore songs; play/pause/next/prev/seek work
- [ ] Background playback survives leaving the app; notification + lock screen
      controls work; audio focus loss pauses gracefully
- [ ] Unplugging headphones pauses playback ("becoming noisy")
- [ ] Wired + Bluetooth detection updates live; battery shows only if reported
- [ ] Per-device preset auto-loads on reconnect (with auto-load enabled)
- [ ] EQ/bass/spatial/dynamics audible and persisted across app restarts
- [ ] Visualizer reacts to real audio; idle state when paused; battery-saver
      halves frame rate (no heat-up on budget devices)
- [ ] Smart Match only modifies settings while audio is playing (honest copy)
- [ ] Reset-to-default restores Flat preset
