// اللاعب والحيوانات — entities.js
import { clamp, dist, TAU, nightAmount } from './util.js';

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 9;
    this.dir = 0;          // اتجاه النظر
    this.walkPhase = 0;
    this.speedScale = 1;
    this.health = 100;
    this.hunger = 100;
    this.thirst = 100;
    this.stamina = 100;
    this.actAnim = 0;      // أنيميشن الضرب/القطع
    this.hurtFlash = 0;
    this.splash = 0;
    this.cold = 0;
    this.grounded = true;
    this.tool = null;      // الفأس/المعول فال يد
  }

  get inWater() { return this.splash > 0; }

  update(dt, game) {
    const { world } = game;
    const inp = game.input;
    const mv = game.moveDir || inp;
    let mx = mv.x, my = mv.y;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const moving = m > 0.08;

    // الجري = طاقة
    const wantRun = inp.run && this.stamina > 1 && moving;
    const base = wantRun ? 238 : 152;
    if (wantRun) this.stamina = clamp(this.stamina - 20 * dt, 0, 100);
    else this.stamina = clamp(this.stamina + (moving ? 9 : 16) * dt, 0, 100);

    // التضاريس كتأثر فالسرعة
    const t = world.tileAtWorld(this.x, this.y);
    const tileMul = { 0: 1, 1: 0.62, 2: 0.96, 3: 1, 4: 0.94, 5: 0.9, 6: 0.78 }[t] ?? 1;
    const mul = tileMul * (game.energyMul || 1);
    const target = base * mul;
    this.vx += (mx * target - this.vx) * Math.min(1, dt * 12);
    this.vy += (my * target - this.vy) * Math.min(1, dt * 12);

    const before = { x: this.x, y: this.y };
    world.moveBody(this, this.vx * dt, this.vy * dt, this.r);

    const moved = dist(before.x, before.y, this.x, this.y);
    if (moving) this.dir = Math.atan2(my, mx);
    this.walkPhase += (moved / 16) * 2.2;
    this.speedScale = clamp(Math.hypot(this.vx, this.vy) / 150, 0, 1.7);

    // شطيح الماء
    if (t === 1 || t === 6) {
      this.splash = Math.min(1, this.splash + dt * 3);
      if (Math.random() < 0.35) game.fx.splash(this.x + (Math.random() - 0.5) * 12, this.y + 4);
    } else this.splash = Math.max(0, this.splash - dt * 2.5);

    // جوع/عطش/صحة
    this.hunger = clamp(this.hunger - 0.105 * dt * (wantRun ? 1.35 : 1), 0, 100);
    this.thirst = clamp(this.thirst - 0.135 * dt * (wantRun ? 1.4 : 1), 0, 100);
    if (this.hunger <= 0) this.health -= 1.1 * dt;
    if (this.thirst <= 0) this.health -= 1.9 * dt;
    if (!this.cold && this.hunger > 45 && this.thirst > 45 && this.health < 100) this.health = clamp(this.health + 0.7 * dt, 0, 100);

    // البرد فالليل
    const hour = hourOf(world.time);
    const night = nightAmount(hour);
    const warm = game.nearFire(this.x, this.y) || game.inHut(this.x, this.y);
    this.cold = night > 0.5 && !warm ? 1 : 0;
    if (this.cold) this.health -= 0.62 * dt;

    this.health = clamp(this.health, -1, 100);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.actAnim = Math.max(0, this.actAnim - dt * 3);
  }

  hurt(n, game, why) {
    this.health -= n;
    this.hurtFlash = 1;
    game.fx.shake(6);
    game.audio.hurt();
    if (why) game.toast('💥 ' + why, 'bad');
  }
}

export function hourOf(tMin) { return ((tMin / 60) % 24 + 24) % 24; }

// ---------------- الحيوانات ----------------
export function updateAnimals(dt, game) {
  const { world, player } = game;
  const hour = hourOf(world.time);
  const night = nightAmount(hour);
  const R = Math.random;

  for (const a of world.animals) {
    a.t += dt;
    a.cool = Math.max(0, a.cool - dt);
    const dPlayer = dist(a.x, a.y, player.x, player.y);

    // مخافة عامة من اللاعب — الدجاج كيولّف شوية بشوية، وكيقرب ملي تكون عندك بزر
    const seedBonus = (game.inv && game.inv.seed > 0) ? 8 : 0;
    const fleeR = Math.max(30, 72 - 18 * (a.affinity || 0) - seedBonus);
    const scared = dPlayer < (a.type === 'chicken' ? fleeR : 120) && !a.tamed;

    switch (a.type) {
      case 'chicken': {
        // إلا تولّفت قبل ما يتبنى القفص، كنعطيوه ليها ملي كايبان
        if (a.tamed && !a.coop) { const c = world.struct('coop'); if (c) a.coop = c; }
        if (a.tamed && a.coop && !a.inside) {
          const dCoop = dist(a.x, a.y, a.coop.x, a.coop.y);
          const playerNearCoop = dist(player.x, player.y, a.coop.x, a.coop.y) < 170;
          if (playerNearCoop && dCoop < 300) {
            // اللاعب قرب من القفص → الدجاجة كتمشي نحوه وكتدخل (بلا ما يلغيها الـwander)
            a.state = 'toCoop';
            if (dCoop > 42) {
              moveSmart(a, a.coop.x, a.coop.y + 12, 152, dt, world);
              a.bob += dt * 8;
              break;
            }
            a.inside = true; a.state = 'coop';
            game.audio.pop();
            game.fx.sparkle(a.x, a.y - 6, '#ffe08a');
            game.fx.heart(a.x, a.y - 18);
            a.bob += dt * 3;
            break;
          }
          if (dCoop > 62) a.state = 'follow';
        }
        if (a.inside) {
          // داخل القفص: كيبيض
          a.x += (a.coop.x + Math.cos(a.t * 0.7) * 16 - a.x) * Math.min(1, dt * 1.2);
          a.y += (a.coop.y + 14 + Math.sin(a.t * 0.9) * 10 - a.y) * Math.min(1, dt * 1.2);
          if (night < 0.6) {
            if (!a.everLaid) { a.everLaid = true; a.eggTimer = Math.min(a.eggTimer, 12); }
            const cozy = 1 + Math.min(a.coop.feed || 0, 3) * 0.45;
            a.eggTimer -= dt * cozy;
            if (a.eggTimer <= 0) {
              a.eggTimer = 22 + R() * 20;
              if (a.coop.eggs < 15) {
                a.coop.eggs++;
                game.fx.sparkle(a.coop.x, a.coop.y - 6, '#fff2c0');
                game.audio.egg();
                if (a.coop.eggs === 1) game.toast('🥚 الدجاجة بيضت! سير للقفص وخود البيض', 'good', 3000);
              }
            }
          } else a.eggTimer = Math.min(a.eggTimer, 18);
          a.bob += dt * 3;
          continue;
        }
        // عندك بزر وواقف ماشي كتجرّي؟ الدجاجة كتقرّب لييك بوحدها
        const playerStill = Math.hypot(game.input.x, game.input.y) < 0.2;
        if (!a.tamed && playerStill && dPlayer < 150 && (game.inv.seed || 0) > 0) {
          if (dPlayer > 34) { moveSmart(a, player.x, player.y, 62, dt, world); a.state = 'interest'; a.bob += dt * 5; break; }
          a.state = 'interest';
          a.dir = Math.atan2(player.y - a.y, player.x - a.x);
          a.bob += dt * 3.5;
          break;
        }
        if (a.state === 'follow') {
          const tx = player.x - Math.cos(player.dir) * 34, ty = player.y - Math.sin(player.dir) * 34;
          const d = dist(a.x, a.y, tx, ty);
          if (d > 46) {
            const sp = clamp(d * 2.2, 20, 118);
            moveToward(a, tx, ty, sp, dt, world);
          } else a.state = 'wander';
        } else {
          if (scared) { a.state = 'flee'; a.fleeT = 1.2; }
          wander(a, dt, world, 30, 110, 26);
        }
        break;
      }
      case 'goat': {
        if (scared && a.cool <= 0) { a.state = 'flee'; a.fleeT = 1.6; }
        if (a.state === 'flee') {
          a.fleeT -= dt;
          moveSmart(a, a.x - (player.x - a.x), a.y - (player.y - a.y), 108, dt, world);
          if (a.fleeT <= 0) a.state = 'wander';
        } else wander(a, dt, world, 26, 130, 34);
        break;
      }
      case 'boar': {
        const scaredOfFire = game.nearFire(a.x, a.y);
        const aggro = !scaredOfFire && (a.state === 'angry' || (night > 0.35 && dPlayer < 175));
        if (aggro && dPlayer < 320) {
          a.state = 'chase';
          moveSmart(a, player.x, player.y, 96, dt, world);
          if (dPlayer < a.r + player.r + 8 && a.cool <= 0) {
            a.cool = 1.9;
            player.hurt(6, game, 'الخنزير البري ضربك! 🐗');
          }
        } else if (dPlayer < 130) {
          a.state = 'flee'; a.fleeT = 1.0;
          moveToward(a, a.x - (player.x - a.x), a.y - (player.y - a.y), 86, dt, world);
        } else wander(a, dt, world, 22, 150, 30);
        break;
      }
      case 'crab': {
        if (dPlayer < 90) {
          // يجري على الماء
          const sp = 92;
          const t = world.tileAtWorld(a.x, a.y);
          const dirx = a.x - player.x, diry = a.y - player.y;
          moveToward(a, a.x + dirx, a.y + diry, sp, dt, world, true);
          if (t === 1) { game.world.removeAnimal(a); }
        } else {
          a.bob += dt * 6;
          if (Math.random() < 0.01) a.dir += (Math.random() - 0.5) * 2.4;
          if (a.t % 2 < 1.6) {
            const nx = a.x + Math.cos(a.dir) * 22 * dt, ny = a.y + Math.sin(a.dir) * 22 * dt;
            if (!world.blockedCircle(nx, ny, a.r, null) || true) { a.x = nx; a.y = ny; }
            a.x = clamp(a.x, 20, world.worldW() - 20); a.y = clamp(a.y, 20, world.worldH() - 20);
          }
        }
        break;
      }
    }
    a.bob += dt * (a.state === 'chase' || a.state === 'follow' ? 7 : 3.4);
  }
}

function wander(a, dt, world, speed, homeRange, turn) {
  if (a.t % 3.2 < dt * 1.05) {
    // اتجاه جديد، وغالباً نحو داره
    const hx = a.home.x - a.x, hy = a.home.y - a.y;
    const hd = Math.hypot(hx, hy);
    if (hd > homeRange) a.dir = Math.atan2(hy, hx);
    else a.dir += (Math.random() - 0.5) * 2.6;
  }
  const sp = speed * (0.75 + 0.5 * Math.sin(a.t * 0.7));
  const nx = a.x + Math.cos(a.dir) * sp * dt;
  const ny = a.y + Math.sin(a.dir) * sp * dt;
  const res = world.moveBody(a, nx - a.x, ny - a.y, a.r);
  if (res.hitX || res.hitY) a.dir += 1.9 + Math.random();
}

// بحال moveToward ولكن إلا مشا بلا ما يقرب للهدف (حجرة، شجرة، تخباط) كيدور عليها
function moveSmart(a, tx, ty, speed, dt, world) {
  if (a.moveAcc === undefined) { a.moveAcc = 0; a.stillT = 0; a.bestD = Math.hypot(tx - a.x, ty - a.y); }
  const dNow = Math.hypot(tx - a.x, ty - a.y);
  const wantAng = Math.atan2(ty - a.y, tx - a.x);

  // واقف فبلاصتو؟ ولا كيتزحلق بلا ما يقرب؟ (زوج الحالات = مسدود)
  if (a.lx === undefined) { a.lx = a.x; a.ly = a.y; }
  const movedNow = Math.hypot(a.x - a.lx, a.y - a.ly);
  a.lx = a.x; a.ly = a.y;
  a.moveAcc += movedNow;
  a.stillT = movedNow < Math.max(0.25, speed * dt * 0.25) ? a.stillT + dt : 0;
  if (dNow < a.bestD - 6) { a.bestD = dNow; a.moveAcc = 0; a.stillT = 0; }
  const blockedNow = a.stillT > 0.35 || a.moveAcc > 55;

  // كنكملو الخروج من التخباط حتى نحيدو التصادم
  if (a.squeeze) {
    const nx = a.x + Math.cos(a.escapeAng) * speed * dt, ny = a.y + Math.sin(a.escapeAng) * speed * dt;
    if (!world.blockedCircle(a.x, a.y, a.r) || !world.walkableAt(nx, ny, a.r)) { a.squeeze = false; a.moveAcc = 0; a.stillT = 0; a.bestD = dNow; }
    else {
      moveToward(a, a.x + Math.cos(a.escapeAng) * 60, a.y + Math.sin(a.escapeAng) * 60, speed * 0.9, dt, world, true);
      return;
    }
  }

  if (blockedNow) {
    // حجرة قدامنا → ندورو عليها
    a.moveAcc = 0; a.stillT = 0; a.bestD = dNow;
    // داخل حجرة/بناية (تخباط ولا بناية تنزلت فوقنا)؟ كنخرجو بلطف بلا تصادم
    if (world.blockedCircle(a.x, a.y, a.r)) {
      a.squeeze = true; a.escapeAng = wantAng;
      moveToward(a, tx, ty, speed * 0.9, dt, world, true);
      return;
    }
    if (a.side === undefined) a.side = Math.random() < 0.5 ? 1 : -1;
    const reach = a.r + 12;
    let detour = null;
    for (let i = 1; i <= 7; i++) {
      const ang = wantAng + a.side * i * 0.45;
      if (!world.blockedCircle(a.x + Math.cos(ang) * reach, a.y + Math.sin(ang) * reach, a.r)) { detour = ang; break; }
    }
    a.side = -a.side;
    if (detour !== null) { moveToward(a, a.x + Math.cos(detour) * 70, a.y + Math.sin(detour) * 70, speed, dt, world); return; }
    // مسدود من كل جيهة (تخباط بين حجرين) — كنخرجو فاتجاه الهدف بلا تصادم
    a.squeeze = true; a.escapeAng = wantAng;
    moveToward(a, tx, ty, speed * 0.9, dt, world, true);
    return;
  }
  moveToward(a, tx, ty, speed, dt, world);
}

function moveToward(a, tx, ty, speed, dt, world, ignoreBlock = false) {
  const dx = tx - a.x, dy = ty - a.y;
  const d = Math.hypot(dx, dy) || 1;
  a.dir = Math.atan2(dy, dx);
  const nx = (dx / d) * speed * dt, ny = (dy / d) * speed * dt;
  if (ignoreBlock) { a.x += nx; a.y += ny; return; }
  const res = world.moveBody(a, nx, ny, a.r);
  if (res.hitX) a.x += Math.cos(a.dir + Math.PI / 2) * speed * dt * 0.7;
  if (res.hitY) a.y += Math.sin(a.dir + Math.PI / 2) * speed * dt * 0.7;
}
