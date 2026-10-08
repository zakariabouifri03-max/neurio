import * as THREE from 'three';
import { LogInteraction } from './game-core.js';

export class Interactable {
  constructor({ prompt = 'Press E to interact', onInteract = null } = {}) {
    this.prompt = prompt; this.onInteract = onInteract;
  }
  interact(context) { this.onInteract?.(context); }
}

export class InteractionSystem {
  constructor({ camera, scene, domRoot = document.body, maxDistance = 5 } = {}) {
    this.camera = camera; this.scene = scene; this.maxDistance = maxDistance;
    this.raycaster = new THREE.Raycaster(); this.center = new THREE.Vector2(0, 0);
    this.target = null; this.enabled = true;
    this.prompt = document.createElement('div');
    this.prompt.className = 'foundation-interaction-prompt'; this.prompt.hidden = true;
    this.prompt.textContent = 'Press E to interact'; domRoot.appendChild(this.prompt);
    this._keydown = (e) => { if (e.code === 'KeyE' && this.target) this.target.userData.interactable.interact({ object: this.target }); };
    addEventListener('keydown', this._keydown);
  }
  update() {
    if (!this.enabled || !this.camera || !this.scene) return;
    this.raycaster.setFromCamera(this.center, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    this.target = hits.find((hit) => hit.distance <= this.maxDistance && hit.object.userData.interactable)?.object || null;
    this.prompt.hidden = !this.target;
    if (this.target) this.prompt.textContent = this.target.userData.interactable.prompt;
  }
  destroy() { removeEventListener('keydown', this._keydown); this.prompt.remove(); }
}

export function makeTestInteractable(object, options = {}) {
  object.userData.interactable = new Interactable(options);
  LogInteraction('Registered interactable', options.prompt || 'Press E to interact');
  return object;
}
