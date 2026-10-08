/**
 * ╔══════════════════════════════════════════════════════════════════╗
 *   Neurio AI Villagers — main.js
 *   القرويون كيهضرو بالدارجة، كيجاوبو، وكيصوتو — بلا أنترنت
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * How to talk to them:
 *   • Sneak + Use on a villager  -> the conversation screen
 *   • Use the ⌬ Talking Amulet on a villager -> name him / pick his personality
 *   • /scriptevent neurio:say salam khoya      -> talk to the closest one
 *   • /scriptevent neurio:all  salam           -> everybody around answers
 *   • /scriptevent neurio:menu | help | settings
 *
 * Voice: Android/iOS -> tap the mic on the keyboard inside the text box.
 *        Windows     -> Win + H inside the text box (dictation).
 *        Or run the companion app (minecraft/bridge) for full hands-free voice.
 */

import { world, system } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { DEFAULTS, IDS, KEYS, BRAND, NS } from './config.js';
import { createBrain, detectLang, corpusStats } from './brain.js';
import { makePersona } from './persona.js';
import { getState, saveState, addRep, bumpSeen, seenCount, repWith, rename, forgetEntity } from './memory.js';
import { speak, voiceInfo, resetSpeaking, hesitate } from './voice.js';
import { t } from './i18n.js';
import { safe, isValid, dist2 } from './compat.js';
import { openMenu, openSettings, openAmulet, nameFor, jobFor } from './forms.js';
import { reactToHit, playerState, setFollowing, bless, flee, pointDirection, giveItem, countItem, itemName } from './actions.js';

/* ------------------------------------------------------------------ *
 * Settings (saved in the world)
 * ------------------------------------------------------------------ */
const settings = loadSettings();
const playerLang = new Map();     // playerId -> last language they used
const lastBark = new Map();       // entityId -> tick of the last spontaneous line
const followers = new Map();      // entityId -> { entity, playerId }
const pending = [];               // actions queued from read-only events
let weather = 'clear';

function loadSettings() {
  const raw = safe(() => world.getDynamicProperty(KEYS.settings), undefined);
  if (typeof raw === 'string' && raw.length) {
    try { return Object.assign({}, DEFAULTS, JSON.parse(raw)); } catch (e) { /* fall through */ }
  }
  return Object.assign({}, DEFAULTS);
}
function saveSettings() {
  safe(() => world.setDynamicProperty(KEYS.settings, JSON.stringify(settings)));
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */
function langOf(player) {
  if (settings.lang && settings.lang !== 'auto') return settings.lang;
  return playerLang.get(player.id) || 'dz';
}
function noteLang(player, text) {
  if (settings.lang !== 'auto') return;
  const l = detectLang(text);
  playerLang.set(player.id, l === 'latin' ? 'dz' : l);
}

function timeOfDay() {
  const t2 = safe(() => world.getDimension('overworld').getTimeOfDay(), 6000) % 24000;
  if (t2 < 1000 || t2 >= 23000) return 'morning';
  if (t2 < 5000) return 'morning';
  if (t2 < 8000) return 'noon';
  if (t2 < 12000) return 'day';
  if (t2 < 13500) return 'evening';
  return 'night';
}

function biomeTag(entity) {
  const id = safe(() => entity.dimension.getBiome(entity.location).id, '') || '';
  if (/desert|savanna|badlands|mesa/.test(id)) return 'hot';
  if (/snow|ice|taiga|frozen|cold/.test(id)) return 'cold';
  return '';
}

function hostileNear(entity, radius = 14) {
  const list = safe(() => entity.dimension.getEntities({
    types: ['minecraft:zombie', 'minecraft:husk', 'minecraft:drowned', 'minecraft:pillager', 'minecraft:vindicator', 'minecraft:zombie_villager_v2'],
    location: entity.location, maxDistance: radius,
  }), []);
  return list.length;
}

function villagersNear(location, dimension, radius) {
  const out = [];
  for (const type of IDS.villagers) {
    const list = safe(() => dimension.getEntities({ type, location, maxDistance: radius }), []);
    for (const e of list) if (isValid(e)) out.push(e);
  }
  return out;
}

function nearestVillager(player, radius) {
  const list = villagersNear(player.location, player.dimension, radius);
  let best = null, bd = Infinity;
  for (const e of list) {
    const d = dist2(e.location, player.location);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Build the situational context the brain uses. */
function contextFor(entity, state, player, extraTags = []) {
  const ps = player ? playerState(player) : { hp: 20, maxHp: 20, low: false, sneaking: false, name: 'player' };
  const tod = timeOfDay();
  const tags = [tod];
  if (weather === 'rain') tags.push('rain');
  if (weather === 'thunder') tags.push('thunder', 'rain');
  if (weather === 'clear') tags.push('clear');
  const bt = biomeTag(entity);
  if (bt) tags.push(bt);
  if (ps.low) tags.push('player_low_hp');
  if (ps.sneaking) tags.push('player_sneak');
  if (hostileNear(entity) > 0) tags.push('zombie_near', 'danger');
  if (player) {
    if (countItem(player, 'minecraft:diamond') > 0) tags.push('player_diamond');
    if (countItem(player, 'minecraft:emerald') > 0) tags.push('player_emerald');
  }
  for (const x of extraTags) tags.push(x);

  // who else lives here (used for gossip)
  const others = villagersNear(entity.location, entity.dimension, 24).filter((e) => e.id !== entity.id);
  let otherName = '';
  if (others.length) {
    const o = others[Math.floor(Math.random() * others.length)];
    const os = getState(o);
    if (os) otherName = nameFor(os.persona, 'dz');
  }

  return {
    playerName: ps.name,
    tags,
    timeOfDay: tod,
    weather,
    temp: bt,
    rep: player ? repWith(state, player) : 0,
    times: player ? seenCount(state, player) : 0,
    otherName,
    lang: player ? langOf(player) : settings.lang === 'auto' ? 'dz' : settings.lang,
    volume: 1,
    maxLineChars: settings.maxLineChars || 200,
  };
}

/* ------------------------------------------------------------------ *
 * Brains
 * ------------------------------------------------------------------ */
const brains = new Map();
function brainFor(entity, state) {
  const id = safe(() => entity.id, null);
  let b = id ? brains.get(id) : null;
  if (b && b.persona === state.persona) {
    // keep the persistent parts in sync
    b.state.mood = state.mood;
    b.state.recent = state.recent;
    return b;
  }
  b = createBrain(state.persona, {
    mood: state.mood,
    rep: 0,
    times: 0,
    recent: state.recent || [],
    topics: [],
  });
  if (id) {
    if (brains.size > 300) brains.clear();
    brains.set(id, b);
  }
  return b;
}

/** Answer something the player said. */
function respond(entity, state, player, text) {
  noteLang(player, text);
  const ctx = contextFor(entity, state, player);
  const brain = brainFor(entity, state);
  const times = bumpSeen(state, player);
  ctx.times = times;
  const reply = brain.hear(text, ctx);
  state.mood = brain.state.mood;
  state.recent = brain.state.recent;
  // reputation drifts with the tone of the conversation
  for (const a of reply.acts || []) {
    if (a === 'rep:up') addRep(state, player, 1);
    if (a === 'rep:down') addRep(state, player, -2);
  }
  reply.lang = ctx.lang;
  saveState(entity, state);
  return reply;
}

/** Villager-initiated line. */
function respondBark(entity, state, player, kind, extraTags = []) {
  const ctx = contextFor(entity, state, player, extraTags);
  const brain = brainFor(entity, state);
  return brain.bark(kind, ctx);
}

/* ------------------------------------------------------------------ *
 * Delivery: voice + text + bubble
 * ------------------------------------------------------------------ */
function deliver(entity, state, player, reply, opts = {}) {
  if (!reply || !reply.text) return;
  const lang = reply.lang || langOf(player);
  const who = nameFor(state.persona, lang);

  // 1) the voice
  if (settings.voice) speak(system, entity, reply, settings);

  // 2) the text
  const chat = opts.chat !== false;
  const line = `§l§e${who}§r §8» §f${reply.text}`;
  const channel = opts.channel || settings.textChannel || 'chat';
  if (channel === 'chat' || channel === 'all') { if (chat) safe(() => player.sendMessage(line)); }
  if (channel === 'actionbar' || channel === 'all') {
    safe(() => player.onScreenDisplay.setActionBar(`§e${who}§r §8» §f${reply.text.slice(0, 90)}`));
  }
  if (channel === 'title') {
    if (reply.text.length <= 70) safe(() => player.onScreenDisplay.setTitle(`§e${who}`, { subtitle: `§f${reply.text}`, stayDuration: 60, fadeInDuration: 5, fadeOutDuration: 10 }));
    else if (chat) safe(() => player.sendMessage(line));
  }

  // 3) optional floating bubble
  if (settings.bubbles && reply.text.length <= 42) {
    safe(() => { entity.nameTag = `§e${who}§r\n§f${reply.text}`; });
    safe(() => system.runTimeout(() => { if (isValid(entity)) safe(() => { entity.nameTag = who; }); }, 80));
  }

  // 4) actions
  for (const a of reply.acts || []) runAction(a, entity, state, player, reply);
}

function runAction(act, entity, state, player, reply) {
  if (!act) return;
  const [kind, arg] = String(act).split(':');
  switch (kind) {
    case 'gift': {
      if (!settings.gifts || !player) return;
      const item = arg === 'bread' ? 'minecraft:bread' : 'minecraft:emerald';
      giveItem(player, item, arg === 'bread' ? 2 : 1);
      safe(() => player.sendMessage(`§8[§6${nameFor(state.persona, 'dz')}§8] §a+ ${itemName(item, langOf(player))}`));
      break;
    }
    case 'bless': if (player) bless(player, entity); break;
    case 'flee': if (player) flee(entity, player); break;
    case 'guard': {
      safe(() => entity.dimension.playSound('mob.irongolem.hit', entity.location, { volume: 0.7, pitch: 1 }));
      break;
    }
    case 'point': {
      if (!player) return;
      const target = nearestOther(entity) || { location: player.location };
      const d = pointDirection(entity, target);
      safe(() => player.sendMessage(`§8➤ ${d.dirs[langOf(player)][d.idx]} §7(${d.distance}m)`));
      break;
    }
    case 'trade':
      if (player) safe(() => player.sendMessage(`§8[tip] §7${langOf(player) === 'ar' ? 'استعمل عليه بلا sneaking باش تحل التجارة العادية، ولا اختار "السوق ديالو" فهاد المينو.' : 'use on him without sneaking for vanilla trades, or pick "His shop" in this menu.'}`));
      break;
    case 'quest': break; // handled by the Quest button
    default: break;
  }
}

function nearestOther(entity) {
  const others = villagersNear(entity.location, entity.dimension, 30).filter((e) => e.id !== entity.id);
  return others.length ? others[0] : null;
}

/* ------------------------------------------------------------------ *
 * Interaction
 * ------------------------------------------------------------------ */
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const target = ev.target;
  if (!target || !IDS.villagers.includes(safe(() => target.typeId, ''))) return;
  const player = ev.player;
  const held = ev.itemStack ? safe(() => ev.itemStack.typeId, '') : '';
  const sneaking = safe(() => player.isSneaking, false);
  const amulet = held === IDS.amulet;

  if (amulet || (sneaking && settings.sneakToTalk)) {
    ev.cancel = true; // don't open the vanilla trade screen
    pending.push(() => {
      const state = getState(target);
      if (!state) return;
      const ctx = formCtx(player);
      if (amulet) openAmulet(player, target, state, ctx);
      else openMenu(player, target, state, ctx);
    });
    return;
  }
  // normal interaction -> vanilla trades open, but he still says hello
  pending.push(() => {
    const state = getState(target);
    if (!state) return;
    const now = system.currentTick;
    if (now - (lastBark.get(target.id) || -9999) < settings.barkEverySeconds * 20) return;
    lastBark.set(target.id, now);
    const kind = seenCount(state, player) === 0 ? 'first_meet' : (Math.random() < 0.4 ? 'player_trade' : 'greet');
    const reply = respondBark(target, state, player, kind);
    if (reply) deliver(target, state, player, reply, { channel: settings.textChannel === 'chat' ? 'actionbar' : settings.textChannel });
  });
});

/** Everything that must happen OUTSIDE a read-only event. */
system.runInterval(() => {
  while (pending.length) {
    const fn = pending.shift();
    try {
      fn();
    } catch (e) {
      // never let one bad callback kill the pack
      safe(() => console.error('[neurio] action error:', e && e.message ? e.message : e));
    }
  }
}, 1);

function formCtx(player) {
  return {
    settings,
    langOf,
    respond: (entity, state, pl, text) => respond(entity, state, pl, text),
    respondBark: (entity, state, pl, kind) => respondBark(entity, state, pl, kind),
    deliver,
    greet: (entity, state, pl) => {
      const kind = seenCount(state, pl) <= 1 ? 'first_meet' : (repWith(state, pl) >= 4 ? 'good_rep' : repWith(state, pl) <= -3 ? 'bad_rep' : 'player_returns');
      const r = respondBark(entity, state, pl, kind);
      if (r) { r.lang = langOf(pl); deliver(entity, state, pl, r, { chat: false }); }
      return r;
    },
    toggleFollow: (entity, state, pl) => {
      const on = setFollowing(state, pl);
      saveState(entity, state);
      if (on) followers.set(entity.id, { entity, playerId: pl.id });
      else followers.delete(entity.id);
      return !!on;
    },
    saveSettings,
  };
}

/* ------------------------------------------------------------------ *
 * Reactions: getting hit, weather, joining
 * ------------------------------------------------------------------ */
world.afterEvents.entityHurt.subscribe((ev) => {
  if (!settings.reactions) return;
  const hurt = ev.hurtEntity;
  if (!hurt || !IDS.villagers.includes(safe(() => hurt.typeId, ''))) return;
  const dmg = ev.damageSource;
  const attacker = dmg && dmg.damagingEntity ? dmg.damagingEntity : null;
  if (!attacker || safe(() => attacker.typeId, '') !== 'minecraft:player') return;
  const state = getState(hurt);
  if (!state) return;
  reactToHit(hurt, attacker, state, system);
  const reply = respondBark(hurt, state, attacker, 'player_hit_me');
  if (reply) deliver(hurt, state, attacker, reply);
  saveState(hurt, state);
});

world.afterEvents.weatherChange.subscribe((ev) => {
  const w = String(safe(() => ev.newWeather, 'clear') || 'clear').toLowerCase();
  weather = w.includes('thunder') ? 'thunder' : w.includes('rain') ? 'rain' : 'clear';
  if (weather !== 'clear' && settings.barks) {
    for (const player of world.getAllPlayers()) {
      const v = nearestVillager(player, settings.listenRadius);
      if (!v) continue;
      const state = getState(v);
      if (!state) continue;
      const reply = respondBark(v, state, player, weather === 'thunder' ? 'thunder' : 'rain');
      if (reply) deliver(v, state, player, reply);
      break;
    }
  }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  const player = ev.player;
  resetSpeaking();
  if (!ev.initialSpawn) return;
  safe(() => system.runTimeout(() => {
    player.sendMessage(t('pack.welcome', langOf(player), { v: BRAND.version }));
    const vi = voiceInfo();
    if (!vi.real) player.sendMessage(t('sys.noVoice', langOf(player)));
    if (settings.giveAmuletOnJoin) {
      const inv = safe(() => player.getComponent('minecraft:inventory')?.container, undefined);
      let has = false;
      if (inv) for (let i = 0; i < inv.size; i++) { const it = safe(() => inv.getItem(i), undefined); if (it && it.typeId === IDS.amulet) has = true; }
      if (!has) giveItem(player, IDS.amulet, 1);
    }
  }, 40));
});

world.afterEvents.entityRemove.subscribe((ev) => {
  if (ev.removedEntityId) { forgetEntity({ id: ev.removedEntityId }); brains.delete(ev.removedEntityId); lastBark.delete(ev.removedEntityId); followers.delete(ev.removedEntityId); }
});

/* ------------------------------------------------------------------ *
 * The amulet in the air -> global menu
 * ------------------------------------------------------------------ */
world.beforeEvents.itemUse.subscribe((ev) => {
  if (!ev.itemStack || safe(() => ev.itemStack.typeId, '') !== IDS.amulet) return;
  const player = ev.source;
  pending.push(() => globalMenu(player));
});

async function globalMenu(player) {
  const lang = langOf(player);
  const vi = voiceInfo();
  const form = new ActionFormData()
    .title('§e⌬ Neurio AI Villagers')
    .body([
      `§7${BRAND.name} v${BRAND.version}`,
      `§7Voice engine: §f${vi.engine}§8 (${vi.phrases} phrases / ${vi.words} words / ${vi.murmurs} murmurs)`,
      `§7Lang: §f${settings.lang}§8 · §7barks: §f${settings.barks ? 'on' : 'off'}§8 · §7voice: §f${settings.voice ? 'on' : 'off'}`,
      vi.real ? '' : `§8${t('sys.noVoice', lang).replace(/§./g, '')}`,
    ].filter(Boolean).join('\n'))
    .button('§b💬 Hder m3a a9reb crouyi', `${'textures/ui/neurio_'}talk.png`)
    .button('§7⚙ Settings', `${'textures/ui/neurio_'}gear.png`)
    .button('§e🎙 Voice test', `${'textures/ui/neurio_'}shop.png`)
    .button('§c✖ Sed');
  let res;
  try { res = await form.show(player); } catch (e) { return; }
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) {
    const v = nearestVillager(player, settings.listenRadius * 2);
    if (!v) return player.sendMessage(t('sys.noneNear', lang));
    const st = getState(v);
    return st && openMenu(player, v, st, formCtx(player));
  }
  if (res.selection === 1) return openSettings(player, formCtx(player));
  if (res.selection === 2) {
    const v = nearestVillager(player, settings.listenRadius * 2);
    if (!v) return player.sendMessage(t('sys.noneNear', lang));
    const st = getState(v);
    if (!st) return;
    const r = respondBark(v, st, player, 'first_meet');
    if (r) deliver(v, st, player, r, { chat: false });
    return globalMenu(player);
  }
}

/* ------------------------------------------------------------------ *
 * Script events  (/scriptevent neurio:...)
 * ------------------------------------------------------------------ */
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const id = String(ev.id || '');
  if (!id.startsWith(`${NS}:`)) return;
  const cmd = id.slice(NS.length + 1).toLowerCase();
  const msg = String(ev.message || '').trim();
  const src = ev.sourceEntity && safe(() => ev.sourceEntity.typeId, '') === 'minecraft:player' ? ev.sourceEntity : null;
  pending.push(() => handleCommand(cmd, msg, src, ev));
});

function handleCommand(cmd, msg, player, ev) {
  const lang = player ? langOf(player) : 'dz';
  switch (cmd) {
    case 'say': case 'tell': {
      if (!player) return;
      if (!msg) return player.sendMessage(t('talk.empty', lang));
      const v = nearestVillager(player, settings.listenRadius);
      if (!v) return player.sendMessage(t('sys.noneNear', lang));
      const st = getState(v); if (!st) return;
      if (settings.voice) hesitate(system, v, settings);
      safe(() => v.lookAt(player.getHeadLocation ? player.getHeadLocation() : player.location));
      const reply = respond(v, st, player, msg);
      deliver(v, st, player, reply);
      return;
    }
    case 'all': {
      if (!player) return;
      const list = villagersNear(player.location, player.dimension, settings.listenRadius);
      if (!list.length) return player.sendMessage(t('sys.noneNear', lang));
      list.slice(0, 5).forEach((v, i) => {
        safe(() => system.runTimeout(() => {
          const st = getState(v); if (!st) return;
          const reply = respond(v, st, player, msg);
          deliver(v, st, player, reply);
        }, i * 14));
      });
      return;
    }
    case 'menu': {
      if (!player) return;
      const v = nearestVillager(player, settings.listenRadius);
      if (!v) return player.sendMessage(t('sys.noneNear', lang));
      const st = getState(v); if (!st) return;
      openMenu(player, v, st, formCtx(player));
      return;
    }
    case 'lang': {
      if (['auto', 'dz', 'ar', 'en', 'fr'].includes(msg)) { settings.lang = msg; saveSettings(); if (player) player.sendMessage(`§alang = ${msg}`); }
      return;
    }
    case 'voice': {
      settings.voice = msg !== 'off' && msg !== 'false' && msg !== '0';
      saveSettings();
      if (player) player.sendMessage(settings.voice ? t('sys.voiceOn', lang) : t('sys.voiceOff', lang));
      return;
    }
    case 'barks': {
      settings.barks = msg !== 'off' && msg !== 'false' && msg !== '0';
      saveSettings();
      if (player) player.sendMessage(`§abarks = ${settings.barks ? 'on' : 'off'}`);
      return;
    }
    case 'bubbles': {
      settings.bubbles = msg === 'on' || msg === 'true' || msg === '1';
      saveSettings();
      if (player) player.sendMessage(`§abubbles = ${settings.bubbles ? 'on' : 'off'}`);
      return;
    }
    case 'channel': {
      if (['chat', 'actionbar', 'title', 'all'].includes(msg)) { settings.textChannel = msg; saveSettings(); if (player) player.sendMessage(`§achannel = ${msg}`); }
      return;
    }
    case 'set': {
      const [k, ...rest] = msg.split(' ');
      const v = rest.join(' ');
      if (!(k in settings)) { if (player) player.sendMessage(`§cunknown key: ${k}`); return; }
      const old = settings[k];
      settings[k] = typeof old === 'boolean' ? (v === 'true' || v === 'on' || v === '1') : typeof old === 'number' ? Number(v) || 0 : v;
      saveSettings();
      if (player) player.sendMessage(`§a${k} = ${JSON.stringify(settings[k])}`);
      return;
    }
    case 'name': {
      if (!player || !msg) return;
      const v = nearestVillager(player, settings.listenRadius);
      if (!v) return player.sendMessage(t('sys.noneNear', lang));
      const st = getState(v); if (!st) return;
      const nm = msg.slice(0, 24);
      rename(v, st, nm);
      brains.delete(safe(() => v.id, ''));
      saveState(v, st);
      player.sendMessage(t('sys.nameSet', lang, { name: nm }));
      return;
    }
    case 'info': {
      if (!player) return;
      const vi = voiceInfo();
      player.sendMessage(`§e⌬ voice: §f${vi.engine}§7 | phrases §f${vi.phrases}§7 | words §f${vi.words}§7 | murmurs §f${vi.murmurs}§7 | lang §f${settings.lang}`);
      return;
    }
    case 'stats': {
      const s = corpusStats();
      if (player) player.sendMessage(`§e⌬ brain: §f${s.lines}§7 lines, §f${s.intents}§7 intents, §f${s.barks}§7 situations`);
      return;
    }
    case 'help':
    default:
      if (player) player.sendMessage(t('sys.help', lang));
      return;
  }
}

/* ------------------------------------------------------------------ *
 * Ambient life: spontaneous talking + following
 * ------------------------------------------------------------------ */
system.runInterval(() => {
  // ---- following villagers ----
  for (const [id, f] of followers) {
    const e = f.entity;
    if (!isValid(e)) { followers.delete(id); continue; }
    const pl = world.getAllPlayers().find((p) => p.id === f.playerId);
    if (!pl || !isValid(pl)) { followers.delete(id); continue; }
    const d = Math.sqrt(dist2(e.location, pl.location));
    if (d > 18) {
      safe(() => e.teleport({ x: pl.location.x + 1, y: pl.location.y, z: pl.location.z + 1 }));
    } else if (d > 4) {
      const dx = pl.location.x - e.location.x, dz = pl.location.z - e.location.z;
      const len = Math.hypot(dx, dz) || 1;
      safe(() => e.applyImpulse({ x: (dx / len) * 0.35, y: d > 8 ? 0.2 : 0.05, z: (dz / len) * 0.35 }));
    }
  }

  if (!settings.barks) return;

  // ---- spontaneous lines ----
  const now = system.currentTick;
  const cooldown = Math.max(40, settings.barkEverySeconds * 20);
  for (const player of world.getAllPlayers()) {
    if (Math.random() > 0.55) continue; // not every tick-window, keeps it natural
    const list = villagersNear(player.location, player.dimension, settings.barkRadius);
    if (!list.length) continue;
    const candidates = list.filter((e) => now - (lastBark.get(e.id) || -99999) > cooldown);
    if (!candidates.length) continue;
    const e = candidates[Math.floor(Math.random() * candidates.length)];
    const state = getState(e);
    if (!state) continue;
    if (state.persona.chatty !== undefined && Math.random() > 0.4 + state.persona.chatty * 0.6) continue;

    lastBark.set(e.id, now);
    const kind = pickBark(e, state, player);
    if (!kind) continue;
    const reply = respondBark(e, state, player, kind);
    if (!reply) continue;
    // don't spam the chat when the player is far or busy
    const d = Math.sqrt(dist2(e.location, player.location));
    deliver(e, state, player, reply, { channel: d > settings.barkRadius * 0.6 ? 'actionbar' : settings.textChannel });
  }
}, 30);

function pickBark(entity, state, player) {
  const tod = timeOfDay();
  const seen = seenCount(state, player);
  const rep = repWith(state, player);
  const ps = playerState(player);
  if (hostileNear(entity, 12) > 0 && Math.random() < 0.8) return 'zombie_near';
  if (seen === 0) return 'first_meet';
  if (ps.low && Math.random() < 0.5) return 'player_low_hp';
  if (rep <= -3 && Math.random() < 0.4) return 'bad_rep';
  if (rep >= 5 && Math.random() < 0.25) return 'good_rep';
  if (weather === 'thunder' && Math.random() < 0.5) return 'thunder';
  if (weather === 'rain' && Math.random() < 0.4) return 'rain';
  const r = Math.random();
  if (tod === 'morning' && r < 0.45) return 'morning';
  if (tod === 'evening' && r < 0.4) return 'evening';
  if (tod === 'night' && r < 0.5) return 'night';
  if (tod === 'noon' && r < 0.3) return 'noon';
  if (r < 0.1) return 'proverb';
  if (r < 0.2) return 'gossip';
  if (r < 0.32) return 'news';
  if (r < 0.42) return 'joke';
  if (r < 0.6) return 'work';
  return 'idle';
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
saveSettings();
world.sendMessage(`§8[§e⌬ ${BRAND.name}§8] §7loaded — ${voiceInfo().engine} voice, /scriptevent ${NS}:help`);
if (settings.debug) world.sendMessage(`§8[debug] brain ready`);
