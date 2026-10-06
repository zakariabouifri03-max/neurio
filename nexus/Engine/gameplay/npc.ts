// ============================================================================
// NEXUS ENGINE — NPC / Enemy AI
// Finite state machine (idle, patrol, investigate, follow, chase, attack,
// flee, dead), vision cone + hearing detection, steering navigation with
// obstacle avoidance whiskers, attack cooldowns, loot drops, dialogue &
// vendor behaviour for friendly NPCs.
// ============================================================================
import * as THREE from 'three';
import { RuntimeComponent, type RuntimeObject } from '../runtime/object';
import { getComponentDef } from '../core/registry';
import { clamp, damp, moveTowards } from '../core/math';

export type NpcState = 'idle' | 'patrol' | 'investigate' | 'follow' | 'chase' | 'attack' | 'flee' | 'dead';

export class NPCCmp extends RuntimeComponent {
  static register() { getComponentDef('NPC')!.runtime = NPCCmp; }

  state: NpcState = 'idle';
  health: number;
  private patrolIndex = 0;
  private patrolWaitTimer = 0;
  private patrolForward = 1;
  private target: RuntimeObject | null = null;
  private lastSeenPos: { x: number; y: number; z: number } | null = null;
  private investigateTimer = 0;
  private attackCooldown = 0;
  private stateTime = 0;
  private body: any = null;
  private velocity = { x: 0, z: 0 };
  private wanderAngle = Math.random() * Math.PI * 2;
  private wanderTimer = 0;
  private aiDisabled = false;
  private deadHandled = false;
  private regenTickTimer = 0;
  onStateChange: ((from: NpcState, to: NpcState) => void) | null = null;

  constructor(go: RuntimeObject, data: any, engine: any) {
    super(go, data, engine);
    this.health = data.maxHealth ?? 60;
    this.state = data.initialState ?? 'patrol';
  }

  get role() { return (this.data as any).role ?? 'enemy'; }

  onStart() {
    this.body = (this.engine as any).physics?.getBody(this.gameObject.id) ?? null;
    if (!this.gameObject.hasTag('npc')) this.gameObject.tags.push('npc');
    if (this.role === 'enemy' && !this.gameObject.hasTag('enemy')) this.gameObject.tags.push('enemy');
    if ((this.role === 'ally' || this.role === 'guard') && !this.gameObject.hasTag('ally')) this.gameObject.tags.push('ally');
    if ((this.data as any).initialState === 'patrol' && !((this.data as any).patrolPoints?.length)) {
      // auto-generate a small patrol loop around spawn
      const p = this.gameObject.position;
      const pts = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        pts.push({ x: p.x + Math.cos(a) * 6, y: p.y, z: p.z + Math.sin(a) * 6 });
      }
      (this.data as any).patrolPoints = pts;
    }
    if (this.gameObject.hasTag('enemy')) ((this.engine as any).stats.enemiesTotal ??= 0, (this.engine as any).stats.enemiesTotal++);
  }

  setState(s: NpcState) {
    if (this.state === s) return;
    const from = this.state;
    this.state = s;
    this.stateTime = 0;
    this.onStateChange?.(from, s);
    (this.engine as any).events.emit('npcState', { npc: this.gameObject.id, from, to: s });
  }

  private get player() { return ((this.engine as any).player as RuntimeObject) ?? null; }

  private canSee(target: RuntimeObject): boolean {
    const d = this.data as any;
    const dist = this.gameObject.distanceTo(target);
    if (dist > (d.detectionRange ?? 14)) return false;
    // FOV check (ignore for touch range)
    if (dist < 2.2) return true;
    const dir = new THREE.Vector3(
      target.position.x - this.gameObject.position.x, 0,
      target.position.z - this.gameObject.position.z,
    ).normalize();
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.gameObject.holder.quaternion);
    facing.y = 0; facing.normalize();
    const dot = dir.dot(facing);
    const fovCos = Math.cos(((d.detectionFov ?? 130) * Math.PI / 180) / 2);
    if (dot < fovCos) return false;
    // line of sight raycast (walls block vision)
    const from = this.gameObject.worldPosition();
    const to = target.worldPosition();
    const hit = (this.engine as any).physics?.raycast(
      { x: from.x, y: from.y + 1.2, z: from.z },
      { x: to.x, y: to.y + 1.2, z: to.z },
      this.gameObject.id,
    );
    if (hit && hit.gameObjectId && hit.gameObjectId !== target.id) {
      // something solid between us — blocked unless it's the target
      const blocker = (this.engine as any).getGameObject(hit.gameObjectId);
      if (blocker && !blocker.hasTag('player')) return false;
    }
    return true;
  }

  private hears(target: RuntimeObject): boolean {
    const d = this.data as any;
    if (!(d.hearingRange ?? 20)) return false;
    const player = this.player;
    if (!player || target !== player) return false;
    const ctrl = (this.engine as any).playerController;
    const running = ctrl?.speedNorm > 0.8;
    const range = running ? (d.hearingRange ?? 20) : (d.hearingRange ?? 20) * 0.4;
    return this.gameObject.distanceTo(target) < range;
  }

  private isTargetOfInterest(o: RuntimeObject | null): boolean {
    if (!o) return false;
    if (this.role === 'enemy') return o.hasTag('player') || o.hasTag('ally');
    if (this.role === 'guard' || this.role === 'ally') return o.hasTag('enemy');
    return false;
  }

  takeDamage(amount: number, from?: RuntimeObject) {
    if (this.state === 'dead') return;
    this.health = Math.max(0, this.health - amount);
    const bodyCmp = this.gameObject.getComponent<any>('CharacterBody');
    bodyCmp?.hitAnim?.();
    // red flash
    const mesh = this.gameObject.slots.mesh as THREE.Mesh;
    if (mesh?.material) { /* leave to materials; simple damage feedback via scale pulse */ }
    if (from) {
      this.lastSeenPos = from.worldPosition();
      if (this.isTargetOfInterest(from) || this.role === 'enemy') {
        this.target = from;
        this.setState('chase');
      } else if (this.role !== 'enemy') {
        this.setState('investigate');
        this.investigateTimer = (this.data as any).investigateDuration ?? 6;
      }
    }
    if (this.health <= 0) this.die();
    else if ((this.data as any).fleeBelowHealthPct > 0 && this.health / (this.data as any).maxHealth < (this.data as any).fleeBelowHealthPct) {
      this.setState('flee');
    }
  }

  private die() {
    if (this.deadHandled) return;
    this.deadHandled = true;
    this.setState('dead');
    const d = this.data as any;
    (this.engine as any).stats.kills++;
    (this.engine as any).events.emit('npcDied', { npc: this.gameObject.id, name: this.gameObject.name });
    // loot drop
    if (d.loot && this.player) {
      const inv = (this.player.getComponent('Inventory') as any);
      inv?.addItem?.(d.loot, d.lootAmount ?? 1);
    }
    // death pose then destroy/deactivate
    const charBody = this.gameObject.getComponent<any>('CharacterBody');
    if (charBody?.parts) {
      charBody.parts.hips.rotation.x = Math.PI / 2.2;
      charBody.parts.hips.position.y = 0.35;
    }
    if (d.onDeathDestroy !== false) {
      setTimeout(() => { if (!this.destroyed) this.gameObject.destroy(); }, 2500);
    } else {
      this.gameObject.setActive(false);
    }
    this.aiDisabled = true;
  }

  private attackTarget(target: RuntimeObject) {
    const d = this.data as any;
    if (this.attackCooldown > 0) return;
    this.attackCooldown = d.attackCooldown ?? 1.4;
    const dmg = d.attackDamage ?? 12;
    const health = target.getComponent<any>('Health');
    const dealer = this.gameObject.getComponent<any>('DamageDealer');
    health?.takeDamage?.(dmg, this.gameObject);
    const charBody = this.gameObject.getComponent<any>('CharacterBody');
    charBody?.attackAnim?.();
    (this.engine as any).events.emit('npcAttack', { npc: this.gameObject.id, target: target.id, damage: dmg });
  }

  private moveTowardsPoint(pt: { x: number; y: number; z: number }, speed: number, dt: number) {
    const d = this.data as any;
    const p = this.gameObject.position;
    let dirX = pt.x - p.x, dirZ = pt.z - p.z;
    const dist = Math.hypot(dirX, dirZ);
    if (dist < 0.05) return 0;
    dirX /= dist; dirZ /= dist;

    // obstacle avoidance whiskers
    if (d.avoidObstacles !== false && (this.engine as any).physics) {
      const from = this.gameObject.worldPosition();
      for (const side of [-0.6, 0.6]) {
        const ax = dirX * Math.cos(side) - dirZ * Math.sin(side);
        const az = dirX * Math.sin(side) + dirZ * Math.cos(side);
        const hit = (this.engine as any).physics.raycast(
          { x: from.x, y: from.y + 0.8, z: from.z },
          { x: from.x + ax * 2.2, y: from.y + 0.8, z: from.z + az * 2.2 },
          this.gameObject.id,
        );
        if (hit) {
          // steer away perpendicular
          const away = side <= 0 ? 1 : -1;
          const px = -dirZ * away, pz = dirX * away;
          dirX = dirX * 0.35 + px * 0.65;
          dirZ = dirZ * 0.35 + pz * 0.65;
          const l = Math.hypot(dirX, dirZ) || 1;
          dirX /= l; dirZ /= l;
          break;
        }
      }
    }

    const targetVx = dirX * speed, targetVz = dirZ * speed;
    if (this.body) {
      this.body.velocity.x = damp(this.body.velocity.x, targetVx, 8, dt);
      this.body.velocity.z = damp(this.body.velocity.z, targetVz, 8, dt);
    } else {
      this.velocity.x = damp(this.velocity.x, targetVx, 8, dt);
      this.velocity.z = damp(this.velocity.z, targetVz, 8, dt);
      this.gameObject.move(this.velocity.x * dt, 0, this.velocity.z * dt);
    }
    // face movement
    const targetYaw = Math.atan2(dirX, dirZ);
    let diff = targetYaw - this.gameObject.holder.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.gameObject.holder.rotation.y += diff * Math.min(1, dt * 8);
    this.gameObject.syncToData();
    return dist;
  }

  private stopMove(dt: number) {
    if (this.body) { this.body.velocity.x *= 0.8; this.body.velocity.z *= 0.8; }
    else { this.velocity.x *= 0.8; this.velocity.z *= 0.8; }
  }

  private animate(dt: number) {
    const charBody = this.gameObject.getComponent<any>('CharacterBody');
    const speed = this.body ? Math.hypot(this.body.velocity.x, this.body.velocity.z) : Math.hypot(this.velocity.x, this.velocity.z);
    if (charBody?.animate) charBody.animate(dt, clamp(speed / 3.2, 0, 1.3));
    const animator = this.gameObject.getComponent<any>('Animator');
    if (animator?.setLocomotion) animator.setLocomotion(clamp(speed / 3.2, 0, 1.3), true);
  }

  onUpdate(dt: number) {
    if (this.aiDisabled) { this.animate(dt); return; }
    const d = this.data as any;
    this.stateTime += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // day/night activity gating
    const dayNight = (this.engine as any).dayNight;
    if (dayNight) {
      if (d.nightOnly && !dayNight.isNight) { this.stopMove(dt); this.animate(dt); return; }
      if (d.dayOnly && dayNight.isNight) { this.stopMove(dt); this.animate(dt); return; }
    }

    // acquire target
    if (!this.target || this.target.destroyed || !this.isTargetOfInterest(this.target)) {
      this.target = null;
      if (this.role === 'enemy') {
        if (this.player && this.player.active && (this.canSee(this.player) || this.hears(this.player))) this.target = this.player;
      } else {
        const enemies = this.engine.findByTag('enemy');
        for (const e of enemies) { if (e.active && this.canSee(e)) { this.target = e; break; } }
      }
    } else if (!this.canSee(this.target)) {
      // lost sight
      if (this.gameObject.distanceTo(this.target) > (d.loseInterestRange ?? 26)) this.target = null;
    } else {
      this.lastSeenPos = this.target.worldPosition();
    }

    // health regen (slow)
    this.regenTickTimer += dt;
    if (this.regenTickTimer > 1) {
      this.regenTickTimer = 0;
      this.health = Math.min(d.maxHealth ?? 60, this.health + 1);
    }

    switch (this.state) {
      case 'idle': {
        this.stopMove(dt);
        if (this.target) this.setState('chase');
        else if (d.patrolPoints?.length && this.stateTime > 2) this.setState('patrol');
        break;
      }
      case 'patrol': {
        if (this.target) { this.setState('chase'); break; }
        const pts = d.patrolPoints ?? [];
        if (!pts.length) { this.setState('idle'); break; }
        if (this.patrolWaitTimer > 0) {
          this.patrolWaitTimer -= dt;
          this.stopMove(dt);
          break;
        }
        const pt = pts[this.patrolIndex % pts.length];
        const dist = this.moveTowardsPoint(pt, d.moveSpeed ?? 2.4, dt);
        if (dist < 0.8) {
          if (d.patrolLoop !== false) this.patrolIndex = (this.patrolIndex + 1) % pts.length;
          else {
            this.patrolIndex += this.patrolForward;
            if (this.patrolIndex >= pts.length || this.patrolIndex < 0) {
              this.patrolForward *= -1;
              this.patrolIndex += this.patrolForward * 2;
            }
          }
          this.patrolWaitTimer = d.patrolWait ?? 1.2;
        }
        break;
      }
      case 'investigate': {
        this.investigateTimer -= dt;
        if (this.target) { this.setState('chase'); break; }
        const pt = this.lastSeenPos;
        if (pt) {
          const dist = this.moveTowardsPoint(pt, (d.moveSpeed ?? 2.4) * 1.15, dt);
          if (dist < 1.2) this.lastSeenPos = null;
        } else {
          // wander around
          this.wanderTimer -= dt;
          if (this.wanderTimer <= 0) { this.wanderAngle = Math.random() * Math.PI * 2; this.wanderTimer = 1 + Math.random() * 2; }
          const p = this.gameObject.position;
          this.moveTowardsPoint({ x: p.x + Math.cos(this.wanderAngle) * 3, y: p.y, z: p.z + Math.sin(this.wanderAngle) * 3 }, d.moveSpeed ?? 2.4, dt);
        }
        if (this.investigateTimer <= 0) this.setState(d.patrolPoints?.length ? 'patrol' : 'idle');
        break;
      }
      case 'follow': {
        if (!this.target) { this.setState('idle'); break; }
        const dist = this.moveTowardsPoint(this.target.worldPosition(), d.moveSpeed ?? 2.4, dt);
        if (dist < 2.2) this.stopMove(dt);
        break;
      }
      case 'chase': {
        if (!this.target) { this.setState('investigate'); this.investigateTimer = d.investigateDuration ?? 6; break; }
        const dist = this.gameObject.distanceTo(this.target);
        if (dist <= (d.attackRange ?? 1.9)) { this.setState('attack'); break; }
        this.moveTowardsPoint(this.target.worldPosition(), d.chaseSpeed ?? 4.6, dt);
        break;
      }
      case 'attack': {
        if (!this.target) { this.setState('investigate'); break; }
        const dist = this.gameObject.distanceTo(this.target);
        if (dist > (d.attackRange ?? 1.9) * 1.25) { this.setState('chase'); break; }
        // face target
        const t = this.target.worldPosition(), p = this.gameObject.position;
        const targetYaw = Math.atan2(t.x - p.x, t.z - p.z);
        let diff = targetYaw - this.gameObject.holder.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.gameObject.holder.rotation.y += diff * Math.min(1, dt * 10);
        this.stopMove(dt);
        this.attackTarget(this.target);
        break;
      }
      case 'flee': {
        if (!this.target) { this.setState('patrol'); break; }
        const t = this.target.worldPosition(), p = this.gameObject.position;
        const away = { x: p.x + (p.x - t.x) * 2, y: p.y, z: p.z + (p.z - t.z) * 2 };
        this.moveTowardsPoint(away, (d.chaseSpeed ?? 4.6) * 1.1, dt);
        if (this.gameObject.distanceTo(this.target) > (d.loseInterestRange ?? 26) * 0.8) this.setState('patrol');
        break;
      }
      case 'dead': break;
    }
    this.animate(dt);
  }

  /** Player interaction (vendors, guards, quest NPCs). */
  onInteract(player: RuntimeObject) {
    const d = this.data as any;
    if (this.role === 'vendor') {
      (this.engine as any).events.emit('npcDialogue', { npc: this.gameObject.id, lines: d.dialogue ?? [], shop: d.shopItems ?? {} });
    } else if (d.dialogue?.length) {
      (this.engine as any).events.emit('npcDialogue', { npc: this.gameObject.id, lines: d.dialogue });
    } else if (this.role === 'guard' || this.role === 'ally') {
      (this.engine as any).events.emit('npcDialogue', { npc: this.gameObject.id, lines: ['Guard: The area is secure.'] });
    }
  }
}

export function registerNpcComponents() {
  NPCCmp.register();
}
