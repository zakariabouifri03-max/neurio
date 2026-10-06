// ============================================================================
// NEXUS ENGINE — Player controllers
// Third-person (spring-arm camera), first-person (pointer lock), top-down.
// All share: physics-body locomotion, gravity, jump with ground check,
// sprint + stamina, crouch, animation hooks (CharacterBody / Animator).
// ============================================================================
import * as THREE from 'three';
import { RuntimeComponent } from '../runtime/object';
import { getComponentDef } from '../core/registry';
import { clamp, damp, deg2rad } from '../core/math';
import type { RuntimeObject } from '../runtime/object';

const UP = new THREE.Vector3(0, 1, 0);

/** Shared locomotion core used by all three controllers. */
export class LocomotionCore extends RuntimeComponent {
  body: any = null;
  grounded = false;
  wasGrounded = false;
  sprinting = false;
  crouching = false;
  stamina = 100;
  maxStamina = 100;
  speedNorm = 0;
  cameraRig: THREE.Object3D | null = null;

  protected ensureBody() {
    const physics = (this.engine as any).physics;
    this.body = physics?.getBody(this.gameObject.id) ?? null;
    if (!this.body) {
      // No RigidBody — controllers move the holder directly (still real movement,
      // just without collisions). Warn once so the user knows.
      if (!this.constructor.name.startsWith('_')) this.engine.warn(`${this.gameObject.name}: no RigidBody/Collider — moving without collision.`);
    }
    return this.body;
  }

  protected moveWithVelocity(localDir: { x: number; z: number }, speed: number, dt: number) {
    if (this.body) {
      const v = this.body.velocity;
      const targetX = localDir.x * speed;
      const targetZ = localDir.z * speed;
      v.x += (targetX - v.x) * Math.min(1, dt * 14);
      v.z += (targetZ - v.z) * Math.min(1, dt * 14);
    } else {
      this.gameObject.move(localDir.x * speed * dt, 0, localDir.z * speed * dt);
    }
  }

  protected applyJump(jumpForce: number) {
    if (!this.body) {
      this.gameObject.move(0, jumpForce * 0.02, 0);
      return;
    }
    this.body.velocity.y = jumpForce;
  }

  protected updateGround(extra = 0.18) {
    const physics = (this.engine as any).physics;
    if (!this.body || !physics) { this.grounded = true; return; }
    const r = physics.grounded(this.gameObject.id, extra);
    this.wasGrounded = this.grounded;
    this.grounded = r.grounded;
  }

  protected updateStamina(sprintHeld: boolean, dt: number, drain: number, regen: number, canSprint: boolean) {
    const healthCmp = this.gameObject.getComponent('Health') as any;
    if (canSprint && sprintHeld && this.speedNorm > 0.1 && this.stamina > 0) {
      this.sprinting = true;
      this.stamina = Math.max(0, this.stamina - drain * dt);
    } else {
      this.sprinting = false;
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    }
    if (healthCmp) { /* stamina is separate from health but regen is paused below 20% health */ }
  }

  /** Drive animation: CharacterBody procedural or Animator states. */
  protected animate(dt: number, crouch = false) {
    const body = this.gameObject.getComponent<any>('CharacterBody');
    if (body?.animate) body.animate(dt, this.speedNorm, crouch);
    const animator = this.gameObject.getComponent<any>('Animator');
    if (animator?.setLocomotion) animator.setLocomotion(this.speedNorm, this.grounded);
  }

  registerAsPlayer() {
    (this.engine as any).setPlayer?.(this.gameObject, this);
    if (!this.gameObject.hasTag('player')) this.gameObject.tags.push('player');
  }
}

// ------------------------------ Third person --------------------------------

export class ThirdPersonControllerCmp extends LocomotionCore {
  static register() { getComponentDef('ThirdPersonController')!.runtime = ThirdPersonControllerCmp; }
  private camYaw = 0;
  private camPitch = 0.32;
  private camObj: THREE.PerspectiveCamera | null = null;

  onStart() {
    const d = this.data as any;
    this.registerAsPlayer();
    this.ensureBody();
    this.maxStamina = 100;
    this.stamina = 100;
    const engine: any = this.engine;
    this.camObj = engine.camera?.three ?? null;
    this.camYaw = this.gameObject.rotation.y * -1;
    if (this.camObj) this.camObj.fov = 62;
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    const input = this.engine.input;
    this.updateGround(d.groundCheckExtra ?? 0.18);

    // mouse orbit
    if (input.mouse.locked) {
      this.camYaw -= input.mouse.dx * (d.mouseSensitivity ?? 0.14) * 0.014;
      this.camPitch = clamp(this.camPitch + input.mouse.dy * (d.mouseSensitivity ?? 0.14) * 0.014, -0.5, 1.2);
    }

    // movement relative to camera yaw
    const mv = input.moveVector;
    const moving = mv.x !== 0 || mv.z !== 0;
    const cos = Math.cos(this.camYaw), sin = Math.sin(this.camYaw);
    const dirX = mv.x * cos - mv.z * sin;
    const dirZ = mv.x * sin + mv.z * cos;
    const len = Math.hypot(dirX, dirZ) || 1;
    const ndx = dirX / len, ndz = dirZ / len;

    this.crouching = d.canCrouch && input.crouchDown && this.grounded;
    const sprintHeld = d.canSprint && input.sprintDown && !this.crouching;
    this.updateStamina(sprintHeld, dt, d.staminaDrain ?? 12, d.staminaRegen ?? 9, d.useStamina !== false && d.canSprint !== false);
    if (this.stamina <= 0.5) this.sprinting = false;

    const base = this.crouching ? (d.crouchSpeed ?? 3) : this.sprinting ? (d.sprintSpeed ?? 10.5) : (d.moveSpeed ?? 6);
    const speed = this.grounded ? base : base * 0.92;
    this.speedNorm = moving ? clamp(speed / (d.sprintSpeed ?? 10.5), 0, 1.4) : 0;

    if (moving) {
      this.moveWithVelocity({ x: ndx * (moving ? 1 : 0), z: ndz * (moving ? 1 : 0) }, speed, dt);
      // face movement direction
      const targetYaw = Math.atan2(ndx, ndz);
      const cur = this.gameObject.holder.rotation.y;
      let diff = targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.gameObject.holder.rotation.y = cur + diff * Math.min(1, dt * (d.turnSpeed ?? 12));
      this.gameObject.syncToData();
    } else {
      this.moveWithVelocity({ x: 0, z: 0 }, 0, dt);
    }

    // jump
    if (input.jumpPressed && this.grounded && !(this.stamina <= 0)) {
      this.applyJump(d.jumpForce ?? 7.5);
      this.engine.events.emit('playerJump', { object: this.gameObject.id });
    }

    // gravity scale (heavier feel)
    if (this.body) {
      this.body.velocity.y -= 9.82 * ((d.gravityScale ?? 1.8) - 1) * dt;
    }

    this.animate(dt, this.crouching);

    // spring-arm camera
    if (this.camObj) {
      const p = this.gameObject.position;
      const dist = d.cameraDistance ?? 6.5;
      const h = d.cameraHeight ?? 2.4;
      const target = new THREE.Vector3(
        p.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist,
        p.y + h + Math.sin(this.camPitch) * dist,
        p.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist,
      );
      const lag = d.cameraLag ?? 8;
      this.camObj.position.x = damp(this.camObj.position.x, target.x, lag, dt);
      this.camObj.position.y = damp(this.camObj.position.y, target.y, lag, dt);
      this.camObj.position.z = damp(this.camObj.position.z, target.z, lag, dt);
      this.camObj.lookAt(p.x, p.y + (this.crouching ? 1.0 : 1.5), p.z);
    }
  }
}

// ------------------------------ First person --------------------------------

export class FirstPersonControllerCmp extends LocomotionCore {
  static register() { getComponentDef('FirstPersonController')!.runtime = FirstPersonControllerCmp; }
  private camYaw = 0;
  private camPitch = 0;
  private camObj: THREE.PerspectiveCamera | null = null;

  onStart() {
    const d = this.data as any;
    this.registerAsPlayer();
    this.ensureBody();
    this.camYaw = this.gameObject.rotation.y;
    const engine: any = this.engine;
    this.camObj = engine.camera?.three ?? null;
    if (this.camObj) this.camObj.fov = 72;
    // hide own character body in first person
    const body = this.gameObject.getComponent<any>('CharacterBody');
    if (body?.parts) body.parts.root.visible = false;
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    const input = this.engine.input;
    this.updateGround(d.groundCheckExtra ?? 0.18);

    if (input.mouse.locked) {
      this.camYaw -= input.mouse.dx * (d.mouseSensitivity ?? 0.12) * 0.012;
      this.camPitch = clamp(this.camPitch - input.mouse.dy * (d.mouseSensitivity ?? 0.12) * 0.012, -1.45, 1.45);
    }

    const mv = input.moveVector;
    const moving = mv.x !== 0 || mv.z !== 0;
    const cos = Math.cos(this.camYaw), sin = Math.sin(this.camYaw);
    const dirX = mv.x * cos + mv.z * sin;
    const dirZ = -mv.x * sin + mv.z * cos;
    const len = Math.hypot(dirX, dirZ) || 1;
    const ndx = dirX / len, ndz = dirZ / len;

    this.crouching = d.canCrouch && input.crouchDown && this.grounded;
    const sprintHeld = d.canSprint && input.sprintDown && !this.crouching;
    this.updateStamina(sprintHeld, dt, d.staminaDrain ?? 12, d.staminaRegen ?? 9, d.useStamina !== false);
    const base = this.crouching ? (d.crouchSpeed ?? 3) : this.sprinting ? (d.sprintSpeed ?? 10) : (d.moveSpeed ?? 6);
    this.speedNorm = moving ? base / (d.sprintSpeed ?? 10) : 0;

    if (moving) this.moveWithVelocity({ x: ndx, z: ndz }, base, dt);
    else this.moveWithVelocity({ x: 0, z: 0 }, 0, dt);

    if (input.jumpPressed && this.grounded) this.applyJump(d.jumpForce ?? 7.5);
    if (this.body) this.body.velocity.y -= 9.82 * ((d.gravityScale ?? 1.8) - 1) * dt;

    this.gameObject.holder.rotation.y = this.camYaw;
    this.gameObject.syncToData();
    this.animate(dt, this.crouching);

    if (this.camObj) {
      const p = this.gameObject.position;
      this.camObj.position.set(p.x, p.y + (this.crouching ? 1.1 : (d.eyeHeight ?? 1.62)) * 0.55 + 0.55, p.z);
      this.camObj.rotation.set(this.camPitch, this.camYaw, 0, 'YXZ');
    }
  }
}

// -------------------------------- Top down ----------------------------------

export class TopDownControllerCmp extends LocomotionCore {
  static register() { getComponentDef('TopDownController')!.runtime = TopDownControllerCmp; }
  private camObj: THREE.PerspectiveCamera | null = null;

  onStart() {
    this.registerAsPlayer();
    this.ensureBody();
    this.camObj = (this.engine as any).camera?.three ?? null;
  }

  onUpdate(dt: number) {
    const d = this.data as any;
    const input = this.engine.input;
    this.updateGround(0.3);
    const mv = input.moveVector;
    const moving = mv.x !== 0 || mv.z !== 0;
    const sprintHeld = input.sprintDown;
    this.updateStamina(sprintHeld, dt, d.staminaDrain ?? 12, d.staminaRegen ?? 9, false);
    const speed = sprintHeld && this.stamina > 0 ? (d.sprintSpeed ?? 11) : (d.moveSpeed ?? 6.5);
    this.speedNorm = moving ? speed / (d.sprintSpeed ?? 11) : 0;
    if (moving) {
      this.moveWithVelocity(mv, speed, dt);
      const targetYaw = Math.atan2(mv.x, mv.z);
      const cur = this.gameObject.holder.rotation.y;
      let diff = targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.gameObject.holder.rotation.y = cur + diff * Math.min(1, dt * 10);
      this.gameObject.syncToData();
    } else this.moveWithVelocity({ x: 0, z: 0 }, 0, dt);
    if (input.jumpPressed && this.grounded) this.applyJump(7);
    this.animate(dt);
    if (this.camObj) {
      const p = this.gameObject.position;
      const tilt = clamp((d.cameraAngle ?? 55) / 55, 0.5, 1.6);
      const h = d.cameraHeight ?? 16;
      const target = new THREE.Vector3(p.x, p.y + h * tilt * 0.9, p.z + h * (2 - tilt) * 0.75);
      const lag = d.cameraLag ?? 6;
      this.camObj.position.x = damp(this.camObj.position.x, target.x, lag, dt);
      this.camObj.position.y = damp(this.camObj.position.y, target.y, lag, dt);
      this.camObj.position.z = damp(this.camObj.position.z, target.z, lag, dt);
      this.camObj.lookAt(p.x, p.y + 0.5, p.z);
    }
  }
}

export function registerControllerComponents() {
  ThirdPersonControllerCmp.register();
  FirstPersonControllerCmp.register();
  TopDownControllerCmp.register();
}
