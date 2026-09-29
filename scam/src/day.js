/* ============================================================================
 * Scam Baqi — day.js
 * حلقة اللعبة: الشيفت، الكولات، الكوتا، الأحداث الخطيرة، تقييم البوس، الترقيات.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;

  var S = {
    phase: 'menu',            // menu | brief | shift | review | shop | gameover | win
    day: 1, cash: 400, quota: D.boss.quotaStart, earnedToday: 0,
    shiftT: 0, shiftLen: 300,   // real seconds
    upgrades: {}, nerves: 100, stinkBombs: 0, balls: 0, meeting: null,
    stats: { answered: 0, landed: 0, totalEarned: 0, daysSurvived: 0, viruses: 0, raids: 0, strikes: 0, lessons: 0 },
    handled: 0, scamsLanded: 0,
    ring: null, ringT: 8, nextIn: 0,
    targets: [], currentEvent: null, eventT: 0, paused: false,
    virusT: 0, inspecting: false, lastOutcome: null, runOver: false
  };

  var events = [
    { id: 'boss_rage', weight: 22, min: 1, kind: 'flavor' },
    { id: 'coworker', weight: 16, min: 1, kind: 'flavor' },
    { id: 'power', weight: 10, min: 2, kind: 'walk' },
    { id: 'virus', weight: 14, min: 2, kind: 'hud' },
    { id: 'raid', weight: 11, min: 3, kind: 'hud' },
    { id: 'inspector', weight: 9, min: 3, kind: 'hud' },
    { id: 'strike', weight: 9, min: 4, kind: 'walk' },
    { id: 'meeting', weight: 13, min: 1, kind: 'walk' }
  ];

  function hooks() { return SWYF.main.hooks; }

  // -------------------------------------------------------------------- state
  function state() {
    return {
      phase: S.phase, day: S.day, cash: S.cash, quota: S.quota, earnedToday: S.earnedToday,
      upgrades: S.upgrades, nerves: S.nerves, answered: S.stats.answered, handled: S.handled,
      scamsLanded: S.scamsLanded, daysSurvived: S.stats.daysSurvived, totalEarned: S.stats.totalEarned
    };
  }
  function time() { return (S.shiftT / S.shiftLen) * 540 + 9 * 60; }   // 09:00 → 18:00
  function progress() { return U.clamp(S.shiftT / S.shiftLen, 0, 1); }
  function upgrades() { return S.upgrades; }

  // -------------------------------------------------------------------- save
  function save() {
    U.save({
      day: S.day, cash: S.cash, upgrades: S.upgrades, nerves: S.nerves,
      stats: S.stats, lessons: SWYF.Desktop ? SWYF.Desktop.lessons() : [], ts: Date.now()
    });
  }
  function load() {
    var d = U.load();
    if (!d) return false;
    S.day = d.day || 1; S.cash = d.cash == null ? 400 : d.cash;
    S.upgrades = d.upgrades || {}; S.nerves = d.nerves == null ? 100 : d.nerves;
    if (d.stats) S.stats = Object.assign(S.stats, d.stats);
    if (d.lessons && SWYF.Desktop) d.lessons.forEach(function (l) { SWYF.Desktop.addLesson(l); });
    return true;
  }

  // ------------------------------------------------------------------- shift
  function startDay(n) {
    if (n) S.day = n;
    S.contribution = {};
    S.quota = D.boss.quotaStart + (S.day - 1) * 700;
    S.earnedToday = 0; S.shiftT = 0; S.shiftLen = Math.max(220, 300 - (S.day - 1) * 12);
    S.handled = 0; S.scamsLanded = 0; S.nerves = U.clamp(S.nerves + 12, 0, 100);
    S.meeting = null; SWYF.ui.meetingBanner('', '', false);
    S.ring = null; S.currentEvent = null; S.eventT = 0; S.virusT = 0;
    S.targets = []; S.ringT = U.rnd(6, 12); S.phase = 'brief';
    for (var i = 0; i < 4; i++) S.targets.push(planTarget(i));
    SWYF.Desktop.setTargets(S.targets.map(function (t) {
      return { name: t.name, city: t.city, job: t.job, persona: t.persona, tip: t.tip, done: false };
    }));
    SWYF.ui.showBrief(S.day, S.quota, function () {
      S.phase = 'shift';
      SWYF.ui.hud(true);
      SWYF.Desktop.notify('disscord', '👔 البوس: «الكوتا ديال اليوم ' + U.money(S.quota) + '. سيرو خدمة!»');
    });
    save();
  }

  function planTarget(i) {
    var c = SWYF.callers.createCaller({ day: S.day + (i > 2 ? 1 : 0), upgrades: S.upgrades });
    c.tip = {
      kind: 'كيهضر بالتفصيل — خليه يهضر و دير المدح.',
      fearful: 'خوّاف: «البنك»، «المصلحة»، «الغرامة» كيديرو مفعول.',
      skeptic: 'شكّاك: الوثيقة، رقم الملف، و الصبر. بلا استعجال.',
      greedy: 'طمّاع: الجايزة، النسبة، «بزاف فلوس».',
      proud: 'مغرور: مدحو و قول ليه «مختار».',
      grumpy: 'عصبي: هضر قصير و مباشر.',
      lonely: 'وحيد: كلام عاطفي و صحاب.',
      savvy: 'واعي: خطر! إلا غلطت، كيسد التيليفون.'
    }[c.persona.id];
    return c;
  }

  // ------------------------------------------------------------------ ringing
  function startRing() {
    var c = S.targets.shift() || planTarget(0);
    if (!c) return;
    S.ring = { caller: c, t: 18 };
    SWYF.audio.sfx('ring');
    SWYF.ui.showRing(c, 18, {
      answer: function () { answer(c); },
      reject: function () { missCall(c, true); }
    });
  }

  function answer(c) {
    if (!S.ring) return;
    S.ring = null;
    SWYF.ui.hideRing();
    S.phase = 'shift';
    SWYF.audio.sfx('connect');
    SWYF.ui.seatForCall();
    setTimeout(function () {
      SWYF.Desktop.setVisible(true);
      SWYF.Desktop.open('phone');
      SWYF.Calls.begin(c);
    }, 420);
  }

  function missCall(c, manual) {
    S.ring = null;
    SWYF.ui.hideRing();
    S.nerves = U.clamp(S.nerves - (manual ? 4 : 9), 0, 100);
    SWYF.audio.sfx('hangup');
    if (!manual) {
      SWYF.Desktop.notify('boss', '«كولاية ضاعت! هادشي كيتحسب عليك.»');
      S.missed = (S.missed || 0) + 1;
    }
    S.targets.push(c);   // they can call back later
    S.ringT = U.rnd(18, 32);
  }

  function finishCall(res) {
    S.handled++;
    if (res.money > 0) S.scamsLanded++;
    var t = SWYF.Desktop.getTargets();
    for (var i = 0; i < t.length; i++) if (t[i].name === res.caller.name) t[i].done = res.outcome === 'success' || res.money > 0;
    SWYF.Desktop.setTargets(t);
    if (res.outcome === 'scambaiter') {
      S.nerves = U.clamp(S.nerves - 22, 0, 100);
      S.stats.viruses++;
      SWYF.Desktop.notify('boss', '«فيروس ف المكتب! شكون سمح بهادشي؟»');
    } else if (res.outcome === 'hungup') {
      S.nerves = U.clamp(S.nerves - 8, 0, 100);
    } else if (res.money > 0) {
      S.nerves = U.clamp(S.nerves + 5, 0, 100);
    }
    S.ringT = U.rnd(16, 30) - Math.min(8, S.day);
    SWYF.ui.refreshHud();
    save();
  }

  function takeMoney(amount, caller) {
    S.earnedToday += amount;
    S.stats.totalEarned += amount;
    SWYF.ui.refreshHud();
    SWYF.ui.flashQuota(amount);
  }

  function infect(why) {
    S.stats.viruses++;
    SWYF.ui.virus(true);
    SWYF.audio.sfx('virus');
    S.virusT = 26;
    S.nerves = U.clamp(S.nerves - 12, 0, 100);
    SWYF.ui.toast('🦠 فيروس! نيّت الشاشة الزرقاء و كليكي على زر التنظيف قبل ما تسالي المدة.');
  }

  // ------------------------------------------------------------------- events
  function scheduleEvent() {
    var pool = events.filter(function (e) { return e.min <= S.day; });
    var total = pool.reduce(function (a, e) { return a + e.weight; }, 0);
    var r = Math.random() * total, chosen = pool[0];
    for (var i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { chosen = pool[i]; break; } }
    runEvent(chosen.id);
  }

  function runEvent(id) {
    S.currentEvent = id;
    switch (id) {
      case 'boss_rage': {
        var line = U.pick(D.boss.lines.bad.concat(D.boss.lines.great ? [U.pick(D.boss.lines.great)] : []));
        SWYF.audio.sfx('boo');
        SWYF.ui.shake(0.04, 0.5);
        SWYF.Desktop.notify('boss', line);
        var v = SWYF.world.flags.boss;
        if (v && v.say) v.say(line.replace(/[«»]/g, ''));
        if (Math.random() < 0.5) {
          setTimeout(function () { SWYF.audio.sfx('stapler'); SWYF.ui.shake(0.06, 0.4); }, 700);
        }
        S.nerves = U.clamp(S.nerves - 6, 0, 100);
        break;
      }
      case 'meeting': {
        if (S.meeting) break;                    // one meeting at a time
        // purple banner: walk to the conference room before the door closes
        SWYF.ui.meetingBanner('Meeting is about to start!', 'الاجتماع غادي يبدا ف قاعة الاجتماعات — سير دابا (', true);
        if (SWYF.audio.sfx) SWYF.audio.sfx('boss');
        SWYF.Desktop.notify('boss', '🟣 Meeting is about to start in the conference room!');
        S.meeting = { t: 28, done: false };
        break;
      }
      case 'coworker': {
        var cw = U.pick(SWYF.world.npcs);
        var line2 = U.pick([D.events.coworker_coffee, D.events.coworker_cover, D.events.coworker_tip]).replace('{co}', cw.name);
        cw.obj.say(line2.replace(/[«»{}]/g, ''), 6000);
        SWYF.audio.sfx('notify');
        SWYF.ui.toast('🧑‍💼 ' + cw.name + ': ' + line2);
        S.eventAwait = { type: 'coworker', npc: cw, t: 40, done: false };
        break;
      }
      case 'power': {
        SWYF.audio.sfx('power');
        SWYF.world.setPower(false);
        SWYF.ui.toast('⚡ الضو تقطع! سير للـ«قاطع» اللي بحدا الماكينة و شعلو (زر تفاعل).');
        S.eventAwait = { type: 'power', t: 30, done: false };
        break;
      }
      case 'virus': {
        infect('event');
        break;
      }
      case 'raid': {
        S.stats.raids++;
        SWYF.audio.sfx('siren');
        SWYF.ui.vignette('red');
        SWYF.ui.alert('🚨 مداهمة!!', 'الشرطة كتسول على «رخصة المكتب». عندك 16 ثانية باش تنقّي الديسكتوب. اضغط الزر الأحمر دابا!',
          '🗑️ نظّف الملفات دابا', 16, function () {
            SWYF.ui.vignette(null);
            SWYF.ui.toast('✅ الديسكتوب نقّي. الشرطة مشات — بالسلامة!');
            SWYF.Desktop.notify('boss', '«شفت؟ منين تكون ذكي، ما كايناش مشاكل.»');
            S.nerves = U.clamp(S.nerves + 6, 0, 100);
          }, function () {
            SWYF.ui.vignette(null);
            SWYF.ui.toast('❌ الملفات بقاو محلولين… البوس غادي يسمع بيك.');
            SWYF.Desktop.notify('boss', '«الشرطة عندنا ف الباب و نتا كتشرب أتاي؟! ناقص 400 درهم من الكوتا.»');
            S.earnedToday -= 400; S.nerves = U.clamp(S.nerves - 20, 0, 100);
            if (SWYF.world.setFired) SWYF.world.setFired(true);
            SWYF.ui.refreshHud();
          });
        break;
      }
      case 'inspector': {
        SWYF.ui.alert('🕴️ مفتش!', 'شي واحد ببذلة كيسول على «رخصة المكتب». خاصك تجاوبو بلا ما تشكّ.',
          '🕴️ استقبل المفتش (بلا شك)', 15, function () {
            SWYF.ui.toast('✅ المفتش مشى — جاوبتيه بثبات.');
            S.nerves = U.clamp(S.nerves + 4, 0, 100);
          }, function () {
            SWYF.ui.toast('❌ المفتش دار تقرير… البوس غادي يزعل.');
            SWYF.Desktop.notify('boss', '«التقرير وصل! ناقص 300 درهم.»');
            S.earnedToday -= 300;
            S.nerves = U.clamp(S.nerves - 14, 0, 100);
          });
        break;
      }
      case 'strike': {
        S.stats.strikes++;
        SWYF.audio.sfx('alarm');
        SWYF.ui.alert('🚁 ضربة جوية!', 'النيّت ديال الضربة جاي على المبنى. سير للطبلة المحمية (تحت الطبلة الكحلا ف الزاوية) و احتمي!',
          '🏃 فهمت، غادي نجري', 14, function () {
            S.eventAwait = { type: 'strike', t: 14, done: false };
            SWYF.ui.toast('🏃 سير للطبلة المحمية — عندك 14 ثانية!');
          }, function () {
            SWYF.world.fireball(SWYF.world.flags.shelter, function () {});
            SWYF.audio.sfx('boom');
            SWYF.ui.shake(0.12, 1.2);
            SWYF.ui.toast('💥 الضربة طاحت فوق المكتب! ناقص 25 توتر… و الزجاج تكسّر.');
            S.nerves = U.clamp(S.nerves - 25, 0, 100);
          });
        break;
      }
    }
    SWYF.ui.refreshHud();
  }

  // -------------------------------------------------------- event interactions
  function tryInteractPower() {
    SWYF.world.setPower(true);
    SWYF.audio.sfx('success');
    SWYF.ui.toast('💡 الضو رجع!');
    if (S.eventAwait && S.eventAwait.type === 'power') S.eventAwait = null;
  }
  function inShelter() {
    if (S.eventAwait && S.eventAwait.type === 'strike' && !S.eventAwait.done) {
      S.eventAwait.done = true;
      SWYF.ui.toast('🛡️ راك محمي تحت الطبلة — الضربة دازت.');
      SWYF.audio.sfx('boom');
      setTimeout(function () { SWYF.audio.sfx('chime'); }, 900);
      S.nerves = U.clamp(S.nerves + 8, 0, 100);
      SWYF.Desktop.notify('boss', '«شفتو؟ هادا التلاميذ اللي كيعرفو. برافو.»');
      SWYF.ui.refreshHud();
    }
  }

  // -------------------------------------------------------------------- update
  function update(dt) {
    if (S.paused) return;
    if (S.phase !== 'shift' && S.phase !== 'brief') return;
    if (S.phase === 'shift') {
      S.shiftT += dt;
      SWYF.world.setShift(progress());
    }
    // door for the brief: auto-start after the overlay closes (ui handles)

    // calls
    if (S.phase === 'shift' && !SWYF.Calls.active()) {
      if (S.ring) {
        S.ring.t -= dt;
        if (S.ring.t <= 0) missCall(S.ring.caller, false);
      } else {
        S.ringT -= dt;
        if (S.ringT <= 0) startRing();
      }
    }

    // events
    if (S.phase === 'shift') {
      S.eventT -= dt;
      if (S.eventT <= 0 && !SWYF.Calls.active()) {
        S.eventT = U.rnd(24, 46) - Math.min(12, S.day);
        scheduleEvent();
      }
      if (S.eventAwait) {
        S.eventAwait.t -= dt;
        if (S.eventAwait.type === 'strike' && S.eventAwait.done) S.eventAwait = null;
        if (S.eventAwait.t <= 0 && !S.eventAwait.done) { S.eventAwait = null; }
      }
      // ---- the meeting: be in the conference room before it closes ----------
      if (S.meeting && !S.meeting.done) {
        S.meeting.t -= dt;
        var ms = SWYF.world && SWYF.world.flags && SWYF.world.flags.meetingSpot;
        var pl = SWYF.player;
        var near = ms && pl && pl.pos && (Math.abs(pl.pos.x - ms.x) < 2.0 && Math.abs(pl.pos.z - ms.z) < 2.2);
        var banner = document.getElementById('meeting');
        if (banner && !banner.classList.contains('hidden')) {
          var b2 = banner.querySelector('span');
          if (b2) b2.textContent = 'الاجتماع غادي يبدا ف قاعة الاجتماعات — باقي ' + Math.max(0, Math.round(S.meeting.t)) + ' ثانية';
        }
        if (near) {
          S.meeting.done = true;
          SWYF.ui.meetingBanner('', '', false);
          S.nerves = U.clamp(S.nerves + 10, 0, 100);
          var bl = '«مبروك عليكم، جيتو ف الوقت. هاد شي فريق كيحترم.»';
          if (SWYF.world.flags.boss && SWYF.world.flags.boss.say) SWYF.world.flags.boss.say(bl, 5000);
          SWYF.Desktop.addLesson('📌 الاجتماع: الحضور ف الوقت كيرفع الثقة… و الغياب كيتسجل.');
          SWYF.ui.toast('✅ حضرت الاجتماع — +10 أعصاب', 3200);
          S.meeting = null;
        } else if (S.meeting.t <= 0) {
          S.meeting.done = true;
          SWYF.ui.meetingBanner('', '', false);
          S.nerves = U.clamp(S.nerves - 16, 0, 100);
          SWYF.ui.toast('❌ فوتّي الاجتماع — البوس كتب عليك غياب (-16)', 3600);
          SWYF.audio.sfx('boo');
          if (SWYF.world.flags.boss && SWYF.world.flags.boss.say) SWYF.world.flags.boss.say('«الاجتماع… و نتا فين؟ هاد الغياب غادي نتفكر.»', 5200);
          S.meeting = null;
        }
      }
      // nerves recovery
      S.nerves = U.clamp(S.nerves + dt * 0.25, 0, 100);
    }

    // virus countdown
    if (S.virusT > 0) {
      S.virusT -= dt;
      if (S.virusT <= 0) { SWYF.ui.virus(false); S.virusT = 0; }
    }

    // end of shift
    if (S.phase === 'shift' && S.shiftT >= S.shiftLen) {
      if (SWYF.Calls.active()) { SWYF.ui.toast('⏰ سالى الوقت! كمّل المكالمة…'); S.shiftT = S.shiftLen; }
      else endShift();
    }
  }

  function endShift() {
    S.phase = 'review';
    if (S.meeting) { S.meeting = null; SWYF.ui.meetingBanner('', '', false); }
    SWYF.ui.hud(false);
    SWYF.ui.hideRing();
    SWYF.audio.sfx('door');
    var passed = S.earnedToday >= S.quota;
    var ratio = S.quota > 0 ? S.earnedToday / S.quota : 1;
    var rating = ratio >= 1.6 ? 'great' : ratio >= 1.15 ? 'ok' : 'bad';
    if (!passed) rating = 'fired';
    S.lastOutcome = { passed: passed, rating: rating, earned: S.earnedToday, quota: S.quota };
    // your cut for the shop
    if (passed) {
      S.cash += Math.round(S.earnedToday * 0.35) + (rating === 'great' ? 1500 : 0);
      S.stats.daysSurvived++;
    }
    SWYF.world.setFired(!passed);
    SWYF.ui.showReview(S.lastOutcome, function () {
      if (!passed) { gameOver(); return; }
      if (S.day >= 7) { win(); return; }
      S.phase = 'shop';
      SWYF.ui.showShopBetweenDays(function () {
        S.day++;
        startDay();
      });
    });
    save();
  }

  function gameOver() {
    S.phase = 'gameover'; S.runOver = true;
    SWYF.ui.hud(false);
    SWYF.audio.music.stop();
    SWYF.audio.sfx('boo');
    SWYF.ui.showGameOver(S.stats, S.day);
    save();
  }
  function win() {
    S.phase = 'win'; S.runOver = true;
    SWYF.ui.hud(false);
    SWYF.audio.music.stop();
    SWYF.audio.sfx('chime');
    SWYF.ui.showWin(S.stats, S.day, S.cash);
    save();
  }

  // ---------------------------------------------------------------------- shop
  function buy(id) {
    var up = null;
    for (var i = 0; i < D.upgrades.length; i++) if (D.upgrades[i].id === id) up = D.upgrades[i];
    if (!up || S.cash < up.price) return false;
    if (up.consumable) {
      S.cash -= up.price;
      if (id === 'stink') S.stinkBombs = (S.stinkBombs || 0) + 3;
      else if (id === 'balls') S.balls = (S.balls || 0) + 5;
      else if (id === 'chips') S.cash += 800;
      SWYF.audio.sfx('cash');
      SWYF.ui.refreshHud();
      return true;
    }
    if (S.upgrades[id]) return false;
    S.cash -= up.price;
    S.upgrades[id] = 1;
    SWYF.ui.refreshHud();
    save();
    return true;
  }

  // -------------------------------------------------------------------- public
  SWYF.Day = {
    S: S, state: state, time: time, progress: progress, upgrades: upgrades,
    startDay: startDay, update: update, takeMoney: takeMoney, finishCall: finishCall,
    infect: infect, buy: buy, save: save, load: load, answer: answer, missCall: missCall,
    startRing: startRing, tryInteractPower: tryInteractPower, inShelter: inShelter,
    scheduleEvent: scheduleEvent, runEvent: runEvent,
    setPaused: function (v) { S.paused = v; },
    resetRun: function () {
      U.wipe();
      S.day = 1; S.cash = 400; S.upgrades = {}; S.nerves = 100;
      S.stats = { answered: 0, landed: 0, totalEarned: 0, daysSurvived: 0, viruses: 0, raids: 0, strikes: 0, lessons: 0 };
      S.runOver = false;
      if (SWYF.Desktop) SWYF.Desktop.reset();
    }
  };
})();
