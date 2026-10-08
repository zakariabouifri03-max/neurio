/**
 * voice.js — makes the villagers SPEAK
 * -----------------------------------------------------------------------------
 * Bedrock can only play sounds that were packed inside the resource pack when the
 * world loaded, so the voice works like this (best available option first):
 *
 *  1. phrases  — the whole sentence was synthesised offline (tools/build_voicebank.py
 *                with edge-tts / piper / espeak) -> one clip, real Darija speech.
 *  2. words    — every word of the sentence exists as a clip -> played one after
 *                another with the right timing (concatenative speech).
 *  3. murmurs  — "villagerese": short voiced syllables timed to the sentence,
 *                Animal-Crossing style. This is what ships in the pack by default,
 *                generated procedurally, so the addon has a voice with zero setup.
 *
 * Emotion changes pitch, volume and speed, and each persona has its own voice
 * (male / female / old / kid), so no two villagers sound the same.
 */

import { VOICE_MANIFEST } from './voicemanifest.js';
import { safe, isValid } from './compat.js';

const TICKS_PER_SECOND = 20;
const speaking = new Map(); // entityId -> tick when the voice ends

/** Same normalisation the Python voice-bank builder uses. */
export function normKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:"'`’‘“”()\[\]{}<>|/\\+\-*=~^%$#@&_…،؛؟«»ـ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function voiceInfo() {
  const ph = VOICE_MANIFEST.phrases || {};
  const wd = VOICE_MANIFEST.words || {};
  const count = (o) => {
    const by = o.byVoice || {};
    const n = Object.values(by).reduce((a, v) => a + Object.keys(v).length, 0);
    const flat = Object.keys(o).filter((k) => k !== 'byVoice' && k !== 'map' && o[k] && o[k].id).length;
    return n + flat;
  };
  const mur = VOICE_MANIFEST.murmurs || {};
  const murClips = Object.values(mur).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  return {
    engine: VOICE_MANIFEST.engine || 'murmur',
    phrases: count(ph),
    words: count(wd),
    murmurs: murClips,
    real: count(ph) > 0,
  };
}

/** Is this villager still talking? */
export function busy(entityId, now) {
  return (speaking.get(entityId) || 0) > now;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/**
 * Speak a reply.
 * @param {object} system   the minecraft `system` object (for runTimeout)
 * @param {object} entity   the villager (for position + id)
 * @param {object} reply    from brain.js (text, voice{pitch,volume,speed,murmur,family})
 * @param {object} settings { voice, voiceVolume, voiceMode }
 * @returns {number} how many ticks the speech takes (0 = silent)
 */
export function speak(system, entity, reply, settings = {}) {
  if (!settings.voice || !reply || !reply.text) return 0;
  if (!isValid(entity)) return 0;
  const now = safe(() => system.currentTick, 0) || 0;
  if (busy(entity.id, now)) return 0;

  const loc = headLocation(entity);
  const dim = entity.dimension;
  const v = reply.voice || { pitch: 1, volume: 1, speed: 1 };
  const basePitch = clamp(v.pitch || 1, 0.5, 2);
  const baseVolume = clamp((v.volume || 1) * (settings.voiceVolume ?? 1), 0.05, 2);
  const speed = clamp(Number(v.speed) || 1, 0.6, 1.6);
  const mode = settings.voiceMode || 'auto';

  const plan = buildPlan(reply.text, v, mode);
  if (!plan.clips.length) return 0;

  let t = 0;
  for (const c of plan.clips) {
    const delay = Math.max(1, Math.round(t));
    const pitch = clamp(c.pitch * basePitch, 0.4, 2.2);
    const vol = clamp(c.vol * baseVolume, 0.02, 2);
    safe(() => system.runTimeout(() => {
      try {
        if (isValid(dim)) dim.playSound(c.id, loc, { volume: vol, pitch });
      } catch (e) { /* chunk unloaded, sound def missing... just skip */ }
    }, delay));
    t += c.ticks;
  }
  // a tiny "villager hrmm" underneath, for flavour
  if (plan.kind === 'murmur' && Math.random() < 0.35) {
    safe(() => system.runTimeout(() => {
      try { dim.playSound('mob.villager.idle', loc, { volume: 0.25 * baseVolume, pitch: clamp(basePitch * 1.05, 0.5, 2) }); } catch (e) {}
    }, 2));
  }

  const total = Math.round(t) + 6;
  speaking.set(entity.id, now + total);
  return total;
}

function headLocation(entity) {
  const l = entity.location;
  return { x: l.x, y: l.y + 1.5, z: l.z };
}

/** Which voice set belongs to this persona (male/female, old/kid reuse them). */
function voiceSet(section, voice) {
  const sec = VOICE_MANIFEST[section] || {};
  const by = sec.byVoice || {};
  const map = (sec.map || {})[voice.murmur] || voice.murmur || 'male';
  return by[map] || by[voice.murmur] || by[Object.keys(by)[0]] || sec;
}

/** Decide what to play for this sentence. */
function buildPlan(text, voice, mode) {
  const phrases = voiceSet('phrases', voice);
  const words = voiceSet('words', voice);
  const key = normKey(text);

  // 1) a full recorded sentence
  if (mode !== 'murmur' && phrases[key]) {
    const p = phrases[key];
    return { kind: 'phrase', clips: [{ id: p.id, ticks: Math.max(2, Math.round((p.d || 1) * TICKS_PER_SECOND)), pitch: p.pitch || 1, vol: 1 }] };
  }

  // 2) word by word
  if (mode !== 'murmur' && Object.keys(words).length) {
    const toks = key.split(' ').filter(Boolean);
    const hits = toks.map((tk) => words[tk] || words[tk.replace(/[^a-z0-9\u0600-\u06ff]/g, '')]);
    const covered = hits.filter(Boolean).length;
    if (toks.length && covered / toks.length >= 0.6) {
      const clips = [];
      let t = 0;
      for (let i = 0; i < hits.length; i++) {
        const w = hits[i];
        if (w) {
          const ticks = Math.max(2, Math.round((w.d || 0.35) * TICKS_PER_SECOND));
          clips.push({ id: w.id, ticks, pitch: w.pitch || 1, vol: 1 });
          t += ticks;
        } else {
          // unknown word -> a murmur syllable in its place
          const m = murmurClip(voice, t);
          clips.push(m);
          t += m.ticks;
        }
      }
      return { kind: 'words', clips };
    }
  }

  // 3) villagerese murmurs, timed to the sentence
  return { kind: 'murmur', clips: murmurPlan(text, voice) };
}

function murmurPlan(text, voice) {
  const s = String(text || '');
  const groups = s.match(/[\w\u0600-\u06FF']+/g) || [];
  const clips = [];
  let t = 0;
  const murmurSet = murmurPool(voice);
  if (!murmurSet.length) return clips;

  for (let i = 0; i < groups.length && clips.length < 42; i++) {
    const word = groups[i];
    const syl = Math.max(1, Math.min(4, Math.round(word.length / 3)));
    for (let k = 0; k < syl; k++) {
      const c = murmurClip(voice, t, murmurSet);
      clips.push(c);
      t += c.ticks;
    }
    // pause between words / longer pause after punctuation
    const punct = /[.!?؟]/.test(s.slice(s.indexOf(word) + word.length, s.indexOf(word) + word.length + 2));
    t += punct ? 7 : 2;
  }
  return clips;
}

function murmurPool(voice) {
  const m = VOICE_MANIFEST.murmurs || {};
  const want = voice.murmur || voice.tone || 'male';
  return m[want] || m.male || m[Object.keys(m)[0]] || [];
}

function murmurClip(voice, seedNum, pool) {
  const set = pool || murmurPool(voice);
  if (!set.length) return { id: '', ticks: 4, pitch: 1, vol: 0 };
  const pick = set[Math.floor(Math.random() * set.length) % set.length];
  const d = pick.d || 0.28;
  return {
    id: pick.id,
    ticks: Math.max(2, Math.round(d * TICKS_PER_SECOND * (1 / clamp(Number(voice.speed) || 1, 0.6, 1.6)))),
    pitch: clamp((pick.p || 1) * (0.94 + Math.random() * 0.14), 0.5, 2),
    vol: pick.v ?? 1,
  };
}

/** Pre-speak "thinking" noise while the answer is being composed. */
export function hesitate(system, entity, settings = {}) {
  if (!settings.voice || !isValid(entity)) return;
  const voice = { murmur: 'male', speed: 1 };
  const c = murmurClip(voice, 0);
  if (!c.id) return;
  const loc = headLocation(entity);
  safe(() => entity.dimension.playSound(c.id, loc, { volume: 0.5 * (settings.voiceVolume ?? 1), pitch: c.pitch }));
}

export function resetSpeaking() { speaking.clear(); }
