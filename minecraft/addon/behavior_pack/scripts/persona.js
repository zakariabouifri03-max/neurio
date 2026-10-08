/**
 * persona.js — who is this villager? (pure JS, no Minecraft imports)
 * ------------------------------------------------------------------
 * A persona is built deterministically from the entity id, so the same villager is
 * always the same person. If the villager has a real Minecraft profession we read it
 * (villager_v2: minecraft:variant = profession, minecraft:mark_variant = biome).
 */

/* ------------------------------------------------------------------ *
 * Vanilla villager_v2 profession ids (from the vanilla behaviour file)
 * ------------------------------------------------------------------ */
export const PROFESSIONS = {
  0:  { key: 'none',      ar: 'بلا صنعة',      dz: 'bla sna3a',      en: 'villager',        fr: 'villageois',  tags: ['humble'] },
  1:  { key: 'farmer',    ar: 'فلاح',          dz: 'fellah',         en: 'farmer',          fr: 'fermier',     tags: ['farmer', 'foodie'] },
  2:  { key: 'fisherman', ar: 'صياد الحوت',    dz: 'sayyad l7out',   en: 'fisherman',       fr: 'pecheur',     tags: ['brave', 'storyteller'] },
  3:  { key: 'shepherd',  ar: 'راعي الغنم',    dz: 'ra3i l8nam',     en: 'shepherd',        fr: 'berger',      tags: ['humble', 'warm'] },
  4:  { key: 'fletcher',  ar: 'صانع السهام',   dz: 'sana3 saham',    en: 'fletcher',        fr: 'flechier',    tags: ['brave'] },
  5:  { key: 'librarian', ar: 'فقيه الكتب',    dz: 'f9ih lktoub',    en: 'librarian',       fr: 'bibliothecaire', tags: ['elder', 'wise', 'honest_ai'] },
  6:  { key: 'cartographer', ar: 'خرائطي',     dz: 'khara2i6i',      en: 'cartographer',    fr: 'cartographe', tags: ['brave', 'wise'] },
  7:  { key: 'cleric',    ar: 'فقيه',          dz: 'f9ih',           en: 'cleric',          fr: 'clerc',       tags: ['mystic', 'wise'] },
  8:  { key: 'armorer',   ar: 'حداد الدروع',   dz: '7ddad drou3',    en: 'armorer',         fr: 'armurier',    tags: ['smith', 'brave'] },
  9:  { key: 'weaponsmith', ar: 'حداد السيوف', dz: '7ddad syouf',    en: 'weaponsmith',     fr: 'forgeron',    tags: ['smith', 'brave'] },
  10: { key: 'toolsmith', ar: 'حداد العدّة',   dz: '7ddad l3edda',   en: 'toolsmith',       fr: 'outilleur',   tags: ['smith'] },
  11: { key: 'butcher',   ar: 'جزّار',         dz: 'jezzar',         en: 'butcher',         fr: 'boucher',     tags: ['foodie', 'trader'] },
  12: { key: 'leatherworker', ar: 'دبّاغ',     dz: 'debbagh',        en: 'leatherworker',   fr: 'tanneur',     tags: ['trader'] },
  13: { key: 'mason',     ar: 'بنّاء',         dz: 'bennay',         en: 'mason',           fr: 'macon',       tags: ['humble', 'hard_worker'] },
  14: { key: 'nitwit',    ar: 'عاطل',          dz: '3a6el',          en: 'nitwit',          fr: 'faineant',    tags: ['joker', 'poor'] },
};

/** villager_v2 biome flavour (minecraft:mark_variant) */
export const BIOMES = {
  0: { key: 'plains',  ar: 'السهول',   dz: 'shouhoul', en: 'plains',  tags: [] },
  1: { key: 'desert',  ar: 'الصحرا',   dz: 's7ra',     en: 'desert',  tags: ['hot', 'brave'] },
  2: { key: 'jungle',  ar: 'الغابة',   dz: 'l8aba',    en: 'jungle',  tags: ['hot'] },
  3: { key: 'savanna', ar: 'السافانا', dz: 'savanna',  en: 'savanna', tags: ['hot'] },
  4: { key: 'snow',    ar: 'الثلج',    dz: 'telj',     en: 'snow',    tags: ['cold'] },
  5: { key: 'swamp',   ar: 'المستنقع', dz: 'moustan9a3', en: 'swamp', tags: ['mystic'] },
  6: { key: 'taiga',   ar: 'الغابة الباردة', dz: 'l8aba lbarda', en: 'taiga', tags: ['cold'] },
};

/* ------------------------------------------------------------------ *
 * Rosters
 * ------------------------------------------------------------------ */
export const MALE_NAMES = [
  { ar: 'عبد الله', dz: '3abd allah' }, { ar: 'محمد', dz: 'm7ammed' }, { ar: 'أحمد', dz: 'a7med' },
  { ar: 'يوسف', dz: 'youssef' }, { ar: 'حسن', dz: '7ssen' }, { ar: 'عمر', dz: '3omar' },
  { ar: 'رشيد', dz: 'rachid' }, { ar: 'كريم', dz: 'karim' }, { ar: 'سعيد', dz: 'sa3id' },
  { ar: 'مصطفى', dz: 'mostafa' }, { ar: 'عبد الرحمن', dz: '3abd rrahman' }, { ar: 'الجيلالي', dz: 'jilali' },
  { ar: 'مبارك', dz: 'mbarek' }, { ar: 'الطاهر', dz: 'taher' }, { ar: 'العربي', dz: 'larbi' },
  { ar: 'عبد القادر', dz: '3abd l9ader' }, { ar: 'حميد', dz: '7mid' }, { ar: 'نور الدين', dz: 'nour ddine' },
  { ar: 'زهير', dz: 'zouhir' }, { ar: 'ياسين', dz: 'yassine' }, { ar: 'المهدي', dz: 'mahdi' },
  { ar: 'إدريس', dz: 'driss' }, { ar: 'بوجمعة', dz: 'boujem3a' }, { ar: 'الحاج', dz: 'l7aj' },
  { ar: 'عزيز', dz: '3ziz' }, { ar: 'خالد', dz: 'khalid' }, { ar: 'سليم', dz: 'slim' },
  { ar: 'حمزة', dz: '7amza' }, { ar: 'أنس', dz: 'anas' }, { ar: 'عثمان', dz: '3othmane' },
];

export const FEMALE_NAMES = [
  { ar: 'فاطمة', dz: 'fa6ima' }, { ar: 'خديجة', dz: 'khadija' }, { ar: 'عائشة', dz: '3a2icha' },
  { ar: 'مريم', dz: 'mariam' }, { ar: 'زينب', dz: 'zinab' }, { ar: 'رقية', dz: 'ro9aya' },
  { ar: 'حليمة', dz: '7alima' }, { ar: 'الزهرة', dz: 'zzohra' }, { ar: 'السعدية', dz: 'sa3diya' },
  { ar: 'نعيمة', dz: 'na3ima' }, { ar: 'سعاد', dz: 'sou3ad' }, { ar: 'نجاة', dz: 'najat' },
  { ar: 'آمال', dz: 'amal' }, { ar: 'حياة', dz: '7ayat' }, { ar: 'سمية', dz: 'soumia' },
  { ar: 'لطيفة', dz: 'l6ifa' }, { ar: 'مليكة', dz: 'mlika' }, { ar: 'خدوج', dz: 'khedouj' },
  { ar: 'زليخة', dz: 'zoulikha' }, { ar: ' الحاجة', dz: 'l7aja' }, { ar: 'رحمة', dz: 'rahma' },
  { ar: 'بهيجة', dz: 'bhija' }, { ar: 'جميلة', dz: 'jmila' }, { ar: 'كريمة', dz: 'karima' },
];

export const TRAITS = [
  { ar: 'كريم', dz: 'karim', tags: ['generous'], emo: 'happy' },
  { ar: 'بخيل', dz: 'bakhil', tags: ['stingy'], emo: 'grumpy' },
  { ar: 'ضحّاك', dz: 'de77ak', tags: ['joker'], emo: 'laugh' },
  { ar: 'حكواتي', dz: '7ekkawati', tags: ['storyteller'], emo: 'mystic' },
  { ar: 'عاقل', dz: '3a9el', tags: ['wise', 'elder'], emo: 'warm' },
  { ar: 'خجول', dz: 'khajoul', tags: ['shy'], emo: 'shy' },
  { ar: 'عصبي', dz: '3asabi', tags: ['grumpy'], emo: 'grumpy' },
  { ar: 'شجاع', dz: 'chouja3', tags: ['brave'], emo: 'proud' },
  { ar: 'خوّاف', dz: 'khewwaf', tags: ['coward'], emo: 'fear' },
  { ar: 'متصوف', dz: 'mtasawwef', tags: ['mystic'], emo: 'mystic' },
  { ar: 'متواضع', dz: 'mtwade3', tags: ['humble'], emo: 'warm' },
  { ar: 'أب لأولاد', dz: 'bou l3yal', tags: ['parent'], emo: 'warm' },
  { ar: 'أم لأولاد', dz: 'omm l3yal', tags: ['parent', 'foodie'], emo: 'warm' },
  { ar: 'عاشق الماكلة', dz: '3achi9 lmakla', tags: ['foodie'], emo: 'happy' },
  { ar: 'صريح', dz: 'sri7', tags: ['honest_ai'], emo: 'mystic' },
  { ar: 'فقير', dz: 'f9ir', tags: ['poor', 'humble'], emo: 'sad' },
  { ar: 'نشيط', dz: 'nchit', tags: ['hard_worker'], emo: 'proud' },
  { ar: 'كسول', dz: 'ksoul', tags: ['lazy'], emo: 'tired' },
];

export const CATCHPHRASES = [
  { ar: 'الله يبارك', dz: 'llah ybarek' }, { ar: 'يا لطيف', dz: 'ya la6if' },
  { ar: 'واه واه', dz: 'wah wah' }, { ar: 'بالحق', dz: 'b7aq' },
  { ar: 'صافي', dz: 'safi' }, { ar: 'الله يعاون', dz: 'llah y3awen' },
  { ar: 'يا ربي', dz: 'ya rabbi' }, { ar: 'همم', dz: 'hmm' },
  { ar: 'الله يرحم الوالدين', dz: 'llah yer7am lwaldin' },
];

export const VOICES = {
  male_old:   { pitch: 0.85, speed: 0.9,  tone: 'deep',  murmur: 'old' },
  male:       { pitch: 1.0,  speed: 1.0,  tone: 'mid',   murmur: 'male' },
  male_young: { pitch: 1.15, speed: 1.08, tone: 'bright', murmur: 'male' },
  female:     { pitch: 1.25, speed: 1.02, tone: 'soft',  murmur: 'female' },
  female_old: { pitch: 1.05, speed: 0.92, tone: 'warm',  murmur: 'old' },
  kid:        { pitch: 1.45, speed: 1.15, tone: 'high',  murmur: 'kid' },
};

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ */
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const pickN = (r, arr, n) => {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
};

/* ------------------------------------------------------------------ *
 * Persona factory
 * ------------------------------------------------------------------ */

/**
 * @param {string} seed   stable id (entity id works great)
 * @param {object} opts   { profession?:number, biome?:number, nameTag?:string, age?:number, baby?:boolean }
 */
export function makePersona(seed, opts = {}) {
  const r = rng(seed + '|neurio');
  const baby = !!opts.baby;
  const gender = opts.gender || (r() < 0.55 ? 'm' : 'f');
  const nameTable = gender === 'm' ? MALE_NAMES : FEMALE_NAMES;

  let name = pick(r, nameTable);
  if (opts.nameTag && String(opts.nameTag).trim()) {
    const t = String(opts.nameTag).trim();
    name = { ar: t, dz: t };
  }

  const age = opts.age ?? (baby ? 6 + Math.floor(r() * 8) : 18 + Math.floor(r() * 60));
  const prof = PROFESSIONS[opts.profession ?? -1] || PROFESSIONS[Math.floor(r() * 15)] || PROFESSIONS[0];
  const biome = BIOMES[opts.biome ?? -1] || BIOMES[Math.floor(r() * 7)] || BIOMES[0];

  const traits = pickN(r, TRAITS, age > 55 ? 3 : 2);
  const tags = new Set([...prof.tags, ...biome.tags, ...traits.flatMap((t) => t.tags)]);
  if (age > 55) tags.add('elder');
  if (age < 16) tags.add('kid');
  if (prof.key !== 'nitwit' && prof.key !== 'none') tags.add('trader');
  if (gender === 'f' && age > 20 && r() < 0.6) tags.add('parent');
  if (gender === 'm' && age > 24 && r() < 0.5) tags.add('parent');

  let voice;
  if (baby) voice = VOICES.kid;
  else if (gender === 'm') voice = age > 55 ? VOICES.male_old : r() < 0.3 ? VOICES.male_young : VOICES.male;
  else voice = age > 55 ? VOICES.female_old : VOICES.female;
  // small personal variation so no two villagers sound identical
  voice = { ...voice, pitch: +(voice.pitch * (0.94 + r() * 0.12)).toFixed(3), speed: +(voice.speed * (0.95 + r() * 0.1)).toFixed(3) };

  return {
    seed: String(seed),
    name,
    gender,
    age,
    job: prof,
    biome,
    traits,
    tags: [...tags],
    catchphrase: pick(r, CATCHPHRASES),
    voice,
    /** mood baseline 0..1 (0 = grumpy, 1 = cheerful) */
    baseMood: +(0.35 + r() * 0.45).toFixed(2),
    /** how talkative: 0..1 */
    chatty: +(0.2 + r() * 0.8).toFixed(2),
    /** does this one admit to being a little program? */
    honest_ai: tags.has('honest_ai') || r() < 0.25,
    likes: pickN(r, ['القمح', 'الزمرد', 'الخبز', 'الورق', 'الماس', 'الزهور', 'الشاي'], 2),
    likesDz: pickN(r, ['l9m7', 'zomrod', 'khobz', 'wra9', 'almas', 'ward', 'atay'], 2),
    dislikes: pickN(r, ['الكريبر', 'الزومبي', 'الشتا', 'الضجيج', 'اللصوص'], 2),
    created: Date.now(),
  };
}

/** Short human readable label, e.g. "الحاج عبد الله — فلاح (كريم)". */
export function personaLabel(p, lang = 'ar') {
  const nm = lang === 'dz' ? p.name.dz : p.name.ar;
  const job = lang === 'dz' ? p.job.dz : p.job.ar;
  const tr = (p.traits[0] && (lang === 'dz' ? p.traits[0].dz : p.traits[0].ar)) || '';
  return lang === 'en'
    ? `${p.name.dz} — ${p.job.en}${tr ? ' (' + p.traits[0]?.en?.toLowerCase?.() + ')' : ''}`.replace(/\(undefined\)/, '')
    : `${nm} — ${job}${tr ? ' (' + tr + ')' : ''}`;
}
