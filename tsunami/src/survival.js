// survival.js — inventory, crafting, gathering, building, hunger/thirst/warmth
import * as THREE from 'three';
import { clamp, clamp01, lerp, mulberry32, rand, pick, TAU, colorGeo, xf } from './util.js';

/* ------------------------------------------------------------------- items */
export const ITEMS = {
  stick: { name: 'Stick', icon: '🪵', stack: 30, kind: 'mat', desc: 'Dry branch. The base of everything.' },
  plank: { name: 'Plank', icon: '🟫', stack: 30, kind: 'mat', desc: 'Sawn board from the wreckage.' },
  fiber: { name: 'Plant fibre', icon: '🌿', stack: 30, kind: 'mat', desc: 'Twisted grass — makes rope.' },
  rope: { name: 'Rope', icon: '🪢', stack: 10, kind: 'mat', desc: 'Strong cordage.' },
  stone: { name: 'Stone', icon: '🪨', stack: 30, kind: 'mat', desc: 'Sharp rock shard.' },
  scrap: { name: 'Scrap metal', icon: '⛓️', stack: 20, kind: 'mat', desc: 'Rusted parts from the harbour.' },
  cloth: { name: 'Cloth', icon: '🧵', stack: 20, kind: 'mat', desc: 'Torn fabric — bandages, torches.' },
  frond: { name: 'Palm frond', icon: '🌴', stack: 30, kind: 'mat', desc: 'Waterproof roofing.' },
  charcoal: { name: 'Charcoal', icon: '⚫', stack: 20, kind: 'mat', desc: 'From a burnt fire. Filters water.' },
  sand_: { name: 'Sand', icon: '🏖️', stack: 20, kind: 'mat', desc: 'Filters water.' },

  berry: { name: 'Berries', icon: '🫐', stack: 20, kind: 'food', food: 6, water: 8, desc: 'Tart but edible.' },
  coconut: { name: 'Coconut', icon: '🥥', stack: 10, kind: 'food', food: 9, water: 16, desc: 'Nature\'s canteen.' },
  shellfish: { name: 'Shellfish', icon: '🦪', stack: 20, kind: 'food', food: 7, water: 4, raw: true, desc: 'From the rocks. Cook it.' },
  crab: { name: 'Crab', icon: '🦀', stack: 20, kind: 'food', food: 9, water: 3, raw: true, desc: 'Beach scavenger.' },
  meat_raw: { name: 'Raw meat', icon: '🥩', stack: 20, kind: 'food', food: 12, water: 2, raw: true, desc: 'Better cooked.' },
  meat_cooked: { name: 'Cooked meat', icon: '🍖', stack: 20, kind: 'food', food: 34, water: 4, desc: 'Filling and safe.' },
  fish_raw: { name: 'Raw fish', icon: '🐟', stack: 20, kind: 'food', food: 11, water: 3, raw: true, desc: 'Anchovy, bream, …' },
  fish_cooked: { name: 'Grilled fish', icon: '🍣', stack: 20, kind: 'food', food: 32, water: 5, desc: 'Perfectly charred.' },
  bird_egg: { name: 'Egg', icon: '🥚', stack: 12, kind: 'food', food: 8, water: 3, raw: true, desc: 'From a cliff nest.' },

  water_dirty: { name: 'Murky water', icon: '🥛', stack: 5, kind: 'drink', water: 26, risk: 0.55, desc: 'Boil or filter it first.' },
  water_clean: { name: 'Clean water', icon: '💧', stack: 5, kind: 'drink', water: 34, desc: 'Safe to drink.' },

  bandage: { name: 'Bandage', icon: '🩹', stack: 10, kind: 'med', heal: 14, bleed: 0.8, desc: 'Stops the bleeding.' },
  herb: { name: 'Medicinal herb', icon: '🌱', stack: 20, kind: 'med', heal: 5, desc: 'Bitter leaves.' },
  painkillers: { name: 'Painkillers', icon: '💊', stack: 10, kind: 'med', heal: 22, desc: 'From the pharmacy.' },

  torch: { name: 'Torch', icon: '🔥', stack: 5, kind: 'tool', light: true, desc: 'Warm light that follows you.' },
  axe: { name: 'Hatchet', icon: '🪓', stack: 1, kind: 'tool', desc: 'Chop wood fast.' },
  knife: { name: 'Knife', icon: '🔪', stack: 1, kind: 'tool', desc: 'Skin, gut, defend.' },
  spear: { name: 'Spear', icon: '🔱', stack: 1, kind: 'tool', desc: 'Hunting & fishing.' },
  rod: { name: 'Fishing rod', icon: '🎣', stack: 1, kind: 'tool', desc: 'Cast, wait, strike!' },
  rod_broken: { name: 'Broken rod', icon: '🪝', stack: 1, kind: 'quest', desc: 'A splintered rod found on the beach — repairable.' },
  bucket: { name: 'Bucket', icon: '🪣', stack: 1, kind: 'tool', desc: 'Carries water & bait.' },
  radio_part: { name: 'Radio part', icon: '📻', stack: 4, kind: 'quest', desc: 'For the camp transmitter.' },
  battery: { name: 'Car battery', icon: '🔋', stack: 2, kind: 'quest', desc: 'Heavy. Powers the radio.' },
  fuel_can: { name: 'Fuel can', icon: '⛽', stack: 3, kind: 'quest', desc: 'Refills vehicles.' },
  flare: { name: 'Flare', icon: '🧨', stack: 5, kind: 'quest', desc: 'Signal at night for rescuers.' },
  medkit: { name: 'First-aid kit', icon: '🧰', stack: 2, kind: 'med', heal: 55, bleed: 1, desc: 'Serious medicine.' },
};

/* ----------------------------------------------------------------- recipes */
export const RECIPES = [
  { id: 'rope', out: ['rope', 1], cost: { fiber: 3 }, label: 'Rope', desc: '3 plant fibre' },
  { id: 'axe', out: ['axe', 1], cost: { stick: 2, stone: 2, rope: 1 }, label: 'Hatchet', desc: '2 stick · 2 stone · 1 rope' },
  { id: 'knife', out: ['knife', 1], cost: { stick: 1, scrap: 1, rope: 1 }, label: 'Knife', desc: '1 stick · 1 scrap · 1 rope' },
  { id: 'spear', out: ['spear', 1], cost: { stick: 2, stone: 1, rope: 1 }, label: 'Spear', desc: '2 stick · 1 stone · 1 rope' },
  { id: 'rod', out: ['rod', 1], cost: { stick: 3, fiber: 2, scrap: 1 }, label: 'Fishing rod 🎣', desc: '3 stick · 2 fibre · 1 scrap' },
  { id: 'rod_fix', out: ['rod', 1], cost: { rod_broken: 1, fiber: 2, scrap: 1 }, label: 'Repair the broken rod 🎣', desc: 'broken rod · 2 fibre · 1 scrap' },
  { id: 'torch', out: ['torch', 1], cost: { stick: 1, cloth: 1, charcoal: 1 }, label: 'Torch', desc: '1 stick · 1 cloth · 1 charcoal' },
  { id: 'bandage', out: ['bandage', 2], cost: { cloth: 2, herb: 1 }, label: 'Bandages ×2', desc: '2 cloth · 1 herb' },
  { id: 'bucket', out: ['bucket', 1], cost: { scrap: 2, rope: 1 }, label: 'Bucket', desc: '2 scrap · 1 rope' },
  { id: 'water_clean', out: ['water_clean', 1], cost: { water_dirty: 1, charcoal: 1 }, station: 'fire', label: 'Purify water', desc: 'Murky water + charcoal (at fire)' },
];

/* ------------------------------------------------------------------ bag */
export class Inventory {
  constructor(cap = 24) { this.slots = new Map(); this.cap = cap; }
  count(id) { return this.slots.get(id)?.qty || 0; }
  add(id, n = 1) {
    if (!ITEMS[id]) return false;
    const cur = this.slots.get(id);
    const max = ITEMS[id].stack || 99;
    if (cur) cur.qty = Math.min(max, cur.qty + n);
    else {
      if (this.slots.size >= this.cap) return false;
      this.slots.set(id, { id, qty: Math.min(max, n) });
    }
    return true;
  }
  remove(id, n = 1) {
    const cur = this.slots.get(id);
    if (!cur || cur.qty < n) return false;
    cur.qty -= n;
    if (cur.qty <= 0) this.slots.delete(id);
    return true;
  }
  has(cost) { for (const k in cost) if (this.count(k) < cost[k]) return false; return true; }
  pay(cost) { if (!this.has(cost)) return false; for (const k in cost) this.remove(k, cost[k]); return true; }
  list() { return [...this.slots.values()]; }
  total() { let n = 0; for (const s of this.list()) n += s.qty; return n; }
  save() { return this.list().map((s) => [s.id, s.qty]); }
  load(arr) { this.slots.clear(); for (const [id, qty] of arr || []) if (ITEMS[id]) this.slots.set(id, { id, qty }); }
}

/* ------------------------------------------------------- world structures */
export class Structure {
  constructor(kind, mesh, pos, data = {}) {
    this.kind = kind; this.mesh = mesh; this.pos = pos; this.data = data;
    this.life = data.life ?? 100;
    this.fuel = data.fuel ?? 0;
    this.t = 0;
    this.cooking = [];
  }
}

export class Survival {
  constructor({ player, world, ocean, fx, audio, ui, scene, quality = 'high' }) {
    this.player = player; this.world = world; this.ocean = ocean;
    this.fx = fx; this.audio = audio; this.ui = ui; this.scene = scene;
    this.inv = new Inventory(28);
    this.structures = [];
    this.rng = mulberry32(5150);
    this.campfirePos = null;
    this.shelterPos = null;
    this.waterSources = [];
    this.cookTimer = [];
    this.stats = { fishCaught: 0, animalsHunted: 0, treesChopped: 0, structuresBuilt: 0, daysSurvived: 0, waterDrunk: 0, foodEaten: 0 };
    this.onEvent = () => {};
    this.group = new THREE.Group();
    this.group.name = 'structures';
    scene.add(this.group);
  }

  /* ----------------------------------------------------------- gathering */
  nearestResource(pos, radius = 3.4, filter = null) {
    let best = null, bd = radius * radius;
    for (const r of this.world.resources || []) {
      if (r.depleted) continue;
      if (filter && !filter(r)) continue;
      const dx = r.x - pos.x, dz = r.z - pos.z, dy = r.y - pos.y;
      const d = dx * dx + dz * dz + dy * dy * 0.5;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  harvest(resource, tool = null) {
    const r = resource;
    const hasAxe = this.inv.count('axe') > 0;
    const hasKnife = this.inv.count('knife') > 0;
    let msg = null;
    switch (r.type) {
      case 'tree': {
        if (!hasAxe) { msg = 'You need a hatchet to cut this tree.'; break; }
        r.hp -= 2;
        this.fx.debrisBurst(r.x, r.y + 1.4, r.z, 8, [0.45, 0.33, 0.2]);
        this.audio?.play('chop');
        if (r.hp <= 0) {
          r.depleted = true;
          this.inv.add('stick', 4); this.inv.add('plank', 2); this.inv.add('fiber', 2);
          this.stats.treesChopped++;
          msg = '+4 stick, +2 plank, +2 fibre';
          if (r.obj) r.obj.visible = false;
        } else msg = `Chopping… ${Math.max(0, r.hp)}`;
        break;
      }
      case 'palm': {
        r.hp -= 1;
        if (r.hp <= 0) {
          r.depleted = true;
          this.inv.add('frond', 5); this.inv.add('fiber', 2);
          if (this.rng() < 0.5) this.inv.add('coconut', 1);
          msg = '+5 frond' + (this.inv.count('coconut') ? ', +1 coconut' : '');
          if (r.obj) r.obj.visible = false;
        } else msg = 'Cutting fronds…';
        break;
      }
      case 'bush': {
        r.hp -= 3;
        this.inv.add('berry', 2); this.inv.add('fiber', 1);
        if (this.rng() < 0.25) this.inv.add('herb', 1);
        if (r.hp <= 0) { r.depleted = true; if (r.obj) r.obj.visible = false; }
        msg = '+2 berries, +1 fibre';
        break;
      }
      case 'rock': {
        r.hp -= 2;
        if (this.rng() < 0.7) this.inv.add('stone', 2);
        if (this.rng() < 0.25) this.inv.add('scrap', 1);
        this.fx.sparks(r.x, r.y + 0.4, r.z, 5, [0.9, 0.9, 0.9]);
        this.audio?.play('chop');
        if (r.hp <= 0) { r.depleted = true; if (r.obj) r.obj.visible = false; }
        msg = '+ stone';
        break;
      }
      case 'cactus': {
        r.hp -= 1;
        this.inv.add('water_dirty', 1);
        msg = hasKnife ? '+1 murky water (from the cactus)' : 'You need a knife to open it';
        if (!hasKnife) this.inv.remove('water_dirty', 1);
        break;
      }
      case 'wreck': {
        r.hp -= 1;
        this.inv.add('scrap', 1);
        if (this.rng() < 0.3) this.inv.add('cloth', 1);
        if (this.rng() < 0.12) this.inv.add('fuel_can', 1);
        this.audio?.play('metal');
        if (r.hp <= 0) { r.depleted = true; if (r.obj) r.obj.visible = false; }
        msg = '+1 scrap';
        break;
      }
      case 'shell': {
        this.inv.add('shellfish', 2);
        this.inv.add('stone', 1);
        r.depleted = true;
        msg = '+2 shellfish';
        break;
      }
      case 'driftwood': {
        this.inv.add('stick', 2); this.inv.add('plank', 1);
        r.depleted = true;
        if (r.obj) r.obj.visible = false;
        msg = '+2 stick, +1 plank';
        break;
      }
      case 'supply': {
        r.depleted = true;
        if (r.obj) r.obj.visible = false;
        this.inv.add('medkit', 1); this.inv.add('water_clean', 2); this.inv.add('painkillers', 2);
        this.inv.add('flare', 2); this.inv.add('battery', 1);
        msg = 'Salvaged a rescue crate!';
        break;
      }
      case 'radio_crate': {
        r.depleted = true;
        if (r.obj) r.obj.visible = false;
        this.inv.add('radio_part', 2); this.inv.add('scrap', 2);
        msg = 'Radio parts recovered.';
        break;
      }
      default: msg = 'Nothing here.';
    }
    if (msg) this.onEvent({ type: 'message', text: msg });
    return msg;
  }

  /* -------------------------------------------------------------- drinks */
  drinkSource(source) {
    const p = this.player;
    if (source.safe) {
      p.drink(34); this.inv.add('water_clean', 0);
      this.onEvent({ type: 'message', text: 'You drink deeply. Fresh spring water.' });
      this.audio?.play('drink');
    } else {
      p.drink(24);
      p.thirst = Math.min(100, p.thirst + 8);
      if (this.rng() < 0.5) { p.sick = Math.min(1, p.sick + 0.45); this.onEvent({ type: 'message', text: 'The water tastes foul… you might get sick.' }); }
      else this.onEvent({ type: 'message', text: 'You gulp the murky water down.' });
      this.audio?.play('drink');
    }
    this.stats.waterDrunk++;
  }
  fillBottle(source) {
    if (this.inv.count('bucket') === 0 && this.inv.count('water_clean') > 0) { }
    this.inv.add(source.safe ? 'water_clean' : 'water_dirty', 1);
    this.onEvent({ type: 'message', text: source.safe ? 'Filled a bottle with clean water.' : 'Filled a bottle with murky water.' });
    this.audio?.play('water');
  }

  /* --------------------------------------------------------------- eating */
  eat(id) {
    const it = ITEMS[id];
    if (!it || it.kind !== 'food' && it.kind !== 'drink' && it.kind !== 'med') return false;
    if (!this.inv.remove(id, 1)) return false;
    const p = this.player;
    if (it.food) p.feed(it.food);
    if (it.water) p.drink(it.water);
    if (it.heal) p.heal(it.heal, id === 'bandage' ? 'bandage' : '');
    if (it.bleed) p.bleeding = Math.max(0, p.bleeding - it.bleed);
    if (it.raw && !it.cooked) {
      if (this.rng() < 0.35) { p.sick = Math.min(1, p.sick + 0.4); this.onEvent({ type: 'message', text: 'Raw food… your stomach turns.' }); }
    }
    if (it.risk && id === 'water_dirty') { }
    this.stats.foodEaten++;
    this.audio?.play('eat');
    this.onEvent({ type: 'eat', item: id });
    return true;
  }
  drinkItem(id) {
    const it = ITEMS[id];
    if (!it || it.kind !== 'drink') return false;
    if (!this.inv.remove(id, 1)) return false;
    const p = this.player;
    p.drink(it.water || 20);
    if (it.risk && this.rng() < it.risk) { p.sick = Math.min(1, p.sick + 0.5); this.onEvent({ type: 'message', text: 'That murky water was a mistake.' }); }
    this.audio?.play('drink');
    return true;
  }

  /* -------------------------------------------------------------- crafting */
  canCraft(recipe) {
    if (!this.inv.has(recipe.cost)) return false;
    if (recipe.station === 'fire' && !this.nearFire()) return false;
    return true;
  }
  craft(id) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return false;
    if (!this.canCraft(r)) { this.onEvent({ type: 'message', text: r.station === 'fire' ? 'You need to be next to a fire.' : 'Not enough materials.' }); return false; }
    this.inv.pay(r.cost);
    this.inv.add(r.out[0], r.out[1]);
    this.audio?.play('craft');
    this.onEvent({ type: 'message', text: `Crafted ${ITEMS[r.out[0]].name} ×${r.out[1]}` });
    return true;
  }

  /* -------------------------------------------------------------- building */
  nearFire() {
    const p = this.player.pos;
    return this.structures.some((s) => s.kind === 'campfire' && s.fuel > 0 && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 4.5 && Math.abs(s.pos.y - p.y) < 3);
  }
  nearShelter() {
    const p = this.player.pos;
    return this.structures.find((s) => s.kind === 'shelter' && Math.hypot(s.pos.x - p.x, s.pos.z - p.z) < 4.0);
  }

  build(kind, pos, rot = 0) {
    const opts = {
      campfire: { cost: { stick: 4, stone: 3 }, name: 'Campfire' },
      shelter: { cost: { plank: 6, frond: 6, rope: 2 }, name: 'Lean-to shelter' },
      rack: { cost: { stick: 4, rope: 1 }, name: 'Drying rack' },
      wall: { cost: { plank: 3 }, name: 'Wind wall' },
      marker: { cost: { stone: 3 }, name: 'Stone marker' },
    }[kind];
    if (!opts) return false;
    if (!this.inv.pay(opts.cost)) { this.onEvent({ type: 'message', text: `Need more materials for the ${opts.name.toLowerCase()}.` }); return false; }
    const y = this.world.heightAt(pos.x, pos.z);
    const mesh = this._structureMesh(kind, rot);
    mesh.position.set(pos.x, y, pos.z);
    mesh.rotation.y = rot;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    const st = new Structure(kind, mesh, new THREE.Vector3(pos.x, y, pos.z), { fuel: kind === 'campfire' ? 100 : 0 });
    if (kind === 'campfire') {
      const light = new THREE.PointLight(0xffa94d, 6, 26, 2);
      light.position.set(pos.x, y + 1.0, pos.z);
      light.castShadow = false;
      this.scene.add(light);
      st.data.light = light;
      this.campfirePos = st.pos.clone();
    }
    if (kind === 'shelter') {
      this.shelterPos = st.pos.clone();
      this.world.colliders.push({ cx: pos.x, cz: pos.z, hx: 1.6, hz: 1.4, rot, y0: y, y1: y + 2.0, kind: 'shelter' });
    }
    if (kind === 'wall') this.world.colliders.push({ cx: pos.x, cz: pos.z, hx: 2.2, hz: 0.18, rot, y0: y, y1: y + 1.6, kind: 'wall' });
    this.structures.push(st);
    this.stats.structuresBuilt++;
    this.audio?.play('build');
    this.onEvent({ type: 'message', text: `${opts.name} built.` });
    return st;
  }

  _structureMesh(kind, rot) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.03 });
    const add = (geo, color, pos, quat) => {
      const m = new THREE.Mesh(colorGeo(geo, new THREE.Color(color)), mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (quat) m.rotation.set(quat[0], quat[1], quat[2]);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    };
    if (kind === 'campfire') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU;
        add(new THREE.DodecahedronGeometry(0.22, 0), 0x6a625a, [Math.cos(a) * 0.85, 0.1, Math.sin(a) * 0.85], [a, a * 2, 0]);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        add(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 5), 0x4a3a2a, [Math.cos(a) * 0.22, 0.42, Math.sin(a) * 0.22], [0.1, a, 1.15]);
      }
      add(new THREE.SphereGeometry(0.3, 8, 6), 0x241a12, [0, 0.1, 0]);
    } else if (kind === 'shelter') {
      add(new THREE.BoxGeometry(3.0, 0.1, 2.6), 0x8a6a44, [0, 1.3, 0], [0.28, 0, 0]);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6), 0x6d5233, [sx * 1.35, 1.1, -1.0], [0.2, 0, sx * 0.12]);
        add(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 6), 0x6d5233, [sx * 1.35, 1.0, 1.0], [-0.2, 0, sx * 0.12]);
      }
      for (let i = 0; i < 8; i++) {
        add(new THREE.BoxGeometry(0.5, 0.06, 2.4), 0x5f7a34, [-1.2 + i * 0.34, 1.34 + i * 0.1, 0], [0.28, 0, 0]);
      }
      add(new THREE.BoxGeometry(2.8, 0.2, 2.0), 0x9a8256, [0, 0.1, 0]);
      add(new THREE.BoxGeometry(2.2, 0.25, 1.4), 0xb8a074, [0, 0.25, 0.2]);
    } else if (kind === 'rack') {
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6), 0x6d5233, [sx * 1.2, 0.85, 0], [0, 0, sx * 0.1]);
      add(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), 0x6d5233, [0, 1.6, 0], [0, 0, Math.PI / 2]);
      add(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), 0x6d5233, [0, 1.2, 0], [0, 0, Math.PI / 2]);
    } else if (kind === 'wall') {
      for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.45, 1.6, 0.06), i % 2 ? 0x9a7a52 : 0x8a6a44, [-1.9 + i * 0.48, 0.85, 0], [0, 0, 0.02 * (i % 3 - 1)]);
    } else if (kind === 'marker') {
      for (let i = 0; i < 5; i++) add(new THREE.DodecahedronGeometry(0.3 + i * 0.05, 0), 0x8c8478, [0, 0.3 + i * 0.35, 0], [i, i * 2, 0]);
    }
    return g;
  }

  /* ------------------------------------------------------------- cooking */
  cook(itemId) {
    const st = this.structures.find((s) => s.kind === 'campfire' && s.fuel > 0);
    if (!st) { this.onEvent({ type: 'message', text: 'Build a campfire to cook.' }); return false; }
    const map = { fish_raw: 'fish_cooked', meat_raw: 'meat_cooked', shellfish: 'fish_cooked', crab: 'fish_cooked', bird_egg: 'meat_cooked' };
    if (!map[itemId]) { this.onEvent({ type: 'message', text: 'That cannot be cooked.' }); return false; }
    if (!this.inv.remove(itemId, 1)) return false;
    st.cooking.push({ from: itemId, to: map[itemId], t: 16 });
    this.onEvent({ type: 'message', text: 'Cooking…' });
    return true;
  }

  addFuelToFire() {
    const st = this.structures.find((s) => s.kind === 'campfire');
    if (!st) return false;
    if (!this.inv.remove('stick', 3)) { this.onEvent({ type: 'message', text: 'Need 3 sticks.' }); return false; }
    st.fuel = Math.min(100, st.fuel + 45);
    this.onEvent({ type: 'message', text: 'You feed the fire.' });
    return true;
  }

  /* ------------------------------------------------------------- per-frame */
  update(dt, env = {}) {
    const p = this.player;
    // campfires
    for (const st of this.structures) {
      st.t += dt;
      if (st.kind === 'campfire') {
        if (st.fuel > 0) {
          st.fuel = Math.max(0, st.fuel - dt * (env.rain ? 0.9 : 0.42));
          const flick = 0.75 + Math.sin(st.t * 12.3) * 0.12 + Math.sin(st.t * 7.1) * 0.1;
          if (st.data.light) st.data.light.intensity = (3.4 + st.fuel * 0.035) * flick;
          if (this.fx && Math.random() < 0.85) this.fx.fireAt(st.pos.x, st.pos.y + 0.35, st.pos.z, st.fuel > 0 ? 1 : 0);
          if (this.fx && Math.random() < 0.35) this.fx.smoke(st.pos.x, st.pos.y + 1.1, st.pos.z, 1, [0.28, 0.26, 0.24]);
          // cooking
          for (const c of st.cooking.slice()) {
            c.t -= dt;
            if (c.t <= 0) { this.inv.add(c.to, 1); st.cooking.splice(st.cooking.indexOf(c), 1); this.onEvent({ type: 'message', text: `Cooked: ${ITEMS[c.to].name}` }); }
          }
        } else if (st.data.light) st.data.light.intensity = 0;
      }
    }
    // ---- survival meters
    const activity = p.speed > 5 ? 1.6 : p.speed > 1 ? 1.15 : 0.85;
    p.hunger = clamp(p.hunger - dt * 0.058 * activity, 0, 100);
    p.thirst = clamp(p.thirst - dt * 0.082 * activity, 0, 100);
    // warmth: cold at night / in rain / on the mountain / when wet / in water
    const alt = p.pos.y;
    let cold = 0;
    cold += env.night ? 0.55 : 0;
    cold += (env.rain || 0) * 0.75;
    cold += clamp01((alt - 120) / 260) * 0.7;
    cold += p.wet * 0.5;
    cold += p.swimming ? 0.6 : 0;
    if (this.nearFire()) cold -= 1.6;
    if (this.nearShelter()) cold -= 0.55;
    cold = clamp(cold, -2, 2.4);
    p.warmth = clamp(p.warmth - cold * dt * 2.1, 0, 100);
    // consequences
    let dmg = 0;
    if (p.hunger <= 0) dmg += 0.32 * dt;
    if (p.thirst <= 0) dmg += 0.5 * dt;
    if (p.warmth <= 0) dmg += 0.42 * dt;
    if (p.bleeding > 0) { dmg += p.bleeding * 0.55 * dt; p.bleeding = Math.max(0, p.bleeding - dt * 0.004); }
    if (p.sick > 0) {
      dmg += p.sick * 0.3 * dt;
      p.sick = Math.max(0, p.sick - dt * 0.006);
      if (Math.random() < dt * 0.05) this.onEvent({ type: 'message', text: 'You feel nauseous…' });
    }
    if (dmg > 0) p.damage(dmg, 'survival');
    // passive healing when healthy
    if (dmg === 0 && p.hunger > 45 && p.thirst > 45 && p.health < 100) p.heal(dt * 0.55);
    // torch light
    this._updateTorch(dt);
  }

  _updateTorch(dt) {
    const has = this.inv.count('torch') > 0;
    if (has && !this.torchLight) {
      this.torchLight = new THREE.PointLight(0xffb060, 4.2, 22, 2);
      this.scene.add(this.torchLight);
      this.torchFlame = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffc060 })
      );
      this.scene.add(this.torchFlame);
    }
    if (this.torchLight) {
      const p = this.player.eye;
      const f = p.clone().addScaledVector(new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw)), 0.6);
      this.torchLight.position.set(f.x, f.y - 0.2, f.z);
    }
  }

  /* ---------------------------------------------------------------- saving */
  save() {
    return {
      inv: this.inv.save(),
      stats: this.stats,
      structures: this.structures.map((s) => ({ kind: s.kind, x: s.pos.x, y: s.pos.y, z: s.pos.z, fuel: s.fuel, rot: s.mesh.rotation.y })),
    };
  }
  load(data) {
    if (!data) return;
    this.inv.load(data.inv);
    Object.assign(this.stats, data.stats || {});
    for (const s of data.structures || []) this.build(s.kind, new THREE.Vector3(s.x, s.y, s.z), s.rot || 0);
  }
}

export { rand, pick, lerp, clamp01 };
