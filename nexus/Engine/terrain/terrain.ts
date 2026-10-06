// ============================================================================
// NEXUS ENGINE — Terrain system
// Heightmap terrain with sculpt brushes (raise/lower/smooth/flatten/paint),
// 3-layer texture splatting via vertex colors, foliage scatter data,
// an island generator, and height sampling used by NPCs & placement tools.
// ============================================================================
import * as THREE from 'three';
import { clamp, fbm2D } from '../core/math';

export function encodeFloats(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  return btoa(bin);
}
export function decodeFloats(b64: string, expected: number): Float32Array {
  if (!b64) return new Float32Array(expected);
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  } catch { return new Float32Array(expected); }
}
export function encodeBytes(arr: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}
export function decodeBytes(b64: string, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  if (!b64) return out;
  try {
    const bin = atob(b64);
    for (let i = 0; i < Math.min(bin.length, expected); i++) out[i] = bin.charCodeAt(i);
  } catch { }
  return out;
}

export const DEFAULT_LAYERS = [
  { r: 255, g: 0, b: 0 },   // layer 1 weight
  { r: 0, g: 255, b: 0 },   // layer 2 weight
  { r: 0, b: 255, g: 0 },   // layer 3 weight
];

export interface TerrainMeshResult {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshStandardMaterial;
  heights: Float32Array;
  colors: Uint8Array;
  size: number;
  segments: number;
}

/**
 * Build the three.js mesh for a Terrain component. Splat layers are blended
 * through vertex colors (r,g,b = layer weights) with a small shader injection
 * so shadows/PBR keep working.
 */
export function buildTerrainMesh(data: any, layerTextures: (THREE.Texture | null)[], anisotropy = 4): TerrainMeshResult {
  const size = data.size ?? 200;
  const segments = data.segments ?? 96;
  const n = segments + 1;
  let heights = data.heights ? decodeFloats(data.heights, n * n) : new Float32Array(n * n);
  if (heights.length !== n * n) heights = resizeHeights(heights, n * n);
  const colors = data.colors ? decodeBytes(data.colors, n * n * 3) : new Uint8Array(n * n * 3);

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colorAttr = new THREE.BufferAttribute(new Float32Array(n * n * 3), 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const vi = j * n + i;
      const vj = j * (segments + 1) + i;
      pos.setY(vj, heights[vi]);
      colorAttr.setXYZ(vj, colors[vi * 3] / 255, colors[vi * 3 + 1] / 255, colors[vi * 3 + 2] / 255);
    }
  }
  geo.setAttribute('color', colorAttr);
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(data.baseColor ?? '#6b7d52'),
    roughness: 0.94, metalness: 0.02,
    vertexColors: true,
  });

  const tiling = data.layerTiling ?? 12;
  const hasAny = layerTextures.some(Boolean);
  if (hasAny) {
    const uniforms: any = { nxsT0: { value: null }, nxsT1: { value: null }, nxsT2: { value: null }, nxsTile: { value: tiling } };
    if (layerTextures[0]) { layerTextures[0].anisotropy = anisotropy; layerTextures[0].wrapS = layerTextures[0].wrapT = THREE.RepeatWrapping; uniforms.nxsT0.value = layerTextures[0]; }
    if (layerTextures[1]) { layerTextures[1].anisotropy = anisotropy; layerTextures[1].wrapS = layerTextures[1].wrapT = THREE.RepeatWrapping; uniforms.nxsT1.value = layerTextures[1]; }
    if (layerTextures[2]) { layerTextures[2].anisotropy = anisotropy; layerTextures[2].wrapS = layerTextures[2].wrapT = THREE.RepeatWrapping; uniforms.nxsT2.value = layerTextures[2]; }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D nxsT0; uniform sampler2D nxsT1; uniform sampler2D nxsT2; uniform float nxsTile;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 w = clamp(vColor, 0.0, 1.0);
            float baseW = clamp(1.0 - (w.r + w.g + w.b), 0.0, 1.0);
            vec2 tuv = vMapUv * nxsTile;
            vec4 c0 = texture2D(nxsT0, tuv);
            vec4 c1 = texture2D(nxsT1, tuv);
            vec4 c2 = texture2D(nxsT2, tuv);
            vec4 base = vec4(1.0);
            vec4 blended = base * baseW + c0 * w.r + c1 * w.g + c2 * w.b;
            diffuseColor.rgb *= blended.rgb;
          }`,
        );
    };
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'TerrainMesh';
  return { mesh, geometry: geo, material, heights, colors, size, segments };
}

function resizeHeights(src: Float32Array, target: number): Float32Array {
  const out = new Float32Array(target);
  out.set(src.subarray(0, Math.min(src.length, target)));
  return out;
}

/** Update geometry from height/color arrays after brush strokes. */
export function refreshTerrainGeometry(geo: THREE.PlaneGeometry, heights: Float32Array, colors: Uint8Array) {
  const count = geo.attributes.position.count;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colorAttr = geo.attributes.color as THREE.BufferAttribute;
  const n = Math.sqrt(count);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const vi = j * n + i;
      pos.setY(vi, heights[vi]);
      colorAttr.setXYZ(vi, colors[vi * 3] / 255, colors[vi * 3 + 1] / 255, colors[vi * 3 + 2] / 255);
    }
  }
  pos.needsUpdate = true;
  colorAttr.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

export type BrushOp = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint';

export interface BrushParams {
  op: BrushOp;
  worldX: number; worldZ: number;   // brush center (world)
  radius: number;                    // world units
  strength: number;                  // 0..1
  flattenHeight?: number;
  paintLayer?: number;               // 0..2
  size: number; segments: number;
}

/** Apply a brush stroke to height/color arrays. Returns whether anything changed. */
export function applyBrush(heights: Float32Array, colors: Uint8Array, p: BrushParams): boolean {
  const n = p.segments + 1;
  const half = p.size / 2;
  const step = p.size / p.segments;
  let changed = false;
  const ci = Math.round((p.worldX + half) / step);
  const cj = Math.round((p.worldZ + half) / step);
  const rCells = Math.ceil(p.radius / step);
  for (let j = cj - rCells; j <= cj + rCells; j++) {
    for (let i = ci - rCells; i <= ci + rCells; i++) {
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
      const wx = i * step - half, wz = j * step - half;
      const d = Math.hypot(wx - p.worldX, wz - p.worldZ);
      if (d > p.radius) continue;
      const falloff = Math.pow(1 - d / p.radius, 1.6);
      const idx = j * n + i;
      if (p.op === 'raise') { heights[idx] += p.strength * falloff * 0.6; changed = true; }
      else if (p.op === 'lower') { heights[idx] -= p.strength * falloff * 0.6; changed = true; }
      else if (p.op === 'smooth') {
        const avg = (heights[idx - 1] + heights[idx + 1] + heights[idx - n] + heights[idx + n]) / 4;
        heights[idx] += (avg - heights[idx]) * falloff * p.strength;
        changed = true;
      } else if (p.op === 'flatten') {
        heights[idx] += ((p.flattenHeight ?? 0) - heights[idx]) * falloff * p.strength * 0.9;
        changed = true;
      } else if (p.op === 'paint' && p.paintLayer !== undefined) {
        const w = falloff * p.strength;
        // reduce other layers, boost target layer (r,g = layers 0,1; b = layer 2)
        const ch = [colors[idx * 3], colors[idx * 3 + 1], colors[idx * 3 + 2]];
        ch[p.paintLayer] = clamp(ch[p.paintLayer] + 255 * w, 0, 255);
        const others = ch.reduce((s, v, k) => k !== p.paintLayer ? s + v : s, 0);
        const budget = Math.max(0, 510 - ch[p.paintLayer]);
        if (others > 0) {
          const scale = Math.min(1, budget / others);
          for (let k = 0; k < 3; k++) if (k !== p.paintLayer) ch[k] *= scale;
        }
        colors[idx * 3] = ch[0]; colors[idx * 3 + 1] = ch[1]; colors[idx * 3 + 2] = ch[2];
        changed = true;
      }
    }
  }
  return changed;
}

/** Sample terrain height at world x/z (bilinear). */
export function sampleHeight(heights: Float32Array, size: number, segments: number, x: number, z: number): number | null {
  const n = segments + 1;
  const half = size / 2;
  const fx = (x + half) / (size / segments);
  const fz = (z + half) / (size / segments);
  if (fx < 0 || fz < 0 || fx > segments - 1 || fz > segments - 1) return null;
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const h00 = heights[j * n + i], h10 = heights[j * n + i + 1];
  const h01 = heights[(j + 1) * n + i], h11 = heights[(j + 1) * n + i + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

// --------------------------- island generator -------------------------------

export interface IslandOptions {
  size: number;
  segments: number;
  maxHeight?: number;
  beachHeight?: number;
  seed?: number;
  slope?: number; // 0.5..1.5 — island falloff steepness
}

export interface IslandResult {
  heights: Float32Array;
  colors: Uint8Array;   // splat: beach / grass / rock by height & slope
}

/** Procedural island: fbm heights with radial falloff, auto splat-painted. */
export function generateIsland(opts: IslandOptions): IslandResult {
  const { size, segments } = opts;
  const n = segments + 1;
  const heights = new Float32Array(n * n);
  const colors = new Uint8Array(n * n * 3);
  const maxH = opts.maxHeight ?? 18;
  const beach = opts.beachHeight ?? 1.6;
  const seed = opts.seed ?? 4711;
  const slope = opts.slope ?? 0.85;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / segments, v = j / segments;
      const nx = u * 2 - 1, nz = v * 2 - 1;
      const dist = Math.min(1, Math.hypot(nx, nz));
      const falloff = Math.pow(Math.cos(Math.min(1, dist / slope) * Math.PI / 2), 1.3);
      let h = (fbm2D(u * 5.2, v * 5.2, 5, 2.1, 0.52, seed) * 0.5 + 0.5);
      h = Math.pow(h, 1.35);
      heights[j * n + i] = h * falloff * maxH;
      // small beach flattening
      if (heights[j * n + i] < beach) heights[j * n + i] *= 0.65;
    }
  }
  paintIslandSplat(heights, colors, segments, beach, maxH);
  return { heights, colors };
}

export function paintIslandSplat(heights: Float32Array, colors: Uint8Array, segments: number, beachH: number, maxH: number) {
  const n = segments + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const h = heights[idx];
      // slope estimate
      const hl = heights[j * n + Math.max(0, i - 1)], hr = heights[j * n + Math.min(n - 1, i + 1)];
      const hu = heights[Math.max(0, j - 1) * n + i], hd = heights[Math.min(n - 1, j + 1) * n + i];
      const slope = (Math.abs(hr - hl) + Math.abs(hd - hu)) / 2;
      let r = 0, g = 0, b = 0;
      if (h <= beachH + 0.35) r = 255;                        // beach / sand
      else if (h > maxH * 0.55 || slope > 1.35) b = 255;      // rock
      else g = 255;                                            // grass
      colors[idx * 3] = r; colors[idx * 3 + 1] = g; colors[idx * 3 + 2] = b;
    }
  }
}
