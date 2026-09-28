// city.js — procedural architecture, harbour, landmarks & vegetation generators
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { xf, colorGeo, roundedBox, clamp, lerp, rand, pick, TAU, ctx2d, texFromCanvas, mulberry32 } from './util.js';

/* ------------------------------------------------------------------ mesher */
export class Mesher {
  constructor() { this.parts = new Map(); }
  add(key, geo) {
    if (!geo) return;
    // A single non-finite vertex gives the merged geometry a NaN bounding sphere, and
    // three then culls the WHOLE bucket (all trees / all buildings of that material).
    // Scrub it here and shout, so a generator bug shows up as a warning instead of a
    // silently empty world.
    const pos = geo.attributes && geo.attributes.position;
    if (pos) {
      const a = pos.array;
      let bad = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== a[i] || a[i] === Infinity || a[i] === -Infinity) { a[i] = 0; bad++; }
      }
      if (bad) console.warn(`Mesher: ${bad} non-finite vertex value(s) in "${key}" — scrubbed`);
      const nrm = geo.attributes.normal;
      if (nrm) {
        const na = nrm.array;
        let nbad = 0;
        for (let i = 0; i < na.length; i += 3) {
          if (!Number.isFinite(na[i]) || !Number.isFinite(na[i + 1]) || !Number.isFinite(na[i + 2])) {
            na[i] = 0; na[i + 1] = 1; na[i + 2] = 0; nbad++;
          }
        }
        if (nbad) console.warn(`Mesher: ${nbad} non-finite normal(s) in "${key}" — reset`);
      }
    }
    // every bucket must be uniformly indexed or mergeGeometries bails out
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    let a = this.parts.get(key);
    if (!a) { a = []; this.parts.set(key, a); }
    a.push(geo);
  }
  stats() { let n = 0; for (const a of this.parts.values()) n += a.length; return n; }
  finalize(mats, parent, { castShadow = true, receiveShadow = true, name = 'merged' } = {}) {
    const out = [];
    for (const [key, geos] of this.parts) {
      const mat = mats[key];
      if (!mat) { console.warn('Mesher: missing material', key); continue; }
      let merged;
      try { merged = mergeGeometries(geos, false); } catch (e) { console.warn('merge failed', key, e); continue; }
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}_${key}`;
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/* --------------------------------------------------------------- primitives */
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

function box(ctx, key, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], geo = null, w = 1, h = 1, d = 1, round = 0 } = {}) {
  const g = geo || (round ? roundedBox(w, h, d, Math.min(round, Math.min(w, h, d) * 0.4)) : B(w, h, d));
  ctx.m.add(key, xf(colorGeo(g, color), { pos, rot, scale }));
}

/* planks: horizontal boards forming a slab (wood, cheap detail) */
function plankSlab(ctx, key, color, { w, d, y, count = 4, thick = 0.06, rot = [0, 0, 0], origin = [0, 0, 0] }) {
  const step = d / count;
  for (let i = 0; i < count; i++) {
    const z = -d / 2 + step * (i + 0.5);
    const c = new THREE.Color(color).offsetHSL(0, 0, (i % 2) * 0.02 - 0.01);
    box(ctx, key, c, { pos: [origin[0], y, origin[2] + z], rot, w, h: thick, d: step * 0.92 });
  }
}

/* ---------------------------------------------------------------- windows */
function addWindow(ctx, { x, y, z, rotY = 0, w = 0.9, h = 1.35, shutters = true, color = 0x1c2b33, sill = 0xa9a29a }) {
  const r = [0, rotY, 0];
  const cand = Math.cos(rotY), sand = Math.sin(rotY);
  const off = (dx, dz) => [x + dx * cand + dz * sand, y, z - dx * sand + dz * cand];
  box(ctx, 'glass', color, { pos: off(0, 0.02), rot: r, w, h, d: 0.10 });
  box(ctx, 'wood', sill, { pos: off(0, -h / 2 - 0.06), rot: r, w: w + 0.22, h: 0.10, d: 0.22 });
  if (shutters) {
    const sc = new THREE.Color().setHSL(0.06 + Math.random() * 0.03, 0.45, 0.32 + Math.random() * 0.15);
    box(ctx, 'wood', sc, { pos: off(-w / 2 - 0.24, 0), rot: r, w: w * 0.5, h, d: 0.08 });
    box(ctx, 'wood', sc, { pos: off(w / 2 + 0.24, 0), rot: r, w: w * 0.5, h, d: 0.08 });
  }
  box(ctx, 'wood', 0xd8d2c8, { pos: off(0, 0), rot: r, w: w + 0.14, h: 0.06, d: 0.13 });
}

/* ---------------------------------------------------------------- building */
export function addBuilding(ctx, rng, { x, z, y, w, d, floors, rot = 0, style = 'tile', color, entrances = 1 }) {
  const wallColor = new THREE.Color(color !== undefined ? color : 0);
  if (color === undefined) wallColor.setHSL(pick(rng, [0.09, 0.11, 0.07, 0.05, 0.13]), 0.32 + rng() * 0.22, 0.62 + rng() * 0.26);
  const fh = 3.2;
  const H = floors * fh;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const toWorld = (lx, lz) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];

  // body (slightly larger ground floor = shop level)
  box(ctx, 'plaster', wallColor, { pos: [x, y + H / 2, z], rot: [0, rot, 0], w, h: H, d });
  // foundation
  box(ctx, 'rock', new THREE.Color(0x6f6a62), { pos: [x, y - 0.35, z], rot: [0, rot, 0], w: w + 0.3, h: 0.9, d: d + 0.3 });

  // ---- roof
  if (style === 'tile') {
    const rh = 1.5 + w * 0.12;
    const roofC = new THREE.Color().setHSL(0.03 + rng() * 0.02, 0.5, 0.28 + rng() * 0.08);
    const slope = B(w + 1.0, 0.22, d * 0.62);
    ctx.m.add('tile', xf(colorGeo(slope, roofC), { pos: [x, y + H + rh * 0.45, z + d * 0.24 * cos], rot: [0.55, rot, 0] }));
    ctx.m.add('tile', xf(colorGeo(slope.clone(), roofC), { pos: [x, y + H + rh * 0.45, z - d * 0.24 * cos], rot: [-0.55, rot, 0] }));
    box(ctx, 'tile', roofC, { pos: [x, y + H + rh * 0.5, z], rot: [0, rot, 0], w: w + 1.05, h: 0.3, d: 0.4 });
    box(ctx, 'plaster', wallColor, { pos: [x, y + H + 0.2, z], rot: [0, rot, 0], w: w + 0.4, h: 0.5, d: d + 0.4 });
  } else {
    // flat roof + parapet + tanks
    box(ctx, 'concrete', 0xc9c4ba, { pos: [x, y + H + 0.12, z], rot: [0, rot, 0], w: w + 0.5, h: 0.3, d: d + 0.5 });
    const ph = 0.7, t = 0.22;
    const edges = [[0, (d + 0.5) / 2], [0, -(d + 0.5) / 2], [(w + 0.5) / 2, 0], [-(w + 0.5) / 2, 0]];
    edges.forEach(([ex, ez], i) => {
      const pw = i < 2 ? w + 0.5 : t, pd = i < 2 ? t : d + 0.5;
      const [wx, wz] = toWorld(ex, ez);
      box(ctx, 'concrete', 0xd2cdc3, { pos: [wx, y + H + 0.5, wz], rot: [0, rot, 0], w: pw, h: ph, d: pd });
    });
    if (rng() < 0.75) {
      const [tx, tz] = toWorld(rand(rng, -w * 0.25, w * 0.25), rand(rng, -d * 0.25, d * 0.25));
      box(ctx, 'metal', new THREE.Color(0x8d8f8a), { pos: [tx, y + H + 1.0, tz], geo: CYL(0.55, 0.55, 1.5, 10) });
    }
    if (rng() < 0.5) {
      const [ax, az] = toWorld(rand(rng, -w * 0.3, w * 0.3), rand(rng, -d * 0.3, d * 0.3));
      box(ctx, 'metal', new THREE.Color(0xb9bcb6), { pos: [ax, y + H + 0.55, az], w: 0.9, h: 0.6, d: 0.9 });
    }
    // laundry line
    if (rng() < 0.45) {
      const [px, pz] = toWorld(rand(rng, -w * 0.3, w * 0.3), d * 0.35);
      box(ctx, 'fabric', new THREE.Color().setHSL(rng(), 0.5, 0.7), { pos: [px, y + H + 1.4, pz], rot: [0, rot, 0], w: 0.8, h: 0.9, d: 0.05 });
    }
  }

  // ---- windows on the two long facades
  for (const side of [1, -1]) {
    const cols = Math.max(1, Math.floor(w / 2.4));
    for (let f = 1; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.14) continue;
        const lx = -w / 2 + (w / cols) * (c + 0.5);
        const [wx, wz] = toWorld(lx, (d / 2 + 0.06) * side);
        addWindow(ctx, {
          x: wx, y: y + f * fh + 1.5, z: wz, rotY: rot + (side > 0 ? 0 : Math.PI),
          w: 0.85 + rng() * 0.25, h: 1.25 + rng() * 0.35, shutters: rng() < 0.6,
        });
      }
    }
  }
  // ---- shop front on the ground floor
  if (rng() < 0.65) {
    const [dx, dz] = toWorld(0, d / 2 + 0.06);
    box(ctx, 'wood', new THREE.Color().setHSL(0.07, 0.4, 0.25), { pos: [dx, y + 1.15, dz], rot: [0, rot, 0], w: 1.2, h: 2.3, d: 0.16 });
    // awning
    const aw = w * 0.7;
    const [ax, az] = toWorld(0, d / 2 + 1.0);
    const ac = new THREE.Color().setHSL(pick(rng, [0.0, 0.55, 0.12, 0.33]), 0.62, 0.45);
    ctx.m.add('fabric', xf(colorGeo(B(aw, 0.08, 2.0), ac), { pos: [ax, y + 2.6, az], rot: [-0.22, rot, 0] }));
    for (const s of [-1, 1]) {
      const [sx, sz] = toWorld(s * aw / 2, d / 2 + 1.9);
      box(ctx, 'metal', 0x8a8a86, { pos: [sx, y + 1.35, sz], geo: CYL(0.05, 0.05, 2.6, 6) });
    }
    // crates
    for (let i = 0; i < 3; i++) {
      const [cx2, cz2] = toWorld(rand(rng, -w / 2 + 0.6, w / 2 - 0.6), d / 2 + rand(rng, 0.8, 1.5));
      box(ctx, 'wood', new THREE.Color().setHSL(0.08, 0.35, 0.35 + rng() * 0.15), { pos: [cx2, y + 0.28, cz2], rot: [0, rot + rand(rng, -0.4, 0.4), 0], w: 0.6, h: 0.55, d: 0.6, round: 0.04 });
    }
  }
  // side entrance
  if (entrances > 0 && rng() < 0.4) {
    const [sx, sz] = toWorld(w / 2 + 0.06, rand(rng, -d * 0.3, d * 0.3));
    box(ctx, 'wood', 0x5b3f2a, { pos: [sx, y + 1.05, sz], rot: [0, rot + Math.PI / 2, 0], w: 1.0, h: 2.1, d: 0.14 });
  }
  // satellite dish
  if (rng() < 0.35) {
    const [sx, sz] = toWorld(rand(rng, -w * 0.3, w * 0.3), (d / 2 + 0.3));
    ctx.m.add('metal', xf(colorGeo(CYL(0.32, 0.05, 0.28, 10), 0xd9d4cb), { pos: [sx, y + H + 0.75, sz], rot: [1.2, rot + rand(rng, -0.6, 0.6), 0] }));
  }
  ctx.colliders.push({ cx: x, cz: z, hx: w / 2, hz: d / 2, rot, y0: y, y1: y + H + (style === 'tile' ? 1.6 : 1.2), kind: 'building' });
  return { top: y + H + (style === 'tile' ? 1.6 : 1.2), height: H };
}

/* ------------------------------------------------------------ stone tower */
export function addTower(ctx, rng, { x, z, y, h = 22, r = 3.2, color = 0xd8cdb8, clock = true, balconies = 2 }) {
  ctx.m.add('plaster', xf(colorGeo(CYL(r, r * 1.12, h, 14), color), { pos: [x, y + h / 2, z] }));
  ctx.m.add('plaster', xf(colorGeo(CYL(r * 1.25, r * 1.25, 0.6, 14), 0xc9bda6), { pos: [x, y + h * 0.55, z] }));
  ctx.m.add('tile', xf(colorGeo(CYL(r * 1.45, r * 1.35, 1.8, 14), 0x9c5638), { pos: [x, y + h + 0.9, z] }));
  for (let i = 0; i < balconies; i++) {
    const by = y + h * (0.3 + i * 0.32);
    ctx.m.add('wood', xf(colorGeo(CYL(r * 1.55, r * 1.55, 0.18, 14), 0x6b4a2e), { pos: [x, by, z] }));
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * TAU;
      box(ctx, 'wood', 0x7a5636, { pos: [x + Math.cos(ang) * r * 1.5, by + 0.45, z + Math.sin(ang) * r * 1.5], w: 0.08, h: 0.9, d: 0.08 });
    }
  }
  if (clock) {
    for (let f = 0; f < 4; f++) {
      const a = (f / 4) * TAU;
      const px = x + Math.cos(a) * (r + 0.06), pz = z + Math.sin(a) * (r + 0.06);
      ctx.m.add('concrete', xf(colorGeo(new THREE.CircleGeometry(1.15, 16), 0xf2ecdf), { pos: [px, y + h * 0.86, pz], rot: [0, -a + Math.PI / 2, 0] }));
      box(ctx, 'metal', 0x30302e, { pos: [px + Math.cos(a + 1.5) * 0.5, y + h * 0.86, pz + Math.sin(a + 1.5) * 0.5], w: 0.1, h: 0.8, d: 0.1, rot: [0, -a, 0] });
    }
  }
  ctx.colliders.push({ cx: x, cz: z, hx: r * 1.15, hz: r * 1.15, rot: 0, y0: y, y1: y + h + 1.5, kind: 'tower' });
}

/* ------------------------------------------------------- evacuation tower */
export function addEvacuationTower(ctx, rng, { x, z, y, levels = 5, r = 4.2 }) {
  const stepH = 3.2;
  const H = levels * stepH;
  ctx.m.add('concrete', xf(colorGeo(CYL(r, r * 1.06, 1.2, 12), 0xb9b4ab), { pos: [x, y + 0.6, z] }));
  for (let i = 0; i < levels; i++) {
    const ly = y + 1.2 + i * stepH;
    ctx.m.add('concrete', xf(colorGeo(CYL(r, r * 0.98, 0.35, 12), 0xc4bfb5), { pos: [x, ly, z] }));
    // spiral staircase around the column
    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const a0 = (i * steps + s) / steps * TAU * 1.0 + i * 0.4;
      const px = x + Math.cos(a0) * (r - 1.0), pz = z + Math.sin(a0) * (r - 1.0);
      const sy = ly + (s / steps) * stepH + 0.18;
      box(ctx, 'concrete', 0xc9c4ba, { pos: [px, sy, pz], rot: [0, -a0, 0], w: 2.0, h: 0.22, d: 1.05 });
      ctx.colliders.push({ cx: px, cz: pz, hx: 1.0, hz: 0.55, rot: -a0, y0: sy - 0.11, y1: sy + 0.11, kind: 'step' });
    }
    // railing
    for (let s = 0; s < 24; s++) {
      const a0 = (s / 24) * TAU;
      box(ctx, 'metal', 0x9aa0a6, { pos: [x + Math.cos(a0) * (r + 0.5), y + 1.2 + i * stepH + 0.6, z + Math.sin(a0) * (r + 0.5)], w: 0.06, h: 1.0, d: 0.06 });
    }
  }
  // top platform + shelter
  const topY = y + 1.2 + H;
  ctx.m.add('concrete', xf(colorGeo(CYL(r * 1.45, r * 1.35, 0.5, 12), 0xcac5bb), { pos: [x, topY + 0.25, z] }));
  ctx.m.add('tile', xf(colorGeo(CYL(r * 1.2, r * 1.5, 1.0, 12), 0x9c5638), { pos: [x, topY + 2.4, z] }));
  for (let s = 0; s < 8; s++) {
    const a0 = (s / 8) * TAU;
    box(ctx, 'concrete', 0xcfcac0, { pos: [x + Math.cos(a0) * r * 1.25, topY + 1.6, z + Math.sin(a0) * r * 1.25], w: 0.25, h: 2.6, d: 0.25, rot: [0, -a0, 0] });
  }
  ctx.colliders.push({ cx: x, cz: z, hx: r * 1.4, hz: r * 1.4, rot: 0, y0: topY, y1: topY + 0.5, kind: 'platform' });
  box(ctx, 'metal', 0xff5a3c, { pos: [x, topY + 3.6, z], geo: new THREE.SphereGeometry(0.35, 10, 8) });
  return topY;
}

/* ------------------------------------------------------------- lighthouse */
export function addLighthouse(ctx, rng, { x, z, y, h = 16 }) {
  ctx.m.add('rock', xf(colorGeo(CYL(4.6, 5.6, 5, 12), 0x8a8378), { pos: [x, y + 2.2, z] }));
  ctx.m.add('plaster', xf(colorGeo(CYL(2.0, 2.9, h, 14), 0xf0ece2), { pos: [x, y + 5 + h / 2, z] }));
  for (let i = 0; i < 3; i++) ctx.m.add('plaster', xf(colorGeo(CYL(2.15, 2.25, 1.6, 14), 0xc23b2f), { pos: [x, y + 5 + 2 + i * 4, z] }));
  ctx.m.add('glass', xf(colorGeo(CYL(1.9, 1.9, 2.2, 12), 0x223038), { pos: [x, y + 5 + h + 1.1, z] }));
  ctx.m.add('metal', xf(colorGeo(CYL(2.0, 2.2, 0.5, 12), 0x3d3d3d), { pos: [x, y + 5 + h + 2.4, z] }));
  box(ctx, 'emissive', 0xfff0c0, { pos: [x, y + 5 + h + 1.1, z], geo: new THREE.SphereGeometry(1.1, 10, 8) });
  ctx.lights = ctx.lights || [];
  ctx.lights.push({ type: 'point', x, y: y + 5 + h + 1.1, z, color: 0xffe6a8, intensity: 6, distance: 90 });
}

/* ------------------------------------------------------------------ boats */
export function hullGeometry(len = 7.5, wid = 2.6, dep = 1.2, nl = 10, nw = 6) {
  const verts = [], idx = [], uvs = [];
  for (let i = 0; i <= nl; i++) {
    const u = i / nl;                 // 0 stern → 1 bow
    const taper = Math.pow(Math.max(0, Math.sin(Math.pow(u, 0.85) * Math.PI * 0.94 + 0.06)), 0.62);
    const bowRise = Math.pow(u, 3.2);
    for (let j = 0; j <= nw; j++) {
      const v = j / nw;
      const across = (v * 2 - 1);
      const y = -(dep * (1 - across * across) * (0.85 - 0.25 * bowRise)) + bowRise * dep * 0.9;
      verts.push((u - 0.5) * len, y, across * wid * 0.5 * taper);
      uvs.push(u, v);
    }
  }
  for (let i = 0; i < nl; i++) for (let j = 0; j < nw; j++) {
    const a = i * (nw + 1) + j, b = a + 1, c = a + nw + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function addFishingBoat(ctx, rng, { x, y, z, rot = 0, len = 7.5, color = 0xe8e4da, stripe = 0x2f6fa8, mast = true }) {
  const wid = len * 0.34, dep = len * 0.17;
  const r = [0, rot, 0];
  const hull = colorGeo(hullGeometry(len, wid, dep, 12, 7), 0xffffff);
  ctx.m.add('wood', xf(hull, { pos: [x, y + dep * 0.55, z], rot: r }));
  // sheer stripe / gunwale
  ctx.m.add('wood', xf(colorGeo(B(len * 0.96, 0.18, wid * 0.96), stripe), { pos: [x, y + dep * 0.97, z], rot: r }));
  // deck
  ctx.m.add('wood', xf(colorGeo(B(len * 0.9, 0.1, wid * 0.82), 0xa8865e), { pos: [x, y + dep * 0.72, z], rot: r }));
  // cabin
  const cw = len * 0.3, ch = 1.35, cd = wid * 0.62;
  const cx0 = x + Math.cos(rot) * len * 0.16, cz0 = z - Math.sin(rot) * len * 0.16;
  box(ctx, 'plaster', color, { pos: [cx0, y + dep * 0.72 + ch / 2, cz0], rot: r, w: cw, h: ch, d: cd, round: 0.08 });
  box(ctx, 'glass', 0x203038, { pos: [cx0, y + dep * 0.72 + ch * 0.72, cz0], rot: r, w: cw * 0.92, h: 0.5, d: cd * 1.02 });
  ctx.m.add('tile', xf(colorGeo(B(cw + 0.4, 0.16, cd + 0.4), 0x8d4f36), { pos: [cx0, y + dep * 0.72 + ch + 0.1, cz0], rot: r }));
  // mast + boom
  if (mast) {
    const mx = x - Math.cos(rot) * len * 0.12, mz = z + Math.sin(rot) * len * 0.12;
    ctx.m.add('wood', xf(colorGeo(CYL(0.07, 0.11, len * 0.95, 8), 0x8a6a44), { pos: [mx, y + dep * 0.72 + len * 0.45, mz] }));
    ctx.m.add('wood', xf(colorGeo(CYL(0.05, 0.06, len * 0.5, 6), 0x8a6a44), { pos: [mx, y + dep * 0.72 + len * 0.6, mz], rot: [Math.PI / 2, rot, 0] }));
    ctx.m.add('fabric', xf(colorGeo(new THREE.PlaneGeometry(len * 0.4, len * 0.5), new THREE.Color().setHSL(0, 0.05, 0.85)), { pos: [mx, y + dep * 0.72 + len * 0.35, mz], rot: [0, rot, 0] }));
  }
  // rails
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = (i / 4 - 0.5) * len * 0.7;
      ctx.m.add('metal', xf(colorGeo(CYL(0.035, 0.035, 0.6, 6), 0x8f9499), { pos: [x + Math.cos(rot) * t, y + dep * 0.9 + 0.3, z - Math.sin(rot) * t + s * wid * 0.42 * Math.cos(rot)], rot: r }));
    }
  }
  // nets in the stern
  ctx.m.add('net', xf(colorGeo(new THREE.CylinderGeometry(0.9, 0.7, 0.7, 10), 0xcfc7b0), { pos: [x - Math.cos(rot) * len * 0.36, y + dep * 0.85, z + Math.sin(rot) * len * 0.36], rot: r }));
  return { len, wid, dep };
}

/* ------------------------------------------------------------- vegetation */
export function addPalm(ctx, rng, { x, y, z, scale = 1, lean = 0.1, rotY = 0 }) {
  const h = rand(rng, 6.5, 11) * scale;
  const segs = 7;
  let px = x, py = y, pz = z;
  const dirX = Math.sin(rotY) * lean, dirZ = Math.cos(rotY) * lean;
  const trunkColor = new THREE.Color().setHSL(0.09, 0.28, 0.34 + rng() * 0.1);
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const seg = h / segs;
    const tt = t + 0.5 / segs;
    const r0 = lerp(0.34, 0.19, tt) * scale;
    const nx = x + dirX * h * tt * tt, nz = z + dirZ * h * tt * tt;
    ctx.m.add('bark', xf(colorGeo(CYL(r0 * 0.9, r0, seg * 1.06, 8), trunkColor), { pos: [nx, y + h * tt, nz] }));
    px = nx; py = y + h * tt; pz = nz;
  }
  // crown
  const topY = y + h;
  const topX = x + dirX * h, topZ = z + dirZ * h;
  const fronds = 9 + ((rng() * 4) | 0);
  const frondGeo = new THREE.PlaneGeometry(3.4, 0.62, 4, 1);
  {
    const pos = frondGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const fx = pos.getX(i), fy = pos.getY(i);
      // clamp: Float32 rounding makes (fx + halfWidth) come out as -0.00000005 at the
      // root vertices, and Math.pow(negative, 1.9) is NaN — which poisons the merged mesh
      const t = clamp((fx + 1.7) / 3.4, 0, 1);
      pos.setZ(i, -Math.pow(t, 1.9) * 1.4);
      pos.setY(i, fy * (1 - t * 0.55));
    }
    frondGeo.computeVertexNormals();
  }
  const green = new THREE.Color().setHSL(0.26 + rng() * 0.05, 0.5, 0.30 + rng() * 0.12);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rng() * 0.3;
    const pitch = -0.15 - rng() * 0.75;
    const frond = xf(colorGeo(frondGeo.clone(), green.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06)), {
      pos: [topX, topY + 0.15, topZ],
      rot: [0, -a + Math.PI / 2, pitch],
      scale: [rand(rng, 0.8, 1.15), rand(rng, 0.85, 1.2), 1],
    });
    ctx.m.add('leaf', frond);
  }
  if (rng() < 0.6) {
    for (let i = 0; i < 3; i++) {
      const a = rng() * TAU;
      ctx.m.add('foliage', xf(colorGeo(new THREE.SphereGeometry(0.17, 7, 6), 0x6b5a34), { pos: [topX + Math.cos(a) * 0.35, topY - 0.25, topZ + Math.sin(a) * 0.35] }));
    }
  }
  ctx.colliders.push({ cx: x + dirX * h * 0.25, cz: z + dirZ * h * 0.25, hx: 0.42 * scale, hz: 0.42 * scale, rot: 0, y0: y, y1: y + h * 0.75, kind: 'tree' });
}

export function addPine(ctx, rng, { x, y, z, scale = 1, kind = 'pine' }) {
  const h = rand(rng, 8, 15) * scale;
  const trunkC = new THREE.Color().setHSL(0.07, 0.3, 0.22 + rng() * 0.08);
  ctx.m.add('bark', xf(colorGeo(CYL(h * 0.022, h * 0.045, h * 0.55, 7), trunkC), { pos: [x, y + h * 0.27, z] }));
  if (kind === 'pine') {
    const gc = new THREE.Color().setHSL(0.31 + rng() * 0.03, 0.36, 0.16 + rng() * 0.08);
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = lerp(h * 0.30, h * 0.11, t) * rand(rng, 0.9, 1.1);
      const lh = h * lerp(0.36, 0.24, t);
      ctx.m.add('foliage', xf(colorGeo(new THREE.ConeGeometry(r, lh, 8, 1), gc.clone().offsetHSL(0, 0, t * 0.05)), { pos: [x, y + lerp(h * 0.35, h * 0.92, t), z], rot: [0, rng() * TAU, 0] }));
    }
  } else {
    // broadleaf / olive
    const gc = new THREE.Color().setHSL(0.24 + rng() * 0.04, 0.34, 0.24 + rng() * 0.1);
    const blobs = 4 + ((rng() * 3) | 0);
    for (let i = 0; i < blobs; i++) {
      const r = h * rand(rng, 0.17, 0.28);
      ctx.m.add('foliage', xf(colorGeo(new THREE.IcosahedronGeometry(r, 1), gc.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.08)), {
        pos: [x + (rng() - 0.5) * h * 0.35, y + h * rand(rng, 0.55, 0.85), z + (rng() - 0.5) * h * 0.35],
      }));
    }
  }
  ctx.colliders.push({ cx: x, cz: z, hx: 0.3 * scale, hz: 0.3 * scale, rot: 0, y0: y, y1: y + h * 0.5, kind: 'tree' });
}

export function addBush(ctx, rng, { x, y, z, scale = 1 }) {
  const gc = new THREE.Color().setHSL(0.22 + rng() * 0.06, 0.35, 0.2 + rng() * 0.12);
  const n = 1 + ((rng() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const r = rand(rng, 0.5, 1.1) * scale;
    ctx.m.add('foliage', xf(colorGeo(new THREE.IcosahedronGeometry(r, 0), gc), { pos: [x + (rng() - 0.5) * 0.6 * scale, y + r * 0.75, z + (rng() - 0.5) * 0.6 * scale] }));
  }
}

export function addCactus(ctx, rng, { x, y, z, scale = 1 }) {
  const gc = new THREE.Color().setHSL(0.32, 0.35, 0.25);
  const h = rand(rng, 1.8, 3.6) * scale;
  ctx.m.add('foliage', xf(colorGeo(CYL(0.26, 0.32, h, 8), gc), { pos: [x, y + h / 2, z] }));
  const arms = 1 + ((rng() * 2) | 0);
  for (let i = 0; i < arms; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const ay = y + h * rand(rng, 0.4, 0.65);
    ctx.m.add('foliage', xf(colorGeo(CYL(0.16, 0.18, 0.9, 8), gc), { pos: [x + side * 0.42, ay, z], rot: [0, 0, side * 1.15] }));
    ctx.m.add('foliage', xf(colorGeo(CYL(0.15, 0.17, 0.7, 8), gc), { pos: [x + side * 0.72, ay + 0.45, z] }));
  }
}

export function addRock(ctx, rng, { x, y, z, scale = 1, tint = 0 }) {
  const g = new THREE.IcosahedronGeometry(rand(rng, 0.8, 2.6) * scale, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * rand(rng, 0.6, 1.35), pos.getY(i) * rand(rng, 0.45, 1.0), pos.getZ(i) * rand(rng, 0.6, 1.35));
  }
  g.computeVertexNormals();
  const c = new THREE.Color().setHSL(0.08 + rand(rng, -0.02, 0.02), 0.06 + rng() * 0.06, 0.34 + tint + rng() * 0.18);
  ctx.m.add('rockPlain', xf(colorGeo(g, c), { pos: [x, y, z], rot: [rng() * 0.4, rng() * TAU, rng() * 0.4] }));
}

export function addDriftwood(ctx, rng, { x, y, z, len = 3 }) {
  ctx.m.add('bark', xf(colorGeo(CYL(0.12, 0.22, len, 6), 0x9a8a74), { pos: [x, y + 0.18, z], rot: [Math.PI / 2 + rand(rng, -0.2, 0.2), rng() * TAU, rand(rng, -0.2, 0.2)] }));
}

/* -------------------------------------------------------------- city props */
export function addLamp(ctx, rng, { x, y, z, rot = 0, kind = 'street' }) {
  const h = kind === 'street' ? 6.5 : 4.2;
  ctx.m.add('metal', xf(colorGeo(CYL(0.09, 0.13, h, 8), 0x3f4548), { pos: [x, y + h / 2, z] }));
  if (kind === 'street') {
    ctx.m.add('metal', xf(colorGeo(CYL(0.07, 0.07, 1.6, 6), 0x3f4548), { pos: [x + Math.cos(rot) * 0.8, y + h - 0.2, z - Math.sin(rot) * 0.8], rot: [0, 0, Math.PI / 2] }));
    ctx.m.add('metal', xf(colorGeo(new THREE.ConeGeometry(0.42, 0.35, 8), 0x343a3d), { pos: [x + Math.cos(rot) * 1.6, y + h - 0.05, z - Math.sin(rot) * 1.6] }));
    ctx.m.add('emissive', xf(colorGeo(new THREE.SphereGeometry(0.22, 8, 6), 0xffe9c0), { pos: [x + Math.cos(rot) * 1.6, y + h - 0.28, z - Math.sin(rot) * 1.6] }));
  } else {
    ctx.m.add('metal', xf(colorGeo(new THREE.ConeGeometry(0.3, 0.3, 8), 0x343a3d), { pos: [x, y + h + 0.1, z] }));
  }
}

export function addPowerPole(ctx, rng, { x, y, z, rot = 0, h = 9 }) {
  ctx.m.add('bark', xf(colorGeo(CYL(0.16, 0.22, h, 8), 0x6d5a44), { pos: [x, y + h / 2, z] }));
  for (let i = 0; i < 2; i++) {
    const ay = y + h - 0.8 - i * 1.3;
    ctx.m.add('wood', xf(colorGeo(B(2.6, 0.14, 0.14), 0x6d5a44), { pos: [x, ay, z], rot: [0, rot, 0] }));
    for (const s of [-1, 1]) {
      ctx.m.add('glass', xf(colorGeo(CYL(0.09, 0.11, 0.22, 6), 0x7a8b7a), { pos: [x + Math.cos(rot) * s * 1.1, ay + 0.2, z - Math.sin(rot) * s * 1.1] }));
    }
  }
}

export function addParkedCar(ctx, rng, { x, y, z, rot = 0, color = null, broken = false }) {
  const c = new THREE.Color(color !== undefined && color !== null ? color : 0xffffff);
  if (color === null) c.setHSL(rng(), 0.5 + rng() * 0.3, 0.35 + rng() * 0.3);
  const L = 4.2, W = 1.85, wheelR = 0.32;
  const r = [0, rot, 0];
  ctx.m.add('metal', xf(colorGeo(roundedBox(W, 0.75, L, 0.16), c), { pos: [x, y + 0.62, z], rot: r }));
  ctx.m.add('glass', xf(colorGeo(roundedBox(W * 0.86, 0.6, L * 0.45, 0.14), 0x1a262c), { pos: [x, y + 1.22, z + Math.cos(rot) * -0.2], rot: r }));
  ctx.m.add('metal', xf(colorGeo(roundedBox(W * 0.94, 0.16, L * 0.9, 0.08), c.clone().offsetHSL(0, 0, 0.06)), { pos: [x, y + 1.5, z], rot: r }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const wx = x + Math.cos(rot) * sz * L * 0.32 + Math.sin(rot) * sx * W * 0.5;
    const wz = z - Math.sin(rot) * sz * L * 0.32 + Math.cos(rot) * sx * W * 0.5;
    ctx.m.add('metal', xf(colorGeo(CYL(wheelR, wheelR, 0.22, 10), 0x18181a), { pos: [wx, y + wheelR, wz], rot: [0, 0, Math.PI / 2] }));
  }
  ctx.m.add('emissive', xf(colorGeo(B(W * 0.8, 0.14, 0.1), 0xfff2cc), { pos: [x + Math.cos(rot) * (L / 2), y + 0.7, z - Math.sin(rot) * (L / 2)], rot: r }));
  if (broken) ctx.m.add('metal', xf(colorGeo(roundedBox(W * 0.98, 0.4, L * 0.4, 0.1), c.clone().offsetHSL(0, -0.2, -0.1)), { pos: [x, y + 1.05, z + Math.cos(rot) * 0.7], rot: [0, rot, 1.2] }));
  ctx.colliders.push({ cx: x, cz: z, hx: W / 2, hz: L / 2, rot, y0: y, y1: y + 1.55, kind: 'car' });
}

export function addContainer(ctx, rng, { x, y, z, rot = 0, stacked = 1 }) {
  const colors = [0xb4442f, 0x2f6b8f, 0x3f7a4a, 0xb08b2f, 0x8a8f95];
  const c = pick(rng, colors);
  for (let i = 0; i < stacked; i++) {
    const yy = y + 1.3 + i * 2.6;
    ctx.m.add('metal', xf(colorGeo(B(2.44, 2.55, 6.06), c), { pos: [x, yy, z], rot: [0, rot, 0] }));
    for (let k = 0; k < 6; k++) {
      const oz = -3 + k * 1.2;
      ctx.m.add('metal', xf(colorGeo(B(2.5, 2.45, 0.08), new THREE.Color(c).offsetHSL(0, 0, -0.06)), { pos: [x + Math.sin(rot) * oz, yy, z + Math.cos(rot) * oz], rot: [0, rot, 0] }));
    }
    ctx.colliders.push({ cx: x, cz: z, hx: 1.25, hz: 3.05, rot, y0: yy - 1.28, y1: yy + 1.28, kind: 'container' });
  }
}

export function addStall(ctx, rng, { x, y, z, rot = 0 }) {
  const c = new THREE.Color().setHSL(pick(rng, [0, 0.55, 0.1, 0.33, 0.75]), 0.6, 0.5);
  ctx.m.add('wood', xf(colorGeo(B(3.2, 0.12, 1.6), 0x8b6b46), { pos: [x, y + 0.95, z], rot: [0, rot, 0] }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    ctx.m.add('wood', xf(colorGeo(B(0.1, 1.0, 0.1), 0x7a5c3a), { pos: [x + Math.cos(rot) * sx * 1.5 + Math.sin(rot) * sz * 0.7, y + 0.5, z - Math.sin(rot) * sx * 1.5 + Math.cos(rot) * sz * 0.7], rot: [0, rot, 0] }));
  }
  ctx.m.add('fabric', xf(colorGeo(B(3.4, 0.08, 2.2), c), { pos: [x, y + 2.2, z], rot: [-0.18, rot, 0] }));
  for (let i = 0; i < 8; i++) {
    ctx.m.add('foliage', xf(colorGeo(new THREE.SphereGeometry(rand(rng, 0.08, 0.16), 6, 5), new THREE.Color().setHSL(rng(), 0.6, 0.4)), { pos: [x + (rng() - 0.5) * 2.6, y + 1.05, z + (rng() - 0.5) * 1.1], rot: [0, rot, 0] }));
  }
}

export function addBench(ctx, rng, { x, y, z, rot = 0 }) {
  ctx.m.add('wood', xf(colorGeo(B(1.8, 0.08, 0.5), 0x8a6a44), { pos: [x, y + 0.45, z], rot: [0, rot, 0] }));
  ctx.m.add('wood', xf(colorGeo(B(1.8, 0.45, 0.08), 0x8a6a44), { pos: [x - Math.sin(rot) * 0.22, y + 0.75, z - Math.cos(rot) * 0.22], rot: [0, rot, 0] }));
  for (const s of [-1, 1]) {
    ctx.m.add('metal', xf(colorGeo(B(0.08, 0.45, 0.45), 0x555b5e), { pos: [x + Math.cos(rot) * s * 0.75, y + 0.22, z - Math.sin(rot) * s * 0.75], rot: [0, rot, 0] }));
  }
}

export function addFence(ctx, rng, { x, y, z, rot = 0, len = 6, kind = 'wood' }) {
  const n = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * len;
    const px = x + Math.cos(rot) * t, pz = z - Math.sin(rot) * t;
    ctx.m.add(kind === 'wood' ? 'wood' : 'metal', xf(colorGeo(CYL(0.06, 0.07, 1.1, 6), kind === 'wood' ? 0x8a6a44 : 0x777d80), { pos: [px, y + 0.55, pz] }));
  }
  for (const h of [0.45, 0.9]) {
    ctx.m.add('wood', xf(colorGeo(B(len, 0.06, 0.06), 0x8a6a44), { pos: [x, y + h, z], rot: [0, rot, 0] }));
  }
}

export function addWaterTank(ctx, rng, { x, y, z, r = 0.9, h = 1.8, color = 0xd8d4cb }) {
  ctx.m.add('metal', xf(colorGeo(CYL(r, r, h, 12), color), { pos: [x, y + h / 2, z] }));
  ctx.m.add('metal', xf(colorGeo(CYL(r * 0.2, r * 0.2, h + 0.3, 8), 0xa8a49b), { pos: [x, y + h / 2, z] }));
}

export function addSign(ctx, rng, { x, y, z, rot = 0, w = 1.6, h = 0.5, color = 0xf3c53e, text = null }) {
  ctx.m.add('metal', xf(colorGeo(CYL(0.06, 0.06, 2.4, 6), 0x777d80), { pos: [x, y + 1.2, z] }));
  ctx.m.add('metal', xf(colorGeo(B(w, h, 0.06), color), { pos: [x, y + 2.4, z], rot: [0, rot, 0] }));
}

export function addPier(ctx, rng, { x, y, z, rot = 0, len = 26, wide = 4.2 }) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const planks = Math.round(len / 1.2);
  for (let i = 0; i < planks; i++) {
    const t = (i / planks - 0.5) * len;
    const px = x + cos * t, pz = z - sin * t;
    ctx.m.add('wood', xf(colorGeo(B(wide, 0.14, 1.05), new THREE.Color().setHSL(0.09, 0.3, 0.38 + (i % 3) * 0.03)), { pos: [px, y, pz], rot: [0, rot, 0] }));
  }
  for (let i = 0; i <= 4; i++) {
    const t = (i / 4 - 0.5) * len;
    for (const s of [-1, 1]) {
      const px = x + cos * t + sin * s * wide * 0.42, pz = z - sin * t + cos * s * wide * 0.42;
      ctx.m.add('bark', xf(colorGeo(CYL(0.2, 0.24, 3.2, 8), 0x5f4a33), { pos: [px, y - 1.6, pz] }));
    }
  }
  for (const s of [-1, 1]) {
    ctx.m.add('wood', xf(colorGeo(B(len, 0.1, 0.14), 0x7a5c3a), { pos: [x + sin * s * wide * 0.48, y + 0.6, z + cos * s * wide * 0.48], rot: [0, rot, 0] }));
  }
  // bollards
  for (let i = 0; i < 4; i++) {
    const t = (i / 3 - 0.5) * len * 0.85;
    ctx.m.add('metal', xf(colorGeo(CYL(0.16, 0.18, 0.5, 8), 0x5a5f62), { pos: [x + cos * t + sin * wide * 0.42, y + 0.2, z - sin * t + cos * wide * 0.42] }));
  }
}

export function addCrane(ctx, rng, { x, y, z, rot = 0, h = 12 }) {
  ctx.m.add('metal', xf(colorGeo(CYL(0.25, 0.35, h, 8), 0xd8842f), { pos: [x, y + h / 2, z] }));
  ctx.m.add('metal', xf(colorGeo(B(h * 0.55, 0.3, 0.3), 0xd8842f), { pos: [x + Math.cos(rot) * h * 0.25, y + h - 0.4, z - Math.sin(rot) * h * 0.25], rot: [0, rot, 0] }));
  ctx.m.add('metal', xf(colorGeo(CYL(0.04, 0.04, 4, 5), 0x44484a), { pos: [x + Math.cos(rot) * h * 0.45, y + h - 2.4, z - Math.sin(rot) * h * 0.45] }));
  ctx.m.add('metal', xf(colorGeo(B(1.2, 1.2, 1.2), 0xb0782c), { pos: [x + Math.cos(rot) * h * 0.45, y + h - 4.6, z - Math.sin(rot) * h * 0.45] }));
  ctx.colliders.push({ cx: x, cz: z, hx: 0.5, hz: 0.5, rot, y0: y, y1: y + h, kind: 'crane' });
}

export function addCampTent(ctx, rng, { x, y, z, rot = 0, color = null, scale = 1 }) {
  const c = new THREE.Color(color !== undefined && color !== null ? color : 0xffffff);
  if (color === null) c.setHSL(pick(rng, [0.08, 0.35, 0.55]), 0.3, 0.42 + rng() * 0.2);
  const w = 3.0 * scale, d = 2.4 * scale, h = 1.9 * scale;
  const roof = new THREE.ConeGeometry(w * 0.62, h, 4, 1);
  ctx.m.add('cloth', xf(colorGeo(roof, c), { pos: [x, y + h / 2, z], rot: [0, rot + Math.PI / 4, 0], scale: [1, 1, d / w] }));
  ctx.m.add('cloth', xf(colorGeo(B(w * 0.7, h * 0.35, d * 0.7), c.clone().offsetHSL(0, 0, -0.05)), { pos: [x, y + h * 0.16, z], rot: [0, rot, 0] }));
  ctx.colliders.push({ cx: x, cz: z, hx: w * 0.35, hz: d * 0.35, rot, y0: y, y1: y + h * 0.6, kind: 'tent' });
}

export function addCampfire(ctx, rng, { x, y, z }) {
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    ctx.m.add('rockPlain', xf(colorGeo(new THREE.IcosahedronGeometry(rand(rng, 0.16, 0.28), 0), 0x5d5852), { pos: [x + Math.cos(a) * 0.9, y + 0.1, z + Math.sin(a) * 0.9] }));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU * 2;
    ctx.m.add('bark', xf(colorGeo(CYL(0.07, 0.09, 1.2, 6), 0x4a3a2a), { pos: [x + Math.cos(a) * 0.25, y + 0.35, z + Math.sin(a) * 0.25], rot: [Math.sin(a) * 0.5, a, Math.cos(a) * 0.5] }));
  }
  ctx.fireSpots = ctx.fireSpots || [];
  ctx.fireSpots.push({ x, y: y + 0.15, z });
}

export function addWatchTower(ctx, rng, { x, y, z, h = 7 }) {
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [lx, lz] of legs) {
    ctx.m.add('bark', xf(colorGeo(CYL(0.14, 0.18, h, 7), 0x6d5a44), { pos: [x + lx * 1.4, y + h / 2, z + lz * 1.4], rot: [lz * -0.06, 0, lx * 0.06] }));
  }
  for (let i = 1; i <= 3; i++) {
    const yy = y + (h / 4) * i;
    ctx.m.add('wood', xf(colorGeo(B(3.0, 0.1, 0.12), 0x6d5a44), { pos: [x, yy, z + 1.4] }));
    ctx.m.add('wood', xf(colorGeo(B(3.0, 0.1, 0.12), 0x6d5a44), { pos: [x, yy, z - 1.4] }));
  }
  const py = y + h;
  ctx.m.add('wood', xf(colorGeo(B(3.6, 0.18, 3.6), 0x8a6a44), { pos: [x, py, z] }));
  for (const s of [-1, 1]) {
    ctx.m.add('wood', xf(colorGeo(B(3.6, 0.9, 0.1), 0x7a5c3a), { pos: [x, py + 0.55, z + s * 1.75] }));
    ctx.m.add('wood', xf(colorGeo(B(0.1, 0.9, 3.6), 0x7a5c3a), { pos: [x + s * 1.75, py + 0.55, z] }));
  }
  ctx.m.add('thatch', xf(colorGeo(new THREE.ConeGeometry(3.1, 1.3, 4), 0x9a7c4a), { pos: [x, py + 1.5, z], rot: [0, Math.PI / 4, 0] }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.m.add('wood', xf(colorGeo(CYL(0.05, 0.05, 0.7, 5), 0x7a5c3a), { pos: [x + Math.cos(a) * 1.5, py + 0.5, z + Math.sin(a) * 1.5] }));
  }
  ctx.colliders.push({ cx: x, cz: z, hx: 1.8, hz: 1.8, rot: 0, y0: py, y1: py + 0.2, kind: 'platform' });
}

export function addRadioMast(ctx, rng, { x, y, z, h = 14 }) {
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.m.add('metal', xf(colorGeo(CYL(0.05, 0.09, h, 6), 0x9aa0a6), { pos: [x + lx * 0.6, y + h / 2, z + lz * 0.6], rot: [lz * -0.045, 0, lx * 0.045] }));
  }
  for (let i = 1; i < 8; i++) {
    const yy = y + (h / 8) * i;
    ctx.m.add('metal', xf(colorGeo(B(1.15, 0.04, 0.04), 0xbfc4c9), { pos: [x, yy, z + 0.45] }));
    ctx.m.add('metal', xf(colorGeo(B(1.15, 0.04, 0.04), 0xbfc4c9), { pos: [x, yy, z - 0.45] }));
  }
  ctx.m.add('metal', xf(colorGeo(CYL(0.03, 0.03, 1.2, 5), 0xd0d5da), { pos: [x, y + h + 0.6, z] }));
  ctx.m.add('emissive', xf(colorGeo(new THREE.SphereGeometry(0.15, 8, 6), 0xff5a3c), { pos: [x, y + h + 1.2, z] }));
}

/* ------------------------------------------------------------- landmarks */
export function addStoneBridge(ctx, rng, { x, y, z, len = 46, wide = 9, rot = 0, rise = 4 }) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const segs = 18;
  for (let i = 0; i < segs; i++) {
    const t = (i / (segs - 1) - 0.5) * len;
    const arc = Math.cos((i / (segs - 1) - 0.5) * Math.PI) * rise;
    const px = x + cos * t, pz = z - sin * t;
    ctx.m.add('rock', xf(colorGeo(B(len / segs + 0.2, 0.6, wide), new THREE.Color().setHSL(0.08, 0.14, 0.5 + (i % 2) * 0.03)), { pos: [px, y + arc, pz], rot: [0, rot, 0] }));
    // arch stones below
    if (i > 3 && i < segs - 4) {
      ctx.m.add('rock', xf(colorGeo(B(len / segs, 1.5 + arc * 0.5, wide * 0.9), 0x9a9186), { pos: [px, y + arc - 1.0, pz], rot: [0, rot, 0] }));
    }
    for (const s of [-1, 1]) {
      ctx.m.add('rock', xf(colorGeo(B(len / segs + 0.1, 0.7, 0.4), 0xada396), { pos: [px + sin * s * wide * 0.5, y + arc + 0.65, pz + cos * s * wide * 0.5], rot: [0, rot, 0] }));
    }
  }
  ctx.colliders.push({ cx: x + sin * wide * 0.5, cz: z + cos * wide * 0.5, hx: len / 2, hz: 0.25, rot, y0: y, y1: y + 1.4, kind: 'parapet' });
  ctx.colliders.push({ cx: x - sin * wide * 0.5, cz: z - cos * wide * 0.5, hx: len / 2, hz: 0.25, rot, y0: y, y1: y + 1.4, kind: 'parapet' });
}

export function addHydroStation(ctx, rng, { x, y, z, rot = 0 }) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  // intake building
  ctx.m.add('concrete', xf(colorGeo(B(12, 5, 8), 0xb6b1a8), { pos: [x, y + 2.5, z], rot: [0, rot, 0] }));
  ctx.m.add('tile', xf(colorGeo(B(12.6, 0.3, 8.6), 0x8d4f36), { pos: [x, y + 5.1, z], rot: [0, rot, 0] }));
  for (let i = 0; i < 4; i++) {
    ctx.m.add('glass', xf(colorGeo(B(1.4, 1.1, 0.1), 0x1e2c33), { pos: [x + cos * (-4 + i * 2.6) + sin * 4.05, y + 3.2, z - sin * (-4 + i * 2.6) + cos * 4.05], rot: [0, rot, 0] }));
  }
  // penstocks (big pipes) going down the slope
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 3.2;
    ctx.m.add('metal', xf(colorGeo(CYL(0.9, 0.9, 26, 10), 0x8d9296), { pos: [x + cos * off + sin * 8, y - 6, z - sin * off + cos * 8], rot: [1.05, rot, 0] }));
  }
  // small dam wall
  ctx.m.add('concrete', xf(colorGeo(B(3.0, 6.0, 26), 0xb0aba2), { pos: [x + sin * 10, y - 0.5, z + cos * 10], rot: [0, rot + Math.PI / 2, 0] }));
  ctx.m.add('metal', xf(colorGeo(CYL(0.35, 0.35, 1.6, 8), 0xc23b2f), { pos: [x + sin * 9.5, y + 3.6, z + cos * 9.5] }));
  ctx.colliders.push({ cx: x, cz: z, hx: 6, hz: 4, rot, y0: y, y1: y + 5.2, kind: 'building' });
}

export function addMineEntrance(ctx, rng, { x, y, z, rot = 0 }) {
  ctx.m.add('bark', xf(colorGeo(B(0.4, 3.4, 0.4), 0x5d4a34), { pos: [x - 1.6, y + 1.7, z], rot: [0, rot, 0] }));
  ctx.m.add('bark', xf(colorGeo(B(0.4, 3.4, 0.4), 0x5d4a34), { pos: [x + 1.6, y + 1.7, z], rot: [0, rot, 0] }));
  ctx.m.add('bark', xf(colorGeo(B(4.4, 0.4, 0.5), 0x5d4a34), { pos: [x, y + 3.3, z], rot: [0, rot, 0] }));
  ctx.m.add('rockPlain', xf(colorGeo(B(4.0, 3.2, 0.6), 0x151312), { pos: [x, y + 1.6, z - 0.6], rot: [0, rot, 0] }));
  // rails + cart
  for (const s of [-1, 1]) {
    ctx.m.add('metal', xf(colorGeo(B(0.09, 0.12, 6), 0x6f6a63), { pos: [x + s * 0.7, y + 0.1, z + 3], rot: [0, rot, 0] }));
  }
  ctx.m.add('metal', xf(colorGeo(B(1.7, 0.8, 2.3), 0x5b5f62), { pos: [x, y + 0.6, z + 5], rot: [0, rot, 0] }));
  for (const s of [-1, 1]) for (const t of [-0.9, 0.9]) {
    ctx.m.add('metal', xf(colorGeo(CYL(0.26, 0.26, 0.12, 8), 0x33383b), { pos: [x + s * 0.8, y + 0.26, z + 5 + t], rot: [0, 0, Math.PI / 2] }));
  }
  ctx.colliders.push({ cx: x, cz: z + 5, hx: 0.9, hz: 1.2, rot, y0: y, y1: y + 1.0, kind: 'cart' });
}

export function addRuin(ctx, rng, { x, y, z, rot = 0, w = 8, h = 3.2, d = 6 }) {
  const c = new THREE.Color().setHSL(0.08, 0.16, 0.44 + rng() * 0.12);
  const cols = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i < cols; i++) {
    const lx = -w / 2 + (w / cols) * (i + 0.5);
    const hh = h * rand(rng, 0.5, 1.0);
    ctx.m.add('plaster', xf(colorGeo(B(w / cols * 0.7, hh, 0.5), c), { pos: [x + Math.cos(rot) * lx, y + hh / 2, z - Math.sin(rot) * lx], rot: [0, rot, 0] }));
  }
  ctx.m.add('plaster', xf(colorGeo(B(w, h * 0.4, 0.5), c), { pos: [x, y + h * 0.2, z + d / 2], rot: [0, rot, 0] }));
  for (let i = 0; i < 6; i++) {
    ctx.m.add('rockPlain', xf(colorGeo(new THREE.IcosahedronGeometry(rand(rng, 0.3, 0.8), 0), c.clone().offsetHSL(0, -0.05, -0.06)), { pos: [x + rand(rng, -w, w) * 0.5, y + 0.2, z + rand(rng, -d, d) * 0.5] }));
  }
}

export function addWaterfall(ctx, rng, { x, y, z, h = 26, w = 7, rot = 0 }) {
  ctx.waterfalls = ctx.waterfalls || [];
  ctx.waterfalls.push({ x, y, z, h, w, rot });
}

/* ---------------------------------------------------------------- harbour */
export function addHarbour(ctx, rng, { x, y, z, rot = 0, len = 90 }) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const segs = Math.round(len / 8);
  const quayH = 3.4;
  for (let i = 0; i < segs; i++) {
    const t = (i / (segs - 1) - 0.5) * len;
    const px = x + cos * t, pz = z - sin * t;
    ctx.m.add('concrete', xf(colorGeo(B(len / segs + 0.4, quayH, 6), 0xa9a49b), { pos: [px, y + quayH / 2 - 1.4, pz], rot: [0, rot, 0] }));
    ctx.m.add('concrete', xf(colorGeo(B(len / segs + 0.4, 0.35, 6.4), 0xbcb7ae), { pos: [px, y + quayH - 1.5, pz], rot: [0, rot, 0] }));
    ctx.colliders.push({ cx: px, cz: pz, hx: len / segs / 2 + 0.2, hz: 3, rot, y0: y - 1.4, y1: y + quayH - 1.3, kind: 'quay' });
    if (i % 2 === 0) {
      for (let k = 0; k < 2; k++) {
        const bt = (k - 0.5) * 3;
        ctx.m.add('metal', xf(colorGeo(CYL(0.22, 0.26, 0.7, 10), 0x4f5457), { pos: [px + cos * bt + sin * 2.4, y + quayH - 1.2, pz - sin * bt + cos * 2.4] }));
        // mooring rope loop
        ctx.m.add('net', xf(colorGeo(new THREE.TorusGeometry(0.3, 0.06, 5, 10), 0xd8d2c0), { pos: [px + cos * bt + sin * 2.4, y + quayH - 0.9, pz - sin * bt + cos * 2.4], rot: [Math.PI / 2, 0, 0] }));
      }
    }
  }
  // ladders into the water
  for (let i = 0; i < 3; i++) {
    const t = (i / 2 - 0.5) * len * 0.8;
    const px = x + cos * t - sin * 3.2, pz = z - sin * t - cos * 3.2;
    for (let k = 0; k < 5; k++) {
      ctx.m.add('metal', xf(colorGeo(B(0.7, 0.07, 0.07), 0x6d7276), { pos: [px, y + 1.2 - k * 0.5, pz + k * 0.0], rot: [0, rot + Math.PI / 2, 0] }));
    }
  }
}
