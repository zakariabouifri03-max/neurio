// ═══════════════════════════════════════════════════════════════════════════
//  VALIDATOR — static + runtime checks for the Minecraft viewer, runnable
//  without a browser:
//   1. every named import resolves to a real export of its module
//   2. every module can actually be evaluated under Node (with a DOM stub)
//   3. the world generates, meshes and exports to a valid .glb
//  Usage: node tools/mc/validate.mjs [seed]
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import './stub.js';

const ROOT = '/home/user/neurio';
const MC = path.join(ROOT, 'src/minecraft');
const files = fs.readdirSync(MC).filter((f) => f.endsWith('.js')).map((f) => path.join(MC, f));
const errors = [];
const warns = [];

// ── 1. static import/export graph ───────────────────────────────────────────
function exportsOf(file) {
  const s = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s+class\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+([^;\n]+)/gm)) {
    for (const part of m[1].split(',')) {
      const nm = part.trim().match(/^([A-Za-z0-9_$]+)/);
      if (nm) names.add(nm[1]);
    }
  }
  for (const m of s.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      names.add((t.split(/\s+as\s+/)[1] || t).trim());
    }
  }
  if (/^export\s+default/m.test(s)) names.add('default');
  return names;
}
const exportCache = new Map();
const getExports = (f) => { if (!exportCache.has(f)) exportCache.set(f, exportsOf(f)); return exportCache.get(f); };

function resolve(spec, from) {
  if (spec === 'three') return path.join(ROOT, 'node_modules/three/build/three.module.js');
  if (spec.startsWith('three/addons/')) return path.join(ROOT, 'vendor', spec.slice('three/addons/'.length));
  if (spec.startsWith('.')) return path.resolve(path.dirname(from), spec);
  return null;
}

for (const f of [...files, path.join(ROOT, 'src/post.js'), path.join(ROOT, 'src/util.js')]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim(), spec = m[2];
    const target = resolve(spec, f);
    if (!target) { warns.push(`${path.basename(f)}: unresolved import '${spec}'`); continue; }
    if (!fs.existsSync(target)) { errors.push(`${path.basename(f)}: missing file for '${spec}' → ${target}`); continue; }
    if (/^import\s+\*/.test(clause)) continue;                      // namespace import, fine
    const named = clause.match(/\{([^}]*)\}/);
    if (!named) continue;                                            // default import
    const avail = getExports(target);
    for (const part of named[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const orig = t.split(/\s+as\s+/)[0].trim();
      if (!avail.has(orig)) errors.push(`${path.basename(f)}: '${orig}' is not exported by ${path.basename(target)}`);
    }
  }
  // flag imports of files that don't exist at all (dynamic too)
  for (const m of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = resolve(m[1], f);
    if (target && !fs.existsSync(target)) errors.push(`${path.basename(f)}: dynamic import missing → ${m[1]}`);
  }
}

// ── 2. modules evaluate cleanly ─────────────────────────────────────────────
const THREE = await import(path.join(ROOT, 'node_modules/three/build/three.module.js'));
const mods = {};
for (const f of files) {
  try { mods[path.basename(f)] = await import('file://' + f); }
  catch (e) { errors.push(`module ${path.basename(f)} failed to load: ${e.message}`); }
}

// ── 3. full world build + export ────────────────────────────────────────────
const seed = Number(process.argv[2] || 20261011);
const t0 = performance.now();
const { generateTerrain, SEA, SIZE } = mods['terrain.js'];
const { populate } = mods['structures.js'];
const { buildAtlas, PALETTE, B } = mods['textures.js'];
const { Character } = mods['character.js'];
const { Mobs } = mods['mobs.js'];

const T = generateTerrain(seed);
const E = { torches: [], lights: [], campfires: [], beacons: [], spawn: {} };
populate(T, E);
const atlas = buildAtlas(seed);
T.world.setMaterials(atlas.materials);
const group = T.world.buildAll();
const t1 = performance.now();

// character + mobs must build and animate without throwing
const scene = new THREE.Scene();
scene.add(group);
let char = null, mobs = null;
try {
  char = new Character(scene, T, { x: E.spawn.house.x, y: E.spawn.house.y, z: E.spawn.house.z, path: [E.spawn.house, E.spawn.camp, E.spawn.farm].filter(Boolean) });
  for (let i = 0; i < 240; i++) char.update(1 / 60, i / 60, {});
} catch (e) { errors.push('Character: ' + e.message); }
try {
  mobs = new Mobs(scene, T, { home: { x: 0, z: 0 }, radius: 26, seed });
  for (let i = 0; i < 240; i++) mobs.update(1 / 60, i / 60, { night: i > 120 ? 0.9 : 0.1 });
} catch (e) { errors.push('Mobs: ' + e.message); }

// geometry sanity
let tris = 0, verts = 0, badMesh = 0;
for (const m of group.children) {
  const g = m.geometry;
  const ic = g.index ? g.index.count : 0;
  if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv || !g.attributes.color) { badMesh++; continue; }
  if (ic % 3 !== 0) { badMesh++; continue; }
  if (ic / 3 !== g.attributes.position.count / 4 * 2) badMesh++;
  const max = g.index.array.reduce((a, b) => Math.max(a, b), 0);
  if (max >= g.attributes.position.count) badMesh++;
  tris += ic / 3; verts += g.attributes.position.count;
  // vertex colours and AO must stay in range
  const col = g.attributes.color.array;
  for (let i = 0; i < col.length; i++) if (!Number.isFinite(col[i]) || col[i] < 0 || col[i] > 1.001) { badMesh++; break; }
}

// GLB export through three's own exporter
let glbSize = 0, gltfStats = null;
try {
  const { GLTFExporter } = await import(path.join(ROOT, 'node_modules/three/examples/jsm/exporters/GLTFExporter.js'));
  const tmp = new THREE.Scene();
  tmp.add(group.clone());
  if (char) tmp.add(char.obj.clone());
  const buf = await new GLTFExporter().parseAsync(tmp, { binary: true, onlyVisible: true });
  glbSize = buf.byteLength;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) errors.push('GLB: bad magic');
  if (dv.getUint32(4, true) !== 2) errors.push('GLB: bad version');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  gltfStats = { meshes: json.meshes.length, nodes: json.nodes.length, mats: json.materials.length, images: json.images.length, accessors: json.accessors.length };
  const binLen = dv.getUint32(20 + jsonLen + 4, true);
  if (20 + jsonLen + 8 + binLen > buf.byteLength) errors.push('GLB: truncated BIN chunk');
  if (!json.meshes.length) errors.push('GLB: no meshes');
  if (!json.images.length) errors.push('GLB: atlas texture missing');
  fs.writeFileSync('/tmp/mc-export.glb', Buffer.from(buf));
} catch (e) { errors.push('GLTFExporter: ' + e.message); }
const t2 = performance.now();

// ── report ──────────────────────────────────────────────────────────────────
console.log('── validate ─────────────────────────────────────────────');
console.log('seed            ', seed);
console.log('gen + mesh  ms  ', (t1 - t0).toFixed(0));
console.log('char/mobs/glb ms', (t2 - t1).toFixed(0));
console.log('blocks          ', T.world.blockCount.toLocaleString());
console.log('quads / tris    ', T.world.stats.faces.toLocaleString(), '/', tris.toLocaleString());
console.log('verts           ', verts.toLocaleString());
console.log('chunk meshes    ', group.children.length, 'in', T.world.stats.chunks, 'chunks');
console.log('glb bytes       ', glbSize ? (glbSize / 1048576).toFixed(2) + ' MB' : 'FAILED', gltfStats ? JSON.stringify(gltfStats) : '');
console.log('entities        ', JSON.stringify({ torches: E.torches.length, lights: E.lights.length, fires: E.campfires.length, beacons: E.beacons.length }));
console.log('mobs            ', mobs ? mobs.list.length : 0, 'fish', mobs && mobs.fish ? mobs.fish.count : 0);
if (badMesh) errors.push(badMesh + ' meshes have inconsistent index/colour data');
if (warns.length) console.log('warnings:\n  ' + warns.join('\n  '));
if (errors.length) { console.log('\n❌ ERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('\n✅ static graph + runtime + export all clean');
