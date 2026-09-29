// اختبار المصيّر 3D (بلا WebGL) — node tests/test-3d.mjs
import { installStubs, ROOT, makeEl, suite } from './stub.mjs';
installStubs();

const { Game } = await import(ROOT + 'game.js');
const { View3D } = await import(ROOT + 'view3d.js');
const { RECIPE_BY_ID } = await import(ROOT + 'data.js');
const THREE = await import(ROOT + '../vendor/three.module.js');

const t = suite('🏝️ اختبار 3D (Three.js بلا WebGL)');

t.section('[1] بناء المشهد');
const view = new View3D({ shadows: false, autoAttach: false });
const game = new Game(makeEl('canvas'), view);
game.newGame(20240928);
game.ui.back();
view.buildScene(game);

t.ok(!!view.terrain, 'الأرض تبنات');
t.ok(view.terrain.geometry.attributes.position.count === (game.world.w + 1) * (game.world.h + 1), `رؤوس الأرض: ${view.terrain.geometry.attributes.position.count}`);
t.ok(!!view.water && !!view.deep, 'الماء كاين (سطحي + عميق)');
t.ok(!!view.stars, 'النجوم كاينين');
t.ok(!!view.sun && !!view.hemi, 'الضوء كاين');
t.ok(!!view.playerModel && view.playerModel.root.children.length >= 5, 'نموذج اللاعب تبنى');
t.ok(view.instanced.length >= 8, `${view.instanced.length} مجموعات مرسومة (instanced)`);
const totalInstances = view.instanced.reduce((s, m) => s + m.count, 0);
const natural = game.world.objs.filter((o) => !(o.kind in { campfire: 1, hut: 1, coop: 1, bench: 1, boat: 1 })).length;
t.ok(totalInstances > natural * 0.55, `نسخ الأغراض: ${totalInstances} من ${natural} غرض طبيعي`);
t.ok(view.map.size === totalInstances, 'كل غرض عندو نسخة (mapping)');
t.ok(!!view.pMesh, 'نظام الجزيئات واجد');

t.section('[2] حساب ارتفاع الأرض');
const gCamp = view.groundAtPx(game.world.camp.x, game.world.camp.y);
t.ok(gCamp > -0.2 && gCamp < 2, `ارتفاع الرمل: ${gCamp.toFixed(2)}`);
let deepTile = null;
for (let ty = 0; ty < game.world.h && !deepTile; ty++)
  for (let tx = 0; tx < game.world.w; tx++)
    if (game.world.tileAt(tx, ty) === 0) { deepTile = { x: (tx + .5) * 32, y: (ty + .5) * 32 }; break; }
t.ok(deepTile && view.groundAtPx(deepTile.x, deepTile.y) < -1.5, `قاع البحر: ${deepTile ? view.groundAtPx(deepTile.x, deepTile.y).toFixed(2) : '—'} صافي`);
t.ok(view.groundAtPx(deepTile.x, deepTile.y) < -1.5, 'البحر غامق');
const wp = view.worldPos(game.player.x, game.player.y);
t.ok(Math.abs(wp.x - (game.player.x / 32 + view.offsetX)) < 0.001, 'التحويل للتلات مزيان');
t.ok(Math.abs(wp.x) <= game.world.w / 2 + 1, `البلاصة داخل الجزيرة (${wp.x.toFixed(1)})`);

t.section('[3] الكاميرا والمدخلات');
view.camera.position.set(0, 20, 30);
view.camera.lookAt(0, 0, 0);
view.camera.updateMatrixWorld();
const f = view.transformInput(0, -1);
const r = view.transformInput(1, 0);
t.ok(Math.hypot(f.x, f.y) > 0.9 && Math.hypot(r.x, r.y) > 0.9, 'تحويل المدخلات كيرجع اتجاه');
t.ok(Math.abs(f.x * r.x + f.y * r.y) < 0.01, 'قدّام ويمين متعامدين ✔');
game.input.x = 0; game.input.y = -1;
const before = { x: game.player.x, y: game.player.y };
for (let i = 0; i < 120; i++) game.update(1 / 60);
const movedPx = Math.hypot(game.player.x - before.x, game.player.y - before.y);
t.ok(movedPx > 200, `اللاعب مشا بالمدخلات المحوّلة: ${movedPx.toFixed(0)}px`);
game.input.x = game.input.y = 0;

t.section('[4] التحديث كل فريم');
try {
  for (let i = 0; i < 600; i++) { game.update(1 / 60); view.updateScene(game, 1 / 60); }
  t.ok(true, '600 فريم بلا أخطاء');
} catch (e) { t.ok(false, 'updateScene طاح: ' + e.message + '\n' + e.stack); }
const camGround = view.groundAtPx((view.camera.position.x - view.offsetX) * 32, (view.camera.position.z - view.offsetZ) * 32);
t.ok(view.camera.position.y > camGround - 0.6, `الكاميرا فوق الأرض (${view.camera.position.y.toFixed(1)} > ${camGround.toFixed(1)})`);
t.ok(view.animalModels.size === game.world.animals.length, `نماذج ${view.animalModels.size} حيوان متزامنة`);

t.section('[5] ليل/نهار وإضاءة');
game.world.time = 12 * 60; view.updateScene(game, 1 / 60);
const dayI = view.sun.intensity, dayStars = view.starMat.opacity;
game.world.time = 23 * 60; view.updateScene(game, 1 / 60);
const nightI = view.sun.intensity, nightStars = view.starMat.opacity;
t.ok(dayI > nightI * 3, `ضوا النهار ${dayI.toFixed(2)} >> الليل ${nightI.toFixed(2)}`);
t.ok(nightStars > 0.5 && dayStars < 0.1, `النجوم: ليل ${nightStars.toFixed(2)} / نهار ${dayStars.toFixed(2)}`);
game.world.time = 12 * 60;

t.section('[6] القطع، البنايات والقارب');
const tree = game.world.objs.find((o) => (o.kind === 'tree' || o.kind === 'palm') && !o.depleted);
game.player.x = tree.x; game.player.y = tree.y + 20;
for (let i = 0; i < 40 && !tree.depleted; i++) { game.hitCd = 0; game.doAction(); game.update(1 / 60); }
t.ok(tree.depleted, 'الشجرة تقطعت');
view.updateScene(game, 1 / 60);
t.ok(view.stumps && view.stumps.has(tree.id), 'الجذع تبان فالبلاصة');
const rec = view.map.get(tree.id);
const mtx = new THREE.Matrix4();
rec.mesh.getMatrixAt(rec.index, mtx);
t.ok(Math.abs(mtx.elements[0]) < 0.001, 'الشجرة المقطوعة تخفات');

game.stageIdx = 5;
game.inv = { ...game.inv, wood: 300, stone: 80, fiber: 150, resin: 30, rope: 20, sail: 1, axe: 1, pick: 1 };
for (const id of ['axe', 'pick', 'campfire', 'hut', 'coop', 'bench', 'rope', 'sail', 'boat']) {
  const rc = RECIPE_BY_ID[id];
  if (!game.crafted[id]) game.craft(rc);
}
game.state = 'playing';
view.updateScene(game, 1 / 60);   // كيفما فاللعب: المزامنة كل فريم
t.ok(!!game.world.struct('hut') && view.structs.size >= 3, `البنايات زادو (${view.structs.size})`);
t.ok(view.fireLights.length >= 1, 'نار المخيم فيها ضوا');
t.ok(!!view.boat && view.boat.parts.hull.visible, 'القارب تبنى');
t.ok(!view.boat.parts.sail.visible, 'الشراع مازال مخفي (البناء مكمّلش)');
game.player.x = view.boat.obj.x; game.player.y = view.boat.obj.y + 30;
for (let i = 0; i < 60 && (view.boat.obj.progress ?? 0) < 1; i++) game.boatAction(view.boat.obj);
view.syncBoat(game);
t.ok((view.boat.obj.progress ?? 0) >= 1, `القارب ${Math.round((view.boat.obj.progress ?? 0) * 100)}%`);
t.ok(view.boat.parts.sail.visible && view.boat.parts.mast.visible && view.boat.parts.ropes.visible, 'الشراع والصاري والحبال بانو');
t.ok(!!view.beacon, 'عمود الضوا فوق القارب');

t.section('[7] حيوانات كتزاد وكتحيد');
const before2 = view.animalModels.size;
game.world.addAnimal({ type: 'goat', x: game.world.camp.x + 200, y: game.world.camp.y + 200, seed: 5 });
view.updateScene(game, 1 / 60);
t.ok(view.animalModels.size === before2 + 1, 'العنزة الزايدة تبان');
const last = game.world.animals[game.world.animals.length - 1];
game.world.removeAnimal(last);
view.updateScene(game, 1 / 60);
t.ok(view.animalModels.size === before2, 'الحيوان اللي مشا تحيد');

t.section('[8] الجزيئات والعناصر المرمية');
game.fx.sparkle(game.player.x, game.player.y, '#ffd75e');
game.spawnItems('wood', 3, game.player.x + 20, game.player.y);
view.updateScene(game, 1 / 60);
t.ok(view.pMesh.count > 0, `جزيئات: ${view.pMesh.count}`);
const woodPool = view.itemMeshes.get('wood');
const woodOnGround = game.items.filter((i) => i.kind === 'wood').length;
t.ok(!!woodPool && woodPool.count === Math.min(woodOnGround, 40), `العناصر المرمية: ${woodPool ? woodPool.count : 0} = ${woodOnGround}`);
const woodBefore = game.inv.wood;
for (let i = 0; i < 60 * 8; i++) { game.update(1 / 60); view.updateScene(game, 1 / 60); }
t.ok(game.inv.wood >= woodBefore + 3, `اللاعب جمع الخشب (+${game.inv.wood - woodBefore})`);

t.section('[9] الوضع 2D مازال خدام');
const { View2D } = await import(ROOT + 'view2d.js');
const game2 = new Game(makeEl('canvas'), new View2D());
game2.newGame(777);
game2.ui.back();
try {
  game2.render();
  t.ok(!!game2.ui.mapCanvas && !!game2.ctx, 'الوضع 2D باقة خدام');
} catch (e) { t.ok(false, '2D طاح: ' + e.message + '\n' + e.stack); }

t.done();
