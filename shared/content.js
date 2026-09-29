// ═════════════════════════════════════════════════════════════════════════════
// SWINDLE SQUAD — game content (shared by the authoritative server & the client)
// Everything here is original: names, text, numbers, art ids, characters.
//
// A round def can implement these hooks (all optional except begin/resolve):
//   begin(ctx)                 – deal out secrets, build public state
//   optionsFor(ctx, pid)       – the commit buttons this player sees
//   actionsFor(ctx, pid)       – live actions available during TALK
//   onAction(ctx, pid, id, p)  – custom live action (return false = unhandled)
//   resolve(ctx)               – called at LOCK; must call ctx.award/ctx.beat
// ctx = { R, rng, rint, pick, shuffle, flip, pids, P, roleOf(pid),
//         award(pid, delta, tag, why), beat(o), goods, holds(pid) }
// ═════════════════════════════════════════════════════════════════════════════

import { mulberry32, rint, pick, shuffle, clamp, fmt, flip as _flip } from './util.js';

export const PROTO = 12;
export const GAME_TITLE = 'SWINDLE SQUAD';
export const GAME_SUB = 'deal · doubt · double-cross';
export const VENUE = 'The Gilded Alibi';

// ── tunables ─────────────────────────────────────────────────────────────────
export const CFG = {
  startChips: 1200,
  minPlayers: 2,
  maxPlayers: 8,
  baseRoundMs: 1000 * 60,
  revealBeatMs: 2600,
  tag: 'swindle-v1',
};

// ── secret roles. Rotating: never permanent, reassigned every round. ─────────
export const ROLES = [
  {
    id: 'trickster', name: 'Trickster', icon: '🎭', hue: 340,
    obj: 'Make one honest plan go gloriously wrong — and stay unnamed.',
    blurb: 'You get one free loophole on a deal, and you may palm a dud into someone else\u2019s trade. Nobody may point at you.',
    ability: 'Shady Clause · Palm A Dud',
  },
  {
    id: 'detective', name: 'Detective', icon: '🔍', hue: 205,
    obj: 'Catch a cheat red-handed. Naming an honest player costs you.',
    blurb: 'You may Flag a player to void any loophole they pull, and Audit their goods once per round.',
    ability: 'Flag · Audit',
  },
  {
    id: 'trader', name: 'Trader', icon: '🤝', hue: 35,
    obj: 'Be the reason two people walk away richer.',
    blurb: 'Goods you receive are worth 40% more and any loophole pulled on you only half stings.',
    ability: 'Sweeten The Deal',
  },
  {
    id: 'protector', name: 'Protector', icon: '🛡️', hue: 150,
    obj: 'Be the reason someone keeps their prize.',
    blurb: 'Insure one player: any scam landing on them bounces off you, and the house pays you anyway.',
    ability: 'Take The Heat',
  },
  {
    id: 'risk', name: 'Risk Taker', icon: '🎲', hue: 15,
    obj: 'Wager loud. Twice, at least.',
    blurb: 'Your Push doubles your swing. Being right pays triple; being wrong still gets a consolation kiss.',
    ability: 'Push It',
  },
  {
    id: 'insider', name: 'Insider', icon: '🗝️', hue: 275,
    obj: 'Know too much, say exactly enough.',
    blurb: 'Peek at one player\u2019s hidden card. Tell the table in chat — never by clicking them.',
    ability: 'Peek',
  },
  {
    id: 'civilian', name: 'Straight Dealer', icon: '🍀', hue: 95,
    obj: 'End the round richer without a single lie attached to your name.',
    blurb: 'No tricks, no tells. Clean play pays a quiet bonus.',
    ability: 'Clean Hands',
  },
];
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));
export const ABLE_ROLES = ['trickster', 'detective', 'trader', 'protector', 'risk', 'insider'];

// ── goods that get traded, faked, and fought over ────────────────────────────
export const GOODS = [
  { id: 'g01', n: 'Solid Gold TV Remote', i: '📺', v: 260, w: 'Weight: suspiciously correct' },
  { id: 'g02', n: 'Unmarked Envelope', i: '✉️', v: 140, w: 'Crinkles when you disagree' },
  { id: 'g03', n: 'Retirement Fund (used)', i: '🏦', v: 300, w: 'Smells of old carpet' },
  { id: 'g04', n: 'Diamond-ish Ring', i: '💎', v: 340, w: 'Ice-cold. Suspiciously warm' },
  { id: 'g05', n: 'Signed Autograph, Unclear Who', i: '🖊️', v: 95, w: 'Name has 11 letters' },
  { id: 'g06', n: 'Emotional Support Duck', i: '🦆', v: 60, w: 'Judges your choices' },
  { id: 'g07', n: 'Briefcase of Monopoly Cash', i: '💼', v: 175, w: 'Board game not included' },
  { id: 'g08', n: 'Very Legal Certificate', i: '📜', v: 220, w: 'Framed. Blank inside' },
  { id: 'g09', n: 'Whisper-Proof Kettle', i: '🫖', v: 110, w: 'Gossip insulation' },
  { id: 'g10', n: 'Second-Hand Trophy', i: '🏆', v: 190, w: 'Engraved: "Almost"' },
  { id: 'g11', n: 'Pocket Full of Keys', i: '🔑', v: 130, w: 'None are for a car' },
  { id: 'g12', n: 'Certified Loud Coin', i: '🪙', v: 250, w: 'Dings at the worst time' },
  { id: 'g13', n: 'A Friendly Oath', i: '🤞', v: 70, w: 'Verbal only, no refunds' },
  { id: 'g14', n: 'Slightly Haunted Lamp', i: '🪔', v: 280, w: 'Grants 1 wish, minor spite' },
];
export const GOOD_BY_ID = Object.fromEntries(GOODS.map((g) => [g.id, g]));

// ── emotes (client animates; server only validates + relays) ─────────────────
export const EMOTES = [
  { id: 0, n: 'Sweat', i: '😅', anim: 'sweat', dur: 1600 },
  { id: 1, n: 'Finger Guns', i: '👌', anim: 'guns', dur: 1500 },
  { id: 2, n: 'Sly Shake', i: '🫨', anim: 'shake', dur: 1800 },
  { id: 3, n: 'Cash Count', i: '💵', anim: 'count', dur: 2200 },
  { id: 4, n: 'Dramatic Gasps', i: '😲', anim: 'gasp', dur: 1500 },
  { id: 5, n: 'Slow Clap', i: '👏', anim: 'clap', dur: 2400 },
  { id: 6, n: 'Point Accuse', i: '☝️', anim: 'point', dur: 1700 },
  { id: 7, n: 'Shrug', i: '🤷', anim: 'shrug', dur: 1400 },
  { id: 8, n: 'Bow, Mocking', i: '🙇', anim: 'bow', dur: 2000 },
  { id: 9, n: 'Wiggle Taunt', i: '🕺', anim: 'wiggle', dur: 2600 },
  { id: 10, n: 'Handshake Ready', i: '🫱', anim: 'hand', dur: 1600 },
  { id: 11, n: 'Fake Cry', i: '🥲', anim: 'cry', dur: 2400 },
];

// ── quick chat. Original, contextual, and mapped to situations so it reads
//    like a real table of friends panicking. ─────────────────────────────────
export const CHAT_GROUPS = [
  {
    id: 'heat', label: 'Reassure', icon: '🫶',
    lines: [
      'Look at my face. Honest face.',
      'I would never fold on you here.',
      'My record at this table is spotless.',
      'You\u2019re safe with me, obviously.',
      'Take it from someone who cares.',
      'I have nothing to gain from your pain.',
      'Swearing on my lucky duck.',
    ],
  },
  {
    id: 'doubt', label: 'Sow Doubt', icon: '🌩️',
    lines: [
      'Ask them why their hands are moving.',
      'Interesting that they answered first.',
      'I\u2019d want to know what\u2019s in the left case.',
      'Not saying lying. Saying... performing.',
      'Nobody watched them switch it. Nobody.',
      'Their smile came 2 seconds late.',
      'Follow the money, then follow them.',
    ],
  },
  {
    id: 'deal', label: 'Deal', icon: '📜',
    lines: [
      'Two minutes, clean paperwork, we both win.',
      'I\u2019ll sign if someone else signs first.',
      'Name a number I can pretend to hate.',
      'I\u2019m one honest sentence from rich.',
      'Split it 60/40 and I\u2019ll feel generous.',
      'Take the trade or keep the regret.',
    ],
  },
  {
    id: 'panic', label: 'Panic', icon: '',
    lines: [
      'Who gave you permission?!',
      'This is fine. I am unwell. This is fine.',
      'Somebody insure me, quickly.',
      'I trusted a stranger at a shady table.',
      'That was MY envelope!!',
      'I want a new starting life, please.',
    ],
  },
  {
    id: 'gloat', label: 'Gloat', icon: '😎',
    lines: [
      'That was craft, not luck.',
      'Thank you, I\u2019ll be here all round.',
      'Play me again. Louder this time.',
      'The table applauded me internally.',
      'I lied beautifully and you paid for it.',
    ],
  },
  {
    id: 'claim', label: 'Claim', icon: '🗣️',
    lines: [
      'I\u2019m holding nothing worth stealing.',
      'The only thing I hid is modesty.',
      'Check my pockets, I dare you.',
      'I picked that case before any of you spoke.',
      'If I\u2019m the mole, I\u2019m a terrible mole.',
    ],
  },
];
export const CHAT_LINES = CHAT_GROUPS.flatMap((g) => g.lines.map((l) => ({ g: g.id, l })));

// ── outcome tags shown in the reveal & the feed ──────────────────────────────
export const TAGS = {
  SCAM_SUCCESS: { n: 'SCAM SUCCESS', c: '#ff3d7f', i: '🎭' },
  TRICK_FAILED: { n: 'TRICK FAILED', c: '#8b8fb5', i: '💨' },
  GOOD_CALL: { n: 'GOOD CALL', c: '#39e6a0', i: '🎯' },
  WRONG_ACCUSE: { n: 'WRONG ACCUSATION', c: '#ff7a45', i: '' },
  BIG_WIN: { n: 'BIG WIN', c: '#ffd23f', i: '💰' },
  CLEVER: { n: 'CLEVER', c: '#5ad1ff', i: '🧠' },
  OUCH: { n: 'OUCH', c: '#c04a5a', i: '🩹' },
  PAID: { n: 'PAID OUT', c: '#9be36b', i: '🪙' },
  VOID: { n: 'DEAL VOID', c: '#a2a6c8', i: '🫥' },
  INSURED: { n: 'INSURED', c: '#4fd1c5', i: '🛡️' },
  JOB: { n: 'ROLE OBJECTIVE', c: '#ffb020', i: '★' },
  NOTHING: { n: 'STILL BROKE', c: '#7c81a8', i: '🍃' },
};

// ── reveal reactions: original flavour keyed on what actually happened ───────
export const REACTIONS = {
  [TAGS.SCAM_SUCCESS.n]: [
    'Signed, sealed, no regrets.', 'That was a whole performance.', 'Do you clap? You should not clap.',
    'The envelope was a lie and so was I.',
  ],
  [TAGS.TRICK_FAILED.n]: [
    'So close. So visibly bad at it.', 'The whole room heard that plan fail.', 'Bold. Wrong. Bold.',
  ],
  [TAGS.GOOD_CALL.n]: [
    'Instinct of a hungry seagull.', 'Court is in session and you were right.',
  ],
  [TAGS.WRONG_ACCUSE.n]: [
    'Pointed at the wrong honest person.', 'That was the calmest innocent hand at the table.',
  ],
  [TAGS.BIG_WIN.n]: ['Table is yours. Dignity is not.', 'Absurd. Unfair. Repeat it.'],
  [TAGS.OUCH.n]: ['Insured by nobody. Bold.', 'That number is going in the group chat.'],
  [TAGS.INSURED.n]: ['Someone took the hit for you. Rude of them.', 'A bodyguard! At this price?!'],
};

export const ANNOUNCER = {
  roundStart: [
    'Deals open. Feelings optional.',
    'Everyone is lying a little. Even the quiet one.',
    'Table is hot. Hands are clean. Allegedly.',
    'Welcome back to the worst ideas of your night.',
    'Paperwork ready. Trust level: cute.',
  ],
  submit: [
    'Lock it in. Commit to the bit.',
    'Timer running. Panic professionally.',
    'Choose now, explain later.',
    'Last chance to be a better person. Don\u2019t.',
  ],
  reveal: [
    'Lights down. Receipts up.',
    'Here comes the part where friends become evidence.',
    'Opening envelopes. Sit down.',
    'Reveal time: someone in this room feels sick.',
  ],
  results: [
    'Scores updated. Reputations not.',
    'Chips moved. Trust did not.',
    'The ledger is unbothered.',
  ],
  final: [
    'The house thanks you for your questionable choices.',
    'Somebody here is a menace and it is statistically you.',
    'Glorious, unhinged, and profitable.',
  ],
};

export const TIPS = [
  'Flagging a player costs you nothing — unless you flag the wrong face.',
  'A Deal can be accepted during the Reckoning. Wait. Squirm. Accept.',
  'Insiders get in trouble for using the truth out loud.',
  'Pushing a safe pick is how Risk Takers eat.',
  'Every round the roles are dealt again. Nobody here is trustworthy all night.',
  'Emote over a suspicious player to make them sweat.',
];

// ── cosmetics (progression shop, priced in lifetime chips) ───────────────────
export const COSM = {
  skin: [
    { id: 0, n: 'Fair', c: '#f4d0b8' }, { id: 1, n: 'Sand', c: '#e6b48c' },
    { id: 2, n: 'Amber', c: '#c98a5c' }, { id: 3, n: 'Clay', c: '#a2663f' },
    { id: 4, n: 'Cocoa', c: '#77462c' }, { id: 5, n: 'Espresso', c: '#4e2e1f' },
    { id: 6, n: 'Mint', c: '#bfe6d2', cost: 600, tier: 2 }, { id: 7, n: 'Slate', c: '#9fa8bd', cost: 600, tier: 2 },
    { id: 8, n: 'Peach Pop', c: '#ffc0a0', cost: 1200, tier: 3 }, { id: 9, n: 'Lilac', c: '#d3c0ea', cost: 1200, tier: 3 },
  ],
  face: [
    { id: 0, n: 'Cheeky', cost: 0 }, { id: 1, n: 'Sleepy', cost: 0 }, { id: 2, n: 'Narrow', cost: 0 },
    { id: 3, n: 'Round Eyes', cost: 250 }, { id: 4, n: 'Bedroom Eyes', cost: 250 },
    { id: 5, n: 'Unimpressed', cost: 400 }, { id: 6, n: 'Gremlin', cost: 700 },
    { id: 7, n: 'Worried Owl', cost: 700 }, { id: 8, n: 'Star Eyes', cost: 1100 },
    { id: 9, n: 'Laser Grin', cost: 1600, tier: 3 },
  ],
  hair: [
    { id: -1, n: 'Bald', cost: 0 }, { id: 0, n: 'Slick', cost: 0 }, { id: 1, n: 'Bubble', cost: 0 },
    { id: 2, n: 'Spikes', cost: 200 }, { id: 3, n: 'Curl Cloud', cost: 200 },
    { id: 4, n: 'Ponytail', cost: 350 }, { id: 5, n: 'Bob Cut', cost: 350 },
    { id: 6, n: 'Tall Fade', cost: 600 }, { id: 7, n: 'Messy Mop', cost: 600 },
    { id: 8, n: 'Space Buns', cost: 900 }, { id: 9, n: 'Mullet', cost: 1300, tier: 3 },
  ],
  hat: [
    { id: -1, n: 'None', cost: 0 }, { id: 0, n: 'Bowler', cost: 150 }, { id: 1, n: 'Flat Cap', cost: 150 },
    { id: 2, n: 'Bucket', cost: 300 }, { id: 3, n: 'Top Hat', cost: 500 },
    { id: 4, n: 'Chef Toque', cost: 500 }, { id: 5, n: 'Visor', cost: 350 },
    { id: 6, n: 'Paper Bag', cost: 800 }, { id: 7, n: 'Crown of Spoons', cost: 1500, tier: 3 },
    { id: 8, n: 'Halo (rented)', cost: 1800, tier: 3 },
  ],
  glasses: [
    { id: -1, n: 'None', cost: 0 }, { id: 0, n: 'Round Specs', cost: 150 }, { id: 1, n: 'Sharp Rects', cost: 150 },
    { id: 2, n: 'Shades', cost: 300 }, { id: 3, n: 'Monocle', cost: 500 },
    { id: 4, n: 'Sleep Mask', cost: 450 }, { id: 5, n: 'Spy Goggles', cost: 1100, tier: 3 },
  ],
  shirt: [
    { id: 0, n: 'Plain Tee', cost: 0 }, { id: 1, n: 'Shirt', cost: 0 }, { id: 2, n: 'Hoodie', cost: 200 },
    { id: 3, n: 'Waistcoat', cost: 400 }, { id: 4, n: 'Track Jacket', cost: 400 },
    { id: 5, n: 'Tuxedo', cost: 900 }, { id: 6, n: 'Cuban Shirt', cost: 550 },
    { id: 7, n: 'Denim Oversize', cost: 550 }, { id: 8, n: 'Botanical Tee', cost: 800 },
  ],
  pants: [
    { id: 0, n: 'Straight', cost: 0 }, { id: 1, n: 'Baggy', cost: 150 }, { id: 2, n: 'Pleated', cost: 150 },
    { id: 3, n: 'Shorts', cost: 250 }, { id: 4, n: 'Cargo', cost: 400 }, { id: 5, n: 'Bell Bottoms', cost: 650 },
  ],
  shoes: [
    { id: 0, n: 'Plimsolls', cost: 0 }, { id: 1, n: 'Chunky Sneaks', cost: 200 },
    { id: 2, n: 'Loafers', cost: 250 }, { id: 3, n: 'Wellies', cost: 400 },
    { id: 4, n: 'Winged Tips', cost: 900 }, { id: 5, n: 'Moon Boots', cost: 1200 },
  ],
  acc: [
    { id: -1, n: 'None', cost: 0 }, { id: 0, n: 'Shoulder Duck', cost: 300 }, { id: 1, n: 'Gold Chain', cost: 450 },
    { id: 2, n: 'Pocket Watch', cost: 450 }, { id: 3, n: 'Sneaky Briefcase', cost: 600 },
    { id: 4, n: 'Parrot (informant)', cost: 1000 }, { id: 5, n: 'Tiny Crown', cost: 1400, tier: 3 },
    { id: 6, n: 'Wrist Cuffs', cost: 1600, tier: 3 },
  ],
  color: [
    { id: 0, n: 'Tomato', c: '#e8564f' }, { id: 1, n: 'Marigold', c: '#f2b230' },
    { id: 2, n: 'Moss', c: '#4f9d69' }, { id: 3, n: 'Deep Sea', c: '#2b6ca3' },
    { id: 4, n: 'Plum', c: '#6c4287' }, { id: 5, n: 'Chili', c: '#b3382f' },
    { id: 6, n: 'Bone', c: '#e8e2d2' }, { id: 7, n: 'Ink', c: '#252a3a' },
    { id: 8, n: 'Teal', c: '#1f8f8a', cost: 300 }, { id: 9, n: 'Bubblegum', c: '#f56fae', cost: 300 },
    { id: 10, n: 'Lilac', c: '#a48ce0', cost: 500 }, { id: 11, n: 'Copper', c: '#c1743a', cost: 500 },
    { id: 12, n: 'Neon Lime', c: '#b6f24a', cost: 900, tier: 3 }, { id: 13, n: 'Holo White', c: '#eef6ff', cost: 1200, tier: 3 },
  ],
};
export const COSM_SLOTS = ['skin', 'face', 'hair', 'hat', 'glasses', 'shirt', 'pants', 'shoes', 'acc'];

export function defaultAvatar() {
  return { skin: 1, face: 0, hair: 1, hat: -1, glasses: -1, shirt: 1, pants: 0, shoes: 0, acc: -1, color: 3, hairColor: 7, name: 'You' };
}

export function validateAvatar(a) {
  const d = defaultAvatar();
  const o = {};
  for (const k of ['skin', 'face', 'hair', 'hat', 'glasses', 'shirt', 'pants', 'shoes', 'acc']) {
    const arr = COSM[k];
    const v = Number(a && a[k]);
    o[k] = Number.isFinite(v) && arr.some((c) => c.id === v) ? v : d[k];
  }
  for (const k of ['color', 'hairColor']) {
    const v = Number(a && a[k]);
    o[k] = Number.isFinite(v) && v >= 0 && v < COSM.color.length ? v : d[k];
  }
  return o;
}

// ── room settings ─────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  rounds: 6,
  turnMs: 55,            // TALK length (seconds)
  submitMs: 30,
  briefMs: 14,
  private: true,
  chat: true,
  minigames: true,
  tells: 1,              // 0 blind, 1 subtle, 2 generous
  bots: 0,
};
export const SETTINGS_META = [
  { k: 'rounds', label: 'Rounds', min: 3, max: 10, step: 1, unit: '' },
  { k: 'turnMs', label: 'Deal time', min: 25, max: 120, step: 5, unit: 's' },
  { k: 'submitMs', label: 'Reckoning', min: 12, max: 60, step: 3, unit: 's' },
  { k: 'briefMs', label: 'Secrets', min: 6, max: 30, step: 2, unit: 's' },
];
export const TOGGLE_META = [
  { k: 'private', label: 'Private room', help: 'Only friends with the code can enter' },
  { k: 'chat', label: 'Table talk', help: 'Quick chat and typing allowed' },
  { k: 'minigames', label: 'Insert minigames', help: 'Short trust games between big rounds' },
  { k: 'tells', label: 'Micro-tells', min: 0, max: 2, step: 1, labelOff: 'Blind', labels: ['Blind', 'Subtle', 'Generous'], help: 'Nervous tics you can read on other players' },
];

// ═════════════════════════════════════════════════════════════════════════════
//  ROUND HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function money(r, base) { return Math.round((base + r() * base * 0.8) / 10) * 10; }

function dealGoods(ctx, each) {
  const ids = shuffle(ctx.rng, GOODS.map((g) => g.id));
  let i = 0;
  for (const pid of ctx.pids) {
    const hand = [];
    for (let k = 0; k < each; k++) {
      const gid = ids[i++ % ids.length];
      const g = GOOD_BY_ID[gid];
      hand.push({ uid: 'i' + pid + '_' + k, gid, v: g.v, fake: false });
    }
    ctx.R.inv[pid] = hand;
  }
  // decide which of the hands carry a counterfeit
  for (const pid of ctx.pids) {
    const hand = ctx.R.inv[pid];
    if (ctx.rng() < 0.45) hand[0].fake = true;
    if (hand.length > 1 && ctx.flip() < 0.18) hand[1].fake = true;
  }
}

export function holdsOf(ctx, pid) { return (ctx.R.inv[pid] || []).length ? ctx.R.inv[pid] : []; }
export function worth(ctx, pid) {
  return (ctx.R.inv[pid] || []).reduce((s, it) => s + (it.fake ? -Math.round(it.v * 0.5) : it.v), 0);
}

// ═════════════════════════════════════════════════════════════════════════════
//  DECEPTION ROUNDS
// ═════════════════════════════════════════════════════════════════════════════
export const ROUNDS = [];
const DEF = (o) => { ROUNDS.push(o); return o; };

// ── 1 · Case The Joint ──────────────────────────────────────────────────────
DEF({
  id: 'cases', kind: 'deception', title: 'Case The Joint', icon: '🧳',
  blurb: 'Sealed cases on the table. One of them is stupidly valuable. One of you has gloved hands.',
  offers: false, accuse: true, push: true,
  beatIntro: 'The cases spin.',
  begin(ctx) {
    const n = clamp(ctx.pids.length + 1, 3, 6);
    const jackpot = money(ctx.rng, 420) + ctx.pids.length * 30;
    const cases = [];
    for (let i = 0; i < n; i++) cases.push({ id: i, v: 0, label: String.fromCharCode(65 + i) });
    const order = shuffle(ctx.rng, cases.map((c) => c.id));
    cases[order[0]].v = jackpot;
    for (let i = 1; i < order.length; i++) {
      const c = cases[order[i]];
      c.v = ctx.rng() < 0.28 ? 40 : money(ctx.rng, 140);
    }
    ctx.R.cases = cases;
    ctx.R.pub.cases = cases.map((c) => ({ id: c.id, label: c.label, opened: false }));
    ctx.R.jackpot = jackpot;
    for (const pid of ctx.pids) ctx.sec(pid, { pick: null, swap: null, peeked: null });
  },
  optionsFor(ctx, pid) {
    const o = ctx.R.pub.cases.map((c) => ({ id: 'c' + c.id, label: 'Case ' + c.label, icon: '🧳', hint: 'Sealed. Contents unknown to you.' }));
    o.push({ id: 'hush', label: 'Sell pick back to house', icon: '🪙', hint: 'Take 160 guaranteed and walk.', style: 'safe' });
    return o;
  },
  actionsFor(ctx, pid) {
    const a = [];
    const role = ctx.roleOf(pid);
    const unswapped = !ctx.R.sec[pid]?.swap;
    if (role === 'trickster' && unswapped) a.push({ id: 'swap', label: 'Palm a switch', icon: '🫰', targets: 'cases', hint: 'Swap two cases. Nobody saw. Nobody?' });
    if (role === 'detective' && ctx.R.sec[pid]?.peeked == null) a.push({ id: 'peek', label: 'Lift a seal', icon: '🔍', targets: 'cases', hint: 'Look inside one case before locking.' });
    if (role === 'insider' && !ctx.R.sec[pid]?.peeked2) a.push({ id: 'peekPick', label: 'Read a hand', icon: '🗝️', targets: 'others', hint: 'See what someone intends to take.' });
    return a;
  },
  onAction(ctx, pid, id, p) {
    const s = ctx.R.sec[pid];
    if (id === 'swap') {
      const [a, b] = (p?.cases || []).slice(0, 2).map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return false;
      const ca = ctx.R.cases[a], cb = ctx.R.cases[b];
      if (!ca || !cb) return false;
      ctx.R.cases[a] = cb; ctx.R.cases[b] = ca;
      s.swap = [a, b]; s.trick = { kind: 'swap', a, b };
      ctx.beat({ kind: 'trick', pid, text: 'switched Case ' + String.fromCharCode(65 + a) + ' with Case ' + String.fromCharCode(65 + b), tone: 'trick', focus: pid });
      return true;
    }
    if (id === 'peek') {
      const a = Number(p?.cases?.[0]);
      if (!Number.isInteger(a) || !ctx.R.cases[a]) return false;
      s.peeked = ctx.R.cases[a].v; s.peekedLabel = String.fromCharCode(65 + a);
      return true;
    }
    if (id === 'peekPick') {
      const t = p?.target;
      if (!ctx.P[t]) return false;
      s.peeked2 = t;
      return true;
    }
    return false;
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid] || {};
    const rows = [];
    if (s.peeked != null) rows.push({ k: 'Case ' + s.peekedLabel + ' holds', v: fmt(s.peeked) + ' chips', good: s.peeked > 200 });
    if (s.peeked2) rows.push({ k: ctx.P[s.peeked2].name + ' intends', v: ctx.R.sec[s.peeked2]?.commitLabel || 'unknown yet' });
    return { head: 'You are at the table with ' + ctx.R.pub.cases.length + ' cases.', sub: 'The ' + fmt(ctx.R.jackpot) + ' chip prize is in exactly one of them.', rows };
  },
  resolve(ctx) {
    const picks = [];
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      const cid = s.commit && s.commit.startsWith('c') ? Number(s.commit.slice(1)) : -1;
      if (s.commit === 'hush') {
        ctx.award(pid, 160, 'PAID', 'Sold their nerve back to the house');
        picks.push({ pid, label: 'Cash-out', v: 160 });
        continue;
      }
      let c = ctx.R.cases[cid];
      let original = null;
      // protector insured someone whose case was switched
      if (c && s.insuredBy != null && s.swap && s.swap.includes(cid)) {
        original = ctx.R.cases[s.swap.find((x) => x !== cid)];
      }
      if (original && (original.v > c.v)) c = original;
      let v = c ? c.v : 90;
      let tag = v >= ctx.R.jackpot * 0.85 ? 'BIG_WIN' : v >= 200 ? 'PAID' : v <= 60 ? 'OUCH' : 'PAID';
      if (s.push) {
        if (v >= ctx.R.jackpot * 0.5) { v = Math.round(v * 1.9); tag = 'BIG_WIN'; } else { v = -130; tag = 'OUCH'; }
      }
      ctx.award(pid, v, tag, c ? 'Case ' + c.label : 'no case');
      picks.push({ pid, label: c ? 'Case ' + c.label + ' → ' + fmt(v) : 'Nothing', v });
      ctx.beat({ kind: 'choice', pid, text: c ? 'took Case ' + c.label + ' — inside: ' + fmt(ctx.R.cases[cid]?.v ?? 0) + ' chips' : 'took nothing', tone: v > 0 ? 'good' : 'bad', focus: pid });
    }
    // trickster payoff
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (!s.trick) continue;
      const hurt = picks.some((p) => p.pid !== pid && p.v <= 90);
      const caught = ctx.caughtBy(pid);
      if (hurt && !caught) ctx.award(pid, 260, 'SCAM_SUCCESS', 'A whole table of duds, one set of gloves');
      else if (caught) ctx.award(pid, -180, 'TRICK_FAILED', 'Named mid-swap');
      else ctx.award(pid, 40, 'TRICK_FAILED', 'Switched nothing that mattered');
    }
    roleObjectives(ctx, picks);
  },
});

// ── 2 · Fakes & Files ───────────────────────────────────────────────────────
DEF({
  id: 'counterfeit', kind: 'deception', title: 'Fakes & Files', icon: '️',
  blurb: 'Two items each. Some are counterfeit. Make a deal, or become the person holding the junk.',
  offers: true, loophole: true, accuse: true, push: false,
  beatIntro: 'Goods are laid out under the lamp.',
  begin(ctx) {
    dealGoods(ctx, 2);
    ctx.R.pub.gossip = pick(ctx.rng, [
      'House note: at least one item on this table is a forgery.',
      'House note: the fakes are warmer to the touch.',
      'House note: counterfeit goods burn holes in pockets.',
    ]);
    for (const pid of ctx.pids) ctx.sec(pid, { audited: null, salted: null });
  },
  secretCard(ctx, pid) {
    const hand = holdsOf(ctx, pid);
    return {
      head: 'Your two items. Only you know which one disappoints.',
      rows: hand.map((it) => ({ k: GOOD_BY_ID[it.gid].n, v: (it.fake ? 'COUNTERFEIT — worth ' + fmt(it.v) + ' in shame' : 'genuine · ' + fmt(it.v)), good: !it.fake, icon: GOOD_BY_ID[it.gid].i })),
      sub: ctx.R.pub.gossip,
    };
  },
  resolve(ctx) {
    for (const pid of ctx.pids) {
      const hand = holdsOf(ctx, pid);
      let v = 0, fake = 0, real = 0;
      for (const it of hand) { if (it.fake) { v -= Math.round(it.v * 0.55); fake++; } else { v += it.v; real++; } }
      if (ctx.roleOf(pid) === 'trader') v = Math.round(v * 1.15) + 40;
      if (!hand.length) { v += 70; }
      const tag = v > 260 ? 'BIG_WIN' : v > 0 ? 'PAID' : v > -140 ? 'NOTHING' : 'OUCH';
      ctx.award(pid, v, tag, real + ' genuine / ' + fake + ' counterfeit');
      ctx.beat({ kind: 'goods', pid, text: hand.map((it) => GOOD_BY_ID[it.gid].i + ' ' + GOOD_BY_ID[it.gid].n + (it.fake ? ' (fake!)' : '')).join(' · ') || 'pockets empty', tone: v > 0 ? 'good' : 'bad', focus: pid });
    }
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (s.salted) {
        const caught = ctx.caughtBy(pid);
        const victim = ctx.R.sec[s.salted];
        const victimHoldsFake = holdsOf(ctx, s.salted).some((it) => it.fake);
        if (victimHoldsFake && !caught) ctx.award(pid, 210, 'SCAM_SUCCESS', 'Planted a dud, walked away clean');
        else if (caught) ctx.award(pid, -170, 'TRICK_FAILED', 'Caught with the glue still out');
        else ctx.award(pid, 30, 'TRICK_FAILED', 'Planted a dud nobody cared about');
        if (victim && victim.auditedBy != null) ctx.award(victim.auditedBy, 150, 'GOOD_CALL', 'audited the right hands');
      }
      if (s.auditedBy != null) {
        // an audit that found nothing costs the auditor
        if (!holdsOf(ctx, pid).some((it) => it.fake)) ctx.award(s.auditedBy, -80, 'WRONG_ACCUSE', 'audited an innocent folder');
      }
    }
    roleObjectives(ctx, []);
  },
  actionsFor(ctx, pid) {
    const a = [];
    const role = ctx.roleOf(pid), s = ctx.R.sec[pid] || {};
    if (role === 'trickster' && !s.salted) a.push({ id: 'salt', label: 'Palm a dud onto them', icon: '🫳', targets: 'one', hint: 'Move one of YOUR counterfeits into their bag.' });
    if (role === 'detective' && s.audited == null) a.push({ id: 'audit', label: 'Audit their goods', icon: '🔍', targets: 'one', hint: 'Fake found: it is confiscated and you are paid. Nothing found: you pay.' });
    if (role === 'insider' && !s.peekedItem) a.push({ id: 'peekItems', label: 'Check their bag', icon: '🗝️', targets: 'one' });
    return a;
  },
  onAction(ctx, pid, id, p) {
    const s = ctx.R.sec[pid];
    const t = p?.target;
    if (id === 'salt') {
      if (!ctx.P[t] || t === pid) return false;
      const hand = holdsOf(ctx, pid);
      const fi = hand.findIndex((it) => it.fake);
      if (fi < 0) return false;
      const item = hand.splice(fi, 1)[0];
      ctx.R.inv[t].push(item);
      s.salted = t; s.trick = { kind: 'salt', t };
      ctx.beat({ kind: 'trick', pid, text: 'slipped a counterfeit into ' + ctx.P[t].name + '’s bag', tone: 'trick', focus: pid });
      return true;
    }
    if (id === 'audit') {
      if (!ctx.P[t] || t === pid) return false;
      s.audited = t;
      const hand = holdsOf(ctx, t);
      const fakes = hand.filter((it) => it.fake).map((it) => GOOD_BY_ID[it.gid].n);
      s.auditResult = fakes.length ? fakes : ['nothing but honest junk'];
      if (fakes.length) { const fi = ctx.R.inv[t].findIndex((it) => it.fake); if (fi >= 0) ctx.R.inv[t].splice(fi, 1); }
      ctx.R.sec[t].auditedBy = pid;
      return true;
    }
    if (id === 'peekItems') {
      if (!ctx.P[t] || t === pid) return false;
      s.peekedItem = holdsOf(ctx, t).map((it) => GOOD_BY_ID[it.gid].n + (it.fake ? ' (fake)' : ' (real)'));
      return true;
    }
    return false;
  },
});

// ── 3 · Split The Stack ──────────────────────────────────────────────────────
DEF({
  id: 'backstab', kind: 'deception', title: 'Split The Stack', icon: '🪓',
  blurb: 'A stack of chips, a partner you chose, and exactly one button that ruins the friendship.',
  offers: false, accuse: true, push: true,
  beatIntro: 'Partners are read out. Oh no.',
  begin(ctx) {
    const order = shuffle(ctx.rng, ctx.pids.slice());
    const pairs = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    if (order.length % 2) pairs.push([order[order.length - 1], null]);
    ctx.R.pairs = pairs;
    ctx.R.pots = pairs.map((_, i) => 300 + i * 60 + Math.round(ctx.rng() * 180));
    ctx.R.pub.pairs = pairs.map((p, i) => ({ a: p[0], b: p[1], pot: ctx.R.pots[i], id: i }));
    for (const pid of ctx.pids) ctx.sec(pid, { pair: pairs.findIndex((p) => p.includes(pid)) });
  },
  secretCard(ctx, pid) {
    const i = ctx.R.sec[pid].pair;
    const pr = ctx.R.pub.pairs[i];
    const other = pr.a === pid ? pr.b : pr.a;
    return {
      head: 'Your partner for this stack: ' + (other ? ctx.P[other].name : 'the house itself'),
      sub: other ? 'They were dealt the same partner. One of you will be disappointed.' : 'No partner. The house takes the other half either way.',
      rows: [{ k: 'Stack on the table', v: fmt(pr.pot) + ' chips', good: true }],
    };
  },
  optionsFor(ctx, pid) {
    const role = ctx.roleOf(pid);
    const o = [
      { id: 'split', label: 'Split it honest', icon: '🤝', hint: 'Both sides walk with a share.', style: 'safe' },
      { id: 'grab', label: 'Grab the stack', icon: '🪓', hint: 'Everything, or nothing but shame.', style: 'danger' },
    ];
    if (role === 'trickster') o.push({ id: 'frame', label: 'Grab AND leave a note in their pocket', icon: '🎭', hint: 'You take more; they take the blame. Unless a Detective objects.', style: 'danger' });
    return o;
  },
  resolve(ctx) {
    const grabs = [];
    for (const [a, b] of ctx.R.pairs) {
      const pi = ctx.R.pairs.findIndex((p) => p[0] === a && p[1] === b);
      const pot = ctx.R.pots[pi];
      const ca = ctx.R.sec[a].commit, cb = b ? ctx.R.sec[b].commit : 'split';
      grabs.push({ a, b, ca, cb, pot });
      const res = settle2(ca, cb, pot, ctx, a, b);
      ctx.award(a, res.va, res.ta, res.wa);
      if (b) ctx.award(b, res.vb, res.tb, res.wb);
      ctx.beat({
        kind: 'choice', pid: a, focus: a, tone: res.va > 0 ? 'good' : 'bad',
        text: ctx.P[a].name + ': ' + (ca || 'split') + (b ? '  ·  ' + ctx.P[b].name + ': ' + (cb || 'split') : ''),
      });
      if (b && (res.va > 0) !== (res.vb > 0)) {
        const winner = res.va > res.vb ? a : b, loser = winner === a ? b : a;
        ctx.beat({ kind: 'story', pid: winner, focus: winner, tone: 'trick', text: 'double-crossed ' + ctx.P[loser].name + ' at the last second' });
      }
    }
    // frame payoffs & detective counters
    for (const g of grabs) {
      for (const pid of [g.a, g.b]) {
        if (!pid || ctx.R.sec[pid].commit !== 'frame') continue;
        const caught = ctx.caughtBy(pid);
        const other = pid === g.a ? g.b : g.a;
        if (caught) ctx.award(pid, -240, 'TRICK_FAILED', 'framed the wrong person in front of a Detective');
        else { ctx.award(pid, 240, 'SCAM_SUCCESS', 'a note in their pocket, chips in yours'); }
      }
    }
    roleObjectives(ctx, []);
  },
});
function settle2(ca, cb, pot, ctx, a, b) {
  const half = Math.round(pot * 0.5);
  let va = half, vb = half, ta = 'PAID', tb = 'PAID', wa = 'split the stack', wb = 'split the stack';
  if (ca === 'split' && cb === 'split') { va = half; vb = half; }
  else if (ca === 'grab' && cb === 'grab') { va = -170; vb = -170; ta = 'OUCH'; tb = 'OUCH'; wa = 'both swung, both missed'; wb = wa; }
  else if (ca === 'grab') { va = Math.round(pot * 0.82); vb = -140; ta = 'BIG_WIN'; tb = 'OUCH'; wa = 'grabbed it all'; wb = 'got the handle'; }
  else if (cb === 'grab') { va = -140; vb = Math.round(pot * 0.82); ta = 'OUCH'; tb = 'BIG_WIN'; wa = 'got the handle'; wb = 'grabbed it all'; }
  if (ca === 'frame') { va += 90; vb -= 130; ta = 'SCAM_SUCCESS'; }
  if (cb === 'frame') { vb += 90; va -= 130; tb = 'SCAM_SUCCESS'; }
  // protector insurance on a grabbed victim
  for (const [p, o] of [[a, b], [b, a]]) {
    if (!p) continue;
    const s = ctx.R.sec[p];
    if (s.insuredBy != null && s.commit !== 'grab') {
      const back = Math.min(220, -Math.min(0, p === a ? va : vb));
      if (back > 0) {
        if (p === a) va += back; else vb += back;
        ctx.award(s.insuredBy, 70, 'INSURED', 'took a hit for ' + ctx.P[p].name);
      }
    }
  }
  // risk push
  if (ctx.R.sec[a].push) { if (va > 0) { va = Math.round(va * 1.8); ta = 'BIG_WIN'; } else { va -= 90; ta = 'OUCH'; } }
  if (b && ctx.R.sec[b].push) { if (vb > 0) { vb = Math.round(vb * 1.8); tb = 'BIG_WIN'; } else { vb -= 90; tb = 'OUCH'; } }
  return { va, vb, ta, tb, wa, wb };
}

// ── 4 · Contract Roulette ───────────────────────────────────────────────────
DEF({
  id: 'contracts', kind: 'deception', title: 'Contract Roulette', icon: '📝',
  blurb: 'Three contracts, one of them a trap. Someone at the table has already read the fine print.',
  offers: false, accuse: true, push: true,
  beatIntro: 'Contracts face-down. Signatures up.',
  begin(ctx) {
    const ids = shuffle(ctx.rng, [0, 1, 2, 3]).slice(0, 3);
    const kinds = ['bonus', 'trap', 'neutral'];
    const deck = shuffle(ctx.rng, kinds);
    ctx.R.contracts = ids.map((_, i) => ({ id: i, kind: deck[i], title: pick(ctx.rng, [
      'Sunset Logistics', 'Bramble & Sons', 'The Quiet Courier', 'Marigold Holdings',
      'Two Cousins Ltd', 'Harbour Freight', 'Pickle Row Partners',
    ]), label: String.fromCharCode(185 + i) }));
    ctx.R.pub.contracts = ctx.R.contracts.map((c) => ({ id: c.id, title: c.title, label: c.label }));
    const pids = ctx.pids;
    const mole = pick(ctx.rng, pids);
    ctx.R.mole = mole;
    for (const pid of pids) ctx.sec(pid, { mole: pid === mole });
    if (mole != null) ctx.R.sec[mole].knowTrap = ctx.R.contracts.find((c) => c.kind === 'trap').id;
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    if (s.mole) {
      const t = ctx.R.contracts[s.knowTrap];
      return { head: 'You are the House\u2019s friend tonight.', sub: 'Do not get caught saying it out loud.', rows: [{ k: t.title + ' is a', v: 'TRAP — anyone who signs loses 240', bad: true }] };
    }
    return { head: 'Three contracts. One of you in this room knows which is the trap.', sub: 'The one who is too calm is either innocent or excellent.', rows: [] };
  },
  optionsFor(ctx, pid) {
    const o = ctx.R.pub.contracts.map((c) => ({ id: 'k' + c.id, label: 'Sign ' + c.title, icon: '📝', hint: 'Read once. Blind forever.' }));
    o.push({ id: 'walk', label: 'Walk away, bill the house', icon: '🚪', hint: '+70 and a clean shirt.', style: 'safe' });
    return o;
  },
  resolve(ctx) {
    const signedTrap = [];
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      const cid = s.commit && s.commit.startsWith('k') ? Number(s.commit.slice(1)) : -1;
      const c = ctx.R.contracts[cid];
      let v = 70, tag = 'PAID', why = 'walked away';
      if (c) {
        if (c.kind === 'bonus') { v = 300; tag = 'BIG_WIN'; why = 'hit the generous clause'; }
        else if (c.kind === 'trap') { v = -240; tag = 'OUCH'; why = 'signed the trap'; signedTrap.push(pid); }
        else { v = 110; tag = 'PAID'; why = 'dull, safe, paid'; }
      }
      if (s.push && c) { v = v > 0 ? Math.round(v * 1.9) : v - 80; if (v > 300) tag = 'BIG_WIN'; }
      if (s.insuredBy != null && v < 0) { const back = Math.min(240, -v); v += back; ctx.award(s.insuredBy, 80, 'INSURED', 'a signature witnessed in time'); tag = 'INSURED'; }
      ctx.award(pid, v, tag, why);
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: v > 0 ? 'good' : 'bad', text: (c ? c.title + ' — ' + c.kind : 'walked') });
    }
    const m = ctx.R.mole;
    if (m != null) {
      if (signedTrap.length) { ctx.award(m, 250, 'SCAM_SUCCESS', 'sold a trap with a smile'); }
      else { ctx.award(m, -70, 'TRICK_FAILED', 'nobody signed anything, what a waste'); }
      const named = ctx.pids.filter((p) => ctx.R.accuses[p] === m);
      if (named.length) ctx.award(m, -140, 'TRICK_FAILED', named.length + ' finger(s) found the mole');
      for (const p of named) ctx.award(p, 190, 'GOOD_CALL', 'named the House\u2019s friend');
    }
    roleObjectives(ctx, []);
  },
});

// ── 5 · Hot Parcel ──────────────────────────────────────────────────────────
DEF({
  id: 'parcel', kind: 'deception', title: 'Hot Parcel', icon: '📦',
  blurb: 'A parcel bounces around the table. Whoever holds it when the clock dies owns whatever it is.',
  offers: false, accuse: true, push: false, pass: true,
  beatIntro: 'The parcel is still warm.',
  begin(ctx) {
    const heat = ctx.rng() < 0.5;
    const loot = money(ctx.rng, 320);
    ctx.R.heat = heat;
    ctx.R.loot = heat ? -(260 + ctx.pids.length * 20) : loot;
    ctx.R.holder = pick(ctx.rng, ctx.pids);
    ctx.R.passCooldown = 0;
    ctx.R.pub.holder = ctx.R.holder;
    ctx.R.pub.parcelName = pick(ctx.rng, ['Fragile: Do Not Open', 'Live Crayfish (urgent)', 'Dentures For Two', 'Wet Cement, Handle Kindly']);
    ctx.R.passes = 0;
    for (const pid of ctx.pids) ctx.sec(pid, { scanned: false, offeredCover: null });
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    const rows = [];
    if (s.scanned) rows.push({ k: 'Thermal scan says', v: ctx.R.heat ? 'it is HOT. move it.' : 'it is clean loot. keep it?', good: !ctx.R.heat });
    return { head: 'The parcel is with ' + (ctx.P[ctx.R.holder]?.name || 'nobody'), sub: 'Passing is free. Being caught holding it is not.', rows };
  },
  actionsFor(ctx, pid) {
    const a = [];
    if (ctx.R.holder === pid) {
      a.push({ id: 'pass', label: 'Shove it at them', icon: '📦', targets: 'others', hint: 'Free. Immediate. Rude.' });
      a.push({ id: 'sign', label: 'Sign for it', icon: '🖋️', hint: 'Lock yourself in: you take what is inside, whatever it is.', style: 'danger' });
    }
    const role = ctx.roleOf(pid);
    if (role === 'detective' && !s(ctx, pid).scanned) a.push({ id: 'scan', label: 'Thermal scan', icon: '🔦', targets: 'none', hint: 'Is it hot? Only you learn.' });
    if (role === 'insider' && !s(ctx, pid).scanned) a.push({ id: 'scan', label: 'Listen at the box', icon: '🗝️', targets: 'none' });
    if (role === 'protector') a.push({ id: 'cover', label: 'Pre-pay their bail', icon: '🛡️', targets: 'one', hint: 'If it lands on them, you eat the loss.' });
    if (role === 'trickster') a.push({ id: 'relabel', label: 'Swap the shipping label', icon: '🎭', targets: 'one', hint: 'Change who the courier thinks owns it.' });
    return a;

    function s(c, p) { return c.R.sec[p] || {}; }
  },
  onAction(ctx, pid, id, p) {
    const s = ctx.R.sec[pid];
    const t = p?.target;
    if (id === 'pass') {
      if (ctx.R.holder !== pid || !ctx.P[t] || t === pid) return false;
      if (ctx.R.lastPass && ctx.now - ctx.R.lastPass < 2500) return false;
      ctx.R.lastPass = ctx.now;
      ctx.R.holder = t; ctx.R.pub.holder = t; ctx.R.passes++;
      s.moved = (s.moved || 0) + 1;
      ctx.beat({ kind: 'pass', pid, text: 'shoved ' + ctx.R.pub.parcelName + ' to ' + ctx.P[t].name, tone: 'trick' });
      return true;
    }
    if (id === 'sign') { s.signed = true; ctx.R.pub.signed = ctx.R.pub.signed || []; ctx.R.pub.signed.push(pid); return true; }
    if (id === 'scan') { if (s.scanned) return false; s.scanned = true; return true; }
    if (id === 'cover') {
      if (!ctx.P[t] || t === pid) return false;
      s.offeredCover = t; ctx.R.sec[t].insuredBy = pid; return true;
    }
    if (id === 'relabel') {
      if (!ctx.P[t] || t === pid) return false;
      if (s.relabel) return false;
      s.relabel = t; ctx.R.holder = t; ctx.R.pub.holder = t; ctx.R.passes++;
      ctx.beat({ kind: 'trick', pid, tone: 'trick', focus: pid, text: 'rewrote the label onto ' + ctx.P[t].name });
      return true;
    }
    return false;
  },
  resolve(ctx) {
    const holder = ctx.R.holder;
    const v = ctx.R.heat;
    ctx.beat({ kind: 'reveal', pid: holder, focus: holder, tone: v < 0 ? 'bad' : 'good', text: 'Inside the parcel: ' + (v < 0 ? 'heat, cuffs, and a strongly worded letter' : fmt(ctx.R.loot) + ' chips, wrapped in newspaper') });
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      let val = 0, tag = 'NOTHING', why = 'hands clean, pockets empty';
      if (pid === holder) {
        val = v; tag = v < 0 ? 'OUCH' : 'BIG_WIN';
        why = v < 0 ? 'caught holding it' : 'held the loot through the buzzer';
        if (s.signed && v < 0) { val = Math.round(v * 0.55); why = 'signed for it, but negotiated'; }
      } else if (s.signed) {
        val = Math.round(ctx.R.loot * 0.4); tag = ctx.R.loot > 0 ? 'PAID' : 'OUCH';
        why = 'co-signed, shared the outcome';
        if (ctx.R.loot < 0) val = 0;
      } else {
        val = 60 + (s.moved || 0) * 25;
        tag = (s.moved || 0) >= 2 ? 'CLEVER' : 'PAID';
        why = 'moved it ' + (s.moved || 0) + '×';
      }
      if (s.insuredBy != null && val < 0) { const back = Math.min(300, -val); val += back; ctx.award(s.insuredBy, 90, 'INSURED', 'bail paid for ' + ctx.P[pid].name); }
      ctx.award(pid, val, tag, why);
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: val >= 0 ? 'good' : 'bad', text: (pid === holder ? 'ended up holding it' : 'dropped it in time') + ' → ' + fmt(Math.abs(val)) });
    }
    const tr = ctx.pids.filter((p) => ctx.R.sec[p].relabel);
    for (const pid of tr) {
      const caught = ctx.caughtBy(pid);
      if (caught) ctx.award(pid, -190, 'TRICK_FAILED', 'rewrote a label in front of a witness');
      else if (ctx.R.heat < 0) { ctx.award(pid, 230, 'SCAM_SUCCESS', 'the label did its job'); }
      else ctx.award(pid, 30, 'TRICK_FAILED', 'label swap, zero consequences');
    }
    roleObjectives(ctx, []);
  },
});

// ── 6 · Vouch & Borrow ──────────────────────────────────────────────────────
DEF({
  id: 'vouch', kind: 'deception', title: 'Vouch & Borrow', icon: '💳',
  blurb: 'Everyone wants a loan. Everyone is also the bank. Reputation is the collateral.',
  offers: false, accuse: true, push: false,
  beatIntro: 'Ledgers open. Names get read.',
  begin(ctx) {
    for (const pid of ctx.pids) {
      ctx.sec(pid, { ask: 200, intent: 'repay', vouchFor: null, stake: 0, traced: null, forged: false });
    }
    ctx.R.loans = [150, 320, 560, 820];
    ctx.R.pub.note = 'A borrower who pays back keeps their line open. A runner burns every voucher behind them.';
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    const rows = [{ k: 'You intend to', v: s.intent === 'repay' ? 'PAY BACK' : 'DISAPPEAR', good: s.intent === 'repay' }];
    if (s.traced != null) rows.push({ k: 'You traced ' + ctx.P[s.traced].name, v: ctx.R.sec[s.traced].intent === 'repay' ? 'they intend to repay' : 'THEY INTEND TO RUN', good: ctx.R.sec[s.traced].intent === 'repay' });
    if (s.vouchedBy && s.vouchedBy.length) rows.push({ k: 'People backing you', v: s.vouchedBy.map((p) => ctx.P[p].name + ' (' + fmt(ctx.R.sec[p].stake) + ')').join(', ') });
    return { head: 'Your loan ask: ' + fmt(s.ask) + ' chips', sub: 'Approve = you get paid back on trust. Bolt = your vouchers pay for your exit.', rows };
  },
  optionsFor(ctx, pid) {
    return [
      { id: 'repay', label: 'Pay it back', icon: '🤝', hint: 'You profit less. Everyone profits more.', style: 'safe' },
      { id: 'bolt', label: 'Leave town', icon: '🏃', hint: 'Keep the loan. Lose the table.', style: 'danger' },
    ];
  },
  actionsFor(ctx, pid) {
    const a = [{ id: 'ask', label: 'Set loan size', icon: '💳', targets: 'none', hint: 'Ask for more, owe more faith.' }];
    const role = ctx.roleOf(pid);
    if (role === 'detective' && ctx.R.sec[pid].traced == null) a.push({ id: 'trace', label: 'Trace a borrower', icon: '🔍', targets: 'others', hint: 'Learn one person\u2019s true intent before locking.' });
    if (role === 'trickster' && !ctx.R.sec[pid].forged) a.push({ id: 'forge', label: 'Forge a signature', icon: '🎭', targets: 'one', hint: 'Pocket part of someone\u2019s stake.' });
    if (role === 'protector') a.push({ id: 'back', label: 'Back them extra', icon: '🛡️', targets: 'one', hint: 'Bigger stake on an honest borrower pays big.' });
    return a;
  },
  onAction(ctx, pid, id, p) {
    const s = ctx.R.sec[pid];
    const t = p?.target;
    if (id === 'ask') {
      const i = clamp(Number(p?.amount ?? 1), 0, ctx.R.loans.length - 1);
      s.ask = ctx.R.loans[i];
      return true;
    }
    if (id === 'trace') { if (!ctx.P[t] || t === pid) return false; s.traced = t; ctx.R.sec[t].tracedBy = pid; return true; }
    if (id === 'forge') {
      if (!ctx.P[t] || t === pid || s.forged) return false;
      const other = ctx.R.sec[t];
      if (!other.stake) return false;
      const steal = Math.round(other.stake * 0.6);
      s.forged = { t, steal };
      other.forged = (other.forged || 0) + steal;
      ctx.beat({ kind: 'trick', pid, tone: 'trick', focus: pid, text: 'copied a signature and lifted ' + fmt(steal) + ' from ' + ctx.P[t].name });
      return true;
    }
    if (id === 'back') { if (!ctx.P[t] || t === pid) return false; s.vouchFor = t; s.stake = 240; s.bigBack = true; ctx.R.sec[t].vouchedBy = ctx.R.sec[t].vouchedBy || []; ctx.R.sec[t].vouchedBy.push(pid); return true; }
    return false;
  },
  resolve(ctx) {
    // everyone also picks a borrower to back during SUBMIT via payload; default stake 120 on a random target
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (s.vouchFor == null) {
        const cand = ctx.pids.filter((p) => p !== pid);
        s.vouchFor = cand.length ? pick(ctx.rng, cand) : null;
        s.stake = 120;
        if (s.vouchFor != null) { ctx.R.sec[s.vouchFor].vouchedBy = ctx.R.sec[s.vouchFor].vouchedBy || []; ctx.R.sec[s.vouchFor].vouchedBy.push(pid); }
      }
    }
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      const backers = (s.vouchedBy || []);
      const total = backers.reduce((a, b) => a + (ctx.R.sec[b].stake || 0), 0);
      const funded = total >= s.ask;
      s.funded = funded;
      const repaid = s.commit !== 'bolt';
      let vb = 0, tag = 'PAID', why;
      if (!funded) { vb = 0; tag = 'NOTHING'; why = 'no one backed them, loan dead'; }
      else if (repaid) {
        vb = Math.round(s.ask * 0.62);
        tag = vb > 300 ? 'BIG_WIN' : 'PAID';
        why = 'borrowed ' + fmt(s.ask) + ' and paid like an adult';
        for (const b of backers) {
          const st = ctx.R.sec[b].stake || 0;
          const gain = Math.round(st * (ctx.R.sec[b].bigBack ? 0.55 : 0.42));
          ctx.award(b, gain, 'PAID', 'backed an honest borrower');
          ctx.beat({ kind: 'pay', pid: b, tone: 'good', text: ctx.P[b].name + ' collected ' + fmt(gain) + ' on ' + ctx.P[pid].name });
        }
      } else {
        vb = s.ask;
        tag = 'BIG_WIN';
        why = 'took the money and is already in another city';
        for (const b of backers) {
          const st = ctx.R.sec[b].stake || 0;
          ctx.award(b, -st, 'OUCH', 'was the collateral for a runner');
          ctx.beat({ kind: 'pay', pid: b, tone: 'bad', text: ctx.P[b].name + ' ate ' + fmt(st) + ' for trusting ' + ctx.P[pid].name });
        }
      }
      if (s.forged) vb -= 0;
      ctx.award(pid, vb, tag, why);
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: repaid ? 'good' : 'bad', text: ctx.P[pid].name + (repaid ? ' paid back' : ' ran') + (funded ? '' : ' (never funded)') });
    }
    // forgeries settle
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (!s.forged) continue;
      const caught = ctx.caughtBy(pid);
      if (caught) ctx.award(pid, -220, 'TRICK_FAILED', 'a forged signature with your handwriting on it');
      else { ctx.award(pid, s.forged.steal + 120, 'SCAM_SUCCESS', 'signature work'); ctx.award(s.forged.t, -Math.round(s.forged.steal * 0.5), 'OUCH', 'had a signature copied'); }
    }
    // correct accusations on runners
    for (const pid of ctx.pids) {
      const tgt = ctx.R.accuses[pid];
      if (tgt == null) continue;
      const ran = ctx.R.sec[tgt].commit === 'bolt';
      if (ran) ctx.award(pid, 170, 'GOOD_CALL', 'named a runner');
      else ctx.award(pid, -120, 'WRONG_ACCUSE', 'named someone who paid up');
    }
    roleObjectives(ctx, []);
  },
});

// ── 7 · Whisper Auction ─────────────────────────────────────────────────────
DEF({
  id: 'auction', kind: 'deception', title: 'Whisper Auction', icon: '🔨',
  blurb: 'Three mystery lots, secret bids, and one bidder with no intention of paying.',
  offers: false, accuse: true, bid: true, push: false,
  beatIntro: 'The gavel is warm. Bids are secret.',
  begin(ctx) {
    const lots = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const g = pick(ctx.rng, GOODS);
      const fake = ctx.rng() < 0.4;
      lots.push({ id: i, gid: g.id, name: g.n, value: fake ? -Math.round(g.v * 0.6) : g.v + rint(ctx.rng, -40, 90), fake });
    }
    ctx.R.lots = lots;
    ctx.R.lot = 0;
    ctx.R.pub.lots = lots.map((l) => ({ id: l.id, name: 'Lot ' + (l.id + 1) + ': ' + l.name, desc: l.fake ? 'Provenance: vibes' : 'Provenance: one credible witness' }));
    for (const pid of ctx.pids) ctx.sec(pid, { verified: null, shill: null });
    ctx.R.tiers = [0, 120, 240, 420];
    ctx.R.pub.tiers = ctx.R.tiers;
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    const rows = [];
    if (s.verified != null) for (const k of Object.keys(s.verified)) rows.push({ k: ctx.R.lots[k].name, v: fmt(ctx.R.lots[k].value) + ' (verified)', good: ctx.R.lots[k].value > 0 });
    return { head: 'Bids are secret. Overpaying is public.', sub: 'Winner pays their bid for the lot. Everyone else keeps their wallet shut.', rows };
  },
  actionsFor(ctx, pid) {
    const a = [];
    const role = ctx.roleOf(pid);
    if (role === 'detective') a.push({ id: 'verify', label: 'Appraise a lot', icon: '🔍', targets: 'lots', hint: 'True value revealed to you only.' });
    if (role === 'trickster' && ctx.R.sec[pid].shill == null) a.push({ id: 'shill', label: 'Shill the room', icon: '🎭', targets: 'lots', hint: 'Post a bid you never pay. Watch them chase it.' });
    return a;
  },
  onAction(ctx, pid, id, p) {
    const s = ctx.R.sec[pid];
    if (id === 'verify') {
      const li = Number(p?.lots?.[0]);
      if (!ctx.R.lots[li]) return false;
      s.verified = s.verified || {}; s.verified[li] = true;
      return true;
    }
    if (id === 'shill') {
      const li = Number(p?.lots?.[0]);
      if (!ctx.R.lots[li] || s.shill != null) return false;
      s.shill = li;
      s.ghostBid = ctx.R.tiers[3] + rint(ctx.rng ?? ctx.rng, 20, 90);
      ctx.beat({ kind: 'trick', pid, tone: 'trick', focus: pid, text: 'whispered a huge fake bid on ' + ctx.R.lots[li].name });
      return true;
    }
    return false;
  },
  optionsFor(ctx, pid) {
    const l = ctx.R.lots[ctx.R.lot];
    if (!l) return [];
    return ctx.R.tiers.map((t, i) => ({
      id: 'b' + i, label: t === 0 ? 'Pass' : 'Bid ' + fmt(t), icon: t === 0 ? '' : '',
      hint: t === 0 ? 'Live to overpay another day.' : 'Pay ' + fmt(t) + ' for ' + l.name + '.',
      style: t >= 420 ? 'danger' : t === 0 ? 'safe' : '',
    }));
  },
  resolve(ctx) {
    // single-round auction on lot 1 for pacing; other lots are noise, house keeps them
    const l = ctx.R.lots[0];
    const bids = ctx.pids.map((pid) => {
      const s = ctx.R.sec[pid];
      const idx = s.commit && s.commit.startsWith('b') ? Number(s.commit.slice(1)) : 0;
      return { pid, v: ctx.R.tiers[idx] || 0 };
    }).filter((b) => b.v > 0).sort((a, b) => b.v - a.v);
    ctx.beat({ kind: 'reveal', focus: null, tone: 'story', text: 'Under the hammer: ' + l.name + ' — true worth ' + fmt(l.value) + (l.fake ? ' (FORGERY)' : '') });
    if (!bids.length) {
      for (const pid of ctx.pids) ctx.award(pid, 40, 'NOTHING', 'nobody blinked, nobody ate');
      ctx.beat({ kind: 'story', text: 'The lot rots unsold. Everyone keeps their chips and their dignity.' });
    } else {
      const win = bids[0];
      const net = l.value - win.v;
      const tag = net > 140 ? 'BIG_WIN' : net > 0 ? 'PAID' : net > -180 ? 'TRICK_FAILED' : 'OUCH';
      ctx.award(win.pid, net, tag, 'paid ' + fmt(win.v) + ' for ' + l.name);
      ctx.beat({ kind: 'pay', pid: win.pid, focus: win.pid, tone: net > 0 ? 'good' : 'bad', text: ctx.P[win.pid].name + ' won it for ' + fmt(win.v) + (net >= 0 ? ' — a bargain!' : ' — ouch') });
      for (const b of bids.slice(1)) {
        const would = l.value - b.v;
        if (would > 120) ctx.beat({ kind: 'story', pid: b.pid, tone: 'story', text: ctx.P[b.pid].name + ' lost by ' + fmt(b.v - win.v) + ' and would have eaten well' });
      }
    }
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (s.shill == null) continue;
      const overpaid = bids.length && bids[0].v > Math.max(0, l.value) + 100;
      const caught = ctx.caughtBy(pid);
      if (caught) ctx.award(pid, -180, 'TRICK_FAILED', 'a shill bid with your ring on it');
      else if (overpaid) { ctx.award(pid, 240, 'SCAM_SUCCESS', 'they chased your ghost bid'); ctx.award(bids[0].pid, -0, 'VOID', 'chased a ghost'); }
      else ctx.award(pid, 20, 'TRICK_FAILED', 'nobody took the bait');
    }
    roleObjectives(ctx, []);
  },
});

// ── 8 · Ledger Laundry (2 truths, 1 performance) ────────────────────────────
DEF({
  id: 'ledger', kind: 'deception', title: 'Ledger Laundry', icon: '🧾',
  blurb: 'Three statements about this table. Two are facts. One is a costume. Sell the lie.',
  offers: true, loophole: true, accuse: true, push: false,
  beatIntro: 'Statements pinned to the board.',
  begin(ctx) {
    dealGoods(ctx, 2);
    for (const pid of ctx.pids) ctx.sec(pid, { statements: null, truthIndex: 1 });
    // build statements from the REAL state so bluffing has teeth
    for (const pid of ctx.pids) {
      const others = ctx.pids.filter((p) => p !== pid);
      const made = [];
      let guard = 0;
      while (made.length < 3 && guard++ < 40) {
        const subj = pick(ctx.rng, others);
        const hand = holdsOf(ctx, subj);
        const g = hand[Math.floor(ctx.rng() * Math.max(1, hand.length))];
        const kind = ctx.rng();
        let text, truth;
        if (kind < 0.45 && g) {
          truth = !g.fake;
          text = ctx.P[subj].name + ' is holding a genuine ' + GOOD_BY_ID[g.gid].n.toLowerCase();
        } else if (kind < 0.75 && g) {
          truth = ctx.P[subj] && ctx.R.inv[subj].indexOf(g) >= 0;
          text = ctx.P[subj].name + ' has ' + GOOD_BY_ID[g.gid].n.toLowerCase() + ' in their bag';
        } else {
          const chips = ctx.P[subj].chips;
          truth = chips >= 1200;
          text = ctx.P[subj].name + (truth ? ' is up on the night' : ' is down on the night') + ' (over 1200)';
        }
        made.push({ text, truth, subj });
      }
      const lieIdx = Math.floor(ctx.rng() * Math.max(1, made.length));
      if (made[lieIdx]) made[lieIdx].truth = false;
      ctx.R.sec[pid].statements = made;
      ctx.R.sec[pid].lieIdx = lieIdx;
    }
    ctx.R.pub.note = 'Pick the statement you want believed. The table picks who was lying.';
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    return {
      head: 'Your three statements. Sell one.',
      sub: 'If they believe your lie: you get paid. If they see through it: you do not.',
      rows: (s.statements || []).map((st, i) => ({ k: 'Option ' + (i + 1), v: st.text, good: st.truth, note: i === s.lieIdx ? '◀ this one is not true' : 'true' })),
    };
  },
  optionsFor(ctx, pid) {
    const s = ctx.R.sec[pid];
    return (s.statements || []).map((st, i) => ({ id: 's' + i, label: 'Read statement ' + (i + 1), icon: '️', hint: st.text }));
  },
  resolve(ctx) {
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      const i = s.commit && s.commit.startsWith('s') ? Number(s.commit.slice(1)) : 0;
      const st = (s.statements || [])[i] || { text: 'mumbled something', truth: true };
      s.readText = st.text; s.readLie = !st.truth;
      ctx.beat({ kind: 'story', pid, focus: pid, tone: 'story', text: ctx.P[pid].name + ' read: “' + st.text + '”' });
    }
    // each player names whose statement they think was the lie
    for (const pid of ctx.pids) {
      const tgt = ctx.R.accuses[pid];
      if (tgt == null || tgt === pid) { continue; }
      const lied = !!ctx.R.sec[tgt].readLie;
      if (lied) {
        ctx.award(pid, 170, 'GOOD_CALL', 'caught the lie');
        if (!ctx.R.liedCaught) ctx.R.liedCaught = {};
        ctx.R.liedCaught[tgt] = (ctx.R.liedCaught[tgt] || 0) + 1;
        ctx.beat({ kind: 'catch', pid, focus: tgt, tone: 'good', text: ctx.P[pid].name + ' called it: ' + ctx.P[tgt].name + ' was performing' });
      } else {
        ctx.award(pid, -120, 'WRONG_ACCUSE', 'accused a true statement');
        ctx.beat({ kind: 'catch', pid, focus: tgt, tone: 'bad', text: ctx.P[pid].name + ' called a lie on the truth' });
      }
    }
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      if (!s.readLie) { ctx.award(pid, 110, 'PAID', 'told the truth and survived'); continue; }
      const caught = (s.liedCaught || 0) > 0;
      if (caught) { ctx.award(pid, -140, 'TRICK_FAILED', 'a lie everybody saw'); }
      else { ctx.award(pid, 260, 'SCAM_SUCCESS', 'the table believed the costume'); }
    }
    roleObjectives(ctx, []);
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  MINIGAMES  (short; same spine: TRUST → DOUBT → DECISION → REVEAL)
// ═════════════════════════════════════════════════════════════════════════════
export const MINIGAMES = [];
const MG = (o) => { MINIGAMES.push({ ...o, kind: 'minigame', offers: false, accuse: false, push: false }); return o; };

MG({
  id: 'mg_suitcase', title: 'Two Cases, One Hint', icon: '🥫',
  blurb: 'One suitcase is a payday, one is a bill. One of you gets told which — maybe.',
  begin(ctx) {
    const good = Math.round(200 + ctx.rng() * 240);
    const bad = -Math.round(90 + ctx.rng() * 160);
    const pair = ctx.rng() < 0.5 ? [good, bad] : [bad, good];
    ctx.R.vals = pair;
    ctx.R.pub.names = ['Case of "Returns"', 'Case of "Definitely Not Returns"'];
    const told = pick(ctx.rng, ctx.pids);
    const honest = ctx.rng() < 0.6;
    const hintIdx = honest ? (pair[0] > 0 ? 0 : 1) : (pair[0] > 0 ? 1 : 0);
    for (const pid of ctx.pids) ctx.sec(pid, { told: pid === told ? ctx.R.pub.names[hintIdx] : null, shifty: pid === told && !honest });
    ctx.R.pub.hint = (ctx.P[told]?.name || 'Someone') + ' whispered: “' + ctx.R.pub.names[hintIdx] + ' is the good one.”';
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    return { head: s.told ? 'You were asked for a hint' : 'You get nothing. Use your ears.', sub: s.told ? (s.shifty ? 'You were misinformed on purpose. Enjoy watching.' : 'You were told the truth. You may lie about it.') : 'Someone at this table got a hint and we all heard there was a hint.', rows: s.told ? [{ k: 'Your "hint"', v: s.told, good: !s.shifty }] : [] };
  },
  optionsFor(ctx) {
    return ctx.R.pub.names.map((n, i) => ({ id: 'x' + i, label: n, icon: '🧳' }));
  },
  resolve(ctx) {
    for (const pid of ctx.pids) {
      const i = Number((ctx.R.sec[pid].commit || 'x0').slice(1));
      const v = ctx.R.vals[i] ?? 0;
      ctx.award(pid, v, v > 200 ? 'BIG_WIN' : v > 0 ? 'PAID' : 'OUCH', v > 0 ? 'opened the right case' : 'opened the loud case');
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: v > 0 ? 'good' : 'bad', text: ctx.P[pid].name + ' → ' + (v > 0 ? fmt(v) + ' chips' : 'a bill for ' + fmt(-v)) });
    }
  },
});

MG({
  id: 'mg_button', title: 'The Quiet Button', icon: '🔘',
  blurb: 'A button hides under one of five tiles. Whoever was "told" might be lying.',
  begin(ctx) {
    const n = 5;
    ctx.R.n = n;
    ctx.R.win = Math.floor(ctx.rng() * n);
    ctx.R.pub.tiles = Array.from({ length: n }, (_, i) => 'Tile ' + (i + 1));
    const told = pick(ctx.rng, ctx.pids);
    const lies = ctx.rng() < 0.5;
    const toldIdx = lies ? (ctx.R.win + 1 + Math.floor(ctx.rng() * (n - 1))) % n : ctx.R.win;
    for (const pid of ctx.pids) ctx.sec(pid, { clue: pid === told ? { idx: toldIdx, lying: lies } : null });
    ctx.R.pub.clue = (ctx.P[told]?.name || 'A friend') + ' points at ' + ctx.R.pub.tiles[toldIdx] + ' with total confidence.';
  },
  secretCard(ctx, pid) {
    const c = ctx.R.sec[pid].clue;
    return { head: c ? 'You are the pointer' : 'No clue for you. Watch a hand instead.', sub: c ? (c.lying ? 'You were given a WRONG tile and no one knows. Point anyway.' : 'You were given the true tile. Tell them, or don\u2019t.') : 'Everyone is guessing at the same five tiles.', rows: c ? [{ k: 'You will claim', v: ctx.R.pub.tiles[c.idx], good: !c.lying }] : [] };
  },
  optionsFor(ctx) { return ctx.R.pub.tiles.map((t, i) => ({ id: 't' + i, label: t, icon: '🔘' })); },
  resolve(ctx) {
    const hits = [];
    for (const pid of ctx.pids) {
      const i = Number((ctx.R.sec[pid].commit || 't0').slice(1));
      const ok = i === ctx.R.win;
      const v = ok ? 150 : -45;
      if (ctx.R.sec[pid].clue && ctx.R.sec[pid].clue.lying && ok) ctx.award(pid, 60, 'CLEVER', 'lied about the clue and still found it');
      ctx.award(pid, v, ok ? 'GOOD_CALL' : 'NOTHING', ok ? 'found the button' : 'nothing under there');
      if (ok) hits.push(pid);
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: ok ? 'good' : 'bad', text: ctx.P[pid].name + ' lifted ' + ctx.R.pub.tiles[i] + (ok ? ' — the button!' : ' — dust') });
    }
    if (!hits.length) ctx.beat({ kind: 'story', tone: 'story', text: 'Nobody found it. The button was under ' + ctx.R.pub.tiles[ctx.R.win] + ' the entire time.' });
    const c = ctx.pids.find((p) => ctx.R.sec[p].clue?.lying);
    if (c) ctx.award(c, 120, 'SCAM_SUCCESS', 'sent the whole table to the wrong tile');
  },
});

MG({
  id: 'mg_vault', title: 'Risky Vault', icon: '🛞',
  blurb: 'The dial opens on a hidden number. Below it, you keep your payout. Above it, the vault bites.',
  begin(ctx) {
    ctx.R.n = 1 + Math.floor(ctx.rng() * 9);
    for (const pid of ctx.pids) ctx.sec(pid, { spin: ctx.R.n < 5 ? 2 : 1 });
    ctx.R.pub.note = 'Vault hums somewhere between 1 and 9. Turn past it and you lose it all.';
  },
  secretCard(ctx, pid) {
    const s = ctx.R.sec[pid];
    return { head: 'You may dial up to ' + s.spin + ' time' + (s.spin > 1 ? 's' : '') + '.', sub: 'Each extra turn raises your take — and the chance the door swings on your fingers.', rows: [] };
  },
  optionsFor(ctx) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: 'd' + n, label: 'Dial ' + n, icon: n >= 7 ? '🥶' : '🛞', style: n >= 7 ? 'danger' : '' }));
  },
  resolve(ctx) {
    ctx.beat({ kind: 'reveal', tone: 'story', text: 'The vault was set to ' + ctx.R.n });
    for (const pid of ctx.pids) {
      const s = ctx.R.sec[pid];
      const d = Number((s.commit || 'd1').slice(1));
      let v;
      if (d > ctx.R.n) v = -120 - (d - ctx.R.n) * 30;
      else v = 30 + (ctx.R.n - d) * 5 + d * 22;
      if (d === ctx.R.n) v = 340;
      if (s.push && d <= ctx.R.n) v = Math.round(v * 2);
      else if (s.push) v -= 90;
      ctx.award(pid, v, v > 250 ? 'BIG_WIN' : v > 0 ? 'PAID' : 'OUCH', d === ctx.R.n ? 'dead centre' : d > ctx.R.n ? 'overshot the dial' : 'safe but small');
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: v > 0 ? 'good' : 'bad', text: ctx.P[pid].name + ' dialled ' + d });
    }
  },
});

MG({
  id: 'mg_cards', title: 'Card Shark', icon: '🃏',
  blurb: 'Four cards face-down. Two pay, one steals, one swaps. Order is decided by who you trust.',
  begin(ctx) {
    const kind = shuffle(ctx.rng, ['pay', 'pay', 'steal', 'swap']);
    ctx.R.kind = kind;
    ctx.R.pub.cards = ['Card 1', 'Card 2', 'Card 3', 'Card 4'];
    ctx.R.pub.note = 'Pick a card. Then, if you drew the swap, pick a friend.';
    for (const pid of ctx.pids) ctx.sec(pid, { swapWith: null });
  },
  secretCard() { return { head: 'Four cards. No information.', sub: 'Some of you will be very smug by the end.', rows: [] }; },
  optionsFor(ctx) { return ctx.R.pub.cards.map((c, i) => ({ id: 'c' + i, label: c, icon: '🃏' })); },
  resolve(ctx) {
    const draws = {};
    for (const pid of ctx.pids) {
      const i = Number((ctx.R.sec[pid].commit || 'c0').slice(1)) % 4;
      draws[pid] = ctx.R.kind[i];
    }
    for (const pid of ctx.pids) {
      const k = draws[pid];
      let v = k === 'pay' ? 160 + Math.round(ctx.rng() * 90) : 0;
      let tag = k === 'pay' ? 'PAID' : 'VOID';
      if (k === 'steal') {
        const cand = ctx.pids.filter((p) => p !== pid && draws[p] === 'pay');
        if (cand.length) {
          const t = pick(ctx.rng, cand);
          const amt = 150;
          v = amt; ctx.award(t, -amt, 'OUCH', 'had a card read by ' + ctx.P[pid].name);
          tag = 'SCAM_SUCCESS';
          ctx.beat({ kind: 'pay', pid, focus: t, tone: 'trick', text: ctx.P[pid].name + ' lifted ' + fmt(amt) + ' off ' + ctx.P[t].name });
        } else { v = 40; tag = 'NOTHING'; }
      }
      if (k === 'swap') {
        const cand = ctx.pids.filter((p) => p !== pid);
        const t = cand.length ? pick(ctx.rng, cand) : null;
        if (t) {
          const a = ctx.R.award[t] || 0, b = v;
          ctx.R.award[t] = (ctx.R.award[t] || 0) + (b - (a || 0)) * 0.5;
          ctx.beat({ kind: 'story', pid, focus: t, tone: 'trick', text: ctx.P[pid].name + ' swapped outcomes with ' + ctx.P[t].name });
          v = Math.round(b * 0.6); tag = 'CLEVER';
        }
      }
      ctx.award(pid, v, tag, k === 'pay' ? 'drew a paying card' : k);
      ctx.beat({ kind: 'choice', pid, focus: pid, tone: v > 0 ? 'good' : 'bad', text: ctx.P[pid].name + ' → ' + k.toUpperCase() });
    }
  },
});

MG({
  id: 'mg_vanish', title: 'Vanishing Pot', icon: '⏳',
  blurb: 'The pot shrinks every half-second. One of you will smash the button. One of you will smash it too late.',
  begin(ctx) {
    ctx.R.pot = 420 + Math.round(ctx.rng() * 220);
    ctx.R.rate = 7;
    ctx.R.trap = ctx.rng() < 0.35;
    ctx.R.firstTouch = null;
    ctx.R.pub.note = 'Slam the table button (ACTION) to take what is left. In ' + (ctx.R.trap ? 'this' : 'a possibly cursed') + ' pot.';
    for (const pid of ctx.pids) ctx.sec(pid, { touched: false });
  },
  secretCard(ctx) {
    return { head: 'Every second costs the whole table ' + ctx.R.rate + ' chips.', sub: 'Grabbing early is cheap insurance. Grabbing late is glory.', rows: [{ k: 'House rumor', v: ctx.R.trap ? 'this pot is booby-trapped…' : 'this pot is clean… probably', good: !ctx.R.trap }] };
  },
  actionsFor(ctx, pid) {
    if (ctx.R.firstTouch != null) return [];
    return [{ id: 'grab', label: 'SLAM the button', icon: '👋', hint: 'Take the pot as it stands.' }];
  },
  onAction(ctx, pid, id) {
    if (id !== 'grab') return false;
    if (ctx.R.firstTouch != null) return false;
    ctx.R.firstTouch = pid;
    ctx.R.sec[pid].touched = true;
    ctx.beat({ kind: 'pass', pid, tone: 'trick', focus: pid, text: ctx.P[pid].name + ' slammed the button with ' + fmt(ctx.R.currentPot ?? ctx.R.pot) + ' left' });
    return true;
  },
  resolve(ctx) {
    const pot = Math.max(30, ctx.R.currentPot ?? ctx.R.pot);
    const who = ctx.R.firstTouch;
    if (who == null) {
      for (const pid of ctx.pids) ctx.award(pid, 25, 'NOTHING', 'too polite to grab');
      ctx.beat({ kind: 'story', tone: 'story', text: 'Nobody touched it. The pot evaporated out of pure spite.' });
      return;
    }
    if (ctx.R.trap) {
      ctx.award(who, -240, 'TRICK_FAILED', 'grabbed a cursed pot');
      ctx.beat({ kind: 'choice', pid: who, focus: who, tone: 'bad', text: ctx.P[who].name + ' grabbed ' + fmt(pot) + ' and found a bill for 240' });
      for (const pid of ctx.pids) if (pid !== who) ctx.award(pid, 60, 'CLEVER', 'watched someone else take the trap');
    } else {
      ctx.award(who, pot, pot > 300 ? 'BIG_WIN' : 'PAID', 'fastest hand at the table');
      ctx.beat({ kind: 'choice', pid: who, focus: who, tone: 'good', text: ctx.P[who].name + ' snatched ' + fmt(pot) });
      for (const pid of ctx.pids) if (pid !== who) ctx.award(pid, 10, 'NOTHING', 'slowed by conscience');
    }
  },
});

MG({
  id: 'mg_fall', title: 'Trust Fall', icon: '🪟',
  blurb: 'One of you stands on the table. The rest choose: catch, or look away.',
  begin(ctx) {
    const leap = pick(ctx.rng, ctx.pids);
    ctx.R.leaper = leap;
    ctx.R.pub.leaper = leap;
    ctx.R.pub.note = ctx.P[leap]?.name + ' is on the table. Decide quickly, quietly, and with doubt.';
    for (const pid of ctx.pids) ctx.sec(pid, {});
  },
  secretCard(ctx, pid) {
    const isL = ctx.R.leaper === pid;
    return {
      head: isL ? 'You are on the table.' : 'You are on the floor. That is a choice too.',
      sub: isL ? 'LEAP if you believe they will catch you. CHICKEN pays less and costs face.' : 'CATCH costs you 40 chips if they chicken out. LOOKING AWAY costs them everything.',
      rows: [],
    };
  },
  optionsFor(ctx, pid) {
    if (ctx.R.leaper === pid) return [
      { id: 'leap', label: 'LEAP', icon: '🕊️', hint: 'Full trust. Absolute chaos.', style: 'danger' },
      { id: 'chicken', label: 'Step down carefully', icon: '🐔', hint: '+50 chips, minus reputation.', style: 'safe' },
    ];
    return [
      { id: 'catch', label: 'Catch them', icon: '🤲', hint: 'Costs 40 if nobody jumps.' },
      { id: 'look', label: 'Look away', icon: '🙈', hint: 'Free. Revealing.' },
    ];
  },
  resolve(ctx) {
    const leap = ctx.R.leaper;
    const jumpers = ctx.pids.filter((p) => ctx.R.sec[p].commit === 'catch');
    const leapt = ctx.R.sec[leap].commit === 'leap';
    if (leapt) {
      if (jumpers.length >= Math.ceil((ctx.pids.length - 1) * 0.6)) {
        ctx.award(leap, 300, 'BIG_WIN', 'caught by a wall of friends');
        for (const p of jumpers) ctx.award(p, 130, 'GOOD_CALL', 'caught without thinking');
        ctx.beat({ kind: 'story', focus: leap, tone: 'good', text: 'A clean, ridiculous, beautiful save.' });
      } else {
        ctx.award(leap, -260, 'OUCH', 'the floor was 100% of the catchers');
        for (const p of jumpers) ctx.award(p, 90, 'CLEVER', 'showed up anyway');
        for (const p of ctx.pids) if (p !== leap && !jumpers.includes(p)) ctx.award(p, -110, 'WRONG_ACCUSE', 'watched it happen');
        ctx.beat({ kind: 'story', focus: leap, tone: 'bad', text: 'Not enough hands. Someone is already laughing.' });
      }
    } else {
      ctx.award(leap, 50, 'NOTHING', 'stepped down, we never speak of it');
      for (const p of jumpers) ctx.award(p, -40, 'TRICK_FAILED', 'crouched for nothing');
      ctx.beat({ kind: 'story', focus: leap, tone: 'story', text: ctx.P[leap].name + ' chicken' });
    }
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  shared role-objective settlement (used by most rounds)
// ═════════════════════════════════════════════════════════════════════════════
function roleObjectives(ctx) {
  for (const pid of ctx.pids) {
    const s = ctx.R.sec[pid] || {};
    const role = ctx.roleOf(pid);
    const gain = ctx.R.award[pid] || 0;
    if (role === 'civilian' && gain > 0) ctx.award(pid, 90, 'JOB', 'clean hands, full pockets');
    if (role === 'trader') {
      const deals = (ctx.R.offers || []).filter((o) => o.status === 'accepted' && (o.from === pid || o.to === pid));
      if (deals.length) ctx.award(pid, 110, 'JOB', 'made the table move');
    }
    if (role === 'risk' && s.push) ctx.award(pid, 70, 'JOB', 'bet loud and meant it');
    if (role === 'protector' && s.insuredBy == null && s.insured) ctx.award(pid, 60, 'JOB', 'stood in front of something');
    if (role === 'detective' && s.flagTarget != null) ctx.award(pid, 45, 'JOB', 'hands on the file');
    if (role === 'insider' && s.peekUsed) ctx.award(pid, 65, 'JOB', 'knew too much, said just enough');
    // loophole honour system: everyone who voided an accepted deal
    for (const o of ctx.R.offers || []) {
      if (o.status !== 'accepted' || !o.void) continue;
      if (o.from === pid && role === 'trickster') { /* already paid by round logic */ }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  round planning
// ═════════════════════════════════════════════════════════════════════════════
export const ALL_ROUNDS = [...ROUNDS, ...MINIGAMES];
export const ROUND_BY_ID = Object.fromEntries(ALL_ROUNDS.map((r) => [r.id, r]));

/** Build the schedule for a game: deception rounds with minigames woven in. */
export function planRounds(rng, count, withMinigames) {
  const deck = shuffle(rng, ROUNDS.map((r) => r.id));
  const mdeck = shuffle(rng, MINIGAMES.map((m) => m.id));
  const plan = [];
  let i = 0, j = 0;
  for (let n = 0; n < count; n++) {
    const wantMini = withMinigames && n > 0 && n % 2 === 1 && j < mdeck.length;
    if (wantMini) plan.push({ id: mdeck[j++], kind: 'minigame' });
    else plan.push({ id: deck[i % deck.length], kind: 'deception' });
    if (i >= deck.length) i = 0;
    i++;
  }
  // never two identical in a row
  for (let n = 1; n < plan.length; n++) {
    if (plan[n].id === plan[n - 1].id) {
      const alt = deck.find((d) => d !== plan[n].id);
      if (alt) plan[n] = { id: alt, kind: 'deception' };
    }
  }
  return plan;
}

/** durations in ms, scaled by kind */
export function phaseTimes(def, settings) {
  const mini = def.kind === 'minigame';
  return {
    brief: (mini ? 8 : settings.briefMs) * 1000,
    talk: (mini ? Math.min(30, settings.turnMs * 0.6) : settings.turnMs) * 1000,
    submit: (mini ? 16 : settings.submitMs) * 1000,
    revealBeat: CFG.revealBeatMs,
  };
}

export function rngFor(seed) { return mulberry32(seed >>> 0); }
export { rint, pick, clamp };
