/* ============================================================================
 * Scam Baqi — main.js
 * البداية: الـrenderer، الحلقة، تبديل الأوضاع (قائمة / مكتب / ديسك)، التفاعلات.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, D = SWYF.data;
  var THREE = window.THREE;

  var renderer, camera, world, player, clockT = 0, started = false;
  var state = { mode: 'menu' };          // menu | office
  var buffs = { patience: 0 };
  var fps = { t: 0, n: 0, low: 0 };

  var M = {
    hooks: {}, keys: {}, buffs: buffs,
    get player() { return player; }, get world() { return world; }, get camera() { return camera; }
  };

  function boot() {
    var canvas = document.getElementById('scene');
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !SWYF.ui.isTouch(), powerPreference: 'high-performance' });
    } catch (e) {
      U.fail('ما قدرناش نفتحو WebGL — دخّل هاد الصفحة من متصفح فيه WebGL (Chrome/Firefox/Safari).\n' + e.message);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 90);

    world = SWYF.World.build();
    player = SWYF.Player.create(camera, world, canvas);
    SWYF.world = world;              // shared handles (used by day.js / calls.js)
    SWYF.player = player;
    var spawn = player.findFreeSpot(1.0, 1.0);
    player.teleport(spawn.x, spawn.z, -Math.PI / 2);
    player.onInteract = onInteract;

    // cinematic menu orbit
    player.setMode('cinematic', { r: 9 });
    if (world.flags.boss) world.flags.boss.say('مرحبا بيكم ف المكتب. الكوتا كتبدل.', 6000);

    // ---- desktop api
    SWYF.Desktop.init({
      sfx: function (n) { SWYF.audio.sfx[n] && SWYF.audio.sfx[n](); },
      isTouch: SWYF.ui.isTouch,
      getCaller: function () { return SWYF.Calls.active(); },
      getTargets: function () { return SWYF.Desktop.getTargets(); },
      getState: function () { return SWYF.Day.state(); },
      getTime: function () { return SWYF.Day.time(); },
      timeCost: function (secs) { /* the call clock keeps running for real */ },
      buy: function (id) { return SWYF.Day.buy(id); },
      evidence: function (kind, msg) { SWYF.ui.toast(msg); SWYF.Desktop.notify('files', msg); },
      hasEvidence: function () { return SWYF.Desktop.hasEvidence(); }
    });

    // ---- ui hooks
    SWYF.ui.init({
      player: player,
      seat: function (forCall) { seat(forCall); },
      onStart: startRun,
      onAction: doAction,
      onPause: pause,
      onResume: resume,
      onReviewGo: function () {},
      onShopGo: function () {},
      onWinContinue: function () { stand(); }
    });
    M.hooks = SWYF.ui;

    U.on(window, 'resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('error', function (e) { U.fail('خطأ: ' + (e.message || 'unknown')); });

    // menu
    var hasSave = !!U.load();
    U.toggle(document.getElementById('btn-continue'), hasSave);
    SWYF.ui.show('menu', true);
    SWYF.audio.music.start();

    started = true;
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ run flow
  function startRun(continueSave) {
    SWYF.audio.init();
    SWYF.audio.resume();
    SWYF.audio.music.start();
    SWYF.audio.music.set(SWYF.audio.music.isOn());
    SWYF.audio.ambience(true);
    SWYF.ui.show('menu', false);
    SWYF.Day.setPaused(false);
    if (continueSave) SWYF.Day.load();
    state.mode = 'office';
    var spot = player.findFreeSpot(1.2, 1.6);
    player.setMode('walk', { pos: new THREE.Vector3(spot.x, 0, spot.z) });
    player.yaw = -Math.PI / 2;
    SWYF.Day.startDay(SWYF.Day.state().day);
  }

  function toMenu() {
    state.mode = 'menu';
    SWYF.Day.setPaused(true);
    stand();
    SWYF.ui.hud(false);
    SWYF.ui.show('menu', true);
    player.setMode('cinematic', { r: 9 });
    SWYF.Desktop.setVisible(false);
    SWYF.Desktop.closeAll();
    SWYF.audio.ambience(false);
  }

  function pause() {
    if (state.mode !== 'office') return;
    SWYF.Day.setPaused(true);
    SWYF.ui.show('pause', true);
    if (player.locked && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function resume() {
    SWYF.Day.setPaused(false);
    SWYF.ui.show('pause', false);
  }

  // -------------------------------------------------------------- desk / stand
  function seat(forCall) {
    if (state.mode !== 'office') return;
    player.setMode('desk', {
      pos: new THREE.Vector3(2.62, 1.30, 0.22),
      look: new THREE.Vector3(3.12, 1.22, 1.28)
    });
    U.show(document.getElementById('btn-stand'));
    U.hide(document.getElementById('interact'));
    setTimeout(function () {
      SWYF.Desktop.setVisible(true);
      if (!SWYF.Desktop.isVisible()) return;
      if (forCall || SWYF.Calls.active()) SWYF.Desktop.open('phone');
    }, 420);
  }
  function stand() {
    var spot = player.findFreeSpot(1.1, -0.5);
    player.setMode('walk', { pos: new THREE.Vector3(spot.x, 0, spot.z) });
    player.yaw = -Math.PI / 2;
    SWYF.Desktop.setVisible(false);
    U.hide(document.getElementById('btn-stand'));
    state.seated = false;
  }

  // -------------------------------------------------------------- interactions
  function doAction() {
    if (state.mode !== 'office') return;
    if (player.mode === 'desk') { return; }
    if (player.nearest) onInteract(player.nearest);
  }

  function onInteract(it) {
    if (player && player.mode === 'desk') { stand(); return; }   // E while seated = stand up
    if (!it) { SWYF.ui.toast('ما كايناش شي حاجة قريبة — سير قرب من الديسك ولا من شي حاجة.', 2000); return; }
    SWYF.audio.sfx('click');
    switch (it.kind) {
      case 'desk': seat(false); break;
      case 'coffee':
        SWYF.audio.sfx('success');
        buffs.patience = 20;
        SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves + 6, 0, 100);
        SWYF.ui.toast('☕ قهوة! المكالمة الجاية غادي يكون فيها +20 ثانية ديال الصبر.', 3200);
        SWYF.ui.refreshHud();
        break;
      case 'water':
        SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves + 9, 0, 100);
        SWYF.audio.sfx('blip', 0.6);
        SWYF.ui.toast('💧 شربتي الما — راسك رجع صافي.', 2200);
        SWYF.ui.refreshHud();
        break;
      case 'shelter':
        SWYF.Day.inShelter();
        SWYF.ui.toast('🛡️ راك ف البلاصة المحمية. حسّن… راك محمي.', 2200);
        break;
      case 'radio':
        SWYF.audio.music.set(!SWYF.audio.music.isOn());
        SWYF.ui.toast(SWYF.audio.music.isOn() ? '🎵 الراديو خدام.' : '🔇 الراديو تسدّ.', 1600);
        break;
      case 'vending':
        if (SWYF.Day.S.cash >= 30) {
          SWYF.Day.S.cash -= 30;
          SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves + 12, 0, 100);
          SWYF.audio.sfx('coin');
          SWYF.ui.toast('🍫 شريتي شي حاجة حلوة ب 30 درهم — التوتر نقص.', 2600);
          SWYF.ui.refreshHud();
        } else SWYF.ui.toast('💸 ما كايناش فلوس كافيين.', 1800);
        break;
      case 'board':
        SWYF.ui.showBoard();
        break;
      case 'boss':
      case 'bossnpc':
        talkBoss();
        break;
      case 'npc':
        talkCoworker(it.npc);
        break;
    }
  }

  function talkBoss() {
    var st = SWYF.Day.state();
    var line = st.earnedToday >= st.quota
      ? U.pick(['«مزيان! كمّل هكاك و غادي نفكرو ف الترقية.»', '«شفت؟ منين كيتخدمو العقول، الفلوس كتجي.»'])
      : U.pick(['«سير خدمة، ما عندي وقت للهضرة!»', '«الكوتا! باقي ما وصلتيش!»', '«واش عارف شحال من واحد كيتمنا بلاصتك؟»']);
    SWYF.audio.speak(line.replace(/[«»]/g, ''), { pitch: 0.55, rate: 0.95 });
    if (world.flags.boss) world.flags.boss.say(line.replace(/[«»]/g, ''), 5000);
    SWYF.ui.toast('👔 السيد بولعيد: ' + line, 5200);
    SWYF.Desktop.notify('boss', line);
    SWYF.ui.shake(0.02, 0.25);
  }

  function talkCoworker(npc) {
    var line = U.pick(npc.lines);
    if (npc.obj && npc.obj.say) npc.obj.say(line.replace(/[«»]/g, ''), 5200);
    SWYF.audio.speak(line.replace(/[«»]/g, ''), { pitch: npc.voice === 'f' ? 1.35 : 0.9 });
    SWYF.ui.toast('🧑‍💼 ' + npc.name + ': ' + line, 5200);
    SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves + 3, 0, 100);
    SWYF.ui.refreshHud();
  }

  // -------------------------------------------------------------------- loop
  var last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    var paused = document.getElementById('pause') && !document.getElementById('pause').classList.contains('hidden');
    if (!SWYF.Day.S.paused && !paused) {
      player.update(dt);
      world.update(dt, player.pos);
      SWYF.Calls.tick(dt);
      SWYF.Day.update(dt);
      // interaction prompt
      if (state.mode === 'office' && player.mode === 'walk') {
        player.findNearest();
        SWYF.ui.setInteract(player.nearest ? player.nearest.label : null);
      }
    }
    // taskbar clock
    clockT += dt;
    if (clockT > 0.5) {
      clockT = 0;
      var c = document.getElementById('dt-clock');
      var q = document.getElementById('dt-quota');
      if (c) c.textContent = U.minutes(SWYF.Day.time());
      if (q) q.textContent = '🎯 ' + U.money(Math.max(0, SWYF.Day.state().earnedToday)) + ' / ' + U.money(SWYF.Day.state().quota);
      SWYF.ui.refreshHud();
    }
    renderer.render(world.scene, camera);

    // cheap adaptive quality
    fps.t += dt; fps.n++;
    if (fps.t > 3) {
      var f = fps.n / fps.t;
      if (f < 26) { fps.low++; if (fps.low >= 2 && renderer.getPixelRatio() > 0.8) { renderer.setPixelRatio(0.8); fps.low = 0; } }
      else fps.low = 0;
      fps.t = 0; fps.n = 0;
    }
  }

  M.boot = boot;
  M.pause = pause;
  M.resume = resume;
  M.toMenu = toMenu;
  M.seat = seat;
  M.stand = stand;
  M.state = state;
  SWYF.main = M;

  if (document.readyState === 'loading') U.on(document, 'DOMContentLoaded', boot);
  else boot();
})();
