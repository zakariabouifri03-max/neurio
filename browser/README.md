# Neurio Browser

Neurio is a small Android browser shell built on the **Android System WebView** already installed and updated by the phone. The Android app source is in [`../android`](../android). The files in this folder are the installable web preview of its home screen; they are not the Android browser engine.

## What it can do

- Search Google or open an `https://` / `http://` address.
- Keep up to eight tabs, with a home page, bookmarks, and local browsing history.
- Use the Android system download manager, share pages, choose files for website uploads, and open video in fullscreen.
- Offer desktop-site mode and a lightweight setting that blocks network-loaded images.
- Use Android's updated WebView, its normal web cache, and standard HTTPS certificate checks.

## Important limits

- No browser can make a slow Wi-Fi connection faster than the connection or a site's server. Downloads may resume only when the server supports it; this app does not promise extra bandwidth or a fixed download speed.
- The lightweight setting blocks images; it does not compress all traffic and can make some pages look incomplete. It is not enabled by default.
- YouTube controls its own adaptive video stream and quality options. **Auto** is usually the best choice on a slow link; a high resolution cannot be guaranteed without enough bandwidth. Some protected playback or Google sign-in flows may require YouTube/Chrome.
- This is a WebView-based browser, not a full Chromium/Chrome clone: Chrome extensions, Google Chrome sync, and Chrome's built-in password ecosystem are not included.
- The web preview cannot keep arbitrary sites inside its own page because many sites prohibit framing. In that preview, links open in a separate browser tab. The Android app loads sites in its own WebView.
- Offline support in the web preview caches its small interface, not arbitrary websites or video.

## Run the preview

From the repository root:

```bash
python3 -m http.server 8000 --directory browser
# open http://localhost:8000
```

For installation as a PWA, serve it over HTTPS and use the browser's **Add to Home screen** option. The PWA is a home-screen preview, not a replacement for the Android APK.

## Build the Android APK

Open the `android/` folder in Android Studio with **JDK 17** and Android SDK Platform 35 installed, then run the `app` **debug** build. Or, with Gradle 8.7 and the Android SDK configured:

```bash
cd android
gradle :app:assembleDebug
```

The debug APK is created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

A debug-signed installable APK is published here: [Download NeurioBrowser-debug.apk](https://github.com/zakariabouifri03-max/neurio/releases/download/neurio-browser-v1.0.0-debug/NeurioBrowser-debug.apk). It is for testing, not a Play Store release; a production release needs your own stable signing key. The build was run in GitHub Actions because this local sandbox has no JDK or Android SDK. The existing `BashBaqiRacing.apk` at the repository root is the older racing game, **not** Neurio Browser.
