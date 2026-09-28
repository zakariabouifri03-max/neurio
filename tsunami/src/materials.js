// materials.js — shared procedural material library
import * as THREE from 'three';
import { surfaceTex, texFromCanvas, ctx2d, mulberry32, clamp, TAU } from './util.js';

/** palm/leaf alpha texture */
function leafTexture(size = 128) {
  const { c, x } = ctx2d(size, size);
  x.clearRect(0, 0, size, size);
  const rng = mulberry32(9);
  // central rib
  const ribW = size * 0.045;
  x.fillStyle = '#2c4a1e';
  x.beginPath();
  x.moveTo(size * 0.02, size * 0.5 - ribW);
  x.lineTo(size * 0.98, size * 0.5 - ribW * 0.4);
  x.lineTo(size * 0.98, size * 0.5 + ribW * 0.4);
  x.lineTo(size * 0.02, size * 0.5 + ribW);
  x.closePath(); x.fill();
  // leaflets
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const px = size * (0.04 + t * 0.92);
    const len = size * (0.30 + 0.16 * Math.sin(t * Math.PI));
    for (const s of [-1, 1]) {
      x.strokeStyle = `rgba(${40 + rng() * 30},${80 + rng() * 50},${28 + rng() * 20},1)`;
      x.lineWidth = size * 0.028;
      x.beginPath();
      x.moveTo(px, size * 0.5);
      x.quadraticCurveTo(px + size * 0.05, size * 0.5 + s * len * 0.6, px + size * 0.02, size * 0.5 + s * len);
      x.stroke();
    }
  }
  return texFromCanvas(c, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

export function createMaterials(quality = 'high', onProgress) {
  const low = quality === 'low';
  const size = low ? 128 : quality === 'medium' ? 192 : 256;
  const need = low
    ? ['sand', 'grass', 'rock', 'plaster', 'wood', 'tile', 'metal']
    : ['sand', 'grass', 'drygrass', 'rock', 'gravel', 'dirt', 'plaster', 'tile', 'wood', 'thatch', 'metal', 'bark'];
  const tex = {};
  need.forEach((k, i) => {
    tex[k] = surfaceTex(k, 11 + i * 7, size);
    if (onProgress) onProgress((i + 1) / need.length * 0.6);
  });
  const leaf = leafTexture(low ? 64 : 128);

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const mats = {
    terrain: std({ vertexColors: true, roughness: 0.96, metalness: 0.0, dithering: true }),
    sandStone: std({ map: tex.sand.map, normalMap: tex.sand.normalMap, roughnessMap: tex.sand.roughnessMap, roughness: 0.95, vertexColors: true }),
    rock: std({ map: tex.rock.map, normalMap: tex.rock.normalMap, roughnessMap: tex.rock.roughnessMap, roughness: 0.95, vertexColors: true }),
    gravel: std({ map: (tex.gravel || tex.rock).map, normalMap: (tex.gravel || tex.rock).normalMap, roughness: 0.95, vertexColors: true }),
    dirt: std({ map: (tex.dirt || tex.sand).map, normalMap: (tex.dirt || tex.sand).normalMap, roughness: 0.95, vertexColors: true }),
    plaster: std({ map: tex.plaster.map, normalMap: tex.plaster.normalMap, roughnessMap: tex.plaster.roughnessMap, roughness: 0.92, vertexColors: true }),
    tile: std({ map: tex.tile.map, normalMap: tex.tile.normalMap, roughness: 0.7, vertexColors: true }),
    wood: std({ map: tex.wood.map, normalMap: tex.wood.normalMap, roughnessMap: tex.wood.roughnessMap, roughness: 0.78, vertexColors: true }),
    metal: std({ map: tex.metal.map, normalMap: tex.metal.normalMap, roughness: 0.45, metalness: 0.65, vertexColors: true }),
    concrete: std({ map: (tex.plaster || tex.sand).map, roughness: 0.9, color: 0xbdbdb6, vertexColors: true }),
    glass: std({ color: 0x1b2b33, roughness: 0.09, metalness: 0.35, vertexColors: true, envMapIntensity: 1.4 }),
    fabric: std({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }),
    thatch: std({ map: (tex.thatch || tex.grass).map, normalMap: (tex.thatch || tex.grass).normalMap, roughness: 0.95, vertexColors: true }),
    leaf: std({
      map: leaf, alphaMap: leaf, transparent: false, alphaTest: 0.42,
      side: THREE.DoubleSide, roughness: 0.8, vertexColors: true, color: 0xffffff,
    }),
    bark: std({ map: (tex.bark || tex.wood).map, normalMap: (tex.bark || tex.wood).normalMap, roughness: 0.92, vertexColors: true }),
    asphalt: std({ map: (tex.gravel || tex.rock).map, normalMap: (tex.gravel || tex.rock).normalMap, color: 0x4a4a4e, roughness: 0.82, vertexColors: true }),
    foliage: std({ roughness: 0.88, vertexColors: true, flatShading: false }),
    rockPlain: std({ roughness: 0.95, vertexColors: true, flatShading: true }),
    emissive: std({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 1.6, vertexColors: true }),
    cloth: std({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }),
    net: std({ color: 0xd8d2c0, roughness: 0.95, transparent: true, opacity: 0.85, vertexColors: true, side: THREE.DoubleSide }),
  };
  return { mats, tex, leaf };
}
