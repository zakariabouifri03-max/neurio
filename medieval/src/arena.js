// ── IRONVOW — the four grounds ───────────────────────────────────────────────
// Hand-built rooms, not tilesets: a torch-lit hall with light shafts through the
// high windows, a flooded oubliette, a sunlit sand yard, and a wind-scoured
// battlement walk. All geometry is generated at runtime.
import * as THREE from 'three';
import { stoneMat, floorMat, woodMat, plankTex, metalMat, leatherMat, clothMat, bannerMat, flatMat, sandTex, normalFromCanvas } from './tex.js';
import { mulberry32, clamp, lerp, TAU, rnd } from './mathx.js';
import { arenaById, HOUSES } from './data.js';

// ── small builders ──────────────────────────────────────────────────────────
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function barrel(rng, mat) {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = 0.30 * (1 + 0.13 * Math.sin(t * Math.PI * 1.0)) * (t < 0.06 || t > 0.94 ? 0.92 : 1);
    prof.push(new THREE.Vector2(r, t * 0.92));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), mat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const hoop = metalMat('iron', [1, 1], 0.5);
  for (const y of [0.12, 0.46, 0.80]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.012, 5, 18), hoop);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    t.castShadow = true;
    g.add(t);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), woodMat('dark', [1, 1]));
  lid.position.y = 0.925;
  g.add(lid);
  g.userData.radius = 0.34;
  return g;
}
function table(w, d, h, mat, rng) {
  const g = new THREE.Group();
  const top = box(w, 0.06, d, mat, 0, h, 0);
  g.add(top);
  const legX = w * 0.42, legZ = d * 0.38;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = box(0.08, h, 0.08, mat, sx * legX, h / 2, sz * legZ);
    g.add(leg);
  }
  const trestle = box(w * 1.02, 0.05, 0.07, mat, 0, h * 0.35, 0);
  g.add(trestle);
  g.userData.radius = Math.max(w, d) * 0.5;
  return g;
}
function bench(w, h, mat) {
  const g = new THREE.Group();
  g.add(box(w, 0.05, 0.26, mat, 0, h, 0));
  for (const sx of [-1, 1]) g.add(box(0.06, h, 0.24, mat, sx * w * 0.42, h / 2, 0));
  g.userData.radius = w * 0.5;
  return g;
}
/** Wall torch: iron bracket, pitch-soaked shaft, flame sprite and a real light. */
function sconce(ironMat, seed, intensity = 2.0, distance = 11) {
  const g = new THREE.Group();
  g.add(box(0.04, 0.04, 0.16, ironMat, 0, 0, 0.08));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.10, 8), ironMat);
  cup.position.set(0, 0.06, 0.17);
  cup.castShadow = true;
  g.add(cup);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.34, 6), woodMat('dark', [1, 1]));
  shaft.position.set(0, 0.22, 0.17);
  shaft.rotation.x = 0.08;
  shaft.castShadow = true;
  g.add(shaft);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flameTex(seed), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  flame.scale.set(0.5, 0.7, 1);
  flame.position.set(0, 0.48, 0.17);
  g.add(flame);
  const light = new THREE.PointLight(0xff9a44, intensity, distance, 2);
  light.position.set(0, 0.5, 0.18);
  g.add(light);
  g.userData.flame = flame;
  g.userData.light = light;
  return g;
}

const flameTextures = [];
function flameTex(seed) {
  if (flameTextures[seed % 4]) return flameTextures[seed % 4];
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const rng = mulberry32(seed * 77 + 3);
  g.clearRect(0, 0, 64, 128);
  const grd = g.createRadialGradient(32, 96, 2, 32, 78, 54);
  grd.addColorStop(0, 'rgba(255,246,220,1)');
  grd.addColorStop(0.25, 'rgba(255,196,96,0.92)');
  grd.addColorStop(0.55, 'rgba(232,110,32,0.5)');
  grd.addColorStop(1, 'rgba(120,30,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(32, 8);
  g.bezierCurveTo(46, 52, 56, 74, 32, 108);
  g.bezierCurveTo(8, 74, 18, 52, 32, 8);
  g.fill();
  for (let i = 0; i < 20; i++) {
    g.fillStyle = `rgba(255,${180 + rng() * 60 | 0},${60 + rng() * 90 | 0},${0.1 + rng() * 0.3})`;
    g.beginPath();
    g.arc(32 + (rng() - 0.5) * 22, 60 + rng() * 44, 1 + rng() * 4, 0, TAU);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  flameTextures[seed % 4] = t;
  return t;
}

function bannerMesh(house, w = 1.0, h = 2.4) {
  const g = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 6, 10), bannerMat(house));
  cloth.castShadow = true;
  // gentle sag: pull the lower verts toward the viewer, as if hanging slack
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i);
    pos.setZ(i, Math.cos((x / w) * Math.PI) * 0.06 * (1 - (y + h / 2) / h) + Math.sin((y / h) * 3) * 0.02);
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
  g.add(cloth);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, w + 0.24, 8), woodMat('dark', [1, 1]));
  rod.rotation.z = Math.PI / 2;
  rod.position.y = h / 2 + 0.04;
  rod.castShadow = true;
  g.add(rod);
  return g;
}

function lightShaftTex() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(255,240,205,0.62)');
  grd.addColorStop(0.45, 'rgba(255,232,190,0.26)');
  grd.addColorStop(1, 'rgba(255,228,180,0.0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  // soften the sides
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.28, 'rgba(0,0,0,0)');
  side.addColorStop(0.72, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ════════════════════════════════════════════════════════════════════════════
//  ARENA
// ════════════════════════════════════════════════════════════════════════════
export class Arena {
  constructor(id) {
    this.def = arenaById(id) || arenaById('hall');
    this.group = new THREE.Group();
    this.colliders = [];      // {min:Vector3, max:Vector3}
    this.torches = [];
    this.spawns = [];         // world positions for fighters
    this.playerStart = new THREE.Vector3();
    this.lights = [];
    this.build();
    this.playerFacing = 0;
    this.faceSpawns();
  }

  /**
   * Face every spawn at the one opposite it. Authoring yaw by hand is how a
   * duellist ends up looking over his own shoulder; the geometry knows the
   * answer, so ask it.
   */
  faceSpawns() {
    this.spawnYaw = [];
    for (let i = 0; i < this.spawns.length; i++) {
      const other = this.spawns[(i + 1) % this.spawns.length] || this.spawns[i];
      const dx = other.x - this.spawns[i].x, dz = other.z - this.spawns[i].z;
      this.spawnYaw[i] = (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) ? Math.atan2(dx, dz) : 0;
    }
    if (this.spawnYaw.length) this.playerFacing = this.spawnYaw[0];
    if (this.spawns[0]) this.playerStart.copy(this.spawns[0]);
    return this.playerFacing;
  }
  /** Yaw for a fighter spawned at `spawns[i]` so it looks at its opposite. */
  facingFor(i) { return (this.spawnYaw && this.spawnYaw[i]) ?? this.playerFacing ?? 0; }

  addCollider(obj, w, h, d, yOff = 0) {
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    this.colliders.push({
      min: new THREE.Vector3(pos.x - w / 2, 0 + yOff, pos.z - d / 2),
      max: new THREE.Vector3(pos.x + w / 2, h + yOff, pos.z + d / 2),
    });
  }
  addBox(minX, minZ, maxX, maxZ, height = 3) {
    this.colliders.push({ min: new THREE.Vector3(minX, 0, minZ), max: new THREE.Vector3(maxX, height, maxZ) });
  }

  build() {
    const d = this.def;
    switch (d.id) {
      case 'oubliette': this.buildOubliette(); break;
      case 'courtyard': this.buildCourtyard(); break;
      case 'ramparts': this.buildRamparts(); break;
      default: this.buildHall();
    }
    this.buildLighting();
  }

  // ── 1. ASHCOMBE GREAT HALL ────────────────────────────────────────────────
  buildHall() {
    const rng = mulberry32(4711);
    const B = this.def.bounds;
    const W = B.x * 2, D = B.z * 2, H = 8.2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1), floorMat(true, [7, 6]));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    const wallMat = stoneMat('ashlar', [5, 2]);
    const wallMatEnd = stoneMat('ashlar', [4, 2]);
    // walls, built as thick slabs so the light does not leak through
    const mkWall = (w, h, dd, x, y, z, ry, mat) => {
      const m = box(w, h, dd, mat || wallMat, x, y, z);
      if (ry) m.rotation.y = ry;
      this.group.add(m);
      return m;
    };
    mkWall(W + 1, H, 0.7, 0, H / 2, -D / 2 - 0.35);
    mkWall(W + 1, H, 0.7, 0, H / 2, D / 2 + 0.35);
    mkWall(0.7, H, D + 1, -W / 2 - 0.35, H / 2, 0);
    mkWall(0.7, H, D + 1, W / 2 + 0.35, H / 2, 0);
    // plinth course around the base
    for (const [w, dd, x, z] of [[W, 0.5, 0, -D / 2 + 0.2], [W, 0.5, 0, D / 2 - 0.2], [0.5, D, -W / 2 + 0.2, 0], [0.5, D, W / 2 - 0.2, 0]]) {
      this.group.add(box(w, 0.5, dd, stoneMat('rubble', [3, 1]), x, 0.25, z));
    }
    this.addBox(-W / 2 - 2, -D / 2 - 2, -W / 2 + 0.25, D / 2 + 2);
    this.addBox(W / 2 - 0.25, -D / 2 - 2, W / 2 + 2, D / 2 + 2);
    this.addBox(-W / 2 - 2, -D / 2 - 2, W / 2 + 2, -D / 2 + 0.25);
    this.addBox(-W / 2 - 2, D / 2 - 0.25, W / 2 + 2, D / 2 + 2);

    // ── timber roof: trusses and rafters ──
    const timber = woodMat('dark', [1, 6]);
    const beam = (w, h, dd, x, y, z, ry = 0, rz = 0) => {
      const m = box(w, h, dd, timber, x, y, z);
      m.rotation.y = ry; m.rotation.z = rz;
      this.group.add(m);
      return m;
    };
    for (let i = -3; i <= 3; i++) {
      const z = i * (D / 7);
      beam(0.3, 0.4, D + 0.6, 0, H - 0.35, z, 0, 0);
    }
    for (let i = -6; i <= 6; i++) {
      const x = i * (W / 13);
      const r = beam(W + 0.5, 0.26, 0.26, 0, H - 0.9, x);
      r.rotation.y = Math.PI / 2;
    }
    // ceiling boards
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, D + 1), woodMat('char', [6, 5]));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H - 0.12;
    ceil.receiveShadow = true;
    this.group.add(ceil);

    // ── high windows on the north wall + light shafts ──
    const shaftTex = lightShaftTex();
    const shaftMat = new THREE.MeshBasicMaterial({
      map: shaftTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.shafts = [];
    for (const [i, x] of [[-1, -W * 0.28], [1, W * 0.28]].map((v, i) => [i, v[1]])) {
      // window opening: a bright arched recess in the wall
      const win = new THREE.Group();
      win.position.set(x, H * 0.72, -D / 2 + 0.02);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 3.4), new THREE.MeshBasicMaterial({ color: 0xffe9c4 }));
      win.add(gl);
      const frameMat = stoneMat('light', [1, 1]);
      win.add(box(2.3, 0.24, 0.5, frameMat, 0, 1.82, 0.16));
      win.add(box(0.22, 3.7, 0.5, frameMat, -1.16, 0, 0.16));
      win.add(box(0.22, 3.7, 0.5, frameMat, 1.16, 0, 0.16));
      win.add(box(2.3, 0.24, 0.5, frameMat, 0, -1.82, 0.16));
      for (const sx of [-0.36, 0.36]) win.add(box(0.08, 3.4, 0.16, frameMat, sx * 2, 0, 0.2));
      this.group.add(win);
      // the shaft itself
      for (let k = 0; k < 2; k++) {
        const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4 - k * 0.5, 12), shaftMat.clone());
        shaft.material.opacity = 0.5 - k * 0.22;
        shaft.position.set(x + k * 0.5, H * 0.45 - k * 0.2, -D / 2 + 4.4 + k * 0.8);
        shaft.rotation.x = -0.42;
        shaft.rotation.z = 0.06;
        shaft.renderOrder = 3;
        this.group.add(shaft);
        this.shafts.push(shaft);
      }
    }
    // dust motes drifting through the beams
    const dustGeo = new THREE.BufferGeometry();
    const N = 320;
    const dp = new Float32Array(N * 3);
    this.dustData = [];
    for (let i = 0; i < N; i++) {
      const x = (rng() - 0.5) * W * 0.9, y = rng() * H * 0.8, z = (rng() - 0.5) * D * 0.9;
      dp.set([x, y, z], i * 3);
      this.dustData.push({ vx: (rng() - 0.5) * 0.06, vy: 0.02 + rng() * 0.05, vz: (rng() - 0.5) * 0.06 });
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xffe6bb, size: 0.035, transparent: true, opacity: 0.5, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.group.add(this.dust);

    // ── hearth, tables, benches, barrels, rushes ──
    const hearth = new THREE.Group();
    hearth.position.set(-W * 0.34, 0, D / 2 - 2.5);
    hearth.add(box(3.4, 0.35, 1.5, stoneMat('rubble', [2, 1]), 0, 0.18, 0));
    for (const sx of [-1, 1]) hearth.add(box(0.4, 1.5, 1.5, stoneMat('ashlar', [1, 1]), sx * 1.6, 0.75, 0));
    hearth.add(box(3.4, 0.4, 1.5, stoneMat('ashlar', [1, 1]), 0, 1.6, 0));
    const fireGlow = new THREE.PointLight(0xff8a3c, 2.4, 14, 2);
    fireGlow.position.set(0, 0.8, 0);
    hearth.add(fireGlow);
    this.fireLight = fireGlow;
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 1.1, 7), woodMat('char', [1, 1]));
      log.rotation.z = Math.PI / 2 + (rng() - 0.5) * 0.5;
      log.rotation.y = rng() * TAU;
      log.position.set((rng() - 0.5) * 0.7, 0.44, (rng() - 0.5) * 0.5);
      log.castShadow = true;
      hearth.add(log);
    }
    const fireSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex(2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffffff,
    }));
    fireSprite.scale.set(1.5, 1.7, 1);
    fireSprite.position.set(0, 0.85, 0);
    hearth.add(fireSprite);
    this.fireSprite = fireSprite;
    this.group.add(hearth);
    this.addCollider(hearth, 3.6, 1.9, 1.6);

    const wood = woodMat('oak', [1, 1]);
    // long tables down the middle, pushed to the sides so there is room to duel
    for (const [x, z, ry] of [[-W * 0.33, -D * 0.28, 0.06], [W * 0.33, -D * 0.26, -0.05], [W * 0.32, D * 0.3, 0.04]]) {
      const t = table(3.4, 0.9, 0.78, wood, rng);
      t.position.set(x, 0, z);
      t.rotation.y = ry;
      this.group.add(t);
      this.addCollider(t, 3.4, 0.86, 0.95);
      for (const sx of [-1, 1]) {
        const b = bench(2.6, 0.46, wood);
        b.position.set(x + sx * 0.2, 0, z + 0.85 * (sx > 0 ? 1 : -1));
        b.rotation.y = ry + (sx > 0 ? Math.PI : 0);
        this.group.add(b);
        this.addCollider(b, 2.6, 0.5, 0.3);
      }
      // pewter and wood on the table
      for (let i = 0; i < 3; i++) {
        const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.24, 10), metalMat('iron', [1, 1], 0.35));
        jug.position.set(x + (rng() - 0.5) * 2.4, 0.9, z + (rng() - 0.5) * 0.5);
        jug.castShadow = true;
        this.group.add(jug);
      }
    }
    const barrelMat = woodMat('dark', [1, 1]);
    for (let i = 0; i < 9; i++) {
      const b = barrel(rng, barrelMat);
      const side = rng() > 0.5 ? 1 : -1;
      b.position.set(side * (W / 2 - 1.1 - rng() * 0.5), 0, -D / 2 + 1.4 + i * (D - 3) / 9 + rng() * 0.5);
      b.rotation.y = rng() * TAU;
      this.group.add(b);
      this.addCollider(b, 0.72, 0.95, 0.72);
    }
    for (let i = 0; i < 3; i++) {
      const b = barrel(rng, barrelMat);
      b.rotation.z = Math.PI / 2;
      b.position.set(W / 2 - 1.2, 0.32, D / 2 - 2 - i * 0.8);
      this.group.add(b);
      this.addCollider(b, 0.95, 0.7, 0.72);
    }

    // ── torches, banners, weapon rack, rushes ──
    const iron = metalMat('iron', [1, 1], 0.5);
    for (const [x, z, ry] of [[-W / 2 + 0.4, -D * 0.15, Math.PI / 2], [-W / 2 + 0.4, D * 0.34, Math.PI / 2],
                              [W / 2 - 0.4, -D * 0.1, -Math.PI / 2], [W / 2 - 0.4, D * 0.4, -Math.PI / 2],
                              [0, -D / 2 + 0.4, 0], [0, D / 2 - 0.4, Math.PI]]) {
      const s = sconce(iron, this.torches.length, 2.0, 11);
      s.position.set(x, 2.5, z);
      s.rotation.y = ry;
      this.group.add(s);
      this.torches.push({ sprite: s.userData.flame, light: s.userData.light, seed: rnd() * 10, base: 2.0 });
    }
    for (const [x, z] of [[-W * 0.36, D / 2 - 0.5], [-W * 0.24, D / 2 - 0.5], [W * 0.26, D / 2 - 0.5], [W * 0.38, D / 2 - 0.5]]) {
      const b = bannerMesh(rng() > 0.5 ? 'ashcombe' : 'emberfall', 1.1, 2.6);
      b.position.set(x, 6.2 - 1.3, z);
      this.group.add(b);
    }
    // weapon rack against a wall
    const rack = new THREE.Group();
    rack.position.set(-W / 2 + 0.9, 0, -D * 0.42);
    rack.add(box(0.14, 1.3, 2.2, wood, 0, 0.65, 0));
    for (let i = 0; i < 4; i++) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), wood);
      stand.position.set(0.2, 0.9, -0.75 + i * 0.5);
      stand.rotation.z = 0.22;
      stand.castShadow = true;
      rack.add(stand);
    }
    this.group.add(rack);
    this.addCollider(rack, 0.6, 1.4, 2.3);
    // rushes / straw on the flagstones
    for (let i = 0; i < 130; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.6 + rng() * 0.5, 4), flatMat(0x8a7546, 0.95));
      st.position.set((rng() - 0.5) * W * 0.95, 0.01, (rng() - 0.5) * D * 0.95);
      st.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.2, rng() * TAU, 0);
      this.group.add(st);
    }

    this.spawns.push(new THREE.Vector3(0, 0, -D * 0.22), new THREE.Vector3(0, 0, D * 0.22));
    this.playerStart.set(0, 0, -D * 0.22);
    this.playerFacing = 0;
  }

  // ── 2. THE OUBLIETTE ─────────────────────────────────────────────────────
  buildOubliette() {
    const rng = mulberry32(90210);
    const B = this.def.bounds;
    const W = B.x * 2, D = B.z * 2, H = 3.6;
    const floorMatD = floorMat(false, [4, 4]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 8, 8), floorMatD);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    // slight unevenness, as if the ground settled
    const fp = floor.geometry.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i);
      fp.setZ(i, Math.sin(x * 0.6) * 0.05 + Math.cos(y * 0.7) * 0.05);
    }
    fp.needsUpdate = true;
    floor.geometry.computeVertexNormals();
    this.group.add(floor);

    const wallMat = stoneMat('dungeon', [4, 1]);
    const mkWall = (w, h, dd, x, y, z) => { this.group.add(box(w, h, dd, wallMat, x, y, z)); };
    mkWall(W + 1, H, 0.6, 0, H / 2, -D / 2 - 0.3);
    mkWall(W + 1, H, 0.6, 0, H / 2, D / 2 + 0.3);
    mkWall(0.6, H, D + 1, -W / 2 - 0.3, H / 2, 0);
    mkWall(0.6, H, D + 1, W / 2 + 0.3, H / 2, 0);
    this.addBox(-W / 2 - 2, -D / 2 - 2, -W / 2 + 0.2, D / 2 + 2);
    this.addBox(W / 2 - 0.2, -D / 2 - 2, W / 2 + 2, D / 2 + 2);
    this.addBox(-W / 2 - 2, -D / 2 - 2, W / 2 + 2, -D / 2 + 0.2);
    this.addBox(-W / 2 - 2, D / 2 - 0.2, W / 2 + 2, D / 2 + 2);

    // ── barrel vault: arches marching down the room ──
    const vaultMat = stoneMat('dungeon', [3, 1]);
    const ribs = 12;
    for (let i = 0; i < ribs; i++) {
      const x = -W / 2 + (i + 0.5) * (W / ribs);
      for (let k = 0; k < 11; k++) {
        const a = (k / 10) * Math.PI;
        const r = D * 0.62;
        const y = Math.sin(a) * r * 0.52 + 1.5;
        const z = -Math.cos(a) * r * 0.78;
        if (Math.abs(y) > H + 0.4) continue;
        const seg = box(W / ribs + 0.06, 0.34, 0.5, vaultMat, x, y, z);
        seg.rotation.x = a - Math.PI / 2;
        this.group.add(seg);
      }
    }
    // ceiling slabs above the vault (keeps light in)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, D + 1), vaultMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H + 0.5;
    this.group.add(ceil);

    // ── cells along one side with barred doors ──
    const iron = metalMat('iron', [1, 1], 0.55);
    const cellWallMat = stoneMat('rubble', [3, 1]);
    for (let c = 0; c < 3; c++) {
      const cz = -D * 0.28 + c * (D * 0.38);
      const cell = new THREE.Group();
      cell.position.set(-W / 2 + 1.6, 0, cz);
      cell.add(box(3.2, 2.6, 0.3, cellWallMat, 0, 1.3, -1.9));
      cell.add(box(3.2, 2.6, 0.3, cellWallMat, 0, 1.3, 1.9));
      cell.add(box(0.3, 2.6, 3.8, cellWallMat, -1.5, 1.3, 0));
      cell.add(box(3.2, 0.4, 4.1, cellWallMat, 0, 2.7, 0));
      // bars
      for (let i = 0; i < 7; i++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.4, 6), iron);
        bar.position.set(1.5, 1.2, -1.5 + i * 0.5);
        bar.castShadow = true;
        cell.add(bar);
      }
      cell.add(box(0.12, 0.1, 3.6, iron, 1.5, 2.35, 0));
      cell.add(box(0.12, 0.1, 3.6, iron, 1.5, 0.12, 0));
      this.group.add(cell);
      this.addBox(-W / 2 + 0.05, cz - 2.0, -W / 2 + 3.2, cz + 2.0, 3);
    }

    // ── chains, manacles, a straw pallet, a bucket ──
    const chainLink = new THREE.TorusGeometry(0.05, 0.014, 5, 10);
    for (let i = 0; i < 4; i++) {
      const chain = new THREE.Group();
      const len = 6 + Math.floor(rng() * 6);
      for (let k = 0; k < len; k++) {
        const link = new THREE.Mesh(chainLink, iron);
        link.position.y = -k * 0.075;
        link.rotation.y = k % 2 ? Math.PI / 2 : 0;
        chain.add(link);
      }
      chain.position.set(-W / 2 + 1.2 + rng() * 1.5, 2.5, -D * 0.3 + rng() * D * 0.6);
      this.group.add(chain);
    }
    const strawG = new THREE.Group();
    strawG.position.set(W * 0.3, 0, D * 0.3);
    for (let i = 0; i < 90; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.35 + rng() * 0.4, 4), flatMat(0x7a6742, 0.96));
      const a = rng() * TAU, r = Math.sqrt(rng()) * 0.9;
      st.position.set(Math.cos(a) * r, 0.02 + rng() * 0.05, Math.sin(a) * r);
      st.rotation.set(Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * TAU, 0);
      strawG.add(st);
    }
    this.group.add(strawG);

    // ── puddles, dripping water, moss ──
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x0b1114, roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.92,
    });
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.8 + rng() * 1.5, 18), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set((rng() - 0.5) * W * 0.8, 0.012, (rng() - 0.5) * D * 0.8);
      p.receiveShadow = true;
      this.group.add(p);
    }
    this.drips = [];
    const dripGeo = new THREE.BufferGeometry();
    const dn = 26;
    const dpos = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) {
      dpos.set([(rng() - 0.5) * W * 0.9, rng() * H, (rng() - 0.5) * D * 0.9], i * 3);
      this.drips.push({ v: 1.4 + rng() * 1.6 });
    }
    dripGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    this.dripPoints = new THREE.Points(dripGeo, new THREE.PointsMaterial({
      color: 0x9fc4d8, size: 0.025, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.group.add(this.dripPoints);

    // ── two torches and a brazier ──
    for (const [x, z, ry] of [[-W / 2 + 0.5, -D * 0.45, Math.PI / 2], [W / 2 - 0.5, D * 0.42, -Math.PI / 2]]) {
      const s = sconce(iron, this.torches.length, 2.6, 13);
      s.position.set(x, 2.1, z);
      s.rotation.y = ry;
      this.group.add(s);
      this.torches.push({ sprite: s.userData.flame, light: s.userData.light, seed: rnd() * 10, base: 2.6 });
    }
    const brazier = new THREE.Group();
    brazier.position.set(W * 0.42, 0, -D * 0.34);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 0.36, 14), metalMat('iron', [1, 1], 0.5));
    bowl.position.y = 0.95;
    bowl.castShadow = true;
    brazier.add(bowl);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.0, 6), iron);
      leg.position.set(Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3);
      leg.rotation.z = -Math.cos(a) * 0.12;
      leg.rotation.x = Math.sin(a) * 0.12;
      brazier.add(leg);
    }
    const bLight = new THREE.PointLight(0xff7a2a, 3.2, 15, 2);
    bLight.position.y = 1.3;
    brazier.add(bLight);
    const bFlame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    bFlame.scale.set(1.1, 1.3, 1);
    bFlame.position.y = 1.35;
    brazier.add(bFlame);
    this.group.add(brazier);
    this.addCollider(brazier, 1.1, 1.4, 1.1);
    this.brazierFlame = bFlame;
    this.brazierLight = bLight;
    this.fireLight = bLight;
    this.fireSprite = bFlame;

    this.spawns.push(new THREE.Vector3(0, 0, -D * 0.26), new THREE.Vector3(0, 0, D * 0.26));
    this.playerStart.set(0, 0, -D * 0.26);
  }

  // ── 3. SUNBLADE YARD ────────────────────────────────────────────────────
  buildCourtyard() {
    const rng = mulberry32(31337);
    const B = this.def.bounds;
    const W = B.x * 2, D = B.z * 2;
    const sand = sandTex().clone();
    sand.repeat.set(9, 8); sand.needsUpdate = true;
    const sandMat = new THREE.MeshStandardMaterial({ map: sand, roughness: 0.95, metalness: 0 });
    sandMat.normalMap = normalFromCanvas(sand.image, 1.0, 'n_sand_yard');
    sandMat.normalScale.set(0.6, 0.6);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.2, D * 2.2, 1, 1), sandMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // sky dome
    const skyGeo = new THREE.SphereGeometry(200, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x3f7fd6) }, bottom: { value: new THREE.Color(0xe8d9b4) }, sun: { value: new THREE.Vector3(0.6, 0.7, -0.4).normalize() } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sun; varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = clamp(d.y*1.2, 0.0, 1.0);
          vec3 c = mix(bottom, top, pow(h, 0.7));
          float s = max(dot(d, normalize(sun)), 0.0);
          c += vec3(1.0,0.92,0.78) * pow(s, 12.0) * 0.7;
          c += vec3(1.0,0.85,0.6) * pow(s, 220.0) * 1.4;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.group.add(this.sky);

    // perimeter walls
    const wallMat = stoneMat('light', [5, 2]);
    const mkWall = (w, h, dd, x, y, z) => this.group.add(box(w, h, dd, wallMat, x, y, z));
    mkWall(W * 2.1, 5.2, 0.8, 0, 2.6, -D - 0.4);
    mkWall(W * 2.1, 5.2, 0.8, 0, 2.6, D + 0.4);
    mkWall(0.8, 5.2, D * 2.1, -W - 0.4, 2.6, 0);
    mkWall(0.8, 5.2, D * 2.1, W + 0.4, 2.6, 0);
    for (const [w, dd, x, z] of [[W * 2.1, 0.9, 0, -D], [W * 2.1, 0.9, 0, D], [0.9, D * 2.1, -W, 0], [0.9, D * 2.1, W, 0]]) {
      this.group.add(box(w, 0.55, dd, stoneMat('rubble', [4, 1]), x, 5.4, z));
    }
    this.addBox(-W * 2.2, -D - 1.5, -W + 0.2, D + 1.5);
    this.addBox(W - 0.2, -D - 1.5, W * 2.2, D + 1.5);
    this.addBox(-W * 2.2, -D - 1.5, W * 2.2, -D + 0.2);
    this.addBox(-W * 2.2, D - 0.2, W * 2.2, D + 1.5);

    // the lists: a fence of posts and rails across one end, with the sand harrowed
    const wood = woodMat('pale', [1, 3]);
    for (let i = -6; i <= 6; i++) {
      const x = i * (D * 1.5 / 12);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.2, 8), wood);
      post.position.set(x, 0.6, -D * 0.72);
      post.castShadow = true;
      this.group.add(post);
      if (i < 6) {
        for (const y of [0.55, 0.98]) {
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, D * 1.5 / 12, 6), wood);
          rail.rotation.z = Math.PI / 2;
          rail.position.set(x + (D * 1.5 / 24), y, -D * 0.72);
          rail.castShadow = true;
          this.group.add(rail);
        }
      }
    }
    this.addBox(-D * 0.78, -D * 0.78, D * 0.78, -D * 0.68, 1.2);

    // awning along one wall (shade — and the reference's slanted light)
    const awning = new THREE.Group();
    awning.position.set(-W * 0.6, 0, 0);
    const cloth = clothMat([196, 172, 132], [2, 6]);
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(4.5, D * 1.5), cloth);
    canopy.rotation.x = Math.PI / 2 - 0.22;
    canopy.rotation.z = Math.PI / 2;
    canopy.position.set(0, 3.5, 0);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    awning.add(canopy);
    for (const z of [-D * 0.6, 0, D * 0.6]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 3.6, 8), wood);
      pole.position.set(2.1, 1.8, z);
      pole.castShadow = true;
      awning.add(pole);
      this.addCollider(pole, 0.25, 3.6, 0.25);
    }
    this.group.add(awning);

    // training dummies + weapon rack + straw bales + well + benches
    for (const [x, z, ry] of [[W * 0.45, -D * 0.2, 0.4], [-W * 0.5, D * 0.5, -0.3], [W * 0.62, D * 0.55, 0.1]]) {
      const dummy = new THREE.Group();
      dummy.position.set(x, 0, z);
      dummy.rotation.y = ry;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 9), wood);
      post.position.y = 0.95;
      post.castShadow = true;
      dummy.add(post);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.3, 5, 10), clothMat([140, 118, 84], [1, 2]));
      torso.position.y = 1.25;
      torso.castShadow = true;
      dummy.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), clothMat([150, 128, 92], [1, 1]));
      head.position.y = 1.62;
      head.castShadow = true;
      dummy.add(head);
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 7), wood);
        arm.position.set(sx * 0.3, 1.3, 0);
        arm.rotation.z = Math.PI / 2 + sx * 0.15;
        arm.castShadow = true;
        dummy.add(arm);
      }
      dummy.userData.radius = 0.4;
      this.group.add(dummy);
      this.addCollider(dummy, 0.9, 1.9, 0.9);
    }
    const rack = new THREE.Group();
    rack.position.set(W * 0.74, 0, D * 0.1);
    rack.add(box(0.16, 0.1, 2.4, wood, 0, 1.0, 0));
    for (const z of [-1.0, 1.0]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.05, 8), wood);
      leg.position.set(0, 0.52, z);
      leg.castShadow = true;
      rack.add(leg);
    }
    for (let i = 0; i < 5; i++) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.0, 7), woodMat('oak', [1, 1]));
      shaft.position.set(0.06, 1.0, -0.9 + i * 0.45);
      shaft.rotation.z = 0.28 + (rng() - 0.5) * 0.1;
      shaft.castShadow = true;
      rack.add(shaft);
    }
    this.group.add(rack);
    this.addCollider(rack, 0.8, 1.2, 2.5);

    for (const [x, z, s] of [[-W * 0.8, -D * 0.5, 1.1], [-W * 0.55, -D * 0.62, 0.9], [W * 0.9, D * 0.7, 1.0]]) {
      const bale = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 0.62 * s, 1.0 * s), flatMat(0xa89150, 0.96));
      bale.position.set(x, 0.31 * s, z);
      bale.rotation.y = rng() * TAU;
      bale.castShadow = true; bale.receiveShadow = true;
      this.group.add(bale);
      this.addCollider(bale, 1.1 * s, 0.62 * s, 1.1 * s);
    }
    const well = new THREE.Group();
    well.position.set(-W * 0.72, 0, D * 0.15);
    const wellR = 0.85;
    const wellWall = new THREE.Mesh(new THREE.CylinderGeometry(wellR, wellR * 1.05, 1.0, 18, 1, false), stoneMat('rubble', [2, 1]));
    wellWall.position.y = 0.5;
    wellWall.castShadow = true; wellWall.receiveShadow = true;
    well.add(wellWall);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(wellR * 0.8, 16), new THREE.MeshBasicMaterial({ color: 0x05070a }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = 1.001;
    well.add(hole);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.0, 0.14), wood);
      post.position.set(sx * wellR, 1.6, 0);
      post.castShadow = true;
      well.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(wellR * 2.4, 0.16, 0.18), wood);
    beam.position.y = 2.55;
    beam.castShadow = true;
    well.add(beam);
    this.group.add(well);
    this.addCollider(well, 1.9, 1.0, 1.9);

    // pennants on poles
    for (const [x, z] of [[-W * 0.95, -D * 0.9], [W * 0.95, -D * 0.9], [W * 0.95, D * 0.9]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 5.5, 8), wood);
      pole.position.set(x, 2.75, z);
      pole.castShadow = true;
      this.group.add(pole);
      const b = bannerMesh('vare', 0.8, 2.2);
      b.position.set(x + 0.5, 4.2, z);
      b.rotation.y = -0.4;
      this.group.add(b);
    }

    this.spawns.push(new THREE.Vector3(0, 0, -D * 0.35), new THREE.Vector3(0, 0, D * 0.35));
    this.playerStart.set(0, 0, -D * 0.35);
  }

  // ── 4. ROOKMOOR RAMPARTS ────────────────────────────────────────────────
  buildRamparts() {
    const rng = mulberry32(777);
    const B = this.def.bounds;
    const W = B.x * 2, D = B.z * 2;
    const walkMat = stoneMat('dungeon', [6, 3]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1), walkMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    // the deck is a platform: a long drop beyond the parapets
    const drop = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), flatMat(0x1a1d22, 1));
    drop.rotation.x = -Math.PI / 2;
    drop.position.y = -26;
    this.group.add(drop);
    const deckMat = stoneMat('rubble', [8, 1]);
    for (const s of [-1, 1]) {
      this.group.add(box(W, 26, 1.0, deckMat, 0, -13, s * (D / 2 + 0.5)));
      this.group.add(box(1.0, 26, D, deckMat, s * (W / 2 + 0.5), -13, 0));
    }
    // crenellations on both long sides
    for (const s of [-1, 1]) {
      const z = s * (D / 2 - 0.15);
      for (let i = 0; i < 18; i++) {
        const x = -W / 2 + 0.8 + i * (W - 1.6) / 17;
        const merlon = box(0.95, 1.25, 0.62, walkMat, x, 0.62, z);
        this.group.add(merlon);
        this.addCollider(merlon, 1.0, 1.3, 0.7);
      }
      const parapet = box(W, 0.75, 0.55, walkMat, 0, 0.38, z);
      this.group.add(parapet);
    }
    // end towers
    for (const sx of [-1, 1]) {
      const tower = new THREE.Group();
      tower.position.set(sx * (W / 2 - 1.6), 0, 0);
      tower.add(box(3.6, 7.5, D + 3, walkMat, 0, 3.75, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        tower.add(box(1.1, 1.4, 1.1, walkMat, Math.cos(a) * 1.5, 8.0, Math.sin(a) * (D / 2 + 0.8)));
      }
      tower.add(box(4.4, 0.5, D + 4, deckMat, 0, 7.6, 0));
      this.group.add(tower);
      this.addCollider(tower, 3.6, 7.6, D + 3);
    }
    // torch poles along the walk
    const iron = metalMat('iron', [1, 1], 0.5);
    for (const x of [-W * 0.32, 0, W * 0.32]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 8), woodMat('dark', [1, 1]));
      pole.position.set(x, 1.3, -D * 0.32);
      pole.castShadow = true;
      this.group.add(pole);
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.34, 10, 1, true), iron);
      cage.position.set(x, 2.62, -D * 0.32);
      this.group.add(cage);
      const light = new THREE.PointLight(0xff9a44, 2.4, 14, 2);
      light.position.set(x, 2.85, -D * 0.32);
      this.group.add(light);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(this.torches.length), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      fl.scale.set(0.7, 0.95, 1);
      fl.position.set(x, 2.85, -D * 0.32);
      this.group.add(fl);
      this.torches.push({ sprite: fl, light, seed: rnd() * 10, base: 2.4 });
    }
    // braziers at the ends for silhouette drama
    for (const sx of [-1, 1]) {
      const b = new THREE.Group();
      b.position.set(sx * W * 0.42, 0, D * 0.3);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.26, 0.3, 12), iron);
      bowl.position.y = 0.85;
      bowl.castShadow = true;
      b.add(bowl);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.4;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6), iron);
        leg.position.set(Math.cos(a) * 0.28, 0.45, Math.sin(a) * 0.28);
        b.add(leg);
      }
      const light = new THREE.PointLight(0xff7a2a, 2.8, 13, 2);
      light.position.y = 1.25;
      b.add(light);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(this.torches.length), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      fl.scale.set(0.95, 1.15, 1);
      fl.position.y = 1.25;
      b.add(fl);
      this.group.add(b);
      this.addCollider(b, 1.0, 1.2, 1.0);
      this.torches.push({ sprite: fl, light, seed: rnd() * 10, base: 2.8 });
    }
    // a banner snapping on the wind
    for (const sx of [-1, 1]) {
      const b = bannerMesh('rookmoor', 1.2, 2.8);
      b.position.set(sx * W * 0.22, 3.4, D / 2 - 0.4);
      b.rotation.y = Math.PI;
      this.group.add(b);
      this.banners = this.banners || [];
      this.banners.push(b);
    }
    // crates and a rope coil
    const wood = woodMat('oak', [1, 1]);
    for (const [x, z] of [[-W * 0.18, D * 0.28], [-W * 0.14, D * 0.16], [W * 0.2, -D * 0.05]]) {
      const crate = box(0.85, 0.7, 0.85, wood, x, 0.35, z);
      crate.rotation.y = rng() * 0.6;
      this.group.add(crate);
      this.addCollider(crate, 0.95, 0.75, 0.95);
    }
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 20), flatMat(0x6f5c3c, 0.95));
    coil.rotation.x = Math.PI / 2;
    coil.position.set(W * 0.28, 0.1, D * 0.2);
    coil.castShadow = true;
    this.group.add(coil);

    this.spawns.push(new THREE.Vector3(-W * 0.18, 0, 0), new THREE.Vector3(W * 0.18, 0, 0));
    this.playerStart.set(-W * 0.18, 0, 0);
    this.playerFacing = -Math.PI / 2;
  }

  // ── lighting ─────────────────────────────────────────────────────────────
  buildLighting() {
    const d = this.def;
    this.ambient = new THREE.HemisphereLight(d.ambient, 0x2a2620, d.ambientIntensity);
    this.group.add(this.ambient);
    const sun = new THREE.DirectionalLight(d.sunColor, d.sunIntensity);
    const az = d.sunAzimuth, el = d.sunElev;
    sun.position.set(Math.cos(az) * Math.cos(el) * 30, Math.sin(el) * 30 + 6, Math.sin(az) * Math.cos(el) * 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    const ext = Math.max(d.bounds.x, d.bounds.z) * 1.5;
    sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.028;
    this.group.add(sun);
    this.group.add(sun.target);
    this.sun = sun;
    // fill light so armour still reads in shadow, kept subtle
    const fill = new THREE.DirectionalLight(0x9fb4d8, d.ambientIntensity * 0.35);
    fill.position.set(-14, 12, 10);
    this.group.add(fill);
    this.scene = { fog: new THREE.Fog(d.fog, d.fogNear, d.fogFar) };
  }

  // ── per-frame life ───────────────────────────────────────────────────────
  update(dt, t, camPos) {
    for (const tr of this.torches) {
      const f = 0.82 + 0.18 * Math.sin(t * (7 + tr.seed) + tr.seed * 3) + 0.12 * Math.sin(t * (17 + tr.seed * 2));
      tr.light.intensity = tr.base * f;
      if (tr.sprite) {
        tr.sprite.scale.set(0.46 * f, 0.72 * f, 1);
        tr.sprite.material.opacity = 0.86 + f * 0.14;
      }
    }
    if (this.fireLight) {
      const f = 0.86 + 0.14 * Math.sin(t * 9.3) + 0.08 * Math.sin(t * 21.7);
      this.fireLight.intensity = (this.def.id === 'courtyard' ? 0 : this.def.id === 'hall' ? 2.4 : 3.2) * f;
      if (this.fireSprite) this.fireSprite.scale.set(1.4 * f, 1.7 * f, 1);
    }
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < this.dustData.length; i++) {
        const dd = this.dustData[i];
        let x = pos.getX(i) + dd.vx * dt, y = pos.getY(i) + dd.vy * dt, z = pos.getZ(i) + dd.vz * dt;
        if (y > 7.4) y = 0.2;
        if (Math.abs(x) > this.def.bounds.x) x = -x * 0.98;
        if (Math.abs(z) > this.def.bounds.z) z = -z * 0.98;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
    if (this.dripPoints) {
      const pos = this.dripPoints.geometry.attributes.position;
      for (let i = 0; i < this.drips.length; i++) {
        let y = pos.getY(i) - this.drips[i].v * dt;
        if (y < 0.05) { y = 3.4; pos.setX(i, (rnd() - 0.5) * this.def.bounds.x * 1.6); pos.setZ(i, (rnd() - 0.5) * this.def.bounds.z * 1.6); }
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (this.banners) {
      for (let i = 0; i < this.banners.length; i++) {
        this.banners[i].rotation.z = Math.sin(t * 0.9 + i) * 0.05;
        this.banners[i].rotation.x = Math.sin(t * 1.4 + i * 2) * 0.04;
      }
    }
    if (this.shafts) {
      for (let i = 0; i < this.shafts.length; i++) {
        const m = this.shafts[i].material;
        m.opacity = (i % 2 === 0 ? 0.46 : 0.26) + Math.sin(t * 0.6 + i) * 0.05;
      }
    }
  }
}
