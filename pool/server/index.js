#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  NEURIO Pool Hall — the authoritative game server (zero dependencies)
//
//    node server/index.js          # http + ws on :8080
//    PORT=9000 node server/index.js
//
//  Why this file exists: the client is never believed about anything that
//  matters. Coins, XP, cue ownership, friend lists, loans, daily rewards,
//  match pairings and match results are all decided here.
//
//  A shot is submitted as a STRIKE (direction, power, tip contact point) and
//  nothing else. The server owns the ball positions, replays the shot with the
//  very same deterministic physics module the client uses (src/physics.js),
//  judges it with the same rules module (src/rules.js), and only then tells
//  both players what happened. A modified client can lie about its aim; it
//  cannot invent a result, because it never gets to send one.
//
//  Real-money purchases are deliberately not credited here without a validated
//  platform receipt — see purchase.begin below.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WsServer } from './ws.js';
import { Shot, makeStrike, makeBall, PHYS } from '../src/physics.js';
import {
  newMatch, applyResult, validateShot, canPlace, placeCue, shotClockFoul, settle,
  snapshot, situation, PHASE, GROUP,
} from '../src/rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const POOL = resolve(HERE, '..');
const VENDOR = resolve(POOL, '..', 'vendor');
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(HERE, 'data');
const USERS_FILE = join(DATA, 'users.json');
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ── tuning ──────────────────────────────────────────────────────────────────
const LIMITS = {
  startFree: 500, startBonus: 250,          // a brand new account
  maxStake: 5000, rankedStake: [100, 2500],
  giftMin: 20, giftMax: 500, giftDaily: 2000,
  loanMin: 50, loanMax: 250, loanDaily: 3, loanCooldownMin: 20, loanInterest: 0.10,
  dailyTable: [100, 150, 250, 400, 600, 900, 1500],
  shotClock: 30,
  queueTimeoutMs: 90000,
};
const CUE_PRICES = { house: 0, maple: 900, onyx: 2400, ivory: 5200, dragon: 12000, aurum: 28000 };
const PACKS = { p1: { coins: 2500, bonus: 0, usd: 1.99 }, p2: { coins: 7000, bonus: 1000, usd: 4.99 }, p3: { coins: 20000, bonus: 5000, usd: 12.99 }, p4: { coins: 55000, bonus: 20000, usd: 29.99 } };

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ── progression maths (must match src/profile.js exactly) ───────────────────
const xpForLevel = (l) => Math.round(320 * Math.pow(l, 1.42));
function levelFromXp(xp) {
  let l = 1, acc = 0;
  while (l < 200) { const need = xpForLevel(l); if (xp < acc + need) break; acc += need; l++; }
  return { level: l, into: xp - acc, need: xpForLevel(l) };
}

// ── accounts ────────────────────────────────────────────────────────────────
const users = new Map();          // lowercased name → user
const byToken = new Map();        // token → { user, conn }
const matches = new Map();        // matchId → match
const queue = [];                 // waiting players
let saveTimer = null;
let savePending = false;

function freshProfile(name) {
  return {
    v: 1, name, avatar: '🎱', level: 1, xp: 0,
    wallet: { free: LIMITS.startFree, bought: 0, bonus: LIMITS.startBonus },
    ledger: [], cues: ['house'], equipped: 'house',
    stats: { played: 0, won: 0, lost: 0, potted: 0, shots: 0, fouls: 0, bestRun: 0, run: 0, eightWins: 0, breaks: 0 },
    history: [], friends: [], inbox: [],
    daily: { last: 0, streak: 0 },
    loans: { taken: [], given: [], cooldownUntil: 0 },
    settings: { guides: 2, camera: 'aim', shotClock: true, fastForward: true, sensitivity: 1, leftHanded: false, quality: 'auto', resolution: 1, bloom: true, shadows: true, sound: true, volume: 0.9, sfxVolume: 1, music: true, spatialAudio: true, showFps: false, frameCap: 0, clothColor: 'blue', tableFinish: 'tournament', aiLevel: 3, stake: 0, autoCam: true, guideRail: true },
  };
}
function freshUser(name, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    name, salt, hash: hashPass(password, salt),
    created: Date.now(), lastSeen: Date.now(),
    profile: freshProfile(name),
  };
}
const hashPass = (p, salt) => crypto.scryptSync(String(p), `neurio:${salt}`, 32).toString('hex');
function checkPass(user, password) {
  const a = Buffer.from(user.hash, 'hex');
  const b = Buffer.from(hashPass(password, user.salt), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function loadUsers() {
  await mkdir(DATA, { recursive: true });
  try {
    const raw = await readFile(USERS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    for (const u of Array.isArray(arr) ? arr : []) {
      if (!u || !u.name) continue;
      u.profile = { ...freshProfile(u.name), ...(u.profile || {}), wallet: { free: 0, bought: 0, bonus: 0, ...((u.profile || {}).wallet || {}) } };
      users.set(u.name.toLowerCase(), u);
    }
    log(`loaded ${users.size} account(s) from ${USERS_FILE}`);
  } catch (e) {
    if (e.code !== 'ENOENT') log('could not read users.json:', e.message);
    else log('no saved accounts yet — a fresh hall');
  }
}
function saveUsers() {
  savePending = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!savePending) return;
    savePending = false;
    try {
      const arr = [...users.values()].map((u) => ({ name: u.name, salt: u.salt, hash: u.hash, created: u.created, lastSeen: u.lastSeen, profile: u.profile }));
      const tmp = USERS_FILE + '.tmp';
      await writeFile(tmp, JSON.stringify(arr, null, 1));
      await writeFile(USERS_FILE, await readFile(tmp));   // keep it simple and atomic-ish
    } catch (e) { log('save failed:', e.message); }
  }, 1500);
}

// ── wallet authority ────────────────────────────────────────────────────────
const total = (u) => u.profile.wallet.free + u.profile.wallet.bought + u.profile.wallet.bonus;
function ledger(u, amount, kind, reason) {
  u.profile.ledger.unshift({ t: Date.now(), amount, kind, reason: String(reason || '').slice(0, 80) });
  if (u.profile.ledger.length > 200) u.profile.ledger.length = 200;
}
/** FREE (earned) · BOUGHT (real money) · BONUS (packs, events, loans) never mix */
function addCoins(u, kind, amount, reason) {
  amount = Math.max(0, Math.round(amount));
  if (!amount || !(kind in u.profile.wallet)) return 0;
  u.profile.wallet[kind] += amount;
  ledger(u, +amount, kind, reason);
  saveUsers();
  return amount;
}
function spend(u, amount, reason) {
  amount = Math.round(amount);
  if (amount <= 0) return true;
  if (total(u) < amount) return false;
  let left = amount;
  for (const kind of ['bonus', 'free', 'bought']) {     // bought coins are spent last, always
    const take = Math.min(left, u.profile.wallet[kind]);
    if (take > 0) { u.profile.wallet[kind] -= take; ledger(u, -take, kind, reason); left -= take; }
  }
  saveUsers();
  return left === 0;
}
function addXp(u, n) {
  n = Math.max(0, Math.round(n));
  const before = u.profile.level;
  u.profile.xp += n;
  u.profile.level = levelFromXp(u.profile.xp).level;
  saveUsers();
  return { gained: n, level: u.profile.level, leveledUp: u.profile.level > before };
}

const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ── what a client is allowed to see ─────────────────────────────────────────
function publicProfile(u) {
  const p = u.profile;
  return {
    name: p.name, avatar: p.avatar, level: p.level, xp: p.xp, wallet: { ...p.wallet },
    ledger: p.ledger.slice(0, 40), cues: [...p.cues], equipped: p.equipped,
    stats: { ...p.stats }, history: p.history.slice(0, 30), friends: p.friends.map((f) => ({ ...f, online: isOnline(f.name) })),
    inbox: p.inbox.slice(0, 40), daily: { ...p.daily }, loans: { taken: p.loans.taken, given: p.loans.given, cooldownUntil: p.loans.cooldownUntil },
    settings: { ...p.settings }, guest: false,
  };
}
const isOnline = (name) => [...byToken.values()].some((s) => s.user.name.toLowerCase() === String(name).toLowerCase());

// ── matchmaking + server-side matches ───────────────────────────────────────
function ballsFromState(state) {
  const out = new Array(16).fill(null);
  for (const b of state.balls) {
    const t = makeBall(b.n, b.x, b.z);
    t.state = b.state === 'table' ? 'table' : 'pocketed';
    if (t.state === 'pocketed') t.sink = 0.06;
    out[b.n] = t;
  }
  return out;
}

function publicState(m) {
  const s = m.state;
  return {
    game: s.game, phase: s.phase, turn: s.turn, open: s.open, ballInHand: s.ballInHand, kitchenOnly: s.kitchenOnly,
    stake: s.stake, pot: s.pot, winner: s.winner, winReason: s.winReason, loseReason: s.loseReason,
    shotNumber: s.shotNumber, shotClock: s.shotClock, shotClockLeft: Math.max(0, Math.round(m.clockLeft)),
    situation: situation(s),
    players: s.players.map((p) => ({ name: p.name, avatar: p.avatar, group: p.group, pocketed: [...p.pocketed], fouls: p.fouls, score: p.score, streak: p.streak })),
    balls: snapshot(s),
  };
}

function createMatch(a, b, game, stake) {
  const id = crypto.randomBytes(6).toString('hex');
  const breaker = Math.random() < 0.5 ? 0 : 1;
  const state = newMatch({
    game,
    players: [
      { name: a.user.profile.name, avatar: a.user.profile.avatar },
      { name: b.user.profile.name, avatar: b.user.profile.avatar },
    ],
    breaker, stake, shotClock: LIMITS.shotClock,
  });
  const m = {
    id, game, stake, state, breaker,
    seats: [a, b],
    escrow: stake * 2,
    created: Date.now(),
    clockLeft: LIMITS.shotClock,
    simming: false,
    over: false,
  };
  matches.set(id, m);
  a.session.matchId = id; b.session.matchId = id;
  for (const s of [a, b]) s.session.queueAt = 0;
  m.timer = setInterval(() => tickClock(m), 1000);
  send(a, 'match.start', { matchId: id, you: 0, opponent: state.players[1].name, opponentAvatar: state.players[1].avatar, game, stake, state: publicState(m) });
  send(b, 'match.start', { matchId: id, you: 1, opponent: state.players[0].name, opponentAvatar: state.players[0].avatar, game, stake, state: publicState(m) });
  log(`match ${id}: ${state.players[0].name} vs ${state.players[1].name} · ${game} · stake ${stake}`);
  return m;
}

function tickClock(m) {
  if (m.over || m.simming) return;
  m.clockLeft -= 1;
  if (m.clockLeft > 0) { broadcastMatch(m, 'match.clock', { matchId: m.id, left: m.clockLeft }); return; }
  // the server enforces the shot clock, not the client
  const out = shotClockFoul(m.state);
  m.clockLeft = LIMITS.shotClock;
  broadcastMatch(m, 'match.resolved', { matchId: m.id, out, state: publicState(m), note: 'shot clock' });
  finishIfOver(m);
}

function finishIfOver(m) {
  if (m.state.phase !== PHASE.OVER || m.over) return;
  m.over = true;
  clearInterval(m.timer);
  const s = settle(m.state);
  const winSeat = m.seats[s.winner];
  const loseSeat = m.seats[1 - s.winner];
  // the pot was taken up front; paying it out is the server's job
  if (winSeat && s.coins > 0) addCoins(winSeat.user, 'free', s.coins, `won ${m.game} vs ${loseSeat ? loseSeat.user.profile.name : '—'}`);
  for (const [i, seat] of m.seats.entries()) {
    if (!seat) continue;
    const u = seat.user;
    const won = i === s.winner;
    const st = m.state;
    u.profile.stats.played++;
    if (won) { u.profile.stats.won++; u.profile.stats.run++; u.profile.stats.bestRun = Math.max(u.profile.stats.bestRun, u.profile.stats.run); }
    else { u.profile.stats.lost++; u.profile.stats.run = 0; }
    u.profile.stats.shots += Math.round(st.shotNumber / 2);
    u.profile.stats.potted += st.players[i].pocketed.length;
    u.profile.stats.fouls += st.players[i].fouls;
    if (won && String(st.winReason || '').includes('8-ball')) u.profile.stats.eightWins++;
    const xp = Math.round(60 + st.players[i].pocketed.length * 12 + (won ? 90 : 0) + m.stake / 25);
    addXp(u, xp);
    u.profile.history.unshift({ t: Date.now(), mode: m.game === '9ball' ? '9-ball online' : '8-ball online', opponent: st.players[1 - i].name, outcome: won ? 'win' : 'loss', coins: won ? s.coins : -m.stake, xp, shots: Math.round(st.shotNumber / 2), potted: st.players[i].pocketed.length });
    if (u.profile.history.length > 60) u.profile.history.length = 60;
    seat.session.matchId = null;
    send(seat, 'profile.sync', { profile: publicProfile(u) });
    send(seat, 'match.over', { matchId: m.id, winner: s.winner, you: i, coins: won ? s.coins : -m.stake, xp, reason: st.winReason || st.loseReason, state: publicState(m) });
  }
  saveUsers();
  log(`match ${m.id} over — winner ${s.winner} (${winSeat ? winSeat.user.profile.name : '?'}) paid ${s.coins}`);
  setTimeout(() => matches.delete(m.id), 60000);
}

function forfeit(m, seatIdx, why) {
  if (m.over) return;
  const other = 1 - seatIdx;
  m.state.winner = other;
  m.state.phase = PHASE.OVER;
  m.state.winReason = why;
  finishIfOver(m);
}

/** the heart of the anti-cheat story: replay the submitted strike ourselves */
function playShot(m, seatIdx, strike) {
  if (m.over) return { ok: false, why: 'the match is over' };
  if (m.simming) return { ok: false, why: 'the balls are still moving' };
  if (m.state.turn !== seatIdx) return { ok: false, why: 'not your turn' };
  const v = validateShot(m.state, strike);
  if (!v.ok) { m.simming = false; return { ok: false, why: v.why }; }
  m.simming = true;

  // a ball-in-hand shot carries its placement: put the cue ball down on OUR copy
  // of the table first, so the simulation we run is the shot they described
  if (strike.placement && m.state.ballInHand) {
    const c = canPlace(m.state, +strike.placement.x, +strike.placement.z);
    if (!c.ok) return { ok: false, why: `placement refused: ${c.why}` };
    placeCue(m.state, +strike.placement.x, +strike.placement.z);
  }
  const balls = ballsFromState(m.state);
  const shot = new Shot(balls, { eventCap: 0, keepEvents: false });
  shot.applyStrike(makeStrike(strike.dirX, strike.dirZ, clamp01(strike.power), clamp1(strike.tipSide), clamp1(strike.tipVert)));
  shot.runAll();
  const res = shot.result();
  const out = applyResult(m.state, res);
  m.simming = false;
  m.clockLeft = LIMITS.shotClock;
  return { ok: true, out, res, pocketed: res.pocketed.length, maxSpeed: res.maxSpeed };
}
const clamp01 = (v) => Math.max(0.02, Math.min(1, Number(v) || 0));
const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

function broadcastMatch(m, type, data) { for (const s of m.seats) if (s) send(s, type, data); }

// ── transport helpers ───────────────────────────────────────────────────────
function send(seat, type, data) {
  try { seat.conn.send({ type, data }); } catch (e) { /* the socket is gone */ }
}
function reply(conn, id, data, error) {
  try { conn.send({ id, data, error }); } catch (e) { /* ignore */ }
}
function push(conn, type, data) { try { conn.send({ type, data }); } catch (e) { /* ignore */ } }

// ── request handlers ────────────────────────────────────────────────────────
const handlers = {
  auth(sess, d) {
    const name = String(d.name || '').trim().slice(0, 16);
    const pass = String(d.password || '');
    if (!/^[A-Za-z0-9_.\- ]{2,16}$/.test(name)) return { ok: false, why: 'usernames are 2–16 characters: letters, numbers, space . _ -' };
    if (pass.length < 4) return { ok: false, why: 'passwords are at least 4 characters' };
    const key = name.toLowerCase();
    let u = users.get(key);
    if (!u) {
      if (!d.register) return { ok: false, why: 'no such account — create one first' };
      u = freshUser(name, pass);
      users.set(key, u);
      ledger(u, LIMITS.startFree, 'free', 'welcome bonus');
      ledger(u, LIMITS.startBonus, 'bonus', 'welcome bonus');
      saveUsers();
      log(`new account ${u.name}`);
    } else if (!checkPass(u, pass)) return { ok: false, why: 'wrong password' };
    u.lastSeen = Date.now();
    // one session per account: an older socket is dropped
    for (const [tok, s] of byToken) if (s.user === u && s.conn !== sess.conn) { push(s.conn, 'kicked', { why: 'signed in elsewhere' }); s.conn.close(4000, 'elsewhere'); byToken.delete(tok); }
    const token = crypto.randomBytes(24).toString('hex');
    byToken.set(token, { user: u, conn: sess.conn, session: sess });
    sess.token = token; sess.user = u;
    announcePresence();
    return { ok: true, token, name: u.name, profile: publicProfile(u), serverTime: Date.now(), limits: LIMITS };
  },

  'profile.get': (sess) => sess.user ? { ok: true, profile: publicProfile(sess.user) } : { ok: false, why: 'not signed in' },

  /**
   * The client may only write things it owns: cosmetics and preferences.
   * Wallet, XP, level, cues, stats and friends are ignored here — they are
   * changed exclusively by server-side events.
   */
  'profile.save'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    const s = d && d.settings;
    if (s && typeof s === 'object') {
      for (const k of Object.keys(p.settings)) {
        const v = s[k];
        if (v === undefined) continue;
        if (typeof p.settings[k] === 'number') p.settings[k] = Number.isFinite(+v) ? +v : p.settings[k];
        else if (typeof p.settings[k] === 'boolean') p.settings[k] = !!v;
        else p.settings[k] = String(v).slice(0, 24);
      }
    }
    if (typeof d.avatar === 'string' && d.avatar.length <= 8) p.avatar = d.avatar;
    if (CUE_PRICES[d.equipped] !== undefined && p.cues.includes(d.equipped)) p.equipped = d.equipped;
    saveUsers();
    return { ok: true, profile: publicProfile(sess.user) };
  },

  'cue.buy'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    const id = String(d.id || '');
    if (CUE_PRICES[id] === undefined) return { ok: false, why: 'no such cue' };
    if (p.cues.includes(id)) return { ok: false, why: 'already owned' };
    if (!spend(sess.user, CUE_PRICES[id], `bought cue ${id}`)) return { ok: false, why: 'not enough coins' };
    p.cues.push(id); p.equipped = id;
    saveUsers();
    return { ok: true, profile: publicProfile(sess.user) };
  },

  'friend.add'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const name = String(d.name || '').trim().slice(0, 16);
    const other = users.get(name.toLowerCase());
    if (!other) return { ok: false, why: 'no player by that name' };
    if (other === sess.user) return { ok: false, why: 'you cannot friend yourself' };
    const p = sess.user.profile;
    if (p.friends.some((f) => f.name.toLowerCase() === name.toLowerCase())) return { ok: false, why: 'already on your list' };
    if (p.friends.length >= 100) return { ok: false, why: 'friend list is full' };
    p.friends.push({ name: other.profile.name, avatar: other.profile.avatar, added: Date.now(), online: isOnline(other.profile.name) });
    other.profile.inbox.unshift({ t: Date.now(), icon: '🧑‍🤝‍🧑', title: 'New friend', body: `${p.name} added you.` });
    if (other.profile.inbox.length > 40) other.profile.inbox.length = 40;
    saveUsers();
    announcePresence();
    notifyUser(other, 'friend.add', { name: p.name });
    return { ok: true, profile: publicProfile(sess.user) };
  },

  'friend.remove'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    const name = String(d.name || '').toLowerCase();
    p.friends = p.friends.filter((f) => f.name.toLowerCase() !== name);
    saveUsers();
    return { ok: true, profile: publicProfile(sess.user) };
  },

  /** coins between friends: rate limited, ledgered on both sides */
  'wallet.gift'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const amount = Math.round(+d.amount || 0);
    if (amount < LIMITS.giftMin || amount > LIMITS.giftMax) return { ok: false, why: `gifts are ${LIMITS.giftMin}–${LIMITS.giftMax} coins` };
    const to = users.get(String(d.name || '').toLowerCase());
    if (!to) return { ok: false, why: 'no such friend' };
    if (!sess.user.profile.friends.some((f) => f.name.toLowerCase() === to.profile.name.toLowerCase())) return { ok: false, why: 'you are not friends' };
    const today = dayKey();
    const givenToday = sess.user.profile.ledger.filter((l) => l.amount < 0 && l.reason.startsWith('gift to') && dayKey(l.t) === today)
      .reduce((a, l) => a - l.amount, 0);
    if (givenToday + amount > LIMITS.giftDaily) return { ok: false, why: `daily gift limit is ${LIMITS.giftDaily} coins` };
    if (!spend(sess.user, amount, `gift to ${to.profile.name}`)) return { ok: false, why: 'not enough coins' };
    addCoins(to, 'bonus', amount, `gift from ${sess.user.profile.name}`);
    to.profile.inbox.unshift({ t: Date.now(), icon: '🎁', title: `${sess.user.profile.name} sent you ${amount} coins`, body: 'Gifted coins land in your bonus balance.' });
    notifyUser(to, 'wallet.gift', { from: sess.user.profile.name, amount });
    saveUsers();
    return { ok: true, amount, profile: publicProfile(sess.user) };
  },

  /** ask-a-friend: only at zero, three a day, 20 minute cooldown, +10% to repay */
  'loan.ask'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    if (total(sess.user) > 0) return { ok: false, why: 'loans are only for players at 0 coins' };
    if (p.loans.cooldownUntil > Date.now()) {
      return { ok: false, why: `loan cooldown: ${Math.ceil((p.loans.cooldownUntil - Date.now()) / 60000)} min left` };
    }
    const today = dayKey();
    if (p.loans.taken.filter((l) => dayKey(l.t) === today).length >= LIMITS.loanDaily) return { ok: false, why: `daily loan limit is ${LIMITS.loanDaily}` };
    const from = users.get(String(d.name || '').toLowerCase());
    if (!from) return { ok: false, why: 'no such friend' };
    if (!p.friends.some((f) => f.name.toLowerCase() === from.profile.name.toLowerCase())) return { ok: false, why: 'you are not friends' };
    if (total(from) < LIMITS.loanMin) return { ok: false, why: `${from.profile.name} has no coins to lend` };
    const amount = Math.max(LIMITS.loanMin, Math.min(LIMITS.loanMax, Math.round(+d.amount || LIMITS.loanMin)));
    if (!spend(from, amount, `loan to ${p.name}`)) return { ok: false, why: 'not enough coins' };
    const id = crypto.randomBytes(4).toString('hex');
    const repay = Math.round(amount * (1 + LIMITS.loanInterest));
    p.loans.taken.push({ id, t: Date.now(), from: from.profile.name, amount, repay });
    p.loans.cooldownUntil = Date.now() + LIMITS.loanCooldownMin * 60000;
    from.profile.loans.given.push({ id, t: Date.now(), to: p.name, amount, repay, repaid: 0 });
    addCoins(sess.user, 'bonus', amount, `loan from ${from.profile.name}`);
    from.profile.inbox.unshift({ t: Date.now(), icon: '🤝', title: `${p.name} borrowed ${amount} coins`, body: `You get ${repay} back when they repay.` });
    notifyUser(from, 'loan.ask', { from: p.name, amount, repay });
    saveUsers();
    return { ok: true, amount, repay, from: from.profile.name, profile: publicProfile(sess.user) };
  },

  'loan.repay'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    const loan = p.loans.taken.find((l) => l.id === d.id && !l.repaid);
    if (!loan) return { ok: false, why: 'no such loan' };
    if (!spend(sess.user, loan.repay, `repay ${loan.from}`)) return { ok: false, why: `you need ${loan.repay} coins to repay` };
    loan.repaid = Date.now();
    const lender = users.get(loan.from.toLowerCase());
    if (lender) {
      addCoins(lender, 'free', loan.repay, `repaid by ${p.name}`);
      const g = lender.profile.loans.given.find((x) => x.id === loan.id);
      if (g) g.repaid = Date.now();
      lender.profile.inbox.unshift({ t: Date.now(), icon: '🤝', title: `${p.name} repaid ${loan.repay} coins`, body: 'Loans are repaid with 10% interest.' });
      notifyUser(lender, 'loan.repay', { from: p.name, amount: loan.repay });
    }
    saveUsers();
    return { ok: true, amount: loan.repay, profile: publicProfile(sess.user) };
  },

  'daily.claim'(sess) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const p = sess.user.profile;
    const today = new Date(); const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (p.daily.last === t0) return { ok: false, why: 'already claimed today' };
    const yesterday = t0 - 86400000;
    p.daily.streak = p.daily.last === yesterday ? p.daily.streak + 1 : 1;
    p.daily.last = t0;
    const day = ((p.daily.streak - 1) % 7) + 1;
    const coins = LIMITS.dailyTable[day - 1];
    addCoins(sess.user, 'free', coins, `daily reward day ${day}`);
    addXp(sess.user, 40 + day * 10);
    return { ok: true, day, coins, streak: p.daily.streak, profile: publicProfile(sess.user) };
  },

  /**
   * Real money. We never credit coins on the client's word: a purchase needs a
   * receipt the platform signed (Google Play Billing on Android, the desktop
   * store elsewhere). Without a billing client attached the server refuses, so
   * a patched client cannot mint bought coins.
   */
  'purchase.begin'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const pack = PACKS[String(d.packId || '')];
    if (!pack) return { ok: false, why: 'no such pack' };
    return {
      ok: false,
      why: 'no billing client attached',
      pack: { ...pack },
      hint: 'The Android build starts Google Play Billing, then calls purchase.verify with the signed purchase token. The server validates that token with the store before crediting BOUGHT coins.',
    };
  },
  'purchase.verify'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    const pack = PACKS[String(d.packId || '')];
    if (!pack) return { ok: false, why: 'no such pack' };
    const okReceipt = verifyReceipt(d.receipt, sess.user, d.packId);
    if (!okReceipt.ok) return { ok: false, why: okReceipt.why };
    addCoins(sess.user, 'bought', pack.coins, `purchase ${d.packId}`);
    if (pack.bonus) addCoins(sess.user, 'bonus', pack.bonus, `purchase ${d.packId} bonus`);
    sess.user.profile.purchases = sess.user.profile.purchases || [];
    sess.user.profile.purchases.push({ t: Date.now(), packId: d.packId, orderId: okReceipt.orderId, usd: pack.usd });
    saveUsers();
    return { ok: true, coins: pack.coins, bonus: pack.bonus, profile: publicProfile(sess.user) };
  },

  // ── matchmaking ───────────────────────────────────────────────────────────
  'match.find'(sess, d) {
    if (!sess.user) return { ok: false, why: 'not signed in' };
    if (sess.matchId) return { ok: false, why: 'you are already in a match' };
    const game = d.game === '9ball' ? '9ball' : '8ball';
    const stake = Math.max(0, Math.min(LIMITS.maxStake, Math.round(+d.stake || 0)));
    if (stake > 0) {
      if (!spend(sess.user, stake, `entry: online ${game}`)) return { ok: false, why: 'not enough coins for that stake' };
      push(sess.conn, 'profile.sync', { profile: publicProfile(sess.user) });   // the escrow left their wallet
    }
    const me = { user: sess.user, conn: sess.conn, session: sess, stake, game, at: Date.now() };
    // pick the waiting player closest in level, then longest waiting
    const lvl = sess.user.profile.level;
    let best = -1, bestScore = Infinity;
    queue.forEach((c, i) => {
      if (c.user === sess.user || c.game !== game || c.stake !== stake) return;
      const score = Math.abs(c.user.profile.level - lvl) * 1000 - (Date.now() - c.at) / 1000;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) {
      const other = queue.splice(best, 1)[0];
      createMatch(other, me, game, stake);
      return { ok: true, matched: true };
    }
    queue.push(me);
    sess.queueAt = Date.now();
    setTimeout(() => {
      const i = queue.indexOf(me);
      if (i >= 0 && Date.now() - me.at > LIMITS.queueTimeoutMs) {
        queue.splice(i, 1);
        if (stake > 0) addCoins(sess.user, 'free', stake, 'matchmaking timeout refund');
        push(sess.conn, 'match.queue', { state: 'timeout', refund: stake });
        push(sess.conn, 'profile.sync', { profile: publicProfile(sess.user) });
      }
    }, LIMITS.queueTimeoutMs + 500);
    return { ok: true, matched: false, queue: queue.length, position: queue.length };
  },

  'match.cancel'(sess) {
    const i = queue.findIndex((c) => c.session === sess);
    if (i >= 0) {
      const c = queue.splice(i, 1)[0];
      if (c.stake > 0) addCoins(sess.user, 'free', c.stake, 'queue cancelled refund');
      sess.queueAt = 0;
      push(sess.conn, 'profile.sync', { profile: publicProfile(sess.user) });
      return { ok: true, refund: c.stake };
    }
    return { ok: false, why: 'not in the queue' };
  },

  'match.shot'(sess, d) {
    const m = matches.get(String(d.matchId || ''));
    if (!m) return { ok: false, why: 'no such match' };
    const idx = m.seats.findIndex((s) => s && s.session === sess);
    if (idx < 0) return { ok: false, why: 'you are not in this match' };
    // playShot() runs the simulation synchronously and guards re-entry itself
    const r = playShot(m, idx, d.strike || {});
    if (!r.ok) return r;
    broadcastMatch(m, 'match.resolved', {
      matchId: m.id, by: idx, strike: d.strike, out: r.out,
      pocketedThisShot: r.pocketed, state: publicState(m),
    });
    finishIfOver(m);
    return { ok: true, out: r.out, state: publicState(m) };
  },

  'match.place'(sess, d) {
    const m = matches.get(String(d.matchId || ''));
    if (!m) return { ok: false, why: 'no such match' };
    const idx = m.seats.findIndex((s) => s && s.session === sess);
    if (idx < 0 || m.state.turn !== idx) return { ok: false, why: 'not your turn' };
    const c = canPlace(m.state, +d.x, +d.z);
    if (!c.ok) return c;
    placeCue(m.state, +d.x, +d.z);
    broadcastMatch(m, 'match.state', { matchId: m.id, state: publicState(m) });
    return { ok: true, state: publicState(m) };
  },

  'match.state'(sess, d) {
    const m = matches.get(String(d.matchId || sess.matchId || ''));
    if (!m) return { ok: false, why: 'no such match' };
    if (!m.seats.some((s) => s && s.session === sess)) return { ok: false, why: 'you are not in this match' };
    return { ok: true, matchId: m.id, state: publicState(m) };
  },

  'match.resign'(sess, d) {
    const m = matches.get(String(d.matchId || sess.matchId || ''));
    if (!m) return { ok: false, why: 'no such match' };
    const idx = m.seats.findIndex((s) => s && s.session === sess);
    if (idx < 0) return { ok: false, why: 'you are not in this match' };
    forfeit(m, idx, `${sess.user.profile.name} resigned`);
    return { ok: true };
  },

  'chat.say'(sess, d) {
    const text = String(d.text || '').slice(0, 160);
    if (!text.trim() || !sess.user) return { ok: false, why: 'nothing to say' };
    const m = matches.get(sess.matchId);
    if (m) { broadcastMatch(m, 'chat', { from: sess.user.profile.name, text }); return { ok: true }; }
    for (const s of byToken.values()) push(s.conn, 'chat', { from: sess.user.profile.name, text, hall: true });
    return { ok: true };
  },

  presence: () => ({ ok: true, online: byToken.size, queue: queue.length, matches: [...matches.values()].filter((m) => !m.over).length }),
};

function verifyReceipt(receipt, user, packId) {
  // With a store client attached this validates the signed purchase token
  // against Google Play / the desktop store. Until then, nothing passes — that
  // is the safe direction: it is impossible to mint bought coins from here.
  if (!receipt || typeof receipt !== 'object' || !receipt.signature || !receipt.purchaseToken) {
    return { ok: false, why: 'no signed purchase token' };
  }
  return { ok: false, why: 'receipt validation is not configured on this server' };
}

function notifyUser(user, type, data) {
  for (const s of byToken.values()) if (s.user === user) push(s.conn, type, data);
}
function announcePresence() {
  const names = [...byToken.values()].map((s) => ({ name: s.user.profile.name, avatar: s.user.profile.avatar, level: s.user.profile.level }));
  for (const s of byToken.values()) push(s.conn, 'presence', { online: byToken.size, queue: queue.length, players: names });
}

// ── static files ────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
async function serveFile(res, url) {
  if (url === '/' || url === '') url = '/neurio-pool.html';
  const isVendor = url.startsWith('/vendor/');
  const base = isVendor ? VENDOR : POOL;
  const rel = normalize(isVendor ? url.slice('/vendor/'.length) : url).replace(/^(\.\.[/\\])+/, '');
  const file = join(base, rel);
  if (!file.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
  const st = await stat(file).catch(() => null);
  if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + url); return; }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length, 'cache-control': 'no-cache', 'access-control-allow-origin': '*',
  });
  res.end(body);
}

// ── boot ────────────────────────────────────────────────────────────────────
const http_ = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, online: byToken.size, accounts: users.size, queue: queue.length, matches: matches.size, physics: { dt: PHYS.DT, eBall: PHYS.E_BALL }, time: Date.now() }));
    return;
  }
  try { await serveFile(res, url); } catch (e) { res.writeHead(500); res.end(String(e.message || e)); }
});

const wss = new WsServer(http_, { path: '/ws' });
wss.on('connection', (conn, req) => {
  const sess = { conn, user: null, token: null, matchId: null, queueAt: 0, ip: conn.ip, since: Date.now() };
  conn.sess = sess;
  push(conn, 'hello', { server: 'neurio-pool', version: 1, time: Date.now(), online: byToken.size });
  conn.on('message', (msg) => {
    try {
      const type = String(msg.type || '');
      const fn = handlers[type];
      if (!fn) { reply(conn, msg.id, null, `unknown type: ${type}`); return; }
      // a signed-in-only guard for everything except auth/ping
      if (type !== 'auth' && type !== 'presence' && !sess.user) { reply(conn, msg.id, null, 'not signed in'); return; }
      const data = fn(sess, msg.data || {}, msg);
      Promise.resolve(data).then((d) => {
        if (msg.id === undefined) return;
        if (d && d.ok === false) reply(conn, msg.id, d, d.why);
        else reply(conn, msg.id, d);
      }).catch((e) => { log('handler error', type, e); if (msg.id !== undefined) reply(conn, msg.id, null, 'server error'); });
    } catch (e) {
      log('message error', e);
      if (msg.id !== undefined) reply(conn, msg.id, null, 'server error');
    }
  });
  conn.on('bad', () => conn.close(1002, 'bad frame'));
  conn.on('close', () => {
    if (sess.token) byToken.delete(sess.token);
    const qi = queue.findIndex((c) => c.session === sess);
    if (qi >= 0) {
      const c = queue.splice(qi, 1)[0];
      if (c.stake > 0) addCoins(c.user, 'free', c.stake, 'queue disconnect refund');
    }
    if (sess.matchId) {
      const m = matches.get(sess.matchId);
      if (m && !m.over) {
        const idx = m.seats.findIndex((s) => s && s.session === sess);
        if (idx >= 0) {
          // give the other player a moment — a dropped socket is not a resign
          setTimeout(() => { if (!m.over && m.seats[idx] && m.seats[idx].session === sess) forfeit(m, idx, `${sess.user ? sess.user.profile.name : 'a player'} disconnected`); }, 20000);
          broadcastMatch(m, 'match.peer', { matchId: m.id, peer: idx, state: 'disconnected', graceMs: 20000 });
        }
      }
    }
    announcePresence();
  });
});

await loadUsers();
http_.listen(PORT, HOST, () => {
  log(`NEURIO Pool Hall server on http://${HOST}:${PORT}/  ·  ws://${HOST}:${PORT}/ws`);
  log(`static: ${POOL} (+ ${VENDOR} as /vendor)  ·  accounts: ${USERS_FILE}`);
  log(`physics dt=${PHYS.DT} — shots are replayed here, results are decided here`);
});

process.on('SIGINT', () => { log('shutting down'); wss.close(); http_.close(); process.exit(0); });
process.on('uncaughtException', (e) => log('uncaught:', e));
process.on('unhandledRejection', (e) => log('unhandled rejection:', e));

export { handlers, users, matches, LIMITS };
