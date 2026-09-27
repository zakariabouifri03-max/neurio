# 🗼 برج إيفل · Tour Eiffel 3D

نموذج تفاعلي ثلاثي الأبعاد لبرج إيفل مبني بالكامل بشكل إجرائي (procedural) باستخدام **Three.js** — بدون بناء (no build step) وبدون أي CDN خارجي.

> Interactive 3D model of the Eiffel Tower, fully procedural with Three.js. No build step, no external CDN — everything is vendored.

![برج إيفل نهارًا](docs/screenshot-day.png)

![برج إيفل ليلًا](docs/screenshot-night.png)

---

## ✨ المميزات · Features

- 🏗️ **هيكل شبكي إجرائي** — أكثر من 33,000 مثلث مبنية برمجيًا بأبعاد حقيقية:
  - القاعدة: 124.9 م · الطوابق: 57.6 / 115.7 / 276.1 م · قمة الهوائي: 330 م
- 🌙 **وضع ليلي / نهاري** — إضاءة ذهبية + محاكاة **20,000 وميض** (الزر أو حرف `N`)
- ⭐ سماء متدرجة مع نجوم متلألئة ومنارة حمراء وامضة (تحذير الطيران)
- 🎥 دوران تلقائي يتوقف عند التفاعل
- 🖱️ تحكم كامل: دوران / تقريب / إزاحة (OrbitControls)
- 🇲🇦 واجهة عربية RTL بتصميم زجاجي (glassmorphism)
- 📦 **صفر تبعيات وقت التشغيل** — three.js r170 مرفق داخل `vendor/`

## 🚀 التشغيل · Run

أي خادم ملفات ثابت يكفي:

```bash
python3 serve.py            # بلا كاش (مستحسن)
# أو
python3 -m http.server 3000
# أو
npx serve .
```

ثم افتح `http://localhost:3000`

## 🎮 التحكم · Controls

| الفعل | الأداة |
|---|---|
| الدوران | سحب بالزر الأيسر / إصبع |
| التقريب | عجلة الفأرة / قرصة |
| الإزاحة | الزر الأيمن |
| ليل / نهار | زر 🌙 أو حرف `N` |
| دوران تلقائي | زر ⏸ / ▶ |
| ملء الشاشة | زر ⛶ |

## 📁 البنية · Structure

```
neurio/
├── index.html                      # الواجهة
├── src/
│   ├── main.js                     # محرك المشهد + بناء البرج إجرائيًا
│   └── style.css                   # التنسيق (RTL + زجاجية)
├── vendor/                         # three.js r170 (مرفق — لا حاجة لإنترنت)
│   ├── three.module.js
│   ├── controls/OrbitControls.js
│   └── utils/BufferGeometryUtils.js
└── docs/                           # لقطات الشاشة
```

## 🧠 كيف يُبنى البرج؟

كل شيء مرسوم برمجيًا في `src/main.js`:

1. **منحنى جانبي** `w(y) = 3 + 59.5·e^(−y/78)` يحاكي الانفراج الأسطوري للبرج
2. **4 أعمدة** متقاربة على 41 مستوى + حلقات أفقية + مقطعيات X على كل وجه
3. **4 أقواس** شبه بيضاوية تحت الطابق الأول (تُصنع بأنابيب `TubeGeometry`)
4. **منصات** الطوابق الثلاثة + الهوائي وكبينة القمة
5. كل القضبان تُدمج في **شبكة واحدة** (`mergeGeometries`) للأداء

---

صُنع بـ ❤️ باستخدام [Three.js](https://threejs.org) r170 (MIT © mrdoob والمساهمون)

---

## 🏎️ سوق الطوموبيل · Drive the Ferrari (`car.html`)

عالم خاوي وفيراري 458 ثلاثية الأبعاد (الموديل جاي من [mrdoob/three.js](https://github.com/mrdoob/three.js/tree/r170/examples/models/gltf) على GitHub) — كتمشي بحال طوموبيل حقيقية:

- فيزياء: slip ديال الروايض، friction circle، نقل الوزن، بواط أوطوماتيك 6 فيتيسات + أريير، drag الهوا
- فرين اليد للدريفت، TC كيتطفى بـ `T`، آثار الروايض فالأرض، صوت موتور V8 مصنّع
- 4 كاميرات (`C`)، أزرار لمس للتيليفون

| زر | فعل |
|---|---|
| `W`/`↑` | أكسيليراتور |
| `S`/`↓` | فرين / أريير |
| `A` `D` / `←` `→` | الفولان |
| `Space` | فرين اليد |
| `C` / `R` / `H` / `T` | كاميرا / reset / كلاكسون / TC |
| `G` / `Q` / `E` | الكاراج / اللي قبل / اللي بعد |

### 🚗 الكاراج — 18 طوموبيل واقعية (`G`، `Q` / `E`)

من الضعيفة للأقوى: Mercedes 190E Evo → Shelby GT350 '65 → Mustang Mach 1 '69 → Shelby Cobra GT500 '67 → Porsche 911 (930) Turbo → Toyota Supra '98 → Rolls-Royce Ghost → Ford F-150 Raptor R → Jaguar F-Type R → Shelby GT350R → Aston Martin DB11 → BMW M8 Competition → Shelby GT500 '20 → Porsche 911 GT3 (992) → **Ferrari 458** → Audi R8 V10 → Ford GT → **Koenigsegg CCGT**.

🔊 **كل طوموبيل عندها صوت الموتور ديالها**: I4، V8 cross-plane (Mustang) وbig-block، V8 flat-plane (Ferrari / GT350R)، V8 supercharged مع الصفير ديال الكومبريسور، V8 twin-turbo، Flat-6 (Porsche)، I6 turbo (Supra) مع صوت التيربو والـ blow-off، V10 (R8)، V12 (DB11)، V12 الصامت ديال Rolls، V6 twin-turbo (Ford GT)، وV8 race (Koenigsegg) — مع طقطيق (pops) فاش كتطلق الأكسيليراتور.

كل وحدة بالأرقام الحقيقية ديالها تقريبا (hp، Nm، rpm، الوزن، عدد الفيتيسات، السرعة القصوى).

الموديلات جاية من GitHub (أصلها Sketchfab) — ضغطناهم (Draco + WebP)، دورناهم وقيسناهم بالمتر، وجمعنا الروايض باش يدورو. المؤلفين والرخص (CC-BY / CC-BY-NC(-SA)) فـ [`assets/real/LICENSES.txt`](assets/real/LICENSES.txt). Ferrari 458 by vicent091036 (CC-BY 4.0) via three.js examples.
