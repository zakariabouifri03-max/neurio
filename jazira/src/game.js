// المنطق الرئيسي — game.js
import { World, KIND_DEF, TILE, T, WALKABLE } from './world.js';
import { Player, updateAnimals, hourOf } from './entities.js';
import { ITEMS, STRUCTURES, RECIPE_BY_ID, STAGES } from './data.js';
import { Audio } from './audio.js';
import { clamp, dist, TAU, clockText, nightAmount, smoothstep, makeRng } from './util.js';
import { UI } from './ui.js';

const SAVE_KEY = 'jazira_save_v1';
const MIN_PER_SEC = 4.6;            // سرعة الوقت: 24 ساعة = ~5 دقايق حقيقية

export class Game {
  constructor(canvas, view = null) {
    this.canvas = canvas;
    this.view = view;
    this.ctx = null;
    this.audio = new Audio();
    this.input = { x: 0, y: 0, run: false };
    this.state = 'menu';
    this.time = 0;
    this.acc = 0;
    this.zoom = 1;
    this.cam = { x: 0, y: 0 };
    this.fx = new Fx(this);
    this.items = [];
    this.tool = null;
    this.hitCd = 0;
    this.prompt = null;
    this.actionEdge = false;
    this.ui = new UI(this);
    this.ui.build();
    if (view) {
      if (view.attach && view.autoAttach !== false) view.attach(canvas, this);
      if (view.init) view.init(this, canvas);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    this.lastT = performance.now();
    this.saveTimer = 0;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ---------------- الإعداد ----------------
  resize() {
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.zoom = clamp(Math.min(this.W / 780, this.H / 680), 0.85, 1.6);
    if (this.view && this.view.resize) this.view.resize(this);
  }

  // تبديل بين 2D و 3D
  setView(view) {
    this.view = view;
    if (view.init) view.init(this, this.canvas);
    if (this.world && view.onWorld) view.onWorld(this);
    this.resize();
  }

  // شنو خاص المشهد يتعاود يتولد (جزيرة جديدة)
  refreshWorld() { if (this.view && this.view.onWorld) this.view.onWorld(this); }

  bindInput() {
    const keys = {};
    const setFromKeys = () => {
      let x = 0, y = 0;
      if (keys['a'] || keys['arrowleft']) x -= 1;
      if (keys['d'] || keys['arrowright']) x += 1;
      if (keys['w'] || keys['arrowup']) y -= 1;
      if (keys['s'] || keys['arrowdown']) y += 1;
      this.input.x = x; this.input.y = y;
      this.input.run = !!(keys['shift']);
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (keys[k]) return;
      keys[k] = true;
      this.audio.resume();
      if (k === ' ' || k === 'e') this.doAction();
      if (k === 'c') this.ui.toggle('crafting');
      if (k === 'i' || k === 'b') this.ui.toggle('inventory');
      if (k === 'escape') this.ui.toggle('paused');
      if (k === 'h') this.ui.toggle('help');
      if (k === 'm') { this.audio.muted = !this.audio.muted; this.toast(this.audio.muted ? '🔇 الصوت مطفي' : '🔊 الصوت شاعل'); }
      setFromKeys();
    });
    window.addEventListener('keyup', (e) => {
      keys[e.key.toLowerCase()] = false;
      setFromKeys();
    });
    window.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
      setFromKeys();
    });
  }

  // ---------------- اللعبة ----------------
  newGame(seed) {
    this.seed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.world = new World(this.seed);
    const sp = this.world.spawnPoint();
    this.player = new Player(sp.x, sp.y);
    this.inv = { wood: 0, stone: 0, fiber: 0, seed: 0, coconut: 0, egg: 0, meat: 0, cooked: 0, omelette: 0, resin: 0, rope: 0, sail: 0, axe: 0, pick: 0 };
    this.stats = { wood: 0, stone: 0, fiber: 0, eggs: 0, resin: 0, meals: 0, ropeMade: 0, coconut: 0, meat: 0 };
    this.flags = { tamed: 0, drink: 0, escaped: 0 };
    this.crafted = {};
    this.built = {};
    this.stageIdx = 0;
    this.items = [];
    this.tool = null;
    this.world.time = 7 * 60 + 30;
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.fade = 1;
    this.deathCount = 0;
    this.state = 'playing';
    this.player.tool = this.tool;
    this.ui.buildMinimap(this.world);
    this.refreshWorld();
    this.ui.syncAll();
    this.toast(`🏝️ وصلتي لجزيرة جديدة! ${STAGES[0].name}`, 'good', 3600);
    this.ui.showTutorial();
  }

  // جزيرة كتخدم كخلفية للقائمة
  idleWorld() {
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.world = new World(this.seed);
    const sp = this.world.spawnPoint();
    this.player = new Player(sp.x, sp.y);
    this.inv = { wood: 0, stone: 0, fiber: 0, seed: 0, coconut: 0, egg: 0, meat: 0, cooked: 0, omelette: 0, resin: 0, rope: 0, sail: 0, axe: 0, pick: 0 };
    this.stats = { wood: 0, stone: 0, fiber: 0, eggs: 0, resin: 0, meals: 0, ropeMade: 0 };
    this.flags = { tamed: 0, drink: 0, escaped: 0 };
    this.crafted = {}; this.built = {}; this.stageIdx = 0; this.items = [];
    this.world.time = 8 * 60;
    this.cam.x = this.world.cx * TILE; this.cam.y = this.world.cy * TILE;
    this.state = 'menu';
    this.fade = 0;
    this.ui.buildMinimap(this.world);
    this.refreshWorld();
  }

  get stage() { return STAGES[this.stageIdx]; }

  // الاتجاه المطلوب (المصيّر 3D كيحوّلو بالنسبة للكاميرا)
  get moveDir() {
    let mx = this.input.x, my = this.input.y;
    if (this.view && this.view.transformInput) {
      const t = this.view.transformInput(mx, my);
      if (t) { mx = t.x; my = t.y; }
    }
    return { x: mx, y: my };
  }
  get day() { return Math.floor(this.world.time / 1440) + 1; }

  toast(msg, tone = '', ms = 2400) { this.ui.toast(msg, tone, ms); }

  // ---------- المدخلات ----------
  doAction() {
    if (this.state !== 'playing') return;
    const hit = this.nearestInteraction();
    if (hit) hit.run();
  }

  // ما كايناش حاجة قريبة → نضربو/نقطعو أقرب غرض طبيعي
  nearestInteraction() {
    const p = this.player, world = this.world;
    const cands = [];
    const push = (d, label, run, icon, obj) => cands.push({ d, label, run, icon, obj });

    // الأغراض
    const objs = world.objsNear(p.x, p.y, 70);
    for (const o of objs) {
      const def = KIND_DEF[o.kind];
      const d = dist(p.x, p.y, o.x, o.y) - def.r * 0.6;
      if (d > 46) continue;
      if (def.built) {
        if (o.kind === 'campfire') {
          const canCook = (this.inv.meat >= 2 && this.inv.wood >= 1) || (this.inv.egg >= 2 && this.inv.wood >= 1);
          push(d, canCook ? '🔥 طيّب ماكلة' : '🔥 نار المخيم (خاصك 2 لحم/بيض + خشب)', () => this.tryCook(), '🔥', o);
        } else if (o.kind === 'hut') {
          const night = nightAmount(hourOf(world.time)) > 0.5;
          push(d, night ? '🛏️ نعس حتى الصباح' : '🛏️ استراحة (ترجع الطاقة)', () => this.sleep(), '🛏️', o);
        } else if (o.kind === 'coop') {
          const n = o.eggs || 0;
          push(d + 10, n > 0 ? `🐔 خد البيض (${n})` : (this.inv.seed > 0 ? '🐔 عطي علف' : '🐔 قفص الدجاج'), () => this.coopAction(o), '🐔', o);
        } else if (o.kind === 'bench') {
          push(d, '🛠️ حل الوصفات', () => this.ui.open('crafting'), '🛠️', o);
        } else if (o.kind === 'boat') {
          push(d, this.boatReady(o) ? '⛵ اركب القارب!' : '⛵ سلّم مواد البناء', () => this.boatAction(o), '⛵', o);
        }
      } else if (o.depleted) {
        continue;
      } else {
        const label = this.hitLabel(o);
        if (label) push(d, label, () => this.hitObject(o), ITEMS[this.dropKind(o)]?.icon || '', o);
      }
    }

    // الماء العذب
    const t = world.tileAtWorld(p.x, p.y);
    const nearFresh = t === T.FRESH || world.objsNear(p.x, p.y, 40).some((o) => o.kind === 'spring');
    if (nearFresh) push(10, '💧 اشرب من العين', () => this.drink(), '💧', null);
    else if (t === T.SHALLOW && p.thirst < 75 && this.time % 6 < 1 / 60) {
      this.toast('🌊 الماء مالح! دور على عين 💧 داخل الجزيرة', 'bad', 2600);
    }

    // الحيوانات
    for (const a of world.animals) {
      const d = dist(p.x, p.y, a.x, a.y) - a.r;
      if (d > 46) continue;
      if (a.type === 'chicken') {
        if (a.tamed) continue;
        push(d - 16, this.inv.seed > 0 ? `🐔 عطي بزر (${a.affinity || 0}/3)` : '🐔 الدجاج خايف (خاصك بزر)', () => this.feedChicken(a), '🐔', a);
      } else if (a.type === 'goat') push(d, '🐐 اضرب العنزة', () => this.attackAnimal(a), '🐐');
      else if (a.type === 'boar') push(d, '🐗 اضرب الخنزير (خود بالك!)', () => this.attackAnimal(a), '🐗', a);
    }

    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    return cands[0];
  }

  dropKind(o) { return Object.keys(KIND_DEF[o.kind].drop || {})[0]; }

  hitLabel(o) {
    switch (o.kind) {
      case 'palm': return '🌴 قطع النخلة';
      case 'tree': case 'tree2': return '🪓 قطع الشجرة';
      case 'rock': return this.inv.pick ? '⛏️ بقّي الحجر' : '⛏️ خاصك معول';
      case 'bush': return '🌾 قطع الشجيرة';
      case 'tuft': return '🌾 خد البزر';
      case 'flower': return '🌸 قطع الزهرة';
      case 'pebble': return '🪨 خد الحجرة';
      case 'reeds': return '🌾 قطع القصب';
      default: return null;
    }
  }

  // ---------- القطع والجمع ----------
  hitObject(o) {
    const def = KIND_DEF[o.kind];
    const p = this.player;
    if (this.hitCd > 0) return;
    this.hitCd = 0.38;
    p.actAnim = 1;
    p.dir = Math.atan2(o.y - p.y, o.x - p.x);

    let dmg = 1, perMul = 1;
    const isWood = o.kind === 'palm' || o.kind === 'tree' || o.kind === 'tree2';
    const isRock = o.kind === 'rock';
    if (isWood && this.inv.axe) { dmg = 2; perMul = 2; }
    if (isRock && !this.inv.pick) {
      this.toast('⛏️ خاصك معول باش تبقّي الحجر — حل منو فالوصفات!', 'bad', 2000);
      this.audio.fail();
      return;
    }
    if (isRock && this.inv.pick) { dmg = 2; perMul = 2; }

    if (isWood) { this.audio.chop(); this.fx.woodChips(o.x, o.y - 32); this.fx.leafPuff(o.x, o.y - 70); }
    else if (isRock) { this.audio.rockHit(); this.fx.stoneChips(o.x, o.y - 20); }
    else { this.audio.gather(); this.fx.leafPuff(o.x, o.y - 14); }

    o.hp -= dmg;
    o.shakeT = 0.22;
    if (def.perHit) {
      for (const k in def.perHit) {
        let n = def.perHit[k] * perMul;
        if (k === 'wood' && o.kind === 'palm') n = def.perHit[k] * perMul;
        this.addItem(k, n, true);
      }
    }
    // راتنج من الشجر المعلّم
    if (isWood && o.resin && Math.random() < 0.55) {
      this.addItem('resin', 1, true);
      this.fx.sparkle(o.x, o.y - 44, '#f0b456');
    }
    if (o.hp <= 0) this.deplete(o);
  }

  deplete(o) {
    const def = KIND_DEF[o.kind];
    o.depleted = true;
    o.hp = 0;
    o.regrow = def.regrow ? def.regrow / 4 : 0;   // ⏱️ مخفّضة باش اللعبة تمشي بالزربة
    const R2 = Math.random;
    for (const k in def.drop || {}) {
      const [a, b] = def.drop[k];
      let n = Math.floor(a + R2() * (b - a + 1));
      if (k === 'wood' && this.inv.axe) n = Math.ceil(n * 1.6);
      if (k === 'stone' && this.inv.pick) n = Math.ceil(n * 1.5);
      this.spawnItems(k, n, o.x, o.y);
    }
    if (o.resin) { this.spawnItems('resin', 1 + (R2() < 0.4 ? 1 : 0), o.x, o.y); }
    this.fx.shake(3);
    this.audio.build();
    // جذوع باقية مكانها
    if (def.solid) o.stump = true;
  }

  spawnItems(kind, n, x, y) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = 8 + Math.random() * 26;
      this.items.push({ kind, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, t: 0, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18 });
    }
  }

  addItem(kind, n, silent) {
    this.inv[kind] = (this.inv[kind] || 0) + n;
    if (!this.stageDone) this._goalsDirty = true;
    if (this.stats[kind] !== undefined) this.stats[kind] += n;
    if (kind === 'egg') this.stats.eggs += n;
    if (!silent) this.audio.pickup();
    this.ui.syncInv();
    return true;
  }

  take(kind, n) {
    if ((this.inv[kind] || 0) < n) return false;
    this.inv[kind] -= n;
    this.ui.syncInv();
    return true;
  }

  // ---------- التفاعلات ----------
  drink() {
    const p = this.player;
    if (p.thirst > 97) { this.toast('💧 عطشان ماشي دابا', 'bad'); return; }
    p.thirst = clamp(p.thirst + 55, 0, 100);
    this.flags.drink = 1;
    this.audio.drink();
    this.fx.sparkle(p.x, p.y - 10, '#8fd8ff');
    this.toast('💧 ماء بارد وصافي!', 'good');
    this.checkGoals();
  }
  tryCook() {
    const inv = this.inv;
    if (inv.meat >= 2 && inv.wood >= 1) {
      this.take('meat', 2); this.take('wood', 1);
      this.addItem('cooked', 1, true);
      this.stats.meals++;
      this.audio.craft();
      this.fx.sparkle(this.player.x, this.player.y - 12, '#ffb347');
      this.toast('🍖 لحم مطهّي! بنين 😋', 'good');
      this.checkGoals();
    } else if (inv.egg >= 2 && inv.wood >= 1) {
      this.take('egg', 2); this.take('wood', 1);
      this.addItem('omelette', 1, true);
      this.stats.meals++;
      this.audio.craft();
      this.fx.sparkle(this.player.x, this.player.y - 12, '#ffd97a');
      this.toast('🍳 أومليت سخون!', 'good');
      this.checkGoals();
    } else this.toast('🔥 خاصك 2 لحم ولا 2 بيض + خشب', 'bad');
  }
  sleep() {
    const p = this.player, w = this.world;
    const hour = hourOf(w.time);
    const night = nightAmount(hour) > 0.5;
    this.fade = 1;
    if (night) {
      const target = (Math.floor(w.time / 1440) + (hour >= 20 ? 1 : 0)) * 1440 + 6 * 60;
      w.time = target;
      p.health = clamp(p.health + 45, 0, 100);
      p.hunger = clamp(p.hunger + 25, 0, 100);
      p.thirst = clamp(p.thirst + 22, 0, 100);
      p.stamina = 100;
      this.audio.craft();
      this.toast('☀️ صباح الخير! نعستي مليح', 'good', 3000);
    } else {
      w.time += 90;
      p.stamina = 100;
      p.health = clamp(p.health + 6, 0, 100);
      this.toast('😌 استراحتي شوية', 'good');
    }
  }
  coopAction(o) {
    if (o.eggs > 0) {
      const n = o.eggs;
      o.eggs = 0;
      this.addItem('egg', n);
      this.toast(`🥚 جمعتي ${n} بيض!`, 'good');
      this.fx.sparkle(o.x, o.y - 10, '#fff3c4');
      this.checkGoals();
      return;
    }
    if (this.inv.seed > 0) {
      this.take('seed', 1);
      o.feed = (o.feed || 0) + 1;
      this.audio.cluck();
      this.fx.sparkle(o.x, o.y - 20, '#d9e26a');
      this.toast('🌱 علفتي الدجاج — غادي يبيضو بزربة', 'good');
      return;
    }
    const inside = this.world.animals.filter((a) => a.coop === o && a.inside).length;
    this.toast(`🐔 ${inside} دجاجة داخل · ${o.eggs} بيض`, '');
  }
  feedChicken(a) {
    if (this.inv.seed < 1) { this.toast('🌱 خاصك بزر — خدو من العشب', 'bad'); return; }
    this.take('seed', 1);
    a.affinity = (a.affinity || 0) + 1;
    a.state = 'follow';
    this.audio.cluck();
    this.fx.heart(a.x, a.y - 22);
    if (a.affinity >= 3 && !a.tamed) {
      a.tamed = true;
      const coop = this.world.struct('coop');
      a.coop = coop || null;
      this.flags.tamed++;
      this.audio.tame();
      this.fx.sparkle(a.x, a.y - 20, '#ffd1e0');
      this.toast('🐔💛 الدجاجة ولّفت! غادي تتبعك', 'good', 3000);
      if (coop) this.toast('🐔 دوّزها للقفص باش تبيض', '');
      this.checkGoals();
    } else {
      this.toast(`🌱 الدجاجة قربت ليك (${a.affinity}/3)`, '');
    }
  }
  attackAnimal(a) {
    if (this.hitCd > 0) return;
    this.hitCd = 0.4;
    this.player.actAnim = 1;
    a.hp -= 1;
    a.state = a.type === 'boar' && a.hp > 2 ? 'angry' : 'flee';
    a.fleeT = 1.2;
    this.audio.grunt();
    this.fx.blood(a.x, a.y - 12);
    if (a.type === 'boar') a.dir = Math.atan2(this.player.y - a.y, this.player.x - a.x);
    if (a.hp <= 0) {
      const n = a.type === 'goat' ? 2 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 2);
      this.spawnItems('meat', n, a.x, a.y);
      this.world.removeAnimal(a);
      this.audio.pop();
      this.toast(`🥩 ${n} لحم! طيّبو فوق النار`, 'good');
      this.checkGoals();
    } else this.toast('💢 ضربتي! عاود', '');
  }
  boatReady(o) { return (o.progress ?? 0) >= 0.999; }

  boatAction(o) {
    if (this.boatReady(o)) { this.startSailing(o); return; }
    const need = (o.needs || []).find((n) => (n.got || 0) < n.n);
    if (!need) { o.progress = 1; return; }
    const have = this.inv[need.k] || 0;
    if (have < 1) {
      this.toast(`⛵ خاصك ${ITEMS[need.k].icon} ${ITEMS[need.k].name} (باقي ${need.n - (need.got || 0)})`, 'bad', 2200);
      return;
    }
    const give = Math.min(have, need.n - (need.got || 0), 10);
    this.take(need.k, give);
    need.got = (need.got || 0) + give;
    this.audio.build();
    this.fx.woodChips(o.x, o.y - 20);
    const total = o.needs.reduce((s, n) => s + n.n, 0);
    const done = o.needs.reduce((s, n) => s + (n.got || 0), 0);
    o.progress = 0.25 + 0.75 * (done / total);
    this.toast(`🔨 ${ITEMS[need.k].icon} ${ITEMS[need.k].name}: ${need.got}/${need.n}`, 'good');
    if (done >= total) {
      o.progress = 1;
      this.toast('⛵🎉 القارب واجد! اركب فيه ودير البحر', 'good', 4000);
      this.audio.win();
    }
  }

  startSailing(o) {
    this.state = 'sailing';
    this.sailing = { t: 0, ang: Math.atan2(o.y - this.world.cy * TILE, o.x - this.world.cx * TILE), boat: o };
    this.flags.escaped = 1;
    this.audio.win();
    this.toast('⛵ وداعاً الجزيرة! دخلتي للبحر…', 'good', 4000);
    this.checkGoals(true);
  }

  // ---------- الحرف ----------
  isUnlocked(r) { return r.stage <= this.stage.n; }
  canCraft(r) {
    if (!this.isUnlocked(r)) return false;
    if (r.once && this.crafted[r.id]) return false;
    if (r.needFire && !this.world.struct('campfire')) return false;
    if (r.needBench && !this.world.struct('bench')) return false;
    for (const k in r.cost) if ((this.inv[k] || 0) < r.cost[k]) return false;
    return true;
  }
  craft(r) {
    if (r.cat === 'build' && r.build && this.world.struct(r.build)) {
      this.toast('✅ عندك واحد من قبل', 'bad');
      return false;
    }
    if (r.build === 'boat' && this.world.struct('boat')) {
      this.toast('⛵ القارب كاين — كمّلو بالمواد', 'bad');
      return false;
    }
    if (!this.canCraft(r)) {
      this.audio.fail();
      const missing = [];
      for (const k in r.cost) {
        const have = this.inv[k] || 0;
        if (have < r.cost[k]) missing.push(`${ITEMS[k].icon}${r.cost[k] - have}`);
      }
      if (missing.length) this.toast('خاصك: ' + missing.join(' '), 'bad');
      else if (r.needFire && !this.world.struct('campfire')) this.toast('🔥 خاصك نار المخيم', 'bad');
      else if (r.needBench && !this.world.struct('bench')) this.toast('🛠️ خاصك طابلة الخدمة', 'bad');
      else this.toast('ما زال ما تفتحاش هاد الوصفة', 'bad');
      return false;
    }
    for (const k in r.cost) this.take(k, r.cost[k]);

    if (r.cat === 'build') {
      const placed = this.placeStructure(r.build);
      if (!placed) {
        for (const k in r.cost) this.addItem(k, r.cost[k], true);
        this.toast('ما لقيتش بلاصة خاوية — دوز شوية وعاود', 'bad');
        return false;
      }
      this.built[r.build] = (this.built[r.build] || 0) + 1;
      this.audio.build();
      this.toast(`✅ بني: ${STRUCTURES[r.build].icon} ${STRUCTURES[r.build].name}`, 'good', 2600);
    } else {
      for (const k in r.out) this.addItem(k, r.out[k], true);
      this.audio.craft();
      this.toast(`🔨 صنعتي: ${r.icon} ${r.name}`, 'good', 2600);
      if (r.out.rope) this.stats.ropeMade += r.out.rope;
    }
    this.crafted[r.id] = (this.crafted[r.id] || 0) + 1;
    if (this.inv.axe || this.inv.pick) this.tool = this.inv.axe ? 'axe' : 'pick';
    this.player.tool = this.tool;
    this.ui.syncAll();
    this.checkGoals();
    return true;
  }

  placeStructure(kind) {
    const p = this.player, w = this.world;
    const R0 = 46 + KIND_DEF[kind].r;
    if (kind === 'boat') {
      // القارب فالبلاصة ديال الإبحار
      const spots = [[w.launch.x, w.launch.y + 26], [w.launch.x, w.launch.y], [w.camp.x + 40, w.camp.y + 20]];
      for (const [x, y] of spots) {
        if (w.isLand(x, y) && !w.blockedCircle(x, y, 26)) return this.addBuilt(kind, x, y);
      }
      return this.addBuilt(kind, w.launch.x, w.launch.y + 26);
    }
    for (let ring = 0; ring < 6; ring++) {
      const rad = R0 + ring * 18;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + ring * 0.4;
        const x = p.x + Math.cos(a) * rad, y = p.y + Math.sin(a) * rad;
        if (x < 30 || y < 30 || x > w.worldW() - 30 || y > w.worldH() - 30) continue;
        if (!w.isLand(x, y) || w.blockedCircle(x, y, KIND_DEF[kind].r * 0.8 + 6)) continue;
        return this.addBuilt(kind, x, y);
      }
    }
    return null;
  }

  addBuilt(kind, x, y) {
    // ما نخليوش بناية تنزل فوق حيوان (كان كيعلقوه)
    const r = (KIND_DEF[kind].r || 20) + 8;
    for (const a of this.world.animals) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d < r + a.r) {
        const ux = d < 0.01 ? 1 : (a.x - x) / d, uy = d < 0.01 ? 0 : (a.y - y) / d;
        a.x = x + ux * (r + a.r + 2);
        a.y = y + uy * (r + a.r + 2);
        a.moveAcc = 0; a.bestD = undefined; a.lx = undefined;
      }
    }
    const o = this.world.addObj({ kind, x, y });
    if (kind === 'campfire') o.lit = true;
    if (kind === 'boat') {
      o.needs = [
        { k: 'wood', n: 24, got: 0 },
        { k: 'fiber', n: 12, got: 0 },
        { k: 'rope', n: 3, got: 0 },
        { k: 'sail', n: 1, got: 0 },
      ];
      o.progress = 0.25;
    }
    this.fx.sparkle(x, y - 20, '#ffe9a8');
    return o;
  }

  // ---------- الأكل ----------
  useItem(kind) {
    const it = ITEMS[kind];
    if (!it) return false;
    if (kind === 'axe' || kind === 'pick') { this.tool = kind; this.player.tool = kind; this.toast(`🖐️ ${it.icon} ${it.name} فال يد`, ''); return false; }
    if (kind === 'rope' || kind === 'sail' || kind === 'resin') { this.toast(`${it.icon} ${it.name} — ${it.desc}`, ''); return false; }
    if (!it.food) { this.toast(`${it.icon} ${it.name} — ماشي ماكلة`, ''); return false; }
    if (!this.take(kind, 1)) return false;
    const f = it.food;
    this.player.hunger = clamp(this.player.hunger + (f.hunger || 0), 0, 100);
    this.player.thirst = clamp(this.player.thirst + (f.thirst || 0), 0, 100);
    this.player.health = clamp(this.player.health + (f.health || 0), 0, 100);
    this.audio.eat();
    this.fx.sparkle(this.player.x, this.player.y - 14, '#ffd28a');
    this.toast(`${it.icon} ${kind === 'egg' && this.inv.egg > 0 ? 'خديتي واحدة' : it.name} — ${f.health < 0 ? 'ني… ثقيل على المعدة' : 'بنين!'}`, f.health < 0 ? 'bad' : 'good');
    this.ui.syncAll();
    return true;
  }

  // ---------- الحالة ----------------
  nearFire(x, y) { return this.world.structs('campfire').some((f) => dist(x, y, f.x, f.y) < 132); }
  inHut(x, y) { const h = this.world.struct('hut'); return h && dist(x, y, h.x, h.y) < 74; }

  checkGoals(silent) {
    if (this.state !== 'playing' && this.state !== 'sailing') return;
    const s = this.stage;
    if (!s) return;
    let done = true;
    for (const g of s.goals) if (this.goalValue(g) < g.need) done = false;
    if (done && !this.stageDone) {
      this.stageDone = true;
      if (s.n === 7 || this.flags.escaped) return;
      setTimeout(() => this.completeStage(), 500);
    }
  }
  goalValue(g) {
    if (g.t === 'stat') return this.stats[g.k] || 0;
    if (g.t === 'crafted') return this.crafted[g.k] || 0;
    if (g.t === 'built') return this.built[g.k] || 0;
    if (g.t === 'flag') return this.flags[g.k] || 0;
    return this.inv[g.k] || 0;
  }
  completeStage() {
    if (this.stageIdx >= STAGES.length - 1) return;
    this.stageIdx++;
    this.stageDone = false;
    this.audio.win();
    this.fx.shake(4);
    this.ui.showStageComplete();
    this.saveNow();
  }

  die() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathCount++;
    this.audio.hurt();
    this.ui.show('dead');
  }
  respawn() {
    const p = this.player, w = this.world;
    const sp = w.spawnPoint();
    p.x = sp.x; p.y = sp.y;
    p.health = 65; p.hunger = Math.max(p.hunger, 50); p.thirst = Math.max(p.thirst, 50);
    // نبعّدو الحيوانات المفترسة من المخيم
    for (const a of this.world.animals) {
      if (a.type !== 'boar') continue;
      a.state = 'wander';
      const dx = a.x - this.world.camp.x, dy = a.y - this.world.camp.y;
      const d = Math.hypot(dx, dy) || 1;
      a.x = this.world.camp.x + (dx / d) * 420;
      a.y = this.world.camp.y + (dy / d) * 420;
      a.home = { x: a.x, y: a.y };
    }
    p.vx = p.vy = 0;
    this.cam.x = p.x; this.cam.y = p.y;
    this.state = 'playing';
    this.fade = 1;
    this.ui.hideAll();
    this.toast('🏕️ رجعتي للمخيم — خود بالك من راسك', '');
  }

  // ---------- الحفظ ----------
  toJSON() {
    return {
      v: 1, seed: this.seed, world: this.world.toJSON(),
      player: { x: this.player.x, y: this.player.y, health: this.player.health, hunger: this.player.hunger, thirst: this.player.thirst },
      inv: this.inv, stats: this.stats, flags: this.flags, crafted: this.crafted, built: this.built,
      stageIdx: this.stageIdx, tool: this.tool, deaths: this.deathCount,
      items: this.items.map((i) => ({ kind: i.kind, x: i.x, y: i.y })),
    };
  }
  saveNow() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.toJSON())); } catch (e) { }
  }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  loadSave() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { }
    if (!d) { this.newGame(); return; }
    this.seed = d.seed;
    this.world = new World(d.seed, { load: d.world });
    this.player = new Player(d.player.x, d.player.y);
    this.player.health = d.player.health; this.player.hunger = d.player.hunger; this.player.thirst = d.player.thirst;
    this.inv = d.inv; this.stats = d.stats; this.flags = d.flags;
    this.built = {}; for (const o of this.world.objs) if (KIND_DEF[o.kind] && KIND_DEF[o.kind].built) this.built[o.kind] = (this.built[o.kind] || 0) + 1;
    this.crafted = d.crafted && Object.keys(d.crafted).length ? d.crafted : this.guessCrafted();
    this.stageIdx = clamp(d.stageIdx || 0, 0, STAGES.length - 1);
    this.tool = d.tool || (this.inv.axe ? 'axe' : this.inv.pick ? 'pick' : null);
    this.player.tool = this.tool;
    this.deathCount = d.deaths || 0;
    this.items = (d.items || []).map((i) => ({ kind: i.kind, x: i.x, y: i.y, t: 1 }));
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    this.fade = 1;
    this.stageDone = false;
    this.state = 'playing';
    this.ui.buildMinimap(this.world);
    this.refreshWorld();
    this.ui.syncAll();
    this.toast('💾 كمّلنا منين وقفتي', 'good');
  }
  guessCrafted() {
    const c = {};
    if (this.inv.axe) c.axe = 1;
    if (this.inv.pick) c.pick = 1;
    for (const k of ['campfire', 'hut', 'coop', 'bench', 'boat']) if (this.built[k]) c[k] = this.built[k];
    return c;
  }
  resetSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { } }

  // ---------- الحلقة ----------------
  frame(now) {
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.12) dt = 0.12;
    this.acc += dt;
    const step = 1 / 60;
    let guard = 0;
    while (this.acc >= step && guard++ < 6) { this.update(step); this.acc -= step; }
    this.lastDt = dt;
    try {
      this.render();
    } catch (e) {
      console.warn('المشهد 3D طاح:', e);
      this.fallbackTo2D(e);
    }
    requestAnimationFrame(this.frame);
  }

  update(dt) {
    this.time += dt;
    this.fade = Math.max(0, this.fade - dt * 1.6);
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.fx.update(dt);

    if (!this.world || !this.player) return;

    if (this.state === 'sailing') { this.updateSailing(dt); this.world.update(dt); this.fx.updateCamera(); return; }

    if (this.state === 'playing') {
      this.world.time += dt * MIN_PER_SEC;
      this.world.lastPlayerX = this.player.x;
      this.world.lastPlayerY = this.player.y;
      // تعب/جوع كيأثرو فالسرعة
      this.energyMul = this.player.hunger < 18 ? 0.82 : 1;
      this.player.update(dt, this);
      updateAnimals(dt, this);
      this.world.update(dt);
      this.updateItems(dt);
      this.smoke(dt);
      // موت
      if (this.player.health <= 0) { this.die(); }
      // فحص الأهداف كل ربع ثانية
      if (this._goalsDirty || this.time % 0.25 < dt) { this._goalsDirty = false; this.checkGoals(); }
      // الحفظ التلقائي
      this.saveTimer += dt;
      if (this.saveTimer > 12) { this.saveTimer = 0; this.saveNow(); }
    } else if (this.state === 'menu') {
      // كاميرا كتدور على الجزيرة
      if (this.world) {
        const t = this.time * 0.08;
        this.cam.x = this.world.cx * TILE + Math.cos(t) * 260;
        this.cam.y = this.world.cy * TILE + Math.sin(t * 1.3) * 140;
      }
    }
    if (this.player && this.state === 'playing') {
      // كاميرا كتتبع اللاعب
      const tx = this.player.x + Math.cos(this.player.dir) * 26;
      const ty = this.player.y + Math.sin(this.player.dir) * 18 - 10;
      this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 5.5);
      this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 5.5);
      this.fx.updateCamera();
      // الأمراض
      if (this.player.hunger <= 0 && this.time % 4 < dt) this.toast('😫 جوعان! كول شي حاجة', 'bad');
      if (this.player.thirst <= 0 && this.time % 4 < dt) this.toast('🥵 عطشان! شرب من العين', 'bad');
      if (this.player.cold && this.hitCd <= 0) { }
      this.prompt = this.nearestInteraction();
    }
    this.updateClock(dt);
    this.ui.syncHud();
  }

  updateSailing(dt) {
    const s = this.sailing;
    s.t += dt;
    const bob = Math.sin(s.t * 2) * 2;
    s.boat.x += Math.cos(s.ang) * 62 * dt;
    s.boat.y += Math.sin(s.ang) * 62 * dt;
    this.player.x = s.boat.x;
    this.player.y = s.boat.y - 26 + bob;
    this.player.dir = s.ang;
    this.cam.x = s.boat.x; this.cam.y = s.boat.y;
    if (s.t > 2.2 && this.state === 'sailing') {
      this.state = 'won';
      this.saveNow();
      this.ui.show('won');
    }
  }

  updateItems(dt) {
    const p = this.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.x += (it.vx || 0) * dt; it.y += (it.vy || 0) * dt;
      it.vx *= 0.86; it.vy *= 0.86;
      const d = dist(p.x, p.y, it.x, it.y);
      if (d < 70) {
        const k = clamp(1 - d / 70, 0, 1) * 240;
        it.x += ((p.x - it.x) / (d || 1)) * k * dt;
        it.y += ((p.y - it.y) / (d || 1)) * k * dt;
      }
      if (d < 20) {
        this.addItem(it.kind, 1);
        this.fx.text(it.x, it.y - 14, `+1 ${ITEMS[it.kind] ? ITEMS[it.kind].icon : ''}`, '#fff');
        this.items.splice(i, 1);
      }
    }
  }

  smoke(dt) {
    for (const f of this.world.structs('campfire')) {
      if (f.lit === false) continue;
      if (Math.random() < dt * 14) this.fx.smoke(f.x + (Math.random() - 0.5) * 8, f.y - 24);
    }
  }

  updateClock(dt) {
    // نعيطة الديك فالصباح
    const h = hourOf(this.world.time);
    const key = Math.floor(h);
    if (this.lastHour !== key) {
      if (this.lastHour !== undefined && key === 6) { this.audio.cluck(); this.toast('🐓 دييييك! نهار جديد', '', 2600); }
      if (this.lastHour !== undefined && key === 19) this.toast('🌇 المغرب قرب — وحّد النار', '', 2600);
      this.lastHour = key;
    }
  }

  // إلا طاح WebGL كنرجعو للوضع 2D بلا ما تتوقف اللعبة
  async fallbackTo2D(err) {
    if (this._fallback) return;
    this._fallback = true;
    try {
      const { View2D } = await import('./view2d.js');
      const fresh = this.canvas.cloneNode(false);
      if (this.canvas.parentNode) this.canvas.parentNode.replaceChild(fresh, this.canvas);
      this.canvas = fresh;
      this.setView(new View2D());
      this.toast('⚠️ المشهد 3D طاح — رجعنا للوضع 2D', 'bad', 5000);
    } catch (e) { console.error(e); }
  }

  // ---------- الرسم (كيتكلف بيه المصيّر) ----------
  render() {
    if (this.view && this.view.render) this.view.render(this, this.lastDt || 0.016);
  }
}

// ============================================================
//  المؤثرات
// ============================================================
export class Fx {
  constructor(game) {
    this.g = game;
    this.parts = [];
    this.texts = [];
    this.shakeAmt = 0;
    this.shx = 0; this.shy = 0;
  }
  add(x, y, o) {
    this.parts.push({ x, y, vx: o.vx || 0, vy: o.vy || 0, life: o.life || 0.6, max: o.life || 0.6, color: o.color || '#fff', size: o.size || 3, grav: o.grav ?? 60, alpha: o.alpha ?? 1, shape: o.shape || 'rect', rot: Math.random() * TAU, vr: o.vr || 0 });
    if (this.parts.length > 600) this.parts.splice(0, 60);
  }
  splash(x, y) { for (let i = 0; i < 3; i++) this.add(x, y, { vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 60, life: 0.4, color: 'rgba(220,245,255,0.9)', size: 2.4, grav: 140, shape: 'circle' }); }
  woodChips(x, y) { for (let i = 0; i < 7; i++) this.add(x, y, { vx: (Math.random() - 0.5) * 150, vy: -Math.random() * 130, life: 0.7, color: ['#c9a06a', '#8a5e34', '#d8b98a'][i % 3], size: 3.2, grav: 420, shape: 'rect' }); }
  stoneChips(x, y) { for (let i = 0; i < 6; i++) this.add(x, y, { vx: (Math.random() - 0.5) * 140, vy: -Math.random() * 120, life: 0.6, color: ['#b9bcc2', '#8b8f96', '#d5d8dd'][i % 3], size: 2.6, grav: 440, shape: 'rect' }); }
  leafPuff(x, y) { for (let i = 0; i < 6; i++) this.add(x, y, { vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 40 - 10, life: 0.9, color: ['#6fae4b', '#8fc95f', '#4c8a3a'][i % 3], size: 3, grav: 30, shape: 'leaf', vr: (Math.random() - 0.5) * 6 }); }
  sparkle(x, y, color) { for (let i = 0; i < 10; i++) { const a = Math.random() * TAU, s = 40 + Math.random() * 70; this.add(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: 0.7, color, size: 2.6, grav: -20, shape: 'circle' }); } }
  heart(x, y) { for (let i = 0; i < 4; i++) this.add(x + (Math.random() - 0.5) * 14, y, { vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 30, life: 1.1, color: '#ff7aa8', size: 5, grav: -10, shape: 'heart' }); }
  blood(x, y) { for (let i = 0; i < 8; i++) this.add(x, y, { vx: (Math.random() - 0.5) * 130, vy: -Math.random() * 90, life: 0.55, color: ['#c0392b', '#9b2c1f'][i % 2], size: 3, grav: 400, shape: 'circle' }); }
  smoke(x, y) { this.add(x, y, { vx: (Math.random() - 0.5) * 16, vy: -22 - Math.random() * 16, life: 2.2, color: 'rgba(210,210,215,0.5)', size: 7 + Math.random() * 6, grav: -8, shape: 'cloud' }); }
  fire(x, y) { this.add(x + (Math.random() - 0.5) * 12, y, { vx: (Math.random() - 0.5) * 20, vy: -40 - Math.random() * 40, life: 0.5, color: ['#ffc63c', '#ff8a20', '#ffe8a0'][Math.floor(Math.random() * 3)], size: 4, grav: -30, shape: 'circle' }); }
  text(x, y, str, color) { this.texts.push({ x, y, str, color: color || '#fff', life: 1.1, max: 1.1 }); }
  shake(n) { this.shakeAmt = Math.min(14, this.shakeAmt + n); }
  updateCamera() {
    if (this.shakeAmt > 0.05) {
      this.shx = (Math.random() - 0.5) * this.shakeAmt;
      this.shy = (Math.random() - 0.5) * this.shakeAmt;
    } else { this.shx = this.shy = 0; }
  }
  update(dt) {
    this.shakeAmt *= Math.pow(0.0025, dt);
    if (this.shakeAmt < 0.05) this.shakeAmt = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.shape === 'cloud') { p.size += dt * 6; p.vx += (Math.random() - 0.5) * 6; }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt; t.y -= dt * 26;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }
  draw(ctx) {
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1) * p.alpha;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); ctx.fill(); }
      else if (p.shape === 'cloud') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); }
      else if (p.shape === 'leaf') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.ellipse(0, 0, p.size * 1.7, p.size * 0.8, 0, 0, TAU); ctx.fill();
      } else if (p.shape === 'heart') {
        ctx.translate(p.x, p.y); ctx.scale(p.size / 6, p.size / 6);
        ctx.beginPath();
        ctx.moveTo(0, 4); ctx.bezierCurveTo(-7, -3, -4, -9, 0, -5);
        ctx.bezierCurveTo(4, -9, 7, -3, 0, 4); ctx.fill();
      } else {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
    for (const t of this.texts) {
      const a = clamp(t.life / t.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
      ctx.restore();
    }
  }
}
