/**
 * brain.js — the villager mind (pure JS: runs in Minecraft, in Node and in the browser companion app)
 * --------------------------------------------------------------------------------------------------
 * This is a small, fully offline conversational engine:
 *
 *   hear("salam khoya, chhal f l9m7?")
 *     -> normalise (Arabizi / Arabic / English / French)
 *     -> score every intent with keyword + fuzzy matching
 *     -> pick a line that fits the persona, the mood, the reputation and the situation
 *     -> fill in the facts it can see (your name, the weather, the time, what you carry...)
 *     -> optionally add a second sentence so it never sounds like a tape recorder
 *     -> hand back text + emotion + voice parameters + actions to run in the world
 *
 * No network, no API key, no experimental toggles. Everything lives in corpus.js.
 */

import { INTENTS, BARKS, LINES, OPENERS, FILLERS } from './corpus.js';
import { arToArabizi, normalizeAr, normalizeLatin, detectScript, tokenize, hasPhrase, similarity } from './arabizi.js';

/* ------------------------------------------------------------------ *
 * Emotions -> voice
 * ------------------------------------------------------------------ */
export const EMOTIONS = {
  warm:   { pitch: 1.0,  volume: 1.0,  speed: 1.0,  murmur: 'warm' },
  happy:  { pitch: 1.12, volume: 1.0,  speed: 1.06, murmur: 'happy' },
  laugh:  { pitch: 1.2,  volume: 1.05, speed: 1.12, murmur: 'laugh' },
  sad:    { pitch: 0.9,  volume: 0.9,  speed: 0.92, murmur: 'sad' },
  angry:  { pitch: 0.82, volume: 1.12, speed: 1.1,  murmur: 'angry' },
  fear:   { pitch: 1.28, volume: 1.08, speed: 1.18, murmur: 'fear' },
  shy:    { pitch: 1.08, volume: 0.85, speed: 0.95, murmur: 'shy' },
  proud:  { pitch: 1.05, volume: 1.05, speed: 1.0,  murmur: 'proud' },
  mystic: { pitch: 0.95, volume: 0.92, speed: 0.88, murmur: 'mystic' },
  tired:  { pitch: 0.88, volume: 0.85, speed: 0.9,  murmur: 'tired' },
  grumpy: { pitch: 0.85, volume: 1.0,  speed: 0.96, murmur: 'grumpy' },
};
export const emotionOf = (e) => EMOTIONS[e] || EMOTIONS.warm;

/* ------------------------------------------------------------------ *
 * Corpus preparation (once)
 * ------------------------------------------------------------------ */

/** All languages we can speak. */
export const LANGS = ['dz', 'ar', 'en', 'fr'];

let PREPARED = null;

function prepare() {
  if (PREPARED) return PREPARED;

  const lines = LINES.map((l, idx) => {
    const ar = String(l.ar || '').trim();
    const entry = {
      id: l.id || `L${idx}`,
      i: l.i,
      emo: l.emo || 'warm',
      tag: l.tag || [],
      act: l.act || null,
      w: l.w ?? 1,
      text: {
        ar,
        dz: l.dz || arToArabizi(ar),
        en: l.en || null,
        fr: l.fr || null,
      },
      tokens: {
        ar: tokenize(normalizeAr(ar)),
        dz: tokenize(normalizeLatin(l.dz || arToArabizi(ar))),
        en: l.en ? tokenize(normalizeLatin(l.en)) : [],
        fr: l.fr ? tokenize(normalizeLatin(l.fr)) : [],
      },
    };
    return entry;
  });

  const byIntent = {};
  for (const l of lines) (byIntent[l.i] ||= []).push(l);

  // intent keyword tables, normalised per language
  const intentKeys = {};
  for (const [id, def] of Object.entries(INTENTS)) {
    const ar = (def.ar || []).map((k) => normalizeAr(k));
    const dz = (def.dz || []).concat((def.ar || []).map(arToArabizi)).map((k) => normalizeLatin(k)).filter(Boolean);
    const en = (def.en || []).map((k) => normalizeLatin(k));
    const fr = (def.fr || []).map((k) => normalizeLatin(k));
    intentKeys[id] = { ar: uniq(ar), dz: uniq(dz), en: uniq(en), fr: uniq(fr), prio: def.prio || 1 };
  }

  PREPARED = { lines, byIntent, intentKeys };
  return PREPARED;
}

const uniq = (a) => [...new Set(a.filter(Boolean))];

/* ------------------------------------------------------------------ *
 * Intent classification
 * ------------------------------------------------------------------ */

/**
 * @returns {{id:string,score:number}[]} ranked intents
 */
export function classify(input) {
  const { intentKeys } = prepare();
  const raw = String(input || '').trim();
  if (!raw) return [];

  const script = detectScript(raw);
  const arN = normalizeAr(raw);
  const dzN = normalizeLatin(script === 'ar' ? arToArabizi(raw) : raw);
  const forms = {
    ar: arN,
    dz: dzN,
    latinRaw: normalizeLatin(raw),
    en: normalizeLatin(raw),
    fr: normalizeLatin(raw),
    // "3ellem ni darija" -> "3ellemnidarija" so the keyword "3ellemni" still hits
    arSquash: arN.replace(/\s+/g, ''),
    dzSquash: dzN.replace(/\s+/g, ''),
  };
  const tokens = tokenize(forms.dz).length ? tokenize(forms.dz) : tokenize(forms.ar);
  const scores = [];

  for (const [id, keys] of Object.entries(intentKeys)) {
    let score = 0;
    // Arabic keywords
    for (const k of keys.ar) {
      if (!k) continue;
      if (script === 'ar' && (forms.ar === k || forms.ar.includes(k))) score += 3;
      if (script === 'ar' && hasPhrase(tokenize(forms.ar), k)) score += 3;
    }
    // Arabizi keywords (also catches Arabic input, because we transliterate it above)
    for (const k of keys.dz) {
      if (!k) continue;
      const kt = tokenize(k);
      if (kt.length > 1) {
        if (forms.dz.includes(k)) score += 3.5;
        else if (forms.dzSquash.includes(k.replace(/\s+/g, ''))) score += 2.4;
      } else {
        if (hasPhrase(tokens, k, 0.8)) score += 2.2;
        else if (k.length > 4 && forms.dzSquash.includes(k)) score += 2.2;
        else if (k.length > 4 && tokens.some((t) => t.length > 4 && similarity(t, k) >= 0.76)) score += 1.2;
      }
    }
    // English / French
    if (script === 'latin') {
      for (const k of keys.en) {
        const kt = tokenize(k);
        if (kt.length > 1 ? forms.en.includes(k) : hasPhrase(tokenize(forms.en), k, 0.9)) score += 3;
      }
      for (const k of keys.fr) {
        const kt = tokenize(k);
        if (kt.length > 1 ? forms.fr.includes(k) : hasPhrase(tokenize(forms.fr), k, 0.9)) score += 2.6;
      }
    }
    if (score > 0) {
      score += keys.prio * 0.15;
      // short inputs get a bonus for exact matches ("salam", "la", "wah")
      if (tokens.length <= 2) score *= 1.25;
      scores.push({ id, score: +score.toFixed(2) });
    }
  }

  // a Minecraft topic word in the sentence pushes mc_help up
  const mcWords = ['almas', 'diamond', '7did', 'iron', 'nether', 'ender', 'creeper', 'zombie', 'skeleton', 'dragon', 'fa7m', 'coal', 'dheheb', 'gold', 'redstone', 'enchante', 'seif', 'sword', 'der3', 'armor', 'diamant', 'fer', 'الماس', 'الحديد', 'النيدر', 'كريبر', 'زومبي'];
  const lowText = normalizeLatin(raw) + ' ' + raw;
  if (mcWords.some((w) => lowText.includes(w))) {
    const hit = scores.find((s) => s.id === 'mc_help');
    if (hit) hit.score += 2.2; else scores.push({ id: 'mc_help', score: 2.2 });
  }

  // question marks push the "asking" intents a bit
  if (/\?|؟/.test(raw)) for (const s of scores) if (['how', 'name', 'price', 'where', 'time', 'ai', 'mc_help', 'whoami'].includes(s.id)) s.score += 0.5;

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

/** Guess which language the player is using (for 'auto' mode). */
export function detectLang(input) {
  const raw = String(input || '');
  if (/[\u0600-\u06FF]/.test(raw)) return 'ar';
  const t = normalizeLatin(raw);
  const frHits = ['bonjour', 'salut', 'merci', 'oui', 'non', 'combien', 'pourquoi', 'veux', 'manger', 'pluie', 'histoire', 'qui', 'es-tu', 'ca va'].filter((w) => t.includes(w)).length;
  const enHits = ['hello', 'thanks', 'yes', 'no', 'what', 'where', 'how', 'name', 'buy', 'help', 'story', 'who', 'you', 'the', 'and'].filter((w) => t.includes(w)).length;
  const dzHits = ['salam', 'wach', 'bghit', 'chnou', 'kif', '3lach', 'chhal', 'fin', 'khoya', 'mzyan', 'mezyan', 'safi', 'wakha', '3afak', 'labas', 'smh', 'sme7', '3andek', 'nta', '7ta'].filter((w) => t.includes(w)).length;
  const best = Math.max(frHits, enHits, dzHits);
  if (best === 0) return 'dz';
  if (best === dzHits) return 'dz';
  if (best === frHits) return 'fr';
  return 'en';
}

/* ------------------------------------------------------------------ *
 * Line selection
 * ------------------------------------------------------------------ */

/**
 * Tags come in two flavours:
 *  - SITUATION tags (night, rain, good_rep...) are a hard gate: a night line is never
 *    said at noon.
 *  - PERSONA tags (elder, trader, joker, farmer...) only change the odds, so a farmer
 *    can still tell you where the diamonds are, he is just less likely to.
 */
const SITUATION_TAGS = new Set([
  'morning', 'noon', 'evening', 'night', 'day', 'rain', 'thunder', 'cold', 'hot', 'clear',
  'knows_player', 'good_rep', 'bad_rep', 'player_sneak', 'hungry', 'gossip',
]);

function tagScore(line, ctx) {
  const tags = line.tag || [];
  if (!tags.length) return 0.55; // untagged lines always fit, they are just not preferred
  let hard = 0, hardHits = 0, soft = 0, softHits = 0;
  for (const t of tags) {
    if (SITUATION_TAGS.has(t)) { hard++; if (ctx.tags.has(t)) hardHits++; }
    else { soft++; if (ctx.tags.has(t)) softHits++; }
  }
  if (hard && hardHits === 0) return -1; // wrong moment -> never use it
  let s = 1 + hardHits * 0.8;
  if (soft) s *= softHits ? 1.55 : 0.62; // persona flavour
  return s;
}

function moodFit(line, mood) {
  const e = line.emo;
  const positive = ['happy', 'laugh', 'warm', 'proud'].includes(e);
  const negative = ['angry', 'sad', 'fear', 'tired', 'grumpy'].includes(e);
  if (positive) return 0.5 + mood * 0.9;
  if (negative) return 1.25 - mood * 0.9;
  return 1;
}

function pickLine(pool, ctx, mood, recent, lang) {
  // For English / French we strongly prefer lines that actually have that translation.
  let candidates = pool;
  if (!['dz', 'ar'].includes(lang)) {
    const translated = pool.filter((l) => l.text[lang]);
    if (translated.length) candidates = translated;
  }
  const scored = [];
  let total = 0;
  for (const line of candidates) {
    const ts = tagScore(line, ctx);
    if (ts < 0) continue;
    let w = line.w * (0.35 + ts) * moodFit(line, mood);
    // words the player actually used push the matching line up
    // ("lmas fin nl9ah" -> the diamond line, not the wheat line)
    if (ctx.inputTokens && ctx.inputTokens.length) {
      let overlap = 0;
      const t = line.tokens;
      const all = t.ar.concat(t.dz, t.en, t.fr);
      for (const w2 of ctx.inputTokens) {
        if (w2.length < 3) continue;
        if (all.some((x) => x === w2 || (x.length > 3 && similarity(x, w2) > 0.86))) overlap++;
      }
      if (overlap) w *= 1 + overlap * 5;
    }
    if (recent.includes(line.id)) w *= 0.06; // strong "don't repeat yourself"
    if (line.i === 'ai' && line.tag.includes('honest_ai') && !ctx.persona.honest_ai) w *= 0.15;
    w = Math.max(0.0001, w);
    scored.push({ line, w });
    total += w;
  }
  if (!scored.length) return candidates[0] || pool[0];
  let x = Math.random() * total;
  for (const s of scored) {
    x -= s.w;
    if (x <= 0) return s.line;
  }
  return scored[scored.length - 1].line;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const DIRS = {
  ar: ['قدامك', 'ورايا', 'على يمينك', 'على يسارك', 'تحت الأرض', 'فوق الجبل'],
  dz: ['9ddamek', 'wraya', '3la yminek', '3la yesrek', 'te7t lard', 'fou9 ljbel'],
  en: ['in front of you', 'behind me', 'on your right', 'on your left', 'underground', 'up the hill'],
  fr: ['devant toi', 'derriere moi', 'a ta droite', 'a ta gauche', 'sous terre', 'en haut de la colline'],
};

export function renderLine(line, lang, vars = {}) {
  let text = line.text[lang] || line.text.dz || line.text.ar;
  if (!text) return '';
  const r = vars.rng || Math.random;
  const dir = DIRS[lang] ? DIRS[lang][Math.floor(r() * DIRS[lang].length)] : DIRS.dz[0];
  const map = Object.assign(
    {
      name: v(vars, 'name', lang),
      job: v(vars, 'job', lang),
      player: vars.playerName || (lang === 'en' ? 'friend' : lang === 'fr' ? 'ami' : 'صاحبي'),
      trait: v(vars, 'trait', lang),
      age: vars.age ?? 30,
      times: vars.times ?? 1,
      dir,
      item: v(vars, 'item', lang),
      reward: v(vars, 'reward', lang),
      price: vars.price ?? 5,
      other: vars.otherName ? v(vars.otherName, '', lang) : (lang === 'en' ? 'the neighbour' : 'الجار'),
      biome: v(vars, 'biome', lang),
    },
    vars.extra || {},
  );
  return text.replace(/\{(\w+)\}/g, (m, k) => (map[k] === undefined || map[k] === null ? m : String(map[k])));
}

function v(obj, key, lang) {
  if (!obj) return '';
  const o = obj[key === 'name' ? 'name' : key];
  if (!o) return '';
  if (typeof o === 'string') return o;
  return o[lang] || o.dz || o.ar || o.en || '';
}

/** Split a long answer into chat-sized pieces. */
export function splitText(text, max = 200) {
  const s = String(text || '');
  if (s.length <= max) return [s];
  const parts = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if ((cur + ' ' + word).trim().length > max) {
      if (cur) parts.push(cur.trim());
      cur = word;
    } else cur = (cur ? cur + ' ' : '') + word;
  }
  if (cur) parts.push(cur.trim());
  return parts;
}

/* ------------------------------------------------------------------ *
 * The brain
 * ------------------------------------------------------------------ */

/**
 * @param {object} persona  from persona.js
 * @param {object} state    { mood, rep, times, recent:[ids], topics:[] }
 */
export function createBrain(persona, state = {}) {
  const { byIntent, intentKeys } = prepare();
  const st = Object.assign({ mood: persona.baseMood ?? 0.6, rep: 0, times: 0, recent: [], topics: [] }, state);

  function contextTags(ctx = {}) {
    ctx.persona = persona;
    const tags = new Set(persona.tags || []);
    for (const t of ctx.tags || []) tags.add(t);
    if ((ctx.rep ?? st.rep) >= 4) tags.add('good_rep');
    if ((ctx.rep ?? st.rep) <= -3) tags.add('bad_rep');
    if ((ctx.times ?? st.times) >= 2) tags.add('knows_player');
    if (ctx.playerSneaking) tags.add('player_sneak');
    if (ctx.timeOfDay) tags.add(ctx.timeOfDay);
    if (ctx.weather && ctx.weather !== 'clear') tags.add(ctx.weather);
    if (ctx.weather === 'clear') tags.add('clear');
    if (ctx.temp) tags.add(ctx.temp);
    return tags;
  }

  function chooseLang(input, forced) {
    if (forced && forced !== 'auto') return forced;
    const l = detectLang(input);
    // Arabic script players get Arabic; Latin players get Arabizi (renders everywhere)
    if (l === 'ar') return 'ar';
    return l;
  }

  function speak(text, line, ctx = {}) {
    const emo = emotionOf(line ? line.emo : 'warm');
    const voice = persona.voice || { pitch: 1, speed: 1, tone: 'mid', murmur: 'male' };
    const pitch = +(emo.pitch * (voice.pitch ?? 1)).toFixed(3);
    const volume = +(emo.volume * (ctx.volume ?? 1)).toFixed(3);
    return {
      text,
      parts: splitText(text, ctx.maxLineChars || 200),
      emotion: line ? line.emo : 'warm',
      intent: line ? line.i : 'unknown',
      lineId: line ? line.id : null,
      acts: line && line.act ? line.act.split(',').map((a) => a.trim()) : [],
      voice: {
        pitch: Math.max(0.5, Math.min(2, pitch)),
        volume: Math.max(0.1, Math.min(2, volume)),
        speed: (emo.speed * (voice.speed ?? 1)).toFixed(2) * 1,
        murmur: voice.murmur || 'male',
        tone: voice.tone || 'mid',
        family: emo.murmur,
      },
      lang: ctx.lang || 'dz',
    };
  }

  function remember(line) {
    if (!line) return;
    st.recent = st.recent || [];
    st.recent.push(line.id);
    if (st.recent.length > (ctxNoRepeat.value || 8)) st.recent.shift();
    if (!st.topics.includes(line.i)) {
      st.topics.push(line.i);
      if (st.topics.length > 12) st.topics.shift();
    }
  }
  const ctxNoRepeat = { value: 8 };

  /**
   * Main entry: the player said something.
   * @param {string} input
   * @param {object} ctx  { playerName, tags:[], timeOfDay, weather, rep, times, item, price, otherName, volume, lang }
   */
  function hear(input, ctx = {}) {
    const lang = chooseLang(input, ctx.lang || 'auto');
    ctx.lang = lang;
    ctx.tags = contextTags(ctx);
    ctx.rep = ctx.rep ?? st.rep;
    ctx.times = ctx.times ?? st.times;
    ctx.rng = ctx.rng || Math.random;
    const vars = buildVars(persona, ctx, lang);

    ctx.inputTokens = tokenize(normalizeAr(input)).concat(tokenize(normalizeLatin(input)));
    const ranked = classify(input);
    const best = ranked[0];

    // 1) understood something -> answer it
    if (best && best.score >= 1.6) {
      const pool = byIntent[best.id] || [];
      let line = pool.length ? pickLine(pool, ctx, st.mood, st.recent, lang) : null;
      if (!line) line = pickLine(byIntent.unknown || [], ctx, st.mood, st.recent, lang);

      let text = renderLine(line, lang, vars);

      // 25% chance to add a second, situation-aware sentence
      if (ctx.rng() < 0.24 && text.length < 120) {
        const extra = contextFact(ctx, lang, vars, st.recent, line.i);
        if (extra) text = `${text} ${extra}`;
      }
      // second intent (e.g. "salam, chhal f l9m7?")
      const second = ranked[1];
      if (second && second.score >= 3.2 && second.id !== best.id && ctx.rng() < 0.35) {
        const pool2 = byIntent[second.id] || [];
        if (pool2.length) {
          const l2 = pickLine(pool2, ctx, st.mood, st.recent.concat(line.id), lang);
          text = `${text} ${renderLine(l2, lang, vars)}`;
        }
      }

      remember(line);
      const out = speak(text, line, ctx);
      out.ranked = ranked.slice(0, 3);
      out.score = best.score;
      return out;
    }

    // 2) not understood -> try to answer with something related to what they typed
    const fuzzy = fuzzyAnswer(input, ctx, lang, vars, st.recent);
    if (fuzzy) return fuzzy;

    // 3) nothing -> honest fallback
    const line = pickLine(byIntent.unknown || [], ctx, st.mood, st.recent, lang);
    const text = withOpener(renderLine(line, lang, vars), lang, ctx, persona);
    remember(line);
    const out = speak(text, line, ctx);
    out.ranked = ranked.slice(0, 3);
    out.score = 0;
    return out;
  }

  /** Villager starts the conversation on its own. */
  function bark(kind, ctx = {}) {
    const lang = ctx.lang && ctx.lang !== 'auto' ? ctx.lang : 'dz';
    ctx.lang = lang;
    ctx.tags = contextTags(ctx);
    ctx.rng = ctx.rng || Math.random;
    const vars = buildVars(persona, ctx, lang);
    const pool = (byIntent[kind] || []).filter((l) => tagScore(l, ctx) >= 0);
    const line = pool.length ? pickLine(pool, ctx, st.mood, st.recent, lang) : null;
    if (!line) return null;
    remember(line);
    return speak(renderLine(line, lang, vars), line, ctx);
  }

  /** Free-form "say this specific sentence" (used by the bridge / LLM mode). */
  function say(text, emotion = 'warm', ctx = {}) {
    ctx.persona = persona;
    const lang = ctx.lang && ctx.lang !== 'auto' ? ctx.lang : detectLang(text);
    const fake = { id: 'say', i: 'say', emo: emotion, tag: [], act: null, text: { [lang]: text } };
    return speak(text, fake, { ...ctx, lang });
  }

  return {
    hear,
    bark,
    say,
    classify: (t) => classify(t),
    get state() { return st; },
    get persona() { return persona; },
    setMood(m) { st.mood = Math.max(0, Math.min(1, m)); },
    setRep(r) { st.rep = Math.max(-10, Math.min(10, r)); },
    bumpTimes() { st.times = (st.times || 0) + 1; },
  };
}

/* ------------------------------------------------------------------ *
 * helpers used above
 * ------------------------------------------------------------------ */

function buildVars(persona, ctx, lang) {
  const q = QUEST_ITEMS[lang] || QUEST_ITEMS.dz;
  const r = ctx.rng || Math.random;
  const item = q[Math.floor(r() * q.length)];
  const reward = REWARDS[lang] || REWARDS.dz;
  return {
    name: persona.name,
    job: persona.job,
    trait: (persona.traits[0] && { ar: persona.traits[0].ar, dz: persona.traits[0].dz, en: '', fr: '' }) || { ar: '', dz: '' },
    age: persona.age,
    biome: persona.biome,
    times: ctx.times ?? 1,
    playerName: ctx.playerName,
    item: ctx.questItem || item,
    reward: ctx.questReward || reward[Math.floor(r() * reward.length)],
    price: ctx.price ?? 3 + Math.floor(r() * 12),
    otherName: ctx.otherName ? { ar: ctx.otherName, dz: ctx.otherName } : null,
    extra: ctx.vars || {},
    rng: r,
  };
}

const QUEST_ITEMS = {
  ar: ['٥ قمح', '٣ خبز', '٨ خشب', '٢ حديد', '١ ماسة', '٥ زهور', '٣ أسماك'],
  dz: ['5 l9m7', '3 khobz', '8 khcheb', '2 7did', '1 almas', '5 ward', '3 7out'],
  en: ['5 wheat', '3 bread', '8 logs', '2 iron', '1 diamond', '5 flowers', '3 fish'],
  fr: ['5 ble', '3 pains', '8 bois', '2 fers', '1 diamant', '5 fleurs', '3 poissons'],
};

const REWARDS = {
  ar: ['زمردة', 'زمردتين', 'خبز طازج', 'بركة', 'حكاية قديمة'],
  dz: ['zomroda', 'jouj zomrod', 'khobz skhoun', 'baraka', '7kaya 9dima'],
  en: ['an emerald', 'two emeralds', 'fresh bread', 'a blessing', 'an old story'],
  fr: ['une emeraude', 'deux emeraudes', 'du pain frais', 'une benediction', 'une vieille histoire'],
};

function withOpener(text, lang, ctx, persona) {
  const r = ctx.rng || Math.random;
  if (r() < 0.3) {
    const cp = persona.catchphrase ? persona.catchphrase[lang] || persona.catchphrase.dz : '';
    if (cp) return `${cp}... ${text}`;
  }
  if (r() < 0.22) {
    const o = (OPENERS[lang] || OPENERS.dz)[Math.floor(r() * (OPENERS[lang] || OPENERS.dz).length)];
    return `${o} ${text}`;
  }
  return text;
}

/** Situation-aware extra sentence. */
function contextFact(ctx, lang, vars, recent, skipIntent) {
  const { byIntent } = prepare();
  const pools = [];
  const tags = ctx.tags;
  const order = [
    ['night', ['night']], ['rain', ['rain']], ['thunder', ['thunder']], ['morning', ['morning']],
    ['evening', ['evening']], ['hot', ['hot']], ['cold', ['cold']], ['zombie_near', ['zombie_near']],
    ['good_rep', ['good_rep']], ['bad_rep', ['bad_rep']], ['player_diamond', ['player_diamond']],
    ['proverb', ['proverb']], ['gossip', ['gossip']], ['idle', ['idle']],
  ];
  for (const [tag, kinds] of order) {
    if (!tags.has(tag)) continue;
    for (const k of kinds) if (byIntent[k]) pools.push(...byIntent[k]);
  }
  const usable = pools.filter((l) => tagScore(l, ctx) >= 0 && !recent.includes(l.id) && l.i !== skipIntent);
  if (!usable.length) return '';
  const line = pickLine(usable, ctx, 0.6, recent, lang);
  return renderLine(line, lang, vars);
}

/** Last resort: overlap with any known line (so a weird question still gets a themed answer). */
function fuzzyAnswer(input, ctx, lang, vars, recent) {
  const { lines } = prepare();
  const toks = tokenize(normalizeLatin(input));
  if (toks.length < 2) return null;
  let best = null;
  let bestScore = 0;
  for (const l of lines) {
    if (recent.includes(l.id)) continue;
    const t = l.tokens.dz.length ? l.tokens.dz : l.tokens.ar;
    let s = 0;
    for (const w of toks) if (t.some((x) => x === w || (w.length > 3 && similarity(w, x) > 0.85))) s += 1;
    if (s > bestScore) { bestScore = s; best = l; }
  }
  if (!best || bestScore < 2) return null;
  if (tagScore(best, ctx) < 0) return null;
  const out = {
    ...speak(renderLine(best, lang, vars), best, ctx),
    ranked: [{ id: best.i, score: bestScore }],
    score: bestScore,
    fuzzy: true,
  };
  return out;
}

/** Exported so the bridge/companion can list what the brain knows. */
export function corpusStats() {
  const { lines, byIntent, intentKeys } = prepare();
  return {
    lines: lines.length,
    intents: Object.keys(intentKeys).length,
    barks: Object.keys(BARKS).length,
    byIntent: Object.fromEntries(Object.entries(byIntent).map(([k, v]) => [k, v.length])),
  };
}
