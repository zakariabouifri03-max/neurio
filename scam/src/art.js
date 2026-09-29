/* ============================================================================
 * Scam Baqi — art.js
 * The flat-shaded "toy" art kit: big-headed featureless characters with floating
 * name tags, neon signs, checkered casino walls, blue office carpet, sticky
 * notes, motivational posters, office chairs, strip lights…
 *
 * Everything is generated procedurally (canvas + primitives) — 100% offline.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util;
  var THREE = window.THREE;

  // ------------------------------------------------------------------ palettes
  // Exotic flat skin tones straight out of the reference screenshots
  var SKINS = [0xff8a3d, 0xffb03a, 0xf7d24a, 0x8fd46a, 0x66c9a0, 0xff7a8a, 0xd9a066, 0xc98fe0, 0x6fb8ff, 0xffffff];
  var HAIRS = [0xff5a1f, 0xffd23a, 0x3a2a1f, 0x111111, 0xff4d8d, 0x6ad0ff, 0xb46bff, 0xf0f0f0, 0x8a4b2a];
  var SHIRTS = [0xff4d4d, 0x2f7dff, 0x22c07a, 0xffd23a, 0xff8a3d, 0x9b5cff, 0x00c2d1, 0xf0f0f0, 0x21252e, 0xff7ab8];
  var PANTS = [0x2b3a55, 0x3b3f4a, 0x5a3b2a, 0x243b2e, 0x4a2b3b, 0x1f2430];
  var SHOES = [0x1b1f27, 0xf0f0f0, 0xff5a1f, 0x2f7dff];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function flat(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color, roughness: opts.rough == null ? 0.82 : opts.rough,
      metalness: opts.metal == null ? 0 : opts.metal,
      flatShading: opts.smooth ? false : true,
      emissive: opts.emissive == null ? 0x000000 : opts.emissive,
      emissiveIntensity: opts.ei == null ? 1 : opts.ei,
      transparent: !!opts.transparent, opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side || THREE.FrontSide
    });
  }
  function basic(color, opts) {
    opts = opts || {};
    return new THREE.MeshBasicMaterial({
      color: color, transparent: !!opts.transparent, opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side || THREE.FrontSide, map: opts.map || null, depthTest: opts.depthTest !== false
    });
  }

  // ------------------------------------------------------------------- canvas
  function canvas(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function tex(c, repeat) {
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

  // ---------------------------------------------------------- name tag sprite
  function nameTagTexture(name, colorHex, emoji) {
    var W = 512, H = 160;
    var c = canvas(W, H, function (g) {
      g.clearRect(0, 0, W, H);
      var col = '#' + ('000000' + colorHex.toString(16)).slice(-6);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = 'bold 74px "Noto Kufi Arabic",Tahoma,sans-serif';
      var tw = g.measureText(name).width;
      // avatar chip
      var chip = 100, pad = 16;
      var totalW = Math.min(W - 20, chip + tw + pad * 3);
      var x0 = (W - totalW) / 2;
      g.fillStyle = 'rgba(0,0,0,0.28)';
      roundRect(g, x0, 26, totalW, chip, 26); g.fill();
      g.fillStyle = 'rgba(20,26,40,0.85)';
      roundRect(g, x0 + 6, 32, totalW - 12, chip - 12, 22); g.fill();
      g.fillStyle = col;
      roundRect(g, x0 + 12, 38, chip - 12, chip - 12, 18); g.fill();
      g.font = '58px "Segoe UI Emoji",sans-serif';
      g.textAlign = 'center';
      g.fillText(emoji || '🙂', x0 + 12 + (chip - 12) / 2, 38 + (chip - 12) / 2 + 2);
      g.font = 'bold 70px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.textAlign = 'left';
      g.lineWidth = 12; g.strokeStyle = 'rgba(12,16,26,0.95)';
      g.strokeText(name, x0 + chip + 14, 38 + (chip - 12) / 2 + 4);
      g.fillStyle = col;
      g.fillText(name, x0 + chip + 14, 38 + (chip - 12) / 2 + 4);
    });
    return tex(c);
  }

  function makeNameTag(name, colorHex, emoji) {
    var t = nameTagTexture(name, colorHex, emoji);
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(1.25, 0.39, 1);
    s.position.y = 2.12;
    s.renderOrder = 999;
    return s;
  }

  // ----------------------------------------------------------------- characters
  /**
   * The signature look: big featureless head, capsule limbs, flat colours,
   * headphones, floating name tag, springy walk.
   */
  function makeCharacter(opts) {
    opts = opts || {};
    var skin = opts.skin != null ? opts.skin : pick(SKINS);
    var hair = opts.hair != null ? opts.hair : pick(HAIRS);
    var shirt = opts.shirt != null ? opts.shirt : pick(SHIRTS);
    var pants = opts.pants != null ? opts.pants : pick(PANTS);
    var shoe = opts.shoe != null ? opts.shoe : pick(SHOES);
    var scale = opts.scale || 1;
    var headR = 0.30;

    var g = new THREE.Group();
    var M = {
      skin: flat(skin, { rough: 0.75 }),
      hair: flat(hair, { rough: 0.9 }),
      shirt: flat(shirt, { rough: 0.85 }),
      pants: flat(pants, { rough: 0.9 }),
      shoe: flat(shoe, { rough: 0.7 }),
      dark: flat(0x1b1f27, { rough: 0.6 }),
      metal: flat(0xb9c2cc, { rough: 0.4, metal: 0.5 })
    };

    // torso: chunky capsule (no neck visible — head sits straight on it)
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.20, 4, 12), M.shirt);
    torso.position.y = 1.03; torso.scale.set(1.18, 1, 0.92);
    torso.castShadow = true; g.add(torso);

    var hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.1, 4, 10), M.pants);
    hip.position.y = 0.79; hip.scale.set(1.2, 1, 0.95); hip.castShadow = true; g.add(hip);

    // big flat-shaded head (sphere, slightly squashed) + hair cap
    var head = new THREE.Mesh(new THREE.SphereGeometry(headR, 14, 12), M.skin);
    head.position.y = 1.55; head.scale.set(1, 1.02, 0.96); head.castShadow = true; g.add(head);

    var hairMesh = new THREE.Mesh(new THREE.SphereGeometry(headR + 0.015, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), M.hair);
    hairMesh.position.y = 1.56; hairMesh.castShadow = true; g.add(hairMesh);
    if (opts.hairTuft) {
      var tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), M.hair);
      tuft.position.set(0.02, 1.86, -0.02); tuft.rotation.z = 0.25; g.add(tuft);
    }

    // face: two flat oval eyes (featureless otherwise — exactly like the reference)
    var eyes = [];
    for (var e = 0; e < 2; e++) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), basic(opts.eyeColor == null ? 0x14181f : opts.eyeColor));
      eye.position.set(e ? 0.095 : -0.095, 1.60, headR - 0.045);
      eye.scale.set(1, 1.25, 0.45);
      g.add(eye); eyes.push(eye);
    }
    // tiny mouth (optional)
    var mouth = null;
    if (opts.mouth !== false) {
      mouth = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), basic(0x2a1010));
      mouth.position.set(0, 1.47, headR - 0.05);
      mouth.scale.set(1.5, 0.8, 0.4);
      g.add(mouth);
    }

    // arms with mitten hands
    var arms = [], hands = [];
    for (var a = 0; a < 2; a++) {
      var pivot = new THREE.Group();
      pivot.position.set(a ? 0.29 : -0.29, 1.20, 0);
      var arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.30, 4, 8), M.shirt);
      arm.position.y = -0.20; arm.castShadow = true; pivot.add(arm);
      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), M.skin);
      hand.position.y = -0.42; hand.scale.set(1, 0.9, 1); pivot.add(hand);
      g.add(pivot); arms.push(pivot); hands.push(hand);
    }

    // legs + chunky shoes
    var legs = [], shoes = [];
    for (var l = 0; l < 2; l++) {
      var lp = new THREE.Group();
      lp.position.set(l ? 0.11 : -0.11, 0.72, 0);
      var leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.42, 4, 8), M.pants);
      leg.position.y = -0.31; leg.castShadow = true; lp.add(leg);
      var sh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.11, 0.28), M.shoe);
      sh.position.set(0, -0.60, 0.04); sh.castShadow = true; lp.add(sh);
      g.add(lp); legs.push(lp); shoes.push(sh);
    }

    // headphones (call-centre crew)
    var headphones = null;
    if (opts.headset !== false) {
      headphones = new THREE.Group();
      var band = new THREE.Mesh(new THREE.TorusGeometry(headR + 0.035, 0.025, 8, 18, Math.PI), M.dark);
      band.position.y = 1.57; band.rotation.z = Math.PI; headphones.add(band);
      var padL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), M.dark);
      padL.rotation.z = Math.PI / 2; padL.position.set(-(headR + 0.03), 1.55, 0); headphones.add(padL);
      var padR = padL.clone(); padR.position.x = headR + 0.03; headphones.add(padR);
      var mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.22, 4, 6), M.dark);
      mic.position.set(headR - 0.02, 1.42, 0.10); mic.rotation.z = 1.15; mic.rotation.x = -0.5; headphones.add(mic);
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.metal);
      tip.position.set(headR - 0.12, 1.34, 0.16); headphones.add(tip);
      g.add(headphones);
    }

    // tie / collar for the boss look
    if (opts.tie) {
      var tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.30, 0.04), flat(opts.tie, { rough: 0.5 }));
      tie.position.set(0, 1.06, 0.24); g.add(tie);
      var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 12, 1, true), flat(0xf2f2f2, { rough: 0.7 }));
      collar.position.y = 1.24; g.add(collar);
    }

    // floating name tag
    var tag = null;
    if (opts.name) {
      tag = makeNameTag(opts.name, opts.tagColor == null ? shirt : opts.tagColor, opts.emoji || '🙂');
      g.add(tag);
    }

    // speech bubble (same API the old characters had)
    var bCanvas = canvas(512, 192, function () {});
    var bTex = tex(bCanvas);
    var bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bTex, transparent: true, depthTest: false }));
    bubble.scale.set(1.5, 0.56, 1); bubble.position.y = 2.5; bubble.visible = false;
    g.add(bubble);

    g.scale.setScalar(scale);

    var char = {
      group: g, torso: torso, hip: hip, head: head, hair: hairMesh, eyes: eyes, mouth: mouth,
      arms: arms, hands: hands, legs: legs, shoes: shoes, headphones: headphones, tag: tag,
      bubble: bubble, bCtx: bCanvas.getContext('2d'), bTex: bTex,
      skinColor: skin, shirtColor: shirt,
      bobT: Math.random() * 6.28, knocked: 0, ragdoll: false, vy: 0, vx: 0, vz: 0, spin: 0, spinV: 0,
      say: function (text, ms) {
        var g2 = char.bCtx;
        g2.clearRect(0, 0, 512, 192);
        g2.fillStyle = 'rgba(12,18,30,0.92)';
        roundRect(g2, 6, 6, 500, 180, 26); g2.fill();
        g2.strokeStyle = '#7ef0b4'; g2.lineWidth = 5; g2.stroke();
        g2.direction = 'rtl'; g2.textAlign = 'center';
        g2.fillStyle = '#eaf3ff';
        g2.font = 'bold 38px "Noto Kufi Arabic",Tahoma,sans-serif';
        var words = String(text).split(' '), line = '', lines = [];
        for (var i = 0; i < words.length; i++) {
          if ((line + ' ' + words[i]).length > 26) { lines.push(line); line = words[i]; } else line = line ? line + ' ' + words[i] : words[i];
        }
        if (line) lines.push(line);
        lines.slice(0, 3).forEach(function (ln, i) { g2.fillText(ln, 256, 68 + i * 46); });
        bTex.needsUpdate = true;
        bubble.visible = true;
        if (bubble.userData.t) clearTimeout(bubble.userData.t);
        bubble.userData.t = setTimeout(function () { bubble.visible = false; }, ms || 4200);
      },
      /** walk animation (call every frame with speed 0…1) */
      walk: function (spd, t) {
        if (char.ragdoll) return;
        var sw = Math.sin(t * 9) * 0.75 * spd;
        char.legs[0].rotation.x = sw; char.legs[1].rotation.x = -sw;
        char.arms[0].rotation.x = -sw * 0.8; char.arms[1].rotation.x = sw * 0.8;
        char.bobT = t;
        g.position.y = Math.abs(Math.sin(t * 9)) * 0.045 * spd;
      },
      idle: function (t) {
        if (char.ragdoll) return;
        char.legs[0].rotation.x = 0; char.legs[1].rotation.x = 0;
        char.arms[0].rotation.x = Math.sin(t * 1.6) * 0.09;
        char.arms[1].rotation.x = -Math.sin(t * 1.6) * 0.09;
        g.position.y = Math.sin(t * 1.7) * 0.012;
      },
      look: function (x, z) { g.rotation.y = Math.atan2(x - g.position.x, z - g.position.z); }
    };
    return char;
  }

  // ------------------------------------------------------------------ textures
  function officeCarpet() {
    return tex(canvas(512, 512, function (g, w, h) {
      g.fillStyle = '#33477a'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 5200; i++) {
        g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
      for (var x = 0; x < w; x += 128) {
        for (var y = 0; y < h; y += 128) {
          g.fillStyle = ((x / 128 + y / 128) % 2) ? 'rgba(20,30,60,0.18)' : 'rgba(90,120,200,0.14)';
          g.fillRect(x, y, 128, 128);
        }
      }
    }), [7, 5]);
  }

  function casinoCarpet() {
    return tex(canvas(512, 512, function (g, w, h) {
      g.fillStyle = '#2a1b4a'; g.fillRect(0, 0, w, h);
      var cols = ['#e94f37', '#f6b93b', '#2f9e9e', '#5a2a8a', '#d94f8a', '#3b6fd9'];
      for (var i = 0; i < 26; i++) {
        g.fillStyle = cols[i % cols.length];
        g.beginPath();
        var cx = Math.random() * w, cy = Math.random() * h, r = U.rnd(22, 70);
        g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.beginPath(); g.arc(cx, cy, r * 0.45, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 10;
      for (var k = 0; k < w; k += 128) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
    }), [6, 6]);
  }

  function checkerWall(colA, colB) {
    return tex(canvas(256, 256, function (g, w, h) {
      for (var y = 0; y < h; y += 32) {
        for (var x = 0; x < w; x += 32) {
          g.fillStyle = ((x / 32 + y / 32) % 2) ? colA : colB;
          g.fillRect(x, y, 32, 32);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, w, h);
    }), [8, 3]);
  }

  /** "STAY AWAKE" style sticky note (image 1 of the reference) */
  function stickyNote(text, color) {
    return tex(canvas(256, 256, function (g, w, h) {
      g.fillStyle = color || '#ffe14d'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, h - 26, w, 26);
      g.fillStyle = '#1b1b1b';
      g.font = 'bold 54px "Noto Kufi Arabic",Impact,Tahoma,sans-serif';
      g.textAlign = 'center';
      var words = String(text).split(' ');
      words.slice(0, 2).forEach(function (ln, i) { g.fillText(ln, w / 2, 108 + i * 58); });
      // doodle eyes, like the reference note
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 6;
      g.beginPath(); g.arc(w / 2 - 30, 210, 16, 0, 6.3); g.stroke();
      g.beginPath(); g.arc(w / 2 + 30, 210, 16, 0, 6.3); g.stroke();
      g.beginPath(); g.arc(w / 2 - 30, 210, 6, 0, 6.3); g.stroke();
      g.beginPath(); g.arc(w / 2 + 30, 210, 6, 0, 6.3); g.stroke();
    }));
  }

  /** Big glowing neon sign (casino / arcade look) */
  function neonTexture(text, color, opts) {
    opts = opts || {};
    return tex(canvas(1024, 384, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      var col = color || '#ff4fd8';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = (opts.font || 'bold 150px') + ' Impact,"Noto Kufi Arabic",Tahoma,sans-serif';
      g.shadowColor = col; g.shadowBlur = 60;
      for (var i = 0; i < 3; i++) { g.fillStyle = col; g.fillText(text, w / 2, h / 2); }
      g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(text, w / 2, h / 2);
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeText(text, w / 2, h / 2);
      if (opts.sub) {
        g.shadowBlur = 24; g.shadowColor = opts.subColor || '#ffd447';
        g.fillStyle = opts.subColor || '#ffd447';
        g.font = 'bold 64px "Noto Kufi Arabic",Tahoma,sans-serif';
        g.fillText(opts.sub, w / 2, h / 2 + 120);
      }
    }));
  }

  function motivationalPoster(kind) {
    var sets = {
      awake: { bg: '#f7f3e2', title: 'STAY AWAKE', sub: 'القهوة ماشي رفاهية', col: '#e74c3c', art: 'coffee' },
      quota: { bg: '#eef4ff', title: 'SELL SELL SELL', sub: 'الكوتا قبل 18:00', col: '#2f7dff', art: 'chart' },
      smile: { bg: '#fdf0f6', title: 'SMILE!', sub: 'الضحية كتحس بالصوت', col: '#ff4d8d', art: 'face' },
      quiet: { bg: '#eafaf1', title: 'KEEP IT DOWN', sub: 'البوس كيسمع كلشي', col: '#22c07a', art: 'shh' },
      danger: { bg: '#fff4e5', title: 'DANGER SIGNS', sub: '«بلوكيست» · سؤال الملف', col: '#e67e22', art: 'warn' }
    };
    var s = sets[kind] || sets.awake;
    return tex(canvas(768, 1024, function (g, w, h) {
      g.fillStyle = s.bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = s.col; g.lineWidth = 22; g.strokeRect(11, 11, w - 22, h - 22);
      g.fillStyle = s.col;
      g.font = 'bold 92px Impact,"Noto Kufi Arabic",Tahoma,sans-serif';
      g.textAlign = 'center';
      g.fillText(s.title, w / 2, 170);
      g.fillStyle = '#243247';
      g.font = 'bold 52px "Noto Kufi Arabic",Tahoma,sans-serif';
      g.fillText(s.sub, w / 2, 250);
      g.translate(w / 2, 620);
      g.strokeStyle = s.col; g.fillStyle = s.col; g.lineWidth = 18;
      if (s.art === 'coffee') {
        g.beginPath(); g.moveTo(-110, -60); g.lineTo(90, -60); g.lineTo(70, 130); g.lineTo(-90, 130); g.closePath(); g.stroke();
        g.beginPath(); g.arc(110, 10, 45, -1.2, 1.2); g.stroke();
        g.beginPath(); g.moveTo(-60, -110); g.quadraticCurveTo(-30, -150, -60, -190); g.stroke();
        g.beginPath(); g.moveTo(0, -110); g.quadraticCurveTo(30, -150, 0, -190); g.stroke();
      } else if (s.art === 'chart') {
        g.fillRect(-160, 40, 60, 100); g.fillRect(-70, -20, 60, 160); g.fillRect(20, -100, 60, 240); g.fillRect(110, -160, 60, 300);
      } else if (s.art === 'face') {
        g.beginPath(); g.arc(0, 0, 150, 0, 6.3); g.stroke();
        g.beginPath(); g.arc(-55, -30, 22, 0, 6.3); g.fill();
        g.beginPath(); g.arc(55, -30, 22, 0, 6.3); g.fill();
        g.beginPath(); g.arc(0, 30, 90, 0.2, Math.PI - 0.2); g.stroke();
      } else if (s.art === 'shh') {
        g.beginPath(); g.arc(0, -30, 120, 0, 6.3); g.stroke();
        g.beginPath(); g.moveTo(-40, 20); g.quadraticCurveTo(0, 40, 40, 20); g.stroke();
        g.font = 'bold 280px Tahoma'; g.textAlign = 'center'; g.fillText('!', 0, 250);
      } else {
        g.beginPath(); g.moveTo(0, -190); g.lineTo(180, 150); g.lineTo(-180, 150); g.closePath(); g.stroke();
        g.font = 'bold 200px Tahoma'; g.textAlign = 'center'; g.fillText('!', 0, 90);
      }
    }));
  }

  // ------------------------------------------------------------------- props
  function chair(color) {
    var g = new THREE.Group();
    var c = color == null ? 0xe8552f : color;
    var seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.5), flat(c, { rough: 0.7 }));
    seat.position.y = 0.47; seat.castShadow = true; g.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.1), flat(c, { rough: 0.7 }));
    back.position.set(0, 0.79, 0.24); back.rotation.x = -0.12; back.castShadow = true; g.add(back);
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 10), flat(0x9aa3ad, { metal: 0.5, rough: 0.4 }));
    post.position.y = 0.24; g.add(post);
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.06, 12), flat(0x2b2f38));
    base.position.y = 0.03; g.add(base);
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2;
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.06), flat(0x2b2f38));
      leg.position.set(Math.sin(a) * 0.16, 0.05, Math.cos(a) * 0.16);
      leg.rotation.y = a; g.add(leg);
    }
    return g;
  }

  function stripLight(len) {
    var g = new THREE.Group();
    var box = new THREE.Mesh(new THREE.BoxGeometry(len || 2.0, 0.09, 0.42), flat(0xf4f6ff, { rough: 0.5, emissive: 0xfff4dd, ei: 0.7 }));
    g.add(box);
    var frame = new THREE.Mesh(new THREE.BoxGeometry((len || 2.0) + 0.1, 0.05, 0.5), flat(0xccd2dd));
    frame.position.y = 0.06; g.add(frame);
    var l = new THREE.PointLight(0xfff2d8, 0.42, 9, 2);
    l.position.y = -0.35; g.add(l);
    g.userData.light = l;
    return g;
  }

  function plant() {
    var g = new THREE.Group();
    var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.38, 10), flat(0xc9754a, { rough: 0.9 }));
    pot.position.y = 0.19; pot.castShadow = true; g.add(pot);
    var leafMat = flat(0x3fbf6a, { rough: 0.85, side: THREE.DoubleSide });
    for (var i = 0; i < 7; i++) {
      var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, U.rnd(0.45, 0.75), 5), leafMat);
      var a = (i / 7) * Math.PI * 2;
      leaf.position.set(Math.sin(a) * 0.11, 0.62, Math.cos(a) * 0.11);
      leaf.rotation.set(U.rnd(-0.35, 0.35), a, U.rnd(-0.3, 0.3));
      g.add(leaf);
    }
    return g;
  }

  function waterCooler() {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.95, 14), flat(0xeff2f6, { rough: 0.6 }));
    body.position.y = 0.48; body.castShadow = true; g.add(body);
    var bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.62, 14), flat(0x8fd9ff, { transparent: true, opacity: 0.7, rough: 0.15 }));
    bottle.position.y = 1.28; g.add(bottle);
    var tap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), flat(0x2f7dff));
    tap.position.set(0, 0.72, -0.28); g.add(tap);
    return g;
  }

  /** The office PC from the reference: grey desk, widescreen monitor, keyboard, mouse */
  function deskSetup(opts) {
    opts = opts || {};
    var g = new THREE.Group();
    var topMat = flat(opts.topColor == null ? 0xc9ccd2 : opts.topColor, { rough: 0.7 });
    var top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 1.1), topMat);
    top.position.y = 0.76; top.castShadow = top.receiveShadow = true; g.add(top);
    var legMat = flat(0x9aa3ad, { metal: 0.4, rough: 0.5 });
    [[-1.0, -0.45], [1.0, -0.45], [-1.0, 0.45], [1.0, 0.45]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.76, 0.07), legMat);
      leg.position.set(p[0], 0.38, p[1]); g.add(leg);
    });
    // widescreen monitor
    var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.04, 14), flat(0x22262e));
    stand.position.set(-0.42, 0.82, -0.22); g.add(stand);
    var neck = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.05), flat(0x22262e));
    neck.position.set(-0.42, 0.96, -0.22); g.add(neck);
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.62, 0.05), flat(0x181c24, { rough: 0.5 }));
    bezel.position.set(-0.42, 1.30, -0.20); bezel.castShadow = true; g.add(bezel);
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.54), basic(0x0a1220, { map: opts.screenMap }));
    screen.position.set(-0.42, 1.30, -0.17); g.add(screen);
    var glare = new THREE.PointLight(0x88bbff, 0.22, 2.4, 2);
    glare.position.set(-0.42, 1.25, -0.02); g.add(glare);
    // keyboard + mouse
    var kb = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.03, 0.24), flat(0x22262e, { rough: 0.55 }));
    kb.position.set(0.28, 0.81, -0.06); g.add(kb);
    for (var r = 0; r < 4; r++) for (var c = 0; c < 14; c++) {
      var key = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.045), flat(0x3a4150));
      key.position.set(0.28 + (c - 6.5) * 0.053, 0.828, -0.06 + (r - 1.5) * 0.055); g.add(key);
    }
    var mouse = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), flat(0x22262e, { rough: 0.5 }));
    mouse.position.set(0.82, 0.81, -0.04); mouse.scale.set(0.8, 0.6, 1.2); g.add(mouse);
    g.userData.screen = screen; g.userData.glare = glare;
    return g;
  }

  function boxProp(size, color) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(size, size * U.rnd(0.7, 1.1), size * U.rnd(0.8, 1.2)), flat(color, { rough: 0.9 }));
    m.castShadow = true;
    return m;
  }

  SWYF.art = {
    SKINS: SKINS, HAIRS: HAIRS, SHIRTS: SHIRTS, PANTS: PANTS, SHOES: SHOES,
    flat: flat, basic: basic, canvas: canvas, tex: tex, roundRect: roundRect, pick: pick,
    makeCharacter: makeCharacter, makeNameTag: makeNameTag, nameTagTexture: nameTagTexture,
    officeCarpet: officeCarpet, casinoCarpet: casinoCarpet, checkerWall: checkerWall,
    stickyNote: stickyNote, neonTexture: neonTexture, motivationalPoster: motivationalPoster,
    chair: chair, stripLight: stripLight, plant: plant, waterCooler: waterCooler,
    deskSetup: deskSetup, boxProp: boxProp
  };
})();
