import * as THREE from 'three';
import { G, tier } from './state.js';
import { clamp, Rand } from './util.js';
import { fx, addShake, damageNumber } from './fx.js';
import { makeGun } from './char.js';

// ══════════════════════════════════════════════════════════════
//  WEAPONS — 5 guns, real projectile bullets with sub-stepped
//  collision against the world grid + every living entity, recoil,
//  spread bloom, reload, ammo and loot drops.
// ══════════════════════════════════════════════════════════════

// spread is in DEGREES of cone half-angle at the hip; aiming multiplies it down
export const GUNS = {
  fists:   { id: 'fists',   name: '✊ IDDA',    dmg: 16, rpm: 140, mag: 0,  reserve: 0,   reload: 0,    spread: 0,    speed: 0,   auto: false, pellets: 1, recoil: 0.05, range: 2.7, melee: true, tier: 0 },
  pistol:  { id: 'pistol',  name: '🔫 PISTOL',  dmg: 21, rpm: 330, mag: 12, reserve: 96,  reload: 1.35, spread: 0.75, speed: 118, auto: false, pellets: 1, recoil: 0.13, range: 150, tier: 1 },
  smg:     { id: 'smg',     name: '💨 SMG',     dmg: 15, rpm: 780, mag: 32, reserve: 190, reload: 1.75, spread: 1.05, speed: 124, auto: true,  pellets: 1, recoil: 0.10, range: 165, tier: 1 },
  rifle:   { id: 'rifle',   name: '🎯 AR',      dmg: 25, rpm: 600, mag: 30, reserve: 180, reload: 2.05, spread: 0.52, speed: 165, auto: true,  pellets: 1, recoil: 0.15, range: 240, tier: 2 },
  shotgun: { id: 'shotgun', name: '💥 SHOTGUN', dmg: 12, rpm: 80,  mag: 6,  reserve: 42,  reload: 2.5,  spread: 3.6,  speed: 104, auto: false, pellets: 8, recoil: 0.55, range: 60, tier: 2 },
  sniper:  { id: 'sniper',  name: '🔭 SNIPER',  dmg: 85, rpm: 45,  mag: 5,  reserve: 30,  reload: 2.8,  spread: 0.06, speed: 320, auto: false, pellets: 1, recoil: 0.7,  range: 460, tier: 3 },
};
export const GUN_IDS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper'];
export const gunByName = (n) => GUNS[n] || GUNS.fists;

// ── bullet pool ────────────────────────────────────────────────
const POOL = 220;
export const bullets = [];
let tracerMesh = null;
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 0, 1);
const DIR = new THREE.Vector3();
const SCALE = new THREE.Vector3();
const P3 = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function initBullets(scene) {
  const g = new THREE.CylinderGeometry(0.035, 0.035, 1, G.tier === 0 ? 4 : 6, 1, true);
  g.rotateX(Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, fog: false, blending: THREE.AdditiveBlending, depthWrite: false });
  tracerMesh = new THREE.InstancedMesh(g, m, POOL);
  tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tracerMesh.frustumCulled = false;
  tracerMesh.renderOrder = 7;
  scene.add(tracerMesh);
  bullets.length = 0;
  for (let i = 0; i < POOL; i++) {
    bullets.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dmg: 0, owner: null, life: 0, idx: i, head: false, trail: 0 });
    M4.makeScale(0, 0, 0);
    tracerMesh.setMatrixAt(i, M4);
  }
  tracerMesh.instanceMatrix.needsUpdate = true;
}

const rnd = new Rand(99);
export function fire(owner, gun, origin, dir, opts = {}) {
  const n = gun.pellets || 1;
  const spread = (gun.spread || 0) * (opts.spreadMul === undefined ? 1 : opts.spreadMul) * (Math.PI / 180);
  for (let p = 0; p < n; p++) {
    let b = null;
    for (let i = 0; i < POOL; i++) { const c = bullets[i]; if (!c.active) { b = c; break; } }
    if (!b) return;
    const dx = dir.x + rnd.range(-spread, spread);
    const dy = dir.y + rnd.range(-spread, spread) * 0.75 + (opts.lift || 0);
    const dz = dir.z + rnd.range(-spread, spread);
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = gun.speed;
    b.active = true;
    b.x = origin.x; b.y = origin.y; b.z = origin.z;
    b.vx = (dx / l) * sp; b.vy = (dy / l) * sp; b.vz = (dz / l) * sp;
    b.dmg = gun.dmg * (opts.dmgMul || 1);
    b.owner = owner; b.life = (gun.range || 120) / sp;
    b.head = false; b.grav = gun.id === 'shotgun' ? 5.5 : 1.6;
  }
  fx.muzzle(origin.x, origin.y, origin.z);
  const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  fx.casing(origin.x, origin.y - 0.1, origin.z, right.x, right.z);
  if (opts.shake) addShake(gun.recoil * opts.shake);
}

/** move every bullet with sub-stepping so fast rounds can't tunnel */
export function updateBullets(dt, targets) {
  if (!tracerMesh) return;
  let visible = 0;
  const maxStep = 1.1;
  for (let i = 0; i < POOL; i++) {
    const b = bullets[i];
    if (!b.active) continue;
    b.life -= dt;
    if (b.life <= 0) { b.active = false; continue; }
    b.vy -= b.grav * dt;
    const speed = Math.hypot(b.vx, b.vy, b.vz) || 1e-6;
    const travel = speed * dt;                 // metres covered this frame
    const steps = clamp(Math.ceil(travel / maxStep), 1, 8);
    const sdt = dt / steps;                    // seconds per sub-step
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      const nx = b.x + b.vx * sdt;
      const ny = b.y + b.vy * sdt;
      const nz = b.z + b.vz * sdt;
      // world collision
      if (G.world.col.segmentBlocked(b.x, b.z, nx, nz, ny) || ny < -1) {
        impact(nx, ny, nz, b.vx, b.vy, b.vz);
        dead = true; break;
      }
      // entity collision — a 3-sphere capsule (head / chest / hips) so hits
      // feel fair and headshots happen naturally
      const sx = nx - b.x, sy = ny - b.y, sz = nz - b.z;
      const L2 = sx * sx + sy * sy + sz * sz || 1e-9;
      for (let t = 0; t < targets.length; t++) {
        const e = targets[t];
        if (!e.alive || e === b.owner || e.dropping) continue;
        const duck = e.crouch ? 0.62 : 1;
        let struck = 0, bestT = 2;            // closest sphere along the path wins
        for (let k = 0; k < 3; k++) {
          const oy = e.pos.y + (k === 0 ? 0.62 : k === 1 ? 1.16 : 1.72) * duck;
          const rr = k === 0 ? 0.42 : k === 1 ? 0.48 : 0.30;
          const ex = e.pos.x - b.x, ey = oy - b.y, ez = e.pos.z - b.z;
          const tt = clamp((ex * sx + ey * sy + ez * sz) / L2, 0, 1);
          const px = ex - sx * tt, py = ey - sy * tt, pz = ez - sz * tt;
          if (px * px + py * py + pz * pz < rr * rr && tt < bestT) { bestT = tt; struck = k + 1; }
        }
        if (struck) {
          applyHit(e, b, struck === 3, nx, ny, nz);
          dead = true; break;
        }
      }
      b.x = nx; b.y = ny; b.z = nz;
    }
    if (dead) { b.active = false; continue; }
    // draw the tracer
    DIR.set(b.vx, b.vy, b.vz).normalize();
    Q.setFromUnitVectors(UP, DIR);
    const len = clamp(Math.hypot(b.vx, b.vy, b.vz) * 0.016, 0.5, 2.4);
    P3.set(b.x, b.y, b.z);
    SCALE.set(1, 1, len);
    M4.compose(P3, Q, SCALE);
    tracerMesh.setMatrixAt(visible++, M4);
  }
  // instances 0..visible-1 are packed at the front, so just trim the count
  tracerMesh.count = visible;
  if (visible) tracerMesh.instanceMatrix.needsUpdate = true;
}

function impact(x, y, z, vx, vy, vz) {
  const l = Math.hypot(vx, vy, vz) || 1;
  const nrm = { x: -vx / l, y: -vy / l * 0.4 + 0.6, z: -vz / l };
  if (y < 0.4) fx.splash(x, Math.max(y, 0.2), z);
  else if (rnd.chance(0.55)) fx.spark(x, y, z, 4, 0xffd27a);
  else fx.dust(x, y, z, 3, 0xbfae8c);
  void nrm;
}

export function applyHit(target, b, headshot, hx, hy, hz) {
  const mul = headshot ? 1.9 : 1;
  const dmg = b.dmg * mul;
  target.hitFlash = 0.16;
  target.lastHitBy = b.owner;
  target.lastHitDir = { x: b.vx, y: 0, z: b.vz };
  fx.blood(hx, hy, hz, headshot ? 14 : 8, { x: b.vx * 0.01, z: b.vz * 0.01 });
  damageEntity(target, dmg, b.owner, headshot, hx, hy, hz);
}

/** shared damage entry point (bullets, grenades, zone, fall) */
export function damageEntity(e, amount, by, headshot, wx, wy, wz) {
  if (!e.alive) return 0;
  let dmg = amount;
  if (e.armor > 0) {
    const absorbed = Math.min(e.armor, dmg * 0.6);
    e.armor -= absorbed;
    dmg -= absorbed;
  }
  e.hp -= dmg;
  e.damageTaken += dmg;
  if (by && by !== e) {
    by.dealt = (by.dealt || 0) + dmg;
    if (by.isPlayer) {
      G.stats.damage += dmg;
      if (wx !== undefined) {
        // hit feedback
        const el = G.ui.hitmark;
        if (el) { el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 90); }
        damageNumber({ x: wx, y: wy, z: wz }, dmg, headshot);
      }
    }
  }
  if (e.hp <= 0) {
    e.hp = 0;
    killEntity(e, by, headshot);
    return dmg;
  }
  return dmg;
}

export function killEntity(e, by, headshot) {
  e.alive = false;
  e.deathT = 0;
  G.aliveCount = Math.max(1, G.aliveCount - 1);
  if (by) {
    by.kills = (by.kills || 0) + 1;
    if (by.isPlayer) {
      G.stats.kills++;
      addShake(0.2);
    }
  }
  const killerName = by ? (by.isPlayer ? 'NTA' : by.name) : 'ZONE';
  const victimName = e.isPlayer ? 'NTA' : e.name;
  G.ui.killFeed && G.ui.killFeed(killerName, victimName, headshot, by && by.gun ? by.gun.name : '');
  if (e.isPlayer) {
    G.ui.onPlayerDeath && G.ui.onPlayerDeath(by);
  } else if (by && by.isPlayer) {
    G.ui.onBotKilled && G.ui.onBotKilled(e, headshot);
  }
  // drop their loot
  if (e.dropLoot) e.dropLoot();
  if (G.aliveCount <= 1 && G.player.alive) G.ui.onWin && G.ui.onWin();
}

// ── grenade pool ───────────────────────────────────────────────
export const grenades = [];
const grenGeo = new THREE.SphereGeometry(0.14, 7, 5);
const grenMat = new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: .6, metalness: .3 });

export function throwGrenade(owner, origin, dir, power = 17) {
  const m = new THREE.Mesh(grenGeo, grenMat);
  m.castShadow = tier().shadows;
  m.position.copy(origin);
  G.scene.add(m);
  grenades.push({
    mesh: m, owner, fuse: 2.6, t: 0,
    x: origin.x, y: origin.y, z: origin.z,
    vx: dir.x * power, vy: dir.y * power + 4.2, vz: dir.z * power,
  });
}

export function updateGrenades(dt, targets) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t += dt; g.fuse -= dt;
    g.vy -= 21 * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    const gh = G.world.heightAt(nx, nz);
    if (ny < gh + 0.14) {
      ny = gh + 0.14;
      g.vy = -g.vy * 0.34;
      g.vx *= 0.62; g.vz *= 0.62;
      if (Math.abs(g.vy) < 0.6) g.vy = 0;
      fx.dust(nx, ny, nz, 3, 0xc0a97f);
    }
    if (G.world.col.segmentBlocked(g.x, g.z, nx, nz, ny)) {
      g.vx *= -0.35; g.vz *= -0.35; nx = g.x; nz = g.z;
    }
    g.x = nx; g.y = ny; g.z = nz;
    g.mesh.position.set(g.x, g.y, g.z);
    g.mesh.rotation.x += dt * 7; g.mesh.rotation.z += dt * 5;
    if (g.fuse <= 0) {
      explode(g, targets);
      G.scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

export function explode(g, targets) {
  const R = 6.4, R2 = R * R;
  fx.explosion(g.x, g.y, g.z);
  addShake(G.player.alive ? clamp(1.2 - Math.hypot(g.x - G.player.pos.x, g.z - G.player.pos.z) / 14, 0, 1) * 0.9 : 0);
  G.ui.sfx && G.ui.sfx('boom', 0.9);
  for (const e of targets) {
    if (!e.alive) continue;
    const d2 = (e.pos.x - g.x) ** 2 + (e.pos.z - g.z) ** 2 + (e.pos.y - g.y) ** 2 * 0.4;
    if (d2 > R2) continue;
    const d = Math.sqrt(d2);
    const falloff = 1 - d / R;
    if (!G.world.col.los(g.x, g.z, e.pos.x, e.pos.z, g.y + 0.4)) continue;
    damageEntity(e, 92 * falloff + 12, g.owner, false, e.pos.x, e.pos.y + 1.1, e.pos.z);
    e.knock = { x: (e.pos.x - g.x) / (d || 1) * 5.5 * falloff, z: (e.pos.z - g.z) / (d || 1) * 5.5 * falloff, t: 0.25 };
  }
}

export function resetProjectiles() {
  for (const b of bullets) b.active = false;
  for (const g of grenades) G.scene && G.scene.remove(g.mesh);
  grenades.length = 0;
  if (tracerMesh) {
    for (let i = 0; i < POOL; i++) tracerMesh.setMatrixAt(i, ZERO);
    tracerMesh.count = 0;
    tracerMesh.instanceMatrix.needsUpdate = true;
  }
}

// ── attach a gun mesh to a character ───────────────────────────
export function equipGunMesh(entity, gunId) {
  const c = entity.char;
  if (!c) return;
  if (entity.gunMesh) c.gunAnchor.remove(entity.gunMesh);
  if (!gunId || gunId === 'fists') { entity.gunMesh = null; return; }
  const m = makeGun(gunId);
  c.gunAnchor.add(m);
  entity.gunMesh = m;
}
