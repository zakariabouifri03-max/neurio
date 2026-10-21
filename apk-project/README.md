# NAR SURVIVOR 3D → APK

Had l-folder fih projet Android **kامل وجاهز** li kay-ghlf l-lo3ba (web app) f WebView → APK 7a9i9i.
Ma kayn 7ta dépendance npm / Capacitor — ghir Android Studio w khlas.

## Tri9a 1 — PWABuilder (as3ab, bla ma t-install walo)
1. Rfe3 l-lo3ba 3la chi hosting b-https (GitHub Pages, Netlify, Vercel…).
2. Sir l **pwabuilder.com** → dkhel l-URL → "Package For Stores" → **Android**.
3. Ghadi y3tik `.aab` / `.apk` m-signi, jahlz l-upload 3la Play Store.

## Tri9a 2 — Android Studio (offline, f dar)
Matloub: Android Studio + JDK 17 (kayjio mjmou3in f Android Studio jdida).

```bash
# 1) copier assets dyal l-lo3ba dakhel l-projet
bash prepare-assets.sh          # mn racine dyal repo (neurio/)

# 2) ft7 l-projet f Android Studio
#    File → Open → khtar had l-folder (apk-project/)
#    tsenna Gradle y-sync (awl mara kay-hmmel chwiya)

# 3) Build → Build Bundle(s)/APK(s) → Build APK(s)
#    l-file kaykoun f:  app/build/outputs/apk/debug/app-debug.apk
```

L-APK dyal debug kaykhdem 3la ay telephone Android 7+ (arm / arm64 / x86).
Ila bghiti version l-Play Store: Build → Generate Signed Bundle/APK (khtiar release + keystore dyalek).

## Chno kayn dakhel
- `app/src/main/java/ma/nar/survivor3d/MainActivity.kt` — WebView b WebGL + localStorage +
  `WebViewAssetLoader` (l-modules ES ma ykhdemch mn `file://`, lazem https virtual).
- `app/src/main/AndroidManifest.xml` — landscape, fullscreen, **bla INTERNET permission**
  (l-lo3ba 100% offline).
- `prepare-assets.sh` — kay-copier `survivor3d/*` + `vendor/*` + `icons/*` l `app/src/main/assets/www/`.

## Ila ma 3ndekch PC
Rkeb l-lo3ba kb PWA mn telephone: ft7ha f Chrome → menu → **Add to Home screen**.
Ghat-ban kif app b ikona dyalha, fullscreen, w offline (service worker kay-cachi kolshi).
