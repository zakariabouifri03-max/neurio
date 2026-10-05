import * as THREE from '../vendor/three.module.js';
import { ID, TOOL_POWER } from './blocks.js';

const COLORS = {
  cow: { body: 0xeee4d7, spot: 0x4a3530, face: 0xc18b70, leg: 0x60453b },
  sheep: { body: 0xe9e5d7, spot: 0xd1c9b9, face: 0xdeb6a0, leg: 0x70605a },
  pig: { body: 0xe69a9d, spot: 0xd78388, face: 0xf0aaa7, leg: 0xa45d64 },
  chicken: { body: 0xf4eee0, spot: 0xffd363, face: 0xe8a44f, leg: 0xd9852e },
  zombie: { body: 0x3b9366, spot: 0x285f4c, face: 0x67a777, leg: 0x364b67 },
};

export class CreatureSystem {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.entities = [];
    this.clock = 0;
    this.spawnClock = 18;
    this._spawnInitial();
  }

  _random(n, salt = 0) {
    const v = Math.sin((this.world.seed % 100003) * 0.001 + n * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  _spawnInitial() {
    for (let i = 0; i < 7; i++) {
      const a = this._random(i + 1) * Math.PI * 2;
      const d = 12 + this._random(i + 8) * 20;
      const x = Math.floor(this.game.player.pos.x + Math.cos(a) * d);
      const z = Math.floor(this.game.player.pos.z + Math.sin(a) * d);
      const { biome, height } = this.world.surfaceAt(x, z);
      if (height <= 13) continue;
      const at = this.world.getBlock(x, height, z);
      if (at === ID.LOG || at === ID.LEAVES) continue;
      const types = biome === 'snow' ? ['sheep', 'chicken'] : biome === 'desert' ? ['pig', 'chicken'] : ['cow', 'sheep', 'pig', 'chicken'];
      this.spawn(types[Math.floor(this._random(i + 18) * types.length)], x + 0.5, height + 1, z + 0.5);
    }
  }

  _part(parent, size, position, color, materialCache) {
    let material = materialCache.get(color);
    if (!material) { material = new THREE.MeshLambertMaterial({ color }); materialCache.set(color, material); }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position); parent.add(mesh); return mesh;
  }

  _build(type) {
    const group = new THREE.Group(), c = COLORS[type], cache = new Map();
    const limb = (x) => {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.73, 0);
      this._part(pivot, [0.20, 0.76, 0.22], [0, -0.35, 0], c.leg, cache);
      group.add(pivot); return pivot;
    };
    if (type === 'chicken') {
      this._part(group, [0.65, 0.65, 0.72], [0, 0.83, 0], c.body, cache);
      this._part(group, [0.43, 0.42, 0.42], [0.05, 1.27, -0.18], c.body, cache);
      this._part(group, [0.17, 0.12, 0.16], [0.06, 1.23, -0.48], c.face, cache);
      this._part(group, [0.07, 0.07, 0.07], [-0.06, 1.36, -0.39], 0x222222, cache);
      this.legs = [limb(-0.18), limb(0.18)];
    } else {
      const bodySize = type === 'zombie' ? [0.72, 0.82, 0.42] : [0.95, 0.78, 0.58];
      this._part(group, bodySize, [0, 0.96, 0], c.body, cache);
      if (type === 'cow') {
        this._part(group, [0.28, 0.28, 0.20], [-0.25, 0.98, -0.31], c.spot, cache);
        this._part(group, [0.22, 0.26, 0.20], [0.27, 1.12, 0.3], c.spot, cache);
        this._part(group, [0.58, 0.47, 0.48], [0, 1.17, -0.42], c.face, cache);
        this._part(group, [0.13, 0.16, 0.15], [-0.22, 1.51, -0.38], 0xf3e6d3, cache);
        this._part(group, [0.13, 0.16, 0.15], [0.22, 1.51, -0.38], 0xf3e6d3, cache);
      } else if (type === 'sheep') {
        for (let i = 0; i < 6; i++) {
          const x = (i % 3 - 1) * 0.28, z = i < 3 ? 0.17 : -0.17;
          this._part(group, [0.40, 0.40, 0.36], [x, 1.16 + (i % 2) * 0.06, z], c.body, cache);
        }
        this._part(group, [0.46, 0.44, 0.44], [0, 1.20, -0.43], c.face, cache);
      } else if (type === 'pig') {
        this._part(group, [0.52, 0.45, 0.47], [0, 1.19, -0.41], c.face, cache);
        this._part(group, [0.26, 0.16, 0.10], [0, 1.08, -0.66], 0xd27678, cache);
        this._part(group, [0.07, 0.08, 0.06], [-0.12, 1.30, -0.61], 0x352328, cache);
        this._part(group, [0.07, 0.08, 0.06], [0.12, 1.30, -0.61], 0x352328, cache);
      } else {
        this._part(group, [0.52, 0.52, 0.48], [0, 1.49, -0.02], c.face, cache);
        this._part(group, [0.09, 0.08, 0.05], [-0.12, 1.54, -0.27], 0xe8f2a8, cache);
        this._part(group, [0.09, 0.08, 0.05], [0.12, 1.54, -0.27], 0xe8f2a8, cache);
        this._part(group, [0.70, 0.2, 0.18], [-0.48, 1.12, 0], c.face, cache);
        this._part(group, [0.70, 0.2, 0.18], [0.48, 1.12, 0], c.face, cache);
      }
      this.legs = [limb(-0.30), limb(0.30), limb(0), limb(0)];
      this.legs[2].position.z = -0.22; this.legs[3].position.z = 0.22;
    }
    if (type === 'zombie') {
      this._part(group, [0.18, 0.88, 0.18], [-0.49, 1.15, -0.02], c.body, cache);
      this._part(group, [0.18, 0.88, 0.18], [0.49, 1.15, -0.02], c.body, cache);
    }
    group.traverse((obj) => { if (obj.isMesh) { obj.castShadow = false; obj.receiveShadow = false; } });
    return { group, legs: this.legs || [], materials: [...cache.values()] };
  }

  spawn(type, x, y, z) {
    const visual = this._build(type);
    visual.group.position.set(x, y, z);
    this.scene.add(visual.group);
    const entity = {
      type, group: visual.group, legs: visual.legs, materials: visual.materials,
      x, y, z, hp: type === 'zombie' ? 12 : 6, speed: type === 'zombie' ? 1.25 : 0.55,
      direction: this._random(this.entities.length + 30) * Math.PI * 2,
      turnIn: 1 + this._random(this.entities.length + 45) * 4,
      attackIn: 0, hurtFlash: 0, dead: false,
    };
    this.entities.push(entity);
    return entity;
  }

  get isNight() { return this.game.isNight; }

  update(dt) {
    this.clock += dt;
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && this.isNight && this.game.record.mode !== 'creative' && this.game.record.difficulty !== 'peaceful') {
      const zombies = this.entities.filter((e) => e.type === 'zombie').length;
      if (zombies < 4) {
        const a = this._random(Math.floor(this.clock * 2) + 101) * Math.PI * 2;
        const d = 12 + this._random(Math.floor(this.clock * 2) + 233) * 13;
        const x = Math.floor(this.game.player.pos.x + Math.cos(a) * d), z = Math.floor(this.game.player.pos.z + Math.sin(a) * d);
        const h = this.world.surfaceAt(x, z).height;
        if (h > 12) this.spawn('zombie', x + 0.5, h + 1, z + 0.5);
      }
      this.spawnClock = 15 + this._random(Math.floor(this.clock) + 60) * 15;
    }

    const p = this.game.player.pos;
    for (const e of this.entities) {
      if (e.dead) continue;
      const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz);
      if (e.type === 'zombie') {
        if (dist < 24) e.direction = Math.atan2(dx, dz);
        if (dist > 38) { this._remove(e); continue; }
        e.attackIn -= dt;
        if (dist < 1.5 && e.attackIn <= 0 && this.isNight) {
          this.game.damage(this.game.record.difficulty === 'hard' ? 3 : 2);
          e.attackIn = this.game.record.difficulty === 'hard' ? 1.1 : 1.7;
        }
      } else {
        e.turnIn -= dt;
        if (e.turnIn <= 0) { e.direction += (this._random(Math.floor(this.clock * 3) + e.group.id) - 0.5) * 2.5; e.turnIn = 2 + this._random(Math.floor(this.clock) + e.group.id) * 4; }
        if (dist < 2.2) e.direction = Math.atan2(-dx, -dz) + 1.4;
      }
      const speedFactor = e.type === 'zombie' ? (dist < 25 ? 1 : 0) : (dist < 35 ? 1 : 0);
      e.x += Math.sin(e.direction) * e.speed * speedFactor * dt;
      e.z += Math.cos(e.direction) * e.speed * speedFactor * dt;
      const bx = Math.floor(e.x), bz = Math.floor(e.z), ground = this.world.highestSolid(bx, bz);
      if (ground > 0 && ground < 52 && Math.abs(ground + 1 - e.y) < 4) e.y += (ground + 1 - e.y) * Math.min(1, dt * 5);
      e.group.position.set(e.x, e.y + Math.abs(Math.sin(this.clock * 7 + e.group.id)) * 0.035, e.z);
      e.group.rotation.y = e.direction + Math.PI;
      const gait = Math.sin(this.clock * 9 + e.group.id) * 0.34;
      for (let i = 0; i < e.legs.length; i++) e.legs[i].rotation.x = Math.sin(this.clock * 9 + e.group.id + (i % 2) * Math.PI) * 0.4;
      e.hurtFlash = Math.max(0, e.hurtFlash - dt);
      if (e.hurtFlash > 0) e.group.scale.setScalar(1.07); else e.group.scale.setScalar(1);
    }
  }

  attack() {
    const selected = this.game.inventory.selectedItem();
    const weapon = TOOL_POWER[selected?.id];
    const damage = weapon?.damage || 1;
    const yaw = this.game.player.yaw;
    let target = null, best = 3.3;
    for (const e of this.entities) {
      if (e.dead) continue;
      const dx = e.x - this.game.player.pos.x, dz = e.z - this.game.player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= best) continue;
      const dot = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / Math.max(0.001, d);
      if (dot > 0.28) { best = d; target = e; }
    }
    if (!target) { this.game.app.toast('No creature in reach. Face a creature and tap ⚔️.', ''); return false; }
    target.hp -= damage; target.hurtFlash = 0.18;
    const dx = target.x - this.game.player.pos.x, dz = target.z - this.game.player.pos.z, d = Math.max(0.01, Math.hypot(dx, dz));
    target.x += dx / d * 0.5; target.z += dz / d * 0.5;
    if (target.hp <= 0) {
      this.game.inventory.add(ID.BONE, target.type === 'zombie' ? 1 : 0);
      if (target.type === 'cow' || target.type === 'pig') {
        this.game.inventory.add(ID.RAW_BEEF, 1 + Math.floor(this._random(this.clock + target.group.id) * 2));
        if (this._random(this.clock + target.group.id, 88) > 0.35) this.game.inventory.add(ID.LEATHER, 1);
      } else if (target.type === 'sheep') this.game.inventory.add(ID.WOOL, 1 + Math.floor(this._random(this.clock + target.group.id, 77) * 2));
      else if (target.type === 'chicken') { this.game.inventory.add(ID.EGG, 1); this.game.inventory.add(ID.RAW_BEEF, 1); }
      else this.game.inventory.add(ID.ROTTEN_FLESH, 1 + Math.floor(this._random(this.clock + target.group.id, 29) * 2));
      this.game.app.toast(`${target.type === 'zombie' ? 'Creature defeated' : 'Creature hunted'} — materials collected.`, '');
      this._remove(target);
    }
    this.game.audio.hurt();
    this.game.inventory.changed();
    return true;
  }

  _remove(entity) {
    entity.dead = true; this.scene.remove(entity.group);
    entity.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const material of entity.materials) material.dispose();
    const i = this.entities.indexOf(entity); if (i >= 0) this.entities.splice(i, 1);
  }

  dispose() { for (const e of [...this.entities]) this._remove(e); }
}
