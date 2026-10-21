# Neurio APK Player (Windows)

<img src="src/app-icon.png" width="96" align="right" alt="">

Neurio APK Player is a small Windows program, about 1 MB. It opens an **Android APK** and plays it in a native window, as long as the game is built with **web technology**. Examples:

* HTML5/JS games
* Cordova and Capacitor apps
* Construct, Phaser, PixiJS, Three.js and Babylon.js games
* WebView wrappers like **Bash Baqi Racing**

It is **not an emulator**. It unpacks the game's web files and runs them in the Microsoft Edge **WebView2** engine, which already ships with Windows 10/11. That keeps it light enough for weak PCs.

**Download:** see the [`apk-player-v1.0.0` release](../../../releases/tag/apk-player-v1.0.0), or take [`bin/NeurioApkPlayer.exe`](bin/NeurioApkPlayer.exe) from this branch.

| | |
|---|---|
| Open a game | Click **Open APK**, drag the APK onto the window, drag it onto the `.exe`, or run `NeurioApkPlayer.exe game.apk` |
| Library | Every game you open is remembered with its icon. 📌 creates a desktop shortcut |
| Keys | **F11** / Alt+Enter: fullscreen · **F2**: touch mode · **F1**: library · **F5**: restart · **Ctrl+M**: mute · F12: developer tools |
| Saves | localStorage / IndexedDB persist. Each app gets its own stable origin `https://<package>.apk.example/` |
| Bundles | `.xapk`, `.apks` and `.apkm` are supported; the player uses the base APK inside |
| Portable | Put an empty `portable.txt` next to the exe and data goes to `NeurioApkPlayerData\` instead of `%LOCALAPPDATA%\NeurioApkPlayer` |

## What runs and what doesn't

The player reads `AndroidManifest.xml` and `resources.arsc` itself (binary XML and the resource table) to find the name, icon, orientation and the page the app loads:

| APK type | How it is detected | Result |
|---|---|---|
| Cordova | `assets/www/cordova.js`, `res/xml/config.xml` `<content src>` | ✅ plays. The bridge is stubbed so `deviceready` fires |
| Capacitor | `assets/capacitor.config.json`, `assets/public/` | ✅ plays |
| WebView shell (e.g. Bash Baqi) | `file:///android_asset/...` / `appassets.androidplatform.net` URLs in `classes*.dex` | ✅ plays |
| Other HTML5 | best `index.html` under `assets/` (heuristic) | ✅ usually plays |
| TWA / remote URL wrapper | `config.xml` remote `src`, TWA `DEFAULT_URL` meta-data | 🌐 opens the site |
| Unity, Unreal, Godot, Flutter, React Native, Xamarin, GameMaker, Cocos, Java/Kotlin … | `lib/*/libunity.so`, `assets/bin/Data/`, … | ⚠️ explained: needs Android (emulator or Bliss OS) |

**Input:** games that listen to the keyboard start in PC mode. Touch-only games start in **touch mode**, where the mouse acts as a finger and the page sees an Android WebView user agent and `maxTouchPoints = 5` (via DevTools touch emulation). Press **F2** to switch modes. The choice is saved per game.

## Source layout

```
apk-player/
  src/apk.h, apk.cpp     portable core: zip (miniz), binary XML, resources.arsc, engine/web detection
  src/main.cpp           Win32 + WebView2 host: window, library, launcher bridge, input modes, smoke test
  src/home.html          launcher UI (embedded as RCDATA 101, served from https://player.example/)
  src/app.rc, app.manifest, app.ico, resource.h
  third_party/miniz      miniz 3.0.2 (MIT)
  tests/inspect_main.cpp Linux/macOS CLI around the core (used with ASan/UBSan + fuzzing)
  tests/make_fixtures.py builds tests/fixtures/*.apk (synthetic Cordova + Unity APKs)
  tests/ci-smoke.ps1     Windows smoke tests run by CI
  tools/make_icon.py     draws src/app.ico
  build.bat              MSVC build script
  bin/                   published binaries + CI screenshots (written by CI)
```

## Building

Requirements: Visual Studio 2019/2022 or the Build Tools with *Desktop development with C++*.

```bat
apk-player\build.bat x64     rem -> apk-player\bin\NeurioApkPlayer.exe
apk-player\build.bat x86     rem -> apk-player\bin\NeurioApkPlayer-32bit.exe
```

The script downloads the `Microsoft.Web.WebView2` NuGet package (`WV2_VERSION`, default 1.0.2903.40) into `build\`. It links the WebView2 loader and the C runtime statically (`/MT`), so the exe has no DLL dependencies besides Windows itself and the WebView2 runtime.

The core also builds on Linux for testing:

```sh
cd apk-player
gcc -c -O1 -g -fsanitize=address,undefined -Ithird_party/miniz third_party/miniz/miniz*.c
g++ -std=c++17 -O1 -g -fsanitize=address,undefined -Ithird_party/miniz tests/inspect_main.cpp src/apk.cpp miniz*.o -o /tmp/inspect
/tmp/inspect some.apk
```

The workflow `.github/workflows/apk-player-windows.yml` builds both architectures on `windows-latest`. It then runs `tests/ci-smoke.ps1`, which does the following:

* runs `--inspect` on the Bash Baqi APK, the same APK from an Arabic-named folder, and the two fixtures;
* runs `--smoke-test` in a real WebView2 window: Bash Baqi runs and renders, the library and native-app screens appear, Cordova `deviceready` fires in touch mode, saves survive a restart, and the 32-bit build runs.

The workflow then commits the exes and screenshots to `bin/` and uploads them to the release.

## Command line

```
NeurioApkPlayer.exe [game.apk]                 open the launcher (and start the game)
NeurioApkPlayer.exe --inspect game.apk out.json write what the player detected (exit 0 ok / 3 not an APK)
NeurioApkPlayer.exe --devtools [game.apk]      also enable the browser's right-click menu
NeurioApkPlayer.exe --smoke-test game.apk outdir [native.apk]   CI self-test (screenshots + probe)
```
