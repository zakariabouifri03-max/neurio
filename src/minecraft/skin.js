// ═══════════════════════════════════════════════════════════════════════════
//  SKINS — a 64×64 Minecraft-layout skin painted entirely in code,
//  plus the UV tables that map a box onto each body part.
// ═══════════════════════════════════════════════════════════════════════════
import { mulberry32 } from '../util.js';

export const SKIN_PX = 64;

// ── box UV tables ───────────────────────────────────────────────────────────
// three.js BoxGeometry face order: +x, −x, +y, −y, +z, −z
// Minecraft limb unwrap order:     right, front, left, back, top, bottom
// every rect is [u0, v0, u1, v1] in *image* pixels (v measured from the top)
const HEAD = [[0, 8, 8, 16], [8, 8, 16, 16], [16, 8, 24, 16], [24, 8, 32, 16], [8, 0, 16, 8], [16, 0, 24, 8]];
const HEAD2 = [[32, 8, 40, 16], [40, 8, 48, 16], [48, 8, 56, 16], [56, 8, 64, 16], [40, 0, 48, 8], [48, 0, 56, 8]];
const BODY = [[16, 20, 20, 32], [20, 20, 28, 32], [28, 20, 32, 32], [32, 20, 40, 32], [20, 16, 28, 20], [28, 16, 36, 20]];
const BODY2 = [[16, 36, 20, 48], [20, 36, 28, 48], [28, 36, 32, 48], [32, 36, 40, 48], [20, 32, 28, 36], [28, 32, 36, 36]];
const ARM_R = [[40, 20, 44, 32], [44, 20, 48, 32], [48, 20, 52, 32], [52, 20, 56, 32], [44, 16, 48, 20], [48, 16, 52, 20]];
const ARM_R2 = [[40, 36, 44, 48], [44, 36, 48, 48], [48, 36, 52, 48], [52, 36, 56, 48], [44, 32, 48, 36], [48, 32, 52, 36]];
const ARM_L = [[32, 52, 36, 64], [36, 52, 40, 64], [40, 52, 44, 64], [44, 52, 48, 64], [36, 48, 40, 52], [40, 48, 44, 52]];
const ARM_L2 = [[48, 52, 52, 64], [52, 52, 56, 64], [56, 52, 60, 64], [60, 52, 64, 64], [52, 48, 56, 52], [56, 48, 60, 52]];
const LEG_R = [[0, 20, 4, 32], [4, 20, 8, 32], [8, 20, 12, 32], [12, 20, 16, 32], [4, 16, 8, 20], [8, 16, 12, 20]];
const LEG_R2 = [[0, 36, 4, 48], [4, 36, 8, 48], [8, 36, 12, 48], [12, 36, 16, 48], [4, 32, 8, 36], [8, 32, 12, 36]];
const LEG_L = [[16, 52, 20, 64], [20, 52, 24, 64], [24, 52, 28, 64], [28, 52, 32, 64], [20, 48, 24, 52], [24, 48, 28, 52]];
const LEG_L2 = [[0, 52, 4, 64], [4, 52, 8, 64], [8, 52, 12, 64], [12, 52, 16, 64], [4, 48, 8, 52], [8, 48, 12, 52]];

export const PARTS = {
  head: HEAD, head2: HEAD2, body: BODY, body2: BODY2,
  armR: ARM_R, armR2: ARM_R2, armL: ARM_L, armL2: ARM_L2,
  legR: LEG_R, legR2: LEG_R2, legL: LEG_L, legL2: LEG_L2,
};

// ── palettes ────────────────────────────────────────────────────────────────
export const SKIN_PRESETS = {
  steve: {
    label: 'Steve', hair: '#4a2f1b', hairDark: '#3a2413', hairHi: '#5d3d24',
    skin: '#c68863', skinDark: '#a06a49', skinLight: '#d59a76',
    eyes: '#ffffff', iris: '#4a6fd4', pupil: '#1b1f2e', mouth: '#7d5440',
    shirt: '#00a6a6', shirtDark: '#007d7d', shirtLight: '#25c4c4',
    pants: '#3b4a8c', pantsDark: '#2b3768', shoes: '#5a5f6d',
    slim: false, beard: false, jacket: true,
  },
  alex: {
    label: 'Alex', hair: '#d68b32', hairDark: '#a86620', hairHi: '#eaa94f',
    skin: '#e0ac82', skinDark: '#bd8b62', skinLight: '#efc09a',
    eyes: '#ffffff', iris: '#4f9c47', pupil: '#1e2a1c', mouth: '#94604a',
    shirt: '#6f8f3f', shirtDark: '#526b2c', shirtLight: '#8fae57',
    pants: '#7a5236', pantsDark: '#5b3c26', shoes: '#4a3626',
    slim: true, beard: false, jacket: true,
  },
  knight: {
    label: 'Knight', hair: '#2b2b31', hairDark: '#1b1b20', hairHi: '#3d3d46',
    skin: '#c68863', skinDark: '#a06a49', skinLight: '#d59a76',
    eyes: '#ffffff', iris: '#6d7b8c', pupil: '#14181e', mouth: '#7d5440',
    shirt: '#8c97a6', shirtDark: '#5f6874', shirtLight: '#b3bcc9',
    pants: '#4b5260', pantsDark: '#363c47', shoes: '#2f343d',
    slim: false, beard: false, jacket: true, plume: '#c2332f',
  },
  zombie: {
    label: 'Zombie', hair: '#2f4a24', hairDark: '#22381a', hairHi: '#3d5c2e',
    skin: '#5c8a3c', skinDark: '#456b2b', skinLight: '#74a44e',
    eyes: '#1c1c1c', iris: '#0d0d0d', pupil: '#000000', mouth: '#2f4a24',
    shirt: '#3d6b8f', shirtDark: '#2b4e6b', shirtLight: '#4f83ab',
    pants: '#4b4b7a', pantsDark: '#373759', shoes: '#3a3a4a',
    slim: false, beard: false, jacket: false,
  },
  wanderer: {
    label: 'Wanderer', hair: '#7b3f2a', hairDark: '#5c2d1e', hairHi: '#96513a',
    skin: '#8d5a3b', skinDark: '#6f4529', skinLight: '#a3704c',
    eyes: '#ffffff', iris: '#7a4b22', pupil: '#1a1208', mouth: '#5c3a26',
    shirt: '#b8a06a', shirtDark: '#8f7a4c', shirtLight: '#d3bd88',
    pants: '#5b4634', pantsDark: '#42321f', shoes: '#3a2c1e',
    slim: false, beard: true, jacket: true, hood: '#8a6f45',
  },
};

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(rgb, k) { return [Math.max(0, Math.min(255, rgb[0] * k)), Math.max(0, Math.min(255, rgb[1] * k)), Math.max(0, Math.min(255, rgb[2] * k))]; }

/**
 * Paint a full 64×64 skin. Returns the canvas.
 */
export function drawSkin(preset = 'steve', seed = 7, opts = {}) {
  const P = typeof preset === 'string' ? SKIN_PRESETS[preset] || SKIN_PRESETS.steve : preset;
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = SKIN_PX;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);

  const rgb = {};
  for (const k of Object.keys(P)) if (typeof P[k] === 'string' && P[k][0] === '#') rgb[k] = hex2rgb(P[k]);

  const put = (x, y, col, a = 1) => {
    if (x < 0 || y < 0 || x > 63 || y > 63) return;
    g.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;
    g.fillRect(x, y, 1, 1);
  };
  const rect = (x, y, w, h, col, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, col, a); };
  const jitter = (x, y, w, h, col, amt) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = 1 + (rnd() - 0.5) * amt;
      put(x + i, y + j, shade(col, k));
    }
  };

  // ── HEAD ────────────────────────────────────────────────────────────────
  const hx = 0, hy = 0;
  // top + bottom of head = hair
  jitter(8, 0, 8, 8, rgb.hair, 0.16);
  jitter(16, 0, 8, 8, rgb.hair, 0.16);
  // back of head
  jitter(24, 8, 8, 8, rgb.hair, 0.14);
  // sides: hair covering the top 4 rows + a sideburn
  for (const sx of [0, 16]) {
    jitter(sx, 8, 8, 8, rgb.skin, 0.09);
    rect(sx, 8, 8, 4, rgb.hair);
    for (let i = 0; i < 4; i++) put(sx + i, 12, rgb.hair, 0.55 + rnd() * 0.3);
    jitter(sx, 8, 8, 3, rgb.hairDark, 0.12);
  }
  // face (front)
  jitter(8, 8, 8, 8, rgb.skin, 0.08);
  rect(8, 8, 8, 2, rgb.hair);                       // fringe
  put(8, 10, rgb.hair); put(15, 10, rgb.hair);       // hair edges
  for (let i = 0; i < 3; i++) put(9 + i * 2, 10, rgb.hairDark, 0.5);
  // eyes: white + iris + pupil, brows above
  for (const ex of [9, 13]) {
    rect(ex, 11, 2, 1, rgb.eyes);
    put(ex + (ex === 9 ? 1 : 0), 11, rgb.iris);
    put(ex + (ex === 9 ? 1 : 0), 11, shade(rgb.pupil, 1.4));
    rect(ex - (ex === 9 ? 0 : 0), 10, 2, 1, rgb.hairDark, 0.85);   // brow
  }
  put(9, 11, rgb.eyes); put(14, 11, rgb.eyes);
  put(10, 11, rgb.iris); put(13, 11, rgb.iris);
  // nose + mouth
  put(11, 12, rgb.skinDark); put(12, 12, rgb.skinDark);
  rect(11, 14, 3, 1, rgb.mouth);
  put(10, 14, rgb.skinDark, 0.6); put(14, 14, rgb.skinDark, 0.6);
  if (P.beard) {
    for (let x = 8; x < 16; x++) for (let y = 13; y < 16; y++) {
      if (rnd() < 0.82) put(x, y, shade(rgb.hair, 0.85 + rnd() * 0.3));
    }
    rect(11, 14, 3, 1, rgb.mouth);
    for (const sx of [0, 16, 24]) for (let x = sx; x < sx + 8; x++) for (let y = 12; y < 16; y++) if (rnd() < 0.7) put(x, y, shade(rgb.hair, 0.9));
  }

  // ── HEAD LAYER 2 (hair volume / hat / hood) ─────────────────────────────
  const l2 = P.hood ? rgb.hood : rgb.hair;
  jitter(40, 0, 8, 8, shade(l2, 1.06), 0.12);
  jitter(48, 0, 8, 8, shade(l2, 1.06), 0.12);
  rect(32, 8, 32, 8, [0, 0, 0], 0);
  for (const sx of [32, 48, 56]) jitter(sx, 8, 8, 8, shade(l2, 0.94), 0.14);
  jitter(40, 8, 8, 3, shade(l2, 0.94), 0.14);        // fringe over the face
  for (let i = 0; i < 8; i++) if (rnd() < 0.55) put(40 + i, 11, shade(l2, 0.9), 0.85);
  if (P.plume) { rect(43, 8, 2, 2, hex2rgb(P.plume)); put(44, 10, shade(hex2rgb(P.plume), 0.8)); }
  if (P.hood) { for (let i = 0; i < 8; i++) put(40 + i, 12, shade(rgb.hood, 0.75)); }

  // ── TORSO ───────────────────────────────────────────────────────────────
  jitter(20, 20, 8, 12, rgb.shirt, 0.09);            // front
  jitter(32, 20, 8, 12, rgb.shirtDark, 0.1);         // back
  jitter(16, 20, 4, 12, rgb.shirtDark, 0.09);        // right side
  jitter(28, 20, 4, 12, rgb.shirtDark, 0.09);        // left side
  jitter(20, 16, 8, 4, rgb.shirtLight, 0.1);         // top (shoulders)
  jitter(28, 16, 8, 4, rgb.shirt, 0.1);              // bottom
  rect(20, 20, 8, 1, rgb.shirtLight);                // collar
  rect(23, 21, 2, 4, rgb.shirtDark, 0.55);           // shirt placket
  // belt + trousers top
  rect(16, 29, 24 - 16, 3, rgb.pantsDark);
  rect(20, 29, 8, 3, rgb.pants);
  rect(20, 30, 8, 1, shade(hex2rgb('#c9a227'), 1));  // buckle
  if (P.slim) { rect(21, 22, 1, 6, rgb.shirtLight, 0.4); }

  // torso layer 2 — open jacket
  rect(16, 36, 24, 12, [0, 0, 0], 0);
  if (P.jacket) {
    const jc = shade(rgb.shirtDark, 0.72);
    jitter(20, 36, 8, 12, jc, 0.1);
    jitter(32, 36, 8, 12, shade(jc, 0.9), 0.1);
    jitter(16, 36, 4, 12, jc, 0.1);
    jitter(28, 36, 4, 12, jc, 0.1);
    rect(20, 32, 8, 4, jc); rect(28, 32, 8, 4, shade(jc, 1.1));
    // leave a strip of shirt visible down the middle
    rect(23, 36, 2, 12, [0, 0, 0], 0);
  }

  // ── ARMS ────────────────────────────────────────────────────────────────
  const drawArm = (ox, oy, sleeveTop) => {
    jitter(ox + 4, oy + 4, 4, 12, rgb.skin, 0.08);            // front (hand/forearm)
    jitter(ox + 8, oy + 4, 4, 12, shade(rgb.skin, 0.92), 0.08);
    jitter(ox, oy + 4, 4, 12, shade(rgb.skin, 0.95), 0.08);
    jitter(ox + 12, oy + 4, 4, 12, shade(rgb.skin, 0.88), 0.08);
    jitter(ox + 4, oy, 4, 4, rgb.skinLight, 0.1);
    jitter(ox + 8, oy, 4, 4, rgb.skin, 0.1);
    // sleeve
    const sl = sleeveTop ? rgb.shirtLight : rgb.shirt;
    rect(ox, oy + 4, 16, 4, sl);
    rect(ox + 4, oy + 4, 4, 5, sl);
    for (let i = 0; i < 16; i++) put(ox + i, oy + 8, shade(sl, 0.8), 0.7);
    rect(ox + 5, oy + 12, 2, 3, shade(rgb.skin, 0.86));       // knuckles
  };
  drawArm(44, 16, false);                                     // right arm
  drawArm(36, 48, true);                                      // left arm
  rect(40, 36, 16, 12, [0, 0, 0], 0);                         // arm R layer 2
  rect(48, 52, 16, 12, [0, 0, 0], 0);                         // arm L layer 2
  if (P.jacket) {
    for (const [ox, oy] of [[44, 16], [36, 48]]) {
      const jc = shade(rgb.shirtDark, 0.72);
      rect(ox - 4 + 4, oy - 16 + 16, 0, 0, jc, 0);
      const lx = ox === 44 ? 40 : 48, ly = oy === 16 ? 36 : 52;
      jitter(lx + 4, ly + 4, 4, 6, jc, 0.1);
      jitter(lx + 8, ly + 4, 4, 6, shade(jc, 0.9), 0.1);
      jitter(lx, ly + 4, 4, 6, jc, 0.1);
      jitter(lx + 12, ly + 4, 4, 6, jc, 0.1);
      rect(lx + 4, ly, 4, 4, jc); rect(lx + 8, ly, 4, 4, shade(jc, 1.12));
      rect(lx, ly + 10, 16, 1, shade(jc, 0.8));
    }
  }

  // ── LEGS ────────────────────────────────────────────────────────────────
  const drawLeg = (ox, oy) => {
    jitter(ox + 4, oy + 4, 4, 12, rgb.pants, 0.09);
    jitter(ox + 8, oy + 4, 4, 12, shade(rgb.pants, 0.92), 0.09);
    jitter(ox, oy + 4, 4, 12, shade(rgb.pants, 0.96), 0.09);
    jitter(ox + 12, oy + 4, 4, 12, shade(rgb.pants, 0.88), 0.09);
    jitter(ox + 4, oy, 4, 4, rgb.pantsDark, 0.1);
    jitter(ox + 8, oy, 4, 4, rgb.pants, 0.1);
    rect(ox, oy + 12, 16, 4, rgb.shoes);                       // boots
    rect(ox + 4, oy + 12, 4, 4, shade(rgb.shoes, 1.15));
    rect(ox, oy + 12, 16, 1, shade(rgb.shoes, 1.3));
  };
  drawLeg(4, 16);                                              // right leg
  drawLeg(20, 48);                                             // left leg
  rect(0, 36, 16, 12, [0, 0, 0], 0);
  rect(0, 52, 16, 12, [0, 0, 0], 0);

  // ── random wear & dirt for realism ──────────────────────────────────────
  const dirt = opts.dirt ?? 0.35;
  for (let i = 0; i < Math.round(dirt * 60); i++) {
    const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64);
    const d = g.getImageData(x, y, 1, 1).data;
    if (d[3] < 40) continue;
    put(x, y, [d[0] * 0.78, d[1] * 0.74, d[2] * 0.68], 0.5);
  }
  return c;
}
