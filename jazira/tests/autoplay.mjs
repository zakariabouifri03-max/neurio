// لاعب آلي كيكمّل اللعبة من الأول للآخر — node tests/autoplay.mjs [seed] [3d] — autoplay.mjs
import { installStubs, ROOT, makeEl } from './stub.mjs';
installStubs();

const args = process.argv.slice(2);
const SEED = Number(args.find((a) => /^\d+$/.test(a)) || 20240928);
const USE_3D = args.includes('3d');

const { Game } = await import(ROOT + 'game.js');
const { RECIPE_BY_ID } = await import(ROOT + 'data.js');

let view = null;
if (USE_3D) {
  const { View3D } = await import(ROOT + 'view3d.js');
  view = new View3D({ shadows: false, autoAttach: false });
}

const g = new Game(makeEl('canvas'), view);
g.newGame(SEED);
g.ui.back();
if (view) view.buildScene(g);
const p = g.player, w = g.world;
const log = [];
let frames = 0, stuckCount = 0, lastX = p.x, lastY = p.y, jitterT = 0, jx = 0, jy = 0;

const CHAIN = ['axe', 'pick', 'campfire', 'hut', 'coop', 'bench', 'sail', 'boat'];
const RES_FOR = {
  wood: ['tree', 'palm', 'tree2'], stone: ['rock', 'pebble'], fiber: ['bush', 'tuft', 'reeds', 'flower'],
  seed: ['tuft', 'bush'], meat: ['goat'], coconut: ['palm'], resin: ['tree', 'tree2', 'palm'],
  rope: ['bush', 'tuft', 'reeds'], sail: ['bush', 'tuft', 'reeds'],
};

let resCache = {}, cacheAge = 999;
function rebuild() { resCache = {}; for (const o of w.objs) { if (!o.depleted) (resCache[o.kind] ||= []).push(o); } cacheAge = 0; }
function nearestRes(kind) {
  if (cacheAge > 30) rebuild();
  const kinds = RES_FOR[kind] || [kind];
  let best = null, bd = 1e9;
  for (const k of kinds) {
    if (k === 'rock' && !g.inv.pick) continue;
    for (const o of resCache[k] || []) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
  }
  return best;
}
function missingFor(id) {
  const r = RECIPE_BY_ID[id];
  if (!r) return {};
  const out = {};
  for (const k in r.cost) { const lack = r.cost[k] - (g.inv[k] || 0); if (lack > 0) out[k] = lack; }
  return out;
}
function recipePlan(id) {
  const r = RECIPE_BY_ID[id];
  if (!r) return null;
  if (r.build && w.struct(r.build)) return null;
  if (r.once && g.crafted[id]) return null;
  if (!g.isUnlocked(r)) return null;
  if (r.needFire && !w.struct('campfire')) return null;
  if (r.needBench && !w.struct('bench')) return null;
  if (g.canCraft(r)) return { type: 'craft', id };
  const keys = Object.keys(missingFor(id));
  if (!keys.length) return null;
  const k = keys[0];
  if (k === 'rope') return { type: 'craft', id: 'rope' };
  if (k === 'sail') return { type: 'craft', id: 'sail' };
  if (RES_FOR[k]) return { type: 'gather', kind: k };
  return { type: 'gather', kind: 'wood' };
}
function boatPlan() {
  const boat = w.struct('boat');
  if (!boat) return null;
  if ((boat.progress ?? 0) >= 1) return { type: 'board', boat };
  const need = boat.needs.find((n) => (n.got || 0) < n.n);
  if (!need) return { type: 'boat', boat };
  const want = Math.min(need.n - (need.got || 0), 10);
  if ((g.inv[need.k] || 0) < want) {
    const rp = recipePlan(need.k);
    if (rp) return rp;
  }
  return { type: 'boat', boat };
}
function chickenPlan() {
  const coop = w.struct('coop');
  if (coop && coop.eggs > 0) return { type: 'coop', coop };
  const chick = w.animals.filter((x) => x.type === 'chicken' && !x.tamed)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (chick) {
    if (g.inv.seed < 1) return { type: 'gather', kind: 'seed' };
    return { type: 'chicken', chick };
  }
  const tamed = w.animals.filter((x) => x.type === 'chicken' && x.tamed && !x.inside);
  if (tamed.length && coop) return { type: 'chicken', chick: tamed[0] };
  return null;
}

function decide() {
  // نجاة
  if (g.player.thirst < 45 && w.springs.length) {
    const sp = w.springs.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b));
    return { type: 'drink', sp };
  }
  if (g.player.hunger < 60) {
    for (const k of ['cooked', 'omelette', 'coconut', 'egg', 'meat']) if (g.inv[k] > 0) return { type: 'eat', k };
    if (g.player.hunger < 40) { const food = nearestRes('coconut'); if (food) return { type: 'gather', kind: 'coconut' }; }
  }
  const boar = w.animals.find((a) => a.type === 'boar' && a.state === 'chase' && Math.hypot(a.x - p.x, a.y - p.y) < 90);
  if (boar && g.player.health > 35) return { type: 'fight', boar };
  const hour = (g.world.time / 60) % 24;
  if (hour >= 19.5 || hour < 6) {
    const hut = w.struct('hut');
    if (hut) return { type: 'sleep', hut };
    const fire = w.struct('campfire');
    if (fire && !g.nearFire(p.x, p.y)) return { type: 'warm', fire };
  }
  if (g.inv.wood < 4) return { type: 'gather', kind: 'wood' };
  if (g.inv.fiber < 4 && g.stageIdx >= 3) return { type: 'gather', kind: 'fiber' };

  // أهداف المرحلة
  const s = g.stage;
  if (s) for (const goal of s.goals) {
    if (g.goalValue(goal) >= goal.need) continue;
    if (goal.t === 'stat') {
      if (goal.k === 'eggs') { const cp = chickenPlan(); if (cp) return cp; }
      else if (goal.k === 'meals') {
        const fire = w.struct('campfire');
        if (fire && (g.inv.meat >= 2 || g.inv.egg >= 2) && g.inv.wood >= 1) return { type: 'cook', fire };
        const goat = nearestRes('goat');
        if (goat) return { type: 'hunt', goat, animal: 'goat' };
      } else if (RES_FOR[goal.k]) return { type: 'gather', kind: goal.k };
      continue;
    }
    if (goal.t === 'crafted' || goal.t === 'built') { const rp = recipePlan(goal.k); if (rp) return rp; }
    if (goal.t === 'flag') {
      if (goal.k === 'tamed') { const cp = chickenPlan(); if (cp) return cp; }
      if (goal.k === 'drink') return { type: 'drink', sp: w.springs[0] };
      if (goal.k === 'escaped') { const bp = boatPlan(); if (bp) return bp; }
    }
  }
  for (const id of CHAIN) { const rp = recipePlan(id); if (rp) return rp; }
  const bp = boatPlan(); if (bp) return bp;
  const cp = chickenPlan(); if (cp) return cp;
  return null;
}

function tick() {
  g.update(1 / 60);
  if (view) view.updateScene(g, 1 / 60);
  frames++;
  cacheAge++;
  if (frames % 20 === 0) {
    const moved = Math.hypot(p.x - lastX, p.y - lastY);
    if (moved < 6 && jitterT <= 0) { stuckCount++; jitterT = 45; const a = Math.random() * Math.PI * 2; jx = Math.cos(a); jy = Math.sin(a); }
    lastX = p.x; lastY = p.y;
  }
  if (g.stageDone) { g.stageDone = false; g.completeStage(); log.push(`🏁 المرحلة ${g.stageIdx + 1}: ${g.stage ? g.stage.name : '—'} — ${fmt(frames)}`); }
  if (g.state !== 'playing') {
    if (['stage', 'tut', 'crafting', 'inventory', 'help', 'paused'].includes(g.state)) { g.ui.hideAll(); g.state = 'playing'; }
    else if (g.state === 'dead') { log.push(`💀 مات ف ${fmt(frames)} — نهار ${g.day}`); g.respawn(); }
  }
}
const fmt = (f) => { const s = f / 60; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

// فـ3D الحركة بالنسبة للكاميرا — كنحوّلو الاتجاه المطلوب لمدخلات
function toInput(dx, dy) {
  if (!view) return { x: dx, y: dy };
  view.camYaw = 0;
  view.manualT = 1e9;               // ما نخليوش الكاميرا تدور بوحدها
  const f = view.transformInput(0, -1), r = view.transformInput(1, 0);
  return { x: dx * r.x + dy * r.y, y: -(dx * f.x + dy * f.y) };
}
function setInput(dx, dy) {
  const v = toInput(dx, dy);
  g.input.x = v.x; g.input.y = v.y;
}

function walkToward(tx, ty, maxFrames = 300) {
  for (let i = 0; i < maxFrames; i++) {
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d < 22) return true;
    if (jitterT <= 0 && Math.random() < 0.5) {
      const ux = (tx - p.x) / (d || 1), uy = (ty - p.y) / (d || 1);
      if (!w.walkableAt(p.x + ux * 26, p.y + uy * 26, p.r)) {
        const ang = (Math.random() < 0.5 ? 1 : -1) * 1.1;
        const c = Math.cos(ang), sn = Math.sin(ang);
        setInput(ux * c - uy * sn, ux * sn + uy * c);
        tick(); continue;
      }
    }
    let ux = (tx - p.x) / (d || 1), uy = (ty - p.y) / (d || 1);
    if (jitterT > 0) { jitterT--; ux = jx; uy = jy; }
    setInput(ux, uy);
    tick();
    if (g.state !== 'playing' && g.state !== 'menu') return false;
  }
  return false;
}
function goToAndAct(tx, ty, reach = 34) {
  if (Math.hypot(tx - p.x, ty - p.y) > reach) { walkToward(tx, ty, 320); return false; }
  g.doAction();
  for (let i = 0; i < 6; i++) tick();
  return true;
}

const MAX = 60 * 60 * 40;
const TIME_LIMIT = Number(process.env.AUTOPLAY_MS || 180000);
const T0 = Date.now();
while (frames < MAX) {
  if (Date.now() - T0 > TIME_LIMIT) { log.push('⏱️ توقفنا على الوقت'); break; }
  const plan = decide();
  if (!plan) { tick(); continue; }

  switch (plan.type) {
    case 'craft': {
      const r = RECIPE_BY_ID[plan.id];
      if (g.canCraft(r)) { g.craft(r); log.push(`🔨 ${r.name} — ${fmt(frames)}`); }
      tick(); break;
    }
    case 'gather': { const tg = nearestRes(plan.kind); if (!tg) { tick(); break; } goToAndAct(tg.x, tg.y + 6, 36); break; }
    case 'hunt': {
      const a = plan.goat;
      if (Math.hypot(a.x - p.x, a.y - p.y) > 34) walkToward(a.x, a.y + 4, 200);
      else { g.doAction(); tick(); }
      break;
    }
    case 'cook': { const f = plan.fire; goToAndAct(f.x, f.y + 26, 44); break; }
    case 'fight': { const a = plan.boar; if (Math.hypot(a.x - p.x, a.y - p.y) > 30) walkToward(a.x, a.y, 120); g.doAction(); tick(); break; }
    case 'drink': { goToAndAct(plan.sp.x, plan.sp.y, 30); break; }
    case 'eat': { g.useItem(plan.k); tick(); break; }
    case 'sleep': { goToAndAct(plan.hut.x, plan.hut.y + 20, 44); break; }
    case 'warm': {
      const f = plan.fire;
      if (Math.hypot(f.x - p.x, f.y - p.y) > 70) walkToward(f.x, f.y + 30, 320); else tick();
      break;
    }
    case 'coop': { goToAndAct(plan.coop.x, plan.coop.y + 24, 44); break; }
    case 'chicken': {
      const a = plan.chick;
      if (a.tamed) {
        const coop = w.struct('coop');
        if (coop && Math.hypot(coop.x - p.x, (coop.y + 30) - p.y) > 26) walkToward(coop.x, coop.y + 30, 320);
        else tick();
      } else {
        // الآلية الجديدة: إلا وقفت وعندك بزر، الدجاجة كتقرب بوحدها
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        const it = g.nearestInteraction();
        if (it && String(it.label).includes('بزر') && d < 52) { g.doAction(); tick(); }
        else if (d > 95) { g.input.run = true; walkToward(a.x, a.y + 4, 200); g.input.run = false; }
        else { g.input.x = 0; g.input.y = 0; tick(); }     // وقفان باش تجي الدجاجة
      }
      break;
    }
    case 'boat': { goToAndAct(plan.boat.x, plan.boat.y + 22, 46); break; }
    case 'board': {
      const b = plan.boat;
      if (Math.hypot(b.x - p.x, b.y - p.y) > 46) walkToward(b.x, b.y + 22, 320);
      else { g.doAction(); tick(); }
      break;
    }
    default: tick();
  }
  if (frames % (60 * 60) === 0) log.push(`   ⏳ ${fmt(frames)} نهار ${g.day} · صحة ${g.player.health.toFixed(0)} · خشب ${g.stats.wood} حجر ${g.stats.stone} ألياف ${g.stats.fiber} بيض ${g.stats.eggs} دجاج ${g.flags.tamed} · مرحلة ${g.stageIdx + 1}`);
  if (g.flags.escaped) { log.push(`⛵ خرج من الجزيرة ف ${fmt(frames)}`); break; }
}

console.log(`🎮 لاعب آلي — بذرة ${SEED}${USE_3D ? ' — 3D' : ''}`);
console.log(log.slice(-14).join('\n'));
console.log('\n=== النتيجة ===');
console.log('الحالة:', g.state, '| مرحلة:', g.stageIdx + 1, '| وقت اللعب:', fmt(frames), '| نهار:', g.day);
console.log('إحصائيات:', JSON.stringify(g.stats), JSON.stringify(g.flags));
console.log('مبني:', JSON.stringify(g.built), '| مصنوع:', Object.keys(g.crafted).join(','));
console.log('مرات الموت:', g.deathCount, '| مرات التعليق:', stuckCount, '| 3D:', !!view);
process.exit(g.flags.escaped ? 0 : 1);
