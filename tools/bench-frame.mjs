// Frame-cost benchmark: 8 fully-cosmeticked characters + the room + the FX pool +
// the camera rig, all ticked like the real render loop, so we can see how much of
// the 16.7 ms budget the JS side eats before the GPU is even involved.
import { register } from 'node:module';
register(new URL('./three-resolver.mjs', import.meta.url).href, import.meta.url);
import { installDom } from './domshim.mjs';

installDom({ ids: [] });
const THREE = await import('three');
const { Room3D, CameraRig } = await import('../swindle/js/room3d.js');
const { Character } = await import('../swindle/js/chars.js');
const { FX } = await import('../swindle/js/fx.js');
const { COSM } = await import('../shared/content.js');

const N = 1500;
for (const quality of ['low', 'medium', 'high', 'ultra']) {
  const room = new Room3D(quality);
  const cam = new THREE.PerspectiveCamera(34, 1.7, 0.4, 90);
  const rig = new CameraRig(cam, room);
  const fx = new FX(room.scene, quality);
  const chars = [];
  for (let i = 0; i < 8; i++) {
    const c = new Character({
      skin: i % COSM.skin.length, face: i % COSM.face.length, hair: i % COSM.hair.length,
      hat: i % COSM.hat.length, glasses: i % COSM.glasses.length, shirt: i % COSM.shirt.length,
      pants: i % COSM.pants.length, shoes: i % COSM.shoes.length, acc: i % COSM.acc.length,
      color: i % COSM.color.length, hairColor: (i * 5) % COSM.color.length,
    });
    room.scene.add(c.root);
    chars.push(c);
  }
  const v = new THREE.Vector3(0, 1.2, 0);
  const exprs = ['idle', 'sly', 'worry', 'cheer', 'smug', 'laugh', 'cry'];
  const boards = ['cases', 'cards', 'tiles', 'vault', 'parcel', 'hammer', 'button', 'fall'];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    for (const c of chars) {
      c.speed = (i % 3) * 0.7;
      if (i % 11 === 0) c.setExpr(exprs[(i / 11 | 0) % exprs.length]);
      if (i % 61 === 0) c.playEmote(['sweat', 'guns', 'clap', 'point', 'shrug', 'count'][(i / 61 | 0) % 6], 900);
      c.update(1 / 60, i / 60);
    }
    room.update(1 / 60, { board: boards[i % boards.length], pot: 400 + i, dial: i * 0.01, press: (i % 30) / 30, highlightCase: 'B', boardSpin: 0.3 });
    if (i % 40 === 0) room.drawScreen((g, W, H) => { g.fillStyle = '#111'; g.fillRect(0, 0, W, H); g.font = '800 34px x'; g.fillText('reveal', 20, 40); });
    rig.frame(chars.map((c) => c.root.position.clone()), { tight: i % 7 === 0 });
    if (i % 90 === 0) rig.kick(0.5);
    rig.update(1 / 60, quality);
    if (i % 3 === 0) fx.spark(v, { count: 18 });
    if (i % 5 === 0) fx.chips(v, { count: 14 });
    if (i % 23 === 0) { fx.ring(v); fx.float(v, '+240'); }
    fx.update(1 / 60, cam.position);
  }
  const ms = (performance.now() - t0) / N;
  let meshes = 0, tris = 0;
  room.scene.traverse((o) => { if (o.isMesh && o.visible) { meshes++; tris += ((o.geometry.index?.count || o.geometry.attributes?.position?.count || 0) / 3); } });
  console.log(`${quality.padEnd(7)} js ${ms.toFixed(2).padStart(6)} ms/frame · ${meshes} meshes · ${(tris / 1000).toFixed(0)}k tris · ${(ms / 16.67 * 100).toFixed(0)}% of the 60fps budget (8 players, fx firing)`);
}
console.log('\nGPU work is on top of this; the headless stub cannot time it. Draw calls stay flat with player count');
console.log('because characters share cached geometries/materials and particles are pooled PointSystems.');
