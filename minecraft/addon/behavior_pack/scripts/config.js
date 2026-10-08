/**
 * Neurio AI Villagers — configuration
 * ------------------------------------
 * Everything here can be changed in-game with the "⚙ Settings" form, or with
 *   /scriptevent neurio:set <key> <value>
 * The values are saved in the world (dynamic properties) so they survive a restart.
 */

export const NS = 'neurio';

/** Default settings. Saved ones override these. */
export const DEFAULTS = {
  /**
   * Language the villagers answer in:
   *   'auto' -> copy the player (Arabic script in  -> Arabic, Latin/Arabizi -> Arabizi,
   *             english in -> english, french in -> french)
   *   'dz'   -> Darija in Latin letters (Arabizi: "salam khoya, kif dayr?")  <-- renders everywhere
   *   'ar'   -> Darija in Arabic letters ("سلام خويا، كيف داير؟")
   *   'en'   -> English
   *   'fr'   -> French
   */
  lang: 'auto',

  /** Voice: play the villager voice-bank sounds (resource pack). */
  voice: true,
  voiceVolume: 1.0,
  /** 'auto' = real recorded/TTS lines when the voice bank has them, else "villagerese" blips. */
  voiceMode: 'auto', // 'auto' | 'words' | 'murmur' | 'off'

  /** Where the answer text shows up. 'chat' | 'actionbar' | 'title' | 'all' */
  textChannel: 'chat',

  /** Villagers talk by themselves when you walk near them. */
  barks: true,
  barkEverySeconds: 12,
  barkRadius: 12,
  /** How close you have to be for a villager to listen to you. */
  listenRadius: 10,

  /** Floating name-tag "speech bubble" above the villager (experimental, short lines only). */
  bubbles: false,

  /** Gameplay: gifts, quests, and reactions (getting angry when you hit them...). */
  gifts: true,
  quests: true,
  reactions: true,
  follow: true,

  /** Give every player a Talking Amulet the first time they join. */
  giveAmuletOnJoin: true,

  /** Sneak + use on a villager = open the talk menu (normal use still opens vanilla trades). */
  sneakToTalk: true,

  /** Never repeat the same line twice in a row (number of lines remembered). */
  noRepeatMemory: 8,

  /** Max characters shown per line (longer lines get split into 2 messages). */
  maxLineChars: 200,

  /** Debug: log what the brain is doing to the script logger. */
  debug: false,
};

/** Items / entities this pack adds or watches. */
export const IDS = {
  amulet: `${NS}:talking_amulet`,
  bubble: `${NS}:speech_bubble`,
  aiVillager: `${NS}:ai_villager`,
  villagers: ['minecraft:villager_v2', 'minecraft:villager', `${NS}:ai_villager`],
  tagBound: `${NS}:ai_bound`,
  scriptEvent: `${NS}:`,
};

/** Keys used for world / entity dynamic properties (kept short: they cost bytes). */
export const KEYS = {
  settings: `${NS}.settings`,
  persona: `${NS}.persona`,
  memory: `${NS}.mem`,
  mood: `${NS}.mood`,
  recent: `${NS}.recent`,
  quests: `${NS}.quests`,
  voice: `${NS}.voice`,
  stats: `${NS}.stats`,
};

/** A tiny bit of branding used in the UI. */
export const BRAND = {
  name: 'Neurio AI Villagers',
  nameAr: 'قرويون بالذكاء الاصطناعي',
  version: '1.0.0',
};
