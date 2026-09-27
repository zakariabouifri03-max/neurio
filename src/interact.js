// ============================================================
// interact.js — raycast interaction system: what you're looking
// at, the prompt it shows, and what E does to it.
// ============================================================
import * as THREE from 'three';

export class Interact {
  constructor(G) {
    this.G = G;
    this.ray = new THREE.Raycaster();
    this.ray.far = 3.0;
    this.current = null;
    this._v = new THREE.Vector3();
  }

  _enabled(def, G) {
    if (def.enabled === undefined) return true;
    if (typeof def.enabled === 'function') return !!def.enabled(G);
    return !!def.enabled;
  }
  _label(def, G) {
    if (!def.label) return null;
    return typeof def.label === 'function' ? def.label(G) : def.label;
  }

  update() {
    const G = this.G, p = G.player;
    if (G.state !== 'play') { G.ui.setPrompt(null); this.current = null; return; }
    if (p.hidden) {
      this.current = null;
      G.ui.setPrompt('Leave the hiding spot');
      el_show('E');
      return;
    }
    const cam = G.camera;
    const camPos = cam.getWorldPosition(this._v);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.ray.set(camPos, dir);

    let best = null, bestD = 3.2;
    for (const def of G.world.interactables) {
      if (!this._enabled(def, G)) continue;
      const label = this._label(def, G);
      if (!label) continue;
      if (def.meshes && def.meshes.length) {
        const hits = this.ray.intersectObjects(def.meshes, false);
        if (hits.length && hits[0].distance < Math.min(bestD, def.maxDist || 2.9)) {
          best = def; bestD = hits[0].distance;
        }
      } else if (def.pos) {
        const d = def.pos.distanceTo(camPos);
        if (d < (def.radius || 1.4) + 0.9) {
          // must be roughly looked at
          const to = def.pos.clone().sub(camPos).normalize();
          if (to.dot(dir) > 0.86 && d < bestD + 0.4) { best = def; bestD = d; }
        }
      }
    }
    this.current = best;
    if (best) G.ui.setPrompt(this._label(best, G));
    else G.ui.setPrompt(null);
  }

  onUse() {
    const G = this.G, p = G.player;
    if (p.hidden) { p.unhide(); return; }
    if (!this.current) return;
    const def = this.current;
    if (!this._enabled(def, G)) return;
    p.startReach();
    def.action(G);
  }
}

function el_show(k) {
  const el = document.getElementById('prompt-key');
  if (el) el.textContent = k;
}
