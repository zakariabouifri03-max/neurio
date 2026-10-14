// ── Giant flora library ─────────────────────────────────────────────────────
// Every plant is generated in REAL METRES. A 48 m titan arbor next to your
// 1.7 m explorer is 48 m tall on screen, exactly like standing under a
// redwood. Each builder returns geometry split into three material buckets
// (bark / leaf / glow) so one InstancedMesh draw call per bucket paints the
// whole forest.

import * as THREE from 'three';
import { mergeGeometries } from '../../vendor/utils/BufferGeometryUtils.js';
import { rand, randi, clamp } from './rng.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// mergeGeometries() refuses to mix indexed with non-indexed geometry, and the
// polyhedron primitives (icosahedron / octahedron) are non-indexed while
// cylinders, cones and spheres are indexed. Normalise before merging.
function mergeAll(parts) {
  const list = [];
  for (const g of parts) {
    if (!g) continue;
    list.push(g.index ? g.toNonIndexed() : g);
  }
  if (!list.length) return null;
  return mergeGeometries(list, false);
}

// ── small geometry helpers ──────────────────────────────────────────────────
function jitterVertices(geo, rng, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (rng() - 0.5) * amount,
      pos.getY(i) + (rng() - 0.5) * amount,
      pos.getZ(i) + (rng() - 0.5) * amount);
  }
  pos.needsUpdate = true;
  return geo;
}

function organicBlob(radius, rng, detail = 1, squash = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  jitterVertices(g, rng, radius * 0.28);
  g.scale(1, squash, 1);
  g.computeVertexNormals();
  return g;
}

// cluster of blobs — the "canopy" of most giants
function blobCluster(rng, { count, radius, spread, y, squash = 0.72, detail = 1 }) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(rng, -0.4, 0.4);
    const rr = spread * Math.pow(rng(), 0.6);
    const b = organicBlob(radius * rand(rng, 0.62, 1.15), rng, detail, squash);
    b.translate(Math.cos(a) * rr, y + rand(rng, -spread * 0.22, spread * 0.3), Math.sin(a) * rr);
    parts.push(b);
  }
  const c = organicBlob(radius * 1.25, rng, detail, squash);
  c.translate(0, y, 0);
  parts.push(c);
  return mergeAll(parts);
}

// tapered, slightly leaning trunk with bark wobble
function trunkGeo(rng, { height, rBottom, rTop, radial = 9, rings = 7, lean = 0.04 }) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, rings, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position;
  const leanX = rand(rng, -lean, lean), leanZ = rand(rng, -lean, lean);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = clamp(y / height, 0, 1);
    const wob = 1 + Math.sin(y * 0.9 + pos.getX(i)) * 0.045 + (rng() - 0.5) * 0.05;
    pos.setX(i, pos.getX(i) * wob + leanX * height * t * t);
    pos.setZ(i, pos.getZ(i) * wob + leanZ * height * t * t);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// root flares splayed at the base of a giant
function rootFlares(rng, rBase, count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.5;
    const len = rBase * rand(rng, 1.6, 2.6);
    const g = new THREE.ConeGeometry(rBase * 0.55, len, 5, 1, true);
    g.rotateZ(Math.PI / 2 - 0.55);
    g.rotateY(a);
    g.translate(Math.cos(a) * rBase * 0.75, len * 0.16, Math.sin(a) * rBase * 0.75);
    parts.push(g);
  }
  return mergeAll(parts);
}

function branches(rng, { y0, y1, count, rBase, reach, up }) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const len = reach * rand(rng, 0.6, 1.15);
    const g = new THREE.CylinderGeometry(rBase * 0.28, rBase, len, 6, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(-Math.PI / 2 + up * rand(rng, 0.7, 1.25));
    g.rotateY(a);
    const y = rand(rng, y0, y1);
    g.translate(Math.cos(a) * len * 0.28, y, Math.sin(a) * len * 0.28);
    parts.push(g);
  }
  return mergeAll(parts);
}

// a curved, tapered frond / leaf blade (single-sided, use DoubleSide material)
function bladeGeo(len, width, segs, droop, twist, curl) {
  const verts = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = len * t;
    const y = -droop * len * t * t - curl * len * Math.pow(t, 3);
    const w = width * (1 - t) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
    const tw = twist * t;
    const cz = Math.cos(tw), sz = Math.sin(tw);
    verts.push(x, y, -w * cz, x, y + w * 0.12 * sz, w * cz);
    uvs.push(t, 0, t, 1);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── the species ─────────────────────────────────────────────────────────────
// H is the full height in metres AFTER the planet's floraScale is applied.

export const SPECIES = {
  // ── Titan Arbor: redwood-scale giant, 30–70 m ──
  titanArbor(H, rng) {
    const rB = H * 0.055, rT = H * 0.022;
    const bark = mergeAll([
      trunkGeo(rng, { height: H, rBottom: rB, rTop: rT, radial: 11, rings: 9 }),
      rootFlares(rng, rB, 5),
      branches(rng, { y0: H * 0.55, y1: H * 0.88, count: 6, rBase: rB * 0.6, reach: H * 0.3, up: 0.75 }),
    ]);
    const leaf = blobCluster(rng, {
      count: 8, radius: H * 0.16, spread: H * 0.2, y: H * 0.93, squash: 0.62, detail: 1,
    });
    return { bark, leaf, glow: null, height: H, radius: rB, label: 'Titan Arbor' };
  },

  // ── Spiral Conifer: stacked tiers, 25–60 m ──
  spiralConifer(H, rng) {
    const rB = H * 0.035;
    const bark = mergeAll([
      trunkGeo(rng, { height: H, rBottom: rB, rTop: rB * 0.5, radial: 9, rings: 6 }),
      rootFlares(rng, rB, 4),
    ]);
    const tiers = [];
    const n = randi(rng, 8, 12);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const y = H * (0.3 + 0.68 * t);
      const r = H * 0.3 * (1 - t * 0.72) * rand(rng, 0.9, 1.1);
      const g = new THREE.ConeGeometry(r, H * 0.16, 9, 1, true);
      g.translate(rand(rng, -r * 0.08, r * 0.08), y, rand(rng, -r * 0.08, r * 0.08));
      tiers.push(g);
    }
    const leaf = mergeAll(tiers);
    return { bark, leaf, glow: null, height: H, radius: rB, label: 'Spiral Conifer' };
  },

  // ── Giant Fungus: 15–45 m mushroom, glowing gills ──
  giantFungus(H, rng) {
    const rStem = H * 0.075;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = rStem * (1.35 - 0.55 * Math.sin(t * Math.PI * 0.9));
      pts.push(new THREE.Vector2(Math.max(0.08, r), t * H * 0.78));
    }
    const stem = new THREE.LatheGeometry(pts, 12);
    const capR = H * 0.42;
    const cap = new THREE.SphereGeometry(capR, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.52);
    cap.scale(1, 0.52, 1);
    cap.translate(0, H * 0.78, 0);
    const rim = new THREE.TorusGeometry(capR * 0.97, capR * 0.055, 6, 20);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, H * 0.79, 0);
    const gills = new THREE.ConeGeometry(capR * 0.86, H * 0.17, 16, 1, true);
    gills.rotateX(Math.PI);
    gills.translate(0, H * 0.79, 0);
    const spots = [];
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2, rr = capR * rand(rng, 0.25, 0.8);
      const s = new THREE.SphereGeometry(capR * rand(rng, 0.06, 0.13), 6, 4);
      s.scale(1, 0.35, 1);
      s.translate(Math.cos(a) * rr, H * 0.79 + Math.sqrt(Math.max(0, capR * capR - rr * rr)) * 0.4, Math.sin(a) * rr);
      spots.push(s);
    }
    return {
      bark: stem,
      leaf: mergeAll([cap, rim]),
      glow: mergeAll([gills, ...spots]),
      height: H, radius: rStem * 1.35, label: 'Giant Fungus',
    };
  },

  // ── Tower Fern: tree-fern with a crown of 20 m fronds ──
  towerFern(H, rng) {
    const rB = H * 0.035;
    const bark = mergeAll([
      trunkGeo(rng, { height: H * 0.82, rBottom: rB, rTop: rB * 0.7, radial: 8, rings: 8, lean: 0.06 }),
      rootFlares(rng, rB, 3),
    ]);
    const fronds = [];
    const n = randi(rng, 10, 15);
    const fl = H * rand(rng, 0.62, 0.8);
    for (let i = 0; i < n; i++) {
      const g = bladeGeo(fl, fl * 0.14, 9, rand(rng, 0.18, 0.4), rand(rng, -0.5, 0.5), rand(rng, 0, 0.08));
      g.rotateY((i / n) * Math.PI * 2 + rng() * 0.3);
      g.rotateZ(rand(rng, -0.15, 0.28));
      g.translate(0, H * 0.82, 0);
      fronds.push(g);
    }
    const bud = organicBlob(rB * 2.2, rng, 1, 1.6);
    bud.translate(0, H * 0.86, 0);
    fronds.push(bud);
    return { bark, leaf: mergeAll(fronds), glow: null, height: H, radius: rB, label: 'Tower Fern' };
  },

  // ── Bulb Bloom: tall stalk crowned by a 6 m flower ──
  bulbBloom(H, rng) {
    const rB = H * 0.03;
    const bark = trunkGeo(rng, { height: H * 0.86, rBottom: rB, rTop: rB * 0.65, radial: 7, rings: 6, lean: 0.05 });
    const petals = [];
    const n = randi(rng, 6, 9);
    const pl = H * 0.26;
    for (let i = 0; i < n; i++) {
      const g = bladeGeo(pl, pl * 0.4, 6, -0.12, 0, 0.05);
      g.rotateX(-0.55);
      g.rotateY((i / n) * Math.PI * 2);
      g.translate(0, H * 0.86, 0);
      petals.push(g);
    }
    const leafGeo = mergeAll(petals);
    const core = organicBlob(H * 0.075, rng, 1, 1);
    core.translate(0, H * 0.9, 0);
    const dust = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.SphereGeometry(H * 0.012, 5, 4);
      s.translate(rand(rng, -H * 0.05, H * 0.05), H * rand(rng, 0.95, 1.06), rand(rng, -H * 0.05, H * 0.05));
      dust.push(s);
    }
    return { bark, leaf: leafGeo, glow: mergeAll([core, ...dust]), height: H, radius: rB, label: 'Bulb Bloom' };
  },

  // ── Crystal Spire: faceted glowing shards, 12–40 m ──
  crystalSpire(H, rng) {
    const shards = [];
    const n = randi(rng, 3, 6);
    let tallest = H * 0.5;
    for (let i = 0; i < n; i++) {
      const h = H * rand(rng, 0.45, 1.0);
      tallest = Math.max(tallest, h);
      const g = new THREE.OctahedronGeometry(H * rand(rng, 0.06, 0.13), 0);
      g.scale(1, h / (H * 0.1), 1);
      g.rotateZ(rand(rng, -0.22, 0.22));
      g.rotateX(rand(rng, -0.22, 0.22));
      const a = rng() * Math.PI * 2, rr = H * rand(rng, 0.02, 0.16);
      g.translate(Math.cos(a) * rr, h / 2, Math.sin(a) * rr);
      shards.push(g);
    }
    const base = organicBlob(H * 0.11, rng, 0, 0.5);
    base.translate(0, H * 0.04, 0);
    return {
      bark: base, glow: mergeAll(shards), leaf: null,
      height: tallest, radius: H * 0.16, label: 'Crystal Spire',
    };
  },

  // ── Vine Tower: trunk wrapped in hanging lianas ──
  vineTower(H, rng) {
    const rB = H * 0.045;
    const bark = mergeAll([
      trunkGeo(rng, { height: H, rBottom: rB, rTop: rB * 0.6, radial: 9, rings: 7 }),
      rootFlares(rng, rB, 4),
    ]);
    const vines = [];
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const len = H * rand(rng, 0.3, 0.75);
      const y0 = H * rand(rng, 0.55, 0.98);
      const g = new THREE.CylinderGeometry(rB * 0.09, rB * 0.14, len, 4, 1, true);
      g.translate(0, -len / 2, 0);
      g.rotateZ(rand(rng, -0.1, 0.1));
      g.rotateY(a);
      g.translate(Math.cos(a) * rB * rand(rng, 1.1, 2.4), y0, Math.sin(a) * rB * rand(rng, 1.1, 2.4));
      vines.push(g);
    }
    const leaf = mergeAll([
      blobCluster(rng, { count: 6, radius: H * 0.12, spread: H * 0.15, y: H * 0.98, squash: 0.7, detail: 1 }),
      ...vines,
    ]);
    return { bark, leaf, glow: null, height: H, radius: rB, label: 'Vine Tower' };
  },

  // ── Pod Tree: trunk hung with metre-wide seed pods ──
  podTree(H, rng) {
    const rB = H * 0.05;
    const bark = mergeAll([
      trunkGeo(rng, { height: H * 0.9, rBottom: rB, rTop: rB * 0.7, radial: 9, rings: 6 }),
      rootFlares(rng, rB, 5),
      branches(rng, { y0: H * 0.45, y1: H * 0.85, count: 5, rBase: rB * 0.55, reach: H * 0.26, up: 0.5 }),
    ]);
    const leaf = blobCluster(rng, { count: 5, radius: H * 0.13, spread: H * 0.17, y: H * 0.9, squash: 0.66, detail: 1 });
    const pods = [];
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2, rr = H * rand(rng, 0.1, 0.24);
      const s = organicBlob(H * rand(rng, 0.045, 0.08), rng, 1, 1.25);
      s.translate(Math.cos(a) * rr, H * rand(rng, 0.4, 0.8), Math.sin(a) * rr);
      pods.push(s);
    }
    return { bark, leaf, glow: mergeAll(pods), height: H, radius: rB, label: 'Pod Tree' };
  },

  // ── Umbrella Cap: 40 m stalk holding a 30 m flat canopy ──
  umbrellaCap(H, rng) {
    const rB = H * 0.03;
    const bark = mergeAll([
      trunkGeo(rng, { height: H * 0.92, rBottom: rB, rTop: rB * 0.8, radial: 8, rings: 8, lean: 0.03 }),
      rootFlares(rng, rB, 4),
    ]);
    const R = H * 0.36;
    const top = new THREE.CylinderGeometry(R, R * 0.94, H * 0.035, 20, 1, false);
    top.translate(0, H * 0.94, 0);
    const dome = new THREE.SphereGeometry(R, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.28);
    dome.scale(1, 0.3, 1);
    dome.translate(0, H * 0.95, 0);
    const frills = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const g = bladeGeo(R * 0.32, R * 0.12, 5, 0.35, 0, 0.1);
      g.rotateY(a);
      g.translate(Math.cos(a) * R * 0.98, H * 0.93, Math.sin(a) * R * 0.98);
      frills.push(g);
    }
    const leaf = mergeAll([top, dome, ...frills]);
    const gills = new THREE.ConeGeometry(R * 0.9, H * 0.09, 18, 1, true);
    gills.rotateX(Math.PI);
    gills.translate(0, H * 0.925, 0);
    return { bark, leaf, glow: gills, height: H, radius: rB, label: 'Umbrella Cap' };
  },

  // ── Giant Grass: 8–16 m blades you can walk between ──
  grassGiant(H, rng) {
    const blades = [];
    const n = randi(rng, 6, 11);
    for (let i = 0; i < n; i++) {
      const h = H * rand(rng, 0.55, 1.0);
      const g = bladeGeo(h, h * 0.09, 7, rand(rng, 0.05, 0.28), rand(rng, -0.8, 0.8), rand(rng, 0, 0.15));
      g.rotateY(rng() * Math.PI * 2);
      g.translate(rand(rng, -1.2, 1.2), 0, rand(rng, -1.2, 1.2));
      blades.push(g);
    }
    return { bark: null, leaf: mergeAll(blades), glow: null, height: H, radius: 1.4, label: 'Giant Grass' };
  },
};

// ── ground cover (walk-through, no collision) ───────────────────────────────
export const GROUND_FLORA = {
  fernClump(H, rng) {
    const fronds = [];
    const n = randi(rng, 5, 8);
    for (let i = 0; i < n; i++) {
      const g = bladeGeo(H * rand(rng, 0.6, 1), H * 0.16, 6, rand(rng, 0.2, 0.45), rand(rng, -0.6, 0.6), 0);
      g.rotateY((i / n) * Math.PI * 2 + rng());
      g.rotateZ(rand(rng, -0.2, 0.35));
      fronds.push(g);
    }
    return { leaf: mergeAll(fronds), height: H };
  },
  grassTuft(H, rng) {
    const blades = [];
    const n = randi(rng, 5, 9);
    for (let i = 0; i < n; i++) {
      const g = bladeGeo(H * rand(rng, 0.5, 1), H * 0.07, 4, rand(rng, 0.1, 0.35), rand(rng, -1, 1), 0);
      g.rotateY(rng() * Math.PI * 2);
      g.translate(rand(rng, -0.4, 0.4), 0, rand(rng, -0.4, 0.4));
      blades.push(g);
    }
    return { leaf: mergeAll(blades), height: H };
  },
  glowBulb(H, rng) {
    const bulbs = [];
    const n = randi(rng, 2, 5);
    for (let i = 0; i < n; i++) {
      const s = organicBlob(H * rand(rng, 0.25, 0.45), rng, 0, 1.2);
      s.translate(rand(rng, -0.5, 0.5), H * rand(rng, 0.3, 0.7), rand(rng, -0.5, 0.5));
      bulbs.push(s);
    }
    const stem = new THREE.CylinderGeometry(0.05, 0.08, H * 0.7, 5, 1, true);
    stem.translate(0, H * 0.35, 0);
    return { leaf: stem, glow: mergeAll(bulbs), height: H };
  },
};

export const SPECIES_IDS = Object.keys(SPECIES);
export const SPECIES_LABEL = {
  titanArbor: 'Titan Arbor', spiralConifer: 'Spiral Conifer', giantFungus: 'Giant Fungus',
  towerFern: 'Tower Fern', bulbBloom: 'Bulb Bloom', crystalSpire: 'Crystal Spire',
  vineTower: 'Vine Tower', podTree: 'Pod Tree', umbrellaCap: 'Umbrella Cap', grassGiant: 'Giant Grass',
};
export const speciesLabel = (id) => SPECIES_LABEL[id] || id;

// how tall each species grows on a given planet, in metres
export const SPECIES_RANGE = {
  titanArbor: [30, 72], spiralConifer: [24, 58], giantFungus: [14, 44],
  towerFern: [18, 40], bulbBloom: [10, 26], crystalSpire: [12, 38],
  vineTower: [22, 50], podTree: [18, 42], umbrellaCap: [26, 55], grassGiant: [7, 16],
};
export const GROUND_RANGE = { fernClump: [2.5, 6], grassTuft: [0.8, 2.2], glowBulb: [0.7, 2.0] };

export { V3, organicBlob, bladeGeo };
