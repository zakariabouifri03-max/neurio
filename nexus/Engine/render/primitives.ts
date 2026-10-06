// NEXUS ENGINE — primitive geometry factory + procedural character builder
import * as THREE from 'three';

const cache = new Map<string, THREE.BufferGeometry>();

export function primitiveGeometry(name: string): THREE.BufferGeometry | null {
  if (cache.has(name)) return cache.get(name)!.clone();
  let g: THREE.BufferGeometry | null = null;
  switch (name) {
    case 'Cube': g = new THREE.BoxGeometry(1, 1, 1); break;
    case 'Sphere': g = new THREE.SphereGeometry(0.5, 28, 20); break;
    case 'Cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); break;
    case 'Cone': g = new THREE.ConeGeometry(0.5, 1, 24); break;
    case 'Capsule': g = new THREE.CapsuleGeometry(0.35, 0.7, 6, 16); break;
    case 'Plane': g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); break;
    case 'Quad': g = new THREE.PlaneGeometry(1, 1); break;
    default: return null;
  }
  cache.set(name, g);
  return g.clone();
}

export interface CharacterParts {
  root: THREE.Group;
  hips: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
}

/**
 * Low-poly humanoid assembled from primitives, with limb groups that the
 * locomotion code can swing procedurally. Total height ≈ 1.8m at scale 1.
 */
export function buildCharacter(opts: {
  clothes?: string; skin?: string; pants?: string; scale?: number;
}): CharacterParts {
  const clothes = new THREE.MeshStandardMaterial({ color: opts.clothes ?? '#39506b', roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: opts.skin ?? '#c9a17e', roughness: 0.7 });
  const pants = new THREE.MeshStandardMaterial({ color: opts.pants ?? '#2b2f38', roughness: 0.9 });

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), clothes);
  torso.position.y = 0.31;
  torso.castShadow = true;
  hips.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin);
  head.position.y = 0.78;
  head.castShadow = true;
  hips.add(head);

  const mkLimb = (mat: THREE.Material, w: number, h: number, x: number, y: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), mat);
    m.position.y = -h / 2;
    m.castShadow = true;
    g.add(m);
    return g;
  };
  const leftArm = mkLimb(clothes, 0.14, 0.58, -0.33, 0.56);
  const rightArm = mkLimb(clothes, 0.14, 0.58, 0.33, 0.56);
  const leftLeg = mkLimb(pants, 0.18, 0.9, -0.14, 0.02);
  const rightLeg = mkLimb(pants, 0.18, 0.9, 0.14, 0.02);
  hips.add(leftArm, rightArm, leftLeg, rightLeg);

  const s = opts.scale ?? 1;
  root.scale.setScalar(s);
  return { root, hips, leftArm, rightArm, leftLeg, rightLeg, head, torso };
}

/** Procedural walk-cycle pose driven by normalized speed & phase. */
export function poseCharacter(parts: CharacterParts, speedNorm: number, phase: number, intensity = 1, crouch = false) {
  const swing = Math.sin(phase) * 0.9 * Math.min(1, speedNorm) * intensity;
  const lift = Math.abs(Math.sin(phase)) * 0.12 * Math.min(1, speedNorm);
  parts.leftArm.rotation.x = swing;
  parts.rightArm.rotation.x = -swing;
  parts.leftLeg.rotation.x = -swing * 0.9;
  parts.rightLeg.rotation.x = swing * 0.9;
  parts.hips.position.y = (crouch ? 0.72 : 0.95) + lift;
  parts.hips.rotation.z = Math.sin(phase) * 0.04 * Math.min(1, speedNorm);
}
