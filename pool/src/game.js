// ─────────────────────────────────────────────────────────────────────────────
//  game.js — the match controller
//
//  Owns one table: the live physics balls, the rules state, the cue stick
//  animation, the aiming guides, the cameras, the shot clock, the AI opponent
//  and the HUD. The physics is stepped in real time (600 Hz sub-steps, with an
//  automatic fast-forward when a shot is rolling out) and every collision event
//  is fed to the spatialised audio as it happens.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Shot, makeStrike, cloneBalls, makeBall, predictShot, castCue, resolveShot,
  PHYS, TABLE, BALL, POCKETS, HL, HW,
} from './physics.js';
import {
  newMatch, applyResult, validateShot, canPlace, placeCue, respawnCue, spotBall,
  legalFirstBalls, onEight, situation, settle, shotClockFoul, snapshot, applySnapshot,
  groupOf, PHASE as RPHASE,
} from './rules.js';
import { planShotAsync, mulberry32, levelName } from './ai.js';
import { $, txt, show, toast, ballTray, clamp, el } from './ui.js';

export const PHASE = {
  AIM: 'aim', STROKE: 'stroke', ROLL: 'roll', AI: 'ai', AI_STROKE: 'aiStroke',
  BIH: 'bih', OVER: 'over', IDLE: 'idle',
  /** online only: our local animation is done and the authority has not answered yet */
  WAIT: 'wait',
};

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export class Match {
  /**
   * @param {object} ctx {scene, audio, profile, onLeave, onResult, onHud}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.audio = ctx.audio;
    this.profile = ctx.profile;
    this.phase = PHASE.IDLE;
    this.aim = { x: 1, z: 0 };
    this.power = 0.5;
    this.spin = { side: 0, vert: 0 };
    this.pull = 0;
    this.simSpeed = 1;
    this.evIdx = 0;
    this.token = 0;
    this.fineAim = false;
    this.autoCam = true;
    this.probe = { t: -1, key: '', cue: null, obj: null };
    this.hudCache = {};
    this.msgTimer = 0;
    this.bound = false;
    this.shotClockLeft = 30;
    this.rollTime = 0;
    this.lastAimChange = 0;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────
  /**
   * @param {object} o {mode:'practice'|'ai'|'local', game:'8ball'|'9ball', level,
   *                    stake, opponent, playerName, seed, breaker}
   */
  start(o = {}) {
    this.opts = { mode: 'ai', game: '8ball', level: 3, stake: 0, seed: (Date.now() & 0xffff) ^ 0x5f3a, ...o };
    this.rulesOn = this.opts.mode !== 'practice';
    /**
     * Online matches are decided by the server: we predict locally (same
     * deterministic physics) and reconcile with whatever it says. Nothing about
     * coins, fouls or the winner is trusted from this machine.
     */
    this.online = this.opts.mode === 'online';
    this.matchId = this.opts.matchId || null;
    this.seat = this.opts.seat || 0;
    this.netResolved = null;
    this.netResult = null;
    this.remoteShot = false;
    this._finished = false;
    this.rng = mulberry32(this.opts.seed >>> 0);
    this.token++;
    const myTok = this.token;

    const p0 = { name: this.opts.playerName || this.profile.me.name, avatar: this.profile.me.avatar };
    const p1 = this.opts.mode === 'local'
      ? { name: this.opts.opponent || 'Player 2', avatar: '🎯' }
      : this.online
        ? { name: this.opts.opponent || 'Searching…', avatar: this.opts.opponentAvatar || '🌐' }
        : { name: this.opts.opponent || `${levelName(this.opts.level)} CPU`, avatar: '🤖', isAI: true, level: this.opts.level };

    this.state = newMatch({
      game: this.opts.game,
      players: [p0, p1],
      breaker: this.opts.breaker || 0,
      stake: this.rulesOn ? this.opts.stake : 0,
      shotClock: this.profile.settings.shotClock ? 30 : 0,
    });
    this.balls = this._ballsFromState(this.state);

    // take the entry stake now; the winner is paid when the match ends
    this.escrow = 0;
    if (this.rulesOn && !this.online && this.opts.stake > 0) {   // online: the server holds the escrow
      if (this.profile.spend(this.opts.stake, `entry: ${this.opts.game} vs ${p1.name}`)) this.escrow = this.opts.stake;
      else { this.opts.stake = 0; this.state.stake = 0; this.state.pot = 0; }
    }

    this.phase = this.state.ballInHand ? PHASE.BIH : PHASE.AIM;
    this.aimAt(this.state.balls[1] ? this.state.balls[1].x : 1, 0, true);
    this.power = this.state.phase === RPHASE.BREAK ? 0.82 : 0.5;
    this.spin = { side: 0, vert: 0 };
    this.shotClockLeft = this.state.shotClock;
    this.shot = null;
    this.evIdx = 0;
    this.rollTime = 0;
    this.stats = { shots: 0, potted: 0, fouls: 0, longest: 0, start: performance.now() };
    this.scene.buildCue(this.profile.cue(this.profile.me.equipped));
    this.scene.guides.setLevel(this.profile.settings.guides);
    this.scene.setShowHall(false);            // a match is lit as its own world
    this.scene.setHeadString(this.state.phase === RPHASE.BREAK);
    this.audio.rollStart();
    this.audio.setAmbience(false);
    this._syncHud(true);
    this._center(this.state.phase === RPHASE.BREAK ? `${this.state.players[this.state.turn].name} to break` : situation(this.state), 1.8);
    show($('matchHud'), true);
    show($('shotCtl'), true);
    show($('ballInHandBar'), this.state.ballInHand);
    show($('specBar'), false);
    this.scene.cam.setMode(this.profile.settings.camera === 'free' ? 'free' : 'aim', true);
    if (!this.bound) this.bind();
    if (this.online) {
      this.phase = PHASE.WAIT;
      show($('shotCtl'), true);
      this._center(this.matchId ? 'WAITING FOR THE TABLE' : 'SEARCHING FOR AN OPPONENT', 999);
    } else if (this._isAITurn()) this._beginAI(myTok);
    return this;
  }

  stop() {
    this.token++;
    this.phase = PHASE.IDLE;
    this.unbind();
    this.audio.rollStop();
    this.audio.setAmbience(true);
    this.scene.setCue({ visible: false });
    this.scene.guides.clear();
    show($('matchHud'), false);
    show($('shotCtl'), false);
    show($('ballInHandBar'), false);
    if (this.escrow > 0 && this.state && this.state.phase !== RPHASE.OVER) {
      // leaving mid-match forfeits the stake, but never silently
      this.escrow = 0;
    }
  }

  _ballsFromState(state) {
    const out = new Array(16).fill(null);
    for (const b of state.balls) {
      const t = makeBall(b.n, b.x, b.z);
      t.state = b.state === 'table' ? 'table' : 'pocketed';
      if (t.state === 'pocketed') t.sink = BALL.R * 2;
      out[b.n] = t;
    }
    return out;
  }

  // ── per-frame ─────────────────────────────────────────────────────────────
  update(dt) {
    if (this.phase === PHASE.IDLE) return;
    this.t = (this.t || 0) + dt;
    if (this.phase === PHASE.STROKE || this.phase === PHASE.AI_STROKE) this._stepStroke(dt);
    else if (this.phase === PHASE.ROLL) this._stepRoll(dt);
    else if (this.phase === PHASE.AI) this._stepAI(dt);
    this._tickClock(dt);
    this._updateStick();
    this._updateGuides();
    this._updateCamera(dt);
    this.scene.syncBalls(this.balls);
    this._syncHud(false, dt);
  }

  _tickClock(dt) {
    if (!this.rulesOn || !this.state.shotClock) return;
    if (this.online) return;                 // the authority ticks the clock
    if (this.phase !== PHASE.AIM && this.phase !== PHASE.BIH) return;
    if (this._isAITurn()) return;
    this.shotClockLeft -= dt;
    if (this.shotClockLeft <= 0) {
      this.shotClockLeft = this.state.shotClock;
      const out = shotClockFoul(this.state);
      this._flash('SHOT CLOCK', out.reason);
      this.audio.click('error');
      this._afterResolution(out, { t: 0, pocketed: [], firstContact: null, railAfterContact: false, cushionHits: 0, cushionBeforeContact: 0, maxSpeed: 0 });
    }
  }

  // ── aiming ────────────────────────────────────────────────────────────────
  get cue() { return this.balls[0]; }

  rotateAim(dr) {
    if (!this._canAim()) return;
    const c = Math.cos(dr), s = Math.sin(dr);
    const x = this.aim.x * c - this.aim.z * s;
    const z = this.aim.x * s + this.aim.z * c;
    const l = Math.hypot(x, z) || 1;
    this.aim.x = x / l; this.aim.z = z / l;
    this.lastAimChange = performance.now();
  }

  /** aim from the cue ball toward a point on the cloth */
  aimAt(x, z, instant = false) {
    if (!this._canAim() && !instant) return;
    const c = this.cue;
    if (!c) return;
    let dx = x - c.x, dz = z - c.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    this.aim.x = dx / l; this.aim.z = dz / l;
    this.lastAimChange = performance.now();
  }

  setPower(p, quiet) {
    if (!this._canAim()) return;
    this.power = clamp(p, 0.02, 1);
    if (!quiet) this.lastAimChange = performance.now();
  }
  nudgePower(d) { this.setPower(this.power + d); }

  setSpin(side, vert) {
    if (!this._canAim()) return;
    let s = clamp(side, -1, 1), v = clamp(vert, -1, 1);
    const m = Math.hypot(s, v);
    if (m > 1) { s /= m; v /= m; }
    this.spin.side = s; this.spin.vert = v;
    this.lastAimChange = performance.now();
  }

  _canAim() {
    return this.phase === PHASE.AIM || this.phase === PHASE.BIH;
  }
  _isAITurn() {
    if (!this.rulesOn) return false;
    if (this.opts.mode !== 'ai') return false;
    return this.state.players[this.state.turn].isAI === true;
  }

  // ── ball in hand ──────────────────────────────────────────────────────────
  requestBallInHand() {
    if (!this.rulesOn) {                                  // practice table: free placement
      this.state.ballInHand = true; this.state.kitchenOnly = false;
      this.phase = PHASE.BIH;
      show($('ballInHandBar'), true);
      this._center('PRACTICE — BALL IN HAND', 1.4);
      return true;
    }
    if (!this.state.ballInHand) { toast('You do not have ball in hand', 'warn'); return false; }
    this.phase = PHASE.BIH;
    show($('ballInHandBar'), true);
    return true;
  }

  /** drag the cue ball around the bed */
  dragCue(x, z) {
    if (this.phase !== PHASE.BIH) return false;
    const c = canPlace(this.state, x, z);
    this._bihOk = c.ok;
    this._bihWhy = c.why;
    if (c.ok) {
      this.balls[0].x = x; this.balls[0].z = z; this.balls[0].state = 'table';
      this.state.balls[0].x = x; this.state.balls[0].z = z; this.state.balls[0].state = 'table';
    }
    return c.ok;
  }

  confirmPlacement() {
    if (this.phase !== PHASE.BIH) return false;
    const c = this.cue;
    const r = canPlace(this.state, c.x, c.z);
    if (!r.ok) { toast(`Not a legal spot — ${r.why}`, 'warn'); this.audio.click('error'); return false; }
    placeCue(this.state, c.x, c.z);
    // online: the placement travels with the strike — the server places the cue
    // ball on its own copy of the table before it replays the shot
    if (this.online) this.lastPlacement = { x: c.x, z: c.z };
    this.state.ballInHand = false;
    show($('ballInHandBar'), false);
    this.phase = PHASE.AIM;
    this.audio.click('confirm');
    this.shotClockLeft = this.state.shotClock;
    return true;
  }

  // ── shooting ──────────────────────────────────────────────────────────────
  shoot() {
    if (this.phase === PHASE.BIH) { if (!this.confirmPlacement()) return; }
    if (this.phase !== PHASE.AIM) return;
    if (this._isAITurn()) return;
    if (this.online && this.state.turn !== 0) { toast('Not your turn', 'warn'); this.audio.click('error'); return; }
    const strike = {
      dirX: this.aim.x, dirZ: this.aim.z, power: this.power,
      tipSide: this.spin.side, tipVert: this.spin.vert,
    };
    if (this.rulesOn) {
      const v = validateShot(this.state, strike);
      if (!v.ok) { toast(v.why, 'warn'); this.audio.click('error'); return; }
    }
    this.pending = strike;
    this.phase = PHASE.STROKE;
    this.strokeT = 0;
    this.struck = false;
    this.maxPull = 0.075 + this.power * 0.30;
    this.strokeDur = 0.30 + this.power * 0.26;
    this.scene.guides.clear();
    this.scene.guides.clearSimPaths();
    this.scene.setCue({ visible: true, x: this.cue.x, z: this.cue.z, dirX: this.aim.x, dirZ: this.aim.z, pull: 0, tipY: this.spin.vert * BALL.R * 0.8, tilt: 0.07 - this.spin.vert * 0.05 });
  }

  _stepStroke(dt) {
    this.strokeT += dt / this.strokeDur;
    const t = this.strokeT;
    if (t < 0.48) this.pull = this.maxPull * easeInOut(t / 0.48);
    else if (t < 0.64) this.pull = this.maxPull;
    else {
      const k = (t - 0.64) / 0.36;
      this.pull = this.maxPull * (1 - easeOut(Math.min(1, k)) * 1.28);
      if (!this.struck && this.pull <= 0.001) this._contact();
    }
    if (t >= 1.0 && !this.struck) this._contact();
    if (t >= 1.22) { this.pull = 0; this.scene.setCue({ visible: false }); }
  }

  _contact() {
    this.struck = true;
    const s = this.pending;
    this.shot = new Shot(this.balls, { eventCap: 4000 });
    const strike = makeStrike(s.dirX, s.dirZ, s.power, s.tipSide, s.tipVert);
    this.shot.applyStrike(strike);
    if (strike.miscue) {
      this._flash('MISCUE', 'the tip slid off the ball');
      this.audio.click('error');
    }
    this.audio.strike(s.power, { x: this.cue.x, y: BALL.R, z: this.cue.z });
    this.scene.cam.kick(0.25 + s.power * 0.9);
    this.evIdx = 0;
    this.rollTime = 0;
    this.phase = PHASE.ROLL;
    this.stats.shots++;
    this.scene.setHeadString(false);
    if (this.rulesOn) this.state.shotClockLeft = this.state.shotClock;
    // online: submit the INPUT, never a result — the server replays this exact
    // strike against its own authoritative table and tells everyone what happened
    if (this.online && !this.remoteShot && this.ctx.net && this.matchId) {
      const strike = { ...s, placement: this.lastPlacement || null };
      this.lastPlacement = null;
      Promise.resolve(this.ctx.net.submitShot(this.matchId, strike)).catch((err) => {
        // the authority disagreed — take its word for it and resynchronise
        toast(`Server refused the shot: ${err && err.message || err}`, 'warn', 3600);
        this.audio.click('error');
        this.resync();
      });
    }
  }

  _stepRoll(dt) {
    this.rollTime += dt;
    // fast-forward a shot that is just rolling out — nobody wants to watch it
    let speed = 1;
    if (this.profile.settings.fastForward) {
      let vmax = 0;
      for (const b of this.balls) if (b && b.state !== 'pocketed') { const v = Math.hypot(b.vx, b.vz); if (v > vmax) vmax = v; }
      if (this.rollTime > 0.9 && vmax < 0.55) speed = 2.4;
      if (this.rollTime > 2.2 && vmax < 0.22) speed = 4.0;
    }
    this.simSpeed = speed;
    const steps = clamp(Math.round(dt * 600 * speed), 1, 140);
    for (let i = 0; i < steps; i++) {
      if (!this.shot.step()) break;
    }
    this._drainEvents();
    // the rolling rumble follows the cue ball
    let vmax = 0;
    for (const b of this.balls) if (b && b.state !== 'pocketed') { const v = Math.hypot(b.vx, b.vz); if (v > vmax) vmax = v; }
    const c = this.cue;
    if (c && c.state === 'table') this.audio.rollUpdate(vmax, { x: c.x, y: BALL.R, z: c.z });
    if (this.shot.done) this._endShot();
  }

  _drainEvents() {
    const evs = this.shot.events;
    while (this.evIdx < evs.length) {
      const e = evs[this.evIdx++];
      const bn = e.n !== undefined ? e.n : e.a;
      const b = bn !== undefined ? this.balls[bn] : null;
      const pos = b ? { x: b.x, y: BALL.R, z: b.z } : { x: 0, y: BALL.R, z: 0 };
      switch (e.type) {
        case 'firstContact': this.audio.clack(e.speed, pos, 1.25); break;
        case 'ballHit': this.audio.clack(e.speed, pos); break;
        case 'cushion': if (!e.rest) this.audio.rail(e.speed, pos); break;
        case 'jaw': this.audio.rail(e.speed * 0.85, pos); break;
        case 'pocket': {
          const p = POCKETS[e.pocket] || pos;
          this.audio.pocket({ x: p.x, y: BALL.R, z: p.z }, e.pocket);
          this._pocketFx(e.n, e.pocket);
          break;
        }
        default: break;
      }
    }
  }

  _pocketFx(n, pocket) {
    if (this.rulesOn && n !== 0) this.stats.potted++;
    const p = POCKETS[pocket];
    if (!p) return;
    if (n === 0) this._flash('SCRATCH', 'cue ball pocketed');
    else if (n === 8) this._center('THE 8-BALL', 1.4);
    else {
      const cue = this.cue;
      const d = cue && cue.state === 'table' ? Math.hypot(cue.x - p.x, cue.z - p.z) : 0;
      if (d > 1.15) { this.audio.crowd(0.35); this._center('LONG POT!', 1.1); }
      this.stats.longest = Math.max(this.stats.longest, d);
    }
  }

  _endShot() {
    const res = this.shot.result();
    this.audio.rollStop();
    this.shot = null;
    this.pull = 0;
    this.scene.setCue({ visible: false });
    const wasRemote = this.remoteShot;
    this.remoteShot = false;
    if (this.online) {
      if (this.netResolved) { this._applyRemote(this.netResolved); return; }
      this.phase = PHASE.WAIT;
      this._center(wasRemote ? '…' : 'WAITING FOR THE SERVER', 999);
      return;
    }
    let out;
    if (this.rulesOn) {
      out = applyResult(this.state, res);
    } else {
      // practice: no rules, but still bring a scratched cue ball back
      out = { foul: false, reason: '', pocketed: res.pocketed, continuesTurn: true, winner: null, events: [] };
      if (this.balls[0].state === 'pocketed') { respawnCue(this.state, undefined); applySnapshot(this.state, snapshot(this.state)); this.balls[0].x = this.state.balls[0].x; this.balls[0].z = this.state.balls[0].z; this.balls[0].state = 'table'; }
      for (const b of res.balls) { const t = this.balls[b.n]; if (t) { t.x = b.x; t.z = b.z; } }
    }
    this._afterResolution(out, res);
  }

  _afterResolution(out, res) {
    const st = this.state;
    // event messages
    for (const e of out.events || []) {
      if (e.type === 'foul') this._flash('FOUL', e.reason + (e.ballInHand ? ' — ball in hand' : ''));
      else if (e.type === 'assign') this._center(`${st.players[e.who].name} takes ${e.group.toUpperCase()}`, 1.7);
      else if (e.type === 'warn') this._center(`${st.players[e.who].name}: one more foul loses the rack`, 2.0);
      else if (e.type === 'respot') this._center('THE 8-BALL IS RE-SPOTTED', 1.5);
      else if (e.type === 'break') this._center(e.keep ? 'GOOD BREAK' : 'BREAK — TABLE OPEN', 1.4);
    }
    if (out.winner !== null && out.winner !== undefined) return this._finish(out);

    // mirror the rules state into the live balls (positions + pocketed)
    for (const b of st.balls) {
      const t = this.balls[b.n];
      if (!t) continue;
      t.x = b.x; t.z = b.z;
      if (b.state === 'pocketed' && t.state !== 'pocketed') { t.state = 'pocketed'; t.sink = BALL.R * 2; }
      else if (b.state === 'table') t.state = 'table';
    }
    // a re-spotted ball must reappear
    if (res && res.balls) for (const s of res.balls) {
      const rule = st.balls[s.n], live = this.balls[s.n];
      if (rule && live && rule.state === 'table' && live.state !== 'table') { live.state = 'table'; live.x = rule.x; live.z = rule.z; live.sink = 0; live.y = 0; }
    }

    this.shotClockLeft = st.shotClock || 30;
    if (this.online && st.turn !== 0 && st.phase !== RPHASE.OVER) {
      // the authority says it is the other player's shot: wait, do not aim
      this.phase = PHASE.WAIT;
      show($('ballInHandBar'), false);
      this._center(`${st.players[1].name} TO PLAY`, 1.6);
    } else if (st.ballInHand) {
      if (this.balls[0].state !== 'table') { respawnCue(st); this.balls[0].x = st.balls[0].x; this.balls[0].z = st.balls[0].z; this.balls[0].state = 'table'; }
      if (this._isAITurn()) this.phase = PHASE.AIM;
      else { this.phase = PHASE.BIH; show($('ballInHandBar'), true); }
    } else {
      this.phase = PHASE.AIM;
    }
    this.scene.setHeadString(st.phase === RPHASE.BREAK || st.kitchenOnly);
    this.audio.rollStart();
    this._syncHud(true);
    this._center(this.phase === PHASE.BIH ? 'BALL IN HAND' : situation(st), 1.2);
    if (this._isAITurn()) this._beginAI(this.token);
  }

  _finish(out) {
    if (this.phase === PHASE.OVER && this._finished) return;   // settled once, never twice
    this._finished = true;
    this.phase = PHASE.OVER;
    const st = this.state;
    const won = st.winner === 0;
    const secs = Math.max(1, Math.round((performance.now() - this.stats.start) / 1000));
    let coins = 0, xp = 0;
    if (this.online) {
      // The server already wrote this match into the account (stats, history,
      // coins, XP) and pushes the authoritative profile back — writing it here
      // as well would double-count, so the client only displays the numbers.
      const d = this.netResult || {};
      coins = d.coins || 0; xp = d.xp || 0;
    } else if (this.rulesOn) {
      const s = settle(st);
      if (won) { coins = s.coins; this.profile.addCoins('free', coins, `won ${this.opts.game} vs ${st.players[1].name}`); }
      xp = Math.round(40 + this.stats.potted * 12 + (won ? 90 : 0) + (this.opts.mode === 'ai' ? this.opts.level * 14 : 0));
      const lv = this.profile.addXp(xp, 'match');
      if (lv.leveledUp) {
        toast(`LEVEL ${lv.level} — ${this.profile.title}`, 'good', 3600);
        this.audio.crowd(1);
      }
      this.profile.recordMatch(won ? 'win' : 'loss', {
        mode: this.opts.game === '9ball' ? '9-ball' : '8-ball',
        opponent: st.players[1].name, coins, xp,
        shots: this.stats.shots, potted: this.stats.potted, fouls: st.players[0].fouls,
        eightWin: won && String(st.winReason || '').includes('8-ball'),
      });
    } else {
      xp = Math.round(this.stats.potted * 6);
      this.profile.addXp(xp, 'practice');
    }
    this.audio.fanfare(won);
    if (won) this.audio.crowd(0.8);
    this.escrow = 0;

    txt('resBig', won ? 'VICTORY' : 'DEFEAT');
    $('resBig').classList.toggle('lose', !won);
    txt('resSub', st.winReason || (this.rulesOn ? '' : 'Practice table — no result recorded'));
    const rows = [
      ['Shots taken', this.stats.shots],
      ['Balls potted', this.stats.potted],
      ['Fouls', st.players[0].fouls],
      ['Match time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
      ['Coins', coins > 0 ? `+${coins} 🪙` : this.opts.stake ? `−${this.opts.stake} 🪙` : '—'],
      ['XP', `+${xp}`],
    ];
    $('resRows').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join('');
    show($('result'), true);
    $('result').classList.add('show');
    show($('shotCtl'), false);
    show($('ballInHandBar'), false);
    this.scene.guides.clear();
    if (this.ctx.onResult) this.ctx.onResult({ won, coins, xp, state: st, stats: this.stats });
  }

  // ── AI opponent ───────────────────────────────────────────────────────────
  async _beginAI(tok) {
    if (tok !== this.token) return;
    this.phase = PHASE.AI;
    this.aiPlan = null;
    this._thinking(true, `${this.state.players[this.state.turn].name} is thinking`);
    const level = this.state.players[this.state.turn].level || 3;
    const t0 = performance.now();
    let plan;
    try {
      plan = await planShotAsync(this.state, this.balls, level, this.rng, 6);
    } catch (e) {
      console.error('AI failed', e);
      plan = { dirX: 1, dirZ: 0, power: 0.5, tipSide: 0, tipVert: 0, thinkMs: 600, plan: { kind: 'error', note: 'fallback' } };
    }
    if (tok !== this.token) return;
    const spent = performance.now() - t0;
    this.aiPlan = plan;
    this.aiWait = Math.max(0.25, (plan.thinkMs - spent) / 1000);
    this.aiAimFrom = { x: this.aim.x, z: this.aim.z };
    this.aiAimT = 0;
    if (plan.placement) {
      placeCue(this.state, plan.placement.x, plan.placement.z);
      this.balls[0].x = plan.placement.x; this.balls[0].z = plan.placement.z; this.balls[0].state = 'table';
      show($('ballInHandBar'), false);
    }
    this._thinking(false);
  }

  _stepAI(dt) {
    const p = this.aiPlan;
    if (!p) return;
    // line up: rotate the stick toward the chosen line while "thinking"
    this.aiAimT = Math.min(1, this.aiAimT + dt / Math.max(0.35, this.aiWait));
    const k = easeInOut(this.aiAimT);
    const ax = this.aiAimFrom.x + (p.dirX - this.aiAimFrom.x) * k;
    const az = this.aiAimFrom.z + (p.dirZ - this.aiAimFrom.z) * k;
    const l = Math.hypot(ax, az) || 1;
    this.aim.x = ax / l; this.aim.z = az / l;
    this.power = this.power + (p.power - this.power) * Math.min(1, dt * 3.4);
    this.spin.side += (p.tipSide - this.spin.side) * Math.min(1, dt * 3.4);
    this.spin.vert += (p.tipVert - this.spin.vert) * Math.min(1, dt * 3.4);
    this.aiWait -= dt;
    if (this.aiWait <= 0 && this.aiAimT >= 1) {
      this.pending = { dirX: p.dirX, dirZ: p.dirZ, power: p.power, tipSide: p.tipSide, tipVert: p.tipVert };
      this.phase = PHASE.AI_STROKE;
      this.strokeT = 0; this.struck = false;
      this.maxPull = 0.075 + this.power * 0.30;
      this.strokeDur = 0.30 + this.power * 0.26;
      this.scene.guides.clear(); this.scene.guides.clearSimPaths();
      this.power = p.power; this.spin.side = p.tipSide; this.spin.vert = p.tipVert;
    }
  }

  _thinking(on, label) {
    let n = document.querySelector('.thinking');
    if (on) {
      if (!n) { n = el('div', 'thinking', ''); document.body.appendChild(n); }
      n.innerHTML = `${label || 'Thinking'}<span>.</span><span>.</span><span>.</span>`;
    } else if (n) n.remove();
  }

  // ── cue stick + guides + camera ───────────────────────────────────────────
  _updateStick() {
    const c = this.cue;
    if (!c || c.state !== 'table') { this.scene.setCue({ visible: false }); return; }
    if (this.phase === PHASE.ROLL || this.phase === PHASE.OVER || this.phase === PHASE.IDLE || this.phase === PHASE.WAIT) {
      if (this.strokeT === undefined || this.strokeT >= 1.22) this.scene.setCue({ visible: false });
      return;
    }
    const pull = this.phase === PHASE.STROKE || this.phase === PHASE.AI_STROKE ? Math.max(-0.03, this.pull) : 0.02 + this.power * 0.045;
    this.scene.setCue({
      visible: true, x: c.x, z: c.z, dirX: this.aim.x, dirZ: this.aim.z, pull,
      tipY: this.spin.vert * BALL.R * 0.8,
      tilt: 0.075 - this.spin.vert * 0.055 + (this.phase === PHASE.BIH ? 0.05 : 0),
    });
  }

  _updateGuides() {
    const g = this.scene.guides;
    const c = this.cue;
    const level = this.profile.settings.guides;
    if (!c || c.state !== 'table' || level <= 0 || this.phase === PHASE.ROLL || this.phase === PHASE.OVER) { g.clear(); return; }
    if (this.phase === PHASE.STROKE || this.phase === PHASE.AI_STROKE) { g.clear(); return; }
    const pred = predictShot(this.balls, c.x, c.z, this.aim.x, this.aim.z, { ignore: 0, maxDist: 7 });
    const d = {
      x0: c.x, z0: c.z, level,
      kind: pred.hit.kind,
      cueEnd: { x: pred.cue.x1, z: pred.cue.z1 },
      hit: { x: pred.hit.hx, z: pred.hit.hz },
    };
    if (pred.object) {
      const o = pred.object;
      d.kind = 'ball';
      d.target = { x: o.x, z: o.z };
      d.objDir = { x: o.nx, z: o.nz };
      d.objLen = clamp((o.pockets[0] ? o.pockets[0].dist : 0.8), 0.12, 2.6);
      const best = o.pockets.find((p) => !p.blocked && p.score > 0.02);
      d.pocket = best ? best.id : -1;
      d.contact = { x: o.x - o.nx * BALL.R, z: o.z - o.nz * BALL.R };
      // cue ball after contact: the stun tangent, bent by the english you set
      const ca = pred.cueAfter;
      const tanL = Math.hypot(ca.dx, ca.dz) || 1;
      const tx = ca.dx / tanL, tz = ca.dz / tanL;
      const bend = clamp(this.spin.vert, -1, 1);
      const len = 0.30 + this.power * 0.42;
      const back = -bend * 0.34 * len;                 // draw pulls it back along the object line
      d.cueAfter = { x: ca.x + tx * len + o.nx * back, z: ca.z + tz * len + o.nz * back };
      // is that ball even legal to hit first?
      if (this.rulesOn) {
        const legal = legalFirstBalls(this.state, this.state.turn);
        d.illegal = !legal.includes(o.n);
      }
    } else if (pred.bounce) {
      d.bounce = { x: pred.bounce.x, z: pred.bounce.z };
      const l = Math.hypot(pred.bounce.dx, pred.bounce.dz) || 1;
      const len = 0.5 + this.power * 1.5;
      d.bounce.x += (pred.bounce.dx / l) * len; d.bounce.z += (pred.bounce.dz / l) * len;
      if (pred.bounce2) d.bounce2 = { x: pred.bounce2.x, z: pred.bounce2.z };
    } else if (pred.hit.kind === 'pocket') {
      d.hit = { x: pred.hit.hx, z: pred.hit.hz };
    }
    g.setLevel(level);
    g.setData(d);
    if (d.illegal) { g.aimLine.material.color.set('#ff6b74'); g.aimLine.material.opacity = 0.9; }
    else { g.aimLine.material.color.set('#ffffff'); g.aimLine.material.opacity = 0.72; }

    // level 3 draws the REAL simulated path (debounced: it costs a probe run)
    if (level >= 3 && this.phase === PHASE.AIM) this._updateProbe(d);
    else g.clearSimPaths();
  }

  _updateProbe(d) {
    const key = `${this.aim.x.toFixed(4)},${this.aim.z.toFixed(4)},${this.power.toFixed(3)},${this.spin.side.toFixed(2)},${this.spin.vert.toFixed(2)},${this.cue.x.toFixed(3)},${this.cue.z.toFixed(3)}`;
    const now = performance.now();
    if (key === this.probe.key) return;
    if (now - this.lastAimChange < 110) { this.scene.guides.clearSimPaths(); return; }   // still moving
    if (now - this.probe.t < 90) return;
    this.probe.t = now; this.probe.key = key;
    const copy = cloneBalls(this.balls);
    const shot = new Shot(copy, { keepEvents: false, maxTime: 4.5 });
    shot.applyStrike(makeStrike(this.aim.x, this.aim.z, this.power, this.spin.side, this.spin.vert));
    const cuePath = [], objPath = [];
    const target = d.target ? d.kind === 'ball' ? null : null : null;
    let objN = -1;
    let steps = 0;
    while (!shot.done && steps < 2600) {
      shot.step();
      steps++;
      if (steps % 12 === 0) {
        const c = copy[0];
        if (c.state === 'table') cuePath.push([c.x, c.z]);
        if (objN < 0 && shot.firstContact) {
          objN = shot.firstContact.n;
        }
        if (objN >= 0) { const o = copy[objN]; if (o && o.state === 'table') objPath.push([o.x, o.z]); }
        if (cuePath.length > 240) break;
      }
    }
    if (cuePath.length > 1) { cuePath.unshift([this.cue.x, this.cue.z]); }
    this.scene.guides.setSimPaths(cuePath, objPath.length > 1 ? objPath : null);
  }

  _updateCamera(dt) {
    const cam = this.scene.cam;
    const c = this.cue;
    if (!c) return;
    const user = this.profile.settings.camera;
    if (this.phase === PHASE.ROLL) {
      if (user === 'aim' && this.autoCam) cam.setGoal(cam.actionTarget(this.balls));
      else if (user === 'free') cam.setGoal(cam.freeTarget());
      else if (user === 'top') cam.setGoal(cam.topTarget());
      else cam.setGoal(cam.actionTarget(this.balls));
      return;
    }
    if (user === 'top') { cam.setGoal(cam.topTarget()); return; }
    if (user === 'close') { cam.setGoal(cam.closeTarget(c, this.aim.x, this.aim.z)); return; }
    if (user === 'free') { cam.setGoal(cam.freeTarget()); return; }
    cam.setGoal(cam.aimTarget(c, this.aim.x, this.aim.z, this.pull));
  }

  setCamera(mode) {
    this.profile.set('camera', mode);
    this.scene.cam.orbit.yaw = Math.atan2(this.aim.x, this.aim.z) + Math.PI;
    toast(`Camera: ${mode.toUpperCase()}`);
  }
  cycleCamera() {
    const order = ['aim', 'top', 'close', 'free'];
    const i = order.indexOf(this.profile.settings.camera);
    this.setCamera(order[(i + 1) % order.length]);
  }

  cycleGuides() {
    const g = (this.profile.settings.guides + 1) % 4;
    this.profile.set('guides', g);
    this.scene.guides.setLevel(g);
    const names = ['OFF', 'BASIC', 'STANDARD', 'PRO ASSIST'];
    toast(`Guides: ${names[g]}`);
    $('btnGuide').classList.toggle('on', g > 0);
  }

  rerack() {
    if (this.phase !== PHASE.AIM && this.phase !== PHASE.BIH) return;
    const fresh = newMatch({ game: this.opts.game, players: this.state.players, breaker: this.state.turn, stake: 0, shotClock: this.state.shotClock });
    this.state = fresh;
    this.balls = this._ballsFromState(fresh);
    this.phase = PHASE.AIM;
    this.scene.setHeadString(true);
    this._syncHud(true);
    this._center('RACKED', 1.2);
    toast('Fresh rack');
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  _center(text, secs = 1.6) {
    const n = $('centerMsg');
    if (!n) return;
    n.textContent = text;
    show(n, true);
    this.msgTimer = secs;
  }
  _flash(title, sub) {
    const n = $('foulFlash');
    if (!n) return;
    n.innerHTML = `<b>${title}</b><i>${sub || ''}</i>`;
    show(n, true);
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => show(n, false), 2200);
  }

  _syncHud(force, dt = 0.016) {
    const st = this.state;
    if (!st) return;
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) show($('centerMsg'), false); }
    const h = this.hudCache;
    const set = (id, v) => { if (h[id] !== v) { h[id] = v; txt(id, v); } };

    const me = st.players[0], op = st.players[1];
    set('s1name', me.name); set('s2name', op.name);
    set('s1ava', me.avatar); set('s2ava', op.avatar);
    set('s1score', String(me.score)); set('s2score', String(op.score));
    set('s1group', me.group ? (me.group === 'solids' ? 'SOLIDS 1–7' : 'STRIPES 9–15') : (st.open ? 'OPEN TABLE' : '—'));
    set('s2group', op.group ? (op.group === 'solids' ? 'SOLIDS 1–7' : 'STRIPES 9–15') : (st.open ? 'OPEN TABLE' : '—'));
    const t1 = ballTray(me.group, me.pocketed), t2 = ballTray(op.group, op.pocketed);
    if (h.t1 !== t1) { h.t1 = t1; $('s1balls').innerHTML = t1; }
    if (h.t2 !== t2) { h.t2 = t2; $('s2balls').innerHTML = t2; }
    $('side1').classList.toggle('active', st.turn === 0 && st.phase !== RPHASE.OVER);
    $('side2').classList.toggle('active', st.turn === 1 && st.phase !== RPHASE.OVER);
    set('matchInfo', `${st.game === '9ball' ? '9-BALL' : '8-BALL'} · ${this.opts.mode === 'practice' ? 'PRACTICE' : this.opts.mode === 'local' ? 'LOCAL 2P' : this.online ? 'ONLINE 1V1' : `VS ${levelName(this.opts.level).toUpperCase()}`}`);
    set('stakeAmt', `${this.opts.stake || 0} 🪙`);
    set('potAmt', `${(this.opts.stake || 0) * 2} 🪙`);
    show($('stakeBar'), (this.opts.stake || 0) > 0);

    const clock = this.rulesOn && st.shotClock ? Math.max(0, Math.ceil(this.shotClockLeft)) : 0;
    set('shotClock', st.shotClock ? String(clock) : '∞');
    const cl = $('shotClock');
    if (cl) cl.classList.toggle('low', st.shotClock > 0 && clock <= 5 && (this.phase === PHASE.AIM || this.phase === PHASE.BIH));

    // power + spin widgets
    const pf = $('pwrFill');
    if (pf) pf.style.height = `${(this.power * 100).toFixed(1)}%`;
    set('pwrVal', `${Math.round(this.power * 100)}%`);
    const pg = $('pwrGrab');
    if (pg) pg.style.bottom = `calc(${(this.power * 100).toFixed(1)}% - 9px)`;
    const sd = $('spinDot');
    if (sd) sd.style.transform = `translate(${(this.spin.side * 26).toFixed(1)}px, ${(-this.spin.vert * 26).toFixed(1)}px)`;

    const canShoot = this.phase === PHASE.AIM || this.phase === PHASE.BIH;
    const bs = $('btnShoot');
    if (bs) {
      bs.disabled = !canShoot || this._isAITurn();
      bs.textContent = this.phase === PHASE.WAIT ? (this.online ? 'SYNC…' : 'WAIT…')
        : this._isAITurn() ? 'CPU…' : st.phase === RPHASE.BREAK ? 'BREAK' : 'SHOOT';
    }
    const bh = $('btnHand');
    if (bh) bh.classList.toggle('on', this.phase === PHASE.BIH);
    show($('ballInHandBar'), this.phase === PHASE.BIH);
  }

  // ── online: server authority ──────────────────────────────────────────────
  /** local player index for a server seat index (the HUD always shows YOU first) */
  _local(i) { return ((i | 0) - (this.seat | 0) + 2) % 2; }

  /** the server paired us: adopt its match wholesale */
  adoptOnline(d) {
    this.online = true;
    this.matchId = d.matchId;
    this.seat = d.you | 0;
    this.netResolved = null;
    this.netResult = null;
    this.opts.opponent = d.opponent || this.opts.opponent;
    this.state.players[this._local(1 - this.seat)].name = d.opponent || 'Opponent';
    this.state.players[this._local(1 - this.seat)].avatar = (d.opponentAvatar || '🌐');
    this.state.players[this._local(1 - this.seat)].isAI = false;
    this._mirrorState(d.state);
    this.balls = this._ballsFromState(this.state);
    this.scene.syncBalls(this.balls);
    this._afterResolution({ foul: false, reason: '', pocketed: [], continuesTurn: true, winner: null, events: [] }, null);
    this._center(`${this.state.players[0].name} vs ${this.state.players[1].name}`, 2.0);
    this.audio.click('confirm');
    return this;
  }

  /** copy the authoritative public state into our local rules state */
  _mirrorState(ps) {
    if (!ps) return;
    const st = this.state;
    st.game = ps.game; st.phase = ps.phase; st.turn = this._local(ps.turn);
    st.open = ps.open; st.ballInHand = ps.ballInHand; st.kitchenOnly = ps.kitchenOnly;
    st.stake = ps.stake; st.pot = ps.pot;
    st.winner = ps.winner === null || ps.winner === undefined ? null : this._local(ps.winner);
    st.winReason = ps.winReason || ''; st.loseReason = ps.loseReason || '';
    st.shotNumber = ps.shotNumber || st.shotNumber;
    st.shotClock = ps.shotClock || st.shotClock;
    for (let i = 0; i < 2; i++) {
      const src = ps.players[i], dst = st.players[this._local(i)];
      if (!src || !dst) continue;
      dst.name = src.name; dst.avatar = src.avatar; dst.group = src.group === null ? null : src.group;
      dst.pocketed = [...(src.pocketed || [])]; dst.fouls = src.fouls || 0;
      dst.score = src.score || 0; dst.streak = src.streak || 0;
    }
    if (ps.balls) applySnapshot(st, ps.balls);
    this.shotClockLeft = ps.shotClockLeft || st.shotClock || 30;
  }

  /** a resolution from the authority: buffer it while we are still animating */
  onResolved(d) {
    if (!this.online) return;
    if (this.phase === PHASE.STROKE || this.phase === PHASE.ROLL || this.phase === PHASE.AI_STROKE) {
      this.netResolved = d; return;
    }
    const mine = (d.by | 0) === (this.seat | 0);
    if (!mine && d.strike && this.phase !== PHASE.OVER) {
      // play the opponent's shot: same deterministic physics, so the animation
      // we show is the shot they actually made
      this.netResolved = d;
      this.playRemoteShot(d.strike);
      return;
    }
    this._applyRemote(d);
  }

  _applyRemote(d) {
    this.netResolved = null;
    if (!d || !d.state) return;
    if (d.state.phase === RPHASE.OVER) { this._mirrorState(d.state); return; }   // match.over drives the result
    this._mirrorState(d.state);
    const out = { ...(d.out || {}) };
    if (out.winner !== null && out.winner !== undefined) out.winner = this._local(out.winner);
    if (Array.isArray(out.events)) {
      out.events = out.events.map((e) => (e && e.who !== undefined ? { ...e, who: this._local(e.who) } : e));
    }
    this._afterResolution(out, null);
  }

  /** animate a shot the other player made */
  playRemoteShot(strike) {
    if (!strike) return;
    const dirX = +strike.dirX || 0, dirZ = +strike.dirZ || 0;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.remoteShot = true;
    this.pending = { dirX: dirX / l, dirZ: dirZ / l, power: clamp(+strike.power || 0.5, 0.02, 1), tipSide: clamp(+strike.tipSide || 0, -1, 1), tipVert: clamp(+strike.tipVert || 0, -1, 1) };
    this.aim = { x: this.pending.dirX, z: this.pending.dirZ };
    this.power = this.pending.power;
    this.spin = { side: this.pending.tipSide, vert: this.pending.tipVert };
    if (strike.placement) {
      const p = strike.placement;
      this.state.balls[0].x = p.x; this.state.balls[0].z = p.z; this.state.balls[0].state = 'table';
      this.balls[0].x = p.x; this.balls[0].z = p.z; this.balls[0].state = 'table'; this.balls[0].sink = 0; this.balls[0].y = 0;
    }
    this.phase = PHASE.STROKE;
    this.strokeT = 0; this.struck = false;
    this.maxPull = 0.075 + this.power * 0.30;
    this.strokeDur = 0.30 + this.power * 0.26;
    this.scene.guides.clear(); this.scene.guides.clearSimPaths();
    this._center(`${this.state.players[1].name} shoots`, 1.0);
  }

  /** the server's clock tick */
  onClock(d) { if (this.online) this.shotClockLeft = Math.max(0, +d.left || 0); }

  /** ask the authority for the table as it really is */
  resync() {
    if (!this.online || !this.ctx.net || !this.matchId) return;
    Promise.resolve(this.ctx.net.request('match.state', { matchId: this.matchId }))
      .then((d) => {
        if (!d || !d.state) return;
        this._mirrorState(d.state);
        this.balls = this._ballsFromState(this.state);
        this._afterResolution({ foul: false, reason: '', pocketed: [], continuesTurn: true, winner: null, events: [] }, null);
      })
      .catch(() => {});
  }

  /** the server ended the match and paid out */
  finishOnline(d) {
    this.netResult = d;
    if (d.state) this._mirrorState(d.state);
    if (this.shot) { this.shot = null; this.audio.rollStop(); }
    this.remoteShot = false;
    this._finish({});
    txt('resSub', d.reason || this.state.winReason || '');
    if (this.ctx.net && this.ctx.net.online) this._center('SERVER SETTLED', 1.6);
  }

  /** our own placement, remembered so the strike carries it to the server */
  confirmPlacementOnline(x, z) { this.lastPlacement = { x, z }; }

  // ── input binding ─────────────────────────────────────────────────────────
  bind() {
    if (this.bound) return;
    this.bound = true;
    const cv = this.scene.canvas;
    const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    this._handlers = [];
    const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); this._handlers.push([target, ev, fn, opts]); };

    let dragging = false, lastX = 0, lastY = 0, moved = 0, pullMode = false;
    on(cv, 'pointerdown', (e) => {
      if (this.phase === PHASE.OVER || this.phase === PHASE.IDLE) return;
      dragging = true; moved = 0; pullMode = false;
      lastX = e.clientX; lastY = e.clientY;
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      if (this.phase === PHASE.BIH) {
        const p = this.scene.pickCloth(e.clientX, e.clientY);
        if (p) this.dragCue(p.x, p.z);
      }
    });
    on(cv, 'pointermove', (e) => {
      if (this.phase === PHASE.OVER || this.phase === PHASE.IDLE) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (this.phase === PHASE.BIH) {
        const p = this.scene.pickCloth(e.clientX, e.clientY);
        if (p && dragging) this.dragCue(p.x, p.z);
        return;
      }
      if (!this._canAim()) return;
      if (!dragging && fine) {
        // desktop: the stick follows the mouse across the table
        const p = this.scene.pickCloth(e.clientX, e.clientY);
        if (p) this.aimAt(p.x, p.z);
        return;
      }
      if (!dragging) return;
      moved += Math.abs(dx) + Math.abs(dy);
      if (!pullMode && Math.abs(dy) > Math.abs(dx) * 1.6 && Math.abs(dy) > 6 && !fine) pullMode = true;
      if (pullMode) {
        // pull back to load power, release to shoot — the mobile gesture
        this.setPower(clamp(this.power + dy * 0.0055, 0.02, 1));
      } else {
        const sens = 0.0022 * (this.profile.settings.sensitivity || 1) * (this.fineAim ? 0.28 : 1) * (this.profile.settings.leftHanded ? -1 : 1);
        this.rotateAim(-dx * sens);
      }
    });
    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      if (pullMode && this.power > 0.06 && moved > 22) this.shoot();
      pullMode = false;
      if (!fine && moved < 8 && this.phase === PHASE.AIM) this.shoot();
    };
    on(cv, 'pointerup', up);
    on(cv, 'pointercancel', up);
    on(cv, 'pointerleave', () => { dragging = false; pullMode = false; });
    on(cv, 'wheel', (e) => {
      if (!this._canAim()) return;
      e.preventDefault();
      this.nudgePower(clamp(-e.deltaY * 0.0009, -0.12, 0.12));
    }, { passive: false });
    on(cv, 'contextmenu', (e) => e.preventDefault());

    // power track
    const pt = $('pwrTrack');
    const setFromTrack = (clientY) => {
      const r = pt.getBoundingClientRect();
      this.setPower(clamp(1 - (clientY - r.top) / r.height, 0.02, 1));
    };
    let trackDrag = false;
    on(pt, 'pointerdown', (e) => { trackDrag = true; setFromTrack(e.clientY); pt.setPointerCapture && pt.setPointerCapture(e.pointerId); });
    on(pt, 'pointermove', (e) => { if (trackDrag) setFromTrack(e.clientY); });
    on(pt, 'pointerup', () => { trackDrag = false; });
    on(pt, 'pointercancel', () => { trackDrag = false; });

    // spin pad
    const sp = $('spinPad');
    const setFromPad = (cx, cy) => {
      const r = sp.getBoundingClientRect();
      const x = ((cx - r.left) / r.width) * 2 - 1;
      const y = -(((cy - r.top) / r.height) * 2 - 1);
      const l = Math.hypot(x, y);
      const k = l > 1 ? 1 / l : 1;
      this.setSpin(x * k, y * k);
    };
    let padDrag = false;
    on(sp, 'pointerdown', (e) => { padDrag = true; setFromPad(e.clientX, e.clientY); sp.setPointerCapture && sp.setPointerCapture(e.pointerId); });
    on(sp, 'pointermove', (e) => { if (padDrag) setFromPad(e.clientX, e.clientY); });
    on(sp, 'pointerup', () => { padDrag = false; });
    on(sp, 'dblclick', () => this.setSpin(0, 0));

    // buttons
    on($('btnShoot'), 'click', () => { this.audio.click('confirm'); this.shoot(); });
    on($('btnCam'), 'click', () => { this.audio.click(); this.cycleCamera(); });
    on($('btnGuide'), 'click', () => { this.audio.click(); this.cycleGuides(); });
    on($('btnHand'), 'click', () => { this.audio.click(); this.requestBallInHand(); });
    on($('bihDone'), 'click', () => this.confirmPlacement());
    on($('btnLeave'), 'click', () => this.leave());
    on($('btnSpecCam'), 'click', () => { this.cycleCamera(); });

    // keyboard
    const keys = {};
    on(window, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      keys[e.code] = true;
      const fine = e.shiftKey ? 0.0012 : 0.0042;
      switch (e.code) {
        case 'ArrowLeft': this.rotateAim(-fine); e.preventDefault(); break;
        case 'ArrowRight': this.rotateAim(fine); e.preventDefault(); break;
        case 'ArrowUp': this.nudgePower(e.shiftKey ? 0.01 : 0.03); e.preventDefault(); break;
        case 'ArrowDown': this.nudgePower(e.shiftKey ? -0.01 : -0.03); e.preventDefault(); break;
        case 'Space': if (!e.repeat) { this.audio.click('confirm'); this.shoot(); } e.preventDefault(); break;
        case 'KeyC': this.cycleCamera(); break;
        case 'KeyG': this.cycleGuides(); break;
        case 'KeyH': this.requestBallInHand(); break;
        case 'KeyR': if (this.opts.mode === 'practice') this.rerack(); break;
        case 'Escape': this.leave(); break;
        default: break;
      }
    });
    on(window, 'keyup', (e) => { keys[e.code] = false; });
    this._keys = keys;
  }

  unbind() {
    for (const [t, ev, fn, o] of this._handlers || []) t.removeEventListener(ev, fn, o);
    this._handlers = [];
    this.bound = false;
    this._thinking(false);
  }

  leave() {
    if (this.online && this.matchId && this.phase !== PHASE.OVER && this.ctx.net) {
      this.ctx.net.resign(this.matchId).catch(() => {});
    }
    if (this.phase === PHASE.OVER) { this.ctx.onLeave && this.ctx.onLeave('hall'); return; }
    this._thinking(false);
    this.ctx.onLeave && this.ctx.onLeave('confirm');
  }

  rematch() {
    if (this.online) {                       // online rematches are the server's call
      toast('Online rematch: back to the queue', '');
      this.ctx.onLeave && this.ctx.onLeave('hall');
      return;
    }
    show($('result'), false);
    $('result').classList.remove('show');
    const o = { ...this.opts, breaker: 1 - (this.opts.breaker || 0), seed: (this.opts.seed * 1103515245 + 12345) >>> 0 };
    this.stop();
    this.start(o);
  }
}

export default Match;
