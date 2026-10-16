# `BashBaqiRacing.apk` — the offline Android build

A **≈250 KB** APK that runs the whole game offline: a fullscreen, hardware-accelerated
WebView around `assets/index.html` (the esbuild bundle of `src/`). No Gradle, no Android
SDK, no network — everything is assembled from npm + PyPI packages.

```bash
node tools/apk/build.mjs        # → dist/BashBaqiRacing.apk
```

## What ends up inside the APK

| part | source |
| --- | --- |
| `assets/index.html` | generated: esbuild bundles `src/` + `vendor/` into one file (fonts link stripped, icon inlined) |
| `classes.dex` | `app/smali/com/neurio/bashbaqi/MainActivity.smali`, hand-written smali assembled by apktool |
| `AndroidManifest.xml` | `app/AndroidManifest.xml` — **no permissions at all** |
| launcher icons | drawn procedurally by `tools/make-icons.mjs` (5 densities + adaptive foreground) |

The activity is intentionally tiny: create the WebView, turn on JS + DOM storage
(localStorage = the save file), keep the screen awake, go immersive, load the page.
It also appends `BashBaqiAPK/1.0` to the user agent, which is what makes the game boot
in **⚡ fast mode** (1× pixels, no bloom, no shadows) — tap the ⚡ button in the garage
to switch back to auto quality.

## Build pipeline (5 steps, ~2 s)

1. **esbuild** → one self-contained `index.html`
2. **make-icons** → `res/mipmap-*/ic_launcher*.png`
3. **apktool** → smali → `classes.dex`, resources + manifest → binary, packaged APK
4. **sign.mjs** → APK Signature Scheme **v2** (pure JS, `apk_sign_ts`)
5. **verify.py** → independent from-scratch check of the signing block, content digest,
   RSA signature, zip CRCs and dex magic — it must print `PASS`

### Tool locations (override with env vars)

| env var | default |
| --- | --- |
| `JAVA` | `/tmp/jdk/x/jdk4py/java-runtime/bin/java` |
| `APKTOOL_JAR` | `/tmp/dl/apktooln/package/bin/apktool_2.4.1.jar` |
| `APKTOOLS_MODULES` | `/tmp/gb/node_modules` (needs `esbuild`, `apk_sign_ts`) |
| `AAPT2` | `/tmp/dl/aapt2` (optional, only used for `dump badging`) |
| `APK_OUT` | `dist/BashBaqiRacing.apk` |

### One-time tool setup (works without dl.google.com / Maven / Gradle)

```bash
# JRE (only needs `java`) — from PyPI
pip download jdk4py --no-deps -d /tmp/jdk && (cd /tmp/jdk && unzip -q -o jdk4py-*.whl -d x)

# apktool 2.4.1 (smali assembler + bundled aapt/aapt2 + framework resources) — from npm
mkdir -p /tmp/dl/apktooln && curl -sL https://registry.npmjs.org/apktool-jar/-/apktool-jar-2.4.1.tgz \
  | tar xz -C /tmp/dl/apktooln

# esbuild + the pure-JS APK signer — from npm
mkdir -p /tmp/gb && cd /tmp/gb && npm i esbuild@0.25.0 pako@3 node-forge@1.4.0 jks-js@1.1.7 apk_sign_ts@1.0.1
```

(Those exact versions are what the build was verified with. `apktool-jar` ships the jar
inside the npm tarball, so no GitHub release download is needed.)

## Signing notes

* **v2 only**: installs on **Android 7.0+ (API 24)** and satisfies the Android 11+
  requirement that `targetSdk 30+` APKs carry a v2+ signature.
* Key: `keystore/release.pem` + `keystore/release.crt` (self-signed RSA-2048, made by
  `make-key.mjs`). **Keep them** — every future release must be signed with the same key
  or Android refuses to install it as an update.
* `verify.py` is the safety net: it re-implements the v2 content digest and the RSA
  PKCS#1 check from scratch (no shared code with the signer), so a bug in the signer
  cannot fool it.
* Until a real certificate is bought, Android will show the usual
  *"install unknown apps"* warning — that is expected for sideloaded APKs.

## Changing the app

* version: bump `versionCode`/`versionName` in `app/apktool.yml` and
  `app/AndroidManifest.xml` before publishing a new release.
* package name: `com.neurio.bashbaqi`. (An older `com.bashbaqi.racing` APK existed in
  this repo's history; because its signing key is gone, this build uses a fresh package
  so it can be installed next to it instead of failing with *"App not installed"*.)
