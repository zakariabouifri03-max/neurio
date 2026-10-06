# 📦 NurioTawasol.apk — تطبيق أندرويد بلا إنترنت

هادي الأدوات اللي كتصنع **NurioTawasol.apk** انطلاقًا من التطبيق اللي فـ `public/`
ومن APK قدام `BashBaqiRacing.apk` (اللي كيوجد فجذر الريبو وكيلعب دور *القلب*: WebView
صغير كيقرا ملف HTML من `assets/game.html`).

**كلشي بـ Python 3 + `openssl` فقط** — بلا Java، بلا Gradle، بلا Android SDK، بلا أي مكتبة.

```
public/  +  style.css/app.js
   │  node tools/offline-chat/build-singlefile.mjs
   ▼
dist/nurio-tawasol.html        ← ملف واحد فيه كلشي (HTML+CSS+JS+أيقونات)
   │
   │  python3 tools/offline-chat/apk/build_apk.py        (shell: BashBaqiRacing.apk)
   ▼
NurioTawasol.apk               ← موقّع v1 (JAR) + v2 (APK Signature Scheme v2)
```

## البناء / Build

```bash
node tools/offline-chat/build-singlefile.mjs      # 1. الملف الواحد (dist/)
python3 tools/offline-chat/apk/build_apk.py       # 2. الـ APK فجذر الريبو
```

النتيجة:

```
📦 building NurioTawasol.apk
   shell      : BashBaqiRacing.apk
   client     : 138.9 KB single-file bundle
   classes.dex: com.bashbaqi.racing → com.neurio.tawassol (checksum + SHA-1 rebuilt ✅)
   manifest   : label «نوريو تواصل», package com.neurio.tawassol, INTERNET ✅, targetSdk 27 ✅
   resources  : arsc package 'com.bashbaqi.racing' → 'com.neurio.tawassol' ✅
   zip        : 9 entries, 95.9 KB
   signature  : v1 ✅ · v2 ✅
   contents   : 12 entries · asset 138.9 KB · dex ok ✅ · zip ok ✅
```

المفتاح كيتصنع أول مرة وكيتخزن فـ `apk/.keys/` (خارج git). باش تبدل المفتاح:
`rm -rf apk/.keys` ومن بعد عاود البناء.

## شنو كيدير `build_apk.py`

| الخطوة | الملف | التفاصيل |
|---|---|---|
| 1 | `classes.dex` | تبديل سلسلة `Lcom/bashbaqi/racing/MainActivity;` بـ `Lcom/neurio/tawassol/MainActivity;` (نفس الطول) ثم إعادة حساب **SHA-1** (offset 12) و**adler32** (offset 8) |
| 2 | `AndroidManifest.xml` | AXML كيتقرا كامل، كيتبدل `package` + `label` (نوريو تواصل) + `targetSdkVersion 27`، كيتزاد `<uses-permission android:name="android.permission.INTERNET"/>` وكيتحيد `screenOrientation`، ثم كيتعاود البناء (`axml.py`) |
| 3 | `resources.arsc` | تبديل سمية الحزمة (متنسقة UTF-16 بحال 256 بايت) فـ `RES_TABLE_PACKAGE_TYPE` |
| 4 | `assets/game.html` | كيتعوّض بالملف الواحد `dist/nurio-tawasol.html` (نفس السمية — الديكس ثابت عليها) |
| 5 | الأيقونات | `apk/icons/mipmap-*/ic_launcher.png` (48 → 192 px) |
| 6 | التوقيع | v1: `META-INF/MANIFEST.MF` + `NURIO.SF` (فيه `X-Android-APK-Signed: 2`) + `NURIO.RSA` (PKCS#7)، وv2: APK Signing Block |

## التوقيع v2 — كيفاش متأكدين بلي صحيح

`sign.py` كتب بمواصفات Google الرسمية (وفي نفس الوقت تخطينا مشاكل حقيقية):

1. **البنية** (`apksig` بالحرف):
   ```
   value      = lp(seq([ signer ]))
   signer     = seq([ signed_data, signatures, public_key ])
   signed_data= seq([ digests, certificates, additional_attributes, b'' ])
   digests    = seq([ uint32 alg + lp(digest) ])
   signatures = seq([ uint32 alg + lp(signature) ])
   public_key = SubjectPublicKeyInfo (DER, ماشي PEM!)
   ```
   * `additional_attributes` **فارغة** حيت التطبيق موقّع بـ v2 بوحدو (apksig كيكتب
     `0xbeeff00d = 3` غير ملي يكون التوقيع v3 تاهو موجود).
   * العنصر الرابع الخاوي (`b''`) كاين فـ apksig — علاش كيتبان 4 بايت أصفار!
2. **الـ digest**: كل قسم (المحتويات / Central Directory / EOCD) كيتقسم بوحدو لـ 1 MiB،
   وكل chunk = `sha256(0xa5 ‖ uint32(حجمه) ‖ المعطيات)`، ثم
   `sha256(0x5a ‖ عدد الـ chunks ‖ ديجيستاتهم)`. وفـ EOCD كيتبدل حقل `cdOffset`
   بـ **بداية APK Signing Block** قبل الحساب.
3. **التوقيع**: RSA-PKCS#1 v1.5 / SHA-256 (alg `0x0103`) فوق `signed_data` **بلا** الـ prefix.
4. الـ block كيتقاد لـ **4096 بايت** (بحال apksigner) بزوج `0x42726577` (verity padding).

### التحقق (كل مرة فالبناء + يدوي)

```bash
python3 -c "
import sys; sys.path.insert(0,'tools/offline-chat/apk'); import sign
print(sign.verify_v1('NurioTawasol.apk'))          # digests ديال JAR
print(sign.verify_v2(open('NurioTawasol.apk','rb').read()))   # digest + RSA + المفتاح
"
```

وهاديك أداة **مستقلة تمامًا** على الـ APK الحقيقي `BashBaqiRacing.apk` (اللي موقّع بـ
apksigner): `sign.verify_v2()` كيرجع `(True, 'ok')` — يعني الفهم ديال البنية والـ digest
مضبوط، حيت التوقيع ديال Google خاصو يتحقق.

زيادة على هادشي، البناء كيتأكد من:
`zipfile.testzip()` · مساواة الأصل (`assets/game.html`) مع `dist/` · وجود
`Lcom/neurio/tawassol/MainActivity;` فالديكس · قراءة الـ manifest من جديد.

## الأدوات

* **`axml.py`** — قاري + كاتب Android Binary XML (chunk headers, string pool UTF-8/UTF-16,
  resource map, events). كيدير round-trip على manifest الأصلي بلا ما يبدل حتى بايت فالبنية.
* **`sign.py`** — `make_key` · `rsa_sign`/`rsa_verify` (بـ `openssl`) · `sign_v1` ·
  `sign_v2` · `parse_signing_block` · `verify_v1`/`verify_v2`.
* **`build_apk.py`** — كيجمع كلشي ويعطي `NurioTawasol.apk` فالريبو.

## شنو كيخدم فالتطبيق / What works in the APK

الـ shell هو WebView بسيط (`setJavaScriptEnabled` + `setDomStorageEnabled` +
`file:///android_asset/game.html`)، **بلا `WebChromeClient`** — يعني:

* ✅ الدردشة (نص)، الغرف، الخاص، التاريخ (localStorage)، P2P بين الهواتف فالشبكة المحلية
* ✅ كيخدم **بلا إنترنت** بالكامل
* ⚠️ اختيار الصور/الملفات والتسجيل الصوتي ما كايناش فالتطبيق (ما كاينش file chooser ولا
  صلاحية الميكرو). التطبيق كيعطي رسالة واضحة ملي تدوس عليهم — وحِل الرابط فـ Chrome
  باش تصيفط تصاور/صوت.

## ملاحظة على التثبيت

الـ APK موقّع بمفتاح ذاتي (self-signed) — Play Protect يقدر يعطي تحذير
«تطبيق ماشي معروف»: ختار **تثبيت على أي حال / Install anyway**. وخاصك تشعل
«تثبيت من مصادر غير معروفة» للمتصفح ولا لتطبيق الملفات.
