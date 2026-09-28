// world.js — heightfield terrain, coastline, mountain, roads, city & landmarks
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import {
  clamp, clamp01, lerp, smoothstep, mulberry32, Noise, damp, rand, pick, TAU, ctx2d, texFromCanvas,
} from './util.js';
import { Mesher, addBuilding, addTower, addEvacuationTower, addLighthouse, addPalm, addPine, addBush, addRock,
  addCactus, addDriftwood, addLamp, addPowerPole, addParkedCar, addContainer, addStall, addBench, addFence,
  addWaterTank, addSign, addPier, addCrane, addFishingBoat, addCampTent, addCampfire, addWatchTower, addRadioMast,
  addStoneBridge, addHydroStation, addMineEntrance, addRuin, addWaterfall, addHarbour } from './city.js';

export const WORLD_SIZE = 2600;
const SEA_FLOOR_MIN = -20;

/* ------------------------------------------------------------------- spline */
class RoadPath {
  constructor(points, opts = {}) {
    this.halfWidth = opts.halfWidth ?? 5.6;
    this.shoulder = opts.shoulder ?? 5.0;
    this.grade = opts.grade ?? 0.14;      // max slope
    this.points = points;
    this.sampleStep = 5;
    this.samples = [];
    this.grid = new Map();
    this.cell = 40;
  }
  build(baseH) {
    const pts = this.points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const len = curve.getLength();
    const n = Math.max(8, Math.round(len / this.sampleStep));
    const raw = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      raw.push({ x: p.x, z: p.z, y: baseH(p.x, p.z), t });
    }
    // smooth the elevation profile so the road is drivable
    const smooth = (arr, k, passes) => {
      let a = arr.slice();
      for (let p = 0; p < passes; p++) {
        const b = a.slice();
        for (let i = 0; i < a.length; i++) {
          let s = 0, c = 0;
          for (let j = -k; j <= k; j++) { const idx = clamp(i + j, 0, a.length - 1); s += b[idx]; c++; }
          a[i] = s / c;
        }
      }
      return a;
    };
    const ys = smooth(raw.map((r) => r.y), 14, 6);
    const ys2 = smooth(ys, 40, 4);
    // limit the grade so the mountain road never becomes a ramp
    let prev = ys2[0];
    const limited = [prev];
    for (let i = 1; i < ys2.length; i++) {
      const step = this.sampleStep;
      const maxDiff = this.grade * step;
      const d = clamp(ys2[i] - prev, -maxDiff, maxDiff);
      prev = prev + d;
      limited.push(prev);
    }
    const finalY = smooth(limited, 6, 3);
    for (let i = 0; i < raw.length; i++) raw[i].y = finalY[i];
    // recompute directions
    for (let i = 0; i < raw.length; i++) {
      const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      raw[i].dx = dx / l; raw[i].dz = dz / l;
    }
    this.samples = raw;
    this.length = len;
    this.grid.clear();
    for (let i = 0; i < raw.length; i++) {
      const gx = Math.floor(raw[i].x / this.cell), gz = Math.floor(raw[i].z / this.cell);
      const key = gx + ',' + gz;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
    return this;
  }
  /** nearest point on the road, or null when far away */
  nearest(x, z, maxR = 60) {
    const gx = Math.floor(x / this.cell), gz = Math.floor(z / this.cell);
    const rc = Math.ceil(maxR / this.cell);
    let best = null, bestD = maxR * maxR;
    for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) {
      const list = this.grid.get((gx + i) + ',' + (gz + j));
      if (!list) continue;
      for (const idx of list) {
        const s = this.samples[idx];
        const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    if (!best) return null;
    const dist = Math.sqrt(bestD);
    return { dist, y: best.y, dx: best.dx, dz: best.dz, x: best.x, z: best.z, t: best.t };
  }
}

/* ------------------------------------------------------------------ helpers */
function ribbon(points, halfWidth, y0, step = 2.5) {
  // builds a flat strip following a list of {x,y,z,dx,dz}
  const verts = [], idx = [], uvs = [];
  const pts = [];
  for (let i = 0; i < points.length - 1; i += step > 1 ? 1 : 1) {
    const a = points[i], b = points[Math.min(i + 1, points.length - 1)];
    pts.push(a);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      pts.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: lerp(a.y, b.y, t), dx: a.dx, dz: a.dz });
    }
  }
  pts.push(points[points.length - 1]);
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) run += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const nx = -p.dz, nz = p.dx;
    for (const s of [-1, 1]) {
      verts.push(p.x + nx * halfWidth * s, p.y + y0, p.z + nz * halfWidth * s);
      uvs.push(s * 0.5 + 0.5, run / 8);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------- world */
export class World {
  constructor(scene, quality = 'high', seed = 20260928) {
    this.scene = scene;
    this.quality = quality;
    this.seed = seed;
    this.nz = new Noise(seed);
    this.nz2 = new Noise(seed + 991);
    this.colliders = [];
    this.lights = [];
    this.fireSpots = [];
    this.waterfalls = [];
    this.size = WORLD_SIZE;
    this.half = WORLD_SIZE / 2;
    this.minHeight = SEA_FLOOR_MIN;
    this.maxHeight = 480;
    this.N = quality === 'low' ? 448 : quality === 'medium' ? 576 : 704;
    this.chunks = new Map();
    this._extraY = new Map();
    this.roads = [];
    this.roadSpecs = [];
    this.spawns = {};
    this.lake = null;
    this.dams = [];
    this.piers = [];

    // landmark placement
    this.city = { x: 420, z: -60, rot: -0.22 };
    this.camp = { x: 800, z: -40, r: 46 };
    this.lakeC = { x: 906, z: 322, r: 86 };
    this.mineC = { x: 690, z: -352 };
    this.harbor = { x: 150, z: 250 };
    this.lighthouseC = { x: 40, z: 520 };

    this.peaks = [
      { x: 938, z: -70, r: 430, h: 372 },
      { x: 792, z: -330, r: 320, h: 246 },
      { x: 830, z: 330, r: 350, h: 268 },
      { x: 1150, z: -220, r: 430, h: 410 },
      { x: 1080, z: 300, r: 400, h: 320 },
      { x: 640, z: 660, r: 300, h: 168 },
      { x: 700, z: -700, r: 330, h: 196 },
      { x: 1200, z: 120, r: 380, h: 360 },
    ];
    void this.mineC;
  }

  /* ------------------------------------------------ analytic (base) height */
  coastX(z) {
    return 62 * Math.sin(z * 0.00235 + 0.6) + 26 * Math.sin(z * 0.0081 + 2.2) + 11 * Math.sin(z * 0.023 + 1.1);
  }
  baseHeight(x, z) {
    const nz = this.nz;
    const cx = this.coastX(z);
    const sd = x - cx;
    // ---- sea floor
    const off = Math.max(0, -sd);
    let sea = -1.5 - 2.8 * smoothstep(0, 45, off) - 6.5 * smoothstep(35, 240, off) - 5.5 * smoothstep(200, 760, off);
    sea += nz.fbm(x * 0.004, z * 0.004, 4) * 1.7 + nz.fbm(x * 0.018, z * 0.018, 3) * 0.5;
    const reef = smoothstep(0.52, 0.92, nz.fbm(x * 0.0058 + 40, z * 0.0058 - 22, 3) * 0.5 + 0.5);
    sea += reef * 3.6 * smoothstep(8, 130, off);
    // ---- beach + plain
    const beachH = 0.052 * clamp(sd, 0, 400);
    const dune = 2.4 * Math.exp(-Math.pow((sd - 155) / 48, 2));
    const plain = 9.7 + nz.fbm(x * 0.00105, z * 0.00105, 5) * 7.6 + nz.fbm(x * 0.0042, z * 0.0042, 3) * 1.6;
    const landMask = smoothstep(-3, 30, sd);
    let h = lerp(sea, beachH + dune, landMask);
    h = lerp(h, plain, smoothstep(115, 275, sd));
    // ---- mountains
    let mtn = 0;
    for (const p of this.peaks) {
      const d = Math.hypot(x - p.x, z - p.z);
      const t = clamp01(1 - d / p.r);
      if (t > 0) mtn = Math.max(mtn, p.h * Math.pow(t, 1.65));
    }
    if (mtn > 0.01) {
      const detail = nz.ridged(x * 0.0021, z * 0.0021, 5, 2.05, 0.5);
      const macro = 0.72 + 0.62 * nz.fbm(x * 0.0014, z * 0.0014, 4);
      mtn *= macro;
      mtn += detail * 26 * smoothstep(30, 150, mtn);
      h += mtn;
    }
    return h;
  }

  /** full height including flattening for the city / camp / lake / mine benches */
  detailHeight(x, z) {
    let h = this.baseHeight(x, z);
    // city plateau (rounded rectangle)
    const c = this.city;
    const dx = Math.abs(x - c.x) / 250, dz = Math.abs(z - c.z) / 330;
    const d = Math.pow(Math.pow(dx, 4) + Math.pow(dz, 4), 0.25);
    const cityMask = 1 - smoothstep(0.72, 1.22, d);
    if (cityMask > 0) h = lerp(h, 10.6 + 1.5 * smoothstep(300, 560, x) + 0.35 * Math.sin(x * 0.02) * 0, cityMask);
    // camp bench
    const cd = Math.hypot(x - this.camp.x, z - this.camp.z);
    const campMask = 1 - smoothstep(this.camp.r * 0.55, this.camp.r, cd);
    if (campMask > 0 && this.camp.y !== undefined) h = lerp(h, this.camp.y, campMask);
    // lake basin
    const ld = Math.hypot(x - this.lakeC.x, z - this.lakeC.z);
    const lakeMask = 1 - smoothstep(this.lakeC.r * 0.5, this.lakeC.r, ld);
    if (lakeMask > 0 && this.lakeC.y !== undefined) {
      const bowl = -3.4 * (1 - clamp01(ld / this.lakeC.r) ** 2);
      h = lerp(h, this.lakeC.y + bowl, lakeMask);
    }
    // mine bench
    const md = Math.hypot(x - this.mineC.x, z - this.mineC.z);
    const mineMask = 1 - smoothstep(16, 40, md);
    if (mineMask > 0 && this.mineC.y !== undefined) h = lerp(h, this.mineC.y, mineMask);
    return h;
  }

  /* --------------------------------------------------------- height field */
  buildHeightField(onProgress) {
    const N = this.N, S = this.size;
    const step = S / N;
    // landmark heights get fixed on the base field first
    this.camp.y = Math.round(this.baseHeight(this.camp.x, this.camp.z));
    this.lakeC.y = Math.round(this.baseHeight(this.lakeC.x, this.lakeC.z) - 1.5);
    this.mineC.y = Math.round(this.baseHeight(this.mineC.x, this.mineC.z));
    const H = new Float32Array((N + 1) * (N + 1));
    // coarse pass then add detail (keeps generation fast)
    const M = N >> 2;                       // coarse resolution
    const C = new Float32Array((M + 1) * (M + 1));
    for (let j = 0; j <= M; j++) {
      for (let i = 0; i <= M; i++) {
        const x = -this.half + (i / M) * S, z = -this.half + (j / M) * S;
        C[j * (M + 1) + i] = this.detailHeight(x, z);
      }
      if (onProgress && j % 8 === 0) onProgress(0.25 * (j / M));
    }
    const coarseAt = (u, v) => {           // bilinear on the coarse grid
      const fi = clamp(u * M, 0, M - 0.0001), fj = clamp(v * M, 0, M - 0.0001);
      const i0 = fi | 0, j0 = fj | 0, tx = fi - i0, tz = fj - j0;
      const a = C[j0 * (M + 1) + i0], b = C[j0 * (M + 1) + i0 + 1];
      const cc = C[(j0 + 1) * (M + 1) + i0], dd = C[(j0 + 1) * (M + 1) + i0 + 1];
      return lerp(lerp(a, b, tx), lerp(cc, dd, tx), tz);
    };
    const nz = this.nz2;
    for (let j = 0; j <= N; j++) {
      const z = -this.half + (j / N) * S;
      for (let i = 0; i <= N; i++) {
        const x = -this.half + (i / N) * S;
        let h = coarseAt(i / N, j / N);
        // fine detail blended in near the coast & plains only
        const cx = this.coastX(z);
        const sd = x - cx;
        const near = 1 - smoothstep(60, 320, sd);
        const fine = nz.fbm(x * 0.03, z * 0.03, 3) * 0.35 + nz.fbm(x * 0.0085, z * 0.0085, 3) * 1.15;
        h += fine * (near * 0.7 + 0.35);
        H[j * (N + 1) + i] = h;
      }
      if (onProgress && j % 12 === 0) onProgress(0.25 + 0.25 * (j / N));
    }
    this.heights = H;
    this.hn = N;
    this.hstep = step;
    return this;
  }

  /* --------------------------------------------------------------- roads */
  addRoad(points, opts = {}) { this.roadSpecs.push({ points, opts }); return this; }

  /** the three canonical routes: coastal highway, city main street, mountain switchbacks */
  defineRoads() {
    this.addRoad([[110, -1150], [130, -780], [150, -520], [175, -300], [196, -150], [232, 30], [250, 240], [228, 520], [205, 800], [215, 1150]],
      { halfWidth: 5.8, shoulder: 4.6, grade: 0.10 });
    this.addRoad([[185, -128], [280, -100], [370, -84], [470, -72], [565, -62]],
      { halfWidth: 5.0, shoulder: 3.2, grade: 0.09 });
    this.addRoad([[565, -62], [640, -18], [690, 45], [706, 130], [692, 205], [722, 272], [788, 300], [848, 268], [878, 195], [872, 118], [836, 62], [802, -16]],
      { halfWidth: 5.2, shoulder: 4.0, grade: 0.135 });
    this.addRoad([[802, -16], [766, -84], [726, -164], [704, -258], [688, -348]],
      { halfWidth: 4.2, shoulder: 3.2, grade: 0.16 });
    return this;
  }

  buildRoads() {
    const baseFn = (x, z) => this.rawHeightAt(x, z);
    this.roads = this.roadSpecs.map((r) => new RoadPath(r.points, r.opts).build(baseFn));
    // stamp the roads into the height field so nothing pokes through
    for (const road of this.roads) {
      const rw = road.halfWidth + road.shoulder;
      for (const s of road.samples) {
        const i0 = Math.max(0, Math.floor((s.x - rw + this.half) / this.hstep));
        const i1 = Math.min(this.hn, Math.ceil((s.x + rw + this.half) / this.hstep));
        const j0 = Math.max(0, Math.floor((s.z - rw + this.half) / this.hstep));
        const j1 = Math.min(this.hn, Math.ceil((s.z + rw + this.half) / this.hstep));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = -this.half + i * this.hstep, z = -this.half + j * this.hstep;
          const d = Math.hypot(x - s.x, z - s.z);
          if (d > rw) continue;
          const t = 1 - smoothstep(road.halfWidth * 0.7, rw, d);
          const idx = j * (this.hn + 1) + i;
          this.heights[idx] = lerp(this.heights[idx], s.y - 0.35, t);
        }
      }
    }
    return this;
  }

  /** raw bilinear sampling of the height grid */
  rawHeightAt(x, z) {
    const N = this.hn, S = this.size;
    const fx = clamp((x + this.half) / S, 0, 1) * N;
    const fz = clamp((z + this.half) / S, 0, 1) * N;
    const i0 = Math.min(N - 1, Math.max(0, fx | 0)), j0 = Math.min(N - 1, Math.max(0, fz | 0));
    const tx = fx - i0, tz = fz - j0;
    const H = this.heights, W = N + 1;
    const a = H[j0 * W + i0], b = H[j0 * W + i0 + 1], c = H[(j0 + 1) * W + i0], d = H[(j0 + 1) * W + i0 + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  /** smooth (Catmull-Rom) sampling — used for physics so the ground feels continuous */
  heightAt(x, z) {
    const N = this.hn, S = this.size, W = N + 1, H = this.heights;
    const fx = clamp((x + this.half) / S, 0, 1) * N;
    const fz = clamp((z + this.half) / S, 0, 1) * N;
    const i1 = Math.floor(fx), j1 = Math.floor(fz);
    const tx = fx - i1, tz = fz - j1;
    const cr = (a, b, c, d, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };
    const get = (i, j) => H[clamp(j, 0, N) * W + clamp(i, 0, N)];
    const row = [];
    for (let j = -1; j <= 2; j++) {
      row.push(cr(get(i1 - 1, j1 + j), get(i1, j1 + j), get(i1 + 1, j1 + j), get(i1 + 2, j1 + j), tx));
    }
    let h = cr(row[0], row[1], row[2], row[3], tz);
    // roads override for a perfectly smooth driving surface
    for (const road of this.roads) {
      const n = road.nearest(x, z, road.halfWidth + road.shoulder + 1);
      if (n) {
        const t = 1 - smoothstep(road.halfWidth * 0.8, road.halfWidth + road.shoulder, n.dist);
        h = lerp(h, n.y, t);
      }
    }
    return h;
  }

  normalAt(x, z, e = 1.2) {
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
  }

  slopeAt(x, z) { return 1 - this.normalAt(x, z).y; }

  onRoad(x, z) {
    for (const road of this.roads) {
      const n = road.nearest(x, z, road.halfWidth + 1.2);
      if (n) return n;
    }
    return null;
  }

  regionAt(x, z) {
    const h = this.heightAt(x, z);
    const sd = x - this.coastX(z);
    if (h < 0.2 && sd < 2) return 'sea';
    if (sd < 175) return h < 3.4 ? 'beach' : 'coast';
    if (h > 150) return 'mountain';
    const c = this.city;
    if (Math.abs(x - c.x) < 300 && Math.abs(z - c.z) < 380 && h < 40) return 'city';
    return 'plain';
  }

  /* --------------------------------------------------------- height texture */
  makeHeightTexture(size = 512) {
    const data = new Float32Array(size * size * 4);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -this.half + (i / (size - 1)) * this.size;
      const z = -this.half + (j / (size - 1)) * this.size;
      const h = this.rawHeightAt(x, z);
      const o = (j * size + i) * 4;
      data[o] = h; data[o + 1] = h; data[o + 2] = h; data[o + 3] = 1;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTex = tex;
    this.texSize = size;
    return tex;
  }

  /* -------------------------------------------------------- terrain mesh */
  buildTerrainMesh(mats) {
    const N = this.hn, S = this.size, W = N + 1;
    const vcount = W * W;
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    const uv = new Float32Array(vcount * 2);
    const col = new Float32Array(vcount * 3);
    const H = this.heights;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const idx = j * W + i;
        const x = -this.half + (i / N) * S;
        const z = -this.half + (j / N) * S;
        const h = H[idx];
        pos[idx * 3] = x; pos[idx * 3 + 1] = h; pos[idx * 3 + 2] = z;
        uv[idx * 2] = i / N; uv[idx * 2 + 1] = j / N;
        // normal from neighbours
        const hL = H[j * W + Math.max(0, i - 1)], hR = H[j * W + Math.min(N, i + 1)];
        const hD = H[Math.max(0, j - 1) * W + i], hU = H[Math.min(N, j + 1) * W + i];
        const nx = (hL - hR), ny = 2 * this.hstep, nz2 = (hD - hU);
        const l = Math.hypot(nx, ny, nz2) || 1;
        nrm[idx * 3] = nx / l; nrm[idx * 3 + 1] = ny / l; nrm[idx * 3 + 2] = nz2 / l;
        // vertex colour: macro variation + curvature AO
        const ao = clamp01(0.5 + (h - (hL + hR + hD + hU) / 4) * 0.35);
        const macro = this.nz2.fbm(x * 0.0035, z * 0.0035, 4) * 0.5 + 0.5;
        const shade = lerp(0.72, 1.12, macro) * lerp(0.72, 1.0, ao * 0.6 + 0.4);
        col[idx * 3] = shade; col[idx * 3 + 1] = shade * 0.995; col[idx * 3 + 2] = shade * 0.98;
      }
    }
    const index = new Uint32Array(N * N * 6);
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    const mat = mats.terrain;
    this.terrainMaterial = mat;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.castShadow = this.quality !== 'low';
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    this.terrainMesh = mesh;
    return mesh;
  }

  /** install splatting into the shared terrain material */
  installTerrainShader(tex) {
    const mat = this.terrainMaterial;
    const levels = this.quality === 'low' ? 3 : 5;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSandMap = { value: tex.sand.map };
      shader.uniforms.uSandN = { value: tex.sand.normalMap };
      shader.uniforms.uGrassMap = { value: tex.grass.map };
      shader.uniforms.uGrassN = { value: tex.grass.normalMap };
      shader.uniforms.uRockMap = { value: tex.rock.map };
      shader.uniforms.uRockN = { value: tex.rock.normalMap };
      shader.uniforms.uDryMap = { value: (tex.drygrass || tex.grass).map };
      shader.uniforms.uDryN = { value: (tex.drygrass || tex.grass).normalMap };
      shader.uniforms.uDirtMap = { value: (tex.dirt || tex.sand).map };
      shader.uniforms.uDirtN = { value: (tex.dirt || tex.sand).normalMap };
      shader.uniforms.uWaterLevel = { value: 0 };
      shader.uniforms.uMud = { value: 0 };
      shader.uniforms.uTexScale = { value: 1 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uSandMap, uSandN, uGrassMap, uGrassN, uRockMap, uRockN, uDryMap, uDryN, uDirtMap, uDirtN;
uniform float uWaterLevel, uMud, uTexScale;
${NOISE}
float triplanarBlend(float slope){ return smoothstep(0.35, 0.62, slope); }`)
        .replace('#include <map_fragment>', `
float gWet = 0.0;
{
  vec3 wp = vWPos;
  float h = wp.y;
  float slope = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
  vec2 w1 = wp.xz * 0.055;
  vec2 w2 = wp.xz * 0.155;
  float macro = fbm2(wp.xz * 0.012, 3);
  float sandW = (1.0 - smoothstep(1.0, 5.2, h)) * (1.0 - smoothstep(0.20, 0.48, slope));
  float grassW = smoothstep(4.0, 12.0, h) * (1.0 - smoothstep(0.34, 0.58, slope)) * (1.0 - smoothstep(150.0, 235.0, h));
  float dryW = smoothstep(120.0, 210.0, h) * (1.0 - smoothstep(260.0, 360.0, h)) * (1.0 - smoothstep(0.45, 0.7, slope));
  float rockW = smoothstep(0.40, 0.66, slope) * 0.9 + smoothstep(230.0, 340.0, h);
  float snowW = smoothstep(330.0, 420.0, h) * (1.0 - smoothstep(0.48, 0.78, slope));
  vec3 cSand = texture2D(uSandMap, w1 * 1.6).rgb;
  vec3 cGrass = texture2D(uGrassMap, w2).rgb;
  vec3 cDry = texture2D(uDryMap, w2 * 1.3).rgb;
  vec3 cRock = texture2D(uRockMap, w1 * 1.1).rgb;
  vec3 cSnow = vec3(0.86, 0.90, 0.95);
  float sum = sandW + grassW + dryW + rockW + snowW + 0.001;
  vec3 base = (cSand * sandW + cGrass * grassW + cDry * dryW + cRock * rockW + cSnow * snowW) / sum;
  base *= mix(vec3(0.82, 0.86, 0.80), vec3(1.12, 1.06, 0.98), macro * 0.5 + 0.5);
  gWet = smoothstep(1.1, -0.4, h - uWaterLevel);
  float mud = uMud * smoothstep(2.4, -0.4, h - uWaterLevel);
  base = mix(base, base * vec3(0.55, 0.52, 0.5), gWet * 0.6);
  base = mix(base, vec3(0.24, 0.19, 0.14), mud * 0.55);
  diffuseColor.rgb *= base * 1.35;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.42, gWet * 0.75);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  {
    vec3 nD = texture2D(uRockN, vWPos.xz * 0.42).rgb * 2.0 - 1.0;
    vec3 nD2 = texture2D(uSandN, vWPos.xz * 0.21).rgb * 2.0 - 1.0;
    normal = normalize(normal + (nD * 0.32 + nD2 * 0.42));
  }`);
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () => 'terrain-splat-' + this.quality;
    mat.needsUpdate = true;
    void levels;
  }

  /* -------------------------------------------------------------- chunking */
  ctxFor(x, z) {
    const cs = 420;
    const key = `${Math.floor((x + this.half) / cs)}_${Math.floor((z + this.half) / cs)}`;
    let m = this.chunks.get(key);
    if (!m) { m = new Mesher(); this.chunks.set(key, m); }
    return { m, colliders: this.colliders, lights: this.lights, fireSpots: this.fireSpots, waterfalls: this.waterfalls, world: this };
  }

  /* ------------------------------------------------------------------ city */
  buildCity() {
    const rng = mulberry32(this.seed + 5);
    const c = this.city;
    this.heroSpecs = [];
    this._citySpecs = [];
    this.destructibles = [];
    const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
    const toWorld = (u, v) => [c.x + u * cos + v * sin, c.z - u * sin + v * cos];
    const groundY = (x, z) => this.heightAt(x, z);

    // ---- street grid
    const blockW = 38, blockD = 34, streetW = 13;
    const cols = 7, rows = 8;
    for (let iu = 0; iu < cols; iu++) {
      for (let iv = 0; iv < rows; iv++) {
        const u = (iu - (cols - 1) / 2) * (blockW + streetW);
        const v = (iv - (rows - 1) / 2) * (blockD + streetW);
        // skip blocks that fall outside the plateau or into the sea
        const [bx, bz] = toWorld(u, v);
        if (this.heightAt(bx, bz) < 4 || this.heightAt(bx, bz) > 34) continue;
        if (rng() < 0.09) continue;                    // squares / empty lots
        const perRow = rng() < 0.3 ? 1 : 2;
        for (let s = 0; s < perRow; s++) {
          const off = perRow === 1 ? 0 : (s - 0.5) * blockW * 0.52;
          const [x, z] = toWorld(u + off + rand(rng, -1.5, 1.5), v + rand(rng, -2.5, 2.5));
          const w = rand(rng, 10, 15.5), d = rand(rng, 9, 14);
          const floors = 1 + ((rng() * (iu < 2 ? 3 : 4)) | 0);
          const style = rng() < 0.62 ? 'tile' : 'flat';
          const y = groundY(x, z) - 0.15;
          const rot = c.rot + (d > w ? Math.PI / 2 : 0) + rand(rng, -0.05, 0.05);
          const spec = { x, z, y, w, d, floors, rot, style };
          // meshed later: the buildings closest to the sea get individual meshes so they can collapse
          this._citySpecs.push({ spec, score: x - this.coastX(z) });
        }
        // small courtyard props
        const [px, pz] = toWorld(u + rand(rng, -12, 12), v + rand(rng, -12, 12));
        const ctx = this.ctxFor(px, pz);
        const r = rng();
        if (r < 0.18) addPalm(ctx, rng, { x: px, y: groundY(px, pz), z: pz, scale: rand(rng, 0.75, 1.0), rotY: rng() * TAU });
        else if (r < 0.3) addBush(ctx, rng, { x: px, y: groundY(px, pz), z: pz, scale: 1.1 });
        else if (r < 0.42) addParkedCar(ctx, rng, { x: px, y: groundY(px, pz), z: pz, rot: c.rot + rand(rng, -1.5, 1.5), color: null });
        else if (r < 0.5) { addWaterTank(ctx, rng, { x: px, z: pz, y: groundY(px, pz), r: 0.8, h: 1.6 }); }
      }
    }

    // ---- flush the deferred building meshes: the water-front row is individual (collapsible)
    {
      const ordered = this._citySpecs.slice().sort((a, b) => a.score - b.score);
      this._citySpecs = [];
      const HERO_MAX = 30;
      for (let i = 0; i < ordered.length; i++) {
        const spec = ordered[i].spec;
        const low = this.heightAt(spec.x, spec.z) < 24;
        if (i < HERO_MAX && low) this.heroSpecs.push(spec);
        else addBuilding(this.ctxFor(spec.x, spec.z), rng, spec);
      }
    }

    // ---- the grand square with the clock tower & fountain
    {
      const [sx, sz] = toWorld(0, 0);
      const y = groundY(sx, sz);
      const ctx = this.ctxFor(sx, sz);
      addTower(ctx, rng, { x: sx, z: sz, y, h: 24, r: 3.4, clock: true });
      // fountain
      const fx = sx + 16, fz = sz + 10;
      const fy = groundY(fx, fz);
      ctx.m.add('rock', xf2(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 16), 0xc5bfb2, fx, fy + 0.35, fz));
      ctx.m.add('rock', xf2(new THREE.CylinderGeometry(2.4, 2.6, 0.5, 14), 0xb2aca0, fx, fy + 0.8, fz));
      ctx.m.add('rock', xf2(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 10), 0xcac4b8, fx, fy + 1.5, fz));
      ctx.m.add('rock', xf2(new THREE.SphereGeometry(0.6, 12, 10), 0xc9c3b6, fx, fy + 2.4, fz));
      this.fountain = { x: fx, y: fy + 0.9, z: fz, r: 3.0 };
      // square paving is handled by the terrain colouring
      for (let i = 0; i < 5; i++) {
        const a = rng() * TAU, rr = rand(rng, 12, 22);
        addLamp(ctx, rng, { x: sx + Math.cos(a) * rr, y: groundY(sx + Math.cos(a) * rr, sz + Math.sin(a) * rr), z: sz + Math.sin(a) * rr, rot: -a, kind: 'street' });
      }
      // market stalls + a few people-scale props
      for (let i = 0; i < 7; i++) {
        const a = rng() * TAU, rr = rand(rng, 14, 34);
        const x = sx + Math.cos(a) * rr, z = sz + Math.sin(a) * rr;
        addStall(ctx, rng, { x, y: groundY(x, z), z, rot: a + Math.PI / 2 });
      }
      this.spawns.city = { x: sx + 30, z: sz + 40, y: groundY(sx + 30, sz + 40) + 0.1 };
      // ---- evacuation tower in the square (a landmark you can climb above the flood)
      const tY = groundY(sx + 6, sz - 6);
      addEvacuationTower(ctx, rng, { x: sx + 6, z: sz - 6, y: tY, levels: 5, r: 4.2 });
      ctx.lights.push({ type: 'point', x: sx + 6, y: tY + 17, z: sz - 6, color: 0xffe6a8, intensity: 6, distance: 90 });
      // ---- the upper refuge on the shelf where the mountain road starts (above the 16.5 m flood line)
      const anchor = (this.roads && this.roads[2] && this.roads[2].samples.find((sm) => sm.y > 20)) || null;
      const ux = anchor ? anchor.x - 16 : sx + 145;
      const uz = anchor ? anchor.z - 4 : sz;
      const uy = groundY(ux, uz);
      addEvacuationTower(ctx, rng, { x: ux, z: uz, y: uy, levels: 6, r: 4.6 });
      ctx.lights.push({ type: 'point', x: ux, y: uy + 21, z: uz, color: 0xffe6a8, intensity: 6, distance: 110 });
      this.spawns.tower = { x: ux + 6, z: uz + 4, y: groundY(ux + 6, uz + 4) + 0.1 };
      this.upperTown = { x: ux, z: uz };
    }

    // ---- waterfront promenade + harbour
    {
      const h = this.harbor;
      const coastAtHarbor = this.coastX(h.z) + 30;
      const y = groundY(coastAtHarbor + 12, h.z);
      const ctx = this.ctxFor(coastAtHarbor, h.z);
      addHarbour(ctx, rng, { x: coastAtHarbor + 20, y: y + 1.2, z: h.z, rot: -1.35, len: 130 });
      // moored fishing boats
      for (let i = 0; i < 7; i++) {
        const bz = h.z - 55 + i * 17 + rand(rng, -4, 4);
        const bx = this.coastX(bz) - rand(rng, 12, 34);
        const by = -0.4;
        const ctx2 = this.ctxFor(bx, bz);
        const b = addFishingBoat(ctx2, rng, {
          x: bx, y: by, z: bz, rot: 1.2 + rand(rng, -2.2, 2.2),
          len: rand(rng, 5.5, 9.5), color: pick(rng, [0xe8e4da, 0xdfe6ea, 0xd8d2c4, 0xcfe0e2]),
          stripe: pick(rng, [0x2f6fa8, 0xc23b2f, 0x2f7a4a]),
        });
        this.boats = this.boats || [];
        this.boats.push({ mesh: null, x: bx, y: by, z: bz, rot: 1.2, len: b.len, wid: b.wid, dep: b.dep, float: true, kind: 'fishing' });
      }
      // containers + crane on the quay
      for (let i = 0; i < 12; i++) {
        const cz = h.z - 60 + i * 10 + rand(rng, -3, 3);
        const cx2 = coastAtHarbor + rand(rng, 26, 44);
        addContainer(this.ctxFor(cx2, cz), rng, { x: cx2, y: groundY(cx2, cz), z: cz, rot: rand(rng, -0.2, 0.2), stacked: rng() < 0.3 ? 2 : 1 });
      }
      addCrane(this.ctxFor(coastAtHarbor + 46, h.z - 30), rng, { x: coastAtHarbor + 46, y: groundY(coastAtHarbor + 46, h.z - 30), z: h.z - 30, rot: 1.2, h: 14 });
      this.spawns.harbor = { x: coastAtHarbor + 10, z: h.z + 6, y: groundY(coastAtHarbor + 10, h.z + 6) + 0.2 };
    }

    // ---- beach pier (start point) + beach props
    {
      const bz = -150;
      const bx = this.coastX(bz);
      const py = 1.6;
      const ctx = this.ctxFor(bx + 20, bz);
      addPier(ctx, rng, { x: bx + 16, y: py, z: bz, rot: -1.5, len: 30, wide: 4.4 });
      this.piers.push({ x: bx + 16, y: py, z: bz, rot: -1.5, len: 30, wide: 4.4 });
      addFishingBoat(ctx, rng, { x: bx - 6, y: -0.4, z: bz + 12, rot: 1.4, len: 8.2, color: 0xe6e2d6, stripe: 0x2f6fa8 });
      this.spawns.beach = { x: bx + 40, y: this.heightAt(bx + 40, bz) + 0.1, z: bz };
      this.spawns.pier = { x: bx + 16, y: py + 0.3, z: bz + 10 };
      this.beachCenter = { x: bx + 30, z: bz };
      this.buildBeachLife(bx, bz);
    }

    void streetW;
  }

  /* ------------------------------------------- the fishing village on the sand */
  // Everything within a stone's throw of where the run starts: drawn-up boats, net racks,
  // crates, buoys, a fire pit, palms and a fish stall. It is what makes the opening read as
  // a working Moroccan beach instead of an empty plain.
  buildBeachLife(bx, bz) {
    const rng = mulberry32(this.seed + 71);
    const at = (dx, dz) => ({ x: bx + dx, z: bz + dz, y: this.heightAt(bx + dx, bz + dz) });
    const put = (dx, dz, fn) => { const p = at(dx, dz); fn(this.ctxFor(p.x, p.z), p, rng); };
    // one prop: tinted (the mesher materials read vertex colours) and dropped on the sand
    const mesh = (key, geo, color, dx, dz, dy, rotY = 0) => put(dx, dz, (ctx, p) => {
      ctx.m.add(key, xf2(geo, color, p.x, p.y + (dy || 0), p.z, rotY));
    });
    const ground = (dx, dz) => this.heightAt(bx + dx, bz + dz);

    // --- boats pulled up onto the sand at the waterline
    for (const [dx, dz, rot, len, col, st] of [
      [10, 34, 0.55, 7.4, 0xd9d2c0, 0x2f6fa8],
      [14, -30, -0.7, 6.6, 0xc9c2ae, 0x9c3f34],
      [26, 58, 0.2, 8.2, 0xe2dccb, 0x356b8c],
    ]) {
      put(dx, dz, (ctx, p) => addFishingBoat(ctx, rng, { x: p.x, y: p.y + 0.12, z: p.z, rot, len, color: col, stripe: st, mast: false }));
    }
    // --- drying racks with nets and buoys
    for (const [dx, dz, rot] of [[30, 16, 0.4], [24, -14, -0.9]]) {
      put(dx, dz, (ctx, p) => {
        const h = 2.4, w = 5.2;
        for (let i = -1; i <= 1; i += 2) {
          mesh('wood', new THREE.CylinderGeometry(0.09, 0.11, h, 7), 0x6b4a2e, dx + i * w * 0.5, dz, h / 2, rot);
        }
        mesh('wood', new THREE.BoxGeometry(w, 0.1, 0.12), 0x7a5636, dx, dz, h - 0.15, rot);
        // the net itself: a sagging sheet of dark olive twine
        const net = new THREE.PlaneGeometry(w * 0.94, 1.5, 6, 3);
        const pos = net.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i) / (w * 0.47);
          pos.setZ(i, -0.28 * (1 - u * u));
        }
        net.computeVertexNormals();
        net.rotateX(-Math.PI / 2);                    // hang it flat, sagging
        const np = at(dx, dz);
        // colourGeoLocal tints the geometry (the mesher materials read vertex colours) and places it
        this.ctxFor(np.x, np.z).m.add('net', colorGeoLocal(net, 0x50523a, np.x, np.y + h - 0.75, np.z, rot));
        // floats along the top rope
        for (let i = -2; i <= 2; i++) {
          mesh('fabric', new THREE.SphereGeometry(0.16, 8, 6), 0xd4763a, dx + i * 1.05 * Math.cos(rot), dz - i * 1.05 * Math.sin(rot), h - 0.1);
        }
      });
    }
    // --- crates, barrels and coiled rope by the pier head
    for (let i = 0; i < 7; i++) {
      const dx = 22 + (i % 3) * 2.3 + rng() * 0.6, dz = 4 + Math.floor(i / 3) * 2.1 - rng() * 0.5;
      mesh('wood', new THREE.BoxGeometry(1.15, 0.75, 0.85), 0x8a6a44, dx, dz, 0.38, rng() * 0.5);
      if (i % 3 === 0) mesh('wood', new THREE.BoxGeometry(1.05, 0.7, 0.8), 0x9c7a4c, dx + 0.1, dz + 0.15, 1.1, rng() * 0.6);
    }
    for (let i = 0; i < 4; i++) {
      mesh('metal', new THREE.CylinderGeometry(0.42, 0.42, 0.92, 12), 0x7d848a, 19 + i * 1.4, -6 - i * 0.8, 0.46, rng() * 0.4);
    }
    for (let i = 0; i < 3; i++) mesh('net', new THREE.TorusGeometry(0.36, 0.09, 6, 14), 0x9c8f6a, 27 + i * 1.1, 9 + i * 0.6, 0.09, rng());
    // --- a fire pit of stones with cold ash
    put(34, -6, (ctx, p) => {
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        mesh('rock', new THREE.DodecahedronGeometry(0.24 + rng() * 0.09, 0), 0x8c8478, 34 + Math.cos(a) * 1.05, -6 + Math.sin(a) * 1.05, 0.05);
      }
      mesh('concrete', new THREE.CylinderGeometry(0.95, 0.95, 0.06, 14), 0x3b3733, 34, -6, 0.03);
      ctx.fireSpots.push({ x: p.x, z: p.z, y: p.y });
    });
    // --- a fish stall and a bench facing the water
    put(38, 22, (ctx, p) => addStall(ctx, rng, { x: p.x, y: p.y, z: p.z, rot: -1.5 }));
    put(40, 6, (ctx, p) => addBench(ctx, rng, { x: p.x, y: p.y, z: p.z, rot: 1.6 }));
    put(30, 44, (ctx, p) => addSign(ctx, rng, { x: p.x, y: p.y, z: p.z, rot: -1.4, text: 'RHĪSSA · PLAGE' }));
    // --- a fishing hut, its door facing the sea, with a water tank and a fence
    put(52, -18, (ctx, p) => {
      const w = 4.6, d = 4.0, h = 2.7;
      ctx.m.add('thatch', xf2(new THREE.ConeGeometry(w * 0.82, 1.7, 4), 0x9d7f4c, p.x, p.y + h + 0.6, p.z, Math.PI / 4));
      ctx.m.add('plaster', xf2(new THREE.BoxGeometry(w, h, d), 0xdfd6c2, p.x, p.y + h / 2, p.z));
      ctx.m.add('wood', xf2(new THREE.BoxGeometry(1.1, 2.1, 0.14), 0x6b4a2e, p.x, p.y + 1.05, p.z - d / 2 - 0.05));
      ctx.colliders.push({ cx: p.x, cz: p.z, hx: w / 2, hz: d / 2, rot: 0, y0: p.y, y1: p.y + h, kind: 'hut' });
      addWaterTank(ctx, rng, { x: p.x + 3.4, y: p.y, z: p.z + 2.2 });
    });
    for (let i = 0; i < 3; i++) {
      const dz = 26 + i * 6;
      mesh('wood', new THREE.BoxGeometry(6, 1.1, 0.14), 0x6b4a2e, 44, dz, 0.55, 1.5);
    }
    // --- palms right where the player wakes up, so the opening shot has trees in it
    for (const [dx, dz, sc, lean] of [[46, -34, 1.15, 0.16], [56, -44, 0.95, 0.1], [44, 52, 1.05, 0.2], [62, 30, 0.85, 0.12], [50, 68, 1.0, 0.18]]) {
      put(dx, dz, (ctx, p) => addPalm(ctx, rng, { x: p.x, y: p.y, z: p.z, scale: sc, lean, rotY: rng() * TAU }));
    }
    // --- low scrub on the dunes behind the beach
    for (let i = 0; i < 22; i++) {
      const dx = 46 + rng() * 90, dz = -70 + rng() * 150;
      const y = ground(dx, dz);
      if (y < 1.4 || y > 13) continue;
      put(dx, dz, (ctx, p) => (rng() < 0.55
        ? addBush(ctx, rng, { x: p.x, y: p.y, z: p.z, scale: 0.7 + rng() * 0.5 })
        : addRock(ctx, rng, { x: p.x, y: p.y + 0.15, z: p.z, scale: 0.5 + rng() * 0.7 })));
    }
  }

  /* --------------------------------------------------------------- harbour */
  buildCoast() {
    const rng = mulberry32(this.seed + 17);
    // rocky headland with the lighthouse
    {
      const lh = this.lighthouseC;
      const y = this.baseHeight(lh.x, lh.z);
      const ctx = this.ctxFor(lh.x, lh.z);
      for (let i = 0; i < 26; i++) {
        const a = rng() * TAU, rr = rand(rng, 6, 30);
        const x = lh.x + Math.cos(a) * rr, z = lh.z + Math.sin(a) * rr;
        addRock(ctx, rng, { x, y: this.heightAt(x, z) + 0.3, z, scale: rand(rng, 1.2, 3.4) });
      }
      addLighthouse(ctx, rng, { x: lh.x, y: Math.max(y, 3), z: lh.z, h: 17 });
      this.spawns.lighthouse = { x: lh.x + 8, z: lh.z + 6, y: this.heightAt(lh.x + 8, lh.z + 6) + 0.2 };
    }
    // palm grove along the beach + dunes
    const palms = this.quality === 'low' ? 40 : 96;
    for (let i = 0; i < palms; i++) {
      const z = rand(rng, -900, 900);
      const sd = rand(rng, 30, 130);
      const x = this.coastX(z) + sd;
      const y = this.heightAt(x, z);
      if (y < 1.2 || y > 12) continue;
      addPalm(this.ctxFor(x, z), rng, { x, y, z, scale: rand(rng, 0.8, 1.25), rotY: rng() * TAU, lean: rand(rng, 0.04, 0.24) });
    }
    // beach props
    for (let i = 0; i < 30; i++) {
      const z = rand(rng, -800, 800);
      const x = this.coastX(z) + rand(rng, 6, 60);
      const y = this.heightAt(x, z);
      if (y > 8) continue;
      const ctx = this.ctxFor(x, z);
      if (rng() < 0.5) addDriftwood(ctx, rng, { x, y, z, len: rand(rng, 2, 4.5) });
      else addRock(ctx, rng, { x, y: y + 0.2, z, scale: rand(rng, 0.6, 1.6) });
    }
    // beach huts
    for (let i = 0; i < 5; i++) {
      const z = -600 + i * 260 + rand(rng, -40, 40);
      const x = this.coastX(z) + rand(rng, 60, 110);
      const y = this.heightAt(x, z);
      if (y > 12) continue;
      const ctx = this.ctxFor(x, z);
      const w = rand(rng, 3.6, 5), d = rand(rng, 3.2, 4.4), h = 2.6;
      ctx.m.add('thatch', xf2(new THREE.ConeGeometry(w * 0.85, 1.6, 4), 0x9d7f4c, x, y + h + 0.55, z));
      ctx.m.add('plaster', xf2(new THREE.BoxGeometry(w, h, d), 0xdfd6c2, x, y + h / 2, z));
      ctx.m.add('wood', xf2(new THREE.BoxGeometry(1.1, 2.1, 0.14), 0x6b4a2e, x + w * 0.0, y + 1.05, z + d / 2 + 0.05));
      ctx.colliders.push({ cx: x, cz: z, hx: w / 2, hz: d / 2, rot: 0, y0: y, y1: y + h, kind: 'hut' });
      if (i === 1) this.spawns.hut = { x: x + 5, z: z + 5, y: this.heightAt(x + 5, z + 5) + 0.1 };
    }
  }

  /* ------------------------------------------------------------- mountain */
  buildMountain() {
    const rng = mulberry32(this.seed + 29);
    const camp = this.camp;
    const campY = camp.y;
    const ctx = this.ctxFor(camp.x, camp.z);
    // camp: tents, fire, watchtower, supplies
    addCampfire(ctx, rng, { x: camp.x, y: campY, z: camp.z });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.5;
      const x = camp.x + Math.cos(a) * rand(rng, 8, 14), z = camp.z + Math.sin(a) * rand(rng, 8, 14);
      addCampTent(this.ctxFor(x, z), rng, { x, y: this.heightAt(x, z), z, rot: a + Math.PI / 2, color: null, scale: rand(rng, 0.9, 1.15) });
    }
    addWatchTower(ctx, rng, { x: camp.x + 16, y: campY, z: camp.z - 10, h: 8 });
    addRadioMast(ctx, rng, { x: camp.x - 14, y: campY, z: camp.z + 12, h: 15 });
    addWaterTank(ctx, rng, { x: camp.x + 6, y: campY, z: camp.z + 14, r: 1.2, h: 2.0, color: 0xc9d2d6 });
    for (let i = 0; i < 6; i++) {
      const x = camp.x + rand(rng, -18, 18), z = camp.z + rand(rng, -18, 18);
      ctx.m.add('wood', xf2(new THREE.BoxGeometry(rand(rng, 0.7, 1.3), rand(rng, 0.6, 1.0), rand(rng, 0.7, 1.3)), 0x9a7a52, x, this.heightAt(x, z) + 0.4, z));
    }
    this.spawns.camp = { x: camp.x + 4, y: campY + 0.2, z: camp.z + 6 };
    this.spawns.roadCamp = { x: camp.x - 30, y: campY + 0.2, z: camp.z };

    // lake + hydro station + waterfall
    const lake = this.lakeC;
    const lakeY = lake.y;
    addHydroStation(this.ctxFor(lake.x - 40, lake.z), rng, { x: lake.x - 42, y: lakeY + 4, z: lake.z, rot: -0.4 });
    this.lake = { x: lake.x, z: lake.z, y: lakeY + 0.35, r: lake.r };
    const wf = { x: lake.x - 66, y: lakeY - 6, z: lake.z + 26, h: 34, w: 9, rot: -0.3 };
    addWaterfall(this.ctxFor(wf.x, wf.z), rng, wf);
    this.spawns.lake = { x: lake.x - 20, y: lakeY + 0.6, z: lake.z + 40 };

    // mine entrance in the gorge
    const mc = this.mineC;
    addMineEntrance(this.ctxFor(mc.x, mc.z), rng, { x: mc.x, y: mc.y, z: mc.z, rot: 0.3 });
    addRuin(this.ctxFor(mc.x + 20, mc.z + 18), rng, { x: mc.x + 20, y: this.heightAt(mc.x + 20, mc.z + 18), z: mc.z + 18, rot: 0.4, w: 9, h: 3.6, d: 7 });
    this.spawns.mine = { x: mc.x + 6, y: mc.y + 0.2, z: mc.z + 8 };

    // vegetation: pines & shrubs on the slopes
    const count = this.quality === 'low' ? 320 : this.quality === 'high' ? 1200 : 700;
    for (let i = 0; i < count; i++) {
      const x = rand(rng, 360, 1290), z = rand(rng, -1290, 1290);
      const y = this.heightAt(x, z);
      if (y < 14 || y > 300) continue;
      const slope = this.slopeAt(x, z);
      if (slope > 0.62) continue;
      const ctx2 = this.ctxFor(x, z);
      const r = rng();
      if (r < 0.55) addPine(ctx2, rng, { x, y, z, scale: rand(rng, 0.7, 1.4), kind: 'pine' });
      else if (r < 0.78) addPine(ctx2, rng, { x, y, z, scale: rand(rng, 0.6, 1.1), kind: 'oak' });
      else if (r < 0.9) addBush(ctx2, rng, { x, y, z, scale: rand(rng, 0.7, 1.4) });
      else addRock(ctx2, rng, { x, y: y + 0.3, z, scale: rand(rng, 0.8, 2.2) });
    }
    // dry-zone cacti & rocks on the plain
    for (let i = 0; i < (this.quality === 'low' ? 80 : 260); i++) {
      const x = rand(rng, -170, 720), z = rand(rng, -1290, 1290);
      const y = this.heightAt(x, z);
      if (y < 9 || y > 60 || this.slopeAt(x, z) > 0.5) continue;
      const ctx2 = this.ctxFor(x, z);
      if (rng() < 0.35) addCactus(ctx2, rng, { x, y, z, scale: rand(rng, 0.7, 1.3) });
      else if (rng() < 0.6) addBush(ctx2, rng, { x, y, z, scale: rand(rng, 0.6, 1.2) });
      else addRock(ctx2, rng, { x, y: y + 0.2, z, scale: rand(rng, 0.5, 1.4) });
    }
    // summit marker
    const peak = this.peaks[0];
    const ctxP = this.ctxFor(peak.x, peak.z);
    ctxP.m.add('rockPlain', xf2(new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6), 0xd8d4c8, peak.x, this.heightAt(peak.x, peak.z) + 1.2, peak.z));
    ctxP.m.add('metal', xf2(new THREE.ConeGeometry(0.5, 0.8, 6), 0xc23b2f, peak.x, this.heightAt(peak.x, peak.z) + 2.7, peak.z));
    this.spawns.summit = { x: peak.x + 6, y: this.heightAt(peak.x + 6, peak.z + 6) + 0.2, z: peak.z + 6 };
  }

  /* ------------------------------------------------------------ utilities */
  buildRoadMeshes(mats) {
    const rng = mulberry32(this.seed + 41);
    const group = new THREE.Group();
    group.name = 'roads';
    for (const road of this.roads) {
      const asphalt = ribbon(road.samples, road.halfWidth, 0.06, 3);
      const am = new THREE.Mesh(asphalt, mats.asphalt);
      am.receiveShadow = true; am.matrixAutoUpdate = false;
      group.add(am);
      const shoulder = ribbon(road.samples, road.halfWidth + road.shoulder * 0.9, 0.02, 4);
      const sm = new THREE.Mesh(shoulder, mats.gravel);
      sm.receiveShadow = true; sm.matrixAutoUpdate = false;
      sm.renderOrder = -1;
      group.add(sm);
      // centre dashes
      const dashGeo = [];
      for (let i = 12; i < road.samples.length - 12; i += 6) {
        const s = road.samples[i];
        dashGeo.push(colorGeoLocal(new THREE.BoxGeometry(0.3, 0.02, 2.6), 0xd8d2b8, s.x, s.y + 0.08, s.z, Math.atan2(s.dx, s.dz)));
      }
      if (dashGeo.length) {
        const merged = mergeSimple(dashGeo);
        const dm = new THREE.Mesh(merged, mats.plaster);
        dm.matrixAutoUpdate = false;
        group.add(dm);
      }
      void rng;
    }
    this.scene.add(group);
    this.roadGroup = group;
  }

  /* ------------------------------------------------------------------ build */
  finalize(mats) {
    for (const [key, mesher] of this.chunks) {
      mesher.finalize(mats, this.scene, { name: 'chunk' + key });
    }
    this.chunks.clear();
    // ---- individually meshed water-front buildings (can topple in the tsunami)
    const rng = mulberry32(this.seed + 77);
    for (const spec of this.heroSpecs || []) {
      const mesher = new Mesher();
      const colliders = [];
      addBuilding({ m: mesher, colliders, lights: this.lights, fireSpots: this.fireSpots, waterfalls: this.waterfalls }, rng, spec);
      const group = new THREE.Group();
      group.position.set(spec.x, 0, spec.z);
      this.scene.add(group);
      mesher.finalize(mats, group, { name: 'hero' });
      group.children.forEach((m) => { m.position.x -= spec.x; m.position.z -= spec.z; m.matrixAutoUpdate = false; m.updateMatrix(); });
      const col = colliders[0] ? { ...colliders[0], cx: spec.x, cz: spec.z } : null;
      if (col) this.colliders.push(col);
      this.destructibles.push({ group, spec, collider: col, state: 'standing', t: 0, dir: rng() < 0.5 ? 1 : -1 });
    }
    this.heroSpecs = [];
    // point lights (lighthouse, etc.)
    for (const l of this.lights) {
      if (l.type === 'point') {
        const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
        pl.position.set(l.x, l.y, l.z);
        this.scene.add(pl);
      }
    }
  }

  /** streaming points for the rescue boat / tsunami origin */
  get seaOrigin() {
    const z = this.beachCenter ? this.beachCenter.z : -150;
    return { x: this.coastX(z) - 900, z, dirX: 1, dirZ: 0 };
  }
}

/* ------------------------------------------------------------ small helpers */
function xf2(geo, color, x, y, z, rotY = 0) {
  const g = colorGeoLocal(geo, color, x, y, z, rotY);
  return g;
}
function colorGeoLocal(geo, color, x, y, z, rotY = 0) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z);
  geo.applyMatrix4(m);
  return geo;
}
function mergeSimple(geos) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : new Float32Array(p.length / 3 * 2);
    const c = g.attributes.color.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) nrm.push(n[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (let i = 0; i < c.length; i++) col.push(c[i]);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + base);
    else for (let i = 0; i < p.length / 3; i++) idx.push(i + base);
    base += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

export { mergeSimple, colorGeoLocal };
