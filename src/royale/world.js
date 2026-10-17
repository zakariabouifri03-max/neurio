import * as THREE from 'three';
import { WORLD_RADIUS, terrainHeight, seeded } from './rules.js';
import { mat, box, cylinder, ico, pole, quad, batch, textPlane } from './models.js';

export function createEnvironment(renderer, scene) {
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
  const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 1024);
  gradient.addColorStop(0, '#7696ab'); gradient.addColorStop(.28, '#b9c6cc'); gradient.addColorStop(.48, '#e9d2b8'); gradient.addColorStop(.55, '#c6b49c'); gradient.addColorStop(.67, '#7d8976'); gradient.addColorStop(1, '#4b5957'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2048, 1024);
  const random = seeded(245);
  for (let i = 0; i < 32; i++) {
    const x = random() * 2048, y = 180 + random() * 270, w = 50 + random() * 210;
    const cloud = ctx.createRadialGradient(x, y, 3, x, y, w); cloud.addColorStop(0, 'rgba(255,240,225,.24)'); cloud.addColorStop(1, 'rgba(255,240,225,0)'); ctx.save(); ctx.translate(x, y); ctx.scale(1, .22); ctx.translate(-x, -y); ctx.fillStyle = cloud; ctx.fillRect(x - w, y - w, w * 2, w * 2); ctx.restore();
  }
  const sun = ctx.createRadialGradient(1310, 390, 2, 1310, 390, 220); sun.addColorStop(0, '#ffecd7'); sun.addColorStop(.12, '#ffe4c4a0'); sun.addColorStop(1, '#ffdeb400'); ctx.fillStyle = sun; ctx.fillRect(1050, 120, 520, 540);
  const texture = new THREE.CanvasTexture(canvas); texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  const generator = new THREE.PMREMGenerator(renderer); const environment = generator.fromEquirectangular(texture); scene.environment = environment.texture; scene.environmentIntensity = .78; generator.dispose();
  return environment;
}
function groundTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#a0a48a'; ctx.fillRect(0, 0, 512, 512); const random = seeded(200);
  for (let i = 0; i < 26000; i++) { ctx.fillStyle = random() > .5 ? '#e6d6a215' : '#334b3218'; ctx.fillRect(random() * 512, random() * 512, 1 + random() * 2, 1 + random() * 5); }
  const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(95, 95); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map;
}
function mountain(parent, x, z, radius, height, seed) {
  const random = seeded(seed), slices = 28, rows = 7, vertices = [], colors = [], indices = [];
  const low = new THREE.Color('#7e8989'), high = new THREE.Color('#e1e0d5');
  for (let row = 0; row <= rows; row++) {
    const f = row / rows;
    for (let i = 0; i <= slices; i++) {
      const a = i / slices * Math.PI * 2, r = radius * (1 - f) * (.83 + random() * .25);
      const h = height * f + (row > 0 && row < rows ? (random() - .5) * 23 : 0);
      vertices.push(Math.sin(a) * r + x, h - 14, Math.cos(a) * r + z);
      const c = low.clone().lerp(high, Math.max(0, (f - .60) / .22)); c.multiplyScalar(.89 + random() * .16); colors.push(c.r, c.g, c.b);
      if (row < rows && i < slices) { const k = row * (slices + 1) + i; indices.push(k, k + slices + 1, k + 1, k + 1, k + slices + 1, k + slices + 2); }
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })); parent.add(mesh);
}
function cherry(parent, x, z, scale = 1, variant = 0) {
  const y = terrainHeight(x, z), trunk = 0x6b5c50, crown = variant ? 0xe8b6a8 : 0xdca2a2;
  pole(parent, [x, y, z], [x + .12 * scale, y + 3.2 * scale, z], .19 * scale, trunk);
  for (let i = 0; i < 4; i++) {
    const a = i * 2.4 + variant, px = x + Math.sin(a) * 1.4 * scale, pz = z + Math.cos(a) * 1.3 * scale;
    pole(parent, [x, y + 2.0 * scale, z], [px, y + (3.9 + (i % 2) * .4) * scale, pz], .09 * scale, trunk);
    ico(parent, px, y + (4.25 + (i % 2) * .4) * scale, pz, 1.7 * scale, crown, [1.2, .7, 1.15], 1);
  }
  ico(parent, x, y + 4.8 * scale, z, 1.7 * scale, 0xf0c6b9, [1.1, .68, 1.1], 1);
}
function pine(parent, x, z, size, variant = 0) {
  const y = terrainHeight(x, z);
  cylinder(parent, x, y + size * .28, z, size * .027, size * .048, size * .56, 0x5f6353, 5);
  for (let j = 0; j < 3; j++) cylinder(parent, x, y + size * (.42 + j * .2), z, 0, size * (.28 - j * .065), size * (.55 - j * .075), variant ? 0x547465 : 0x426454, 7);
}
function torii(parent, x, z, angle = 0, scale = 1) {
  const group = new THREE.Group(); group.position.set(x, terrainHeight(x, z), z); group.rotation.y = angle; group.scale.setScalar(scale); parent.add(group);
  const red = mat(0xb45442, .85), dark = 0x444f4b;
  for (const s of [-1, 1]) {
    const p = cylinder(group, s * 2.1, 2.7, 0, .15, .23, 5.4, red, 10); p.rotation.z = -s * .04;
    cylinder(group, s * 2.2, .17, 0, .31, .33, .34, dark, 10);
    box(group, s * 2.1, 3.73, 0, .12, .19, 1.45, red);
  }
  box(group, 0, 4.0, 0, 5.1, .24, .21, red);
  box(group, 0, 5.02, 0, 6.08, .32, .57, red);
  box(group, 0, 5.24, 0, 6.39, .16, .69, dark);
  for (const s of [-1, 1]) { const end = box(group, s * 2.91, 5.30, 0, .7, .19, .7, dark); end.rotation.z = s * .16; }
  box(group, 0, 4.48, .1, .52, .65, .12, dark);
}
function house(parent, x, z, rotation = 0, scale = 1) {
  const group = new THREE.Group(); group.position.set(x, terrainHeight(x, z), z); group.rotation.y = rotation; group.scale.setScalar(scale); parent.add(group);
  box(group, 0, .17, 0, 7.2, .34, 5.7, 0x727a70);
  box(group, 0, 1.9, 0, 6.6, 3.5, 5.0, 0xd5cdad);
  for (const x of [-3.3, 0, 3.3]) box(group, x, 1.8, 2.53, .16, 3.5, .14, 0x5a5a4d);
  box(group, 0, 2.8, 2.56, 6.8, .16, .16, 0x5a5a4d);
  for (const x of [-2.03, 2.03]) {
    box(group, x, 1.8, 2.54, 1.72, 1.62, .05, 0x536e69);
    for (let i = -1; i <= 1; i++) box(group, x + i * .44, 1.8, 2.59, .04, 1.64, .03, 0x666754);
    box(group, x, 1.8, 2.59, 1.72, .045, .03, 0x666754);
  }
  box(group, 0, 1.25, 2.55, 1.1, 2.5, .07, 0x606855);
  const roof = mat(0x505d5b, .92);
  quad(group, [[-3.9, 3.5, 3.2], [3.9, 3.5, 3.2], [3.7, 5.2, 0], [-3.7, 5.2, 0]], roof).material.side = THREE.DoubleSide;
  quad(group, [[-3.7, 5.2, 0], [3.7, 5.2, 0], [3.9, 3.5, -3.2], [-3.9, 3.5, -3.2]], roof);
  box(group, 0, 5.22, 0, 8.0, .18, .30, 0x3c4e4c);
  for (let i = -7; i <= 7; i++) { pole(group, [i * .5, 3.52, 3.17], [i * .5, 5.25, 0], .023, 0x7d8171); pole(group, [i * .5, 5.25, 0], [i * .5, 3.52, -3.17], .023, 0x7d8171); }
}
export function createWorld(scene) {
  const group = new THREE.Group(); scene.add(group);
  const staticProps = new THREE.Group(); group.add(staticProps);
  const obstacles = [], random = seeded(80412), roadPaths = [], roadSamples = [];
  const groundGeo = new THREE.PlaneGeometry(1720, 1720, 128, 128); groundGeo.rotateX(-Math.PI / 2);
  const positions = groundGeo.attributes.position, colors = [];
  const green = new THREE.Color('#8c9b7b'), golden = new THREE.Color('#aeb08b');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = terrainHeight(x, z); positions.setY(i, y);
    const c = green.clone().lerp(golden, .25 + Math.sin(x * .03) * Math.cos(z * .021) * .22); colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: groundTexture(), vertexColors: true, roughness: .98 })); ground.receiveShadow = true; group.add(ground);
  const roadMaterial = mat(0x454f51, .93), edgeMaterial = mat(0xbcc3ac, .94), marking = mat(0xdcd7bd, .86);
  function buildRoad(points, width = 9, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], 0, p[1])), closed, 'catmullrom', .28);
    const length = curve.getLength(), count = Math.round(length / 4), points3d = curve.getSpacedPoints(count), vertices = [], indices = [], uvs = [];
    const samples = [];
    for (let i = 0; i <= count; i++) {
      const p = points3d[i], t = curve.getTangentAt(i / count), right = new THREE.Vector3(t.z, 0, -t.x).normalize();
      samples.push({ x: p.x, z: p.z, angle: Math.atan2(t.x, t.z) }); roadSamples.push({ x: p.x, z: p.z });
      for (const s of [-1, 1]) { const x = p.x + right.x * width / 2 * s, z = p.z + right.z * width / 2 * s; vertices.push(x, terrainHeight(x, z) + .065, z); uvs.push(s > 0 ? 1 : 0, i / count); }
      if (i < count) { const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      if (i % 3 === 0 && i > 0) {
        const line = box(staticProps, p.x, terrainHeight(p.x, p.z) + .088, p.z, .105, .012, 3.0, marking, Math.atan2(t.x, t.z));
        const nextY = terrainHeight(p.x + t.x * 1.5, p.z + t.z * 1.5), lastY = terrainHeight(p.x - t.x * 1.5, p.z - t.z * 1.5); line.rotation.x = -Math.atan2(nextY - lastY, 3);
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, roadMaterial); mesh.receiveShadow = true; group.add(mesh); roadPaths.push(samples);
    // Continuous edge paint follows the terrain instead of floating in space.
    for (const s of [-1, 1]) {
      const ev = [], ei = [];
      points3d.forEach((p, i) => { const t = curve.getTangentAt(i / count), rx = t.z, rz = -t.x; for (const offset of [width / 2 - .25, width / 2 - .13]) { const x = p.x + rx * offset * s, z = p.z + rz * offset * s; ev.push(x, terrainHeight(x, z) + .085, z); } if (i < count) { const k = i * 2; ei.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(ev, 3)); geo.setIndex(ei); geo.computeVertexNormals(); const line = new THREE.Mesh(geo, edgeMaterial); line.material.side = THREE.DoubleSide; group.add(line);
    }
  }
  buildRoad([[5, -640], [-42, -470], [70, -325], [15, -180], [0, -60], [0, 0], [20, 100], [160, 207], [185, 370], [60, 580]], 9.5);
  buildRoad([[-520, 290], [-435, -75], [-280, -310], [80, -430], [380, -290], [497, -50], [400, 280], [130, 410], [-220, 440]], 9, true);
  buildRoad([[-560, 170], [-330, 170], [-135, 85], [20, 100], [200, 60], [420, -70], [610, -80]], 8);
  const onRoad = (x, z, margin = 6) => roadSamples.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < margin * margin);
  const nearestRoad = (x, z) => { let closest = roadSamples[0], distance = Infinity; for (const path of roadPaths) for (const p of path) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < distance) { closest = p; distance = d; } } return closest; };
  // A peaceful highland landscape, not a closed racetrack.
  mountain(group, -60, -1030, 520, 470, 471); mountain(group, 560, -860, 380, 330, 111);
  mountain(group, -680, -700, 360, 270, 73); mountain(group, 890, 580, 410, 275, 948);
  mountain(group, -920, 520, 440, 320, 187); mountain(group, 300, 1100, 460, 370, 554);
  for (let i = 0; i < 230; i++) {
    const x = (random() - .5) * 1430, z = (random() - .5) * 1430;
    if (Math.hypot(x, z) < 45 || onRoad(x, z, 16) || Math.hypot(x + 407, z - 82) < 95) continue;
    const size = 8 + random() * 14; pine(staticProps, x, z, size, i % 2);
    if (Math.hypot(x, z) < WORLD_RADIUS - 25) obstacles.push({ x, z, radius: .55, type: 'tree' });
  }
  const cherries = [[-13, -12, 1.5], [12, -22, 1.6], [-17, -37, 1.25], [15, -61, 1.7], [-13, 28, 1.4], [21, 44, 1.25], [29, 90, 1.6], [-9, -82, 1.3], [11, -122, 1.6], [-8, -155, 1.7], [28, -187, 1.5]];
  for (let i = 0; i < 70; i++) { const p = roadSamples[Math.floor(random() * roadSamples.length)]; const x = p.x + (random() > .5 ? 1 : -1) * (13 + random() * 18), z = p.z + (random() - .5) * 20; if (!onRoad(x, z, 11) && Math.hypot(x + 407, z - 82) > 100) cherries.push([x, z, 1.4 + random() * 1.4]); }
  cherries.forEach(([x, z, size], i) => { cherry(staticProps, x, z, size, i % 2); obstacles.push({ x, z, radius: .3 * size, type: 'tree' }); });
  // Small wildflower patches make the close-up garage scene feel grounded.
  for (let i = 0; i < 340; i++) {
    const x = (random() - .5) * 95, z = (random() - .5) * 115;
    if (onRoad(x, z, 5.7)) continue;
    const y = terrainHeight(x, z); const blade = new THREE.Mesh(new THREE.ConeGeometry(.075, .28 + random() * .30, 3), mat(i % 3 ? 0x7b926b : 0xb6b68b)); blade.position.set(x, y + .18, z); blade.rotation.z = (random() - .5) * .4; staticProps.add(blade);
    if (i % 7 === 0) ico(staticProps, x, y + .35, z, .085, 0xe5c4aa);
  }
  torii(staticProps, -23, -34, -.25, 1.15); torii(staticProps, 238, -289, .9, 1.8); torii(staticProps, -162, 91, -.9, 1.4);
  for (let i = 0; i < 8; i++) {
    const x = 218 + (i % 4) * 19, z = -112 + Math.floor(i / 4) * 32;
    house(staticProps, x, z, .2, 1.55); obstacles.push({ x, z, radius: 6.7, type: 'house' });
  }
  house(staticProps, -39, -72, .2, 1.25); obstacles.push({ x: -39, z: -72, radius: 5.3, type: 'house' });
  // Roadside festival pennants and safety posts.
  for (let i = 0; i < 38; i++) {
    const p = roadPaths[0][Math.min(i * 5 + 75, roadPaths[0].length - 1)], side = i % 2 ? 1 : -1;
    const x = p.x + Math.cos(p.angle) * 6.5 * side, z = p.z - Math.sin(p.angle) * 6.5 * side, y = terrainHeight(x, z);
    box(staticProps, x, y + .52, z, .14, 1.04, .14, 0xe0dcc6); box(staticProps, x, y + .83, z, .16, .12, .16, 0x424f50);
  }
  for (const [x, z] of [[-7.8, -18], [7.8, -18], [28, 110], [12, 110]]) {
    const y = terrainHeight(x, z); cylinder(staticProps, x, y + 3.4, z, .045, .045, 6.8, 0x5c6b69, 6);
    const flag = box(staticProps, x + .6, y + 5.3, z, 1.2, 2.8, .02, 0xdc7354);
    textPlane(staticProps, 'OUTRUN', x + .6, y + 5.45, z + .025, .95, .23, { color: '#f7e9d5', size: 91 });
  }
  // Mirror Lake is an obstacle rather than an invisible reset trap.
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x83adb0, metalness: .45, roughness: .18, transparent: true, opacity: .85 }));
  water.rotation.x = -Math.PI / 2; water.scale.set(90, 69, 1); water.position.set(-407, -2.8, 82); group.add(water); obstacles.push({ x: -407, z: 82, radius: 70, type: 'lake' });
  for (let i = 0; i < 45; i++) {
    const x = (random() - .5) * 1220, z = (random() - .5) * 1220;
    if (onRoad(x, z, 14) || Math.hypot(x, z) < 40) continue;
    const size = .7 + random() * 2; ico(staticProps, x, terrainHeight(x, z) + size * .3, z, size, i % 2 ? 0x999c89 : 0x7c877b, [1.4, .7, 1], 0); obstacles.push({ x, z, radius: size, type: 'rock' });
  }
  batch(staticProps);
  // Supply flares. Their original coordinates remain stable on every restart.
  const dropLocations = [[-15, -35, 3], [-65, -65, 2], [70, 125, 3], [-150, 130, 4], [198, -38, 5], [-225, -195, 4], [340, 185, 5], [-325, 310, 6], [315, -310, 6], [-32, -330, 5], [90, 305, 4], [20, 30, 2], [105, -120, 3], [-75, 240, 5]];
  const drops = [], dropMaterial = new THREE.MeshBasicMaterial({ color: 0x9de0ec, transparent: true, opacity: .21, depthWrite: false, side: THREE.DoubleSide });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xaee4e6, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false });
  dropLocations.forEach(([x, z, level], index) => {
    const root = new THREE.Group(); root.position.set(x, terrainHeight(x, z), z); group.add(root); root.visible = false;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.8, 1.65, 38, 9, 1, true), dropMaterial); pillar.position.y = 19; root.add(pillar);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.8, 5.02, 48), ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .14; root.add(ring);
    box(root, 0, .35, 0, 1.7, .7, 1.7, 0x3f6366); box(root, 0, .73, 0, 1.8, .09, 1.8, 0xb4d5c9);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.6), new THREE.MeshStandardMaterial({ color: 0xc1e9e5, emissive: 0x73c8d4, emissiveIntensity: .5, metalness: .2, roughness: .4 })); diamond.position.y = 2.9; root.add(diamond);
    drops.push({ id: index, x, z, level, root, pillar, diamond, taken: false });
  });
  const zoneMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { time: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'varying vec2 vUv;uniform float time;void main(){float edge=pow(1.-vUv.y,2.);float band=pow(.5+.5*sin(vUv.y*120.-time*1.5),12.);float grid=step(.985,fract(vUv.x*100.));float a=edge*(.09+band*.12+grid*.14);gl_FragColor=vec4(.98,.35,.29,a);}' });
  const zone = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 120, 1, true), zoneMaterial); zone.position.y = 52; zone.scale.set(640, 1, 640); zone.visible = false; group.add(zone);
  const zoneRing = new THREE.Mesh(new THREE.TorusGeometry(1, .0018, 5, 160), new THREE.MeshBasicMaterial({ color: 0xef836f, transparent: true, opacity: .8 })); zoneRing.rotation.x = Math.PI / 2; zoneRing.position.y = 3; zoneRing.scale.setScalar(640); zoneRing.visible = false; group.add(zoneRing);
  const finish = new THREE.Group(); group.add(finish); finish.visible = false;
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff8c67, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false });
  for (const s of [-1, 1]) { box(finish, s * 10, 5.5, 0, 1.0, 11, 1.2, 0xe98561); const beam = new THREE.Mesh(new THREE.CylinderGeometry(.3, .55, 85, 8, 1, true), beaconMaterial); beam.position.set(s * 10, 42.5, 0); finish.add(beam); }
  box(finish, 0, 11, 0, 21.0, 1.6, .48, 0x354d4e); textPlane(finish, 'FINISH / OUTRUN', 0, 11.01, .26, 16, 1.3, { color: '#fbecda', size: 68 });
  const finishRing = new THREE.Mesh(new THREE.RingGeometry(11.3, 11.7, 64), new THREE.MeshBasicMaterial({ color: 0xffb091, side: THREE.DoubleSide, depthWrite: false })); finishRing.rotation.x = -Math.PI / 2; finishRing.position.y = .15; finish.add(finishRing);
  // Only one shadow-casting light. Its small shadow region follows the player.
  scene.fog = new THREE.Fog(0xc7c4b2, 260, 1530);
  const sky = new THREE.HemisphereLight(0xd8e3e3, 0x77775d, 1.9); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffe4c5, 3.15); sun.position.set(-19, 32, 20); sun.target.position.set(0, 0, 0); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 100 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .035; scene.add(sun, sun.target);
  // Softly drifting petals are local to the showcase, not fake motion blur.
  const petalGeometry = new THREE.BufferGeometry(), petalPositions = new Float32Array(65 * 3);
  for (let i = 0; i < 65; i++) { petalPositions[i * 3] = (random() - .5) * 65; petalPositions[i * 3 + 1] = 2 + random() * 9; petalPositions[i * 3 + 2] = (random() - .5) * 55; }
  petalGeometry.setAttribute('position', new THREE.BufferAttribute(petalPositions, 3));
  const petals = new THREE.Points(petalGeometry, new THREE.PointsMaterial({ color: 0xf3c8ba, size: .075, transparent: true, opacity: .8, depthWrite: false })); group.add(petals);
  return { group, obstacles, roadPaths, roadSamples, drops, zone, zoneRing, finish, sun, onRoad, nearestRoad, petals,
    setLobby(on) { drops.forEach(d => { d.root.visible = !on && !d.taken; }); zone.visible = zoneRing.visible = !on; finish.visible = false; petals.visible = on; sun.shadow.needsUpdate = true; if (on) { sun.position.set(-19, 32, 20); sun.target.position.set(0, 0, 0); } },
    reset() { drops.forEach(d => { d.taken = false; d.root.visible = true; }); finish.visible = false; },
    setZone(radius) { zone.scale.set(radius, 1, radius); zoneRing.scale.setScalar(radius); },
    setFinish(x, z) { finish.visible = true; finish.position.set(x, terrainHeight(x, z), z); },
    animate(t) { zoneMaterial.uniforms.time.value = t; drops.forEach(d => { if (!d.taken) { d.diamond.rotation.y = t * .6; d.diamond.position.y = 3 + Math.sin(t * 1.8 + d.id) * .3; } }); petals.rotation.y = Math.sin(t * .06) * .2; petals.position.y = Math.sin(t * .2) * .4; },
    followShadow(x, z) { const y = terrainHeight(x, z); sun.position.set(x - 19, y + 32, z + 20); sun.target.position.set(x, y, z); sun.shadow.needsUpdate = true; },
  };
}
