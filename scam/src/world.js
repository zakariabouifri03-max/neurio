/* ============================================================================
 * Scam Baqi — world.js
 * مكتب 3D كامل، مولّد بالإجرائية (Procedural 3D office) — بلا أي ملف خارجي.
 * Room, desks, monitors, boss cabin, kitchen, posters, clock, NPCs, interactables.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util;
  var THREE = window.THREE;

  // ---------------------------------------------------------------- textures
  function canvasTex(w, h, draw, repeat) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    draw(g, w, h);
    var t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function signTexture(title, sub, opts) {
    opts = opts || {};
    return canvasTex(1024, 512, function (g, w, h) {
      g.fillStyle = opts.bg || '#0f1a2b';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = opts.border || '#2b3f5e';
      g.lineWidth = 14;
      g.strokeRect(7, 7, w - 14, h - 14);
      g.fillStyle = opts.title || '#ffd447';
      g.font = 'bold 96px "Noto Kufi Arabic","Tahoma",sans-serif';
      g.textAlign = 'center';
      g.direction = 'rtl';
      g.fillText(title, w / 2, h * 0.44);
      if (sub) {
        g.fillStyle = opts.sub || '#9fb6d8';
        g.font = '58px "Noto Kufi Arabic","Tahoma",sans-serif';
        g.fillText(sub, w / 2, h * 0.68);
      }
      if (opts.foot) {
        g.fillStyle = '#5a7396';
        g.font = '34px "Noto Kufi Arabic",Tahoma,sans-serif';
        g.fillText(opts.foot, w / 2, h * 0.86);
      }
    });
  }

  function floorTexture() {
    return canvasTex(512, 512, function (g, w, h) {
      g.fillStyle = '#2b2c30'; g.fillRect(0, 0, w, h);
      for (var y = 0; y < h; y += 64) {
        for (var x = 0; x < w; x += 64) {
          var v = 40 + Math.random() * 18;
          g.fillStyle = 'rgb(' + (v + 4) + ',' + v + ',' + (v + 6) + ')';
          g.fillRect(x + 1, y + 1, 62, 62);
          g.fillStyle = 'rgba(255,255,255,0.02)';
          g.fillRect(x + 4, y + 4, 26, 3);
        }
      }
    }, [8, 6]);
  }

  function carpetTexture() {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#3a2b2e'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 3000; i++) {
        g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.25) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = '#5c4048'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    }, [3, 2]);
  }

  function posterTexture(items, opts) {
    opts = opts || {};
    return canvasTex(1024, 768, function (g, w, h) {
      g.fillStyle = opts.bg || '#f4f1e6'; g.fillRect(0, 0, w, h);
      g.strokeStyle = opts.frame || '#c0392b'; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
      g.direction = 'rtl'; g.textAlign = 'right';
      g.fillStyle = opts.titleCol || '#1b2a41';
      g.font = 'bold 82px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillText(opts.title || '', w - 50, 130);
      g.font = '52px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillStyle = '#26374d';
      for (var i = 0; i < items.length; i++) g.fillText(items[i], w - 50, 240 + i * 92);
    });
  }

  function screenTexture(kind) {
    return canvasTex(1024, 640, function (g, w, h) {
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#123055'); grad.addColorStop(1, '#0a1730');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // fake windows-xp-ish taskbar
      g.fillStyle = '#1c2c46'; g.fillRect(0, h - 70, w, 70);
      g.fillStyle = '#2ecc71'; roundRect(g, w - 190, h - 56, 150, 42, 8); g.fill();
      g.direction = 'rtl'; g.textAlign = 'center';
      g.fillStyle = '#0a1a12'; g.font = 'bold 30px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillText('ابدأ', w - 115, h - 26);
      // desktop icons
      var icons = ['🛒 Scamazon', '💬 Disscord', '🖥️ AnyViewer', '🎨 Paint', '🎥 Recorder', '📷 Camera', '📁 Files', '🗒️ Notes'];
      g.textAlign = 'right';
      for (var i = 0; i < icons.length; i++) {
        var col = i % 4, row = Math.floor(i / 4);
        var x = w - 70 - col * 240, y = 120 + row * 190;
        g.fillStyle = 'rgba(255,255,255,0.10)';
        roundRect(g, x - 170, y - 70, 200, 150, 14); g.fill();
        g.font = '54px "Segoe UI Emoji",sans-serif';
        g.fillText(icons[i].split(' ')[0], x - 70, y - 5);
        g.fillStyle = '#e8f0ff';
        g.font = 'bold 30px "Noto Kufi Arabic",Tahoma,sans-serif';
        g.textAlign = 'center';
        g.fillText(icons[i].split(' ').slice(1).join(' '), x - 70, y + 50);
        g.textAlign = 'right';
      }
      if (kind === 'call') {
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, w, h);
        g.textAlign = 'center'; g.direction = 'rtl';
        g.fillStyle = '#ff5d6c'; g.font = 'bold 96px "Noto Kufi Arabic",Tahoma,sans-serif';
        g.fillText('📞 كولاية داخلة…', w / 2, h / 2);
      }
    });
  }

  function skylineTexture() {
    return canvasTex(1024, 512, function (g, w, h) {
      var sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#1b2b4a'); sky.addColorStop(0.55, '#4a3b63'); sky.addColorStop(1, '#a05a4a');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      // sun haze
      var sg = g.createRadialGradient(w * 0.7, h * 0.62, 10, w * 0.7, h * 0.62, 260);
      sg.addColorStop(0, 'rgba(255,200,120,0.75)'); sg.addColorStop(1, 'rgba(255,180,120,0)');
      g.fillStyle = sg; g.fillRect(0, 0, w, h);
      // buildings
      for (var i = 0; i < 60; i++) {
        var bw = U.rnd(30, 90), bh = U.rnd(60, 300), x = Math.random() * w;
        g.fillStyle = 'rgba(18,22,36,' + U.rnd(0.75, 0.98) + ')';
        g.fillRect(x, h - bh, bw, bh);
        for (var y = h - bh + 10; y < h - 10; y += 22) {
          for (var xx = x + 6; xx < x + bw - 8; xx += 16) {
            if (Math.random() < 0.32) { g.fillStyle = 'rgba(255,215,140,0.85)'; g.fillRect(xx, y, 6, 8); }
          }
        }
      }
    });
  }

  function clockTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = '#f6f1e2'; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#22303f'; g.lineWidth = 12; g.stroke();
    g.fillStyle = '#22303f';
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      g.save(); g.translate(256 + Math.sin(a) * 205, 256 - Math.cos(a) * 205);
      g.fillRect(-8, -22, 16, 34); g.restore();
    }
    var t = new THREE.CanvasTexture(c);
    return { tex: t, canvas: c, ctx: g };
  }

  // ---------------------------------------------------------------- build
  function build() {
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e16);
    scene.fog = new THREE.Fog(0x0a0e16, 14, 42);

    var colliders = [];      // {x1,z1,x2,z2}
    var interactables = [];
    var npcs = [];
    var flags = {};
    var lamps = [];

    var W = 17, DP = 12, H = 3.2;
    var root = new THREE.Group();
    scene.add(root);

    function addCollider(cx, cz, sx, sz, pad) {
      pad = pad || 0;
      colliders.push({ x1: cx - sx / 2 - pad, x2: cx + sx / 2 + pad, z1: cz - sz / 2 - pad, z2: cz + sz / 2 + pad });
    }

    // ---- materials
    var matFloor = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, metalness: 0.05 });
    var matWall = new THREE.MeshStandardMaterial({ color: 0xd9d3c4, roughness: 0.95 });
    var matWall2 = new THREE.MeshStandardMaterial({ color: 0x35617a, roughness: 0.95 });
    var matCeil = new THREE.MeshStandardMaterial({ color: 0xeeeae1, roughness: 1 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x8a5a35, roughness: 0.7 });
    var matDark = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6 });
    var matMetal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.7 });
    var matGlassM = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2 });

    // ---- shell
    var floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, DP), matFloor);
    floor.position.set(0, -0.1, 0);
    floor.receiveShadow = true;
    root.add(floor);
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, DP), matCeil);
    ceil.position.set(0, H, 0); root.add(ceil);
    // walls
    function wall(x, z, w, d, mat, h) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h || H, d), mat || matWall);
      m.position.set(x, (h || H) / 2, z);
      m.castShadow = m.receiveShadow = true;
      root.add(m); return m;
    }
    wall(0, -DP / 2, W, 0.2, matWall);           // north (view wall for boss)
    wall(0, DP / 2, W, 0.2, matWall);            // south
    wall(-W / 2, 0, 0.2, DP, matWall2);          // west (windows)
    wall(W / 2, 0, 0.2, DP, matWall);            // east

    // carpet runner
    var carpet = new THREE.Mesh(new THREE.PlaneGeometry(4.4, DP - 1.4), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(-1.0, 0.011, 0);
    root.add(carpet);

    // ---- windows (west wall) with skyline
    var skyTex = skylineTexture();
    for (var wi = 0; wi < 3; wi++) {
      var wz = -3.4 + wi * 3.4;
      var win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), new THREE.MeshBasicMaterial({ map: skyTex }));
      win.position.set(-W / 2 + 0.12, 1.75, wz);
      win.rotation.y = Math.PI / 2;
      root.add(win);
      var frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.05, 2.75), matDark);
      frame.position.set(-W / 2 + 0.06, 1.75, wz); root.add(frame);
      var lightPool = new THREE.PointLight(0xffc48a, 0.5, 5.5, 2);
      lightPool.position.set(-W / 2 + 1.2, 1.6, wz); root.add(lightPool);
    }

    // ---- ceiling lamps
    for (var li = 0; li < 4; li++) {
      var lx = -5 + (li % 2) * 10, lz = -3 + Math.floor(li / 2) * 6;
      var shade = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.4, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x2f3b4a, side: THREE.DoubleSide, roughness: 0.6 }));
      shade.position.set(lx, H - 0.35, lz); root.add(shade);
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffeec2 }));
      bulb.position.set(lx, H - 0.58, lz); root.add(bulb);
      var pl = new THREE.PointLight(0xfff0cf, 0.55, 11, 2);
      pl.position.set(lx, H - 0.8, lz); root.add(pl);
      lamps.push({ light: pl, bulb: bulb });
    }
    var hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2118, 0.55); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffd9a8, 0.85);
    sun.position.set(-9, 8, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    scene.add(sun);

    // ---- desks
    var deskSpots = [
      { x: -3.2, z: -2.4, ry: 0, mine: false }, { x: -3.2, z: 1.1, ry: 0, mine: false },
      { x: 2.6, z: -2.4, ry: Math.PI, mine: false }, { x: 2.6, z: 1.1, ry: Math.PI, mine: true }
    ];
    var monitors = [];
    deskSpots.forEach(function (d, i) {
      var grp = new THREE.Group();
      grp.position.set(d.x, 0, d.z);
      grp.rotation.y = d.ry;
      // table
      var top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.15), matWood);
      top.position.y = 0.75; top.castShadow = top.receiveShadow = true; grp.add(top);
      [[-0.98, -0.46], [0.98, -0.46], [-0.98, 0.46], [0.98, 0.46]].forEach(function (p) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), matMetal);
        leg.position.set(p[0], 0.375, p[1]); grp.add(leg);
      });
      // monitor
      var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.06, 12), matDark);
      stand.position.set(-0.5, 0.79 + 0.03, -0.25); grp.add(stand);
      var neck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), matDark);
      neck.position.set(-0.5, 0.95, -0.25); grp.add(neck);
      var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.42), new THREE.MeshBasicMaterial({ map: screenTexture(i === 3 ? 'call' : 'idle') }));
      scr.position.set(-0.5, 1.3, -0.22); grp.add(scr);
      var bezel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.05), matDark);
      bezel.position.set(-0.5, 1.3, -0.25); grp.add(bezel);
      var glare = new THREE.PointLight(0x88bbff, 0.25, 2.2, 2);
      glare.position.set(-0.5, 1.25, -0.1); grp.add(glare);
      monitors.push({ mesh: scr, glare: glare, mine: d.mine });
      // keyboard + phone + papers + mug
      var kb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.18), matDark);
      kb.position.set(0.15, 0.8, -0.1); grp.add(kb);
      var ph = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.3), matDark);
      ph.position.set(0.72, 0.83, -0.12); grp.add(ph);
      var hs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.1), matDark);
      hs.position.set(0.72, 0.88, -0.12); grp.add(hs);
      for (var pp = 0; pp < 3; pp++) {
        var paper = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 1, side: THREE.DoubleSide }));
        paper.rotation.x = -Math.PI / 2; paper.rotation.z = U.rnd(-0.4, 0.4);
        paper.position.set(-0.15 + pp * 0.2, 0.8, 0.28); grp.add(paper);
      }
      var mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 12), new THREE.MeshStandardMaterial({ color: d.mine ? 0xd94f4f : 0x4f7fd9, roughness: 0.5 }));
      mug.position.set(0.45, 0.86, 0.3); grp.add(mug);
      // chair
      var seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.5), matDark);
      seat.position.set(d.mine ? 0.05 : -0.05, 0.46, 1.05); grp.add(seat);
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.08), matDark);
      back.position.set(d.mine ? 0.05 : -0.05, 0.78, 1.28); grp.add(back);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), matMetal);
      pole.position.set(d.mine ? 0.05 : -0.05, 0.22, 1.05); grp.add(pole);
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.05, 14), matMetal);
      base.position.set(d.mine ? 0.05 : -0.05, 0.03, 1.05); grp.add(base);
      if (d.mine) {
        var jacket = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.12), new THREE.MeshStandardMaterial({ color: 0x6d3b2c, roughness: 0.9 }));
        jacket.position.set(0.05, 0.78, 1.22); grp.add(jacket);
      }
      root.add(grp);
      addCollider(d.x, d.z, 2.3, 1.5, 0.25);
      if (d.mine) {
        flags.myDesk = new THREE.Vector3(d.x, 1.2, d.z);
        // the chair sits on the -z side of this desk (ry = PI)
        interactables.push({
          id: 'desk', label: 'اجلس و خدم (كولات + ديسكتوب)',
          pos: new THREE.Vector3(d.x - 0.05, 1.0, d.z - 1.15), radius: 1.7, kind: 'desk'
        });
      }
    });

    // ---- boss cabin (north-east glass box)
    var cab = new THREE.Group();
    cab.position.set(4.6, 0, -4.0); root.add(cab);
    var cabGlass = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.6, 3.0), matGlassM);
    cabGlass.position.set(0, 1.3, 0); cab.add(cabGlass);
    var cabFrameTop = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.12, 3.1), matDark);
    cabFrameTop.position.set(0, 2.6, 0); cab.add(cabFrameTop);
    [[-2.6, -1.5], [2.6, -1.5], [-2.6, 1.5], [2.6, 1.5]].forEach(function (p) {
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), matDark);
      post.position.set(p[0], 1.3, p[1]); cab.add(post);
    });
    var bossDesk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.3), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.5 }));
    bossDesk.position.set(0, 0.8, -0.4); bossDesk.castShadow = true; cab.add(bossDesk);
    var bossChair = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.6 }));
    bossChair.position.set(0, 0.75, -1.3); cab.add(bossChair);
    var firedPoster = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1), new THREE.MeshBasicMaterial({
      map: signTexture('YOU ARE FIRED', 'الكوتا اليومية', { bg: '#2a0e12', border: '#e04a5a', title: '#ff6b7a', sub: '#ffb3bb', foot: 'قسم الإنتاجية' })
    }));
    firedPoster.position.set(0, 1.9, -1.48); cab.add(firedPoster);
    var bossLamp = new THREE.PointLight(0xffd0a0, 0.7, 7, 2); bossLamp.position.set(0, 2.3, 0); cab.add(bossLamp);
    addCollider(4.6, -4.0, 5.3, 3.1, 0.1);
    interactables.push({ id: 'boss', label: 'دخول لمكتب البوس', pos: new THREE.Vector3(3.4, 1.2, -2.6), radius: 1.4, kind: 'boss' });
    flags.bossStand = new THREE.Vector3(4.6, 0, -3.0);
    flags.bossCamera = new THREE.Vector3(4.6, 1.65, -1.7);

    // ---- whiteboard (quota) — south wall
    flags.quotaSign = signTexture('الكوتا اليومية', '1500 درهم', { bg: '#101820', border: '#39d18b', title: '#7ef0b4', sub: '#ffffff', foot: 'من يوصل، يبقى — من ما يوصلش، يمشي' });
    var wb = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: flags.quotaSign }));
    wb.position.set(-3.2, 1.85, DP / 2 - 0.14);
    wb.rotation.y = Math.PI; root.add(wb);
    var wbFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.9, 0.08), matDark);
    wbFrame.position.set(-3.2, 1.85, DP / 2 - 0.08); root.add(wbFrame);
    interactables.push({ id: 'board', label: 'شوف الكوتا و الدروس', pos: new THREE.Vector3(-3.2, 1.4, DP / 2 - 1.1), radius: 1.4, kind: 'board' });

    // ---- posters on east wall
    var posters = [
      { title: 'أسبوع الإنتاجية', items: ['• كل كولاية = فرصة', '• ما تسولش، كمل', '• الهدف: صفر شك'], col: '#8e44ad', bg: '#f6f3ea' },
      { title: 'علامات الخطر', items: ['• «بلوكيست» كيبان', '• جرايات كيسجلو', '• سؤال: «رقم الملف؟»'], col: '#c0392b', bg: '#fdf6e3' },
      { title: 'جوائز الشهر', items: ['🥇 5000 درهم', '🥈 2500 درهم', '🥉 …ما كاينش 🥉'], col: '#e67e22', bg: '#eef6ff' }
    ];
    posters.forEach(function (p, i) {
      var pl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.12), new THREE.MeshBasicMaterial({ map: posterTexture(p.items, { title: p.title, frame: p.col, bg: p.bg }) }));
      pl.position.set(W / 2 - 0.14, 1.95 - i * 0.02, -3.2 + i * 3.1);
      pl.rotation.y = -Math.PI / 2; root.add(pl);
    });

    // ---- neon sign over the whiteboard (parody brand wall)
    var neon = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.4), new THREE.MeshBasicMaterial({
      map: signTexture('مكتب الاتصال السريع', 'سبيتار · KOLKATA · CASABLANCA', { bg: '#0b0f18', border: '#ff5d6c', title: '#ff8a3d', sub: '#ffd447', foot: 'مرخّص؟… تقريباً' }),
      side: THREE.DoubleSide
    }));
    neon.position.set(3.0, 2.45, DP / 2 - 0.16); neon.rotation.y = Math.PI; root.add(neon);

    // ---- kitchen corner (north-west)
    var kitchen = new THREE.Group(); kitchen.position.set(-6.6, 0, -4.3); root.add(kitchen);
    var counter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.95, 1.2), new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.8 }));
    counter.position.set(0, 0.48, 0); counter.castShadow = true; kitchen.add(counter);
    var counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.08, 1.3), matDark);
    counterTop.position.set(0, 0.98, 0); kitchen.add(counterTop);
    var coffee = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.4, metalness: 0.4 }));
    coffee.position.set(-0.9, 1.32, 0); kitchen.add(coffee);
    var coffeeLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    coffeeLight.position.set(-0.9, 1.6, 0.2); kitchen.add(coffeeLight);
    var water = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.85, 14), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75, roughness: 0.2 }));
    water.position.set(0.6, 1.42, 0); kitchen.add(water);
    var snack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: 0x2f3a4a, roughness: 0.5 }));
    snack.position.set(1.1, 1.28, 0); kitchen.add(snack);
    addCollider(-6.6, -4.3, 3.4, 1.4, 0.2);
    interactables.push({ id: 'coffee', label: 'دير قهوة ☕', pos: new THREE.Vector3(-7.2, 1.1, -3.2), radius: 1.3, kind: 'coffee' });
    interactables.push({ id: 'vending', label: 'شري حاجة من الماكينة', pos: new THREE.Vector3(-5.6, 1.1, -3.2), radius: 1.3, kind: 'vending' });

    // ---- protection spot (under the strong table) — for air strikes
    var bunkerTable = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 1.1), new THREE.MeshStandardMaterial({ color: 0x6b5540, roughness: 0.9 }));
    bunkerTable.position.set(6.2, 1.02, 3.6); bunkerTable.castShadow = true; root.add(bunkerTable);
    [[-0.85, -0.45], [0.85, -0.45], [-0.85, 0.45], [0.85, 0.45]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), matMetal);
      leg.position.set(6.2 + p[0], 0.5, 3.6 + p[1]); root.add(leg);
    });
    addCollider(6.2, 3.6, 2.0, 1.1, 0.0);
    flags.shelter = new THREE.Vector3(6.2, 0, 4.9);
    interactables.push({ id: 'shelter', label: 'احتمي تحت الطبلة 🛡️', pos: new THREE.Vector3(6.2, 1.0, 4.9), radius: 1.3, kind: 'shelter' });

    // ---- radio (music)
    var radio = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.25), new THREE.MeshStandardMaterial({ color: 0x3d2b1a, roughness: 0.6 }));
    radio.position.set(-6.6, 1.16, -4.3); root.add(radio);
    interactables.push({ id: 'radio', label: 'شغّل/وقّف الراديو 🎵', pos: new THREE.Vector3(-6.6, 1.0, -3.3), radius: 1.2, kind: 'radio' });

    // ---- water cooler
    var cooler = new THREE.Group(); cooler.position.set(7.4, 0, 1.2); root.add(cooler);
    var cBody = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 1.0, 16), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 }));
    cBody.position.y = 0.5; cooler.add(cBody);
    var cBottle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 16), new THREE.MeshStandardMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.7, roughness: 0.1 }));
    cBottle.position.y = 1.35; cooler.add(cBottle);
    addCollider(7.4, 1.2, 0.8, 0.8, 0.1);
    interactables.push({ id: 'water', label: 'شرب الما 💧', pos: new THREE.Vector3(6.7, 1.0, 1.2), radius: 1.1, kind: 'water' });

    // ---- wall clock (ticks with the shift!)
    var c = clockTexture();
    var clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ map: c.tex }));
    clockFace.position.set(W / 2 - 0.16, 2.35, 3.6); clockFace.rotation.y = -Math.PI / 2; root.add(clockFace);
    var handHour = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.012), new THREE.MeshBasicMaterial({ color: 0x101820 }));
    handHour.position.set(W / 2 - 0.18, 2.35 - 0.09, 3.6); handHour.rotation.y = -Math.PI / 2;
    var hGrp = new THREE.Group(); hGrp.position.set(W / 2 - 0.18, 2.35, 3.6); hGrp.add(handHour); root.add(hGrp);
    var handMin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.01), new THREE.MeshBasicMaterial({ color: 0x101820 }));
    handMin.position.y = 0.15;
    var mGrp = new THREE.Group(); mGrp.position.set(W / 2 - 0.19, 2.35, 3.6); mGrp.add(handMin); root.add(mGrp);

    // ---- junk / props
    for (var b = 0; b < 7; b++) {
      var box = new THREE.Mesh(new THREE.BoxGeometry(U.rnd(0.3, 0.6), U.rnd(0.3, 0.5), U.rnd(0.3, 0.6)), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09, 0.35, U.rnd(0.25, 0.5)), roughness: 0.95 }));
      var bx = U.rnd(-7.5, 7.5), bz = U.rnd(-5, 5);
      if (Math.abs(bx) < 4.5 && Math.abs(bz) < 3) bx += 5;      // keep the desk area clear
      if (bx > -1 && bx < 3.2 && bz > -1.5 && bz < 2.6) bx -= 5; // keep the way to your desk clear
      box.position.set(bx, box.geometry.parameters.height / 2, bz);
      box.rotation.y = U.rnd(0, 6.28); box.castShadow = true; root.add(box);
      addCollider(bx, bz, 0.7, 0.7, 0.05);
    }
    // plants
    [[-8.0, 4.6], [8.0, -5.0]].forEach(function (p) {
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a3b, roughness: 0.9 }));
      pot.position.set(p[0], 0.2, p[1]); root.add(pot);
      var leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.9, side: THREE.DoubleSide });
      for (var l = 0; l < 6; l++) {
        var leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.8), leafMat);
        leaf.position.set(p[0] + U.rnd(-0.1, 0.1), 0.85, p[1] + U.rnd(-0.1, 0.1));
        leaf.rotation.set(U.rnd(-0.4, 0.4), U.rnd(0, 3.14), U.rnd(-0.35, 0.35));
        root.add(leaf);
      }
      addCollider(p[0], p[1], 0.6, 0.6, 0.05);
    });
    // CCTV camera (fun: it "watches" you)
    var camBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.5), matDark);
    camBody.position.set(-W / 2 + 0.4, 2.85, 4.4); root.add(camBody);
    var camLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    camLight.position.set(-W / 2 + 0.55, 2.78, 4.65); root.add(camLight);

    // ---- NPC factory -------------------------------------------------------
    function makeHuman(opts) {
      opts = opts || {};
      var skin = new THREE.Color().setHSL(0.07, U.rnd(0.35, 0.55), U.rnd(0.42, 0.68));
      var shirt = new THREE.Color().setHSL(Math.random(), 0.45, U.rnd(0.3, 0.6));
      var g = new THREE.Group();
      var torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.26), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
      torso.position.y = 1.12; torso.castShadow = true; g.add(torso);
      var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), new THREE.MeshStandardMaterial({ color: skin }));
      neck.position.y = 1.46; g.add(neck);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 14), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
      head.position.y = 1.62; head.castShadow = true; g.add(head);
      var hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), new THREE.MeshStandardMaterial({ color: opts.hair || 0x1b1310, roughness: 0.9 }));
      hair.position.y = 1.64; g.add(hair);
      var eyes = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      eyes.position.set(0, 1.63, 0.145); g.add(eyes);
      if (opts.tie) {
        var tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: opts.tie, roughness: 0.5 }));
        tie.position.set(0, 1.2, 0.14); g.add(tie);
      }
      var arms = [];
      for (var a = 0; a < 2; a++) {
        var arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
        arm.position.set(a ? 0.26 : -0.26, 1.14, 0);
        arm.castShadow = true; g.add(arm); arms.push(arm);
      }
      var legs = [];
      for (var l = 0; l < 2; l++) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.78, 0.14), new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.9 }));
        leg.position.set(l ? 0.11 : -0.11, 0.4, 0);
        leg.castShadow = true; g.add(leg); legs.push(leg);
      }
      // speech bubble sprite
      var bubbleCanvas = document.createElement('canvas');
      bubbleCanvas.width = 512; bubbleCanvas.height = 192;
      var bCtx = bubbleCanvas.getContext('2d');
      var bTex = new THREE.CanvasTexture(bubbleCanvas);
      var bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bTex, transparent: true, depthTest: false }));
      bubble.scale.set(1.5, 0.56, 1); bubble.position.y = 2.05; bubble.visible = false;
      g.add(bubble);
      return {
        group: g, arms: arms, legs: legs, bubble: bubble, bCtx: bCtx, bTex: bTex, head: head, hair: hair,
        say: function (text, ms) {
          bCtx.clearRect(0, 0, 512, 192);
          bCtx.fillStyle = 'rgba(12,18,30,0.92)';
          roundRect(bCtx, 6, 6, 500, 180, 26); bCtx.fill();
          bCtx.strokeStyle = '#7ef0b4'; bCtx.lineWidth = 5; bCtx.stroke();
          bCtx.direction = 'rtl'; bCtx.textAlign = 'center';
          bCtx.fillStyle = '#eaf3ff';
          bCtx.font = 'bold 38px "Noto Kufi Arabic",Tahoma,sans-serif';
          var words = String(text).split(' '), line = '', lines = [];
          for (var i = 0; i < words.length; i++) {
            if ((line + ' ' + words[i]).length > 26) { lines.push(line); line = words[i]; } else line = line ? line + ' ' + words[i] : words[i];
          }
          if (line) lines.push(line);
          lines.slice(0, 3).forEach(function (ln, i) { bCtx.fillText(ln, 256, 68 + i * 46); });
          bTex.needsUpdate = true;
          bubble.visible = true;
          if (bubble.userData.t) clearTimeout(bubble.userData.t);
          bubble.userData.t = setTimeout(function () { bubble.visible = false; }, ms || 4200);
        }
      };
    }

    // ---- coworkers walking
    var coopSpots = [
      new THREE.Vector3(-1.5, 0, -1.2), new THREE.Vector3(1.2, 0, 2.6), new THREE.Vector3(-5.5, 0, 3.2),
      new THREE.Vector3(5.6, 0, -0.6), new THREE.Vector3(-1.6, 0, 4.2), new THREE.Vector3(3.4, 0, 4.4)
    ];
    SWYF.data.coworkers.forEach(function (cw, i) {
      var hum = makeHuman({ hair: i % 2 ? 0x2a1a12 : 0x3a2a18 });
      hum.group.position.copy(coopSpots[i % coopSpots.length]);
      root.add(hum.group);
      var npc = {
        id: cw.id, name: cw.name, emoji: cw.emoji, lines: cw.lines, voice: cw.voice,
        obj: hum, target: coopSpots[(i + 2) % coopSpots.length].clone(),
        speed: U.rnd(0.55, 0.95), waitT: U.rnd(1, 6), talked: 0, mood: 1
      };
      npcs.push(npc);
      interactables.push({ id: 'npc_' + cw.id, label: 'هضر مع ' + cw.name, npc: npc, kind: 'npc', radius: 1.35, pos: hum.group.position });
    });

    // ---- boss npc
    var bossHum = makeHuman({ tie: 0xd23b3b, hair: 0x101010 });
    bossHum.group.position.copy(flags.bossStand);
    bossHum.group.scale.set(1.06, 1.06, 1.06);
    root.add(bossHum.group);
    flags.boss = bossHum;
    interactables.push({ id: 'bossnpc', label: 'هضر مع البوس', npc: { id: 'boss', name: 'السيد بولعيد', emoji: '👔', lines: SWYF.data.boss.lines.intro, voice: 'm', obj: bossHum }, kind: 'npc', radius: 1.5, pos: bossHum.group.position });

    // ---- dynamic objects (created by events)
    function virusCube() {
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xff3b6b, emissive: 0x66112a, roughness: 0.3 }));
      m.position.set(U.rnd(-6, 6), U.rnd(1.4, 2.4), U.rnd(-4, 4));
      root.add(m);
      return m;
    }
    function fireball(pos, cb) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(U.rnd(0.5, 1.1), 14, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a }));
      m.position.copy(pos);
      root.add(m);
      var t0 = performance.now();
      function tick() {
        var k = (performance.now() - t0) / 900;
        if (k >= 1) { root.remove(m); m.geometry.dispose(); m.material.dispose(); cb && cb(); return; }
        m.position.y += 0.02; m.scale.setScalar(1 + k * 1.6);
        m.material.color.setHSL(0.08 - k * 0.06, 1, 0.55 - k * 0.25);
        requestAnimationFrame(tick);
      }
      tick();
    }

    // ---- lights out / fire states
    var powerOn = true;
    var hazardFire = null;
    function setPower(on) {
      powerOn = on;
      lamps.forEach(function (l) {
        l.light.intensity = on ? 0.55 : 0.05;
        l.bulb.material.color.setHex(on ? 0xffeec2 : 0x333333);
      });
      hemi.intensity = on ? 0.55 : 0.16;
      sun.intensity = on ? 0.85 : 0.25;
      scene.background.setHex(on ? 0x0a0e16 : 0x05070c);
      scene.fog.color.setHex(on ? 0x0a0e16 : 0x05070c);
      monitors.forEach(function (m) { m.glare.intensity = on ? 0.25 : 0.06; });
    }
    function setFire(on, pos) {
      if (on && !hazardFire) {
        hazardFire = { t: 0, m: new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85 })), p: (pos || new THREE.Vector3(U.rnd(-6, 6), 0.5, U.rnd(-4, 4))).clone() };
        hazardFire.m.position.copy(hazardFire.p);
        root.add(hazardFire.m);
      } else if (!on && hazardFire) {
        root.remove(hazardFire.m); hazardFire.m.geometry.dispose(); hazardFire.m.material.dispose(); hazardFire = null;
      }
    }

    // ---- clock hands from shift progress (9:00 → 18:00)
    function setShift(progress) {
      var secs = 9 * 3600 + progress * 9 * 3600;
      var hours = secs / 3600, mins = (hours % 1) * 60;
      mGrp.rotation.x = -((mins / 60) * Math.PI * 2);
      hGrp.rotation.x = -(((hours % 12) / 12) * Math.PI * 2);
    }

    function setQuota(sub) {
      flags.quotaSign.dispose();
      flags.quotaSign = signTexture('الكوتا اليومية', sub, { bg: '#101820', border: '#39d18b', title: '#7ef0b4', sub: '#ffffff', foot: 'من يوصل، يبقى — من ما يوصلش، يمشي' });
      wb.material.map = flags.quotaSign;
      wb.material.needsUpdate = true;
    }
    function setFired(on) {
      firedPoster.material.map.dispose();
      firedPoster.material.map = signTexture(on ? 'مطرود!' : 'YOU ARE FIRED', on ? 'الملف تسدّ' : 'الكوتا اليومية', { bg: on ? '#3a0a10' : '#2a0e12', border: on ? '#ff3b3b' : '#e04a5a', title: on ? '#ff9aa5' : '#ff6b7a', sub: on ? '#ffd7db' : '#ffb3bb', foot: 'قسم الإنتاجية' });
      firedPoster.material.needsUpdate = true;
    }

    // ---- simple NPC update
    function update(dt, playerPos) {
      var t = performance.now() / 1000;
      npcs.forEach(function (n, i) {
        var g = n.obj.group;
        // walk to target
        var dx = n.target.x - g.position.x, dz = n.target.z - g.position.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.35) {
          var vx = (dx / dist) * n.speed * dt, vz = (dz / dist) * n.speed * dt;
          g.position.x += vx; g.position.z += vz;
          g.rotation.y = Math.atan2(vx, vz);
          var sw = Math.sin(t * 9 + i) * 0.6;
          n.obj.legs[0].rotation.x = sw; n.obj.legs[1].rotation.x = -sw;
          n.obj.arms[0].rotation.x = -sw * 0.7; n.obj.arms[1].rotation.x = sw * 0.7;
        } else {
          n.waitT -= dt;
          var sw2 = Math.sin(t * 2 + i) * 0.06;
          n.obj.legs[0].rotation.x = 0; n.obj.legs[1].rotation.x = 0;
          n.obj.arms[0].rotation.x = sw2; n.obj.arms[1].rotation.x = -sw2;
          if (n.waitT <= 0) {
            n.waitT = U.rnd(3, 9);
            n.target = coopSpots[U.irnd(0, coopSpots.length - 1)].clone();
            // avoid standing inside the player
            if (playerPos && n.target.distanceTo(playerPos) < 1.2) n.target.x += 2.2;
          }
        }
        // look at player when close
        if (playerPos && g.position.distanceTo(playerPos) < 3.2) {
          var ang = Math.atan2(playerPos.x - g.position.x, playerPos.z - g.position.z);
          g.rotation.y += (ang - g.rotation.y) * Math.min(1, dt * 3);
        }
        // keep inside the room
        g.position.x = U.clamp(g.position.x, -W / 2 + 0.6, W / 2 - 0.6);
        g.position.z = U.clamp(g.position.z, -DP / 2 + 0.6, DP / 2 - 0.6);
        if (n.talkT > 0) n.talkT -= dt;
      });
      // boss idle sway
      if (flags.boss) {
        flags.boss.group.rotation.y = Math.sin(t * 0.5) * 0.5 + Math.PI;
        flags.boss.arms[0].rotation.x = Math.sin(t * 1.3) * 0.12;
        flags.boss.arms[1].rotation.x = -Math.sin(t * 1.3) * 0.12;
      }
      // monitor sizzle (cheap flicker on the glare only)
      monitors.forEach(function (m) {
        if (Math.random() < 0.01) m.glare.intensity = 0.18 + Math.random() * 0.2;
      });
      if (hazardFire) {
        hazardFire.t += dt;
        var s = 1 + Math.sin(t * 12) * 0.12;
        hazardFire.m.scale.setScalar(s);
        hazardFire.m.material.opacity = 0.6 + Math.sin(t * 9) * 0.2;
      }
    }

    return {
      scene: scene, THREE: THREE, colliders: colliders, interactables: interactables, npcs: npcs,
      flags: flags, W: W, DP: DP, H: H,
      update: update, setPower: setPower, setFire: setFire, setShift: setShift,
      setQuota: setQuota, setFired: setFired, virusCube: virusCube, fireball: fireball,
      signTexture: signTexture, screenTexture: screenTexture, makeHuman: makeHuman,
      addCollider: addCollider, root: root
    };
  }

  SWYF.World = { build: build };
})();
