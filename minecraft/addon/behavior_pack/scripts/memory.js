/**
 * memory.js — what each villager remembers (saved in the world, survives a restart)
 * ---------------------------------------------------------------------------------
 * One small JSON blob per villager, stored in an entity dynamic property:
 *   { s: seed, p: profession, b: biome, n: nameTag, g: gender, a: age,   <- how to rebuild the persona
 *     m: mood, r: {playerId: reputation}, k: {playerId: timesSeen},
 *     x: [lastLineIds], q: quest, f: following }
 */

import { KEYS } from './config.js';
import { makePersona } from './persona.js';
import { safe, isValid, villagerVariant, nameTagOf } from './compat.js';

const cache = new Map();
const CACHE_MAX = 400;

function rebuild(raw, entity) {
  const v = villagerVariant(entity);
  const opts = {
    profession: raw.p ?? v.profession,
    biome: raw.b ?? v.biome,
    nameTag: raw.n || nameTagOf(entity) || '',
    gender: raw.g,
    age: raw.a,
    baby: raw.baby,
  };
  const seed = raw.s || entity.id || 'villager';
  return makePersona(seed, opts);
}

/** Load (and cache) the full state of a villager. */
export function getState(entity) {
  if (!isValid(entity)) return null;
  const id = safe(() => entity.id, null);
  if (id && cache.has(id)) {
    const c = cache.get(id);
    if (isValid(c.entity)) return c.state;
    cache.delete(id);
  }
  let raw = {};
  const stored = safe(() => entity.getDynamicProperty(KEYS.persona), undefined);
  if (typeof stored === 'string' && stored.length) {
    try { raw = JSON.parse(stored); } catch (e) { raw = {}; }
  }
  const v = villagerVariant(entity);
  if (raw.s === undefined) raw.s = id || 'villager';
  if (raw.p === undefined) raw.p = v.profession;
  if (raw.b === undefined) raw.b = v.biome;
  if (raw.n === undefined) raw.n = nameTagOf(entity) || '';
  const state = {
    raw,
    persona: rebuild(raw, entity),
    mood: typeof raw.m === 'number' ? raw.m : undefined,
    rep: raw.r || {},
    seen: raw.k || {},
    recent: raw.x || [],
    quest: raw.q || null,
    following: raw.f || null,
    lastBark: 0,
  };
  if (state.mood === undefined) state.mood = state.persona.baseMood ?? 0.6;
  if (id) {
    if (cache.size > CACHE_MAX) cache.clear();
    cache.set(id, { entity, state });
  }
  return state;
}

/** Persist the state back onto the entity. */
export function saveState(entity, state) {
  if (!isValid(entity) || !state) return;
  state.raw.m = +Number(state.mood ?? 0.6).toFixed(2);
  state.raw.r = state.rep;
  state.raw.k = state.seen;
  state.raw.x = (state.recent || []).slice(-8);
  state.raw.q = state.quest || null;
  state.raw.f = state.following || null;
  state.raw.p = state.persona.job ? professionValue(state.persona.job.key) : state.raw.p;
  const json = JSON.stringify(state.raw);
  if (json.length > 30000) return; // Bedrock limit, never hit in practice
  safe(() => entity.setDynamicProperty(KEYS.persona, json));
}

const PROFESSION_VALUES = {
  none: 0, farmer: 1, fisherman: 2, shepherd: 3, fletcher: 4, librarian: 5, cartographer: 6,
  cleric: 7, armorer: 8, weaponsmith: 9, toolsmith: 10, butcher: 11, leatherworker: 12,
  mason: 13, nitwit: 14,
};
export function professionValue(key) {
  return PROFESSION_VALUES[key] ?? 0;
}

/* ---------------- per-player relations ---------------- */

export function repWith(state, player) {
  const pid = player.id || player.name;
  return state.rep[pid] || 0;
}

export function addRep(state, player, amount) {
  const pid = player.id || player.name;
  state.rep[pid] = Math.max(-10, Math.min(10, (state.rep[pid] || 0) + amount));
}

export function seenCount(state, player) {
  const pid = player.id || player.name;
  return state.seen[pid] || 0;
}

export function bumpSeen(state, player) {
  const pid = player.id || player.name;
  state.seen[pid] = (state.seen[pid] || 0) + 1;
  return state.seen[pid];
}

export function rememberLine(state, lineId) {
  if (!lineId) return;
  state.recent = state.recent || [];
  state.recent.push(lineId);
  while (state.recent.length > 8) state.recent.shift();
}

/** Remember a promise / quest. */
export function setQuest(state, quest) { state.quest = quest; }

/** Rename the villager (also updates the persona). */
export function rename(entity, state, name) {
  state.raw.n = String(name || '').slice(0, 32);
  safe(() => { entity.nameTag = state.raw.n; });
  state.persona = rebuild(state.raw, entity);
}

export function setPersonaChoice(entity, state, opts) {
  if (opts.gender) state.raw.g = opts.gender;
  if (opts.age) state.raw.a = opts.age;
  if (opts.profession !== undefined) state.raw.p = opts.profession;
  // a new seed = a brand new person
  if (opts.reroll) state.raw.s = `${entity.id}|${Date.now()}`;
  state.persona = rebuild(state.raw, entity);
  state.mood = state.persona.baseMood ?? 0.6;
}

export function forgetEntity(entity) {
  const id = safe(() => entity.id, null);
  if (id) cache.delete(id);
}

export function clearCache() { cache.clear(); }
