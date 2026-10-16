import * as THREE from 'three';
import { STAGES, PLATFORM_DATA, LAVA, SPINNER, COINS, platformAt } from './rules.js';
import { mat, box, cylinder, mesh, tree, bench, coin, label, arch, starGeometry, studTexture, mergeStatic } from './models.js';

export function createWorld() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d4e9f9'); scene.fog = new THREE.Fog('#d4e9f9', 65, 205);
  const hemisphere = new THREE.HemisphereLight('#f4f6ff', '#a8b9be', 2.5); scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#fff3d7', 3.0); sun.position.set(-24, 36, 18); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -33; sun.shadow.camera.right = sun.shadow.camera.top = 33;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 110; sun.shadow.bias = -.00025; sun.shadow.normalBias = .035;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 20, 14), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color('#b9dcf6') }, bottom: { value: new THREE.Color('#c4e1f5') } }, vertexShader: 'varying vec3 v; void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform vec3 top;uniform vec3 bottom;varying vec3 v;void main(){float h=clamp(normalize(v).y*.8+.15,0.,1.);gl_FragColor=vec4(mix(bottom,top,h),1.);\n#include <colorspace_fragment>\n}' }));
  sky.renderOrder = -10; scene.add(sky);
  const root = new THREE.Group(); root.name = 'Cloud Hop — floating obstacle course'; scene.add(root);
  const models = new Map(), flags = [], moving = [], hazards = [], scenery = new THREE.Group(), solids = [];

  function topSurface(group, p, color) {
    const cap = box(group, color, [0, -.16, 0], [p.w + .08, .32, p.d + .08], .15);
    const top = new THREE.PlaneGeometry(p.w - .28, p.d - .28); top.rotateX(-Math.PI / 2);
    const uv = top.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.w / 1.5, uv.getY(i) * p.d / 1.5);
    const plate = mesh(group, top, mat(color, { map: studTexture(), roughness: .9 }), 0, .006, 0); plate.castShadow = false;
    cap.receiveShadow = true;
  }
  for (const p of PLATFORM_DATA) {
    const group = new THREE.Group(); group.name = p.id; group.position.set(p.x, p.y, p.z); root.add(group); models.set(p.id, group);
    const colors = { step: '#f6eee0', moving: '#82c8e5', lava: '#f2d8ad', spring: '#e9cb75', spinner: '#bba3da' };
    if (p.kind === 'island') {
      box(group, '#d8be98', [0, -1.05, 0], [p.w, 1.9, p.d], .3);
      box(group, '#b8a58e', [.2, -2.2, -.1], [p.w * .78, 1.0, p.d * .78], .28);
      topSurface(group, p, p.color);
      for (let i = 0; i < Math.floor(p.w / 2); i++) box(group, i % 2 ? '#d9c7a6' : '#c4af8f', [-p.w / 2 + 1.2 + i * 2.1, -1.1, p.d / 2 + .015], [1.8, .63, .05], .035);
      const pad = cylinder(group, '#f4f6db', [p.spawn ? p.spawn.x - p.x : 0, .012, p.spawn ? p.spawn.z - p.z : 1.3], 1.35, .02, 36);
      const core = cylinder(group, new THREE.MeshStandardMaterial({ color: p.stage === 0 ? '#a8d566' : '#e5e2d3', roughness: .72 }), [pad.position.x, .024, pad.position.z], 1.11, .006, 36);
      cylinder(group, '#d6c7aa', [-p.w / 2 + 1.25, 1.65, -.75], .055, 3.3, 8);
      const flag = box(group, new THREE.MeshStandardMaterial({ color: p.stage === 0 ? '#b5df69' : '#f3f1e5', roughness: .8 }), [-p.w / 2 + 1.78, 2.83, -.75], [1.12, .7, .06], .035);
      const artwork = label(String(p.stage + 1).padStart(2, '0'), { width: .7, height: .5, bg: '#ffffff00', fg: '#566456', size: 300 });
      const number = mesh(group, new THREE.PlaneGeometry(.7, .5), new THREE.MeshBasicMaterial({ map: artwork.material.map, transparent: true, toneMapped: false }), flag.position.x, 2.84, -.71); number.castShadow = false;
      flags.push({ stage: p.stage, core, flag });
      // Furniture and trees stay out of the jumping line.
      if (p.stage !== 5) {
        const positions = p.stage === 0 ? [[-7.1, 5.7, 1.15], [7.1, -2.6, .9], [-7.4, -3.9, .85]] : [[p.w / 2 - 1.9, -p.d / 2 + 1.5, .72], [-p.w / 2 + 1.7, p.d / 2 - 1.5, .64]];
        for (const [x, z, scale] of positions) {
          const t = tree(scale, p.stage === 4 ? '#bba3d6' : '#89b56c'); t.position.set(p.x + x, p.y, p.z + z); scenery.add(t);
          solids.push({ id: `tree-${p.id}-${x}`, x: p.x + x, z: p.z + z, y: p.y + 2.4 * scale, w: .56 * scale, d: .56 * scale, thickness: 2.4 * scale });
        }
      }
      for (const side of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          const x = side * (p.w / 2 - 1.1) + Math.sin(j * 4) * .3, z = .3 + j * .45;
          box(group, '#7a9c66', [x, .22, z], [.06, .45, .06], .015);
          box(group, j % 2 ? '#f6d180' : '#f7f4e8', [x, .47, z], [.25, .15, .25], .05);
        }
      }
    } else {
      box(group, p.kind === 'moving' ? '#599fbe' : p.kind === 'spinner' ? '#9272b7' : '#cbbca8', [0, -.55, 0], [p.w, 1.0, p.d], .18);
      topSurface(group, p, colors[p.kind] || colors.step);
      if (p.kind === 'moving') {
        moving.push({ data: p, model: group });
        for (const x of [-1, 1]) {
          const arrow = box(group, '#edf7f2', [x, .04, 0], [.55, .035, .12], .02); arrow.rotation.y = x * Math.PI / 4;
        }
        box(group, '#e5f4f6', [0, -.46, p.d / 2 + .015], [p.w - .5, .18, .05], .04);
      }
      if (p.bounce) {
        cylinder(group, '#565960', [0, .1, 0], 1.65, .15, 32);
        const spring = cylinder(group, mat('#f9d968', { emissive: '#d7ab30', emissiveIntensity: .12 }), [0, .24, 0], 1.45, .15, 32); group.userData.spring = spring;
        const arrow = label('↑  UP WE GO', { width: 3.5, height: .65, bg: '#fff8e4', fg: '#8c6b2c', size: 72 }); arrow.position.set(0, 2.2, 0); group.add(arrow);
      }
    }
  }
  root.add(scenery);
  const seat = bench(); seat.position.set(-5.5, 0, 5.1); root.add(seat);
  solids.push({ id: 'bench', x: -5.5, z: 5.1, y: 1.7, w: 2.9, d: 1.1, thickness: 1.7 });
  arch(root, -1.0, 0, -4.5, '#8abddd', 'CLOUD HOP');
  for (const x of [-4.3, 2.3]) solids.push({ id: `start-post-${x}`, x, z: -4.5, y: 4.4, w: .7, d: .85, thickness: 4.4 });
  const startLabel = label('YOUR NEXT LITTLE ADVENTURE', { width: 5.1, height: .55, bg: '#ffffff', fg: '#64776a', size: 39 }); startLabel.position.set(-1, 5.3, -4.5); root.add(startLabel);
  const direction = new THREE.Group();
  for (let j = 0; j < 3; j++) {
    for (const s of [-1, 1]) { const a = box(direction, '#edf4d7', [s * .25, .03, -.25 + j * 1.0], [.7, .035, .16], .025); a.rotation.y = s * Math.PI / 4; }
  }
  direction.position.set(.65, 0, -.5); root.add(direction);

  for (const p of LAVA) {
    const hazard = box(root, mat('#f5827c', { emissive: '#dc594b', emissiveIntensity: .26 }), [p.x, p.y + .10, p.z], [p.w, .2, p.d], .075);
    hazards.push(hazard);
    for (const sign of [-1, 1]) box(root, '#ffe6ae', [p.x + sign * (p.w / 2 - .25), p.y + .23, p.z], [.14, .04, p.d - .12], .02);
  }
  const spinner = new THREE.Group(); spinner.position.set(SPINNER.x, SPINNER.y, SPINNER.z); root.add(spinner);
  box(spinner, mat('#ee91b3', { emissive: '#a34b70', emissiveIntensity: .08 }), [0, 0, 0], [SPINNER.length, .40, .44], .15);
  for (const s of [-1, 1]) cylinder(spinner, '#f7d6e4', [s * (SPINNER.length / 2 - .15), 0, 0], .32, .44, 16);
  cylinder(root, '#fbf1e1', [SPINNER.x, SPINNER.y, SPINNER.z], .45, 1.05, 16);
  const sp = label('HOP OVER!', { width: 2.4, height: .6, bg: '#fff3f7', fg: '#a05b81', size: 82 }); sp.position.set(SPINNER.x, SPINNER.y + 2.4, SPINNER.z); root.add(sp);

  const last = STAGES.at(-1); arch(root, last.x, last.y, last.z - 2.8, '#f5ce78', 'THE SKY’S YOURS');
  for (const x of [-1, 1]) {
    box(root, '#e8c673', [last.x + x * 5.4, last.y + .5, last.z - 2.8], [1.3, 1, 1.3], .15);
    const trophy = mesh(root, starGeometry(.65, .24), mat('#ffd775', { metalness: .28, roughness: .35 }), last.x + x * 5.4, last.y + 1.7, last.z - 2.8); trophy.rotation.y = x * -.2;
  }
  const goal = new THREE.Group(); goal.position.set(last.x, last.y + 4.2, last.z - 2.8); root.add(goal);
  const goalStar = mesh(goal, starGeometry(.9, .24), mat('#fff0b0', { metalness: .25, roughness: .25, emissive: '#edc055', emissiveIntensity: .12 }), 0, 1.4, 0);
  const coins = COINS.map(definition => { const model = coin(); model.name = `Sky coin ${definition.id + 1}`; model.position.set(definition.x, definition.y, definition.z); root.add(model); return { ...definition, model }; });

  // Oversized, soft-edged voxel clouds and distant islands frame the real course.
  const clouds = new THREE.Group(); scene.add(clouds);
  let seed = 4897; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 34; i++) {
    const cloud = new THREE.Group(), x = (rng() - .5) * 170, z = 35 - rng() * 240, y = -8 - rng() * 12, size = 3 + rng() * 5;
    for (let j = 0; j < 4; j++) box(cloud, '#f4f7fa', [(j - 1.5) * size * .7, Math.sin(j * 2) * size * .12, (rng() - .5) * size * .4], [size * 1.3, size * .57, size], size * .25);
    const compact = mergeStatic(cloud); compact.position.set(x, y, z); compact.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = false; }); compact.userData.x = x; compact.userData.phase = i; clouds.add(compact);
  }
  for (const [x, z, y, size] of [[-39, -25, -2, 9], [33, -46, 0, 11], [-38, -85, 6, 8], [36, -111, 6, 11], [30, 14, -4, 7]]) {
    const group = new THREE.Group(); box(group, '#b2c7bc', [0, -1.1, 0], [size, 2.4, size * .76], .4); box(group, '#bad7a2', [0, .12, 0], [size + .1, .3, size * .76 + .1], .18);
    const t = tree(.85, '#adcca0'); t.position.set(-1, .3, 0); group.add(t); group.position.set(x, y, z); scene.add(group);
  }
  let lastStage = -1;
  return {
    scene, root, sun, coins, flags, models, solids, goalStar,
    colliders(time, previousTime = time) {
      return [...PLATFORM_DATA.map(p => { const now = platformAt(p, time), old = platformAt(p, previousTime); return { ...now, dx: now.x - old.x, dz: now.z - old.z }; }), ...solids];
    },
    update(time, visualTime, state, player) {
      for (const item of moving) { const p = platformAt(item.data, time); item.model.position.x = p.x; }
      spinner.rotation.y = time * SPINNER.speed;
      for (const item of coins) {
        item.model.visible = !state.collected.includes(item.id); item.model.rotation.y = visualTime * 1.6 + item.id;
        item.model.position.y = item.y + Math.sin(visualTime * 2.2 + item.id) * .16;
        if (item.platform) item.model.position.x = platformAt(PLATFORM_DATA.find(p => p.id === item.platform), time).x;
      }
      if (lastStage !== state.checkpoint) {
        lastStage = state.checkpoint;
        for (const flag of flags) { flag.core.material.color.set(flag.stage <= lastStage ? '#a7d85b' : '#e5e2d3'); flag.flag.material.color.set(flag.stage <= lastStage ? '#b5df69' : '#f3f1e5'); }
      }
      goalStar.rotation.y = visualTime * .6; goalStar.position.y = 1.4 + Math.sin(visualTime * 2) * .15;
      for (const c of clouds.children) c.position.x = c.userData.x + Math.sin(visualTime * .035 + c.userData.phase) * 2.5;
      sun.position.set(player.x - 24, player.y + 36, player.z + 18); sun.target.position.set(player.x, player.y, player.z - 5); sun.target.updateMatrixWorld();
    },
  };
}
