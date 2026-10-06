# ⚽ Botola 25

**لعبة كورة كاملة من A لـ Z** — موسم كامل، انتقاللات، تدريب، و ماتشات 3D مباشرة.
كتخدم فالمتصفح، و كتخرج كـ **APK حقيقي موقّع** كيت ركّب على التليفون.

A complete football career game in the browser — 3D matches, a league season,
transfers, training — packaged as a real signed Android APK. **No engine, no
image files, no CDN, no Android SDK, no Java, no Gradle.**

---

## 📱 الـ APK — كيفاش تركّبو

الـ APK جاهز فالـ repo: **`Botola25.apk`** (~350 KB)

1. صيفط `Botola25.apk` للتليفون (ولا حمّلو من GitHub)
2. حلّو → غادي يطلب منك السماح بالتثبيت من مصدر غير معروف → وافق
3. الأيقونة كتبان فالشاشة الرئيسية و اللعبة كتخدم **offline 100%**

> ⚠️ **علاش هاد الـ APK موقّع غير بـ v1؟**
> الـ APK اللي كان ف المستودع قبل (`BashBaqiRacing.apk`) كان فيه **APK Signature
> Scheme v2 مكسور**. Android منين كيلقا v2 block وماشي صالح **كيرفض التثبيت
> نهائياً** و ما كيرجعش لـ v1 — هادشي على الأغلب هو السبب علاش ما تركّبش.
>
> tools/verify-apk.mjs كيقيس هادشي بالدقة، و الحل: **v1 (JAR) فقط +
> `targetSdkVersion=29`**، اللي كيتقبل ف كل Android من 5.0 لفوق.

### تبني الـ APK من الصفر

```bash
node tools/build-apk.mjs     # يبني
node tools/verify-apk.mjs    # يثبت بلي صالح (40 فحص)
# ولا بجوج:
npm run apk
```

البناء كيدير كلشي بيديه:
- **AndroidManifest.xml** → binary AXML مكتوب من الصفر (`tools/apk/axml.mjs`)
- **resources.arsc** → جدول الموارد، غير اسم الباكدج كيتبدّل
- **classes.dex** → WebView shell مبني بـ D8، السمية ديال الـ class كتبدّل و
  الـ adler32 + SHA-1 ديال الـ header كيتحسبو من جديد
- **الأيقونات** → مرسومة بيكسل بيكسل و مكتوبة كـ PNG (`tools/make-icons.mjs`)
- **التوقيع** → v1 JAR signing بـ openssl (مفتاح + شهادة + PKCS#7)

---

## 🎮 اللعبة

| | |
|---|---|
| **الموسم** | بطولة بـ 12 نادي مغربي، double round-robin (22 جولة)، ترتيب، هدّافين، و كاس |
| **الماتش** | 11 ضد 11، 3D، شوطين، رميات تماس / كورنر / ركلات مرمى، حارس كيغطس |
| **التحكم** | joystick + أزرار (باس، تسديد مع شحن، سبرينت، تاكل، تبديل لاعب) |
| **الانتقالات** | سوق فيه 8 لاعبين، شراء، بيع (المدرسة كتعويض)، تجديد السوق |
| **التدريب** | طلع السرعة / التسديد / الباس / الدفاع بالفلوس |
| **الحفظ** | أوتوماتيكي ف localStorage |
| **أوفلاين** | PWA + service worker، ولا الـ APK اللي فيه كلشي مدمج |

الأندية: Atlas Fès · Olive Meknès · Casa United · Rabat Olympique · Marrakech
Stars · Tanger Port · Agadir Waves · Oujda East · Tétouan North · Safi Ocean ·
Laâyoune Sands · Kénitra Rail — كل واحد بألوانو و مستوى ديالو.

### التحكم

| الفعل | الكلافيي | التليفون |
|---|---|---|
| التحرك | `W A S D` / الأسهم | joystick |
| تسديد | `SPACE` (شدّو باش تشحن) | 👟 |
| باس | `E` | ➤ |
| سبرينت | `SHIFT` | ⚡ |
| تاكل | `F` | 🦵 |
| بدّل لاعب | `Q` | 🔁 |
| وقف | `ESC` / `P` | II |

---

## 🖥️ خدم بيه فالمتصفح

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

بلا build step. `index.html` كيجيب الـ modules من `src/` و Three.js من `vendor/`.

---

## 🧱 البنية

```
src/
  engine.js    المحرّك: فيزياء الكرة، حركة اللاعبين، AI، القوانين، الحارس
               → pure JS، بلا DOM ولا Three.js (كايتختبر headless)
  render.js    Three.js: الملعب، اللاعبين، الكرة، كاميرا التلفزة
  tex.js       كل النسيج مرسوم ف canvas (عشب، خطوط، جمهور، إشهار، شبكة)
  data.js      الأندية، التشكيلة، توليد اللاعبين، البطولة
  career.js    الموسم، الترتيب، السوق، التدريب
  ui.js        الشاشات + HUD + الرادار
  audio.js     WebAudio: جمهور، صافرة، ضربة،-goal-، تصدي
  save.js      localStorage
  main.js      الـ loop، الإدخال، التنقل بين الشاشات
tools/
  sim-test.mjs       ماتشات headless
  render-test.mjs    طبقة 3D فالـ Node
  check-ui.mjs       تناسق HTML ↔ JS
  dom-test.mjs       طبقة DOM على stub
  build-singlefile.mjs  كلشي ف HTML واحد (للـ APK)
  make-icons.mjs     مولّد PNG
  build-apk.mjs      مولّد الـ APK
  verify-apk.mjs     الفحص المستقل ديال الـ APK
  apk/               AXML encoder، ZIP writer، v1 signer، DEX patcher
```

**علاش المحرّك مفصول على الرسوميات؟** حيت هكاك نقدر نشغّل ماتش كامل ف Node
بلا متصفح — و هادشي هو اللي خلّى كل هاد الاختبارات ممكنة.

---

## ✅ الاختبارات

```bash
npm test          # كلشي
```

| المرحلة | شنو كتفحص |
|---|---|
| `sim-test.mjs` | ماتشات كاملة: كتوصل لـ 90'، بلا NaN، بلا dead-lock، التسديدات/الأهداف/الاستحواذ منطقية |
| `render-test.mjs` | Three.js فالـ Node: الملعب، اللاعبين، 1800 فريم من المزامنة، الكاميرا |
| `check-ui.mjs` | كل `$('id')` كاين فالـ HTML، كل شاشة reachable، الأصول كاينين |
| `dom-test.mjs` | كل الشاشات + HUD + الرادار + الصوت + الحفظ على stub DOM |
| `build-singlefile.mjs` | الـ bundle كيتفحص بـ `node --check` قبل ما يتكتب |
| `verify-apk.mjs` | **40 فحص**: الـ ZIP، AXML، arsc، DEX checksums، كل digests، و التوقيع بـ openssl |

---

## 📝 ملاحظات

- **المفتاح ديال التوقيع** كيتولّد ف `tools/apk/keystore/` و **ماشي ف git** (مفتاح
  خاص ما كيت commit-اش). إلا مسحيتيه، البناء الجاي غادي يكون بمفتاح جديد و
  خاصك تحيّد التطبيق القديم قبل ما تركّب الجديد.
- الأسماء ديال الأندية و اللاعبين خيالية (مستوحاة من المدن المغربية).
- Three.js r170 موجود ف `vendor/` — حتى اعتماد خارجي.
