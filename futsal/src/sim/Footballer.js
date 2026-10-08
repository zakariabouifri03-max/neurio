// Footballer: the shared body used by humans, AI outfielders and goalkeepers.
// Holds attributes, physical state (position/velocity/stamina) and action timers.
// Movement is an acceleration-limited velocity approach toward a desired velocity.
import { PLAYER } from '../config.js';
import { clamp, len2 } from '../core/math.js';

export class Footballer {
  constructor({ id, teamIndex, number, name, role, slot, attrs }) {
    this.id = id;
    this.teamIndex = teamIndex;
    this.number = number;
    this.name = name;
    this.role = role;              // 'GK' | 'DEF' | 'MID' | 'FWD'
    this.slot = slot;              // formation slot index (-1 for GK)
    this.attrs = attrs;

    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.heading = 0;              // radians, atan2(z, x)
    this.desired = { x: 0, z: 0 }; // desired velocity (XZ) set by controller / AI
    this.wantSprint = false;
    this.sprinting = false;
    this.stamina = 1;
    this.fatigue = 0;

    this.human = false;
    this.visible = true;
    this.skillSide = 1;
    this.tackleKind = null;
    this.tackleDir = null;
    this.tackleDone = false;
    this.sentOff = false;
    this.walkOff = false;
    this.yellow = 0;
    this.homePos = { x: 0, z: 0 }; // formation anchor (updated each think)

    // action timers (seconds remaining)
    this.kickCD = 0;       // cannot re-capture ball for this long after kicking it
    this.tackleT = 0;      // tackle lunge active
    this.slideT = 0;       // slide (sprint tackle) active
    this.downT = 0;        // fallen
    this.celebrateT = 0;
    this.diveT = 0;        // goalkeeper dive
    this.diveVel = { x: 0, z: 0 };
    this.diveDir = 0;      // -1 .. 1 across goal
    this.kickAnimT = 0;
    this.skillT = 0;       // feint / skill animation
    this.stunT = 0;        // reacting to a feint
    this.blockT = 0;       // AI forced into shot path
    this.blockTarget = null;
    this.pressCommandT = 0;
    this.thinkT = Math.random() * 0.2;
    this.lastCaptureT = -9;
    this.restartTarget = null;
    this.reactT = 0;       // reaction timer for goalkeeper / AI
    this.phase = Math.random() * 10;   // animation phase accumulator
    this.distanceRun = 0;
    this.touches = 0;
    this.ballTime = 0;     // seconds in possession (drives forced passes)
    this.tackleCD = 0;     // AI tackle cooldown
    this.faceTo = null;    // optional facing override (heading) when idle
  }

  static overall(p) {
    const a = p.attrs;
    if (p.role === 'GK') return Math.round(a.goalkeeping * 0.7 + a.reaction * 0.2 + a.speed * 0.1);
    return Math.round((a.speed + a.acceleration + a.shooting + a.passing + a.dribbling + a.strength + a.stamina + a.ballControl + a.defending + a.reaction) / 10);
  }

  get overall() {
    return Footballer.overall(this);
  }

  get label() {
    return `#${this.number} ${this.name}`;
  }

  // Base top speed for this player (m/s), before stamina and sprint.
  get runSpeed() {
    return PLAYER.baseRun + this.attrs.speed * PLAYER.speedPerPoint;
  }

  get accel() {
    return 7 + this.attrs.acceleration * 0.1;
  }

  maxSpeed(sprint) {
    const stamFactor = 0.72 + 0.28 * this.stamina;
    const base = this.runSpeed * stamFactor;
    return sprint && this.stamina > 0.05 ? base * PLAYER.sprintMult : base;
  }

  get isDown() {
    return this.downT > 0;
  }

  get isActive() {
    return !this.sentOff && !this.walkOff;
  }

  // Dive / slide overrides normal steering.
  get isLocked() {
    return this.diveT > 0 || this.downT > 0;
  }

  setDesired(x, z, sprint = false) {
    this.desired.x = x;
    this.desired.z = z;
    this.wantSprint = sprint;
  }

  // Advance body physics by dt. Ball handling happens in BallController / MatchManager.
  step(dt) {
    this.kickCD = Math.max(0, this.kickCD - dt);
    this.tackleT = Math.max(0, this.tackleT - dt);
    this.slideT = Math.max(0, this.slideT - dt);
    this.kickAnimT = Math.max(0, this.kickAnimT - dt);
    this.skillT = Math.max(0, this.skillT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.blockT = Math.max(0, this.blockT - dt);
    this.pressCommandT = Math.max(0, this.pressCommandT - dt);
    this.celebrateT = Math.max(0, this.celebrateT - dt);
    this.reactT = Math.max(0, this.reactT - dt);
    if (this.downT > 0) {
      this.downT = Math.max(0, this.downT - dt);
      this.vel.x *= Math.exp(-6 * dt);
      this.vel.z *= Math.exp(-6 * dt);
    } else if (this.diveT > 0) {
      this.diveT = Math.max(0, this.diveT - dt);
      this.vel.x = this.diveVel.x;
      this.vel.z = this.diveVel.z;
      this.vel.y = 0;
      // dive hits the ground: slow down quickly after the dive window
      if (this.diveT <= 0.15) {
        this.vel.x *= 0.3;
        this.vel.z *= 0.3;
      }
    } else if (this.slideT > 0) {
      this.vel.x *= Math.exp(-2.4 * dt);
      this.vel.z *= Math.exp(-2.4 * dt);
    } else if (this.tackleT > 0) {
      // lunge keeps momentum
      this.vel.x *= Math.exp(-3 * dt);
      this.vel.z *= Math.exp(-3 * dt);
    } else {
      const sprint = this.wantSprint && this.stamina > 0.05;
      const maxV = this.maxSpeed(sprint) * (this.stunT > 0 ? 0.55 : 1);
      let tx = this.desired.x, tz = this.desired.z;
      const tl = Math.hypot(tx, tz);
      if (tl > 1) { tx /= tl; tz /= tl; }
      tx *= maxV; tz *= maxV;
      const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
      const dv = Math.hypot(dvx, dvz);
      const maxDv = this.accel * dt * (this.stunT > 0 ? 0.5 : 1);
      if (dv > maxDv && dv > 1e-9) {
        this.vel.x += (dvx / dv) * maxDv;
        this.vel.z += (dvz / dv) * maxDv;
      } else {
        this.vel.x = tx;
        this.vel.z = tz;
      }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.vel.y = 0;

    const speed = len2(this.vel);
    if (speed > 0.6) {
      this.heading = Math.atan2(this.vel.z, this.vel.x);
    } else if (this.faceTo !== null) {
      this.heading = this.faceTo;
    }
    this.phase += speed * dt * 1.15;
    this.distanceRun += speed * dt;

    // stamina
    const sprinting = this.wantSprint && speed > 4.5 && this.stamina > 0.05 && this.downT <= 0;
    this.sprinting = sprinting;
    const a = this.attrs.stamina;
    if (sprinting) {
      this.stamina -= PLAYER.stamDrainSprint * dt * (1.25 - (a / 100) * 0.6);
    } else if (speed < 2.2) {
      this.stamina += PLAYER.stamRecoverIdle * dt * (0.6 + a / 200);
    } else {
      this.stamina += PLAYER.stamRecoverWalk * dt * (0.6 + a / 200);
    }
    this.stamina = clamp(this.stamina, 0, 1);
  }

  // Put the body in a fallen state for `t` seconds.
  fall(t = PLAYER.downTime) {
    this.downT = Math.max(this.downT, t);
    this.desired.x = 0;
    this.desired.z = 0;
  }

  reset(x, z, heading = 0) {
    this.pos.x = x;
    this.pos.z = z;
    this.vel.x = 0;
    this.vel.z = 0;
    this.desired.x = 0;
    this.desired.z = 0;
    this.heading = heading;
    this.faceTo = heading;
    this.downT = 0;
    this.tackleT = 0;
    this.slideT = 0;
    this.diveT = 0;
    this.stunT = 0;
    this.blockT = 0;
    this.kickCD = 0;
    this.restartTarget = null;
  }
}

