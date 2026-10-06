# 📦 Filebox — milafat dyalek, mkhasrin

Tatbi9 li kayjm3 l-milafat dyalek (tswar, video, PDF...) f **coffres** mkhasrin
b ZIP + AES-256, bach twaffer espace f telefon.

Kayn **jouj versions** b nfs l-format dyal coffre — coffre li tsaybo f wahed
y9der ythell f lakhor:

| | `web/` | `android/` |
|---|---|---|
| Chnu | PWA (kaynseb f telefon bhal app) | Projet Android → `.apk` |
| Kifach tkhdem biha | 7ellha f Chrome, `⋮` → «Installer l'application» | Sebte l-APK |
| Khass | Browser (Chrome/Edge) | Android 7.0+ |

---

## ⚠️ Qbel matbda — l-7a9i9a 3la "space"

L-milafat li kaydkholo l coffre **kayb9aw f telefon**. Coffre kaywaffer espace
b jouj toro9:

1. **Compression** — milafat dyal texte/PDF kayb9aw sghar bzzaf. Tswar JPG w
   video MP4 deja mkhasrin, 3lach ghadi trebba7 0–5% 3lihom.
2. **Backup + msah** — sift l-coffre l PC/NAS/Nextcloud dyalek (`server/`),
   verifier belli slm, **w mn ba3d msah l-milafat l-9dam**. Hadchi huwa li
   kayrje3 l-espace bessa7.

Filebox **makaymsahch** ta fichier mn telefon dyalek bla ma nta t2akked b
bouton. Hadchi 3lach.

---

## 1 · Version web (khdam daba)

```bash
cd Filebox
python3 ../tools/video/serve.py 8000 web
# → http://localhost:8000
```

Bla build, bla CDN — kolchi procedural w vendored.

**3la telefon:** hosti `web/` f ay place (GitHub Pages kaykfi), 7ell l-link f
Chrome, `⋮` → «Installer l'application». Kaykhdem offline (service worker),
w l-milafat kayb9aw f IndexedDB/OPFS.

**Permission mohima:** Settings → «Stop the browser from auto-purging».
Bla biha l-browser y9der ymsah l-milafat ila khss espace.

---

## 2 · Version Android (APK)

L-projet kamel f `android/`. **Bla AndroidX, bla libraries** — ghir framework
Android, 3lach l-build khfif w l-APK sghir.

### 🔨 Kifach tbni l-APK **bla PC**

1. Pushi had l-repo l GitHub dyalek
2. 3la telefon: 7ell l-repo f `github.com` → **Actions** → **Filebox APK** →
   **Run workflow**
3. Steena 3-4 d9aye9 → dkhel l-run → **Artifacts** → `filebox-apk`
4. Telecharji `filebox-debug.apk` → 7ellha f telefon → «Installer quand même»

L-workflow kayban f [`.github/workflows/filebox-apk.yml`](../.github/workflows/filebox-apk.yml).

> 3lach machi mبنية hna? Had l-environnement makaych fih Java wla Android SDK,
> w `dl.google.com` mabloki — 3lach l-build kayt3mel f GitHub Actions.

### 🔨 Wla b Android Studio / Gradle

```bash
cd Filebox/android
gradle assembleDebug                 # → app/build/outputs/apk/debug/app-debug.apk
```

Khass JDK 17 + Android SDK 34. L-APK dyal debug mوقَّع automatiquement b
debug keystore, y9der ytsebte direktement.

---

## 🔐 Format dyal coffre

Coffre huwa `.zip` 3adi, b wa7ed l-7aja zayda: l-entrées mchfrin kaystakhdm
**method 99** + extra field **`0xFB01`** li kaygoul chnu l-method l-7a9i9i.

```
entry payload  =  salt(32) | iv(12) | AES-256-GCM(bytes) || tag(16)
key            =  PBKDF2-SHA256(password, salt, 250000, 32 bytes)
bytes          =  zlib(deflate(original))   ila l-compression khdmat
```

Had l-format **kaykhdmou jouj** l-versions (JS + Java) b nfs l-bytes:

- `CompressionStream('deflate-raw')` f JS + `zlibWrap()` = `Deflater(level, nowrap=false)` f Java
- `adler32` kayt7sab 3la l-data **l-9dam** compression (RFC 1950)

L-version web kay9ra **zayd** coffres WinZip-AES (7-Zip, WinZip) — method 99 +
extra `0x9901`, AES-256-CTR b counter little-endian + HMAC-SHA1.

Coffre **bla** chiffrement huwa ZIP 3adi — ay outil kay9dro.

---

## 🧪 Tests

```bash
cd Filebox
node tools/test-zip.mjs      # ZIP writer/reader: CRC, deflate, ZIP64, jouj ciphers, interop
node tools/test-app.mjs      # i18n, imports, assets, workflow kamel dyal coffre
python3 tools/make-icons.py  # icons (PNG writer bla libraries)
python3 tools/make-interop-fixture.py   # kaytleb pyzipper
```

`test-zip.mjs` kayverifi l-bytes dyal l-extra fields, w kayقra coffre mktوب b
**pyzipper** (implementation مستقلة) bach y2akked l-interop.

```bash
pip install pyzipper
python3 tools/make-interop-fixture.py && node tools/test-zip.mjs
```

---

## ☁️ Serveur dyal backup (option)

```bash
cd Filebox
node server/server.mjs --port 8200 --dir ./backups --user zakaria --pass s3cr3t
```

F l-app: **Settings → Backup → URL** = `http://<ip-dyal-pc>:8200`

Kaydd3em `PROPFIND` / `MKCOL` / `PUT` / `GET` b Basic auth, bla dependencies.
Kayrfd path traversal (`/../../etc/x` kayb9a dakhel `--dir`).

Wla khdm ay serveur WebDAV akhor: Nextcloud, Freebox, Synology, nginx-dav...

---

## 📁 Structure

```
Filebox/
├── web/                  PWA
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js             offline (app shell ghir — l-milafat f IndexedDB/OPFS)
│   ├── icons/
│   └── src/
│       ├── app.js        UI (Darija / Français / English)
│       ├── db.js         IndexedDB + OPFS
│       ├── zip.js        ZIP writer/reader + AES-GCM + WinZip-AES
│       ├── util.js
│       ├── i18n.js
│       └── style.css
├── android/              projet Android → APK
│   ├── app/src/main/java/ma/filebox/
│   │   ├── MainActivity.java
│   │   ├── Vault.java    nfs l-format bhal web/src/zip.js
│   │   ├── Space.java
│   │   └── Backup.java   WebDAV
│   └── *.gradle
├── server/server.mjs     WebDAV backup
└── tools/                tests + icons
```
