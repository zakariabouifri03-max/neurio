// ── WARFRONT · the arena: a war-torn town built entirely from code ───────────
// Every solid object is registered as an AABB collider, so movement, bullets and
// AI line-of-sight all share one source of truth. Also builds the navigation
// grid + cover map used by the soldier AI.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, boxAdd, clamp, MinHeap, rayWorld } from './util.js';

const HALF = 47;              // playable half-size
const CELL = 2.0;             // nav grid cell size
const GN = Math.floor((HALF * 2) / CELL);

// ── procedural textures ──────────────────────────────────────────────────────
function cv(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function texFrom(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function noise(ctx, s, amt, alpha) {
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    if (alpha) d[i + 3] = clamp(d[i + 3] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

function texGround() {
  const s = 256, [c, x] = cv(s);
  x.fillStyle = '#a1906d'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const r = Math.random() * 26 + 3;
    x.globalAlpha = 0.05 + Math.random() * 0.12;
    x.fillStyle = ['#b6a37c', '#8e7d5c', '#c3b48f', '#7e6f52'][i & 3];
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  // tyre tracks / dirt lanes
  for (let i = 0; i < 10; i++) {
    x.strokeStyle = 'rgba(120,105,80,.35)'; x.lineWidth = 6 + Math.random() * 10;
    x.beginPath();
    const y = Math.random() * s;
    x.moveTo(-10, y); x.bezierCurveTo(s * .3, y + (Math.random() - .5) * 60, s * .7, y + (Math.random() - .5) * 60, s + 10, y);
    x.stroke();
  }
  noise(x, s, 26);
  return texFrom(c, 1);
}

function texStreet() {
  const s = 256, [c, x] = cv(s);
  x.fillStyle = '#4c4b47'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 500; i++) {
    x.globalAlpha = 0.06 + Math.random() * 0.1;
    x.fillStyle = Math.random() < .5 ? '#3a3936' : '#5d5b56';
    x.fillRect(Math.random() * s, Math.random() * s, Math.random() * 30, Math.random() * 30);
  }
  x.globalAlpha = 1;
  // cracks
  x.strokeStyle = 'rgba(25,25,25,.55)';
  for (let i = 0; i < 22; i++) {
    x.lineWidth = Math.random() * 1.6 + .4;
    x.beginPath();
    let px = Math.random() * s, py = Math.random() * s;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (Math.random() - .5) * 42; py += (Math.random() - .5) * 42; x.lineTo(px, py); }
    x.stroke();
  }
  // faded lane paint
  x.fillStyle = 'rgba(210,190,120,.13)';
  for (let i = 0; i < 4; i++) x.fillRect(0, 30 + i * 64, s, 5);
  noise(x, s, 22);
  return texFrom(c, 1);
}

function texFacade(tone) {
  const s = 256, [c, x] = cv(s);
  const base = tone === 'light' ? ['#c7b490', '#b39f7c'] : tone === 'block' ? ['#9d8f7e', '#87796a'] : ['#b09a76', '#9a8564'];
  x.fillStyle = base[0]; x.fillRect(0, 0, s, s);
  // stucco blotches
  for (let i = 0; i < 320; i++) {
    x.globalAlpha = .05 + Math.random() * .1;
    x.fillStyle = Math.random() < .5 ? base[1] : '#d6c8a8';
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, Math.random() * 24 + 4, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  // windows on a 2x2 grid, tileable
  const cells = [[0.25, 0.28], [0.75, 0.28], [0.25, 0.78], [0.75, 0.78]];
  for (const [u, v] of cells) {
    const w = 46, h = 58, px = u * s - w / 2, py = v * s - h / 2;
    x.fillStyle = '#2b2f33'; x.fillRect(px, py, w, h);
    x.fillStyle = 'rgba(150,180,200,.16)'; x.fillRect(px + 4, py + 4, w - 8, h * .35);
    x.strokeStyle = 'rgba(60,52,40,.85)'; x.lineWidth = 5; x.strokeRect(px - 2, py - 2, w + 4, h + 4);
    x.fillStyle = 'rgba(40,34,26,.55)'; x.fillRect(px - 8, py + h + 2, w + 16, 5);
    if (Math.random() < .45) { // boarded / damaged
      x.fillStyle = '#6c583c'; x.fillRect(px + 3, py + 3, w - 6, h - 6);
      x.strokeStyle = 'rgba(40,30,18,.6)'; x.lineWidth = 2;
      for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(px, py + 8 + k * 12); x.lineTo(px + w, py + 12 + k * 12); x.stroke(); }
    }
  }
  // grime streaks + scorch at the bottom
  for (let i = 0; i < 26; i++) {
    x.fillStyle = `rgba(60,50,38,${.03 + Math.random() * .07})`;
    x.fillRect(Math.random() * s, 0, 2 + Math.random() * 6, s * (.3 + Math.random() * .7));
  }
  x.fillStyle = 'rgba(35,28,20,.3)'; x.fillRect(0, s - 22, s, 22);
  noise(x, s, 20);
  return texFrom(c, 1);
}

function texRoof() {
  const s = 128, [c, x] = cv(s);
  x.fillStyle = '#6f6a60'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 200; i++) {
    x.globalAlpha = .1 + Math.random() * .2;
    x.fillStyle = Math.random() < .5 ? '#5c574f' : '#82796d';
    x.fillRect(Math.random() * s, Math.random() * s, 12, 8);
  }
  x.globalAlpha = 1;
  x.strokeStyle = 'rgba(40,36,30,.4)'; x.lineWidth = 2;
  for (let i = 0; i < s; i += 16) { x.beginPath(); x.moveTo(0, i); x.lineTo(s, i); x.stroke(); }
  noise(x, s, 18);
  return texFrom(c, 1);
}

function texWood() {
  const s = 128, [c, x] = cv(s);
  x.fillStyle = '#8a6b42'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 12; i++) {
    x.fillStyle = i % 2 ? 'rgba(90,68,40,.5)' : 'rgba(160,126,80,.35)';
    x.fillRect(0, i * 11, s, 10);
  }
  x.strokeStyle = 'rgba(50,36,20,.5)'; x.lineWidth = 3;
  x.strokeRect(4, 4, s - 8, s - 8);
  noise(x, s, 22);
  return texFrom(c, 1);
}

function texMetal() {
  const s = 128, [c, x] = cv(s);
  x.fillStyle = '#6d7a80'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 8) {
    x.fillStyle = i % 16 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)';
    x.fillRect(i, 0, 6, s);
  }
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(${120 + Math.random() * 40},${70 + Math.random() * 30},40,${.1 + Math.random() * .3})`;
    x.beginPath(); x.arc(Math.random() * s, Math.random() * s, Math.random() * 9 + 2, 0, 7); x.fill();
  }
  noise(x, s, 16);
  return texFrom(c, 1);
}

function texBag() {
  const s = 128, [c, x] = cv(s);
  x.fillStyle = '#8f8266'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(${110 + Math.random() * 60},${100 + Math.random() * 45},${70 + Math.random() * 40},.5)`;
    x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, 16 + Math.random() * 12, 9 + Math.random() * 7, Math.random() * 3, 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(45,40,28,.35)'; x.lineWidth = 2;
  for (let i = 0; i < s; i += 16) { x.beginPath(); x.moveTo(0, i); x.lineTo(s, i + 4); x.stroke(); }
  noise(x, s, 20);
  return texFrom(c, 1);
}

function texSky() {
  const [c, x] = cv(256);
  c.width = 512;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1d2b3a');
  g.addColorStop(0.34, '#4a5a63');
  g.addColorStop(0.55, '#a68a63');
  g.addColorStop(0.72, '#d8a76e');
  g.addColorStop(1, '#e8c99a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  // dust haze bands
  for (let i = 0; i < 70; i++) {
    x.globalAlpha = .04 + Math.random() * .06;
    x.fillStyle = Math.random() < .5 ? '#f0d6ac' : '#6f7b80';
    x.beginPath(); x.ellipse(Math.random() * 512, 90 + Math.random() * 130, 40 + Math.random() * 130, 6 + Math.random() * 16, 0, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ── world ────────────────────────────────────────────────────────────────────
export class World {
  constructor(scene, rngSeed = 7) {
    this.scene = scene;
    this.rng = new RNG(rngSeed);
    this.colliders = [];      // bullet-blocking + walking
    this.buckets = new Map(); // material -> geometries, merged at the end of build()
    this.kinds = [];          // impact material tag per collider
    this._flat = null;        // Float32Array collider cache for hot loops
    this.group = new THREE.Group();
    scene.add(this.group);
    this.matCache = new Map();
    this.blocked = new Uint8Array(GN * GN);
    this.cover = new Uint8Array(GN * GN);
    this.spawns = [];
    this.smokes = [];
    this.lights = [];
    this.objective = { x: 0, z: 0, r: 7.5 };
    this.size = HALF;
    this.animated = [];
  }

  // ── solid primitive: merged geometry + collider in one call ─────────────
  addGeo(mat, geo, x = 0, y = 0, z = 0, rotY = 0, tilt = null) {
    if (tilt) geo.rotateX(tilt);
    if (rotY) geo.rotateY(rotY);
    if (x || y || z) geo.translate(x, y, z);
    let arr = this.buckets.get(mat);
    if (!arr) { arr = []; this.buckets.set(mat, arr); }
    arr.push(geo);
    return geo;
  }

  addCollider(cx, cz, w, d, y0, y1, kind) {
    const b = boxAdd(this.colliders, cx, cz, w, d, y0, y1);
    b.kind = kind || 'concrete';
    this.colliders.push(b);
    return b;
  }

  addSolid(cx, cz, w, d, y0, y1, mat, opts = {}) {
    const geo = new THREE.BoxGeometry(w, y1 - y0, d);
    this.addGeo(mat, geo, cx, (y0 + y1) / 2, cz, opts.rotY || 0);
    if (opts.collide !== false) {
      const b = boxAdd(this.colliders, cx, cz, w, d, y0, y1);
      b.kind = opts.kind || (mat === this.mats?.metal ? 'metal' : mat === this.mats?.wood ? 'wood' : mat === this.mats?.bag ? 'sand' : 'concrete');
      this.colliders.push(b);
    }
    return null;
  }

  /** merge every bucket into one mesh per material, then build the collider cache */
  finish() {
    let n = 0;
    for (const [mat, geos] of this.buckets) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      if (merged) {
        merged.computeBoundingSphere();
        const m = new THREE.Mesh(merged, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        this.group.add(m);
        n += geos.length;
      }
      for (const g of geos) if (g !== merged) g.dispose();
    }
    this.buckets.clear();
    // flat collider cache (typed, for the hot AI / bullet loops)
    const C = this.colliders, N = C.length;
    const f = new Float32Array(N * 6);
    const k = new Uint8Array(N);
    const KINDS = ['concrete', 'metal', 'wood', 'sand'];
    for (let i = 0; i < N; i++) {
      const b = C[i];
      f[i * 6] = b.x0; f[i * 6 + 1] = b.y0; f[i * 6 + 2] = b.z0;
      f[i * 6 + 3] = b.x1; f[i * 6 + 4] = b.y1; f[i * 6 + 5] = b.z1;
      k[i] = Math.max(0, KINDS.indexOf(b.kind || 'concrete'));
      b.i = i;
    }
    this._flat = f;
    this._kind = k;
    this.KINDS = KINDS;
    return n;
  }

  /** ray vs all colliders — the single hot path of the whole game */
  rayTrace(ox, oy, oz, dx, dy, dz, tmax) {
    const f = this._flat;
    if (!f) return null;
    const eps = 1e-8;
    let bt = tmax, best = -1, bnx = 0, bny = 0, bnz = 0;
    const ix = Math.abs(dx) < eps ? 1e9 : 1 / dx;
    const iy = Math.abs(dy) < eps ? 1e9 : 1 / dy;
    const iz = Math.abs(dz) < eps ? 1e9 : 1 / dz;
    for (let i = 0, o = 0; o < f.length; i++, o += 6) {
      const x0 = f[o], y0 = f[o + 1], z0 = f[o + 2], x1 = f[o + 3], y1 = f[o + 4], z1 = f[o + 5];
      // quick reject: box behind or beyond the current best hit
      if (Math.min(x0, x1) > bt || Math.max(x0, x1) < 0) continue;
      if (Math.min(z0, z1) > bt || Math.max(z0, z1) < 0) continue;
      let t0 = 0, t1 = bt;
      let a = (x0 - ox) * ix, c = (x1 - ox) * ix;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
      a = (y0 - oy) * iy; c = (y1 - oy) * iy;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
      a = (z0 - oz) * iz; c = (z1 - oz) * iz;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1 || t0 < 0) continue;
      // remember the entry face normal
      const px = ox + dx * t0, py = oy + dy * t0, pz = oz + dz * t0;
      const ex = Math.min(Math.abs(px - x0), Math.abs(px - x1));
      const ey = Math.min(Math.abs(py - y0), Math.abs(py - y1));
      const ez = Math.min(Math.abs(pz - z0), Math.abs(pz - z1));
      let nx = 0, ny = 0, nz = 0;
      if (ey <= ex && ey <= ez) ny = py > (y0 + y1) / 2 ? 1 : -1;
      else if (ex <= ez) nx = px > (x0 + x1) / 2 ? 1 : -1;
      else nz = pz > (z0 + z1) / 2 ? 1 : -1;
      bt = t0; best = i; bnx = nx; bny = ny; bnz = nz;
    }
    if (best < 0) return null;
    return {
      t: bt, nx: bnx, ny: bny, nz: bnz,
      x: ox + dx * bt, y: oy + dy * bt, z: oz + dz * bt,
      kind: this.KINDS[this._kind[best]] || 'concrete',
    };
  }

  /** true when something blocks the straight line a→b */
  blocked3(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return false;
    return !!this.rayTrace(ax, ay, az, dx / len, dy / len, dz / len, len - .05);
  }
  los(from, to) { return !this.blocked3(from.x, from.y, from.z, to.x, to.y, to.z); }

  facadeMat(tone, w, h) {
    const key = tone + '|' + Math.round(w / 3.4) + 'x' + Math.max(1, Math.round(h / 3.2));
    let m = this.matCache.get(key);
    if (m) return m;
    const tex = this.tex.facade[tone].clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 3.4)), Math.max(1, Math.round(h / 3.2)));
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0.02 });
    this.matCache.set(key, m);
    return m;
  }

  build() {
    const rng = this.rng;
    this.tex = {
      ground: texGround(), street: texStreet(), roof: texRoof(),
      wood: texWood(), metal: texMetal(), bag: texBag(),
      facade: { light: texFacade('light'), block: texFacade('block'), sand: texFacade('sand') },
    };
    this.mats = {
      ground: new THREE.MeshStandardMaterial({ map: (() => { const t = this.tex.ground.clone(); t.needsUpdate = true; t.repeat.set(26, 26); return t; })(), roughness: 1 }),
      street: new THREE.MeshStandardMaterial({ map: (() => { const t = this.tex.street.clone(); t.needsUpdate = true; t.repeat.set(8, 8); return t; })(), roughness: .95 }),
      roof: new THREE.MeshStandardMaterial({ map: (() => { const t = this.tex.roof.clone(); t.needsUpdate = true; t.repeat.set(3, 3); return t; })(), roughness: .9 }),
      wood: new THREE.MeshStandardMaterial({ map: (() => { const t = this.tex.wood.clone(); t.needsUpdate = true; t.repeat.set(1, 1); return t; })(), roughness: .85 }),
      metal: new THREE.MeshStandardMaterial({ map: this.tex.metal, roughness: .55, metalness: .65 }),
      bag: new THREE.MeshStandardMaterial({ map: (() => { const t = this.tex.bag.clone(); t.needsUpdate = true; t.repeat.set(2, 1); return t; })(), roughness: .98 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x9b968c, roughness: .95 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: .8 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x7c5334, roughness: .8, metalness: .35 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x16232c, roughness: .25, metalness: .5 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a2e24, roughness: .7 }),
    };

    // ── sky, fog, lights ───────────────────────────────────────────────────
    const skyTex = texSky();
    this.scene.background = new THREE.Color(0xc0a279);
    this.scene.fog = new THREE.FogExp2(0xb99a72, 0.0095);

    const hemi = new THREE.HemisphereLight(0x9fb6c9, 0x9c8158, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdcae, 1.95);
    sun.position.set(-38, 46, 26);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x6d86a3, 0.5);
    fill.position.set(30, 20, -34);
    this.scene.add(fill);

    // sky dome (for correct horizon behind the fog)
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(340, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    this.scene.add(sky);
    this.sky = sky;

    // sun disc + glow
    const glowTex = (() => {
      const [c, x] = cv(128);
      const g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,246,220,1)');
      g.addColorStop(.25, 'rgba(255,214,150,.7)');
      g.addColorStop(1, 'rgba(255,190,120,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    disc.position.set(-210, 120, 150);
    this.scene.add(disc);

    // ── ground ─────────────────────────────────────────────────────────────
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 260, HALF * 2 + 260), this.mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // streets (visually distinct asphalt, no collision)
    const street = (x, z, w, d) => {
      const mat = new THREE.MeshStandardMaterial({ map: this.mats.street.map, roughness: .95 });
      mat.map = this.mats.street.map;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      m.receiveShadow = true;
      this.group.add(m);
    };
    street(0, 0, 16, HALF * 2);
    street(0, 0, HALF * 2, 16);
    street(-28, -28, 12, 12); street(28, 28, 12, 12);
    street(-28, 28, 12, 12); street(28, -28, 12, 12);

    // ── buildings ──────────────────────────────────────────────────────────
    const built = [];
    const building = (cx, cz, w, d, h, tone = 'light', o = {}) => {
      this.addSolid(cx, cz, w, d, 0, h, this.facadeMat(tone, Math.max(w, d), h));
      // roof slab (slightly overhanging, gives a lip)
      this.addSolid(cx, cz, w + .7, d + .7, h, h + .35, this.mats.concrete);
      // parapet for roof-access buildings
      if (o.roof) {
        const ph = 0.85, t = 0.35, y = h + .35;
        this.addSolid(cx, cz - d / 2, w + .7, t, y, y + ph, this.mats.concrete);
        this.addSolid(cx, cz + d / 2, w + .7, t, y, y + ph, this.mats.concrete);
        this.addSolid(cx - w / 2, cz, t, d + .7, y, y + ph, this.mats.concrete);
        this.addSolid(cx + w / 2, cz, t, d + .7, y, y + ph, this.mats.concrete);
        this.roofs = this.roofs || [];
        this.roofs.push({ x: cx, z: cz, y: y + ph, r: Math.min(w, d) * .4 });
      }
      // stair tower to the roof
      if (o.roof) {
        const dir = o.stairDir || 1;
        const steps = Math.ceil((h + 1.2) / 0.34);
        for (let i = 0; i < steps; i++) {
          const y0 = i * 0.34;
          const off = (d / 2 + 1.0 + i * 0.72) * dir;
          this.addSolid(cx, cz + off, w * 0.8, 0.78, 0, y0 + 0.34, this.mats.concrete);
        }
        for (let i = 0; i < steps; i++) {
          const off = (d / 2 + 1.0 + i * 0.72) * dir;
          this.addSolid(cx, cz + off, w * 0.8, 0.78, i * 0.34 + 0.34, i * 0.34 + 1.0, this.mats.concrete, { collide: false, cast: false });
        }
        this.addSolid(cx, cz + (d / 2 + steps * 0.72 + 1.4) * dir, w * 0.8 + .4, 2.2, 0, h + 1.2, this.mats.concrete);
        this.addSolid(cx, cz + (d / 2 + steps * 0.72 + 1.4) * dir, w * 0.8 + .4, 2.2, h + 1.2, h + 1.6, this.mats.concrete, { collide: false, cast: false });
      }
      built.push({ cx, cz, w, d, h });
      // rooftop clutter
      if (h > 5) {
        this.addSolid(cx + rng.range(-w / 4, w / 4), cz + rng.range(-d / 4, d / 4), 1.6, 1.6, h + .35, h + 1.6, this.mats.metal);
        if (rng.chance(.5)) this.addSolid(cx + rng.range(-w / 3, w / 3), cz + rng.range(-d / 3, d / 3), .8, .8, h + .35, h + 3.2, this.mats.dark);
      }
    };

    // perimeter block ring
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = HALF - 4;
      const w = rng.range(9, 15), d = rng.range(8, 13), h = rng.range(5.5, 12);
      building(Math.cos(a) * r, Math.sin(a) * r, w, d, h, rng.pick(['light', 'block', 'sand']), { roof: h > 9 && i % 5 === 0, stairDir: Math.sign(Math.cos(a)) || 1 });
    }
    // downtown clusters
    const clusters = [
      [-26, -26], [26, -26], [-26, 26], [26, 26],
      [-16, -34], [16, -34], [-34, -14], [34, 14], [-14, 34], [16, 34], [-34, 16], [34, -16],
    ];
    for (const [bx, bz] of clusters) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const w = rng.range(7, 13), d = rng.range(6, 11), h = rng.range(4, 15);
        const cx = bx + rng.range(-7, 7), cz = bz + rng.range(-7, 7);
        if (Math.abs(cx) > HALF - 6 || Math.abs(cz) > HALF - 6) continue;
        building(cx, cz, w, d, h, rng.pick(['light', 'block', 'sand']), { roof: h > 10 && rng.chance(.45), stairDir: rng.sign() });
      }
    }

    // ── landables: watchtower in the centre-east, market stalls south-west ──
    building(12, -6, 6, 6, 13.5, 'block', { roof: true, stairDir: -1 });
    this.addSolid(-11, 11, 5.5, 1.1, 2.4, 2.7, this.mats.metal);      // mezzanine slab
    this.stairsTo(-11, 11, 2.7, 1);

    // ── cover furniture: sandbags, crates, containers, cars, walls ────────
    const sandbagWall = (x, z, len, dir, bags = true) => {
      const rows = 2 + (rng.chance(.4) ? 1 : 0);
      const n = Math.max(1, Math.round(len / 0.85));
      const mat = bags ? this.mats.bag : this.mats.concrete;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < rows; r++) {
          const px = dir === 0 ? x + i * 0.85 : x;
          const pz = dir === 0 ? z : z + i * 0.85;
          const sc = 1 - r * 0.06;
          this.addGeo(mat, new THREE.BoxGeometry(0.86 * sc, 0.44, 0.8 * sc), px, r * 0.42 + 0.22, pz, rng.range(-.06, .06));
        }
      }
      // one collider for the whole wall instead of one per bag
      const wl = n * 0.86, wd = 0.92;
      const cx = dir === 0 ? x + (n - 1) * 0.425 : x;
      const cz = dir === 0 ? z : z + (n - 1) * 0.425;
      this.addCollider(cx, cz, dir === 0 ? wl : wd, dir === 0 ? wd : wl, 0, rows * 0.42, bags ? 'sand' : 'concrete');
    };
    const crate = (x, z, s = 1.1) => {
      this.addSolid(x, z, s, s, 0, s, this.mats.wood);
      if (rng.chance(.35)) this.addSolid(x + rng.range(-.1, .1), z + rng.range(-.1, .1), s * .8, s * .8, s, s + s * .8, this.mats.wood);
    };
    const container = (x, z, rot) => {
      const len = 6.1, wid = 2.45, h = 2.6;
      const mat = rng.chance(.5) ? this.mats.rust : (this.mats.teal || (this.mats.teal = new THREE.MeshStandardMaterial({ map: this.tex.metal, color: 0x4a7f8c, roughness: .6, metalness: .5 })));
      this.addGeo(mat, new THREE.BoxGeometry(len, h, wid), x, h / 2, z, rot);
      const rib = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(rot));
      for (let i = 0; i < 7; i++) {
        this.addGeo(this.mats.dark, new THREE.BoxGeometry(.12, h * .96, wid + .06)
          .applyMatrix4(new THREE.Matrix4().makeTranslation(-len / 2 + .3 + i * (len - .6) / 6.99, h / 2, 0).premultiply(rib)));
      }
      const hw = (Math.abs(Math.cos(rot)) * len + Math.abs(Math.sin(rot)) * wid) / 2;
      const hd = (Math.abs(Math.cos(rot)) * wid + Math.abs(Math.sin(rot)) * len) / 2;
      const b = boxAdd(this.colliders, x, z, hw * 2, hd * 2, 0, h);
      b.kind = 'metal';
      this.colliders.push(b);
    };
    const wreck = (x, z, rot, color = 0x3b3f42) => {
      const key = 'car' + color;
      const mat = this.mats[key] || (this.mats[key] = new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .4 }));
      const put = (geo, lx, ly, lz, m2) => {
        geo.applyMatrix4(new THREE.Matrix4().makeTranslation(lx, ly, lz).premultiply(m2));
        this.addGeo(m2 === null ? mat : mat, geo);
      };
      const root = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(rot));
      this.addGeo(mat, new THREE.BoxGeometry(4.2, .95, 2.0).applyMatrix4(new THREE.Matrix4().makeTranslation(0, .72, 0).premultiply(root)));
      this.addGeo(mat, new THREE.BoxGeometry(2.1, .8, 1.8).applyMatrix4(new THREE.Matrix4().makeTranslation(-.2, 1.5, 0).premultiply(root)));
      for (const [ox, oz] of [[1.35, 1.0], [-1.35, 1.0], [1.35, -1.0], [-1.35, -1.0]]) {
        this.addGeo(this.mats.dark, new THREE.BoxGeometry(.7, .7, .32)
          .applyMatrix4(new THREE.Matrix4().makeTranslation(ox, .38, oz).premultiply(root)));
      }
      void put;
      const w = Math.abs(Math.cos(rot)) * 4.2 + Math.abs(Math.sin(rot)) * 2.0;
      const d = Math.abs(Math.sin(rot)) * 4.2 + Math.abs(Math.cos(rot)) * 2.0;
      this.addCollider(x, z, w, d, 0, 1.5, 'metal');
    };
    const barrel = (x, z) => {
      const mat = rng.chance(.4) ? this.mats.rust : this.mats.metal;
      this.addGeo(mat, new THREE.CylinderGeometry(.42, .42, 1.05, 9), x, .52, z, rng.range(0, 3));
      const b = boxAdd(this.colliders, x, z, .84, .84, 0, 1.05);
      b.kind = 'metal'; this.colliders.push(b);
    };
    const lowWall = (x, z, len, dir) => {
      this.addSolid(x, z, dir === 0 ? len : .5, dir === 0 ? .5 : len, 0, 1.15, this.mats.concrete);
    };

    // scatter cover through the streets, avoiding the very centre lanes
    const used = [];
    const free = (x, z, r) => {
      for (const u of used) if (Math.hypot(u.x - x, u.z - z) < u.r + r) return false;
      return true;
    };
    for (let i = 0; i < 44; i++) {
      const x = rng.range(-HALF + 8, HALF - 8), z = rng.range(-HALF + 8, HALF - 8);
      if (!free(x, z, 4)) continue;
      used.push({ x, z, r: 5 });
      const k = rng.int(0, 6);
      if (k === 0) sandbagWall(x - 1.7, z, 3.4, rng.int(0, 1));
      else if (k === 1) { crate(x, z); crate(x + 1.2, z - .4, .95); }
      else if (k === 2) lowWall(x, z, rng.range(4, 8), rng.int(0, 1));
      else if (k === 3) container(x, z, rng.chance(.5) ? 0 : Math.PI / 2);
      else if (k === 4) wreck(x, z, rng.range(0, 3.14), rng.pick([0x3b3f42, 0x5a4a3a, 0x42504a]));
      else if (k === 5) { for (let j = 0; j < 3; j++) barrel(x + rng.range(-1.2, 1.2), z + rng.range(-1.2, 1.2)); }
      else { sandbagWall(x - 1.3, z + 1.3, 2.6, 1); crate(x + 1.4, z - 1); }
    }
    // a defensive ring of barriers + a few nests near the objective
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 13.5, z = Math.sin(a) * 13.5;
      if (i % 3 === 0) sandbagWall(x - 1.4, z, 2.8, a > Math.PI / 2 && a < Math.PI * 1.5 ? 1 : 0);
      else if (i % 3 === 1) crate(x, z, 1.2);
      else lowWall(x, z, 3.6, Math.abs(Math.cos(a)) > .5 ? 0 : 1);
    }

    // ── soft decoration (no collision): poles, tarps, debris, antennas ────
    const decor = new THREE.Group();
    this.group.add(decor);
    const poleMat = this.mats.dark;
    for (let i = 0; i < 16; i++) {
      const x = rng.range(-HALF + 6, HALF - 6), z = rng.range(-HALF + 6, HALF - 6), rot = rng.range(0, 6.28);
      const root = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(rot));
      this.addGeo(poleMat, new THREE.CylinderGeometry(.09, .12, 6, 6).applyMatrix4(new THREE.Matrix4().makeTranslation(0, 3, 0).premultiply(root)));
      this.addGeo(poleMat, new THREE.BoxGeometry(1.1, .1, .1).applyMatrix4(new THREE.Matrix4().makeTranslation(.5, 5.8, 0).premultiply(root)));
      this.addGeo(this.lampMat || (this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffb457, emissiveIntensity: .5, roughness: .5 })),
        new THREE.BoxGeometry(.42, .16, .3).applyMatrix4(new THREE.Matrix4().makeTranslation(.92, 5.7, 0).premultiply(root)));
      this.lights.push({ x, y: 5.6, z, on: rng.chance(.55), flick: rng.range(0, 9), light: null });
      const pl = new THREE.PointLight(0xffc079, 0, 11, 2);
      pl.position.set(x + .9 * Math.cos(rot), 5.5, z - .9 * Math.sin(rot));
      decor.add(pl);
      this.lights[this.lights.length - 1].light = pl;
    }
    // rubble piles + trash
    const rub = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.mats.concrete);
    const rubGeo = new THREE.InstancedMesh(rub.geometry, this.mats.concrete, 220);
    rubGeo.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 220; i++) {
      const x = rng.range(-HALF + 2, HALF - 2), z = rng.range(-HALF + 2, HALF - 2);
      const s = rng.range(.16, .55);
      dummy.position.set(x, s * .35, z);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      dummy.scale.set(s * rng.range(1, 2.6), s * rng.range(.5, 1.2), s * rng.range(1, 2.6));
      dummy.updateMatrix();
      rubGeo.setMatrixAt(i, dummy.matrix);
    }
    rubGeo.castShadow = false; rubGeo.receiveShadow = true;
    decor.add(rubGeo);
    // smoke columns rising from a few spots
    const smokeTex = (() => {
      const [c, x] = cv(128);
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
      g.addColorStop(0, 'rgba(30,30,32,.85)');
      g.addColorStop(.6, 'rgba(45,42,40,.35)');
      g.addColorStop(1, 'rgba(60,55,50,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    for (let i = 0; i < 5; i++) {
      const x = rng.range(-HALF + 10, HALF - 10), z = rng.range(-HALF + 10, HALF - 10);
      const col = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(7 + k * 1.6, 7 + k * 1.6), new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: .34 - k * .028 }));
        s.position.y = 2 + k * 3.4;
        s.userData.spin = rng.range(-.06, .06);
        s.userData.bob = rng.range(0, 6);
        col.add(s);
      }
      col.position.set(x, 0, z);
      decor.add(col);
      this.smokes.push(col);
      // fire glow at the base
      const f = new THREE.PointLight(0xff7a2a, 1.4, 14, 2);
      f.position.set(x, 1.4, z);
      decor.add(f);
      this.animated.push({ type: 'fire', light: f, ph: rng.range(0, 9) });
    }

    // objective marker: a comms uplink in the plaza
    const up = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, .6, 12), this.mats.concrete);
    base.position.y = .3; base.receiveShadow = true;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, 6.5, 8), this.mats.metal);
    mast.position.y = 3.6; mast.castShadow = true;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.mats.metal);
    dish.position.set(0, 6.2, 0); dish.rotation.x = -0.6; dish.castShadow = true;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4433 }));
    beacon.position.y = 7.1;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.objective.r, .06, 4, 48), new THREE.MeshBasicMaterial({ color: 0x41e0a0, transparent: true, opacity: .55 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .05;
    up.add(base, mast, dish, beacon, ring);
    up.position.set(this.objective.x, 0, this.objective.z);
    this.group.add(up);
    this.objRing = ring;
    this.objBeacon = beacon;
    this.addSolid(this.objective.x, this.objective.z, 1.4, 1.4, 0, 7.0, this.mats.dark);

    // merge static geometry + build the collider cache *before* spawn selection,
    // which raycasts against it
    this.mergedCount = this.finish();

    // spawn markers around the map — must be open ground, never inside a wall
    const openGround = (x, z) => {
      if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) return false;
      if (this.solidAt(x, .05, z, .9, 2.0)) return false;
      const gy = this.groundAt(x, z, .9, 6, 6);
      if (gy > .5) return false;
      // needs a bit of elbow room
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (this.solidAt(x + dx, .05, z + dz, .5, 1.6)) return false;
      return true;
    };
    this.openGround = openGround;
    const cands = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      for (const r of [19, 27, 35, 41]) cands.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    for (let i = 0; i < 90; i++) cands.push({ x: rng.range(-HALF + 8, HALF - 8), z: rng.range(-HALF + 8, HALF - 8) });
    for (const c of cands) {
      if (!openGround(c.x, c.z)) continue;
      const r = Math.hypot(c.x, c.z) || 1;
      const ro = this.rayTrace(c.x, 1.4, c.z, -c.x / r, 0, -c.z / r, r - 2);
      if (ro && ro.t < 5) continue;
      this.spawns.push(c);
    }
    if (this.spawns.length < 8) this.spawns.push({ x: 0, z: 24 }, { x: 0, z: -24 }, { x: 24, z: 0 }, { x: -24, z: 0 });
    this.buildNav();
    return this;
  }

  /** a safe standable spot near (x,z), nudging outward until it is clear */
  safeSpot(x, z, maxR = 6) {
    if (this.openGround && this.openGround(x, z)) return { x, z };
    for (let r = 1.5; r <= maxR; r += 1.5) {
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
        if (this.openGround && this.openGround(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** little stepped ramp (works with the 0.6m auto step-up) */
  stairsTo(x, z, topY, dir) {
    const steps = Math.ceil(topY / 0.32);
    for (let i = 0; i < steps; i++) {
      const y = (i + 1) * 0.32;
      this.addSolid(x - dir * (3.4 + (steps - i) * 0.7), z, 2.6, 1.0, 0, Math.min(y, topY), this.mats.metal);
    }
  }

  // ── navigation grid ──────────────────────────────────────────────────────
  buildNav() {
    const pad = 0.45;
    for (const b of this.colliders) {
      if (b.y1 < 0.5) continue;
      const i0 = this.ci(Math.max(-HALF, b.x0 - pad)), i1 = this.ci(Math.min(HALF, b.x1 + pad));
      const j0 = this.ci(Math.max(-HALF, b.z0 - pad)), j1 = this.ci(Math.min(HALF, b.z1 + pad));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.blocked[j * GN + i] = 1;
    }
    // cover score: passable cells hugging a waist-height blocker
    for (let i = 0; i < GN; i++) {
      for (let j = 0; j < GN; j++) {
        const k = j * GN + i;
        if (this.blocked[k]) continue;
        let score = 0;
        for (const b of this.colliders) {
          if (b.y1 > 2.6 || b.y1 < 0.55) continue;
          const cx = this.cf(i), cz = this.cf(j);
          const dx = clamp(cx, b.x0, b.x1), dz = clamp(cz, b.z0, b.z1);
          if (Math.hypot(cx - dx, cz - dz) < 1.7) score++;
        }
        this.cover[k] = clamp(score, 0, 15);
      }
    }
  }
  ci(v) { return clamp(Math.floor((v + HALF) / CELL), 0, GN - 1); }
  cf(i) { return -HALF + (i + .5) * CELL; }
  passable(i, j) { return i >= 0 && j >= 0 && i < GN && j < GN && !this.blocked[j * GN + i]; }
  cellOf(x, z) { return [this.ci(x), this.ci(z)]; }
  posOf(i, j) { return { x: this.cf(i), z: this.cf(j) }; }

  /** A* over the grid, with LOS smoothing. Returns [{x,z},…] or null */
  path(sx, sz, tx, tz, maxNodes = 2600) {
    const [si, sj] = this.cellOf(sx, sz), [ti, tj] = this.cellOf(tx, tz);
    if (!this.passable(ti, tj)) return null;
    if (si === ti && sj === tj) return null;
    const start = sj * GN + si, goal = tj * GN + ti;
    const g = new Map(), from = new Map(), closed = new Set();
    const open = new MinHeap();
    const h = (i, j) => Math.hypot(i - ti, j - tj) * CELL * 0.95;
    g.set(start, 0);
    open.push(start, h(si, sj));
    let n = 0;
    while (open.size && n++ < maxNodes) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      const ci = cur % GN, cj = (cur / GN) | 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.passable(ni, nj)) continue;
          if (di && dj && (!this.passable(ci + di, cj) || !this.passable(ci, cj + dj))) continue;
          const step = (di && dj ? 1.4142 : 1) * CELL;
          const nk = nj * GN + ni;
          const ng = (g.get(cur) ?? 1e9) + step;
          if (ng < (g.get(nk) ?? 1e9)) {
            g.set(nk, ng); from.set(nk, cur);
            open.push(nk, ng + h(ni, nj));
          }
        }
      }
    }
    if (!from.has(goal)) return null;
    const cells = [];
    let k = goal;
    while (k !== undefined && k !== start) { cells.unshift(k); k = from.get(k); }
    if (!cells.length) return null;
    // LOS smoothing
    const pts = cells.map((kk) => this.posOf(kk % GN, (kk / GN) | 0));
    const out = [];
    let anchor = { x: sx, z: sz }, ai = 0;
    while (ai < pts.length) {
      let best = ai;
      for (let j = pts.length - 1; j > ai; j--) {
        if (this.groundClear(anchor, pts[j])) { best = j; break; }
      }
      out.push(pts[best]);
      anchor = pts[best];
      ai = best + 1;
    }
    return out;
  }

  /** cheap 2D walkability ray between grid points */
  groundClear(a, b) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 1.1));
    for (let i = 1; i < steps; i++) {
      const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const [ci, cj] = this.cellOf(x, z);
      if (!this.passable(ci, cj)) return false;
    }
    return true;
  }

  /** best cover cell within `rad` of (x,z) that hides from (tx,tz) */
  findCover(x, z, tx, tz, rad = 9) {
    let best = null, bestScore = -1e9;
    const [bi, bj] = this.cellOf(x, z);
    const R = Math.ceil(rad / CELL);
    for (let di = -R; di <= R; di++) {
      for (let dj = -R; dj <= R; dj++) {
        const i = bi + di, j = bj + dj;
        if (!this.passable(i, j)) continue;
        const cov = this.cover[j * GN + i];
        if (cov < 1) continue;
        const p = this.posOf(i, j);
        const dd = Math.hypot(p.x - x, p.z - z);
        if (dd > rad) continue;
        // hide the candidate point from the threat?
        if (!this.blockedBetween(p, { x: tx, z: tz })) continue;
        const score = cov * 2.2 - dd * 1.4 - Math.abs(Math.hypot(p.x - tx, p.z - tz) - 14) * .3;
        if (score > bestScore) { bestScore = score; best = p; }
      }
    }
    return best;
  }

  blockedBetween(a, b) {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const hit = this.rayTrace(a.x, 1.25, a.z, (b.x - a.x) / len, 0, (b.z - a.z) / len, len - .1);
    return !!hit && hit.t > 0.25;
  }

  /** 3D line of sight between two THREE.Vector3-ish points */
  losTo(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.rayTrace(from.x, from.y, from.z, dx / len, dy / len, dz / len, len - .06);
  }

  /** highest standable surface under (x,z) between newY and prevY+step */
  groundAt(x, z, r, prevY, newY) {
    const f = this._flat;
    let g = 0;
    if (!f) return 0;
    for (let o = 0; o < f.length; o += 6) {
      const y1 = f[o + 4];
      if (y1 <= g || y1 > prevY + 0.62 || y1 < newY - 0.001) continue;
      if (x + r > f[o] && x - r < f[o + 3] && z + r > f[o + 2] && z - r < f[o + 5]) g = y1;
    }
    return g;
  }

  /** lowest ceiling above the feet, or Infinity */
  ceilAt(x, z, r, y) {
    const f = this._flat;
    let c = Infinity;
    if (!f) return c;
    for (let o = 0; o < f.length; o += 6) {
      const y0 = f[o + 1];
      if (y0 < y - 0.02 || y0 >= c || f[o + 4] <= y + 0.2) continue;
      if (x + r > f[o] && x - r < f[o + 3] && z + r > f[o + 2] && z - r < f[o + 5]) c = y0;
    }
    return c;
  }

  /** true when a body of radius r / height h at (x,y,z) is inside solid geometry */
  solidAt(x, y, z, r, h) {
    const f = this._flat;
    if (!f) return false;
    const yTop = y + h, lim = y + 0.62;
    for (let o = 0; o < f.length; o += 6) {
      if (f[o + 4] > lim && f[o + 1] < yTop && x + r > f[o] && x - r < f[o + 3] && z + r > f[o + 2] && z - r < f[o + 5]) return true;
    }
    return false;
  }

  /** true when a crouched body would be squeezed under something */
  headroom(x, y, z, r, h) { return !this.solidAt(x, y, z, r, h); }

  clampToArena(p) {
    p.x = clamp(p.x, -HALF + 1.2, HALF - 1.2);
    p.z = clamp(p.z, -HALF + 1.2, HALF - 1.2);
  }

  update(dt, t, px, pz) {
    // shadow frustum follows the player
    const s = this.sun;
    s.position.set(px - 38, 46, pz + 26);
    s.target.position.set(px, 0, pz);
    s.target.updateMatrixWorld();
    for (const col of this.smokes) {
      for (const c of col.children) {
        c.rotation.z += c.userData.spin * dt * 8;
        c.position.y += Math.sin(t * .35 + c.userData.bob) * dt * .35;
        c.quaternion.copy(this.camQ || c.quaternion);
      }
    }
    for (const a of this.animated) {
      if (a.type === 'fire') a.light.intensity = 1.1 + Math.sin(t * 11 + a.ph) * .35 + Math.sin(t * 27 + a.ph * 2) * .2;
    }
    if (this.objRing) {
      this.objRing.rotation.z = t * .35;
      this.objBeacon.material.color.setRGB(1, .2 + Math.abs(Math.sin(t * 3)) * .2, .15);
    }
  }

  setCamQuat(q) { this.camQ = q; }
}
