// ============================================================================
// NEXUS ENGINE — Gameplay components
// Health, DamageDealer, Pickup, Inventory (+crafting), Interactable,
// TriggerVolume, Door, Spawner, Checkpoint, Weapon, Projectile,
// DayNightCycle, AudioSource, SaveSystem, GameRules.
// ============================================================================
import * as THREE from 'three';
import { RuntimeComponent, type RuntimeObject } from '../runtime/object';
import { getComponentDef } from '../core/registry';
import { clamp, lerp } from '../core/math';

// ---------------------------------- Health ----------------------------------

export class HealthCmp extends RuntimeComponent {
  static register() { getComponentDef('Health')!.runtime = HealthCmp; }
  health: number;
  private regenTimer = 0;
  private invulnTimer = 0;
  dead = false;
  onDeath: ((from?: RuntimeObject) => void) | null = null;

  constructor(go: RuntimeObject, data: any, engine: any) {
    super(go, data, engine);
    this.health = data.startHealth ?? data.maxHealth ?? 100;
  }

  takeDamage(amount: number, from?: RuntimeObject) {
    if (this.dead || this.invulnTimer > 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.regenTimer = 0;
    this.invulnTimer = (this.data as any).invulnerableSeconds ?? 0;
    (this.engine as any).events.emit('damaged', { object: this.gameObject.id, amount, from: from?.id });
    if (this.health <= 0) this.die(from);
  }
  heal(amount: number) {
    if (this.dead) return;
    this.health = Math.min((this.data as any).maxHealth ?? 100, this.health + amount);
  }
  private die(from?: RuntimeObject) {
    if (this.dead) return;
    this.dead = true;
    this.onDeath?.(from);
    (this.engine as any).events.emit('died', { object: this.gameObject.id, name: this.gameObject.name, from: from?.id });
    const d = this.data as any;
    if (d.destroyOnDeath) this.gameObject.destroy();
  }
  respawn() {
    this.dead = false;
    this.health = (this.data as any).startHealth ?? (this.data as any).maxHealth ?? 100;
  }
  onUpdate(dt: number) {
    const d = this.data as any;
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (d.regenPerSecond && !this.dead) {
      this.regenTimer += dt;
      if (this.regenTimer >= (d.regenDelay ?? 4)) this.health = Math.min(d.maxHealth ?? 100, this.health + d.regenPerSecond * dt);
    }
  }
}

// ------------------------------- DamageDealer -------------------------------

export class DamageDealerCmp extends RuntimeComponent {
  static register() { getComponentDef('DamageDealer')!.runtime = DamageDealerCmp; }
  private cooldowns = new Map<string, number>();

  onTriggerEnter(other: RuntimeObject) { this.tryDamage(other); }
  onCollisionEnter(other: RuntimeObject) { this.tryDamage(other); }

  private tryDamage(other: RuntimeObject) {
    const d = this.data as any;
    const tag = d.affectsTag ?? 'player';
    if (tag && !other.hasTag(tag)) return;
    const now = (this.engine.time as any).now ?? 0;
    const last = this.cooldowns.get(other.id) ?? -999;
    if (now - last < (d.cooldownPerTarget ?? 1)) return;
    this.cooldowns.set(other.id, now);
    const health = other.getComponent<any>('Health');
    if (health?.takeDamage) {
      health.takeDamage(d.damage ?? 10, this.gameObject);
      if (d.destroySelf) this.gameObject.destroy();
    }
  }
}

// ---------------------------------- Pickup ----------------------------------

export class PickupCmp extends RuntimeComponent {
  static register() { getComponentDef('Pickup')!.runtime = PickupCmp; }
  private collected = false;
  private respawnTimer = 0;
  private baseY = 0;

  onStart() { this.baseY = this.gameObject.position.y; }

  onUpdate(dt: number) {
    const d = this.data as any;
    if (this.collected) {
      if (!d.respawn) return;
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.collected = false;
        this.gameObject.setActive(true);
      }
      return;
    }
    // bob & spin
    if (d.bob !== false) this.gameObject.holder.position.y = this.baseY + Math.sin((this.engine.time as any).now * 2.2 + this.baseY) * 0.12;
    if (d.spin !== false) this.gameObject.rotateY(dt * 1.6);
  }

  onTriggerEnter(other: RuntimeObject) {
    if (this.collected || !other.hasTag('player')) return;
    const inv = other.getComponent<any>('Inventory');
    const d = this.data as any;
    if (inv?.addItem) {
      if (inv.addItem(d.item ?? 'item', d.amount ?? 1)) {
        this.collected = true;
        (this.engine as any).events.emit('pickup', { item: d.item, amount: d.amount ?? 1, object: this.gameObject.id });
        ((this.engine as any).stats.itemsCollected ??= {})[d.item ?? 'item'] = (((this.engine as any).stats.itemsCollected ?? {})[d.item ?? 'item'] ?? 0) + (d.amount ?? 1);
        if (d.respawn) { this.respawnTimer = d.respawnSeconds ?? 30; this.gameObject.setActive(false); }
        else this.gameObject.destroy();
      }
    }
  }
}

// --------------------------------- Inventory --------------------------------

export class InventoryCmp extends RuntimeComponent {
  static register() { getComponentDef('Inventory')!.runtime = InventoryCmp; }
  items: Record<string, number> = {};

  onStart() {
    this.items = { ...((this.data as any).startingItems ?? {}) };
  }

  count(item: string): number { return this.items[item] ?? 0; }
  has(item: string, amount = 1): boolean { return this.count(item) >= amount; }

  addItem(item: string, amount = 1): boolean {
    const cap = (this.data as any).capacity ?? 100;
    const total = Object.values(this.items).reduce((a, b) => a + b, 0);
    if (total + amount > cap) return false;
    this.items[item] = (this.items[item] ?? 0) + amount;
    (this.engine as any).events.emit('inventoryChanged', { items: { ...this.items } });
    return true;
  }

  removeItem(item: string, amount = 1): boolean {
    if (!this.has(item, amount)) return false;
    this.items[item] -= amount;
    if (this.items[item] <= 0) delete this.items[item];
    (this.engine as any).events.emit('inventoryChanged', { items: { ...this.items } });
    return true;
  }

  craft(recipeId: string): boolean {
    const recipes = ((this.engine as any).recipes ?? []) as any[];
    const recipe = recipes.find(r => r.id === recipeId || r.name === recipeId);
    if (!recipe) return false;
    for (const [item, amount] of Object.entries(recipe.inputs ?? {})) {
      if (!this.has(item, amount as number)) return false;
    }
    for (const [item, amount] of Object.entries(recipe.inputs ?? {})) this.removeItem(item, amount as number);
    this.addItem(recipe.output, recipe.outputAmount ?? 1);
    (this.engine as any).events.emit('crafted', { recipe: recipeId, output: recipe.output });
    return true;
  }

  serialize() { return { ...this.items }; }
  restore(items: Record<string, number>) { this.items = { ...items }; (this.engine as any).events.emit('inventoryChanged', { items: { ...this.items } }); }
}

// ------------------------------- Interactable -------------------------------

export class InteractableCmp extends RuntimeComponent {
  static register() { getComponentDef('Interactable')!.runtime = InteractableCmp; }
  private used = false;

  static nearest: InteractableCmp | null = null;

  onUpdate(_dt: number) {
    const d = this.data as any;
    const player = (this.engine as any).player as RuntimeObject | null;
    if (!player || !this.gameObject.active) return;
    const dist = this.gameObject.distanceTo(player);
    if (dist <= (d.range ?? 3)) {
      // register as candidate prompt (runtime picks the closest each frame)
      const engine: any = this.engine;
      if (!engine.interactCandidate || engine.interactCandidate.dist > dist) {
        engine.interactCandidate = { cmp: this, dist };
      }
    }
  }

  /** Called by the runtime when the player presses the interact key. */
  interact(player: RuntimeObject) {
    const d = this.data as any;
    if (d.once && this.used) return;
    this.used = true;
    (this.engine as any).events.emit('interacted', { object: this.gameObject.id, name: this.gameObject.name });
    switch (d.action) {
      case 'openDoor': {
        const target = d.target ? this.engine.getGameObject(d.target) : null;
        const door = target?.getComponent<any>('Door') ?? this.gameObject.getComponent<any>('Door');
        door?.toggle();
        break;
      }
      case 'pickup': {
        const inv = player.getComponent<any>('Inventory');
        if (d.requireItem && !inv?.has(d.requireItem)) { this.engine.warn(`${this.gameObject.name}: requires ${d.requireItem}`); break; }
        inv?.addItem?.(d.requireItem ?? 'item', d.amount ?? 1);
        this.gameObject.destroy();
        break;
      }
      case 'save': {
        const saver = player.getComponent<any>('SaveSystem') ?? ((this.engine as any).saveSystem);
        saver?.saveNow?.(this.gameObject.worldPosition());
        break;
      }
      case 'rest': {
        const health = player.getComponent<any>('Health');
        health?.heal?.(999);
        break;
      }
      case 'craft': {
        (this.engine as any).ui?.show('Crafting');
        break;
      }
      default: {
        // custom → visual scripts / user scripts listen for the event
        break;
      }
    }
    // let scripts & NPCs handle interaction too
    for (const cmp of this.gameObject.components) {
      if (cmp !== this && cmp.onInteract) { try { cmp.onInteract(player); } catch { } }
    }
  }
}

// ------------------------------- TriggerVolume ------------------------------

export class TriggerVolumeCmp extends RuntimeComponent {
  static register() { getComponentDef('TriggerVolume')!.runtime = TriggerVolumeCmp; }
  private fired = new Set<string>();

  onTriggerEnter(other: RuntimeObject) {
    const d = this.data as any;
    if (d.tag && !other.hasTag(d.tag)) return;
    if (d.once) {
      if (this.fired.has(other.id)) return;
      this.fired.add(other.id);
    }
    (this.engine as any).events.emit('triggerEnter', { volume: this.gameObject.id, name: this.gameObject.name, object: other.id });
    (this.engine as any).events.emit(`trigger:${this.gameObject.name}`, { object: other.id });
  }
  onTriggerExit(other: RuntimeObject) {
    (this.engine as any).events.emit('triggerExit', { volume: this.gameObject.id, object: other.id });
  }
}

// ----------------------------------- Door -----------------------------------

export class DoorCmp extends RuntimeComponent {
  static register() { getComponentDef('Door')!.runtime = DoorCmp; }
  open = false;
  private t = 0; // 0 closed → 1 open
  private basePos = new THREE.Vector3();
  private baseRot = 0;

  onStart() {
    this.open = (this.data as any).startOpen ?? false;
    this.t = this.open ? 1 : 0;
    this.basePos.copy(this.gameObject.position);
    this.baseRot = this.gameObject.rotation.y;
  }

  toggle() { this.open = !this.open; (this.engine as any).events.emit('doorToggled', { door: this.gameObject.id, open: this.open }); }
  setOpen(o: boolean) { this.open = o; }

  onUpdate(dt: number) {
    const d = this.data as any;
    this.t = clamp(this.t + (this.open ? 1 : -1) * dt * (d.speed ?? 3), 0, 1);
    const e = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2; // easeInOut
    if ((d.mode ?? 'slide') === 'slide') {
      const off = d.openOffset ?? { x: 0, y: 3, z: 0 };
      this.gameObject.holder.position.set(
        this.basePos.x + off.x * e, this.basePos.y + off.y * e, this.basePos.z + off.z * e,
      );
    } else {
      this.gameObject.holder.rotation.y = this.baseRot + (d.openAngle ?? 100) * Math.PI / 180 * e;
    }
    this.gameObject.syncToData();
  }
}

// ---------------------------------- Spawner ---------------------------------

export class SpawnerCmp extends RuntimeComponent {
  static register() { getComponentDef('Spawner')!.runtime = SpawnerCmp; }
  private timer = 0;
  private spawned = new Set<string>();
  private spawnedOnce = false;
  private wasNight = false;
  private wasDay = false;
  aliveCount = 0;

  onStart() {
    const d = this.data as any;
    if (d.mode === 'once') { this.timer = 0.5; }
    else this.timer = Math.min(2, d.interval ?? 12) ; // first spawn quickly
    const dayNight = (this.engine as any).dayNight;
    this.wasNight = !!dayNight?.isNight;
    this.wasDay = !dayNight ? true : !dayNight.isNight;
  }

  private spawnNow(): RuntimeObject | null {
    const d = this.data as any;
    const prefabId = d.prefab;
    if (!prefabId) return null;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * (d.spawnRadius ?? 6);
    const pos = this.gameObject.worldPosition();
    const spawnPos = { x: pos.x + Math.cos(angle) * r, y: pos.y + (d.offset?.y ?? 0.2), z: pos.z + Math.sin(angle) * r };
    const go = this.engine.spawn(prefabId, spawnPos);
    if (go) {
      this.spawned.add(go.id);
      this.aliveCount++;
      (this.engine as any).events.emit('spawned', { spawner: this.gameObject.id, object: go.id, prefab: prefabId });
    }
    return go;
  }

  onGameObjectDestroyed(id: string) {
    if (this.spawned.has(id)) { this.spawned.delete(id); this.aliveCount = Math.max(0, this.aliveCount - 1); }
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    const dayNight = (this.engine as any).dayNight;
    const isNight = !!dayNight?.isNight;
    let active = true;
    if (d.mode === 'night') active = isNight;
    else if (d.mode === 'day') active = !isNight;
    else if (d.mode === 'once') active = !this.spawnedOnce;

    if (d.mode === 'night' && isNight && !this.wasNight) this.timer = 0; // spawn immediately at dusk
    if (d.mode === 'day' && !isNight && !this.wasDay) this.timer = 0;
    this.wasNight = isNight;
    this.wasDay = !isNight;

    if (!active) return;
    // cull the dead from our tracking
    for (const id of [...this.spawned]) {
      const go = this.engine.getGameObject(id);
      if (!go || !go.active || go.destroyed) this.onGameObjectDestroyed(id);
    }
    if (this.spawned.size >= (d.maxAlive ?? 4)) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      const go = this.spawnNow();
      this.timer = go ? (d.interval ?? 12) : 3; // retry sooner on failure
      if (go && d.mode === 'once') this.spawnedOnce = true;
    }
  }
}

// --------------------------------- Checkpoint -------------------------------

export class CheckpointCmp extends RuntimeComponent {
  static register() { getComponentDef('Checkpoint')!.runtime = CheckpointCmp; }
  static current: { x: number; y: number; z: number } | null = null;

  onUpdate(_dt: number) {
    const player = (this.engine as any).player as RuntimeObject | null;
    if (!player) return;
    const d = this.data as any;
    if (d.isStart && !CheckpointCmp.current) CheckpointCmp.current = this.gameObject.worldPosition();
    if (this.gameObject.distanceTo(player) <= (d.radius ?? 2.5)) {
      if (CheckpointCmp.current !== this.gameObject.worldPosition()) {
        CheckpointCmp.current = this.gameObject.worldPosition();
        (this.engine as any).saveSystem?.saveNow?.(CheckpointCmp.current);
        (this.engine as any).events.emit('checkpoint', { object: this.gameObject.id });
        this.engine.log(`Checkpoint reached: ${this.gameObject.name}`);
      }
    }
  }
}

// ----------------------------------- Weapon ---------------------------------

export class WeaponCmp extends RuntimeComponent {
  static register() { getComponentDef('Weapon')!.runtime = WeaponCmp; }
  private cooldown = 0;
  private player = false;

  onStart() {
    this.player = this.gameObject.hasTag('player') || !!this.gameObject.getComponent('ThirdPersonController') || !!this.gameObject.getComponent('FirstPersonController') || !!this.gameObject.getComponent('TopDownController');
  }

  swing(): boolean {
    if (this.cooldown > 0) return false;
    const d = this.data as any;
    this.cooldown = d.cooldown ?? 0.7;
    // stamina cost
    const ctrl = (this.engine as any).playerController as any;
    if (d.staminaCost && ctrl) { ctrl.stamina = Math.max(0, ctrl.stamina - d.staminaCost); }
    const charBody = this.gameObject.getComponent<any>('CharacterBody');
    charBody?.attackAnim?.();
    if (d.swingSound) (this.engine as any).audio?.play2D?.(d.swingSound, { volume: 0.5 });
    // find target in range & facing
    const p = this.gameObject.worldPosition();
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.gameObject.holder.quaternion);
    let best: RuntimeObject | null = null, bestDist = Infinity;
    for (const o of this.engine.findByTag(d.affectsTag ?? 'enemy')) {
      if (!o.active) continue;
      const op = o.worldPosition();
      const to = new THREE.Vector3(op.x - p.x, op.y - p.y, op.z - p.z);
      const dist = to.length();
      if (dist > (d.range ?? 2.2)) continue;
      to.normalize();
      if (to.dot(facing) < 0.35) continue;
      if (dist < bestDist) { bestDist = dist; best = o; }
    }
    (this.engine as any).events.emit('weaponSwing', { weapon: this.gameObject.id, hit: best?.id ?? null });
    if (best) {
      const npc = best.getComponent<any>('NPC');
      const health = best.getComponent<any>('Health');
      if (npc?.takeDamage) npc.takeDamage(d.damage ?? 15, this.gameObject);
      else health?.takeDamage?.(d.damage ?? 15, this.gameObject);
    }
    return true;
  }

  onUpdate(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.player) {
      const input = (this.engine as any).input;
      if (input?.mouse.locked && (input.mouse.buttons & 1)) this.swing();
    }
  }
}

// --------------------------------- Projectile -------------------------------

export class ProjectileCmp extends RuntimeComponent {
  static register() { getComponentDef('Projectile')!.runtime = ProjectileCmp; }
  private velocity = new THREE.Vector3();
  private life = 0;
  private dir = new THREE.Vector3(0, 0, 1);

  onStart() {
    const d = this.data as any;
    this.dir.set(0, 0, 1).applyQuaternion(this.gameObject.holder.quaternion);
    this.velocity.copy(this.dir).multiplyScalar(d.speed ?? 26);
    this.life = d.lifetime ?? 4;
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    this.life -= dt;
    if (this.life <= 0) { this.gameObject.destroy(); return; }
    this.velocity.y -= (d.gravity ?? 0) * 9.82 * dt;
    const step = this.velocity.clone().multiplyScalar(dt);
    const from = this.gameObject.worldPosition();
    const to = { x: from.x + step.x, y: from.y + step.y, z: from.z + step.z };
    // sweep test
    const hit = (this.engine as any).physics?.raycast(from, to, this.gameObject.id);
    if (hit) {
      const target = hit.gameObjectId ? this.engine.getGameObject(hit.gameObjectId) : null;
      if (target && (target.hasTag(d.affectsTag ?? 'enemy') || d.affectsTag === 'any')) {
        const npc = target.getComponent<any>('NPC');
        const health = target.getComponent<any>('Health');
        if (npc?.takeDamage) npc.takeDamage(d.damage ?? 12, (this.engine as any).player);
        else health?.takeDamage?.(d.damage ?? 12);
      }
      this.gameObject.destroy();
      return;
    }
    this.gameObject.move(step.x, step.y, step.z);
  }
}

// ------------------------------- DayNightCycle ------------------------------

export class DayNightCycleCmp extends RuntimeComponent {
  static register() { getComponentDef('DayNightCycle')!.runtime = DayNightCycleCmp; }
  timeOfDay: number; // hours 0..24
  dayCount = 1;
  isNight = false;
  private nightFactor = 0; // 0 day → 1 night
  private lastIsNight = false;

  constructor(go: RuntimeObject, data: any, engine: any) {
    super(go, data, engine);
    this.timeOfDay = data.startAtNight ? 22 : (data.startTime ?? 10);
  }

  onStart() {
    const engine: any = this.engine;
    engine.dayNight = this;
    this.lastIsNight = this.timeOfDay < 6 || this.timeOfDay >= 20;
    this.isNight = this.lastIsNight;
    engine.events.emit(this.isNight ? 'night' : 'day', { time: this.timeOfDay, day: this.dayCount });
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    const dayLength = Math.max(10, (d.dayLengthMinutes ?? 4) * 60);
    this.timeOfDay = (this.timeOfDay + (24 / dayLength) * dt) % 24;
    if (this.timeOfDay < dt * 24 / dayLength) { /* wrapped */ }
    const engine: any = this.engine;
    engine.timeOfDay = this.timeOfDay;

    // sun angle: 6h = sunrise (east), 12h = noon, 18h = sunset, 0h = midnight
    const sunAngle = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    const elevation = Math.sin(sunAngle); // -1..1
    this.nightFactor = clamp(-elevation * 1.6 + 0.5, 0, 1);
    const api = engine.rendererApi;
    if (api) {
      const dayAmb = d.dayAmbient ?? 0.5, nightAmb = d.nightAmbient ?? 0.16;
      const sunI = Math.max(0, elevation) * (d.sunIntensity ?? 2.4);
      const moonI = Math.max(0, -elevation) * (d.moonIntensity ?? 0.35);
      // sky colors blend day ↔ dusk ↔ night
      const dayTop = new THREE.Color('#4a7fbf'), dayBottom = new THREE.Color('#bcd6ea');
      const duskTop = new THREE.Color('#2b2340'), duskBottom = new THREE.Color('#c96b3f');
      const nightTop = new THREE.Color('#05070f'), nightBottom = new THREE.Color('#131b2e');
      const t1 = clamp(elevation * 2.2, 0, 1); // dusk→day
      const t2 = clamp(-elevation * 2.2, 0, 1); // dusk→night
      const top = nightTop.clone().lerp(duskTop, 1 - t2).lerp(dayTop, t1);
      const bottom = nightBottom.clone().lerp(duskBottom, 1 - t2).lerp(dayBottom, t1);
      api.setSky(`#${top.getHexString()}`, `#${bottom.getHexString()}`);
      api.setAmbient('#9fb6d8', lerp(nightAmb, dayAmb, 1 - this.nightFactor));
      const isDay = elevation > 0;
      const sunDir = new THREE.Vector3(Math.cos(sunAngle) * 0.8, Math.abs(elevation), Math.sin(sunAngle) * 0.35).normalize();
      if (isDay) {
        api.setSun('#ffe9c4', sunI, 0, clamp(elevation * 80, 3, 88), true);
        api.setSunFromDirection?.(sunDir);
      } else {
        api.setSun('#8fa8ff', moonI, 0, clamp(-elevation * 80, 3, 88), true);
        api.setSunFromDirection?.(new THREE.Vector3(-sunDir.x, Math.abs(elevation), -sunDir.z).normalize());
      }
      if (api.setNightFactor) api.setNightFactor(this.nightFactor);
    }

    this.isNight = this.timeOfDay < 6 || this.timeOfDay >= 20;
    if (this.isNight !== this.lastIsNight) {
      this.lastIsNight = this.isNight;
      if (this.isNight) { this.dayCount++; engine.events.emit('night', { time: this.timeOfDay, day: this.dayCount }); }
      else engine.events.emit('day', { time: this.timeOfDay, day: this.dayCount });
    }
  }
}

// --------------------------------- AudioSource ------------------------------

export class AudioSourceCmp extends RuntimeComponent {
  static register() { getComponentDef('AudioSource')!.runtime = AudioSourceCmp; }
  private handle: any = null;

  async onStart() {
    const d = this.data as any;
    if (!d.autoplay || !d.clip) return;
    await this.play();
  }
  async play() {
    const d = this.data as any;
    const audio = (this.engine as any).audio;
    if (!audio || !d.clip) return;
    this.stop();
    if (d.spatial) {
      this.handle = await audio.play3D(d.clip, this.gameObject.holder, {
        volume: d.volume ?? 0.8, loop: d.loop, minDistance: d.minDistance, maxDistance: d.maxDistance, rolloff: d.rolloff,
      });
    } else {
      this.handle = await audio.play2D(d.clip, { volume: d.volume ?? 0.8, loop: d.loop, channel: d.channel ?? 'sfx' });
    }
  }
  stop() { this.handle?.stop?.(); this.handle = null; }
  onDestroy() { this.stop(); }
}

// --------------------------------- SaveSystem -------------------------------

export class SaveSystemCmp extends RuntimeComponent {
  static register() { getComponentDef('SaveSystem')!.runtime = SaveSystemCmp; }
  private autosaveTimer = 0;
  lastSavePoint: { x: number; y: number; z: number } | null = null;

  onStart() {
    const engine: any = this.engine;
    engine.saveSystem = this;
    this.lastSavePoint = CheckpointCmp.current;
  }

  saveNow(at?: { x: number; y: number; z: number }) {
    const d = this.data as any;
    const player = (this.engine as any).player as RuntimeObject | null;
    if (!player) return;
    const payload: any = {
      position: at ?? player.worldPosition(),
      health: player.getComponent<any>('Health')?.health,
      inventory: player.getComponent<any>('Inventory')?.serialize(),
      savedAt: Date.now(),
    };
    const dayNight = (this.engine as any).dayNight;
    if (d.includeTime !== false && dayNight) { payload.timeOfDay = dayNight.timeOfDay; payload.dayCount = dayNight.dayCount; }
    try {
      const key = `${(this.engine as any).savePrefix ?? 'nexus'}:${d.saveKey ?? 'nexus_save'}`;
      localStorage.setItem(key, JSON.stringify(payload));
      this.lastSavePoint = payload.position;
      (this.engine as any).events.emit('saved', { at: payload.position });
      this.engine.log('Game saved.');
    } catch (e) { this.engine.warn('Save failed: ' + e); }
  }

  static loadRaw(prefix: string, key: string): any | null {
    try {
      const raw = localStorage.getItem(`${prefix}:${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  apply(payload: any) {
    const player = (this.engine as any).player as RuntimeObject | null;
    if (!player) return;
    if (payload.position) player.setPosition(payload.position.x, payload.position.y + 0.5, payload.position.z);
    if (payload.health !== undefined) {
      const h = player.getComponent<any>('Health');
      if (h) { h.health = clamp(payload.health, 1, h.data.maxHealth); h.dead = false; }
    }
    if (payload.inventory) player.getComponent<any>('Inventory')?.restore(payload.inventory);
    const dayNight = (this.engine as any).dayNight;
    if (dayNight && payload.timeOfDay !== undefined) { dayNight.timeOfDay = payload.timeOfDay; dayNight.dayCount = payload.dayCount ?? 1; }
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    if (d.autosaveSeconds > 0) {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= d.autosaveSeconds) { this.autosaveTimer = 0; this.saveNow(); }
    }
  }
}

// --------------------------------- GameRules --------------------------------

export class GameRulesCmp extends RuntimeComponent {
  static register() { getComponentDef('GameRules')!.runtime = GameRulesCmp; }
  private ended = false;
  private startTime = 0;
  private respawnTimer = -1;

  onStart() {
    this.startTime = (this.engine.time as any).now ?? 0;
    const engine: any = this.engine;
    engine.events.on('died', (payload: any) => {
      const object = payload?.object ?? payload;
      const player = engine.player;
      if (player && object === player.id && !this.ended) {
        if ((this.data as any).loseWhenPlayerDies !== false) {
          this.ended = true;
          engine.ui?.show('Lose');
          engine.events.emit('gameOver', { win: false });
        } else if ((this.data as any).respawnOnDeath) {
          this.respawnTimer = (this.data as any).respawnSeconds ?? 3;
        }
      }
    });
  }

  onUpdate(dt: number) {
    if (this.ended) return;
    const d = this.data as any;
    const engine: any = this.engine;
    if (this.respawnTimer >= 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer < 0) {
        const player = (engine as any).player;
        if (player) {
          (player as any).getComponent('Health')?.respawn();
          const point = d.respawnPoint ? engine.getGameObject(d.respawnPoint) : null;
          const cp = CheckpointCmp.current ?? point?.worldPosition();
          if (cp) player.setPosition(cp.x, cp.y + 1, cp.z);
          engine.ui?.hide('Lose');
        }
      }
      return;
    }
    const stats = engine.stats;
    if (d.winWhenEnemiesKilled > 0 && (stats.kills ?? 0) >= d.winWhenEnemiesKilled) this.win();
    if (d.winWhenItemCollected) {
      const player: any = (engine as any).player;
      const inv = player?.getComponent('Inventory');
      const amount = d.winWhenItemAmount ?? 1;
      if (inv?.has(d.winWhenItemCollected, amount)) this.win();
    }
    if (d.winWhenTimeSurvived > 0 && ((engine.time.now ?? 0) - this.startTime) >= d.winWhenTimeSurvived) this.win();
  }

  private win() {
    if (this.ended) return;
    this.ended = true;
    const engine: any = this.engine;
    engine.ui?.show('Win');
    engine.events.emit('gameOver', { win: true, stats: { ...engine.stats } });
  }
}

export function registerGameplayComponents() {
  HealthCmp.register();
  DamageDealerCmp.register();
  PickupCmp.register();
  InventoryCmp.register();
  InteractableCmp.register();
  TriggerVolumeCmp.register();
  DoorCmp.register();
  SpawnerCmp.register();
  CheckpointCmp.register();
  WeaponCmp.register();
  ProjectileCmp.register();
  DayNightCycleCmp.register();
  AudioSourceCmp.register();
  SaveSystemCmp.register();
  GameRulesCmp.register();
}
