# 📞 Neurio Voice — الدليل بالدارجة

صاوبنا ليك **AI receptionist كامل وخدام بالصح** — كيجاوب على المكالمات، كيحجز
المواعيد، وكيجاوب على الأسئلة. مستهدف السوق الأمريكي 🇺🇸

## شنو تبنى؟

| الحاجة | الرابط | الشرح |
|---|---|---|
| صفحة البيع | `/` | بالإنجليزية، فيها تجربة حية + الأثمنة |
| الديمو الصوتي | `/demo` | هضر مع الـ AI بالميكروفون من المتصفح |
| لوحة التحكم | `/dashboard` | الإعدادات + المكالمات + المواعيد |

**بلا ما تحتاج حتى API key** — الـ AI خدام offline. وإلا بغيتيه أذكى، زيد
`OPENAI_API_KEY` وغادي يستعمل GPT.

## كيفاش تخدمو؟

```bash
cd receptionist
npm install
node server.js
# حل http://localhost:3000
```

جرّب هاد الجمل في الديمو:
- "I'd like to book a cleaning for tomorrow morning" (حجز من جملة وحدة!)
- "How much is teeth whitening?"
- "What are your hours?"
- "I need to cancel my appointment"
- "I want to talk to a human"

## كيفاش يولي يجاوب على مكالمات حقيقية؟ 📱

1. **صاوب حساب Twilio** (twilio.com) وشري نمرة أمريكية (~$1.15/شهر).
2. **نشر السيرفر** في Render أو Railway (فابور للبداية) — خاصو يكون عندو رابط عمومي.
3. في إعدادات النمرة في Twilio، حط الـ webhook:
   `POST https://الرابط-ديالك/voice/incoming`
4. **عيّط للنمرة من تيليفونك** وجرب تحجز موعد بصوتك!

التفاصيل كاملة في تبويب **Go live** داخل `/dashboard`.

## كيفاش تبيعو وتدخل الفلوس؟ 💰

**الأثمنة المقترحة:** $149/شهر (Starter) · $299/شهر (Growth)

**فين تلقى الزبناء:**
1. **Google Maps** — قلب على dentists / plumbers / salons في مدينة أمريكية،
   شوف اللي عندهم تقييمات كتشكي "they never answer the phone" — هادوك زبناء جاهزين!
2. **عيّط ليهم** (أو صيفط email) وجرب ليهم الديمو مباشرة في المكالمة.
3. **TikTok / YouTube Shorts** — صوّر فيديوهات "AI answers the phone for my dental clinic"
   — هاد النوع كيمشي viral في أمريكا.

**السكربت ( pitch ):**
> "Hi, I noticed you miss calls when you're with clients. I built an AI
> receptionist that answers 24/7 and books appointments — can I show you
> a 2-minute demo? First week is free."

**الخلاص:** صاوب Stripe Payment Links (فابور) وحط الروابط في أزرار الأثمنة
في `public/index.html` (قلب على `data-stripe`).

## شنو خاصك تبدل قبل ما تبيع؟

1. في `/dashboard` → غيّر اسم الشركة التجريبية لشركة الزبون الحقيقي
   (الخدمات، الأثمنة، الساعات، الأسئلة الشائعة).
2. بدّل الإيميل `hello@neurio-voice.com` بالإيميل ديالك (في `index.html`).
3. شري دومين `.com` من Namecheap (~$10/العام) وربطو بالسيرفر.

## الأرباح الممكنة 📊

- 10 زبناء × $149 = **~$1,500/شهر**
- 30 زبون × $200 (معدل) = **~$6,000/شهر**
- التكلفة: Twilio (~$10-30/زبون) + السيرفر (~$5-20) — الباقي ربح صافي.

بالتوفيق! 🚀 إلا بغيتي نزيد شي حاجة (SMS، العربية/الفرنسية، Spanish mode،
ربط Google Calendar...) غير گوليا.
