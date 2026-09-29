// تفتيش بصري بلا متصفح: كنحسبو المواضع والإطار ديال الكاميرا
// node tests/test-visual.mjs
import * as THREE from '../vendor/three.module.js';
import { installStubs, ROOT, makeEl } from './stub.mjs';
installStubs();
const { Game } = await import(ROOT + 'game.js');
const { View3D } = await import(ROOT + 'view3d.js');
const TILE = 32;   // بلاطة = 32 بكسل (قيمة اللعبة)

let total = 0, fails = 0;
const ok = (c, m) => { total++; console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fails++; };
const f = (v, d = 2) => Number(v).toFixed(d);

console.log('🎥 تفتيش المشهد والكاميرا (بلا متصفح)');

const canvas = makeEl('canvas');
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
const view = new View3D({ shadows: false, autoAttach: false });
const game = new Game(canvas, view);
game.newGame(20240928);
game.ui.back();
view.buildScene(game);

ok(!!view.scene && view.scene.children.length > 5, `المشهد فيه ${view.scene.children.length} عنصر`);
ok(!!view.camera, 'الكاميرا مركّبة');

// ---------- 1) الأرض ----------
const terrain = view.terrain;
ok(!!terrain, 'ميش الأرض كاين');
const pos = terrain.geometry.attributes.position;
const W1 = game.world.w + 1;
let maxMesh = 0, maxFn = 0, samples = 0;
for (let i = 0; i < 80; i++) {
  const gx = Math.floor(Math.random() * W1), gy = Math.floor(Math.random() * (game.world.h + 1));
  const vi = gy * W1 + gx;
  maxMesh = Math.max(maxMesh, Math.abs(pos.getY(vi) - view.heights[vi]));
  maxFn = Math.max(maxFn, Math.abs(view.groundAtPx(gx * TILE, gy * TILE) - view.heights[vi]));
  samples++;
}
ok(maxMesh < 1e-4, `ميش الأرض مبني من نفس الارتفاعات (أقصى فرق ${f(maxMesh, 5)} فـ${samples} رأس)`);
ok(maxFn < 1e-4, `حساب الارتفاع مطابق للميش (${f(maxFn, 5)})`);
const dx = pos.getX(1) - pos.getX(0), dz = pos.getZ(W1) - pos.getZ(0);
ok(Math.abs(dx - 1) < 1e-4 && Math.abs(dz - 1) < 1e-4, `التلاتة ديال الأرض = 1 وحدة لكل بلاطة (${f(dx, 4)} / ${f(dz, 4)})`);
// النقطة الوسطى ديال بلاطة خاصها تكون وسط 4 رؤوس
let midBad = 0;
for (let i = 0; i < 40; i++) {
  const tx = Math.floor(Math.random() * (game.world.w - 1)), ty = Math.floor(Math.random() * (game.world.h - 1));
  const mid = view.groundAtPx(tx * TILE + 16, ty * TILE + 16);
  const corners = [pos.getY(ty * W1 + tx), pos.getY(ty * W1 + tx + 1), pos.getY((ty + 1) * W1 + tx), pos.getY((ty + 1) * W1 + tx + 1)];
  const lo = Math.min(...corners) - 0.01, hi = Math.max(...corners) + 0.01;
  if (mid < lo || mid > hi) midBad++;
}
ok(midBad === 0, 'الوسط ديال البلاطة بين الرؤوس ديالها (بلا تشويه)');

const campfireAt = () => game.world.struct('campfire');
if (!campfireAt()) {
  game.stageIdx = 3;
  game.inv.wood = 40; game.inv.stone = 40; game.inv.fiber = 40;
  const { RECIPE_BY_ID } = await import(ROOT + 'data.js');
  game.craft(RECIPE_BY_ID.campfire);
}
view.syncStructures(game); view.syncCampfires(game);
const fire = campfireAt();
ok(!!fire, 'نار المخيم كاينة فالمشهد');
const deep = view.groundAtPx(20, 20);
const landY = view.groundAtPx(fire.x, fire.y);
ok(deep < -1 && landY > 0, `الما غارق (${f(deep)}) والبر مرفوع (${f(landY)})`);

// ---------- 2) الشجر ثابت فالأرض ----------
let checked = 0, badFloat = 0;
for (const kind of ['palm', 'tree', 'bush']) {
  for (const o of game.world.objs.filter((o) => o.kind === kind).slice(0, 10)) {
    const rec = view.map.get(o.id);
    if (!rec) continue;
    const m = new THREE.Matrix4();
    rec.mesh.getMatrixAt(rec.index, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    checked++;
    if (Math.abs(p.y - view.groundAtPx(o.x, o.y)) > 0.15) badFloat++;
  }
}
ok(checked > 0 && badFloat === 0, `${checked} شجرة/شجيرة متثبتين فالأرض (${badFloat} طايرة)`);

// ---------- 3) اللاعب والحيوانات ----------
const pm = view.playerModel;
const pb = new THREE.Box3().setFromObject(pm.root);
const pg = view.groundAtPx(game.player.x, game.player.y);
ok(Math.abs(pb.min.y - pg) < 0.2, `رجلين اللاعب فالرملة (فرق ${f(pb.min.y - pg, 3)})`);
ok(pb.max.y - pb.min.y > 1.2 && pb.max.y - pb.min.y < 2.1, `طول اللاعب ${f(pb.max.y - pb.min.y)} وحدة`);

const chkEntry = [...view.animalModels].find(([a]) => a.type === 'chicken');
if (chkEntry) {
  const [ca, cm] = chkEntry;
  const cb = new THREE.Box3().setFromObject(cm.root);
  const cg = view.groundAtPx(ca.x, ca.y);
  ok(cb.min.y - cg > -0.15 && cb.min.y - cg < 0.25, `الدجاجة واقفة فالأرض (${f(cb.min.y - cg, 3)})`);
  ok(cb.max.y - cb.min.y > 0.4 && cb.max.y - cb.min.y < 1.2, `قد الدجاجة ${f(cb.max.y - cb.min.y)}`);
}

// ---------- 4) القارب والنار ----------
if (!game.world.struct('boat')) {
  const { RECIPE_BY_ID } = await import(ROOT + 'data.js');
  game.stageIdx = 6;
  game.inv.wood = 400; game.inv.stone = 200; game.inv.fiber = 400; game.inv.rope = 40; game.inv.resin = 20;
  game.craft(RECIPE_BY_ID.bench);
  const cb = game.craft(RECIPE_BY_ID.boat);
  ok(!!cb && !!game.world.struct('boat'), 'هيكل القارب تبنى (بالطابلة والراتنج)');
}
view.syncBoat(game);
ok(!!view.boat, 'القارب بان فالمشهد');
if (view.boat) {
  const bb = new THREE.Box3().setFromObject(view.boat.root);
  const bg = view.groundAtPx(view.boat.obj.x, view.boat.obj.y);
  ok(bb.min.y - bg < 1.4 && bb.min.y - bg > -3, `القارب مرسى فالماء (${f(bb.min.y - bg)} تحت الأرض)`);
  view.boat.obj.progress = 0.1; view.syncBoat(game);
  ok(view.boat.parts.hull.visible && !view.boat.parts.mast.visible, 'المرحلة 1: غير الجسم كيبان');
  view.boat.obj.progress = 1; view.syncBoat(game);
  ok(view.boat.parts.mast.visible && view.boat.parts.ropes.visible && view.boat.parts.sail.visible, 'القارب الكامل: صاري + حبال + شراع');
}

const fl = view.fireLights[0];
if (fl) {
  game.world.time = 12 * 60; game.time += 4.2; view.updateScene(game, 1 / 60); const day = fl.light.intensity;
  game.world.time = 22 * 60; game.time += 4.2; view.updateScene(game, 1 / 60); const night = fl.light.intensity;
  ok(night > day * 2, `ضو النار كيقوى بالليل (${f(day)} → ${f(night)})`);
  ok(fl.light.distance >= 10, `مدى الضو ${f(fl.light.distance)} وحدة`);
  const fb = new THREE.Box3().setFromObject(fl.fire);
  ok(fb.min.y > fl.g - 0.3, 'الضرام ماشي غارق فالأرض');
} else ok(false, 'ما لقيناش ضوا النار');

// ---------- 5) الكاميرا ----------
for (let i = 0; i < 90; i++) { game.update(1 / 60); view.updateScene(game, 1 / 60); }
view.updateCamera(game, 1 / 60);
view.camera.updateMatrixWorld(true);

const W = 1280, H = 720;
const project = (v) => { const q = v.clone().project(view.camera); return { x: (q.x + 1) / 2 * W, y: (1 - q.y) / 2 * H, z: q.z }; };
const feet = project(new THREE.Vector3(game.player.x / TILE + view.offsetX, pg, game.player.y / TILE + view.offsetZ));
const head = project(new THREE.Vector3(game.player.x / TILE + view.offsetX, pg + 1.55, game.player.y / TILE + view.offsetZ));
const pxH = Math.abs(head.y - feet.y);
ok(feet.x > 0 && feet.x < W && feet.y > 0 && feet.y < H, `اللاعب داخل الشاشة (${f(feet.x, 0)}, ${f(feet.y, 0)})`);
ok(Math.abs(feet.x - W / 2) < W * 0.35, `اللاعب قريب من الوسط أفقيا (${f(feet.x, 0)} من ${W})`);
ok(pxH > H * 0.06 && pxH < H * 0.7, `قد اللاعب فالشاشة ${f(pxH, 0)}px من ${H}`);
ok(view.camera.position.y > pg + 2, `الكاميرا عالية (${f(view.camera.position.y)} مقابل الأرض ${f(pg)})`);
ok(view.camera.fov >= 45 && view.camera.fov <= 75, `زاوية الرؤية ${view.camera.fov}°`);
ok(view.camera.near < 1 && view.camera.far > 200, `نطاق الرؤية ${view.camera.near} → ${view.camera.far}`);

// حاجة بعيدة كتبان وسط الإطار (الأفق)
const farObj = game.world.objs.find((o) => Math.hypot(o.x - game.player.x, o.y - game.player.y) > 250);
if (farObj) {
  const p2 = project(new THREE.Vector3(farObj.x / TILE + view.offsetX, view.groundAtPx(farObj.x, farObj.y), farObj.y / TILE + view.offsetZ));
  ok(p2.z > -1 && p2.z < 1, `شي حاجة بعيدة داخل مدى الرؤية (z=${f(p2.z)})`);
}

// ---------- 6) التحكم: الحركة بالنسبة للكاميرا ----------
view.camYaw = 0; view.manualT = 1e9;
const up = view.transformInput(0, -1);
view.camera.updateMatrixWorld(true);
const camFwd = new THREE.Vector3(); view.camera.getWorldDirection(camFwd);
camFwd.y = 0; camFwd.normalize();
const dot = up.x * camFwd.x + up.y * camFwd.z;
ok(dot > 0.9, `"لفوق" كيمشي فاتجاه الكاميرا (منتج ${f(dot, 3)})`);
ok(Math.abs(Math.hypot(up.x, up.y) - 1) < 0.01, `الاتجاه مقيّس (${f(Math.hypot(up.x, up.y), 3)})`);

// ---------- 7) الما والنجوم والضباب ----------
ok(!!view.water, 'ميش الما كاين');
const wpos = view.water.geometry.attributes.position;
const before = wpos.getY(500);
game.time += 0.5;
view.updateScene(game, 0.5);
const afterW = view.water.geometry.attributes.position.getY(500);
ok(Math.abs(afterW - before) > 0.001, `الما فيه موج (${f(before, 3)} → ${f(afterW, 3)})`);
ok(wpos.count > 100, `${wpos.count} رأس فالما`);

game.world.time = 22 * 60;
view.updateScene(game, 1 / 60);
const nightStars = view.stars ? view.starMat.opacity : -1;
const nightSun = view.sun.intensity;
game.world.time = 12 * 60;
view.updateScene(game, 1 / 60);
const dayStars = view.stars ? view.starMat.opacity : -1;
const daySun = view.sun.intensity;
ok(nightSun < daySun, `الشمس خفيفة بالليل (${f(nightSun)} مقابل ${f(daySun)} بالنهار)`);
ok(view.stars ? nightStars > dayStars : true, `النجوم كتبان غير بالليل (${f(dayStars)} → ${f(nightStars)})`);
ok(view.sun.intensity <= 1.6 && view.sun.intensity >= 0.05, `ضو الشمس ${f(view.sun.intensity)}`);
ok(!!view.scene.fog, 'الضباب مركّب');

// ---------- 8) فحص الكليك: النقطة تحت راس اللاعب ----------
const ray = new THREE.Raycaster();
ray.setFromCamera(new THREE.Vector2(0, 0), view.camera);
const hitTerrain = ray.intersectObject(terrain, false);
ok(hitTerrain.length > 0, 'شعاع من وسط الشاشة كيضرب الأرض');

console.log(fails === 0 ? `\n🎉 ${total} تفتيش بصري كامل خدام!` : `\n⚠️ ${fails}/${total} طايحين`);
process.exit(fails ? 1 : 0);
