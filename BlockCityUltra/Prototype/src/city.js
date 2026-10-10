// BLOCK CITY ULTRA — procedural district layout.
// Mirror of UBCUCityGenerator::GenerateDistrict() (C++) and citygen.py.
// Same seeds, same district table, same block subdivision.

import { rng } from './util.js';

export const VOXEL = 1.6;          // metres per voxel (32 cm * 5 scale for the web)
export const FLOOR_H = 4.0;        // metres per floor

// district table (centre/radius in km, block/road in metres)
export const DISTRICTS = [
  { name: 'Downtown',    center: [0, 0],       radius: 1.6, block: 76,  road: 15,
    height: 1.6,  density: 1.00, green: 0.04, landmarks: 6,
    archetypes: ['Tower', 'Skyscraper', 'OfficeBlock', 'Garage'] },
  { name: 'Residential', center: [-2.6, 1.4],  radius: 2.0, block: 92,  road: 13,
    height: 0.35, density: 0.80, green: 0.45, landmarks: 1,
    archetypes: ['House', 'House', 'Tenement', 'Shop'] },
  { name: 'Luxury',      center: [2.2, 1.8],   radius: 1.3, block: 84,  road: 17,
    height: 0.80, density: 0.70, green: 0.35, landmarks: 4,
    archetypes: ['Mansion', 'Mall', 'Shop', 'OfficeBlock'] },
  { name: 'Industrial',  center: [-2.9, -2.4], radius: 1.9, block: 140, road: 22,
    height: 0.30, density: 0.55, green: 0.05, landmarks: 2,
    archetypes: ['Warehouse', 'Factory', 'Warehouse', 'GasStation'] },
  { name: 'Airport',     center: [2.8, -2.6],  radius: 1.7, block: 180, road: 26,
    height: 0.20, density: 0.30, green: 0.15, landmarks: 3,
    archetypes: ['Hangar', 'Hangar', 'Warehouse', 'Garage'] },
  { name: 'Countryside', center: [0.4, -3.4],  radius: 2.6, block: 240, road: 16,
    height: 0.15, density: 0.10, green: 0.85, landmarks: 0,
    archetypes: ['House', 'Warehouse', 'GasStation'] },
  { name: 'Commercial',  center: [-1.4, 2.9],  radius: 1.5, block: 88,  road: 16,
    height: 0.55, density: 0.85, green: 0.18, landmarks: 3,
    archetypes: ['Shop', 'Mall', 'OfficeBlock', 'PoliceStation', 'Hospital', 'Garage'] },
];

export const FLOOR_RANGES = {
  Tower: [10, 60], Skyscraper: [10, 60], OfficeBlock: [6, 26],
  House: [1, 3], Tenement: [3, 8],
  Mansion: [2, 4], Mall: [2, 5], Shop: [1, 4],
  Warehouse: [1, 3], Factory: [2, 5],
  Hangar: [1, 2], Garage: [1, 4],
  PoliceStation: [2, 5], Hospital: [4, 10],
  GasStation: [1, 1], BillboardTower: [3, 7],
};

const ENTERABLE = new Set(['Shop', 'Mall', 'Garage', 'House', 'PoliceStation', 'Hospital']);

/**
 * Generate one district. Returns { buildings, roads, bounds }.
 * Units: metres. Y is up.
 */
export function generateDistrict(name, seed = 20251010, opts = {}) {
  const cfg = DISTRICTS.find(d => d.name === name) || DISTRICTS[0];
  const R = rng((seed ^ hashStr(cfg.name)) >>> 0);
  const cx = cfg.center[0] * 1000, cy = cfg.center[1] * 1000;
  const radius = cfg.radius * 1000;
  const { block, road } = cfg;
  const maxBuildings = opts.maxBuildings ?? 220;

  const buildings = [];
  const blocks = Math.ceil((radius * 2) / block);

  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      if (buildings.length >= maxBuildings) break;
      const ox = cx - radius + bx * block;
      const oy = cy - radius + by * block;
      const dist = Math.hypot(ox + block * 0.5 - cx, oy + block * 0.5 - cy);
      if (dist > radius * R.r(0.92, 1.08)) continue;

      const big = R.chance(0.18);
      const subX = big ? 1 : R.i(2, 3);
      const subY = big ? 1 : R.i(2, 3);
      const pw = (block - road) / subX;
      const ph = (block - road) / subY;
      const margin = road * 0.12;

      for (let py = 0; py < subY; py++) {
        for (let px = 0; px < subX; px++) {
          if (buildings.length >= maxBuildings) break;
          if (R.f() > cfg.density) continue;

          const arch = R.pick(cfg.archetypes);
          const [lo, hi] = FLOOR_RANGES[arch] || [2, 12];
          let floors = Math.round(R.r(lo, hi) * cfg.height);
          const falloff = 1 - Math.min(dist / radius, 1) * 0.55;
          floors = Math.max(1, Math.min(Math.round(floors * falloff), 90));

          buildings.push({
            x: ox + road * 0.5 + px * pw + pw * 0.5,
            z: oy + road * 0.5 + py * ph + ph * 0.5,
            w: pw - margin * 2,
            d: ph - margin * 2,
            floors,
            archetype: arch,
            district: cfg.name,
            palette: R.i(0, 5),
            seed: R.next(),
            enterable: ENTERABLE.has(arch),
            rot: 0,
          });
        }
      }
    }
  }

  // landmarks
  for (let i = 0; i < cfg.landmarks; i++) {
    const ang = R.r(0, Math.PI * 2), rad = R.r(0, radius * 0.5);
    buildings.push({
      x: cx + Math.cos(ang) * rad,
      z: cy + Math.sin(ang) * rad,
      w: R.r(30, 60), d: R.r(30, 60),
      floors: Math.round(R.r(40, 78) * cfg.height),
      archetype: cfg.name === 'Downtown' ? 'Tower' : 'Skyscraper',
      district: cfg.name,
      palette: R.i(0, 5),
      seed: R.next(),
      enterable: true,
      rot: 0,
      landmark: true,
    });
  }

  const roads = buildRoadGrid(cx, cy, radius, block, road, R);
  return { buildings, roads, bounds: { cx, cy, radius }, cfg };
}

// --- road grid (mirrors UBCURoadNetwork::BuildFromGrid) -----------------------
function buildRoadGrid(cx, cy, radius, block, road, R) {
  const blocks = Math.ceil((radius * 2) / block);
  const segs = [];                 // {x1,z1,x2,z2, highway}
  const nodes = [];

  const grid = [];
  for (let r = 0; r <= blocks; r++) {
    grid[r] = [];
    for (let c = 0; c <= blocks; c++) {
      grid[r][c] = {
        x: cx - radius + c * block + R.r(-block * 0.04, block * 0.04),
        z: cy - radius + r * block + R.r(-block * 0.04, block * 0.04),
        links: [], speed: 50, lanes: 2,
      };
      nodes.push(grid[r][c]);
    }
  }

  const link = (a, b) => {
    if (!a.links.includes(b)) a.links.push(b);
    if (!b.links.includes(a)) b.links.push(a);
  };

  for (let r = 0; r <= blocks; r++) {
    for (let c = 0; c <= blocks; c++) {
      const me = grid[r][c];
      if (c < blocks && !R.chance(0.05)) {
        link(me, grid[r][c + 1]);
        segs.push({ a: me, b: grid[r][c + 1], highway: r % 6 === 0 });
      }
      if (r < blocks && !R.chance(0.06)) {
        link(me, grid[r + 1][c]);
        segs.push({ a: me, b: grid[r + 1][c], highway: c % 6 === 0 });
      }
      if ((r % 6 === 0 && c < blocks) || (c % 6 === 0 && r < blocks)) {
        me.speed = 70; me.lanes = 4;
      }
      me.intersection = me.links.length > 2;
    }
  }

  return { segs, nodes, block, road };
}

// --- A* over the road graph (mirrors UBCURoadNetwork::FindPath) ---------------
export function findPath(roads, from, to) {
  const nodes = roads.nodes;
  if (!nodes.length) return null;

  const nearest = (p) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i].x - p.x) ** 2 + (nodes[i].z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const start = nearest(from), end = nearest(to);
  if (start === end) return [nodes[start]];

  const n = nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = [];
  const h = (i) => Math.hypot(nodes[end].x - nodes[i].x, nodes[end].z - nodes[i].z) / nodes[i].speed;

  g[start] = 0;
  open.push({ i: start, f: h(start) });

  let guard = 0;
  while (open.length && guard++ < 40000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    if (cur.i === end) break;

    for (const nb of nodes[cur.i].links) {
      const j = nodes.indexOf(nb);
      if (j < 0 || closed[j]) continue;
      const dist = Math.hypot(nodes[cur.i].x - nb.x, nodes[cur.i].z - nb.z);
      const t = g[cur.i] + dist / nodes[cur.i].speed;
      if (t < g[j]) {
        g[j] = t; came[j] = cur.i;
        open.push({ i: j, f: t + h(j) });
      }
    }
  }

  if (!closed[end]) return null;
  const path = [];
  for (let i = end; i !== -1; i = came[i]) path.unshift(nodes[i]);
  return path;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
