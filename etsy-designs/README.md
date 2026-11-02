# 🧵 K-Studio Style — collection PNG (10 designs)

نسخة كاملة من الستيل ديال المتجر **KdigitalstoreArt** — نفس التقنية، نفس الپاليت، نفس الشكل ديال
les listings — ولكن كلشي مصنوع من الصفر بالكود: ما كاين حتى stock art، الخطوط كلها OFL.

**▶ شوف الكوليكسيون:** `python3 -m http.server` داخل هاد الفولدر → `http://localhost:8000`

---

## 1. شنو شفت فالمتجر (التحليل)

| حاجة | القيمة |
|---|---|
| النيش | Sublimation PNG للتيشورتات (seasonal: Christmas, Fall, Bible verse, Family, Teacher/Nurse, Sport…) |
| عدد الليستينڭ | **1,598** listing · 20 section |
| السمية الكبيرة | `24H HOT DEALS` (613) · `NEW!!! Daily Fresh` (204) · `Family Designs` (133) · `Bible Verse` (119) · `FALL HALLOWEEN` (119) · `Teacher/Nurse` (103) · `Sport` (84) |
| الثمن | **$1.67 – $2.43** (25% off دايمة, Prix barré $2.23–$3.25) |
| Social proof | 136.8k sales · ⭐4.9 (4k reviews) · Star Seller · 3 سنين فالمنصة |
| العنوان | وصف الشكل + النيش + التقنية + الفورما : *"Leopard Christmas Tree PNG, Animal Print Christmas, Rustic Vintage Design, Faux Applique Tree, Christmas Sublimation, Digital Download"* |
| الپاليت | Cream `#F7F0DF` · Leopard tan `#F1D2A6` + spots `#241E1A` · Pine `#2E6B4F` · Xmas red `#C0392B` · Terra `#C0562F` · Gold `#D9A93C` / `#F3D177` · Ink outline `#2A211C` |

### الوصفة ديالهم فـ 10 قواعد (hadi hiya "l style")
1. **Faux applique**: كل عنصر كيتقطع كيف ما كان قماش مخيّط، بحدود سميكة dark + خط **stitch** متقطع.
2. **Patchwork letters**: كل حرف عندو الپاطرون ديالو (leopard, gingham, plaid, polka, pine, stripes).
3. **Leopard فكل بلاصة** — هو الـ signature ديالهم (tree, letters, accents).
4. **Coquette bow** (cream ولا gold) فوق ولا وسط التصميم — كيتكرر فـ 80% من الليستينڭ.
5. **Gold doodles**: نجوم، sparkles، line-art bows، snowflakes — خفاف و قلال.
6. **Palette ديال 2–3 ألوان** فكل design، background شفاف (transparent PNG).
7. **الخط**: slab/rounded retro للكلمات الكبيرة (Alfa Slab One, Bowlby) + script (Lobster, Caveat) للجملة الصغيرة.
8. **Layering**: tree/عنصر كبير فوسط + كلمة فوق + script تحت + stars/accents فالزوَايا.
9. **Mockup**: تصويرة واحدة نظيفة (تيشيرت مفروش، خلفية بيج فاتح) — هي لي كتبيع، ماشي الPNG.
10. **Title SEO + 13 tags**: *Hook + Design + Style + Format*، مع كلمات مفتاحية موسمية.

---

## 2. الكوليكسيون (10 designs)

| # | Design | الملف | القياس |
|---|---|---|---|
| 01 | **HOLLY JOLLY** — leopard + gingham patchwork + faux applique tree + bow | `png/d01-holly-jolly-leopard.png` | 4500×5400 |
| 02 | **MERRY CHRISTMAS** — 6 قماشات، كل حرف پاطرون، bow | `png/d02-merry-christmas-patchwork.png` | 4500×5400 |
| 03 | **LEOPARD CHRISTMAS TREE** — الشكل الهرم ديالهم + ornaments + gold script | `png/d03-leopard-christmas-tree.png` | 4500×5400 |
| 04 | **CHRISTMAS PLEASE** — coquette martinis، bows، ornaments | `png/d04-christmas-please-cocktails.png` | 4500×5400 |
| 05 | **GIVE THANKS** — polka letters + gold doodle bow + turkey/pumpkins | `png/d05-give-thanks-turkey.png` | 4500×5400 |
| 06 | **THANKFUL** — hand-lettering scribble + doodle fall | `png/d06-thankful-fall-scribble.png` | 4500×5400 |
| 07 | **SMALL TOWN CHRISTMAS** — vintage red truck + snowy pines | `png/d07-small-town-christmas-truck.png` | 4500×5400 |
| 08 | **CHRISTMAS RACCOON** — funny holiday + iced coffee | `png/d08-christmas-raccoon-funny.png` | 4500×5400 |
| 09 | **TAKE IT TO THE HOOP** — minimal sport line art | `png/d09-take-it-to-the-hoop.png` | 4500×5400 |
| 10 | **WESTERN MAMA** — patchwork name + bows + boots/hat | `png/d10-western-mama-patchwork.png` | 4500×5400 |

كل design عندو:
- `png/…png` — **4500×5400 px transparent** (15×18 inch @ 300 dpi) جاهز للـ print
- `svg/…svg` — vector (تقدر تكبّرو ولا تبدل الألوان)
- `preview/…-preview.png` — الPNG على خلفية
- `preview/…-mockup.jpg` — mockup تيشيرت 2000×2000 (هي لي كتحط فـ Etsy كـ photo #1)
- `listings.json` — title + 13 tags + description + لون التيشيرت لكل design

---

## 3. كيفاش تبدل و تعاود تبني

```bash
# كل designs
python3 tools/designs/designs.py

# غير واحد ولا جوج
python3 tools/designs/designs.py d03 d07

# mockups (من بعد ما تبني الPNG)
python3 tools/designs/mockup.py

# صفحة العرض (index.html)
python3 tools/designs/showcase.py
```

الكود:

```
tools/designs/
├── render.py     # engine: العلامات من الخط (fontTools)، textures (leopard, gingham, plaid…),
│                 # patch/stitch/bow/text helpers، export PNG بـ resvg
├── icons.py      # الرسومات: tree, snowman, turkey, pumpkin, martini, raccoon, truck, hoop…
├── designs.py    # 10 designs + العناوين
├── mockup.py     # SVG تيشيرت + composite بـ Pillow
└── showcase.py   # index.html
etsy-designs/
├── fonts/        # OFL: Alfa Slab One, Bowlby One SC, Anton, Bebas Neue, Lobster, Caveat,
│                 #      Abril Fatface, Shadows Into Light
├── png/  svg/  preview/
├── listings.json
└── index.html
```

### تبديل بسيط
- **سمية أخرى** (custom name, بحال `MAMA`): فـ `designs.py` بدل `patchword("MAMA", …)` بالسمية لي بغيت — الحروف كتتقسم على القماشات أوتوماتيك.
- **ألوان**: كل texture كتاخد parameters، مثال `R.texture("leopard", base="#F1D2A6", seed=12)` ولا `R.texture("gingham", a="#C0392B", b="#FBF3E4")`.
- **خط**: `R.word(..., font="blk" | "cond" | "bebas" | "script" | "hand" | "serif")`.

---

## 4. باش تربح بها (نصايح Etsy)

1. **طلع 5–10 designs/نهار** — المتجر ديالهم عندهم `Daily Fresh` كل نهار؛ الـ algorithm كيحب النشاط.
2. **كل listing = 1 design + 4–6 صور**: mockup تيشيرت (photo 1) · mockup sweatshirt · الPNG على خلفية بيج · close-up stitch · (اختياري) bundle.
3. **Title**: نفس الفورمولا — `[Hook] PNG, [Design], [Style], [Format], Digital Download` (140 حرف).
4. **13 tag** كلهم طوال (20 حرف)، و بلا تكرار ديال نفس الكلمة.
5. **الثمن**: ابدا بـ $1.99–$2.49 مع 25% off (بحالهم) و من بعد دير **bundles** (3 designs = $4.99) باش تطلع الـ AOV.
6. **Sections** بحالهم: `24H HOT DEALS` · `NEW Daily Fresh` · `Bible Verse` · `Family` · `Teacher/Nurse` · `Sport` · `Fall/Halloween` · `Christmas`.
7. **Mockup ديال الجودة** هو 80% من الـ conversion — الخلفية البيج الفاتح + تيشيرت واحد كبير.
8. **License**: بيع PNG شخصي/تجاري صغير بحالهم، وزيد ملف `License.txt` داخل الZIP.

> ملاحظة: الـ designs هنا **مولّدة بالكود 100%** (ماشي مقلدة designs ديالهم واحد بواحد) — نفس الستيل و التقنية فقط، بلا أي مشكل copyright ولا trademark.
