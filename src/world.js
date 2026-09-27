// 🌍 Open world — procedural, inspired by open-world racing games (original content, no game assets).
// Zones: mountains + snow (north), coast + beach + sea (south), city (east), festival (west),
// lake, airfield, forests, wind farm, lighthouse. Roads: highway ring, coastal road,
// mountain pass, city grid. Exposes height / surface / collision queries for the car physics.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  const R = ZONES.runway, dr = Math.max(R.x0 - x, x - R.x1, R.z0 - z, z - R.z1);
  h = THREE.MathUtils.lerp(6, h, ss(0, 60, dr));
  return h;
}

// ───────── roads ─────────
const ROADS_DEF = [
  { name: 'ring', w: 7, loop: true, pts: [[-700, 330], [-300, 470], [100, 430], [480, 380], [760, 170], [820, -200], [620, -470], [200, -540], [-200, -500], [-600, -420], [-880, -120], [-870, 160]] },
  { name: 'coast', w: 6, pts: [[-700, 330], [-620, 600], [-320, 780], [80, 840], [480, 770], [790, 560], [760, 170]] },
  { name: 'pass', w: 5, pts: [[-200, -500], [-160, -640], [-320, -760], [-250, -900], [-40, -980], [160, -880], [120, -720], [260, -640], [200, -540]] },
  { name: 'festival', w: 6, pts: [[-870, 160], [-620, 150], [-470, 140], [-320, 120], [-200, 20], [140, 0]] },
  { name: 'city-link', w: 6, pts: [[560, 0], [700, -20], [820, -200]] },
  { name: 'north-link', w: 6, pts: [[350, -200], [330, -380], [200, -540]] },
  { name: 'south-link', w: 6, pts: [[350, 200], [330, 320], [300, 410]] },
];
// city grid
for (let x = 140; x <= 560; x += 105) ROADS_DEF.push({ name: 'city', w: 5.5, city: true, pts: [[x, -200], [x, 200]] });
for (let z = -200; z <= 200; z += 100) ROADS_DEF.push({ name: 'city', w: 5.5, city: true, pts: [[140, z], [560, z]] });

function sampleRoad(def) {
  const v = def.pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = def.city ? new THREE.CatmullRomCurve3(v, false, 'catmullrom', 0) : new THREE.CatmullRomCurve3(v, !!def.loop, 'centripetal');
  const len = curve.getLength(), n = Math.max(2, Math.ceil(len / 3));
  const P = curve.getSpacedPoints(n);
  // elevation: smoothed terrain, kept above water
  const raw = P.map((p) => Math.max(1.8, baseHeight(p.x, p.z)));
  const el = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -14; k <= 14; k++) { let j = i + k; if (def.loop) j = (j + raw.length) % raw.length; else j = Math.min(raw.length - 1, Math.max(0, j)); s += raw[j]; c++; }
    return s / c;
  });
  if (def.city) el.fill(ZONES.city.h);
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
  const order = [...ROADS_DEF].sort((a, b) => (b.loop ? 2 : b.city ? 1 : 0) - (a.loop ? 2 : a.city ? 1 : 0));
  const roads = [];
  for (const d of order) { const r = { def: d, s: sampleRoad(d) }; if (!d.loop && !d.city) joinEnds(r, roads); roads.push(r); }
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
  const grass = new THREE.Color(0x5d8a3a), grass2 = new THREE.Color(0x7c9a45), dry = new THREE.Color(0xa59a5c), rock = new THREE.Color(0x7a746c), snow = new THREE.Color(0xf4f6fa), sand = new THREE.Color(0xdcc89a), mud = new THREE.Color(0x6b5a44), cityC = new THREE.Color(0x8a8a86);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), slope = 1 - nrm.getY(k);
    c.copy(grass).lerp(grass2, vnoise(x / 40, z / 40));
    c.lerp(dry, ss(0.2, 0.9, vnoise(x / 150 + 9, z / 150)) * 0.5);
    if (y < 3.2) c.lerp(sand, ss(3.2, 1.2, y));
    if (y < 0.3) c.lerp(mud, 0.5);
    c.lerp(rock, ss(0.18, 0.4, slope) + ss(95, 140, y) * 0.6);
    c.lerp(snow, ss(150, 185, y + vnoise(x / 30, z / 30) * 15) * (1 - ss(0.45, 0.7, slope)));
    const C = ZONES.city; if (x > C.x0 - 10 && x < C.x1 + 10 && z > C.z0 - 10 && z < C.z1 + 10) c.copy(cityC);
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
  const roadTex = roadTexture(renderer, false), cityTex = roadTexture(renderer, true);
  const rgeo = [], cgeo = [];
  roads.forEach((r, ri) => {
    const s = r.s, P = [], U = [], I = [];
    const lift = 0.07 + (r.def.city ? 0.01 + ri * 0.0005 : ri * 0.003);
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
    (r.def.city ? cgeo : rgeo).push(g);
  });
  const roadMat = (t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const roadMesh = new THREE.Mesh(mergeGeometries(rgeo), roadMat(roadTex)); roadMesh.receiveShadow = true; scene.add(roadMesh);
  const cityMesh = new THREE.Mesh(mergeGeometries(cgeo), roadMat(cityTex)); cityMesh.receiveShadow = true; cityMesh.renderOrder = 1; scene.add(cityMesh);

  // ───────── colliders ─────────
  const circles = [];           // {x,z,r}
  const boxes = [];             // {x0,x1,z0,z1}
  const CG = 40, cgrid = new Map();
  const ckey = (x, z) => (Math.floor(x / CG) + 1000) * 4096 + (Math.floor(z / CG) + 1000);
  function addCircle(x, z, r) { const o = { x, z, r }; circles.push(o); const k = ckey(x, z); if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(o); }
  function addBox(x0, x1, z0, z1) { boxes.push({ x0, x1, z0, z1 }); }
  const onRoad = (x, z, m = 0) => { const n = nearestRoad(x, z, 1); return n && n.d < n.s.w + m; };
  const inZone = (x, z, m = 0) => {
    const C = ZONES.city, F = ZONES.festival, L = ZONES.lake, R = ZONES.runway;
    return (x > C.x0 - m && x < C.x1 + m && z > C.z0 - m && z < C.z1 + m) || Math.hypot(x - F.x, z - F.z) < F.r + m
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

  // ───────── forests & rocks (instanced) ─────────
  {
    const pineM = new THREE.MeshStandardMaterial({ color: 0x2f5a2e, roughness: 0.9, flatShading: true });
    const leafM = new THREE.MeshStandardMaterial({ color: 0x4f7f2f, roughness: 0.9, flatShading: true });
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 1 });
    const pineG = new THREE.ConeGeometry(2.6, 9, 7).translate(0, 7, 0);
    const leafG = new THREE.IcosahedronGeometry(3.4, 0).translate(0, 6.2, 0);
    const trunkG = new THREE.CylinderGeometry(0.3, 0.45, 4, 6).translate(0, 2, 0);
    const MAX = 7000;
    const pines = new THREE.InstancedMesh(pineG, pineM, MAX), leafs = new THREE.InstancedMesh(leafG, leafM, MAX), trunks = new THREE.InstancedMesh(trunkG, trunkM, MAX * 2);
    let np = 0, nl = 0, nt = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (let t = 0; t < 26000 && np + nl < MAX * 1.6; t++) {
      const x = (rnd() * 2 - 1) * (HALF - 20), z = (rnd() * 2 - 1) * (HALF - 20);
      const h = heightAt(x, z);
      if (h < 2.5 || h > 150 || inZone(x, z, 10) || onRoad(x, z, 7)) continue;
      const dens = vnoise(x / 120 + 50, z / 120) + ss(-300, -700, z) * 0.4;   // clumpy forests, denser north
      if (rnd() > dens * dens * 1.4) continue;
      const slope = Math.abs(heightAt(x + 2, z) - heightAt(x - 2, z)) + Math.abs(heightAt(x, z + 2) - heightAt(x, z - 2));
      if (slope > 3) continue;
      const s = 0.7 + rnd() * 0.7, pine = z < -250 || h > 40 || rnd() < 0.3;
      q.setFromAxisAngle(Y, rnd() * 6.28); p.set(x, h - 0.2, z); sc.set(s, s * (0.85 + rnd() * 0.4), s);
      m4.compose(p, q, sc);
      if (pine && np < MAX) pines.setMatrixAt(np++, m4); else if (!pine && nl < MAX) leafs.setMatrixAt(nl++, m4); else continue;
      trunks.setMatrixAt(nt++, m4);
      addCircle(x, z, 0.5 * s + 0.2);
    }
    pines.count = np; leafs.count = nl; trunks.count = nt;
    [pines, leafs, trunks].forEach((m) => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
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
    if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.7, roughness: 0.35 })); m.castShadow = true; scene.add(m); }
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
  function collide(x, z, r) {
    let hit = null;
    const cx = Math.floor(x / CG), cz = Math.floor(z / CG);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = cgrid.get((cx + i + 1000) * 4096 + (cz + j + 1000)); if (!a) continue;
      for (const o of a) {
        const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = r + o.r;
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
  function update(t) { for (const f of animated) f(t); }

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
      g.strokeStyle = r.def.city ? '#dcdcdc' : '#f5f5f5'; g.lineWidth = r.def.city ? 1.5 : 2.6;
      g.beginPath(); r.s.forEach((s, k) => (k ? g.lineTo(toPx(s.x), toPx(s.z)) : g.moveTo(toPx(s.x), toPx(s.z)))); if (r.def.loop) g.closePath(); g.stroke();
    }
    const F = ZONES.festival; g.fillStyle = '#ff3d7f'; g.beginPath(); g.arc(toPx(F.x), toPx(F.z), 6, 0, 7); g.fill();
    const R = ZONES.runway; g.fillStyle = '#444'; g.fillRect(toPx(R.x0), toPx(R.z0), toPx(R.x1) - toPx(R.x0), toPx(R.z1) - toPx(R.z0));
  }

  return { heightAt, surfaceAt, collide, spawnNear, update, minimap: mm, size: WORLD, roads };
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
function roadTexture(renderer, city) {
  return canvasTex(renderer, 256, 512, (g, w, h) => {
    g.fillStyle = '#3b3d40'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { const v = 45 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v},.6)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#e9e9e9'; g.fillRect(8, 0, 6, h); g.fillRect(w - 14, 0, 6, h);        // edge lines
    g.fillStyle = city ? '#e9e9e9' : '#f2c230';
    if (city) g.fillRect(w / 2 - 3, 0, 6, h * 0.55);                                        // dashed
    else { g.fillRect(w / 2 - 8, 0, 5, h); g.fillRect(w / 2 + 3, 0, 5, h); }               // double yellow
  });
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
