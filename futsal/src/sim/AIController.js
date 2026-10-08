// AIController: outfield AI for one team.
//
// Every ~0.2s the team re-evaluates roles from the ball state:
//   loose ball  → nearest players chase, others hold shape
//   opponent has ball → presser, cover, markers (goal-side marking with greedy assignment)
//   we have ball → ball carrier decides, a support runner offers an angle, another makes a run in behind
//
// The ball carrier decides shot / pass / dribble using openness, progress, lane safety,
// pressure and the team's risk setting. Passes are weighted with a rolling-distance solver
// so ground passes arrive at the receiver's feet.
import { PITCH, PLAYER, BALL } from '../config.js';
import { BallController } from './BallController.js';
import { clamp, dist2, norm2, createRng } from '../core/math.js';

const TEAM_RNG_SEED = 97;

export class AIController {
  constructor(match, team) {
    this.match = match;
    this.team = team;
    this.roleT = 0;
    this.targets = new Map();   // footballer.id -> { x, z, mode, sprint, speed }
    this.modes = new Map();
    this.rng = createRng(TEAM_RNG_SEED + team.index * 31);
    this.mode = 'loose';
    this.dribbleTarget = null;
  }

  get diff() {
    return this.match.difficultySettings;
  }

  // ---------- team-level role assignment ----------
  assignRoles(dt) {
    const m = this.match, team = this.team, ball = m.ball;
    this.roleT -= dt;
    if (this.roleT > 0) return;
    this.roleT = 0.18 + this.rng.next() * 0.08;

    const owner = ball.owner;
    const opp = m.teams[1 - team.index];
    const outfield = team.players.filter((p) => p.role !== 'GK' && p.isActive && !p.human && !p.isDown);
    const ownGoalX = -team.attackDir * PITCH.halfLength;
    let mode;
    if (owner && owner.teamIndex === team.index) mode = 'attack';
    else if (owner) mode = 'defend';
    else mode = 'loose';
    this.mode = mode;
    this.targets.clear();
    this.modes.clear();
    if (!outfield.length) return;

    const bp = ball.pos;
    const predictedBall = { x: bp.x + ball.vel.x * 0.35, z: bp.z + ball.vel.z * 0.35 };

    if (mode === 'loose') {
      // the intended receiver of a pass goes to meet it; the passer never chases his own pass
      const passer = ball.lastKicker && this.match.time - ball.kickT < 1.5 ? ball.lastKicker : null;
      const intended = ball.intended && ball.intended.teamIndex === team.index && ball.intended.isActive && !ball.intended.human ? ball.intended : null;
      const sorted = outfield.slice().sort((a, b) => {
        const pa = a === intended ? -5 : a === passer ? 5 : 0;
        const pb = b === intended ? -5 : b === passer ? 5 : 0;
        return (dist2(a.pos, bp) + pa) - (dist2(b.pos, bp) + pb);
      });
      sorted.forEach((p, i) => {
        const d = dist2(p.pos, bp);
        const chaser = i === 0 || (i === 1 && d < 9);
        if (chaser && p !== passer) {
          this.setTarget(p, predictedBall.x, predictedBall.z, 'chase', true, 1);
        } else {
          this.setZone(p, mode);
        }
      });
    } else if (mode === 'defend') {
      const oppOwner = owner;
      const sorted = outfield.slice().sort((a, b) => dist2(a.pos, oppOwner.pos) - dist2(b.pos, oppOwner.pos));
      // a teammate-pressure command makes the commanded player the presser
      const commanded = sorted.find((p) => p.pressCommandT > 0);
      if (commanded) { sorted.splice(sorted.indexOf(commanded), 1); sorted.unshift(commanded); }
      const pressers = sorted[0];
      const pressRange = 6.5 * (this.team.tactic.press + 0.3);
      if (pressers && dist2(pressers.pos, oppOwner.pos) < pressRange + 2) {
        const lead = { x: oppOwner.pos.x + oppOwner.vel.x * 0.2, z: oppOwner.pos.z + oppOwner.vel.z * 0.2 };
        this.setTarget(pressers, lead.x, lead.z, 'press', true, 1);
      } else if (pressers) {
        this.setZone(pressers, mode);
      }
      const cover = sorted[1];
      if (cover) {
        const g = norm2({ x: ownGoalX - oppOwner.pos.x, z: -oppOwner.pos.z * 0.3 });
        const cx = oppOwner.pos.x + g.x * 3.4;
        const cz = oppOwner.pos.z + g.z * 3.4 + (oppOwner.pos.z > 0 ? -2.2 : 2.2) * 0.6;
        this.setTarget(cover, cx, cz, 'cover', true, 0.8);
      }
      // markers: goal-side of nearest unmarked opponents
      const markers = sorted.slice(2);
      const opponents = opp.players.filter((p) => p.role !== 'GK' && p.isActive && p !== oppOwner);
      const taken = new Set();
      for (const mk of markers) {
        let best = null, bestD = Infinity;
        for (const o of opponents) {
          if (taken.has(o.id)) continue;
          const d = dist2(o.pos, mk.pos);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) {
          taken.add(best.id);
          const g = norm2({ x: ownGoalX - best.pos.x, z: -best.pos.z * 0.2 });
          const tight = 1.0 + (1 - mk.attrs.defending / 100) * 1.1;
          this.setTarget(mk, best.pos.x + g.x * tight, best.pos.z + g.z * tight, 'mark', false, 0.9);
        } else {
          this.setZone(mk, mode);
        }
      }
    } else {
      // attack: support + run, the carrier is handled by onBall()
      const others = outfield.filter((p) => p !== owner);
      const sorted = others.slice().sort((a, b) => dist2(a.pos, owner.pos) - dist2(b.pos, owner.pos));
      const dirX = team.attackDir;
      const supportSide = this.openSide(owner);
      const sup = sorted[0];
      if (sup) {
        const sx = owner.pos.x + dirX * -2.8 + dirX * 1.0 + 0.0;
        const sz = owner.pos.z + supportSide * 4.2;
        this.setTarget(sup, sx, sz, 'support', false, 0.9);
      }
      const run = sorted[1];
      if (run) {
        const rx = owner.pos.x + dirX * 7.5;
        const rz = clamp(-Math.sign(owner.pos.z || 1) * 3.5, -6, 6);
        this.setTarget(run, rx, rz, 'run', true, 1);
      }
      for (const p of sorted.slice(2)) {
        this.setZone(p, mode);
      }
    }
    // Forced block of a shot path overrides everything for a short time
    for (const p of outfield) {
      if (p.blockT > 0 && p.blockTarget) {
        this.setTarget(p, p.blockTarget.x, p.blockTarget.z, 'block', true, 1);
      }
    }
  }

  // Choose the side (+1 / -1) with more room for a support runner.
  openSide(owner) {
    const m = this.match;
    const opp = m.teams[1 - this.team.index];
    let openPlus = 0, openMinus = 0;
    for (const o of opp.players) {
      if (!o.isActive) continue;
      const dz = o.pos.z - owner.pos.z;
      if (dz > 0) openMinus += 1 / (1 + Math.abs(dz)); else openPlus += 1 / (1 + Math.abs(dz));
    }
    if (owner.pos.z > 6) return -1;
    if (owner.pos.z < -6) return 1;
    return openPlus < openMinus ? 1 : -1;
  }

  setZone(p, mode) {
    const a = this.match.formation.anchorFor(this.team, p, mode);
    this.targets.set(p.id, { x: a.x, z: a.z, mode: 'zone', sprint: false, speed: 0.75 });
    this.modes.set(p.id, 'zone');
  }

  setTarget(p, x, z, mode, sprint, speed) {
    const tx = clamp(x, -PITCH.halfLength + 1, PITCH.halfLength - 1);
    const tz = clamp(z, -PITCH.halfWidth + 0.8, PITCH.halfWidth - 0.8);
    this.targets.set(p.id, { x: tx, z: tz, mode, sprint, speed });
    this.modes.set(p.id, mode);
  }

  // ---------- per-frame update ----------
  update(dt) {
    const m = this.match, team = this.team, ball = m.ball;
    this.assignRoles(dt);
    const outfield = team.players.filter((p) => p.role !== 'GK');

    for (const p of outfield) {
      if (!p.isActive || p.human) {
        p.setDesired(0, 0, false);
        continue;
      }
      if (p.isLocked) continue;

      if (ball.owner === p) {
        p.thinkT -= dt;
        if (p.thinkT <= 0) {
          p.thinkT = (0.2 + (1 - p.attrs.reaction / 100) * 0.25) * this.diff.reactionMul * (0.9 + this.rng.next() * 0.2);
          this.onBall(p);
        }
        this.dribble(p, dt);
        continue;
      }

      const t = this.targets.get(p.id) || this.zoneTarget(p);
      this.steer(p, t, dt);
    }
    // occasional tackles for defenders pressing the ball
    this.considerTackles(dt);
  }

  zoneTarget(p) {
    const a = this.match.formation.anchorFor(this.team, p, this.mode);
    return { x: a.x, z: a.z, mode: 'zone', sprint: false, speed: 0.75 };
  }

  steer(p, t, dt) {
    const dx = t.x - p.pos.x, dz = t.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    let fx = 0, fz = 0;
    if (d > 0.2) {
      const slow = t.mode === 'chase' || t.mode === 'press' ? 1.2 : 2.6;
      const frac = clamp((d - 0.2) / slow, 0, 1);
      fx = (dx / d) * frac * (t.speed ?? 1);
      fz = (dz / d) * frac * (t.speed ?? 1);
    }
    // separation from teammates
    for (const o of this.team.players) {
      if (o === p || !o.isActive) continue;
      const sx = p.pos.x - o.pos.x, sz = p.pos.z - o.pos.z;
      const sd = Math.hypot(sx, sz);
      if (sd < 1.35 && sd > 1e-4) {
        const push = (1.35 - sd) * 1.4;
        fx += (sx / sd) * push;
        fz += (sz / sd) * push;
      }
    }
    const sprint = !!t.sprint && d > 4 && p.stamina > 0.3;
    p.setDesired(fx, fz, sprint);
    p.faceTo = Math.atan2(dz || 1e-6, dx || 1e-6);
  }

  // ---------- on-ball decisions ----------
  onBall(f) {
    const m = this.match;
    const goalX = f.teamIndex === 0 ? PITCH.halfLength : -PITCH.halfLength;
    const dir = this.team.attackDir;
    const dG = Math.hypot(f.pos.x - goalX, f.pos.z);
    const { d: nearD } = this.nearestOpponent(f);
    const pressed = nearD < 2.4;
    const risk = this.team.tactic.risk;
    const inRange = dG < 13.5 && Math.abs(f.pos.z) < 9 && dir * (goalX - f.pos.x) > 0;

    if (inRange) {
      const pShot = clamp((13.5 - dG) / 9.5, 0, 1) * (0.25 + f.attrs.shooting / 170) * (pressed ? 0.55 : 1.0) * (0.55 + risk * 0.6) * this.diff.shotBias;
      if (this.rng.next() < pShot) {
        this.shootAt(f);
        return;
      }
    }

    const best = this.bestPass(f);
    const ageLimit = f.ballTime > 4.0;
    if (best) {
      const threshold = pressed ? -0.35 : (0.45 - risk * 0.35);
      if (best.score > threshold || ageLimit) {
        this.passTo(f, best.receiver, { through: best.through && !pressed && best.progress > 0.5 });
        return;
      }
    }
    // dribbling: sometimes a skill move when pressed and skilful
    if (pressed && f.attrs.dribbling > 68 && this.rng.next() < 0.12 * this.diff.reactionMul) {
      m.performSkill(f);
    }
  }

  nearestOpponent(f) {
    const opp = this.match.teams[1 - this.team.index];
    let best = null, bestD = Infinity;
    for (const o of opp.players) {
      if (!o.isActive || o.role === 'GK' && dist2(o.pos, f.pos) > 6) continue;
      const d = dist2(o.pos, f.pos);
      if (d < bestD) { bestD = d; best = o; }
    }
    return { o: best, d: bestD };
  }

  bestPass(f) {
    const m = this.match;
    const opp = m.teams[1 - this.team.index];
    const dir = this.team.attackDir;
    let best = null;
    for (const t of this.team.players) {
      if (t === f || !t.isActive || t.isDown) continue;
      const d = dist2(f.pos, t.pos);
      if (d < 2.2 || d > 24) continue;
      let openness = Infinity;
      for (const o of opp.players) {
        if (!o.isActive) continue;
        openness = Math.min(openness, dist2(o.pos, t.pos));
      }
      openness = clamp((openness - 0.8) / 4.5, 0, 1);
      let lane = Infinity;
      for (const o of opp.players) {
        if (!o.isActive) continue;
        lane = Math.min(lane, segDist(o.pos, f.pos, t.pos));
      }
      // a teammate standing in the lane would take the ball
      for (const o of this.team.players) {
        if (o === f || o === t || !o.isActive || o.role === 'GK') continue;
        lane = Math.min(lane, segDist(o.pos, f.pos, t.pos) + 0.6);
      }
      // a lane an opponent can reach is not a pass the AI should make (unless forced later)
      if (lane < 1.15) continue;
      // the ball must sit in front of the passer for a clean strike (no flick through the body)
      const bx = m.ball.pos.x - f.pos.x, bz = m.ball.pos.z - f.pos.z;
      const tx = t.pos.x - f.pos.x, tz = t.pos.z - f.pos.z;
      const bl = Math.hypot(bx, bz), tl = Math.hypot(tx, tz) || 1;
      if (bl > 1e-4 && (bx * tx + bz * tz) / (bl * tl) < 0.2) continue;
      const laneFactor = clamp((lane - 1.15) / 2.2, 0, 1);
      const blocked = 0;
      const progress = clamp(dir * (t.pos.x - f.pos.x) / 10, -1, 1);
      const deep = t.role === 'FWD' ? 0.2 : 0;
      let score = 0.9 * openness + 0.55 * progress + 0.45 * laneFactor - 0.8 * blocked + deep;
      if (t.role === 'GK') score -= 1.2;
      score -= Math.max(0, d - 15) * 0.04;
      score += (this.rng.next() - 0.5) * 0.12 * (1 - f.attrs.passing / 100);
      if (!best || score > best.score) {
        best = { receiver: t, score, progress, through: t.role !== 'GK' && progress > 0.2 };
      }
    }
    return best;
  }

  dribble(f, dt) {
    const m = this.match;
    if (m.ball.owner !== f) return;
    const dir = this.team.attackDir;
    const goalX = dir * PITCH.halfLength;
    const { o, d } = this.nearestOpponent(f);
    let tx = goalX, tz = clamp(-f.pos.z * 0.4, -3, 3);
    if (o && d < 3.5) {
      // evade: sidestep away from the nearest defender
      const sx = f.pos.x - o.pos.x, sz = f.pos.z - o.pos.z;
      const sd = Math.hypot(sx, sz) || 1;
      tz = f.pos.z + (sz / sd) * 3.0 + (this.rng.next() - 0.5);
      tx = f.pos.x + dir * 3.5 + (sx / sd) * 1.0;
    }
    const dx = tx - f.pos.x, dz = tz - f.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const sprint = f.stamina > 0.35 && (!o || d > 2.5);
    const frac = clamp(dl / 3, 0.2, 0.92);
    f.setDesired((dx / dl) * frac, (dz / dl) * frac, sprint);
    f.faceTo = Math.atan2(dz, dx);
  }

  considerTackles(dt) {
    const m = this.match, ball = m.ball;
    const o = ball.owner;
    if (!o || o.teamIndex === this.team.index) return;
    for (const p of this.team.players) {
      if (p.tackleCD > 0) p.tackleCD -= dt;
      if (p.role === 'GK' || !p.isActive || p.human || p.isLocked || p.tackleT > 0) continue;
      if (p.kickCD > 0 || p.tackleCD > 0) continue;
      const d = dist2(p.pos, o.pos);
      if (d > 1.25) continue;
      p.tackleCD = 0.9 + this.rng.next() * 0.8;
      const chance = (0.1 + p.attrs.defending / 360) * this.diff.pressMul * (this.team.tactic.press + 0.3);
      if (this.rng.next() < chance) {
        const slide = p.sprinting && this.rng.chance(0.55);
        m.startTackle(p, o, slide ? 'slide' : 'lunge');
      }
    }
  }

  // ---------- actions (shared with restarts and the human controller via the match) ----------
  shootAt(f) {
    const m = this.match;
    const opp = m.teams[1 - this.team.index];
    const gk = opp.players.find((p) => p.role === 'GK');
    const goalX = this.team.attackDir * PITCH.halfLength;
    const gkZ = gk ? gk.pos.z : 0;
    let side = gkZ >= 0 ? -1 : 1;
    if (this.rng.chance(0.2)) side = -side;
    const tz = side * (PITCH.goalHalfWidth - 0.28 - this.rng.next() * 0.45);
    const ty = 0.12 + this.rng.next() * 0.9;
    const target = { x: goalX, y: ty, z: tz };
    const speed = (15 + f.attrs.shooting * 0.13) * (0.95 + this.rng.next() * 0.1);
    const err = (1 - f.attrs.shooting / 100) * 0.35 * this.diff.errorMul;
    target.z += this.rng.gauss() * err;
    target.y += this.rng.gauss() * err * 0.4;
    const v = BallController.ballisticVelocity(m.ball.pos, target, speed);
    m.kickBall(f, v, { x: this.rng.gauss() * 4, y: 0, z: this.rng.gauss() * 4 }, { kind: 'shot', target });
  }

  passTo(f, t, opts = {}) {
    const m = this.match;
    // lead the receiver by roughly the flight time of the pass
    const dd = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
    const leadT = clamp(dd / 9, 0.2, 1.1);
    const lead = { x: t.pos.x + t.vel.x * leadT, y: 0, z: t.pos.z + t.vel.z * leadT };
    let target = lead;
    if (opts.through) {
      target = { x: t.pos.x + this.team.attackDir * 6, y: 0, z: t.pos.z + clamp(-t.pos.z * 0.2, -1, 1) };
      target.x = clamp(target.x, -PITCH.halfLength + 1, PITCH.halfLength - 1);
      target.z = clamp(target.z, -PITCH.halfWidth + 1, PITCH.halfWidth - 1);
    }
    const d = Math.hypot(target.x - f.pos.x, target.z - f.pos.z);
    const speed = BallController.speedForDistance(d) * (opts.through ? 1.08 : 1.0);
    const dirx = (target.x - f.pos.x) / (d || 1), dirz = (target.z - f.pos.z) / (d || 1);
    const err = (1 - f.attrs.passing / 100) * 0.08 * this.diff.errorMul;
    const ang = Math.atan2(dirz, dirx) + this.rng.gauss() * err;
    const v = { x: Math.cos(ang) * speed, y: 0, z: Math.sin(ang) * speed };
    m.kickBall(f, v, { x: 0, y: this.rng.gauss() * 6, z: 0 }, { kind: opts.through ? 'through' : 'pass', target: t });
  }
}

// Shortest distance from point p to segment a→b (XZ plane).
export function segDist(p, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const apx = p.x - a.x, apz = p.z - a.z;
  const ab2 = abx * abx + abz * abz || 1e-9;
  const t = clamp((apx * abx + apz * abz) / ab2, 0, 1);
  const cx = a.x + abx * t, cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.z - cz);
}
