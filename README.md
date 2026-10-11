# VYRO PLAY — Ultra HD YouTube & Local Video Android App

**VYRO PLAY** is a native Android video application built with **Kotlin**, **Jetpack Compose**, and **Material 3**. It features a premium **Obsidian Black & Royal Purple** interface with **Cyber Cyan** accents, real **YouTube Data API v3** search & discovery, an **Officially Permitted YouTube IFrame Player** integration supporting up to **4K (2160p)** playback, persistent **Room** storage for favorites/watch history/search history, **Jetpack DataStore** settings, and a built-in **AndroidX Media3 ExoPlayer** for local device videos alongside official YouTube offline-viewing guidance.

---

## Key Features

- **Premium Black, Purple & Cyan Material 3 UI**:
  - Custom Dark Obsidian (`#06050B`) & Electric Purple (`#8B5CF6`) theme with Cyber Cyan (`#00F0FF`) accents, plus a high-contrast Light Violet & Cyan theme and System-follow mode.
  - Smooth spring animations on favorite toggles, animated search history expansion, and responsive `LazyVerticalGrid` layouts that scale across compact phones, foldables, and tablets.
- **Real YouTube Data API v3 Integration**:
  - Searches real YouTube videos via `https://www.googleapis.com/youtube/v3/search` and enriches every result with `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics` (ISO-8601 duration, HD/4K resolution badges, closed-caption indicator, view counts, and like counts).
  - Supports trending/popular discovery feeds (`chart=mostPopular`) across categories (**Trending**, **4K Ultra HD**, **Music**, **Gaming**, **Tech & AI**, **Science & Space**, **Nature 4K**, **Kotlin & Dev**).
  - Includes a **Direct URL / Video ID Player** (`https://www.youtube.com/oembed` + Official IFrame Player) so users can also paste any `youtube.com/watch?v=...` or `youtu.be/...` link and play immediately even before configuring a search API key.
- **Official YouTube Player Integration (Up to 4K 2160p)**:
  - Uses the official **YouTube IFrame Player API** (`https://www.youtube.com/iframe_api`) inside a hardware-accelerated Android `WebView` with a two-way `@JavascriptInterface` bridge (`VyroYouTubeBridge`).
  - Supports quality selection up to **2160p 4K (`hd2160`)**, **1440p 2K (`hd1440`)**, **1080p (`hd1080`)**, **720p (`hd720`)**, **480p (`large`)**, **360p (`medium`)**, **240p (`small`)**, and **Auto (`auto`)**.
  - Synchronized playback controls: Play/Pause, interactive Seek Bar, `-10s` / `+10s` skip, Mute/Unmute, **Captions (`CC`) toggle & language preference**, **Playback Speed (`0.5x` – `2.0x`)**, **Fullscreen landscape mode**, and one-tap **Open in Official YouTube App** fallback.
- **Offline Viewing Section & Local Video Player**:
  - **Local Video Player (`AndroidX Media3 ExoPlayer`)**: Pick any local MP4, MKV, WebM, or MOV video file via Android's Storage Access Framework (`OpenMultipleDocuments`) or scan device videos via `MediaStore.Video.Media`. Supports up to 4K local playback, subtitles, playback speed, Fit/Zoom aspect modes, fullscreen, and automatic resume timestamps.
  - **Official YouTube Offline Guide**: Policy-compliant educational guide explaining official YouTube offline viewing via the YouTube app & YouTube Premium. Strictly respects YouTube Terms of Service — **no unauthorized downloading, stream extraction, or DRM circumvention**.
- **Persistent Room Database & DataStore Preferences**:
  - **Room (`VyroPlayDatabase`)**: Persists `favorites`, `watch_history` (with progress bars and resume timestamps), `search_history`, `saved_local_videos`, and `api_cache` (policy-compliant 15-minute TTL cache).
  - **DataStore (`SettingsDataStore`)**: Persists theme mode, default video quality, captions toggle & language, SafeSearch filter, low-end performance mode, region code, and custom YouTube API key.
- **Optimized for Low-End Android Phones**:
  - **Coil ImageLoader** tuned with `Bitmap.Config.RGB_565` (50% less bitmap RAM) on low-RAM phones, capped memory cache (10%–18%), and automatic `mqdefault.jpg` thumbnail selection when **Low-End Phone Performance Mode** is active.
  - All `LazyVerticalGrid`, `LazyColumn`, and `LazyRow` lists use explicit `key` and `contentType` lambdas with immutable models to minimize recomposition.
  - Zero background polling: `ConnectivityManager.NetworkCallback` and `SharingStarted.WhileSubscribed(5_000)` suspend work automatically when the app leaves the foreground.

---

## Project Architecture

```text
neurio/
├── app/
│   ├── build.gradle.kts                  # Android app config, Room KSP, Compose, Media3, Coil, OkHttp
│   ├── proguard-rules.pro                # R8 keep rules for WebView JS bridge & Room entities
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml       # Permissions, queries, hardware acceleration, intent filters
│       │   ├── java/com/vyro/play/
│       │   │   ├── VyroPlayApplication.kt # AppContainer DI + Coil low-RAM ImageLoaderFactory
│       │   │   ├── MainActivity.kt        # Edge-to-edge host Activity + Intent handler
│       │   │   ├── model/
│       │   │   │   └── Models.kt          # Immutable domain models, quality enums, QuotaCachePolicy
│       │   │   ├── data/
│       │   │   │   ├── local/             # Room Entities, DAOs, VyroPlayDatabase
│       │   │   │   ├── preferences/       # Jetpack DataStore SettingsDataStore
│       │   │   │   ├── remote/            # YouTubeApiService (OkHttp) & YouTubeMetadataParser
│       │   │   │   ├── localvideo/        # LocalVideoManager (MediaStore + SAF URI resolver)
│       │   │   │   └── repository/        # VyroRepository (15-min TTL cache, favorites, history)
│       │   │   ├── network/
│       │   │   │   └── NetworkMonitor.kt  # Event-driven ConnectivityManager.NetworkCallback
│       │   │   ├── player/
│       │   │   │   ├── OfficialYouTubePlayer.kt # Official YouTube IFrame API WebView + Bridge
│       │   │   │   └── LocalVideoExoPlayer.kt   # AndroidX Media3 ExoPlayer for local files
│       │   │   └── ui/
│       │   │       ├── VyroPlayApp.kt     # Root Scaffold, Header, Offline Banner, Bottom Nav
│       │   │       ├── components/        # VyroVideoCard, WatchHistoryRowCard, VyroPlayerDock
│       │   │       ├── screens/           # Explore, Favorites, History, Offline, Settings screens
│       │   │       ├── theme/             # Obsidian Black, Royal Purple & Cyber Cyan Material 3 theme
│       │   │       └── viewmodel/         # VyroViewModel (StateFlow + SavedState coordination)
│       │   └── res/                       # Adaptive launcher icons, themes, strings, colors
│       └── test/java/com/vyro/play/
│           ├── YouTubeMetadataParserTest.kt # Unit tests for API parsing, ISO durations, URL extraction
│           └── QuotaCachePolicyTest.kt      # Unit tests for 15-min TTL cache & low-end optimizations
├── build.gradle.kts                      # Root Gradle configuration (AGP 8.5.2, Kotlin 2.0.21, KSP)
├── settings.gradle.kts                   # Google Maven & Maven Central repositories
├── gradle.properties                     # AndroidX & JVM build configuration
├── gradlew / gradlew.bat                 # Self-bootstrapping Gradle 8.9 wrapper scripts
├── local.properties.example              # Template for SDK path and YOUTUBE_API_KEY
└── docs/
    └── API_SETUP.md                      # Detailed YouTube Data API v3 setup & security guide
```

---

## YouTube Data API v3 Setup Instructions

See **[`docs/API_SETUP.md`](docs/API_SETUP.md)** for full step-by-step instructions.

1. **In-App Configuration (Recommended — No Rebuild Needed)**:
   - Launch **VYRO PLAY** → go to **Settings → YouTube Data API v3 Configuration** (or tap **Enter API Key** on the Explore screen).
   - Paste your Google Cloud YouTube Data API v3 key and tap **Save & Verify Key**.
2. **Build-Time Configuration (`local.properties`)**:
   - Copy `local.properties.example` to `local.properties` (which is gitignored) and set:
     ```properties
     YOUTUBE_API_KEY=your_youtube_data_api_v3_key
     ```

---

## Building & Testing from Source

### Prerequisites
- **JDK 17** (e.g., Eclipse Temurin 17, bundled with Android Studio Ladybug/Koala)
- **Android SDK Platform 34** (`platforms;android-34`) and **Android SDK Build-Tools 34.0.0** (`build-tools;34.0.0`)

### Commands
```bash
# Run JVM Unit Tests
./gradlew :app:testDebugUnitTest

# Build the installable Debug APK
./gradlew :app:assembleDebug
```

### Generated APK Locations
- **Root convenience copy**: `VYRO-PLAY-debug.apk`
- **Standard Gradle output path**: `app/build/outputs/apk/debug/app-debug.apk`
