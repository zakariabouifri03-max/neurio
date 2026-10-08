# 🌴 SOLARA BAY — وثيقة تصميم اللعبة الكاملة (GDD)
### لعبة عالم مفتوح Voxel ساحلية — هوية أصلية 100% — بدون أي اقتباس من أسماء تجارية

> **المحرك المختار لك:** Unity 6 + URP (الأنسب لطلبك: EXE للـ PC + منظور أول/ثالث + خريطة كبيرة قابلة للتوسع)
> **المنصات:** PC (Steam) أولاً — ثم Consoles لاحقاً
> **مستوى العنف:** واقعي سينمائي (Teen → Mature خفيف) — اشتباكات وشرطة لكن بدون مبالغة دموية صادمة
> **حجم الخريطة:** مخطط نهائي 5×5 كم، البداية 1.5×1.5 كم قابلة للتوسع بنظام جزر/مربعات

---

## A) Game Design Document — المختصر الواضح

### 1. الاسم المقترح والهوية
**الاسم الرئيسي: SOLARA BAY — سولارا باي**
أسماء بديلة: NEON COAST / VOXEL HARBOR / SUNSET COUNTY
الشعار: *"مدينة من مكعبات، تحيا كأنها حقيقية"*

**Elevator Pitch (3 أسطر):**
سولارا باي مدينة ساحلية voxel تنبض بالحياة — شمس غروب دافئة، نيون ليلي، وشوارع تعج بالسيارات والمشاة. تعيش حراً: قد سيارتك، افتح أي متجر، نفّذ مهام القصة أو اصنع فوضاك الخاصة ونظام الشرطة سيطاردك بذكاء. كل شيء مبني بمكعبات لكن بإضاءة سينمائية HDR تجعل كل لقطة خلفية لسطح المكتب.

### 2. حلقة اللعب الأساسية (Core Loop)
```
استكشاف المدينة (قيادة/مشي) → اكتشاف فرصة (مهمة/متجر/حدث عشوائي)
 → تنفيذ الفعل (قيادة/شراء/قتال/توصيل) → مكافأة (فلوس + سمعة + فتح منطقة)
 → ترقية (سيارة/ملابس/شقة/أسلحة خفيفة) → فتح محتوى أصعب → إعادة
```
**Loop ثانوي (Sandbox):** تجربة أنظمة المدينة بدون هدف — إحداث فوضى → مطاردة شرطة → هروب → اختباء.
**Loop اقتصادي:** فلوس ← مهام + أنشطة ← إنفاق على سيارات/تعديل/عقارات ← فلوس أسرع.

### 3. أنظمة اللعب (Gameplay Systems)

| # | النظام | الوصف التنفيذي القابل للعب |
|---|---|---|
| **1** | **القيادة** | Arcade ممتع وليس محاكاة. فيزياء صندوقية + Raycast للعجلات. تسارع/فرملة/Handbrake درفت، اصطدام voxel بسيط (تكسير زجاج/صدام يتفكك مكعبات). الدراجات أخف وأسرع في المناورة لكن تنقلب. دعم مقود/يد تحكم. |
| **2** | **المشاة NPC** | 80-150 NPC نشط حول اللاعب. سلوكيات: يمشي، يتسوق، يجلس، يصور، يهرب عند إطلاق نار، يتصل بالشرطة (أنيميشن هاتف)، يساعد المصاب. تنوع ملابس/أجسام voxel. |
| **3** | **الشرطة والمطاردة** | 5 نجوم Wanted. كل نجمة = نوع استجابة (دورية → مطاردة → حاجز → مروحية → فرقة تدخل). الشرطة تتصل، تتجاوز، تصدم، تطوق. الهروب = اختفاء عن الرادار 15-25 ثانية. دفع رشوة/اختباء في ورشة يقلل النجوم. |
| **4** | **المحلات التفاعلية** | 20+ محل قابل للدخول بدون شاشة تحميل (Interior streaming). كل محل = تفاعل حقيقي: مطعم (اشترِ أكل = صحة)، ملابس (غيّر السكن)، ورشة (عدّل السيارة)، سوبرماركت (التقط أشياء من الرفوف). |
| **5** | **الاقتصاد** | عملة واحدة SOL $. مصادر: مهام (500-5000)، تاكسي/توصيل (50-200)، سباقات (1000)، كنوز مخفية. مصارف: سيارات (5k-80k)، تعديل (1k-15k)، ملابس (200-2k)، شقق/كراجات (20k-150k)، أسلحة خفيفة (1k-8k). |
| **6** | **القتال البسيط** | قتال قبضات (كومبو 3 ضربات + صد)، أسلحة خفيفة (مسدس/شوتجن/رشاش خفيف) بتصويب من الكتف (ثالث) أو ADS (أول). لا دموية مبالغة — وميض إصابة + سقوط voxel. نظام Cover خلف مكعبات. |
| **7** | **التفاعل الواقعي** | E للتفاعل + نظام التقاط (Hold): التقط صندوق، كرسي، قنينة — ارمها. اركب أي مركبة، اشترِ من ماكينة، غيّر إشارة المرور، افتح صندوق السيارة، عدّل لوحة القيادة، شغّل راديو. |

### 4. أنظمة العالم
- **ليل/نهار:** دورة 24 دقيقة (18 نهار/6 ليل) + غروب 3 دقائق بلون برتقالي-وردي سينمائي. إضاءة الشوارع والنيون تشتعل تلقائياً.
- **طقس:** مشمس (70%)، غائم (15%)، مطر خفيف (10%)، عاصفة قصيرة (5% مع برق voxel). المطر = انعكاسات على الأرض + قيادة منزلقة 15%.
- **مرور:** كثافة ديناميكية (قليلة فجراً، ذروة 8ص و5م). إشارات تعمل، حوادث 2% عند التقاطعات، أبواق، تجاوز.
- **أصوات:** Ambience لكل حي (أمواج/نوارس شاطئ، زحام وسط، آلات مصنع، ضفادع مستنقع). راديو سيارة (3 محطات: Lo-fi Sunset / Neon Synth / Reggaeton Bay).

### 5. قائمة الأولويات MoSCoW

| Must (الإطلاق) | Should (بعد شهر) | Could (لاحقاً) |
|---|---|---|
| قيادة 5 سيارات + دراجة | 10 سيارات + تخصيص عميق | قوارب وطائرات هليكوبتر |
| 30 NPC + شرطة 3 نجوم | 120 NPC + 5 نجوم + مروحية | نظام عصابات وحرب مناطق |
| 8 محلات تفاعلية | 20 محل + شقق قابلة للشراء | بورصة/أسهم مبسطة |
| 12 مهمة رئيسية | مهام جانبية 20 + سباقات ليلية | طور أونلاين Co-op |
| ليل/نهار + مطر | فصول/ضباب/رياح | تدمير مباني voxel |
| حفظ/تحميل + اقتصاد | شجرة مهارات | محرر خرائط للاعبين |

---

## B) خريطة المدينة — SOLARA BAY WORLD LAYOUT

**المفهوم:** خريطة 5×5 كم نهائية، نبدأ بـ **الجزيرة المركزية 1.5×1.5 كم** (Downtown + Beach + Suburbs) ثم نضيف Industrial وSwamp وHighlands كجزر/جسور.

### 6-8 مناطق (Districts)

| # | المنطقة | الوصف البصري | المحلات النموذجية | نوع المهام |
|---|---|---|---|---|
| **1** | **Marina Bay (الشاطئ)** | رمال بيضاء voxel، كورنيش نيون، فنادق باستيل، نخيل، غروب سينمائي | مطاعم سمك، تأجير دراجات مائية، متجر ملابس صيفية، آيس كريم | توصيل طلبات، تصوير سياح، سباق شاطئي |
| **2** | **Neon Downtown** | أبراج زجاجية voxel عاكسة، شاشات نيون، ترام، ازدحام | بنوك، مقاهي، ملابس فاخرة، إلكترونيات، حلاق | سرقة بنك، مطاردات، هاكينغ |
| **3** | **Palmetto Suburbs** | بيوت دورين بحدائق، مدارس، ملاعب، هدوء | سوبرماركت، صيدلية، مغسلة، ورشة صغيرة | تاكسي، توصيل أطفال، إصلاح |
| **4** | **Coral Industrial** | مصانع حمراء، رافعات، حاويات، دخان voxel | ورشة تعديل كبيرة، خردة، متجر أدوات، مستودع | تهريب، مطاردة شاحنات، تخريب |
| **5** | **Mangrove Swamp** | مستنقعات، جسور خشبية، أشجار معلقة، ضباب | كوخ صيد، محطة وقود قديمة، بار ريفي | مطاردة قوارب، بحث، هروب |
| **6** | **Sunset Hills** | فلل فاخرة على تلة، إطلالة بانورامية، غروب | نادي غولف، فيلا للبيع، معرض سيارات فاخرة | سرقة فيلا، سباق جبلي، تصوير |
| **7** | **Harbor Market** | ميناء صاخب، سوق شعبي، ألوان دافئة | سوق سمك، مطاعم شعبية، متجر هدايا | توصيل ميناء، شجار سوق، تهريب |
| **8** | **AeroTech Park** | منطقة تقنية/جامعة، مباني بيضاء حديثة | متجر إلكترونيات، مقهى دراسة، مكتبة | مهام هاكينغ، توصيل طرود تقنية |

> **نصيحة التنفيذ:** ابدأ بـ 1+2+3 فقط (مثلث ذهبي: بحر-مدينة-ضواحي). كل منطقة = Tile 500×500م مع LOD.

### 20 محل/مبنى تفاعلي

| # | الاسم | الوظيفة |
|---|---|---|
| 1 | **SunBite Diner** | مطعم برغر — اشترِ وجبة (+صحة)، مهمة توصيل |
| 2 | **Aqua Threads** | ملابس شاطئية — غيّر اللبس |
| 3 | **Neon Cuts** | حلاق — غيّر تسريحة/لحية voxel |
| 4 | **Bay Motors Garage** | ورشة تعديل — لون/جنوط/نيترو/تصليح |
| 5 | **FreshMart** | سوبرماركت — التقط منتجات من الرفوف، ادفع عند الكاشير |
| 6 | **PharmaPlus** | صيدلية — أدوية/ضمادات |
| 7 | **TechHaven** | إلكترونيات — اشترِ هاتف/كاميرا (للمهام) |
| 8 | **Bean & Bloom Café** | مقهى — اجلس، استمع، مهمة تصوير |
| 9 | **InkSpot Tattoo** | وشم voxel |
| 10 | **Luna Gym** | جيم — تدريب يزيد قوة الضرب |
| 11 | **WaveRent** | تأجير دراجات/سكوتر |
| 12 | **Harbor Pawn** | رهن — بع أغراض مسروقة |
| 13 | **City Bank** | بنك — مهمة سطو رئيسية |
| 14 | **Sunset Realty** | عقارات — اشترِ شقة/كراج |
| 15 | **AmmoLite** | متجر أدوات/حماية — مضرب/رذاذ |
| 16 | **Vinyl & Vibes** | تسجيلات — غيّر راديو السيارة |
| 17 | **FuelPro Station** | محطة وقود — عبّئ بنزين (استهلاك خفيف)، متجر صغير |
| 18 | **LaundroVox** | مغسلة — إخفاء ملابس مطلوبة |
| 19 | **Coral Fish Market** | سوق سمك — مزاد صباحي، مهمة توصيل |
| 20 | **SkyView Hotel Lobby** | فندق — نقطة حفظ فاخرة + مهمة تسلل |

---

## C) نظام المهام

### 12 مهمة رئيسية (القصة: صعودك من سائق توصيل إلى أسطورة المدينة)

| # | العنوان | الهدف | الخطوات | المكافأة | الربط القصصي |
|---|---|---|---|---|---|
| 1 | **أول توصيلة** | تعلّم القيادة | خذ سكوتر → وصّل طرداً للشاطئ قبل 3 دق | $300 + سكوتر مجاني | تعريف بالمدينة |
| 2 | **رخصة سولارا** | اختبار قيادة | أكمل مسار حواجز دون صدم | رخصة + فتح التاكسي | بوابة الأنشطة |
| 3 | **ليلة النيون** | تعرّف على الميكانيكية لونا | قد بلونا downtown ليلاً وهرب من دورية | $800 + خصم ورشة 20% | لقاء الحليف |
| 4 | **دَين الميناء** | سدّد دين عمك | اجمع $2000 عبر تاكسي/توصيل أو اقترض | فتح Harbor Market | ضغط اقتصادي |
| 5 | **سرقة الفانيليا** | اسرق شاحنة آيس كريم | تسلل للمصنع → قد الشاحنة للمستنقع دون كشف | $1500 + شاحنة | أول جريمة |
| 6 | **حاجز الفجر** | اهرب من أول حاجز شرطة | مطاردة 2 نجوم + اختر حاجزاً | إزالة نجمة مجانية + مهارة درفت | تعليم Wanted |
| 7 | **أضواء المارينا** | صوّر 5 معالم للسائح | استخدم كاميرا TechHaven + تسلّق فندق | $1200 + كاميرا دائمة | استكشاف |
| 8 | **سباق الغروب** | اربح سباق الشارع | عدّل سيارتك → اربح 3 لفات حول Downtown | $3000 + سيارة رياضية مستعملة | بوابة السباقات |
| 9 | **سطو FreshMart** | قرار أخلاقي | اسرق المتجر (فلوس سريعة + نجمتين) أو احمه (سمعة) | $2000 أو -نجمة دائمة | تفرع أخلاقي |
| 10 | **خيانة الكورال** | كشف المصنع | تسلل صناعي + هاك 3 حواسيب + هروب بقارب | $4000 + فتح Mangrove | ذروة الفصل 1 |
| 11 | **قمة Sunset Hills** | اقتحم فيلا | تسلق + تعطيل كاميرات + سرقة لوحة voxel | $6000 + فيلا صغيرة | صعود اجتماعي |
| 12 | **نهائي سولارا** | سباق/مطاردة نهائية 5 نجوم | هروب من المدينة عبر جسر مع مروحية + تسليم اللوحة | $10000 + لقب “أسطورة سولارا” + فتح الخريطة الكاملة | خاتمة + Teaser للتوسعة |

### 20 مهمة جانبية (Side Activities) — تتكرر وتتدرج

| # | النشاط | الوصف السريع | المكافأة |
|---|---|---|---|
| 1 | تاكسي | أوصل 1-3 ركاب بأسرع وقت | $80-250 + بقشيش |
| 2 | توصيل طعام (SunBite) | دراجة/سيارة + وقت محدود | $60-180 |
| 3 | توصيل طرود | شاحنة صغيرة + تجنب الشرطة | $120-300 |
| 4 | سباق شارع ليلي | 4-6 متسابقين، 2-3 لفات | $500-2000 |
| 5 | سباق درفت جبلي | نقاط درفت في Sunset Hills | $400 |
| 6 | تصوير سياحي | صوّر 3 أماكن مطلوبة | $300 + XP |
| 7 | دورية شرطة (مؤقت) | أوقف مجرمين كشرطي | $350 + إزالة نجمة |
| 8 | إسعاف | أوصل مريض للمستشفى بسرعة | $280 |
| 9 | إطفاء | أطفئ حريق voxel بخرطوم | $320 |
| 10 | سحب سيارات | اسحب سيارة معطلة للورشة | $200 |
| 11 | جمع قمامة | شاحنة قمامة + مسار | $150 |
| 12 | كنز الشاطئ | detector + حفر voxel | $500-2000 عشوائي |
| 13 | قفزات مجنونة | اقفز من منحدر لمسافة | $250 + نيترو |
| 14 | تحدّي ركن | اركن بدقة 90° | $100 |
| 15 | حماية متجر | امنع سطو 60 ثانية | $400 |
| 16 | هروب مجرم | اهرب بنجمتين لمدة 90 ثانية | $600 |
| 17 | توصيل وقود | شاحنة وقود خطرة | $350 |
| 18 | سباق دراجات | دراجات فقط في الميناء | $450 |
| 19 | بحث عن قطة | ابحث في الضواحي | $200 + سمعة |
| 20 | أسئلة سكان | أجب/ساعد NPC عشوائي | $50-150 |

### 10 أحداث عشوائية (Random Events) — تظهر كل 2-4 دقائق قرب اللاعب

1. **نشل في السوق** — لص يسرق حقيبة ويهرب، امسكه أو تجاهل.
2. **حادث سير** — سيارتان مصطدمتان، إسعاف قادم، يمكنك المساعدة أو السرقة.
3. **مطاردة شرطة عابرة** — شرطة تطارد مجرم NPC، يمكنك التدخل.
4. **سيارة معطلة** — سائق يطلب دفش/توصيل للورشة.
5. **حقيبة فلوس** — تسقط من شاحنة مصفحة، التقطها = نجمتان فوراً.
6. **مصور تائه** — يطلب توصيله لنقطة تصوير مرتفعة.
7. **شجار مقهى** — اثنان يتشاجران، افصل أو شارك.
8. **كلب ضائع** — أعد الكلب لصاحبه في الضواحي.
9. **عاصفة مفاجئة** — رياح تطيّر صناديق voxel، اجمعها.
10. **حفل نيون** — شاحنة DJ تتجول Downtown، ارقص (ميني جيم) واكسب ملابس.

---

## D) NPC AI و Traffic AI

### 1) سلوك المشاة — State Machine

```
[Idle] --(timer 2-5s / player far)--> [Wander/Walk]
[Walk] --(reach shop)--> [Shop] --(buy 5-10s)--> [Walk]
[Walk] --(hear gun / see police chase 30m)--> [Flee] --(safe 20m)--> [CallPolice] --(30s)--> [Idle]
[Any] --(hit by car)--> [Panic/Fall] --(5s)--> [Flee]
[Walk] --(traffic light red)--> [WaitCross] --> [Walk]
```

**تفاصيل:**
- **Idle:** أنيميشن تنفس، ينظر حوله، يستخدم هاتف voxel.
- **Walk:** يتبع NavMesh + نقاط Waypoints على الرصيف، يتجنب اللاعب والسيارات (Avoidance radius 1.5م).
- **Shop:** يدخل المتجر (Fade interior)، يقف أمام الرف 5 ثوانٍ، يخرج بحقيبة.
- **Flee:** يجري عكس اتجاه الخطر، يصرخ، يلوّح.
- **CallPolice:** يخرج هاتف، شريط اتصال 3 ثوانٍ → +1 Wanted إذا رآك تضرب.
- **Performance:** LOD — أنيميشن كامل <50م، حركة بسيطة <100م، تجميد >150م.

### 2) سلوك السيارات — Traffic AI

```
[FollowLane] --(car ahead <8m)--> [Brake/Wait] --(clear)--> [FollowLane]
[FollowLane] --(intersection red)--> [StopAtLight] --(green)--> [FollowLane]
[FollowLane] --(hear siren / chase nearby)--> [PullOver] --(10s)--> [FollowLane]
[FollowLane] --(player hits)--> [PanicSwerve] --> [FleeTraffic]
```

**تفاصيل:**
- مسارات Spline على كل شارع (اتجاهين)، سرعة 30-60 كم/س حسب الحي.
- **تجاوز:** إذا سيارة بطيئة 3 ثوانٍ، يفحص المسار المعاكس ويتجاوز.
- **إشارة:** Raycast لإشارة المرور، توقف 2-4 ثوانٍ عند الأحمر.
- **هروب عند مطاردة:** يبتعد عن الشرطة، قد يصطدم ويسبب حادث.
- **ازدحام:** كثافة = عدد سيارات/كم، تزداد في الذروة، تقل ليلاً.

### 3) Spawning/Despawn الذكي (الأداء)

- **Grid 100×100م** حول اللاعب: فقط 3×3 خلايا نشطة (300×300م) تسبّن NPC/سيارات.
- **Pool:** 40 مشاة + 20 سيارة معاد استخدامها، لا Instantiate جديد أثناء اللعب.
- **Spawn:** خلف الكاميرا أو عند زاوية شارع بعيدة 60-90م، بسرعة مطابقة للمرور.
- **Despawn:** إذا خلف اللاعب >150م أو غير مرئي 10 ثوانٍ → إعادة للـ Pool.
- **Culling:** Frustum + Occlusion (مباني تحجب)، Shadows فقط لـ 30 جسم قريب.
- **LOD:** سيارات بعيدة = صندوق واحد، قريبة = voxel مفصل + ظلال.
- **Budget:** <80 Draw Calls عبر GPU Instancing للـ voxel المتكرر.

---

## E) أسلوب الفن والأنيميشن — High-Quality Voxel

### 1) الوصف البصري
- **Voxel:** مكعب 0.3-0.5م، حواف Bevel خفيفة (Chamfer 5%) لإزالة الحدة، Ambient Occlusion داخل الزوايا.
- **إضاءة:** URP + Light Probes + Reflection Probes كل 30م + SS Ambient Occlusion خفيف. شمس Directional + Skybox HDR غروب (برتقالي #FF7A3D → وردي #FF4D8A → بنفسجي #5A2A83).
- **ظلال:** Cascaded Shadows ناعمة 2048، ظل voxel حاد قريب وناعم بعيد.
- **Bloom:** خفيف (Threshold 1.2, Intensity 0.6) للنيون فقط، ليس مشبع.
- **Neon Signs:** مكعبات باعثة (Emission 3-5) + خطوط voxel مضيئة + وميض 0.5 هرتز.
- **خامات:** Palette محدودة 64 لون دافئ، Roughness 0.7-0.9 للمباني، Metallic 0.1، زجاج بسيط شفاف + انعكاس خفيف (SSR مبسط).
- **ماء:** Voxel ماء مسطح مع Vertex Wave + انعكاس غروب.

### 2) أنيميشن الشخصية (قائمة)

| الأنيميشن | الإطارات | ملاحظات voxel |
|---|---|---|
| Idle | 60 | تنفس + حركة رأس |
| Walk | 24 loop | تأرجح أذرع مكعبة |
| Run | 16 loop | ميل 10° للأمام |
| Jump | 20 | قرفصاء → قفز → هبوط |
| Enter Car (سائق) | 45 | فتح باب → جلوس → إغلاق |
| Exit Car | 30 | فتح → خروج |
| فتح باب متجر | 20 | دفع باب زجاجي |
| شراء/استلام | 30 | يد تمتد + حقيبة |
| قتال قبضة 1-2-3 | 15/15/20 | لكمات مكعبة |
| تصويب مسدس | loop | ذراعان أمامية |
| هاتف/تصوير | loop | هاتف/كاميرا voxel |
| رقص/احتفال | 60 | للفوز |

### 3) السيارات

- فتح باب (مفصل voxel يدور 70°)، أضواء أمامية/خلفية (Emission)، مؤشرات برتقالية تومض، تكسير: زجاج يتفتت مكعبات + صدام يسقط + دخان.

---

## F) خطة التطوير الواقعية — Roadmap

### المرحلة 1: Prototype (أسبوع — 3 أسابيع) — “هل هي ممتعة؟”
**الأهداف:** حركة + قيادة + مدينة صغيرة 300×300م + NPC بسيط.
**المخرجات:** Playable exe يمشي/يقود/يدخل سيارة، شارعين + 5 مباني + ليل/نهار.
**المخاطر:** فيزياء السيارة غير ممتعة → حل: Arcade preset + تجريب يومي.

### المرحلة 2: Vertical Slice (شهر — 3 أشهر) — “هل تصلح كمنتج؟”
**الأهداف:** 1.5×1.5 كم + 8 محلات + 5 مهام رئيسية + شرطة 3 نجوم + اقتصاد + حفظ.
**المخرجات:** Demo 15 دقيقة للستيم + Trailer 60 ثانية.
**المخاطر:** أداء voxel → حل: Chunking + Instancing + LOD.

### المرحلة 3: Early Access / Beta (3 — 9 أشهر) — “هل يعيدون اللعب؟”
**الأهداف:** خريطة 5×5 كم تدريجياً + 12 مهمة + 20 نشاط + 5 نجوم + تخصيص + صوتيات كاملة.
**المخرجات:** Early Access على Steam + تحديثات شهرية (حي جديد كل 6 أسابيع).
**المخاطر:** محتوى كثير → حل: أدوات توليد إجرائي للمدينة + متجر أصول voxel جاهز.

---

## G) التنفيذ التقني — Unity 6 (الاختيار لك: PC EXE)

### لماذا Unity لك؟
- تصدير **EXE أحادي الملف** بضغطة: Build → Windows x64 → SolaraBay.exe (لا يحتاج تثبيت)
- URP ممتاز للـ voxel + إضاءة سينمائية خفيفة
- PhysX مدمج للسيارة + NavMesh للمشاة
- Asset Store: Voxel tools + Traffic System جاهزة

### هيكل المشروع

```
Assets/
 ├─ _Project/
 │   ├─ Scenes/ (Boot, City_1.5km, Interiors)
 │   ├─ Scripts/
 │   │   ├─ Player/ (PlayerController, Interaction, Combat)
 │   │   ├─ Vehicle/ (VehicleController, Wheel, Damage)
 │   │   ├─ AI/ (PedestrianAI, TrafficAI, PoliceManager)
 │   │   ├─ World/ (DayNightCycle, Weather, ChunkManager)
 │   │   ├─ Economy/ (Money, Shop, Inventory)
 │   │   └─ Missions/ (MissionManager, RandomEvents)
 │   ├─ Voxel/ (CityGenerator, BuildingPresets, Palettes)
 │   ├─ UI/ (HUD, Minimap, ShopUI)
 │   └─ Audio/ (Ambience, Radio)
 ├─ Plugins/ (URP, DOTween)
 └─ StreamingAssets/ (Save.json)
```

### كود مبدئي — 3 أنظمة أساسية (C# — Unity)

#### 1) Player Controller + Interaction (أول/ثالث قابل للتبديل)

```csharp
public class PlayerController : MonoBehaviour {
    public float walkSpeed=3.5f, runSpeed=6f, jumpForce=5f;
    public Transform camPivot; public bool isFPS;
    CharacterController cc; Vector3 vel;
    void Update(){
        float h=Input.GetAxis("Horizontal"), v=Input.GetAxis("Vertical");
        bool run=Input.GetKey(KeyCode.LeftShift);
        Vector3 dir = (camPivot.forward*v + camPivot.right*h).normalized;
        dir.y=0;
        float speed = run? runSpeed: walkSpeed;
        cc.Move(dir*speed*Time.deltaTime);
        if(Input.GetKeyDown(KeyCode.V)) ToggleCamera();
        if(Input.GetKeyDown(KeyCode.E)) TryInteract();
        if(Input.GetKeyDown(KeyCode.Space) && cc.isGrounded) vel.y=jumpForce;
        vel.y += Physics.gravity.y*Time.deltaTime;
        cc.Move(vel*Time.deltaTime);
        if(cc.isGrounded) vel.y=-1f;
    }
    void ToggleCamera(){ isFPS=!isFPS; camPivot.localPosition = isFPS? new Vector3(0,1.6f,0.1f): new Vector3(0,1.8f,-4f);}
    void TryInteract(){
        if(Physics.Raycast(camPivot.position, camPivot.forward, out var hit, 3f)){
            hit.collider.GetComponent<IInteractable>()?.Interact(this);
        }
    }
}
```

#### 2) Vehicle Controller بسيط (Arcade — بدون WheelCollider معقد)

```csharp
public class VehicleController : MonoBehaviour {
    public float motorTorque=1200f, steerAngle=30f, brakeForce=3000f;
    public Transform[] wheels; public bool isOccupied;
    float inputV, inputH, speed;
    Rigidbody rb;
    void FixedUpdate(){
        if(!isOccupied) return;
        inputV=Input.GetAxis("Vertical"); inputH=Input.GetAxis("Horizontal");
        Vector3 forward = transform.forward * inputV * motorTorque;
        rb.AddForce(forward);
        transform.Rotate(0, inputH * steerAngle * Time.deltaTime * (speed/10f), 0);
        speed = rb.velocity.magnitude*3.6f;
        // درفت
        if(Input.GetKey(KeyCode.Space)) rb.AddForce(-transform.right*500f*inputH);
        // تحديث عجلات بصرياً
        foreach(var w in wheels) w.Rotate(inputV*360*Time.deltaTime,0,0);
    }
    public void Enter(PlayerController p){ isOccupied=true; p.gameObject.SetActive(false); }
    public void Exit(PlayerController p){ isOccupied=false; p.transform.position=transform.position+transform.right*2f; p.gameObject.SetActive(true);}
}
```

#### 3) Wanted System + Police Spawning

```csharp
public class WantedSystem : MonoBehaviour {
    [Range(0,5)] public int wantedLevel;
    public float wantedTimer, escapeTime=20f;
    public Transform player; public GameObject policePrefab;
    List<GameObject> activePolice=new();
    public void AddWanted(int stars){
        wantedLevel=Mathf.Clamp(wantedLevel+stars,0,5);
        wantedTimer=0; SpawnPolice();
        UIManager.Instance.ShowWanted(wantedLevel);
    }
    void Update(){
        if(wantedLevel>0){
            bool seen = IsSeenByPolice();
            wantedTimer = seen? 0: wantedTimer+Time.deltaTime;
            if(wantedTimer>escapeTime) DecreaseWanted();
            if(activePolice.Count < wantedLevel*2) SpawnPolice();
        }
    }
    void SpawnPolice(){
        Vector3 pos = player.position + Random.onUnitSphere*80f; pos.y=0;
        NavMeshHit hit; if(NavMesh.SamplePosition(pos,out hit,50f,NavMesh.AllAreas)){
            var cop = Instantiate(policePrefab, hit.position, Quaternion.identity);
            cop.GetComponent<PoliceAI>().Chase(player);
            activePolice.Add(cop);
        }
    }
    bool IsSeenByPolice()=> activePolice.Exists(c=> Vector3.Distance(c.transform.position, player.position)<40f);
    void DecreaseWanted(){ wantedLevel--; wantedTimer=0; UIManager.Instance.ShowWanted(wantedLevel); }
}
```

### Optimization لعالم Voxel مفتوح

| التقنية | التطبيق |
|---|---|
| **Chunking** | قسّم المدينة 50×50م Chunks، حمّل 3×3 حول اللاعب فقط |
| **GPU Instancing** | كل مكعب متكرر = Material واحد + Instancing، <30 Draw Calls |
| **Occlusion Culling** | Umbra + مباني تحجب ما خلفها |
| **LOD** | مبنى بعيد = Box واحد، قريب = voxel مفصل |
| **Texture Atlas** | Atlas 1024 واحد لكل الألوان |
| **Job System + Burst** | حركة 150 NPC عبر IJobParallelFor |
| **Object Pool** | سيارات/NPC/رصاص Pool بدون Instantiate |
| **Baked Lighting** | Lightmaps للمباني + Light Probes للمتحرك |

---

## 📦 التسليم الحالي

1. **هذه الوثيقة** — جاهزة للطباعة/التحويل PDF
2. **اللعبة القابلة للعب** — نسخة Prototype أولية تعمل في المتصفح + قابلة للتصدير EXE (انظر مجلد `solara-bay/`)

> **التالي:** افتح اللعبة الآن في المعاينة، جرّب القيادة والمطاردة، ثم اطلب مني تصدير **SolaraBay.exe** أحادي الملف أو توسيع الخريطة لمنطقتك المفضلة.

