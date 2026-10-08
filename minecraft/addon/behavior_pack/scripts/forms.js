/**
 * forms.js — the in-game UI (menus, the talk box, the shop, gifts, settings)
 * --------------------------------------------------------------------------
 * The conversation screen is an ActionForm:
 *   title  = who is talking
 *   body   = what he just said  (spoken aloud at the same time by voice.js)
 *   buttons= say something / gift / shop / quest / close
 * Pressing "say something" opens a text box — that is where you type, or dictate
 * (Android & iOS: the mic key on the keyboard, Windows: Win + H).
 */

import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { ItemStack } from '@minecraft/server';
import { t, LANG_NAMES, moodWord, repWord } from './i18n.js';
import { safe, isValid, getComponent } from './compat.js';
import { repWith, seenCount, rename, setPersonaChoice, saveState } from './memory.js';
import { countItem, takeItem, giveItem, stockFor, priceFor, sellPriceFor, WANTED, itemName, startQuest, completeQuest, giftFromPlayer } from './actions.js';
import { voiceInfo } from './voice.js';

const ICON = 'textures/ui/neurio_';   // icons are registered in resource_pack/textures/ui/_ui_defs.json

export async function show(form, player) {
  try {
    return await form.show(player);
  } catch (e) {
    return { canceled: true, cancelationReason: 'error' };
  }
}

/* ------------------------------------------------------------------ *
 * Main conversation screen
 * ------------------------------------------------------------------ */

/**
 * @param {object} ctx  { settings, langOf(player), respond(entity,state,player,text),
 *                        speakNow(entity,state,reply), questCheck(entity,state,player) }
 */
export async function openMenu(player, entity, state, ctx, lastReply) {
  if (!isValid(player) || !isValid(entity)) return;
  const lang = ctx.langOf(player);
  const p = state.persona;

  if (!lastReply) {
    // first hello: greet + quest reminder
    lastReply = ctx.greet(entity, state, player);
  }

  const form = new ActionFormData()
    .title(t('menu.title', lang, { name: nameFor(p, lang), job: jobFor(p, lang) }))
    .body(buildBody(lang, p, state, player, lastReply))
    .button(t('menu.talk', lang), `${ICON}talk`)
    .button(t('menu.gift', lang), `${ICON}gift`);

  if (ctx.settings.gifts !== false) form.button(t('menu.shop', lang), `${ICON}shop`);
  if (ctx.settings.quests !== false) form.button(t('menu.quest', lang), `${ICON}quest`);
  if (ctx.settings.follow !== false) form.button(state.following === player.id ? t('sys.stopfollow', lang).replace('§7', '') : t('menu.follow', lang), `${ICON}follow`);
  form.button(t('menu.info', lang), `${ICON}info`);
  form.button(t('menu.settings', lang), `${ICON}gear`);
  form.button(t('menu.close', lang), `${ICON}close`);

  const res = await show(form, player);
  if (res.canceled || res.selection === undefined) return;

  const buttons = ['talk', 'gift', 'shop', 'quest', 'follow', 'info', 'settings', 'close'];
  const pick = buttons[res.selection] || 'close';

  switch (pick) {
    case 'talk': {
      const text = await askText(player, entity, state, ctx, lang);
      if (!text) return openMenu(player, entity, state, ctx, lastReply);
      const reply = ctx.respond(entity, state, player, text);
      ctx.deliver(entity, state, player, reply, { form: false });
      return openMenu(player, entity, state, ctx, reply);
    }
    case 'gift': return openGift(player, entity, state, ctx, lang);
    case 'shop': return openShop(player, entity, state, ctx, lang);
    case 'quest': return openQuest(player, entity, state, ctx, lang);
    case 'follow': {
      const on = ctx.toggleFollow(entity, state, player);
      player.sendMessage(on ? t('sys.follow', lang, { name: nameFor(p, lang) }) : t('sys.stopfollow', lang, { name: nameFor(p, lang) }));
      return openMenu(player, entity, state, ctx, lastReply);
    }
    case 'info': return openInfo(player, entity, state, ctx, lang);
    case 'settings': {
      await openSettings(player, ctx);
      return openMenu(player, entity, state, ctx, lastReply);
    }
    default: return;
  }
}

function buildBody(lang, p, state, player, reply) {
  const info = t('menu.body', lang, {
    age: p.age,
    biome: lang === 'dz' ? p.biome.dz : lang === 'ar' ? p.biome.ar : p.biome.en,
    traits: (p.traits || []).map((x) => (lang === 'dz' ? x.dz : lang === 'ar' ? x.ar : x.dz)).join(' · '),
    mood: moodWord(state.mood ?? 0.6, lang),
    rep: repWord(repWith(state, player), lang),
    hint: reply ? '' : '§8' + t('talk.label', lang, { name: nameFor(p, lang) }).split('\n')[1],
  });
  const said = reply ? `\n\n§l§e❝§r §f${reply.text}§r §l§e❞§r\n§8— ${nameFor(p, lang)} (${reply.emotion})` : '';
  return info + said;
}

export function nameFor(p, lang) {
  if (!p || !p.name) return 'Crouyi';
  return lang === 'dz' || lang === 'en' || lang === 'fr' ? p.name.dz || p.name.ar : p.name.ar;
}
export function jobFor(p, lang) {
  if (!p || !p.job) return '';
  return lang === 'ar' ? p.job.ar : lang === 'en' ? p.job.en : lang === 'fr' ? p.job.fr : p.job.dz;
}

/* ------------------------------------------------------------------ *
 * The text box — this is where the player "speaks"
 * ------------------------------------------------------------------ */
export async function askText(player, entity, state, ctx, lang) {
  const form = new ModalFormData()
    .title(`${nameFor(state.persona, lang)} — ${jobFor(state.persona, lang)}`)
    .textField(t('talk.label', lang, { name: nameFor(state.persona, lang) }), t('talk.placeholder', lang))
    .submitButton(t('talk.send', lang));
  const res = await show(form, player);
  if (res.canceled) return '';
  const v = (res.formValues && res.formValues[0]) || '';
  return String(v).trim();
}

/* ------------------------------------------------------------------ *
 * Gifts
 * ------------------------------------------------------------------ */
const GIFTABLE = [
  { id: 'minecraft:bread', worth: 2 }, { id: 'minecraft:wheat', worth: 1 }, { id: 'minecraft:emerald', worth: 4 },
  { id: 'minecraft:diamond', worth: 6 }, { id: 'minecraft:apple', worth: 1 }, { id: 'minecraft:dandelion', worth: 1 },
  { id: 'minecraft:poppy', worth: 1 }, { id: 'minecraft:cooked_beef', worth: 2 }, { id: 'minecraft:golden_carrot', worth: 3 },
  { id: 'minecraft:iron_ingot', worth: 3 }, { id: 'minecraft:paper', worth: 1 }, { id: 'minecraft:book', worth: 2 },
  { id: 'minecraft:oak_log', worth: 1 }, { id: 'minecraft:coal', worth: 1 }, { id: 'minecraft:leather', worth: 2 },
];

export async function openGift(player, entity, state, ctx, lang) {
  const have = GIFTABLE.map((g) => ({ ...g, n: countItem(player, g.id) })).filter((g) => g.n > 0);
  const form = new ActionFormData()
    .title(t('gift.title', lang))
    .body(have.length
      ? `§7${have.map((h) => `${itemName(h.id, lang)}: §f${h.n}`).join('§8 · §7')}`
      : '§c...')
    ;
  if (!have.length) {
    form.button(t('menu.close', lang));
    await show(form, player);
    return openMenu(player, entity, state, ctx);
  }
  for (const h of have) form.button(`§6🎁 ${itemName(h.id, lang)} §8x1`, `${ICON}gift`);
  form.button(t('menu.close', lang));

  const res = await show(form, player);
  if (res.canceled || res.selection === undefined || res.selection >= have.length) return openMenu(player, entity, state, ctx);
  const item = have[res.selection];
  const done = giftFromPlayer(player, entity, state, item.id, 1);
  if (done) {
    player.sendMessage(t('gift.given', lang, { n: 1, item: itemName(item.id, lang) }));
    saveState(entity, state);
    const reply = ctx.respondBark(entity, state, player, 'player_gift');
    if (reply) ctx.deliver(entity, state, player, reply, { form: false });
    return openMenu(player, entity, state, ctx, reply);
  }
  player.sendMessage(t('gift.none', lang, { item: itemName(item.id, lang) }));
  return openGift(player, entity, state, ctx, lang);
}

/* ------------------------------------------------------------------ *
 * Shop
 * ------------------------------------------------------------------ */
export async function openShop(player, entity, state, ctx, lang) {
  const p = state.persona;
  const rep = repWith(state, player);
  const stock = stockFor(p);
  const wanted = WANTED[p.job.key] || WANTED.none;
  const em = countItem(player, 'minecraft:emerald');

  const form = new ActionFormData()
    .title(t('shop.title', lang, { name: nameFor(p, lang) }))
    .body(`§a§l❖§r §7zomrod 3andek: §f${em}§8 | §7rep: §f${repWord(rep, lang)}`);

  const buyList = stock.map((s) => ({ ...s, price: priceFor(s, rep) }));
  const sellList = wanted.filter((w) => countItem(player, w.id) >= w.n).map((w) => ({ ...w, gain: sellPriceFor(w, rep) }));

  for (const b of buyList) form.button(t('shop.buy', lang, { n: b.n, item: itemName(b.id, lang), price: b.price }), `${ICON}shop`);
  for (const s of sellList) form.button(t('shop.sell', lang, { n: s.n, item: itemName(s.id, lang), price: s.gain }), `${ICON}sell`);
  form.button(t('menu.close', lang));

  const res = await show(form, player);
  if (res.canceled || res.selection === undefined) return openMenu(player, entity, state, ctx);
  const i = res.selection;

  if (i < buyList.length) {
    const b = buyList[i];
    if (countItem(player, 'minecraft:emerald') < b.price) { player.sendMessage(t('shop.noem', lang)); return openShop(player, entity, state, ctx, lang); }
    takeItem(player, 'minecraft:emerald', b.price);
    giveItem(player, b.id, b.n);
    safe(() => entity.dimension.playSound('random.orb', entity.location, { volume: 0.6, pitch: 1.4 }));
    const reply = ctx.respondBark(entity, state, player, 'player_trade');
    if (reply) ctx.deliver(entity, state, player, reply, { form: false });
    return openShop(player, entity, state, ctx, lang);
  }
  const si = i - buyList.length;
  if (si < sellList.length) {
    const s = sellList[si];
    if (takeItem(player, s.id, s.n)) {
      giveItem(player, 'minecraft:emerald', s.gain);
      safe(() => entity.dimension.playSound('random.orb', entity.location, { volume: 0.6, pitch: 1.1 }));
      const reply = ctx.respondBark(entity, state, player, 'player_trade');
      if (reply) ctx.deliver(entity, state, player, reply, { form: false });
    }
    return openShop(player, entity, state, ctx, lang);
  }
  return openMenu(player, entity, state, ctx);
}

/* ------------------------------------------------------------------ *
 * Quest
 * ------------------------------------------------------------------ */
export async function openQuest(player, entity, state, ctx, lang) {
  const done = completeQuest(player, state, lang);
  if (done) {
    saveState(entity, state);
    player.sendMessage(t('sys.questGot', lang, { item: done.item, reward: done.reward }));
    const reply = ctx.respondBark(entity, state, player, 'praise');
    if (reply) ctx.deliver(entity, state, player, reply, { form: false });
    return openMenu(player, entity, state, ctx, reply);
  }
  if (!state.quest) {
    state.quest = null;
    const q = startQuest(state, lang);
    saveState(entity, state);
    const reply = ctx.respond(entity, state, player, lang === 'ar' ? 'عطيني خدمة' : 'quest');
    ctx.deliver(entity, state, player, reply, { form: false });
    player.sendMessage(`§8[quest] §e${q.n}x ${itemName(q.item, lang)} §7→ §a${q.rn}x ${itemName(q.reward, lang)}`);
    return openMenu(player, entity, state, ctx, reply);
  }
  const q = state.quest;
  const have = countItem(player, q.item);
  const form = new ActionFormData()
    .title(t('menu.quest', lang).replace(/§./g, ''))
    .body(`§e${q.n}x §f${itemName(q.item, lang)}\n§73andek: §f${have}§7/${q.n}\n§aReward: §f${q.rn}x ${itemName(q.reward, lang)}`)
    .button(t('menu.close', lang));
  await show(form, player);
  return openMenu(player, entity, state, ctx);
}

/* ------------------------------------------------------------------ *
 * Who is he? (rename, re-roll personality, voice)
 * ------------------------------------------------------------------ */
export async function openInfo(player, entity, state, ctx, lang) {
  const p = state.persona;
  const vi = voiceInfo();
  const body = [
    `§e§l${p.name.ar}§r §8(${p.name.dz})`,
    `§7${jobFor(p, 'ar')} · ${p.age} §7سن`,
    `§7traits: §f${p.traits.map((x) => x.ar).join('، ')}`,
    `§7catchphrase: §f"${p.catchphrase.ar}"`,
    `§7saw you §f${seenCount(state, player)}§7 times · rep §f${repWith(state, player)}`,
    `§7voice: §f${vi.engine}§8 (${vi.phrases} phrases, ${vi.words} words, ${vi.murmurs} murmurs)`,
    vi.real ? '' : `§8${t('sys.noVoice', lang).replace('§8', '')}`,
  ].filter(Boolean).join('\n');

  const form = new ActionFormData().title(t('menu.info', lang).replace(/§./g, ''))
    .body(body)
    .button('§b✏️ Smiya jdida / Rename', `${ICON}talk`)
    .button('§d🎲 Chakhsiya jdida / New personality', `${ICON}quest`)
    .button('§e🎙 Sout / Voice test', `${ICON}gear`)
    .button(t('menu.close', lang));

  const res = await show(form, player);
  if (res.canceled || res.selection === undefined || res.selection === 3) return openMenu(player, entity, state, ctx);

  if (res.selection === 0) {
    const f = new ModalFormData().title('✏️ Rename').textField('Smiya jdida / New name:', p.name.dz).submitButton('✔');
    const r = await show(f, player);
    if (!r.canceled) {
      const nm = String((r.formValues && r.formValues[0]) || '').trim().slice(0, 24);
      if (nm) {
        rename(entity, state, nm);
        saveState(entity, state);
        player.sendMessage(t('sys.nameSet', lang, { name: nm }));
      }
    }
    return openInfo(player, entity, state, ctx, lang);
  }
  if (res.selection === 1) {
    setPersonaChoice(entity, state, { reroll: true });
    saveState(entity, state);
    return openInfo(player, entity, state, ctx, lang);
  }
  if (res.selection === 2) {
    const reply = ctx.respondBark(entity, state, player, 'first_meet');
    if (reply) ctx.deliver(entity, state, player, reply, { form: false });
    return openInfo(player, entity, state, ctx, lang);
  }
}

/* ------------------------------------------------------------------ *
 * Amulet: bind / configure a villager
 * ------------------------------------------------------------------ */
export async function openAmulet(player, entity, state, ctx) {
  const lang = ctx.langOf(player);
  const p = state.persona;
  const form = new ActionFormData()
    .title(`§e⌬ ${t('sys.amulet', lang).replace(/§./g, '').replace('⌬ ', '').split(' — ')[0]}`)
    .body(`§f${p.name.ar} §8(${p.name.dz})\n§7${jobFor(p, lang)} · ${p.age}\n§8${t('menu.body', lang, { age: p.age, biome: p.biome.dz, traits: p.traits.map((x) => x.dz).join(' · '), mood: moodWord(state.mood, lang), rep: repWord(repWith(state, player), lang), hint: '' })}`)
    .button(t('menu.talk', lang), `${ICON}talk`)
    .button('§b✏️ Smiya / Name', `${ICON}talk`)
    .button('§d🎲 Chakhsiya / Personality', `${ICON}quest`)
    .button('§a👨 Rajel  §7/ §d👑 Mara', `${ICON}info`)
    .button(t('menu.close', lang));

  const res = await show(form, player);
  if (res.canceled || res.selection === undefined) return;
  if (res.selection === 0) return openMenu(player, entity, state, ctx);
  if (res.selection === 1) return openInfo(player, entity, state, ctx, lang);
  if (res.selection === 2) { setPersonaChoice(entity, state, { reroll: true }); saveState(entity, state); player.sendMessage(t('sys.bound', lang, { name: state.persona.name.dz, job: jobFor(state.persona, lang) })); return openAmulet(player, entity, state, ctx); }
  if (res.selection === 3) { setPersonaChoice(entity, state, { gender: p.gender === 'm' ? 'f' : 'm', reroll: true }); saveState(entity, state); return openAmulet(player, entity, state, ctx); }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */
export async function openSettings(player, ctx) {
  const lang = ctx.langOf(player);
  const s = ctx.settings;
  const langs = ['auto', 'dz', 'ar', 'en', 'fr'];
  const channels = ['chat', 'actionbar', 'title', 'all'];
  const form = new ModalFormData()
    .title(t('set.title', lang).replace(/§./g, ''))
    .dropdown(t('set.lang', lang), langs.map((l) => (l === 'auto' ? 'auto (copy me)' : LANG_NAMES[l] || l)), Math.max(0, langs.indexOf(s.lang)))
    .toggle(t('set.voice', lang), !!s.voice)
    .toggle(t('set.barks', lang), !!s.barks)
    .dropdown(t('set.channel', lang), channels, Math.max(0, channels.indexOf(s.textChannel)))
    .toggle(t('set.bubbles', lang), !!s.bubbles)
    .submitButton('✔ Save');
  const res = await show(form, player);
  if (res.canceled || !res.formValues) return;
  const v = res.formValues;
  s.lang = langs[v[0]] || 'auto';
  s.voice = !!v[1];
  s.barks = !!v[2];
  s.textChannel = channels[v[3]] || 'chat';
  s.bubbles = !!v[4];
  ctx.saveSettings();
  player.sendMessage(t('set.saved', lang));
  if (s.voice && !voiceInfo().real) player.sendMessage(t('sys.noVoice', lang));
}
