# Safi Sound — Android APK

An Android-installable, offline WebView container for the Safi local audio
player in `sound/`. It bundles all HTML/JS/CSS and the AudioWorklet. There is
no dependency on the temporary Arena preview, a website, or a running server.
This is **not** a system-wide volume booster and does not control other apps.

## Requirements / installing

- Android 8.0 (API 26) or later.
- An up-to-date Android System WebView / Chrome. AudioWorklet support varies
  by version. If unavailable, the app explicitly disables positive boost and
  tone presets instead of pretending peak protection is active.
- Download `deliverables/Safi-Sound.apk` and open it on the phone. Android may
  ask you to allow installation from the particular browser/file manager you
  used. Do not disable Play Protect; if it reports a specific threat, stop
  and investigate. Turn off that source's install permission afterwards.
- Choose **Add audio**, select your own file, Play, then increase gain gently.

The app has no INTERNET, microphone, or broad storage permission. Android's
system document picker grants access to files you explicitly choose. The UI
is served from a virtual HTTPS origin by intercepting bundled asset requests;
file:// access and external navigation are blocked. No JS-to-Java bridge is
exposed. Background playback is not implemented; playback pauses when you
leave the activity (except opening the picker). Originals are not modified.

The limiter reduces **sample** clipping from added gain; it cannot guarantee
zero speaker distortion, safe listening levels, or repair clipped recordings.
Boost only affects files played inside this app, never calls or other apps.

## Build

Java 17, Python 3, zip, Android SDK platform 35 / build-tools 35.0.0:

```sh
export ANDROID_HOME=/path/to/android-sdk
bash android-safi/build.sh
```

The script runs aapt2, javac, d8, zipalign, then apksigner. It verifies the APK
signature and prints manifest metadata. No Gradle dependencies or remote web
assets are included. GitHub Actions runs this build on the session branch and
uploads the APK artifact, and commits the APK to `deliverables/` on the
session branch for direct download. Assets are copied from `sound/` at build time; edits do not require
maintaining a separate player implementation.

This is a **sideload/test build**, not a Play Store release. The ephemeral
signing key is discarded after each build and never stored in Git. Subsequent
builds will generally require uninstalling the earlier test app before
installation because the signing certificate changes. The app stores no user
tracks, but any app settings/state are lost on uninstall; original files stay
in their original location. A production release needs a privately managed,
stable signing key before offering in-place updates.

## Validation limits

The web player has automated browser playback/control/offline tests, and the
limiter has DSP tests. The APK build checks compilation, APK structure, SDK
requirements, and signing. These do not replace an on-device WebView, file
picker, speaker-distortion or hearing-safety test. No physical-phone testing
is claimed.
