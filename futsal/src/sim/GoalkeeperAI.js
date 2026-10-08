// GoalkeeperAI: one per team. Positions on the line by ball angle, reads shots
// after a reaction delay, dives to the predicted intercept, catches or parries,
// rushes out for loose balls when appropriate, and distributes in-hand.
import { PITCH, BALL, PLAYER } from '../config.js';
import { BallController } from './BallController.js';
import { clamp, dist2, norm2 } from '../core/math.js';
import { segDist } from './AIController.js';

export class GoalkeeperAI {
  constructor(match, team) {
    this.match = match;
    this.team = team;
    this.gk = team.players.find((p) => p.role === 'GK');
    this.holdT = 0;
    this.rushT = 0;           // commanded rush (player pressed R)
    this.shotSeenT = 0;
    this.shotCandidate = null;
    this.diveDone = false;
    this.lastSaveT = -9;
  }

  get diff() {
    return this.match.difficultySettings;
  }

  commandRush(seconds = 2.5) {
    this.rushT = seconds;
  }

  update(dt) {
    const gk = this.gk;
    if (!gk || !gk.isActive) return;
    const m = this.match, ball = m.ball;
    this.rushT = Math.max(0, this.rushT - dt);
    if (gk.diveT > 0 || gk.downT > 0) {
      return; // physics of the dive is driven by Footballer.step
    }
    const goalX = -this.team.attackDir * PITCH.halfLength;
    const sgn = Math.sign(goalX);

    // ----- in possession -----
    if (ball.owner === gk) {
      this.holdT += dt;
      if (this.holdT > 1.0 + (1 - gk.attrs.reaction / 100) * 0.8 || this.holdT > 3.2) {
        this.distribute();
        this.holdT = 0;
      } else {
        gk.setDesired(0, 0, false);
      }
      return;
    }
    this.holdT = 0;

    // ----- shot detection -----
    const incoming = this.incomingShot();
    if (incoming) {
      if (!this.shotCandidate || this.shotCandidate.id !== incoming.id) {
        this.shotCandidate = { id: incoming.id, seenAt: m.time, zAt: incoming.z, yAt: incoming.y };
        this.shotSeenT = 0;
        this.diveDone = false;
      }
      this.shotSeenT += dt;
      const reactDelay = (0.28 - gk.attrs.reaction / 100 * 0.18) * this.diff.reactionMul;
      if (!this.diveDone && this.shotSeenT >= reactDelay && incoming.timeToLine < 0.9) {
        this.diveDone = true;
        this.startDive(incoming);
        return;
      }
      if (!this.diveDone) {
        // shuffle to the predicted spot while reading the shot
        this.moveTo(goalX, clamp(incoming.z, -1.3, 1.3), 1.0, true);
        return;
      }
    } else {
      this.shotCandidate = null;
      this.diveDone = false;
    }

    // ----- loose ball: rush out? -----
    const bp = ball.pos;
    const distToBall = dist2(gk.pos, bp);
    const ownHalfBall = Math.sign(bp.x) === sgn && Math.abs(bp.x) > 9;
    const chaseFar = Math.abs(goalX - bp.x) < 13.5;
    const closeOpp = this.nearestOpponentDist(bp);
    const rushOK = this.rushT > 0 || (ball.owner === null && ownHalfBall && chaseFar && distToBall < 8.5 && closeOpp > 1.5 && ball.speed < 9);
    if (rushOK && ball.owner === null && !ball.dead) {
      const lead = { x: bp.x + ball.vel.x * 0.25, z: bp.z + ball.vel.z * 0.25 };
      // stay within the keeper's zone: between 6.5 m and 19.2 m from the centre line on his side
      const lo = sgn > 0 ? 6.5 : -19.2;
      const hi = sgn > 0 ? 19.2 : -6.5;
      this.moveTo(clamp(lead.x, lo, hi), lead.z, 1.0, true);
      return;
    }

    // ----- positioning on the line -----
    const dGoal = Math.abs(bp.x - goalX);
    const depth = clamp(0.9 + (16 - dGoal) / 16 * 0.9, 0.8, 1.8);
    const z = clamp(bp.z * (0.34 + (1 - clamp(dGoal / 25, 0, 1)) * 0.1), -1.05, 1.05);
    this.moveTo(goalX - sgn * depth, z, 0.65, false);
  }

  nearestOpponentDist(p) {
    const opp = this.match.teams[1 - this.team.index];
    let best = Infinity;
    for (const o of opp.players) {
      if (!o.isActive || o.role === 'GK') continue;
      best = Math.min(best, Math.hypot(o.pos.x - p.x, o.pos.z - p.z));
    }
    return best;
  }

  // Returns the first shot that will reach the goal plane, or null.
  incomingShot() {
    const m = this.match, ball = m.ball;
    const goalX = -this.team.attackDir * PITCH.halfLength;
    const sgn = Math.sign(goalX);
    const approaching = (ball.vel.x - 0) * sgn < -5;
    if (!approaching) return null;
    const dx = goalX - ball.pos.x;
    const t = dx / ball.vel.x;
    if (!(t > 0 && t < 2.2)) return null;
    const z = ball.pos.z + ball.vel.z * t;
    const y = ball.pos.y + ball.vel.y * t - 0.5 * BALL.gravity * t * t;
    const onFrame = Math.abs(z) < PITCH.goalHalfWidth + 0.9 && y < PITCH.goalHeight + 0.7;
    if (!onFrame) return null;
    return { id: Math.round(ball.t * 10), z, y: clamp(y, 0.1, 2.0), timeToLine: t, speed: ball.speed };
  }

  startDive(shot) {
    const gk = this.gk;
    const goalX = -this.team.attackDir * PITCH.halfLength;
    const sgn = Math.sign(goalX);
    const tz = clamp(shot.z, -PITCH.goalHalfWidth - 0.6, PITCH.goalHalfWidth + 0.6);
    const tx = goalX - sgn * 0.5;
    const dist = Math.hypot(tz - gk.pos.z, tx - gk.pos.x);
    const tDive = clamp(dist / 7 + 0.15, 0.25, 0.65);
    let vx = (tx - gk.pos.x) / tDive, vz = (tz - gk.pos.z) / tDive;
    const sp = Math.hypot(vx, vz);
    if (sp > 9) { vx *= 9 / sp; vz *= 9 / sp; }
    gk.diveT = tDive;
    gk.diveVel = { x: vx, z: vz };
    gk.diveDir = clamp(tz / PITCH.goalHalfWidth, -1, 1);
    gk.faceTo = Math.atan2(vz || 1e-6, vx || 1e-6);
    this.match.emit('diveStart', { gk, dir: gk.diveDir });
  }

  // Ball contact with the keeper's body/hands. Called by the match every frame.
  handleContact(ball) {
    const gk = this.gk;
    if (!gk || !gk.isActive) return false;
    const dx = ball.pos.x - gk.pos.x, dz = ball.pos.z - gk.pos.z;
    const d = Math.hypot(dx, dz);
    const reach = PLAYER.radius + BALL.radius + 0.55 + (gk.diveT > 0 ? 0.45 : 0);
    if (d > reach || ball.pos.y > 1.9 || ball.owner) return false;
    const goalX = -this.team.attackDir * PITCH.halfLength;
    const sgn = Math.sign(goalX);
    const towardGoal = Math.sign(ball.vel.x) === -sgn;
    const speed = ball.speed;
    // only real shots are saves; slow balls are simply controlled by the normal capture rules
    if (!towardGoal || speed < 6) {
      if (speed < 3.5 && !ball.owner && this.match.rng.chance(0.5)) {
        ball.capture(gk);
        return true;
      }
      return false;
    }

    this.lastSaveT = this.match.time;
    const power = clamp(speed / 26, 0, 1);
    const catchChance = clamp(0.25 + gk.attrs.goalkeeping / 140 - power * 0.45, 0.05, 0.92);
    if (speed < 17 && this.match.rng.next() < catchChance) {
      ball.capture(gk);
      this.match.stats.save(gk);
      this.match.emit('save', { gk, catch: true });
      return true;
    }
    // parry: push it away from goal, sideways toward the side it came from
    const side = dz >= 0 ? 1 : -1;
    const rng = this.match.rng;
    ball.vel = {
      x: -sgn * (4 + rng.next() * 5),
      y: 2.5 + rng.next() * 2.5,
      z: side * (3 + rng.next() * 4) + ball.vel.z * 0.3,
    };
    ball.pos.x = gk.pos.x - sgn * 0.3;
    ball.lastTouch = { by: gk, teamIndex: gk.teamIndex, t: ball.t };
    ball.lastKicker = gk;
    gk.kickCD = 0.3;
    this.match.stats.save(gk);
    this.match.emit('save', { gk, catch: false });
    return true;
  }

  distribute() {
    const m = this.match, gk = this.gk, ball = m.ball;
    if (ball.owner !== gk) return;
    const mates = this.team.players.filter((p) => p !== gk && p.isActive && !p.isDown);
    let best = null, bestScore = -Infinity;
    const opp = m.teams[1 - this.team.index];
    for (const t of mates) {
      const d = dist2(gk.pos, t.pos);
      if (d < 2.5 || d > 22) continue;
      let open = Infinity, lane = Infinity;
      for (const o of opp.players) {
        if (!o.isActive) continue;
        open = Math.min(open, dist2(o.pos, t.pos));
        lane = Math.min(lane, segDist(o.pos, gk.pos, t.pos));
      }
      // only distribute along lanes no opponent can reach
      if (lane < 1.6) continue;
      const score = Math.min(open, 8) * 0.5 - Math.abs(d - 10) * 0.12 + (t.role === 'DEF' ? 0.6 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) {
      m.ai[this.team.index].passTo(gk, best, {});
    } else {
      const dir = this.team.attackDir;
      const target = { x: dir * 6, y: 0, z: -gk.pos.z * 0.3 };
      const v = BallController.ballisticVelocity(gk.pos, target, 14);
      v.y = 3.5;
      m.kickBall(gk, v, { x: 0, y: 0, z: 0 }, { kind: 'clear' });
    }
  }

  moveTo(x, z, speed, sprint) {
    const gk = this.gk;
    const dx = x - gk.pos.x, dz = z - gk.pos.z;
    const d = Math.hypot(dx, dz);
    const frac = clamp(d / 1.2, 0, 1) * speed;
    if (d > 0.05) {
      gk.setDesired((dx / d) * frac, (dz / d) * frac, sprint && d > 2);
    } else {
      gk.setDesired(0, 0, false);
    }
    gk.faceTo = Math.atan2(dz || 1e-6, dx || 1e-6);
  }
}
