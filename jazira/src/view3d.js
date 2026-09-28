// المصيّر 3D — view3d.js (Three.js)
import * as THREE from '../../vendor/three.module.js';
import { buildModels, buildPlayer, buildChicken, buildGoat, buildBoar, buildCrab, buildBoat, MAT } from './models3d.js';
import { TILE, T, KIND_DEF } from './world.js';
import { clamp, TAU, nightAmount, sunsetAmount, lerp } from './util.js';
import { hourOf } from './entities.js';

const WATER_Y = -0.1;
const H_BASE = { [T.DEEP]: -2.4, [T.SHALLOW]: -0.55, [T.SAND]: 0.05, [T.GRASS]: 0.42, [T.FOREST]: 0.5, [T.ROCK]: 1.9, [T.FRESH]: -0.6 };
const H_AMP = { [T.DEEP]: 0, [T.SHALLOW]: 0.05, [T.SAND]: 0.1, [T.GRASS]: 0.55, [T.FOREST]: 0.85, [T.ROCK]: 1.3, [T.FRESH]: 0.05 };
const COL3 = {
  [T.DEEP]: 0x1e5f7e, [T.SHALLOW]: 0x59c3c8, [T.SAND]: 0xe8d6a8, [T.GRASS]: 0x74b855,
  [T.FOREST]: 0x548a4a, [T.ROCK]: 0x9ea0a8, [T.FRESH]: 0x4fb0cf,
};
const MATS = {
  water: null, deep: null,
};

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const hashNoise = (x, y, s = 1) => hash2(Math.floor(x * s), Math.floor(y * s));

// من CSS/hex → رقم (Three.js)
function cssColor(c) {
  if (!c) return 0xffffff;
  if (c[0] === '#') return c;
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) return 0xffffff;
  const [r, g, b] = m[1].split(',').map((v) => Math.max(0, Math.min(255, parseFloat(v) | 0)));
  return (r << 16) | (g << 8) | b;
}

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s3 = new THREE.Vector3();
const _e3 = new THREE.Euler();
const _c3 = new THREE.Color();

const SPRITE_MODEL = {
  palm: 'palm1', tree: 'tree1', tree1r: 'tree1r', tree2: 'tree2', tree2r: 'tree2r',
  bush: 'bush', bushBerry: 'bushBerry', tuft: 'tuft', flower: 'flowerA',
  rock: 'rockA', pebble: 'pebble', reeds: 'reeds',
};

export class View3D {
  constructor(opts = {}) {
    this.type = '3d';
    this.shadows = opts.shadows ?? true;
    this.autoAttach = opts.autoAttach !== false;
    this.pixelRatio = opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 1.6);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camYaw = Math.PI * 0.15;
    this.camPitch = 0.72;
    this.camDist = 17;
    this.camTarget = new THREE.Vector3();
    this.map = new Map();          // objId → { mesh, index, base }
    this.animalModels = new Map(); // animal → model
    this.itemMeshes = new Map();
    this.puff = [];
    this.ready = false;
    this.frameCount = 0;
  }

  // ============================================================
  //  بناء المشهد (ما كيحتاجش WebGL — كيخدم حتى فالاختبارات)
  // ============================================================
  disposeScene() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) if (m && m !== MAT && m.dispose) m.dispose();
    });
    this.map.clear();
    this.animalModels.clear();
    this.itemMeshes.clear();
    this.structs.clear();
    this.fireLights = [];
    this.stumps = null;
    this.stumpMesh = null;
    this.boat = null;
    this.beacon = null;
    this.pMesh = null;
    this.ready = false;
  }

  buildScene(game) {
    if (this.scene && this.ready) this.disposeScene();
    const w = game.world;
    this.world = w;
    this.game = game;
    this.models = buildModels();
    this.scene = new THREE.Scene();

    // ---- إضاءة ----
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a6b3a, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
    this.sun.position.set(20, 40, 12);
    if (this.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = -24; c.right = 24; c.top = 24; c.bottom = -24; c.near = 1; c.far = 130;
      this.sun.shadow.bias = -0.0012;
    }
    this.scene.add(this.sun, this.sun.target);
    this.amb = new THREE.AmbientLight(0xffffff, 0.32);
    this.scene.add(this.amb);

    // ---- السماء والضباب ----
    this.skyColor = new THREE.Color(0x8fd0f0);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(0x8fd0f0, 46, 135);

    // ---- النجوم ----
    {
      const n = 420, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, e = Math.random() * 0.9 + 0.1;
        const r = 200;
        pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
        pos[i * 3 + 1] = Math.sin(e) * r;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.starMat = new THREE.PointsMaterial({ size: 2.6, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
      this.stars = new THREE.Points(g, this.starMat);
      this.scene.add(this.stars);
    }

    this.buildTerrain(w);
    this.buildWater(w);
    this.buildObjects(game);
    this.buildStructures(game);
    this.buildPlayerModel(game);
    this.initParticles();
    this.ready = true;
    return this;
  }

  // ---------- الأرض ----------
  buildTerrain(w) {
    const W = w.w + 1, H = w.h + 1;
    const heights = new Float32Array(W * H);
    const colors = new Float32Array(W * H * 3);
    const c = new THREE.Color();

    const tileH = (tx, ty) => {
      const t = w.tileAt(tx, ty);
      const base = H_BASE[t] ?? 0.4;
      const amp = H_AMP[t] ?? 0.4;
      if (amp === 0) return base;
      const n = hashNoise(tx, ty, 0.35) * 0.65 + hashNoise(tx, ty, 0.12) * 0.35;
      return base + (n - 0.5) * amp;
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, cnt = 0;
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 0; dy++)
          for (let dx = -1; dx <= 0; dx++) {
            const tx = x + dx, ty = y + dy;
            if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) continue;
            sum += tileH(tx, ty); cnt++;
            const t = w.tileAt(tx, ty);
            c.set(COL3[t] ?? 0x74b855);
            const v = ((w.var[w.idx(tx, ty)] || 128) / 255 - 0.5) * 0.14;
            r += c.r + v * c.r; g += c.g + v * c.g; b += c.b + v * c.b;
          }
        const i = y * W + x;
        heights[i] = cnt ? sum / cnt : -2.4;
        colors[i * 3] = r / (cnt || 1);
        colors[i * 3 + 1] = g / (cnt || 1);
        colors[i * 3 + 2] = b / (cnt || 1);
      }
    }
    this.heights = heights;
    this.hW = W; this.hH = H;

    const pos = new Float32Array(W * H * 3);
    const col = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      pos[i * 3] = i % W;                      // بالوحدة: بلاطة = 1
      pos[i * 3 + 1] = heights[i];
      pos[i * 3 + 2] = Math.floor(i / W);
      col[i * 3] = colors[i * 3];
      col[i * 3 + 1] = colors[i * 3 + 1];
      col[i * 3 + 2] = colors[i * 3 + 2];
    }
    const idx = [];
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const a = y * W + x, b = y * W + x + 1, cc = (y + 1) * W + x, d = (y + 1) * W + x + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = this.shadows;
    // نمركزو الجزيرة باش الكاميرا تكون فالوسط: البلاصة 0,0 فالوسط
    this.terrain.position.set(-w.w / 2, 0, -w.h / 2);
    this.offsetX = -w.w / 2;
    this.offsetZ = -w.h / 2;
    this.scene.add(this.terrain);
  }

  buildWater(w) {
    const seg = 60;
    const geo = new THREE.PlaneGeometry(w.w + 30, w.h + 30, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.waterBase = geo.attributes.position.array.slice();
    const mat = new THREE.MeshLambertMaterial({ color: 0x2e93b8, transparent: true, opacity: 0.78, depthWrite: false });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set(0, WATER_Y, 0);
    this.water.renderOrder = 1;
    this.scene.add(this.water);

    // ما عميق تحت (باش يبان غامق)
    const deepGeo = new THREE.PlaneGeometry(w.w + 60, w.h + 60);
    deepGeo.rotateX(-Math.PI / 2);
    this.deep = new THREE.Mesh(deepGeo, new THREE.MeshBasicMaterial({ color: 0x0d3a52, fog: true }));
    this.deep.position.set(0, -3.4, 0);
    this.scene.add(this.deep);
  }

  // ---------- الأغراض ----------
  buildObjects(game) {
    const byKind = new Map();
    for (const o of game.world.objs) {
      if (KIND_DEF[o.kind] && KIND_DEF[o.kind].built) continue;
      const model = o.kind === 'rock' ? (o.variant ? 'rockB' : 'rockA') : (SPRITE_MODEL[o.kind] || null);
      if (!model || !this.models[model]) continue;
      if (!byKind.has(model)) byKind.set(model, []);
      byKind.get(model).push(o);
    }
    this.instanced = [];
    for (const [model, objs] of byKind) {
      const geo = this.models[model];
      const mesh = new THREE.InstancedMesh(geo, MAT, objs.length);
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      objs.forEach((o, i) => {
        const s = 0.85 + hash2(o.x | 0, o.y | 0) * 0.3;
        this.map.set(o.id, { mesh, index: i, model, obj: o, scale: s, rot: hash2(o.y | 0, o.x | 0) * TAU, depleted: !!o.depleted });
        this.writeInstance(o, s);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.instanced.push(mesh);
    }
    this.frustumObjects = new THREE.Group();
  }

  writeInstance(o, scale) {
    const rec = this.map.get(o.id);
    if (!rec) return;
    rec.depleted = !!o.depleted;
    if (o.depleted && rec.model !== 'stump') {
      // جذع بدل الشجرة المقطوعة
      const isTree = rec.model.startsWith('tree') || rec.model.startsWith('palm');
      if (isTree) {
        this.showStump(o);
        rec.mesh.setMatrixAt(rec.index, new THREE.Matrix4().makeScale(0, 0, 0));
      } else {
        rec.mesh.setMatrixAt(rec.index, _m4.makeScale(0, 0, 0));
      }
      rec.mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    const g = this.groundAtPx(o.x, o.y);
    _m4.compose(
      _v3.set(o.x / TILE + this.offsetX, g - 0.05, o.y / TILE + this.offsetZ),
      _q.setFromEuler(_e3.set(0, rec.rot, 0)),
      _s3.set(scale, scale, scale),
    );
    rec.mesh.setMatrixAt(rec.index, _m4);
    rec.mesh.instanceMatrix.needsUpdate = true;
    if (this.stumps && this.stumps.has(o.id)) {
      this.stumps.get(o.id).visible = false;
    }
  }

  showStump(o) {
    if (!this.stumps) {
      this.stumps = new Map();
      this.stumpMesh = new THREE.InstancedMesh(this.models.stump, MAT, 400);
      this.stumpMesh.castShadow = this.shadows;
      this.stumpMesh.count = 0;
      this.scene.add(this.stumpMesh);
      this.stumpCount = 0;
    }
    if (this.stumps.has(o.id)) { this.stumps.get(o.id).visible = true; return; }
    if (this.stumpCount >= 400) return;
    const g = this.groundAtPx(o.x, o.y);
    _m4.compose(
      _v3.set(o.x / TILE + this.offsetX, g - 0.02, o.y / TILE + this.offsetZ),
      _q.identity(), _s3.set(1, 1, 1));
    this.stumps.set(o.id, { visible: true });
    this.stumpMesh.setMatrixAt(this.stumpCount, _m4);
    this.stumps.get(o.id).index = this.stumpCount;
    this.stumpCount++;
    this.stumpMesh.count = this.stumpCount;
    this.stumpMesh.instanceMatrix.needsUpdate = true;
  }

  // الأغراض اللي تبدلت (تقطعت ولا رجعت)
  syncInstances(game) {
    for (const [, rec] of this.map) {
      if (!!rec.obj.depleted !== rec.depleted) this.writeInstance(rec.obj, rec.scale);
    }
  }

  // ---------- البنايات ----------
  buildStructures(game) {
    this.structs = new Map();
    for (const kind of ['hut', 'coop', 'bench']) {
      for (const o of game.world.structs(kind)) this.addStructure(o);
    }
    this.fireLights = [];
    this.syncCampfires(game);
    this.syncBoat(game);
  }

  addStructure(o) {
    const model = this.models[o.kind];
    if (!model) return null;
    const mesh = new THREE.Mesh(model, MAT);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.position.set(o.x / TILE + this.offsetX, this.groundAtPx(o.x, o.y) - 0.05, o.y / TILE + this.offsetZ);
    mesh.rotation.y = hash2(o.y | 0, o.x | 0) * 0.6;
    this.scene.add(mesh);
    this.structs.set(o.id, { mesh, obj: o, kind: o.kind });
    return mesh;
  }

  syncStructures(game) {
    for (const kind of ['hut', 'coop', 'bench']) {
      for (const o of game.world.structs(kind)) {
        if (!this.structs.has(o.id)) this.addStructure(o);
      }
    }
  }

  syncCampfires(game) {
    for (const o of game.world.structs('campfire')) {
      if (this.structs.has(o.id)) continue;
      this.addStructure(o);
      const g = this.groundAtPx(o.x, o.y);
      const px = o.x / TILE + this.offsetX, pz = o.y / TILE + this.offsetZ;
      // النار
      const fire = new THREE.Group();
      const g1 = new THREE.ConeGeometry(0.5, 1.15, 6);
      const m1 = new THREE.MeshLambertMaterial({ color: 0xff7a20, emissive: 0xff6a10, emissiveIntensity: 0.9, transparent: true, opacity: 0.92, flatShading: true });
      const c1 = new THREE.Mesh(g1, m1); c1.position.y = 0.6;
      const g2 = new THREE.ConeGeometry(0.28, 0.7, 6);
      const m2 = new THREE.MeshLambertMaterial({ color: 0xffe08a, emissive: 0xffc040, emissiveIntensity: 1.2, flatShading: true });
      const c2 = new THREE.Mesh(g2, m2); c2.position.y = 0.5;
      fire.add(c1, c2);
      fire.position.set(px, g + 0.1, pz);
      this.scene.add(fire);
      const light = new THREE.PointLight(0xff9a33, 0, 30, 1.35);
      light.position.set(px, g + 1.4, pz);
      this.scene.add(light);
      this.fireLights.push({ fire, light, o, g, c1, c2 });
    }
  }

  syncBoat(game) {
    const o = game.world.struct('boat');
    if (!o) return;
    if (!this.boat) {
      const { root, parts } = buildBoat();
      root.position.set(o.x / TILE + this.offsetX, this.groundAtPx(o.x, o.y) - 0.2, o.y / TILE + this.offsetZ);
      root.rotation.y = hash2((o.x | 0) + 7, o.y | 0) * 0.8;
      root.traverse((m) => { if (m.isMesh) { m.castShadow = this.shadows; } });
      this.scene.add(root);
      this.boat = { root, parts, obj: o };
      // عمود ضوا فوق القارب
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 40, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.16, depthWrite: false, fog: false })
      );
      beacon.position.copy(root.position);
      beacon.position.y = 20;
      this.scene.add(beacon);
      this.beacon = beacon;
    }
    const p = this.boat.obj.progress ?? 0;
    this.boat.parts.hull.visible = p > 0.02;
    this.boat.parts.mast.visible = p > 0.5;
    this.boat.parts.ropes.visible = p > 0.68;
    this.boat.parts.sail.visible = p > 0.85;
  }

  // ---------- الشخصيات ----------
  buildPlayerModel(game) {
    const m = buildPlayer();
    m.root.traverse((o) => { if (o.isMesh) o.castShadow = this.shadows; });
    this.scene.add(m.root);
    this.playerModel = m;
  }

  // النماذج كيتبناو مرة وحدة وكتّنسخ (الهندسة والمواد مشتركة = أداء أحسن)
  animalTemplate(key, build) {
    if (!this.animalTemplates) this.animalTemplates = new Map();
    if (!this.animalTemplates.has(key)) this.animalTemplates.set(key, build());
    return this.animalTemplates.get(key);
  }

  makeAnimalModel(a) {
    let key, build;
    if (a.type === 'chicken') { key = 'chicken' + (a.variant ? 1 : 0); build = () => buildChicken(a.variant); }
    else if (a.type === 'goat') { key = 'goat'; build = buildGoat; }
    else if (a.type === 'boar') { key = 'boar'; build = buildBoar; }
    else { key = 'crab'; build = buildCrab; }

    const template = this.animalTemplate(key, build);
    const root = template.root.clone(true);      // نفس الهندسة، أجزاء جديدة للأنيميشن
    const parts = {};
    for (const n of ['legL', 'legR', 'legL2', 'legR2', 'clawL', 'clawR', 'body']) {
      const o = root.getObjectByName(n);
      if (o) parts[n] = o;
    }
    root.traverse((o) => { if (o.isMesh) o.castShadow = this.shadows; });
    // النماذج مصممة كتشوف +X، واللاعب كيشوف +Z — نوحّدوهم
    const inner = new THREE.Group();
    inner.rotation.y = -Math.PI / 2;
    [...root.children].forEach((c) => inner.add(c));
    root.add(inner);
    const m = { root, parts, inner, height: template.height };
    this.scene.add(root);
    return m;
  }

  syncAnimals(game) {
    const alive = new Set();
    for (const a of game.world.animals) {
      alive.add(a);
      if (!this.animalModels.has(a)) this.animalModels.set(a, this.makeAnimalModel(a));
    }
    for (const [a, m] of this.animalModels) {
      if (!alive.has(a)) { this.scene.remove(m.root); this.animalModels.delete(a); }
    }
  }

  // ---------- العناصر المرمية ----------
  itemGeo(kind) {
    switch (kind) {
      case 'wood': return new THREE.BoxGeometry(0.34, 0.16, 0.16);
      case 'stone': return new THREE.IcosahedronGeometry(0.16, 0);
      case 'fiber': return new THREE.ConeGeometry(0.14, 0.4, 5);
      case 'seed': return new THREE.SphereGeometry(0.09, 6, 5);
      case 'coconut': return new THREE.SphereGeometry(0.17, 8, 6);
      case 'egg': return new THREE.SphereGeometry(0.13, 8, 6);
      case 'meat': return new THREE.BoxGeometry(0.28, 0.14, 0.2);
      case 'cooked': return new THREE.BoxGeometry(0.3, 0.16, 0.22);
      case 'omelette': return new THREE.CylinderGeometry(0.2, 0.2, 0.07, 8);
      case 'resin': return new THREE.IcosahedronGeometry(0.14, 0);
      case 'rope': return new THREE.TorusGeometry(0.14, 0.05, 5, 8);
      case 'sail': return new THREE.BoxGeometry(0.4, 0.36, 0.05);
      default: return new THREE.SphereGeometry(0.14, 6, 5);
    }
  }
  itemColor(kind) {
    return ({
      wood: 0x8a5e34, stone: 0x9aa0a6, fiber: 0x7cae3f, seed: 0xe8cf6a, coconut: 0x6b4423,
      egg: 0xfdf6e3, meat: 0xc74a3f, cooked: 0xa8562e, omelette: 0xf2c14e, resin: 0xe0a13c,
      rope: 0xc9a86a, sail: 0xf6f1e2,
    })[kind] || 0xffffff;
  }

  syncItems(game) {
    const pools = new Map();
    for (const it of game.items) {
      if (!pools.has(it.kind)) pools.set(it.kind, []);
      pools.get(it.kind).push(it);
    }
    for (const [kind, list] of pools) {
      let mesh = this.itemMeshes.get(kind);
      if (!mesh) {
        mesh = new THREE.InstancedMesh(this.itemGeo(kind), new THREE.MeshLambertMaterial({ color: this.itemColor(kind), flatShading: true }), 40);
        mesh.castShadow = this.shadows;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        this.scene.add(mesh);
        this.itemMeshes.set(kind, mesh);
      }
      const n = Math.min(list.length, 40);
      for (let i = 0; i < n; i++) {
        const it = list[i];
        const y = this.groundAtPx(it.x, it.y) + 0.35 + Math.sin(game.time * 3 + it.x * 0.1) * 0.08;
        _m4.compose(
          _v3.set(it.x / TILE + this.offsetX, y, it.y / TILE + this.offsetZ),
          _q.setFromEuler(_e3.set(0, game.time * 1.6 + it.x * 0.05, 0)),
          _s3.set(1, 1, 1));
        mesh.setMatrixAt(i, _m4);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [kind, mesh] of this.itemMeshes) {
      if (!pools.has(kind)) mesh.count = 0;
    }
  }

  // ---------- الجزيئات ----------
  initParticles() {
    const geo = new THREE.IcosahedronGeometry(0.11, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.pMesh = new THREE.InstancedMesh(geo, mat, 500);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.count = 0;
    this.pMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(500 * 3), 3);
    this.pMesh.frustumCulled = false;
    this.scene.add(this.pMesh);
    this._col = new THREE.Color();
  }

  syncParticles(game) {
    const parts = game.fx.parts;
    const n = Math.min(parts.length, 500);
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      const life = clamp(p.life / p.max, 0, 1);
      const s = clamp((p.size || 3) / 3, 0.25, 2.4) * (0.5 + life * 0.7);
      const y = this.groundAtPx(p.x, p.y) + 0.4;
      _m4.compose(
        _v3.set(p.x / TILE + this.offsetX, y, p.y / TILE + this.offsetZ),
        _q.identity(),
        _s3.set(s, s, s));
      this.pMesh.setMatrixAt(i, _m4);
      this._col.set(cssColor(p.color));
      this.pMesh.instanceColor.setXYZ(i, this._col.r, this._col.g, this._col.b);
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    this.pMesh.instanceColor.needsUpdate = true;
  }

  // ---------- الأرض: حساب الارتفاع ----------
  groundAtPx(x, y) {
    if (!this.heights) return 0;
    const fx = clamp(x / TILE, 0, this.hW - 1.001);
    const fy = clamp(y / TILE, 0, this.hH - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const h = this.heights;
    const H00 = h[y0 * this.hW + x0], H10 = h[y0 * this.hW + x0 + 1];
    const H01 = h[(y0 + 1) * this.hW + x0], H11 = h[(y0 + 1) * this.hW + x0 + 1];
    return lerp(lerp(H00, H10, tx), lerp(H01, H11, tx), ty);
  }
  // بلاصة اللاعب فتلات العالم
  worldPos(px, py) { return new THREE.Vector3(px / TILE + this.offsetX, this.groundAtPx(px, py), py / TILE + this.offsetZ); }

  // ============================================================
  //  التشغيل فالمتصفح
  // ============================================================
  attach(canvas, game) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.bindCameraControls();
    this.resize();
  }

  bindCameraControls() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0, pointers = new Map(), pinch = 0, manualT = -99;
    const rot = (dx, dy) => {
      this.camYaw -= dx * 0.006;
      this.camPitch = clamp(this.camPitch + dy * 0.004, 0.28, 1.25);
      manualT = this.game ? this.game.time : 0;
      this.manualT = manualT;
    };
    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
      }
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.camDist = clamp(this.camDist * (pinch / d), 7, 34);
        pinch = d;
        return;
      }
      if (!dragging) return;
      rot(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { dragging = false; pinch = 0; }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 1.4, 7, 34);
    }, { passive: false });

    // لوحة المفاتيح للكاميرا
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'q') { this.camYaw += 0.12; this.manualT = this.game ? this.game.time : 0; }
      if (k === 'e') { this.camYaw -= 0.12; this.manualT = this.game ? this.game.time : 0; }
      if (k === 'z') { this.camDist = clamp(this.camDist - 1.5, 7, 34); }
      if (k === 'x') { this.camDist = clamp(this.camDist + 1.5, 7, 34); }
    });
  }

  resize() {
    if (!this.renderer) return;
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(this.pixelRatio, 2));
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  setQuality(shadows) {
    this.shadows = shadows;
    if (this.renderer) this.renderer.shadowMap.enabled = shadows;
    if (this.sun) this.sun.castShadow = shadows;
    if (this.terrain) this.terrain.receiveShadow = shadows;
    for (const m of this.instanced || []) m.castShadow = shadows;
    if (this.stumpMesh) this.stumpMesh.castShadow = shadows;
  }

  transformInput(ix, iy) {
    // حركة بالنسبة للكاميرا
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const fwd = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2).negate();
    let vx = right.x * ix + fwd.x * -iy;
    let vz = right.z * ix + fwd.z * -iy;
    const len = Math.hypot(vx, vz);
    if (len > 0.0001) { vx /= len; vz /= len; }
    return { x: vx, y: vz };
  }

  // ============================================================
  //  الرسم
  // ============================================================
  render(game, dt = 0.016) {
    if (!this.renderer || !this.ready) return;
    this.updateScene(game, dt);
    this.renderer.render(this.scene, this.camera);
  }

  // كلشي كيتحرك فالوقت — بلا WebGL (كيخدم حتى فالاختبارات)
  updateScene(game, dt = 0.016) {
    if (!this.ready) return;
    const p = game.player, w = game.world;

    // --- الشمس والجو ---
    const hour = hourOf(w.time);
    const night = nightAmount(hour);
    const sunset = sunsetAmount(hour);
    const daySky = new THREE.Color(0x8fd0f0), setSky = new THREE.Color(0xf0a35c), nightSky = new THREE.Color(0x0a1330);
    const sky = daySky.clone().lerp(setSky, sunset).lerp(nightSky, night);
    this.skyColor.copy(sky);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = lerp(70, 26, night);
    this.scene.fog.far = 140;
    const ang = ((hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.max(0.12, Math.sin(ang)), 0.35).normalize();
    const pPos = this.worldPos(p.x, p.y);
    this.sun.position.copy(pPos).addScaledVector(sunDir, 45);
    this.sun.target.position.copy(pPos);
    this.sun.target.updateMatrixWorld();
    const warm = new THREE.Color(0xfff3d6).lerp(new THREE.Color(0xff9c4a), sunset).lerp(new THREE.Color(0x9db4ff), night);
    this.sun.color.copy(warm);
    this.sun.intensity = lerp(1.15, 0.14, night);
    this.hemi.intensity = lerp(0.72, 0.24, night);
    this.amb.intensity = lerp(0.3, 0.16, night);
    this.starMat.opacity = clamp(night * 1.2 - 0.15, 0, 1);
    this.stars.position.set(pPos.x, 0, pPos.z);

    // --- الما ---
    if (this.water) {
      const pos = this.water.geometry.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] = Math.sin(x * 0.35 + game.time * 0.9) * 0.09 + Math.cos(z * 0.28 + game.time * 0.7) * 0.07;
      }
      pos.needsUpdate = true;
    }

    // --- اللاعب ---
    const pm = this.playerModel;
    if (pm) {
      const y = this.groundAtPx(p.x, p.y) + (p.splash > 0 ? -0.12 : 0);
      pm.root.position.set(p.x / TILE + this.offsetX, y, p.y / TILE + this.offsetZ);
      pm.root.rotation.y = Math.PI / 2 - p.dir;
      const walking = p.speedScale > 0.05;
      const ph = p.walkPhase * 2;
      const sw = walking ? Math.sin(ph) * 0.7 : Math.sin(game.time * 2) * 0.05;
      pm.parts.legL.rotation.x = sw;
      pm.parts.legR.rotation.x = -sw;
      pm.parts.armL.rotation.x = -sw * 0.8;
      const act = p.actAnim;
      pm.parts.armR.rotation.x = walking ? sw * 0.8 : Math.sin(game.time * 2) * 0.05;
      pm.parts.armR.rotation.x -= act * 1.5;
      pm.parts.head.rotation.y = Math.sin(game.time * 0.8) * 0.15;
      pm.parts.axe.visible = p.tool === 'axe';
      pm.parts.pick.visible = p.tool === 'pick';
      pm.parts.axe.rotation.x = -0.45 - act * 0.9;
      pm.parts.pick.rotation.x = -0.45 - act * 0.9;
      pm.root.position.y += walking ? Math.abs(Math.sin(ph)) * 0.045 : Math.sin(game.time * 2.2) * 0.02;
      // الظل تحت اللاعب
      pm.root.visible = true;
    }

    // --- الحيوانات ---
    this.syncAnimals(game);
    for (const a of w.animals) {
      const m = this.animalModels.get(a);
      if (!m) continue;
      const g0 = this.groundAtPx(a.x, a.y);
      const inWater = w.tileAtWorld(a.x, a.y) === T.FRESH;
      m.root.position.set(a.x / TILE + this.offsetX, g0 + (inWater ? -0.2 : 0), a.y / TILE + this.offsetZ);
      m.root.rotation.y = Math.PI / 2 - a.dir;
      const walk = a.state === 'chase' || a.state === 'flee' || a.state === 'follow' || a.state === 'toCoop';
      const sp = walk ? 2.2 : 1.1;
      const sw = Math.sin(a.bob * sp) * (walk ? 0.65 : 0.18);
      if (m.parts.legL) m.parts.legL.rotation.x = sw;
      if (m.parts.legR) m.parts.legR.rotation.x = -sw;
      if (m.parts.legL2) m.parts.legL2.rotation.x = -sw;
      if (m.parts.legR2) m.parts.legR2.rotation.x = sw;
      if (m.parts.body) {
        const peck = a.type === 'chicken' && a.state === 'wander' && Math.sin(a.t * 1.4) > 0.75 ? 0.35 : 0;
        m.parts.body.rotation.x = peck;
        m.parts.body.position.y = Math.abs(Math.sin(a.bob * sp)) * 0.04;
      }
      if (m.parts.clawL) m.parts.clawL.rotation.x = Math.sin(a.bob * 4) * 0.4;
      if (m.parts.clawR) m.parts.clawR.rotation.x = -Math.sin(a.bob * 4) * 0.4;
      // وشاح الدجاجة الموالفة
      if (a.type === 'chicken' && a.tamed) {
        if (!m.ribbon) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.18), new THREE.MeshLambertMaterial({ color: 0xe2564a }));
          r.position.set(0, 0.72, 0);
          m.root.add(r);
          m.ribbon = r;
        }
      }
    }

    // --- النار ---
    for (const f of this.fireLights) {
      const flick = 0.85 + Math.sin(game.time * 9) * 0.12 + Math.sin(game.time * 21) * 0.05;
      f.c1.scale.set(flick, flick + 0.1, flick);
      f.c2.scale.set(flick, flick, flick);
      f.c1.rotation.y = game.time * 2;
      f.light.intensity = lerp(1.6, 14, night) * flick;
    }

    // --- القارب ---
    this.syncBoat(game);
    if (this.beacon) {
      const boat = game.world.struct('boat');
      const far = boat && Math.hypot(boat.x - p.x, boat.y - p.y) > 400;
      this.beacon.visible = !!far;
      if (far) this.beacon.material.opacity = 0.10 + 0.06 * Math.sin(game.time * 3);
    }

    // --- الأغراض، البنايات، العناصر والجزيئات ---
    this.syncInstances(game);
    this.syncStructures(game);
    this.syncCampfires(game);
    this.syncItems(game);
    this.syncParticles(game);

    // --- الكاميرا ---
    this.updateCamera(game, dt);
  }

  updateCamera(game, dt) {
    const p = game.player;
    if (game.state === 'menu') this.camYaw += dt * 0.12;   // دوران هادي فالقائمة
    const target = this.worldPos(p.x, p.y);
    target.y += 1.3;
    const k = 1 - Math.pow(0.0015, dt);
    this.camTarget.lerp(target, k);

    // تتبع تلقائي من ورا اللاعب
    const moving = Math.hypot(game.input.x, game.input.y) > 0.2;
    const sinceManual = (game.time || 0) - (this.manualT ?? -99);
    if (moving && sinceManual > 1.1) {
      const want = Math.atan2(-game.moveDir.x, -game.moveDir.y);
      let d = ((want - this.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.camYaw += d * Math.min(1, dt * 1.5);
    }

    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const off = new THREE.Vector3(Math.sin(this.camYaw) * cp, sp, Math.cos(this.camYaw) * cp).multiplyScalar(this.camDist);
    const camPos = this.camTarget.clone().add(off);
    const minY = this.groundAtPx((camPos.x - this.offsetX) * TILE, (camPos.z - this.offsetZ) * TILE) + 1.1;
    if (camPos.y < minY) camPos.y = minY;
    this.camera.position.lerp(camPos, 1 - Math.pow(0.0009, dt));
    this.camera.lookAt(this.camTarget.x, this.camTarget.y + 0.6, this.camTarget.z);
  }

  dispose() {
    if (this.renderer) this.renderer.dispose();
  }
}
