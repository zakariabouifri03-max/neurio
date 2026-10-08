// MatchManager: owns a match and runs the simulation in a fixed update order.
//
//   1. goalkeepers + outfield AI decide and steer
//   2. human controllers apply input
//   3. footballers integrate movement, players are separated and kept on the pitch
//   4. ball physics (sub-stepped) and out-of-play / goal events
//   5. ball contact: keeper hands, body collisions, first-touch captures
//   6. tackles, fouls and advantage, restarts, clock, stoppage time
//
// Modes: 'quick' (full match), 'training' (free practice, no referee), 'shooting' (timed drill),
// 'demo' (AI vs AI, used for the menu backdrop).
import { PITCH, PLAYER, BALL, MATCH, DIFFICULTY } from '../config.js';
import { BallController } from './BallController.js';
import { TeamManager } from './TeamManager.js';
import { FormationManager } from './FormationManager.js';
import { AIController } from './AIController.js';
import { GoalkeeperAI } from './GoalkeeperAI.js';
import { PlayerController } from './PlayerController.js';
import { Referee } from './Referee.js';
import { MatchStats } from './MatchStats.js';
import { createRng, clamp, dist2, norm2 } from '../core/math.js';

export class MatchManager {
  constructor(opts) {
    this.opts = opts;
    this.mode = opts.mode || 'quick';
    this.seed = opts.seed || (Math.random() * 1e9) | 0;
    this.rng = createRng(this.seed);
    this.difficulty = opts.difficulty || 'normal';
    this.difficultySettings = DIFFICULTY[this.difficulty] || DIFFICULTY.normal;
    this.listeners = new Map();
    this.input = null;
    this.paused = false;
    this.finished = false;

    const tm = new TeamManager(this.seed);
    this.teamManager = tm;
    const humanHome = opts.humanHome !== false && this.mode !== 'demo';
    const homeDef = opts.homeDef || TeamManager.findDef('madrid-lions');
    const awayDef = opts.awayDef || TeamManager.findDef('tokyo-falcons');
    this.teams = [
      tm.createTeam(homeDef, 0, { human: humanHome, kitSide: 'home' }),
      tm.createTeam(awayDef, 1, { human: false, kitSide: 'away', clashWith: homeDef.home.shirt }),
    ];
    // practice: keep the opponent goalkeeper, hide outfield opponents unless requested
    this.opponentsActive = !(this.mode === 'training' || this.mode === 'shooting') || opts.opponents === true;
    if (!this.opponentsActive) {
      for (const p of this.teams[1].players) {
        if (p.role !== 'GK') { p.sentOff = true; p.visible = false; }
      }
    }

    // footballers' think timers / animation phases come from the match RNG (deterministic replays)
    for (const f of this.allPlayers) {
      f.thinkT = this.rng.next() * 0.2;
      f.phase = this.rng.next() * 10;
    }
    this.formation = new FormationManager(this);
    this.ball = new BallController();
    this.referee = new Referee(this);
    this.stats = new MatchStats(this);
    this.ai = this.teams.map((t) => new AIController(this, t));
    this.gks = this.teams.map((t) => new GoalkeeperAI(this, t));
    this.controllers = [];
    if (humanHome) this.controllers[0] = new PlayerController(this, 0);
    if (opts.humanAway) this.controllers[1] = new PlayerController(this, 1);
    for (const t of this.teams) t.human = !!this.controllers[t.index];

    // clock
    this.halfMinutes = opts.halfMinutes || MATCH.defaultHalfMinutes;
    this.halfSeconds = this.mode === 'quick' || this.mode === 'demo' ? this.halfMinutes * 60 : Infinity;
    this.time = 0;            // seconds elapsed in the current half (excl. paused time)
    this.clock = 0;           // total elapsed play time
    this.half = 1;
    this.stoppage = 0;
    this.phase = 'restart';   // 'restart' | 'play' | 'celebrate' | 'halftime' | 'fulltime' | 'foulPending'
    this.phaseT = 0;
    this.restart = null;
    this.pendingFoul = null;
    this.drill = { timeLeft: this.mode === 'shooting' ? MATCH.trainingDrillSeconds : Infinity, goals: 0, shots: 0 };
    this.lastPossessionTeam = 0;
    this.scorer = null;
    this.elapsedSinceTactics = 0;
    this.nextKickoffTeam = 0;

    // starting positions: home kicks off the first half; practice starts live at the centre spot
    if (this.practice) {
      this.phase = 'play';
      this.ball.placeDead(0, 0);
      this.ball.setLive();
    } else {
      this.startRestart('kickoff', 0, { x: 0, z: 0 });
    }
  }

  get practice() {
    return this.mode === 'training' || this.mode === 'shooting';
  }

  // ---------- events ----------
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const arr = this.listeners.get(name);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(name, payload) {
    const arr = this.listeners.get(name);
    if (arr) for (const fn of arr) fn(payload);
  }

  // ---------- helpers used by AI / controllers ----------
  get allPlayers() {
    return this.teams[0].players.concat(this.teams[1].players);
  }

  timeRemainingFraction() {
    if (!isFinite(this.halfSeconds)) return 0.5;
    const total = this.halfSeconds * 2 + this.stoppage;
    return clamp(1 - this.clock / total, 0, 1);
  }

  stoppageAdd(sec) {
    if (!isFinite(this.halfSeconds)) return;
    this.stoppage = clamp(this.stoppage + sec, 0, MATCH.maxStoppage);
  }

  clockText() {
    if (!isFinite(this.halfSeconds)) {
      const s = Math.floor(this.time);
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    const base = this.halfSeconds;
    const sec = Math.floor(this.time);
    const minute = Math.floor(Math.min(sec, base) / 60);
    if (sec < base) return `${String(minute).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    const extra = Math.floor(sec - base);
    return `${Math.floor(this.halfMinutes)}+${Math.floor(extra / 60)}:${String(extra % 60).padStart(2, '0')}`;
  }

  // Attack direction of a team side.
  attackDirOf(teamIndex) {
    return this.teams[teamIndex].attackDir;
  }

  commandPress(teamIndex) {
    const t = this.teams[teamIndex];
    const outfield = t.players.filter((p) => p.role !== 'GK' && p.isActive && !p.human);
    if (!outfield.length) return;
    let best = outfield[0], bd = Infinity;
    for (const p of outfield) {
      const d = dist2(p.pos, this.ball.pos);
      if (d < bd) { bd = d; best = p; }
    }
    best.pressCommandT = 3.0;
    this.emit('callout', { text: 'PRESS!', teamIndex });
  }

  gkRush(teamIndex) {
    this.gks[teamIndex].commandRush(2.5);
    this.emit('callout', { text: 'KEEPER RUSH!', teamIndex });
  }

  // Feint / skill move. Returns true when executed.
  performSkill(f) {
    if (f.skillT > 0 || f.isLocked || f.stamina < 0.1) return false;
    f.skillT = 0.45;
    f.skillSide = this.rng.chance(0.5) ? 1 : -1;
    f.stamina = Math.max(0, f.stamina - 0.04);
    let opp = null, bd = 2.2;
    for (const o of this.teams[1 - f.teamIndex].players) {
      if (!o.isActive || o.role === 'GK') continue;
      const d = dist2(o.pos, f.pos);
      if (d < bd) { bd = d; opp = o; }
    }
    if (opp && this.rng.next() < 0.35 + f.attrs.dribbling / 200) {
      opp.stunT = 0.55 * (1 - opp.attrs.reaction / 250);
      this.emit('callout', { text: 'SKILL!', teamIndex: f.teamIndex });
    }
    this.emit('skill', { f });
    return true;
  }

  kickBall(by, velocity, spin, meta = {}) {
    by.intended = meta.kind && (meta.kind === 'pass' || meta.kind === 'through' || meta.kind === 'lob' || meta.kind === 'cross') ? (meta.target || null) : null;
    this.ball.kick(by, velocity, spin);
    this.stats.kick(by, meta);
    by.ballTime = 0;
    if (meta.kind === 'shot') {
      this.onShot(by, meta.target);
    }
    if (this.restart && this.restart.taker === by) {
      this.restart.taken = true;
      this.endRestart();
    }
    this.emit('kick', { by, meta, power: meta.power || 0.6 });
  }

  // Shot path: nearby defenders are sent to block.
  onShot(by, target) {
    const b = this.ball.pos;
    const tx = target.x, tz = target.z;
    const ax = tx - b.x, az = tz - b.z;
    const al = Math.hypot(ax, az) || 1;
    const defenders = this.teams[1 - by.teamIndex].players.filter((p) => p.isActive && p.role !== 'GK');
    const scored = [];
    for (const d of defenders) {
      const t = clamp(((d.pos.x - b.x) * ax + (d.pos.z - b.z) * az) / (al * al), 0, 1);
      const px = b.x + ax * t, pz = b.z + az * t;
      const dd = Math.hypot(d.pos.x - px, d.pos.z - pz);
      if (dd < 3.2) scored.push({ d, px, pz, dd });
    }
    scored.sort((a, c) => a.dd - c.dd);
    for (const s of scored.slice(0, 2)) {
      if (this.rng.chance(0.55 * this.difficultySettings.pressMul)) {
        s.d.blockT = 0.9;
        s.d.blockTarget = { x: s.px, z: s.pz };
      }
    }
  }

  // Tackle start. `victim` may be null (resolved by proximity).
  startTackle(f, victim, kind, dirOverride = null) {
    if (f.tackleT > 0 || f.isLocked) return;
    let dir = dirOverride;
    if (!dir && victim) dir = norm2({ x: victim.pos.x - f.pos.x, y: 0, z: victim.pos.z - f.pos.z });
    if (!dir || (!dir.x && !dir.z)) dir = { x: Math.cos(f.heading), z: Math.sin(f.heading) };
    f.tackleKind = kind;
    f.tackleDir = { x: dir.x, z: dir.z };
    f.tackleDone = false;
    if (kind === 'slide') {
      f.tackleT = PLAYER.slideTime;
      f.slideT = PLAYER.slideTime;
      f.vel.x = dir.x * 8.5; f.vel.z = dir.z * 8.5;
    } else {
      f.tackleT = PLAYER.tackleTime;
      f.vel.x = dir.x * 4.5; f.vel.z = dir.z * 4.5;
    }
    f.faceTo = Math.atan2(dir.z, dir.x);
    this.emit('tackleStart', { f, kind });
  }

  resolveTackles() {
    for (const f of this.allPlayers) {
      if (f.tackleT <= 0 || f.tackleDone || !f.isActive) continue;
      const ball = this.ball;
      const ballD = Math.hypot(ball.pos.x - f.pos.x, ball.pos.z - f.pos.z);
      const opp = this.teams[1 - f.teamIndex];
      let victim = null, vd = Infinity;
      for (const o of opp.players) {
        if (!o.isActive || o.isDown) continue;
        const d = dist2(o.pos, f.pos);
        if (d < vd) { vd = d; victim = o; }
      }
      const ballOwnerOpp = ball.owner && ball.owner.teamIndex !== f.teamIndex ? ball.owner : null;
      const ballContact = ballD < 0.95 && ball.pos.y < 0.7 && (!ball.owner || ballOwnerOpp);
      if (!ballContact && vd > 1.25) continue;
      f.tackleDone = true;

      if (ballContact) {
        // ball-first challenge
        const dribble = ballOwnerOpp ? ballOwnerOpp.attrs.dribbling : 50;
        const p = clamp(0.5 + (f.attrs.defending - dribble) / 220 + (f.slideT > 0 ? 0.05 : 0), 0.2, 0.9);
        const won = this.rng.next() < p;
        this.stats.tackle(f, won);
        if (won && ballOwnerOpp) {
          ballOwnerOpp.ballTime = 0;
          const bv = { x: f.tackleDir.x * 3.6 + f.vel.x * 0.4, y: 0, z: f.tackleDir.z * 3.6 + f.vel.z * 0.4 };
          if (ball.owner) ball.release(bv);
          ball.vel = bv;
          ball.lastTouch = { by: f, teamIndex: f.teamIndex, t: ball.t };
          this.emit('tackleWon', { f, victim: ballOwnerOpp });
          ballOwnerOpp.fall(0.35 + this.rng.next() * 0.2);
          if (f.tackleKind === 'slide') this.emit('slideContact', { f });
        } else if (!won) {
          this.emit('tackleLost', { f });
        }
        // a clean ball challenge can still clip the body
        if (victim && vd < 1.0 && this.rng.chance(0.08)) {
          this.foulCheck(f, victim, false);
        }
      } else if (victim) {
        // body contact before the ball: possible foul
        this.foulCheck(f, victim, true);
      }
    }
  }

  foulCheck(f, victim, bodyFirst) {
    // tackler is behind the victim when he is on the opposite side of the victim's facing
    const rx = f.pos.x - victim.pos.x, rz = f.pos.z - victim.pos.z;
    const fromBehind = Math.cos(victim.heading) * rx + Math.sin(victim.heading) * rz < -0.3 * Math.hypot(rx, rz);
    const decision = this.referee.judgeTackle({
      tackler: f, victim, slide: f.tackleKind === 'slide', ballFirst: false, fromBehind,
    });
    if (decision.foul) {
      this.handleFoul(f, victim, decision);
    }
  }

  handleFoul(by, victim, decision) {
    if (this.pendingFoul || this.phase === 'celebrate' || this.phase === 'halftime' || this.phase === 'fulltime') return;
    const spot = { x: victim.pos.x, z: victim.pos.z };
    const info = this.referee.giveFoul(by, victim, spot, decision.card);
    if (decision.severe) victim.fall(0.6);
    this.pendingFoul = { ...info, t: MATCH.advantageWindow, by, victim, shots0: this.stats.team[victim.teamIndex].shots };
    this.emit('foul', { by, victim, box: info.box, card: decision.card });
    this.emit('whistle', { kind: 'foul' });
    if (decision.severe) this.emit('callout', { text: 'FOUL!', teamIndex: victim.teamIndex });
  }

  // ---------- restarts ----------
  pickTaker(type, teamIndex, spot) {
    const team = this.teams[teamIndex];
    const outfield = team.players.filter((p) => p.role !== 'GK' && p.isActive);
    const gk = team.players.find((p) => p.role === 'GK');
    if (type === 'goalKick') return gk;
    if (type === 'penalty') {
      return outfield.slice().sort((a, b) => b.attrs.shooting - a.attrs.shooting)[0] || gk;
    }
    if (!outfield.length) return gk;
    let best = null, bd = Infinity;
    for (const p of outfield) {
      const d = dist2(p.pos, spot);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  startRestart(type, teamIndex, spot, extra = {}) {
    if (this.finished) return;
    this.pendingFoul = null;
    this.phase = 'restart';
    const taker = this.pickTaker(type, teamIndex, spot);
    this.restart = {
      type, teamIndex, taker, spot: { x: spot.x, z: spot.z }, taken: false,
      t: 0, readyT: 0, ready: false, extra,
      delay: type === 'kickoff' ? 1.2 : MATCH.restartDelay,
    };
    // the ball glides to the restart spot (no teleport); only a ball already there is placed directly
    if (Math.hypot(this.ball.pos.x - spot.x, this.ball.pos.z - spot.z) > 0.3) this.ball.glideTo(spot.x, spot.z);
    else this.ball.placeDead(spot.x, spot.z);
    for (const p of this.allPlayers) p.restartTarget = null;
    this.layoutForRestart(this.restart);
    if (taker && this.controllers[teamIndex]) this.controllers[teamIndex].bind(taker);
    if (type === 'corner') this.stats.team[teamIndex].corners++;
    if (type === 'kickIn') this.stats.team[teamIndex].kickIns++;
    if (type === 'freeKick' || type === 'penalty') this.stats.team[teamIndex].freeKicks++;
    this.emit('restart', { type, teamIndex, spot: this.restart.spot, taker });
    this.emit('whistle', { kind: type === 'kickoff' ? 'kickoff' : 'restart' });
  }

  layoutForRestart(rs) {
    const { spot, taker, type } = rs;
    const center = { x: 0, z: 0 };
    for (const team of this.teams) {
      const attacking = team.index === rs.teamIndex;
      for (const f of team.players) {
        if (!f.isActive) continue;
        if (f === taker) {
          // taker stands just behind the ball (away from the opponent's goal)
          const back = -team.attackDir;
          f.restartTarget = { x: spot.x + back * 0.9, z: spot.z + (type === 'kickoff' ? 0.2 : 0) };
          continue;
        }
        const a = f.role === 'GK'
          ? this.formation.keeperAnchor(team)
          : this.formation.anchorFor(team, f, 'loose');
        let tx = a.x, tz = a.z;
        if (type === 'goalKick' && attacking) {
          // attacking side vacates the box for a goal kick
          tx = clamp(tx, -PITCH.halfLength + PITCH.boxDepth + 1, PITCH.halfLength - PITCH.boxDepth - 1);
        }
        if (!attacking && type !== 'kickoff' && type !== 'goalKick' && type !== 'kickIn') {
          const gap = PITCH.restartGap;
          const dx = tx - spot.x, dz = tz - spot.z;
          const d = Math.hypot(dx, dz) || 1e-6;
          if (d < gap) { tx = spot.x + (dx / d) * gap; tz = spot.z + (dz / d) * gap; }
        }
        if (!attacking && type === 'kickIn') {
          const gap = 2.6;
          const dx = tx - spot.x, dz = tz - spot.z;
          const d = Math.hypot(dx, dz) || 1e-6;
          if (d < gap) { tx = spot.x + (dx / d) * gap; tz = spot.z + (dz / d) * gap; }
        }
        if (type === 'kickoff') {
          if (!attacking) {
            const dx = tx - center.x, dz = tz - center.z;
            const d = Math.hypot(dx, dz) || 1e-6;
            if (d < PITCH.centerCircle + 0.3) {
              tx = center.x + (dx / d) * (PITCH.centerCircle + 0.3);
              tz = center.z + (dz / d) * (PITCH.centerCircle + 0.3);
            }
          } else {
            // kicking side stays in its own half at kick-off
            if (Math.sign(tx) === team.attackDir && Math.abs(tx) > 0.8) tx = -team.attackDir * 1.2;
          }
        }
        f.restartTarget = {
          x: clamp(tx, -PITCH.halfLength + 0.8, PITCH.halfLength - 0.8),
          z: clamp(tz, -PITCH.halfWidth + 0.8, PITCH.halfWidth - 0.8),
        };
      }
    }
  }

  // Taker's executed restart. `opts` comes from a human ({ action, aim, lob }) or is empty for AI.
  executeRestart(f, opts = {}) {
    const rs = this.restart;
    if (!rs || rs.taken || rs.taker !== f) return;
    const ai = this.ai[f.teamIndex];
    const ctrl = this.controllers[f.teamIndex];
    const type = rs.type;
    if (opts.action && ctrl) {
      if (opts.action === 'shoot' && (type === 'penalty' || type === 'freeKick' || this.inShotRange(f))) {
        ctrl.executeShot(f, { c: 0.7, tap: false, lob: !!opts.lob });
      } else if (type === 'corner' && opts.action !== 'shoot') {
        this.crossIntoBox(f);
      } else if (opts.action === 'through') {
        ctrl.executePass(f, { c: 0.6, tap: false, lob: false, through: true });
      } else {
        ctrl.executePass(f, { c: 0.5, tap: false, lob: !!opts.lob, through: false });
      }
      return;
    }
    // AI taker
    if (type === 'penalty') {
      ai.shootAt(f);
    } else if (type === 'corner') {
      this.crossIntoBox(f);
    } else if (type === 'goalKick') {
      this.gks[f.teamIndex].distribute();
    } else if (type === 'freeKick' && this.inShotRange(f) && this.rng.chance(0.5)) {
      ai.shootAt(f);
    } else {
      const best = ai.bestPass(f);
      if (best) ai.passTo(f, best.receiver, {});
      else {
        // no open lane: play it to the nearest free teammate, or shoot if none is around
        const opp = this.teams[1 - f.teamIndex].players.filter((p) => p.isActive);
        const mates = this.teams[f.teamIndex].players.filter((p) => p !== f && p.isActive && p.role !== 'GK');
        mates.sort((a, b) => dist2(a.pos, f.pos) - dist2(b.pos, f.pos));
        const mate = mates.find((t) => opp.every((o) => dist2(o.pos, t.pos) > 2.5));
        if (mate || mates[0]) ai.passTo(f, mate || mates[0], {}); else ai.shootAt(f);
      }
    }
    if (this.restart && this.restart.taker === f) { rs.taken = true; this.endRestart(); }
  }

  inShotRange(f) {
    const goalX = this.teams[f.teamIndex].attackDir * PITCH.halfLength;
    return Math.hypot(goalX - f.pos.x, f.pos.z) < 13;
  }

  crossIntoBox(f) {
    const team = this.teams[f.teamIndex];
    const goalX = team.attackDir * PITCH.halfLength;
    // pick a teammate in the box: the forward with the best heading
    const runners = team.players.filter((p) => p !== f && p.isActive && p.role !== 'GK');
    let target = null;
    let bestScore = -Infinity;
    for (const r of runners) {
      const inBox = Math.abs(goalX - r.pos.x) < PITCH.boxDepth + 2;
      const s = (inBox ? 2 : 0) + this.rng.next() * 0.5 - Math.abs(r.pos.z) * 0.02;
      if (s > bestScore) { bestScore = s; target = r; }
    }
    const tx = goalX - team.attackDir * 3.5 + (target ? (target.pos.x - goalX) * 0.2 : 0);
    const tz = target ? clamp(target.pos.z, -4.5, 4.5) : (this.rng.chance(0.5) ? 3 : -3);
    const v = BallController.ballisticVelocity(this.ball.pos, { x: tx, y: 1.0, z: tz }, 12.5);
    this.kickBall(f, v, { x: 0, y: 0, z: 0 }, { kind: 'cross', target: target ? { x: target.pos.x, y: 0, z: target.pos.z } : null, power: 0.7 });
  }

  endRestart() {
    this.restart = null;
    this.phase = 'play';
    for (const p of this.allPlayers) p.restartTarget = null;
    this.ball.setLive();
  }

  // ---------- goals & out of play ----------
  onGoal(ev) {
    const side = ev.side;
    const scoringIdx = this.teams.findIndex((t) => t.attackDir === side);
    if (scoringIdx < 0) return;
    const concIdx = 1 - scoringIdx;
    const by = ev.by;
    const own = by && by.teamIndex !== scoringIdx;
    const scorer = by && !own ? by : null;
    const assist = scorer ? this.stats.assisterFor(scorer, this.time) : null;
    this.teams[scoringIdx].score += 1;
    this.stats.goal(scorer, assist, scoringIdx, this.clockText());
    if (this.mode === 'shooting' && scorer) this.drill.goals += 1;
    this.stoppageAdd(MATCH.stoppagePerGoal);
    this.phase = 'celebrate';
    this.phaseT = MATCH.goalCelebrate;
    this.scorer = scorer;
    if (scorer) scorer.celebrateT = MATCH.goalCelebrate;
    for (const p of this.teams[scoringIdx].players) {
      if (p.isActive && p !== scorer) p.celebrateT = 1.6;
      if (p.isActive && p.role !== 'GK') p.setDesired(0, 0, false);
    }
    this.emit('goal', { teamIndex: scoringIdx, scorer, assist, own, score: this.teams.map((t) => t.score), minute: this.clockText() });
    this.emit('whistle', { kind: 'goal' });
    this.restart = null;
    if (this.practice) {
      this.pendingReset = { x: 0, z: 0 };
      this.phaseT = 2.0;
    } else {
      this.pendingGoalConceded = concIdx;
    }
  }

  onOutOfPlay(ev) {
    const last = ev.lastTouch;
    const lastTeam = last ? last.teamIndex : null;
    if (this.practice) {
      // practice: put the ball back in play just inside the line it left
      const x = ev.kind === 'endline' ? ev.side * (PITCH.halfLength - 4) : clamp(this.ball.pos.x, -PITCH.halfLength + 3, PITCH.halfLength - 3);
      const z = ev.kind === 'sideline' ? ev.side * (PITCH.halfWidth - 2) : clamp(this.ball.pos.z, -PITCH.halfWidth + 2, PITCH.halfWidth - 2);
      this.phase = 'celebrate';
      this.phaseT = 0.8;
      this.pendingReset = { x, z };
      return;
    }
    if (ev.kind === 'sideline') {
      const teamIndex = lastTeam === null ? 0 : 1 - lastTeam;
      const spot = { x: clamp(this.ball.pos.x, -PITCH.halfLength + 1, PITCH.halfLength - 1), z: ev.side * (PITCH.halfWidth - 0.05) };
      this.startRestart('kickIn', teamIndex, spot);
      this.emit('callout', { text: 'KICK-IN', teamIndex });
    } else {
      // endline: the goal the ball crossed is at x = side * halfLength
      const defendingIdx = this.teams.findIndex((t) => t.attackDir === -ev.side);
      if (lastTeam === defendingIdx) {
        // last touched by the defenders: corner for the attackers
        const attIdx = 1 - defendingIdx;
        const spot = { x: ev.side * (PITCH.halfLength - 0.25), z: Math.sign(ev.pos.z || 1) * (PITCH.halfWidth - 0.45) };
        this.startRestart('corner', attIdx, spot);
        this.emit('callout', { text: 'CORNER', teamIndex: attIdx });
      } else {
        // last touched by the attackers: goal kick
        const spot = { x: ev.side * (PITCH.halfLength - 1.4), z: 0 };
        this.startRestart('goalKick', defendingIdx, spot);
        this.emit('callout', { text: 'GOAL KICK', teamIndex: defendingIdx });
      }
    }
  }

  onPlayerSentOff(f) {
    const ctrl = this.controllers[f.teamIndex];
    if (ctrl && ctrl.current === f) ctrl.ensureControl();
    this.emit('sentOff', { f });
    this.stats.p(f);
  }

  // ---------- main update ----------
  update(dt, input) {
    if (this.finished || this.paused) return;
    this.input = input;
    dt = Math.min(dt, 1 / 30);
    const ball = this.ball;

    // ----- clock / phases -----
    this.phaseT = Math.max(0, this.phaseT - dt);
    if (this.phase === 'play' || this.phase === 'restart' || this.phase === 'foulPending' || this.phase === 'celebrate') {
      this.time += dt;
      this.clock += dt;
    }
    if (this.mode === 'shooting') {
      this.drill.timeLeft = Math.max(0, this.drill.timeLeft - dt);
      if (this.drill.timeLeft <= 0 && !this.finished) {
        this.finished = true;
        this.emit('drillEnd', { goals: this.drill.goals, shots: this.stats.team[0].shots });
        return;
      }
    }

    this.elapsedSinceTactics += dt;
    if (this.elapsedSinceTactics > 0.5) {
      this.elapsedSinceTactics = 0;
      this.formation.updateTactics(this.teams[0]);
      this.formation.updateTactics(this.teams[1]);
    }

    // ----- 1. goalkeepers + AI -----
    for (const i of [0, 1]) {
      this.gks[i].update(dt);
      this.ai[i].update(dt);
    }
    // restart movement for everyone (AI and humans alike) before physics
    if (this.restart) this.updateRestartMovement(dt);

    // ----- 2. humans -----
    for (const c of this.controllers) if (c) c.update(dt, input);

    // ----- 3. footballers integrate, then separation and bounds -----
    for (const f of this.allPlayers) {
      if (!f.isActive && !f.walkOff) continue;
      if (f.walkOff) this.walkOffUpdate(f, dt);
      else f.step(dt);
      if (f.isActive) {
        f.pos.y = 0;
        f.pos.x = clamp(f.pos.x, -PITCH.halfLength + 0.4, PITCH.halfLength - 0.4);
        f.pos.z = clamp(f.pos.z, -PITCH.halfWidth + 0.4, PITCH.halfWidth - 0.4);
      }
    }
    this.separatePlayers();

    // ----- 4. ball physics -----
    ball.update(dt);
    if (ball.owner) {
      ball.owner.ballTime = (ball.owner.ballTime || 0) + dt;
    }

    // ----- 5. contact -----
    if (!ball.dead && !ball.inNet) {
      const gkHit = this.gks.some((g) => g.handleContact(ball));
      if (!gkHit) ball.collidePlayers(this.allPlayers);
      if (!ball.owner) ball.tryCapture(this.allPlayers, this.rng); // emits a 'capture' event
    }

    // ----- 6. tackles, events, restarts -----
    this.resolveTackles();
    this.processBallEvents();

    // possession stats (team with last touch)
    if (this.phase === 'play' || this.phase === 'foulPending') {
      const holder = ball.owner ? ball.owner.teamIndex : (ball.lastTouch ? ball.lastTouch.teamIndex : null);
      if (holder !== null) this.stats.possession(holder, dt);
    }

    this.updatePendingFoul(dt);
    this.updatePhases(dt);
    this.updateCelebrations(dt);

    // half end / full time (the whistle waits for the ball to be dead in play)
    if (this.phase === 'play' && this.isHalfOver()) {
      this.endHalf();
    }
  }

  onCapture(f) {
    f.ballTime = 0;
    this.stats.capture(f);
    this.emit('capture', { f });
  }

  processBallEvents() {
    const evs = this.ball.drainEvents();
    for (const ev of evs) {
      switch (ev.type) {
        case 'kick':
          break;
        case 'capture':
          this.onCapture(ev.by);
          break;
        case 'release':
          break;
        case 'touch':
          this.emit('touch', ev);
          break;
        case 'bounce':
          this.emit('bounce', ev);
          break;
        case 'board':
          this.emit('board', ev);
          break;
        case 'post':
          this.emit('post', ev);
          this.emit('callout', { text: 'POST!', teamIndex: -1 });
          break;
        case 'goal':
          this.onGoal(ev);
          break;
        case 'out':
          if (this.phase !== 'celebrate' || this.mode === 'training' || this.mode === 'shooting') this.onOutOfPlay(ev);
          break;
        default:
          break;
      }
    }
  }

  // Play-on advantage: if the fouled side keeps the ball (or shoots) inside the window, play continues.
  updatePendingFoul(dt) {
    const pf = this.pendingFoul;
    if (!pf) return;
    pf.t -= dt;
    const b = this.ball;
    const victimTeam = pf.victimTeam ?? pf.victim.teamIndex;
    pf.victimTeam = victimTeam;
    if (this.stats.team[victimTeam].shots > pf.shots0) {
      this.pendingFoul = null; // they shot: advantage played
      return;
    }
    if (pf.t > 0) return;
    if (b.owner && b.owner.teamIndex === victimTeam) {
      this.pendingFoul = null; // advantage kept
      return;
    }
    this.pendingFoul = null;
    if (pf.box) {
      const spot = { x: this.teams[victimTeam].attackDir * PITCH.penaltySpot, z: 0 };
      this.startRestart('penalty', victimTeam, spot);
      this.emit('callout', { text: 'PENALTY!', teamIndex: victimTeam });
      return;
    }
    const spot = {
      x: clamp(pf.spot.x, -PITCH.halfLength + 2.2, PITCH.halfLength - 2.2),
      z: clamp(pf.spot.z, -PITCH.halfWidth + 1.4, PITCH.halfWidth - 1.4),
    };
    this.startRestart('freeKick', victimTeam, spot);
    this.emit('callout', { text: 'FREE KICK', teamIndex: victimTeam });
  }

  updatePhases(dt) {
    if (this.phase === 'celebrate') {
      if (this.pendingReset && this.phaseT <= 0) {
        const spot = this.pendingReset;
        this.pendingReset = null;
        this.pendingResetSpot = spot;
        this.resetBallPractice();
        this.pendingResetSpot = null;
      } else if (this.pendingGoalConceded !== undefined && this.phaseT <= 0) {
        const conc = this.pendingGoalConceded;
        this.pendingGoalConceded = undefined;
        if (this.isHalfOver()) this.endHalf();
        else this.startRestart('kickoff', conc, { x: 0, z: 0 });
      }
    }
    if (this.phase === 'restart' && this.restart) {
      const rs = this.restart;
      rs.t += dt;
      const taker = rs.taker;
      const tgt = taker && taker.restartTarget;
      const near = !tgt || Math.hypot(taker.pos.x - tgt.x, taker.pos.z - tgt.z) < 1.1;
      if (near) rs.readyT += dt;
      const isHumanTaker = !!this.controllers[rs.teamIndex] && this.controllers[rs.teamIndex].current === taker;
      const everyoneSet = this.allPlayers.every((p) => !p.isActive || !p.restartTarget || Math.hypot(p.pos.x - p.restartTarget.x, p.pos.z - p.restartTarget.z) < 1.6);
      const settled = rs.t >= rs.delay && rs.readyT >= 0.7 && (everyoneSet || rs.t > 4.5);
      if (!rs.taken && taker) {
        if (!isHumanTaker && settled) {
          this.executeRestart(taker, {});
        } else if (isHumanTaker && rs.t > 9) {
          // the human did not take it in time: play it for them
          this.executeRestart(taker, {});
        }
      }
    }
    if (this.phase === 'halftime') {
      if (this.phaseT <= 0) this.startSecondHalf();
    }
    if (this.phase === 'fulltime') {
      if (this.phaseT <= 0 && !this.finished) {
        this.finished = true;
        this.emit('fullTime', this.summary());
      }
    }
  }

  isHalfOver() {
    return isFinite(this.halfSeconds) && this.time >= this.halfSeconds + this.stoppage;
  }

  updateRestartMovement(dt) {
    const rs = this.restart;
    for (const f of this.allPlayers) {
      if (!f.isActive || !f.restartTarget) continue;
      if (f.isLocked) continue;
      const isTaker = f === rs.taker;
      // a human taker who is steering themselves keeps control until they reach the ball
      if (f.human && isTaker && this.controllers[f.teamIndex] && this.controllers[f.teamIndex].moveMag > 0.2) continue;
      const t = f.restartTarget;
      const dx = t.x - f.pos.x, dz = t.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      const frac = clamp(d / 1.5, 0, 1);
      if (d > 0.1) {
        f.setDesired((dx / d) * frac, (dz / d) * frac, d > 5);
      } else {
        f.setDesired(0, 0, false);
      }
      f.faceTo = Math.atan2(dz || 1e-6, dx || 1e-6);
      if (isTaker) f.faceTo = Math.atan2(this.ball.pos.z - f.pos.z || 1e-6, this.ball.pos.x - f.pos.x || 1e-6);
    }
  }

  walkOffUpdate(f, dt) {
    // sent-off players walk to their bench behind the nearest touch line
    const bench = { x: f.teamIndex === 0 ? -21 : 21, z: -12.5 };
    const dx = bench.x - f.pos.x, dz = bench.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      f.setDesired(0, 0, false);
      f.walkOff = false;
      f.visible = false;
      f.pos.x = bench.x; f.pos.z = bench.z;
      f.vel.x = f.vel.z = 0;
      return;
    }
    f.setDesired(dx / d, dz / d, false);
    f.step(dt);
  }

  updateCelebrations(dt) {
    for (const f of this.allPlayers) {
      if (f.celebrateT > 0 && f.isActive) {
        f.setDesired(0, 0, false);
      }
    }
  }

  // Dead-ball reset for practice modes (no referee).
  resetBallPractice() {
    const spot = this.pendingResetSpot || this.pendingReset || { x: 0, z: 0 };
    this.ball.placeDead(spot.x, spot.z);
    this.ball.setLive();
    this.phase = 'play';
  }

  separatePlayers() {
    const all = this.allPlayers;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.isActive || a.diveT > 0) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.isActive || b.diveT > 0) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER.radius * 2 * 0.92;
        if (d < min && d > 1e-6) {
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  endHalf() {
    this.stoppage = Math.min(this.stoppage, MATCH.maxStoppage);
    if (this.half === 1) {
      this.phase = 'halftime';
      this.phaseT = MATCH.halftimeBreak;
      this.restart = null;
      this.pendingFoul = null;
      this.ball.placeDead(0, 0);
      this.emit('halftime', { score: this.teams.map((t) => t.score) });
      this.emit('whistle', { kind: 'half' });
    } else {
      this.phase = 'fulltime';
      this.phaseT = MATCH.fullTimeResults;
      this.restart = null;
      this.ball.placeDead(0, 0);
      this.emit('whistle', { kind: 'full' });
    }
  }

  startSecondHalf() {
    this.half = 2;
    this.time = 0;
    this.stoppage = 0;
    for (const t of this.teams) t.attackDir *= -1;
    this.startRestart('kickoff', 1, { x: 0, z: 0 });
    this.emit('secondHalf', {});
  }

  // Summary for the results screen.
  summary() {
    const s = this.stats;
    return {
      score: this.teams.map((t) => t.score),
      names: this.teams.map((t) => t.name),
      shortNames: this.teams.map((t) => t.short),
      logos: this.teams.map((t) => t.logo),
      kits: this.teams.map((t) => t.kit),
      possession: [s.possessionPct(0), s.possessionPct(1)],
      shots: this.teams.map((_, i) => s.team[i].shots),
      shotsOn: this.teams.map((_, i) => s.team[i].shotsOn),
      passAcc: [s.passAccuracy(0), s.passAccuracy(1)],
      passes: this.teams.map((_, i) => s.team[i].passes),
      fouls: this.teams.map((_, i) => s.team[i].fouls),
      corners: this.teams.map((_, i) => s.team[i].corners),
      saves: this.teams.map((_, i) => s.team[i].saves),
      cards: this.teams.map((_, i) => ({ yellow: s.team[i].yellow, red: s.team[i].red })),
      goalLog: s.goalLog.slice(),
      players: this.teams.map((t) => t.players.map((p) => ({
        id: p.id, name: p.name, number: p.number, role: p.role, team: t.index,
        goals: s.p(p).goals, assists: s.p(p).assists, shots: s.p(p).shots, passes: s.p(p).passes,
        passesOk: s.p(p).passesOk, tackles: s.p(p).tackles, fouls: s.p(p).fouls, saves: s.p(p).saves,
        rating: s.rating(p), yellow: s.p(p).yellow, red: s.p(p).red, overall: p.overall,
      }))),
      mode: this.mode,
      difficulty: this.difficulty,
      halfMinutes: this.halfMinutes,
      drill: { ...this.drill },
    };
  }
}
