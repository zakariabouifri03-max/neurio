// ═══════════════════════════════════════════════════════════════════════════
//  MOBS — voxel farm animals (pig, sheep, cow, chicken) with wander/idle/sleep
//  AI that follows the terrain and avoids water, plus fish circling the pond.
//  Built from boxes only; every colour is a plain PBR material.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mulberry32, clamp } from '../util.js';
import { mergeBoxes } from './sky.js';

const mat = (color, rough = 0.92) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

function box(parent, w, h, d, material, x, y, z, pivotY = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** a leg group whose pivot is at the hip; geometry hangs below it */
function leg(parent, w, h, d, material, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  box(g, w, h, d, material, 0, -h / 2, 0);
  parent.add(g);
  return g;
}

// ── PIG ─────────────────────────────────────────────────────────────────────
function buildPig(rnd) {
  const root = new THREE.Group();
  const skin = mat(0xee9e9e, 0.86), skinD = mat(0xd9828b, 0.88), snout = mat(0xf6b6bb, 0.8);
  const body = new THREE.Group(); body.position.y = 0.62; root.add(body);
  box(body, 0.62, 0.56, 1.02, skin, 0, 0, 0);
  const head = new THREE.Group(); head.position.set(0, 0.14, 0.55); body.add(head);
  box(head, 0.5, 0.46, 0.44, skin, 0, 0, 0.18);
  box(head, 0.24, 0.17, 0.09, snout, 0, -0.05, 0.42);
  box(head, 0.13, 0.13, 0.07, skinD, -0.15, 0.22, 0.02);
  box(head, 0.13, 0.13, 0.07, skinD, 0.15, 0.22, 0.02);
  box(head, 0.07, 0.07, 0.03, new THREE.MeshStandardMaterial({ color: 0x1b1013, roughness: 0.3 }), -0.14, 0.06, 0.4);
  box(head, 0.07, 0.07, 0.03, new THREE.MeshStandardMaterial({ color: 0x1b1013, roughness: 0.3 }), 0.14, 0.06, 0.4);
  const legs = [
    leg(root, 0.18, 0.36, 0.18, skinD, -0.2, 0.44, 0.34),
    leg(root, 0.18, 0.36, 0.18, skinD, 0.2, 0.44, 0.34),
    leg(root, 0.18, 0.36, 0.18, skinD, -0.2, 0.44, -0.34),
    leg(root, 0.18, 0.36, 0.18, skinD, 0.2, 0.44, -0.34),
  ];
  const tail = box(body, 0.07, 0.07, 0.16, skinD, 0, 0.16, -0.55);
  return { root, body, head, legs, tail, height: 0.9, speed: 1.05 + rnd() * 0.4, sit: -0.3 };
}

// ── SHEEP ───────────────────────────────────────────────────────────────────
function buildSheep(rnd) {
  const root = new THREE.Group();
  const wool = mat(0xefefea, 1.0), face = mat(0xd8d2c4, 0.88), dark = mat(0x9d968a, 0.9);
  const body = new THREE.Group(); body.position.y = 0.78; root.add(body);
  box(body, 0.72, 0.68, 1.06, wool, 0, 0, 0);
  box(body, 0.78, 0.74, 0.5, wool, 0, 0.02, -0.2);
  const head = new THREE.Group(); head.position.set(0, 0.2, 0.56); body.add(head);
  box(head, 0.4, 0.44, 0.4, face, 0, -0.02, 0.16);
  box(head, 0.46, 0.2, 0.3, wool, 0, 0.24, 0.02);
  box(head, 0.1, 0.24, 0.1, wool, -0.22, 0.05, -0.02);
  box(head, 0.1, 0.24, 0.1, wool, 0.22, 0.05, -0.02);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x221c18, roughness: 0.3 });
  box(head, 0.07, 0.09, 0.03, eyeM, -0.12, 0.02, 0.36);
  box(head, 0.07, 0.09, 0.03, eyeM, 0.12, 0.02, 0.36);
  box(head, 0.14, 0.1, 0.06, dark, 0, -0.16, 0.36);
  const legs = [
    leg(root, 0.17, 0.5, 0.17, dark, -0.22, 0.5, 0.34),
    leg(root, 0.17, 0.5, 0.17, dark, 0.22, 0.5, 0.34),
    leg(root, 0.17, 0.5, 0.17, dark, -0.22, 0.5, -0.34),
    leg(root, 0.17, 0.5, 0.17, dark, 0.22, 0.5, -0.34),
  ];
  return { root, body, head, legs, height: 1.25, speed: 0.95 + rnd() * 0.35, sit: -0.42 };
}

// ── COW ─────────────────────────────────────────────────────────────────────
function buildCow(rnd) {
  const root = new THREE.Group();
  const hide = mat(0x4a3327, 0.9), white = mat(0xe6e0d4, 0.92), horn = mat(0xcfc6ae, 0.7);
  const body = new THREE.Group(); body.position.y = 0.86; root.add(body);
  box(body, 0.74, 0.7, 1.24, hide, 0, 0, 0);
  // patches
  box(body, 0.76, 0.36, 0.42, white, 0.01, 0.16, -0.3);
  box(body, 0.3, 0.72, 0.36, white, -0.24, -0.02, 0.34);
  const head = new THREE.Group(); head.position.set(0, 0.16, 0.66); body.add(head);
  box(head, 0.5, 0.48, 0.44, hide, 0, 0, 0.18);
  box(head, 0.34, 0.24, 0.2, white, 0, -0.14, 0.4);
  box(head, 0.1, 0.2, 0.1, horn, -0.26, 0.26, 0.02);
  box(head, 0.1, 0.2, 0.1, horn, 0.26, 0.26, 0.02);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.25 });
  box(head, 0.08, 0.09, 0.03, eyeM, -0.15, 0.05, 0.4);
  box(head, 0.08, 0.09, 0.03, eyeM, 0.15, 0.05, 0.4);
  const legs = [
    leg(root, 0.2, 0.56, 0.2, hide, -0.24, 0.56, 0.42),
    leg(root, 0.2, 0.56, 0.2, white, 0.24, 0.56, 0.42),
    leg(root, 0.2, 0.56, 0.2, hide, -0.24, 0.56, -0.42),
    leg(root, 0.2, 0.56, 0.2, hide, 0.24, 0.56, -0.42),
  ];
  return { root, body, head, legs, height: 1.4, speed: 0.8 + rnd() * 0.3, sit: -0.5 };
}

// ── CHICKEN ─────────────────────────────────────────────────────────────────
function buildChicken(rnd) {
  const root = new THREE.Group();
  const feather = mat(0xf2f0ea, 0.95), beak = mat(0xe8a33d, 0.7), wattle = mat(0xd0402f, 0.7), legM = mat(0xd9b25c, 0.8);
  const body = new THREE.Group(); body.position.y = 0.42; root.add(body);
  box(body, 0.36, 0.38, 0.44, feather, 0, 0, 0);
  const tailG = new THREE.Group(); tailG.position.set(0, 0.12, -0.24); body.add(tailG);
  box(tailG, 0.24, 0.3, 0.2, feather, 0, 0.1, -0.08);
  const head = new THREE.Group(); head.position.set(0, 0.22, 0.16); body.add(head);
  box(head, 0.26, 0.26, 0.24, feather, 0, 0.06, 0.06);
  box(head, 0.12, 0.08, 0.12, beak, 0, 0.02, 0.24);
  box(head, 0.08, 0.1, 0.06, wattle, 0, -0.06, 0.2);
  box(head, 0.1, 0.08, 0.08, wattle, 0, 0.2, 0.04);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.25 });
  box(head, 0.05, 0.06, 0.02, eyeM, -0.1, 0.09, 0.16);
  box(head, 0.05, 0.06, 0.02, eyeM, 0.1, 0.09, 0.16);
  const legs = [
    leg(root, 0.06, 0.24, 0.06, legM, -0.09, 0.24, 0.02),
    leg(root, 0.06, 0.24, 0.06, legM, 0.09, 0.24, 0.02),
  ];
  const wings = [
    box(body, 0.06, 0.26, 0.34, feather, -0.2, 0.02, 0),
    box(body, 0.06, 0.26, 0.34, feather, 0.2, 0.02, 0),
  ];
  return { root, body, head, legs, wings, height: 0.7, speed: 1.5 + rnd() * 0.7, sit: -0.2, bird: true };
}

const BUILDERS = { pig: buildPig, sheep: buildSheep, cow: buildCow, chicken: buildChicken };

// ═══════════════════════════════════════════════════════════════════════════
export class Mobs {
  constructor(scene, T, opts = {}) {
    this.T = T;
    this.group = new THREE.Group();
    this.group.name = 'mobs';
    scene.add(this.group);
    this.list = [];
    this.enabled = true;
    this.night = 0;
    const rnd = mulberry32(opts.seed ?? 5150);
    const plan = opts.plan || [
      ...Array(opts.pigs ?? 3).fill('pig'),
      ...Array(opts.sheep ?? 4).fill('sheep'),
      ...Array(opts.cows ?? 2).fill('cow'),
      ...Array(opts.chickens ?? 5).fill('chicken'),
    ];
    const home = opts.home || { x: 0, z: 0 };
    for (const kind of plan) {
      const b = BUILDERS[kind](rnd);
      // spawn on dry land near the given home
      let x = 0, z = 0, y = 0, ok = false;
      for (let t = 0; t < 400 && !ok; t++) {
        const a = rnd() * Math.PI * 2, r = 3 + rnd() * (opts.radius ?? 26);
        x = home.x + Math.cos(a) * r; z = home.z + Math.sin(a) * r;
        const ix = Math.round(x), iz = Math.round(z);
        y = T.surface(ix, iz);
        if (y > T.SEA + 1 && !T.isReserved(ix, iz, 0)) ok = true;
      }
      b.root.position.set(x, y, z);
      this.group.add(b.root);
      this.list.push({
        kind, ...b, yaw: rnd() * Math.PI * 2, phase: rnd() * 10,
        state: 'idle', timer: rnd() * 3, target: null, x, z, wanderR: 4 + rnd() * 9,
        home: { x, z },
      });
    }
    this._buildFish(opts.fish ?? 9);
  }

  _buildFish(count) {
    const pond = this.T.pond;
    const geo = mergeBoxes([
      (() => { const g = new THREE.BoxGeometry(0.1, 0.12, 0.34); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.02, 0.14, 0.12); g.translate(0, 0.02, -0.22); return g; })(),
    ]);
    const m = new THREE.MeshStandardMaterial({ color: 0xe2863c, roughness: 0.5, metalness: 0.05 });
    this.fish = new THREE.InstancedMesh(geo, m, count);
    this.fish.castShadow = false;
    this.fish.name = 'fish';
    this.fishData = [];
    const rnd = mulberry32(31337);
    for (let i = 0; i < count; i++) {
      this.fishData.push({
        a: rnd() * Math.PI * 2, r: 1.2 + rnd() * (pond.r - 2.5), s: 0.35 + rnd() * 0.6,
        y: this.T.SEA - 0.7 - rnd() * 1.4, wob: rnd() * 10,
      });
    }
    this.group.add(this.fish);
  }

  update(dt, time, ctx) {
    this.night = ctx.night ?? 0;
    if (!this.enabled) return;
    const T = this.T;
    const sleeping = this.night > 0.6;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);

    for (const mob of this.list) {
      if (sleeping) {
        mob.state = 'sleep';
        mob.timer = 0;
      } else {
        mob.timer -= dt;
        if (mob.timer <= 0) {
          if (mob.state === 'idle') {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * mob.wanderR;
            const tx = clamp(mob.home.x + Math.cos(a) * r, -48, 48);
            const tz = clamp(mob.home.z + Math.sin(a) * r, -48, 48);
            const sy = T.surface(Math.round(tx), Math.round(tz));
            if (sy > T.SEA + 1) { mob.target = { x: tx, z: tz }; mob.state = 'walk'; mob.timer = 4 + Math.random() * 6; }
            else mob.timer = 1.5;
          } else {
            mob.state = 'idle'; mob.timer = 1.5 + Math.random() * 5; mob.target = null;
          }
        }
      }

      const p = mob.root.position;
      if (mob.state === 'walk' && mob.target) {
        const dx = mob.target.x - p.x, dz = mob.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) { mob.state = 'idle'; mob.timer = 1 + Math.random() * 4; }
        else {
          const want = Math.atan2(dx, dz);
          let diff = ((want - mob.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
          mob.yaw += diff * Math.min(1, dt * 4);
          const sp = mob.speed * (mob.bird ? 1.25 : 1);
          p.x += (dx / d) * sp * dt; p.z += (dz / d) * sp * dt;
          mob.phase += dt * sp * 6.5;
        }
      } else if (mob.state === 'idle') {
        mob.phase += dt * 0.6;
      }

      // stick to the terrain
      const gy = T.surface(p.x, p.z);
      const targetY = Math.max(gy, T.SEA + 1);
      p.y += (targetY - p.y) * Math.min(1, dt * 9);

      // pose
      const walkAmt = mob.state === 'walk' ? 1 : 0;
      const sw = Math.sin(mob.phase) * 0.62 * walkAmt;
      for (let i = 0; i < mob.legs.length; i++) {
        const sign = i % 2 === 0 ? 1 : -1;
        const front = i < 2 ? 1 : -1;
        mob.legs[i].rotation.x = sw * sign * front;
      }
      if (mob.state === 'sleep') {
        for (const l of mob.legs) l.rotation.x = -1.35;
        mob.body.rotation.x = 0.1;
        mob.root.position.y = p.y + mob.sit;
        mob.head.rotation.x = 0.5 + Math.sin(time * 0.7 + mob.phase) * 0.05;
        mob.head.rotation.y = 0;
      } else {
        mob.body.rotation.x = Math.sin(mob.phase * 2) * 0.02 * walkAmt;
        mob.root.position.y = p.y;
        mob.head.rotation.x = -0.06 * walkAmt + (mob.state === 'idle' ? Math.sin(time * 0.9 + mob.phase) * 0.07 - 0.03 : 0);
        mob.head.rotation.y = Math.sin(time * 0.42 + mob.phase) * (mob.state === 'idle' ? 0.5 : 0.08);
        // chickens peck
        if (mob.bird && mob.state === 'idle' && Math.sin(time * 1.7 + mob.phase) > 0.86) mob.head.rotation.x = 0.7;
        if (mob.bird && mob.wings) {
          const flap = mob.state === 'walk' ? Math.sin(mob.phase * 2.2) * 0.22 : Math.sin(time * 1.2) * 0.04;
          mob.wings[0].rotation.z = flap; mob.wings[1].rotation.z = -flap;
        }
      }
      mob.root.rotation.y = mob.yaw;
    }

    // fish circles
    if (this.fish) {
      const pond = T.pond;
      for (let i = 0; i < this.fishData.length; i++) {
        const f = this.fishData[i];
        f.a += dt * f.s * 0.55;
        const x = pond.x + Math.cos(f.a) * f.r, z = pond.z + Math.sin(f.a) * f.r;
        const y = f.y + Math.sin(time * 1.1 + f.wob) * 0.22;
        e.set(0, -f.a + Math.PI / 2, Math.sin(time * 3 + f.wob) * 0.16);
        q.setFromEuler(e); v.set(x, y, z);
        m4.compose(v, q, s);
        this.fish.setMatrixAt(i, m4);
      }
      this.fish.instanceMatrix.needsUpdate = true;
      this.fish.visible = true;
    }
  }

  setVisible(v) { this.enabled = v; this.group.visible = v; }
}

export { BUILDERS };
