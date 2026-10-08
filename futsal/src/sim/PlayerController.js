// PlayerController: turns human input into footballer actions.
// Movement is camera-relative. Shots and passes are charged while the button is held,
// with aim assist toward goal / teammates. Input is consumed through the InputManager's
// short buffer so a quick tap is never lost to frame timing.
import { PITCH, PLAYER, BALL } from '../config.js';
import { BallController } from './BallController.js';
import { clamp, dist2, norm2 } from '../core/math.js';

const CHARGE_TIME = 0.9;
const TAP_TIME = 0.14;

export class PlayerController {
  constructor(match, teamIndex) {
    this.match = match;
    this.teamIndex = teamIndex;
    this.current = null;
    this.camFwd = { x: 0, z: 1 };   // camera forward on the pitch plane (set by main)
    this.charge = null;             // { kind, t, lobAtStart }
    this.chargeFrac = 0;
    this.chargeKind = null;
    this.moveDir = { x: 0, z: 0 };  // world-space move input (magnitude ≤ 1)
    this.moveMag = 0;
    this.passCandidate = null;      // teammate who would receive a pass right now
    this.tackleCD = 0;
    this.switchCD = 0;
    this.skillCD = 0;
    this.pressCD = 0;
    this.assistOn = true;
    this.input = null;
  }

  get team() {
    return this.match.teams[this.teamIndex];
  }

  bind(f) {
    if (this.current === f) return;
    if (this.current) this.current.human = false;
    this.current = f;
    f.human = true;
    this.charge = null;
    this.chargeFrac = 0;
    this.match.emit('control', { f });
  }

  ensureControl() {
    const cur = this.current;
    if (cur && cur.isActive && cur.teamIndex === this.teamIndex) return cur;
    const pick = this.nearestTo(this.match.ball.pos, null);
    if (pick) this.bind(pick);
    return pick;
  }

  nearestTo(p, exclude) {
    let best = null, bd = Infinity;
    for (const f of this.team.players) {
      if (!f.isActive || f === exclude || f.role === 'GK') continue;
      const d = dist2(f.pos, p);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  cycle(dir) {
    const list = this.team.players.filter((f) => f.isActive && f.role !== 'GK');
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(this.current));
    const next = list[(i + dir + list.length) % list.length];
    this.bind(next);
    this.match.emit('switch', { f: next });
  }

  // Input is the InputManager. Called once per simulation step.
  update(dt, input) {
    const m = this.match;
    this.input = input;
    const f = this.ensureControl();
    if (!f) return;
    const ball = m.ball;
    this.switchCD = Math.max(0, this.switchCD - dt);
    this.tackleCD = Math.max(0, this.tackleCD - dt);
    this.skillCD = Math.max(0, this.skillCD - dt);
    this.pressCD = Math.max(0, this.pressCD - dt);

    // ----- movement (camera-relative) -----
    const mv = input.moveAxis();
    const fwd = this.camFwd;
    const right = { x: -fwd.z, z: fwd.x };
    let wx = right.x * mv.x + fwd.x * mv.y;
    let wz = right.z * mv.x + fwd.z * mv.y;
    const mag = Math.min(1, Math.hypot(wx, wz));
    const ln = Math.hypot(wx, wz) || 1;
    wx /= ln; wz /= ln;
    this.moveDir = { x: wx, z: wz };
    this.moveMag = mag;

    const sprintHeld = input.held('sprint') && f.stamina > 0.04;
    if (f.isLocked || f.tackleT > 0) {
      // locked in an animation; nothing to steer
    } else if (f.skillT > 0) {
      f.setDesired(wx * mag * 1.1, wz * mag * 1.1, sprintHeld);
    } else {
      let dx = wx * mag, dz = wz * mag;
      // gentle assist toward a loose ball nearby (scaled by difficulty)
      if (!ball.owner && !ball.dead) {
        const bdx = ball.pos.x - f.pos.x, bdz = ball.pos.z - f.pos.z;
        const bd = Math.hypot(bdx, bdz);
        if (bd < 4.5 && bd > 0.5 && this.assistOn && m.difficultySettings.assist > 0) {
          const a = m.difficultySettings.assist * clamp((4.5 - bd) / 4.5, 0, 1);
          dx = dx * (1 - a) + (bdx / bd) * a;
          dz = dz * (1 - a) + (bdz / bd) * a;
        }
      }
      f.setDesired(dx, dz, sprintHeld);
    }
    if (mag > 0.2 && !f.isLocked && f.tackleT <= 0) {
      f.faceTo = Math.atan2(wz, wx);
    }

    // ----- switching -----
    if (input.consume('switch') && this.switchCD <= 0) {
      const next = this.nearestTo(ball.pos, f);
      if (next) { this.bind(next); this.match.emit('switch', { f: next }); }
      this.switchCD = 0.2;
    }
    if (input.consume('switchNext') && this.switchCD <= 0) { this.cycle(1); this.switchCD = 0.2; }
    if (input.consume('switchPrev') && this.switchCD <= 0) { this.cycle(-1); this.switchCD = 0.2; }

    // ----- restart: the human is the taker -----
    const rs = m.restart;
    if (rs && rs.taker === f && !rs.taken) {
      if (input.consume('pass')) m.executeRestart(f, { action: 'pass', aim: this.aimDirection(), lob: input.held('lob') });
      else if (input.consume('shoot')) m.executeRestart(f, { action: 'shoot', aim: this.aimDirection(), lob: input.held('lob') });
      else if (input.consume('through')) m.executeRestart(f, { action: 'through', aim: this.aimDirection(), lob: input.held('lob') });
      // drain other buttons so they don't fire later
      input.consume('tackle');
    } else {
      this.handleBallActions(dt, input, f, ball);
    }

    // ----- utility actions -----
    if (input.consume('press') && this.pressCD <= 0) {
      m.commandPress(this.teamIndex);
      this.pressCD = 1.0;
    }
    if (input.consume('gkRush')) m.gkRush(this.teamIndex);
    if (input.consume('skill') && this.skillCD <= 0) {
      if (m.performSkill(f)) this.skillCD = 1.2;
    }
    if (input.consume('tackle') && this.tackleCD <= 0 && !f.isLocked) {
      const dir = mag > 0.3 ? { x: wx, z: wz } : { x: Math.cos(f.heading), z: Math.sin(f.heading) };
      const slide = f.sprinting && f.stamina > 0.2;
      m.startTackle(f, null, slide ? 'slide' : 'lunge', dir);
      this.tackleCD = slide ? 1.0 : 0.6;
    }

    // pass candidate highlight (what a pass would hit right now)
    this.passCandidate = this.findPassReceiver(f, this.aimDirection() || (mag > 0.3 ? this.moveDir : null));
    this.chargeFrac = this.charge ? Math.min(1, this.charge.t / CHARGE_TIME) : 0;
  }

  handleBallActions(dt, input, f, ball) {
    // charges advance while held
    if (this.charge) {
      this.charge.t += dt;
      this.chargeFrac = Math.min(1, this.charge.t / CHARGE_TIME);
    }
    const canTouch = ball.owner === f || (!ball.dead && dist2(ball.pos, f.pos) < PLAYER.radius + BALL.radius + PLAYER.kickReach * 0.7 && ball.pos.y < 0.5);

    if (input.consume('shoot', 'down') && canTouch && !this.charge) {
      this.charge = { kind: 'shoot', t: 0 };
      this.chargeKind = 'shoot';
    }
    if (input.consume('pass', 'down') && canTouch && !this.charge) {
      this.charge = { kind: 'pass', t: 0 };
      this.chargeKind = 'pass';
    }
    if (input.consume('through', 'down') && canTouch && !this.charge) {
      this.executePass(f, { through: true, c: 0.7, lob: false });
    }
    // release
    if (this.charge && input.consume(this.charge.kind, 'up')) {
      const c = Math.min(1, this.charge.t / CHARGE_TIME);
      const kind = this.charge.kind;
      const tap = this.charge.t < TAP_TIME;
      this.charge = null;
      this.chargeKind = null;
      this.chargeFrac = 0;
      const lob = input.held('lob');
      if (kind === 'shoot') {
        if (canTouch) this.executeShot(f, { c, tap, lob });
      } else if (canTouch) {
        this.executePass(f, { c, tap, lob, through: false });
      }
    }
    // a touch can be lost while charging (ball taken away)
    if (this.charge && !canTouch && this.charge.t > 0.3) {
      this.charge = null;
      this.chargeFrac = 0;
    }
  }

  // Camera-relative aim (right stick on pad, or the move direction if moving).
  aimDirection() {
    const a = this.input ? this.input.aimAxis() : null;
    if (a) {
      const fwd = this.camFwd, right = { x: -fwd.z, z: fwd.x };
      const wx = right.x * a.x + fwd.x * a.y;
      const wz = right.z * a.x + fwd.z * a.y;
      const n = norm2({ x: wx, y: 0, z: wz });
      if (n.x || n.z) return n;
    }
    if (this.moveMag > 0.3) return norm2({ x: this.moveDir.x, y: 0, z: this.moveDir.z });
    return null;
  }

  // ---------- actions ----------
  executeShot(f, { c, tap, lob }) {
    const m = this.match, ball = m.ball;
    const goalX = this.team.attackDir * PITCH.halfLength;
    const power = tap ? 0.5 : 0.5 + 0.5 * c;
    const aim = this.aimDirection();
    const gk = m.teams[1 - this.teamIndex].players.find((p) => p.role === 'GK');
    const gkZ = gk ? gk.pos.z : 0;
    let target;

    if (aim) {
      // aim assist: if the aim points roughly at goal, snap onto the goal mouth
      const t = Math.abs(aim.x) > 1e-3 ? (goalX - ball.pos.x) / aim.x : -1;
      if (t > 0 && aim.x * this.team.attackDir > 0) {
        const zAt = ball.pos.z + aim.z * t;
        const mouth = PITCH.goalHalfWidth;
        if (Math.abs(zAt) < mouth + 1.6) {
          target = { x: goalX, y: lob ? 0.9 : 0.35, z: clamp(zAt, -mouth + 0.2, mouth - 0.2) };
        }
      }
      if (!target) {
        const reach = 9 + power * 6;
        target = { x: ball.pos.x + aim.x * reach, y: lob ? 1.0 : 0.25, z: ball.pos.z + aim.z * reach };
      }
    } else {
      const side = gkZ >= 0 ? -1 : 1;
      target = { x: goalX, y: lob ? 0.9 : 0.3, z: side * (PITCH.goalHalfWidth - 0.4) };
    }

    const speed = (14 + 17 * power) * (tap ? 0.9 : 1);
    const err = (1 - f.attrs.shooting / 100) * 0.12 * (0.5 + power * 0.8);
    target.z += (m.rng.next() - 0.5) * err * 6;
    target.y += (m.rng.next() - 0.5) * err * (lob ? 2 : 1);
    let v;
    if (lob) {
      v = BallController.ballisticVelocity(ball.pos, target, speed * 0.62);
    } else {
      v = BallController.ballisticVelocity(ball.pos, target, speed);
      // drives stay low
      v.y = clamp(v.y, -2, 1.2);
    }
    const spin = { x: 0, y: (target.z - ball.pos.z) * 0.0, z: 0 };
    m.kickBall(f, v, spin, { kind: 'shot', target, power, tap });
  }

  executePass(f, { c, tap, lob, through }) {
    const m = this.match, ball = m.ball;
    const aim = this.aimDirection();
    let recv = this.findPassReceiver(f, aim);
    let target;
    if (through) {
      const dirX = this.team.attackDir;
      const basis = recv || f;
      target = {
        x: clamp(basis.pos.x + dirX * 6.5, -PITCH.halfLength + 1, PITCH.halfLength - 1),
        y: 0,
        z: clamp(basis.pos.z + (recv ? recv.vel.z * 0.3 : 0), -PITCH.halfWidth + 1, PITCH.halfWidth - 1),
      };
      if (!recv) target.x = clamp(f.pos.x + dirX * 10, -PITCH.halfLength + 1, PITCH.halfLength - 1);
    } else if (recv) {
      const dd = Math.hypot(recv.pos.x - f.pos.x, recv.pos.z - f.pos.z);
      const leadT = clamp(dd / 9, 0.2, 1.1);
      target = { x: recv.pos.x + recv.vel.x * leadT, y: 0, z: recv.pos.z + recv.vel.z * leadT };
    } else {
      const fwd = aim || { x: Math.cos(f.heading), z: Math.sin(f.heading) };
      const reach = 5 + (tap ? 2 : 8) * (0.5 + c);
      target = { x: f.pos.x + fwd.x * reach, y: 0, z: f.pos.z + fwd.z * reach };
    }
    const d = Math.hypot(target.x - ball.pos.x, target.z - ball.pos.z);
    const power = tap ? 0.4 : 0.6 + 0.4 * c;
    const speed = BallController.speedForDistance(d) * (through ? 1.05 : 1) * (0.9 + power * 0.3);
    const err = (1 - f.attrs.passing / 100) * 0.04;
    let v;
    if (lob) {
      v = BallController.ballisticVelocity(ball.pos, { x: target.x, y: 0.4, z: target.z }, Math.max(6, speed * 0.7));
    } else {
      const ang = Math.atan2(target.z - ball.pos.z, target.x - ball.pos.x) + (m.rng.next() - 0.5) * err * 2;
      v = { x: Math.cos(ang) * speed, y: 0, z: Math.sin(ang) * speed };
    }
    m.kickBall(f, v, { x: 0, y: 0, z: 0 }, { kind: through ? 'through' : (lob ? 'lob' : 'pass'), target: recv || null, power });
  }

  // Best teammate for a pass in the aim direction (or in front of the player if no aim).
  findPassReceiver(f, aim) {
    let best = null, bestScore = -Infinity;
    const dirRef = aim || { x: Math.cos(f.heading), z: Math.sin(f.heading) };
    for (const t of this.team.players) {
      if (t === f || !t.isActive || t.role === 'GK') continue;
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5 || d > 26) continue;
      const cos = (dx * dirRef.x + dz * dirRef.z) / d;
      if (cos < (aim ? 0.55 : 0.25)) continue;
      const score = cos * 2.2 - d * 0.045 + (t.human ? -0.05 : 0);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }
}
