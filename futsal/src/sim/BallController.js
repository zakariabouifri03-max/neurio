// BallController: ball physics, possession, kicks and out-of-play / goal detection.
//
// Physics: semi-implicit Euler integration with sub-steps (no tunnelling), gravity,
// speed-proportional air drag, Magnus lift from spin, rolling friction, floor
// bounces, board / post / bar rebounds, and a soft net on goals.
//
// Possession: a loose ball can be trapped by a footballer (first touch, based on
// ball control); a possessed ball follows its owner with smooth damping, so it
// never teleports.
import { BALL, PITCH, PLAYER } from '../config.js';
import { len3, clamp, damp } from '../core/math.js';

const R = BALL.radius;
const POST_R = 0.06;
const ROLL_DT = 0.01;
const travelCache = new Map();

export class BallController {
  constructor() {
    this.pos = { x: 0, y: R, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
    this.owner = null;          // Footballer currently in possession
    this.lastTouch = null;      // { by, teamIndex, t }
    this.lastKicker = null;
    this.dead = false;          // frozen during restarts / after out of play / goal
    this.inNet = 0;             // ±1 when a goal has been scored
    this.t = 0;
    this.events = [];
    this.bounceCD = 0;
    this.lastShotPath = null;
    this.intended = null;       // intended receiver of the last pass (may trap it straight away)
    this.kickT = -9;
  }

  // ---------- static helpers (pure functions, used by AI for pass weighting) ----------

  // Distance a ball travels on the ground from speed v0 before stopping.
  static rollingDistance(v0) {
    let v = v0, d = 0, guard = 0;
    while (v > 0.05 && guard++ < 4000) {
      const decel = BALL.rollDecel + BALL.rollDrag * v;
      v = Math.max(0, v - decel * ROLL_DT);
      d += v * ROLL_DT;
    }
    return d;
  }

  // Ground speed needed for a pass to stop after `dist` metres.
  static speedForDistance(dist) {
    const key = Math.round(dist * 4) / 4;
    if (travelCache.has(key)) return travelCache.get(key);
    let lo = 0, hi = BALL.maxSpeed;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (BallController.rollingDistance(mid) < key) lo = mid; else hi = mid;
    }
    const out = (lo + hi) / 2;
    if (travelCache.size < 2000) travelCache.set(key, out);
    return out;
  }

  // Ballistic launch velocity from `from` to `to` with horizontal speed `vh`.
  static ballisticVelocity(from, to, vh) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const hd = Math.hypot(dx, dz) || 1e-6;
    const t = hd / Math.max(0.5, vh);
    const vy = (to.y - from.y + 0.5 * BALL.gravity * t * t) / t;
    return { x: (dx / hd) * vh, y: vy, z: (dz / hd) * vh };
  }

  // ---------- state transitions ----------

  placeDead(x, z, y = R) {
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
    this.owner = null;
    this.inNet = 0;
    this.dead = true;
  }

  setLive() {
    this.dead = false;
    this.glide = null;
  }

  // Dead-ball placement that moves the ball smoothly instead of teleporting it.
  glideTo(x, z, dur = null) {
    const d = Math.hypot(this.pos.x - x, this.pos.z - z);
    const t = dur ?? clamp(0.25 + d / 9, 0.3, 1.6);
    this.glide = { from: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, to: { x, y: R, z }, t: 0, dur: t };
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
    this.owner = null;
    this.inNet = 0;
    this.dead = true;
  }

  // Kick the ball with an explicit 3D velocity. `spin` is an angular velocity vector.
  kick(by, velocity, spin = null) {
    if (this.owner) this.owner = null;
    this.glide = null;
    this.vel = { x: velocity.x, y: velocity.y, z: velocity.z };
    const sp = len3(this.vel);
    if (sp > BALL.maxSpeed) {
      const k = BALL.maxSpeed / sp;
      this.vel.x *= k; this.vel.y *= k; this.vel.z *= k;
    }
    this.spin = spin ? { ...spin } : { x: 0, y: 0, z: 0 };
    this.dead = false;
    this.lastKicker = by;
    this.lastTouch = { by, teamIndex: by.teamIndex, t: this.t };
    this.kickT = this.t;
    this.intended = by.intended || null;
    // the boot makes contact: push the ball radially out of the kicker's control radius
    // (a small move, never a jump to the other side of the player)
    const hx = this.pos.x - by.pos.x, hz = this.pos.z - by.pos.z;
    const hd = Math.hypot(hx, hz);
    const want = PLAYER.radius + R + 0.34;
    const sl = Math.hypot(velocity.x, velocity.z);
    const behind = sl > 1e-6 && hd > 1e-4 && (hx * velocity.x + hz * velocity.z) / (hd * sl) < 0.25;
    if (hd > 1e-4 && hd < want) {
      this.pos.x = by.pos.x + (hx / hd) * want;
      this.pos.z = by.pos.z + (hz / hd) * want;
    }
    // ball sitting beside/behind the kicker: the boot meets it on the kick side (a quick flick)
    if (behind && sl > 1e-6) {
      this.pos.x = by.pos.x + (velocity.x / sl) * want;
      this.pos.z = by.pos.z + (velocity.z / sl) * want;
    }
    by.kickCD = 0.42;
    by.kickAnimT = 0.28;
    this.events.push({ type: 'kick', by, speed: sp });
  }

  capture(by) {
    this.owner = by;
    this.lastTouch = { by, teamIndex: by.teamIndex, t: this.t };
    this.spin = { x: 0, y: 0, z: 0 };
    by.lastCaptureT = this.t;
    by.touches++;
    this.events.push({ type: 'capture', by });
  }

  release(vel = null) {
    if (!this.owner) return;
    const o = this.owner;
    this.owner = null;
    this.vel = vel ? { ...vel } : { x: o.vel.x * 1.05, y: 0, z: o.vel.z * 1.05 };
    this.events.push({ type: 'release', by: o });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- per-frame update ----------

  update(dt) {
    this.t += dt;
    this.bounceCD = Math.max(0, this.bounceCD - dt);
    if (this.glide) {
      const g = this.glide;
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const s = k * k * (3 - 2 * k);
      this.pos = {
        x: g.from.x + (g.to.x - g.from.x) * s,
        y: g.from.y + (g.to.y - g.from.y) * s + Math.sin(Math.PI * k) * 0.25 * (1 - k),
        z: g.from.z + (g.to.z - g.from.z) * s,
      };
      if (k >= 1) { this.pos = { ...g.to }; this.glide = null; }
      return;
    }
    if (this.dead) return;
    if (this.owner) {
      this.followOwner(dt);
      return;
    }
    if (this.inNet) {
      // stopped in the net: keep a small settle motion
      this.vel.x *= Math.exp(-12 * dt);
      this.vel.z *= Math.exp(-12 * dt);
      this.vel.y *= Math.exp(-12 * dt);
    }
    const speed = len3(this.vel);
    const sub = Math.max(1, Math.min(40, Math.ceil((speed * dt) / BALL.maxStepDistance)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.integrate(h);
      if (this.dead) break;
    }
  }

  integrate(h) {
    const v = this.vel, p = this.pos, s = this.spin;
    const onGround = p.y <= R + 0.002 && v.y <= 0.3;

    // Magnus force from spin: a = k * (ω × v)
    const k = BALL.magnus;
    const cx = s.y * v.z - s.z * v.y;
    const cy = s.z * v.x - s.x * v.z;
    const cz = s.x * v.y - s.y * v.x;
    v.x += k * cx * h;
    v.y += k * cy * h;
    v.z += k * cz * h;

    // gravity
    v.y -= BALL.gravity * h;

    // drag
    const dragF = Math.exp(-(onGround ? BALL.rollDrag : BALL.airDrag) * h);
    v.x *= dragF; v.z *= dragF;
    if (!onGround) v.y *= Math.exp(-BALL.airDrag * h);

    p.x += v.x * h;
    p.y += v.y * h;
    p.z += v.z * h;

    // rolling friction (constant decel) when touching the floor
    if (p.y <= R + 0.002 && Math.abs(v.y) < 0.4) {
      p.y = R;
      v.y = 0;
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1e-6) {
        const ns = Math.max(0, hs - (BALL.rollDecel + BALL.rollDrag * hs) * h);
        v.x *= ns / hs; v.z *= ns / hs;
      }
      // roll-spin converts to motion; spin decays faster on the floor
      s.x *= Math.exp(-2.5 * h); s.y *= Math.exp(-2.5 * h); s.z *= Math.exp(-2.5 * h);
    } else {
      s.x *= Math.exp(-BALL.spinDecay * h); s.y *= Math.exp(-BALL.spinDecay * h); s.z *= Math.exp(-BALL.spinDecay * h);
    }

    // floor bounce
    if (p.y < R) {
      p.y = R;
      if (v.y < 0) {
        const impact = -v.y;
        v.y = impact * BALL.restitution;
        if (v.y < 0.5) v.y = 0;
        if (impact > 1.2 && this.bounceCD <= 0) {
          this.bounceCD = 0.12;
          this.events.push({ type: 'bounce', strength: Math.min(1, impact / 8) });
        }
        // bounce loses some horizontal speed to friction
        v.x *= 0.97; v.z *= 0.97;
      }
    }
    // ceiling
    if (p.y > PITCH.ceiling) {
      p.y = PITCH.ceiling;
      v.y = -Math.abs(v.y) * 0.6;
    }

    // goal posts & crossbar (rebound)
    this.collidePosts();

    // touch lines / boards
    const halfW = PITCH.halfWidth;
    if (Math.abs(p.z) > halfW - R) {
      if (p.y > PITCH.boardHeight + R) {
        this.markOut('sideline', Math.sign(p.z));
        return;
      }
      const sgn = Math.sign(p.z);
      p.z = sgn * (halfW - R);
      if (v.z * sgn > 0) {
        v.z = -v.z * BALL.wallRestitution;
        if (this.bounceCD <= 0) {
          this.bounceCD = 0.12;
          this.events.push({ type: 'board', strength: Math.min(1, Math.abs(v.z) / 10) });
        }
      }
    }

    // goal lines: crossing inside the goal mouth is a goal, anywhere else it is out of play
    const halfL = PITCH.halfLength;
    if (!this.inNet && Math.abs(p.x) >= halfL) {
      const side = Math.sign(p.x);
      const inMouth = Math.abs(p.z) < PITCH.goalHalfWidth - POST_R && p.y < PITCH.goalHeight - POST_R;
      if (inMouth) {
        this.score(side);
        return;
      }
      this.markOut('endline', side);
      return;
    }
    if (this.inNet) {
      // stop in the net: keep it behind the line with a damped rebound
      const lim = PITCH.halfLength + PITCH.goalDepth - R;
      if (Math.abs(p.x) > lim) {
        p.x = this.inNet * lim;
        v.x = -v.x * 0.35;
      }
    }
  }

  collidePosts() {
    const p = this.pos, v = this.vel;
    const halfL = PITCH.halfLength;
    for (const side of [-1, 1]) {
      for (const zs of [-1, 1]) {
        const px = side * halfL, pz = zs * PITCH.goalHalfWidth;
        // vertical post: distance in XZ
        if (p.y < PITCH.goalHeight + R) {
          const dx = p.x - px, dz = p.z - pz;
          const d = Math.hypot(dx, dz);
          const min = R + POST_R;
          if (d < min && d > 1e-6) {
            const nx = dx / d, nz = dz / d;
            p.x = px + nx * min;
            p.z = pz + nz * min;
            const vn = v.x * nx + v.z * nz;
            if (vn < 0) {
              v.x -= (1 + BALL.postRestitution) * vn * nx;
              v.z -= (1 + BALL.postRestitution) * vn * nz;
              this.events.push({ type: 'post', strength: Math.min(1, -vn / 8) });
            }
          }
        }
      }
    }
    // crossbar: runs along z at y = goalHeight, x = ±halfL
    for (const side of [-1, 1]) {
      const px = side * halfL, py = PITCH.goalHeight;
      if (Math.abs(p.z) <= PITCH.goalHalfWidth + R) {
        const dx = p.x - px, dy = p.y - py;
        const d = Math.hypot(dx, dy);
        const min = R + POST_R;
        if (d < min && d > 1e-6) {
          const nx = dx / d, ny = dy / d;
          p.x = px + nx * min;
          p.y = py + ny * min;
          const vn = v.x * nx + v.y * ny;
          if (vn < 0) {
            v.x -= (1 + BALL.postRestitution) * vn * nx;
            v.y -= (1 + BALL.postRestitution) * vn * ny;
            this.events.push({ type: 'post', strength: Math.min(1, -vn / 8) });
          }
        }
      }
    }
  }

  score(side) {
    this.inNet = side;
    this.dead = false;
    this.owner = null;
    // keep the ball in the net: lose most of the speed immediately
    this.vel.x *= 0.25;
    this.vel.z *= 0.25;
    this.vel.y = Math.max(-1, this.vel.y);
    this.pos.x = side * (PITCH.halfLength + 0.25);
    this.events.push({ type: 'goal', side, by: this.lastTouch ? this.lastTouch.by : null });
  }

  markOut(kind, side) {
    if (this.dead) return;
    const p = this.pos;
    // clamp to the line where it left the pitch
    if (kind === 'sideline') p.z = side * (PITCH.halfWidth - 0.02);
    if (kind === 'endline') p.x = side * (PITCH.halfLength - 0.02);
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = { x: 0, y: 0, z: 0 };
    this.dead = true;
    this.events.push({ type: 'out', kind, side, pos: { x: p.x, z: p.z }, lastTouch: this.lastTouch });
  }

  followOwner(dt) {
    const f = this.owner;
    if (!f || f.sentOff || f.walkOff || f.isDown || f.diveT > 0) {
      const v = f ? { x: f.vel.x * 1.05, y: 0, z: f.vel.z * 1.05 } : { x: 0, y: 0, z: 0 };
      this.release(v);
      return;
    }
    const sp = Math.hypot(f.vel.x, f.vel.z);
    let dx, dz;
    if (sp > 0.8) {
      dx = f.vel.x / sp; dz = f.vel.z / sp;
    } else {
      dx = Math.cos(f.heading); dz = Math.sin(f.heading);
    }
    // dribble touches: while running the ball is pushed a little further ahead
    const dribbleExtra = Math.min(0.42, sp * 0.035) * (0.5 + 0.5 * Math.sin(f.phase * 0.5));
    const dist = PLAYER.dribbleOffset + Math.min(0.2, sp * 0.02) + dribbleExtra * 0.5;
    const tx = f.pos.x + dx * dist;
    const tz = f.pos.z + dz * dist;
    const prev = { x: this.pos.x, z: this.pos.z };
    // a feint swings the ball across the body and back
    let lat = 0;
    if (f.skillT > 0) lat = (f.skillSide || 1) * 0.7 * Math.sin(Math.PI * (1 - f.skillT / 0.45));
    const tx2 = tx - dz * lat, tz2 = tz + dx * lat;
    const lam = 24;
    let nx = damp(this.pos.x, tx2, lam, dt);
    let nz = damp(this.pos.z, tz2, lam, dt);
    // never move more than 0.45 m in one frame
    const mx = nx - prev.x, mz = nz - prev.z;
    const md = Math.hypot(mx, mz);
    if (md > 0.45) { nx = prev.x + (mx / md) * 0.45; nz = prev.z + (mz / md) * 0.45; }
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y = R;
    this.vel.x = f.vel.x;
    this.vel.z = f.vel.z;
    this.vel.y = 0;
    this.spin.x = this.spin.y = this.spin.z = 0;
    // keep the field bounds
    this.pos.x = clamp(this.pos.x, -PITCH.halfLength + R, PITCH.halfLength - R);
    this.pos.z = clamp(this.pos.z, -PITCH.halfWidth + R, PITCH.halfWidth - R);
  }

  // Trap a loose ball: called once per frame by the match with all active footballers.
  // Returns the footballer who gained possession or null.
  tryCapture(players, rng) {
    if (this.owner || this.dead || this.inNet) return null;
    if (this.pos.y > 0.6) return null;
    const best = [];
    const inFlight = this.t - this.kickT < 0.12;
    for (const f of players) {
      if (!f.isActive || f.isDown || f.diveT > 0 || f.kickCD > 0) continue;
      if (this.t - f.lastCaptureT < 0.2) continue;
      // a fresh pass is not trapped by bystanders in the first instants (only its target may take it)
      if (inFlight && f !== this.intended && f.teamIndex === (this.lastKicker ? this.lastKicker.teamIndex : -1)) continue;
      const dx = this.pos.x - f.pos.x, dz = this.pos.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = BALL.controlRadius + PLAYER.radius * 0.35;
      if (d > reach) continue;
      best.push({ f, d });
    }
    if (!best.length) return null;
    best.sort((a, b) => a.d - b.d);
    const { f } = best[0];
    const rvx = this.vel.x - f.vel.x, rvz = this.vel.z - f.vel.z;
    const relSpeed = Math.hypot(rvx, rvz);
    const limit = 9 + f.attrs.ballControl * 0.14 + (f.role === 'GK' ? 8 : 0);
    if (relSpeed > limit) return null;
    const p = f.role === 'GK' ? 0.85 : clamp(0.42 + f.attrs.ballControl * 0.0054 - relSpeed * 0.012, 0.15, 0.97);
    if (rng.next() < p) {
      // first touch: trap the ball (speed is absorbed), then the owner carries it
      this.vel.x *= 0.25;
      this.vel.z *= 0.25;
      this.capture(f);
      return f;
    }
    f.lastCaptureT = this.t; // failed first touch: ball bounces away
    return null;
  }

  // Ball vs footballer body collision for loose balls (blocks, deflections, bodies in the way).
  collidePlayers(players) {
    if (this.owner || this.dead || this.inNet) return;
    for (const f of players) {
      if (!f.isActive) continue;
      // the player who has just kicked does not block his own pass
      if (f === this.lastKicker && f.kickCD > 0) continue;
      const dx = this.pos.x - f.pos.x, dz = this.pos.z - f.pos.z;
      const d = Math.hypot(dx, dz);
      const min = R + PLAYER.radius;
      if (d >= min || this.pos.y > 1.5) continue;
      let nx = d > 1e-6 ? dx / d : Math.cos(f.heading + 1.57);
      let nz = d > 1e-6 ? dz / d : Math.sin(f.heading + 1.57);
      this.pos.x = f.pos.x + nx * min;
      this.pos.z = f.pos.z + nz * min;
      // relative velocity along the normal
      const rvx = this.vel.x - f.vel.x, rvz = this.vel.z - f.vel.z;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const e = 0.5;
        this.vel.x -= (1 + e) * vn * nx;
        this.vel.z -= (1 + e) * vn * nz;
        // players that run into a ball push it a bit
        this.vel.x += f.vel.x * 0.35;
        this.vel.z += f.vel.z * 0.35;
        this.events.push({ type: 'touch', by: f, strength: Math.min(1, -vn / 10) });
      }
    }
  }

  // Attach visuals / stats-facing read only state.
  get speed() {
    return len3(this.vel);
  }
}
