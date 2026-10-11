# VYRO PLAY

A premium Android video client built with **Kotlin**, **Jetpack Compose** and **Material 3**.
It searches real YouTube content through the **YouTube Data API v3**, plays it with
YouTube's **official IFrame player**, and plays the user's own video files offline with
**Media3 / ExoPlayer**.

> **Legal / policy note.** VYRO PLAY does **not** download YouTube videos, extract stream
> URLs, proxy media or bypass DRM. All YouTube playback happens inside YouTube's own
> player. The app's *Offline* section documents the supported ways to watch YouTube
> offline (YouTube Premium, YouTube Music, files you own) and never implements
> unauthorised downloads.

---

## Contents

* [Features](#features)
* [Screens](#screens)
* [Architecture](#architecture)
* [Project layout](#project-layout)
* [Building the APK](#building-the-apk)
* [API key](#api-key)
* [Performance notes](#performance-notes)
* [Testing](#testing)
* [Permissions](#permissions)

---

## Features

**Discovery**

* Real YouTube Data API v3 search with pagination, debounced typing and suggestions
* Trending feed (`chart=mostPopular`) plus eight quick categories
* Deep-link support: open `youtube.com/watch?v=…`, `youtu.be/…` and shared links in the app

**Playback**

* Official YouTube player (IFrame Player API through
  [`android-youtube-player`](https://github.com/PierfrancescoSoffritti/android-youtube-player))
* Quality menu driven by the stream's real `getAvailableQualityLevels()`, **including
  2160p / 4K** when the video has it
* Captions on/off with a preferred language (`cc_load_policy` / `cc_lang_pref`)
* Fullscreen: immersive, sensor-landscape, screen kept awake, transient system bars
* Local files play through ExoPlayer at whatever resolution the file has (4K included)
* Watch progress is saved and playback can be resumed where you left off

**Library (persisted locally)**

* Favorites (Room)
* Watch history with progress bars, watch counts and sort by recency / most watched
* Search history with per-query use counts, or fully disabled
* "My videos" — MediaStore scan of the device's own video files

**Offline**

* A dedicated *Offline* section explaining the officially supported options
* Data Saver caps streaming at 480p on metered connections
* Local-file playback needs no network at all

**Settings**

* Theme: System / Light / Dark
* Dynamic colour (Android 12+), pure-black OLED mode, reduced animations
* Preferred quality, captions + language, autoplay next
* Thumbnail quality, Data Saver, Restricted Mode, content region
* History limits, clear search/watch history, clear image cache
* Runtime API-key entry

**System quality**

* Explicit loading / empty / error / offline states for every screen
* Live network classification (none, slow, metered, fast, unmetered Wi-Fi)
* Responsive layout: bottom bar on phones, navigation rail on tablets and unfolded devices
* No `java.time`, no desugaring, bounded caches — see [Performance notes](#performance-notes)

---

## Screens

| Screen | Highlights |
| ------ | ---------- |
| **Home** | Wordmark header, offline chip, category chips, two hero cards, paginated trending/category feed, pull-to-refresh |
| **Search** | Material 3 `SearchBar`, history-backed suggestions, result count, infinite scroll |
| **Library** | Four tabs — Favorites / History / Offline / My videos |
| **Player** | 16:9 player, quality menu, captions, favourite, share, open-on-YouTube, fullscreen, expandable description, up-next |
| **Local player** | ExoPlayer with transport controls, 10 s skip, fullscreen |
| **Settings** | Six grouped sections, segmented theme picker, dropdowns, API-key dialog |

---

## Architecture

Clean, layered, unidirectional:

```
UI (Compose)  →  ViewModel (StateFlow)  →  Use case  →  Repository  →  DataSource
                                                            ↑
                                             Room / DataStore / OkHttp
```

* **`:core`** — a plain Kotlin/JVM module with **zero Android dependencies**: domain
  models, ISO-8601 parsing, formatters, URL building, quality resolution and the
  history/search policy rules. Fast to compile and trivially unit-testable.
* **`:app`** — everything Android: Compose UI, Room, DataStore, OkHttp, Hilt.

Dependency injection uses **Hilt**; all cross-cutting concerns (JSON, HTTP cache, image
cache, repositories) are provided by three modules under `di/`.

State is exposed as a single `StateFlow<UiState>` per screen, built with `combine` over
the independent sources (settings / favourites / network / data). Screens are therefore
stateless and easy to preview.

```
com.vyro.play
├── di/            Hilt modules (App, Database, Repository, Connectivity)
├── data/
│   ├── remote/    YouTube Data API v3 client, DTOs, DTO→domain mapping, error mapping
│   ├── local/     Room database, DAOs, entities, MediaStore scanner
│   ├── datastore/ DataStore preferences (settings + separate API-key store)
│   └── repository/ Repository implementations
├── domain/
│   ├── repository/ Repository interfaces (what the ViewModels depend on)
│   └── usecase/    ApiKeyStatus, ToggleFavorite, RecordWatch, RemoveFromHistory
├── feature/       home · search · player · localplayer · library · offline · settings
└── ui/            theme, shared components, navigation
```

---

## Project layout

```
android/
├── app/                       Android application module
│   ├── schemas/               Room schema exports
│   └── src/
│       ├── main/              Kotlin + AndroidManifest + res
│       ├── test/              JVM unit tests
│       └── androidTest/       Instrumented smoke test
├── core/                      Pure Kotlin domain module
│   └── src/{main,test}/kotlin
├── gradle/
│   ├── libs.versions.toml     Single source of truth for every dependency version
│   └── wrapper/
├── tools/offline-verify/      Gradle-free runner for the :core unit tests
├── gradlew / gradlew.bat
├── settings.gradle.kts
├── build.gradle.kts
├── API_SETUP.md               How to create and supply a YouTube API key
└── local.properties.example
```

---

## Building the APK

### Requirements

| Tool | Version used | Notes |
| ---- | ------------ | ----- |
| JDK | **17** | AGP 8.7 does not support JDK 21 for all tasks; JDK 17 is the safe choice |
| Android SDK | `compileSdk 34`, build-tools 34.x | Install **Android SDK Platform 34** and **Build-Tools 34** |
| Gradle | 8.9 (via the wrapper) | Downloaded automatically |
| Network | Access to `dl.google.com`, `repo1.maven.org`, `services.gradle.org` | First build downloads ~700 MB |

### Commands

```bash
cd android

# 1. Point Gradle at your SDK (Android Studio does this for you)
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
echo "youtube.api.key=AIza...your-key..." >> local.properties

# 2. Debug APK  → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleDebug

# 3. Release APK (needs a signing config) → app/build/outputs/apk/release/app-release.apk
./gradlew :app:assembleRelease

# 4. Install on a connected device
./gradlew :app:installDebug
```

Or simply open the `android` directory in Android Studio (Hedgehog / Iguana or newer) and
press **Run**.

### Prebuilt APKs

Two ready-to-install builds are committed to this repository and refreshed automatically by
[the CI workflow](../.github/workflows/vyro-play-apk.yml) on every push:

| File | Package | Notes |
| ---- | ------- | ----- |
| [`android/apk/vyro-play-debug.apk`](apk/vyro-play-debug.apk) | `com.vyro.play.debug` | Unminified, debuggable — recommended for testing |
| [`android/apk/vyro-play-release.apk`](apk/vyro-play-release.apk) | `com.vyro.play` | R8-minified and resource-shrunk (~3 MB), signed with the debug key |

Install with `adb install android/apk/vyro-play-debug.apk`, or copy the file to the device
and open it. Both APKs are built **without** an API key, so on first launch the app asks for
one in **Settings → YouTube Data API → API key**.

### Signing the release build

`app/build.gradle.kts` uses the default debug keystore for `debug`. For `release`, add a
signing config (never commit the keystore):

```kotlin
signingConfigs {
    create("release") {
        storeFile = file(System.getenv("VYRO_KEYSTORE") ?: "vyro.jks")
        storePassword = System.getenv("VYRO_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("VYRO_KEY_ALIAS")
        keyPassword = System.getenv("VYRO_KEY_PASSWORD")
    }
}
```

---

## API key

The app needs a **YouTube Data API v3** key. Full walk-through: **[API_SETUP.md](API_SETUP.md)**.

Quick version:

```bash
# android/local.properties  (git-ignored)
youtube.api.key=AIzaSy...
```

…or open **Settings → YouTube Data API → API key** inside the app and paste a key.

The key is compiled into `BuildConfig` only when you provide one; the committed default is
an empty string, so **no secret is ever stored in the repository**.

---

## Performance notes

Targeted at low-end phones:

* **`minSdk 23`** and no `java.time`, so **no core-library desugaring** — smaller DEX,
  faster installs.
* **Coil** with a 24 MB disk cache and a memory cache capped at 18 % of the heap; bitmaps
  are downsampled to the size actually drawn.
* **OkHttp** 8 MB HTTP cache with a 5-minute `max-age` on API responses, which also saves
  API quota.
* **Lazy lists everywhere** with stable `key`s and `contentType`, plus skeleton placeholders
  instead of blocking spinners.
* Pagination prefetches 6 items before the end of the list and de-duplicates by video id.
* Watch history is trimmed automatically to the user's configured limit.
* R8 (full mode) + resource shrinking on release builds.
* `hardwareAccelerated=true`, `largeHeap=false` — the app is expected to live inside a
  normal heap budget.

---

## Testing

```bash
./gradlew :core:test          # pure-Kotlin domain tests (no Android needed)
./gradlew :app:testDebugUnitTest   # DTO mapping, quality bridge, error mapping
./gradlew :app:connectedAndroidTest  # instrumented smoke test (device/emulator)
```

`core/src/test` covers duration/date parsing, formatting, URL building, quality
resolution, and the search/watch history policies.
`app/src/test` pins down the exact YouTube JSON wire format, the IFrame quality bridge and
the HTTP error taxonomy.

### Running the `:core` tests without Gradle

If you have a Kotlin compiler but no Gradle/Android SDK:

```bash
kotlinc -cp "$KOTLIN_HOME/lib/kotlin-test.jar" \
        -d /tmp/vyro-core \
        core/src/main/kotlin core/src/test/kotlin tools/offline-verify/OfflineVerify.kt
java -cp "/tmp/vyro-core:$KOTLIN_HOME/lib/kotlin-test.jar" OfflineVerifyKt
```

---

## Permissions

| Permission | Why |
| ---------- | --- |
| `INTERNET` | YouTube Data API and the official player |
| `ACCESS_NETWORK_STATE` | Offline detection and adaptive quality |
| `READ_MEDIA_VIDEO` (33+) / `READ_EXTERNAL_STORAGE` (≤32) | Listing the user's own video files for local playback |

No other permission is requested. Favorites, history and settings stay on the device; the
database and the API-key store are excluded from cloud backups.

---

## Third-party libraries

| Library | Licence | Purpose |
| ------- | ------- | ------- |
| Jetpack Compose / Material 3 | Apache 2.0 | UI |
| Hilt | Apache 2.0 | Dependency injection |
| Room | Apache 2.0 | Local persistence |
| DataStore | Apache 2.0 | Preferences |
| OkHttp | Apache 2.0 | Networking |
| kotlinx.serialization | Apache 2.0 | JSON |
| Coil | Apache 2.0 | Image loading |
| Media3 (ExoPlayer) | Apache 2.0 | Local playback |
| android-youtube-player | Apache 2.0 | Official YouTube IFrame player |
