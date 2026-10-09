# Neurio Android preview

This small native Java shell packages the complete local Neurio web workspace in an installable APK. It does **not** package the old racing game and does not depend on a hosted website. Minimum Android: **8.0 / API 26**, with an up-to-date **Android System WebView** (Chromium 98+).

## Build

Requirements: JDK 17, Android SDK platform 35 and build-tools 35.0.0, `zip`.

```sh
export ANDROID_HOME=/path/to/android-sdk
bash android/build.sh
```

The workflow `.github/workflows/neurio-android.yml` builds on this session branch. Output is `android/out/Neurio-0.1.0-preview.apk` with a SHA-256 checksum. Build files, private signing keys, and APKs are ignored by Git. Distribute binaries via GitHub Releases, not source control.

## Native behavior

- First-party bundled assets are served on a fixed HTTPS virtual origin. No external content is loaded into the bridge-enabled WebView.
- Android document picker selects videos for private local previews. No broad storage permission, video upload, or persisted video copy.
- Workspace export uses Android's Save document dialog. Caption copying uses the native clipboard.
- Android Back closes dialogs / navigation, returns to Overview, then exits.
- System-bar insets work on Android 15; app content remains inside the safe area.
- Plans and profile data remain in WebView local storage; clearing app data or uninstalling removes them. Export first. JSON import is not implemented.
- Auto-backup is disabled. The APK contains no API credentials, analytics SDKs, or Instagram integration.

## Preview signing

The build generates a temporary development signing key, excluded from artifacts and Git. This is a **sideloadable preview**, not a Play Store production release. A later preview may use a different key and require uninstall/reinstall; uninstalling deletes local workspace state. For production, configure a securely managed persistent signing key before distributing updates.

GitHub's build verifies the APK signature and package/activity metadata. Browser tests cover the bundled application; a build alone does not verify behavior on a physical Android device.
