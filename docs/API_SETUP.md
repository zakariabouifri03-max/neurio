# VYRO PLAY — YouTube Data API v3 Setup & Security Guide

VYRO PLAY integrates **Google's official YouTube Data API v3** (`search.list` and `videos.list`) for live video search, trending feeds, ISO-8601 duration parsing, 4K/HD resolution indicators, and caption availability, paired with the **Official YouTube IFrame Player API** for playback.

To protect your Google Cloud quota and follow security best practices, **private API credentials are never hardcoded in source control**.

---

## Step 1: Create a YouTube Data API v3 Key in Google Cloud Console

1. Sign in to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `VYRO-PLAY-Android`) or select an existing project.
3. Navigate to **APIs & Services → Library**.
4. Search for **YouTube Data API v3** and click **Enable**.
5. Navigate to **APIs & Services → Credentials**.
6. Click **+ Create Credentials → API key**.
7. Copy your generated API key (it starts with `AIza...`).
8. *(Recommended)* Under **API restrictions**, restrict the key to **YouTube Data API v3**.

---

## Step 2: Configure the Key in VYRO PLAY (Two Options)

### Option A: Configure Directly Inside the Installed APK (No Rebuild Required)

1. Open **VYRO PLAY** on your Android device.
2. Tap the **Enter API Key** button on the Explore screen banner, **or** go to the **Settings** tab → **YouTube Data API v3 Configuration**.
3. Paste your `AIza...` API key and tap **Save & Verify Key**.
4. VYRO PLAY will validate your key live against `https://www.googleapis.com/youtube/v3/videos` and store it locally on your device using **Android Jetpack DataStore Preferences**.

### Option B: Configure at Build Time via `local.properties`

1. In the root of the repository, copy `local.properties.example` to `local.properties` (`local.properties` is in `.gitignore` and will never be committed):
   ```bash
   cp local.properties.example local.properties
   ```
2. Add your API key to `local.properties`:
   ```properties
   sdk.dir=/path/to/your/Android/sdk
   YOUTUBE_API_KEY=AIzaSyYourActualYouTubeDataApiV3KeyHere
   ```
   *(Alternatively, pass `-PYOUTUBE_API_KEY=...` or export `YOUTUBE_API_KEY=...` in your shell environment.)*
3. Build the debug APK:
   ```bash
   ./gradlew :app:assembleDebug
   ```
   Gradle injects the key into `BuildConfig.YOUTUBE_API_KEY` at compile time.

---

## Direct Playback Without a Search API Key

Even before you configure a YouTube Data API v3 key for search:
- Tap the **URL / ID** button next to the search bar on the **Explore** screen.
- Paste any YouTube link (`https://www.youtube.com/watch?v=...`, `https://youtu.be/...`, `https://www.youtube.com/shorts/...`) or an 11-character Video ID, or tap one of the built-in **Official 4K Test Stream** buttons (`Costa Rica 4K` or `Big Buck Bunny 4K`).
- VYRO PLAY resolves the video metadata via YouTube's official public oEmbed endpoint (`https://www.youtube.com/oembed`) and plays it immediately in the **Official YouTube Player**.

---

## Quota & Caching Policy Compliance

- VYRO PLAY caches `search.list` and `videos.list` responses in a local Room table (`api_cache`) with a strict **15-minute Time-To-Live (`CACHE_TTL_MS = 15 * 60 * 1000L`)**.
- Expired cache entries are automatically evicted on app startup, and users can clear the cache at any time under **Settings → Cache & Local Data Management → Clear API Cache**.
- VYRO PLAY strictly obeys YouTube API Services Terms of Service: it never extracts raw media streams, never downloads YouTube streams offline, never circumvents DRM, and automatically pauses playback when the app leaves the foreground.
