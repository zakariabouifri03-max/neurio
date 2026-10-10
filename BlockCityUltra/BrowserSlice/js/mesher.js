// BLOCK CITY ULTRA — browser slice: box → merged geometry.
//
// The city is stored as axis-aligned boxes per material. This module merges
// them into one BufferGeometry per material, so the whole 1.4 km slice renders
// in ~26 draw calls instead of ~60 000.
//
// It also runs a face-culling pass: a face hidden inside another box is never
// emitted. That is the same optimisation the UE5 greedy mesher performs, and it
// is what makes a dense downtown block affordable.

import * as THREE from './three.module.js';

/** Face directions: +X, -X, +Z, -Z, +Y, -Y. */
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
];

/**
 * Merges every box list into per-material geometry.
 *
 * @param {Map<number, Array>} boxes  material id → [{x,y,z,w,h,d}]
 * @param {object} table              material id → {c, r, m, e}
 * @returns {{meshes: THREE.Mesh[], emissive: THREE.Mesh[], stats: object}}
 */
export function buildMergedMesh(boxes, table) {
  // ── 1. Spatial hash so occlusion tests are O(1) instead of O(n²) ─────────
  const CELL = 8; // metres
  const grid = new Map();

  const keyOf = (cx, cy, cz) => `${cx},${cy},${cz}`;

  const allBoxes = [];
  for (const [mat, list] of boxes) {
    for (const b of list) {
      if (!b || b.w <= 0 || b.h <= 0 || b.d <= 0) continue;
      const entry = { mat, ...b };
      allBoxes.push(entry);

      const x0 = Math.floor(b.x / CELL), x1 = Math.floor((b.x + b.w) / CELL);
      const y0 = Math.floor(b.y / CELL), y1 = Math.floor((b.y + b.h) / CELL);
      const z0 = Math.floor(b.z / CELL), z1 = Math.floor((b.z + b.d) / CELL);

      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (let cz = z0; cz <= z1; cz++) {
            const k = keyOf(cx, cy, cz);
            let bucket = grid.get(k);
            if (!bucket) { bucket = []; grid.set(k, bucket); }
            bucket.push(entry);
          }
        }
      }
    }
  }

  /** Is the point just outside `box`'s face occupied by another solid box? */
  function isOccluded(px, py, pz, nx, ny, nz, self) {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), cz = Math.floor(pz / CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = grid.get(keyOf(cx + ox, cy + oy, cz + oz));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === self) continue;
            if (px >= other.x - 1e-4 && px <= other.x + other.w + 1e-4 &&
                py >= other.y - 1e-4 && py <= other.y + other.h + 1e-4 &&
                pz >= other.z - 1e-4 && pz <= other.z + other.d + 1e-4) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ── 2. Emit visible faces, grouped by material ───────────────────────────
  const perMaterial = new Map();
  let facesEmitted = 0;
  let facesCulled = 0;

  for (const box of allBoxes) {
    let target = perMaterial.get(box.mat);
    if (!target) {
      target = { positions: [], normals: [], colors: [], indices: [] };
      perMaterial.set(box.mat, target);
    }

    const tint = table[box.mat] ? table[box.mat].c : 0xffffff;
    const r = ((tint >> 16) & 255) / 255;
    const g = ((tint >> 8) & 255) / 255;
    const b = (tint & 255) / 255;

    const { x, y, z, w, h, d } = box;
    const corners = [
      [x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d],
      [x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d],
    ];

    // Six faces, each defined by four corner indices and a probe point.
    const faceDefs = [
      { idx: [1, 5, 6, 2], probe: [x + w + 0.02, y + h / 2, z + d / 2], n: [1, 0, 0] },
      { idx: [3, 7, 4, 0], probe: [x - 0.02, y + h / 2, z + d / 2], n: [-1, 0, 0] },
      { idx: [2, 6, 7, 3], probe: [x + w / 2, y + h / 2, z + d + 0.02], n: [0, 0, 1] },
      { idx: [0, 4, 5, 1], probe: [x + w / 2, y + h / 2, z - 0.02], n: [0, 0, -1] },
      { idx: [4, 7, 6, 5], probe: [x + w / 2, y + h + 0.02, z + d / 2], n: [0, 1, 0] },
      { idx: [0, 1, 2, 3], probe: [x + w / 2, y - 0.02, z + d / 2], n: [0, -1, 0] },
    ];

    for (const face of faceDefs) {
      // A face pointing down at ground level is never visible.
      if (face.n[1] < 0 && y <= 0.001) { facesCulled++; continue; }

      if (isOccluded(face.probe[0], face.probe[1], face.probe[2], face.n[0], face.n[1], face.n[2], box)) {
        facesCulled++;
        continue;
      }

      // Slight per-face shading so cubic forms read under flat-ish light: the
      // top is brightest, sides mid, bottom darkest. Baked into vertex colour.
      const shade = face.n[1] > 0 ? 1.0 : (face.n[1] < 0 ? 0.42 : (Math.abs(face.n[0]) > 0 ? 0.78 : 0.88));

      const base = target.positions.length / 3;
      for (const ci of face.idx) {
        const c = corners[ci];
        target.positions.push(c[0], c[1], c[2]);
        target.normals.push(face.n[0], face.n[1], face.n[2]);
        target.colors.push(r * shade, g * shade, b * shade);
      }
      target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      facesEmitted++;
    }
  }

  // ── 3. Build materials and meshes ────────────────────────────────────────
  const meshes = [];
  const emissiveMeshes = [];

  for (const [mat, data] of perMaterial) {
    if (data.positions.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
    geometry.setIndex(data.indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const spec = table[mat] || { c: 0xffffff, r: 0.8, m: 0, e: 0 };
    const isEmissive = spec.e > 0;

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: spec.r,
      metalness: spec.m,
      emissive: isEmissive ? new THREE.Color(spec.c) : new THREE.Color(0x000000),
      emissiveIntensity: isEmissive ? spec.e : 0,
      flatShading: false,
      transparent: mat === 20 /* water */,
      opacity: mat === 20 ? 0.86 : 1.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `city_mat_${mat}`;
    mesh.castShadow = !isEmissive && mat !== 20;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // one mesh per material spans the whole city

    if (isEmissive) {
      mesh.castShadow = false;
      emissiveMeshes.push(mesh);
    } else {
      meshes.push(mesh);
    }
  }

  return {
    meshes,
    emissive: emissiveMeshes,
    stats: {
      boxes: allBoxes.length,
      facesEmitted,
      facesCulled,
      triangles: facesEmitted * 2,
      materials: perMaterial.size,
      drawCalls: meshes.length + emissiveMeshes.length,
    },
  };
}

/**
 * Builds a single small mesh from an array of boxes sharing one colour — used
 * for vehicles and pedestrians, where each one is its own object.
 */
export function buildBoxMesh(boxes, color, roughness = 0.6, metalness = 0.2) {
  const positions = [], normals = [], indices = [];

  for (const b of boxes) {
    const { x, y, z, w, h, d } = b;
    const corners = [
      [x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d],
      [x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d],
    ];
    const faceDefs = [
      { idx: [1, 5, 6, 2], n: [1, 0, 0] }, { idx: [3, 7, 4, 0], n: [-1, 0, 0] },
      { idx: [2, 6, 7, 3], n: [0, 0, 1] }, { idx: [0, 4, 5, 1], n: [0, 0, -1] },
      { idx: [4, 7, 6, 5], n: [0, 1, 0] }, { idx: [0, 1, 2, 3], n: [0, -1, 0] },
    ];
    for (const face of faceDefs) {
      const base = positions.length / 3;
      for (const ci of face.idx) {
        positions.push(corners[ci][0], corners[ci][1], corners[ci][2]);
        normals.push(face.n[0], face.n[1], face.n[2]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness, metalness, flatShading: true,
  }));
}
