// ═════════════════════════════════════════════════════════════════════════════
// SWINDLE SQUAD — authoritative game engine.
//
// This module is the single source of truth for scores, secrets, roles, deals
// and reveals. The same class runs on the dedicated server (online play) and
// inside the browser tab when you host a room with bots. Clients never compute
// anything that matters: they only render the *redacted* view this file hands
// them via Room.view(pid).
// ═════════════════════════════════════════════════════════════════════════════

import { mulberry32, clamp, pick, rint, shuffle, cleanName, cleanText, filterChat, makeCode, fmt } from './util.js';
import {
  PROTO, CFG, ROLES, ROLE_BY_ID, ABLE_ROLES, EMOTES, ROUND_BY_ID, ALL_ROUNDS, planRounds,
  phaseTimes, DEFAULT_SETTINGS, validateAvatar, CHAT_LINES, REACTIONS, ANNOUNCER, TAGS, GOODS,
} from './content.js';
import { botThink } from './bots.js';

export const PHASE = {
  LOBBY: 'lobby',
  BRIEF: 'brief',
  TALK: 'talk',
  SUBMIT: 'submit',
  LOCK: 'lock',
  REVEAL: 'reveal',
  RESULTS: 'results',
  FINAL: 'final',
};

const AUTO_COMMIT_DELAY = 900;   // ms after a bot wants to act (feels human)
const MAX_OFFERS = 4;
const MAX_DEAL_CHARS = 40;

let IDN = 1;

export class Room {
  /**
   * @param {object} o
   *  o.code           room code (generated if absent)
   *  o.private        only via code
   *  o.rngSeed         deterministic sim (tests / replays)
   *  o.broadcast(fn)   fn(topic, payload) — send to one or all
   *  o.now()           clock
   */
  constructor(o = {}) {
    this.rng = mulberry32((o.rngSeed ?? Math.floor(Math.random() * 1e9)) >>> 0);
    this.code = (o.code || makeCode(this.rng)).toUpperCase().slice(0, 5);
    this.private = o.private !== false;
    this.settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) };
    this.now = o.now ? o.now() : Date.now();
    this._now = o.now || (() => Date.now());
    this.broadcast = o.broadcast || (() => {});
    this.players = new Map();
    this.host = null;
    this.state = PHASE.LOBBY;
    this.events = [];
    this.chatLog = [];
    this.round = null;
    this.roundIndex = -1;
    this.plan = [];
    this.startedAt = 0;
    this.phaseEnds = 0;
    this.dirty = true;
    this.beatCursor = 0;
    this.res = null;
    this.tickCount = 0;
    this.log = [];
  }

  // ── time helpers ───────────────────────────────────────────────────────────
  tick(dtMs) {
    this.now = this._now();
    this.tickCount++;
    if (this.state === PHASE.LOBBY) { this.flush(); return; }
    if (this.state === PHASE.FINAL) { this.flush(); return; }

    const elapsed = this.now - this.phaseEnds;
    if (this.state === PHASE.REVEAL) {
      // reveal advances on its own beat track so the pacing feels staged
      const beats = this.round?.beats || [];
      if (this.beatCursor < beats.length) {
        const step = CFG.revealBeatMs * (this.round.def.kind === 'minigame' ? 0.8 : 1);
        const need = (this.beatCursor + 1) * step;
        if (this.now - this.phaseStart >= need) {
          this.beatCursor++;
          this.dirty = true;
        }
      } else if (this.now - this.phaseStart >= beats.length * CFG.revealBeatMs + 1500) {
        this.toResults();
      }
    } else if (this.now >= this.phaseEnds) {
      this.advance();
    } else {
      // live mechanics that run on the clock
      if (this.state === PHASE.TALK || this.state === PHASE.SUBMIT) {
        this.botsAct();
        if (this.round?.def.id === 'parcel') this.parcelDecay();
        if (this.round?.def.id === 'mg_vanish') this.potDecay();
        this.parcelAutoPass();
      }
      if (this.state === PHASE.BRIEF && this.now - this.phaseStart > 1200) this.botsAct();
    }
    this.flush();
  }

  setPhase(state, ms) {
    this.state = state;
    this.phaseStart = this.now;
    this.phaseEnds = this.now + (ms || 0);
    this.dirty = true;
    this.push('phase', { phase: state, endsAt: this.phaseEnds, round: this.roundIndex });
  }

  advance() {
    switch (this.state) {
      case PHASE.BRIEF: this.setPhase(PHASE.TALK, this.round.times.talk); this.push('announce', { text: pick(this.rng, ANNOUNCER.roundStart) }); break;
      case PHASE.TALK: this.beginSubmit(); break;
      case PHASE.SUBMIT: this.lockAndResolve(); break;
      case PHASE.LOCK: this.beginReveal(); break;
      case PHASE.RESULTS: this.nextRound(); break;
      default: break;
    }
  }

  // ── roster ─────────────────────────────────────────────────────────────────
  addPlayer(c) {
    const pid = 'p' + (IDN++);
    const p = {
      pid, token: Math.random().toString(36).slice(2, 12),
      name: cleanName(c.name, 'Guest' + (this.players.size + 1)),
      avatar: validateAvatar(c.avatar),
      ready: false, connected: true, isBot: false, spectating: false,
      joined: this.now, lastSeen: this.now,
      chips: CFG.startChips, score0: CFG.startChips,
      seat: this.nextSeat(), pos: null, rotY: 0, emote: null, emoteAt: 0,
      chatAt: 0, acts: 0, actsAt: 0, strikes: 0, earned: 0,
      stats: { scams: 0, catches: 0, wrong: 0, trusted: 0, best: 0, wins: 0, rounds: 0, bluffed: 0, voids: 0, insured: 0 },
      hist: [],
      conn: c.conn || null,
    };
    p.pos = this.spawnPos(p.seat);
    this.players.set(pid, p);
    if (!this.host) this.host = pid;
    this.dirty = true;
    this.push('join', { pid, name: p.name, avatar: p.avatar });
    return p;
  }

  addBot(name, avatar) {
    const pid = 'b' + (IDN++);
    const p = {
      pid, token: null, name: name || this.botName(), avatar: validateAvatar(avatar || this.botAvatar()),
      ready: true, connected: true, isBot: true, spectating: false, joined: this.now, lastSeen: this.now,
      chips: CFG.startChips, score0: CFG.startChips, seat: this.nextSeat(), pos: this.spawnPos(this.nextSeat() - 1), rotY: 0,
      emote: null, emoteAt: 0, chatAt: 0, acts: 0, actsAt: 0, strikes: 0, earned: 0,
      stats: { scams: 0, catches: 0, wrong: 0, trusted: 0, best: 0, wins: 0, rounds: 0, bluffed: 0, voids: 0, insured: 0 },
      hist: [], conn: null, nextAct: 0,
    };
    this.players.set(pid, p);
    this.dirty = true;
    this.push('join', { pid, name: p.name, avatar: p.avatar, bot: true });
    return p;
  }

  botName() {
    const N = ['Marlo', 'Bea', 'Sump', 'Tilda', 'Gus', 'Nim', 'Ozzy', 'Pim', 'Vero', 'Dax', 'Juniper', 'Rook', 'Kesse', 'Fig', 'Wren', 'Milo'];
    const taken = new Set([...this.players.values()].map((p) => p.name));
    const free = N.filter((n) => !taken.has(n));
    return free.length ? free[Math.floor(this.rng() * free.length)] : 'Bot' + rint(this.rng, 10, 99);
  }
  botAvatar() {
    return validateAvatar({
      skin: rint(this.rng, 0, 5), face: rint(this.rng, 0, 9), hair: rint(this.rng, -1, 9), hat: pick(this.rng, [-1, -1, 0, 1, 2, 5]),
      glasses: pick(this.rng, [-1, -1, 0, 1, 2]), shirt: rint(this.rng, 0, 8), pants: rint(this.rng, 0, 5),
      shoes: rint(this.rng, 0, 5), acc: pick(this.rng, [-1, -1, 0, 1, 2, 3]), color: rint(this.rng, 0, 13), hairColor: rint(this.rng, 0, 13),
    });
  }
  nextSeat() {
    const used = new Set([...this.players.values()].map((p) => p.seat));
    for (let i = 0; i < CFG.maxPlayers; i++) if (!used.has(i)) return i;
    return used.size;
  }
  spawnPos(seat) {
    const a = (seat / 8) * Math.PI * 2;
    return { x: Math.cos(a) * 3.1, z: Math.sin(a) * 3.1 };
  }

  dropPlayer(pid, reason) {
    const p = this.players.get(pid);
    if (!p) return;
    if (p.isBot) { this.players.delete(pid); this.dirty = true; return; }
    p.connected = false;
    p.rejoinUntil = this.now + 90_000;
    this.push('left', { pid, name: p.name, reason: reason || 'gone' });
    if (this.host === pid) this.migrateHost();
    if (this.state !== PHASE.LOBBY && this.state !== PHASE.FINAL) {
      // a table needs a body: slot in a bot so the round stays solvable
      const active = this.activePids().length;
      if (active < 2) { const b = this.addBot(); b.seat = p.seat; p.seat = -1; p.spectating = true; }
    }
    this.dirty = true;
  }
  migrateHost() {
    const next = [...this.players.values()].filter((p) => p.connected && !p.isBot).sort((a, b) => a.joined - b.joined)[0];
    if (next) { this.host = next.pid; this.push('host', { pid: next.pid, name: next.name }); }
    else if (this.players.size) { const any = [...this.players.values()].find((p) => p.connected); if (any) this.host = any.pid; }
  }
  removePlayer(pid) { this.players.delete(pid); this.dirty = true; }

  activePids() {
    return [...this.players.values()].filter((p) => p.seat >= 0 && !p.spectating).map((p) => p.pid);
  }

  // ── lobby actions ───────────────────────────────────────────────────────────
  startGame() {
    const act = this.activePids();
    if (act.length < CFG.minPlayers) { this.push('toast', { text: 'Need ' + CFG.minPlayers + ' players at the table.' }); return; }
    const notReady = [...this.players.values()].filter((p) => act.includes(p.pid) && !p.ready && !p.isBot).map((p) => p.name);
    if (notReady.length && this.settings.strictReady) { this.push('toast', { text: 'Not ready yet: ' + notReady.join(', ') }); return; }
    this.startedAt = this.now;
    this.plan = planRounds(this.rng, clamp(this.settings.rounds, 3, 10), this.settings.minigames);
    this.roundIndex = -1;
    for (const p of this.players.values()) { p.chips = CFG.startChips; p.score0 = CFG.startChips; p.hist = []; }
    this.push('start', { plan: this.plan.map((r) => ({ id: r.id, kind: r.kind })), rounds: this.plan.length });
    this.nextRound();
  }

  nextRound() {
    this.roundIndex++;
    if (this.roundIndex >= this.plan.length) return this.finish();
    const entry = this.plan[this.roundIndex];
    const def = ROUND_BY_ID[entry.id];
    const pids = shuffle(this.rng, this.activePids());
    if (pids.length < CFG.minPlayers) { this.toLobby('Not enough players — back to the lobby.'); return; }

    // ── secret roles: re-dealt every round, never permanent
    const roles = dealRoles(this.rng, pids, this.roundIndex);
    const R = {
      id: entry.id, def, index: this.roundIndex, kind: def.kind,
      pub: {}, sec: {}, inv: {}, offers: [], offerId: 1, commits: {},
      accuses: {}, pushes: {}, award: {}, awards: [], beats: [],
      flags: {}, seedRoll: Math.floor(this.rng() * 1e9),
      roles: {},
    };
    for (const pid of pids) R.roles[pid] = roles.get(pid);
    this.round = R;
    this.roundCtx = this.makeCtx(R, pids);
    R.times = phaseTimes(def, this.settings);
    R.beats = [];
    try { def.begin?.(this.roundCtx); } catch (e) { console.error('[begin]', def.id, e); }
    for (const pid of pids) {
      const s = R.sec[pid] || (R.sec[pid] = {});
      s.role = roles.get(pid);
      s.commit = null; s.push = false; s.accuse = null; s.insuredBy = null;
      s.offerCount = 0; s.locked = false; s.trick = null; s.flagTarget = null; s.peekUsed = false;
      s.botNext = 0;
    }
    this.beatCursor = 0;
    this.setPhase(PHASE.BRIEF, R.times.brief);
    this.push('round', {
      index: R.index, total: this.plan.length, id: R.id, title: def.title, icon: def.icon,
      blurb: def.blurb, kind: R.kind, offers: !!def.offers, accuse: !!def.accuse, push: !!def.push,
    });
    this.push('announce', { text: def.blurb });
    for (const pid of pids) this.players.get(pid).stats.rounds++;
  }

  toLobby(msg) {
    this.round = null; this.roundCtx = null;
    this.setPhase(PHASE.LOBBY, 0);
    for (const p of this.players.values()) p.ready = false;
    if (msg) this.push('toast', { text: msg });
  }

  beginSubmit() {
    // accepted deals survive into the reckoning; unpicked offers die at lock
    this.setPhase(PHASE.SUBMIT, this.round.times.submit);
    this.push('announce', { text: pick(this.rng, ANNOUNCER.submit) });
    for (const pid of this.activePids()) {
      const o = this.round.def.optionsFor?.(this.roundCtx, pid) || [];
      this.push('options', { pid: null, view: null }, pid);
    }
  }

  lockAndResolve() {
    // auto-fill anyone who never committed
    for (const pid of this.activePids()) {
      const s = this.round.sec[pid];
      if (!s || s.commit != null) continue;
      const opts = this.round.def.optionsFor?.(this.roundCtx, pid) || [];
      const safe = opts.find((o) => o.style === 'safe') || opts[0];
      s.commit = safe ? safe.id : null;
      s.auto = true;
    }
    for (const o of this.round.offers) if (o.status === 'open') o.status = 'void';
    this.settleDeals();
    this.setPhase(PHASE.LOCK, 900);
    this.push('lock', { round: this.round.index });
    try { this.round.def.resolve?.(this.roundCtx); } catch (e) { console.error('[resolve]', this.round.id, e); }
    // commit awards into chips + feed
    for (const a of this.round.awards) {
      const p = this.players.get(a.pid);
      if (!p) continue;
      p.chips = Math.max(0, p.chips + a.delta);
      p.stats.best = Math.max(p.stats.best, a.delta);
      if (a.tag === 'SCAM_SUCCESS') p.stats.scams++;
      if (a.tag === 'GOOD_CALL') p.stats.catches++;
      if (a.tag === 'WRONG_ACCUSE') p.stats.wrong++;
      if (a.tag === 'INSURED') p.stats.insured++;
      if (a.tag === 'TRICK_FAILED') p.stats.bluffed++;
    }
    this.push('awards', { round: this.round.index, awards: this.round.awards.map((a) => ({ pid: a.pid, delta: a.delta, tag: a.tag, why: a.why })) });
  }

  beginReveal() {
    this.beatCursor = 0;
    const beats = this.round.beats || [];
    this.setPhase(PHASE.REVEAL, beats.length * CFG.revealBeatMs + 1600);
    this.push('announce', { text: pick(this.rng, ANNOUNCER.reveal) });
    this.push('reveal', {
      round: this.round.index,
      intro: this.round.def.beatIntro || 'Reveal.',
      beats,
      roles: Object.fromEntries(this.activePids().map((pid) => [pid, this.round.sec[pid].role])),
      commits: Object.fromEntries(this.activePids().map((pid) => [pid, this.round.sec[pid].commit])),
      awards: this.round.awards.map((a) => ({ pid: a.pid, delta: a.delta, tag: a.tag, why: a.why })),
    });
    // auto reactions from bots so the table is never silent
    for (const p of this.players.values()) {
      if (!p.isBot || !this.round.awards.some((a) => a.pid === p.pid)) continue;
      const a = this.round.awards.find((x) => x.pid === p.pid);
      const pool = REACTIONS[TAGS[a.tag]?.n];
      if (pool && this.rng() < 0.7) this.say(p.pid, pick(this.rng, pool));
    }
  }

  toResults() {
    const board = [...this.players.values()].filter((p) => p.seat >= 0 && !p.spectating)
      .map((p) => ({ pid: p.pid, name: p.name, chips: p.chips, avatar: p.avatar, scams: p.stats.scams, catches: p.stats.catches }))
      .sort((a, b) => b.chips - a.chips);
    for (const [i, row] of board.entries()) {
      const p = this.players.get(row.pid);
      p.hist.push({ round: this.round.index, gained: this.round.awards.filter((a) => a.pid === p.pid).reduce((s, a) => s + a.delta, 0), place: i + 1 });
    }
    this.lastBoard = board;
    this.setPhase(PHASE.RESULTS, this.round.kind === 'minigame' ? 5200 : 7000);
    this.push('results', { board, round: this.round.index });
    this.push('announce', { text: pick(this.rng, ANNOUNCER.results) });
  }

  finish() {
    const board = [...this.players.values()].filter((p) => p.seat >= 0 && !p.spectating)
      .map((p) => ({ pid: p.pid, name: p.name, chips: p.chips, avatar: p.avatar, stats: p.stats, wins: p.stats.wins }))
      .sort((a, b) => b.chips - a.chips || b.scams - a.scams);
    const winner = board[0];
    if (winner) {
      const p = this.players.get(winner.pid);
      p.stats.wins++;
      // lifetime payout: placement + performance, spent on cosmetics
      for (const [i, row] of board.entries()) {
        const q = this.players.get(row.pid);
        const place = [260, 170, 120, 90, 70, 55, 45, 40][i] ?? 30;
        q.earned = Math.max(10, Math.round(place + q.stats.scams * 22 + q.stats.catches * 16 - q.stats.wrong * 4));
      }
    }
    this.setPhase(PHASE.FINAL, 0);
    this.push('final', {
      board: board.map((b) => ({ ...b, earned: this.players.get(b.pid).earned })),
      winner: winner?.pid || null,
      quote: pick(this.rng, ANNOUNCER.final),
    });
  }

  rematch(keepSeats = true) {
    for (const p of this.players.values()) {
      p.ready = p.isBot || keepSeats;
      p.chips = CFG.startChips;
    }
    this.plan = planRounds(this.rng, clamp(this.settings.rounds, 3, 10), this.settings.minigames);
    this.roundIndex = -1;
    this.setPhase(PHASE.LOBBY, 0);
    this.push('rematch', { plan: this.plan.map((r) => r.id) });
    if (this.settings.autoRematch) this.startGame();
  }

  // ── context handed to round definitions ────────────────────────────────────
  makeCtx(R, pids) {
    const self = this;
    const ctx = {
      R, pids, rng: () => self.rng(), now: 0,
      get P() {
        const m = {};
        for (const pid of pids) { const p = self.players.get(pid); if (p) m[pid] = { pid, name: p.name, chips: p.chips, avatar: p.avatar }; }
        return m;
      },
      roleOf(pid) { return R.sec[pid]?.role || R.roles?.[pid] || 'civilian'; },
      sec(pid, obj) { R.sec[pid] = Object.assign(R.sec[pid] || {}, obj); },
      rint(a, b) { return rint(self.rng, a, b); },
      pick(arr) { return pick(self.rng, arr); },
      shuffle(arr) { return shuffle(self.rng, arr); },
      flip() { return self.rng() < 0.5 ? 1 : 0; },
      award(pid, delta, tag, why) {
        if (!Number.isFinite(delta)) delta = 0;
        delta = Math.round(clamp(delta, -4000, 4000));
        R.award[pid] = (R.award[pid] || 0) + delta;
        R.awards.push({ pid, delta, tag: tag || 'NOTHING', why: why || '' });
      },
      beat(o) { if (!o) return; if (!R.beats) R.beats = []; if (R.beats.length >= 16) return; R.beats.push(normalizeBeat(o, R, self)); },
      caughtBy(pid) {
        const flagged = R.flags[pid] != null || Object.values(R.sec).some((s) => s.flagTarget === pid);
        const named = Object.entries(R.accuses).some(([from, to]) => to === pid && from !== pid);
        const victimSays = R.sec[pid]?.salted != null || R.sec[pid]?.trick != null;
        return victimSays && (flagged || named);
      },
    };
    return ctx;
  }

  // ── inbound messages (the ONLY way a client can affect the game) ───────────
  handle(pid, m) {
    if (typeof m !== 'object' || m === null) return;
    const p = this.players.get(pid);
    if (!p) return;
    p.lastSeen = this.now;
    if (!p.connected && m.t !== 'resume') { /* ignore until resumed */ }
    const rate = this.rateHit(p);
    if (rate === 'blocked') return;

    switch (m.t) {
      case 'ready': p.ready = !!m.on; this.dirty = true; break;
      case 'avatar':
        p.avatar = validateAvatar(m.avatar); this.dirty = true;
        this.push('avatar', { pid, avatar: p.avatar });
        break;
      case 'name': {
        const n = cleanName(m.name, p.name);
        if (n && n !== p.name && ![...this.players.values()].some((q) => q !== p && q.name.toLowerCase() === n.toLowerCase())) {
          p.name = n; this.dirty = true; this.push('rename', { pid, name: n });
        }
        break;
      }
      case 'emote': this.emote(pid, m.id | 0); break;
      case 'chat': this.chat(pid, m.text, m.quick || m.qc); break;
      case 'move': this.move(p, m); break;
      case 'sit':
        p.sitting = !!m.on;
        if (m.on && Number.isInteger(m.seat) && m.seat >= 0 && m.seat < CFG.maxPlayers) {
          const taken = [...this.players.values()].some((q) => q !== p && q.seat === m.seat && !q.sitting);
          if (!taken) p.seat = m.seat;
        }
        this.push('sitting', { pid, on: p.sitting, seat: p.seat });
        break;
      case 'spectate': p.spectating = !!m.on; if (p.spectating) p.seat = -1; else if (p.seat < 0) p.seat = this.nextSeat(); this.dirty = true; break;
      case 'act': this.act(pid, m); break;
      case 'offer': this.offerNew(pid, m); break;
      case 'offerResp': this.offerRespond(pid, m); break;
      case 'offerVoid': this.offerVoid(pid, m); break;
      case 'accuse': this.accuse(pid, m.target); break;
      case 'push': this.setPush(pid, !!m.on); break;
      case 'kick': if (this.host === pid) { this.dropPlayer(m.pid, 'kicked'); this.push('kicked', { pid: m.pid }); } break;
      case 'botAdd': if (this.host === pid && this.state === PHASE.LOBBY) { if (this.players.size < CFG.maxPlayers) this.addBot(); } break;
      case 'botDel': if (this.host === pid && this.state === PHASE.LOBBY) { const b = [...this.players.values()].filter((x) => x.isBot).pop(); if (b) this.removePlayer(b.pid); } break;
      case 'settings': this.hostSet(pid, m); break;
      case 'start': if (this.host === pid && this.state === PHASE.LOBBY) this.startGame(); break;
      case 'rematch': if (this.host === pid && this.state === PHASE.FINAL) this.rematch(!!m.keep); break;
      case 'abort': if (this.host === pid && this.state !== PHASE.LOBBY) this.toLobby('The host called it. Back to the table.'); break;
      case 'skipTo': if (this.host === pid && this.state === PHASE.REVEAL) { this.beatCursor = (this.round.beats || []).length; this.dirty = true; } break;
      case 'ping': this.to(pid, { t: 'pong', ts: m.ts, serverNow: this.now }); return;
      default: p.strikes++;
    }
    this.dirty = true;
  }

  rateHit(p) {
    const now = this.now;
    if (now - p.actsAt > 1500) { p.acts = 0; p.actsAt = now; }
    p.acts++;
    if (p.acts > 40) { p.strikes++; if (p.strikes > 40 && !p.isBot) this.dropPlayer(p.pid, 'flooding'); return 'blocked'; }
    return 'ok';
  }

  hostSet(pid, m) {
    if (this.host !== pid) return;
    const allowed = new Set(['rounds', 'turnMs', 'submitMs', 'briefMs', 'private', 'chat', 'minigames', 'tells', 'autoRematch', 'strictReady', 'bots']);
    for (const [k, v] of Object.entries(m.k || {})) {
      if (!allowed.has(k)) continue;
      if (k === 'rounds') this.settings[k] = clamp(v | 0, 3, 10);
      else if (k === 'turnMs') this.settings[k] = clamp(v | 0, 25, 120);
      else if (k === 'submitMs') this.settings[k] = clamp(v | 0, 12, 60);
      else if (k === 'briefMs') this.settings[k] = clamp(v | 0, 6, 30);
      else if (k === 'tells') this.settings[k] = clamp(v | 0, 0, 2);
      else if (k === 'bots') this.settings[k] = clamp(v | 0, 0, 6);
      else this.settings[k] = !!v;
    }
    this.push('settings', { settings: this.settings });
  }

  say(pid, text) {
    const p = this.players.get(pid);
    if (!p || !text) return;
    if (this.now - p.chatAt < 300) return;
    p.chatAt = this.now;
    const rec = { pid, name: p.name, text: cleanText(text, 80), at: this.now };
    this.chatLog.push(rec);
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.push('chat', rec);
  }

  emote(pid, id) {
    const e = EMOTES.find((x) => x.id === id);
    if (!e) return;
    const p = this.players.get(pid);
    p.emote = id; p.emoteAt = this.now;
    this.push('emote', { pid, id, anim: e.anim, dur: e.dur });
    // emote at someone → they see a "tell" ping
    if (this.round && (this.state === PHASE.TALK)) {
      for (const other of this.activePids()) if (other !== pid) this.push('tell', { pid: other, from: pid, kind: 'emote' }, other);
    }
  }

  chat(pid, text, quick) {
    const p = this.players.get(pid);
    if (!this.settings.chat) return;
    if (this.now - p.chatAt < 600) return;
    p.chatAt = this.now;
    const out = quick ? safeQuick(text) : filterChat(text);
    if (!out) return;
    const rec = { pid, name: p.name, text: out, at: this.now };
    this.chatLog.push(rec);
    if (this.chatLog.length > 60) this.chatLog.shift();
    this.push('chat', rec);
  }

  move(p, m) {
    if (p.isBot || p.spectating) return;
    const x = +m.x, z = +m.z, r = +m.r;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    // server-authoritative validation: clamp inside the room, cap speed
    const nx = clamp(x, -7.4, 7.4), nz = clamp(z, -6.4, 6.4);
    if (p.pos) {
      const dx = nx - p.pos.x, dz = nz - p.pos.z;
      const dtS = Math.max(0.033, (this.now - (p.mvAt || this.now)) / 1000);
      const max = 6.2 * dtS + 0.25;
      if (Math.hypot(dx, dz) > max) { p.strikes++; return; }
    }
    p.pos = { x: +nx.toFixed(2), z: +nz.toFixed(2) };
    p.rotY = Number.isFinite(r) ? r : p.rotY;
    p.mvAt = this.now;
  }

  // ── player actions during a round ─────────────────────────────────────────
  act(pid, m) {
    if (!this.round) return;
    if (this.state !== PHASE.TALK && this.state !== PHASE.SUBMIT && this.state !== PHASE.BRIEF) return;
    if (!this.activePids().includes(pid)) return;
    const s = this.round.sec[pid];
    if (!s) return;
    const id = String(m.id || '').slice(0, 24);
    const payload = sanitizePayload(m.p);

    if (id === 'commit') {
      if (this.state === PHASE.REVEAL || this.state === PHASE.LOCK || this.state === PHASE.RESULTS) return;
      const opts = this.round.def.optionsFor?.(this.roundCtx, pid) || [];
      const oid = String(payload?.choice || '').slice(0, 12);
      const found = opts.find((o) => o.id === oid);
      if (!found) return;
      s.commit = found.id; s.commitLabel = found.label; s.locked = true;
      this.push('locked', { pid, on: true });
      return;
    }
    if (id === 'uncommit') { s.locked = false; s.commit = null; this.push('locked', { pid, on: false }); return; }

    // generic role abilities available in any round
    if (id === 'flag') {
      if (s.role !== 'detective' || s.flagTarget != null) return;
      const t = payload?.target;
      if (!this.players.get(t) || t === pid || !this.activePids().includes(t)) return;
      s.flagTarget = t; this.round.flags[t] = pid;
      this.push('flag', { by: pid, on: t });
      return;
    }
    if (id === 'insure') {
      if (s.role !== 'protector' || s.insuredSet) return;
      const t = payload?.target;
      if (!this.players.get(t) || t === pid || !this.activePids().includes(t)) return;
      s.insuredSet = t; s.insured = true;
      this.round.sec[t].insuredBy = pid;
      this.push('insure', { by: pid, on: t });
      return;
    }
    if (id === 'peek') {
      if (s.role !== 'insider' || s.peekUsed) return;
      const t = payload?.target;
      if (!this.players.get(t) || t === pid || !this.activePids().includes(t)) return;
      s.peekUsed = true;
      const other = this.round.sec[t];
      const hint = peekSummary(this.round, t, other);
      this.to(pid, { t: 'peek', hint, on: t });
      return;
    }

    // scenario-specific
    const def = this.round.def;
    if (def.onAction) {
      let ok = false;
      try { ok = def.onAction(this.roundCtx, pid, id, { ...payload, ctxTime: this.now }); } catch (e) { ok = false; }
      if (ok) { this.dirty = true; return; }
    }
    if (id === 'voidOffer') { this.offerVoid(pid, { id: String(payload?.id || '').slice(0, 8) }); return; }
    // not handled → ignore silently (client may have raced a phase change)
  }

  offerNew(pid, m) {
    if (!this.round || !this.round.def.offers) return;
    if (this.state !== PHASE.TALK) return;
    const s = this.round.sec[pid];
    if ((s.offerCount || 0) >= MAX_OFFERS) return;
    const to = m.to;
    if (!this.activePids().includes(to) || to === pid) return;
    const inv = this.round.inv[pid] || [];
    const giveItem = inv.find((it) => it.uid === m.giveItem) || null;
    const wantItem = (this.round.inv[to] || []).find((it) => it.uid === m.wantItem) || null;
    const giveChips = clamp(Math.round(+m.giveChips || 0), 0, 900);
    const wantChips = clamp(Math.round(+m.wantChips || 0), 0, 900);
    if (!giveItem && !wantItem && !giveChips && !wantChips) return;
    const note = cleanText(m.note || '', MAX_DEAL_CHARS);
    const o = {
      id: 'o' + (this.round.offerId++), from: pid, to,
      give: giveItem ? { kind: 'item', uid: giveItem.uid, gid: giveItem.gid, v: giveItem.v } : { kind: 'chips', v: giveChips },
      want: wantItem ? { kind: 'item', uid: wantItem.uid, gid: wantItem.gid, v: wantItem.v } : { kind: 'chips', v: wantChips },
      note, status: 'open', voidIntent: false, createdAt: this.now,
    };
    if (giveItem && giveChips) { o.give = { kind: 'both', item: giveItem.uid, chips: giveChips, gid: giveItem.gid, v: giveItem.v }; }
    if (wantItem && wantChips) { o.want = { kind: 'both', item: wantItem.uid, chips: wantChips, gid: wantItem.gid, v: wantItem.v }; }
    this.round.offers.push(o);
    s.offerCount++;
    this.push('offer', { offer: publicOffer(this.round, o, this.players) });
  }

  offerRespond(pid, m) {
    if (!this.round) return;
    const o = this.round.offers.find((x) => x.id === m.id);
    if (!o || o.to !== pid) return;
    if (this.state !== PHASE.TALK && this.state !== PHASE.SUBMIT) return;
    if (o.status !== 'open') return;
    o.status = m.accept ? 'accepted' : 'rejected';
    if (m.accept) {
      this.round.sec[pid].trusted = (this.round.sec[pid].trusted || 0) + 1;
      this.players.get(pid).stats.trusted++;
      this.beatFor(this.round, { kind: 'deal', pid, tone: 'story', text: this.players.get(pid).name + ' took the deal from ' + this.players.get(o.from).name });
    }
    this.push('offerState', { id: o.id, status: o.status, to: pid });
  }

  offerVoid(pid, m) {
    if (!this.round) return;
    if (this.state !== PHASE.SUBMIT && this.state !== PHASE.TALK) return;
    const o = this.round.offers.find((x) => x.id === m.id);
    if (!o || o.from !== pid || o.status !== 'accepted') return;
    o.voidIntent = !!m.on;
    this.to(pid, { t: 'offerVoid', id: o.id, on: o.voidIntent });
  }

  accuse(pid, target) {
    if (!this.round || !this.round.def.accuse) return;
    if (this.state !== PHASE.SUBMIT && this.state !== PHASE.TALK) return;
    const t = target == null ? null : target;
    if (t != null && (!this.activePids().includes(t) || t === pid)) return;
    const prev = this.round.accuses[pid];
    this.round.accuses[pid] = t;
    if (t) this.push('accuseSent', { by: pid });
    this.to(pid, { t: 'accuse', target: t });
    void prev;
  }

  setPush(pid, on) {
    if (!this.round || !this.round.def.push) return;
    const s = this.round.sec[pid];
    if (!s) return;
    s.push = !!on;
    this.to(pid, { t: 'push', on: s.push });
  }

  // ── deal settlement, shared by every round with offers ─────────────────────
  settleDeals() {
    const R = this.round;
    for (const o of R.offers) {
      if (o.status !== 'accepted') continue;
      const from = this.players.get(o.from), to = this.players.get(o.to);
      if (!from || !to) continue;
      const voided = !!o.voidIntent;
      const flaggedBy = R.flags[o.from] ?? (R.sec[o.from]?.flagTarget === o.from ? o.from : null) ??
        Object.keys(R.sec).find((x) => R.sec[x].flagTarget === o.from) ?? null;
      const victimCalled = R.accuses[o.to] === o.from;
      const trickFree = R.sec[o.from]?.role === 'trickster';
      // a loophole survives only if nobody flagged the cheat and the victim did not call it
      const blocked = voided && (!!flaggedBy || victimCalled);
      const doGive = !voided || blocked;
      const doWant = !(voided && !blocked);
      let moved = [];
      if (doGive) moved = moved.concat(transfer(R, o.from, o.to, o.give));
      if (doWant) moved = moved.concat(transfer(R, o.to, o.from, o.want));
      const gc = chipsOf(o.give), wc = chipsOf(o.want);
      if (doGive && gc) { this.awardTag(o.from, -gc, 'PAID', 'paid for a deal'); this.awardTag(o.to, gc, 'PAID', 'paid for a deal'); }
      if (doWant && wc) { this.awardTag(o.to, -wc, 'PAID', 'paid for a deal'); this.awardTag(o.from, wc, 'PAID', 'paid for a deal'); }
      const wantVal = valOf(o.want), giveVal = valOf(o.give);
      if (R.sec[o.from]?.role === 'trader' && (doGive || doWant)) {
        this.awardTag(o.from, Math.round(Math.max(wantVal, giveVal) * 0.4), 'JOB', 'the table moves because of them');
      }
      if (voided && !blocked) {
        from.stats.voids++;
        this.awardTag(o.from, 190, 'SCAM_SUCCESS', 'took the prize, kept the promise in their pocket');
        const sting = Math.round(wantVal * 0.55) + 60;
        const ins = R.sec[o.to]?.insuredBy;
        if (ins != null) {
          this.awardTag(o.to, sting, 'INSURED', 'someone else ate the loss');
          this.awardTag(ins, 90, 'INSURED', 'their cover held');
        } else {
          this.awardTag(o.to, -sting, 'OUCH', 'the other side never showed up');
        }
        this.beatFor(R, { kind: 'trick', pid: o.from, focus: o.from, tone: 'trick', text: from.name + ' invoked the fine print — ' + to.name + ' got nothing but a signature' });
      } else if (voided && blocked) {
        this.awardTag(o.from, -200, 'TRICK_FAILED', 'loophole called out before it landed');
        if (victimCalled) this.awardTag(o.to, 170, 'GOOD_CALL', 'called the bluff and held the line');
        if (flaggedBy && flaggedBy !== o.to) this.awardTag(flaggedBy, 180, 'GOOD_CALL', 'flagged the exact hands that folded');
        this.beatFor(R, { kind: 'catch', pid: victimCalled ? o.to : flaggedBy, focus: o.from, tone: 'good', text: 'loophole blocked — the deal stands and ' + from.name + ' eats the fine' });
      } else {
        this.awardTag(o.from, 45, 'PAID', 'a deal that actually happened');
        this.awardTag(o.to, 45, 'PAID', 'a deal that actually happened');
        this.beatFor(R, { kind: 'deal', focus: o.from, tone: 'good', text: from.name + ' ⇄ ' + to.name + ': ' + (o.note || 'handshake, honoured') });
      }
      for (const g of moved) this.beatFor(R, { kind: 'goods', text: 'goods moved: ' + (g.name || 'parcel') });
      o.status = voided && !blocked ? 'void' : 'settled';
    }
  }
  awardTag(pid, delta, tag, why) {
    if (!Number.isFinite(delta)) return;
    this.round.award[pid] = (this.round.award[pid] || 0) + Math.round(delta);
    this.round.awards.push({ pid, delta: Math.round(delta), tag, why });
  }
  beatFor(R, o) {
    if (!R.beats) R.beats = [];
    if (R.beats.length >= 16) return;   // keep the reveal tight, never a scroll-fest
    R.beats.push(normalizeBeat(o, R, this));
  }

  // ── bots ────────────────────────────────────────────────────────────────────
  botsAct() {
    const R = this.round; if (!R) return;
    for (const pid of this.activePids()) {
      const p = this.players.get(pid);
      if (!p.isBot) continue;
      if (this.now < (p.nextAct || 0)) continue;
      p.nextAct = this.now + rint(this.rng, 700, 2100);
      const want = botThink(this, R, pid, this.state);
      if (!want) continue;
      switch (want.t) {
        case 'act': this.handle(pid, { t: 'act', id: want.id, p: want.p }); break;
        case 'commit': this.handle(pid, { t: 'act', id: 'commit', p: { choice: want.choice } }); break;
        case 'offer': this.handle(pid, { t: 'offer', ...want.o }); break;
        case 'offerResp': this.handle(pid, { t: 'offerResp', id: want.id, accept: want.accept }); break;
        case 'accuse': this.handle(pid, { t: 'accuse', target: want.target }); break;
        case 'push': this.handle(pid, { t: 'push', on: want.on }); break;
        case 'chat': this.chat(pid, want.text); break;
        case 'emote': this.emote(pid, want.id); break;
        default: break;
      }
    }
  }

  parcelDecay() {
    const R = this.round; if (!R || R.def.id !== 'parcel') return;
    R.drip = (R.drip || 0) + 1;
    if (R.drip % 40 === 0 && R.holder && R.heat) R.loot = Math.round(R.loot * 0.9);
  }
  potDecay() {
    const R = this.round; if (!R || R.def.id !== 'mg_vanish') return;
    R.currentPot = Math.max(30, (R.currentPot ?? R.pot) - (R.rate / 10));
    this.dirty = true;
  }
  parcelAutoPass() {
    const R = this.round; if (!R || R.def.id !== 'parcel') return;
    // if nobody moves it for a while, the parcel gets scared and hops on its own
    if (!R.lastHop) R.lastHop = this.now;
    if (this.now - R.lastHop > 9000 && this.state === PHASE.TALK && R.passes < 14) {
      const cand = this.activePids().filter((p) => p !== R.holder);
      if (cand.length) {
        const t = pick(this.rng, cand);
        R.lastHop = this.now;
        this.handle(R.holder, { t: 'act', id: 'pass', p: { target: t } });
        this.beatFor(R, { kind: 'pass', pid: R.holder, tone: 'trick', text: 'the parcel got cold feet and moved to ' + this.players.get(t).name });
      }
    }
  }

  // ── transport plumbing ──────────────────────────────────────────────────────
  push(topic, payload, onlyPid) {
    if (onlyPid) { this.to(onlyPid, { t: topic, ...payload }); return; }
    this.events.push({ t: topic, ...payload });
  }
  to(pid, msg) {
    const p = this.players.get(pid);
    if (!p || !p.conn) return;
    try { p.conn.send(msg); } catch (e) { /* socket gone */ }
  }
  flush() {
    const evs = this.events;
    const now = this._now();
    const due = now - (this.lastSnap || 0) > 66;           // ~15 Hz snapshots
    if (!evs.length && !this.dirty && !due) return;
    this.events = [];
    const sendSnap = due || this.dirty;
    this.dirty = false;
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      for (const e of evs) { try { p.conn.send(e); } catch (x) { /* gone */ } }
      if (sendSnap) { try { p.conn.send(this.view(p.pid)); } catch (x) { /* gone */ } }
    }
    if (sendSnap) this.lastSnap = now;
  }

  /** redacted per-player snapshot: secrets only ever go to their owner */
  view(pid, force) {
    const p = this.players.get(pid);
    const R = this.round;
    const act = this.activePids();
    const players = [...this.players.values()].map((q) => ({
      pid: q.pid, name: q.name, avatar: q.avatar, seat: q.seat, ready: q.ready,
      chips: q.chips, connected: q.connected, isBot: q.isBot, spectating: q.spectating,
      emote: q.emote, emoteAt: q.emoteAt, pos: q.pos, rotY: q.rotY,
      stats: { scams: q.stats.scams, catches: q.stats.catches, wins: q.stats.wins, rounds: q.stats.rounds },
      you: q.pid === pid, isHost: this.host === q.pid,
    }));
    const v = {
      t: 'state', proto: PROTO, code: this.code, private: this.private, host: this.host,
      phase: this.state, round: R ? R.index : -1, total: this.plan.length || this.settings.rounds,
      settings: this.settings, players,
      now: this.now, phaseEnds: this.phaseEnds, phaseStart: this.phaseStart,
      chat: this.chatLog.slice(-24),
    };
    if (R) {
      v.roundInfo = {
        id: R.id, title: R.def.title, icon: R.def.icon, blurb: R.def.blurb, kind: R.kind,
        offers: !!R.def.offers, accuse: !!R.def.accuse, push: !!R.def.push,
      };
      v.public = pubView(this, R, pid);
      v.offers = R.offers.map((o) => ({ ...publicOffer(R, o, this.players), mine: o.from === pid || o.to === pid ? { voidIntent: o.voidIntent } : null }));
      const s = R.sec[pid];
      if (s) {
        v.me = {
          pid,
          role: s.role,
          commit: s.commit, locked: !!s.locked, push: !!s.push, accuse: R.accuses[pid] || null,
          flagTarget: s.flagTarget || null, insuredSet: s.insuredSet || null,
          trusted: s.trusted || 0, offerCount: s.offerCount || 0,
          auto: !!s.auto,
        };
        try { v.secret = R.def.secretCard ? R.def.secretCard(this.roundCtx, pid) : null; } catch (e) { v.secret = null; }
        v.options = safeOpts(R.def.optionsFor?.(this.roundCtx, pid));
        v.actions = this.actionsFor(pid);
        v.inv = (R.inv[pid] || []).map((it) => ({ uid: it.uid, gid: it.gid, v: it.v, fake: it.fake }));
        // what others are holding: uids and values, never authenticity
        v.hands = {};
        for (const q of act) if (q !== pid && R.inv[q]) v.hands[q] = R.inv[q].map((it) => ({ uid: it.uid, gid: it.gid, v: it.v }));
        v.peekHint = s.peekHint || null;
      } else v.me = null;
      if (this.state === PHASE.REVEAL) {
        v.reveal = { beats: R.beats.slice(0, this.beatCursor), cursor: this.beatCursor, total: R.beats.length, awards: R.awards, roles: Object.fromEntries(act.map((x) => [x, R.sec[x].role])), done: this.beatCursor >= R.beats.length };
      }
      if (this.state === PHASE.RESULTS) v.board = this.lastBoard;
    }
    return v;
  }

  actionsFor(pid) {
    const R = this.round; if (!R) return [];
    const s = R.sec[pid]; if (!s) return [];
    const role = ROLE_BY_ID[s.role] || ROLE_BY_ID.civilian;
    const a = [];
    if (this.state === PHASE.TALK || this.state === PHASE.SUBMIT) {
      if (role.ability.includes('Flag') && s.flagTarget == null) a.push({ id: 'flag', label: 'Flag their hands', icon: '🚩', targets: 'others', hint: 'Any loophole they pull tonight dies at your flag. A wrong flag just costs face.' });
      if (role.ability.includes('Take The Heat') && !s.insuredSet) a.push({ id: 'insure', label: 'Take their heat', icon: '🛡️', targets: 'others', hint: 'Whatever lands on them, you eat it — and the house still pays you.' });
      if (role.ability.includes('Peek') && !s.peekUsed) a.push({ id: 'peek', label: 'Read one player', icon: '🗝️', targets: 'others', hint: 'You will be told the shape of what they are hiding.' });
    }
    let sc = [];
    try { sc = R.def.actionsFor?.(this.roundCtx, pid) || []; } catch (e) { sc = []; }
    return [...a, ...sc];
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function safeOpts(o) {
  if (!Array.isArray(o)) return [];
  return o.slice(0, 12).map((x) => ({ id: String(x.id).slice(0, 12), label: String(x.label).slice(0, 40), icon: x.icon || '', hint: cleanText(x.hint || '', 90), style: x.style || '', safe: x.style === 'safe' }));
}

function chipsOf(side) { return side ? (side.kind === 'chips' ? (side.v || 0) : side.kind === 'both' ? (side.chips || 0) : 0) : 0; }
function valOf(side) {
  if (!side) return 0;
  if (side.kind === 'chips') return side.v || 0;
  if (side.kind === 'item') return side.v || 0;
  return (side.v || 0) + (side.chips || 0);
}
function transfer(R, from, to, side) {
  const out = [];
  if (!side) return out;
  if (side.kind === 'item' || side.kind === 'both') {
    const arr = R.inv[from] || [];
    const i = arr.findIndex((x) => x.uid === (side.uid || side.item));
    if (i >= 0) {
      const it = arr.splice(i, 1)[0];
      (R.inv[to] = R.inv[to] || []).push(it);
      const g = R.def?.goods?.find?.((x) => x.id === it.gid) || null;
      out.push(g || { name: it.gid });
    }
  }
  return out;
}
function publicOffer(R, o, players) {
  const side = (s) => {
    if (!s) return '';
    if (s.kind === 'chips') return fmt(s.v) + ' chips';
    if (s.kind === 'item') return (GOODS.find((g) => g.id === s.gid)?.n) || 'item';
    return fmt(s.chips) + ' + ' + ((GOODS.find((g) => g.id === s.gid)?.n) || 'item');
  };
  return {
    id: o.id, from: o.from, to: o.to,
    fromName: players.get(o.from)?.name, toName: players.get(o.to)?.name,
    give: side(o.give), want: side(o.want), giveV: valOf(o.give), wantV: valOf(o.want),
    note: o.note, status: o.status, age: o.createdAt,
  };
}
function normalizeBeat(o, R, room) {
  return {
    kind: o.kind || 'story',
    pid: o.pid ?? null,
    focus: o.focus ?? o.pid ?? null,
    text: cleanText(o.text || '', 150),
    tone: o.tone || 'story',
    big: !!o.big,
  };
}
function peekSummary(R, pid, s) {
  const bits = [];
  if (s.commit) bits.push('they have already decided');
  else bits.push('they have not decided yet');
  if (s.push) bits.push('they are pushing something');
  if (s.trick) bits.push('their hands are busy with a trick');
  if (R.accuses[pid]) bits.push('they are pointing at someone');
  const hand = (R.inv[pid] || []);
  if (hand.length) bits.push(hand.filter((h) => h.fake).length + ' of their ' + hand.length + ' goods are not real');
  return bits.join(' · ');
}
function pubView(room, R, pid) {
  const act = room.activePids();
  const pub = { ...(R.pub || {}) };
  pub.holder = R.holder ?? pub.holder;
  pub.currentPot = R.currentPot != null ? Math.round(R.currentPot) : undefined;
  pub.passes = R.passes;
  pub.accuses = Object.fromEntries(act.filter((x) => R.accuses[x]).map((x) => [x, R.accuses[x]]));
  pub.locked = act.filter((x) => R.sec[x]?.locked);
  pub.pushers = act.filter((x) => R.sec[x]?.push);
  pub.flags = Object.fromEntries(act.filter((x) => R.sec[x]?.flagTarget).map((x) => [x, R.sec[x].flagTarget]));
  pub.insured = Object.fromEntries(act.filter((x) => R.sec[x]?.insuredSet).map((x) => [x, R.sec[x].insuredSet]));
  pub.tells = {};
  if (room.settings.tells > 0) {
    for (const x of act) {
      const s = R.sec[x];
      if (!s || x === pid) continue;
      const t = [];
      if (s.trick) t.push(room.settings.tells > 1 ? 'busy hands' : 'fidget');
      if (s.locked) t.push('locked in');
      if (s.push) t.push('leaning forward');
      if ((s.offerCount || 0) > 1) t.push('many deals');
      if (t.length) pub.tells[x] = t;
    }
  }
  if (room.state === PHASE.REVEAL) { /* reveal payload carries the rest */ }
  return pub;
}
function sanitizePayload(p) {
  if (!p || typeof p !== 'object') return {};
  const o = {};
  if (p.target != null) o.target = String(p.target).slice(0, 8);
  if (Array.isArray(p.cases)) o.cases = p.cases.slice(0, 3).map((x) => clamp(+x || 0, 0, 12));
  if (Array.isArray(p.lots)) o.lots = p.lots.slice(0, 3).map((x) => clamp(+x || 0, 0, 8));
  if (p.amount != null) o.amount = clamp(Math.round(+p.amount || 0), 0, 900);
  if (p.choice != null) o.choice = String(p.choice).slice(0, 12);
  return o;
}
function safeQuick(text) {
  const t = cleanText(text, 80);
  const known = CHAT_LINES.some((l) => l.l === t);
  return known ? t : '';
}

/** Roles are dealt fresh every round: same player is never the same thing twice in a row. */
function dealRoles(rng, pids, roundIndex) {
  const map = new Map();
  const n = pids.length;
  const pool = ABLE_ROLES.slice();
  const chosen = [];
  const abilityCount = clamp(Math.floor(n / 2) + 1, 2, 5);
  // avoid repeating a player's previous role
  const prev = lastRoles.get(roundIndex - 1) || [];
  const shuffled = shuffle(rng, pool);
  for (let i = 0; i < abilityCount && i < n; i++) chosen.push(shuffled[i]);
  const out = shuffle(rng, [
    ...chosen,
    ...Array.from({ length: Math.max(0, n - chosen.length) }, () => 'civilian'),
  ]);
  const order = shuffle(rng, pids.slice());
  order.forEach((pid, i) => {
    let r = out[i % out.length];
    if (prev[pid] && prev[pid] === r && out.length > 1) {
      const alt = out.find((x) => x !== r);
      if (alt) r = alt;
    }
    map.set(pid, r);
    prev[pid] = r;
  });
  lastRoles.set(roundIndex, prev);
  return map;
}
const lastRoles = new Map();
