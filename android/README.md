# Neurio Guys — Android APK

Hadi APK dyal telephone (WebView) — katkhdem offline, 60fps.

## Tari9a 1: Tseb APK men GitHub Actions (sahla)
1. Dkhol `https://github.com/zakariabouifri03-max/neurio/actions`
2. Khtar `Build APK` → `Run workflow` → `Build`
3. Mill i kammel → Download artifact `neurio-guys-apk` → fih `app-debug.apk`
4. Sifto l telephone → fta7 → Allow unknown sources → Install

## Tari9a 2: Bni f Android Studio
1. Fta7 `android/` folder b Android Studio
2. Sync Gradle → Run → Build → Build APK(s)
3. APK kaykoun f `android/app/build/outputs/apk/debug/app-debug.apk`

## Tari9a 3: PWA — bla APK (instant)
- F telephone: fta7 `https://zakariabouifri03-max.github.io/neurio/` (ila Pages active) wla `https://3000-....e2b.app/neurio/` f Chrome
- Menu → `Add to Home Screen` / `Installer l'application` → katwli bhal APK (icon f launcher, fullscreen, offline b sw.js)

APK kaykhdem `file:///android_asset/index.html` — offline, wheel 5 maps 3chwaeiyin khdama 100%.
