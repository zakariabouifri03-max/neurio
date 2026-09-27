// ============================================================
// textures.js — every texture in the game, painted procedurally
// on small canvases (64–256px) with nearest filtering for the
// crunchy PS1/PS2 low-fi look.
// ============================================================
import { canvasTex, speckle, rand, pick, makeCanvas } from './utils.js';

export function buildTextures() {
  const T = {};

  // ---------------- ground & structure ----------------
  T.asphalt = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#232323'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 700, ['#2b2b2b', '#1c1c1e', '#2e2d2c', '#191919']);
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) { // cracks
      c.beginPath(); let x = rand(0, w), y = rand(0, h); c.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += rand(-16, 16); y += rand(-16, 16); c.lineTo(x, y); }
      c.stroke();
    }
  }, { repeat: [8, 8] });

  T.concrete = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#5f5b52'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 300, ['#6a665d', '#54504a', '#716c60']);
    c.strokeStyle = 'rgba(20,20,20,.55)'; c.lineWidth = 2;
    c.strokeRect(-1, -1, w + 2, h + 2); // slab seams
  }, { repeat: [6, 2] });

  T.dirt = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#232a1e'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 900, ['#2b3325', '#1b2418', '#33392a', '#141b12']);
  }, { repeat: [10, 10] });

  T.stucco = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#8d7f6a'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 1000, ['#958a76', '#7e7260', '#9c927e', '#746a5b']);
    c.fillStyle = 'rgba(60,50,40,.18)';
    for (let i = 0; i < 5; i++) c.fillRect(0, rand(0, h), w, rand(2, 7)); // weather streaks
  }, { repeat: [4, 1] });

  T.roof = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#26252b'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 260, ['#302f36', '#1c1b21', '#343338']);
  }, { repeat: [6, 2] });

  T.wallInt = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#8a8474'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 220, ['#948e7e', '#7e7869', '#8f887a']);
  }, { repeat: [3, 1] });

  T.wallpaper = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#6e2f33'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { // stripes
      c.fillStyle = '#77363a'; c.fillRect(x, 0, 8, h);
    }
    for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 24) { // little motifs
      c.fillStyle = 'rgba(214,186,140,.5)';
      c.fillRect(x - 1, y - 3, 2, 6); c.fillRect(x - 3, y - 1, 6, 2);
    }
    c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(0, 0, w, 10);
  }, { repeat: [3, 1] });

  T.wainscot = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#4a3b2c'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { c.fillStyle = '#4f4030'; c.fillRect(x, 0, 4, h); c.fillStyle = '#423525'; c.fillRect(x + 4, 0, 2, h); }
    c.fillStyle = '#5c4c39'; c.fillRect(0, 0, w, 4);
  }, { repeat: [4, 1] });

  T.carpet = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#3c2a26'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 600, ['#46322c', '#33231f', '#4d3831']);
    c.strokeStyle = 'rgba(120,90,70,.25)';
    for (let i = 0; i < w; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
  }, { repeat: [4, 4] });

  T.linoleum = canvasTex(64, 64, (c, w, h) => {
    const s = 32;
    for (let x = 0; x < w; x += s) for (let y = 0; y < h; y += s) {
      c.fillStyle = ((x + y) / s) % 2 ? '#6b6558' : '#595347'; c.fillRect(x, y, s, s);
      c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x, y, s, 2); c.fillRect(x, y, 2, s);
    }
  }, { repeat: [4, 4] });

  T.tileBath = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#9aa39b'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3e4643'; c.lineWidth = 2;
    for (let i = 0; i <= w; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
    speckle(c, w, h, 90, ['#a9b0a8', '#8b948c']);
  }, { repeat: [2, 2] });

  T.ceiling = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#7d7a70'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 200, ['#6f6c63', '#8a877d']);
    c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(0, 0, w, 2); c.fillRect(0, 0, 2, h);
  }, { repeat: [3, 3] });

  T.woodDark = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#4a3726'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { c.fillStyle = `rgba(${30 + rand(30) | 0},${20 + rand(20) | 0},10,.4)`; c.fillRect(0, y, w, 1); }
  }, { repeat: [2, 2] });

  T.woodLight = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#6e5638'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { c.fillStyle = `rgba(${(60 + rand(40)) | 0},${(40 + rand(30)) | 0},15,.35)`; c.fillRect(0, y, w, 1); }
  }, { repeat: [2, 2] });

  T.metal = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#57585c'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 160, ['#626367', '#494a4e', '#6c6d72']);
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(0, 0, w, 6);
  }, { repeat: [1, 1] });

  T.washer = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#b8b4a6'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 120, ['#c2beb0', '#a9a596']);
    c.fillStyle = '#2e2e33'; c.fillRect(8, 8, 50, 14); // panel
    c.fillStyle = '#767a80'; c.fillRect(12, 12, 10, 6); c.fillRect(26, 12, 10, 6);
    c.fillStyle = '#c33'; c.fillRect(48, 12, 6, 6);
    c.beginPath(); c.arc(w / 2, h * 0.66, 30, 0, 7); c.fillStyle = '#3a3a40'; c.fill();
    c.beginPath(); c.arc(w / 2, h * 0.66, 24, 0, 7); c.fillStyle = '#14151a'; c.fill();
    c.fillStyle = 'rgba(120,140,160,.25)'; c.beginPath(); c.arc(w / 2 - 6, h * 0.66 - 6, 12, 0, 7); c.fill();
  });

  // fabric / soft
  T.curtain = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#5a4a3a'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) { c.fillStyle = 'rgba(0,0,0,.32)'; c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(255,230,190,.08)'; c.fillRect(x + 3, 0, 2, h); }
  }, { repeat: [2, 1] });

  T.bedspread = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#5e3b2e'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      c.fillStyle = ((x + y) / 16) % 2 ? '#654336' : '#573528'; c.fillRect(x, y, 16, 16);
      c.fillStyle = 'rgba(220,190,140,.4)'; c.fillRect(x + 6, y + 6, 4, 4);
    }
  }, { repeat: [2, 2] });

  T.pillow = canvasTex(32, 32, (c, w, h) => {
    c.fillStyle = '#d8d2c0'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 60, ['#cfc9b6', '#e2dccb']);
  });

  T.blinds = canvasTex(64, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) { c.fillStyle = '#b0a890'; c.fillRect(0, y, w, 4); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, y + 3, w, 1); }
  }, { repeat: [1, 2] });

  T.mirror = canvasTex(64, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#30363c'); g.addColorStop(.5, '#454c54'); g.addColorStop(1, '#23282e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  // ---------------- doors ----------------
  T.door = (color, num) => canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = color; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.fillRect(10, 8, w - 20, 44); c.fillRect(10, 62, w - 20, 56); // panels
    c.fillStyle = 'rgba(255,255,255,.07)';
    c.fillRect(12, 10, w - 24, 3); c.fillRect(12, 64, w - 24, 3);
    speckle(c, w, h, 120, ['rgba(0,0,0,.25)', 'rgba(255,255,255,.06)']);
    if (num) {
      c.fillStyle = '#2b2418'; c.fillRect(w / 2 - 16, 30, 32, 22);
      c.fillStyle = '#d8c78f'; c.font = 'bold 17px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(num), w / 2, 41);
    }
  });

  // ---------------- paper & writing ----------------
  T.note = (lines, w = 128, h = 96) => canvasTex(w, h, (c) => {
    c.fillStyle = '#d9d2b8'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(120,110,80,.25)';
    for (let y = 12; y < h; y += 10) c.fillRect(4, y, w - 8, 1);
    c.fillStyle = '#2b2b3a'; c.font = '9px "Comic Sans MS", cursive, sans-serif'; c.textBaseline = 'top';
    lines.forEach((ln, i) => c.fillText(ln, 6, 5 + i * 10));
    c.fillStyle = 'rgba(90,70,40,.3)'; c.beginPath(); c.ellipse(w - 18, h - 14, 9, 5, .4, 0, 7); c.fill(); // coffee ring
  });

  T.ledger = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#cfc7a8'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(110,90,60,.5)';
    for (let y = 14; y < h; y += 12) { c.beginPath(); c.moveTo(6, y); c.lineTo(w - 6, y); c.stroke(); }
    c.strokeStyle = 'rgba(160,60,50,.5)'; c.beginPath(); c.moveTo(30, 0); c.lineTo(30, h); c.stroke();
    c.fillStyle = 'rgba(40,40,60,.75)'; c.font = '8px cursive';
    const names = ['M. Kessler ..... 2', 'R. Pham ........ 6', '??? ............ 4', '________________'];
    names.forEach((n, i) => c.fillText(n, 8, 18 + i * 12));
  });

  T.cork = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#7a5c36'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 400, ['#86683e', '#6b502c', '#90744a']);
    for (let i = 0; i < 6; i++) {
      const x = rand(8, w - 30), y = rand(8, h - 30);
      c.save(); c.translate(x, y); c.rotate(rand(-0.2, 0.2));
      c.fillStyle = pick(['#d9d2b8', '#cfd4c8', '#d8c8b0']); c.fillRect(0, 0, rand(18, 28), rand(10, 20));
      c.fillStyle = '#222'; c.font = '4px monospace'; c.fillText(pick(['ICE $1', 'POOL?', 'CALL TOM', 'NO PETS', 'Rm9 ☠', 'sheriff']), 2, 6);
      c.fillStyle = '#a33'; c.fillRect(8, -2, 3, 3);
      c.restore();
    }
  });

  // polaroid photo (white border + dark photo)
  T.polaroid = (kind) => canvasTex(64, 80, (c, w, h) => {
    c.fillStyle = '#e6e0d2'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#0a0a10'; c.fillRect(6, 6, w - 12, w - 12);
    if (kind === 'motel') { // old photo of the motel sign
      c.fillStyle = '#3a4560'; c.fillRect(6, 6, w - 12, 20);
      c.fillStyle = '#ff7a50'; c.fillRect(16, 12, 20, 8);
      c.fillStyle = '#222'; c.fillRect(10, 30, 40, 18);
    } else if (kind === 'pool') { // the filled-in pool
      c.fillStyle = '#4a7a9a'; c.fillRect(8, 8, w - 16, w - 20);
      c.fillStyle = '#77a'; c.fillRect(12, 12, w - 24, w - 28);
      c.fillStyle = '#333'; c.fillRect(6, w - 14, w - 12, 4);
    } else if (kind === 'dana') { // a photo of... you, asleep on the office couch?
      c.fillStyle = '#17130e'; c.fillRect(6, 6, w - 12, w - 12);
      c.fillStyle = '#584a3a'; c.fillRect(10, 30, 44, 16); // couch
      c.fillStyle = '#c8b090'; c.fillRect(16, 26, 10, 8); // head
      c.fillStyle = 'rgba(255,240,200,.15)'; c.fillRect(6, 6, w - 12, 12);
    }
    c.fillStyle = '#333'; c.font = '7px cursive'; c.fillText(pick(['1994', 'oct 02', '☺', '']), 10, h - 12);
  });

  // ---------------- faces (low-res, uncanny on purpose) ----------------
  const faceBase = (skin, fn) => canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = skin; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 60, ['rgba(0,0,0,.1)', 'rgba(255,255,255,.07)']);
    fn && fn(c, w, h);
  });

  T.faceStalker = faceBase('#cdb9a8', (c, w, h) => {
    // heavy shadow brow
    c.fillStyle = 'rgba(20,14,12,.85)'; c.fillRect(10, 18, 44, 12);
    // hollow eyes
    c.fillStyle = '#0c0a09'; c.fillRect(16, 23, 11, 7); c.fillRect(37, 23, 11, 7);
    c.fillStyle = 'rgba(200,210,255,.25)'; c.fillRect(20, 25, 2, 2); c.fillRect(41, 25, 2, 2);
    // nose
    c.fillStyle = 'rgba(90,70,60,.5)'; c.fillRect(30, 32, 5, 10);
    // flat mouth, slightly too wide
    c.fillStyle = 'rgba(60,30,28,.9)'; c.fillRect(22, 47, 22, 3);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(22, 50, 22, 2);
    // gaunt cheeks
    c.fillStyle = 'rgba(80,60,55,.35)'; c.fillRect(12, 36, 8, 10); c.fillRect(44, 36, 8, 10);
  });

  T.faceVale = faceBase('#b99a80', (c, w, h) => {
    // deep set eyes, tired
    c.fillStyle = 'rgba(40,26,22,.7)'; c.fillRect(12, 20, 40, 9);
    c.fillStyle = '#17120f'; c.fillRect(17, 24, 9, 5); c.fillRect(38, 24, 9, 5);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(20, 25, 2, 2); c.fillRect(41, 25, 2, 2);
    // big nose, unkempt moustache
    c.fillStyle = 'rgba(120,85,65,.6)'; c.fillRect(29, 30, 7, 12);
    c.fillStyle = 'rgba(60,45,35,.85)'; c.fillRect(22, 42, 21, 5);
    c.fillStyle = 'rgba(30,18,14,.8)'; c.fillRect(26, 48, 13, 2);
    // balding shine
    c.fillStyle = 'rgba(255,240,220,.12)'; c.fillRect(18, 4, 28, 8);
    // stubble
    speckle(c, w, h, 40, ['rgba(40,30,25,.5)']);
  });

  // ---------------- signage ----------------
  T.glowSign = (text, color, sub) => canvasTex(256, 128, (c, w, h) => {
    c.fillStyle = '#0d0b08'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3a2f22'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    c.shadowColor = color; c.shadowBlur = 18;
    c.fillStyle = color; c.font = 'bold 44px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, sub ? 44 : 64);
    if (sub) { c.font = 'bold 30px Courier New'; c.fillText(sub, w / 2, 92); }
    c.shadowBlur = 0;
  });

  T.plate = (text, bg = '#1b1a17', fg = '#d8c78f') => canvasTex(128, 32, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = fg; c.lineWidth = 2; c.strokeRect(2, 2, w - 4, h - 4);
    c.fillStyle = fg; c.font = 'bold 16px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2);
  });

  T.roadsign = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#141317'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#4a3f30'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    // star
    c.save(); c.translate(w / 2, 62); c.fillStyle = '#ffd27a'; c.shadowColor = '#ff9a4a'; c.shadowBlur = 16;
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 5, a2 = a + Math.PI / 5;
      c.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); c.lineTo(Math.cos(a2) * 13, Math.sin(a2) * 13);
    }
    c.closePath(); c.fill(); c.restore();
    c.fillStyle = '#ff8a5a'; c.shadowColor = '#ff5a3c'; c.shadowBlur = 14;
    c.font = 'bold 34px Courier New'; c.textAlign = 'center';
    c.fillText('STARVIEW', w / 2, 130);
    c.fillStyle = '#7fd3ff'; c.shadowColor = '#4aa3ff';
    c.font = 'bold 26px Courier New'; c.fillText('MOTEL', w / 2, 168);
    c.shadowBlur = 0;
    c.fillStyle = '#cfc9b0'; c.font = '15px Courier New';
    c.fillText('AIR CONDITIONED', w / 2, 205);
    c.fillText('FREE TV · ICE', w / 2, 226);
  });

  // vacancy flip sign for the office window
  T.vacancy = canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#100e0c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff4a3c'; c.shadowColor = '#ff2a1c'; c.shadowBlur = 10;
    c.font = 'bold 26px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('VACANCY', w / 2, h / 2);
  });
  T.noVacancy = canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#100e0c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff4a3c'; c.shadowColor = '#ff2a1c'; c.shadowBlur = 10;
    c.font = 'bold 20px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('NO VACANCY', w / 2, h / 2);
  });

  T.openSign = canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#0c0a10'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5fd3ff'; c.shadowColor = '#3aa3ff'; c.shadowBlur = 10;
    c.font = 'bold 26px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('OPEN', w / 2, h / 2);
  });
  T.closedSign = canvasTex(128, 64, (c, w, h) => {
    c.fillStyle = '#0c0a10'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff5a4a'; c.shadowColor = '#c33'; c.shadowBlur = 8;
    c.font = 'bold 22px Courier New'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('CLOSED', w / 2, h / 2);
  });

  // vending machine front
  T.vending = canvasTex(128, 256, (c, w, h) => {
    c.fillStyle = '#7a1f1f'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5e1616'; c.fillRect(0, 0, w, 26);
    c.fillStyle = '#f2e2c8'; c.font = 'bold 17px Courier New'; c.textAlign = 'center';
    c.fillText('ICE COLD', w / 2, 17);
    c.fillStyle = '#1c1210';
    for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) c.fillRect(10 + i * 22, 40 + r * 40, 18, 30);
    c.fillStyle = '#d8c78f'; c.fillRect(10, 130, 60, 10); // slot
    c.fillStyle = '#0a0a0a'; c.fillRect(84, 120, 34, 90);
    c.fillStyle = '#333'; c.fillRect(88, 128, 26, 20);
    speckle(c, w, h, 150, ['rgba(0,0,0,.3)', 'rgba(255,255,255,.07)']);
  });

  // breaker panel face
  T.panel = canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#4c4e52'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a3c40'; c.fillRect(8, 8, w - 16, 30);
    c.fillStyle = '#d8d2c0'; c.font = 'bold 9px Courier New'; c.textAlign = 'left';
    c.fillText('STARVIEW MOTEL', 12, 18); c.fillText('MAIN 100A', 12, 30);
    const labels = ['LOT', 'SIGN', 'ROOMS', 'OFFICE'];
    labels.forEach((l, i) => {
      const y = 50 + i * 18;
      c.fillStyle = '#2c2e33'; c.fillRect(14, y, 20, 12);
      c.fillStyle = '#c8c2b0'; c.font = '8px Courier New'; c.fillText(l, 46, y + 9);
    });
    c.fillStyle = '#801515'; c.fillRect(90, 46, 24, 60); // main lever slot
  });

  T.tvScreenOff = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#0a0c0e'; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(140,160,180,.06)'; c.fillRect(10, 8, 44, 20);
  });

  T.moon = canvasTex(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(220,225,235,.9)'); g.addColorStop(.35, 'rgba(190,200,220,.55)');
    g.addColorStop(1, 'rgba(190,200,220,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  T.glowDot = canvasTex(32, 32, (c, w, h) => {
    const g = c.createRadialGradient(16, 16, 2, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,220,160,.85)'); g.addColorStop(.4, 'rgba(255,190,120,.22)'); g.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
  T.glowDotRed = canvasTex(32, 32, (c, w, h) => {
    const g = c.createRadialGradient(16, 16, 2, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,90,60,.85)'); g.addColorStop(.4, 'rgba(255,60,40,.2)'); g.addColorStop(1, 'rgba(255,60,40,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  // handwritten warning found later (original prop)
  T.wallScratch = canvasTex(128, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(38,26,22,.85)'; c.lineWidth = 1.6;
    c.font = 'italic 15px cursive';
    c.save(); c.translate(8, 34); c.rotate(-0.04);
    c.fillStyle = 'rgba(38,26,22,.8)'; c.fillText("don't let him", 0, 0);
    c.fillText('count the rooms', 6, 20); c.restore();
  });

  return T;
}
