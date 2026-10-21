import * as THREE from 'three';
import { G, tier } from './state.js';
import { Rand } from './util.js';
import { mat, getTex } from './tex.js';
import { GUNS, gunByName } from './weapons.js';

// ══════════════════════════════════════════════════════════════
//  LOOT — crates, gun cases, ammo, medkits, armor, grenades, coins.
//  ALL of it renders through ~12 InstancedMeshes with swap-remove
//  compaction, so 200 items on the ground cost a dozen draw calls
//  instead of six hundred.
// ══════════════════════════════════════════════════════════════

export const KIND = { gun: 'gun', ammo: 'ammo', med: 'med', armor: 'armor', nar: 'nar', coins: 'coins' };
const TIER_COLOR = { 1: 0xbfd4e6, 2: 0x63d3ff, 3: 0xffb03a };
export const gunTierColor = (id) => (GUNS[id] ? TIER_COLOR[GUNS[id].tier] || TIER_COLOR[1] : TIER_COLOR[1]);

// ── shared geometries ──────────────────────────────────────────
const GEOS = {};
function geos() {
  if (GEOS.box) return GEOS;
  GEOS.box = new THREE.BoxGeometry(1, 1, 1);
  GEOS.sphere = new THREE.SphereGeometry(0.5, G.tier === 0 ? 7 : 10, G.tier === 0 ? 5 : 7);
  GEOS.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, G.tier === 0 ? 8 : 12);
  GEOS.beam = new THREE.CylinderGeometry(0.16, 0.5, 5, G.tier === 0 ? 6 : 8, 1, true);
  return GEOS;
}

const MATS = {};
function mats() {
  if (MATS.dark) return MATS;
  const std = G.tier > 0;
  const mk = (o) => (std ? new THREE.MeshStandardMaterial(o) : new THREE.MeshLambertMaterial(o));
  MATS.dark = mk({ color: 0x2c3138, roughness: .55, metalness: .5 });
  MATS.glow = mk({ color: 0xffffff, roughness: .3, metalness: .2, emissive: 0xffffff, emissiveIntensity: .55 });
  MATS.camo = mk({ map: getTex('camo'), color: 0xffffff, roughness: .95 });
  MATS.gold = mk({ color: 0xd9a13a, roughness: .4, metalness: .6 });
  MATS.white = mk({ color: 0xf2f2ee, roughness: .6 });
  MATS.red = mk({ color: 0xe0342a, roughness: .5, emissive: 0x5c0d08, emissiveIntensity: .5 });
  MATS.blue = mk({ color: 0x2b5fa8, roughness: .5, metalness: .35 });
  MATS.plate = mk({ color: 0x9fc4ff, roughness: .3, metalness: .6, emissive: 0x1d4a80, emissiveIntensity: .7 });
  MATS.green = mk({ color: 0x3d5a30, roughness: .6, metalness: .3 });
  MATS.coin = mk({ color: 0xffd45e, roughness: .25, metalness: .85, emissive: 0x6b4a00, emissiveIntensity: .6 });
  MATS.beam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
  return MATS;
}

// part = {geo, mat, p:[x,y,z], s:[sx,sy,sz], r:[rx,ry,rz], tint, beam}
const PARTS = {
  gun: [
    { geo: 'box', mat: 'dark', p: [0, 0, 0], s: [0.88, 0.24, 0.42] },
    { geo: 'box', mat: 'glow', p: [0, 0.14, 0], s: [0.9, 0.07, 0.45], tint: 'tier' },
    { geo: 'beam', mat: 'beam', p: [0, 2.6, 0], s: [1, 1, 1], tint: 'tier', beam: true, hi: true },
  ],
  ammo: [
    { geo: 'box', mat: 'camo', p: [0, 0, 0], s: [0.44, 0.28, 0.32] },
    { geo: 'box', mat: 'gold', p: [0, 0.02, 0], s: [0.46, 0.08, 0.34] },
  ],
  med: [
    { geo: 'box', mat: 'white', p: [0, 0, 0], s: [0.42, 0.26, 0.34] },
    { geo: 'box', mat: 'red', p: [0, 0.14, 0], s: [0.24, 0.02, 0.08] },
    { geo: 'box', mat: 'red', p: [0, 0.14, 0], s: [0.08, 0.02, 0.24] },
  ],
  armor: [
    { geo: 'box', mat: 'blue', p: [0, 0, 0], s: [0.46, 0.52, 0.22] },
    { geo: 'box', mat: 'plate', p: [0, 0, 0.13], s: [0.3, 0.3, 0.05] },
    { geo: 'beam', mat: 'beam', p: [0, 2.6, 0], s: [1, 1, 1], tint: 0x63d3ff, beam: true, hi: true },
  ],
  nar: [
    { geo: 'sphere', mat: 'green', p: [0, 0, 0], s: [0.38, 0.38, 0.38] },
    { geo: 'cyl', mat: 'gold', p: [0, 0.22, 0], s: [0.12, 0.1, 0.12] },
  ],
  coins: [
    { geo: 'cyl', mat: 'coin', p: [0, 0, 0], s: [0.4, 0.06, 0.4], r: [Math.PI / 2, 0, 0] },
  ],
};

// ── the renderer ───────────────────────────────────────────────
let rig = null;
const CAP = 260;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
  _v = new THREE.Vector3(), _sc = new THREE.Vector3(), _pm = new THREE.Matrix4(), _col = new THREE.Color();

function buildRig(scene) {
  geos(); mats();
  const r = { scene, kinds: {}, parts: [] };
  for (const kind of Object.keys(PARTS)) {
    r.kinds[kind] = { items: [], parts: [] };
    for (const part of PARTS[kind]) {
      if (part.hi && G.tier === 0) continue;             // no light beams on weak phones
      const im = new THREE.InstancedMesh(GEOS[part.geo], MATS[part.mat], CAP);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = tier().shadows && !part.beam;
      im.count = 0;
      if (part.tint !== undefined) {
        // per-instance tint (three defines USE_COLOR from instanceColor alone)
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      scene.add(im);
      const rec = { im, part, kind };
      r.parts.push(rec);
      r.kinds[kind].parts.push(rec);
    }
  }
  return r;
}

export function initLootRenderer(scene) {
  if (rig) disposeLootRenderer();
  rig = buildRig(scene);
}
export function disposeLootRenderer() {
  if (!rig) return;
  rig.parts.forEach((p) => { rig.scene.remove(p.im); p.im.dispose(); });
  rig = null;
}

const MAX_TOTAL = 300;
export function spawnLoot(scene, opts) {
  if (!rig) initLootRenderer(scene);
  const kind = opts.kind;
  if (rig.kinds[kind].items.length >= CAP || G.pickups.length >= MAX_TOTAL) return null;
  const item = {
    kind, gun: opts.gun || null, amount: opts.amount || 0,
    x: opts.x, y: opts.y, z: opts.z, taken: false,
    t: Math.random() * 6.283, label: opts.label || '',
    tierColor: kind === KIND.gun ? gunTierColor(opts.gun) : (kind === KIND.armor ? 0x63d3ff : 0xffd45e),
    slot: -1,
  };
  const list = rig.kinds[kind].items;
  item.slot = list.push(item) - 1;
  G.pickups.push(item);
  return item;
}

/** remove an item from its kind list by swapping the last one into its slot */
function compact(item) {
  const list = rig.kinds[item.kind].items;
  const i = item.slot;
  if (i < 0 || i >= list.length || list[i] !== item) return;
  const last = list.pop();
  if (last !== item) { list[i] = last; last.slot = i; }
  item.slot = -1;
}

export function updateLoot(dt, playerPos, out) {
  out.nearest = null; out.nearestD = 2.2;
  if (!rig) return;
  const pl = G.player;
  // nearest search
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const p = G.pickups[i];
    if (p.taken) continue;
    const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
    if (d < out.nearestD && Math.abs(p.y - playerPos.y) < 3.4) {
      if (p.kind === KIND.gun && p.gun === pl.gunId && (pl.ammo[p.gun] || 0) + (pl.reserve[p.gun] || 0) > GUNS[p.gun].mag * 2) continue;
      out.nearest = p; out.nearestD = d;
    }
  }
  // rebuild the instance buffers
  for (const kind of Object.keys(rig.kinds)) {
    const K = rig.kinds[kind];
    const items = K.items;
    for (let i = 0; i < items.length; i++) items[i].t += dt;
    for (const rec of K.parts) {
      const part = rec.part, im = rec.im;
      im.count = Math.min(items.length, CAP);
      for (let i = 0; i < im.count; i++) {
        const it = items[i];
        const bob = Math.sin(it.t * 2.1) * 0.09;
        _e.set(part.r ? part.r[0] : 0, it.t * 1.5 + (part.r ? part.r[1] : 0), part.r ? part.r[2] : 0);
        _q.setFromEuler(_e);
        _v.set(it.x, it.y + 0.4 + bob + (part.p[1]), it.z);
        _sc.set(part.s[0], part.s[1], part.s[2]);
        _m.compose(_v, _q, _sc);
        im.setMatrixAt(i, _m);
        if (im.instanceColor) {
          _col.setHex(part.tint === 'tier' ? it.tierColor : (typeof part.tint === 'number' ? part.tint : 0xffffff));
          im.setColorAt(i, _col);
        }
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

export function takeLoot(p) {
  if (!p || p.taken) return '';
  const pl = G.player;
  let msg = '';
  if (p.kind === KIND.gun) {
    const g = GUNS[p.gun];
    msg = `${g.name}  +${g.mag}`;
    pl.gunId = p.gun;
    pl.ammo[p.gun] = (pl.ammo[p.gun] || 0) + g.mag;
    pl.reserve[p.gun] = (pl.reserve[p.gun] || 0) + Math.round(g.reserve * 0.45);
    pl.mag = g.mag;
    pl.reloading = 0;
    G.ui.equipGun && G.ui.equipGun(pl, p.gun);
    G.ui.sfx && G.ui.sfx('pickup', 1);
  } else if (p.kind === KIND.ammo) {
    const id = pl.gunId === 'fists' ? 'pistol' : pl.gunId;
    pl.reserve[id] = (pl.reserve[id] || 0) + p.amount;
    msg = `+${p.amount} ذخيرة`;
    G.ui.sfx && G.ui.sfx('pickup', 0.8);
  } else if (p.kind === KIND.med) {
    pl.meds += p.amount; msg = `🩹 +${p.amount}`;
    G.ui.sfx && G.ui.sfx('pickup', 0.9);
  } else if (p.kind === KIND.nar) {
    pl.nars += p.amount; msg = `💥 +${p.amount}`;
    G.ui.sfx && G.ui.sfx('pickup', 0.9);
  } else if (p.kind === KIND.armor) {
    pl.armor = Math.min(100, pl.armor + p.amount);
    msg = `🛡 armor ${Math.round(pl.armor)}`;
    G.ui.sfx && G.ui.sfx('armor', 1);
  } else {
    pl.coins += p.amount; msg = `🪙 +${p.amount}`;
    G.ui.sfx && G.ui.sfx('coin', 1);
  }
  p.taken = true;
  compact(p);
  const i = G.pickups.indexOf(p);
  if (i >= 0) G.pickups.splice(i, 1);
  G.ui.toast && G.ui.toast(msg);
  return msg;
}

/** scatter loot across the island using the world's loot spots */
export function scatterLoot(scene, world, rnd) {
  if (!rig) initLootRenderer(scene);
  const spots = world.lootSpots.slice();
  for (let i = spots.length - 1; i > 0; i--) { const j = rnd.int(0, i); const t = spots[i]; spots[i] = spots[j]; spots[j] = t; }
  const max = G.tier === 0 ? 110 : G.tier === 1 ? 165 : 210;
  let n = 0;
  for (const s of spots) {
    if (n >= max) break;
    const rolls = s.inside ? 3 : rnd.chance(0.7) ? 2 : 1;
    for (let k = 0; k < rolls && n < max; k++) {
      const a = rnd.range(0, 6.283), rr = rnd.range(0.2, s.inside ? 2.0 : 1.4);
      const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
      const y = s.high ? s.y : world.heightAt(x, z);
      if (!s.high && y < 0.5) continue;
      const roll = rnd.n();
      if (roll < 0.33) {
        const r2 = rnd.n();
        const id = r2 < 0.3 ? 'pistol' : r2 < 0.6 ? 'smg' : r2 < 0.84 ? 'rifle' : r2 < 0.95 ? 'shotgun' : 'sniper';
        spawnLoot(scene, { kind: KIND.gun, gun: id, x, y, z, label: GUNS[id].name });
      } else if (roll < 0.57) spawnLoot(scene, { kind: KIND.ammo, amount: rnd.int(24, 60), x, y, z });
      else if (roll < 0.73) spawnLoot(scene, { kind: KIND.med, amount: 1, x, y, z });
      else if (roll < 0.85) spawnLoot(scene, { kind: KIND.armor, amount: rnd.int(40, 100), x, y, z });
      else if (roll < 0.93) spawnLoot(scene, { kind: KIND.nar, amount: rnd.int(1, 2), x, y, z });
      else spawnLoot(scene, { kind: KIND.coins, amount: rnd.int(5, 30), x, y, z });
      n++;
    }
  }
  const openCoins = G.tier === 0 ? 26 : 60;
  for (let i = 0; i < openCoins; i++) {
    const p = rnd.pick(world.landPoints);
    if (!p || p.h < 1) continue;
    spawnLoot(scene, { kind: KIND.coins, amount: rnd.int(2, 9), x: p.x, y: p.h, z: p.z });
  }
  return n;
}

export function clearLoot(scene) {
  G.pickups.length = 0;
  if (!rig) return;
  for (const kind of Object.keys(rig.kinds)) {
    rig.kinds[kind].items.length = 0;
    rig.kinds[kind].parts.forEach((rec) => { rec.im.count = 0; rec.im.instanceMatrix.needsUpdate = true; });
  }
}

export function dropLootFrom(entity, scene, rnd) {
  const { x, y, z } = entity.pos;
  if (entity.gunId && entity.gunId !== 'fists')
    spawnLoot(scene, { kind: KIND.gun, gun: entity.gunId, x: x + rnd.range(-.6, .6), y, z: z + rnd.range(-.6, .6), label: gunByName(entity.gunId).name });
  spawnLoot(scene, { kind: KIND.ammo, amount: Math.round(((entity.reserve && entity.reserve[entity.gunId]) || 30) * 0.5) + 12, x: x + rnd.range(-.9, .9), y, z: z + rnd.range(-.9, .9) });
  if (entity.meds > 0) spawnLoot(scene, { kind: KIND.med, amount: entity.meds, x: x + rnd.range(-1, 1), y, z: z + rnd.range(-1, 1) });
  if (entity.armor > 20) spawnLoot(scene, { kind: KIND.armor, amount: Math.round(entity.armor * 0.7), x: x + rnd.range(-1, 1), y, z: z + rnd.range(-1, 1) });
  if (rnd.chance(0.55)) spawnLoot(scene, { kind: KIND.coins, amount: rnd.int(8, 26), x: x + rnd.range(-1.2, 1.2), y, z: z + rnd.range(-1.2, 1.2) });
}

export const lootCount = () => G.pickups.length;
