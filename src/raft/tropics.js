import * as THREE from 'three';
import { material, box, beam, sphere, cylinder, rope, optimizeStatic, seeded, storage, barrel } from './models.js';
import { timberTexture, barkTexture, sandTexture } from './textures.js';

const wind = { value: 0 };
const leafMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: .82, emissive: '#30481b', emissiveIntensity: .3 });
const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
const animateLeaves = shader => {
  shader.uniforms.uPalmTime = wind;
  shader.vertexShader = 'uniform float uPalmTime;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float weight = smoothstep(2., 13., position.y);
    transformed.x += sin(uPalmTime * 1.05 + position.x * .34 + position.z * .25) * .18 * weight;
    transformed.z += sin(uPalmTime * .8 + position.z * .39) * .12 * weight;`);
};
leafMaterial.onBeforeCompile = leafDepth.onBeforeCompile = animateLeaves;
leafMaterial.customProgramCacheKey = () => 'drift-palm-foliage-2';
leafDepth.customProgramCacheKey = () => 'drift-palm-shadow-2';
const greens = ['#405d2b', '#526d30', '#6b863c', '#829c47', '#91aa52'].map(color => new THREE.Color(color));
const boards = ['#89603b', '#a27548', '#a98153', '#b48b59', '#977047'].map(color => material(color, { map: timberTexture(), bumpMap: timberTexture(), bumpScale: .035, roughness: .91 }));
const frameMat = material('#735236', { map: timberTexture(), bumpMap: timberTexture(), bumpScale: .035 });
const palmBark = material('#9a8260', { map: barkTexture(), bumpMap: barkTexture(), bumpScale: .045, roughness: 1 });

function coloredGeometry(positions, colors, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // A polar terrain grid repeats its center. Give the unused pole a valid
  // upward normal too: glTF validates every accessor value, not just drawn faces.
  const normal = geometry.attributes.normal;
  for (let i = 0; i < normal.count; i++) {
    if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) < .00001) normal.setXYZ(i, 0, 1, 0);
  }
  return geometry;
}
function fernFrond(length, width, droop, variant = 0, pairs = 17) {
  const positions = [], colors = [];
  const center = t => new THREE.Vector3(length * t, Math.sin(t * Math.PI) * length * .27 - droop * t * t, 0);
  const triangle = (a, b, c, color) => { for (const point of [a, b, c]) { positions.push(point.x, point.y, point.z); colors.push(color.r, color.g, color.b); } };
  for (let i = 1; i <= pairs; i++) {
    const t = i / (pairs + 1), base = center(t), blade = width * Math.pow(Math.sin(t * Math.PI), .64);
    for (const side of [-1, 1]) {
      const tip = new THREE.Vector3(base.x + length * .12 * (1 - t * .4), base.y - blade * .27, side * blade);
      const middle = base.clone().lerp(tip, .52); middle.y += blade * .06;
      const spread = .065 + Math.sin(t * Math.PI) * length * .042;
      const left = middle.clone(); left.x -= spread;
      const right = middle.clone(); right.x += spread;
      const color = greens[(i + variant) % greens.length], dark = color.clone().multiplyScalar(.76);
      triangle(base, left, middle, dark); triangle(left, tip, middle, dark);
      triangle(base, middle, right, color); triangle(middle, tip, right, color);
    }
    const next = center(Math.min(1, t + 1 / (pairs + 1)));
    triangle(new THREE.Vector3(base.x, base.y + .008, -.018), new THREE.Vector3(next.x, next.y, 0), new THREE.Vector3(base.x, base.y + .008, .018), greens[3]);
  }
  return new THREE.Mesh(coloredGeometry(positions, colors), leafMaterial);
}
function detailedPalm(height, seed, lean = 1.8) {
  const group = new THREE.Group(), rng = seeded(seed), direction = rng() * Math.PI * 2;
  const pos = [], uv = [], indices = [], radial = 12, rings = 22;
  for (let y = 0; y <= rings; y++) {
    const t = y / rings, bend = lean * t * t, radius = (.21 + height * .007) * (1 - t * .48) + Math.exp(-t * 18) * .12;
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      pos.push(Math.cos(direction) * bend + Math.cos(angle) * radius, t * height, Math.sin(direction) * bend + Math.sin(angle) * radius);
      uv.push(j / radial, t * height * .26);
      if (y < rings && j < radial) { const a = y * (radial + 1) + j; indices.push(a, a + radial + 1, a + 1, a + 1, a + radial + 1, a + radial + 2); }
    }
  }
  const trunk = new THREE.BufferGeometry(); trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); trunk.setIndex(indices); trunk.computeVertexNormals();
  const mesh = new THREE.Mesh(trunk, palmBark); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  const top = new THREE.Vector3(Math.cos(direction) * lean, height, Math.sin(direction) * lean);
  for (let i = 0; i < 11; i++) {
    const frond = fernFrond(height * (.37 + rng() * .13), height * .085, height * (.12 + rng() * .17), i);
    frond.position.copy(top); frond.rotation.y = i * Math.PI * 2 / 11 + rng() * .2; frond.rotation.z = .08 + (rng() - .5) * .48; group.add(frond);
  }
  for (let i = 0; i < 4; i++) sphere(group, material(i % 2 ? '#777340' : '#68543a'), [top.x + (rng() - .5) * .55, top.y - .27 - rng() * .2, top.z + (rng() - .5) * .55], [.16, .21, .16]);
  return group;
}
function bush(group, x, y, z, size, seed) {
  const rng = seeded(seed), plant = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const frond = fernFrond(size * (.7 + rng() * .4), size * .24, size * .35, i, 9);
    frond.rotation.y = i / 7 * Math.PI * 2; frond.rotation.z = .4 + rng() * .45; plant.add(frond);
  }
  plant.position.set(x, y, z); group.add(plant);
}
export function islandGround(x, z, island) {
  const angle = Math.atan2(z / .88, x / 1.15);
  const edge = island.radius * (1 + .045 * Math.sin(angle * 3 + island.seed) + .035 * Math.cos(angle * 5 - island.seed));
  const distance = Math.hypot(x / 1.15, z / .88) / edge;
  let base = distance < 1 ? 1.9 * Math.pow(Math.max(0, 1 - distance * distance), 1.3) : -(distance - 1) * 8;
  if (island.cabin) {
    const pad = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(x - 3.3) / 4.5, Math.abs(z - 4.6) / 4.6), .80, 1.3);
    base = base * (1 - pad) + 1.24 * pad;
  }
  return base + Math.sin(x * .35 + island.seed) * Math.sin(z * .29) * .11 * Math.max(0, 1 - distance);
}
function islandTerrain(island) {
  const positions = [], colors = [], uv = [], indices = [], rings = 22, segments = 112;
  const sand = new THREE.Color('#d7c89f'), wet = new THREE.Color('#998d6d'), green = new THREE.Color('#626444');
  for (let ring = 0; ring <= rings; ring++) {
    const r = ring / rings * 1.25;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const edge = island.radius * (1 + .045 * Math.sin(angle * 3 + island.seed) + .035 * Math.cos(angle * 5 - island.seed));
      const x = Math.cos(angle) * edge * r * 1.15, z = Math.sin(angle) * edge * r * .88, y = islandGround(x, z, island);
      positions.push(x, y, z); uv.push(x * .34, z * .34);
      const inland = 1 - THREE.MathUtils.smoothstep(r, .35, .76), waterline = THREE.MathUtils.smoothstep(r, .85, 1.04);
      const color = sand.clone().lerp(green, inland * .65).lerp(wet, waterline * .46);
      color.multiplyScalar(.94 + Math.sin(x * 1.2 + z * .9) * .025);
      colors.push(color.r, color.g, color.b);
      if (ring < rings && i < segments) { const a = ring * (segments + 1) + i; if (ring > 0) indices.push(a, a + 1, a + segments + 1); indices.push(a + 1, a + segments + 2, a + segments + 1); }
    }
  }
  const geometry = coloredGeometry(positions, colors, indices); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, map: sandTexture(), bumpMap: sandTexture(), bumpScale: .035, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true; mesh.name = 'Sculpted sand and shallow seabed'; return mesh;
}
function cabin() {
  const group = new THREE.Group(), rng = seeded(1921);
  // Raised deck, individual weathered boards, and a front porch.
  for (let i = 0; i < 24; i++) box(group, boards[i % boards.length], [(i - 11.5) * .30, .58, .25], [.285, .16, 6.1]);
  for (const x of [-3.25, 3.25]) for (const z of [-2.4, .2, 2.9]) {
    cylinder(group, frameMat, [x, .2, z], .15, .18, 1.2, 10);
    beam(group, [x, .5, z], [x, 3.55, z], .11, frameMat);
  }
  for (const z of [-2.45, 1.7]) {
    beam(group, [-3.25, 3.55, z], [0, 5.25, z], .12, frameMat);
    beam(group, [0, 5.25, z], [3.25, 3.55, z], .12, frameMat);
    beam(group, [-3.25, 3.4, z], [3.25, 3.4, z], .10, frameMat);
  }
  beam(group, [0, 5.25, -2.8], [0, 5.25, 3.25], .115, frameMat);
  // Back and side walls have real openings; no painted-on windows.
  for (let i = 0; i < 24; i++) box(group, boards[i % 5], [(i - 11.5) * .27, 2.02, -2.4], [.258, 2.72, .12]);
  for (const x of [-3.25, 3.25]) for (let i = 0; i < 18; i++) {
    const z = -2.3 + i * .23;
    if (i > 7 && i < 14) {
      box(group, boards[i % 5], [x, 1.13, z], [.12, .96, .216]);
      box(group, boards[i % 5], [x, 3.2, z], [.12, .42, .216]);
    } else box(group, boards[i % 5], [x, 2.02, z], [.12, 2.72, .216]);
  }
  // A teal central door with bamboo trim, flanked by open windows.
  for (let i = -2; i <= 2; i++) box(group, material('#477367', { map: timberTexture(), bumpMap: timberTexture(), bumpScale: .025 }), [i * .245, 1.89, 1.8], [.232, 2.37, .12]);
  for (const x of [-.7, .7]) box(group, boards[2], [x, 1.96, 1.88], [.14, 2.68, .17]);
  box(group, boards[2], [0, 3.27, 1.88], [1.55, .14, .17]);
  sphere(group, material('#bda775', { metalness: .65 }), [.44, 1.93, 1.91], [.06, .06, .05]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) box(group, boards[(i + 1) % 5], [side * (1.02 + i * .32), 1.13, 1.8], [.303, .97, .12]);
    box(group, frameMat, [side * 2.02, 1.65, 1.82], [2.45, .10, .22]);
    box(group, boards[1], [side * 2.02, 3.27, 1.82], [2.45, .26, .12]);
    for (const x of [side * .87, side * 3.2]) beam(group, [x, 1.6, 1.85], [x, 3.4, 1.85], .07, frameMat);
    // Porch rails and diagonal braces.
    beam(group, [side * .85, 1.7, 2.94], [side * 3.3, 1.7, 2.94], .08, frameMat);
    beam(group, [side * .85, .68, 2.94], [side * .85, 1.7, 2.94], .075, frameMat);
    beam(group, [side * .9, .86, 2.94], [side * 3.2, 1.58, 2.94], .045, frameMat);
    beam(group, [side * 3.2, .86, 2.94], [side * .9, 1.58, 2.94], .045, frameMat);
    beam(group, [side * 3.25, 1.7, 1.75], [side * 3.25, 1.7, 2.95], .075, frameMat);
  }
  // Layered timber-and-thatch roof: many thin irregular reed strips, batched later.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const t = (row + .5) / 7, x = side * t * 3.8, y = 5.3 - t * 2.0;
      const roof = box(group, boards[(row + 2) % 5], [x, y, .1], [.64, .065, 6.75]); roof.rotation.z = -side * Math.atan2(2.0, 3.8);
      for (let reed = 0; reed < 37; reed++) {
        const z = -3.14 + reed * .18;
        beam(group, [x - side * .29, y + .17, z], [x + side * (.33 + rng() * .13), y - .17, z + (rng() - .5) * .06], .018 + rng() * .018, material(['#8e794d', '#a08a57', '#b19865'][reed % 3]));
      }
    }
    beam(group, [side * 3.85, 3.26, -3.35], [side * 3.85, 3.26, 3.48], .08, frameMat);
  }
  for (let step = 0; step < 3; step++) box(group, boards[step], [0, .44 - step * .2, 3.35 + step * .36], [1.55, .15, .46]);
  const chest = storage(); chest.position.set(-2.3, .69, 2.2); chest.scale.setScalar(.85); group.add(chest);
  const cask = barrel(); cask.position.set(2.3, 1.2, 1); group.add(cask);
  box(group, boards[3], [1.9, 1.35, .15], [1.5, .11, .8]);
  for (const x of [1.3, 2.5]) beam(group, [x, .66, .15], [x, 1.35, .15], .04, frameMat);
  rope(group, [[-2.65, 2.1, -.7], [-1.65, 1.25, -.85], [-.7, 1.85, -1]], .085, '#b6b294');
  // Torch brackets are part of the cabin; flames stay separate so they can flicker.
  for (const x of [-3.45, 3.45]) {
    beam(group, [x, 2.1, 2.8], [x, 3.1, 3.05], .055, material('#523e2d'));
    cylinder(group, material('#423d32', { metalness: .25 }), [x, 3.04, 3.05], .13, .08, .2, 8);
  }
  const result = optimizeStatic(group); result.name = 'Palmwood shelter — timber, thatch, porch and furnishings';
  result.userData.flames = [];
  for (const x of [-3.45, 3.45]) {
    const flame = sphere(result, material('#ffc671', { emissive: '#ff922f', emissiveIntensity: 2.5 }), [x, 3.3, 3.05], [.075, .24, .075]);
    flame.userData.phase = x; result.userData.flames.push(flame);
    const light = new THREE.PointLight('#ffb055', 3.5, 5, 2); light.position.set(x, 3.25, 3.12); result.add(light);
  }
  return result;
}

export function tropicalIsland(definition) {
  const root = new THREE.Group(), nature = new THREE.Group(), rng = seeded(definition.seed), r = definition.radius;
  root.name = definition.name; root.add(islandTerrain(definition));
  const positions = definition.cabin
    ? [[-10, -3], [-7, 2], [-11, 5], [-5, -7], [-1, -8], [4, -7], [9, -4], [11, 1], [10, 6], [-3, -2], [2, -3], [-8, -6], [6, -8], [-12, 0]]
    : Array.from({ length: 9 }, () => [(rng() - .5) * r * 1.3, (rng() - .5) * r * .85]);
  for (let i = 0; i < positions.length; i++) {
    const [x, z] = positions[i], y = islandGround(x, z, definition);
    const tree = detailedPalm(8.5 + rng() * 5.3, definition.seed * 33 + i, 1.3 + rng() * 2.0);
    tree.position.set(x, y, z); nature.add(tree);
    for (let j = 0; j < 2; j++) {
      const bx = x + (rng() - .5) * 2.5, bz = z + (rng() - .5) * 2.5;
      bush(nature, bx, islandGround(bx, bz, definition), bz, 1 + rng() * 1.0, i * 19 + j);
    }
  }
  for (let i = 0; i < 17; i++) {
    const angle = rng() * Math.PI * 2, radius = r * (.45 + rng() * .43), x = Math.cos(angle) * radius, z = Math.sin(angle) * radius * .72;
    // Keep the shelter, porch, and entry path clear of scattered boulders.
    if (definition.cabin && x > -1 && x < 8 && z > 0 && z < 10) continue;
    const geo = new THREE.IcosahedronGeometry(1, 2), attr = geo.attributes.position;
    for (let j = 0; j < attr.count; j++) {
      const a = attr.getX(j), b = attr.getY(j), c = attr.getZ(j), distortion = 1 + Math.sin(a * 3.1 + b * 4.6 + c * 2.7 + i) * .13 + Math.cos(c * 7 + a * 5) * .035;
      attr.setXYZ(j, a * distortion, b * distortion, c * distortion);
    }
    geo.computeVertexNormals();
    const boulder = new THREE.Mesh(geo, material(i % 2 ? '#7b8174' : '#939383', { map: sandTexture(), bumpMap: sandTexture(), bumpScale: .055, roughness: 1 }));
    boulder.position.set(x, islandGround(x, z, definition) + .3, z); boulder.scale.set(.45 + rng() * .9, .5 + rng() * 1.2, .4 + rng() * .75); nature.add(boulder);
  }
  // Grass blades and flowers at the foot of the trees and beside the porch.
  const grass = [], colors = [];
  for (let i = 0; i < 3200; i++) {
    const x = (rng() - .5) * r * 1.75, z = (rng() - .5) * r * 1.3;
    if (definition.cabin && x > -1 && x < 8 && z > 0 && z < 10) continue;
    const y = islandGround(x, z, definition); if (y < .3) continue;
    const h = .14 + rng() * .33, w = .025 + rng() * .025, color = greens[i % 5];
    grass.push(x - w, y, z, x + rng() * .18 - .09, y + h, z + .1, x + w, y, z);
    for (let j = 0; j < 3; j++) colors.push(color.r, color.g, color.b);
  }
  nature.add(new THREE.Mesh(coloredGeometry(grass, colors), leafMaterial));
  const merged = optimizeStatic(nature); merged.name = 'Coconut palms, ferns, grass and shoreline rocks'; root.add(merged);
  merged.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = definition.cabin; mesh.receiveShadow = true; if (mesh.material === leafMaterial) mesh.customDepthMaterial = leafDepth; } });
  if (definition.cabin) {
    const hut = cabin(); hut.position.set(3.3, islandGround(3.3, 4.2, definition) + .03, 4.2); hut.rotation.y = .16; root.add(hut); root.userData.cabin = hut;
    for (const [x, z] of [[-1, 7], [7.5, 5], [7, 8]]) bush(root, x, islandGround(x, z, definition), z, 1.2, Math.floor(x + z) * 51);
  }
  return root;
}
export function updateTropics(time, islands) {
  wind.value = time;
  for (const island of islands) for (const flame of island.model.userData.cabin?.userData.flames || []) {
    flame.scale.y = .23 + Math.sin(time * 8 + flame.userData.phase) * .055; flame.scale.x = .072 + Math.sin(time * 11) * .012;
  }
}
