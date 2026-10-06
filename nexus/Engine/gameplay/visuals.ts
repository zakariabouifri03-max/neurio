// ============================================================================
// NEXUS ENGINE — Visual components
// MeshRenderer, Light, Camera, CharacterBody, Terrain, Water, Foliage.
// These classes build three.js content; the editor instantiates them too
// (edit mode = build only, no behaviour ticking).
// ============================================================================
import * as THREE from 'three';
import { RuntimeComponent } from '../runtime/object';
import { primitiveGeometry, buildCharacter, poseCharacter, CharacterParts } from '../render/primitives';
import { buildMaterial } from '../runtime/assetresolver';
import { getComponentDef } from '../core/registry';
import {
  buildTerrainMesh, refreshTerrainGeometry, sampleHeight, encodeFloats, encodeBytes, applyBrush,
} from '../terrain/terrain';

/** Visual components set this flag — the editor builds them without ticking. */
export abstract class VisualComponent extends RuntimeComponent {
  static visual = true;
  /** Build three.js content into gameObject.slots. Called on instantiation. */
  abstract build(resolver: any): void;
  /** Rebuild after a property change (edit mode live update). */
  rebuild(resolver: any): void {
    this.teardown();
    this.build(resolver);
  }
  teardown(): void {
    const s = this.gameObject.slots;
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (v instanceof THREE.Object3D) {
        v.parent?.remove(v);
        v.traverse?.((o: any) => {
          o.geometry?.dispose?.();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x: any) => x.dispose?.()); else m?.dispose?.();
        });
      }
    }
    this.gameObject.slots = {};
  }
}

function resolverOf(engine: any) {
  return engine?.resolver;
}

// ------------------------------- MeshRenderer -------------------------------

export class MeshRendererCmp extends VisualComponent {
  static register() { getComponentDef('MeshRenderer')!.runtime = MeshRendererCmp; }

  build(resolver: any) {
    const d = this.data as any;
    const matAsset = resolver?.getAsset(d.materialAsset);
    const material = matAsset?.type === 'material'
      ? buildMaterial(matAsset.data, resolver)
      : new THREE.MeshStandardMaterial({ color: 0xa8a29a, roughness: 0.85, metalness: 0.05 });

    if (d.mesh === 'Asset') {
      const asset = resolver?.getAsset(d.modelAsset ?? d.asset ?? d.meshAsset);
      if (asset?.type === 'model') {
        resolver.loadModel(asset.id).then(obj => {
          if (this.destroyed || !obj) return;
          obj.traverse((o: any) => { if (o.isMesh) { o.castShadow = d.castShadows !== false; o.receiveShadow = d.receiveShadows !== false; } });
          this.gameObject.slots.mesh = obj;
          this.gameObject.holder.add(obj);
        });
        return;
      }
      // fallback cube if asset missing
    }
    const geo = primitiveGeometry(d.mesh || 'Cube');
    const mesh = new THREE.Mesh(geo!, material);
    mesh.castShadow = d.castShadows !== false;
    mesh.receiveShadow = d.receiveShadows !== false;
    mesh.name = 'mesh';
    this.gameObject.slots.mesh = mesh;
    this.gameObject.holder.add(mesh);
  }
}

// --------------------------------- Light ------------------------------------

export class LightCmp extends VisualComponent {
  static register() { getComponentDef('Light')!.runtime = LightCmp; }
  build(_resolver: any) {
    const d = this.data as any;
    let light: THREE.Light;
    if (d.lightType === 'directional') {
      const dl = new THREE.DirectionalLight(d.color, d.intensity);
      dl.castShadow = d.castShadows !== false;
      dl.shadow.mapSize.set(1024, 1024);
      dl.shadow.camera.far = 200;
      const dd = Math.max(12, (d.range ?? 18) * 0.8);
      dl.shadow.camera.left = -dd; dl.shadow.camera.right = dd;
      dl.shadow.camera.top = dd; dl.shadow.camera.bottom = -dd;
      dl.shadow.bias = -0.0005;
      dl.shadow.normalBias = 0.03;
      dl.position.set(0, 6, 0);
      dl.target.position.set(0, -1, 0);
      this.gameObject.slots.lightTarget = dl.target;
      light = dl;
    } else if (d.lightType === 'spot') {
      const sl = new THREE.SpotLight(d.color, d.intensity, d.range ?? 18, (d.spotAngle ?? 38) * Math.PI / 180, 0.45, 1.2);
      sl.castShadow = d.castShadows !== false;
      sl.shadow.mapSize.set(1024, 1024);
      sl.shadow.bias = -0.0004;
      sl.position.set(0, 0, 0);
      sl.target.position.set(0, -1, 0);
      this.gameObject.slots.lightTarget = sl.target;
      light = sl;
    } else {
      const pl = new THREE.PointLight(d.color, d.intensity, d.range ?? 18, 1.6);
      pl.castShadow = d.castShadows !== false;
      pl.shadow.mapSize.set(1024, 1024);
      pl.shadow.bias = -0.005;
      light = pl;
    }
    this.gameObject.slots.light = light;
    this.gameObject.holder.add(light);
    const target = this.gameObject.slots.lightTarget;
    if (target) this.gameObject.holder.add(target);
    // small gizmo sphere for editing
    if (this.gameObject.editMode) {
      const giz = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: d.color }));
      giz.name = '__lightGizmo';
      this.gameObject.slots.gizmo = giz;
      this.gameObject.holder.add(giz);
    }
  }
}

// --------------------------------- Camera -----------------------------------

export class CameraCmp extends VisualComponent {
  static register() { getComponentDef('Camera')!.runtime = CameraCmp; }
  build(_resolver: any) {
    const d = this.data as any;
    const cam = new THREE.PerspectiveCamera(d.fov ?? 60, 16 / 9, d.near ?? 0.1, d.far ?? 800);
    cam.name = 'camera';
    this.gameObject.slots.camera = cam;
    this.gameObject.holder.add(cam);
  }
}

// ------------------------------ CharacterBody -------------------------------

export class CharacterBodyCmp extends VisualComponent {
  static register() { getComponentDef('CharacterBody')!.runtime = CharacterBodyCmp; }
  parts: CharacterParts | null = null;
  private phase = 0;

  build(_resolver: any) {
    const d = this.data as any;
    this.parts = buildCharacter({
      clothes: d.bodyColor, skin: d.skinColor, pants: d.pantsColor, scale: d.scale ?? 1,
    });
    this.gameObject.slots.character = this.parts.root;
    this.gameObject.holder.add(this.parts.root);
  }

  /** Driven by controllers/NPCs: speedNorm 0..1.4, dt for animation phase. */
  animate(dt: number, speedNorm: number, crouch = false, intensity?: number) {
    if (!this.parts) return;
    this.phase += dt * Math.max(4, 8 * speedNorm + 2);
    poseCharacter(this.parts, speedNorm, this.phase, intensity ?? (this.data as any).walkSwing ?? 1, crouch);
  }
  attackAnim() {
    if (!this.parts) return;
    const t0 = performance.now();
    const swing = () => {
      const k = (performance.now() - t0) / 320;
      if (k >= 1 || !this.parts) { this.parts && (this.parts.rightArm.rotation.x = 0); return; }
      this.parts.rightArm.rotation.x = -Math.sin(k * Math.PI) * 2.2;
      requestAnimationFrame(swing);
    };
    swing();
  }
  hitAnim() {
    if (!this.parts) return;
    this.parts.hips.rotation.x = 0.25;
    setTimeout(() => { if (this.parts) this.parts.hips.rotation.x = 0; }, 140);
  }
}

// --------------------------------- Terrain ----------------------------------

export class TerrainCmp extends VisualComponent {
  static register() { getComponentDef('Terrain')!.runtime = TerrainCmp; }
  result: ReturnType<typeof buildTerrainMesh> | null = null;

  build(resolver: any) {
    const d = this.data as any;
    const layers = (d.layerTextures ?? [null, null, null]).map((id: string | null) => {
      const asset = resolver?.getAsset(id);
      return asset?.type === 'texture' ? resolver.loadTexture(asset.id) : null;
    });
    this.result = buildTerrainMesh(d, layers);
    this.result.mesh.name = 'terrain';
    this.gameObject.slots.terrain = this.result.mesh;
    this.gameObject.holder.add(this.result.mesh);
  }

  get heights() { return this.result?.heights ?? null; }
  get colors() { return this.result?.colors ?? null; }

  heightAt(x: number, z: number): number | null {
    const d = this.data as any;
    if (!this.heights) return null;
    return sampleHeight(this.heights, d.size, d.segments, x, z);
  }

  /** Apply a brush stroke and refresh geometry + write back to data. */
  stroke(p: any): boolean {
    const d = this.data as any;
    if (!this.result) return false;
    const ok = (require('../terrain/terrain') as any).applyBrush(this.result.heights, this.result.colors, {
      ...p, size: d.size, segments: d.segments,
    });
    if (ok) {
      refreshTerrainGeometry(this.result.geometry, this.result.heights, this.result.colors);
      d.heights = encodeFloats(this.result.heights);
      d.colors = encodeBytes(this.result.colors);
    }
    return ok;
  }
}

// ---------------------------------- Water -----------------------------------

export class WaterCmp extends VisualComponent {
  static register() { getComponentDef('Water')!.runtime = WaterCmp; }
  private t = 0;
  build(_resolver: any) {
    const d = this.data as any;
    const geo = new THREE.PlaneGeometry(d.size ?? 1000, d.size ?? 1000, 40, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: d.color ?? '#2a6f8e', transparent: true, opacity: d.opacity ?? 0.72,
      roughness: 0.15, metalness: 0.55,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    mesh.name = 'water';
    this.gameObject.slots.water = mesh;
    this.gameObject.holder.add(mesh);
  }
  onUpdate(dt: number) {
    // gentle vertex waves
    this.t += dt * ((this.data as any).waveSpeed ?? 1.1);
    const mesh = this.gameObject.slots.water as THREE.Mesh;
    if (!mesh) return;
    const pos = (mesh.geometry as THREE.PlaneGeometry).attributes.position as THREE.BufferAttribute;
    const amp = (this.data as any).waveHeight ?? 0.08;
    if (amp > 0.001) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, Math.sin(x * 0.08 + this.t * 1.7) * Math.cos(z * 0.06 + this.t * 1.1) * amp);
      }
      pos.needsUpdate = true;
    }
  }
}

// --------------------------------- Foliage ----------------------------------

export class FoliageCmp extends VisualComponent {
  static register() { getComponentDef('Foliage')!.runtime = FoliageCmp; }
  build(resolver: any) {
    const d = this.data as any;
    const instances: any[] = d.instances ?? [];
    if (!instances.length || !d.meshAsset) return;
    const asset = resolver?.getAsset(d.meshAsset);
    if (asset?.type !== 'model') return;
    resolver.loadModel(asset.id).then((src: THREE.Object3D | null) => {
      if (!src || this.destroyed) return;
      // Build InstancedMesh from the first mesh found in the source
      let mesh: THREE.Mesh | null = null;
      src.traverse((o: any) => { if (!mesh && o.isMesh) mesh = o; });
      if (!mesh) return;
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, instances.length);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      instances.forEach((ins: any, i: number) => {
        pos.set(ins.x, ins.y, ins.z);
        scl.setScalar(ins.s ?? 1);
        if (ins.ry !== undefined && d.randomRotation) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ins.ry);
        m.compose(pos, q, scl);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.gameObject.slots.foliage = inst;
      this.gameObject.holder.add(inst);
    });
  }
}

export function registerVisualComponents() {
  MeshRendererCmp.register();
  LightCmp.register();
  CameraCmp.register();
  CharacterBodyCmp.register();
  TerrainCmp.register();
  WaterCmp.register();
  FoliageCmp.register();
}
