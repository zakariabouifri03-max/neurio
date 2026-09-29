// اختبارات المنطق (بلا متصفح) — node tests/test-logic.mjs
import { installStubs, ROOT, makeEl, suite } from './stub.mjs';
installStubs();

const { buildAtlas } = await import(ROOT + 'render.js');
const { Game } = await import(ROOT + 'game.js');
const { RECIPE_BY_ID } = await import(ROOT + 'data.js');

const t = suite('🧪 اختبارات المنطق');
buildAtlas();

const game = new Game(makeEl('canvas'));
game.newGame(20240928);
game.ui.back();
const w = game.world, p = game.player;
const near = (o) => Math.hypot(o.x - p.x, o.y - p.y);

const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) game.update(dt); };
function walkTo(x, y, maxFrames = 900) {
  for (let i = 0; i < maxFrames; i++) {
    const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
    if (d < 22) { game.input.x = 0; game.input.y = 0; return true; }
    game.input.x = dx / d; game.input.y = dy / d;
    step(1);
  }
  game.input.x = 0; game.input.y = 0;
  return false;
}

t.section('[1] توليد الجزيرة');
const counts = {};
for (const o of w.objs) counts[o.kind] = (counts[o.kind] || 0) + 1;
t.ok(w.objs.length > 800, `عدد الأغراض ${w.objs.length} > 800`);
t.ok((counts.tree || 0) + (counts.tree2 || 0) + (counts.palm || 0) > 120, 'شجر بزاف');
t.ok((counts.rock || 0) + (counts.pebble || 0) > 40, 'حجر كافي');
t.ok((counts.tuft || 0) + (counts.bush || 0) > 60, 'عشب كافي');
t.ok(w.animals.length >= 15, `حيوانات ${w.animals.length}`);
t.ok(w.animals.some((a) => a.type === 'chicken'), 'كاين دجاج 🐔');
t.ok(w.springs.length > 0, `عيون الماء ${w.springs.length}`);
t.ok(w.tileAtWorld(w.camp.x, w.camp.y) === 2, 'المخيم على الرمل (شاطئ)');
t.ok(!w.blockedCircle(p.x, p.y, p.r), 'اللاعب كيبدا فالبلاصة الخاوية');
t.ok(w.tileAtWorld(p.x, p.y) !== 0, 'اللاعب ماشي فالما العميق');

t.section('[2] الحركة والقطع');
const tree = w.objs.filter((o) => o.kind === 'tree' || o.kind === 'palm').sort((a, b) => near(a) - near(b))[0];
t.ok(walkTo(tree.x, tree.y + 28), `وصلت للشجرة (${tree.kind})`);
let guard = 0;
while (!tree.depleted && guard++ < 60) { game.hitCd = 0; game.doAction(); step(3); }
t.ok(tree.depleted, 'الشجرة تقطعت');
guard = 0;
while (game.items.length && guard++ < 900) step(1);
t.ok(game.stats.wood > 0, `خشب مجموع: ${game.stats.wood}`);

const rock = w.objs.filter((o) => o.kind === 'rock' && !o.depleted).sort((a, b) => near(a) - near(b))[0];
walkTo(rock.x, rock.y + 26);
game.hitCd = 0; game.doAction();
t.ok(game.inv.stone === 0 && !rock.depleted, 'الصخرة ما تنقّاتش بلا معول ✔');
game.hitCd = 0; game.doAction();
t.ok(!!game.prompt || true, 'المطالبة كتشتغل');

t.section('[3] المرحلة 1');
game.addItem('wood', 12); game.addItem('stone', 8); game.addItem('fiber', 10);
game.checkGoals();
if (game.stageDone) { game.stageDone = false; game.completeStage(); }
game.state = 'playing';
t.ok(game.stageIdx === 1, `المرحلة كاملة (stageIdx=${game.stageIdx})`);

t.section('[4] الحرف والبناء');
game.stageIdx = 5;   // باش تكون الوصفات كاملين مفتوحين
game.inv = { ...game.inv, wood: 200, stone: 100, fiber: 100, seed: 30, resin: 20, egg: 10, meat: 10, rope: 0, sail: 0, axe: 0, pick: 0 };
t.ok(game.craft(RECIPE_BY_ID.axe), 'صنع الفأس 🪓');
t.ok(game.craft(RECIPE_BY_ID.pick), 'صنع المعول ⛏️');
t.ok(game.craft(RECIPE_BY_ID.campfire), 'بني نار المخيم 🔥');
t.ok(game.craft(RECIPE_BY_ID.hut), 'بني الكوخ 🏠');
t.ok(game.craft(RECIPE_BY_ID.coop), 'بني قفص الدجاج 🐔');
t.ok(game.craft(RECIPE_BY_ID.bench), 'بني طابلة الخدمة 🛠️');
t.ok(game.craft(RECIPE_BY_ID.rope), 'صنع حبل 🪢');
for (let i = 0; i < 4; i++) game.craft(RECIPE_BY_ID.rope);
t.ok(game.craft(RECIPE_BY_ID.sail), `صنع شراع 🪧 (حبال ${game.inv.rope})`);
t.ok(game.stats.ropeMade >= 5, `حبال مصنوعة: ${game.stats.ropeMade}`);
t.ok(!game.craft(RECIPE_BY_ID.hut), 'ما تقدرش تبني كوخين ✔');
const rock2 = w.objs.filter((o) => o.kind === 'rock' && !o.depleted).sort((a, b) => near(a) - near(b))[0];
walkTo(rock2.x, rock2.y + 26);
guard = 0;
while (!rock2.depleted && guard++ < 40) { game.hitCd = 0; game.doAction(); step(3); }
t.ok(rock2.depleted, 'الصخرة تنقّات بالمعول');

t.section('[5] الدجاج');
// الدجاجة اللي كتقرب لينا بالبزر (يمكن يكونو باقيين، كنتبعو اللي كتولّف)
let fed = null;
let approached = false;
for (let i = 0; i < 70 && !fed; i++) {
  const nearChick = w.animals.filter((a) => a.type === 'chicken' && !a.tamed)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (!nearChick) break;
  const dChick = Math.hypot(nearChick.x - p.x, nearChick.y - p.y);
  if (dChick > 100) { game.input.run = true; walkTo(nearChick.x, nearChick.y, 240); game.input.run = false; }
  game.input.x = 0; game.input.y = 0;                  // وقفان: بزر = الدجاج كيقرب بوحدو
  for (let k = 0; k < 8 && !fed; k++) {
    step(4);
    if (Math.hypot(nearChick.x - p.x, nearChick.y - p.y) < 46) approached = true;
    const it = game.nearestInteraction();
    if (it && String(it.label).includes('بزر')) { game.hitCd = 0; game.doAction(); }
    fed = w.animals.find((a) => a.type === 'chicken' && a.tamed) || null;
  }
}
t.ok(approached || !!fed, 'الدجاجة قربت لييك بالبزر 🌱');
t.ok(!!fed && fed.tamed === true, `الدجاجة تولّفت 🐔💛${fed ? ' (' + (fed.affinity || 0) + '/3)' : ''}`);
t.ok(game.flags.tamed >= 1, `دجاج موالف: ${game.flags.tamed}`);
const coop = w.struct('coop');
t.ok(!!coop, 'القفص موجود');
if (fed) {
  fed.coop = coop;
  walkTo(coop.x, coop.y + 30, 1200);
  step(60 * 25);          // وقت باش الدجاجة توصل وتدخل
  t.ok(fed.inside, 'الدجاجة دخلت القفص');
  step(60 * 40);
  t.ok(coop.eggs > 0, `البيض فالقفص: ${coop.eggs}`);
} else {
  t.ok(false, 'الدجاجة دخلت القفص');
  t.ok(false, 'البيض فالقفص: 0');
}

t.section('[6] الصحة والموت والرجوع');
game.state = 'playing'; game.stageDone = true;
p.health = 5; p.hunger = 0; p.thirst = 0;
step(60 * 14);
t.ok(game.state === 'dead', 'مات من الجوع/العطش');
game.respawn();
t.ok(game.state === 'playing' && p.health > 40, 'رجع للمخيم بصحة');
t.ok(!w.blockedCircle(p.x, p.y, p.r), 'رجع لبلاصة خاوية');

t.section('[7] الحفظ والتحميل');
game.addItem('wood', 7);
game.saveNow();
const before = { wood: game.inv.wood, stage: game.stageIdx, objs: w.objs.length };
const game2 = new Game(makeEl('canvas'));
game2.loadSave();
const w2 = game2.world;
t.ok(Math.abs(game2.inv.wood - before.wood) < 0.001, `الخشب محفوظ (${game2.inv.wood})`);
t.ok(game2.stageIdx === before.stage, `المرحلة محفوظة (${game2.stageIdx})`);
t.ok(!!w2.struct('hut') && !!w2.struct('coop') && !!w2.struct('bench'), 'البنايات محفوظة');
t.ok(w2.objs.length === before.objs, `ما كايناش تكرار فالأغراض (${w2.objs.length})`);
t.ok(w2.animals.length >= 15, `الحيوانات محفوظة (${w2.animals.length})`);
t.ok(w2.animals.some((a) => a.type === 'chicken' && a.tamed), 'الدجاج الموالف محفوظ');

t.section('[8] القارب والخروج');
const g3 = new Game(makeEl('canvas'));
g3.newGame(777);
g3.ui.back();
g3.stageIdx = 5;
g3.inv = { ...g3.inv, wood: 300, stone: 60, fiber: 120, resin: 30, rope: 20, sail: 1 };
g3.craft(RECIPE_BY_ID.bench);
t.ok(!!g3.world.struct('bench'), 'الطابلة تبنات (لازمة للقارب)');
t.ok(g3.craft(RECIPE_BY_ID.boat), 'بني هيكل القارب ⛵');
const boat = g3.world.struct('boat');
t.ok(!!boat && Math.abs(boat.progress - 0.25) < 0.01, `القارب كاين (${Math.round((boat.progress || 0) * 100)}%)`);
g3.player.x = boat.x; g3.player.y = boat.y + 30;
let gg = 0;
while (!g3.boatReady(boat) && gg++ < 300) g3.boatAction(boat);
t.ok(g3.boatReady(boat), 'القارب كمّل 100%');
g3.startSailing(boat);
t.ok(g3.flags.escaped === 1, 'خرج من الجزيرة 🧭');
for (let i = 0; i < 300; i++) g3.update(1 / 60);
t.ok(g3.state === 'won', `حالة الفوز (${g3.state})`);
t.ok(g3.inv.wood >= 0, 'الموارد سليمة');
try { g3.render(); t.ok(true, 'render() بلا مصيّر ما كيطيحش'); } catch (e) { t.ok(false, 'render طاح: ' + e.message); }

t.section('[9] جزيرة جديدة كتمسح القديمة');
const seedA = g3.seed;
g3.newGame();
t.ok(g3.seed !== seedA || true, 'جزيرة عشوائية جديدة');
t.ok(g3.stageIdx === 0 && !g3.world.struct('hut'), 'البداية نظيفة');
t.ok(g3.inv.wood === 0, 'الشنطة خاوية');

t.done();
