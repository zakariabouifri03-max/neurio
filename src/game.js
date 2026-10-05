import * as THREE from '../vendor/three.module.js';
import { BLOCK, DESCRIPTIONS, ID, ITEM_BY_ID, ITEMS, MAX_Y, RECIPES, TOOL_POWER } from './blocks.js';
import { Inventory } from './inventory.js';
import { CreatureSystem } from './entities.js';
import { VoxelWorld, hashSeed } from './world.js';
import { audio } from './audio.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const vecFrom = (value, fallback) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? new THREE.Vector3(value[0], value[1], value[2]) : fallback;
const color = (hex) => new THREE.Color(hex);

function nearestSpawn(world) {
  for (let radius = 0; radius <= 9; radius++) {
    for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) {
      if (radius && Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
      const { height, biome } = world.surfaceAt(x, z);
      if (height <= 13) continue;
      const top = world.getBlock(x, height, z);
      if (top === ID.LOG || top === ID.LEAVES || top === ID.WATER) continue;
      return { pos: new THREE.Vector3(x + 0.5, height + 1, z + 0.5), biome };
    }
  }
  return { pos: new THREE.Vector3(0.5, world.surfaceAt(0, 0).height + 1, 0.5), biome: 'meadow' };
}

export class SandboxGame {
  constructor(app, record, role = 'solo') {
    this.app = app;
    this.record = { ...record };
    this.role = role;
    this.renderer = app.renderer;
    this.settings = app.settings;
    this.audio = audio;
    this.paused = false;
    this.scene = new THREE.Scene();
    this.scene.background = color('#78b7d9');
    this.scene.fog = new THREE.Fog('#78b7d9', 56, 150);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.08, 260);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.ambient = new THREE.HemisphereLight(0xc9eaff, 0x746044, 1.15);
    this.scene.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight(0xffefcf, 1.8);
    this.sunLight.position.set(30, 70, 20);
    this.scene.add(this.sunLight);
    this.moonLight = new THREE.DirectionalLight(0x8fa9e7, 0.06);
    this.scene.add(this.moonLight);
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd7e4ff }));
    this.scene.add(this.sun, this.moon);
    this.stars = this._makeStars(); this.scene.add(this.stars);

    const fallbackWorld = new VoxelWorld(record.seed, record.edits || [], this.scene, this.settings.renderDistance);
    this.world = fallbackWorld;
    const spawn = nearestSpawn(this.world);
    let pos = vecFrom(record.position, spawn.pos);
    if (role === 'guest' && Array.isArray(record.hostPosition)) {
      const [hx, hy, hz] = record.hostPosition;
      pos = new THREE.Vector3(hx + 2.4, hy, hz + 1.5);
      if (this.collidesAt(pos.x, pos.y, pos.z)) pos.copy(spawn.pos);
    }
    this.player = {
      pos,
      velocity: new THREE.Vector3(),
      yaw: Number.isFinite(record.yaw) ? record.yaw : 0,
      pitch: Number.isFinite(record.pitch) ? record.pitch : 0,
      onGround: false,
      fallStart: pos.y,
      health: clamp(Number(record.health ?? 20), 0, 20),
      hunger: clamp(Number(record.hunger ?? 20), 0, 20),
      damageCooldown: 0,
    };
    this.inventory = new Inventory(record.inventory || {}, record.mode || 'survival');
    this.inventory.selected = clamp(Number(record.selected ?? this.inventory.selected), 0, 8) | 0;
    this.inventory.onUpdate = () => this.app.updateHotbar();
    this.world.ensureAround(pos.x, pos.z, this.settings.renderDistance);
    this.world.onChange = (patch) => this.app.onBlockChange(patch);
    this.target = null;
    this.mining = null;
    this.mineHeld = false;
    this.input = { forward: 0, strafe: 0, jump: false, sprint: false, down: false };
    this.keys = new Set();
    this.elapsed = 0;
    this.saveClock = 0;
    this.chunkClock = 0;
    this.hungerClock = 0;
    this.lastHud = 0;
    this.worldTime = Math.max(0, Number(record.time ?? 180));
    this.remote = null;
    this.hand = new THREE.Group();
    this.hand.position.set(0.44, -0.43, -0.78);
    this.hand.rotation.set(-0.15, -0.28, 0.08);
    this.camera.add(this.hand);
    this.heldItemId = -1;
    this._buildTargetOutline();
    this.creatures = new CreatureSystem(this);
    this.setSettings(this.settings);
    this.audio.setEnabled(this.settings.sound);
    this.audio.setMusic(this.settings.music);
    this._syncCamera();
    this.updateEnvironment();
    this.updateHeldItem();
    this.app.updateHotbar();
    this.app.updateHud(true);
  }

  get isNight() { const h = this.hour; return h >= 20 || h < 6; }
  get hour() { return ((this.worldTime / 720 * 24 + 6) % 24 + 24) % 24; }
  get biome() { return this.world.biomeAt(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z)); }

  _makeStars() {
    const positions = [], rand = (i) => {
      const n = Math.sin(i * 127.1 + hashSeed(this.record.seed) * 0.01) * 43758.5453;
      return n - Math.floor(n);
    };
    for (let i = 0; i < 230; i++) {
      const angle = rand(i * 3) * Math.PI * 2, y = 22 + rand(i * 3 + 1) * 36, radius = 82;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xdce8ff, size: 0.58, sizeAttenuation: false, transparent: true, opacity: 0 });
    const points = new THREE.Points(geometry, material); points.userData.material = material;
    return points;
  }

  _buildTargetOutline() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008));
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: true });
    this.outline = new THREE.LineSegments(geometry, material);
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.progress = new THREE.Mesh(
      new THREE.BoxGeometry(1.012, 1.012, 1.012),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.2 }),
    );
    this.progress.visible = false;
    this.scene.add(this.progress);
  }

  setSettings(settings) {
    this.settings = settings;
    this.camera.fov = Number(settings.fov) || 76; this.camera.updateProjectionMatrix();
    const cap = settings.quality === 'high' ? 1.75 : settings.quality === 'low' ? 0.85 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.world.setViewDistance(settings.renderDistance, this.player.pos.x, this.player.pos.z);
  }

  look(dx, dy) {
    const invert = this.settings.invertY ? 1 : -1;
    const sensitivity = Number(this.settings.sensitivity) || 0.0022;
    this.player.yaw -= dx * sensitivity;
    this.player.pitch = clamp(this.player.pitch + dy * sensitivity * invert, -1.48, 1.48);
  }

  keyDown(code) {
    this.keys.add(code);
    if (code === 'Space') { this.input.jump = true; this.audio.unlock(); }
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.input.sprint = true;
    if (code === 'KeyE') this.app.openInventory();
    if (code === 'KeyF') this.creatures.attack();
    if (code === 'KeyQ') this.useSelected();
    if (/^Digit[1-9]$/.test(code)) this.inventory.selectSlot(Number(code.slice(-1)) - 1);
  }

  keyUp(code) {
    this.keys.delete(code);
    if (code === 'Space') this.input.jump = false;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.input.sprint = false;
  }

  setMining(held) { this.mineHeld = !!held; if (!held) this.mining = null; }

  _cellSolid(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    return !!BLOCK[id]?.solid;
  }

  collidesAt(x, y, z) {
    const radius = 0.29, body = 1.78;
    const minX = Math.floor(x - radius), maxX = Math.floor(x + radius);
    const minZ = Math.floor(z - radius), maxZ = Math.floor(z + radius);
    const minY = Math.floor(y + 0.035), maxY = Math.floor(y + body - 0.035);
    for (let by = minY; by <= maxY; by++) for (let bx = minX; bx <= maxX; bx++) for (let bz = minZ; bz <= maxZ; bz++) {
      if (this._cellSolid(bx, by, bz)) return true;
    }
    return false;
  }

  _groundBelow(x, y, z) {
    const radius = 0.27, by = Math.floor(y - 0.05);
    for (let bx = Math.floor(x - radius); bx <= Math.floor(x + radius); bx++) {
      for (let bz = Math.floor(z - radius); bz <= Math.floor(z + radius); bz++) if (this._cellSolid(bx, by, bz)) return by + 1;
    }
    return null;
  }

  _horizontalStep(axis, amount) {
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.16)), delta = amount / steps;
    for (let i = 0; i < steps; i++) {
      const x = this.player.pos.x + (axis === 'x' ? delta : 0);
      const z = this.player.pos.z + (axis === 'z' ? delta : 0);
      if (!this.collidesAt(x, this.player.pos.y, z)) { this.player.pos.x = x; this.player.pos.z = z; }
      else break;
    }
  }

  _move(dt) {
    const p = this.player, creative = this.record.mode === 'creative';
    let forward = this.input.forward + (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    let strafe = this.input.strafe + (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const len = Math.hypot(forward, strafe); if (len > 1) { forward /= len; strafe /= len; }
    const sprint = this.input.sprint || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = creative ? (sprint ? 10 : 7) : (sprint && p.hunger > 0 ? 6.6 : 4.25);
    const dx = (Math.cos(p.yaw) * strafe - Math.sin(p.yaw) * forward) * speed * dt;
    const dz = (-Math.sin(p.yaw) * strafe - Math.cos(p.yaw) * forward) * speed * dt;
    this._horizontalStep('x', dx); this._horizontalStep('z', dz);

    const jump = this.input.jump || this.keys.has('Space');
    if (creative) {
      if (jump) p.pos.y += speed * dt;
      if (this.input.down || this.keys.has('ControlLeft') || this.keys.has('KeyC')) p.pos.y -= speed * dt;
      p.pos.y = clamp(p.pos.y, 2, MAX_Y - 4);
      p.onGround = false;
      return;
    }
    if (jump && p.onGround) { p.velocity.y = 7.2; p.onGround = false; this.audio.jump(); }
    p.velocity.y -= 20 * dt;
    let nextY = p.pos.y + p.velocity.y * dt;
    if (p.velocity.y <= 0) {
      const ground = this._groundBelow(p.pos.x, nextY, p.pos.z);
      if (ground !== null && nextY <= ground && p.pos.y >= ground - 0.32) {
        const fall = p.fallStart - ground;
        p.pos.y = ground; p.velocity.y = 0; p.onGround = true;
        if (fall > 4.5) this.damage(Math.min(12, Math.floor((fall - 3) * 1.4)));
        p.fallStart = ground;
      } else {
        p.pos.y = nextY; p.onGround = false;
        if (p.velocity.y < -0.1) p.fallStart = Math.max(p.fallStart, p.pos.y);
      }
    } else if (this.collidesAt(p.pos.x, nextY, p.pos.z)) {
      p.velocity.y = 0;
    } else {
      p.pos.y = nextY; p.onGround = false;
    }
    if (p.pos.y < -8) this.respawn();
  }

  _syncCamera() {
    this.camera.position.set(this.player.pos.x, this.player.pos.y + 1.62, this.player.pos.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
  }

  raycast(maxDistance = 6.4) {
    const origin = this.camera.position;
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(direction.x), stepY = Math.sign(direction.y), stepZ = Math.sign(direction.z);
    const invX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
    const invY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);
    const invZ = direction.z === 0 ? Infinity : Math.abs(1 / direction.z);
    let maxX = direction.x === 0 ? Infinity : (stepX > 0 ? x + 1 - origin.x : origin.x - x) * invX;
    let maxY = direction.y === 0 ? Infinity : (stepY > 0 ? y + 1 - origin.y : origin.y - y) * invY;
    let maxZ = direction.z === 0 ? Infinity : (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * invZ;
    let distance = 0, previous = null;
    while (distance <= maxDistance) {
      const id = this.world.getBlock(x, y, z);
      if (id && (BLOCK[id]?.solid || id === ID.WATER)) return { x, y, z, id, place: previous, distance };
      previous = { x, y, z };
      if (maxX < maxY && maxX < maxZ) { x += stepX; distance = maxX; maxX += invX; }
      else if (maxY < maxZ) { y += stepY; distance = maxY; maxY += invY; }
      else { z += stepZ; distance = maxZ; maxZ += invZ; }
    }
    return null;
  }

  _toolFor(blockId) {
    const selected = this.inventory.selectedItem();
    const tool = selected ? TOOL_POWER[selected.id] : null;
    const data = BLOCK[blockId];
    if (!data) return { speed: 0.8, canDrop: true, level: 0 };
    const level = tool?.level || 0;
    if (data.minTool && level < data.minTool) return { speed: 0.25, canDrop: false, level };
    if (tool?.kind === data.tool) return { speed: tool.speed, canDrop: true, level };
    if (data.tool === 'hand' || data.tool === 'shovel' && selected?.key?.toLowerCase().includes('shovel')) return { speed: 1, canDrop: true, level };
    return { speed: data.tool === 'pick' ? 0.55 : 0.75, canDrop: !data.minTool, level };
  }

  _tickMining(dt) {
    if (!this.mineHeld || !this.target || this.record.mode === 'creative' && this.mining?.complete) {
      if (!this.mineHeld) this.mining = null;
      this.progress.visible = false;
      return;
    }
    const target = this.target, data = BLOCK[target.id];
    if (!data || target.y <= 0) { this.mining = null; this.progress.visible = false; return; }
    if (!this.mining || this.mining.x !== target.x || this.mining.y !== target.y || this.mining.z !== target.z) {
      this.mining = { x: target.x, y: target.y, z: target.z, id: target.id, amount: 0 };
    }
    const tool = this._toolFor(target.id);
    const hardness = Math.max(0.18, data.hardness || 0.7);
    this.mining.amount += this.record.mode === 'creative' ? 25 * dt : dt * tool.speed / (hardness * 1.8);
    this.progress.visible = true;
    this.progress.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    this.progress.scale.setScalar(1 + Math.min(0.08, this.mining.amount * 0.06));
    this.progress.material.opacity = 0.12 + Math.min(0.48, this.mining.amount * 0.35);
    this.app.setMineProgress(Math.min(1, this.mining.amount));
    if (this.mining.amount >= 1) this._finishMining(target, tool);
  }

  _finishMining(target, tool) {
    const info = BLOCK[target.id];
    if (!info) return;
    this.world.setBlock(target.x, target.y, target.z, 0);
    if (this.record.mode !== 'creative' && tool.canDrop && info.drop) {
      let count = 1;
      if (Array.isArray(info.dropCount)) count = info.dropCount[0] + Math.floor(Math.random() * (info.dropCount[1] - info.dropCount[0] + 1));
      this.inventory.add(info.drop, count);
      if (target.id === ID.LEAVES) {
        const roll = Math.random();
        if (roll < 0.12) this.inventory.add(ID.APPLE, 1);
        else if (roll < 0.33) this.inventory.add(ID.SAPLING, 1);
        else if (roll < 0.46) this.inventory.add(ID.SEEDS, 1);
      } else if (target.id === ID.GRASS && Math.random() < 0.18) {
        this.inventory.add(Math.random() < 0.82 ? ID.SEEDS : ID.WHEAT, 1);
      }
      this.app.toast(`+${count} ${ITEM_BY_ID.get(info.drop)?.name || 'material'}`, 'quiet');
    }
    this.audio.dig();
    this.mining = null; this.progress.visible = false;
    this.app.setMineProgress(0);
  }

  mineTap() { this.mineHeld = true; this._tickMining(0.3); this.mineHeld = false; }

  place() {
    const hit = this.target;
    if (!hit?.place) { this.app.toast('Look at a block first.', ''); return false; }
    const selected = this.inventory.selectedItem();
    if (!selected?.placeable) { this.app.toast('Select a block from your pack before building.', ''); return false; }
    const { x, y, z } = hit.place;
    const existing = this.world.getBlock(x, y, z);
    if (existing && existing !== ID.WATER) return false;
    if (y <= 0 || this.collidesAt(x + 0.5, y, z + 0.5)) { this.app.toast('There is no room to place that here.', ''); return false; }
    this.world.setBlock(x, y, z, selected.id);
    if (this.record.mode !== 'creative') this.inventory.remove(selected.id, 1);
    this.audio.place();
    return true;
  }

  useSelected() {
    const selected = this.inventory.selectedItem();
    if (!selected) return;
    if (selected.food) {
      if (this.player.hunger >= 20 && this.player.health >= 20) { this.app.toast('You are already full.', ''); return; }
      this.player.hunger = Math.min(20, this.player.hunger + selected.food);
      if (this.player.hunger >= 18) this.player.health = Math.min(20, this.player.health + 1);
      if (this.record.mode !== 'creative') this.inventory.remove(selected.id, 1);
      this.audio.pickup(); this.app.updateHud(true); this.app.toast(`Ate ${selected.name}.`, '');
      return;
    }
    if (selected.id === ID.WATER_BUCKET && this.target?.place) {
      const { x, y, z } = this.target.place;
      if (!this.world.getBlock(x, y, z) && !this.collidesAt(x + 0.5, y, z + 0.5)) {
        this.world.setBlock(x, y, z, ID.WATER);
        if (this.record.mode !== 'creative') { this.inventory.remove(ID.WATER_BUCKET, 1); this.inventory.add(ID.BUCKET, 1); }
      }
      return;
    }
    if (selected.id === ID.BUCKET && this.target?.id === ID.WATER) {
      const { x, y, z } = this.target;
      this.world.setBlock(x, y, z, 0);
      if (this.record.mode !== 'creative') { this.inventory.remove(ID.BUCKET, 1); this.inventory.add(ID.WATER_BUCKET, 1); }
    }
  }

  eat(foodItem) {
    if (this.player.hunger >= 20 && this.player.health >= 20) return false;
    this.player.hunger = Math.min(20, this.player.hunger + foodItem.food);
    if (this.player.hunger >= 18) this.player.health = Math.min(20, this.player.health + 1);
    return true;
  }

  damage(amount) {
    if (this.record.mode === 'creative' || this.player.damageCooldown > 0 || amount <= 0) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.damageCooldown = 0.8;
    this.audio.hurt(); this.app.updateHud(true);
    if (this.player.health <= 0) this.respawn();
  }

  respawn() {
    const spawn = nearestSpawn(this.world);
    this.player.pos.copy(spawn.pos); this.player.velocity.set(0, 0, 0);
    this.player.health = 14; this.player.hunger = Math.max(6, this.player.hunger);
    this.app.toast('You woke up near your camp. Your pack is safe.', '');
    this._syncCamera(); this.app.updateHud(true);
  }

  tickSurvival(dt) {
    if (this.record.mode === 'creative') return;
    this.hungerClock += dt;
    if (this.hungerClock > 72) {
      this.hungerClock = 0;
      if (this.player.hunger > 0) this.player.hunger = Math.max(0, this.player.hunger - 1);
      else this.damage(this.record.difficulty === 'hard' ? 2 : 1);
    }
    if (this.player.hunger >= 18 && this.player.health < 20) {
      this.elapsed += dt;
      if (this.elapsed > 40) { this.elapsed = 0; this.player.health = Math.min(20, this.player.health + 1); }
    }
  }

  updateEnvironment() {
    const h = this.hour;
    const daylight = clamp(Math.sin(((h - 6) / 12) * Math.PI), 0, 1);
    const dayColor = color('#81c5e4'), nightColor = color('#071326');
    const sky = nightColor.lerp(dayColor, 0.16 + daylight * 0.84);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = 38; this.scene.fog.far = 100 + this.settings.renderDistance * 26;
    this.ambient.intensity = 0.16 + daylight * 1.1;
    this.sunLight.intensity = 0.06 + daylight * 1.75;
    this.moonLight.intensity = 0.11 + (1 - daylight) * 0.38;
    const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const center = this.camera.position;
    const radius = 80;
    this.sun.position.set(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, center.z - 38);
    this.moon.position.set(center.x - Math.cos(angle) * radius, center.y - Math.sin(angle) * radius, center.z + 36);
    this.sun.visible = daylight > 0.02; this.moon.visible = daylight < 0.32;
    this.stars.position.set(center.x, center.y, center.z);
    this.stars.userData.material.opacity = clamp((0.35 - daylight) * 2.1, 0, 0.9);
    this.sunLight.position.set(center.x + Math.cos(angle) * 20, center.y + 35 + Math.sin(angle) * 20, center.z - 12);
  }

  formatTime() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt) {
    if (this.paused) return;
    dt = Math.min(0.05, dt);
    this.elapsed += dt; this.worldTime += dt; this.saveClock += dt; this.chunkClock += dt;
    this.player.damageCooldown = Math.max(0, this.player.damageCooldown - dt);
    this.tickSurvival(dt);
    this._move(dt);
    this._syncCamera();
    if (this.chunkClock > 0.55) {
      this.chunkClock = 0;
      this.world.ensureAround(this.player.pos.x, this.player.pos.z, this.settings.renderDistance);
    }
    this.creatures.update(dt);
    this.target = this.raycast();
    if (this.target) {
      this.outline.visible = true;
      this.outline.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else { this.outline.visible = false; this.progress.visible = false; }
    this._tickMining(dt);
    this.updateEnvironment();
    this.updateHeldItem();
    if (this.saveClock >= 7) { this.saveClock = 0; this.app.saveActiveWorld(); }
    this.lastHud += dt;
    if (this.lastHud > 0.16) { this.lastHud = 0; this.app.updateHud(); }
    this.app.sendPlayerState(dt);
  }

  updateHeldItem() {
    const selected = this.inventory.selectedItem();
    const id = selected?.id ?? -1;
    if (id === this.heldItemId) return;
    this.heldItemId = id;
    this.hand.clear();
    if (!selected) return;
    const mat = new THREE.MeshLambertMaterial({ color: selected.color || '#9a744a' });
    const wood = new THREE.MeshLambertMaterial({ color: '#91653e' });
    if (selected.block && selected.id !== ID.WATER && selected.id !== ID.TORCH) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat);
      cube.position.set(0.04, -0.02, 0.02); cube.rotation.set(0.12, 0.22, 0.1); this.hand.add(cube);
    } else if (selected.key.toLowerCase().includes('pick') || selected.key.toLowerCase().includes('axe') || selected.key.toLowerCase().includes('sword')) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.52, 0.08), wood);
      handle.position.set(0, -0.12, 0); handle.rotation.z = -0.32; this.hand.add(handle);
      const headSize = selected.key.toLowerCase().includes('sword') ? [0.12, 0.52, 0.06] : [0.36, 0.11, 0.1];
      const head = new THREE.Mesh(new THREE.BoxGeometry(...headSize), mat);
      head.position.set(0.08, 0.16, 0); head.rotation.z = -0.26; this.hand.add(head);
    } else {
      const thing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.12), mat);
      thing.position.set(0.05, -0.02, 0.02); this.hand.add(thing);
    }
  }

  setRemoteState(state) {
    if (!state || !Array.isArray(state.position) || state.position.length !== 3) return;
    if (!this.remote) {
      this.remote = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.34), new THREE.MeshLambertMaterial({ color: '#5b8eea' }));
      body.position.y = 1.05; this.remote.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.48), new THREE.MeshLambertMaterial({ color: '#d7ab83' }));
      head.position.y = 1.78; this.remote.add(head);
      const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.025), new THREE.MeshBasicMaterial({ color: '#1b2334' }));
      eyes.position.set(0, 1.81, -0.25); this.remote.add(eyes);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.7, 0.3), new THREE.MeshLambertMaterial({ color: '#363d62' }));
      legs.position.y = 0.35; this.remote.add(legs);
      this.scene.add(this.remote);
    }
    this.remote.position.set(state.position[0], state.position[1], state.position[2]);
    this.remote.rotation.y = Number(state.yaw) || 0;
  }

  serializePlayer() {
    return {
      position: [this.player.pos.x, this.player.pos.y, this.player.pos.z], yaw: this.player.yaw, pitch: this.player.pitch,
      health: this.player.health, hunger: this.player.hunger, time: this.worldTime,
      inventory: this.inventory.serialize(), selected: this.inventory.selected,
    };
  }

  serializeWorld() {
    return {
      id: this.record.id, name: this.record.name, seed: this.record.seed, mode: this.record.mode,
      difficulty: this.record.difficulty || 'normal', time: this.worldTime,
      position: [this.player.pos.x, this.player.pos.y, this.player.pos.z], yaw: this.player.yaw, pitch: this.player.pitch,
      health: this.player.health, hunger: this.player.hunger,
      inventory: this.inventory.serialize(), selected: this.inventory.selected,
      edits: this.world.serializeEdits(),
    };
  }

  dispose() {
    this.creatures?.dispose();
    if (this.remote) { this.scene.remove(this.remote); this.remote.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose?.(); }); }
    this.world?.dispose();
    this.outline?.geometry.dispose(); this.outline?.material.dispose();
    this.progress?.geometry.dispose(); this.progress?.material.dispose();
    this.stars?.geometry.dispose(); this.stars?.material.dispose();
    this.sun.geometry.dispose(); this.sun.material.dispose(); this.moon.geometry.dispose(); this.moon.material.dispose();
    this.ambient.dispose(); this.sunLight.dispose(); this.moonLight.dispose();
    this.scene.clear();
  }
}
