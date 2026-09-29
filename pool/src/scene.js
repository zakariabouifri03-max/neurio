// ─────────────────────────────────────────────────────────────────────────────
//  scene.js — the 3D world
//
//  Everything is built procedurally (no downloaded assets): the hall, the
//  tournament table, the felt, the wood, the balls and their number decals, the
//  cue stick and the aiming guides. Materials are PBR and lit by an environment
//  map generated from a procedural room, so reflections on the balls and the
//  lacquered rails are real. Quality tiers drive shadow maps, pixel ratio,
//  hall detail and bloom, and an FPS watchdog steps the tier down if the
//  device cannot hold the frame budget.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { BloomFX } from '../../src/post.js';
import { TABLE, BALL, POCKETS, CUSHIONS, HL, HW, HEAD_STRING_X, BALL_COLORS, PHYS } from './table.js';

const R = BALL.R;
const BED_Y = 0;                                  // cloth surface
const FLOOR_Y = -(TABLE.legH + TABLE.frameH);     // hall floor
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ── procedural textures ─────────────────────────────────────────────────────
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 4;
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  return t;
}

/** a cheap value-noise field, used by felt, wood and carpet */
function noiseField(g, w, h, scale, alpha, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = Math.ceil(w / scale) + 2, m = Math.ceil(h / scale) + 2;
  const grid = new Float32Array(n * m);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const fy = y / scale, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / scale, x0 = Math.floor(fx), tx = fx - x0;
      const a = grid[y0 * n + x0], b = grid[y0 * n + x0 + 1], c = grid[(y0 + 1) * n + x0], e = grid[(y0 + 1) * n + x0 + 1];
      const v = lerp(lerp(a, b, tx), lerp(c, e, tx), ty);
      const k = (v - 0.5) * alpha * 255;
      const i4 = (y * w + x) * 4;
      d[i4] = clamp(d[i4] + k, 0, 255);
      d[i4 + 1] = clamp(d[i4 + 1] + k, 0, 255);
      d[i4 + 2] = clamp(d[i4 + 2] + k, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
}

export const CLOTH_COLORS = {
  blue: { base: '#1c5f86', sheen: '#63b6e6', name: 'Tournament Blue' },
  green: { base: '#1d6b45', sheen: '#6fd6a1', name: 'Classic Green' },
  red: { base: '#7d2230', sheen: '#e58a97', name: 'Crimson' },
  graphite: { base: '#3a3f45', sheen: '#9aa6b2', name: 'Graphite' },
};
export const WOOD_FINISHES = {
  tournament: { base: '#4a2a17', grain: '#2a160c', name: 'Mahogany' },
  bar: { base: '#6b4526', grain: '#3d2513', name: 'Oak' },
  vintage: { base: '#2f1d12', grain: '#170d07', name: 'Ebony' },
};

function feltTexture(key) {
  const c = CLOTH_COLORS[key] || CLOTH_COLORS.blue;
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = c.base; g.fillRect(0, 0, w, h);
    // woven nap: fine cross-hatch
    g.globalAlpha = 0.05;
    for (let i = 0; i < w; i += 3) {
      g.fillStyle = i % 6 === 0 ? '#ffffff' : '#000000';
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
    g.globalAlpha = 1;
    noiseField(g, w, h, 6, 0.05, 7);
  }, { repeat: [3, 1.6], aniso: 8 });
}

function woodTexture(finishKey, opts = {}) {
  const f = WOOD_FINISHES[finishKey] || WOOD_FINISHES.tournament;
  return canvasTex(opts.w || 512, opts.h || 512, (g, w, h) => {
    g.fillStyle = f.base; g.fillRect(0, 0, w, h);
    // long grain lines with wandering frequency
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * h;
      const amp = 2 + Math.random() * 9;
      g.strokeStyle = Math.random() < 0.5 ? f.grain : '#ffffff';
      g.globalAlpha = 0.05 + Math.random() * 0.10;
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const yy = y + Math.sin(x * 0.021 + i) * amp + Math.sin(x * 0.006 + i * 2.3) * amp * 0.6;
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // knots
    for (let i = 0; i < 3; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 16;
      const grd = g.createRadialGradient(x, y, 1, x, y, r);
      grd.addColorStop(0, 'rgba(20,10,5,0.55)');
      grd.addColorStop(1, 'rgba(20,10,5,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    noiseField(g, w, h, 5, 0.05, 21);
  }, { repeat: opts.repeat || [2, 1], aniso: 8 });
}

function carpetTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2a1f22'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${30 + Math.random() * 30 | 0},${35 + Math.random() * 30 | 0},0.35)`;
      g.fillRect(x, y, 2, 2);
    }
    // a subtle damask diamond
    g.strokeStyle = 'rgba(150,110,80,0.10)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 64) {
      g.beginPath(); g.moveTo(x + 32, y + 6); g.lineTo(x + 58, y + 32); g.lineTo(x + 32, y + 58); g.lineTo(x + 6, y + 32); g.closePath(); g.stroke();
    }
    noiseField(g, w, h, 8, 0.06, 3);
  }, { repeat: [10, 10], aniso: 4 });
}

function floorTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b1d14'; g.fillRect(0, 0, w, h);
    const plankH = 64;
    for (let y = 0; y < h; y += plankH) {
      const off = ((y / plankH) % 2) * 90;
      for (let x = -90; x < w + 90; x += 180) {
        const l = 150 + Math.random() * 40;
        g.fillStyle = `rgb(${l * 0.42 | 0},${l * 0.28 | 0},${l * 0.18 | 0})`;
        g.fillRect(x + off + 1, y + 1, 178, plankH - 2);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
        g.strokeRect(x + off + 1, y + 1, 178, plankH - 2);
        g.globalAlpha = 0.16;
        for (let i = 0; i < 14; i++) {
          g.strokeStyle = Math.random() < 0.5 ? '#000' : '#fff';
          g.beginPath();
          const yy = y + Math.random() * plankH;
          g.moveTo(x + off, yy); g.lineTo(x + off + 180, yy + (Math.random() - 0.5) * 5);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
  }, { repeat: [6, 6], aniso: 8 });
}

/** the number decal wrap for one ball */
export function ballTexture(n) {
  const color = BALL_COLORS[n] || '#f7f5ef';
  const stripe = n >= 9 && n <= 15;
  return canvasTex(512, 256, (g, w, h) => {
    if (n === 0) {
      g.fillStyle = '#f8f6f0'; g.fillRect(0, 0, w, h);
      // a faint speckle so the cue ball is not flat white
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(190,190,185,${Math.random() * 0.10})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      return;
    }
    if (stripe) { g.fillStyle = '#f8f6f0'; g.fillRect(0, 0, w, h); g.fillStyle = color; g.fillRect(0, h * 0.27, w, h * 0.46); }
    else { g.fillStyle = color; g.fillRect(0, 0, w, h); }
    // two number discs, opposite each other, like a real ball
    for (const u of [0.25, 0.75]) {
      const cx = u * w, cy = h * 0.5, r = h * 0.185;
      g.beginPath(); g.arc(cx, cy, r, 0, 7);
      g.fillStyle = '#fbfaf6'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.18)'; g.stroke();
      g.fillStyle = '#141414';
      g.font = `700 ${Math.round(r * 1.32)}px "Bebas Neue", "Arial Narrow", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy + r * 0.06);
    }
    // polish shading baked into the wrap is unnecessary (PBR handles it), but a
    // hint of wear at the poles makes it read as a used ball
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0.10)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { aniso: 8 });
}

function leatherTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a1a12'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 1 + Math.random() * 3;
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '120,80,50'},${0.05 + Math.random() * 0.12})`;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }, { repeat: [3, 1], aniso: 4 });
}

// ── quality tiers ───────────────────────────────────────────────────────────
export const QUALITY = {
  low: { name: 'Low', dpr: 0.7, shadows: false, shadowSize: 0, bloom: false, hallDetail: 0, envSize: 64, lamps: 1, msaa: 0 },
  medium: { name: 'Medium', dpr: 1.0, shadows: true, shadowSize: 1024, bloom: false, hallDetail: 1, envSize: 128, lamps: 2, msaa: 0 },
  high: { name: 'High', dpr: 1.35, shadows: true, shadowSize: 1536, bloom: true, hallDetail: 2, envSize: 256, lamps: 3, msaa: 2 },
  ultra: { name: 'Ultra', dpr: 2.0, shadows: true, shadowSize: 2048, bloom: true, hallDetail: 3, envSize: 256, lamps: 3, msaa: 4 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

/** guess a sensible tier from the device before the first frame */
export function detectQuality() {
  const nav = navigator;
  const mem = nav.deviceMemory || 4;
  const cores = nav.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const small = Math.min(screen.width, screen.height) < 820;
  let score = 0;
  score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
  score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
  if (mobile) score -= 2;
  if (small) score -= 1;
  const dpr = window.devicePixelRatio || 1;
  if (dpr >= 2.5 && !mobile) score += 1;
  if (score >= 4) return 'ultra';
  if (score >= 2) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

// ── the scene ───────────────────────────────────────────────────────────────
export class Scene3D {
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.quality = settings.quality && settings.quality !== 'auto' ? settings.quality : detectQuality();
    this.auto = !settings.quality || settings.quality === 'auto';
    this.Q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.Q.msaa > 0, powerPreference: 'high-performance', alpha: false, stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.Q.dpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = !!this.Q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#08131a');
    this.scene.fog = new THREE.Fog('#08131a', 9, 34);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.02, 90);
    this.camera.position.set(0, 1.4, 2.6);

    this.clock = new THREE.Clock();
    this.groups = {
      root: new THREE.Group(),
      hall: new THREE.Group(),
      table: new THREE.Group(),
      balls: new THREE.Group(),
      props: new THREE.Group(),
      guides: new THREE.Group(),
      fx: new THREE.Group(),
      people: new THREE.Group(),
    };
    for (const k in this.groups) this.scene.add(this.groups[k]);
    this.groups.guides.frustumCulled = false;

    this.bloom = null;
    if (this.Q.bloom) { try { this.bloom = new BloomFX(this.renderer); this.bloom.strength = 0.42; this.bloom.threshold = 0.86; } catch (e) { this.bloom = null; } }

    this._buildEnv();
    this._lights = [];
    this.ballMeshes = [];
    this.guideLevel = settings.guides === undefined ? 2 : settings.guides;
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0; this._downgrades = 0;
    this.cam = new CameraRig(this);
    this.guides = new Guides(this);
    this.resize();
  }

  // ── environment map (procedural room → PMREM) ─────────────────────────────
  _buildEnv() {
    const size = this.Q.envSize;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const env = new THREE.Scene();
    // warm ceiling panels + dark floor, the classic pool-hall reflection
    const box = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: '#121a20', side: THREE.BackSide }));
    env.add(box);
    const panelMat = new THREE.MeshBasicMaterial({ color: '#fff3dc' });
    for (let i = -1; i <= 1; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), panelMat);
      p.position.set(i * 3.4, 2.85, 0); p.rotation.x = Math.PI / 2; env.add(p);
    }
    const warm = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: '#2a1a10' }));
    warm.position.y = -2.9; warm.rotation.x = -Math.PI / 2; env.add(warm);
    const teal = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: '#12414f' }));
    teal.position.set(0, 0.4, -5.9); env.add(teal);
    const rt = pmrem.fromScene(env, 0.04);
    this.envMap = rt.texture;
    this.scene.environment = this.envMap;
    env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pmrem.dispose();
  }

  // ── lighting ──────────────────────────────────────────────────────────────
  buildLights() {
    for (const l of this._lights) { this.scene.remove(l.obj); if (l.obj.dispose) l.obj.dispose(); }
    this._lights = [];
    const hemi = new THREE.HemisphereLight('#8fb6cc', '#241a12', 0.34);
    this.scene.add(hemi); this._lights.push({ obj: hemi });

    const lamps = this.Q.lamps;
    const shadeMat = new THREE.MeshStandardMaterial({ color: '#1b2b31', roughness: 0.55, metalness: 0.4, emissive: '#ffd9a0', emissiveIntensity: 0.55, side: THREE.DoubleSide });
    const bulbMat = new THREE.MeshBasicMaterial({ color: '#fff6e2' });
    const rodMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.5, metalness: 0.7 });
    const xs = lamps === 1 ? [0] : lamps === 2 ? [-HL * 0.5, HL * 0.5] : [-HL * 0.62, 0, HL * 0.62];
    const lampY = 1.62;
    for (const x of xs) {
      const g = new THREE.Group();
      g.position.set(x, 0, 0);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.20, 20, 1, true), shadeMat);
      shade.position.y = lampY; shade.rotation.x = Math.PI; g.add(shade);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.012, 8, 24), new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.3, metalness: 0.9 }));
      rim.position.y = lampY - 0.10; rim.rotation.x = Math.PI / 2; g.add(rim);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), bulbMat);
      bulb.position.y = lampY - 0.10; g.add(bulb);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.9 - lampY, 6), rodMat);
      rod.position.y = lampY + (2.9 - lampY) / 2; g.add(rod);

      const spot = new THREE.SpotLight('#ffe6bd', 26, 7.4, 0.72, 0.62, 1.5);
      spot.position.set(x, lampY - 0.12, 0);
      spot.target.position.set(x, 0, 0);
      if (this.Q.shadows) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(this.Q.shadowSize, this.Q.shadowSize);
        spot.shadow.camera.near = 0.2; spot.shadow.camera.far = 5.2;
        spot.shadow.bias = -0.0012; spot.shadow.normalBias = 0.012;
        spot.shadow.radius = 2.2;
      }
      this.groups.table.add(g);
      this.scene.add(spot); this.scene.add(spot.target);
      this._lights.push({ obj: spot, target: spot.target, group: g });
    }
    // soft fill so the shadows are not pure black
    const fill = new THREE.DirectionalLight('#9fc4dd', 0.20);
    fill.position.set(-2.4, 3.2, 2.6);
    this.scene.add(fill); this._lights.push({ obj: fill });
    this.lampY = lampY;
  }

  // ── the table ─────────────────────────────────────────────────────────────
  buildTable(opts = {}) {
    const clothKey = opts.cloth || 'blue';
    const finishKey = opts.finish || 'tournament';
    const g = this.groups.table;
    // keep lamps if already built
    const keep = [];
    g.traverse((o) => { if (o.userData.isLamp) keep.push(o); });
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse((o) => { if (o.geometry && !o.userData.keepGeo) o.geometry.dispose(); });
    }
    for (const k of keep) g.add(k);

    const felt = feltTexture(clothKey);
    const wood = woodTexture(finishKey, { repeat: [3, 1] });
    const leather = leatherTexture();
    const CC = CLOTH_COLORS[clothKey] || CLOTH_COLORS.blue;

    const clothMat = new THREE.MeshPhysicalMaterial({
      map: felt, color: '#ffffff', roughness: 0.94, metalness: 0,
      sheen: 0.85, sheenRoughness: 0.92, sheenColor: new THREE.Color(CC.sheen),
      envMapIntensity: 0.35,
    });
    const woodMat = new THREE.MeshPhysicalMaterial({
      map: wood, roughness: 0.32, metalness: 0.05, clearcoat: 0.75, clearcoatRoughness: 0.16, envMapIntensity: 0.9,
    });
    const darkWood = new THREE.MeshPhysicalMaterial({
      color: '#2a1a10', map: wood, roughness: 0.42, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.7,
    });
    const cushionMat = new THREE.MeshPhysicalMaterial({
      map: felt, color: '#ffffff', roughness: 0.9, sheen: 0.7, sheenRoughness: 0.95, sheenColor: new THREE.Color(CC.sheen), envMapIntensity: 0.3,
    });
    const leatherMat = new THREE.MeshStandardMaterial({ map: leather, color: '#4a2c1c', roughness: 0.85, metalness: 0.02 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.18, metalness: 1, envMapIntensity: 1.3 });
    const pearlMat = new THREE.MeshPhysicalMaterial({ color: '#f3ece0', roughness: 0.25, metalness: 0.1, clearcoat: 1, iridescence: 0.5, iridescenceIOR: 1.4 });

    // ── cloth: a rectangle with the six pocket mouths cut out of it
    const shape = new THREE.Shape();
    const pad = 0.022;
    shape.moveTo(-HL - pad, -HW - pad);
    shape.lineTo(HL + pad, -HW - pad);
    shape.lineTo(HL + pad, HW + pad);
    shape.lineTo(-HL - pad, HW + pad);
    shape.closePath();
    for (const p of POCKETS) {
      const hole = new THREE.Path();
      const rr = p.r * (p.kind === 'side' ? 1.0 : 1.02);
      hole.absarc(p.x, p.z, rr, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const clothGeo = new THREE.ShapeGeometry(shape, 26);
    clothGeo.rotateX(-Math.PI / 2);
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.y = BED_Y;
    cloth.receiveShadow = true;
    g.add(cloth);
    this.clothMesh = cloth;

    // the slate bed under the cloth (gives the table thickness)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 0.20, TABLE.frameH, TABLE.W + 0.20), darkWood);
    bed.position.y = BED_Y - TABLE.frameH / 2 - 0.004;
    bed.receiveShadow = true; bed.castShadow = true;
    g.add(bed);

    // ── cushions, extruded from the exact segments the physics uses
    for (const c of CUSHIONS) {
      const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
      const dx = (c.bx - c.ax) / len, dz = (c.bz - c.az) / len;
      const prof = new THREE.Shape();
      // K66-ish profile: nose at the physics line, face back to the bed, then
      // up to the rail cap. Local x = outward from the bed, y = height.
      const nose = TABLE.railH;
      prof.moveTo(0, nose);
      prof.lineTo(0.006, nose * 0.62);
      prof.lineTo(0.020, 0.0);
      prof.lineTo(0.052, 0.0);
      prof.lineTo(0.056, nose + 0.040);
      prof.lineTo(0.086, nose + 0.046);
      prof.lineTo(0.086, 0.0);
      prof.closePath();
      const geo = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false, curveSegments: 1 });
      geo.translate(0, 0, 0);
      const xAxis = new THREE.Vector3(-c.nx, 0, -c.nz);
      const yAxis = new THREE.Vector3(0, 1, 0);
      const zAxis = new THREE.Vector3(dx, 0, dz);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      geo.applyMatrix4(m);
      geo.translate(c.ax, BED_Y, c.az);
      const mesh = new THREE.Mesh(geo, cushionMat);
      mesh.castShadow = !!this.Q.shadows; mesh.receiveShadow = true;
      g.add(mesh);
    }

    // ── wooden rails (the frame the cushions sit in)
    const railTop = TABLE.railH + 0.046;
    const railW = 0.088;
    const mkRail = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, railTop, d), woodMat);
      m.position.set(x, BED_Y + railTop / 2 - 0.002, z);
      m.castShadow = !!this.Q.shadows; m.receiveShadow = true;
      g.add(m);
      // a chamfer cap so the rail reads as shaped, not a box
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.985, 0.006, d * 0.985), woodMat);
      cap.position.set(x, BED_Y + railTop + 0.001, z);
      cap.receiveShadow = true;
      g.add(cap);
      return m;
    };
    const outX = HL + railW / 2 + 0.052, outZ = HW + railW / 2 + 0.052;
    mkRail(TABLE.L + railW * 2 + 0.21, railW, 0, -outZ);
    mkRail(TABLE.L + railW * 2 + 0.21, railW, 0, outZ);
    mkRail(railW, TABLE.W + 0.10, -outX, 0);
    mkRail(railW, TABLE.W + 0.10, outX, 0);

    // ── sight diamonds, inlaid in the rail caps
    const dia = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.006, 0.004, 8), pearlMat);
    dia.rotation.x = 0;
    const diamondAt = (x, z) => {
      const m = dia.clone();
      m.position.set(x, BED_Y + railTop + 0.0035, z);
      m.rotation.x = 0;
      g.add(m);
    };
    // long rails: 6 diamonds each (skipping the pocket positions)
    for (const s of [-1, 1]) {
      const z = s * outZ;
      for (let i = 1; i <= 7; i++) {
        const x = -HL + (TABLE.L / 8) * i;
        if (Math.abs(x) < 0.09) continue;         // the side pocket
        diamondAt(x, z);
      }
      const x = s * outX;
      for (let i = 1; i <= 3; i++) diamondAt(x, -HW + (TABLE.W / 4) * i);
    }

    // ── pockets: leather liners, a dark throat and a chrome plate
    for (const p of POCKETS) {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.06, p.r * 0.92, 0.055, 22, 1, true), leatherMat);
      liner.position.set(p.x, BED_Y - 0.028, p.z);
      liner.material.side = THREE.DoubleSide;
      g.add(liner);
      const throat = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.94, 20), new THREE.MeshBasicMaterial({ color: '#05070a' }));
      throat.rotation.x = -Math.PI / 2;
      throat.position.set(p.x, BED_Y - 0.052, p.z);
      g.add(throat);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.94, p.r * 0.80, 0.10, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.9, side: THREE.DoubleSide }));
      wall.position.set(p.x, BED_Y - 0.10, p.z);
      g.add(wall);
      // chrome corner plates on the two side pockets
      if (p.kind === 'side') {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.004, 0.03), chromeMat);
        plate.position.set(p.x, BED_Y + railTop + 0.002, p.z * 0.985);
        g.add(plate);
      }
    }

    // ── legs, apron and a stretcher
    const legGeo = new THREE.CylinderGeometry(0.055, 0.072, TABLE.legH, 14);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(sx * (HL + 0.06), BED_Y - TABLE.frameH - TABLE.legH / 2 + 0.02, sz * (HW + 0.05));
      leg.castShadow = !!this.Q.shadows; leg.receiveShadow = true;
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.022, 14), chromeMat);
      foot.position.set(leg.position.x, FLOOR_Y + 0.011, leg.position.z);
      g.add(foot);
    }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 0.30, 0.10, TABLE.W + 0.30), darkWood);
    apron.position.y = BED_Y - TABLE.frameH - 0.045;
    apron.castShadow = !!this.Q.shadows; apron.receiveShadow = true;
    g.add(apron);

    // ── spots + the head string (shown on the break and for ball in hand)
    const spotMat = new THREE.MeshBasicMaterial({ color: '#e9e3d6', transparent: true, opacity: 0.5 });
    for (const s of [HEAD_STRING_X, 0, TABLE.L * 0.25]) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), spotMat);
      dot.rotation.x = -Math.PI / 2; dot.position.set(s, BED_Y + 0.0006, 0);
      g.add(dot);
    }
    const hs = new THREE.Mesh(new THREE.PlaneGeometry(0.004, HW * 2 - 0.02), new THREE.MeshBasicMaterial({ color: '#dfe8ee', transparent: true, opacity: 0.0 }));
    hs.rotation.x = -Math.PI / 2; hs.position.set(HEAD_STRING_X, BED_Y + 0.0007, 0);
    g.add(hs);
    this.headString = hs;

    // a ball-return tray and a chalk cube on the rail — small bits of life
    const chalk = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.024, 0.026), new THREE.MeshStandardMaterial({ color: '#2b6ca3', roughness: 0.85 }));
    chalk.position.set(HL * 0.62, BED_Y + railTop + 0.014, -outZ + 0.01);
    chalk.rotation.y = 0.4; chalk.castShadow = !!this.Q.shadows;
    g.add(chalk);
    const chalkTop = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.004, 12), new THREE.MeshStandardMaterial({ color: '#cfe4f2', roughness: 1 }));
    chalkTop.position.copy(chalk.position); chalkTop.position.y += 0.013; chalkTop.rotation.y = 0.4;
    g.add(chalkTop);

    this.buildLights();
    this._buildBalls();
    this.tableReady = true;
    return this;
  }

  setHeadString(on) {
    if (this.headString) this.headString.material.opacity = on ? 0.34 : 0.0;
  }

  // ── balls ─────────────────────────────────────────────────────────────────
  _buildBalls() {
    for (const m of this.ballMeshes) { this.groups.balls.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.ballMeshes = [];
    const geo = new THREE.SphereGeometry(R, this.Q.hallDetail >= 2 ? 40 : 26, this.Q.hallDetail >= 2 ? 28 : 18);
    for (let n = 0; n <= 15; n++) {
      const tex = ballTexture(n);
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex, roughness: n === 0 ? 0.14 : 0.19, metalness: 0,
        clearcoat: 1, clearcoatRoughness: 0.045, envMapIntensity: 1.25,
        sheen: 0.15, sheenColor: new THREE.Color('#ffffff'),
      });
      const m = new THREE.Mesh(geo.clone(), mat);
      m.castShadow = !!this.Q.shadows;
      m.receiveShadow = false;
      m.position.y = R;
      m.visible = false;
      m.userData.n = n;
      this.groups.balls.add(m);
      this.ballMeshes[n] = m;
    }
    // the shadow-catcher under the table gets the ball shadows
  }

  /** copy physics state into the meshes (called once per frame, not per substep) */
  syncBalls(balls) {
    for (let n = 0; n <= 15; n++) {
      const m = this.ballMeshes[n];
      if (!m) continue;
      const b = balls[n];
      if (!b || b.state === 'pocketed') { m.visible = false; continue; }
      m.visible = true;
      m.position.set(b.x, BED_Y + R - (b.y || 0), b.z);
      if (b.q) m.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      // squash nothing; just fade a falling ball out as it drops
      if (b.state === 'falling') {
        const k = clamp(1 - (b.y || 0) / (R * 3.2), 0.15, 1);
        m.scale.setScalar(k);
      } else if (m.scale.x !== 1) m.scale.setScalar(1);
    }
  }

  // ── hall ──────────────────────────────────────────────────────────────────
  buildHall(detail = this.Q.hallDetail) {
    const g = this.groups.hall;
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    if (detail <= 0) { this.hallVisible = false; return this; }
    this.hallVisible = true;

    const floorTex = detail >= 2 ? floorTexture() : null;
    const carpetTex = carpetTexture();
    const wallMat = new THREE.MeshStandardMaterial({ color: '#241d1c', roughness: 0.92, metalness: 0 });
    const wainscot = new THREE.MeshPhysicalMaterial({ color: '#3a2418', roughness: 0.5, clearcoat: 0.35, map: woodTexture('bar', { repeat: [4, 1] }) });
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex || carpetTex, color: floorTex ? '#ffffff' : '#8a7f7a', roughness: floorMat_rough(detail), metalness: 0.02, envMapIntensity: 0.4,
    });
    function floorMat_rough(d) { return d >= 3 ? 0.28 : d >= 2 ? 0.42 : 0.7; }

    const HW_ROOM = 11, HL_ROOM = 16, H = 3.4;
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HL_ROOM * 2, HW_ROOM * 2), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y;
    floor.receiveShadow = !!this.Q.shadows;
    g.add(floor);
    // a carpet under our table
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.4), new THREE.MeshStandardMaterial({ map: carpetTex, color: '#8d6f6a', roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = FLOOR_Y + 0.004; rug.receiveShadow = true;
    g.add(rug);

    // walls + wainscoting
    const mkWall = (w, x, z, ry) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
      wall.position.set(x, FLOOR_Y + H / 2, z); wall.rotation.y = ry;
      wall.receiveShadow = true;
      g.add(wall);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, 0.05), wainscot);
      panel.position.set(x, FLOOR_Y + 0.55, z); panel.rotation.y = ry;
      panel.translateZ(0.026);
      panel.castShadow = false; panel.receiveShadow = true;
      g.add(panel);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.09), wainscot);
      rail.position.set(x, FLOOR_Y + 1.10, z); rail.rotation.y = ry;
      rail.translateZ(0.045);
      g.add(rail);
    };
    mkWall(HL_ROOM * 2, 0, -HW_ROOM, 0);
    mkWall(HL_ROOM * 2, 0, HW_ROOM, Math.PI);
    mkWall(HW_ROOM * 2, -HL_ROOM, 0, Math.PI / 2);
    mkWall(HW_ROOM * 2, HL_ROOM, 0, -Math.PI / 2);

    // ceiling + beams
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HL_ROOM * 2, HW_ROOM * 2), new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = FLOOR_Y + H; g.add(ceil);
    if (detail >= 2) {
      const beamMat = new THREE.MeshStandardMaterial({ color: '#2c1d14', roughness: 0.8 });
      for (let i = -3; i <= 3; i++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, HW_ROOM * 2), beamMat);
        beam.position.set(i * 4.2, FLOOR_Y + H - 0.13, 0);
        g.add(beam);
      }
    }

    // ── other tables (props) — real geometry, no physics, culled when far
    const propTables = detail >= 2 ? 5 : detail === 1 ? 2 : 0;
    const propCloth = new THREE.MeshStandardMaterial({ color: '#1d6b45', roughness: 0.95 });
    const propWood = new THREE.MeshStandardMaterial({ map: woodTexture('bar', { repeat: [2, 1] }), roughness: 0.45 });
    const places = [[-7.5, -4.5, 0.2], [7.5, -4.5, -0.15], [-7.5, 4.5, 0.1], [7.5, 4.5, -0.05], [0, -8.5, Math.PI / 2]];
    for (let i = 0; i < propTables; i++) {
      const [px, pz, ry] = places[i % places.length];
      const t = new THREE.Group();
      t.position.set(px, 0, pz); t.rotation.y = ry;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 0.34, 0.13, TABLE.W + 0.34), propWood);
      bed.position.y = FLOOR_Y + TABLE.legH + 0.06; bed.castShadow = !!this.Q.shadows; bed.receiveShadow = true;
      t.add(bed);
      const clothTop = new THREE.Mesh(new THREE.BoxGeometry(TABLE.L + 0.02, 0.012, TABLE.W + 0.02), propCloth);
      clothTop.position.y = bed.position.y + 0.07; clothTop.receiveShadow = true;
      t.add(clothTop);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, TABLE.legH, 8), propWood);
        leg.position.set(sx * (HL + 0.06), FLOOR_Y + TABLE.legH / 2, sz * (HW + 0.05));
        leg.castShadow = !!this.Q.shadows;
        t.add(leg);
      }
      if (detail >= 3) {
        // a racked set of balls on the far tables
        for (let k = 0; k < 6; k++) {
          const bm = new THREE.Mesh(new THREE.SphereGeometry(R, 10, 8), new THREE.MeshPhysicalMaterial({ color: BALL_COLORS[1 + k * 2], roughness: 0.2, clearcoat: 1 }));
          bm.position.set(-0.3 + (k % 3) * 0.06, bed.position.y + 0.08 + R, 0.1 + Math.floor(k / 3) * 0.06);
          t.add(bm);
        }
      }
      t.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = false; });
      t.updateMatrixWorld(true);
      g.add(t);
    }

    // ── bar, stools, plants, neon, wall art
    if (detail >= 1) {
      const barMat = new THREE.MeshPhysicalMaterial({ color: '#2e1c12', roughness: 0.35, clearcoat: 0.6, map: woodTexture('vintage', { repeat: [3, 1] }) });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.12, 0.7), barMat);
      bar.position.set(-11.6, FLOOR_Y + 0.56, -6.4); bar.rotation.y = Math.PI / 2;
      bar.castShadow = !!this.Q.shadows; bar.receiveShadow = true;
      g.add(bar);
      const barTop = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.06, 0.86), new THREE.MeshPhysicalMaterial({ color: '#1b1b1e', roughness: 0.12, metalness: 0.1, clearcoat: 1 }));
      barTop.position.set(-11.6, FLOOR_Y + 1.15, -6.4); barTop.rotation.y = Math.PI / 2;
      g.add(barTop);
      for (let i = 0; i < 5; i++) {
        const stool = new THREE.Group();
        stool.position.set(-10.6, 0, -8.6 + i * 1.15);
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.06, 14), new THREE.MeshStandardMaterial({ color: '#7a2b2b', roughness: 0.8 }));
        seat.position.y = FLOOR_Y + 0.74; seat.castShadow = true; stool.add(seat);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.72, 10), new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.3, metalness: 0.9 }));
        post.position.y = FLOOR_Y + 0.37; stool.add(post);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 14), post.material);
        base.position.y = FLOOR_Y + 0.015; stool.add(base);
        g.add(stool);
      }
      // neon sign
      const neonMat = new THREE.MeshBasicMaterial({ color: '#39d7ff' });
      const neon = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 40), neonMat);
      neon.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 8, 32), new THREE.MeshBasicMaterial({ color: '#ff5fa2' }));
      ring2.rotation.x = 0.4; neon.add(ring2);
      neon.position.set(0, FLOOR_Y + 2.4, -HW_ROOM + 0.12);
      g.add(neon);
      this.neon = neon;
      const neonLight = new THREE.PointLight('#39d7ff', 6, 9, 2);
      neonLight.position.copy(neon.position); neonLight.position.z += 0.4;
      g.add(neonLight);
      // wall art frames
      for (let i = 0; i < 6; i++) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.4, metalness: 0.7 }));
        const art = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.66), new THREE.MeshStandardMaterial({ color: ['#1c5f86', '#7d2230', '#1d6b45', '#3a3f45', '#5b2a8c', '#f07c14'][i], roughness: 0.9 }));
        art.position.z = 0.03;
        frame.add(art);
        frame.position.set(-8 + i * 3.2, FLOOR_Y + 1.95, -HW_ROOM + 0.06);
        g.add(frame);
      }
      // plants
      if (detail >= 2) {
        for (const [px, pz] of [[-13, 8], [13, 8], [-13, -9], [13, -9], [5, 9.5], [-5, 9.5]]) {
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.20, 0.42, 12), new THREE.MeshStandardMaterial({ color: '#5a3a2a', roughness: 0.9 }));
          pot.position.set(px, FLOOR_Y + 0.21, pz); pot.castShadow = true; g.add(pot);
          for (let k = 0; k < 9; k++) {
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.85 + Math.random() * 0.5, 5), new THREE.MeshStandardMaterial({ color: '#2f6b34', roughness: 0.85 }));
            leaf.position.set(px + (Math.random() - 0.5) * 0.2, FLOOR_Y + 0.75, pz + (Math.random() - 0.5) * 0.2);
            leaf.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
            g.add(leaf);
          }
        }
      }
    }
    g.traverse((o) => { if (o.isMesh && !o.userData.dynamic) o.matrixAutoUpdate = false; });
    g.updateMatrixWorld(true);
    return this;
  }

  setShowHall(on) {
    this.groups.hall.visible = !!on;
    this.scene.fog.far = on ? 34 : 16;
    this.scene.background = new THREE.Color(on ? '#08131a' : '#05080b');
  }

  // ── cue stick ─────────────────────────────────────────────────────────────
  buildCue(cueDef = {}) {
    if (this.cueStick) { this.groups.props.remove(this.cueStick); }
    const g = new THREE.Group();
    const L = 1.47;
    const shaftMat = new THREE.MeshPhysicalMaterial({ color: cueDef.shaft || '#e8d3a8', roughness: 0.24, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 1.0 });
    const buttMat = new THREE.MeshPhysicalMaterial({ color: cueDef.butt || '#6b4a2a', roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.14, envMapIntensity: 1.0 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: cueDef.wrap || '#2b2b33', roughness: 0.85, metalness: 0.05 });
    const ferruleMat = new THREE.MeshPhysicalMaterial({ color: '#f2f0e8', roughness: 0.18, clearcoat: 1 });
    const tipMat = new THREE.MeshStandardMaterial({ color: '#2f6ea3', roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#d7dbe0', roughness: 0.16, metalness: 1, envMapIntensity: 1.3 });

    // built along +X with the tip at x = 0
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0066, L * 0.56, 12), shaftMat);
    shaft.rotation.z = Math.PI / 2; shaft.position.x = L * 0.28; g.add(shaft);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0060, 0.0060, 0.020, 12), ferruleMat);
    ferrule.rotation.z = Math.PI / 2; ferrule.position.x = 0.010; g.add(ferrule);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tipMat);
    tip.rotation.z = -Math.PI / 2; tip.position.x = 0.020 - 0.0062; g.add(tip);
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.0088, 0.0088, 0.05, 12), chrome);
    joint.rotation.z = Math.PI / 2; joint.position.x = L * 0.56; g.add(joint);
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0088, 0.0132, L * 0.40, 14), buttMat);
    butt.rotation.z = Math.PI / 2; butt.position.x = L * 0.56 + 0.025 + L * 0.20; g.add(butt);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0104, L * 0.17, 14), wrapMat);
    wrap.rotation.z = Math.PI / 2; wrap.position.x = L * 0.62; g.add(wrap);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0106, 0.0016, 6, 16), chrome);
    collar.rotation.y = Math.PI / 2; collar.position.x = L * 0.71; g.add(collar);
    const collar2 = collar.clone(); collar2.position.x = L * 0.53; g.add(collar2);
    const bumper = new THREE.Mesh(new THREE.CylinderGeometry(0.0132, 0.0125, 0.022, 14), wrapMat);
    bumper.rotation.z = Math.PI / 2; bumper.position.x = L * 0.56 + 0.025 + L * 0.40 + 0.008; g.add(bumper);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = !!this.Q.shadows; o.receiveShadow = false; } });
    g.visible = false;
    this.groups.props.add(g);
    this.cueStick = g;
    this.cueLength = L;
    return g;
  }

  /**
   * Place the cue stick for a shot.
   * @param {object} o {x,z} cue ball position, {dirX,dirZ} aim, pull metres,
   *                 strike.offset (0..1 of R) and the world contact point.
   */
  setCue(o) {
    const g = this.cueStick;
    if (!g) return;
    if (!o || o.visible === false) { g.visible = false; return; }
    g.visible = true;
    const ang = Math.atan2(o.dirZ, o.dirX);
    // the stick lies behind the ball, along −dir, tipped by the vertical offset
    const back = R + 0.004 + (o.pull || 0);
    g.position.set(o.x - Math.cos(ang) * back, BED_Y + R + (o.tipY || 0), o.z - Math.sin(ang) * back);
    g.rotation.set(0, 0, 0);
    g.rotation.y = -ang;
    // slight butt-down tilt, more when the player is hitting low on the ball
    g.rotation.z = 0;
    const tilt = clamp(0.055 + (o.tilt || 0), -0.28, 0.42);
    g.rotateY(Math.PI);                 // tip now points at the ball
    g.rotateZ(tilt);
    if (o.roll) g.rotation.y += o.roll;
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.bloom) this.bloom.setSize(w, h);
    this.width = w; this.height = h;
  }

  setQuality(name, opts = {}) {
    const prev = this.quality;
    this.quality = QUALITY[name] ? name : 'high';
    this.Q = QUALITY[this.quality];
    this.auto = opts.auto || false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.Q.dpr));
    this.renderer.shadowMap.enabled = !!this.Q.shadows;
    if (this.bloom && !this.Q.bloom) { this.bloom.enabled = false; }
    if (!this.bloom && this.Q.bloom) { try { this.bloom = new BloomFX(this.renderer); this.bloom.strength = 0.42; this.bloom.threshold = 0.86; this.bloom.setSize(this.width, this.height); } catch (e) {} }
    if (this.bloom) this.bloom.enabled = !!this.Q.bloom && this.settings.bloom !== false;
    this.resize();
    if (this.tableReady) {
      // rebuild shadow-casting detail at the new tier
      const cloth = this.settings.clothColor, finish = this.settings.tableFinish;
      this.buildTable({ cloth, finish });
      this.buildHall(this.Q.hallDetail);
      if (this.cueDef) this.buildCue(this.cueDef);
    }
    this.scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    return prev !== this.quality;
  }

  /** watch the frame rate and step the tier down when the device cannot cope */
  tickQuality(dt) {
    if (!this.auto || this._downgrades >= 2) return false;
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc < 2.5) return false;
    this.fps = this._fpsN / this._fpsAcc;
    this._fpsAcc = 0; this._fpsN = 0;
    if (this.fps < 34) {
      const i = QUALITY_ORDER.indexOf(this.quality);
      if (i > 0) { this._downgrades++; this.setQuality(QUALITY_ORDER[i - 1], { auto: true }); return true; }
    }
    return false;
  }

  render(dt) {
    this.cam.update(dt || 0.016);
    this.guides.update(dt || 0.016);
    if (this.bloom && this.bloom.enabled) this.bloom.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  /** project a world point to CSS pixels */
  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, behind: v.z > 1 };
  }

  /** where does a screen point land on the cloth? (null if it misses the bed) */
  pickCloth(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BED_Y);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    if (Math.abs(hit.x) > HL + 0.25 || Math.abs(hit.z) > HW + 0.25) return null;
    return { x: hit.x, z: hit.z, y: hit.y };
  }

  dispose() {
    if (this.bloom) this.bloom.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; for (const x of m) { if (x.map) x.map.dispose(); x.dispose(); } }
    });
    this.renderer.dispose();
  }
}

// ── aiming guides ───────────────────────────────────────────────────────────
class Guides {
  constructor(scene3d) {
    this.s = scene3d;
    this.g = scene3d.groups.guides;
    this.level = scene3d.guideLevel;
    const line = (color, opacity = 0.85, w = 2) => {
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: true });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 2), 3));
      const l = new THREE.Line(geo, m);
      l.frustumCulled = false; l.visible = false;
      this.g.add(l);
      return l;
    };
    this.aimLine = line('#ffffff', 0.72);
    // long polylines: the real simulated cue-ball path and the object ball's
    const poly = (color, opacity, n) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setDrawRange(0, 0);
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      l.frustumCulled = false; l.visible = false;
      this.g.add(l);
      return l;
    };
    this.simPath = poly('#69d2ff', 0.75, 260);
    this.simObj = poly('#ffd45e', 0.62, 120);
    this.objLine = line('#ffd45e', 0.9);
    this.cueLine = line('#69d2ff', 0.8);
    this.railLine = line('#ff8bd0', 0.6);
    this.railLine2 = line('#ff8bd0', 0.42);

    // the ghost ball
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.995, 18, 14),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false })
    );
    this.ghostWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(R * 1.001, 12, 8)),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
    );
    this.ghost.visible = this.ghostWire.visible = false;
    this.g.add(this.ghost); this.g.add(this.ghostWire);

    // pocket highlight ring
    this.pocketRing = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.062, 26),
      new THREE.MeshBasicMaterial({ color: '#7CFFB2', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide })
    );
    this.pocketRing.rotation.x = -Math.PI / 2;
    this.pocketRing.visible = false;
    this.g.add(this.pocketRing);

    // target dot on the object ball
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), new THREE.MeshBasicMaterial({ color: '#ffd45e', transparent: true, opacity: 0.9, depthWrite: false }));
    this.dot.rotation.x = -Math.PI / 2; this.dot.visible = false;
    this.g.add(this.dot);
    this.data = null;
  }

  setLevel(l) { this.level = clamp(l | 0, 0, 3); }

  /** data comes from physics.predictShot plus the game's spin/power state */
  setData(d) { this.data = d; }

  /**
   * The pro-assist path is not a geometric guess: it is the cue ball's real
   * trajectory from a probe run of the physics engine with the current aim,
   * power and english.
   */
  setSimPaths(cuePath, objPath) {
    this._setPoly(this.simPath, cuePath, BED_Y + 0.0055);
    this._setPoly(this.simObj, objPath, BED_Y + 0.0045);
  }
  _setPoly(line, pts, y) {
    if (!pts || pts.length < 2 || this.level < 3) { line.visible = false; line.geometry.setDrawRange(0, 0); return; }
    const a = line.geometry.attributes.position;
    const n = Math.min(pts.length, a.count);
    for (let i = 0; i < n; i++) a.setXYZ(i, pts[i][0], y, pts[i][1]);
    a.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
    line.visible = true;
  }
  clearSimPaths() { this.simPath.visible = false; this.simObj.visible = false; }

  clear() {
    this.data = null;
    for (const l of [this.aimLine, this.objLine, this.cueLine, this.railLine, this.railLine2]) l.visible = false;
    this.clearSimPaths();
    this.ghost.visible = this.ghostWire.visible = this.pocketRing.visible = this.dot.visible = false;
  }

  _seg(line, x1, z1, x2, z2, y = BED_Y + 0.0035) {
    const a = line.geometry.attributes.position;
    a.setXYZ(0, x1, y, z1); a.setXYZ(1, x2, y, z2);
    a.needsUpdate = true;
    line.geometry.setDrawRange(0, 2);
    line.visible = true;
  }

  update(dt) {
    const d = this.data;
    if (!d || this.level <= 0) { this.clear(); return; }
    const y = BED_Y + 0.0035;
    // 1 — the stick line, always
    const end = d.cueEnd || d.hit;
    this._seg(this.aimLine, d.x0, d.z0, end.x, end.z, y);
    if (this.level < 1) { this.ghost.visible = this.ghostWire.visible = this.objLine.visible = false; return; }

    if (d.kind === 'ball') {
      this.ghost.position.set(d.hit.x, BED_Y + R, d.hit.z);
      this.ghostWire.position.copy(this.ghost.position);
      this.ghost.visible = this.ghostWire.visible = this.level >= 1;
      this.ghost.material.opacity = 0.10 + 0.08 * this.level;
      // object ball path
      if (d.objDir) {
        const len = d.objLen === undefined ? 0.9 : d.objLen;
        this._seg(this.objLine, d.target.x, d.target.z, d.target.x + d.objDir.x * len, d.target.z + d.objDir.z * len, y + 0.0006);
        this.objLine.visible = this.level >= 1;
      } else this.objLine.visible = false;
      // where the cue ball goes after contact (stun tangent + draw/follow bend)
      if (d.cueAfter && this.level >= 2) {
        this._seg(this.cueLine, d.hit.x, d.hit.z, d.cueAfter.x, d.cueAfter.z, y + 0.0012);
        this.cueLine.visible = true;
      } else this.cueLine.visible = false;
      // the contact point on the object ball
      if (d.contact && this.level >= 2) {
        this.dot.position.set(d.contact.x, BED_Y + 0.0045, d.contact.z);
        this.dot.visible = true;
      } else this.dot.visible = false;
      if (d.pocket !== undefined && d.pocket >= 0 && this.level >= 2) {
        const p = POCKETS[d.pocket];
        this.pocketRing.position.set(p.x, BED_Y + 0.005, p.z);
        this.pocketRing.visible = true;
        this.pocketRing.material.opacity = 0.5 + 0.2 * Math.sin(performance.now() * 0.006);
      } else this.pocketRing.visible = false;
    } else {
      this.ghost.visible = this.ghostWire.visible = false;
      this.objLine.visible = false; this.dot.visible = false; this.pocketRing.visible = false;
      if (d.kind === 'cushion') {
        if (this.level >= 2 && d.bounce) {
          this._seg(this.railLine, d.hit.x, d.hit.z, d.bounce.x, d.bounce.z, y + 0.001);
          if (this.level >= 3 && d.bounce2) this._seg(this.railLine2, d.bounce.x, d.bounce.z, d.bounce2.x, d.bounce2.z, y + 0.0015);
          else this.railLine2.visible = false;
        } else { this.railLine.visible = false; this.railLine2.visible = false; }
      } else if (d.kind === 'pocket') {
        this.pocketRing.position.set(d.hit.x, BED_Y + 0.005, d.hit.z);
        this.pocketRing.visible = this.level >= 2;
        this.pocketRing.material.color.set('#ff9d6e');
      }
      this.cueLine.visible = false;
    }
    if (d.kind !== 'pocket' && this.pocketRing.visible) this.pocketRing.material.color.set('#7CFFB2');
  }
}

// ── camera rig ──────────────────────────────────────────────────────────────
const CAM_MODES = ['aim', 'top', 'close', 'action', 'free'];
class CameraRig {
  constructor(scene3d) {
    this.s = scene3d;
    this.mode = 'aim';
    this.prevMode = 'aim';
    this.t = 1;
    this.from = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
    this.to = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
    this.cur = { pos: new THREE.Vector3(0, 1.5, 2.4), tgt: new THREE.Vector3() };
    this.orbit = { yaw: 0, pitch: 0.62, dist: 2.5 };
    this.shake = 0;
    this.fovBase = 46;
    this.freeDragging = false;
  }

  setMode(m, instant = false) {
    if (!CAM_MODES.includes(m)) return;
    this.prevMode = this.mode;
    this.mode = m;
    this.t = instant ? 1 : 0;
    this.from.pos.copy(this.cur.pos);
    this.from.tgt.copy(this.cur.tgt);
  }
  cycle() { const i = CAM_MODES.indexOf(this.mode); this.setMode(CAM_MODES[(i + 1) % CAM_MODES.length]); return this.mode; }

  /** aim camera: behind the cue ball, along the shot line */
  aimTarget(cue, dirX, dirZ, pull) {
    const back = 0.62 + pull * 0.5;
    const h = 0.30 + pull * 0.10;
    return {
      pos: { x: cue.x - dirX * back, y: BED_Y + h, z: cue.z - dirZ * back },
      tgt: { x: cue.x + dirX * 1.45, y: BED_Y + R * 0.55, z: cue.z + dirZ * 1.45 },
      fov: 44,
    };
  }

  topTarget() {
    return { pos: { x: 0, y: 3.05, z: 0.001 }, tgt: { x: 0, y: 0, z: 0 }, fov: 40 };
  }
  closeTarget(cue, dirX, dirZ) {
    return {
      pos: { x: cue.x - dirX * 0.20, y: BED_Y + 0.115, z: cue.z - dirZ * 0.20 },
      tgt: { x: cue.x + dirX * 1.1, y: BED_Y + R * 0.4, z: cue.z + dirZ * 1.1 },
      fov: 52,
    };
  }
  /** follow the fastest ball */
  actionTarget(balls) {
    let best = null, bv = 0;
    for (const b of balls) {
      if (!b || b.state !== 'table') continue;
      const v = Math.hypot(b.vx, b.vz);
      if (v > bv) { bv = v; best = b; }
    }
    if (!best) return this.topTarget();
    const ahead = 0.42 + bv * 0.16;
    const vx = bv > 0.02 ? best.vx / bv : 0, vz = bv > 0.02 ? best.vz / bv : 0;
    return {
      pos: { x: best.x - vx * ahead, y: BED_Y + 0.55 + bv * 0.06, z: best.z - vz * ahead },
      tgt: { x: best.x + vx * ahead * 1.4, y: BED_Y + R, z: best.z + vz * ahead * 1.4 },
      fov: clamp(48 + bv * 1.5, 44, 62),
    };
  }
  freeTarget() {
    const o = this.orbit;
    return {
      pos: { x: Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, y: BED_Y + 0.35 + Math.sin(o.pitch) * o.dist, z: Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist },
      tgt: { x: 0, y: BED_Y, z: 0 }, fov: 46,
    };
  }
  /** walking the hall: third person behind the avatar */
  hallTarget(px, py, pz, yaw, pitch) {
    const d = 2.15;
    const cy = Math.cos(pitch), sy = Math.sin(pitch);
    return {
      pos: { x: px - Math.sin(yaw) * d * cy, y: py + 1.05 + sy * d, z: pz - Math.cos(yaw) * d * cy },
      tgt: { x: px + Math.sin(yaw) * 1.6, y: py + 0.85, z: pz + Math.cos(yaw) * 1.6 },
      fov: 62,
    };
  }

  setGoal(goal, snap) {
    this.to.pos.set(goal.pos.x, goal.pos.y, goal.pos.z);
    this.to.tgt.set(goal.tgt.x, goal.tgt.y, goal.tgt.z);
    this.toFov = goal.fov || this.fovBase;
    if (snap) { this.t = 1; this.cur.pos.copy(this.to.pos); this.cur.tgt.copy(this.to.tgt); }
    else if (this.t >= 1) { this.t = 0; this.from.pos.copy(this.cur.pos); this.from.tgt.copy(this.cur.tgt); }
  }

  update(dt) {
    const k = 1 - Math.pow(0.0016, dt);       // critically-damped-ish follow
    this.cur.pos.lerp(this.to.pos, k);
    this.cur.tgt.lerp(this.to.tgt, k);
    const cam = this.s.camera;
    cam.position.copy(this.cur.pos);
    if (this.shake > 0.0005) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const a = this.shake * 0.012;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
    }
    cam.lookAt(this.cur.tgt);
    const fov = this.toFov || this.fovBase;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = lerp(cam.fov, fov, k * 0.8); cam.updateProjectionMatrix(); }
  }

  kick(amount = 1) { this.shake = Math.min(1.6, this.shake + amount); }
}

export { CAM_MODES, Guides, CameraRig, feltTexture, woodTexture, carpetTexture, floorTexture };
export default Scene3D;
