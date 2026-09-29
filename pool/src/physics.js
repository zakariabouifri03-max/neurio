// ── NEURIO billiards physics engine ─────────────────────────────────────────
// SHARED, DETERMINISTIC MODULE — the exact same code runs on the client (for
// instant visual playback) and on the authoritative server (for validation and
// results). No Math.random, no Date, no platform-dependent iteration order, so
// given the same ball state and the same strike, both produce bit-identical
// results. That is what makes client-side prediction safe while the server
// stays authoritative.
//
// Model (SI units, metres / seconds):
//   • rigid spheres, mass M, inertia I = 2/5·M·R²
//   • sliding (kinetic) friction at the cloth contact patch — a ball struck
//     off-centre skids first and only later settles into natural roll
//   • rolling resistance + pivot friction (kills in-place spin)
//   • ball↔ball impulse: normal restitution + tangential friction ⇒ throw and
//     spin transfer, so stun / draw / follow survive contact
//   • cushion impulse: normal restitution + tangential friction computed from
//     the contact-point velocity ⇒ running english, check-up, reverse english
//   • pocket jaws as hard bumper circles ⇒ balls rattle, hang and double-kiss
//   • pocket capture volume ⇒ a ball crossing the mouth drops and is pocketed
import {
  TABLE, BALL, PHYS, POCKETS, CUSHIONS, JAWS, HL, HW, BALL_COUNT, rackPositions, rack9,
} from './table.js';

const { M, R, I } = BALL;
const { G, DT } = PHYS;
const KW = R / I;          // torque → angular accel factor for a tangential impulse
const INV_M = 1 / M;
const K_SPIN = (R * R) / I;   // = 2.5 for a solid sphere (spin inertia factor)

// ── quaternion helpers (plain arrays so state stays serialisable) ───────────
export function qIdent() { return [0, 0, 0, 1]; }

export function qMul(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qNorm(q) {
  const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** integrate orientation by angular velocity ω over dt */
export function qStep(q, wx, wy, wz, dt) {
  const w2 = wx * wx + wy * wy + wz * wz;
  if (w2 < 1e-14) return q;
  const w = Math.sqrt(w2);
  const a = w * dt * 0.5;
  const s = Math.sin(a) / w;
  return qNorm(qMul([wx * s, wy * s, wz * s, Math.cos(a)], q));
}

// ── ball state ──────────────────────────────────────────────────────────────
// state: 'table' | 'falling' | 'pocketed'
export function makeBall(n, x, z) {
  return {
    n, x, y: 0, z,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    q: qIdent(),
    state: 'table',
    pocket: -1,
    fall: 0,
    rest: 0,
    sink: 0,
  };
}

export function cloneBalls(balls) {
  return balls.map((b) => (b ? { ...b, q: b.q.slice() } : null));
}

/** restore balls from a serialised snapshot (Shot.result().balls) */
export function ballsFromSnapshot(snap) {
  const out = new Array(BALL_COUNT).fill(null);
  for (const s of snap) {
    const b = makeBall(s.n, s.x, s.z);
    b.y = s.y || 0;
    b.q = s.q ? s.q.slice() : qIdent();
    b.state = s.st === 0 ? 'table' : s.st === 1 ? 'falling' : 'pocketed';
    b.pocket = s.p === undefined ? -1 : s.p;
    if (b.state === 'pocketed') b.sink = R * 2;
    out[s.n] = b;
  }
  return out;
}

/** fresh rack for a game mode */
export function newRack(mode) {
  const pos = mode === '9ball' ? rack9() : rackPositions();
  const use = mode === '9ball' ? 10 : BALL_COUNT;
  const balls = new Array(BALL_COUNT).fill(null);
  for (let n = 0; n < use; n++) {
    if (pos[n]) balls[n] = makeBall(n, pos[n].x, pos[n].z);
  }
  return balls;
}

// ── the shot simulator ──────────────────────────────────────────────────────
export class Shot {
  constructor(balls, opts = {}) {
    this.balls = balls;
    this.t = 0;
    this.events = [];
    this.firstContact = null;
    this.pocketed = [];
    this.railAfterContact = false;
    this.cushionBeforeContact = 0;
    this.ballHits = 0;
    this.cushionHits = 0;
    this.maxSpeed = 0;
    this.done = false;
    this.eventCap = opts.eventCap || 3000;
    this._evCount = 0;
    this._allRest = 0;
    this._creep = 0;
    this.maxTime = opts.maxTime || PHYS.MAX_SIM_TIME;
    this.keepEvents = opts.keepEvents !== false;
  }

  ev(type, data) {
    if (!this.keepEvents) return;
    if (this._evCount++ > this.eventCap) return;
    this.events.push(Object.assign({ t: +this.t.toFixed(4), type }, data));
  }

  /**
   * Apply the cue strike to the cue ball.
   *
   * The stick is treated as a moving mass Mc: an offset hit is partly a
   * glancing blow, so the normal impulse is Jn = Mc·(V·n̂)·(1+e)·cosφ and the
   * chalked tip can add tangential impulse up to μ_tip·Jn. Spin then follows
   * from Δω = (r × J)/I with r measured from the ball centre to the contact
   * point. This reproduces the three things players actually feel:
   *   • draw/follow proportional to the vertical tip offset,
   *   • sidespin (english) proportional to the horizontal offset,
   *   • a little squirt/deflection pushing the ball off the stick line.
   */
  applyStrike(strike) {
    const cue = this.balls[0];
    if (!cue || cue.state !== 'table') return false;
    const dirX = strike.dirX, dirZ = strike.dirZ;
    const V = Math.max(0.05, strike.speed);
    const ox = strike.ox || 0, oy = strike.oy || 0, oz = strike.oz || 0;
    const dl = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / dl, dz = dirZ / dl;
    const perpX = -dz, perpZ = dx;                    // horizontal perpendicular

    const on = ox * dx + oz * dz;                     // offset along the stick line
    const ot = ox * perpX + oz * perpZ;               // horizontal english
    const cosPhi = Math.sqrt(Math.max(0.02, 1 - (on * on + ot * ot + oy * oy) / (R * R)));

    // The stick is far heavier than the ball and stays behind it through the
    // ~1 ms contact, so the normal impulse is Jn = M·V·cosφ: an off-centre hit
    // is a glancing blow and launches the ball a little slower and a little off
    // the stick line (that is cue deflection, "squirt").
    const Jn = M * V * cosPhi * (strike.miscue ? 0.45 : 1);
    const vn = Jn / M;
    let vx = dx * vn + ot * (vn * 0.055);
    let vz = dz * vn + (-on) * (vn * 0.055);
    const vl = Math.hypot(vx, vz) || 1;
    const maxV = PHYS.CUE_MAX_SPEED + 0.25;
    if (vl > maxV) { vx = vx / vl * maxV; vz = vz / vl * maxV; }
    cue.vx = vx; cue.vz = vz; cue.vy = 0; cue.rest = 0;

    // ── spin: the whole impulse travels along the stick line ────────────────
    // A chalked tip grips (makeStrike already clamped the offset to the miscue
    // limit µ ≥ tanφ), so the cue delivers its impulse J = Jn·d̂ at the contact
    // point r = o − depth·d̂.  All of the spin is the lever arm of that impulse:
    //   Δω = (r × J)/I,   |Δω| = |o|·Jn/I   ⇒   ω·R = 2.5·β·v  with β = |o|/R.
    // That reproduces the classic result players know: struck 0.4R above centre
    // (β = 2/5) the ball leaves in natural roll, u = v + ω·R = 0; above that it
    // skids backward (follow), below it skids forward (draw).
    const Jx = Jn * dx, Jy = 0, Jz = Jn * dz;
    const depth = Math.sqrt(Math.max(1e-9, R * R - ox * ox - oy * oy - oz * oz));
    const rx = ox - dx * depth, ry = oy, rz = oz - dz * depth;
    // (a × b) = (ay·bz−az·by, az·bx−ax·bz, ax·by−ay·bx), and pure roll along +x
    // is ωz = −vx/R, so the signs players expect fall out of this directly:
    //   hit low   (oy<0) ⇒ ωz > 0 ⇒ back-spin ⇒ DRAW
    //   hit high  (oy>0) ⇒ ωz < 0 ⇒ top-spin  ⇒ FOLLOW
    //   hit right (side>0, along +perp) ⇒ ωy > 0 ⇒ clockwise from above
    cue.wx = (rz * Jy - ry * Jz) / I;
    cue.wy = (rz * Jx - rx * Jz) / I;
    cue.wz = (rx * Jy - ry * Jx) / I;

    this.ev('strike', {
      speed: +V.toFixed(4), ox: +ox.toFixed(4), oy: +oy.toFixed(4), oz: +oz.toFixed(4),
      v0: +Math.hypot(cue.vx, cue.vz).toFixed(4),
      w0: +Math.hypot(cue.wx, cue.wy, cue.wz).toFixed(3),
    });
    return true;
  }

  /** advance one fixed step; returns true while the shot is still live */
  step(dt) {
    if (this.done) return false;
    const h = dt === undefined ? DT : dt;
    this.t += h;
    const balls = this.balls;

    const live = [];
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b || b.state === 'pocketed') continue;
      live.push(b);
    }

    for (const b of live) {
      if (b.state === 'falling') { this._fall(b, h); continue; }
      let sp = Math.hypot(b.vx, b.vz);
      if (sp > PHYS.MAX_BALL_SPEED) {           // hard physical ceiling
        const k = PHYS.MAX_BALL_SPEED / sp;
        b.vx *= k; b.vz *= k; b.wx *= k; b.wy *= k; b.wz *= k;
        sp = PHYS.MAX_BALL_SPEED;
      }
      if (sp > this.maxSpeed) this.maxSpeed = sp;
      this._cloth(b, h, sp);
      b.x += b.vx * h;
      b.z += b.vz * h;
      b.q = qStep(b.q, b.wx, b.wy, b.wz, h);
    }

    for (const b of live) if (b.state === 'table') this._pocket(b);
    this._collide(live);

    let anyMoving = false;
    for (const b of live) {
      if (b.state === 'falling') { anyMoving = true; continue; }
      if (b.state !== 'table') continue;
      const sp = Math.hypot(b.vx, b.vz);
      const w = Math.hypot(b.wx, b.wy, b.wz);
      if (sp < PHYS.SLEEP_V && w < PHYS.SLEEP_W) {
        b.vx = 0; b.vz = 0; b.wx = 0; b.wy = 0; b.wz = 0;
        b.rest += h;
      } else { b.rest = 0; anyMoving = true; }
    }
    this._allRest = anyMoving ? 0 : this._allRest + h;

    // "Creep" guard: a ball can be left spinning in place (big ω, ~0 v) or
    // micro-oscillating against a cushion. Physically that is a dead ball —
    // pivot friction finishes it in a fraction of a second — so once nothing on
    // the bed is above a walking pace for a few frames the shot is over.
    let vmax = 0;
    for (const b of live) {
      if (b.state !== 'table') continue;
      const sp2 = Math.hypot(b.vx, b.vz);
      if (sp2 > vmax) vmax = sp2;
    }
    this._creep = vmax < 0.014 ? this._creep + h : 0;

    if (this._allRest >= PHYS.SLEEP_TIME || this._creep >= 0.30 || this.t > this.maxTime) this.finish();
    return !this.done;
  }

  _fall(b, h) {
    b.fall += h;
    b.vy -= G * h * 0.8;
    b.y += b.vy * h;
    b.sink = Math.max(0, -b.y);
    b.vx *= 0.88; b.vz *= 0.88;
    b.wx *= 0.9; b.wy *= 0.9; b.wz *= 0.9;
    b.q = qStep(b.q, b.wx, b.wy, b.wz, h);
    if (b.fall >= PHYS.POCKET_FALL || b.y < -0.24) {
      b.state = 'pocketed';
      b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
      b.sink = R * 2;
      b.y = -0.24;
    }
  }

  _pocket(b) {
    for (let i = 0; i < POCKETS.length; i++) {
      const p = POCKETS[i];
      const dx = b.x - p.x, dz = b.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < p.r * p.r) {
        b.state = 'falling';
        b.pocket = p.id;
        b.fall = 0;
        b.vy = -0.2;
        const d = Math.sqrt(d2) || 1;
        b.x = p.x + (dx / d) * p.r * 0.2;
        b.z = p.z + (dz / d) * p.r * 0.2;
        this.pocketed.push({ n: b.n, pocket: p.id, t: +this.t.toFixed(4) });
        this.ev('pocket', { n: b.n, pocket: p.id });
        return;
      }
      if (d2 < (p.r * 1.4) * (p.r * 1.4)) {
        const d = Math.sqrt(d2) || 1;
        const k = (1 - d / (p.r * 1.4)) * 0.9;
        b.vx -= (dx / d) * k * 0.018;
        b.vz -= (dz / d) * k * 0.018;
      }
    }
    if (Math.abs(b.x) > HL + 0.04 || Math.abs(b.z) > HW + 0.04) {
      let best = 0, bd = 1e9;
      for (const p of POCKETS) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < bd) { bd = d; best = p.id; }
      }
      b.state = 'falling'; b.pocket = best; b.fall = 0; b.vy = -0.2;
      this.pocketed.push({ n: b.n, pocket: best, t: +this.t.toFixed(4), jumped: true });
      this.ev('pocket', { n: b.n, pocket: best, jumped: true });
    }
  }

  /** cloth: sliding friction → natural roll, rolling resistance, spin decay */
  _cloth(b, h, sp) {
    // Velocity of the cloth-contact patch:  u = v + ω × r,  r = (0,−R,0).
    //   (ω × r)_x = ωy·rz − ωz·ry = +ωz·R      (ry = −R, rz = 0)
    //   (ω × r)_z = ωx·ry − ωy·rx = −ωx·R
    //   ⇒  ux = vx + ωz·R ,   uz = vz − ωx·R
    // Pure roll (u = 0) ⇒ ω = (vz/R, 0, −vx/R): travel along +x spins about −z,
    // i.e. clockwise seen from +z, which is what a forward-rolling ball does.
    // u > 0 ⇒ the patch skids forward ⇒ the ball is spinning backwards ⇒ DRAW.
    const ux = b.vx + b.wz * R;
    const uz = b.vz - b.wx * R;
    const ul = Math.hypot(ux, uz);
    const dv = PHYS.MU_SLIDE * G * h;

    if (ul > 1e-8) {
      const d = Math.min(ul, dv);
      const fx = (ux / ul) * d, fz = (uz / ul) * d;
      b.vx -= fx; b.vz -= fz;
      // Δω = (r × J)/I with r = (0,−R,0) and J = −m·f:
      //   Δωx = (−R·Jz)/I = −fz·R/I
      //   Δωz = (+R·Jx)/I = −fx·R/I
      // ⇒ du/dt = −3.5·μ·g·û, so sliding always decays toward pure roll.
      // Δω = (r × J)/I with r = (0,−R,0) and J = −M·f:
      //   (r×J)_x = −R·Jz = +M·R·fz   ⇒  Δωx = +fz·k
      //   (r×J)_z = +R·Jx·(−1) = −M·R·fx ⇒  Δωz = −fx·k
      // Both signs are load-bearing: with Δωx flipped, sliding along z grows
      // every step instead of decaying to pure roll (verified numerically).
      const k = (M * R) / I;                 // = 2.5 / R
      b.wx += fz * k;
      b.wz -= fx * k;
    }

    if (sp > 1e-8) {
      const dr = PHYS.MU_ROLL * G * h;
      if (ul <= dv * 1.5) {
        // pure roll: decelerate translation and rotation together so the
        // rolling condition u = 0 is preserved instead of being eroded
        const f = Math.max(0, 1 - dr / sp);
        b.vx *= f; b.vz *= f; b.wx *= f; b.wz *= f;
      } else {
        // still skidding: sliding friction above handles the spin coupling
        const nx = b.vx / sp, nz = b.vz / sp;
        const cur = b.vx * nx + b.vz * nz;
        const dec = Math.min(Math.abs(cur), dr) * (cur < 0 ? -1 : 1);
        b.vx -= nx * dec; b.vz -= nz * dec;
      }
    }

    b.wy -= b.wy * Math.min(1, PHYS.SPIN_DECAY * h);

    // Pivot (twist) friction. A ball spinning about the vertical axis shears the
    // whole contact patch, so it bleeds off far faster than sliding friction
    // implies — without this a ball would spin in place for over a minute.
    if (Math.abs(b.wy) > 1e-9) {
      const decel = (4 * PHYS.MU_PIVOT * G) / (3 * R);
      const mag = Math.abs(b.wy);
      const dw = decel * h + mag * Math.min(1, 0.9 * h);
      b.wy -= (b.wy / mag) * Math.min(mag, dw);
    }
    // and when the ball is standing still the rolling axes get scrubbed too
    if (sp < PHYS.SLEEP_V * 2.4) {
      const k = Math.min(1, 3.4 * h);
      b.wx -= b.wx * k; b.wz -= b.wz * k;
    }
  }

  _collide(live) {
    const n = live.length;
    this._pairSeen = this._pairSeen || new Set();
    this._pairSeen.clear();
    if (n > 1) {
      // Positional relaxation first (two passes, capped) so a packed rack is
      // separated gently instead of being exploded apart, then the impulse
      // passes. Uniform grid broadphase, hashed twice with a half-cell offset
      // so pairs straddling a cell boundary always meet.
      this._separate(live);
      this._separate(live);
      this._gridPass(live, 0, 0);
      this._gridPass(live, 0.5, 0.5);
    }
    for (const b of live) {
      if (b.state !== 'table') continue;
      // A jaw bumper is centred on the rail line, so when a ball touches a jaw
      // the jaw owns the contact - resolving both would jitter forever.
      if (!this._jaws(b)) this._cushions(b);
      this._clamp(b);
    }
  }

  /** push overlapping balls apart without touching their velocities */
  _separate(live) {
    const cell = 0.14;
    const grid = new Map();
    for (let i = 0; i < live.length; i++) {
      const b = live[i];
      if (b.state !== 'table') continue;
      const k = Math.floor((b.x + 3) / cell) * 4096 + Math.floor((b.z + 3) / cell);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    for (const arr of grid.values()) {
      for (let x = 0; x < arr.length; x++) {
        for (let y = x + 1; y < arr.length; y++) {
          const a = live[arr[x]], b = live[arr[y]];
          if (a.state !== 'table' || b.state !== 'table') continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= BALL.D * BALL.D || d2 < 1e-14) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          // capped: never teleport a ball more than 15 % of its radius per pass
          const pen = Math.min((BALL.D - d) * 0.5, R * 0.15);
          a.x -= nx * pen; a.z -= nz * pen;
          b.x += nx * pen; b.z += nz * pen;
        }
      }
    }
  }

  _gridPass(live, offX, offZ) {
    const cell = 0.14;
    const grid = new Map();
    const idx = [];
    for (let i = 0; i < live.length; i++) {
      const b = live[i];
      if (b.state !== 'table') continue;
      const gx = Math.floor((b.x + offX * cell + 3) / cell);
      const gz = Math.floor((b.z + offZ * cell + 3) / cell);
      const k = gx * 4096 + gz;
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
      idx.push(i);
    }
    for (const arr of grid.values()) {
      for (let a = 0; a < arr.length; a++) {
        for (let c = a + 1; c < arr.length; c++) this._pair(live[arr[a]], live[arr[c]]);
      }
    }
    void idx;
  }

  _pair(a, b) {
    if (a.state !== 'table' || b.state !== 'table') return;
    const pid = a.n < b.n ? a.n * 32 + b.n : b.n * 32 + a.n;
    if (this._pairSeen.has(pid)) return;
    let dx = b.x - a.x, dz = b.z - a.z;
    const d2 = dx * dx + dz * dz;
    const D = BALL.D;
    if (d2 >= D * D || d2 < 1e-12) return;
    this._pairSeen.add(pid);
    const d = Math.sqrt(d2);
    const nx = dx / d, nz = dz / d;

    const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (vn >= 0) return;

    // normal impulse:  j = −(1+e)·v_rel·n / (1/Ma + 1/Mb)  = −(1+e)·v_rel·n·M/2
    const jn = -(1 + PHYS.E_BALL) * vn * M * 0.5;
    a.vx -= (jn * INV_M) * nx; a.vz -= (jn * INV_M) * nz;
    b.vx += (jn * INV_M) * nx; b.vz += (jn * INV_M) * nz;

    // Contact-point velocities. The contact lies in the horizontal plane
    // through both centres:  r_a = +R·n̂  (a's centre → contact),  r_b = −R·n̂.
    // Only ωy (vertical english) moves the contact point sideways, because
    //   (ω × r)_x = ωy·rz ,  (ω × r)_z = −ωy·rx   (ry = 0)
    // ωx/ωz only slide the patches vertically, which the bed constrains away.
    const rax = R * nx, raz = R * nz;
    const sux = a.vx + a.wy * raz;
    const suz = a.vz - a.wy * rax;
    const sbx = b.vx - b.wy * raz;
    const sbz = b.vz + b.wy * rax;
    const utx = sbx - sux, utz = sbz - suz;
    const ut = Math.hypot(utx, utz);
    if (ut > 1e-8) {
      const ux = utx / ut, uz = utz / ut;
      const jtMax = PHYS.MU_BALL * jn;
      // effective mass for a tangential impulse shared by two spheres:
      //   Δu = jt·(2/M + 2R²/I)  ⇒  jt = ut·M/(2 + 2·K_SPIN) = ut·M/7
      const jtNeed = (ut * M) / (2 + 2 * K_SPIN);
      const jt = Math.min(jtMax, jtNeed);
      a.vx += (jt * INV_M) * ux; a.vz += (jt * INV_M) * uz;
      b.vx -= (jt * INV_M) * ux; b.vz -= (jt * INV_M) * uz;
      // Δω_y = (r × J)_y / I. J on a is +jt·û, on b is −jt·û, and rb = −ra,
      // so the two spins are equal and opposite and angular momentum holds.
      // (r × J)_y = rz·Jx − rx·Jz.  J_a = +jt·û at r_a and J_b = −jt·û at
      // r_b = −r_a, so both balls pick up the SAME Δωy (the pair's orbital
      // angular momentum takes up the difference).
      const dwy = (raz * ux - rax * uz) * jt / I;
      a.wy += dwy;
      b.wy += dwy;
    }

    const impact = -vn;
    this.ballHits++;
    if (a.n === 0 || b.n === 0) {
      const other = a.n === 0 ? b.n : a.n;
      if (!this.firstContact) {
        this.firstContact = { n: other, t: +this.t.toFixed(4), speed: +impact.toFixed(3) };
        this.ev('firstContact', { n: other, speed: +impact.toFixed(3) });
      } else {
        this.ev('ballHit', { a: a.n, b: b.n, speed: +impact.toFixed(3) });
      }
    } else {
      this.ev('ballHit', { a: a.n, b: b.n, speed: +impact.toFixed(3) });
    }
  }

  _cushions(b) {
    for (let ci = 0; ci < CUSHIONS.length; ci++) {
      const c = CUSHIONS[ci];
      const ex = c.bx - c.ax, ez = c.bz - c.az;
      const ll = ex * ex + ez * ez;
      let t = ((b.x - c.ax) * ex + (b.z - c.az) * ez) / ll;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = c.ax + ex * t, pz = c.az + ez * t;
      const ddx = b.x - px, ddz = b.z - pz;
      if (ddx * ddx + ddz * ddz > R * R) continue;
      const nx = c.nx, nz = c.nz;
      const plane = c.ax * nx + c.az * nz;
      const dist = b.x * nx + b.z * nz - plane;
      if (dist >= R) continue;
      // positional correction first so a ball can never be squeezed out of the
      // bed — capped, because a deep overlap must not become free velocity
      const push = Math.min(R - dist, R * 0.25);
      b.x += nx * push;
      b.z += nz * push;
      const vn = b.vx * nx + b.vz * nz;
      if (vn >= 0) continue;

      // Resting contact: the ball is leaning on the rail rather than striking
      // it. Cancel the normal velocity instead of bouncing it, otherwise a ball
      // left with side spin against a cushion rebounds hundreds of times a
      // second and never settles (and never finishes the shot).
      const resting = -vn < 0.085;
      const jn = -(resting ? 1.0 : 1 + PHYS.E_CUSHION) * vn * M;
      b.vx += (jn * INV_M) * nx; b.vz += (jn * INV_M) * nz;

      // contact-point velocity including english.  r = −R·n̂ = (rx,0,rz), and
      //   (ω × r)_x = ωy·rz ,  (ω × r)_z = −ωy·rx
      //   ⇒  ux = vx + ωy·rz ,  uz = vz − ωy·rx
      // (Getting this sign wrong feeds spin instead of scrubbing it: the rail
      //  then buzzes forever.)
      const rx = -R * nx, rz = -R * nz;
      const ux = b.vx + b.wy * rz;
      const uz = b.vz - b.wy * rx;
      const tx = -nz, tz = nx;
      const ut = ux * tx + uz * tz;
      if (Math.abs(ut) > 1e-8) {
        const jtMax = PHYS.MU_CUSHION * Math.abs(jn);
        const jtNeed = Math.abs(ut) * M / (1 + K_SPIN);
        const jt = Math.min(jtMax, jtNeed) * (ut < 0 ? -1 : 1);
        const jtx = -jt * tx, jtz = -jt * tz;      // friction opposes sliding
        b.vx += jtx * INV_M; b.vz += jtz * INV_M;
        b.wy += (rz * jtx - rx * jtz) / I;          // Δω = (r × J)/I
      }
      // the rail is padded — it eats spin on every contact
      b.wy *= resting ? 0.80 : 0.62;
      b.wx *= 0.94; b.wz *= 0.94;

      if (!resting || -vn > 0.02) {
        this.cushionHits++;
        if (this.firstContact) this.railAfterContact = true;
        else if (b.n === 0) this.cushionBeforeContact++;
        this.ev('cushion', { n: b.n, speed: +Math.abs(vn).toFixed(3), rail: ci, rest: resting });
      }
    }
  }

  /** last-resort containment: the bed is a hard box except at pocket mouths */
  _clamp(b) {
    const lim = 0.0015;
    if (b.x > HL - R + lim) { b.x = HL - R + lim; if (b.vx > 0) b.vx = 0; }
    if (b.x < -HL + R - lim) { b.x = -HL + R - lim; if (b.vx < 0) b.vx = 0; }
    if (b.z > HW - R + lim) { b.z = HW - R + lim; if (b.vz > 0) b.vz = 0; }
    if (b.z < -HW + R - lim) { b.z = -HW + R - lim; if (b.vz < 0) b.vz = 0; }
  }

  /** @returns true when a jaw owned this ball's contact this step */
  _jaws(b) {
    let touched = false;
    for (let i = 0; i < JAWS.length; i++) {
      const j = JAWS[i];
      const dx = b.x - j.x, dz = b.z - j.z;
      const rr = R + j.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-12) continue;
      touched = true;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      b.x = j.x + nx * rr; b.z = j.z + nz * rr;
      const vn = b.vx * nx + b.vz * nz;
      if (vn >= 0) continue;
      const resting = -vn < 0.07;
      const jn = -(resting ? 1.0 : 1 + PHYS.E_JAW) * vn * M;
      b.vx += (jn * INV_M) * nx; b.vz += (jn * INV_M) * nz;
      const tx = -nz, tz = nx;
      const rx = -R * nx, rz = -R * nz;
      const ut = (b.vx + b.wy * rz) * tx + (b.vz - b.wy * rx) * tz;
      if (Math.abs(ut) > 1e-8) {
        const jtMax = PHYS.MU_JAW * Math.abs(jn);
        const jtNeed = Math.abs(ut) * M / (1 + K_SPIN);
        const jt = Math.min(jtMax, jtNeed) * (ut < 0 ? -1 : 1);
        const jtx = -jt * tx, jtz = -jt * tz;
        b.vx += jtx * INV_M; b.vz += jtz * INV_M;
        b.wy += (rz * jtx - rx * jtz) / I;
      }
      b.wy *= resting ? 0.80 : 0.55;
      if (!resting || -vn > 0.02) {
        this.cushionHits++;
        if (this.firstContact) this.railAfterContact = true;
        this.ev('jaw', { n: b.n, jaw: i, speed: +Math.abs(vn).toFixed(3) });
      }
    }
    return touched;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    for (const b of this.balls) {
      if (!b) continue;
      if (b.state === 'falling') {
        b.state = 'pocketed';
        b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0;
        b.sink = R * 2; b.y = -0.24;
      } else if (b.state === 'table') {
        b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.rest = 0;
      }
    }
  }

  /** run to rest in one go (server authority, AI search, predictions) */
  runAll(maxSteps) {
    let s = 0;
    const cap = maxSteps || Math.ceil(this.maxTime / DT);
    while (!this.done && s++ < cap) this.step(DT);
    this.finish();
    return this.result();
  }

  result() {
    return {
      t: +this.t.toFixed(4),
      pocketed: this.pocketed,
      firstContact: this.firstContact,
      railAfterContact: this.railAfterContact,
      cushionBeforeContact: this.cushionBeforeContact,
      ballHits: this.ballHits,
      cushionHits: this.cushionHits,
      maxSpeed: +this.maxSpeed.toFixed(4),
      balls: this.balls.filter(Boolean).map((b) => ({
        n: b.n,
        x: +b.x.toFixed(5), z: +b.z.toFixed(5), y: +b.y.toFixed(5),
        q: b.q.map((v) => +v.toFixed(5)),
        st: b.state === 'table' ? 0 : b.state === 'falling' ? 1 : 2,
        p: b.pocket,
      })),
      events: this.events,
    };
  }
}

/** Build a shot and resolve it completely. Used by the server, the AI and guides. */
export function resolveShot(balls, strike, opts) {
  const s = new Shot(balls, opts);
  if (strike) s.applyStrike(strike);
  s.runAll();
  return s;
}

/**
 * Convert player intent into the strike record consumed by Shot.applyStrike.
 *
 * The tip offset is expressed in the STICK FRAME, which is what the aiming UI
 * shows and what a player actually thinks in:
 *   tipSide  −1..+1   left → right of centre   (english; +1 = right english)
 *   tipVert  −1..+1   bottom → top of the ball (−1 = draw, +1 = follow)
 * Both are fractions of the maximum usable tip offset (0.80·R by default).
 * They are converted here into world-space offsets so the simulator never has
 * to know which way the player is facing.
 *
 * @returns strike record + `cx/cy/cz`, the contact point on the ball surface
 *          relative to its centre (used to place the cue tip in the renderer).
 */
export function makeStrike(dirX, dirZ, power, tipSide, tipVert, opts = {}) {
  const p = Math.max(0.02, Math.min(1, power));
  const dl = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / dl, dz = dirZ / dl;
  const perpX = -dz, perpZ = dx;          // +90° from the aim direction = "right"

  const maxOff = opts.maxOffset === undefined ? 0.80 : opts.maxOffset;
  let ts = Math.max(-1, Math.min(1, tipSide || 0));
  let tv = Math.max(-1, Math.min(1, tipVert || 0));
  const mag = Math.hypot(ts, tv);
  if (mag > 1) { ts /= mag; tv /= mag; }

  let offSide = ts * R * maxOff;          // world horizontal, perpendicular to aim
  let offVert = tv * R * maxOff;          // world vertical (+y = top of the ball)

  // Miscue limit. The cue can only drive the ball along the stick line while
  // static friction at the tip holds: the required coefficient is tanφ, where
  // φ is the angle between the stick line and the contact radius, so
  //   β = |o|/R ≤ µ/√(1+µ²).
  // Past that the tip slides off the ball — a real miscue: a weak, off-line hit.
  const betaMax = PHYS.MU_TIP / Math.sqrt(1 + PHYS.MU_TIP * PHYS.MU_TIP);
  let off = Math.hypot(offSide, offVert);
  let miscue = false;
  if (off > betaMax * R) {
    miscue = true;
    const k = (betaMax * R) / off;
    offSide *= k; offVert *= k; off = betaMax * R;
  }
  const depth = Math.sqrt(Math.max(1e-9, R * R - offSide * offSide - offVert * offVert));

  // world-space offset of the tip from the ball centre
  const ox = perpX * offSide;
  const oy = offVert;
  const oz = perpZ * offSide;

  const speed = PHYS.CUE_MAX_SPEED * PHYS.CUE_EFF * p;
  return {
    dirX: dx, dirZ: dz, speed, ox, oy, oz,
    // contact point on the sphere, relative to the centre
    cx: ox - dx * depth, cy: oy, cz: oz - dz * depth,
    depth, tipSide: ts, tipVert: tv,
    offset: off / R, miscue,
  };
}

// ── geometry queries used by guides, AI and ball-in-hand ────────────────────

/**
 * Ray-march the cue ball along `dir` and report what it hits first.
 * @returns {kind:'ball'|'cushion'|'none', ...}
 */
export function castCue(balls, fromX, fromZ, dirX, dirZ, opts = {}) {
  const dl = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / dl, dz = dirZ / dl;
  // ignore may be a single ball number or a list (the AI casts from object balls)
  const ig = opts.ignore === undefined ? 0 : opts.ignore;
  const ignore = ig instanceof Set ? ig : (Array.isArray(ig) ? new Set(ig) : new Set([ig]));
  const maxDist = opts.maxDist || 8;
  let best = null;
  const keep = (cand) => { if (!best || cand.t < best.t) best = cand; };

  for (const b of balls) {
    if (!b || b.state !== 'table' || ignore.has(b.n)) continue;
    const ex = b.x - fromX, ez = b.z - fromZ;
    const proj = ex * dx + ez * dz;
    if (proj <= 0) continue;
    const perp2 = ex * ex + ez * ez - proj * proj;
    const rr = BALL.D;
    if (perp2 > rr * rr) continue;
    const t = proj - Math.sqrt(rr * rr - perp2);
    // t ≈ 0 means the cue ball is frozen to this ball — that IS the answer, so
    // only negative t (behind us) is rejected
    if (t < -1e-9 || t > maxDist) continue;
    keep({ kind: 'ball', t, ball: b.n, gx: fromX + dx * t, gz: fromZ + dz * t,
           hx: fromX + dx * t, hz: fromZ + dz * t });
  }

  for (const c of CUSHIONS) {
    const denom = dx * c.nx + dz * c.nz;
    if (denom >= -1e-6) continue;
    const plane = c.ax * c.nx + c.az * c.nz;
    const t = (plane + R - (fromX * c.nx + fromZ * c.nz)) / denom;
    if (t <= 1e-6 || t > maxDist) continue;
    const hx = fromX + dx * t, hz = fromZ + dz * t;
    const ex = c.bx - c.ax, ez = c.bz - c.az;
    const s = ((hx - c.ax) * ex + (hz - c.az) * ez) / (ex * ex + ez * ez);
    if (s < -0.02 || s > 1.02) continue;
    keep({ kind: 'cushion', t, hx, hz, gx: hx, gz: hz, nx: c.nx, nz: c.nz });
  }

  // pocket mouths — a path that ends in a pocket is the useful answer for guides
  for (const p of POCKETS) {
    const ex = p.x - fromX, ez = p.z - fromZ;
    const proj = ex * dx + ez * dz;
    if (proj <= 0) continue;
    const rr = p.r + R * 0.55;
    const perp2 = ex * ex + ez * ez - proj * proj;
    if (perp2 > rr * rr) continue;
    const t = proj - Math.sqrt(Math.max(0, rr * rr - perp2));
    if (t < -1e-9 || t > maxDist) continue;
    keep({ kind: 'pocket', t, pocket: p.id, hx: fromX + dx * t, hz: fromZ + dz * t,
           gx: fromX + dx * t, gz: fromZ + dz * t });
  }

  if (!best) best = { kind: 'none', t: maxDist, hx: fromX + dx * maxDist, hz: fromZ + dz * maxDist };
  best.dx = dx; best.dz = dz;
  return best;
}

/** Full aiming solution: cue path → ghost ball → object-ball path → pocket score. */
export function predictShot(balls, cueX, cueZ, dirX, dirZ, opts = {}) {
  const hit = castCue(balls, cueX, cueZ, dirX, dirZ, opts);
  const out = { hit, cue: { x0: cueX, z0: cueZ, x1: hit.gx !== undefined ? hit.gx : hit.hx, z1: hit.gz !== undefined ? hit.gz : hit.hz } };
  if (hit.kind !== 'ball') {
    out.object = null;
    if (hit.kind === 'cushion') {
      const d = hit.dx * -2 * hit.nx * 0 + hit.dx;
      const e = hit.dz;
      const rx = d - 2 * (d * hit.nx + e * hit.nz) * hit.nx;
      const rz = e - 2 * (d * hit.nx + e * hit.nz) * hit.nz;
      out.bounce = { x: hit.hx, z: hit.hz, dx: rx, dz: rz };
      const second = castCue(balls, hit.hx, hit.hz, rx, rz, { ignore: 0, maxDist: 3.2 });
      out.bounce2 = { x: second.gx !== undefined ? second.gx : second.hx, z: second.gz !== undefined ? second.gz : second.hz };
    }
    return out;
  }
  const tb = balls[hit.ball];
  const gx = hit.gx, gz = hit.gz;
  let nx = tb.x - gx, nz = tb.z - gz;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  // ghost-ball → pocket lines
  const pockets = [];
  for (const p of POCKETS) {
    let px = p.x - tb.x, pz = p.z - tb.z;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;
    const cut = Math.acos(Math.max(-1, Math.min(1, px * nx + pz * nz)));
    const clear = castCue(balls, tb.x, tb.z, px, pz, { ignore: tb.n, maxDist: pl });
    const blocked = clear.kind === 'ball' && clear.t < pl - R;
    pockets.push({
      id: p.id, x: p.x, z: p.z, cut, dist: pl, blocked,
      score: blocked ? 0 : Math.max(0, Math.cos(cut)) ** 2.1 * (1 / (0.35 + pl)),
    });
  }
  pockets.sort((a, b) => b.score - a.score);
  out.object = { n: tb.n, x: tb.x, z: tb.z, nx, nz, tx: -nz, tz: nx, pockets };
  out.ghost = { x: gx, z: gz };
  // cue ball deflection direction after contact (tangent line, for the guide)
  const tdot = hit.dx * (-nz) + hit.dz * nx;
  out.cueAfter = { x: gx, z: gz, dx: -nz * tdot, dz: nx * tdot, cut: Math.acos(Math.max(-1, Math.min(1, hit.dx * nx + hit.dz * nz))) };
  return out;
}

export { TABLE, BALL, PHYS, POCKETS, CUSHIONS, JAWS, HL, HW, M, R, I, rackPositions, rack9 };
