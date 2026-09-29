// ── local profile: identity, cosmetics, progression, settings ───────────────
import { defaultAvatar, validateAvatar, COSM, CFG } from '../../shared/content.js';

const KEY = 'swindle_squad_profile_v1';

export function defaultProfile() {
  return {
    v: 1,
    name: randomName(),
    avatar: defaultAvatar(),
    bank: 0,                      // lifetime chips → spent on cosmetics
    owned: { hat: [0, 1, -1], glasses: [-1, 0, 1], acc: [-1], shirt: [0, 1], pants: [0], shoes: [0], hair: [-1, 0, 1], face: [0, 1, 2], skin: [0, 1, 2, 3, 4, 5], color: [0, 1, 2, 3, 4, 5, 6, 7] },
    lastCode: '',
    stats: { games: 0, wins: 0, scams: 0, catches: 0, wrong: 0, voided: 0, insured: 0, trusted: 0, bestRound: 0, chipsWon: 0 },
    history: [],                  // [{when, place, chips, name, players, scamTags}]
    unlockSeen: [],
    settings: { quality: 'high', music: true, sfx: true, shake: true, names: true, reduceFlash: false, fps: true, autoReady: false },
    lastRoom: { rounds: 6, minigames: true, turnMs: 55, submitMs: 30, briefMs: 14, tells: 1 },
    played: 0,
    tutorial: false,
  };
}

function randomName() {
  const A = ['Slick', 'Loud', 'Quiet', 'Tiny', 'Grand', 'Sneaky', 'Polite', 'Wet', 'Golden', 'Rusty', 'Velvet', 'Numb'];
  const B = ['Pickle', 'Marble', 'Goose', 'Ledger', 'Waffle', 'Baron', 'Sparrow', 'Tofu', 'Bishop', 'Noodle', 'Cobra', 'Plum'];
  return A[(Math.random() * A.length) | 0] + ' ' + B[(Math.random() * B.length) | 0];
}

let cache = null;
export function load() {
  if (cache) return cache;
  let p = defaultProfile();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      p = Object.assign(p, j);
      p.stats = Object.assign(defaultProfile().stats, j.stats || {});
      p.settings = Object.assign(defaultProfile().settings, j.settings || {});
      p.owned = Object.assign(defaultProfile().owned, j.owned || {});
      p.avatar = validateAvatar(Object.assign({}, defaultAvatar(), j.avatar || {}));
      p.history = Array.isArray(j.history) ? j.history.slice(0, 20) : [];
      p.v = 1;
    }
  } catch (e) { /* corrupt or private mode → fresh */ }
  cache = p;
  return p;
}
export function save() {
  if (!cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* quota / private mode */ }
}
export function patch(o) { Object.assign(cache, o); save(); return cache; }
export function setAvatar(a) { cache.avatar = validateAvatar(Object.assign({}, cache.avatar, a)); save(); return cache.avatar; }
export function setName(n) { cache.name = String(n || '').slice(0, 14) || randomName(); save(); return cache.name; }

export function ownedIds(slot) { return (cache.owned[slot] || []).slice(); }
export function isOwned(slot, id) { return (cache.owned[slot] || []).includes(id); }
export function priceOf(slot, id) {
  const c = (COSM[slot] || []).find((x) => x.id === id);
  return c && c.cost ? c.cost : 0;
}
export function buy(slot, id) {
  const price = priceOf(slot, id);
  if (isOwned(slot, id)) return { ok: true, free: true };
  if (cache.bank < price) return { ok: false, why: 'chips', need: price - cache.bank };
  cache.bank -= price;
  (cache.owned[slot] = cache.owned[slot] || []).push(id);
  save();
  return { ok: true, spent: price };
}
export function addBank(n) { cache.bank = Math.max(0, Math.round((cache.bank || 0) + n)); save(); return cache.bank; }

/** called by main.js when the room reports the final board */
export function recordGame({ place, chips, earned, players, scams, catches, wrong, voided }) {
  const s = cache.stats;
  s.games++;
  if (place === 1) s.wins++;
  s.scams += scams | 0; s.catches += catches | 0; s.wrong += wrong | 0;
  s.voided += voided | 0;
  s.chipsWon = Math.max(0, s.chipsWon + (chips - CFG.startChips));
  s.bestRound = Math.max(s.bestRound | 0, Math.max(0, chips - CFG.startChips));
  cache.history.unshift({ when: Date.now(), place, chips, players, earned: earned | 0 });
  cache.history = cache.history.slice(0, 16);
  addBank(earned | 0);
  save();
  return cache;
}

export function qualityPreset(q) {
  switch (q) {
    case 'low': return { dpr: 0.75, shadow: 0, bloom: false, parts: 0.35, lights: 3, seatLOD: true, postScale: 0.6 };
    case 'medium': return { dpr: 1, shadow: 1024, bloom: true, parts: 0.6, lights: 4, postScale: 0.75 };
    case 'high': return { dpr: Math.min(1.6, devicePixelRatio || 1), shadow: 2048, bloom: true, parts: 1, lights: 6, postScale: 1 };
    case 'ultra': default: return { dpr: Math.min(2, devicePixelRatio || 1), shadow: 2048, bloom: true, parts: 1.5, lights: 7, postScale: 1, soft: true };
  }
}
