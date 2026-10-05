// ============================================================
// PlayerController.js — First-Person Controller & Full Body
// ============================================================

import * as THREE from 'three';
import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export class PlayerController {
  constructor(camera, domElement, worldBuilder) {
    this.camera = camera;
    this.domElement = domElement;
    this.worldBuilder = worldBuilder;

    // Movement state
    this.position = new THREE.Vector3(0, 1.65, 2.0); // Start standing in apartment center
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.isGrounded = true;
    this.isSprinting = false;
    this.isCrouching = false;
    this.stamina = 100;

    // Camera rotation
    this.pitch = 0;
    this.yaw = 0;
    this.mouseSensitivity = 0.0022;
    this.isLocked = false;

    // Key inputs
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false,
      crouch: false,
      jump: false
    };

    // Camera sway & footstep accumulator
    this.strideAccumulator = 0;
    this.swayTime = 0;

    // Interaction raycaster
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 2.8;
    this.hoveredObject = null;

    // Full Body Meshes (visible when looking down)
    this.bodyGroup = new THREE.Group();
    this.torsoMesh = null;
    this.leftLegMesh = null;
    this.rightLegMesh = null;
    this.heldItemMesh = null;

    // Sitting transition
    this.deskSitPos = new THREE.Vector3(0, 1.25, -3.2);
    this.isTransitioningSit = false;

    this.initBody();
    this.initEvents();
  }

  initBody() {
    const s = gameState.get();
    const outfit = s.player.outfit;

    // Torso (hoodie)
    const torsoMat = new THREE.MeshStandardMaterial({ color: outfit.shirtColor, roughness: 0.7 });
    this.torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), torsoMat);
    this.torsoMesh.position.set(0, -0.4, -0.05);
    this.bodyGroup.add(this.torsoMesh);

    // Legs
    const pantsMat = new THREE.MeshStandardMaterial({ color: outfit.pantsColor, roughness: 0.8 });
    this.leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.18), pantsMat);
    this.leftLegMesh.position.set(-0.12, -0.95, -0.05);
    this.bodyGroup.add(this.leftLegMesh);

    this.rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.18), pantsMat);
    this.rightLegMesh.position.set(0.12, -0.95, -0.05);
    this.bodyGroup.add(this.rightLegMesh);

    // Shoes
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.26), shoeMat);
    leftShoe.position.set(-0.12, -1.35, 0.02);
    this.bodyGroup.add(leftShoe);

    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.26), shoeMat);
    rightShoe.position.set(0.12, -1.35, 0.02);
    this.bodyGroup.add(rightShoe);

    // Hands / Item holding socket
    this.handSocket = new THREE.Group();
    this.handSocket.position.set(0.2, -0.25, -0.45);
    this.bodyGroup.add(this.handSocket);

    this.worldBuilder.scene.add(this.bodyGroup);
  }

  updateHeldItemVisual() {
    // Clear previous held item
    while (this.handSocket.children.length > 0) {
      this.handSocket.remove(this.handSocket.children[0]);
    }

    const s = gameState.get();
    if (s.player.holding) {
      const item = s.player.holding;
      if (item.type === 'package') {
        // Small preview box in hands
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.25, 0.3),
          new THREE.MeshStandardMaterial({ color: 0xb47b49, roughness: 0.8 })
        );
        this.handSocket.add(box);
      } else if (item.type === 'food') {
        const foodMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12),
          new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 })
        );
        this.handSocket.add(foodMesh);
      }
    }
  }

  initEvents() {
    // Pointer lock on canvas click
    this.domElement.addEventListener('click', () => {
      const s = gameState.get();
      if (!s.player.isSitting && !this.isLocked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === this.domElement);
    });

    // Mouse movement
    window.addEventListener('mousemove', e => {
      const s = gameState.get();
      if (!this.isLocked || s.player.isSitting) return;

      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;

      // Clamp vertical look between -85 and +85 degrees
      this.pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, this.pitch));
    });

    // Keyboard inputs
    window.addEventListener('keydown', e => {
      const s = gameState.get();
      if (s.player.isSitting) return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.sprint = true;
          break;
        case 'ControlLeft':
        case 'KeyC':
          this.keys.crouch = !this.keys.crouch;
          break;
        case 'Space':
          if (this.isGrounded) {
            this.velocity.y = 4.2;
            this.isGrounded = false;
          }
          break;
      }
    });

    window.addEventListener('keyup', e => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.backward = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.sprint = false;
          break;
      }
    });
  }

  sitAtDesk() {
    const s = gameState.get();
    s.player.isSitting = true;
    if (document.exitPointerLock) document.exitPointerLock();

    // Smoothly align camera to facing monitors
    this.camera.position.copy(this.deskSitPos);
    this.yaw = 0;
    this.pitch = -0.05;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    soundEngine.playClick(0.15, 400); // Chair swivel click
    gameState.emit('satAtDesk');
  }

  standUp() {
    const s = gameState.get();
    s.player.isSitting = false;
    this.position.set(0, 1.65, -2.4);
    this.yaw = Math.PI; // Face away from desk back to room
    this.pitch = 0;
    soundEngine.playClick(0.15, 350);
    gameState.emit('stoodUp');
  }

  update(delta) {
    const s = gameState.get();

    if (s.player.isSitting) {
      // Keep camera locked in desk view
      this.camera.position.lerp(this.deskSitPos, 0.1);
      this.bodyGroup.visible = false;
      return;
    }

    this.bodyGroup.visible = true;

    // Calculate movement speeds
    const targetHeight = this.keys.crouch ? 1.15 : 1.65;
    let moveSpeed = this.keys.crouch ? 2.0 : 4.2;

    // Sprint & Stamina
    if (this.keys.sprint && this.stamina > 5 && !this.keys.crouch) {
      moveSpeed = 7.5;
      this.stamina = Math.max(0, this.stamina - delta * 25);
    } else {
      this.stamina = Math.min(100, this.stamina + delta * 15);
    }

    // Energy grogginess modifier
    if (s.player.needs.energy < 20) {
      moveSpeed *= 0.65;
    }

    // Direction vector from WASD
    this.direction.set(0, 0, 0);
    if (this.keys.forward) this.direction.z -= 1;
    if (this.keys.backward) this.direction.z += 1;
    if (this.keys.left) this.direction.x -= 1;
    if (this.keys.right) this.direction.x += 1;
    this.direction.normalize();

    // Transform by Yaw rotation
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const moveX = this.direction.x * cos - this.direction.z * sin;
    const moveZ = this.direction.x * sin + this.direction.z * cos;

    // Accelerate / Friction
    const accel = 18;
    this.velocity.x += (moveX * moveSpeed - this.velocity.x) * accel * delta;
    this.velocity.z += (moveZ * moveSpeed - this.velocity.z) * accel * delta;

    // Gravity
    if (!this.isGrounded) {
      this.velocity.y -= 9.81 * delta;
    }

    // Apply movement
    const prevPos = this.position.clone();
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.position.y += this.velocity.y * delta;

    // Ground check
    if (this.position.y <= targetHeight) {
      this.position.y = targetHeight;
      this.velocity.y = 0;
      this.isGrounded = true;
    }

    // Apartment boundaries & AABB collision
    this.resolveCollisions(prevPos);

    // Subtle head bob
    const isMoving = (this.keys.forward || this.keys.backward || this.keys.left || this.keys.right) && this.isGrounded;
    if (isMoving) {
      const bobFreq = this.keys.sprint ? 14 : 9;
      this.swayTime += delta * bobFreq;
      const bobAmount = this.keys.sprint ? 0.04 : 0.02;
      this.camera.position.y = this.position.y + Math.sin(this.swayTime) * bobAmount;

      // Footstep audio trigger
      this.strideAccumulator += delta * (this.keys.sprint ? 1.6 : 1.0);
      if (this.strideAccumulator >= 0.45) {
        this.strideAccumulator = 0;
        const surface = (this.position.z > 5.2) ? 'concrete' : (this.position.x > 2 && this.position.z > 1.5 ? 'tile' : 'wood');
        soundEngine.playFootstep(surface);
      }
    } else {
      this.camera.position.y = this.position.y;
      this.swayTime = 0;
    }

    this.camera.position.x = this.position.x;
    this.camera.position.z = this.position.z;

    // Apply camera rotation
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // Sync body position with yaw rotation
    this.bodyGroup.position.copy(this.camera.position);
    this.bodyGroup.rotation.y = this.yaw;

    // Leg walking animation
    if (isMoving) {
      this.leftLegMesh.rotation.x = Math.sin(this.swayTime) * 0.45;
      this.rightLegMesh.rotation.x = -Math.sin(this.swayTime) * 0.45;
    } else {
      this.leftLegMesh.rotation.x = 0;
      this.rightLegMesh.rotation.x = 0;
    }

    // Perform interaction raycasting
    this.updateRaycast();
  }

  resolveCollisions(prevPos) {
    // Simple apartment bounds
    // Indoors: X [-5.7, 5.7], Z [-4.7, 4.8]
    // Doorway opening at Z = 5.0 is between X [-0.8, 0.8]
    // Outside street: X [-16, 16], Z [5.0, 16.0]

    const inDoorway = Math.abs(this.position.x) < 0.9 && this.position.z >= 4.5 && this.position.z <= 5.8;
    const isOutside = this.position.z > 5.0;

    if (!isOutside && !inDoorway) {
      if (this.position.x < -5.7) this.position.x = -5.7;
      if (this.position.x > 5.7) this.position.x = 5.7;
      if (this.position.z < -4.7) this.position.z = -4.7;
      if (this.position.z > 4.7) this.position.z = 4.7;
    } else if (isOutside) {
      if (this.position.x < -18.0) this.position.x = -18.0;
      if (this.position.x > 18.0) this.position.x = 18.0;
      if (this.position.z > 16.0) this.position.z = 16.0;
    }

    // Check custom furniture box colliders
    const playerBox = new THREE.Box3(
      new THREE.Vector3(this.position.x - 0.25, this.position.y - 1.5, this.position.z - 0.25),
      new THREE.Vector3(this.position.x + 0.25, this.position.y, this.position.z + 0.25)
    );

    for (const collider of this.worldBuilder.colliders) {
      if (playerBox.intersectsBox(collider)) {
        // Revert to prev position along collision axis
        this.position.x = prevPos.x;
        this.position.z = prevPos.z;
        break;
      }
    }
  }

  updateRaycast() {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.raycaster.intersectObjects(this.worldBuilder.interactives, false);

    if (hits.length > 0 && hits[0].object.userData && hits[0].object.userData.isInteractive) {
      this.hoveredObject = hits[0].object;
      gameState.emit('interactionPrompt', this.hoveredObject.userData.prompt);
    } else {
      this.hoveredObject = null;
      gameState.emit('interactionPrompt', null);
    }
  }

  interact() {
    if (!this.hoveredObject) return;
    const data = this.hoveredObject.userData;
    gameState.emit('interactAction', data);
  }
}
