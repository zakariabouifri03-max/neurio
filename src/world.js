// 🌍 Open world — procedural, inspired by open-world racing games (original content, no game assets).
// Zones: mountains + snow (north), coast + beach + sea (south), city (east), festival (west),
// lake, airfield, forests, wind farm, lighthouse. Roads: highway ring, coastal road,
// mountain pass, city grid. Exposes height / surface / collision queries for the car physics.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const WORLD = 2400;          // m, square
const HALF = WORLD / 2;
const N = 600;                      // terrain grid cells per side (4 m)
const CELL = WORLD / N;
export const WATER = 0;

// ───────── noise ─────────
function hash(x, z) { let h = x * 374761393 + z * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) & 0xffff) / 0xffff; }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f, z * f) * 2 - 1); f *= 2; a *= 0.5; } return s; }
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ───────── zones ─────────
export const ZONES = {
  city: { x0: 140, x1: 560, z0: -200, z1: 200, h: 4 },
  festival: { x: -470, z: 140, r: 95 },
  lake: { x: -90, z: 110, r: 105 },
  runway: { x0: -760, x1: -300, z0: -232, z1: -188 },
  village: { x0: 40, x1: 262, z0: 492, z1: 688, h: 6 },
};
function baseHeight(x, z) {
  let h = 7 + fbm(x / 260, z / 260) * 16 + fbm(x / 60, z / 60, 3) * 2;
  const m = ss(-420, -900, z);                                         // north mountains
  const ridge = 1 - Math.abs(fbm(x / 320 + 7, z / 320 + 3, 4));
  h += m * (40 + 170 * ridge * ridge);
  const edge = ss(880, 1180, Math.max(Math.abs(x), z < 0 ? -z : 0));   // rim hills (not over sea)
  h += edge * 90 * (0.6 + 0.4 * vnoise(x / 90, z / 90));
  const east = ss(620, 950, x) * ss(-100, -400, z);                     // wind-farm hills
  h += east * 35;
  const coast = ss(560, 900, z + fbm(x / 400, 0, 3) * 120);              // south sea
  h = h * (1 - coast) + (-14) * coast;
  const L = ZONES.lake, dl = Math.hypot(x - L.x, z - L.z);
  h = THREE.MathUtils.lerp(h, -5 - 3 * (1 - dl / L.r), 1 - ss(L.r * 0.55, L.r * 1.25, dl));
  const C = ZONES.city;                                                 // flatten zones
  const dc = Math.max(C.x0 - x, x - C.x1, C.z0 - z, z - C.z1);
  h = THREE.MathUtils.lerp(C.h, h, ss(0, 70, dc));
  const F = ZONES.festival, df = Math.hypot(x - F.x, z - F.z);
  h = THREE.MathUtils.lerp(5, h, ss(F.r, F.r + 60, df));
  const V = ZONES.village, dv = Math.max(V.x0 - x, x - V.x1, V.z0 - z, z - V.z1);
  h = THREE.MathUtils.lerp(V.h, h, ss(0, 55, dv));
  const R = ZONES.runway, dr = Math.max(R.x0 - x, x - R.x1, R.z0 - z, z - R.z1);
  h = THREE.MathUtils.lerp(6, h, ss(0, 60, dr));
  return h;
}

// ───────── roads ─────────
const ROADS_DEF = [
  { name: 'ring', kind: 'highway', w: 8, loop: true, pts: [[-700, 330], [-300, 470], [100, 430], [480, 380], [760, 170], [820, -200], [620, -470], [200, -540], [-200, -500], [-600, -420], [-880, -120], [-870, 160]] },
  { name: 'coast', kind: 'rural', w: 6, pts: [[-700, 330], [-620, 600], [-320, 780], [80, 840], [480, 770], [790, 560], [760, 170]] },
  { name: 'pass', kind: 'mountain', w: 5, pts: [[-200, -500], [-160, -640], [-320, -760], [-250, -900], [-40, -980], [160, -880], [120, -720], [260, -640], [200, -540]] },
  { name: 'touge', kind: 'mountain', w: 4.5, pts: [[-600, -420], [-700, -560], [-560, -660], [-680, -800], [-480, -860], [-320, -760]] },
  { name: 'festival', kind: 'rural', w: 6, pts: [[-870, 160], [-620, 150], [-470, 140], [-320, 120], [-200, 20], [140, 0]] },
  { name: 'lake', kind: 'rural', w: 5, loop: true, pts: [[-90, -40], [60, 20], [70, 190], [-60, 260], [-230, 200], [-240, 50]] },
  { name: 'west-hills', kind: 'rural', w: 5, pts: [[-620, 150], [-660, 20], [-640, -120], [-560, -300], [-600, -420]] },
  { name: 'city-link', kind: 'rural', w: 6, pts: [[560, 0], [700, -20], [820, -200]] },
  { name: 'north-link', kind: 'rural', w: 6, pts: [[350, -200], [330, -380], [200, -540]] },
  { name: 'south-link', kind: 'rural', w: 6, pts: [[350, 200], [330, 320], [300, 410]] },
  { name: 'village-n', kind: 'rural', w: 5, pts: [[151, 492], [150, 455], [140, 430]] },
  { name: 'village-s', kind: 'rural', w: 5, pts: [[151, 688], [140, 760], [110, 835]] },
];
// city grid (Tokyo-style blocks)
for (let x = 140; x <= 560; x += 105) ROADS_DEF.push({ name: 'city', kind: 'city', w: 5.5, flat: 4, pts: [[x, -200], [x, 200]] });
for (let z = -200; z <= 200; z += 100) ROADS_DEF.push({ name: 'city', kind: 'city', w: 5.5, flat: 4, pts: [[140, z], [560, z]] });
// village: narrow residential streets
export const VX = [40, 114, 188, 262], VZ = [492, 557, 622, 688];
for (const x of VX) ROADS_DEF.push({ name: 'town', kind: 'town', w: 3.2, flat: 6, pts: [[x, 492], [x, 688]] });
for (const z of VZ) ROADS_DEF.push({ name: 'town', kind: 'town', w: 3.2, flat: 6, pts: [[40, z], [262, z]] });

function sampleRoad(def) {
  const v = def.pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = def.flat !== undefined ? new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0) : new THREE.CatmullRomCurve3(v, !!def.loop, 'centripetal');
  const len = curve.getLength(), n = Math.max(2, Math.ceil(len / 3));
  const P = curve.getSpacedPoints(n);
  // elevation: smoothed terrain, kept above water
  const raw = P.map((p) => Math.max(1.8, baseHeight(p.x, p.z)));
  const el = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -14; k <= 14; k++) { let j = i + k; if (def.loop) j = (j + raw.length) % raw.length; else j = Math.min(raw.length - 1, Math.max(0, j)); s += raw[j]; c++; }
    return s / c;
  });
  if (def.flat !== undefined) el.fill(def.flat);
  else limitGrade(el, len / n, def.loop ? 0.1 : 0.12);
  return P.map((p, i) => {
    const q = P[Math.min(P.length - 1, i + 1)], o = P[Math.max(0, i - 1)];
    const t = new THREE.Vector2(q.x - o.x, q.z - o.z).normalize();
    return { x: p.x, z: p.z, y: el[i], tx: t.x, tz: t.y, w: def.w, d: i * (len / n) };
  });
}
function limitGrade(el, ds, g) {
  const m = g * ds;
  for (let it = 0; it < 6; it++) {
    for (let i = 1; i < el.length; i++) el[i] = Math.min(el[i - 1] + m, Math.max(el[i - 1] - m, el[i]));
    for (let i = el.length - 2; i >= 0; i--) el[i] = Math.min(el[i + 1] + m, Math.max(el[i + 1] - m, el[i]));
  }
}
// make road ends meet the road they join (no steps at junctions)
function joinEnds(road, others) {
  const s = road.s;
  for (const end of [0, s.length - 1]) {
    let best = null, bd = 18;
    for (const o of others) for (const q of o.s) { const d = Math.hypot(q.x - s[end].x, q.z - s[end].z); if (d < bd) { bd = d; best = q; } }
    if (!best) continue;
    const delta = best.y - s[end].y, span = Math.min(s.length - 1, Math.max(12, Math.ceil(Math.abs(delta) / (0.05 * 3))));
    for (let k = 0; k <= span; k++) { const i = end === 0 ? k : s.length - 1 - k, t = 1 - k / span; s[i].y += delta * t * t * (3 - 2 * t); }
  }
}

export function buildWorld(scene, renderer) {
  seed = 12345;
  const order = [...ROADS_DEF].sort((a, b) => (b.name === 'ring' ? 3 : b.flat !== undefined ? 2 : b.loop ? 1 : 0) - (a.name === 'ring' ? 3 : a.flat !== undefined ? 2 : a.loop ? 1 : 0));
  const roads = [];
  for (const d of order) { const r = { def: d, s: sampleRoad(d) }; if (d.flat === undefined && d.name !== 'ring') joinEnds(r, roads); roads.push(r); }
  // spatial hash of road samples
  const RC = 24, rgrid = new Map();
  const key = (x, z) => (Math.floor(x / RC) + 1000) * 4096 + (Math.floor(z / RC) + 1000);
  for (const r of roads) for (const s of r.s) { const k = key(s.x, s.z); if (!rgrid.has(k)) rgrid.set(k, []); rgrid.get(k).push(s); }
  function nearestRoad(x, z, reach = 1) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / RC), cz = Math.floor(z / RC);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const a = rgrid.get((cx + i + 1000) * 4096 + (cz + j + 1000)); if (!a) continue;
      for (const s of a) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    }
    return best ? { s: best, d: Math.sqrt(bd) } : null;
  }

  // ───────── terrain heights (base + road carving) ─────────
  const H = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    let h = baseHeight(x, z);
    const nr = nearestRoad(x, z, 2);
    if (nr) {
      const { s, d } = nr, inner = s.w + 2.5, outer = s.w + 34;
      if (d < outer) h = THREE.MathUtils.lerp(s.y - 0.05, h, ss(inner, outer, d));
    }
    H[j * (N + 1) + i] = h;
  }
  function heightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.min(N - 1, Math.max(0, Math.floor(fx))), j = Math.min(N - 1, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const a = H[j * (N + 1) + i], b = H[j * (N + 1) + i + 1], c = H[(j + 1) * (N + 1) + i], d = H[(j + 1) * (N + 1) + i + 1];
    // match the terrain mesh triangulation (PlaneGeometry: diagonal from (i,j+1) to (i+1,j))
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  // ───────── terrain mesh ─────────
  const tg = new THREE.PlaneGeometry(WORLD, WORLD, N, N);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position, col = new Float32Array(pos.count * 3);
  // PlaneGeometry after rotateX(-90°): rows run from z=-HALF (j=0) … +HALF, matching H indexing
  for (let k = 0; k < pos.count; k++) {
    const i = k % (N + 1), j = Math.floor(k / (N + 1));
    pos.setY(k, H[j * (N + 1) + i]);
  }
  tg.computeVertexNormals();
  const nrm = tg.attributes.normal, c = new THREE.Color();
  const grass = new THREE.Color(0x4a7a2c), grass2 = new THREE.Color(0x6f9a3a), dry = new THREE.Color(0xa59a5c), rock = new THREE.Color(0x7a746c), snow = new THREE.Color(0xf4f6fa), sand = new THREE.Color(0xdcc89a), mud = new THREE.Color(0x6b5a44), cityC = new THREE.Color(0x8a8a86);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), slope = 1 - nrm.getY(k);
    c.copy(grass).lerp(grass2, vnoise(x / 40, z / 40));
    c.lerp(dry, ss(0.2, 0.9, vnoise(x / 150 + 9, z / 150)) * 0.5);
    if (y < 3.2) c.lerp(sand, ss(3.2, 1.2, y));
    if (y < 0.3) c.lerp(mud, 0.5);
    c.lerp(rock, ss(0.18, 0.4, slope) + ss(95, 140, y) * 0.6);
    c.lerp(snow, ss(150, 185, y + vnoise(x / 30, z / 30) * 15) * (1 - ss(0.45, 0.7, slope)));
    const C = ZONES.city; if (x > C.x0 - 10 && x < C.x1 + 10 && z > C.z0 - 10 && z < C.z1 + 10) c.copy(cityC);
    const V = ZONES.village; if (x > V.x0 - 4 && x < V.x1 + 4 && z > V.z0 - 4 && z < V.z1 + 4) c.set(0x8f8a7e).lerp(grass, 0.35 * vnoise(x / 6, z / 6));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const detail = noiseTexture(renderer);
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ───────── water ─────────
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 3).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.86 }));
  water.position.y = WATER; scene.add(water);

  // ───────── roads ─────────
  const byKind = {};
  roads.forEach((r, ri) => {
    const s = r.s, P = [], U = [], I = [];
    const flat = r.def.flat !== undefined;
    const lift = 0.07 + (flat ? 0.012 + ri * 0.0004 : ri * 0.003);
    for (let k = 0; k < s.length; k++) {
      const p = s[k], nx = -p.tz, nz = p.tx;
      P.push(p.x + nx * p.w, p.y + lift, p.z + nz * p.w, p.x - nx * p.w, p.y + lift, p.z - nz * p.w);
      U.push(0, p.d / 12, 1, p.d / 12);
      if (k) { const a = (k - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    if (r.def.loop) { const a = (s.length - 1) * 2; I.push(a, a + 1, 0, a + 1, 1, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeVertexNormals();
    (byKind[r.def.kind] ||= []).push(g);
  });
  for (const kind in byKind) {
    const m = new THREE.Mesh(mergeGeometries(byKind[kind]), new THREE.MeshStandardMaterial({ map: roadTexture(renderer, kind), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true; m.renderOrder = kind === 'city' || kind === 'town' ? 1 : 0; scene.add(m);
  }
  // Japanese-style zebra crossings at city intersections
  {
    const geos = [], C = ZONES.city;
    for (let x = C.x0; x <= C.x1; x += 105) for (let z = C.z0; z <= C.z1; z += 100) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = x + dx * 9, cz = z + dz * 9;
        if (cx < C.x0 || cx > C.x1 || cz < C.z0 || cz > C.z1) continue;
        const g = new THREE.PlaneGeometry(dx ? 4 : 11, dx ? 11 : 4).rotateX(-Math.PI / 2);
        if (dx) { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k)); }
        g.translate(cx, C.h + 0.1, cz); geos.push(g);
      }
    }
    const zm = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: zebraTexture(renderer), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    zm.renderOrder = 2; scene.add(zm);
  }

  // ───────── colliders ─────────
  const circles = [];           // {x,z,r}
  const boxes = [];             // {x0,x1,z0,z1}
  const CG = 40, cgrid = new Map();
  const ckey = (x, z) => (Math.floor(x / CG) + 1000) * 4096 + (Math.floor(z / CG) + 1000);
  function addCircle(x, z, r, brk) { const o = { x, z, r, brk, alive: true }; circles.push(o); const k = ckey(x, z); if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(o); }
  function addBox(x0, x1, z0, z1) { boxes.push({ x0, x1, z0, z1 }); }
  const onRoad = (x, z, m = 0) => { const n = nearestRoad(x, z, 1); return n && n.d < n.s.w + m; };
  const inZone = (x, z, m = 0) => {
    const C = ZONES.city, F = ZONES.festival, L = ZONES.lake, R = ZONES.runway, V = ZONES.village;
    return (x > V.x0 - m && x < V.x1 + m && z > V.z0 - m && z < V.z1 + m) || (x > C.x0 - m && x < C.x1 + m && z > C.z0 - m && z < C.z1 + m) || Math.hypot(x - F.x, z - F.z) < F.r + m
      || Math.hypot(x - L.x, z - L.z) < L.r + m || (x > R.x0 - m && x < R.x1 + m && z > R.z0 - m && z < R.z1 + m);
  };

  // ───────── city buildings (merged, window texture via UVs) ─────────
  {
    const geos = [];
    const C = ZONES.city;
    const xs = []; for (let x = C.x0; x <= C.x1; x += 105) xs.push(x);
    const zs = []; for (let z = C.z0; z <= C.z1; z += 100) zs.push(z);
    for (let a = 0; a < xs.length - 1; a++) for (let b = 0; b < zs.length - 1; b++) {
      const bx0 = xs[a] + 12, bx1 = xs[a + 1] - 12, bz0 = zs[b] + 12, bz1 = zs[b + 1] - 12;
      const nx = 2, nz = 2, gw = (bx1 - bx0) / nx, gd = (bz1 - bz0) / nz;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const w = gw - 6 - rnd() * 8, d = gd - 6 - rnd() * 8;
        const cx = bx0 + gw * (i + 0.5), cz = bz0 + gd * (j + 0.5);
        const centre = 1 - Math.min(1, Math.hypot(cx - 350, cz) / 260);
        const h = 12 + rnd() * 25 + centre * centre * (60 + rnd() * 90);
        const g = new THREE.BoxGeometry(w, h, d);
        const uv = g.attributes.uv, dims = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
        for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
          const k = f * 4 + v, [fw, fh] = dims[f];
          if (!fw) uv.setXY(k, 0.02, 0.02); else uv.setXY(k, uv.getX(k) * fw / 4, uv.getY(k) * fh / 3.5);
        }
        g.translate(cx, C.h + h / 2, cz);
        const tint = new THREE.Color().setHSL(0.08 + rnd() * 0.5, 0.08 + rnd() * 0.12, 0.55 + rnd() * 0.3);
        const cc = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < cc.length; k += 3) { cc[k] = tint.r; cc[k + 1] = tint.g; cc[k + 2] = tint.b; }
        g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        geos.push(g);
        addBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: windowTexture(renderer), vertexColors: true, roughness: 0.6, metalness: 0.2 }));
    m.castShadow = m.receiveShadow = true; scene.add(m);
  }

  // ───────── forests (instanced, merged multi-part low-poly trees, breakable) ─────────
  const TREE_TYPES = makeTreeTypes();
  const treeMeshes = {}, treeCount = {};
  const MAXT = { sugi: 4200, broad: 3000, sakura: 700, maple: 900 };
  for (const k in TREE_TYPES) {
    const m = new THREE.InstancedMesh(TREE_TYPES[k].geo, TREE_TYPES[k].mat, MAXT[k]);
    m.castShadow = m.receiveShadow = true; m.count = 0; treeMeshes[k] = m; treeCount[k] = 0; scene.add(m);
  }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
  function plantTree(type, x, z, s, h = heightAt(x, z)) {
    const mesh = treeMeshes[type]; if (treeCount[type] >= MAXT[type]) return;
    const i = treeCount[type]++;
    _q.setFromAxisAngle(_Y, rnd() * 6.28); _p.set(x, h - 0.15, z); _s.set(s, s * (0.85 + rnd() * 0.35), s);
    _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4);
    _c.setHSL(0, 0, 0.8 + rnd() * 0.4); mesh.setColorAt(i, _c);  // brightness variation
    mesh.count = treeCount[type]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    addCircle(x, z, TREE_TYPES[type].trunk * s + 0.15, { type, i, s });
  }
  {
    for (let t = 0; t < 30000; t++) {
      const x = (rnd() * 2 - 1) * (HALF - 20), z = (rnd() * 2 - 1) * (HALF - 20);
      const h = heightAt(x, z);
      if (h < 2.5 || h > 150 || inZone(x, z, 10) || onRoad(x, z, 7)) continue;
      const dens = vnoise(x / 120 + 50, z / 120) + ss(-300, -700, z) * 0.45;
      if (rnd() > dens * dens * 1.5) continue;
      const slope = Math.abs(heightAt(x + 2, z) - heightAt(x - 2, z)) + Math.abs(heightAt(x, z + 2) - heightAt(x, z - 2));
      if (slope > 3.2) continue;
      const s = 0.75 + rnd() * 0.6;
      const r = rnd();
      const type = z < -250 || h > 40 ? (r < 0.85 ? 'sugi' : 'maple') : r < 0.35 ? 'sugi' : r < 0.85 ? 'broad' : r < 0.93 ? 'maple' : 'sakura';
      plantTree(type, x, z, s, h);
    }
    // sakura avenues along the lake road and village streets
    for (const r of roads) {
      if (r.def.name !== 'lake' && r.def.name !== 'village-n' && r.def.name !== 'village-s') continue;
      for (let k = 0; k < r.s.length; k += 5) {
        const p = r.s[k];
        for (const side of [-1, 1]) {
          const x = p.x - p.tz * side * (p.w + 4), z = p.z + p.tx * side * (p.w + 4);
          if (onRoad(x, z, 3) || heightAt(x, z) < 2) continue;
          plantTree('sakura', x, z, 0.8 + rnd() * 0.3);
        }
      }
    }
    for (const k in treeMeshes) { treeMeshes[k].instanceMatrix.needsUpdate = true; if (treeMeshes[k].instanceColor) treeMeshes[k].instanceColor.needsUpdate = true; }
  }
  // falling trees
  const falling = [];
  function knock(o, vx, vz) {
    if (!o.alive || !o.brk) return false;
    o.alive = false;
    const { type, i, s } = o.brk, mesh = treeMeshes[type];
    mesh.getMatrixAt(i, _m4);
    const pos = new THREE.Vector3(), q0 = new THREE.Quaternion(), sc = new THREE.Vector3();
    _m4.decompose(pos, q0, sc);
    mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); mesh.instanceMatrix.needsUpdate = true;
    const f = new THREE.Mesh(TREE_TYPES[type].geo, TREE_TYPES[type].matSingle);
    f.position.copy(pos); f.quaternion.copy(q0); f.scale.copy(sc); f.castShadow = true;
    scene.add(f);
    const sp = Math.hypot(vx, vz) || 1;
    const axis = new THREE.Vector3(vz / sp, 0, -vx / sp);   // fall in the car's direction
    falling.push({ f, q0, axis, th: 0.05, om: Math.min(2.5, sp * 0.08), t: 0, pos: pos.clone() });
    if (falling.length > 40) { const old = falling.shift(); scene.remove(old.f); }
    return true;
  }
  const _qa = new THREE.Quaternion();
  function updateFalling(dt) {
    for (const fl of falling) {
      fl.t += dt;
      if (fl.th < Math.PI / 2 - 0.08) {
        fl.om += 4.5 * Math.sin(fl.th + 0.1) * dt;        // gravity torque (pendulum)
        fl.th = Math.min(Math.PI / 2 - 0.08, fl.th + fl.om * dt);
        if (fl.th >= Math.PI / 2 - 0.08) fl.om = -fl.om * 0.25; // thud + small bounce
      } else if (fl.om < 0) { fl.th += fl.om * dt; fl.om += 6 * dt; if (fl.om > 0) fl.om = 0; }
      _qa.setFromAxisAngle(fl.axis, fl.th);
      fl.f.quaternion.copy(_qa).multiply(fl.q0);
      if (fl.t > 30) fl.f.position.y = fl.pos.y - (fl.t - 30) * 0.5; // sink away after a while
    }
    for (let k = falling.length - 1; k >= 0; k--) if (falling[k].t > 36) { scene.remove(falling[k].f); falling.splice(k, 1); }
  }

  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    // rocks
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: 1, flatShading: true }), 900);
    let nr = 0;
    for (let t = 0; t < 9000 && nr < 900; t++) {
      const x = (rnd() * 2 - 1) * (HALF - 20), z = (rnd() * 2 - 1) * (HALF - 20), h = heightAt(x, z);
      if (h < 1 || inZone(x, z, 5) || onRoad(x, z, 5)) continue;
      if (rnd() > 0.15 + ss(40, 120, h) * 0.8) continue;
      const s = 0.6 + rnd() * (h > 60 ? 4 : 1.6);
      m4.compose(p.set(x, h - s * 0.3, z), q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), sc.set(s, s * 0.7, s * 1.1));
      rocks.setMatrixAt(nr++, m4);
      if (s > 1) addCircle(x, z, s * 0.9);
    }
    rocks.count = nr; rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);
  }

  // ───────── festival ─────────
  const animated = [];
  {
    const F = ZONES.festival, g = new THREE.Group(); scene.add(g);
    const cols = [0xff3d7f, 0xffc933, 0x33c3ff, 0x8a5cff, 0x3dff9a, 0xff7a33];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = F.r - 22 - (i % 2) * 14, x = F.x + Math.cos(a) * r, z = F.z + Math.sin(a) * r;
      if (onRoad(x, z, 6)) continue;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(7, 7, 4, 1, true), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.7 }));
      tent.position.set(x, 5 + 3.5 + 2.5, z); tent.rotation.y = a;
      const base = new THREE.Mesh(new THREE.BoxGeometry(9.5, 5, 9.5), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
      base.position.set(x, 5 + 2.5, z); base.rotation.y = a + Math.PI / 4;
      tent.castShadow = base.castShadow = true; g.add(tent, base); addCircle(x, z, 6.5);
    }
    // stage + screen
    const stage = new THREE.Mesh(new THREE.BoxGeometry(34, 2, 16), new THREE.MeshStandardMaterial({ color: 0x222228 }));
    stage.position.set(F.x - 10, 6, F.z - 55); g.add(stage); addBox(F.x - 27, F.x + 7, F.z - 63, F.z - 47);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshBasicMaterial({ map: bannerTexture('NEURIO FESTIVAL', '#ff3d7f', '#1a1030') }));
    screen.position.set(F.x - 10, 14, F.z - 62.5); g.add(screen);
    // entrance arch over the festival road
    const arch = new THREE.Group();
    const pillarM = new THREE.MeshStandardMaterial({ color: 0xff3d7f, emissive: 0x551028 });
    for (const sx of [-11, 11]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 14, 1.6), pillarM); p.position.set(sx, 7, 0); p.castShadow = true; arch.add(p); }
    const ban = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 0.8), new THREE.MeshStandardMaterial({ map: bannerTexture('NEURIO FESTIVAL', '#ffffff', '#ff3d7f') }));
    ban.position.y = 13; arch.add(ban);
    const fr = nearestRoad(F.x + 110, F.z - 10, 3).s;
    arch.position.set(fr.x, fr.y, fr.z); arch.rotation.y = Math.atan2(fr.tx, fr.tz) + Math.PI / 2;
    scene.add(arch);
    for (const sx of [-11, 11]) addCircle(fr.x + -fr.tz * sx, fr.z + fr.tx * sx, 1.2);
    // flags
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, x = F.x + Math.cos(a) * (F.r + 4), z = F.z + Math.sin(a) * (F.r + 4);
      if (onRoad(x, z, 3)) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      pole.position.set(x, heightAt(x, z) + 4.5, z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      flag.position.set(1.2, 3.6, 0); pole.add(flag); scene.add(pole);
      animated.push((t) => { flag.rotation.y = Math.sin(t * 3 + i) * 0.35; });
    }
  }

  // ───────── airfield ─────────
  {
    const R = ZONES.runway, len = R.x1 - R.x0, wid = R.z1 - R.z0;
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(len, wid).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: runwayTexture(renderer, len / wid), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
    rw.position.set((R.x0 + R.x1) / 2, 6.06, (R.z0 + R.z1) / 2); rw.receiveShadow = true; scene.add(rw);
    for (let i = 0; i < 3; i++) {
      const x = R.x0 + 60 + i * 55, z = R.z0 - 40;
      const hg = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 40, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
      hg.position.set(x, 6, z); hg.castShadow = true; scene.add(hg); addBox(x - 16, x + 16, z - 20, z + 20);
    }
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 22, 10), new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
    tower.position.set(R.x1 - 40, 17, R.z0 - 45); tower.castShadow = true; scene.add(tower); addCircle(R.x1 - 40, R.z0 - 45, 3);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 3.5, 4, 10), new THREE.MeshStandardMaterial({ color: 0x3a6f8f, metalness: 0.5, roughness: 0.1 }));
    cab.position.set(R.x1 - 40, 30, R.z0 - 45); scene.add(cab);
  }

  // ───────── wind farm ─────────
  for (let i = 0; i < 7; i++) {
    const x = 700 + (i % 3) * 110 + rnd() * 30, z = -300 - Math.floor(i / 3) * 120 - rnd() * 30;
    if (onRoad(x, z, 12)) continue;
    const h = heightAt(x, z), g = new THREE.Group(); g.position.set(x, h, z);
    const m = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.5 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 50, 10), m); mast.position.y = 25; mast.castShadow = true;
    const hub = new THREE.Group(); hub.position.set(0, 50, 1.6);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 0.3).translate(0, 11, 0), m); b.rotation.z = k * 2.094; b.castShadow = true; hub.add(b); }
    g.add(mast, hub); g.rotation.y = -0.6; scene.add(g); addCircle(x, z, 1.8);
    const sp = 0.6 + rnd() * 0.4; animated.push((t) => (hub.rotation.z = t * sp));
  }

  // ───────── lighthouse on the coast ─────────
  {
    let lx = 860, lz = 640; for (let t = 0; t < 60 && heightAt(lx, lz) < 3; t++) { lx -= 6; lz -= 6; }
    const h = heightAt(lx, lz), g = new THREE.Group(); g.position.set(lx, h, lz);
    for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(3 - k * 0.25, 3.2 - k * 0.25, 4.5, 16), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xd62b2b : 0xffffff })); s.position.y = 2.25 + k * 4.5; s.castShadow = true; g.add(s); }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.5, 12), new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffee88, emissiveIntensity: 2 })); lamp.position.y = 28.5; g.add(lamp);
    scene.add(g); addCircle(lx, lz, 3.3);
  }

  // ───────── roadside barriers on the mountain pass ─────────
  {
    const pr = roads.find((r) => r.def.name === 'pass').s, geos = [];
    for (let k = 0; k < pr.length; k += 4) {
      const p = pr[k];
      for (const side of [-1, 1]) {
        const nx = -p.tz * side, nz = p.tx * side, x = p.x + nx * (p.w + 1.2), z = p.z + nz * (p.w + 1.2);
        if (heightAt(x + nx * 6, z + nz * 6) > p.y - 3) continue;     // only where it drops away
        const g = new THREE.BoxGeometry(0.25, 0.7, 12.5); g.rotateY(Math.atan2(p.tx, p.tz)); g.translate(x, p.y + 0.6, z); geos.push(g);
        addCircle(x, z, 0.5);
      }
    }
    if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.3, roughness: 0.45 })); m.castShadow = true; scene.add(m); }
  }

  // ───────── Japanese village: houses, block walls, shrine, torii, vending machines ─────────
  {
    const V = ZONES.village, wallG = [], roofG = [], fenceG = [], woodG = [];
    const wallCols = [0xf1ece0, 0xe6dccb, 0xd9cfbd, 0xf6f4ef, 0x9b7b5b, 0xcfc6b4];
    const roofCols = [0x3b4552, 0x2f3338, 0x5a4a40, 0x44505e, 0x6b3a2e];
    const tint = (g, hex) => { const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < a.length; k += 3) { a[k] = c.r; a[k + 1] = c.g; a[k + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const boxUV = (g, w, h, d, sx = 3, sy = 2.9) => { const uv = g.attributes.uv, dims = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const k = f * 4 + v, [fw, fh] = dims[f]; if (!fw) uv.setXY(k, 0.02, 0.02); else uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(fw / sx)), uv.getY(k) * Math.max(1, Math.round(fh / sy))); } return g; };
    function house(cx, cz, rot, w, d, stories) {
      const hW = 2.9 * stories, y0 = V.h;
      const walls = boxUV(new THREE.BoxGeometry(w, hW, d), w, hW, d); walls.translate(0, y0 + hW / 2, 0);
      tint(walls, wallCols[(rnd() * wallCols.length) | 0]);
      // hipped kawara roof with overhang
      const rh = 1.6 + rnd() * 0.8, over = 1.25, rr = Math.SQRT1_2;
      const roof = new THREE.ConeGeometry(1, rh, 4, 1).rotateY(Math.PI / 4); roof.scale((w + over * 2) * rr, 1, (d + over * 2) * rr);
      roof.translate(0, y0 + hW + rh / 2, 0); tint(roof, roofCols[(rnd() * roofCols.length) | 0]);
      const parts = [[walls, wallG], [roof, roofG]];
      if (stories > 1) { const eave = new THREE.BoxGeometry(w + 1.4, 0.18, d + 1.4); eave.translate(0, y0 + 2.9, 0); tint(eave, 0x3b4552); parts.push([eave, roofG]); }
      // entrance canopy
      const can = new THREE.BoxGeometry(2.4, 0.12, 1.2); can.translate(0, y0 + 2.3, d / 2 + 0.6); tint(can, 0x333333); parts.push([can, roofG]);
      for (const [g, arr] of parts) { g.rotateY(rot); g.translate(cx, 0, cz); arr.push(g); }
      const c = Math.abs(Math.cos(rot)) > 0.5, hw = (c ? w : d) / 2 + 0.2, hd = (c ? d : w) / 2 + 0.2;
      addBox(cx - hw, cx + hw, cz - hd, cz + hd);
    }
    function blockWall(x0, z0, x1, z1) { // concrete "block-bei" garden wall segment
      const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.BoxGeometry(0.2, 1.2, len);
      g.rotateY(Math.atan2(x1 - x0, z1 - z0)); g.translate((x0 + x1) / 2, V.h + 0.6, (z0 + z1) / 2); tint(g, 0xb9b6ae); fenceG.push(g);
    }
    for (let i = 0; i < VX.length - 1; i++) for (let j = 0; j < VZ.length - 1; j++) {
      const bx0 = VX[i] + 5, bx1 = VX[i + 1] - 5, bz0 = VZ[j] + 5, bz1 = VZ[j + 1] - 5;
      if (i === VX.length - 2 && j === VZ.length - 2) { shrine((bx0 + bx1) / 2, (bz0 + bz1) / 2 + 4); continue; }
      const cols = 3, lotW = (bx1 - bx0) / cols;
      for (let c = 0; c < cols; c++) for (const side of [0, 1]) {
        const lx = bx0 + lotW * (c + 0.5), lz = side ? bz1 - 12 : bz0 + 12;
        if (rnd() < 0.12) { plantTree(rnd() < 0.5 ? 'sakura' : 'maple', lx, lz, 0.7, V.h); continue; } // small garden / empty lot
        const w = 7 + rnd() * 3, d = 7 + rnd() * 2.5;
        house(lx + (rnd() - 0.5) * 2, lz, side ? 0 : Math.PI, w, d, rnd() < 0.6 ? 2 : 1);
        // garden wall along the street side with a gap for the gate
        const zz = side ? bz1 - 1 : bz0 + 1, x0 = lx - lotW / 2 + 0.5, x1 = lx + lotW / 2 - 0.5;
        blockWall(x0, zz, lx - 1.6, zz); blockWall(lx + 1.6, zz, x1, zz);
      }
    }
    function shrine(cx, cz) {
      const y0 = V.h;
      const base = new THREE.BoxGeometry(16, 1.2, 12); base.translate(cx, y0 + 0.6, cz); tint(base, 0x8e8a80); woodG.push(base);
      const hall = new THREE.BoxGeometry(12, 4.5, 8); hall.translate(cx, y0 + 1.2 + 2.25, cz); tint(hall, 0xb3261e); woodG.push(hall);
      const roof = new THREE.ConeGeometry(1, 3.6, 4, 1).rotateY(Math.PI / 4); roof.scale(17 * Math.SQRT1_2, 1, 13 * Math.SQRT1_2); roof.translate(cx, y0 + 5.7 + 1.8, cz); tint(roof, 0x2c3a2e); roofG.push(roof);
      const ridge = new THREE.BoxGeometry(9, 0.5, 0.6); ridge.translate(cx, y0 + 9.4, cz); tint(ridge, 0x1d1d1d); roofG.push(ridge);
      addBox(cx - 8, cx + 8, cz - 6, cz + 6);
      torii(cx, cz - 17, 0, 1.1);
      for (const sx of [-4, 4]) { const lan = new THREE.CylinderGeometry(0.5, 0.7, 2.4, 6); lan.translate(cx + sx, y0 + 1.2, cz - 10); tint(lan, 0x9c978d); woodG.push(lan); addCircle(cx + sx, cz - 10, 0.6); }
    }
    function torii(x, z, rot, s = 1, y0 = heightAt(x, z)) {
      const red = 0xd23a1f, parts = [];
      for (const sx of [-2.6, 2.6]) { const p = new THREE.CylinderGeometry(0.28, 0.34, 6.2, 10); p.translate(sx * s, 3.1, 0); tint(p, red); parts.push(p); }
      const nuki = new THREE.BoxGeometry(6.6, 0.35, 0.35); nuki.translate(0, 5.0, 0); tint(nuki, red); parts.push(nuki);
      const kasa = new THREE.BoxGeometry(8.2, 0.5, 0.6); kasa.translate(0, 6.3, 0); tint(kasa, red); parts.push(kasa);
      const top = new THREE.BoxGeometry(8.6, 0.28, 0.75); top.translate(0, 6.65, 0); tint(top, 0x151515); parts.push(top);
      for (const g of parts) { g.scale(s, s, s); g.rotateY(rot); g.translate(x, y0, z); woodG.push(g); }
      for (const sx of [-2.6, 2.6]) addCircle(x + Math.cos(rot) * sx * s, z - Math.sin(rot) * sx * s, 0.4 * s);
    }
    // torii over the roads into the village and at the lake
    const t1 = nearestRoad(148, 470, 3).s; torii(t1.x, t1.z, Math.atan2(t1.tx, t1.tz) + Math.PI / 2, 1.5, t1.y);
    const lk = roads.find((r) => r.def.name === 'lake').s, t2 = lk[(lk.length * 0.72) | 0]; torii(t2.x, t2.z, Math.atan2(t2.tx, t2.tz) + Math.PI / 2, 1.3, t2.y);
    const houseMat = new THREE.MeshStandardMaterial({ map: houseTexture(renderer), vertexColors: true, roughness: 0.8 });
    const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    for (const [arr, mat] of [[wallG, houseMat], [roofG, flatMat], [fenceG, flatMat], [woodG, flatMat]]) {
      if (!arr.length) continue;
      arr.forEach((g) => { if (!g.index) return; }); // all BoxGeometry/ConeGeometry are indexed
      const norm = arr.map((g) => { const n = g.index ? g : g; if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
      const m = new THREE.Mesh(mergeGeometries(norm), mat); m.castShadow = m.receiveShadow = true; scene.add(m);
    }
    // vending machines at street corners
    const vmGeo = [], vmTex = vendingTexture(renderer);
    for (let k = 0; k < 10; k++) {
      const x = VX[(rnd() * VX.length) | 0] + 4.2 * (rnd() < 0.5 ? 1 : -1), z = VZ[0] + 10 + rnd() * (VZ[VZ.length - 1] - VZ[0] - 20);
      const g = new THREE.BoxGeometry(0.9, 1.85, 0.75); g.rotateY(x > 150 ? -Math.PI / 2 : Math.PI / 2); g.translate(x, V.h + 0.93, z); vmGeo.push(g); addCircle(x, z, 0.6);
    }
    const vm = new THREE.Mesh(mergeGeometries(vmGeo), new THREE.MeshStandardMaterial({ map: vmTex, emissive: 0xffffff, emissiveMap: vmTex, emissiveIntensity: 0.35 })); vm.castShadow = true; scene.add(vm);
  }

  // ───────── utility poles + sagging wires along roads (very Japanese) ─────────
  {
    const poleG = [], wire = [];
    const lines = [];
    for (const r of roads) {
      const k0 = r.def.kind; if (k0 === 'highway' || k0 === 'mountain' || k0 === 'city') continue;
      const step = k0 === 'town' ? 9 : 12, off = r.s[0].w + (k0 === 'town' ? 1.2 : 2.6), line = [];
      for (let k = 0; k < r.s.length; k += step) {
        const p = r.s[k], x = p.x - p.tz * off, z = p.z + p.tx * off;
        if (inZone(x, z, 0) && k0 !== 'town') { if (line.length > 1) lines.push(line.splice(0)); else line.length = 0; continue; }
        const h = k0 === 'town' ? ZONES.village.h : heightAt(x, z);
        if (h < 1) continue;
        const g = new THREE.CylinderGeometry(0.14, 0.2, 10, 6); g.translate(x, h + 5, z); poleG.push(g);
        const arm = new THREE.BoxGeometry(1.8, 0.12, 0.12); arm.rotateY(Math.atan2(p.tx, p.tz) + Math.PI / 2); arm.translate(x, h + 9.2, z); poleG.push(arm);
        const tr = new THREE.CylinderGeometry(0.28, 0.28, 0.8, 8); tr.translate(x + p.tz * 0.35, h + 7.4, z - p.tx * 0.35); if (rnd() < 0.3) poleG.push(tr); // transformer can
        addCircle(x, z, 0.3);
        line.push({ x, z, y: h + 9.2, nx: p.tx, nz: p.tz });
      }
      if (line.length > 1) lines.push(line);
    }
    for (const line of lines) for (let k = 1; k < line.length; k++) {
      const a = line[k - 1], b = line[k];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 60) continue;
      for (const o of [-0.75, 0, 0.75]) {
        const ax = a.x - a.nz * 0 + a.nx * 0, ox = -a.nz, oz = a.nx; // lateral offset along crossarm
        let px = a.x + ox * o, pz = a.z + oz * o, py = a.y;
        for (let t = 1; t <= 8; t++) {
          const u = t / 8, x = a.x + (b.x - a.x) * u + ox * o, z = a.z + (b.z - a.z) * u + oz * o, y = a.y + (b.y - a.y) * u - Math.sin(u * Math.PI) * 0.8;
          wire.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
        }
      }
    }
    const pm = new THREE.Mesh(mergeGeometries(poleG.map((g) => { g.deleteAttribute('uv'); return g; })), new THREE.MeshStandardMaterial({ color: 0x9a9892, roughness: 0.9 }));
    pm.castShadow = true; scene.add(pm);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1b1b1b })));
  }

  // ───────── neon signs in the city (Tokyo vibe) ─────────
  {
    const words = ['ラーメン', 'カラオケ', 'ホテル', '寿司', 'ゲーム', '居酒屋', 'カフェ', '薬'];
    const cols = ['#ff2d55', '#ffcc00', '#00e5ff', '#7cff4f', '#ff7a00', '#c86bff'];
    const texs = words.map((w, i) => signTexture(w, cols[i % cols.length]));
    const buckets = texs.map(() => []);
    for (const b of boxes) {
      if (b.x0 < ZONES.city.x0 || b.x1 > ZONES.city.x1 || b.z0 < ZONES.city.z0 || b.z1 > ZONES.city.z1) continue;
      if (rnd() < 0.35) continue;
      const k = (rnd() * texs.length) | 0, h = 5 + rnd() * 3, y = ZONES.city.h + 4 + rnd() * 6;
      const onX = rnd() < 0.5, g = new THREE.BoxGeometry(1.1, h, 0.25);
      if (onX) { g.rotateY(Math.PI / 2); g.translate(b.x0 - 0.2 + (rnd() < 0.5 ? 0 : b.x1 - b.x0 + 0.4), y + h / 2, b.z0 + 1.5 + rnd() * (b.z1 - b.z0 - 3)); }
      else g.translate(b.x0 + 1.5 + rnd() * (b.x1 - b.x0 - 3), y + h / 2, (rnd() < 0.5 ? b.z0 - 0.2 : b.z1 + 0.2));
      buckets[k].push(g);
    }
    buckets.forEach((arr, k) => { if (!arr.length) return; scene.add(new THREE.Mesh(mergeGeometries(arr), new THREE.MeshStandardMaterial({ map: texs[k], emissive: 0xffffff, emissiveMap: texs[k], emissiveIntensity: 0.8 }))); });
  }

  // ───────── grass: dense blades streamed around the player ─────────
  const windU = { value: 0 };
  for (const k in TREE_TYPES) addWind(TREE_TYPES[k].mat, windU, 0.012);
  const TILE = 22, RAD = 2, SLOTS = (RAD * 2 + 1) ** 2, PER = 1400;
  const grassGeo = makeGrassClump(), grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 });
  addWind(grassMat, windU, 0.09, true);
  const slots = [];
  for (let k = 0; k < SLOTS; k++) { const m = new THREE.InstancedMesh(grassGeo, grassMat, PER); m.count = 0; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); slots.push({ m, key: null }); }
  const isGrassy = (x, z, h) => h > 3.4 && h < 135 && !inZone(x, z, 2) && !onRoad(x, z, 1.2) && vnoise(x / 25 + 3, z / 25) > 0.22;
  function fillTile(slot, tx, tz) {
    slot.key = tx + ',' + tz;
    let sd = (tx * 73856093) ^ (tz * 19349663); const r = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let n = 0;
    for (let k = 0; k < PER; k++) {
      const x = (tx + r()) * TILE, z = (tz + r()) * TILE, h = heightAt(x, z);
      if (!isGrassy(x, z, h)) continue;
      const s = 0.6 + r() * 0.9;
      _q.setFromAxisAngle(_Y, r() * 6.28); _m4.compose(_p.set(x, h - 0.05, z), _q, _s.set(s, s * (0.7 + r() * 0.8), s));
      slot.m.setMatrixAt(n++, _m4);
    }
    slot.m.count = n; slot.m.instanceMatrix.needsUpdate = true;
  }
  function grassUpdate(cx, cz, t) {
    windU.value = t;
    const tx0 = Math.floor(cx / TILE), tz0 = Math.floor(cz / TILE);
    let rebuilt = 0;
    for (let i = -RAD; i <= RAD; i++) for (let j = -RAD; j <= RAD; j++) {
      const tx = tx0 + i, tz = tz0 + j, si = (((tx % 5) + 5) % 5) + 5 * (((tz % 5) + 5) % 5), sl = slots[si];
      if (sl.key !== tx + ',' + tz && rebuilt < 3) { fillTile(sl, tx, tz); rebuilt++; }
    }
  }

  // ───────── queries ─────────
  function surfaceAt(x, z) {
    const h = heightAt(x, z);
    if (h < WATER - 0.25) return { mu: 0.5, drag: 6, name: 'water', depth: WATER - h };
    const R = ZONES.runway; if (x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1) return { mu: 1, drag: 0, name: 'asphalt' };
    const C = ZONES.city; if (x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1) return { mu: 1, drag: 0, name: 'asphalt' };
    const n = nearestRoad(x, z, 1);
    if (n && n.d < n.s.w + 0.5) return { mu: 1, drag: 0, name: 'asphalt' };
    if (h < 3.2) return { mu: 0.62, drag: 1.2, name: 'sand' };
    if (h > 150) return { mu: 0.55, drag: 0.6, name: 'snow' };
    return { mu: 0.75, drag: 0.5, name: 'grass' };
  }
  // circle (car) vs world → returns push-out normal or null
  function collide(x, z, r, onBreak) {
    let hit = null;
    const cx = Math.floor(x / CG), cz = Math.floor(z / CG);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = cgrid.get((cx + i + 1000) * 4096 + (cz + j + 1000)); if (!a) continue;
      for (const o of a) {
        if (!o.alive) continue;
        const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = r + o.r;
        if (d < m && d > 1e-6 && o.brk && onBreak && onBreak(o)) continue;
        if (d < m && d > 1e-6) { hit = { nx: dx / d, nz: dz / d, pen: m - d }; x += hit.nx * hit.pen; z += hit.nz * hit.pen; }
      }
    }
    for (const b of boxes) {
      if (x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r) continue;
      const qx = Math.max(b.x0, Math.min(x, b.x1)), qz = Math.max(b.z0, Math.min(z, b.z1));
      let dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
      if (d < 1e-6) { // centre inside box: push out the shortest way
        const opts = [[x - b.x0, -1, 0], [b.x1 - x, 1, 0], [z - b.z0, 0, -1], [b.z1 - z, 0, 1]].sort((u, v) => u[0] - v[0])[0];
        hit = { nx: opts[1], nz: opts[2], pen: opts[0] + r };
      } else if (d < r) hit = { nx: dx / d, nz: dz / d, pen: r - d };
      else continue;
      x += hit.nx * hit.pen; z += hit.nz * hit.pen;
    }
    // world border
    const lim = HALF - 30;
    if (Math.abs(x) > lim) { hit = { nx: -Math.sign(x), nz: 0, pen: Math.abs(x) - lim }; x = Math.sign(x) * lim; }
    if (Math.abs(z) > lim) { hit = { nx: 0, nz: -Math.sign(z), pen: Math.abs(z) - lim }; z = Math.sign(z) * lim; }
    return hit ? { ...hit, x, z } : null;
  }
  function spawnNear(x, z) {
    const n = nearestRoad(x, z, 6) || nearestRoad(0, 0, 60);
    return { x: n.s.x, z: n.s.z, yaw: Math.atan2(-n.s.tx, -n.s.tz) };
  }
  let lastT = 0;
  function update(t, cx = 0, cz = 0) { const dt = Math.min(0.1, t - lastT); lastT = t; for (const f of animated) f(t); updateFalling(dt); grassUpdate(cx, cz, t); }

  // ───────── minimap image ─────────
  const MM = 512, mm = document.createElement('canvas'); mm.width = mm.height = MM;
  {
    const g = mm.getContext('2d'), img = g.createImageData(MM, MM);
    for (let j = 0; j < MM; j++) for (let i = 0; i < MM; i++) {
      const x = -HALF + (i + 0.5) * WORLD / MM, z = -HALF + (j + 0.5) * WORLD / MM, h = heightAt(x, z), o = (j * MM + i) * 4;
      let r, gg, b;
      if (h < WATER) { r = 40; gg = 110; b = 150; }
      else if (h < 3.2) { r = 215; gg = 200; b = 150; }
      else if (h > 150) { r = 235; gg = 238; b = 242; }
      else { const k = Math.min(1, h / 140); r = 80 + k * 60; gg = 125 - k * 10; b = 60 + k * 50; }
      const C = ZONES.city; if (x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1) { r = 150; gg = 150; b = 150; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const toPx = (v) => (v + HALF) / WORLD * MM;
    g.lineCap = g.lineJoin = 'round';
    for (const r of roads) {
      const fl = r.def.flat !== undefined; g.strokeStyle = fl ? '#dcdcdc' : r.def.kind === 'highway' ? '#ffd24a' : '#f5f5f5'; g.lineWidth = fl ? 1.3 : r.def.kind === 'highway' ? 3.2 : 2.2;
      g.beginPath(); r.s.forEach((s, k) => (k ? g.lineTo(toPx(s.x), toPx(s.z)) : g.moveTo(toPx(s.x), toPx(s.z)))); if (r.def.loop) g.closePath(); g.stroke();
    }
    const F = ZONES.festival; g.fillStyle = '#ff3d7f'; g.beginPath(); g.arc(toPx(F.x), toPx(F.z), 6, 0, 7); g.fill();
    const R = ZONES.runway; g.fillStyle = '#444'; g.fillRect(toPx(R.x0), toPx(R.z0), toPx(R.x1) - toPx(R.x0), toPx(R.z1) - toPx(R.z0));
  }

  return { heightAt, surfaceAt, collide, spawnNear, update, knock, minimap: mm, size: WORLD, roads };
}

// ───────── procedural textures ─────────
function canvasTex(renderer, w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noiseTexture(renderer) {
  const t = canvasTex(renderer, 256, 256, (g) => {
    const d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = 200 + Math.random() * 55; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  });
  t.repeat.set(WORLD / 8, WORLD / 8);
  return t;
}
function roadTexture(renderer, kind) {
  // Japanese road markings: white edge lines, white dashed centre (passing allowed),
  // yellow solid centre on mountain roads (no overtaking), multi-lane dashes on the highway
  return canvasTex(renderer, 256, 512, (g, w, h) => {
    g.fillStyle = kind === 'town' ? '#55575a' : '#3a3c3f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = 40 + Math.random() * 45 | 0; g.fillStyle = `rgba(${v},${v},${v},.55)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(20,20,20,.12)'; g.fillRect(0, Math.random() * h, w, 10 + Math.random() * 30); } // patch repairs
    g.fillStyle = '#ececec';
    const edge = kind === 'town' ? 5 : 10;
    g.fillRect(edge, 0, kind === 'town' ? 5 : 7, h); g.fillRect(w - edge - (kind === 'town' ? 5 : 7), 0, kind === 'town' ? 5 : 7, h);
    if (kind === 'highway') { g.fillRect(w * 0.25 - 3, 0, 6, h * 0.4); g.fillRect(w * 0.75 - 3, 0, 6, h * 0.4); g.fillStyle = '#f2b91f'; g.fillRect(w / 2 - 4, 0, 8, h); }
    else if (kind === 'mountain') { g.fillStyle = '#f2b91f'; g.fillRect(w / 2 - 4, 0, 8, h); }
    else if (kind === 'rural' || kind === 'city') g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
  });
}
function zebraTexture(renderer) {
  return canvasTex(renderer, 256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(240,240,240,.95)';
    for (let x = 6; x < w; x += 26) g.fillRect(x, 4, 14, h - 8);
  }, false);
}
function windowTexture(renderer) {
  return canvasTex(renderer, 128, 128, (g, w, h) => {
    g.fillStyle = '#d9d6d0'; g.fillRect(0, 0, w, h);
    const lit = Math.random() < 0.3;
    g.fillStyle = lit ? '#e8d9a0' : '#39505e'; g.fillRect(18, 22, 92, 70);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(18, 22, 92, 12);
    g.fillStyle = '#b8b4ac'; g.fillRect(0, 100, w, 8);
  });
}
function runwayTexture(renderer, aspect) {
  const t = canvasTex(renderer, 1024, 128, (g, w, h) => {
    g.fillStyle = '#2f3134'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#eee'; g.fillRect(0, 6, w, 4); g.fillRect(0, h - 10, w, 4);
    for (let x = 60; x < w - 60; x += 40) g.fillRect(x, h / 2 - 2, 22, 4);
    for (let k = 0; k < 6; k++) { g.fillRect(8, 20 + k * 16, 36, 8); g.fillRect(w - 44, 20 + k * 16, 36, 8); }
  }, false);
  return t;
}
function bannerTexture(text, fg, bg) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 1024, 0); gr.addColorStop(0, bg); gr.addColorStop(1, '#ffb300');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = fg; g.font = 'bold 120px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ───────── trees: merged multi-part geometries with vertex colours ─────────
function part(g, colFn) {
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let k = 0; k < p.count; k++) { colFn(p.getX(k), p.getY(k), p.getZ(k), col); c[k * 3] = col.r; c[k * 3 + 1] = col.g; c[k * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function lumpy(g, amt, sd) { // organic jitter (after vertex merge so there are no cracks)
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), n = vnoise(x * 1.7 + sd, z * 1.7 + y * 1.3) - 0.5; const l = Math.hypot(x, y, z) || 1; p.setXYZ(k, x + (x / l) * n * amt, y + (y / l) * n * amt, z + (z / l) * n * amt); }
  return g;
}
function makeTreeTypes() {
  const bark = (c) => (x, y, z, o) => o.set(c).multiplyScalar(0.85 + 0.3 * vnoise(y * 3, x * 9));
  const leaf = (a, b, sd = 0) => (x, y, z, o) => o.set(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, (y - 3) / 7 + (vnoise(x * 0.9 + sd, z * 0.9 + y) - 0.5) * 0.8)));
  const blob = (r, x, y, z, a, b, sd) => { const g = new THREE.IcosahedronGeometry(r, 1); const m = part(g, leaf(a, b, sd)); lumpy(m, r * 0.35, sd); m.translate(x, y, z); return m; };
  const types = {};
  const finish = (parts, trunk) => {
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    return { geo, mat, matSingle: mat, trunk };
  };
  { // sugi (Japanese cedar): tall trunk + stacked tiers
    const parts = [part(new THREE.CylinderGeometry(0.22, 0.4, 7, 7).translate(0, 3.5, 0), bark(0x5b3b28))];
    for (let i = 0; i < 5; i++) {
      const r = 2.5 - i * 0.42, h = 3.4 - i * 0.3, y = 3.2 + i * 1.85;
      const c = part(new THREE.ConeGeometry(r, h, 9, 2).translate(0, y + h / 2, 0), leaf(0x1f4222, 0x3f6d34, i));
      lumpy(c, 0.35, i * 3); parts.push(c);
    }
    types.sugi = finish(parts, 0.4);
  }
  const broadleaf = (a, b, trunkCol, spread = 1) => {
    const parts = [part(new THREE.CylinderGeometry(0.22, 0.38, 4.2, 7).translate(0, 2.1, 0), bark(trunkCol))];
    const br = part(new THREE.CylinderGeometry(0.09, 0.16, 2.6, 5).rotateZ(0.7).translate(0.8, 4.2, 0), bark(trunkCol)); parts.push(br);
    const br2 = part(new THREE.CylinderGeometry(0.09, 0.16, 2.4, 5).rotateZ(-0.7).rotateY(2).translate(-0.5, 4.1, 0.6), bark(trunkCol)); parts.push(br2);
    const pts = [[0, 6.2, 0, 2.6], [1.7 * spread, 5.4, 0.4, 1.9], [-1.4 * spread, 5.6, 1.0, 2.0], [0.3, 5.3, -1.7 * spread, 1.9], [-0.6, 7.3, -0.4, 1.8], [0.9, 7.0, 1.0, 1.5]];
    pts.forEach(([x, y, z, r], i) => parts.push(blob(r, x, y, z, a, b, i * 5.3)));
    return finish(parts, 0.38);
  };
  types.broad = broadleaf(0x2f5a22, 0x6f9b3c, 0x5a4030);
  types.maple = broadleaf(0x9c2a14, 0xf08a24, 0x4a3326, 1.1);    // momiji — autumn red/orange
  types.sakura = broadleaf(0xe89ab4, 0xffe2ec, 0x3b2a26, 1.25);  // cherry blossom
  return types;
}
function addWind(mat, U, amt, grass = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = U;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = instanceMatrix[3].xz;
      #else
        vec2 ip = vec2(0.);
      #endif
      float hh = ${grass ? 'position.y * position.y * 1.8' : 'max(position.y - 3.0, 0.0) * max(position.y - 3.0, 0.0) * 0.02'};
      float wv = sin(uWind * ${grass ? '2.2' : '0.9'} + ip.x * 0.15 + ip.y * 0.11) + 0.4 * sin(uWind * 3.1 + ip.x * 0.4);
      transformed.x += wv * hh * ${amt.toFixed(3)} * ${grass ? '1.0' : '10.0'};
      transformed.z += wv * hh * ${amt.toFixed(3)} * ${grass ? '0.6' : '6.0'};`);
  };
  mat.customProgramCacheKey = () => (grass ? 'grass-wind' : 'tree-wind');
}
function makeGrassClump() {
  const P = [], C = [], base = new THREE.Color(0x2d4d19), tip = new THREE.Color(0x9cc452), dry = new THREE.Color(0xc2b56a);
  for (let b = 0; b < 7; b++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.35 + Math.random() * 0.45, w = 0.045 + Math.random() * 0.03, ang = Math.random() * Math.PI, dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
    const lean = (Math.random() - 0.5) * 0.25, lz = (Math.random() - 0.5) * 0.25;
    const t = tip.clone().lerp(dry, Math.random() * 0.35);
    // two-segment tapered blade
    const mx = x + lean * 0.4, mz = z + lz * 0.4, my = h * 0.5;
    P.push(x - dx, 0, z - dz, x + dx, 0, z + dz, mx + dx * 0.6, my, mz + dz * 0.6,
           x - dx, 0, z - dz, mx + dx * 0.6, my, mz + dz * 0.6, mx - dx * 0.6, my, mz - dz * 0.6,
           mx - dx * 0.6, my, mz - dz * 0.6, mx + dx * 0.6, my, mz + dz * 0.6, x + lean, h, z + lz);
    const mid = base.clone().lerp(t, 0.5);
    for (const c of [base, base, mid, base, mid, mid, mid, mid, t]) C.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  // point normals up so blades are lit softly like a lawn
  const n = g.attributes.normal; for (let k = 0; k < n.count; k++) n.setXYZ(k, n.getX(k) * 0.3, 1, n.getZ(k) * 0.3);
  return g;
}
function houseTexture(renderer) {
  // plaster wall + wooden-framed window with shoji grid
  return canvasTex(renderer, 128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(0,0,0,.03)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.fillStyle = '#4a3222'; g.fillRect(28, 30, 72, 58);
    g.fillStyle = '#efe6cf'; g.fillRect(33, 35, 62, 48);
    g.fillStyle = '#6b4a32'; for (let x = 33; x <= 95; x += 15.5) g.fillRect(x, 35, 2, 48); for (let y = 35; y <= 83; y += 12) g.fillRect(33, y, 62, 2);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 118, w, 10);
  });
}
function vendingTexture(renderer) {
  return canvasTex(renderer, 64, 128, (g, w, h) => {
    g.fillStyle = ['#d8262b', '#1f5fbf', '#f2f2f2'][Math.random() * 3 | 0]; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8f4ff'; g.fillRect(6, 10, 52, 62);
    const cols = ['#d33', '#36c', '#fc3', '#3a3', '#f80', '#999'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { g.fillStyle = cols[(r * 3 + c) % cols.length]; g.fillRect(9 + c * 8, 14 + r * 15, 5, 11); }
    g.fillStyle = '#222'; g.fillRect(12, 96, 40, 12);
  }, false);
}
function signTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 320; const g = c.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 64, 320);
  g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(4, 4, 56, 312);
  g.fillStyle = color; g.font = 'bold 44px "Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...text]; chars.forEach((ch, i) => g.fillText(ch, 32, 160 + (i - (chars.length - 1) / 2) * 56));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
