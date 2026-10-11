# VYRO PLAY — YouTube Data API v3 setup

VYRO PLAY talks to the **YouTube Data API v3** for search, trending and video metadata.
The API needs a key. **A key is never committed to this repository** — it is read at build
time from a file that Git ignores, or supplied by the user at runtime in **Settings →
YouTube Data API → API key**.

There are three supported ways to provide it, in order of precedence:

| Priority | Method | Best for |
| -------- | ------ | -------- |
| 1 | Runtime entry in **Settings** | End users, testers, anyone without the source |
| 2 | `YOUTUBE_API_KEY` environment variable | CI builds |
| 3 | `local.properties` → `youtube.api.key=…` | Local development |

---

## 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project selector → **New project** → name it (for example `vyro-play`) → **Create**.

## 2. Enable the API

1. In the new project, go to **APIs & Services → Library**.
2. Search for **YouTube Data API v3**.
3. Open it and press **Enable**.

## 3. Create the API key

1. Go to **APIs & Services → Credentials**.
2. **Create credentials → API key**.
3. Copy the key (it starts with `AIza…`).

> For a production release you should additionally **restrict** the key:
> *Application restrictions* → Android apps → add your package name (`com.vyro.play`) and
> SHA‑1 fingerprint; *API restrictions* → limit to **YouTube Data API v3**.
>
> Note that the default key is fine for development but is easily extractable from the APK,
> which is why VYRO PLAY also lets each user supply their own key inside Settings.

## 4. Give the key to the build

### Option A — `local.properties` (recommended for local builds)

Create `android/local.properties` (already listed in `.gitignore`):

```properties
sdk.dir=/home/you/Android/Sdk
youtube.api.key=AIza...your-key...
```

Gradle reads it and exposes the value as `BuildConfig.YOUTUBE_API_KEY`.
A template is provided: [`local.properties.example`](local.properties.example).

### Option B — environment variable

```bash
export YOUTUBE_API_KEY=AIza...your-key...
./gradlew :app:assembleDebug
```

### Option C — in the app (no rebuild needed)

Open VYRO PLAY → **Settings** → **YouTube Data API** → **API key** → paste the key → **Save**.

The key is stored in its own DataStore file (`vyro_api_key`), which is explicitly excluded
from cloud backups (see `app/src/main/res/xml/backup_rules.xml`). Use the **Remove** button
in the same dialog to delete it.

---

## Quota

The free tier grants **10 000 units per day**. VYRO PLAY spends:

| Call | Cost | When |
| ---- | ---- | ---- |
| `search.list` | 100 units | Each search (first page and each pagination page) |
| `videos.list` (`chart=mostPopular`) | 1 unit | Home feed |
| `videos.list` (`id=…`) | 1 unit | Enriching results with duration/views, player metadata |

Practical implications:

* Typing in the search box is debounced (600 ms) and only fires at 2+ characters, so a
  long query costs one or two searches, not one per keystroke.
* Successful API responses are cached by OkHttp for 5 minutes, so rotating the device or
  navigating back does not re-spend quota.
* If the daily quota is exhausted, the app shows a dedicated screen explaining the limit
  and pointing at Settings, where a personal key can be entered.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| "YouTube API key missing" on the home screen | No key found. Add one via Settings or `local.properties`, then rebuild / pull to refresh. |
| "Daily API quota reached" | The free quota is used up. Add your own key in Settings, or wait for the quota to reset at midnight Pacific Time. |
| HTTP 403 `accessNotConfigured` | YouTube Data API v3 is not enabled for the project that owns the key. |
| HTTP 400 `API key not valid` | The key was copied incorrectly, or restricted to a different app/package. |
| Search works but durations show `0:00` | The `videos.list` enrichment call failed (usually quota). Core playback still works. |

---

## What this app does **not** do

* It does **not** download YouTube videos, extract stream URLs or bypass DRM.
* It does **not** use any unofficial/private YouTube endpoint.
* Playback always happens inside YouTube's own official player (the IFrame Player API via
  the open-source `android-youtube-player` library), or in ExoPlayer for files that the
  user already owns.
