# Nour Studio for Android

The Android APK is a small native WebView wrapper around Nour Studio. The web files are bundled inside the app and served from Android's local HTTPS asset origin, so the camera API is available without hosting a web server. Video is processed on the phone; the app does not upload camera frames.

## Download and install

**Direct APK:** [NourStudio-Android-v1.0.0.apk](https://github.com/zakariabouifri03-max/neurio/releases/download/nour-studio-v1.0.0/NourStudio-Android-v1.0.0.apk). Open it on Android and allow your browser/file manager to install apps from this source if Android asks. The first time you tap **شغّل الكاميرا**, Android asks for camera permission.

This is a sideloaded, debug-signed APK rather than a Google Play release. A later APK built with a different signing key cannot update it in place; uninstall the old one before installing such a future build.

## WhatsApp limitation

On Android, Nour Studio can preview and adjust the phone camera, but Android does not let an ordinary app replace WhatsApp's camera feed. **The APK does not directly apply its filters inside WhatsApp mobile.** The in-app OBS instructions are for WhatsApp on a computer: use Nour Studio's clean camera view with OBS Virtual Camera, then select that camera in WhatsApp Desktop.

The app cannot speed up a weak connection or recover detail that was not captured. Its low-data setting reduces the camera source size; WhatsApp still controls the final call bitrate.

## Build

Requirements: JDK 17, Android SDK platform 35 and build-tools 35.0.0, Gradle 8.9.

```sh
node tools/copy-android-assets.mjs
cd android
gradle --no-daemon :app:assembleDebug
```

The repeatable GitHub Actions workflow is `.github/workflows/nour-studio-android.yml`. It verifies the APK signature, attaches it to the tagged GitHub Release for permanent direct download, and also stores a 30-day workflow artifact.
