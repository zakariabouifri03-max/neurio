# Taskly — Release & Google Play build guide

## 0. Prerequisites

| Item | Value / status |
| --- | --- |
| Flutter channel | stable, **3.27 or newer** |
| Android compileSdk / targetSdk | **36** (Android 16) — required for new apps and updates submitted after **Aug 31, 2026** |
| minSdk | 23 (Android 6.0) |
| JDK | 17 |
| Gradle / AGP | 8.14 / 8.11.1 (committed wrapper) |
| Application ID | `com.taskly.app` |
| Version | `version: 1.0.0+1` in `pubspec.yaml` (name+code) |

Verify current Play requirements before submitting — Google's target-API
policy advances yearly (API 36 deadline: Aug 31, 2026, extensions until
Nov 1, 2026). If a newer target becomes mandatory, bump `compileSdk` and
`targetSdk` in `android/app/build.gradle` and re-test.

## 1. Versioning

Bump both parts in `pubspec.yaml` before every upload:

```yaml
version: 1.0.1+2   # versionName+versionCode
```

Play requires a strictly increasing `versionCode`.

## 2. App signing (upload key)

Create a key **once** and back it up somewhere safe (Play App Signing will
hold the actual signing key; this is your upload key):

```bash
keytool -genkeypair -v -keystore taskly-upload.jks -keyalg RSA \
        -keysize 2048 -validity 10000 -alias taskly-upload
```

Create `android/key.properties` (never commit it — it is git-ignored):

```properties
storePassword=*****
keyPassword=*****
keyAlias=taskly-upload
storeFile=/absolute/path/to/taskly-upload.jks
```

`android/app/build.gradle` picks it up automatically; without it, release
builds fall back to debug signing so you can still test locally.

Recommended: enroll in **Play App Signing** when creating the app in Play
Console and keep this key as the upload key.

## 3. Build the Android App Bundle

```bash
cd taskly
flutter clean
flutter pub get
flutter build appbundle --release
```

Output: `build/app/outputs/bundle/release/app-release.aab`

Useful extras:

```bash
flutter build apk --release            # universal APK for side-loading/QA
flutter build appbundle --release --split-per-abi   # not for Play; Play wants one .aab
```

## 4. Pre-upload checklist

- [ ] `flutter analyze` clean, `flutter test` green.
- [ ] Manual pass over the 12-point QA list in `docs/TESTING_REPORT.md`.
- [ ] Reminders verified on a physical device (idle + doze + reboot).
- [ ] Light & dark themes checked on every screen.
- [ ] Version code bumped; release notes written.
- [ ] Privacy policy URL live (must be a hosted page; the in-app copy in
      `lib/screens/app_info_screen.dart` and `docs/PRIVACY_POLICY.md` must match it).
- [ ] Store assets ready (see `docs/PLAY_STORE_LISTING.md`).

## 5. Play Console steps (manual — require your developer account)

1. Create the app (name “Taskly”, default language en-US).
2. Complete **Data safety** per `docs/PLAY_STORE_LISTING.md` (no data collected).
3. Content rating questionnaire: answer for a general-audience productivity
   app (expect “Everyone”).
4. Target audience & content: select 13+ / all ages as appropriate; the app
   has no user-generated content or social features.
5. Upload the `.aab` to **Internal testing** first, then promote.
6. Provide store listing text, icon (512×512: `assets/branding/play_store_icon_512.png`),
   feature graphic (1024×500) and screenshots (see checklist in the listing doc).
7. Ads declaration: **No ads** (this build ships none).
8. App access: no login required — note “app is fully functional offline”.

## 6. What still needs a human

- Google Play Developer account ($25 one-time) and acceptance of the
  distribution agreements.
- Hosted privacy-policy URL.
- Play App Signing enrollment decision.
- Real-device reminder QA on OEM skins (Xiaomi/OPPO/Samsung battery managers).
- Final store asset artwork if you want photography-style screenshots.

Nothing else blocks release: the code, signing config, manifest, icons and
bundle build are all in place.
