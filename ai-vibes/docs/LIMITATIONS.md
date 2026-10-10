# Limitations & honest capability boundaries

AI VIBES is built to be technically honest. Everything below is also surfaced
in the app (Settings → “What AI VIBES can (and cannot) do”).

## Android platform limits (any app, not just this one)

1. **No system-wide processing.** Android routes each app's audio through its
   own mixer session; a normal app cannot insert effects into other apps'
   playback (Spotify, YouTube, games). `AudioPlaybackCapture` (API 29+) can
   *record* other apps' audio via MediaProjection, but:
     * every session needs explicit user consent (system dialog),
     * apps can opt out (`ALLOW_CAPTURE_BY_NONE`), and most streaming apps do,
     * it cannot *modify* their output — only capture it.
   AI VIBES therefore does not claim and does not implement system-wide
   enhancement. It processes the audio of its own Media3 playback pipeline.
2. **No Bluetooth bandwidth changes.** The Bluetooth stack is owned by the OS
   and the headset codec negotiation (SBC/AAC/LDAC…) cannot be altered by apps.
   Headphone physical capabilities also cannot be exceeded.
3. **Hardware spatial audio is a system feature.** Object-based 3D audio
   (e.g. Android Spatializer) lives in the phone's audio HAL + headphones.
   AI VIBES' spatial tab performs real mid/side stereo widening and crossfeed —
   clearly labelled "simulated" in the UI.
4. **Bluetooth battery is device-dependent.** Only some headsets report a
   battery level to Android. The app listens for the system battery broadcast
   and otherwise shows "not reported". (There is no public synchronous API.)

## App-level scope decisions

* The visualizer analyses the post-DSP signal of the in-app player via a tap in
  the processing chain — real data, no microphone/RECORD_AUDIO permission. It
  shows an idle state when nothing plays instead of fake animation.
* "AI Sound" is signal analysis + an on-device statistical controller. The UI
  and this document say so explicitly; no neural network is bundled.
* The system-effects bridge (`android.media.audiofx.*`) is optional assist
  only; the software DSP chain is the primary engine because platform effects
  differ wildly per device (band count, strength support, effect presence).
* Debug-key signing of the release APK is intentional for sideload testing;
  production distribution requires a real keystore (README).
