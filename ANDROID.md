# VYRO PLAY — Android

A native Kotlin / Jetpack Compose video discovery and personal library app. Package: `com.vyro.play`; Android 7.0+ (API 24). The pre-existing website in this repository is separate.

## Install

Download `output/VYRO_PLAY.apk` from the delivered workspace (or the **VYRO PLAY** GitHub Actions build artifact). On an Android device, open the APK and allow installation from this source, or use `adb install -r output/VYRO_PLAY.apk`. This is a **debug** build, signed by the build runner for testing; it is not a Play Store release. Future debug builds from another runner may use a different debug certificate and need the previous installation removed first.

## Build and test from source

Open this repository in Android Studio (JDK 17, Android SDK platform 35, Gradle 8.10.2), then sync. Or run:

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
# optional on a device/emulator
./gradlew :app:connectedDebugAndroidTest
cp app/build/outputs/apk/debug/app-debug.apk output/VYRO_PLAY.apk
```

CI (`.github/workflows/vyro-play.yml`) builds and runs JVM tests on every push to the session branch. Device/instrumentation tests require a connected Android device or emulator. No Android SDK or JDK is preinstalled in this workspace, so compilation runs on GitHub's Android runner.

## YouTube setup

1. Create a Google Cloud project; enable **YouTube Data API v3**; create an API key. Restrict it appropriately (API restriction to YouTube Data API v3; consider Android application restrictions if compatible with your deployment) and monitor your project's quota. No key is included in source or APK.
2. In **Settings → YouTube Data API v3**, enter your key and tap **Save key**. The app stores it in private on-device DataStore (backup disabled). Video/channel search and US popular videos now query the actual API. Search page tokens are used for pagination; recent search suggestions come only from local history, not an undocumented YouTube endpoint.
3. Tap a video to load the official YouTube embedded player, or **Watch on YouTube** if the video disallows embedding. YouTube determines quality, available captions, and playback controls; this app cannot force 4K or override player-selected quality. Network access and API quota are required for discovery. Official YouTube offline downloads, when eligible, are available only in YouTube's own app.

## Personal files and privacy

**Library → Local → Add my video** invokes Android's Storage Access Framework. A persisted read grant for the selected `content://` URI is stored by Android and Media3 plays the original file; no broad storage permission or file copy is needed. If the provider or drive disappears, reconnect it or select the file again. Progress, favorites, searches and history are stored on-device in Room; settings are in DataStore. Turn off history in Settings to stop recording new opens and progress; clear history and recent searches separately there. Nothing uploads personal history to an app server. Embedded YouTube and Data API access contact Google under its terms and privacy policy.

## Limitations

* The YouTube Data API does **not** provide official autocomplete or streams. Recent local searches are shown instead of invented suggestions. No YouTube streams are extracted or downloaded.
* YouTube embed playback is subject to uploader restrictions, region, DRM, account and official player support. The app offers a link to YouTube when an embed does not work.
* The quality setting explains the preference but cannot force quality in YouTube's player. For local files, the file's own quality is used.
* Tests requiring SAF providers, runtime WebView embed availability and actual media decoding should also be checked manually on real devices; the included instrumented Room tests require an emulator/device.
