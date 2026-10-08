/**
 * actions.js — everything a villager can DO, not just say
 * (gifts, his own little shop, quests, following you, blessings, running away...)
 */

import { ItemStack, world } from '@minecraft/server';
import { safe, isValid, inventoryOf, healthOf } from './compat.js';
import { addRep } from './memory.js';

/* ------------------------------------------------------------------ *
 * Inventory helpers
 * ------------------------------------------------------------------ */
export function countItem(player, typeId) {
  const c = inventoryOf(player);
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) {
    const it = safe(() => c.getItem(i), undefined);
    if (it && it.typeId === typeId) n += it.amount;
  }
  return n;
}

export function takeItem(player, typeId, amount) {
  const c = inventoryOf(player);
  if (!c) return false;
  if (countItem(player, typeId) < amount) return false;
  let left = amount;
  for (let i = 0; i < c.size && left > 0; i++) {
    const it = safe(() => c.getItem(i), undefined);
    if (!it || it.typeId !== typeId) continue;
    const take = Math.min(left, it.amount);
    left -= take;
    if (take >= it.amount) safe(() => c.setItem(i, undefined));
    else { it.amount -= take; safe(() => c.setItem(i, it)); }
  }
  return left <= 0;
}

export function giveItem(player, typeId, amount = 1) {
  const c = inventoryOf(player);
  if (!c) return false;
  let left = amount;
  while (left > 0) {
    const stack = safe(() => new ItemStack(typeId, Math.min(left, 64)), undefined);
    if (!stack) return false;
    const rest = safe(() => c.addItem(stack), stack);
    if (!rest) { left = 0; break; }
    left -= (amount - left) >= 0 ? stack.amount - rest.amount : 0;
    if (rest === stack) { // no room at all
      safe(() => player.dimension.spawnItem(stack, player.location));
      return false;
    }
    break;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Shop — each profession has its own stock, prices react to reputation
 * ------------------------------------------------------------------ */
export const STOCK = {
  farmer:        [{ id: 'minecraft:bread', n: 3, buy: 2 }, { id: 'minecraft:wheat', n: 6, buy: 1 }, { id: 'minecraft:apple', n: 4, buy: 1 }, { id: 'minecraft:golden_carrot', n: 1, buy: 4 }, { id: 'minecraft:pumpkin', n: 1, buy: 3 }],
  fisherman:     [{ id: 'minecraft:cod', n: 6, buy: 2 }, { id: 'minecraft:cooked_cod', n: 4, buy: 2 }, { id: 'minecraft:fishing_rod', n: 1, buy: 7 }],
  shepherd:      [{ id: 'minecraft:white_wool', n: 8, buy: 2 }, { id: 'minecraft:shears', n: 1, buy: 4 }],
  fletcher:      [{ id: 'minecraft:arrow', n: 16, buy: 2 }, { id: 'minecraft:bow', n: 1, buy: 8 }, { id: 'minecraft:stick', n: 8, buy: 1 }],
  librarian:     [{ id: 'minecraft:paper', n: 12, buy: 2 }, { id: 'minecraft:book', n: 4, buy: 3 }, { id: 'minecraft:bookshelf', n: 1, buy: 6 }, { id: 'minecraft:experience_bottle', n: 2, buy: 5 }],
  cartographer:  [{ id: 'minecraft:map', n: 1, buy: 5 }, { id: 'minecraft:compass', n: 1, buy: 6 }, { id: 'minecraft:paper', n: 8, buy: 2 }],
  cleric:        [{ id: 'minecraft:ender_pearl', n: 1, buy: 6 }, { id: 'minecraft:redstone', n: 8, buy: 3 }, { id: 'minecraft:glowstone', n: 2, buy: 5 }, { id: 'minecraft:golden_apple', n: 1, buy: 9 }],
  armorer:       [{ id: 'minecraft:iron_ingot', n: 4, buy: 3 }, { id: 'minecraft:chainmail_helmet', n: 1, buy: 6 }, { id: 'minecraft:shield', n: 1, buy: 7 }],
  weaponsmith:   [{ id: 'minecraft:iron_sword', n: 1, buy: 8 }, { id: 'minecraft:diamond', n: 1, buy: 22 }, { id: 'minecraft:iron_axe', n: 1, buy: 7 }],
  toolsmith:     [{ id: 'minecraft:iron_pickaxe', n: 1, buy: 9 }, { id: 'minecraft:iron_shovel', n: 1, buy: 5 }, { id: 'minecraft:iron_hoe', n: 1, buy: 4 }, { id: 'minecraft:flint_and_steel', n: 1, buy: 4 }],
  butcher:       [{ id: 'minecraft:cooked_beef', n: 4, buy: 3 }, { id: 'minecraft:cooked_porkchop', n: 4, buy: 3 }, { id: 'minecraft:rabbit_stew', n: 1, buy: 4 }],
  leatherworker: [{ id: 'minecraft:leather', n: 6, buy: 3 }, { id: 'minecraft:leather_boots', n: 1, buy: 5 }, { id: 'minecraft:saddle', n: 1, buy: 9 }],
  mason:         [{ id: 'minecraft:brick', n: 8, buy: 2 }, { id: 'minecraft:stone_bricks', n: 16, buy: 2 }, { id: 'minecraft:quartz', n: 4, buy: 4 }],
  nitwit:        [{ id: 'minecraft:torch', n: 8, buy: 1 }, { id: 'minecraft:stick', n: 6, buy: 1 }],
  none:          [{ id: 'minecraft:torch', n: 6, buy: 1 }, { id: 'minecraft:bread', n: 2, buy: 2 }],
};

/** What he will happily buy from you (and what he pays). */
export const WANTED = {
  farmer: [{ id: 'minecraft:wheat', n: 6, sell: 1 }, { id: 'minecraft:carrot', n: 6, sell: 1 }],
  librarian: [{ id: 'minecraft:paper', n: 12, sell: 2 }, { id: 'minecraft:book', n: 4, sell: 2 }],
  butcher: [{ id: 'minecraft:porkchop', n: 6, sell: 2 }, { id: 'minecraft:beef', n: 6, sell: 2 }],
  fisherman: [{ id: 'minecraft:cod', n: 6, sell: 2 }],
  armorer: [{ id: 'minecraft:iron_ingot', n: 4, sell: 2 }],
  weaponsmith: [{ id: 'minecraft:coal', n: 8, sell: 2 }],
  toolsmith: [{ id: 'minecraft:iron_ingot', n: 4, sell: 2 }],
  mason: [{ id: 'minecraft:clay_ball', n: 8, sell: 2 }],
  shepherd: [{ id: 'minecraft:white_wool', n: 8, sell: 2 }],
  cleric: [{ id: 'minecraft:rotten_flesh', n: 16, sell: 1 }, { id: 'minecraft:gold_ingot', n: 2, sell: 3 }],
  cartographer: [{ id: 'minecraft:paper', n: 12, sell: 2 }],
  fletcher: [{ id: 'minecraft:string', n: 6, sell: 2 }],
  leatherworker: [{ id: 'minecraft:leather', n: 6, sell: 2 }],
  nitwit: [{ id: 'minecraft:dandelion', n: 4, sell: 1 }],
  none: [{ id: 'minecraft:wheat', n: 6, sell: 1 }],
};

export function priceFor(item, rep) {
  // friends get a discount, enemies pay more
  const f = rep >= 5 ? 0.7 : rep >= 2 ? 0.85 : rep <= -4 ? 1.6 : rep <= -1 ? 1.2 : 1;
  return Math.max(1, Math.round(item.buy * f));
}

export function sellPriceFor(item, rep) {
  const f = rep >= 5 ? 1.4 : rep >= 2 ? 1.2 : rep <= -4 ? 0.6 : 1;
  return Math.max(1, Math.round(item.sell * f));
}

export function stockFor(persona) {
  return STOCK[persona.job.key] || STOCK.none;
}

/* ------------------------------------------------------------------ *
 * Quests
 * ------------------------------------------------------------------ */
const QUEST_POOL = [
  { item: 'minecraft:wheat', n: 6, reward: 'minecraft:emerald', rn: 1 },
  { item: 'minecraft:oak_log', n: 12, reward: 'minecraft:emerald', rn: 2 },
  { item: 'minecraft:coal', n: 8, reward: 'minecraft:emerald', rn: 1 },
  { item: 'minecraft:iron_ingot', n: 3, reward: 'minecraft:emerald', rn: 4 },
  { item: 'minecraft:cod', n: 6, reward: 'minecraft:bread', rn: 4 },
  { item: 'minecraft:dandelion', n: 5, reward: 'minecraft:emerald', rn: 1 },
  { item: 'minecraft:rotten_flesh', n: 12, reward: 'minecraft:golden_carrot', rn: 2 },
  { item: 'minecraft:paper', n: 9, reward: 'minecraft:book', rn: 2 },
  { item: 'minecraft:leather', n: 5, reward: 'minecraft:emerald', rn: 3 },
  { item: 'minecraft:diamond', n: 1, reward: 'minecraft:emerald', rn: 12 },
];

const ITEM_NAMES = {
  dz: { 'minecraft:wheat': 'l9m7', 'minecraft:oak_log': 'lkhcheb', 'minecraft:coal': 'fa7m', 'minecraft:iron_ingot': '7did', 'minecraft:cod': '7out', 'minecraft:dandelion': 'ward sfer', 'minecraft:rotten_flesh': 'l7em mefesed', 'minecraft:paper': 'wra9', 'minecraft:leather': 'jled', 'minecraft:diamond': 'almas', 'minecraft:emerald': 'zomrod', 'minecraft:bread': 'khobz', 'minecraft:book': 'ktab', 'minecraft:golden_carrot': 'khizzou dyal dzheb' },
  ar: { 'minecraft:wheat': 'القمح', 'minecraft:oak_log': 'الخشب', 'minecraft:coal': 'الفحم', 'minecraft:iron_ingot': 'الحديد', 'minecraft:cod': 'الحوت', 'minecraft:dandelion': 'الزهر الأصفر', 'minecraft:rotten_flesh': 'اللحم المفسد', 'minecraft:paper': 'الورق', 'minecraft:leather': 'الجلد', 'minecraft:diamond': 'الماس', 'minecraft:emerald': 'الزمرد', 'minecraft:bread': 'الخبز', 'minecraft:book': 'الكتاب', 'minecraft:golden_carrot': 'الجزر الذهبي' },
  en: { 'minecraft:wheat': 'wheat', 'minecraft:oak_log': 'oak logs', 'minecraft:coal': 'coal', 'minecraft:iron_ingot': 'iron', 'minecraft:cod': 'cod', 'minecraft:dandelion': 'dandelions', 'minecraft:rotten_flesh': 'rotten flesh', 'minecraft:paper': 'paper', 'minecraft:leather': 'leather', 'minecraft:diamond': 'a diamond', 'minecraft:emerald': 'emeralds', 'minecraft:bread': 'bread', 'minecraft:book': 'a book', 'minecraft:golden_carrot': 'golden carrots' },
  fr: { 'minecraft:wheat': 'ble', 'minecraft:oak_log': 'bois', 'minecraft:coal': 'charbon', 'minecraft:iron_ingot': 'fer', 'minecraft:cod': 'poisson', 'minecraft:dandelion': 'pissenlits', 'minecraft:rotten_flesh': 'chair putrefiee', 'minecraft:paper': 'papier', 'minecraft:leather': 'cuir', 'minecraft:diamond': 'un diamant', 'minecraft:emerald': 'emeraudes', 'minecraft:bread': 'pain', 'minecraft:book': 'un livre', 'minecraft:golden_carrot': 'carottes dorees' },
};

export function itemName(id, lang) {
  return (ITEM_NAMES[lang] || ITEM_NAMES.dz)[id] || (ITEM_NAMES.dz[id] || id.replace('minecraft:', ''));
}

export function startQuest(state, lang) {
  const q = QUEST_POOL[Math.floor(Math.random() * QUEST_POOL.length)];
  state.quest = { ...q, at: Date.now(), lang };
  return q;
}

/** Returns the reward if the player delivered, otherwise null. */
export function completeQuest(player, state, lang) {
  const q = state.quest;
  if (!q) return null;
  if (countItem(player, q.item) < q.n) return null;
  takeItem(player, q.item, q.n);
  giveItem(player, q.reward, q.rn);
  state.quest = null;
  addRep(state, player, 3);
  return { item: itemName(q.item, lang), reward: `${q.rn}x ${itemName(q.reward, lang)}` };
}

/* ------------------------------------------------------------------ *
 * Physical reactions
 * ------------------------------------------------------------------ */

/** Blessing: a small regen + hearts. */
export function bless(player, entity) {
  safe(() => player.addEffect('regeneration', 200, { amplifier: 0, showParticles: true }));
  safe(() => player.addEffect('absorption', 400, { amplifier: 0, showParticles: false }));
  const l = player.location;
  for (let i = 0; i < 8; i++) {
    safe(() => player.dimension.spawnParticle('minecraft:heart_particle', { x: l.x + (Math.random() - 0.5), y: l.y + 1 + Math.random(), z: l.z + (Math.random() - 0.5) }));
  }
}

/** Panic: run away from the player. */
export function flee(entity, from) {
  safe(() => entity.addEffect('speed', 100, { amplifier: 1, showParticles: false }));
  const a = entity.location, b = from.location;
  const dx = a.x - b.x, dz = a.z - b.z;
  const len = Math.hypot(dx, dz) || 1;
  safe(() => entity.applyImpulse({ x: (dx / len) * 0.6, y: 0.25, z: (dz / len) * 0.6 }));
}

/** Call the village: every villager nearby gets angry too. */
export function alertVillage(entity, radius = 16) {
  const list = safe(() => entity.dimension.getEntities({ type: 'minecraft:villager_v2', location: entity.location, maxDistance: radius }), []);
  const list2 = safe(() => entity.dimension.getEntities({ type: 'minecraft:villager', location: entity.location, maxDistance: radius }), []);
  return [...list, ...list2].filter((e) => isValid(e) && e.id !== entity.id);
}

/** Show where something is: particles in a direction + a compass word. */
export function pointDirection(entity, target) {
  const a = entity.location;
  const b = target && target.location ? target.location : world.getDimension('overworld').getSpawnLocation
    ? safe(() => entity.dimension.getSpawnLocation(), a) : a;
  const dx = b.x - a.x, dz = b.z - a.z;
  const dirs = {
    dz: ['chamal', 'janoub', 'char9', 'gherb'], ar: ['الشمال', 'الجنوب', 'الشرق', 'الغرب'],
    en: ['north', 'south', 'east', 'west'], fr: ['nord', 'sud', 'est', 'ouest'],
  };
  let idx = 0;
  if (Math.abs(dx) > Math.abs(dz)) idx = dx < 0 ? 2 : 3; // -x = south in MC, +x = north-ish
  else idx = dz > 0 ? 1 : 0;
  const len = Math.hypot(dx, dz) || 1;
  for (let i = 1; i <= 6; i++) {
    const p = { x: a.x + (dx / len) * i * 1.5, y: a.y + 1.2 + Math.sin(i / 2) * 0.3, z: a.z + (dz / len) * i * 1.5 };
    safe(() => entity.dimension.spawnParticle('minecraft:villager_happy', p));
  }
  return { dirs, idx, distance: Math.round(len) };
}

/** Give the villager a temporary "follow me" order (main.js moves him). */
export function setFollowing(state, player) {
  const pid = player.id || player.name;
  state.following = state.following === pid ? null : pid;
  return state.following;
}

export function giftFromPlayer(player, entity, state, typeId, amount) {
  if (!takeItem(player, typeId, amount)) return null;
  const value = typeId === 'minecraft:diamond' ? 6 : typeId === 'minecraft:emerald' ? 4 : typeId === 'minecraft:iron_ingot' ? 3 : typeId === 'minecraft:golden_carrot' ? 3 : 2;
  addRep(state, player, Math.min(6, value));
  state.mood = Math.min(1, (state.mood ?? 0.6) + 0.12);
  const l = entity.location;
  for (let i = 0; i < 6; i++) {
    safe(() => entity.dimension.spawnParticle('minecraft:villager_happy', { x: l.x + (Math.random() - 0.5), y: l.y + 1.5 + Math.random() * 0.5, z: l.z + (Math.random() - 0.5) }));
  }
  return { value };
}

/** Angry reaction when a player hits a villager. */
export function reactToHit(entity, player, state, system) {
  addRep(state, player, -4);
  state.mood = Math.max(0, (state.mood ?? 0.6) - 0.35);
  flee(entity, player);
  const others = alertVillage(entity);
  for (const o of others.slice(0, 4)) {
    safe(() => o.dimension.playSound('mob.villager.hit', o.location, { volume: 0.8, pitch: 1 }));
  }
}

export function playerState(player) {
  const h = healthOf(player);
  return {
    hp: h.current,
    maxHp: h.effective,
    low: h.effective > 0 && h.current / h.effective <= 0.35,
    sneaking: safe(() => player.isSneaking, false),
    name: safe(() => player.name, 'player'),
  };
}
