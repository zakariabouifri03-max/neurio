// ═══════════════════════════════════════════════════════════════════════════
//  MINECRAFT VOXEL SHOWCASE — application shell.
//  Renderer, camera rigs (orbit / first-person / cinematic), day-night cycle,
//  post-processing, UI wiring, PNG screenshot and GLB model export.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BloomFX } from '../post.js';
import { clamp, lerp, mulberry32 } from '../util.js';

import { buildAtlas, PALETTE } from './textures.js';
import { generateTerrain, SEA, SIZE } from './terrain.js';
import { populate } from './structures.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { Decor } from './decor.js';
import { Character } from './character.js';
import { Mobs } from './mobs.js';
import { AmbientAudio } from './audio.js';
import { raycast } from './voxels.js';
import { B } from './textures.js';

const $ = (id) => document.getElementById(id);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3();
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

const QUALITY = {
  low: { dpr: 1, shadow: 1024, grass: 1800, flowers: 300, fireflies: 70, bloom: false, env: false },
  medium: { dpr: 1.5, shadow: 2048, grass: 3600, flowers: 600, fireflies: 130, bloom: true, env: true },
  high: { dpr: 2, shadow: 3072, grass: 5600, flowers: 950, fireflies: 200, bloom: true, env: true },
  ultra: { dpr: 2.5, shadow: 4096, grass: 8000, flowers: 1400, fireflies: 260, bloom: true, env: true },
};

export class MinecraftViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.seed = opts.seed ?? 20261011;
    this.qualityName = opts.quality || (navigator.hardwareConcurrency >= 8 ? 'high' : 'medium');
    this.q = QUALITY[this.qualityName] || QUALITY.high;
    this.onProgress = opts.onProgress || (() => {});
    this.onReady = opts.onReady || (() => {});
    this.mode = 'orbit';
    this.clock = new THREE.Clock();
    this.time = 0;
    this.fps = 60;
    this.paused = false;
    this.wireframe = false;
    this.audio = new AmbientAudio();
    this.shots = [];
    this._shot = 0; this._shotT = 0;
    this._stepPhase = 0;
    this._exported = null;
  }

  // ── renderer / scene ─────────────────────────────────────────────────────
  initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: true, stencil: false,
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.06;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.08, 4000);
    this.camera.position.set(60, 42, 60);

    this.bloom = new BloomFX(r);
    this.bloom.enabled = this.q.bloom;
    this.bloom.strength = 0.62;
    this.bloom.threshold = 0.78;
    this.bloom.setSize(window.innerWidth, window.innerHeight);
    this.applyToneMapping();
    return r;
  }

  applyToneMapping() {
    // BloomFX composites its own filmic curve + gamma, so the renderer must not
    // tone-map twice when the post chain is live.
    const on = this.bloom && this.bloom.enabled;
    this.renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.scene.traverse((o) => { if (o.isMesh && o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => { x.needsUpdate = true; }); } });
  }

  // ── world ────────────────────────────────────────────────────────────────
  async buildWorld() {
    this.onProgress(0.04, 'Painting 64 block textures…');
    await frame();
    const atlas = buildAtlas(this.seed, this.renderer);
    this.atlas = atlas;
    this.materials = atlas.materials;

    this.onProgress(0.14, 'Raising the island…');
    await frame();
    const T = generateTerrain(this.seed);
    this.T = T;

    this.onProgress(0.34, 'Building the village…');
    await frame();
    this.E = { torches: [], lights: [], campfires: [], beacons: [], spawn: {} };
    const deco = populate(T, this.E);
    this.decoCounts = deco;
    this._supportTorches();

    this.onProgress(0.46, 'Meshing chunks…');
    T.world.setMaterials(this.materials);
    await frame();
    T.world.buildAll((p) => this.onProgress(0.46 + p * 0.34, 'Meshing chunks…'));
    this.scene.add(T.world.group);
    this.world = T.world;

    this.onProgress(0.82, 'Lighting the sky…');
    await frame();
    this.sky = new Sky(this.scene, this.renderer, { hour: 9.4, shadowSize: this.q.shadow });
    this.ocean = new Ocean(this.scene, { sea: SEA, radius: 520 });

    this.onProgress(0.88, 'Hanging torches…');
    await frame();
    this.decor = new Decor(this.scene, T, this.E, {
      grass: this.q.grass, flowers: this.q.flowers, fireflies: this.q.fireflies,
    });
    this._buildPointLights();

    this.onProgress(0.94, 'Waking the villagers…');
    await frame();
    this._buildCharacters();
    this.mobs = new Mobs(this.scene, T, {
      seed: this.seed ^ 0x51ed,
      home: this.E.spawn.farm ? { x: this.E.spawn.farm.x, z: this.E.spawn.farm.z } : { x: 0, z: 0 },
      radius: 30, fish: 9,
    });

    this.onProgress(1, 'Ready');
    this._buildShots();
    this.setMode('orbit');
    this.onReady(this);
    return this;
  }

  /** torches need something to stand on */
  _supportTorches() {
    for (const t of this.E.torches) {
      if (this.world0Get(t.x, t.y - 1, t.z) === B.AIR) this.T.world.raw(t.x, t.y - 1, t.z, B.LOG_OAK);
    }
  }
  world0Get(x, y, z) { return this.T.world.get(x, y, z); }

  _buildPointLights() {
    this.pointLights = [];
    const list = [...this.E.lights].sort((a, b) => (b.intensity || 0) - (a.intensity || 0)).slice(0, 7);
    for (const L of list) {
      const pl = new THREE.PointLight(L.color, L.intensity, L.dist, 2);
      pl.position.set(L.x, L.y, L.z);
      pl.castShadow = !!L.shadow;
      if (pl.castShadow) {
        pl.shadow.mapSize.set(1024, 1024);
        pl.shadow.bias = -0.004;
        pl.shadow.camera.near = 0.4;
        pl.shadow.camera.far = L.dist;
      }
      pl.userData = { base: L.intensity, flicker: L.flicker || 0, phase: Math.random() * 10, shadowOk: !!L.shadow };
      this.scene.add(pl);
      this.pointLights.push(pl);
    }
  }

  _buildCharacters() {
    const sp = this.E.spawn;
    const path = [];
    const push = (p, extra) => { if (p) path.push({ x: p.x, y: p.y, z: p.z, ...(extra || {}) }); };
    push(sp.house, { wait: 1.6 });
    push(sp.camp, { wait: 2.4 });
    push(sp.farm, { wait: 2.0 });
    if (sp.mine) push(sp.mine, { wait: 1.2, run: true });
    push(sp.beach, { wait: 2.2 });
    if (sp.dock) push(sp.dock, { wait: 2.6 });
    if (sp.tower) push(sp.tower, { wait: 3.0, run: true });
    if (path.length < 3) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        path.push({ x: Math.cos(a) * 22, y: SEA + 4, z: Math.sin(a) * 22, wait: 0.4 });
      }
    }
    const start = sp.house || path[0];
    this.player = new Character(this.scene, this.T, {
      preset: 'steve', seed: 7, x: start.x, y: start.y, z: start.z, path, speed: 2.1, runSpeed: 4.6,
    });
    this.npc = new Character(this.scene, this.T, {
      preset: 'alex', seed: 21, x: (sp.tower || start).x, y: (sp.tower || start).y, z: (sp.tower || start).z,
      path: [...path].reverse(), speed: 1.8, runSpeed: 4.2,
    });
    this.chars = [this.player, this.npc];
  }

  // ── cinematic shots ──────────────────────────────────────────────────────
  _buildShots() {
    const sp = this.E.spawn, L = this.E.layout;
    const H = (p, dy = 0) => Math.max(this.T.surface(p.x, p.z) + dy, SEA + 1);
    this.shots = [
      { pos: [74, 52, 78], tgt: [0, SEA + 6, 0], orbit: 0.045, label: 'Establishing' },
      L.house ? {
        pos: [L.house.doorX + 11, H({ x: L.house.doorX + 11, z: L.house.z1 + 9 }) + 2.6, L.house.z1 + 9],
        tgt: [L.house.doorX, L.house.y + 3, L.house.cz], label: 'The house',
      } : null,
      L.tower ? { pos: [L.tower.cx + 16, L.tower.dy + 7, L.tower.cz + 15], tgt: [0, SEA + 4, 0], label: 'From the tower' } : null,
      { pos: [44, SEA + 1.5, 52], tgt: [-6, SEA + 5, -4], label: 'Over the water' },
      sp.camp ? { pos: [sp.camp.x + 5.5, H(sp.camp) + 1.7, sp.camp.z + 4.5], tgt: [this.E.campfires[0] ? this.E.campfires[0].x : sp.camp.x, H(sp.camp) + 0.8, this.E.campfires[0] ? this.E.campfires[0].z : sp.camp.z], label: 'Campfire' } : null,
      { pos: [0, 96, 4], tgt: [0, SEA, 0], spin: 0.09, label: 'Sky high' },
      { follow: true, dist: 4.4, high: 2.2, label: 'Follow Steve' },
    ].filter(Boolean);
  }

  // ── camera modes ─────────────────────────────────────────────────────────
  setMode(m) {
    this.mode = m;
    document.body.dataset.mode = m;
    if (m === 'fp') {
      const p = this.camera.position;
      this.fp = {
        x: p.x, z: p.z, y: Math.max(this.T.surface(p.x, p.z), SEA + 1) + 1.62,
        yaw: this.orb ? this.orb.yaw : 0.6, pitch: -0.12, vel: 0, keys: {},
      };
      this.canvas.requestPointerLock?.();
    } else if (document.pointerLockElement) document.exitPointerLock();
    if (m === 'cine') { this._shot = 0; this._shotT = 0; }
    if (m === 'orbit' && !this.orb) this.resetOrbit();
    if (this.ui) this.ui.syncMode(m);
  }

  resetOrbit() {
    const c = this.E && this.E.layout && this.E.layout.house;
    this.orb = {
      target: new THREE.Vector3(c ? c.doorX : 0, (c ? c.y : SEA) + 4, c ? c.cz : 0),
      dist: 52, yaw: 0.72, pitch: 0.42, tDist: 52, tYaw: 0.72, tPitch: 0.42,
    };
  }

  focusOn(p, dist = 22) {
    if (!this.orb) this.resetOrbit();
    this.orb.target.set(p.x, p.y, p.z);
    this.orb.tDist = dist;
  }

  // ── input ────────────────────────────────────────────────────────────────
  bindInput() {
    const cv = this.canvas;
    let drag = null, last = { x: 0, y: 0 }, pinch = 0, panMode = false;

    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (document.pointerLockElement === cv) return;
      cv.setPointerCapture?.(e.pointerId);
      drag = e.pointerId; last = { x: e.clientX, y: e.clientY };
      panMode = e.button === 2 || e.button === 1 || e.shiftKey;
      this.audio.init();
      this.audio.setMuted(!this.audio.enabled);
    });
    cv.addEventListener('pointermove', (e) => {
      const dx0 = e.clientX - last.x, dy0 = e.clientY - last.y;
      if (this.mode === 'fp') {
        if (document.pointerLockElement === cv) {
          this.fp.yaw -= e.movementX * 0.0022;
          this.fp.pitch = clamp(this.fp.pitch - e.movementY * 0.0022, -1.45, 1.45);
          return;
        }
        if (drag === e.pointerId && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
          this.fp.yaw -= dx0 * 0.0042;
          this.fp.pitch = clamp(this.fp.pitch - dy0 * 0.0042, -1.45, 1.45);
          last = { x: e.clientX, y: e.clientY };
          return;
        }
      }
      if (drag !== e.pointerId || !this.orb) return;
      const dx = dx0, dy = dy0;
      last = { x: e.clientX, y: e.clientY };
      if (panMode) this.pan(dx, dy);
      else { this.orb.tYaw -= dx * 0.0055; this.orb.tPitch = clamp(this.orb.tPitch + dy * 0.0045, -0.42, 1.42); }
    });
    const endDrag = (e) => { if (drag === e.pointerId) drag = null; };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.orb) return;
      this.orb.tDist = clamp(this.orb.tDist * (1 + Math.sign(e.deltaY) * 0.11), 3.5, 340);
    }, { passive: false });

    // touch: pinch zoom + two-finger pan
    const touches = new Map();
    cv.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY }); }, { passive: true });
    cv.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        const p = touches.get(t.identifier); if (!p) continue;
        p.x = t.clientX; p.y = t.clientY;
      }
      if (touches.size === 2 && this.orb) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.orb.tDist = clamp(this.orb.tDist * (pinch / d), 3.5, 340);
        pinch = d;
        e.preventDefault();
      }
    }, { passive: false });
    cv.addEventListener('touchend', (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); if (touches.size < 2) pinch = 0; }, { passive: true });

    // keyboard
    this.keys = {};
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'f') this.setMode(this.mode === 'fp' ? 'orbit' : 'fp');
      else if (k === 'c') this.setMode(this.mode === 'cine' ? 'orbit' : 'cine');
      else if (k === 't') this.ui && this.ui.click('timePlay');
      else if (k === 'n') this.ui && this.ui.setTime(this.sky.hour > 12 ? 1.2 : 21.6);
      else if (k === 'g') this.ui && this.ui.click('grass');
      else if (k === 'm') this.ui && this.ui.click('mobs');
      else if (k === 'b') this.ui && this.ui.toggleBloom();
      else if (k === 'x') this.ui && this.ui.click('wire');
      else if (k === 'p' || k === 'F2') { e.preventDefault(); this.screenshot(); }
      else if (k === 'h') this.ui && this.ui.toggleHelp();
      else if (k === 'r') this.ui && this.ui.regenerate();
      else if (e.code === 'Space' && this.mode === 'fp') { e.preventDefault(); if (this.fp.onGround) { this.fp.vel = 6.4; this.fp.onGround = false; this.audio.step(); } }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'fp') this.setMode('orbit');
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  pan(dx, dy) {
    const o = this.orb;
    const s = o.dist * 0.0016;
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    RIGHT.set(cy, 0, -sy);
    o.target.addScaledVector(RIGHT, -dx * s);
    o.target.y = clamp(o.target.y + dy * s * 0.8, SEA - 6, 96);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    this.renderer.setSize(w, h, false);
    this.bloom.setSize(w, h);
    this.pxScale = h * this.renderer.getPixelRatio() * 0.55;
  }

  // ── camera update ────────────────────────────────────────────────────────
  updateCamera(dt) {
    const cam = this.camera;
    if (this.mode === 'orbit') {
      const o = this.orb;
      const k = Math.min(1, dt * 6.5);
      o.yaw = lerp(o.yaw, o.tYaw, k);
      o.pitch = lerp(o.pitch, o.tPitch, k);
      o.dist = lerp(o.dist, o.tDist, k);
      if (this.autoRotate && !this._dragging) o.tYaw += dt * 0.045;
      const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
      cam.position.set(
        o.target.x + Math.sin(o.yaw) * cp * o.dist,
        o.target.y + sp * o.dist,
        o.target.z + Math.cos(o.yaw) * cp * o.dist,
      );
      // never let the camera dip under the terrain
      const gy = this.T.surface(cam.position.x, cam.position.z);
      cam.position.y = Math.max(cam.position.y, Math.max(gy, SEA + 1) + 1.1);
      cam.lookAt(o.target);
    } else if (this.mode === 'fp') {
      const f = this.fp;
      const speed = (this.keys.ShiftLeft || this.keys.ShiftRight) ? 8.2 : 4.4;
      let mx = 0, mz = 0;
      if (this.keys.KeyW || this.keys.ArrowUp) mz += 1;
      if (this.keys.KeyS || this.keys.ArrowDown) mz -= 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) mx -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) mx += 1;
      const len = Math.hypot(mx, mz);
      if (len > 0) {
        mx /= len; mz /= len;
        const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
        f.x += (-mz * sy + mx * cy) * speed * dt;
        f.z += (-mz * cy - mx * sy) * speed * dt;
        this._stepPhase += dt * speed * 1.35;
        if (this._stepPhase > 2.1) { this._stepPhase = 0; this.audio.step(); }
      } else this._stepPhase = 0;
      // keep inside the island, above ground / in water
      const r = Math.hypot(f.x, f.z);
      if (r > SIZE + 8) { f.x *= (SIZE + 8) / r; f.z *= (SIZE + 8) / r; }
      const gy = this.T.surface(f.x, f.z);
      const inWater = gy <= SEA;
      const eye = inWater ? SEA + 0.72 : gy + 1.62;
      f.vel -= 22 * dt;
      f.y += f.vel * dt;
      if (f.y <= eye) { f.y = eye; f.vel = 0; f.onGround = true; } else f.onGround = false;
      // simple head-bob
      const bob = len > 0 ? Math.sin(this._stepPhase * 3.1) * 0.045 : 0;
      cam.position.set(f.x, f.y + bob, f.z);
      cam.rotateY(f.yaw);
      cam.rotateX(f.pitch);
      if (inWater) this.underwater = cam.position.y < SEA + 0.6;
      else this.underwater = false;
    } else if (this.mode === 'cine') {
      const shots = this.shots;
      if (!shots.length) return;
      this._shotT += dt;
      const DUR = 11;
      if (this._shotT > DUR) { this._shotT = 0; this._shot = (this._shot + 1) % shots.length; this.ui && this.ui.setShot(shots[this._shot].label); }
      const cur = shots[this._shot], nxt = shots[(this._shot + 1) % shots.length];
      const t = this._shotT / DUR;
      const ease = smoothstep(0.82, 1.0, t);
      const A = this._shotPos(cur, dt), Bp = this._shotPos(nxt, 0);
      cam.position.lerpVectors(A.pos, Bp.pos, ease);
      const tgt = new THREE.Vector3().lerpVectors(A.tgt, Bp.tgt, ease);
      cam.lookAt(tgt);
      this.orbTarget = tgt;
    }
  }

  _shotPos(shot, dt) {
    if (shot.follow && this.player) {
      shot.a = (shot.a || 0) + dt * 0.22;
      const p = this.player.obj.position;
      return {
        pos: new THREE.Vector3(p.x + Math.cos(shot.a) * shot.dist, p.y + shot.high, p.z + Math.sin(shot.a) * shot.dist),
        tgt: new THREE.Vector3(p.x, p.y + 1.1, p.z),
      };
    }
    const pos = new THREE.Vector3(...shot.pos), tgt = new THREE.Vector3(...shot.tgt);
    const rate = shot.orbit || shot.spin || 0;
    if (rate) {
      shot.a = (shot.a || 0) + dt * rate;
      pos.sub(tgt).applyAxisAngle(UP, shot.a).add(tgt);
    }
    return { pos, tgt };
  }

  // ── main loop ────────────────────────────────────────────────────────────
  start() {
    this.pxScale = window.innerHeight * this.renderer.getPixelRatio() * 0.55;
    this.resize();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.time += dt;
      this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.08);

      if (!this.paused) {
        this.sky.update(dt, this.camera.position);
        this.ocean.update(dt, this.sky, this.camera.position);
        this.decor.update(dt, { night: this.sky.night, pxScale: this.pxScale });
        for (const c of this.chars) c.update(dt, this.time, { paused: false });
        this.mobs.update(dt, this.time, { night: this.sky.night });
        this._updateLights(dt);
        this._updateCloudShadow();
      }
      this.updateCamera(dt);
      this._updateAudio(dt);

      if (this.bloom.enabled) this.bloom.render(this.scene, this.camera);
      else this.renderer.render(this.scene, this.camera);

      this.ui && this.ui.tick(this);
    };
    loop();
  }

  _updateLights(dt) {
    const night = this.sky.night;
    for (const pl of this.pointLights) {
      const u = pl.userData;
      const f = u.flicker ? (0.82 + 0.18 * Math.sin(this.time * 9.3 + u.phase) + 0.1 * Math.sin(this.time * 21 + u.phase * 2.3)) : 1;
      pl.intensity = u.base * (0.22 + night * 1.15) * f;
    }
  }

  _updateCloudShadow() { /* reserved for a projected cloud shadow texture */ }

  _updateAudio(dt) {
    if (!this.audio.ready) return;
    const p = this.camera.position;
    let df = 1e9;
    for (const c of this.E.campfires) df = Math.min(df, Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
    for (const t of this.E.torches) df = Math.min(df, Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) * 1.6);
    this.audio.update(dt, {
      night: this.sky.night,
      distToSea: Math.max(0, p.y - SEA) + Math.max(0, Math.hypot(p.x, p.z) - SIZE * 0.72),
      distToFire: df,
    });
  }

  // ── quality / toggles ────────────────────────────────────────────────────
  setQuality(name) {
    const q = QUALITY[name]; if (!q) return;
    this.qualityName = name; this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.resize();
    this.sky.setQuality(q.shadow);
    this.bloom.enabled = q.bloom && this.bloomWanted !== false;
    this.applyToneMapping();
    this.sky.refreshEnv();
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sky.sun.castShadow = on;
    for (const pl of this.pointLights) { pl.castShadow = on && pl.userData.shadowOk; if (pl.shadow.map) { pl.shadow.map.dispose(); pl.shadow.map = null; } }
    this.scene.traverse((o) => { if (o.isMesh && o.material) { const m = [].concat(o.material); m.forEach((x) => { x.needsUpdate = true; }); } });
  }

  setWireframe(on) {
    this.wireframe = on;
    for (const k of Object.keys(this.materials)) this.materials[k].wireframe = on;
  }

  setBloom(on) {
    this.bloomWanted = on;
    this.bloom.enabled = on && this.q.bloom;
    this.applyToneMapping();
  }

  setEnv(on) {
    if (on) { this.sky.pmremEnabled = true; this.sky.refreshEnv(); }
    else { this.scene.environment = null; this.sky.pmremEnabled = false; }
  }

  setFoliage(on) {
    if (this.decor.grass) this.decor.grass.visible = on;
    for (const f of this.decor.flowers) f.inst.visible = on;
  }

  // ── block picking (click to inspect / place) ─────────────────────────────
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return raycast(this.world, this.camera.position, dir, 160);
  }

  // ── output ───────────────────────────────────────────────────────────────
  screenshot() {
    if (this.bloom.enabled) this.bloom.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/png');
    const a = el('a');
    a.href = url;
    a.download = `minecraft-island-${this.seed}-${Math.floor(this.sky.hour * 100)}.png`;
    a.click();
    this.ui && this.ui.toast('📸 Screenshot saved');
  }

  async exportGLB(what = 'world') {
    const { GLTFExporter } = await import('../../vendor/exporters/GLTFExporter.js');
    const tmp = new THREE.Scene();
    tmp.name = 'minecraft_island';
    const grab = [];
    if (what === 'world' || what === 'all') grab.push(this.world.group);
    if (what === 'all' || what === 'char') for (const c of this.chars) grab.push(c.obj);
    if (what === 'all' || what === 'mobs') grab.push(this.mobs.group);
    for (const g of grab) {
      g.updateMatrixWorld(true);
      tmp.add(cloneForExport(g));
    }
    // a neutral light rig so the file previews nicely in other viewers
    tmp.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dl = new THREE.DirectionalLight(0xfff3e0, 2.2);
    dl.position.set(60, 90, 40);
    tmp.add(dl);

    const exporter = new GLTFExporter();
    const buf = await exporter.parseAsync(tmp, {
      binary: true, onlyVisible: true, truncateDrawRange: true,
      includeCustomExtensions: false,
    });
    const blob = new Blob([buf], { type: 'model/gltf-binary' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `minecraft-island-${this.seed}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    tmp.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.ui && this.ui.toast(`📦 Exported ${(blob.size / 1048576).toFixed(1)} MB GLB`);
    return blob.size;
  }

  async regenerate(seed) {
    this.seed = seed >>> 0;
    // tear down
    cancelAnimationFrame(this._raf);
    this.world.dispose();
    this.scene.remove(this.world.group);
    for (const c of this.chars) { this.scene.remove(c.obj); c.dispose(); }
    this.chars = [];
    this.pointLights = [];
    this.scene.remove(this.mobs.group);
    this.scene.remove(this.decor.group);
    for (const pl of this.pointLights) this.scene.remove(pl);
    this.ocean.dispose(); this.scene.remove(this.ocean.mesh);
    this.sky.dispose(); this.scene.remove(this.sky.dome); this.scene.remove(this.sky.clouds);
    for (const k of Object.keys(this.materials)) this.materials[k].dispose();
    this.atlas.map.dispose(); this.atlas.normalMap.dispose(); this.atlas.roughnessMap.dispose();
    this.renderer.renderLists.dispose();
    await this.buildWorld();
    this.start();
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/** clone a hierarchy keeping geometry + material references (for GLB export) */
function cloneForExport(src) {
  const c = src.clone(false);
  c.name = src.name || c.name;
  if (src.isMesh) { c.geometry = src.geometry; c.material = src.material; }
  for (const ch of src.children) c.add(cloneForExport(ch));
  return c;
}

export { QUALITY };
