// resource.js — interactive harvestable nodes (instanced, individually removable)
// Node types match the names Survival.harvest() understands:
//   tree | palm | bush | rock | cactus | driftwood | shell | wreck | supply | radio_crate
import * as THREE from 'three';
import { Mesher, addPalm, addPine, addBush, addRock, addCactus, addDriftwood, addFishingBoat } from './city.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry32, rand, TAU } from './util.js';

// geometry variants per gameplay type
const VARIANTS = {
  tree: {
    pine: { gen: (ctx, rng, o) => addPine(ctx, rng, { ...o, kind: 'pine' }), hp: 6, scale: [0.75, 1.3] },
    oak: { gen: (ctx, rng, o) => addPine(ctx, rng, { ...o, kind: 'oak' }), hp: 5, scale: [0.7, 1.15] },
  },
  palm: { main: { gen: addPalm, hp: 5, scale: [0.85, 1.2] } },
  bush: { main: { gen: addBush, hp: 3, scale: [0.8, 1.4] } },
  rock: { main: { gen: (ctx, rng, o) => addRock(ctx, rng, { ...o, y: o.y + 0.25 }), hp: 4, scale: [0.7, 1.8] } },
  cactus: { main: { gen: addCactus, hp: 3, scale: [0.8, 1.2] } },
  driftwood: { main: { gen: addDriftwood, hp: 2, scale: [1, 1] } },
  shell: { main: { gen: addDriftwood, hp: 1, scale: [0.4, 0.6] } },
  wreck: { main: { gen: (ctx, rng, o) => addFishingBoat(ctx, rng, { ...o, scale: o.scale * 0.9 }), hp: 4, scale: [0.8, 1.1] } },
};
const NODE_HP = { tree: 6, palm: 5, bush: 3, rock: 4, cactus: 3, driftwood: 2, shell: 1, wreck: 4 };

/** merged geometry buckets for one node variant */
function variantGeometries(gen, seed, nodeScale) {
  const m = new Mesher();
  const ctx = { m, colliders: [], lights: [], fireSpots: [], waterfalls: [] };
  const rng = mulberry32(seed);
  gen(ctx, rng, { x: 0, y: 0, z: 0, scale: nodeScale, rotY: 0 });
  const out = {};
  for (const [key, geos] of m.parts) {
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    if (merged) out[key] = merged;
  }
  return out;
}

export class ResourceField {
  constructor(scene, world, mats, quality = 'high') {
    this.scene = scene; this.world = world; this.mats = mats; this.quality = quality;
    this.rng = mulberry32(8080);
    this.nodes = [];
    this.instances = new Map();      // variantKey → { parts: [{mat, mesh}], list: [] }
    this.group = new THREE.Group();
    this.group.name = 'resources';
    scene.add(this.group);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._zero = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    this.stumps = new THREE.Group();
    this.stumps.name = 'stumps';
    this.group.add(this.stumps);
  }

  _vset(type, variantName) {
    const key = type + '/' + variantName;
    let set = this.instances.get(key);
    if (set) return set;
    const spec = (VARIANTS[type] || {})[variantName];
    if (!spec) return null;
    const geos = variantGeometries(spec.gen, 1234 + key.length * 77, 1);
    const parts = [];
    for (const gk in geos) {
      const mat = this.mats[gk] || this.mats.rockPlain || this.mats.wood;
      const mesh = new THREE.InstancedMesh(geos[gk], mat, 420);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      parts.push({ key: gk, mesh, count: 0 });
    }
    set = { key, type, variant: variantName, parts, list: [] };
    this.instances.set(key, set);
    return set;
  }

  /** add one node; `type` is the gameplay type, `variant` picks the mesh */
  add(type, x, z, opts = {}) {
    const variantName = opts.variant || Object.keys(VARIANTS[type] || {})[0] || 'main';
    const set = this._vset(type, variantName);
    if (!set) return null;
    const spec = VARIANTS[type][variantName];
    const y = opts.y !== undefined ? opts.y : this.world.heightAt(x, z);
    const scale = opts.scale !== undefined ? opts.scale
      : rand(this.rng, spec.scale[0], spec.scale[1]);
    const yaw = opts.rotY !== undefined ? opts.rotY : this.rng() * TAU;
    const index = set.list.length;
    const self = this;
    const node = {
      type, variant: variantName, x, y, z,
      hp: NODE_HP[type] ?? spec.hp, maxHp: NODE_HP[type] ?? spec.hp,
      depleted: false, scale, yaw, index, kind: 'resource', field: self, _visible: true,
      get visible() { return this._visible; },
      set visible(v) { this._visible = !!v; if (!v) self.hide(this); },
      get obj() { return this; },     // Survival.harvest does `r.obj.visible = false`
    };
    this._q.setFromAxisAngle(this._up, yaw);
    this._m.compose(this._v.set(x, y, z), this._q, this._s.set(scale, scale, scale));
    for (const p of set.parts) {
      p.mesh.setMatrixAt(p.count, this._m);
      p.count++;
      p.mesh.count = p.count;
      p.mesh.instanceMatrix.needsUpdate = true;
    }
    set.list.push(node);
    this.nodes.push(node);
    return node;
  }

  /** remove a node from the world and leave a stump / debris pile */
  hide(node) {
    if (!node || node.depleted) return;
    node.depleted = true;
    node._visible = false;
    const set = node.field.instances.get(node.type + '/' + node.variant);
    if (set) {
      for (const p of set.parts) {
        p.mesh.setMatrixAt(node.index, this._zero);
        p.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (node.type === 'tree' || node.type === 'palm') {
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16 * node.scale, 0.22 * node.scale, 0.32, 6),
        this.mats.bark || this.mats.wood);
      stump.position.set(node.x, node.y + 0.15, node.z);
      stump.castShadow = true;
      this.stumps.add(stump);
    } else if (node.type === 'rock') {
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 * node.scale, 0), this.mats.rockPlain || this.mats.rock);
        const a = this.rng() * TAU, r = rand(this.rng, 0.3, 0.8);
        g.position.set(node.x + Math.cos(a) * r, node.y + 0.1, node.z + Math.sin(a) * r);
        g.castShadow = true;
        this.stumps.add(g);
      }
    }
  }

  scatter() {
    const rng = this.rng;
    const w = this.world;
    const low = this.quality === 'low';
    // ---- palms along the coast
    for (let i = 0; i < (low ? 44 : 96); i++) {
      const z = rand(rng, -1000, 1000);
      const x = w.coastX(z) + rand(rng, 22, 140);
      const y = w.heightAt(x, z);
      if (y < 1.2 || y > 13) continue;
      this.add('palm', x, z, { y, scale: rand(rng, 0.85, 1.15) });
    }
    // ---- bushes, rocks and cacti on the plain
    for (let i = 0; i < (low ? 90 : 230); i++) {
      const x = rand(rng, -160, 800), z = rand(rng, -1100, 1100);
      const y = w.heightAt(x, z);
      if (y < 4 || y > 76) continue;
      const r = rng();
      if (r < 0.55) this.add('bush', x, z, { y });
      else if (r < 0.86) this.add('rock', x, z, { y });
      else this.add('cactus', x, z, { y });
    }
    // ---- trees on the mountain (pine + oak variants)
    for (let i = 0; i < (low ? 170 : 420); i++) {
      const x = rand(rng, 380, 1270), z = rand(rng, -1200, 1200);
      const y = w.heightAt(x, z);
      if (y < 14 || y > 330) continue;
      if (w.slopeAt(x, z) > 0.62) continue;
      this.add('tree', x, z, { y, variant: rng() < 0.62 ? 'pine' : 'oak' });
    }
    // ---- driftwood, shells and wrecks on the beach
    for (let i = 0; i < 46; i++) {
      const z = rand(rng, -900, 900);
      const x = w.coastX(z) + rand(rng, 3, 42);
      const y = w.heightAt(x, z);
      if (y < 0.2 || y > 6.5) continue;
      const r = rng();
      if (r < 0.55) this.add('driftwood', x, z, { y: y + 0.15, scale: 1 });
      else this.add('shell', x, z, { y: y + 0.05, scale: rand(rng, 0.5, 0.9) });
    }
    for (let i = 0; i < 14; i++) {
      const z = rand(rng, -700, 700);
      const x = w.coastX(z) + rand(rng, 6, 60);
      const y = w.heightAt(x, z);
      if (y < 0.4 || y > 7) continue;
      this.add('wreck', x, z, { y: y + 0.3, rotY: rand(rng, 0, TAU), scale: rand(rng, 0.7, 1.0) });
    }
    return this;
  }

  stats() {
    const out = {};
    for (const node of this.nodes) out[node.type] = (out[node.type] || 0) + 1;
    return out;
  }
}
