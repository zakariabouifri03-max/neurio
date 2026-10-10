// BLOCK CITY ULTRA — voxel geometry builder (browser vertical slice)
//
// Same architectural language as Voxel/BCUBuildingGenerator.cpp:
// cubic setbacks, cornice bands, corner piers, spandrel slabs, stepped gables,
// rooftop HVAC / stairhouse / antenna masts. No screen-space pixelation anywhere.
//
// Geometry strategy (mirrors the C++ batching contract):
//   one InstancedMesh per palette material -> a few dozen draw calls for the
//   whole district instead of one mesh per cube.

import * as THREE from '../vendor/three.module.js';
import { rng } from './util.js';
import { FLOOR_H } from './city.js';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
export const MAT = {
  CONCRETE: 0, GLASS: 1, GLASSLIT: 2, METAL: 3, DARKMETAL: 4, TRIM: 5,
  ROOF: 6, NEON: 7, ASPHALT: 8, WALK: 9, WOOD: 10, PLASTER: 11, BRICK: 12,
  FOLIAGE: 13, LAMP: 14, TAILLIGHT: 15, HEADLIGHT: 16, TIRE: 17, PAINT: 18,
};

const PALETTE = [
  { name: 'concrete',  color: 0x9a9a96, rough: 0.92, metal: 0.02 },
  { name: 'glass',     color: 0x1a2634, rough: 0.08, metal: 0.9, transparent: true, opacity: 0.82 },
  { name: 'glasslit',  color: 0xffd9a0, rough: 0.1,  metal: 0.5, emissive: 0xffc46b, emissiveIntensity: 0 },
  { name: 'metal',     color: 0x8d949c, rough: 0.42, metal: 0.85 },
  { name: 'darkmetal', color: 0x3c4148, rough: 0.55, metal: 0.8 },
  { name: 'trim',      color: 0xc8c3b6, rough: 0.7,  metal: 0.1 },
  { name: 'roof',      color: 0x4a4a4a, rough: 0.95, metal: 0.0 },
  { name: 'neon',      color: 0xff3b6b, rough: 0.3,  metal: 0.0, emissive: 0xff2f5e, emissiveIntensity: 2.4 },
  { name: 'asphalt',   color: 0x2b2d31, rough: 0.86, metal: 0.03 },
  { name: 'walk',      color: 0x8f8d88, rough: 0.9,  metal: 0.0 },
  { name: 'wood',      color: 0x7a5334, rough: 0.85, metal: 0.0 },
  { name: 'plaster',   color: 0xd8d2c4, rough: 0.88, metal: 0.0 },
  { name: 'brick',     color: 0x8a4a3a, rough: 0.9,  metal: 0.0 },
  { name: 'foliage',   color: 0x3f7a3a, rough: 0.9,  metal: 0.0 },
  { name: 'lamp',      color: 0xfff0c0, rough: 0.3,  metal: 0.0, emissive: 0xffe2a0, emissiveIntensity: 0 },
  { name: 'taillight', color: 0xff2a1a, rough: 0.35, metal: 0.0, emissive: 0xff1a0a, emissiveIntensity: 1.6 },
  { name: 'headlight', color: 0xfff6e0, rough: 0.2,  metal: 0.0, emissive: 0xfff2d0, emissiveIntensity: 0 },
  { name: 'tire',      color: 0x15161a, rough: 0.95, metal: 0.0 },
  { name: 'paint',     color: 0x2a5fd6, rough: 0.18, metal: 0.55 },
];

export const EMITTING = new Set([MAT.GLASSLIT, MAT.NEON, MAT.LAMP, MAT.TAILLIGHT, MAT.HEADLIGHT]);

// ---------------------------------------------------------------------------
// Box collector
// ---------------------------------------------------------------------------
class Boxes {
  constructor() { this.list = []; this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpC = new THREE.Color(); }
  add(mat, x, y, z, sx, sy, sz, tint = null, rotY = 0) {
    this.list.push({ m: mat, x, y, z, sx, sy, sz, tint, rotY });
  }
  count(mat) { let n = 0; for (const b of this.list) if (b.m === mat) n++; return n; }
}

function makeMaterials(textures) {
  return PALETTE.map((p, i) => {
    const params = {
      color: p.color, roughness: p.rough, metalness: p.metal,
      map: i === MAT.GLASS || i === MAT.GLASSLIT ? textures.windows : (i === MAT.ASPHALT ? textures.road : null),
      emissive: p.emissive ?? 0x000000,
      emissiveMap: i === MAT.GLASSLIT ? textures.windows : null,
      emissiveIntensity: p.emissiveIntensity ?? 1,
    };
    if (p.transparent) { params.transparent = true; params.opacity = p.opacity; }
    const m = new THREE.MeshStandardMaterial(params);
    m.name = p.name;
    return m;
  });
}

// ---------------------------------------------------------------------------
// Procedural textures (windows + asphalt lane markings)
// ---------------------------------------------------------------------------
function makeTextures(THREE_) {
  // --- window grid: 4 x 3 module, aligned to the voxel grid --------------------
  const wc = document.createElement('canvas');
  wc.width = wc.height = 128;
  const g = wc.getContext('2d');
  g.fillStyle = '#0d141f'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffffff';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 3; x++) {
      g.fillRect(6 + x * 40, 8 + y * 30, 30, 20);
    }
  }
  const windows = new THREE.CanvasTexture(wc);
  windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
  windows.colorSpace = THREE.SRGBColorSpace;

  // --- asphalt with a dashed centre line --------------------------------------
  const ac = document.createElement('canvas');
  ac.width = ac.height = 64;
  const a = ac.getContext('2d');
  a.fillStyle = '#2b2d31'; a.fillRect(0, 0, 64, 64);
  a.fillStyle = '#3a3d42';
  for (let i = 0; i < 64; i += 4) {
    a.globalAlpha = 0.25 + Math.random() * 0.25;
    a.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  a.globalAlpha = 1;
  a.fillStyle = '#d8d2b0';
  a.fillRect(31, 0, 3, 26);
  const road = new THREE.CanvasTexture(ac);
  road.wrapS = road.wrapT = THREE.RepeatWrapping;
  road.colorSpace = THREE.SRGBColorSpace;

  return { windows, road };
}

// ---------------------------------------------------------------------------
// Building generators
// ---------------------------------------------------------------------------
function tower(B, b) {
  const R = rng(b.seed);
  let w = b.w, d = b.d;
  const setbackEvery = Math.max(4, Math.round(b.floors / 5));
  let y = 0;
  let topW = w, topD = d, topX = b.x, topZ = b.z;

  for (let f = 0; f < b.floors; f++) {
    if (f > 0 && f % setbackEvery === 0 && R.chance(0.6)) {
      const inset = Math.max(1.2, w * 0.09);
      w -= inset * 2; d -= inset * 2;
      if (w < 5 || d < 5) break;
      // cornice band: the signature voxel step
      B.add(MAT.TRIM, b.x, y + 0.25, b.z, w + inset * 2.4, 0.7, d + inset * 2.4);
      y += 0.7;
    }

    // floor slab
    B.add(MAT.CONCRETE, b.x, y + 0.25, b.z, w, 0.5, d);

    // glass band (inset so the slab + piers read as a voxel frame)
    const lit = R.chance(f < 2 ? 0.9 : 0.45);
    B.add(lit ? MAT.GLASSLIT : MAT.GLASS, b.x, y + FLOOR_H * 0.5, b.z,
      w - 1.1, FLOOR_H - 0.75, d - 1.1);

    // corner piers
    const px = w * 0.5 - 0.55, pz = d * 0.5 - 0.55;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B.add(MAT.CONCRETE, b.x + sx * px, y + FLOOR_H * 0.5, b.z + sz * pz,
        1.1, FLOOR_H - 0.4, 1.1);
    }

    // balcony
    if (f > 1 && R.chance(0.14)) {
      const side = R.i(0, 3);
      const off = R.r(0.2, 0.5);
      if (side === 0) B.add(MAT.CONCRETE, b.x, y + FLOOR_H * 0.55, b.z - d * 0.5 - 0.9, w * 0.6, 0.35, 1.8);
      else if (side === 1) B.add(MAT.CONCRETE, b.x, y + FLOOR_H * 0.55, b.z + d * 0.5 + 0.9, w * 0.6, 0.35, 1.8);
      else if (side === 2) B.add(MAT.CONCRETE, b.x - w * 0.5 - 0.9, y + FLOOR_H * 0.55, b.z, 1.8, 0.35, d * 0.6);
      else B.add(MAT.CONCRETE, b.x + w * 0.5 + 0.9, y + FLOOR_H * 0.55, b.z, 1.8, 0.35, d * 0.6);
      void off;
    }

    y += FLOOR_H;
    topW = w; topD = d; topX = b.x; topZ = b.z;
  }

  // roof + parapet
  B.add(MAT.ROOF, topX, y + 0.3, topZ, topW, 0.6, topD);
  B.add(MAT.CONCRETE, topX, y + 1.2, topZ - topD * 0.5 + 0.3, topW, 1.6, 0.6);
  B.add(MAT.CONCRETE, topX, y + 1.2, topZ + topD * 0.5 - 0.3, topW, 1.6, 0.6);
  B.add(MAT.CONCRETE, topX - topW * 0.5 + 0.3, y + 1.2, topZ, 0.6, 1.6, topD);
  B.add(MAT.CONCRETE, topX + topW * 0.5 - 0.3, y + 1.2, topZ, 0.6, 1.6, topD);

  roofClutter(B, R, topX, topZ, y + 0.6, topW, topD, b);

  // street level shopfront
  if (b.floors > 2) {
    B.add(MAT.GLASSLIT, b.x, 1.6, b.z + b.d * 0.5 + 0.35, b.w * 0.8, 2.6, 0.5);
    B.add(MAT.TRIM, b.x, 3.1, b.z + b.d * 0.5 + 0.7, b.w * 0.85, 0.3, 1.6);
    if (R.chance(0.55)) B.add(MAT.NEON, b.x, 3.6, b.z + b.d * 0.5 + 0.75, b.w * 0.7, 0.45, 0.35);
  }

  return { height: y + 2.6, w: b.w, d: b.d };
}

function roofClutter(B, R, x, z, y, w, d, b) {
  if (w < 8 || d < 8) return;
  const n = Math.max(1, Math.min(6, Math.round((w * d) / 220)));
  for (let i = 0; i < n; i++) {
    const bw = R.r(1.6, Math.max(2.5, w * 0.18));
    const bd = R.r(1.6, Math.max(2.5, d * 0.18));
    B.add(MAT.METAL, x + R.r(-w * 0.3, w * 0.3), y + R.r(0.6, 1.4), z + R.r(-d * 0.3, d * 0.3), bw, R.r(1.0, 2.2), bd);
  }
  // stairhouse
  B.add(MAT.CONCRETE, x, y + 1.6, z, Math.max(3, w * 0.2), 3.2, Math.max(3, d * 0.2));
  B.add(MAT.DARKMETAL, x, y + 3.4, z, Math.max(3.2, w * 0.21), 0.4, Math.max(3.2, d * 0.21));
  // antenna mast + aircraft light
  if (b.floors > 14) {
    const mh = R.r(6, 16);
    B.add(MAT.METAL, x + w * 0.25, y + 1.5 + mh * 0.5, z + d * 0.25, 0.4, mh, 0.4);
    B.add(MAT.NEON, x + w * 0.25, y + 1.5 + mh, z + d * 0.25, 0.9, 0.9, 0.9, [1, 0.15, 0.2]);
  }
}

function house(B, b) {
  const R = rng(b.seed);
  const floors = Math.max(1, b.floors);
  const h = floors * FLOOR_H * 0.9;
  const wall = R.chance(0.5) ? MAT.PLASTER : MAT.BRICK;

  B.add(MAT.CONCRETE, b.x, 0.2, b.z, b.w, 0.4, b.d);
  B.add(wall, b.x, h * 0.5, b.z, b.w, h, b.d);

  // stepped gable roof (cubic, not a smooth prism)
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    B.add(MAT.WOOD, b.x, h + 0.3 + i * 0.9, b.z,
      b.w * (1 - t * 0.45), 0.9, b.d * (1 - t * 0.45));
  }
  B.add(MAT.DARKMETAL, b.x, h + 0.3 + steps * 0.9, b.z, b.w * 0.12, 0.8, b.d * 0.12);

  // door + windows
  B.add(MAT.WOOD, b.x, 1.1, b.z + b.d * 0.5 + 0.15, 1.4, 2.2, 0.3);
  for (const sx of [-1, 1]) {
    B.add(R.chance(0.7) ? MAT.GLASSLIT : MAT.GLASS, b.x + sx * b.w * 0.28, 1.8, b.z + b.d * 0.5 + 0.1, 1.6, 1.4, 0.25);
  }
  B.add(MAT.WALK, b.x, 0.25, b.z + b.d * 0.5 + 2.2, b.w * 0.6, 0.15, 4.0);
  return { height: h + 3.5, w: b.w, d: b.d };
}

function warehouse(B, b) {
  const R = rng(b.seed);
  const h = Math.max(6, b.floors * FLOOR_H * 1.5);

  B.add(MAT.CONCRETE, b.x, 0.25, b.z, b.w, 0.5, b.d);
  B.add(MAT.METAL, b.x, h * 0.5, b.z, b.w, h, b.d);

  // corrugated banding: horizontal voxel courses
  for (let y = 1.5; y < h; y += 2.4) {
    B.add(MAT.DARKMETAL, b.x, y, b.z, b.w + 0.15, 0.35, b.d + 0.15);
  }

  // roller doors + signage
  const doors = Math.max(1, Math.floor(b.w / 12));
  for (let i = 0; i < doors; i++) {
    const dx = b.x - b.w * 0.5 + (i + 0.5) * (b.w / doors);
    B.add(MAT.DARKMETAL, dx, 2.4, b.z + b.d * 0.5 + 0.15, b.w / doors * 0.6, 4.6, 0.4);
    B.add(MAT.NEON, dx, 5.2, b.z + b.d * 0.5 + 0.2, b.w / doors * 0.55, 0.5, 0.2);
  }

  // sawtooth roof lights
  for (let z = -b.d * 0.4; z < b.d * 0.4; z += 8) {
    B.add(MAT.METAL, b.x, h + 0.6, b.z + z, b.w * 0.9, 0.7, 3.0);
  }
  roofClutter(B, R, b.x, b.z, h, b.w, b.d, b);

  return { height: h + 2, w: b.w, d: b.d };
}

function gasStation(B, b) {
  const R = rng(b.seed);
  B.add(MAT.CONCRETE, b.x, 0.25, b.z, b.w, 0.5, b.d);
  // canopy + pumps
  B.add(MAT.METAL, b.x, 5.0, b.z, b.w * 0.9, 0.6, b.d * 0.7);
  for (const sx of [-1, 1]) {
    B.add(MAT.CONCRETE, b.x + sx * b.w * 0.3, 2.5, b.z, 1.4, 5.0, 1.4);
  }
  for (const sx of [-1, 0, 1]) {
    B.add(MAT.DARKMETAL, b.x + sx * b.w * 0.22, 1.0, b.z, 1.0, 2.0, 0.8);
    B.add(MAT.NEON, b.x + sx * b.w * 0.22, 2.1, b.z, 0.9, 0.35, 0.85);
  }
  B.add(MAT.GLASSLIT, b.x, 1.8, b.z - b.d * 0.35, b.w * 0.35, 2.6, b.d * 0.25);
  void R;
  return { height: 6, w: b.w, d: b.d };
}

// ---------------------------------------------------------------------------
// Roads, sidewalks, street furniture
// ---------------------------------------------------------------------------
function buildRoads(B, layout) {
  const { segs, road } = layout.roads;
  for (const s of segs) {
    const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const ang = Math.atan2(dz, dx);
    const cx = (s.a.x + s.b.x) * 0.5, cz = (s.a.z + s.b.z) * 0.5;
    const wdt = s.highway ? road * 1.7 : road;

    B.add(MAT.ASPHALT, cx, 0.06, cz, len, 0.12, wdt, null, -ang);
    // sidewalks either side
    const nx = -dz / len, nz = dx / len;
    const off = wdt * 0.5 + 3.2;
    B.add(MAT.WALK, cx + nx * off, 0.22, cz + nz * off, len, 0.4, 6.0, null, -ang);
    B.add(MAT.WALK, cx - nx * off, 0.22, cz - nz * off, len, 0.4, 6.0, null, -ang);

    // streetlights every ~34 m
    const count = Math.floor(len / 34);
    for (let i = 0; i <= count; i++) {
      const t = count ? i / count : 0.5;
      const px = s.a.x + dx * t, pz = s.a.z + dz * t;
      const side = (i % 2 === 0) ? 1 : -1;
      const lx = px + nx * off * side * 1.15, lz = pz + nz * off * side * 1.15;
      B.add(MAT.DARKMETAL, lx, 4.0, lz, 0.45, 8.0, 0.45);
      B.add(MAT.LAMP, lx - nx * side * 1.2, 7.9, lz - nz * side * 1.2, 1.8, 0.5, 0.9, null, -ang);
    }
  }
}

// ---------------------------------------------------------------------------
// Public: build the whole district
// ---------------------------------------------------------------------------
export function buildCity(scene, layout, opts = {}) {
  const B = new Boxes();
  const colliders = [];
  const interiors = [];

  // roads & furniture
  buildRoads(B, layout);

  // buildings
  for (const b of layout.buildings) {
    let info;
    switch (b.archetype) {
      case 'House': case 'Mansion': info = house(B, b); break;
      case 'Warehouse': case 'Factory': case 'Hangar': case 'Garage': info = warehouse(B, b); break;
      case 'GasStation': info = gasStation(B, b); break;
      default: info = tower(B, b);
    }
    colliders.push({ x: b.x, z: b.z, hw: b.w * 0.5 + 0.4, hd: b.d * 0.5 + 0.4, h: info.height });
    if (b.enterable) interiors.push({ x: b.x, z: b.z, w: b.w, d: b.d, name: b.archetype });
  }

  // trees / greenery
  const green = layout.cfg.green;
  if (green > 0.1) {
    const R = rng(99);
    const n = Math.round(green * 260);
    for (let i = 0; i < n; i++) {
      const a = R.r(0, Math.PI * 2), r = R.r(0, layout.bounds.radius * 0.95);
      const x = layout.bounds.cx + Math.cos(a) * r, z = layout.bounds.cy + Math.sin(a) * r;
      B.add(MAT.WOOD, x, 1.6, z, 0.7, 3.2, 0.7);
      B.add(MAT.FOLIAGE, x, 4.4, z, R.r(3.4, 5.6), R.r(3.0, 4.6), R.r(3.4, 5.6));
    }
  }

  // ---- instantiate ------------------------------------------------------------
  const textures = makeTextures(THREE);
  const materials = makeMaterials(textures);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const group = new THREE.Group();
  group.name = 'VoxelCity';

  const meshes = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const v = new THREE.Vector3();

  for (let m = 0; m < materials.length; m++) {
    const n = B.count(m);
    if (!n) { meshes.push(null); continue; }
    const im = new THREE.InstancedMesh(geo, materials[m], n);
    im.name = PALETTE[m].name;
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    im.castShadow = m !== MAT.ASPHALT && m !== MAT.LAMP;
    im.receiveShadow = true;
    im.frustumCulled = false;   // the whole city is one instance batch

    let idx = 0;
    for (const box of B.list) {
      if (box.m !== m) continue;
      e.set(0, box.rotY || 0, 0);
      q.setFromEuler(e);
      v.set(box.sx, box.sy, box.sz);
      m4.compose(new THREE.Vector3(box.x, box.y, box.z), q, v);
      im.setMatrixAt(idx, m4);
      if (box.tint) col.setRGB(box.tint[0], box.tint[1], box.tint[2]);
      else col.setScalar(0.86 + ((box.x * 7 + box.z * 13) % 11) * 0.022);   // subtle dirt variation
      im.setColorAt(idx, col);
      idx++;
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    meshes.push(im);
    group.add(im);
  }

  scene.add(group);

  return {
    group, meshes, materials, colliders, interiors,
    stats: {
      boxes: B.list.length,
      drawCalls: meshes.filter(Boolean).length,
      buildings: layout.buildings.length,
      roadSegments: layout.roads.segs.length,
    },
  };
}

// Night lighting: drive the emissive materials from the environment system.
export function setNightFactor(city, t) {
  const lit = city.materials[MAT.GLASSLIT];
  const lamp = city.materials[MAT.LAMP];
  const neon = city.materials[MAT.NEON];
  if (lit) { lit.emissiveIntensity = 0.15 + t * 2.6; lit.color.setHex(t > 0.5 ? 0xffd9a0 : 0x2a3340); }
  if (lamp) lamp.emissiveIntensity = t * 3.4;
  if (neon) neon.emissiveIntensity = 1.2 + t * 2.2;
}

export function setWetness(city, wet) {
  const road = city.materials[MAT.ASPHALT];
  if (road) { road.roughness = 0.86 - wet * 0.72; road.metalness = 0.03 + wet * 0.55; }
  const walk = city.materials[MAT.WALK];
  if (walk) { walk.roughness = 0.9 - wet * 0.5; }
}
