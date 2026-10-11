// ═══════════════════════════════════════════════════════════════════════════
//  CHARACTER — a Minecraft-proportioned player model built from boxes with a
//  hand-written 64×64 skin UV unwrap (head / torso / 4 limbs + overlay layer),
//  a full animation rig (walk · run · idle · wave · jump · sit · zombie) and a
//  waypoint follower that walks the village, turns to face its target, steps up
//  one-block ledges and hops when it gets stuck.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { drawSkin, PARTS, SKIN_PRESETS } from './skin.js';
import { clamp, lerp, angDiff } from '../util.js';

const S = 1 / 16;                 // 1 skin pixel in world units → 1.8 m tall player

/** remap a unit BoxGeometry's UVs onto skin rects (image coords, v from top) */
function skinBox(w, h, d, rects, texW = 64, texH = 64) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const r = rects[face];
    const u0 = r[0] / texW, v0 = r[1] / texH, u1 = r[2] / texW, v1 = r[3] / texH;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      const u = uv.getX(idx), v = uv.getY(idx);
      uv.setXY(idx, u0 + u * (u1 - u0), 1 - (v0 + (1 - v) * (v1 - v0)));
    }
  }
  uv.needsUpdate = true;
  return g;
}

export function buildCharacter(preset = 'steve', seed = 7, opts = {}) {
  const P = SKIN_PRESETS[preset] || SKIN_PRESETS.steve;
  const canvas = drawSkin(preset, seed, opts);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = true;

  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.0 });
  const matOver = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.86, metalness: 0.0, transparent: true, alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  const armW = P.slim ? 3 * S : 4 * S;
  const E = 1e-3;

  const root = new THREE.Group();
  root.name = 'character_' + (P.label || preset);
  const body = new THREE.Group();            // hips pivot — y = 0.75
  body.position.y = 12 * S;
  root.add(body);

  const torso = new THREE.Mesh(skinBox(8 * S, 12 * S, 4 * S, PARTS.body), mat);
  torso.position.y = 6 * S;
  body.add(torso);
  const torso2 = new THREE.Mesh(skinBox(8 * S + E * 9, 12 * S + E * 9, 4 * S + E * 9, PARTS.body2), matOver);
  torso2.position.copy(torso.position);
  body.add(torso2);

  const headG = new THREE.Group();
  headG.position.y = 12 * S;
  body.add(headG);
  const head = new THREE.Mesh(skinBox(8 * S, 8 * S, 8 * S, PARTS.head), mat);
  head.position.y = 4 * S;
  headG.add(head);
  const head2 = new THREE.Mesh(skinBox(8 * S + E * 12, 8 * S + E * 12, 8 * S + E * 12, PARTS.head2), matOver);
  head2.position.copy(head.position);
  headG.add(head2);

  const mkLimb = (w, h, d, rects, rects2, side) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(skinBox(w, h, d, rects), mat);
    m.position.y = -h / 2;
    g.add(m);
    const m2 = new THREE.Mesh(skinBox(w + E * 10, h + E * 10, d + E * 10, rects2), matOver);
    m2.position.copy(m.position);
    g.add(m2);
    g.position.set(side * (w / 2 + 4 * S), 12 * S, 0);
    body.add(g);
    return g;
  };

  const armR = mkLimb(armW, 12 * S, 4 * S, PARTS.armR, PARTS.armR2, -1);
  const armL = mkLimb(armW, 12 * S, 4 * S, PARTS.armL, PARTS.armL2, 1);
  const legR = mkLimb(4 * S, 12 * S, 4 * S, PARTS.legR, PARTS.legR2, -1);
  const legL = mkLimb(4 * S, 12 * S, 4 * S, PARTS.legL, PARTS.legL2, 1);
  legR.position.y = 0; legL.position.y = 0;      // legs hang from the hip pivot

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return { root, body, head: headG, armR, armL, legR, legL, tex, mat, matOver, preset: P, canvas };
}

// ── animation ───────────────────────────────────────────────────────────────
const ZERO = () => ({ x: 0, y: 0, z: 0 });
export function animateCharacter(rig, time, st) {
  const mode = st.mode || 'idle';
  const speed = st.speed ?? 0;           // 0..1 (1 = run)
  const ph = st.phase ?? 0;
  const s = Math.sin(ph), c = Math.cos(ph);
  const h = rig.head, b = rig.body;
  let amp = 0, bob = 0, lean = 0, rootY = 0, rootPitch = 0;

  if (mode === 'walk' || mode === 'run') {
    amp = mode === 'run' ? 1.15 : 0.72;
    const k = amp * (0.55 + speed * 0.65);
    rig.legR.rotation.x = s * k;
    rig.legL.rotation.x = -s * k;
    rig.armR.rotation.x = -s * k * 0.92;
    rig.armL.rotation.x = s * k * 0.92;
    rig.armR.rotation.z = 0.06 + Math.abs(s) * 0.05;
    rig.armL.rotation.z = -0.06 - Math.abs(s) * 0.05;
    rig.armR.rotation.y = 0; rig.armL.rotation.y = 0;
    rig.legR.rotation.z = 0.03; rig.legL.rotation.z = -0.03;
    b.rotation.y = -s * 0.055 * k;
    b.rotation.x = 0;
    bob = Math.abs(c) * 0.032 * (mode === 'run' ? 1.5 : 1);
    lean = mode === 'run' ? 0.16 : 0.045;
    h.rotation.x = -lean * 0.6 + Math.sin(ph * 0.5) * 0.02;
    h.rotation.y = Math.sin(ph * 0.23) * 0.09;
    h.rotation.z = 0;
    rootPitch = lean;
  } else if (mode === 'idle') {
    const br = Math.sin(time * 1.5) * 0.016;
    rig.legR.rotation.set(0, 0, 0.028); rig.legL.rotation.set(0, 0, -0.028);
    rig.armR.rotation.set(br * 0.6, 0, 0.09 + br);
    rig.armL.rotation.set(br * 0.6, 0, -0.09 - br);
    b.rotation.set(0, Math.sin(time * 0.4) * 0.03, 0);
    b.position.y = 12 * S + br * 0.5;
    bob = br;
    h.rotation.set(Math.sin(time * 0.7) * 0.035, Math.sin(time * 0.33) * 0.16, 0);
  } else if (mode === 'wave') {
    const w = Math.sin(time * 7) * 0.32;
    rig.armR.rotation.set(-2.5, 0, 0.45 + w);
    rig.armL.rotation.set(Math.sin(time * 1.4) * 0.05, 0, -0.1);
    rig.legR.rotation.set(0, 0, 0.03); rig.legL.rotation.set(0, 0, -0.03);
    b.rotation.set(0, -0.1, 0);
    h.rotation.set(0.02, -0.18, 0.03);
    bob = Math.sin(time * 2) * 0.006;
  } else if (mode === 'jump') {
    rig.armR.rotation.set(-2.2, 0, 0.4); rig.armL.rotation.set(-2.2, 0, -0.4);
    rig.legR.rotation.set(-0.55, 0, 0.08); rig.legL.rotation.set(0.35, 0, -0.06);
    b.rotation.x = -0.08;
    h.rotation.set(-0.1, 0, 0);
    rootY = st.jumpY ?? 0;
  } else if (mode === 'sit') {
    rig.legR.rotation.set(-1.45, 0, 0.05); rig.legL.rotation.set(-1.45, 0, -0.05);
    rig.armR.rotation.set(-0.45, 0, 0.16); rig.armL.rotation.set(-0.45, 0, -0.16);
    b.rotation.x = 0.08;
    h.rotation.set(Math.sin(time * 0.8) * 0.05, Math.sin(time * 0.4) * 0.12, 0);
    rootY = -0.42;
    bob = Math.sin(time * 1.4) * 0.006;
  } else if (mode === 'zombie') {
    const sw = Math.sin(ph) * 0.42;
    rig.armR.rotation.set(-1.52, 0, 0.12 + sw * 0.1);
    rig.armL.rotation.set(-1.52, 0, -0.12 - sw * 0.1);
    rig.legR.rotation.x = sw; rig.legL.rotation.x = -sw;
    b.rotation.set(0.1, Math.sin(ph * 0.5) * 0.14, Math.sin(ph * 0.37) * 0.07);
    h.rotation.set(0.14, Math.sin(ph * 0.31) * 0.2, 0);
    bob = Math.abs(Math.cos(ph)) * 0.02;
    rootPitch = 0.1;
  }
  b.position.y = 12 * S + bob;
  rig.body.rotation.x = lerp(rig.body.rotation.x, rootPitch, 0.2);
  rig.sitOffset = rootY;   // the owner applies it to the root height
}

// ── waypoint follower ───────────────────────────────────────────────────────
export class Character {
  constructor(scene, T, opts = {}) {
    this.T = T;
    this.preset = opts.preset || 'steve';
    this.model = buildCharacter(this.preset, opts.seed ?? 7);
    this.obj = this.model.root;
    this.obj.position.set(opts.x ?? 0, opts.y ?? 20, opts.z ?? 0);
    scene.add(this.obj);
    this.speed = opts.speed ?? 1.9;
    this.runSpeed = opts.runSpeed ?? 4.4;
    this.yaw = opts.yaw ?? 0;
    this.mode = 'idle';
    this.phase = 0;
    this.state = { mode: 'idle', speed: 0, phase: 0, groundY: this.obj.position.y };
    this.path = (opts.path || []).map((p) => ({ ...p }));
    this.wp = 0;
    this.loop = opts.loop !== false;
    this.waitTimer = opts.startWait ?? 0;
    this.stuck = 0;
    this.lastDist = Infinity;
    this.jumpV = 0;
    this.airY = 0;
    this.enabled = true;
    this.groundY = this.obj.position.y;
  }

  setPath(path) { this.path = path.map((p) => ({ ...p })); this.wp = 0; }

  update(dt, time, opts = {}) {
    if (!this.enabled) return;
    const paused = opts.paused;
    if (this.waitTimer > 0) { this.waitTimer -= dt; this.mode = 'idle'; }
    else if (!paused && this.path.length > 1) {
      const target = this.path[this.wp];
      const p = this.obj.position;
      const dx = target.x - p.x, dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.45) {
        this.wp++;
        if (this.wp >= this.path.length) {
          if (this.loop) { this.wp = 0; }
          else { this.wp = this.path.length - 1; this.waitTimer = 1e9; }
        }
        if (target.wait) this.waitTimer = target.wait;
        this.stuck = 0; this.lastDist = Infinity;
      } else {
        const run = target.run === true;
        const sp = run ? this.runSpeed : this.speed;
        const wantYaw = Math.atan2(dx, dz);
        this.yaw += angDiff(this.yaw, wantYaw) * Math.min(1, dt * 7);
        const step = sp * dt;
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        this.phase += dt * sp * 4.5;
        this.mode = run ? 'run' : 'walk';
        // stuck detection → hop
        if (dist > this.lastDist - 0.002) this.stuck += dt; else this.stuck = 0;
        this.lastDist = dist;
        if (this.stuck > 0.45 && this.airY <= 0.001) { this.jumpV = 4.2; this.stuck = 0; }
      }
    } else if (!paused) {
      this.mode = opts.wave ? 'wave' : 'idle';
    }

    // gravity + step-up onto the voxel surface
    const p = this.obj.position;
    const surf = this.T.surface(p.x, p.z);
    this.groundY = Math.max(surf, this.T.SEA + 1);
    if (this.jumpV > 0 || this.airY > 0) {
      this.airY += this.jumpV * dt;
      this.jumpV -= 15 * dt;
      if (this.airY <= 0) { this.airY = 0; this.jumpV = 0; }
      this.mode = 'jump';
    }
    // smooth step up small ledges, snap down when falling
    const dy = this.groundY - p.y;
    if (dy > 0) p.y += Math.min(dy, dt * (dy > 1.2 ? 3.2 : 7.5));
    else p.y += Math.max(dy, -dt * 12);

    this.obj.rotation.y = this.yaw;
    this.state.mode = this.mode;
    this.state.phase = this.phase;
    this.state.speed = this.mode === 'run' ? 1 : 0.55;
    this.state.groundY = p.y;
    this.state.airY = this.airY;
    animateCharacter(this.model, time, this.state);
  }

  dispose() {
    this.obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    this.model.mat.dispose(); this.model.matOver.dispose(); this.model.tex.dispose();
  }
}

export { skinBox, S as SKIN_SCALE };
