import * as THREE from 'three';
import { G, tier } from './state.js';
import { Rand, clamp, lerp, approachAngle, angDiff } from './util.js';
import { makeCharacter, animateChar, killPose } from './char.js';
import { GUNS, gunByName, fire, damageEntity, equipGunMesh, throwGrenade } from './weapons.js';
import { fx, addShake } from './fx.js';
import { dropLootFrom, KIND } from './loot.js';

// ══════════════════════════════════════════════════════════════
//  ENTITIES — one factory used for the player AND all 12 bots.
//  Movement with acceleration, slopes, jumping, cover strafing,
//  aiming, recoil bloom, reloading, healing, and a full bot brain
//  (loot → rotate to zone → engage → cover → heal).
// ══════════════════════════════════════════════════════════════

export const BOT_NAMES = ['Zaid', 'Nour', 'Hamza', 'Yusra', 'Karim', 'Salma', 'Omar', 'Lina', 'Reda', 'Amal', 'Yassine', 'Hiba', 'Mehdi', 'Sara', 'Anas', 'Rim'];
export const BOT_LINES = ['wach nta mnin?', 'safi tkhssrt', 'chouf wra7ek!', 'hna f douar', 'zid n3awnek', 'ma bghitch nmout'];

const RUN = 6.4, SPRINT = 9.0, CROUCH = 3.1, AIR = 2.6;
const _dv = new THREE.Vector3();
const GRAV = 23, JUMP_V = 7.6;

export function makeEntity(opts) {
  const e = {
    isPlayer: !!opts.isPlayer,
    name: opts.name || 'BOT',
    pos: new THREE.Vector3(opts.x || 0, opts.y || 0, opts.z || 0),
    vel: new THREE.Vector3(),
    yaw: opts.yaw || 0, pitch: 0,
    hp: 100, armor: 0, alive: true, dead: false, deathT: 0,
    gunId: 'fists', gun: GUNS.fists, mag: 0,
    ammo: {}, reserve: {},
    meds: 0, nars: 0, coins: 0,
    kills: 0, dealt: 0, damageTaken: 0,
    reloading: 0, cooldown: 0, bloom: 0, recoil: 0, hitFlash: 0,
    crouch: false, sprint: false, aiming: false, airborne: false,
    groundY: 0, speed: 0, gait: 0, t: 0,
    healT: 0, knock: null,
    st: { speed: 0, gait: 0, t: 0, recoil: 0, pitch: 0, aiming: false, crouch: false, airborne: false },
    // bot brain
    brain: opts.isPlayer ? null : {
      state: 'drop', target: null, moveTo: new THREE.Vector3(), repath: 0,
      react: 0, accuracy: 0.5, aggro: 0.5, burst: 0, burstT: 0, strafe: 1, strafeT: 0,
      errYaw: 0, errPitch: 0, errT: 0,
      lootTarget: null, healAt: 0, seenT: 0, coverT: 0, fireT: 0, chatter: 0,
    },
    dropping: !!opts.dropping, dropT: 0, chuteAt: opts.chuteAt || 42,
  };
  e.char = makeCharacter({
    seed: opts.seed, tag: opts.isPlayer ? null : e.name,
    tagColor: '#ffd7d7', hpbar: !opts.isPlayer,
    team: opts.team,
  });
  e.char.root.position.copy(e.pos);
  if (e.dropping) { e.char.mkChute(); e.char.chute.visible = false; }
  G.scene.add(e.char.root);

  e.setGun = (id, fillMag = true) => {
    e.gunId = id; e.gun = gunByName(id);
    if (e.ammo[id] === undefined) e.ammo[id] = 0;
    if (e.reserve[id] === undefined) e.reserve[id] = 0;
    if (fillMag && e.gun.mag) {
      const need = e.gun.mag - e.mag;
      const take = Math.min(Math.max(0, need), e.reserve[id]);
      e.mag += take; e.reserve[id] -= take;
    }
    equipGunMesh(e, id === 'fists' ? null : id);
  };
  e.dropLoot = () => dropLootFrom(e, G.scene, new Rand((Math.random() * 1e9) | 0));
  e.setGun(opts.gun || 'fists', false);
  if (opts.mag !== undefined) e.mag = opts.mag;
  if (opts.armor) e.armor = opts.armor;
  if (opts.meds !== undefined) e.meds = opts.meds;
  if (opts.nars !== undefined) e.nars = opts.nars;
  return e;
}

/** give a bot a random loadout scaled by how good it is */
export function botLoadout(e, rnd, skill) {
  const r = rnd.n();
  let id;
  if (skill > 0.75) id = r < 0.42 ? 'rifle' : r < 0.66 ? 'smg' : r < 0.82 ? 'shotgun' : r < 0.94 ? 'sniper' : 'pistol';
  else if (skill > 0.45) id = r < 0.34 ? 'smg' : r < 0.62 ? 'rifle' : r < 0.8 ? 'pistol' : 'shotgun';
  else id = r < 0.5 ? 'pistol' : r < 0.82 ? 'smg' : 'shotgun';
  const g = GUNS[id];
  e.reserve[id] = Math.round(g.reserve * rnd.range(0.5, 1.1));
  e.setGun(id, true);
  e.armor = rnd.chance(0.35 + skill * 0.5) ? rnd.int(25, 95) : 0;
  e.meds = rnd.chance(0.55) ? rnd.int(1, 3) : 0;
  e.nars = rnd.chance(0.3) ? 1 : 0;
}

// ── shooting ───────────────────────────────────────────────────
/**
 * aimPoint (optional): a world position to shoot AT. The player passes the
 * point under the crosshair so what you see is what you hit; bots pass nothing
 * and shoot along their own facing.
 */
export function tryShoot(e, dt, aimPoint) {
  if (!e.alive || e.reloading > 0 || e.cooldown > 0 || e.dropping) return false;
  const g = e.gun;
  if (g.melee) {
    e.cooldown = 60 / g.rpm;
    meleeSwing(e);
    return true;
  }
  if (e.mag <= 0) { startReload(e); return false; }
  e.cooldown = 60 / g.rpm;
  e.mag--;
  const origin = new THREE.Vector3();
  // sync the rig to the CURRENT aim before reading the muzzle, otherwise the
  // shot leaves from last frame's pose and the crosshair lies to the player
  e.char.root.position.set(e.pos.x, e.pos.y, e.pos.z);
  e.char.root.rotation.y = e.yaw;
  e.st.pitch = e.pitch || 0;
  animateChar(e.char, e.st, 0);
  e.char.root.updateMatrixWorld(true);
  e.char.muzzle.getWorldPosition(origin);
  const dir = aimPoint
    ? _dv.set(aimPoint.x - origin.x, aimPoint.y - origin.y, aimPoint.z - origin.z).normalize()
    : aimDir(e);
  const aimMul = e.aiming ? 0.42 : 1;
  const bloomMul = (1 + e.bloom * (e.crouch ? 0.5 : 1) * (e.moving ? 1.9 : 1) * (e.airborne ? 2.6 : 1)) * aimMul;
  fire(e, g, origin, dir, {
    spreadMul: bloomMul,
    shake: e.isPlayer ? (g.recoil * (e.aiming ? 0.5 : 1)) : 0,
    lift: e.isPlayer ? 0 : 0,
  });
  e.bloom = Math.min(2.2, e.bloom + g.recoil * 0.85);
  e.st.recoil = Math.min(1, e.st.recoil + g.recoil * 1.6);
  if (e.isPlayer) {
    G.ui.sfx && G.ui.sfx('shot:' + g.id, 1);
    addShake(g.recoil * 0.16);
    e.pitch = clamp(e.pitch + g.recoil * 0.012, -0.5, 0.9);
  } else {
    // distant bots are quieter
    const d = e.pos.distanceTo(G.player.pos);
    if (d < 120 && G.ui.sfx) G.ui.sfx('shot:' + g.id, clamp(1 - d / 120, 0.06, 0.75), e.pos);
  }
  if (e.mag <= 0) startReload(e);
  return true;
}

export function meleeSwing(e) {
  const g = GUNS.fists;
  const dir = aimDir(e);
  for (const t of [G.player, ...G.bots]) {
    if (t === e || !t.alive) continue;
    const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > g.range) continue;
    if ((dx * dir.x + dz * dir.z) / (d || 1) < 0.45) continue;
    damageEntity(t, g.dmg, e, false, t.pos.x, t.pos.y + 1.1, t.pos.z);
    t.knock = { x: dx / d * 3.4, z: dz / d * 3.4, t: 0.18 };
    if (e.isPlayer) G.ui.sfx && G.ui.sfx('hit', 1);
  }
  if (e.isPlayer) { G.ui.sfx && G.ui.sfx('swing', 1); addShake(0.12); }
}

export function startReload(e) {
  const g = e.gun;
  if (g.melee || e.reloading > 0 || e.mag >= g.mag) return;
  const have = e.reserve[g.id] || 0;
  if (have <= 0) { if (e.isPlayer) G.ui.toast && G.ui.toast('⚠ ma kaybqa7ch ذخيرة!'); return; }
  e.reloading = g.reload;
  if (e.isPlayer) G.ui.sfx && G.ui.sfx('reload', 1);
}
function finishReload(e) {
  const g = e.gun;
  const need = g.mag - e.mag;
  const take = Math.min(need, e.reserve[g.id] || 0);
  e.mag += take; e.reserve[g.id] -= take;
  if (e.isPlayer) G.ui.sfx && G.ui.sfx('reloadEnd', 1);
}

/** unit vector the entity is currently aiming along */
export function aimDir(e) {
  const cp = Math.cos(e.pitch), sp = Math.sin(e.pitch);
  return new THREE.Vector3(Math.sin(e.yaw) * cp, sp, Math.cos(e.yaw) * cp).normalize();
}

export function useMed(e) {
  if (!e.alive || e.meds <= 0 || e.healT > 0 || e.hp >= 100) return false;
  e.meds--; e.healT = 1.5;
  if (e.isPlayer) G.ui.sfx && G.ui.sfx('heal', 1);
  return true;
}

// ── movement & physics ─────────────────────────────────────────
export function moveEntity(e, dt, wish) {
  // wish: {x, z, sprint, crouch, jump}  (x/z are already normalised-ish)
  const w = G.world;
  if (!e.alive) {
    e.deathT += dt;
    if (!e._posed) { e._posed = true; killPose(e.char, e.st); }
    e.char.root.position.copy(e.pos);
    if (e.deathT > 6 && e.char.root.parent) { G.scene.remove(e.char.root); e.gone = true; }
    return;
  }

  // parachute drop phase
  if (e.dropping) {
    e.dropT += dt;
    if (e.dropT > 0.9 && !e.char.chute) e.char.mkChute();
    if (e.char.chute) e.char.chute.visible = e.pos.y > 6;
    const fall = e.pos.y > e.chuteAt ? -13 : -5.2;
    e.pos.y += fall * dt;
    const steer = wish || { x: 0, z: 0 };
    const steerPower = e.pos.y > e.chuteAt ? 5.5 : 12;
    e.pos.x += (steer.x || 0) * steerPower * dt;
    e.pos.z += (steer.z || 0) * steerPower * dt;
    // stay over land
    const d = Math.hypot(e.pos.x, e.pos.z);
    if (d > 108) { e.pos.x *= 108 / d; e.pos.z *= 108 / d; }
    if (e.pos.y > e.chuteAt && Math.hypot(steer.x || 0, steer.z || 0) > 0.1)
      e.yaw = Math.atan2(steer.x, steer.z);
    const gh = w.heightAt(e.pos.x, e.pos.z);
    if (e.pos.y <= gh + 0.02) {
      e.pos.y = gh;
      e.dropping = false;
      e.airborne = false;
      if (e.char.chute) { e.char.root.remove(e.char.chute); e.char.chute = null; }
      fx.land(e.pos.x, e.pos.y, e.pos.z);
      if (e.isPlayer) { G.ui.sfx && G.ui.sfx('land', 1); G.ui.banner && G.ui.banner('🪂 HBITI!  ' + (G.player.gunId === 'fists' ? 'قلّب على السلاح' : '')); G.ui.setPhase && G.ui.setPhase('play'); }
      else if (e.brain) e.brain.state = 'loot';
    }
    syncChar(e, dt);
    return;
  }

  const maxSpeed = e.crouch ? CROUCH : (e.sprint && !e.aiming ? SPRINT : RUN);
  const accel = e.airborne ? AIR * 4 : 44;
  const tx = (wish.x || 0) * maxSpeed, tz = (wish.z || 0) * maxSpeed;
  e.vel.x = lerp(e.vel.x, tx, clamp(accel * dt / maxSpeed, 0, 1));
  e.vel.z = lerp(e.vel.z, tz, clamp(accel * dt / maxSpeed, 0, 1));
  if (e.knock) {
    e.pos.x += e.knock.x * dt * 3; e.pos.z += e.knock.z * dt * 3;
    e.knock.t -= dt; if (e.knock.t <= 0) e.knock = null;
  }
  e.pos.x += e.vel.x * dt;
  e.pos.z += e.vel.z * dt;

  // gravity + ground (terrain, or a platform top: pier / container / tower)
  const gh = w.groundAt ? w.groundAt(e.pos.x, e.pos.z) : w.heightAt(e.pos.x, e.pos.z);
  e.vel.y -= GRAV * dt;
  e.pos.y += e.vel.y * dt;
  if (e.pos.y <= gh) {
    if (e.airborne && e.vel.y < -12) {
      // fall damage
      const dmg = (-e.vel.y - 12) * 6.5;
      if (dmg > 1) {
        damageEntity(e, dmg, null, false, e.pos.x, e.pos.y + 1, e.pos.z);
        if (e.isPlayer) addShake(clamp(dmg / 60, 0.1, 0.8));
      }
      fx.land(e.pos.x, gh, e.pos.z);
      if (e.isPlayer) G.ui.sfx && G.ui.sfx('land', 1);
    }
    e.pos.y = gh; e.vel.y = 0; e.airborne = false;
  } else if (e.pos.y > gh + 0.12) e.airborne = true;

  if (wish.jump && !e.airborne && !e.crouch) {
    e.vel.y = JUMP_V; e.airborne = true;
    if (e.isPlayer) G.ui.sfx && G.ui.sfx('jump', 0.7);
  }

  // island bounds
  const dc = Math.hypot(e.pos.x, e.pos.z);
  if (dc > 112) { e.pos.x *= 112 / dc; e.pos.z *= 112 / dc; }
  // water slows you down a bit
  if (e.pos.y < 0.55) { e.vel.x *= 0.94; e.vel.z *= 0.94; }

  // collide with the world
  w.col.resolve(e.pos, 0.44, e.pos.y);

  // face movement direction unless aiming
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.moving = sp > 0.4;
  if (e.aiming && !e.dropping) {
    // body follows the aim
  } else if (e.moving) {
    e.yaw = approachAngle(e.yaw, Math.atan2(e.vel.x, e.vel.z), dt * 11);
  }
  e.speed = clamp(sp / maxSpeed, 0, 1);
  syncChar(e, dt);
}

function syncChar(e, dt) {
  const c = e.char;
  c.root.position.set(e.pos.x, e.pos.y, e.pos.z);
  if (!e.dropping) c.root.rotation.y = e.yaw;
  else c.root.rotation.y = lerp(c.root.rotation.y, e.yaw, clamp(dt * 4, 0, 1));
  e.st.speed = e.speed || 0;
  e.st.pitch = e.pitch || 0;
  e.st.aiming = e.aiming;
  e.st.crouch = e.crouch;
  e.st.airborne = e.dropping || e.airborne;
  e.st.recoil = e.st.recoil;
  animateChar(c, e.st, dt);
  // hit flash: tint the suit red briefly
  if (e.hitFlash > 0) {
    e.hitFlash -= dt;
    const k = clamp(e.hitFlash / 0.16, 0, 1);
    if (c.suitM) c.suitM.emissive.setRGB(k * 0.8, 0, 0);
  } else if (c.suitM && c.suitM.emissive.r !== 0) c.suitM.emissive.setRGB(0, 0, 0);
  // hp bar faces the camera
  if (c.hpBar) { c.hpBar.lookAt(G.camera.position); c.setHp(e.hp / 100); }
  if (c.tag) c.tag.center.set(0.5, 0);
}

// ── per-frame bookkeeping for any entity ───────────────────────
export function tickEntity(e, dt) {
  if (e.cooldown > 0) e.cooldown -= dt;
  if (e.bloom > 0) e.bloom = Math.max(0, e.bloom - dt * 3.1);
  if (e.reloading > 0) {
    e.reloading -= dt;
    if (e.reloading <= 0) { e.reloading = 0; finishReload(e); }
  }
  if (e.healT > 0) {
    e.healT -= dt;
    if (e.healT <= 0) {
      e.hp = Math.min(100, e.hp + 55);
      e.healT = 0;
      if (e.isPlayer) { G.ui.toast && G.ui.toast('🩹 +55 HP'); fx.dust(e.pos.x, e.pos.y + 1, e.pos.z, 6, 0x7fe0a0); }
    }
  }
  if (!e.alive) return;
  // zone damage
  const z = G.zone;
  const d = Math.hypot(e.pos.x - z.x, e.pos.z - z.z);
  if (d > z.r) {
    const dps = z.dps * clamp(1 + (d - z.r) * 0.06, 1, 3.5);
    damageEntity(e, dps * dt, null, false);
    if (e.isPlayer) {
      G.ui.vig && G.ui.vig(true);
      if (!e._zoneWarn || G.time - e._zoneWarn > 4) { e._zoneWarn = G.time; G.ui.toast && G.ui.toast('☠ NTA BRA L-ZONE!دخل l دائرة'); }
    }
  } else if (e.isPlayer) G.ui.vig && G.ui.vig(false);
}

// ── bot brain ──────────────────────────────────────────────────
const _v = new THREE.Vector3();
export function thinkBot(e, dt) {
  if (!e.alive || e.dropping) return;
  const b = e.brain;
  const w = G.world;
  b.repath -= dt;
  b.react -= dt;
  b.strafeT -= dt;
  b.chatter -= dt;

  // pick a threat: nearest visible living entity
  let best = null, bestD = 1e9;
  const cands = [G.player, ...G.bots];
  const sight = G.time < 40 ? 17 : 44;      // early = loot phase, no long duels
  for (const c of cands) {
    if (c === e || !c.alive || c.dropping) continue;
    const d = c.pos.distanceTo(e.pos);
    if (d > sight) continue;
    const see = w.col.los(e.pos.x, e.pos.z, c.pos.x, c.pos.z, e.pos.y + 1.5, c.pos.y + 1.35);
    if (!see && d > 8) continue;
    const score = d * (see ? 1 : 1.6);
    if (score < bestD) { bestD = score; best = c; }
  }
  b.target = best;

  // state machine
  const zoneD = Math.hypot(e.pos.x - G.zone.x, e.pos.z - G.zone.z);
  const outside = zoneD > G.zone.r * 0.94;

  if (e.hp < 34 && e.meds > 0 && e.healT <= 0 && (!best || bestD > 22)) { useMed(e); b.state = 'heal'; }
  else if (outside) b.state = 'rotate';
  else if (best && bestD < 58) b.state = 'fight';
  else if (b.state !== 'loot' || b.repath <= 0) {
    // look for loot if unarmed / low ammo, else patrol toward the zone centre
    if ((e.gunId === 'fists' || (e.reserve[e.gunId] || 0) < 8) && !b.lootTarget) b.lootTarget = findLoot(e);
    b.state = b.lootTarget ? 'loot' : 'patrol';
  }

  const wish = { x: 0, z: 0, sprint: false, crouch: false, jump: false };
  e.aiming = false; e.crouch = false; e.sprint = false;

  if (b.state === 'fight' && best) {
    const d = bestD;
    const g = e.gun;
    // aim at the target with lead + skill-based error
    _v.copy(best.pos).sub(e.pos);
    const lead = d / Math.max(40, g.speed || 60);
    _v.x += (best.vel.x || 0) * lead; _v.z += (best.vel.z || 0) * lead;
    // humans don't hold a perfect bead: re-roll a small aim error each burst
    b.errT -= dt;
    if (b.errT <= 0) {
      b.errT = 0.45 + Math.random() * 0.75;
      const m = (1 - b.accuracy) * 0.105;
      b.errYaw = (Math.random() * 2 - 1) * m;
      b.errPitch = (Math.random() * 2 - 1) * m * 0.8;
    }
    const targetYaw = Math.atan2(_v.x, _v.z) + b.errYaw;
    const dy = Math.hypot(_v.x, _v.z);
    const targetPitch = Math.atan2((best.pos.y + 1.15) - (e.pos.y + 1.45), dy) + b.errPitch;
    const turnSpeed = 3.4 + b.accuracy * 5.5;
    e.yaw = approachAngle(e.yaw, targetYaw, dt * turnSpeed);
    e.pitch = lerp(e.pitch, targetPitch, clamp(dt * (2.4 + b.accuracy * 4), 0, 1));
    e.aiming = true;
    const aligned = Math.abs(angDiff(e.yaw, targetYaw)) < 0.16 + (1 - b.accuracy) * 0.18;

    // distance-keeping strafe
    if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = (0.7 + Math.random() * 1.3) * (g.melee ? 0.5 : 1); }
    const ideal = g.melee ? 1.4 : g.id === 'shotgun' ? 7 : g.id === 'sniper' ? 30 : 17;
    const push = d > ideal + 4 ? 1 : d < ideal - 4 ? -1 : 0;
    const fx2 = Math.sin(e.yaw), fz2 = Math.cos(e.yaw);
    const rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
    wish.x = fx2 * push + rx * b.strafe * 0.8;
    wish.z = fz2 * push + rz * b.strafe * 0.8;
    const wl = Math.hypot(wish.x, wish.z) || 1;
    wish.x /= wl; wish.z /= wl;
    if (d > 34) wish.sprint = false;
    if (d < 12) wish.crouch = Math.random() < 0.25;
    // stuck? try to sidestep
    if (e.moving === false && push !== 0) { wish.x = rx; wish.z = rz; }

    // fire in bursts
    if (aligned && b.react <= 0) {
      if (g.melee) { if (d < g.range) tryShoot(e, dt); }
      else if (e.mag > 0) {
        b.burstT -= dt;
        if (b.burst <= 0) { b.burst = 2 + Math.floor(Math.random() * (g.auto ? 7 : 2)); b.burstT = 0; }
        if (b.burstT <= 0) {
          if (tryShoot(e, dt)) { b.burst--; b.burstT = g.auto ? 60 / g.rpm : 60 / g.rpm; }
          if (b.burst <= 0) b.fireT = (0.35 + Math.random() * 0.8) * (1.3 - b.accuracy);
        }
      } else startReload(e);
    }
    if (b.fireT > 0) { b.fireT -= dt; b.react = Math.max(b.react, 0.05); }
    // throw a grenade occasionally at medium range
    if (e.nars > 0 && d > 8 && d < 24 && Math.random() < dt * 0.12 * b.aggro) {
      e.nars--;
      const dir = aimDir(e);
      throwGrenade(e, new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z), dir, 13);
      if (b.chatter <= 0) { b.chatter = 8; G.ui.chatter && G.ui.chatter(e.name, '💥 قنبلة!'); }
    }
    // chatter
    if (b.chatter <= 0 && Math.random() < dt * 0.05) { b.chatter = 12; G.ui.chatter && G.ui.chatter(e.name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]); }
  } else if (b.state === 'rotate') {
    // run for the safe zone
    const a = Math.atan2(G.zone.x - e.pos.x, G.zone.z - e.pos.z);
    const jitter = Math.sin(G.time * 0.7 + e.pos.x) * 0.35;
    wish.x = Math.sin(a + jitter); wish.z = Math.cos(a + jitter);
    wish.sprint = true;
    e.yaw = approachAngle(e.yaw, a + jitter, dt * 5);
    avoidObstacles(e, wish, dt);
  } else if (b.state === 'loot' && b.lootTarget) {
    const t = b.lootTarget;
    if (t.taken || t.dead) { b.lootTarget = null; return; }
    const d = Math.hypot(t.x - e.pos.x, t.z - e.pos.z);
    if (d < 1.5) {
      // grab it
      grabBotLoot(e, t);
      b.lootTarget = null;
    } else {
      const a = Math.atan2(t.x - e.pos.x, t.z - e.pos.z);
      wish.x = Math.sin(a); wish.z = Math.cos(a);
      wish.sprint = d > 12;
      avoidObstacles(e, wish, dt);
      e.yaw = approachAngle(e.yaw, a, dt * 4);
    }
  } else {
    // patrol toward a random point biased to the zone centre
    if (b.repath <= 0 || !b.moveTo.lengthSq || e.pos.distanceTo(b.moveTo) < 3) {
      b.repath = 5 + Math.random() * 6;
      const a = Math.random() * 6.283;
      const r = Math.sqrt(Math.random()) * Math.max(14, G.zone.r * 0.8);
      b.moveTo.set(G.zone.x + Math.cos(a) * r, 0, G.zone.z + Math.sin(a) * r);
      const h = w.heightAt(b.moveTo.x, b.moveTo.z);
      if (h < 0.4) b.moveTo.set(G.zone.x, 0, G.zone.z);
    }
    const a = Math.atan2(b.moveTo.x - e.pos.x, b.moveTo.z - e.pos.z);
    wish.x = Math.sin(a); wish.z = Math.cos(a);
    wish.sprint = e.pos.distanceTo(b.moveTo) > 22;
    avoidObstacles(e, wish, dt);
    e.yaw = approachAngle(e.yaw, a, dt * 3.4);
    // pick up anything we step on
    const near = G.pickups.find((p) => !p.taken && Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < 1.5 && Math.abs(p.y - e.pos.y) < 2.5);
    if (near) grabBotLoot(e, near);
  }
  return wish;
}

function avoidObstacles(e, wish, dt) {
  // cheap feeler: if a wall is 1.2 m ahead in the wish direction, slide along it
  const w = G.world;
  const px = e.pos.x + wish.x * 1.4, pz = e.pos.z + wish.z * 1.4;
  if (!w.col.segmentBlocked(e.pos.x, e.pos.z, px, pz, e.pos.y + 1.0)) return;
  // try rotating the wish vector until it is clear
  for (const s of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
    const a = Math.atan2(wish.x, wish.z) + s;
    const nx = Math.sin(a), nz = Math.cos(a);
    if (!w.col.segmentBlocked(e.pos.x, e.pos.z, e.pos.x + nx * 1.6, e.pos.z + nz * 1.6, e.pos.y + 1.0)) {
      wish.x = nx; wish.z = nz;
      return;
    }
  }
}

function findLoot(e) {
  let best = null, bestScore = 1e9;
  for (const p of G.pickups) {
    if (p.taken) continue;
    const d = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
    if (d > 70) continue;
    let s = d;
    if (p.kind === 'gun' && (e.gunId === 'fists' || GUNS[p.gun].tier > GUNS[e.gunId].tier)) s -= 26;
    if (p.kind === 'ammo') s -= 8;
    if (p.kind === 'armor' && e.armor < 60) s -= 14;
    if (p.kind === 'med' && e.hp < 70) s -= 18;
    if (s < bestScore) { bestScore = s; best = p; }
  }
  return best;
}

function grabBotLoot(e, p) {
  if (p.kind === KIND.gun) {
    const g = GUNS[p.gun];
    const better = GUNS[e.gunId] ? (g.tier > GUNS[e.gunId].tier || e.gunId === 'fists') : true;
    if (!better && e.gunId !== 'fists') {
      // still take the ammo for it
      e.reserve[p.gun] = (e.reserve[p.gun] || 0) + Math.round(g.reserve * 0.35);
    } else {
      e.reserve[p.gun] = (e.reserve[p.gun] || 0) + g.mag + Math.round(g.reserve * 0.4);
      e.setGun(p.gun, true);
    }
  } else if (p.kind === KIND.ammo) {
    const id = e.gunId === 'fists' ? 'pistol' : e.gunId;
    e.reserve[id] = (e.reserve[id] || 0) + p.amount;
  } else if (p.kind === KIND.med) e.meds += p.amount;
  else if (p.kind === KIND.nar) e.nars += p.amount;
  else if (p.kind === KIND.armor) e.armor = Math.min(100, e.armor + p.amount);
  else e.coins += p.amount;
  p.taken = true;
}

export function killAllBots(scene) {
  for (const b of G.bots) if (b.char && b.char.root.parent) scene.remove(b.char.root);
  G.bots.length = 0;
}
