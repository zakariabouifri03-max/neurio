// ============================================================================
// NEXUS ENGINE — Asset resolution & caching
// Editor mode: assets load from the project server (Content/...).
// Standalone builds: assets are embedded as base64 payloads inside the game
// data — the resolver decodes them locally so the exported game runs fully
// offline from a single HTML file.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetData } from '../core/types';

export interface EmbeddedPayloads { [assetId: string]: { mime: string; base64: string; name: string }; }

export class AssetResolver {
  private assets = new Map<string, AssetData>();
  private embedded: EmbeddedPayloads;
  private baseUrl: string;
  private modelCache = new Map<string, Promise<THREE.Object3D | null>>();
  private textureCache = new Map<string, THREE.Texture>();
  private gltf = new GLTFLoader();
  private obj = new OBJLoader();
  private fbx = new FBXLoader();

  constructor(assets: AssetData[], opts: { embedded?: EmbeddedPayloads; baseUrl?: string } = {}) {
    this.embedded = opts.embedded ?? {};
    this.baseUrl = opts.baseUrl ?? '';
    for (const a of assets) this.assets.set(a.id, a);
  }

  getAsset(id: string | null | undefined): AssetData | null {
    if (!id) return null;
    return this.assets.get(id) ?? null;
  }

  assetUrl(id: string): string | null {
    const a = this.assets.get(id);
    if (!a) return null;
    if (this.embedded[id]) return `data:${this.embedded[id].mime};base64,${this.embedded[id].base64}`;
    if (a.path) return `${this.baseUrl}${a.path}`;
    return null;
  }

  async loadArrayBuffer(id: string): Promise<ArrayBuffer | null> {
    const emb = this.embedded[id];
    if (emb) {
      const bin = atob(emb.base64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }
    const url = this.assetUrl(id);
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  }

  /** Load a model asset and return a THREE object (cached source, cloned result). */
  loadModel(id: string): Promise<THREE.Object3D | null> {
    if (this.modelCache.has(id)) {
      return this.modelCache.get(id)!.then(src => (src ? SkeletonUtils.clone(src) : null));
    }
    const p = this.loadModelSource(id);
    this.modelCache.set(id, p);
    return p.then(src => (src ? SkeletonUtils.clone(src) : null));
  }

  private async loadModelSource(id: string): Promise<THREE.Object3D | null> {
    const asset = this.assets.get(id);
    if (!asset) return null;
    const url = this.assetUrl(id);
    if (!url) return null;
    try {
      const ext = (asset.path || asset.name).split('.').pop()?.toLowerCase();
      if (ext === 'glb' || ext === 'gltf') {
        const buf = await this.loadArrayBuffer(id);
        if (!buf) return null;
        const gltf = await new Promise<any>((resolve, reject) => {
          this.gltf.parse(buf, '', resolve, reject);
        });
        const root = gltf.scene as THREE.Object3D;
        root.userData.animations = gltf.animations ?? [];
        root.traverse((o: any) => { o.castShadow = true; o.receiveShadow = true; });
        return root;
      }
      if (ext === 'fbx') {
        const buf = await this.loadArrayBuffer(id);
        if (!buf) return null;
        const obj = this.fbx.parse(buf, '');
        obj.userData.animations = obj.animations ?? [];
        obj.traverse((o: any) => { o.castShadow = true; });
        return obj;
      }
      if (ext === 'obj') {
        const text = await (await fetch(url)).text();
        const obj = this.obj.parse(text);
        obj.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.material = new THREE.MeshStandardMaterial({ color: 0xa8a29a }); } });
        return obj;
      }
    } catch (e) {
      console.warn(`[NEXUS] Failed to load model ${asset.name}:`, e);
      return null;
    }
    return null;
  }

  loadTexture(id: string): THREE.Texture | null {
    if (this.textureCache.has(id)) return this.textureCache.get(id)!;
    const url = this.assetUrl(id);
    if (!url) return null;
    try {
      const tex = new THREE.TextureLoader().load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.flipY = true; // default for image textures
      this.textureCache.set(id, tex);
      return tex;
    } catch { return null; }
  }

  /** Model source object (for reading animations without cloning). */
  modelSource(id: string): Promise<THREE.Object3D | null> {
    if (this.modelCache.has(id)) return this.modelCache.get(id)!;
    const p = this.loadModelSource(id);
    this.modelCache.set(id, p);
    return p;
  }

  clear() {
    this.modelCache.clear();
    this.textureCache.forEach(t => t.dispose());
    this.textureCache.clear();
  }
}

// ------------------------- material construction ---------------------------

export function buildMaterial(data: any, resolver: AssetResolver, anisotropy = 4): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial();
  applyMaterial(mat, data, resolver, anisotropy);
  return mat;
}

export function applyMaterial(mat: THREE.MeshStandardMaterial, data: any, resolver: AssetResolver, anisotropy = 4) {
  mat.color.set(data?.color ?? '#a8a29a');
  mat.metalness = data?.metallic ?? 0.05;
  mat.roughness = data?.roughness ?? 0.8;
  mat.emissive.set(data?.emissive ?? '#000000');
  mat.emissiveIntensity = data?.emissiveIntensity ?? 1;
  mat.opacity = data?.opacity ?? 1;
  mat.transparent = (data?.opacity ?? 1) < 1;
  mat.side = data?.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const map = resolver.getAsset(data?.map ?? null);
  if (map?.type === 'texture') {
    const t = resolver.loadTexture(map.id);
    if (t) { t.anisotropy = anisotropy; mat.map = t; }
  } else mat.map = null;
  const nrm = resolver.getAsset(data?.normalMap ?? null);
  if (nrm?.type === 'texture') {
    const t = resolver.loadTexture(nrm.id);
    if (t) { t.anisotropy = anisotropy; mat.normalMap = t; }
  } else mat.normalMap = null;
  mat.needsUpdate = true;
}
