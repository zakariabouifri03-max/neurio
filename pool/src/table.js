// ── Table + ball constants and geometry ─────────────────────────────────────
// SHARED MODULE — loaded by the browser client (as ESM) and by the Node game
// server (as CommonJS) so client-side prediction and server-side authority
// always agree bit-for-bit. Everything is in metres / SI units and follows a
// regulation 9-foot table.

const inch = 0.0254;

const TABLE = {
  id: '9ft',
  name: 'Tournament 9-Foot',
  L: 100 * inch,        // 2.540 m playing length (X)
  W: 50 * inch,         // 1.270 m playing width  (Z)
  railH: 0.037,         // cushion nose height above the cloth
  frameH: 0.115,        // wooden frame below the cloth
  legH: 0.70,           // floor → bed
  clothSpeed: 1.0,      // 1 = fast tournament cloth
};

const BALL = {
  R: 1.125 * inch,      // 0.028575
  D: 2.25 * inch,       // 0.05715
  M: 0.170,             // kg
  I: (2 / 5) * 0.170 * (1.125 * inch) ** 2,
};

const PHYS = {
  G: 9.80665,
  MU_SLIDE: 0.140,      // ball/cloth sliding (skid) friction
  MU_ROLL: 0.0170,      // rolling resistance
  MU_PIVOT: 0.085,      // pivot/twist friction: a ball spinning in place stops in ~1 s
  MU_BALL: 0.060,       // ball/ball tangential friction (throw)
  E_BALL: 0.955,        // ball/ball restitution
  E_CUSHION: 0.66,      // cushion restitution
  MU_CUSHION: 0.155,    // cushion friction → english response
  E_JAW: 0.42,          // pocket jaw restitution (dead bounce)
  MU_JAW: 0.20,
  SPIN_DECAY: 0.70,     // vertical-axis spin damping (1/s)
  SLEEP_V: 0.0072,
  SLEEP_W: 0.05,
  SLEEP_TIME: 0.24,
  MAX_SIM_TIME: 34,
  DT: 1 / 600,
  CUE_MAX_SPEED: 10.6,  // fastest cue-stick speed a player can produce (m/s)
  CUE_EFF: 0.925,       // stick → ball efficiency (max launch ≈ 9.8 m/s ≈ 22 mph)
  CUE_MASS: 0.55,
  MU_TIP: 0.85,         // chalked leather tip on phenolic ball — grips hard
  // A real stroke keeps pushing the ball for ~1 ms while the shaft flexes, so
  // the tip imparts noticeably more spin than a pure friction-limited collision
  // would. These two numbers are measured against real draw/follow behaviour.
  SPIN_GRIP: 1.25,      // spin impulse multiplier over μ_tip·Jn
  SPIN_CAP: 0.80,       // hard ceiling: ω·R ≤ SPIN_CAP·V
  SQUERT_K: 0.055,      // cue deflection (squirt) per unit tip offset
  MASSE_MAX: 0.42,      // max vertical tip offset as a fraction of R
  MAX_BALL_SPEED: 11.5, // nothing on a pool table is ever faster than this
  POCKET_FALL: 0.42,    // seconds for a captured ball to drop out of sight
};

const HL = TABLE.L / 2;              // 1.27
const HW = TABLE.W / 2;              // 0.635
const CORNER_IN = 0.058;
const CORNER_MOUTH = 0.054;
const SIDE_MOUTH = 0.058;
const CORNER_GAP = 0.080;            // cushion ends this far from the corner
const SIDE_GAP = 0.072;              // cushion ends this far from the side pocket

const POCKETS = [
  { id: 0, kind: 'corner', x: -(HL - CORNER_IN), z: -(HW - CORNER_IN), r: CORNER_MOUTH },
  { id: 1, kind: 'corner', x: (HL - CORNER_IN), z: -(HW - CORNER_IN), r: CORNER_MOUTH },
  { id: 2, kind: 'corner', x: -(HL - CORNER_IN), z: (HW - CORNER_IN), r: CORNER_MOUTH },
  { id: 3, kind: 'corner', x: (HL - CORNER_IN), z: (HW - CORNER_IN), r: CORNER_MOUTH },
  { id: 4, kind: 'side', x: 0, z: -(HW + 0.010), r: SIDE_MOUTH },
  { id: 5, kind: 'side', x: 0, z: (HW + 0.010), r: SIDE_MOUTH },
];

// cushion segments: 2D lines in the cloth plane with an inward normal
function buildCushions() {
  const seg = [];
  for (const s of [-1, 1]) {                      // long rails
    const z = s * HW;
    seg.push({ ax: -HL + CORNER_GAP, az: z, bx: -SIDE_GAP, bz: z, nx: 0, nz: -s });
    seg.push({ ax: SIDE_GAP, az: z, bx: HL - CORNER_GAP, bz: z, nx: 0, nz: -s });
  }
  for (const s of [-1, 1]) {                      // short rails
    const x = s * HL;
    seg.push({ ax: x, az: -HW + CORNER_GAP, bx: x, bz: HW - CORNER_GAP, nx: -s, nz: 0 });
  }
  return seg;
}
const CUSHIONS = buildCushions();

// pocket jaw bumpers — hard circles at every cushion end, so balls rattle in
// the jaws instead of teleporting into pockets.
// Corner pockets get one jaw on the long rail and one on the short rail; the
// gap between them (≈4.8") is the mouth.
function buildJaws() {
  const jr = 0.019;
  const out = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push({ x: sx * (HL - CORNER_GAP), z: sz * HW, r: jr });      // long-rail jaw
      out.push({ x: sx * HL, z: sz * (HW - CORNER_GAP), r: jr });      // short-rail jaw
    }
  }
  for (const sz of [-1, 1]) {
    out.push({ x: -SIDE_GAP, z: sz * HW, r: jr });
    out.push({ x: SIDE_GAP, z: sz * HW, r: jr });
  }
  return out;
}
const JAWS = buildJaws();

const SPOTS = {
  head: { x: -TABLE.L * 0.25, z: 0 },
  center: { x: 0, z: 0 },
  foot: { x: TABLE.L * 0.25, z: 0 },
};
const HEAD_STRING_X = -TABLE.L * 0.25;

const BALL_COUNT = 16;
const BALL_COLORS = [
  '#f7f5ef', '#f2c200', '#1f5fd0', '#e0342c', '#5b2a8c', '#f07c14', '#137a3c', '#8c2018',
  '#131313',
  '#f2c200', '#1f5fd0', '#e0342c', '#5b2a8c', '#f07c14', '#137a3c', '#8c2018',
];
const isStripe = (n) => n >= 9 && n <= 15;
const isSolid = (n) => n >= 1 && n <= 7;
const groupOf = (n) => (n === 0 ? 'cue' : n === 8 ? 'eight' : isStripe(n) ? 'stripes' : 'solids');

/**
 * Standard 8-ball triangle: apex (1) on the foot spot, the 8 in the middle of
 * the third row, and one solid + one stripe in the two back corners.
 * Returns positions indexed by ball number; index 0 is the cue ball.
 */
function rackPositions() {
  const d = BALL.D + 0.0004;
  const rows = [[1], [11, 2], [3, 8, 10], [14, 7, 12, 5], [15, 4, 9, 6, 13]];
  const out = new Array(BALL_COUNT).fill(null);
  out[0] = { x: SPOTS.head.x, z: SPOTS.head.z + 0.0012 };
  for (let r = 0; r < rows.length; r++) {
    const n = rows[r].length;
    for (let i = 0; i < n; i++) {
      out[rows[r][i]] = { x: SPOTS.foot.x + r * d * Math.sqrt(3) / 2, z: (i - (n - 1) / 2) * d };
    }
  }
  return out;
}

/** 9-ball diamond rack. */
function rack9() {
  const d = BALL.D + 0.0004;
  const rows = [[1], [2, 3], [4, 9, 5], [6, 7], [8]];
  const out = new Array(BALL_COUNT).fill(null);
  out[0] = { x: SPOTS.head.x, z: 0 };
  for (let r = 0; r < rows.length; r++) {
    const n = rows[r].length;
    for (let i = 0; i < n; i++) {
      out[rows[r][i]] = { x: SPOTS.foot.x + r * d * Math.sqrt(3) / 2, z: (i - (n - 1) / 2) * d };
    }
  }
  return out;
}

/** Is (x,z) a legal cue-ball position? Inside the cushions and clear of other balls. */
function insidePlay(x, z, balls, margin) {
  const m = margin === undefined ? BALL.R * 0.985 : margin;
  if (!(x >= -HL + m && x <= HL - m && z >= -HW + m && z <= HW - m)) return false;
  for (const p of POCKETS) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < (p.r * 0.92 + m) * (p.r * 0.92 + m)) return false;
  }
  if (balls) {
    for (const b of balls) {
      if (!b || b.n === 0 || b.state !== 'table') continue;
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < (BALL.D * 0.995) * (BALL.D * 0.995)) return false;
    }
  }
  return true;
}

export {
  inch, TABLE, BALL, PHYS, POCKETS, CUSHIONS, JAWS, SPOTS, HEAD_STRING_X, HL, HW,
  CORNER_GAP, SIDE_GAP, BALL_COUNT, BALL_COLORS,
  rackPositions, rack9, isStripe, isSolid, groupOf, insidePlay,
};
