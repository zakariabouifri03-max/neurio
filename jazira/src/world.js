// توليد الجزيرة، الأرض، الأغراض والحيوانات — world.js
import { makeRng, makeNoise2D, clamp, dist, TAU } from './util.js';

export const TILE = 32;
export const MAPW = 130;
export const MAPH = 130;
export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCK: 5, FRESH: 6 };

export const WALKABLE = { [T.DEEP]: false, [T.SHALLOW]: true, [T.SAND]: true, [T.GRASS]: true, [T.FOREST]: true, [T.ROCK]: true, [T.FRESH]: true };

// أنواع الأغراض: نصف قطر، صلابة، وشنو كيعطي
export const KIND_DEF = {
  palm:   { r: 13, cr: 7, solid: true,  hits: 4, perHit: { wood: 1 }, drop: { wood: [1, 2], coconut: [0, 1] }, regrow: 130, shake: true, label: 'نخلة' },
  tree:   { r: 14, cr: 8, solid: true,  hits: 4, perHit: { wood: 1 }, drop: { wood: [1, 2] }, regrow: 120, shake: true, label: 'شجرة' },
  tree2:  { r: 13, cr: 8, solid: true,  hits: 3, perHit: { wood: 1 }, drop: { wood: [1, 1] }, regrow: 100, shake: true, label: 'شجرة' },
  bush:   { r: 11, solid: false, hits: 1, perHit: {}, drop: { fiber: [2, 3] }, regrow: 45, shake: true, label: 'شجيرة' },
  tuft:   { r: 9,  solid: false, hits: 1, perHit: {}, drop: { seed: [1, 2], fiber: [1, 1] }, regrow: 30, shake: true, label: 'عشبة البزر' },
  flower: { r: 7,  solid: false, hits: 1, perHit: {}, drop: { fiber: [1, 1] }, regrow: 70, label: 'زهرة' },
  rock:   { r: 15, cr: 15, solid: true,  hits: 4, perHit: { stone: 1 }, drop: { stone: [1, 2] }, regrow: 160, needPick: true, shake: true, label: 'صخرة' },
  pebble: { r: 7,  solid: false, hits: 1, perHit: {}, drop: { stone: [1, 1] }, regrow: 90, label: 'حجرة' },
  reeds:  { r: 10, solid: false, hits: 1, perHit: {}, drop: { fiber: [2, 2] }, regrow: 50, label: 'قصب' },
  spring: { r: 18, solid: false, hits: 0, label: 'عين الماء' },
  campfire: { r: 15, cr: 13, solid: true, hits: 0, built: true, label: 'نار المخيم' },
  hut:      { r: 26, cr: 26, solid: true, hits: 0, built: true, label: 'الكوخ' },
  coop:     { r: 24, cr: 23, solid: true, hits: 0, built: true, label: 'قفص الدجاج' },
  bench:    { r: 18, cr: 16, solid: true, hits: 0, built: true, label: 'طابلة الخدمة' },
  boat:     { r: 30, cr: 30, solid: true, hits: 0, built: true, label: 'القارب' },
};

export class World {
  constructor(seed, opts = {}) {
    this.seed = seed >>> 0;
    this.w = MAPW;
    this.h = MAPH;
    this.tiles = new Uint8Array(this.w * this.h);
    this.var = new Uint8Array(this.w * this.h);   // تنويع بصري 0..255
    this.foam = new Uint8Array(this.w * this.h);  // رشيم الماء حدا الرمل
    this.tileObjs = Array.from({ length: this.w * this.h }, () => []);
    this.objs = [];
    this.animals = [];
    this.coops = [];
    this.time = 0;
    if (opts.load) { this.load(opts.load); }
    else { this.generate(); }
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  tileAt(tx, ty) { return this.inside(tx, ty) ? this.tiles[this.idx(tx, ty)] : T.DEEP; }
  tileAtWorld(x, y) { return this.tileAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
  isWater(x, y) { const t = this.tileAtWorld(x, y); return t === T.DEEP || t === T.SHALLOW; }
  isDeep(x, y) { return this.tileAtWorld(x, y) === T.DEEP; }
  isLand(x, y) { const t = this.tileAtWorld(x, y); return WALKABLE[t] && t !== T.SHALLOW && t !== T.FRESH; }
  worldW() { return this.w * TILE; }
  worldH() { return this.h * TILE; }

  // ---------- التوليد ----------
  generate() {
    const R = makeRng(this.seed);
    const noise = makeNoise2D(this.seed ^ 0x9e3779b9);
    const forest = makeNoise2D(this.seed ^ 0x51ab3f);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    const baseR = this.w * 0.355;
    const ph = [R() * TAU, R() * TAU, R() * TAU];

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dx = x + 0.5 - this.cx;
        const dy = (y + 0.5 - this.cy) * 1.04;
        const d = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        // شكل الجزيرة: موجات ناعمة
        const wob =
          1 +
          0.170 * Math.sin(3 * th + ph[0]) +
          0.105 * Math.sin(5 * th + ph[1]) +
          0.065 * Math.sin(8 * th + ph[2]) +
          0.045 * Math.sin(13 * th + ph[0] * 2);
        const edge = noise(x * 0.09, y * 0.09) - 0.5;
        const hh = ((baseR * wob - d) / baseR) * 1.55 + edge * 0.34 + (noise(x * 0.035, y * 0.035) - 0.5) * 0.30;

        let t;
        if (hh < -0.155) t = T.DEEP;
        else if (hh < 0.0) t = T.SHALLOW;
        else if (hh < 0.10) t = T.SAND;
        else if (hh > 0.72) t = T.ROCK;
        else t = T.GRASS;

        if (t === T.GRASS && forest(x * 0.075, y * 0.075) > 0.60) t = T.FOREST;
        if (t === T.ROCK && forest(x * 0.11, y * 0.11) > 0.62) t = T.FOREST;
        this.tiles[this.idx(x, y)] = t;
        this.var[this.idx(x, y)] = Math.floor(R() * 255);
      }
    }

    // عيون الماء (بحيرات صغيرة داخلية)
    this.springs = [];
    for (let s = 0; s < 3; s++) {
      let placed = null;
      for (let attempt = 0; attempt < 400 && !placed; attempt++) {
        const a = R() * TAU;
        const rr = baseR * R.range(0.15, 0.72);
        const tx = Math.round(this.cx + Math.cos(a) * rr);
        const ty = Math.round(this.cy + Math.sin(a) * rr);
        if (!this.inside(tx, ty)) continue;
        let ok = true;
        for (let yy = -2; yy <= 2 && ok; yy++)
          for (let xx = -2; xx <= 2 && ok; xx++) {
            const tt = this.tileAt(tx + xx, ty + yy);
            if (tt !== T.GRASS && tt !== T.FOREST) ok = false;
          }
        if (ok) placed = { tx, ty };
      }
      if (!placed) continue;
      const rad = R.range(1.4, 2.2);
      for (let yy = -3; yy <= 3; yy++)
        for (let xx = -3; xx <= 3; xx++) {
          if (!this.inside(placed.tx + xx, placed.ty + yy)) continue;
          const d = Math.hypot(xx, yy);
          if (d <= rad) this.tiles[this.idx(placed.tx + xx, placed.ty + yy)] = T.FRESH;
          else if (d <= rad + 1) this.tiles[this.idx(placed.tx + xx, placed.ty + yy)] = T.SAND;
        }
      const sx = (placed.tx + 0.5) * TILE, sy = (placed.ty + 0.5) * TILE;
      this.springs.push({ x: sx, y: sy });
      this.addObj({ kind: 'spring', x: sx, y: sy });
    }

    // نقطة البداية: شاطئ فالجنوب
    this.camp = this.findCoastSpot(Math.PI / 2);
    this.launch = this.findCoastSpot(Math.PI / 2 + 0.22) || this.camp;

    // تنظيف منطقة المخيم
    const clearR = 3.2;
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const d = Math.hypot(tx - this.camp.tx, ty - this.camp.ty);
        if (d < clearR) {
          const tt = this.tileAt(tx, ty);
          if (tt === T.FOREST) this.tiles[this.idx(tx, ty)] = T.GRASS;
        }
      }

    // ---- توزيع الأغراض ----
    const spawnPts = this.camp;
    for (let ty = 1; ty < this.h - 1; ty++) {
      for (let tx = 1; tx < this.w - 1; tx++) {
        const t = this.tileAt(tx, ty);
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        const nearCamp = Math.hypot(tx - spawnPts.tx, ty - spawnPts.ty) < clearR + 0.5;
        if (nearCamp) continue;

        if (t === T.SAND) {
          if (R.chance(0.075)) this.addObj({ kind: 'palm', x, y });
          else if (R.chance(0.05)) this.addObj({ kind: 'pebble', x, y });
          else if (R.chance(0.035)) this.addObj({ kind: 'rock', x, y });
        } else if (t === T.GRASS) {
          const f = R();
          if (f < 0.052) this.addObj({ kind: 'tree', x, y, resin: R.chance(0.45), variant: R.int(0, 1) });
          else if (f < 0.085) this.addObj({ kind: 'bush', x, y });
          else if (f < 0.135) this.addObj({ kind: 'tuft', x, y });
          else if (f < 0.165) this.addObj({ kind: 'flower', x, y, variant: R.int(0, 2) });
          else if (f < 0.175) this.addObj({ kind: 'rock', x, y });
          else if (f < 0.181) this.addObj({ kind: 'pebble', x, y });
        } else if (t === T.FOREST) {
          const f = R();
          if (f < 0.235) this.addObj({ kind: R.chance(0.4) ? 'tree2' : 'tree', x, y, resin: R.chance(0.5), variant: R.int(0, 1) });
          else if (f < 0.290) this.addObj({ kind: 'bush', x, y });
          else if (f < 0.330) this.addObj({ kind: 'tuft', x, y });
        } else if (t === T.ROCK) {
          if (R.chance(0.16)) this.addObj({ kind: 'rock', x, y });
          else if (R.chance(0.10)) this.addObj({ kind: 'pebble', x, y });
        } else if (t === T.SHALLOW) {
          if (R.chance(0.05)) this.addObj({ kind: 'reeds', x, y });
        }
      }
    }

    // مسافة من الشاطئ (بلاصات ما) — للون الماء وللبحر العميق
    this.shoreDist = new Uint8Array(this.w * this.h);
    const queue = [];
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        const t = this.tileAt(tx, ty);
        if (t !== T.DEEP && t !== T.SHALLOW) { this.shoreDist[this.idx(tx, ty)] = 0; queue.push(tx, ty); }
        else this.shoreDist[this.idx(tx, ty)] = 99;
      }
    let qi = 0;
    while (qi < queue.length) {
      const tx = queue[qi++], ty = queue[qi++];
      const d = this.shoreDist[this.idx(tx, ty)];
      if (d >= 99) continue;
      for (let i = 0; i < 4; i++) {
        const nx = tx + [1, -1, 0, 0][i], ny = ty + [0, 0, 1, -1][i];
        if (!this.inside(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (this.shoreDist[j] > d + 1) { this.shoreDist[j] = Math.min(60, d + 1); queue.push(nx, ny); }
      }
    }

    // رشيم الماء (foam) حدا الرمل
    for (let ty = 0; ty < this.h; ty++)
      for (let tx = 0; tx < this.w; tx++) {
        if (this.tileAt(tx, ty) !== T.SHALLOW) continue;
        let near = false;
        for (let i = 0; i < 4 && !near; i++) {
          const nx = tx + [1, -1, 0, 0][i], ny = ty + [0, 0, 1, -1][i];
          if (this.tileAt(nx, ny) === T.SAND) near = true;
        }
        if (near) this.foam[this.idx(tx, ty)] = 1;
      }

    // ---- الحيوانات ----
    const chickenSpots = [];
    for (let i = 0; i < 7; i++) {
      const p = this.randomLandNear(this.camp, 3, 16, R);
      if (p) { this.addAnimal({ type: 'chicken', x: p.x, y: p.y, seed: R.int(0, 1e9) }); chickenSpots.push(p); }
    }
    for (let i = 0; i < 4; i++) {
      const p = this.randomLandNear(this.camp, 6, 26, R);
      if (p) this.addAnimal({ type: 'goat', x: p.x, y: p.y, seed: R.int(0, 1e9) });
    }
    for (let i = 0; i < 3; i++) {
      const p = this.randomLandNear(this.camp, 12, 34, R);
      if (p) this.addAnimal({ type: 'boar', x: p.x, y: p.y, seed: R.int(0, 1e9) });
    }
    for (let i = 0; i < 6; i++) {
      const p = this.randomBeach(this.camp, R);
      if (p) this.addAnimal({ type: 'crab', x: p.x, y: p.y, seed: R.int(0, 1e9) });
    }
    this.rebuildGrid();
  }

  findCoastSpot(angle) {
    const steps = 260;
    let last = null;
    for (let i = 0; i < steps; i++) {
      const r = (i / steps) * this.w * 0.62;
      const tx = Math.round(this.cx + Math.cos(angle) * r);
      const ty = Math.round(this.cy + Math.sin(angle) * r);
      if (!this.inside(tx, ty)) break;
      const t = this.tileAt(tx, ty);
      if (t === T.SAND) {
        // لازم تكون حدا الماء
        const wet = this.tileAt(tx + 1, ty) === T.SHALLOW || this.tileAt(tx - 1, ty) === T.SHALLOW ||
                    this.tileAt(tx, ty + 1) === T.SHALLOW || this.tileAt(tx, ty - 1) === T.SHALLOW;
        if (wet) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
        last = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
      }
    }
    return last || { x: this.cx * TILE, y: (this.cy + 30) * TILE, tx: Math.round(this.cx), ty: Math.round(this.cy + 30) };
  }

  // بلاصة خاوية للبداية (قريبة من المخيم)
  spawnPoint() {
    const tx0 = Math.floor(this.camp.x / TILE), ty0 = Math.floor(this.camp.y / TILE);
    for (let ring = 0; ring <= 8; ring++) {
      for (let dy = -ring; dy <= ring; dy++)
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const tx = tx0 + dx, ty = ty0 + dy;
          if (!this.inside(tx, ty)) continue;
          const t = this.tileAt(tx, ty);
          if (t === T.SAND || t === T.GRASS || t === T.FOREST) {
            const wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
            if (!this.blockedCircle(wx, wy, 15)) return { x: wx, y: wy };
          }
        }
    }
    return { x: this.camp.x, y: this.camp.y };
  }

  randomLandNear(from, minT, maxT, R) {
    for (let i = 0; i < 80; i++) {
      const a = R() * TAU, d = R.range(minT, maxT) * TILE;
      const x = from.x + Math.cos(a) * d, y = from.y + Math.sin(a) * d;
      const t = this.tileAtWorld(x, y);
      if (t === T.GRASS || t === T.FOREST || t === T.SAND) return { x, y };
    }
    return null;
  }

  randomBeach(from, R) {
    for (let i = 0; i < 80; i++) {
      const a = R() * TAU, d = R.range(3, 22) * TILE;
      const x = from.x + Math.cos(a) * d, y = from.y + Math.sin(a) * d;
      if (this.tileAtWorld(x, y) === T.SAND) return { x, y };
    }
    return null;
  }

  // ---------- الأغراض ----------
  addObj(o) {
    o.id = o.id || (this._oid = (this._oid || 0) + 1);
    o.hp = o.hp ?? KIND_DEF[o.kind].hits;
    o.maxHp = KIND_DEF[o.kind].hits;
    o.regrow = 0;
    o.phase = (o.id * 1.618) % TAU;
    if (o.kind === 'coop' && o.eggs === undefined) { o.eggs = 0; o.feed = 0; o.incubating = 0; o.chickens = 0; }
    this.objs.push(o);
    const tx = clamp(Math.floor(o.x / TILE), 0, this.w - 1);
    const ty = clamp(Math.floor(o.y / TILE), 0, this.h - 1);
    this.tileObjs[this.idx(tx, ty)].push(o);
    if (o.kind === 'coop' && !this.coops.includes(o)) this.coops.push(o);
    return o;
  }

  removeObj(o) {
    const i = this.objs.indexOf(o);
    if (i >= 0) this.objs.splice(i, 1);
    const tx = clamp(Math.floor(o.x / TILE), 0, this.w - 1);
    const ty = clamp(Math.floor(o.y / TILE), 0, this.h - 1);
    const arr = this.tileObjs[this.idx(tx, ty)];
    const j = arr.indexOf(o);
    if (j >= 0) arr.splice(j, 1);
    if (o.kind === 'coop') {
      const k = this.coops.indexOf(o);
      if (k >= 0) this.coops.splice(k, 1);
    }
  }

  objsNear(x, y, r) {
    const out = [];
    const t0x = clamp(Math.floor((x - r) / TILE), 0, this.w - 1);
    const t1x = clamp(Math.floor((x + r) / TILE), 0, this.w - 1);
    const t0y = clamp(Math.floor((y - r) / TILE), 0, this.h - 1);
    const t1y = clamp(Math.floor((y + r) / TILE), 0, this.h - 1);
    for (let ty = t0y; ty <= t1y; ty++)
      for (let tx = t0x; tx <= t1x; tx++) {
        const arr = this.tileObjs[this.idx(tx, ty)];
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    return out;
  }

  struct(kind) { return this.objs.find((o) => o.kind === kind); }
  structs(kind) { return this.objs.filter((o) => o.kind === kind); }

  addAnimal(a) {
    const A = { type: 'chicken', x: 0, y: 0, vx: 0, vy: 0, seed: 1, ...a };
    A.home = { x: A.x, y: A.y };
    A.t = A.t ?? Math.random() * 10;
    A.dir = A.dir ?? Math.random() * TAU;
    A.state = A.state || 'wander';
    A.hp = A.hp ?? ({ chicken: 99, goat: 3, boar: 5, crab: 1 }[A.type] || 3);
    A.maxHp = A.hp;
    A.r = { chicken: 11, goat: 14, boar: 17, crab: 9 }[A.type] || 12;
    A.bob = Math.random() * 10;
    A.tamed = !!A.tamed;
    A.coop = A.coop || null;
    A.eggTimer = A.eggTimer ?? (A.type === 'chicken' ? 12 + Math.random() * 16 : 0);
    A.cool = 0;
    A.inside = !!A.inside;
    this.animals.push(A);
    return A;
  }

  removeAnimal(a) {
    const i = this.animals.indexOf(a);
    if (i >= 0) this.animals.splice(i, 1);
  }

  rebuildGrid() { /* الأغراض ديالنا مخزّنة فالـtileObjs، ما كايناش حاجة */ }

  // واش بلاصة فيها تصادم؟
  blockedCircle(x, y, r, ignore) {
    if (!WALKABLE[this.tileAtWorld(x, y)]) return true;
    // حافة العالم
    if (x < r || y < r || x > this.worldW() - r || y > this.worldH() - r) return true;
    const near = this.objsNear(x, y, r + 34);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === ignore) continue;
      const def = KIND_DEF[o.kind];
      if (!def.solid) continue;
      const rr = (def.cr ?? def.r) + r;
      const dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  walkableAt(x, y, r = 0) {
    if (x < r || y < r || x > this.worldW() - r || y > this.worldH() - r) return false;
    return !!WALKABLE[this.tileAtWorld(x, y)];
  }

  // تحرّك مع زحلقة ناعمة حدا الشجر والصخر
  moveBody(b, dx, dy, r) {
    const res = { hitX: false, hitY: false };
    const px = b.x, py = b.y;

    // 1) حركة عادية
    let nx = px + dx, ny = py + dy;
    if (!this.walkableAt(nx, ny, r)) {
      // ما/حدود: نجربو محور بمحور
      if (this.walkableAt(nx, py, r)) { ny = py; res.hitY = true; }
      else if (this.walkableAt(px, ny, r)) { nx = px; res.hitX = true; }
      else { nx = px; ny = py; res.hitX = res.hitY = true; }
    }
    b.x = nx; b.y = ny;

    // 2) دفع خارج الأغراض الصلبة (زحلقة)
    const near = this.objsNear(b.x, b.y, r + 46);
    for (let iter = 0; iter < 2; iter++) {
      let pushed = false;
      for (let i = 0; i < near.length; i++) {
        const o = near[i];
        const def = KIND_DEF[o.kind];
        if (!def || !def.solid || o.depleted) continue;
        const rr = (def.cr ?? def.r) + r;
        let ox = b.x - o.x, oy = b.y - o.y;
        let d = Math.hypot(ox, oy);
        if (d < rr) {
          if (d < 0.0001) { ox = 0.001; oy = 1; d = Math.hypot(ox, oy); }
          let nxr = ox / d, nyr = oy / d;
          // إلا كان الضرب فوسط الجذع، نحيّدو الزحلقة شوية باش اللاعب يدور
          const mv = Math.hypot(dx, dy);
          if (mv > 0.001) {
            const dot = (nxr * dx + nyr * dy) / mv;
            if (dot < -0.93) {
              if (b.slideBias === undefined) b.slideBias = Math.random() < 0.5 ? 1 : -1;
              const ang = 0.55 * b.slideBias;
              const c = Math.cos(ang), s = Math.sin(ang);
              const rx = nxr * c - nyr * s, ry = nxr * s + nyr * c;
              nxr = rx; nyr = ry;
            }
          }
          const push = rr - d + 0.01;
          b.x += nxr * push;
          b.y += nyr * push;
          pushed = true;
          res.hitX = res.hitY = true;
        }
      }
      if (!pushed) break;
    }

    // 3) إذا الدفع خرّجنا من الأرض، نرجعو
    if (!this.walkableAt(b.x, b.y, r)) {
      if (this.walkableAt(px, b.y, r)) b.x = px;
      else if (this.walkableAt(b.x, py, r)) b.y = py;
      else { b.x = px; b.y = py; }
    }
    return res;
  }

  update(dt) {
    // إعادة إخراج الحيوانات (باش اللحم ما ينقصش)
    this.animalTimer = (this.animalTimer ?? 60) - dt;
    if (this.animalTimer <= 0) {
      this.animalTimer = 75;
      if (!this._rng) this._rng = makeRng((this.seed ^ 0x5eed12) >>> 0);
      const R = this._rng;
      const count = (t) => this.animals.filter((a) => a.type === t).length;
      const spawnFar = (type, minD) => {
        for (let i = 0; i < 60; i++) {
          const p = this.randomLandNear(this.camp, minD / TILE, (minD + 500) / TILE, R);
          if (!p) continue;
          if (Math.hypot(p.x - (this.lastPlayerX ?? this.camp.x), p.y - (this.lastPlayerY ?? this.camp.y)) < 420) continue;
          const t = this.tileAtWorld(p.x, p.y);
          if (t !== T.GRASS && t !== T.FOREST) continue;
          this.addAnimal({ type, x: p.x, y: p.y, seed: Math.floor(R() * 1e9) });
          return true;
        }
        return false;
      };
      if (count('goat') < 4) spawnFar('goat', 320);
      if (count('boar') < 3) spawnFar('boar', 420);
    }

    // إعادة نموّ الموارد
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      if (o.regrow > 0) {
        o.regrow -= dt;
        if (o.regrow <= 0) { o.hp = o.maxHp; o.regrow = 0; o.depleted = false; }
      }
    }
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i];
      if (o.kind === 'coop') {
        if (o.incubating > 0) {
          o.incubating -= dt;
          if (o.incubating <= 0) { o.incubating = 0; o.pendingChick = (o.pendingChick || 0) + 1; }
        }
      }
    }
  }

  toJSON() {
    return {
      seed: this.seed, time: this.time,
      objs: this.objs.map((o) => ({
        kind: o.kind, x: o.x, y: o.y, hp: o.hp, regrow: o.regrow, depleted: !!o.depleted,
        variant: o.variant, resin: o.resin, eggs: o.eggs, feed: o.feed, incubating: o.incubating,
        chickens: o.chickens, pendingChick: o.pendingChick, id: o.id, phase: o.phase,
      })),
      animals: this.animals.map((a) => ({
        type: a.type, x: a.x, y: a.y, seed: a.seed, home: a.home, hp: a.hp, tamed: a.tamed,
        coopId: a.coop ? a.coop.id : null, eggTimer: a.eggTimer, inside: a.inside, state: a.state,
      })),
    };
  }

  load(d) {
    this.seed = d.seed;
    // نعاودو التوليد بنفس السييد ومن بعد نطبّقو التعديلات (الأغراض المبنيّة + الحالة)
    const R = makeRng(this.seed);
    this.generate();
    // نمسحو الحيوانات ونديروهم من الجديد حسب المحفوظ
    this.animals = [];
    const objById = new Map(this.objs.map((o) => [o.id, o]));
    for (const so of d.objs || []) {
      const o = objById.get(so.id);
      if (o) {
        o.hp = so.hp; o.regrow = so.regrow; o.depleted = so.depleted;
        o.eggs = so.eggs; o.feed = so.feed; o.incubating = so.incubating;
        o.chickens = so.chickens; o.pendingChick = so.pendingChick;
      } else {
        // غرض مبني (كوخ/نار/قارب...) — نعاودو نزيدوه
        this.addObj({ kind: so.kind, x: so.x, y: so.y, id: so.id, phase: so.phase });
        const nn = this.objs[this.objs.length - 1];
        nn.eggs = so.eggs; nn.feed = so.feed; nn.incubating = so.incubating;
        nn.chickens = so.chickens; nn.pendingChick = so.pendingChick;
      }
    }
    this.time = d.time || 0;
    for (const sa of d.animals || []) {
      const coop = sa.coopId ? this.objs.find((o) => o.id === sa.coopId) : null;
      this.addAnimal({
        type: sa.type, x: sa.x, y: sa.y, seed: sa.seed, home: sa.home, hp: sa.hp,
        tamed: sa.tamed, coop, eggTimer: sa.eggTimer, inside: sa.inside, state: sa.state,
      });
    }
  }
}
