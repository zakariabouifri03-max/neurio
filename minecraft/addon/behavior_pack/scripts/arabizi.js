/**
 * arabizi.js — Moroccan Darija text engine (no Minecraft imports: runs in the game, in Node and in the browser)
 * -------------------------------------------------------------------------------------------------------------
 * Moroccan players write Darija in two ways:
 *    Arabic script :  سلام خويا، كيف داير؟
 *    Arabizi       :  salam khoya, kif dayr?      (Latin letters + digits: 3=ع 5=خ 7=ح 9=ق 2=ء 8=غ 6=ط)
 *
 * The corpus is written ONCE in Arabic script and this module derives the Arabizi form automatically,
 * so a villager can answer you in whichever script you used. It also normalizes both sides so that
 * "kifach", "kif dayr", "كيفاش" and "كيف داير" all land on the same intent.
 */

/* ------------------------------------------------------------------ *
 * Arabic pre-processing
 * ------------------------------------------------------------------ */

/** Diacritics (harakat), tatweel, and the Quranic marks — none of them change the meaning here. */
const AR_DIACRITICS = /[\u064B-\u0652\u0640\u0670\u06D6-\u06ED\u0610-\u061A]/g;

/** Letters that are always read as their "plain" cousin. */
const AR_FOLD = {
  '\u0622': '\u0627', // آ -> ا
  '\u0623': '\u0627', // أ -> ا
  '\u0625': '\u0627', // إ -> ا
  '\u0626': '\u064a', // ئ -> ي
  '\u0624': '\u0648', // ؤ -> و
  '\u0649': '\u064a', // ى -> ي
  '\u0629': '\u0647', // ة -> ه  (Darija reads it "a"/"h")
  '\u066e': '\u0628',
  '\u06cc': '\u064a', '\u0643': '\u0643',
};

/** Punctuation / decorations we throw away before matching. */
const PUNCT = /[.,!?;:"'`´’‘“”()\[\]{}<>|/\\+\-*=~^%$#@&_…،؛؟«»ـ]/g;

/** Fold Arabic letters to their base shapes. */
export function foldArabic(s) {
  let out = '';
  for (const ch of s) out += AR_FOLD[ch] || ch;
  return out;
}

/** Normalize Arabic-script text for matching. */
export function normalizeAr(s) {
  return foldArabic(String(s || ''))
    .replace(AR_DIACRITICS, '')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize Latin/Arabizi text for matching. */
export function normalizeLatin(s) {
  let t = String(s || '').toLowerCase().replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
  // Common spelling variants people type on a phone keyboard.
  t = t
    .replace(/\b(?:salamo|salamou|salamoo)\b/g, 'salam')
    .replace(/\bch7al\b/g, 'chhal')
    .replace(/\bsh7al\b/g, 'chhal')
    .replace(/\bkifash\b/g, 'kifach')
    .replace(/\bkidayer\b/g, 'kif dayr')
    .replace(/\b3lach\b/g, '3lach')
    .replace(/\bla baas\b/g, 'labas')
    .replace(/\bte7ya\b/g, 't7iya')
    .replace(/\bsaha\b/g, 'saha');
  return t;
}

/** Which script is this? */
export function detectScript(s) {
  const str = String(s || '');
  const ar = (str.match(/[\u0600-\u06FF]/g) || []).length;
  const la = (str.match(/[A-Za-z0-9]/g) || []).length;
  if (ar === 0 && la === 0) return 'none';
  return ar >= la ? 'ar' : 'latin';
}

/* ------------------------------------------------------------------ *
 * Arabic -> Arabizi
 * ------------------------------------------------------------------ */

/**
 * Letter level map (fallback for words that are not in the dictionary).
 * Digits follow the Moroccan chat alphabet.
 */
const LETTERS = {
  '\u0627': 'a', // ا
  '\u0628': 'b', // ب
  '\u062a': 't', // ت
  '\u062b': 't', // ث
  '\u062c': 'j', // ج
  '\u062d': '7', // ح
  '\u062e': '5', // خ
  '\u062f': 'd', // د
  '\u0630': 'd', // ذ
  '\u0631': 'r', // ر
  '\u0632': 'z', // ز
  '\u0633': 's', // س
  '\u0634': 'ch', // ش
  '\u0635': 's', // ص
  '\u0636': 'd', // ض
  '\u0637': '6', // ط
  '\u0638': 'd', // ظ
  '\u0639': '3', // ع
  '\u063a': '8', // غ
  '\u0641': 'f', // ف
  '\u0642': '9', // ق
  '\u0643': 'k', // ك
  '\u0644': 'l', // ل
  '\u0645': 'm', // م
  '\u0646': 'n', // ن
  '\u0647': 'h', // ه
  '\u0648': 'w', // و
  '\u064a': 'y', // ي
};

const VOWEL_LETTERS = 'aeiouy2356789';

/**
 * Common Darija words written the way Moroccans actually type them.
 * Anything missing falls back to the letter map, which still gives readable Arabizi.
 */
export const WORD_MAP = {
  // greetings & politeness
  'السلام': 'salam', 'عليكم': '3likom', 'سلام': 'salam', 'اهلا': 'ahlan', 'مرحبا': 'merhba',
  'صباح': 'sba7', 'الخير': 'lkhir', 'مساء': 'msa', 'لاباس': 'labas', 'بخير': 'bkhir',
  'شكرا': 'chokran', 'بارك': 'barek', 'الله': 'allah', 'فيك': 'fik', 'يعطيك': 'y3tik',
  'الصحة': 'sa7a', 'عفاك': '3afak', 'سمح': 'sme7', 'ليا': 'liya', 'ليكم': 'likom',
  'بسلامة': 'bslama', 'تصبح': 'tsba7', 'خير': 'khil', 'مع': 'm3a', 'السلامة': 'slama',
  // question words
  'كيف': 'kif', 'كيفاش': 'kifach', 'داير': 'dayr', 'دايرة': 'dayra', 'شنو': 'chnou', 'اش': 'ach',
  'اشنو': 'achnou', 'فين': 'fin', 'اين': 'fin', 'شكون': 'chkoun', 'شحال': 'chhal', 'شحال': 'chhal',
  'علاش': '3lach', 'لماذا': '3lach', 'امتى': 'imta', 'فوقاش': 'fou9ach', 'واش': 'wach', 'هل': 'wach',
  'سميتك': 'smitk', 'سميت': 'smit', 'اسمك': 'smitk', 'من': 'mnin', 'انت': 'nta', 'انتي': 'nti',
  'انا': 'ana', 'نتوما': 'ntouma', 'حنا': '7na', 'هو': 'howa', 'هي': 'hiya',
  // verbs
  'بغيت': 'bghit', 'بغيتي': 'bghiti', 'بغا': 'bgha', 'كانبغي': 'kanbghi', 'نبغي': 'nbghi',
  'كنمشي': 'kanmchi', 'مشيت': 'mchit', 'نمشي': 'nmchi', 'اجي': 'aji', 'تعال': 't3al', 'تعالي': 't3ali',
  'عطيني': '3tini', 'عطيت': '3tit', 'نعطيك': 'n3tik', 'خد': 'khod', 'خودي': 'khodi',
  'نشري': 'nchri', 'شري': 'chri', 'نبيع': 'nbi3', 'بيع': 'bi3', 'تبيع': 'katsi3',
  'نخدم': 'nkhdm', 'خدم': 'khdm', 'نقضي': 'n9di', 'عرفت': '3رفت', 'نعرف': 'n3ref', 'عارف': '3aref',
  'فهمت': 'fhemt', 'فهم': 'fhem', 'قول': 'goul', 'قلت': 'golt', 'كنقول': 'kangoul', 'نهضر': 'nhder',
  'كنهضر': 'kanhder', 'هضر': 'hder', 'سمع': 'sme3', 'شفت': 'cheft', 'نشوف': 'nchouf', 'شوف': 'chouf',
  'كلت': 'klt', 'نمشيو': 'nmchiw', 'دير': 'dir', 'ديري': 'diri', 'كنت': 'kont', 'كان': 'kan',
  'يكون': 'ykon', 'غادي': 'ghadi', 'غادة': 'ghada', 'باش': 'bach', 'حتا': '7ta', 'رجع': 'rje3',
  'دخل': 'dkhol', 'خرج': 'khrej', 'جلس': 'gles', 'نعس': 'n3es', 'نعست': 'n3est', 'صحا': 's7a',
  // nouns
  'خويا': 'khoya', 'خوي': 'khouya', 'اخويا': 'akhoya', 'صاحبي': 'sa7bi', 'صاحب': 'sa7eb',
  'القرية': 'lqria', 'قرية': 'qria', 'الدار': 'ddar', 'دار': 'dar', 'السوق': 'ssou9', 'سوق': 'sou9',
  'المدينة': 'lmdina', 'مدينة': 'mdina', 'البيت': 'lbit', 'بيت': 'bit', 'الجامع': 'ljame3',
  'المسجد': 'lmasjid', 'المدرسة': 'lmdrasa', 'السبيطار': 'sbi6ar', 'البحر': 'lbe7r', 'بحر': 'be7r',
  'الجبل': 'ljbel', 'الواد': 'lwad', 'الطريق': 'tri9', 'طريق': 'tri9', 'الغابة': 'l8aba',
  'الخبز': 'lkhobz', 'خبز': 'khobz', 'الما': 'lma', 'ماء': 'lma', 'الشاي': 'atay', 'القهوة': 'qhwa',
  'الحوت': 'l7out', 'اللحم': 'l7em', 'الخضر': 'lkhodra', 'الزيت': 'zit', 'الزيتون': 'zitoun',
  'القمح': 'l9m7', 'الفلوس': 'flous', 'دراهم': 'drahem', 'الذهب': 'dheheb', 'الفضة': 'fedda',
  'العيالات': '3yalat', 'الرجال': 'rjala', 'الولد': 'weld', 'البنت': 'bent', 'الأم': 'yemma',
  'الأب': 'baba', 'الجد': 'jedi', 'العائلة': '3a2ila', 'الناس': 'nnas', 'الواحد': 'lwa7ed',
  'الليل': 'llil', 'النهار': 'nhar', 'الصبح': 'sseb7', 'الغدا': 'ghda', 'العشا': '3cha',
  'اليوم': 'lyoum', 'غدا': 'ghedda', 'العام': 'l3am', 'الشتاء': 'chtwa', 'الصيف': 'ssif',
  'الشمس': 'chms', 'القمر': '9mer', 'النجوم': 'njoum', 'الشتا': 'chta', 'المطر': 'chtar',
  'الريح': 'rri7', 'السخانة': 'skhana', 'البرد': 'lbard', 'الضلام': 'dlam', 'النور': 'nnour',
  'الحديد': 'l7did', 'الماس': 'almas', 'الفحم': 'lfa7m', 'الذهب': 'dheheb', 'الخشب': 'lkhcheb',
  'الحجر': 'l7jer', 'الرمل': 'remel', 'التراب': 'trab', 'الزرع': 'zer3', 'الشجرة': 'chjera',
  'الكلب': 'kelb', 'القطة': '9etta', 'الحمار': '7mar', 'البقرة': 'bgra', 'الخروف': 'khrouf',
  'الفرس': '3awd', 'الديك': 'serd', 'الطير': '6ir', 'الذيب': 'dib', 'الحية': '7nya',
  'الزombie': 'zombi', 'الموت': 'lmout', 'الحياة': 'l7ayat', 'القلب': '9leb', 'الراس': 'rras',
  'العين': '3in', 'اليد': 'yedd', 'الرجل': 'rjel', 'الوجه': 'wejeh', 'الصوت': 'ssout',
  // adjectives & adverbs
  'مزيان': 'mezyan', 'مزيانة': 'mezyana', 'حسن': '7sen', 'خايب': 'khaib', 'زوين': 'zwin',
  'زوينة': 'zwina', 'كبير': 'kbir', 'صغير': 's8ir', 'طويل': 'twil', 'قصير': '9sir',
  'سخون': 'skhoun', 'بارد': 'bard', 'غالي': '8ali', 'رخيص': 'rkhis', 'صعب': 's3ib', 'سهل': 'sehl',
  'بزاف': 'bzaf', 'شوية': 'chwiya', 'قلة': '9ella', 'كثير': 'ktir', 'شوية': 'chwiya',
  'دابا': 'daba', 'الآن': 'daba', 'منين': 'mnin', 'هنا': 'hna', 'تم': 'temma', 'قريب': '9rib',
  'بعيد': 'b3id', 'مليح': 'mli7', 'واضح': 'wade7', 'خايف': 'khayef', 'فرحان': 'fer7an',
  'حزين': '7zin', 'عيان': '3iyan', 'جوعان': 'ju3an', 'عطشان': '3etchan', 'مريض': 'mrid',
  'مجنون': 'mejnoun', 'عاقل': '3a9el', 'ذكي': 'dki', 'بليد': 'blid', 'كذاب': 'keddab',
  'صحيح': 's7i7', 'واقila': 'wa9ila', 'واقيلا': 'wa9ila', 'يمكن': 'yimken', 'أكيد': 'akid',
  'مهم': 'mohim', 'عادي': '3adi', 'ممتاز': 'momtaz', 'برافو': 'bravo',
  // numbers
  'واحد': 'wa7ed', 'جوج': 'jouj', 'ثلاثة': 'tlata', 'اربعة': 'reb3a', 'خمسة': 'khamsa',
  'ستة': 'setta', 'سبعة': 'seb3a', 'ثمانية': 'tmenya', 'تسعة': 'tes3ud', 'عشرة': '3echra',
  'مية': 'miyya', 'الف': 'alf',
  // little words
  'و': 'w', 'ف': 'f', 'ب': 'b', 'ل': 'l', 'ال': 'l', 'ديال': 'dyal', 'د': 'd',
  'على': '3la', 'عن': '3an', 'الي': 'li', 'الى': 'ila', 'او': 'wla', 'ولا': 'wla',
  'ما': 'ma', 'مك': 'mak', 'من': 'men', 'بين': 'bin', 'قبل': '9bel', 'بعد': 'ba3d',
  'فوق': 'fou9', 'تحت': 'te7t', 'قدام': '9ddam', 'ورا': 'wra', 'جنب': 'jenb', 'داخل': 'dkhel',
  'هاد': 'had', 'هاذ': 'had', 'هداك': 'hedak', 'هاديك': 'hadik', 'شي': 'chi', 'حتى': '7ta',
  'غير': 'ghir', 'بصح': 'bes7', 'صافي': 'safi', 'واخا': 'wakha', 'يالله': 'yallah',
  'بسم': 'besm', 'ان': 'an', 'شاء': 'cha2', 'الحمد': 'l7amd', 'لله': 'lillah',
  'ماشاء': 'macha2', 'الله': 'llah', 'مبروك': 'mabrouk', 'عقبال': '39bal',
  'الذكاء': 'daka2', 'الاصطناعي': 'istina3i', 'روبوت': 'robot', 'برنامج': 'bernamej',
  'لعبة': 'l3ba', 'اللعب': 'l3ib', 'الماينكرافت': 'minecraft', 'العالم': 'l3alam',
  'الزمان': 'zman', 'المكان': 'blasa', 'بلاصة': 'blasa', 'الحاجة': '7aja', 'حاجة': '7aja',
  'الكلام': 'klam', 'كلام': 'klam', 'السؤال': 'so2al', 'سؤال': 'so2al', 'الجواب': 'jwab',
  'الخدمة': 'khedma', 'خدمة': 'khedma', 'الدراهم': 'drahem', 'الثمن': 'taman', 'ثمن': 'taman',
  'الصنعة': 'sna3a', 'المهنة': 'mihna', 'الصاحب': 'sa7eb', 'الصديق': 'sadi9', 'صديق': 'sadi9',
  'الضيف': 'dif', 'ضيف': 'dif', 'الجار': 'jar', 'جار': 'jar', 'النهار': 'nhar',
};

/** Transliterate one Arabic word to Arabizi. */
export function wordToArabizi(w) {
  const folded = foldArabic(w.replace(AR_DIACRITICS, '')).trim();
  if (!folded) return '';
  if (WORD_MAP[folded]) return WORD_MAP[folded];

  // "ال..." -> "l..." (definite article), "و..." -> "w..."
  let body = folded;
  let prefix = '';
  if (body.length > 3 && body.startsWith('\u0627\u0644')) { prefix = 'l'; body = body.slice(2); }
  else if (body.length > 2 && body.startsWith('\u0648')) { prefix = 'w'; body = body.slice(1); }
  if (prefix && WORD_MAP[body]) return prefix + WORD_MAP[body];

  let out = '';
  const chars = [...body];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    let lat = LETTERS[ch];
    if (lat === undefined) { out += ch; continue; }
    if (ch === '\u0648') { // و : "w" at the start / after a consonant cluster, "o" inside a word
      lat = i === 0 ? 'w' : (VOWEL_LETTERS.includes(out.slice(-1)) ? 'w' : 'o');
      if (i === chars.length - 1) lat = 'w';
    }
    if (ch === '\u064a') { // ي : "y" at the edges, "i" in the middle
      lat = (i === 0 || i === chars.length - 1) ? 'y' : 'i';
    }
    if (ch === '\u0627') { // ا : "a", but silent at the very end of a long word
      lat = (i === chars.length - 1 && chars.length > 3) ? '' : 'a';
    }
    out += lat;
  }
  // tidy up double vowels that look wrong
  out = out.replace(/aa+/g, 'a').replace(/ii+/g, 'i').replace(/hh/g, 'h');
  return prefix + out;
}

/** Transliterate a whole Arabic sentence into Arabizi. */
export function arToArabizi(text) {
  return String(text || '')
    .split(/(\s+)/)
    .map((tok) => (/[\u0600-\u06FF]/.test(tok) ? wordToArabizi(tok.replace(PUNCT, '')) : tok))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Matching helpers
 * ------------------------------------------------------------------ */

/** Split into tokens, keeping digits (Arabizi uses them as letters). */
export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[\s,.!?;:'"()\[\]{}؟،؛]+/)
    .filter(Boolean);
}

/** All the shapes of a phrase we compare against (Arabic normalized + Arabizi + latin-normalized). */
export function variants(text) {
  const out = new Set();
  const raw = String(text || '').trim();
  if (!raw) return [...out];
  out.add(normalizeAr(raw));
  out.add(normalizeLatin(raw));
  if (/[\u0600-\u06FF]/.test(raw)) out.add(normalizeLatin(arToArabizi(raw)));
  else {
    // typed in Arabizi -> also try to match the Arabic form of the dictionary words
    const back = tokenize(raw).map((t) => REVERSE_MAP[t] || t).join(' ');
    out.add(normalizeAr(back));
  }
  return [...out].filter(Boolean);
}

/** Arabizi -> Arabic, for the words we know (used when the player types Latin but wants Arabic back). */
export const REVERSE_MAP = (() => {
  const m = {};
  for (const [ar, dz] of Object.entries(WORD_MAP)) if (dz && !(dz in m)) m[dz] = ar;
  return m;
})();

/** Cheap similarity for typos: 1 = identical, 0 = nothing in common. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = Math.max(a.length, b.length);
  if (la === 0) return 1;
  const d = levenshtein(a, b);
  return 1 - d / la;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Does `haystack` contain `needle` as a word (or a very close typo of it)? */
export function hasPhrase(haystackTokens, needle, fuzzy = 0.82) {
  const n = tokenize(needle);
  if (!n.length) return false;
  if (n.length === 1) {
    const w = n[0];
    for (const t of haystackTokens) {
      if (t === w) return true;
      if (w.length > 3 && t.length > 3 && similarity(t, w) >= fuzzy) return true;
      if (w.length > 4 && t.length > 4 && similarity(t, w) >= 0.84 && (t.startsWith(w) || w.startsWith(t))) return true; // 3ellem -> 3ellemni
    }
    return false;
  }
  const hay = haystackTokens.join(' ');
  return hay.includes(n.join(' '));
}

/** Rough syllable count, used to time the voice blips. */
export function syllables(text) {
  const t = String(text || '').toLowerCase();
  if (/[\u0600-\u06FF]/.test(t)) {
    const stripped = t.replace(AR_DIACRITICS, '');
    return Math.max(1, Math.round(stripped.length / 2.6));
  }
  const groups = t.match(/[aeiouy2357890]+/g) || [];
  return Math.max(1, groups.length);
}
