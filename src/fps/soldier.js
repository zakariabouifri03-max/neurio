// ── WARFRONT · soldiers: procedural bodies + squad AI ───────────────────────
// Both teams run the same brain: sight + hearing -> target choice, A* movement,
// engagement ranges, strafing, real cover use, burst discipline, reloads.

import * as THREE from 'three';
import { clamp, lerp, damp, angDiff, approachAngle, dist, RNG, boxAdd, losClear, rayBox } from './util.js';

const TEAMS = {
  irf: { uniform: 0x53604a, vest: 0x2f3a2c, skin: 0xb98a68, accent: 0x2e6fd8, name: 'IRF' },
  opfor: { uniform: 0x6c5a3e, vest: 0x40372a, skin: 0xa8795a, accent: 0xc0392b, name: 'OPFOR' },
};

const W = new THREE.Object3D();
// parts are reused across every soldier — spawning must not allocate geometry
const GEO = new Map();
function boxGeo(w, h, d) {
  const k = w + '_' + h + '_' + d;
  let g = GEO.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); GEO.set(k, g); }
  return g;
}
function b(w, h, d, mat) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.castShadow = true;
  return m;
}
const MATS = new Map();
function skinMat(c, r = .85, mt = .05) {
  const k = c + '|' + r + '|' + mt;
  let m = MATS.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt, flatShading: true }); MATS.set(k, m); }
  return m;
}

/** build a stylised soldier; returns { root, parts } */
export function buildSoldier(team, detail = 1) {
  const T = TEAMS[team] || TEAMS.opfor;
  const mat = (c, r = .85, mt = .05) => skinMat(c, r, mt);
  const mUni = mat(T.uniform), mVest = mat(T.vest, .9), mSkin = mat(T.skin, 1), mBoot = mat(0x22201d, .8),
    mMetal = mat(0x3a3d40, .5, .7), mStrap = mat(0x2a2620, .95);
  // team identifier: readable at range without breaking the military look
  const mAcc = new THREE.MeshStandardMaterial({
    color: T.accent, roughness: .45, metalness: .1, flatShading: true,
    emissive: new THREE.Color(T.accent), emissiveIntensity: .55,
  });

  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = .93; root.add(hips);
  const chest = new THREE.Group(); chest.position.y = .3; hips.add(chest);
  const torso = b(.56, .62, .34, mUni); torso.position.y = .02; chest.add(torso);
  const vest = b(.6, .44, .4, mVest); vest.position.y = .06; chest.add(vest);
  const plate = b(.34, .26, .06, mAcc); plate.position.set(0, .1, -.22); chest.add(plate);
  for (let i = 0; i < 2; i++) {
    const p = b(.14, .12, .07, mStrap); p.position.set(-.14 + i * .28, -.14, -.22); chest.add(p);
  }
  const belt = b(.58, .1, .38, mStrap); belt.position.y = -.3; hips.add(belt);
  // neck + head + helmet
  const neck = new THREE.Group(); neck.position.set(0, .4, 0); chest.add(neck);
  const head = b(.24, .27, .26, mSkin); head.position.y = .16; neck.add(head);
  const jaw = b(.2, .08, .22, mSkin); jaw.position.set(0, .04, -.01); neck.add(jaw);
  const helm = b(.3, .15, .32, mVest); helm.position.y = .34; neck.add(helm);
  const brim = b(.34, .05, .38, mVest); brim.position.set(0, .28, -.02); neck.add(brim);
  const goggles = b(.22, .05, .04, mMetal); goggles.position.set(0, .2, -.14); neck.add(goggles);
  // arms — gun-holding pose, animated
  const armL = new THREE.Group(); armL.position.set(-.33, .2, 0); chest.add(armL);
  const armR = new THREE.Group(); armR.position.set(.33, .2, 0); chest.add(armR);
  const upL = b(.14, .4, .14, mUni); upL.position.y = -.2; armL.add(upL);
  const upR = b(.14, .4, .14, mUni); upR.position.y = -.2; armR.add(upR);
  const foreL = new THREE.Group(); foreL.position.set(0, -.4, 0); armL.add(foreL);
  const foreR = new THREE.Group(); foreR.position.set(0, -.4, 0); armR.add(foreR);
  const foL = b(.12, .38, .12, mUni); foL.position.y = -.19; foreL.add(foL);
  const foR = b(.12, .38, .12, mUni); foR.position.y = -.19; foreR.add(foR);
  const handL = b(.1, .1, .12, mBoot); handL.position.y = -.4; foreL.add(handL);
  const handR = b(.1, .1, .12, mBoot); handR.position.y = -.4; foreR.add(handR);
  // legs
  const legL = new THREE.Group(); legL.position.set(-.15, -.32, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(.15, -.32, 0); hips.add(legR);
  const thL = b(.18, .46, .2, mUni); thL.position.y = -.23; legL.add(thL);
  const thR = b(.18, .46, .2, mUni); thR.position.y = -.23; legR.add(thR);
  const shinL = new THREE.Group(); shinL.position.set(0, -.46, 0); legL.add(shinL);
  const shinR = new THREE.Group(); shinR.position.set(0, -.46, 0); legR.add(shinR);
  const shL = b(.15, .42, .17, mUni); shL.position.y = -.21; shinL.add(shL);
  const shR = b(.15, .42, .17, mUni); shR.position.y = -.21; shinR.add(shR);
  const ftL = b(.17, .1, .3, mBoot); ftL.position.set(0, -.44, -.05); shinL.add(ftL);
  const ftR = b(.17, .1, .3, mBoot); ftR.position.set(0, -.44, -.05); shinR.add(ftR);

  // weapon in hands
  const gun = new THREE.Group();
  gun.position.set(-.06, .02, -.36);
  chest.add(gun);
  const gm = mat(0x2c2f33, .5, .6);
  const gbody = b(.09, .12, .5, gm); gun.add(gbody);
  const gbar = b(.05, .05, .34, mMetal); gbar.position.set(0, .01, -.4); gun.add(gbar);
  const gmag = b(.06, .16, .08, gm); gmag.position.set(0, -.13, -.06); gun.add(gmag);
  const gstock = b(.06, .1, .22, gm); gstock.position.set(0, -.02, .26); gun.add(gstock);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, .02, -.58); gun.add(muzzle);
  // backpack
  const pack = b(.4, .34, .18, mStrap); pack.position.set(0, .06, .26); chest.add(pack);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = detail > .5;
      o.receiveShadow = false;
      if (detail < .6 && o.geometry && o.geometry.type === 'BoxGeometry') {
        const p = o.geometry.parameters;
        if (p && p.width <= .13 && p.height <= .13) o.visible = false;   // drop tiny clutter on low detail
      }
    }
  });

  return {
    root, parts: { hips, chest, neck, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, gun, muzzle, vest, torso },
    mats: [mUni, mVest, mSkin, mBoot, mAcc, mMetal, mStrap],
  };
}

// ── AI soldier ───────────────────────────────────────────────────────────────
let UID = 1;

export class Soldier {
  constructor(game, team, cls) {
    this.game = game;
    this.id = UID++;
    this.team = team;                     // 'irf' (friendly) | 'opfor' (hostile)
    this.cls = cls;                       // class def below
    const built = buildSoldier(team, game.detail);
    this.obj = built.root;
    this.parts = built.parts;
    this.mats = built.mats;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.aimPitch = 0;
    this.hp = cls.hp;
    this.maxHp = cls.hp;
    this.dead = false;
    this.deadT = 0;
    this.state = 'advance';
    this.target = null;
    this.lastSeen = -99;
    this.lastKnown = new THREE.Vector3();
    this.path = null;
    this.pathI = 0;
    this.rePath = 0;
    this.senseT = Math.random() * .3;
    this.strafeDir = Math.random() < .5 ? -1 : 1;
    this.strafeT = 0;
    this.fireT = 0;
    this.burst = 0;
    this.aimErr = new THREE.Vector2();
    this.reloadT = 0;
    this.mag = cls.mag;
    this.crouch = 0;
    this.animPhase = Math.random() * 6;
    this.spawnT = .55;
    this.speed = 0;
    this.alert = 0;
    this.coverCd = 0;
    this.coverPt = null;
    this.grenadeCd = 8 + Math.random() * 12;
    this.stuck = 0;
    this.flinch = 0;
    this.muzzleT = 0;
    this.stepPhase = Math.random();
    this.marked = 0;                      // minimap ping timer
    this.acquireT = -99;                  // when the target was first spotted
    this.kills = 0; this.deaths = 0;
    this.rng = new RNG((game.tickCount * 977 + UID * 31) | 0);
  }

  get radius() { return .38; }
  height() { return this.dead ? .5 : (1.82 - this.crouch * .48); }
  chest(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height() * .74, this.pos.z); }
  headPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height() * .95 + .04, this.pos.z); }
  eyePos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.height() * .88, this.pos.z); }

  /** axis-aligned hitboxes (approximation of the rotating body) */
  boxes() {
    const h = this.height(), y = this.pos.y, w = .62;
    return [
      { part: 'head', dmg: 2.5, b: boxAdd(null, this.pos.x, this.pos.z, .34, .34, y + h * .87, y + h * 1.0) },
      { part: 'chest', dmg: 1, b: boxAdd(null, this.pos.x, this.pos.z, w, .48, y + h * .46, y + h * .87) },
      { part: 'legs', dmg: .68, b: boxAdd(null, this.pos.x, this.pos.z, .5, .44, y, y + h * .46) },
    ];
  }

  spawnAt(x, z, yaw) {
    this.pos.set(x, this.game.world.groundAt(x, z, this.radius, 40, 40) || 0, z);
    this.yaw = yaw || 0;
    this.spawnT = .55;
    this.hp = this.maxHp;
    this.mag = this.cls.mag;
    this.vel.set(0, 0, 0);
    this.obj.visible = true;
    this.obj.position.copy(this.pos);
    this.obj.scale.setScalar(1);
    this.parts.chest.position.y = .3;
  }

  damage(amount, part, hitPos, byPlayer) {
    if (this.dead) return false;
    const mult = part === 'head' ? 2.5 : part === 'legs' ? .68 : 1;
    const dmg = amount * mult;
    this.hp -= dmg;
    this.flinch = .22;
    if (byPlayer) this.game.fx.bloodHit(hitPos, new THREE.Vector3(0, 1, 0), mult > 2);
    this.alert = 6;
    // being shot makes you look for cover / return fire
    if (!this.target || this.game.time - this.lastSeen > 1.2) {
      if (hitPos) { this.lastKnown.copy(hitPos); this.alert = 8; if (this.state === 'advance' || this.state === 'patrol') this.state = 'search'; }
    }
    if (this.hp <= 0) { this.kill(hitPos, byPlayer, part); return true; }
    return false;
  }

  kill(hitPos, byPlayer, part) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.state = 'dead';
    this.game.onSoldierKilled(this, byPlayer, part, hitPos);
  }

  // ── perception ───────────────────────────────────────────────────────────
  acquire() {
    const g = this.game, w = g.world;
    const hadTarget = !!this.target;
    const eye = this.eyePos(new THREE.Vector3());
    const cands = [];
    if (this.team === 'opfor') cands.push({ p: g.player, kind: 'player' });
    for (const s of g.soldiers) {
      if (s === this || s.dead) continue;
      if (s.team === this.team) continue;
      cands.push({ p: s, kind: 'soldier' });
    }
    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const tp = c.kind === 'player' ? c.p.chestPos(new THREE.Vector3()) : c.p.chest(new THREE.Vector3());
      const d = tp.distanceTo(eye);
      if (d > this.cls.view) continue;
      const dirTo = W.position.copy(tp).sub(eye).normalize();
      const fwd = W.position.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); // model forward is -Z
      const dot = dirTo.x * fwd.x + dirTo.z * fwd.z;
      const inCone = dot > -0.25;                              // ~210° peripheral
      if (!inCone && d > 18) continue;                          // point blank, they hear you
      if (!w.losTo(eye, tp)) continue;
      let score = -d + (dot - 1) * -6 + (c.kind === 'player' ? 14 : 0) + (1 - clamp(d / this.cls.view, 0, 1)) * 30;
      if (!inCone) score -= 40;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best) {
      if (!hadTarget) this.acquireT = g.time;
      const p = best.kind === 'player' ? best.p.chestPos(new THREE.Vector3()) : best.p.chest(new THREE.Vector3());
      if (this.target !== best.p) {
        if (this.target === null && this.state !== 'engage') this.game.say(this, this.rng.pick(this.team === 'opfor' ? ['Contact!', 'Enemy spotted!', 'Contact left!'] : ['Contact!', 'Moving up!', 'Got eyes on!']));
      }
      this.target = best.p;
      this.targetKind = best.kind;
      this.lastSeen = g.time;
      this.lastKnown.copy(p);
      this.alert = 6;
      if (this.state !== 'engage' && this.state !== 'strafe' && this.state !== 'cover') this.state = 'engage';
    } else if (this.target) {
      if (g.time - this.lastSeen > (this.targetKind === 'player' ? 4.2 : 3)) {
        this.target = null;
        if (this.state === 'engage' || this.state === 'strafe' || this.state === 'cover') this.state = 'search';
      }
    }
  }

  hear(x, z, loud) {
    if (this.dead) return;
    const d = dist(x, z, this.pos.x, this.pos.z);
    if (d > loud) return;
    if (this.target) return;
    this.lastKnown.set(x, this.pos.y, z);
    this.alert = Math.max(this.alert, 4);
    if (this.state === 'advance' || this.state === 'patrol') this.state = 'search';
  }

  // ── navigation ───────────────────────────────────────────────────────────
  needPath(tx, tz) {
    const g = this.game;
    if (this.rePath > 0 && this.path) return;
    if (g.pathTokens <= 0) return;
    this.path = g.world.path(this.pos.x, this.pos.z, tx, tz);
    this.pathI = 0;
    this.rePath = .55 + this.rng.next() * .7;
    g.pathTokens--;
  }

  followPath(dt) {
    if (!this.path || this.pathI >= this.path.length) return false;
    const wpt = this.path[this.pathI];
    const d = dist(wpt.x, wpt.z, this.pos.x, this.pos.z);
    if (d < 1.15) {
      this.pathI++;
      if (this.pathI >= this.path.length) { this.path = null; return false; }
      return true;
    }
    const ang = Math.atan2(-(wpt.x - this.pos.x), -(wpt.z - this.pos.z));
    this.moveToward(dt, ang, this.stateTargetSpeed());
    // unstick
    if (this.speed < .6) {
      this.stuck += dt;
      if (this.stuck > .5) {
        this.stuck = 0;
        this.rePath = 0;
        this.path = null;
        // sidestep for half a second
        this.strafeDir = this.rng.sign();
        this.detour = .5 + this.rng.next() * .5;
      }
    } else this.stuck = Math.max(0, this.stuck - dt);
    return true;
  }

  stateTargetSpeed() {
    if (this.reloadT > 0 && this.state !== 'cover') return this.cls.speed * .35;
    return this.cls.speed;
  }

  moveToward(dt, ang, speed) {
    const turn = 7.5;
    this.yaw = approachAngle(this.yaw, ang, turn * dt);
    const diff = Math.abs(angDiff(this.yaw, ang));
    const eff = speed * (1 - clamp(diff / Math.PI, 0, 1) * .55);
    const wx = Math.sin(this.yaw) * -1, wz = Math.cos(this.yaw) * -1;
    this.vel.x = wx * eff;
    this.vel.z = wz * eff;
    if (this.detour > 0) {
      this.detour -= dt;
      this.vel.x += Math.cos(this.yaw) * this.strafeDir * eff * .8;
      this.vel.z += -Math.sin(this.yaw) * this.strafeDir * eff * .8;
    }
  }

  resolve(dt) {
    const w = this.game.world;
    const r = this.radius, h = this.height();
    const p = this.pos;
    const nx = p.x + this.vel.x * dt, nz = p.z + this.vel.z * dt;
    let bx = false, bz = false;
    const blockedAt = (x, z) => w.solidAt(x, p.y, z, r, h);
    if (!blockedAt(nx, p.z)) p.x = nx; else bx = true;
    if (!blockedAt(p.x, nz)) p.z = nz; else bz = bx ? true : bz;
    // separation from nearby teammates
    for (const o of this.game.soldiers) {
      if (o === this || o.dead) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = (1.2 - d) * .5;
        p.x += (dx / d) * push; p.z += (dz / d) * push;
      }
    }
    w.clampToArena(p);
    // gravity / step
    const prevY = p.y;
    this.vel.y -= 25.5 * dt;
    p.y += this.vel.y * dt;
    const gy = w.groundAt(p.x, p.z, r, prevY, p.y);
    const sup = gy < 0 ? 0 : gy;
    if (p.y <= sup + .001 && this.vel.y <= 0) {
      if (prevY - sup > 2.2 && this.game.fx) {
        this.game.fx.dustPuff(p, 1.1);
        if (this.game.diff.fallDmg) this.hp -= (prevY - sup - 2.2) * 9;
        if (this.hp <= 0) { this.kill(null, false, 'fall'); }
      }
      p.y = sup; this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
    if (p.y < -2) { p.y = 0; this.vel.y = 0; }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    void bx; void bz;
  }

  // ── combat ───────────────────────────────────────────────────────────────
  tryShoot(dt) {
    const g = this.game;
    if (!this.target || this.target.dead) return;
    if (this.reloadT > 0) return;
    const from = this.eyePos(new THREE.Vector3());
    const to = this.targetKind === 'player' ? this.target.chestPos(new THREE.Vector3()) : this.target.chest(new THREE.Vector3());
    const d = from.distanceTo(to);
    if (d > this.cls.range) return;
    // aim smoothing + error
    this.aimErr.x = damp(this.aimErr.x, 0, 2.2, dt);
    this.aimErr.y = damp(this.aimErr.y, 0, 2.2, dt);
    if (this.fireT > 0) { this.fireT -= dt; return; }
    if (this.mag <= 0) {
      this.reloadT = this.cls.reload * this.rng.range(.9, 1.35);
      g.audio.reloadAt(this.pos, .35);
      return;
    }
    const aimSkill = this.cls.skill * g.diff.skill;
    const movePen = clamp(this.speed / 6, 0, 1) * .9 + (1 - clamp(this.crouch, 0, 1)) * .25;
    // angular error of the aim solution, in radians
    const errAng = clamp((d * .0016 + .011) * (1 + movePen) / aimSkill, .004, .075);
    // reaction time: they do not snap onto you instantly
    const reacted = clamp((g.time - this.acquireT) / .45, 0, 1);
    if (this.burst <= 0) {
      this.burst = this.rng.int(2, this.cls.burst);
      this.aimErr.set(this.rng.n() * errAng * 2.4 / (0.3 + reacted * .7), this.rng.n() * errAng * 2.0 / (0.3 + reacted * .7));
    }
    this.burst--;
    this.fireT = 60 / this.cls.rpm * (this.burst > 0 ? 1 : 1) + (this.burst > 0 ? 0 : this.rng.range(.35, 1.15));
    this.mag--;
    this.muzzleT = .05;
    g.noiseAt(this.pos.x, this.pos.z, 34);
    g.audio.shotAt(this.cls.sound, this.pos, d);
    // hit test
    const dir = to.clone().sub(from).normalize();
    dir.x += this.aimErr.x * .5 + this.rng.n() * errAng * .45;
    dir.y += this.aimErr.y * .4 + this.rng.n() * errAng * .4;
    dir.z += this.rng.n() * errAng * .45;
    dir.normalize();
    const hit = g.traceShot(from, dir, 200, this);
    const muzzleW = this.parts.muzzle.getWorldPosition(new THREE.Vector3());
    g.fx.tracer(muzzleW, hit.point, .035, .06);
    g.fx.muzzleFlash(muzzleW, dir, .9);
    if (hit.kind === 'world') g.fx.impact(hit.point, hit.normal, hit.mat || 'concrete');
    else if (hit.kind === 'player' || (hit.soldier && hit.soldier.team !== this.team)) {
      if (hit.kind === 'player') {
        const mult = hit.part === 'head' ? 2.2 : hit.part === 'legs' ? .7 : 1;
        g.player.damage(Math.round(this.cls.dmg * mult * g.diff.dmgMul), this.pos, 'bullet');
        g.markTracerHit(this.pos);
      } else if (hit.soldier) {
        hit.soldier.damage(this.cls.dmg * g.diff.aiDmg * (this.team === 'irf' ? 1.15 : 1), hit.part, hit.point, false);
      }
    }
  }

  throwGrenade() {
    const g = this.game;
    if (!this.target) return;
    const from = this.eyePos(new THREE.Vector3());
    const to = this.targetKind === 'player' ? g.player.chestPos(new THREE.Vector3()) : this.target.chest(new THREE.Vector3());
    const d = from.distanceTo(to);
    const t = clamp(d / 11, .5, 1.5);
    const dir = to.clone().sub(from);
    const vel = new THREE.Vector3(dir.x / t, dir.y / t + 4.6 * t * .9, dir.z / t);
    g.grenades.push({
      pos: from.clone().addScaledVector(dir.clone().normalize(), .5), vel, fuse: 2.4,
      owner: this, dmg: 92 * g.diff.dmgMul, radius: 7.2, spin: 0, enemy: true,
    });
    this.say('Grenade out!');
    g.audio.nadeThrow();
  }

  say(txt) { this.game.say(this, txt); }

  // ── brain ────────────────────────────────────────────────────────────────
  think(dt) {
    const g = this.game;
    this.alert = Math.max(0, this.alert - dt);
    this.senseT -= dt;
    if (this.senseT <= 0) { this.senseT = .1 + this.rng.next() * .12; this.acquire(); }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.mag = this.cls.mag; g.audio.reloadAt(this.pos, .3); }
    }
    this.rePath = Math.max(0, this.rePath - dt);
    this.coverCd = Math.max(0, this.coverCd - dt);
    this.grenadeCd = Math.max(0, this.grenadeCd - dt);
    this.strafeT -= dt;

    const t = this.target;
    const tAlive = t && !t.dead;
    if (tAlive && g.time - this.lastSeen > (this.cls.view > 55 ? 4.5 : 3.4)) { this.state = 'search'; }

    switch (this.state) {
      case 'engage':
      case 'strafe':
      case 'cover': this.combatBehaviour(dt); break;
      case 'search': {
        const d = dist(this.pos.x, this.pos.z, this.lastKnown.x, this.lastKnown.z);
        if (d < 1.6 || this.alert <= 0) { this.state = tAlive ? 'engage' : 'advance'; this.alert = 0; break; }
        this.needPath(this.lastKnown.x, this.lastKnown.z);
        if (!this.followPath(dt)) {
          const ang = Math.atan2(-(this.lastKnown.x - this.pos.x), -(this.lastKnown.z - this.pos.z));
          this.moveToward(dt, ang, this.cls.speed * .9);
        }
        break;
      }
      case 'patrol':
      case 'advance': {
        // push toward the objective / the player's general area
        const goal = g.aiObjective(this);
        const d = dist(this.pos.x, this.pos.z, goal.x, goal.z);
        if (d > 2.2) {
          this.needPath(goal.x, goal.z);
          if (!this.followPath(dt)) {
            const ang = Math.atan2(-(goal.x - this.pos.x), -(goal.z - this.pos.z));
            this.moveToward(dt, ang, this.cls.speed * .82);
          }
        } else {
          this.yaw += Math.sin(g.time * .6 + this.id) * dt * .6;
          this.vel.x = this.vel.z = 0;
          if (this.rng.chance(.006)) { this.pickNewPatrol(); }
        }
        break;
      }
      case 'dead': break;
    }

    // grenade avoidance
    for (const n of g.grenades) {
      if (n.enemy === (this.team === 'opfor')) continue;
      const dd = dist(n.pos.x, n.pos.z, this.pos.x, this.pos.z);
      if (dd < 7 && n.fuse < 1.6) {
        const away = Math.atan2(-(this.pos.x - n.pos.x), -(this.pos.z - n.pos.z));
        this.moveToward(dt, away, this.cls.speed * 1.25);
        if (dd < 4.5 && this.rng.chance(.02)) this.say('Grenade! Move!');
      }
    }
  }

  pickNewPatrol() {
    const s = this.game.world.spawns[this.rng.int(0, this.game.world.spawns.length - 1)];
    if (s) { this.lastKnown.set(s.x, this.pos.y, s.z); this.path = null; this.rePath = 0; }
  }

  combatBehaviour(dt) {
    const g = this.game;
    if (!this.target || this.target.dead) { this.state = 'search'; return; }
    const tp = this.targetKind === 'player' ? g.player.chestPos(new THREE.Vector3()) : this.target.chest(new THREE.Vector3());
    const d = this.pos.distanceTo(tp);
    const ideal = this.cls.ideal;
    const los = g.world.losTo(this.eyePos(new THREE.Vector3()), tp);
    const ang = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
    const eyeY = this.pos.y + this.height() * .88;
    this.aimPitch = damp(this.aimPitch, Math.atan2(tp.y - eyeY, Math.max(.5, Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z))), 7, dt);
    this.aimYawErr = angDiff(this.yaw, ang);

    // decide to use cover when hurt or suppressed
    const wantCover = (this.hp < this.maxHp * .45 || (this.reloadT > 0 && d > 12)) && this.coverCd <= 0 && !this.cls.camper;
    if (wantCover && this.state !== 'cover') {
      const cc = g.world.findCover(this.pos.x, this.pos.z, tp.x, tp.z, 9);
      if (cc) { this.coverPt = cc; this.state = 'cover'; this.coverCd = 6; this.path = null; this.rePath = 0; }
    }

    if (this.state === 'cover' && this.coverPt) {
      const dd = dist(this.pos.x, this.pos.z, this.coverPt.x, this.coverPt.z);
      if (dd < 1.1) {
        this.vel.x = this.vel.z = 0;
        this.yaw = approachAngle(this.yaw, ang, 4 * dt);
        this.crouch = damp(this.crouch, 1, 6, dt);
        if (this.reloadT > 0) this.reloadT -= dt * 1.3;
        if (dd < 1.1 && this.hp > this.maxHp * .6 && this.reloadT <= 0 && this.rng.chance(dt * .8)) { this.state = 'engage'; this.crouch = 0; }
      } else {
        this.needPath(this.coverPt.x, this.coverPt.z);
        if (!this.followPath(dt)) this.moveToward(dt, Math.atan2(-(this.coverPt.x - this.pos.x), -(this.coverPt.z - this.pos.z)), this.cls.speed);
      }
      if (los && this.fireT <= 0 && this.burst <= 0 && this.rng.chance(.3)) { this.burst = 2; }
      this.tryShoot(dt);
      return;
    }
    this.crouch = damp(this.crouch, this.cls.camper ? 1 : 0, 5, dt);

    // strafe timing
    if (this.strafeT <= 0) { this.strafeT = this.rng.range(.7, 2.1); this.strafeDir = this.rng.sign(); }
    if (this.state !== 'strafe' && this.rng.chance(dt * .5)) this.state = 'strafe';

    // range control
    let speed = this.cls.speed;
    if (!los) {
      this.needPath(tp.x, tp.z);
      this.followPath(dt) || this.moveToward(dt, ang, speed);
      this.state = this.state === 'strafe' ? 'engage' : this.state;
      this.tryShoot(dt);
      return;
    }
    let mvAng = ang;
    if (d > ideal * 1.5) { this.state = 'engage'; mvAng = ang; speed *= 1; }
    else if (d < ideal * .55) { mvAng = ang + Math.PI; speed *= .85; }
    else {
      mvAng = ang + this.strafeDir * Math.PI * .42;
      speed *= .72;
    }
    this.moveToward(dt, mvAng, speed);
    // face the target while shooting
    this.yaw = approachAngle(this.yaw, ang, (this.speed > 3 ? 3.2 : 6.5) * dt);
    this.tryShoot(dt);
    if (this.grenadeCd <= 0 && this.targetKind === 'player' && d > 9 && d < 26 && this.rng.chance(.35) && this.team === 'opfor') {
      this.grenadeCd = this.rng.range(9, 17);
      this.throwGrenade();
    }
  }

  // ── visuals ──────────────────────────────────────────────────────────────
  render(dt, time) {
    const o = this.obj;
    if (this.dead) {
      this.deadT += dt;
      const k = clamp(this.deadT / .55, 0, 1);
      o.position.set(this.pos.x, this.pos.y + .02, this.pos.z);
      o.rotation.y = this.yaw;
      const P = this.parts;
      // crumple: legs fold, chest drops, whole body tips
      o.rotation.x = -k * 1.45;
      P.legL.rotation.x = lerp(P.legL.rotation.x, .6, k);
      P.legR.rotation.x = lerp(P.legR.rotation.x, .2, k);
      P.armL.rotation.x = lerp(P.armL.rotation.x, -1.2, k);
      P.armR.rotation.x = lerp(P.armR.rotation.x, -.9, k);
      P.chest.rotation.x = lerp(P.chest.rotation.x, .3, k);
      o.position.y = this.pos.y + k * .18;
      if (this.deadT > 26) this.remove = true;
      const fade = this.deadT > 20 ? clamp(1 - (this.deadT - 20) / 6, 0, 1) : 1;
      if (fade < 1) { o.scale.setScalar(lerp(.2, 1, fade)); }
      return;
    }
    const P = this.parts;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      o.scale.setScalar(clamp(1 - this.spawnT / .55, .05, 1));
      o.position.copy(this.pos);
      o.rotation.y = this.yaw;
      return;
    }
    o.scale.setScalar(1);
    o.position.copy(this.pos);
    o.rotation.y = this.yaw;
    o.rotation.x = 0;

    const walk = this.speed > .4;
    const f = clamp(this.speed / this.cls.speed, 0, 1.4);
    this.animPhase += dt * (4.4 + f * 5.4);
    const s = Math.sin(this.animPhase * 2);
    const c = Math.cos(this.animPhase * 2);

    P.hips.position.y = .93 + (walk ? Math.abs(Math.sin(this.animPhase * 2)) * .045 * f : 0) - this.crouch * .28;
    P.hips.rotation.y = walk ? s * .07 * f : 0;
    P.chest.rotation.x = lerp(P.chest.rotation.x, .04 + f * .09 + this.crouch * .18 + this.flinch * .5, clamp(dt * 10, 0, 1));
    P.chest.rotation.y = walk ? -s * .09 * f : 0;
    P.chest.rotation.z = walk ? c * .03 * f : 0;

    // aim pitch drives head + gun
    const aim = clamp(this.aimPitch, -.7, .7);
    P.neck.rotation.x = damp(P.neck.rotation.x, -aim * .8 + this.crouch * .06, 10, dt);
    P.neck.rotation.y = damp(P.neck.rotation.y, clamp(this.aimYawErr || 0, -.4, .4) * .5, 8, dt);

    const lSw = walk ? s * .55 * f : Math.sin(time * 1.1 + this.id) * .015;
    const rSw = walk ? -s * .55 * f : Math.sin(time * 1.1 + this.id + 1) * .015;
    P.legL.rotation.x = damp(P.legL.rotation.x, lSw + this.crouch * .5, 12, dt);
    P.legR.rotation.x = damp(P.legR.rotation.x, rSw + this.crouch * .5, 12, dt);
    P.shinL.rotation.x = damp(P.shinL.rotation.x, walk ? Math.max(0, -s * .5) * f : this.crouch * 1.1, 12, dt);
    P.shinR.rotation.x = damp(P.shinR.rotation.x, walk ? Math.max(0, s * .5) * f : this.crouch * 1.1, 12, dt);

    // arms: hold gun up when engaging, lower when sprinting along
    const raise = clamp(this.alert > 0 || this.state === 'engage' || this.state === 'strafe' || this.state === 'cover' ? 1 : .25, 0, 1);
    const ar = -1.15 * raise - aim * .5;
    P.armL.rotation.x = damp(P.armL.rotation.x, ar - lSw * .35, 9, dt);
    P.armR.rotation.x = damp(P.armR.rotation.x, ar * .92 - rSw * .35, 9, dt);
    P.armL.rotation.z = damp(P.armL.rotation.z, .62 * raise, 9, dt);
    P.armR.rotation.z = damp(P.armR.rotation.z, -.34 * raise, 9, dt);
    P.foreL.rotation.x = damp(P.foreL.rotation.x, -1.5 * raise, 9, dt);
    P.foreR.rotation.x = damp(P.foreR.rotation.x, -1.1 * raise, 9, dt);

    const reloading = this.reloadT > 0;
    if (reloading) {
      const k = Math.sin(clamp(1 - this.reloadT / this.cls.reload, 0, 1) * Math.PI);
      P.gun.rotation.x = k * .8;
      P.gun.position.y = .02 - k * .18;
      P.foreL.rotation.x -= k * .7;
    } else {
      P.gun.rotation.x = damp(P.gun.rotation.x, -aim * .55, 12, dt);
      P.gun.position.y = damp(P.gun.position.y, .02, 10, dt);
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      const sc = 1 - clamp(this.muzzleT / .05, 0, 1);
      const mp = P.muzzle.getWorldPosition(new THREE.Vector3());
      const md = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.game.fx.muzzleFlash(mp, md, .6 + sc * .4);
    }
    this.flinch = Math.max(0, this.flinch - dt);
  }
}

// ── enemy/player squad class defs ────────────────────────────────────────────
export const CLASSES = {
  rifleman: { hp: 100, speed: 4.05, dmg: 9, rpm: 460, burst: 5, mag: 30, reload: 2.6, range: 62, view: 74, ideal: 16, skill: 1, sound: 'rifle', color: 0x8a7a52 },
  automatic: { hp: 130, speed: 3.5, dmg: 8, rpm: 690, burst: 9, mag: 90, reload: 4.4, range: 55, view: 62, ideal: 19, skill: .92, sound: 'lmg', color: 0x6f6a4a },
  shotgunner: { hp: 115, speed: 4.5, dmg: 21, rpm: 90, burst: 1, mag: 6, reload: 3.0, range: 15, view: 40, ideal: 7, skill: 1.15, sound: 'shotgun', color: 0x7a5a3a, aggressive: true },
  breacher: { hp: 150, speed: 4.2, dmg: 12, rpm: 700, burst: 6, mag: 32, reload: 2.4, range: 34, view: 46, ideal: 10, skill: 1.05, sound: 'smg', color: 0x5b6152, aggressive: true },
  sniper: { hp: 85, speed: 3.4, dmg: 62, rpm: 45, burst: 1, mag: 5, reload: 3.4, range: 190, view: 130, ideal: 46, skill: 1.25, sound: 'sniper', color: 0x59604a, camper: true },
  dm: { hp: 105, speed: 3.8, dmg: 26, rpm: 240, burst: 3, mag: 12, reload: 2.6, range: 105, view: 100, ideal: 30, skill: 1.12, sound: 'dmr', color: 0x6a6a52 },
  grunt: { hp: 75, speed: 4.6, dmg: 6, rpm: 380, burst: 4, mag: 25, reload: 2.2, range: 40, view: 52, ideal: 12, skill: .8, sound: 'ak', color: 0x7d6b4a },
};
export { TEAMS };
