// neurio Craft — chunk mesher: hidden-face culling + per-vertex ambient
// occlusion + directional face shading → one BufferGeometry per material bucket.
import * as THREE from 'three';
import { CHUNK, HEIGHT } from './world.js';
import { B, BLOCKS, tileFor, isOpaque } from './blocks.js';
import { tileUV } from './textures.js';

// corners: [x,y,z, u,v] — quad layout 0=(u0,v1) 1=(u0,v0) 2=(u1,v1) 3=(u1,v0)
const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0],  shade: 0.78, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.55, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0],  shade: 1.0,  corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.66, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1],  shade: 0.66, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
const AO_LIGHT = [0.42, 0.62, 0.8, 1.0]; // ao level 0 (fully occluded) … 3

// Flat lookup table — much faster than object/optional-chain access in the hot loop.
const OPAQUE = new Uint8Array(64);
for (const key of Object.keys(BLOCKS)) {
  const id = +key;
  if (isOpaque(id)) OPAQUE[id] = 1;
}

function bucket() { return { pos: [], norm: [], uv: [], col: [], index: [] }; }

function toGeometry(b) {
  if (!b.index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.index);
  return g;
}

// Builds geometries for chunk (cx,cz). Sampling goes through the 3×3 chunk
// neighbourhood so border faces and AO are correct. Positions are in world space.
export function buildChunkGeometries(world, cx, cz) {
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    nb.push(world.getChunkData(cx + dx, cz + dz, false));
  }
  const center = nb[4];
  if (!center) return null;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  // local sampler: lx,lz may be -1..16 (one block into the neighbours)
  function sample(lx, y, lz) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return 0;
    const ncx = lx < 0 ? 0 : lx > 15 ? 2 : 1;
    const ncz = lz < 0 ? 0 : lz > 15 ? 2 : 1;
    const d = nb[ncz * 3 + ncx];
    if (!d) return 0;
    return d[y * 256 + ((lz + 16) & 15) * 16 + ((lx + 16) & 15)];
  }

  const opaque = bucket(), trans = bucket(), water = bucket(), plant = bucket();

  function pushQuad(b, positions, normal, uvRect, shades, aoLevels) {
    const ndx = b.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      b.pos.push(...positions[i]);
      b.norm.push(...normal);
      b.uv.push(uvRect[i * 2], uvRect[i * 2 + 1]);
      const s = shades[i];
      b.col.push(s, s, s);
    }
    // flip the quad diagonal when AO would otherwise interpolate weirdly
    if (aoLevels && aoLevels[0] + aoLevels[3] > aoLevels[1] + aoLevels[2]) {
      b.index.push(ndx, ndx + 1, ndx + 3, ndx, ndx + 3, ndx + 2);
    } else {
      b.index.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }
  }

  for (let y = 0; y < HEIGHT; y++) for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
    const id = center[y * 256 + lz * 16 + lx];
    if (!id) continue;
    const def = BLOCKS[id];
    const wx = x0 + lx, wz = z0 + lz;

    // ── plants: two crossed quads ──────────────────────────────────────────
    if (def.cross) {
      const [u0, v0, u1, v1] = tileUV(def.all);
      const uvs = [u0, v1, u0, v0, u1, v1, u1, v0];
      const a = 0.12, bq = 0.88;
      pushQuad(plant, [[wx + a, y + 1, wz + a], [wx + a, y, wz + a], [wx + bq, y + 1, wz + bq], [wx + bq, y, wz + bq]], [0, 1, 0], uvs, [1, 1, 1, 1], null);
      pushQuad(plant, [[wx + bq, y + 1, wz + a], [wx + bq, y, wz + a], [wx + a, y + 1, wz + bq], [wx + a, y, wz + bq]], [0, 1, 0], uvs, [1, 1, 1, 1], null);
      continue;
    }

    const isW = !!def.water;
    const target = isW ? water : def.transparent ? trans : opaque;
    const waterTop = isW && sample(lx, y + 1, lz) !== B.WATER ? 0.86 : 1;

    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      const nId = sample(lx + dx, y + dy, lz + dz);

      if (isW) {
        if (nId === B.WATER || OPAQUE[nId]) continue;             // water only shows against air/plants/glass
        if (dy < 0) continue;                                     // no water bottoms
      } else {
        if (OPAQUE[nId]) continue;                                // hidden by a full cube
        if (def.transparent && nId === id) continue;              // glass-against-glass
      }

      // per-corner data
      const positions = [], aoLevels = [], shades = [];
      const [tu0, tv0, tu1, tv1] = isW ? [0, 0, 1, 1] : tileUV(tileFor(id, dy));
      const uvRect = [];
      // tangent axes for AO: the two axes that aren't the face normal
      const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
      const uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;

      for (const c of face.corners) {
        let px = wx + c[0], py = y + c[1], pz = wz + c[2];
        if (isW && c[1] === 1) py = y + waterTop;
        positions.push([px, py, pz]);
        uvRect.push(c[3] ? tu1 : tu0, c[4] ? tv1 : tv0);

        if (isW || def.transparent) { aoLevels.push(3); shades.push(face.shade); continue; }
        // voxel AO: 2 side neighbours + corner neighbour, one step out of the face
        const bx = lx + dx, by = y + dy, bz = lz + dz;
        const du = (uAxis === 0 ? c[0] : uAxis === 1 ? c[1] : c[2]) === 1 ? 1 : -1;
        const dv = (vAxis === 0 ? c[0] : vAxis === 1 ? c[1] : c[2]) === 1 ? 1 : -1;
        const s1 = OPAQUE[sample(bx + (uAxis === 0 ? du : 0), by + (uAxis === 1 ? du : 0), bz + (uAxis === 2 ? du : 0))] ? 1 : 0;
        const s2 = OPAQUE[sample(bx + (vAxis === 0 ? dv : 0), by + (vAxis === 1 ? dv : 0), bz + (vAxis === 2 ? dv : 0))] ? 1 : 0;
        const cc = OPAQUE[sample(
          bx + (uAxis === 0 ? du : vAxis === 0 ? dv : 0),
          by + (uAxis === 1 ? du : vAxis === 1 ? dv : 0),
          bz + (uAxis === 2 ? du : vAxis === 2 ? dv : 0))] ? 1 : 0;
        const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
        aoLevels.push(ao);
        shades.push(face.shade * AO_LIGHT[ao]);
      }
      pushQuad(target, positions, face.dir, uvRect, shades, aoLevels);
    }
  }

  return { opaque: toGeometry(opaque), trans: toGeometry(trans), water: toGeometry(water), plant: toGeometry(plant) };
}
