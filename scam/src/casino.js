/* ============================================================================
 * Scam Baqi — casino.js
 * The neon casino next door: TREASURE CHAMBER slot machines, the DUCK RACE, a
 * blackjack table and the results board — exactly the vibe of the reference.
 *
 * 3D room built procedurally + DOM game panels. Everything offline.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util, ART = SWYF.art;
  var THREE = window.THREE;

  var built = null;
  var ui = null;
  var state = { slots: null, race: null, cards: null, spins: 0, races: 0, hands: 0, net: 0 };
  var SLOT_SYMBOLS = ['🪙', '🪲', '☥', '👁️', '🐍', '💎', '🏺'];
  var SLOT_PAY = { 3: 6, 2: 1.4 };

  // -------------------------------------------------------------------- money
  function cash() { return SWYF.Day ? SWYF.Day.S.cash : 0; }
  function addCash(d) {
    if (!SWYF.Day) return;
    SWYF.Day.S.cash = Math.max(0, SWYF.Day.S.cash + d);
    if (SWYF.ui) SWYF.ui.refreshHud();
  }
  function burnTime(secs) {
    if (SWYF.Day && SWYF.Day.S.phase === 'shift') SWYF.Day.S.shiftT += secs;
  }
  function riskBoss() {
    if (!SWYF.Day || SWYF.Day.S.phase !== 'shift') return;
    if (Math.random() < 0.18) {
      SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves - 10, 0, 100);
      if (SWYF.ui) {
        SWYF.ui.toast('👔 البوس شافك قريب من الطاولة… رجّع راسك للديسك!', 4200);
        SWYF.audio.sfx('boss');
      }
    }
  }

  // --------------------------------------------------------------------- room
  function build(ctx) {
    var root = ctx.root, addCollider = ctx.addCollider, flags = ctx.flags, scene = ctx.scene;
    var officeW = ctx.W;
    var W = 20, D = 20, H = 4.2;
    var ox = officeW / 2 + W / 2;               // east of the office

    var g = new THREE.Group();
    g.position.set(ox, 0, 0);
    root.add(g);

    function wall(x, z, w, d, mat, h) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h || H, d), mat);
      m.position.set(x, (h || H) / 2, z);
      m.receiveShadow = true;
      g.add(m); return m;
    }

    // floor + ceiling
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: ART.casinoCarpet(), roughness: 0.75 }));
    floor.rotation.x = -Math.PI / 2; g.add(floor);
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), ART.flat(0x140e2b, { rough: 1 }));
    ceil.position.y = H; g.add(ceil);

    // checkered walls + neon strips
    var wallMat = new THREE.MeshStandardMaterial({ map: ART.checkerWall('#3a2456', '#2a1b40'), roughness: 0.85 });
    wall(0, -D / 2, W, 0.2, wallMat);
    wall(0, D / 2, W, 0.2, wallMat);
    wall(-W / 2, 0, 0.2, D, new THREE.MeshStandardMaterial({ color: 0x2b1e46, roughness: 0.9 }));
    wall(W / 2, 0, 0.2, D, wallMat);

    // neon ceiling tubes
    [[-4, -4, 0xff4fd8], [4, -4, 0x4fd0ff], [-4, 4, 0xffd447], [4, 4, 0x9b5cff]].forEach(function (p) {
      var tube = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.08), ART.basic(p[2]));
      tube.position.set(p[0], H - 0.3, p[1]); g.add(tube);
      var l = new THREE.PointLight(p[2], 0.75, 9, 2);
      l.position.set(p[0], H - 0.55, p[1]); g.add(l);
    });
    var amb = new THREE.PointLight(0x6a4fd0, 0.5, 26, 2);
    amb.position.set(0, 3.4, 0); g.add(amb);

    // ---- big neon signs
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 2.8), new THREE.MeshBasicMaterial({ map: ART.neonTexture('DUCK RACE', '#ff4fd8', { sub: 'سباق البط 🦆' }), transparent: true, side: THREE.DoubleSide }));
    sign.position.set(0, 3.1, -D / 2 + 0.14); g.add(sign);
    var sign2 = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4), new THREE.MeshBasicMaterial({ map: ART.neonTexture('CASINO ROYALE', '#ffd447', { sub: 'BARAKA · 24/7' }), transparent: true, side: THREE.DoubleSide }));
    sign2.position.set(W / 2 - 0.16, 3.0, 0); sign2.rotation.y = -Math.PI / 2; g.add(sign2);
    var crown = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: ART.neonTexture('♛', '#ffd447', { font: 'bold 260px' }), transparent: true, side: THREE.DoubleSide }));
    crown.position.set(-W / 2 + 0.16, 3.0, -3); crown.rotation.y = Math.PI / 2; g.add(crown);

    // ---- door back to the office
    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.2), ART.flat(0xff4fd8, { emissive: 0x66115a, ei: 0.7 }));
    doorFrame.position.set(-W / 2 + 0.1, 1.3, 5); g.add(doorFrame);
    var doorHole = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.3), ART.basic(0x0b0f18));
    doorHole.position.set(-W / 2 + 0.21, 1.2, 5); doorHole.rotation.y = Math.PI / 2; g.add(doorHole);

    // ---- TREASURE CHAMBER slot machines (3 in a row)
    var slots = [];
    for (var s = 0; s < 3; s++) {
      var m = buildSlotMachine(s === 0 ? 'TREASURE CHAMBER' : (s === 1 ? 'GOLDEN SCARAB' : 'LUCKY ANKH'), s);
      m.position.set(-5.2 + s * 5.2, 0, -7.4);
      m.rotation.y = 0;
      g.add(m);
      slots.push({ group: m, screen: m.userData.screen, glow: m.userData.glow, reels: m.userData.reels, canvas: m.userData.canvas });
      addCollider(ox - 5.2 + s * 5.2, -7.4, 1.4, 1.0, 0.1);
    }
    built = { group: g, ox: ox, W: W, D: D, H: H, slots: slots };

    // ---- DUCK RACE lane board (rigged fun)
    var race = buildRaceBoard();
    race.group.position.set(0, 0, 2.6);
    g.add(race.group);
    built.race = race;
    addCollider(ox, 2.6, 6.2, 2.6, 0.1);
    // neon "MIDNIGHT DASH" arcade next to it
    var arcade = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: ART.neonTexture('WIN', '#4fd0ff', { sub: '3 IN A ROW', font: 'bold 220px' }), transparent: true, side: THREE.DoubleSide }));
    arcade.position.set(7.6, 2.0, 6.6); g.add(arcade);

    // ---- blackjack table
    var table = buildBlackjackTable();
    table.group.position.set(-6.4, 0, 4.6);
    g.add(table.group);
    addCollider(ox - 6.4, 4.6, 2.6, 2.0, 0.1);

    // ---- results board (black board, red digits, like the reference)
    var boardCanvas = ART.canvas(512, 384, function (gg, w, h) {
      gg.fillStyle = '#0d0d0f'; gg.fillRect(0, 0, w, h);
      gg.strokeStyle = '#2a2a2e'; gg.lineWidth = 8; gg.strokeRect(6, 6, w - 12, h - 12);
      gg.fillStyle = '#ff3b3b'; gg.font = 'bold 52px monospace'; gg.textAlign = 'left';
      var rows = state.board || ['BACCARAT', '17:18', '17:6', '17:9', 'DUCKS 4'];
      rows.forEach(function (r, i) { gg.fillText(r, 26, 76 + i * 62); });
    });
    var boardTex = ART.tex(boardCanvas);
    var board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshBasicMaterial({ map: boardTex }));
    board.position.set(6.6, 1.9, -2.4); board.rotation.y = -Math.PI / 2; g.add(board);
    built.board = { mesh: board, canvas: boardCanvas, tex: boardTex };

    // ---- crates, neon props
    for (var i = 0; i < 8; i++) {
      var b = ART.boxProp(U.rnd(0.4, 0.7), ART.pick([0x7a4fd0, 0x3b6fd9, 0xd94f8a, 0x4fd08a]));
      var pos = new THREE.Vector3(U.rnd(-8, 8), b.geometry.parameters.height / 2, U.rnd(-8, 8));
      b.position.copy(pos); g.add(b);
      SWYF.physics.addBody(b, { r: 0.35, restitution: 0.5 });
    }

    // ---- casino entrance lights on the office side
    var entrance = new THREE.PointLight(0xff4fd8, 0.8, 8, 2);
    entrance.position.set(officeW / 2 + 1.2, 2.2, 5);
    root.add(entrance);

    flags.casinoEntry = new THREE.Vector3(officeW / 2 + 1.4, 1.0, 5);
    flags.casinoSlot = new THREE.Vector3(ox, 0, -6.2);
    return built;
  }

  // ---------------------------------------------------------- slot machine 3D
  function buildSlotMachine(title, variant) {
    var g = new THREE.Group();
    var cabCol = variant === 0 ? 0xf0c02a : (variant === 1 ? 0xd9a726 : 0xc99a3a);
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.9), ART.flat(cabCol, { rough: 0.45, metal: 0.15 }));
    body.position.y = 1.05; body.castShadow = true; g.add(body);
    var topper = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.42, 1.0), ART.flat(0x2a1430, { emissive: 0x7722aa, ei: 0.6 }));
    topper.position.y = 2.32; g.add(topper);

    var c = ART.canvas(512, 640, function (gg, w, h) {
      gg.fillStyle = '#12061c'; gg.fillRect(0, 0, w, h);
      gg.fillStyle = '#ffd447'; gg.font = 'bold 40px Impact,Tahoma,sans-serif'; gg.textAlign = 'center';
      gg.fillText(title.slice(0, 16), w / 2, 62);
      gg.fillStyle = '#1a0a24'; gg.fillRect(40, 90, w - 80, 300);
      gg.strokeStyle = '#ffd447'; gg.lineWidth = 6; gg.strokeRect(40, 90, w - 80, 300);
      for (var r = 0; r < 3; r++) for (var cc = 0; cc < 3; cc++) {
        gg.fillStyle = '#2a1240';
        ART.roundRect(gg, 60 + cc * 132, 105 + r * 95, 116, 82, 12); gg.fill();
        gg.font = '58px "Segoe UI Emoji",sans-serif'; gg.fillStyle = '#fff';
        gg.fillText('🪙', 118 + cc * 132, 162 + r * 95);
      }
      gg.fillStyle = '#25d366'; ART.roundRect(gg, w / 2 - 110, 420, 220, 70, 16); gg.fill();
      gg.fillStyle = '#06210f'; gg.font = 'bold 46px Tahoma'; gg.fillText('SPIN', w / 2, 470);
      gg.fillStyle = '#e8d9ff'; gg.font = '30px monospace';
      gg.fillText('CREDIT ' + String(cash()).slice(0, 6), w / 2, 545);
      gg.fillText('BET 10   +10  +1  MAX', w / 2, 590);
    });
    var screenTex = ART.tex(c);
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), ART.basic(0xffffff, { map: screenTex }));
    screen.position.set(0, 1.62, 0.46); g.add(screen);
    var keypad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.06), ART.flat(0xd8d2c4));
    keypad.position.set(0, 0.62, 0.46); keypad.rotation.x = -0.25; g.add(keypad);
    for (var k = 0; k < 9; k++) {
      var key = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.04), ART.flat(0xf2eee3));
      key.position.set(-0.28 + (k % 3) * 0.28, 0.74 - Math.floor(k / 3) * 0.16, 0.49);
      key.rotation.x = -0.25; g.add(key);
    }
    var glow = new THREE.PointLight(0xffd447, 0.55, 4.5, 2);
    glow.position.set(0, 1.7, 0.9); g.add(glow);
    g.userData = { screen: screen, glow: glow, canvas: c, tex: screenTex };
    return g;
  }

  // -------------------------------------------------------------- race board
  function buildRaceBoard() {
    var g = new THREE.Group();
    var frame = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.9, 2.4), ART.flat(0x8a2f4a, { rough: 0.6 }));
    frame.position.y = 0.45; frame.castShadow = true; g.add(frame);
    var lanes = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.06, 2.1), ART.flat(0x1b6b4a, { rough: 0.5 }));
    lanes.position.y = 0.93; g.add(lanes);
    for (var i = 0; i < 5; i++) {
      var line = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.02, 0.03), ART.basic(0xffffff));
      line.position.set(0, 0.97, -0.9 + i * 0.45); g.add(line);
    }
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.9), new THREE.MeshBasicMaterial({ map: ART.neonTexture('DUCK RACE', '#ff4fd8', { font: 'bold 170px' }), transparent: true }));
    sign.position.set(0, 1.75, 0); sign.rotation.x = -0.35; g.add(sign);

    var ducks = [];
    for (var d = 0; d < 5; d++) {
      var duck = new THREE.Group();
      var body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), ART.flat([0xffffff, 0xffd447, 0x8fd9ff, 0xff8fd9, 0xa8ff8f][d], { rough: 0.5 }));
      body.scale.set(1.3, 1, 1); duck.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), ART.flat(0xffffff, { rough: 0.5 }));
      head.position.set(0.14, 0.12, 0); duck.add(head);
      var beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 6), ART.flat(0xff8a1f));
      beak.rotation.z = -Math.PI / 2; beak.position.set(0.24, 0.11, 0); duck.add(beak);
      duck.position.set(-2.6, 1.06, -0.9 + d * 0.45);
      g.add(duck);
      ducks.push(duck);
    }
    return { group: g, ducks: ducks, races: 0 };
  }

  // ------------------------------------------------------------ blackjack 3D
  function buildBlackjackTable() {
    var g = new THREE.Group();
    var felt = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.1, 22), ART.flat(0x1f7a4d, { rough: 0.8 }));
    felt.position.y = 0.78; felt.castShadow = true; g.add(felt);
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.4, 0.1, 22), ART.flat(0x5a3b22, { rough: 0.6 }));
    rim.position.y = 0.72; g.add(rim);
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.72, 12), ART.flat(0x3b2a1b));
    post.position.y = 0.36; g.add(post);
    var shoes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.2), ART.flat(0x22262e));
    shoes.position.set(0.5, 0.86, -0.5); g.add(shoes);
    return { group: g };
  }

  // ------------------------------------------------------------------ UI (DOM)
  function panelEl() {
    if (ui) return ui;
    ui = document.createElement('div');
    ui.id = 'casino-ui';
    ui.className = 'hidden';
    document.body.appendChild(ui);
    return ui;
  }
  function close() { if (ui) ui.classList.add('hidden'); SWYF.ui.showInteract && null; }
  function open(game) {
    var el = panelEl();
    el.classList.remove('hidden');
    if (game === 'slots') renderSlots(el);
    else if (game === 'race') renderRace(el);
    else if (game === 'cards') renderCards(el);
  }

  function head(title, sub) {
    return '<div class="cs-head"><b>' + title + '</b><span class="dim">' + sub + '</span>' +
      '<span class="cs-cash">💰 ' + U.money(cash()) + '</span><button class="cs-close ui-block">✕</button></div>';
  }
  function wire(el) {
    var b = el.querySelector('.cs-close');
    if (b) b.onclick = function () { close(); };
  }

  // ---- slots
  function renderSlots(el) {
    var bet = (state.slots && state.slots.bet) || 10;
    var res = state.slots || {};
    el.innerHTML = '<div class="cs-card">' + head('🎰 TREASURE CHAMBER', 'المكافأة: 3 = ×6 · 2 = ×1.4') +
      '<div class="cs-reels">' +
        [0, 1, 2].map(function (i) {
          var sym = res.reels ? res.reels[i] : '🪙';
          return '<div class="cs-reel' + (res.spinning ? ' spin' : '') + '">' + sym + '</div>';
        }).join('') +
      '</div>' +
      '<div class="cs-row"><span class="dim">الرهان</span>' +
        '<button class="cs-bet" data-b="-10">−10</button>' +
        '<b class="cs-betval">' + bet + '</b>' +
        '<button class="cs-bet" data-b="10">+10</button>' +
        '<button class="cs-bet" data-b="100">+100</button>' +
        '<button class="cs-bet" data-b="max">MAX</button></div>' +
      '<div class="cs-row"><button class="cs-spin ui-block primary"' + (res.spinning ? ' disabled' : '') + '>SPIN 🎰</button>' +
        '<span class="cs-msg dim">' + (res.msg || 'دور و شوف الحظ…') + '</span></div>' +
      '<div class="dim small">الخسارة كتخسر الفلوس و الوقت — و البوس ماشي غافل.</div>' +
      '</div>';
    wire(el);
    el.querySelectorAll('.cs-bet').forEach(function (b) {
      b.onclick = function () {
        var v = b.getAttribute('data-b');
        var cur = (state.slots && state.slots.bet) || 10;
        if (v === 'max') cur = Math.max(10, Math.floor(cash() / 10) * 10);
        else cur = Math.max(10, Math.min(cash() || 10, cur + parseInt(v, 10)));
        state.slots = Object.assign(state.slots || {}, { bet: cur });
        renderSlots(el);
      };
    });
    el.querySelector('.cs-spin').onclick = function () { spin(el); };
  }

  function spin(el) {
    var bet = (state.slots && state.slots.bet) || 10;
    if (bet > cash()) { SWYF.ui.toast('💸 ما عندكش فلوس كافيين', 2500); return; }
    addCash(-bet);
    state.spins++;
    state.slots = Object.assign(state.slots || {}, { spinning: true, msg: '…كنتدور', bet: bet });
    burnTime(6);
    var sfx = SWYF.audio;
    sfx.sfx('coins');
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      var r = [0, 1, 2].map(function () { return U.pick(SLOT_SYMBOLS); });
      state.slots.reels = r;
      if (el.querySelector('.cs-reels')) renderSlots(el);
      if (ticks > 9) {
        clearInterval(iv);
        finishSpin(el, bet);
      }
    }, 90);
  }

  function finishSpin(el, bet) {
    var r = state.slots.reels;
    var pay = 0;
    if (r[0] === r[1] && r[1] === r[2]) pay = bet * SLOT_PAY[3];
    else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) pay = Math.round(bet * SLOT_PAY[2]);
    state.slots.spinning = false;
    if (pay > 0) {
      addCash(pay);
      state.slots.msg = '🎉 ربحتي ' + U.money(pay) + '!';
      SWYF.audio.sfx('cash');
      SWYF.audio.speak('مبروك! ربحتي', { pitch: 1.1 });
    } else {
      state.slots.msg = '😐 ما كانش الحظ… عاود?';
    }
    state.net += pay - bet;
    riskBoss();
    refreshBoard();
    renderSlots(el);
  }

  // ---- duck race
  function renderRace(el) {
    var r = state.race || {};
    var bet = r.bet || 20, pick = r.pick == null ? -1 : r.pick;
    var names = ['البطة البيضا', 'الصفرا', 'الزرقا', 'الوردية', 'الخضرا'];
    el.innerHTML = '<div class="cs-card">' + head('🦆 DUCK RACE', 'اختار بطة… و الربح ×4') +
      '<div class="cs-lanes">' +
        names.map(function (n, i) {
          return '<button class="cs-lane' + (pick === i ? ' sel' : '') + '" data-i="' + i + '">' +
            '<span class="duck d' + i + '">🦆</span> ' + n + '</button>';
        }).join('') +
      '</div>' +
      '<div class="cs-row"><span class="dim">الرهان</span><b>' + bet + ' درهم</b>' +
        '<button class="cs-rbet" data-b="-10">−10</button><button class="cs-rbet" data-b="10">+10</button>' +
        '<button class="cs-run ui-block primary">سبّق! 🦆</button></div>' +
      '<div class="cs-track">' + names.map(function (n, i) {
        return '<div class="cs-lanepos"><i class="prog p' + i + '" style="width:' + ((r.pos && r.pos[i]) || 0) + '%"></i><span>🦆</span></div>';
      }).join('') + '</div>' +
      '<div class="cs-msg dim">' + (r.msg || 'سباق مشبوه… البطة الحرجة دايمن كتفوت.') + '</div>' +
      '</div>';
    wire(el);
    el.querySelectorAll('.cs-lane').forEach(function (b) {
      b.onclick = function () { state.race = Object.assign(state.race || {}, { pick: +b.getAttribute('data-i') }); renderRace(el); };
    });
    el.querySelectorAll('.cs-rbet').forEach(function (b) {
      b.onclick = function () {
        var cur = (state.race && state.race.bet) || 20;
        cur = Math.max(10, Math.min(Math.max(10, cash()), cur + parseInt(b.getAttribute('data-b'), 10)));
        state.race = Object.assign(state.race || {}, { bet: cur });
        renderRace(el);
      };
    });
    el.querySelector('.cs-run').onclick = function () { runRace(el); };
  }

  function runRace(el) {
    var r = state.race || {};
    if (r.pick == null || r.pick < 0) { SWYF.ui.toast('🦆 اختار بطة الأول', 2200); return; }
    var bet = r.bet || 20;
    if (bet > cash()) { SWYF.ui.toast('💸 ما عندكش فلوس كافيين', 2500); return; }
    addCash(-bet);
    state.races++;
    burnTime(10);
    SWYF.audio.sfx('beep');
    var pos = [0, 0, 0, 0, 0];
    // rigged: house duck gets a boost (like the reference's crooked race)
    var house = U.irnd(0, 4);
    var speed = [0, 0, 0, 0, 0].map(function () { return U.rnd(0.75, 1.25); });
    speed[house] *= 1.42;
    state.race.pos = pos;
    var iv = setInterval(function () {
      for (var i = 0; i < 5; i++) pos[i] = Math.min(100, pos[i] + speed[i] * U.rnd(1.2, 3.4));
      state.race.pos = pos.slice();
      var bars = el.querySelectorAll('.prog');
      if (bars.length === 5) bars.forEach(function (b, i) { b.style.width = pos[i] + '%'; });
      if (pos.some(function (p) { return p >= 100; })) {
        clearInterval(iv);
        var win = pos.indexOf(Math.max.apply(null, pos));
        var pay = (win === r.pick) ? bet * 4 : 0;
        if (pay) { addCash(pay); SWYF.audio.sfx('cash'); }
        state.race.msg = win === r.pick ? '🎉 البطة ديالك ربحت! +' + U.money(pay) : '😾 ' + ['البيضا', 'الصفرا', 'الزرقا', 'الوردية', 'الخضرا'][win] + ' هي اللي فاتت…';
        state.net += pay - bet;
        riskBoss();
        refreshBoard();
        renderRace(el);
      }
    }, 110);
  }

  // ---- blackjack
  var CARD_VALS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function cardValue(c) {
    if (c === 'A') return 11;
    if (['J', 'Q', 'K'].indexOf(c) >= 0) return 10;
    return parseInt(c, 10);
  }
  function handScore(h) {
    var s = h.reduce(function (a, c) { return a + cardValue(c); }, 0);
    var aces = h.filter(function (c) { return c === 'A'; }).length;
    while (s > 21 && aces > 0) { s -= 10; aces--; }
    return s;
  }
  function draw() { return U.pick(CARD_VALS); }

  function renderCards(el) {
    var h = state.cards || {};
    var cards = function (list, cls) {
      return (list || []).map(function (c) {
        var red = ['♥', '♦'].indexOf(c.suit) >= 0;
        return '<span class="card ' + (red ? 'red' : '') + ' ' + (cls || '') + '">' + c.v + c.suit + '</span>';
      }).join('');
    };
    el.innerHTML = '<div class="cs-card">' + head('♠️ MIDNIGHT BLACKJACK', 'ديلر كيوقف على 17') +
      '<div class="cs-table">' +
        '<div class="cs-hand"><span class="dim">الديلر ' + (h.hideDealer ? '?' : handScore(h.dealer || [])) + '</span>' + cards(h.dealer, h.hideDealer ? 'hidden' : '') + '</div>' +
        '<div class="cs-hand"><span class="dim">نتا ' + handScore(h.player || []) + '</span>' + cards(h.player) + '</div>' +
      '</div>' +
      '<div class="cs-row">' +
        (h.active
          ? '<button class="cs-hit ui-block primary">كارت 🃏</button><button class="cs-stand ui-block">وقف ✋</button>'
          : '<span class="dim">الرهان</span><button class="cs-cbet" data-b="-10">−10</button><b>' + (h.bet || 25) + '</b><button class="cs-cbet" data-b="10">+10</button><button class="cs-deal ui-block primary">لعب ♠️</button>') +
        '<span class="cs-msg dim">' + (h.msg || 'القاعدة: 21 بلا ما تفوت.') + '</span></div>' +
      '</div>';
    wire(el);
    var hit = el.querySelector('.cs-hit'), stand = el.querySelector('.cs-stand');
    if (hit) hit.onclick = function () { bjHit(el); };
    if (stand) stand.onclick = function () { bjStand(el); };
    var deal = el.querySelector('.cs-deal');
    if (deal) deal.onclick = function () { bjDeal(el); };
    el.querySelectorAll('.cs-cbet').forEach(function (b) {
      b.onclick = function () {
        var cur = (state.cards && state.cards.bet) || 25;
        cur = Math.max(10, Math.min(Math.max(10, cash()), cur + parseInt(b.getAttribute('data-b'), 10)));
        state.cards = Object.assign(state.cards || {}, { bet: cur });
        renderCards(el);
      };
    });
  }

  function bjDeal(el) {
    var bet = (state.cards && state.cards.bet) || 25;
    if (bet > cash()) { SWYF.ui.toast('💸 ما عندكش فلوس كافيين', 2500); return; }
    addCash(-bet);
    state.hands++;
    state.cards = { bet: bet, player: [{ v: draw(), suit: U.pick(['♠', '♥', '♦', '♣']) }, { v: draw(), suit: U.pick(['♠', '♥', '♦', '♣']) }], dealer: [{ v: draw(), suit: U.pick(['♠', '♥', '♦', '♣']) }], hideDealer: true, active: true, msg: 'دورك: كارت ولا وقف؟' };
    SWYF.audio.sfx('card');
    renderCards(el);
  }
  function bjHit(el) {
    var c = state.cards;
    c.player.push({ v: draw(), suit: U.pick(['♠', '♥', '♦', '♣']) });
    SWYF.audio.sfx('card');
    if (handScore(c.player) > 21) { c.active = true; return bjFinish(el); }
    renderCards(el);
  }
  function bjStand(el) {
    var c = state.cards;
    c.hideDealer = false;
    while (handScore(c.dealer) < 17) c.dealer.push({ v: draw(), suit: U.pick(['♠', '♥', '♦', '♣']) });
    bjFinish(el);
  }
  function bjFinish(el) {
    var c = state.cards;
    var p = handScore(c.player), d = handScore(c.dealer);
    c.hideDealer = false;
    c.active = false;
    var pay = 0;
    if (p > 21) { c.msg = '😵 فوت 21 — خسرتي ' + U.money(c.bet); }
    else if (d > 21 || p > d) { pay = c.bet * 2; c.msg = '🎉 ربحتي ' + U.money(pay) + '!'; }
    else if (p === d) { pay = c.bet; c.msg = '🤝 تعادل — رجعو ليك الفلوس'; }
    else { c.msg = '😾 الديلر فاتك (' + d + ' ضد ' + p + ')'; }
    if (pay) addCash(pay);
    state.net += pay - c.bet;
    burnTime(8);
    riskBoss();
    refreshBoard();
    SWYF.audio.sfx(pay > c.bet ? 'cash' : 'beep');
    renderCards(el);
  }

  function refreshBoard() {
    if (!built || !built.board) return;
    var rows = ['BACCARAT', '17:' + (10 + (state.spins % 9)), '17:' + (2 + (state.races % 8)), 'NET ' + (state.net >= 0 ? '+' : '') + state.net, 'SPINS ' + state.spins];
    state.board = rows;
    var g = built.board.canvas.getContext('2d');
    g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, 512, 384);
    g.strokeStyle = '#2a2a2e'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 372);
    g.fillStyle = '#ff3b3b'; g.font = 'bold 46px monospace'; g.textAlign = 'left';
    rows.forEach(function (r, i) { g.fillText(r, 26, 76 + i * 62); });
    built.board.tex.needsUpdate = true;
  }

  // -------------------------------------------------------------- 3D ticker
  function update(dt) {
    if (!built) return;
    var t = performance.now() / 1000;
    // slot screen flicker + credit readout
    built.slots.forEach(function (s, i) {
      s.glow.intensity = 0.45 + Math.sin(t * 3 + i) * 0.12;
      if (Math.random() < 0.01) {
        var g = s.canvas.getContext('2d');
        g.fillStyle = '#12061c'; g.fillRect(0, 520, 512, 90);
        g.fillStyle = '#e8d9ff'; g.font = '30px monospace'; g.textAlign = 'center';
        g.fillText('CREDIT ' + String(cash()).slice(0, 6), 256, 545);
        g.fillText('SPINS ' + state.spins, 256, 590);
        s.screen.material.map.needsUpdate = true;
      }
    });
    // duck idle bobbing
    if (built.race) {
      built.race.ducks.forEach(function (d, i) {
        d.position.y = 1.06 + Math.sin(t * 2.4 + i) * 0.03;
        d.rotation.z = Math.sin(t * 2 + i) * 0.08;
      });
    }
  }

  SWYF.Casino = {
    build: build, update: update, open: open, close: close,
    built: function () { return built; },
    stats: function () { return { spins: state.spins, races: state.races, hands: state.hands, net: state.net }; },
    /** called from the office door interactable */
    enter: function () { open('slots'); },
    gamble: { slots: function () { open('slots'); }, race: function () { open('race'); }, cards: function () { open('cards'); } }
  };
})();
