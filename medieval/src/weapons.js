// ── IRONVOW — the smithy ─────────────────────────────────────────────────────
// Every weapon in the game is built here, out of nothing but numbers: no meshes
// are loaded, no textures are downloaded. A weapon is DESCRIBED (a blade that
// long, this curve, that guard) and the geometry, the materials, the physics
// capsules and the contact surfaces all come out of the description — which is
// the only way a game about reading steel can be honest about its steel.
//
// The frame every weapon is built in (all local, +Y = pommel → point):
//
//     +Y ──── blade ────►
//     +Z ──── the EDGE plane (front edge at −Z, back at +Z)
//     +X ──── the FLATS
//
// A blow is read back out of this frame: which way the local velocity runs
// decides whether the man was cut by the edge, clubbed by the flat, spiked on
// the point or shoved by the haft. See classifyContact().
import * as THREE from 'three';
import { metalMat, woodMat, leatherMat, flatMat } from './tex.js';
import { clamp, clamp01, lerp } from './mathx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const cache = new Map();

// ════════════════════════════════════════════════════════════════════════════
//  MATERIALS
// ════════════════════════════════════════════════════════════════════════════
const FINISH = {
  steel: () => metalMat('steel', [1, 2], 0.22),
  iron: () => metalMat('iron', [1, 2], 0.44),
  black: () => metalMat('black', [1, 2], 0.38),
  brass: () => metalMat('brass', [1, 2], 0.3),
  bronze: () => metalMat('bronze', [1, 2], 0.34),
};
const GOLD = () => flatMat(0xc9a227, 0.28, 1);
const LEATHER = (k) => leatherMat(k, [2, 3]);
const WOOD = () => woodMat('oak', [1, 3]);

// ════════════════════════════════════════════════════════════════════════════
//  BLADE GEOMETRY — a lens of steel, swept along its own length
// ════════════════════════════════════════════════════════════════════════════
/**
 * Build a blade from its base (y = y0) to its point.
 * The cross-section is a six-sided lens: a true edge at −Z, either a second
 * edge (double) or a thick spine (single) at +Z, and two flats between.
 */
function bladeGeometry(o) {
  const {
    y0 = 0, len = 1, w = 0.06, thick = 0.02, curve = 0, singleEdge = false,
    tip = 'point', stations = 18, edgeBias = 1.0, spineScale = 0.92, distally = 0.72,
  } = o;
  // width / thickness along the blade: full at the ricasso, drawn out to the point
  const widthAt = (s) => {
    if (tip === 'point') {
      if (s < 0.1) return lerp(0.62, 1, s / 0.1);
      if (s < 0.62) return lerp(1, distally, (s - 0.1) / 0.52);
      if (s > 0.9) return distally * Math.pow(clamp01((1 - s) / 0.1), 0.62);
      return lerp(distally, distally * 0.86, (s - 0.62) / 0.28);
    }
    if (tip === 'spear') {
      if (s < 0.16) return lerp(0.34, 1, s / 0.16);
      if (s < 0.66) return lerp(1, 0.86, (s - 0.16) / 0.5);
      return 0.86 * Math.pow(clamp01((1 - s) / 0.34), 0.7);
    }
    // cleaver: hold the width, then clip the corner
    if (s < 0.12) return lerp(0.66, 1, s / 0.12);
    if (s < 0.88) return 1;
    return Math.pow(clamp01((1 - s) / 0.12), 0.5);
  };
  const thickAt = (s) => thick * (1 - 0.55 * s) * (s > 0.94 ? Math.pow(clamp01((1 - s) / 0.06), 0.5) : 1);
  const pos = [], uv = [], idx = [];
  const ring = (y, hw, ht) => {
    // 6 points: front edge, front-right flat, back-right flat, back, back-left, front-left
    const s = singleEdge ? 0.86 : 1.0;
    return [
      [0, y, -hw * edgeBias],
      [ht, y, -hw * 0.34],
      [ht, y, hw * 0.34 * s],
      [0, y, hw * s],
      [-ht, y, hw * 0.34 * s],
      [-ht, y, -hw * 0.34],
    ];
  };
  for (let i = 0; i <= stations; i++) {
    const s = i / stations;
    const y = y0 + len * s;
    const z = curve * s * s;                 // a curved blade (messer, beak)
    const hw = Math.max(0.0006, w * widthAt(s)) * 0.5;
    const ht = Math.max(0.0006, thickAt(s)) * 0.5;
    const pts = ring(y, hw, ht);
    for (let k = 0; k < pts.length; k++) {
      pos.push(pts[k][0], pts[k][1], pts[k][2] + z);
      uv.push(k / pts.length, (y - y0) / len);
    }
  }
  const n = stations + 1;
  for (let i = 0; i < stations; i++) {
    for (let k = 0; k < 6; k++) {
      const a = i * 6 + k, b = i * 6 + ((k + 1) % 6);
      const c = (i + 1) * 6 + k, d = (i + 1) * 6 + ((k + 1) % 6);
      idx.push(a, c, b, b, c, d);
    }
  }
  // cap the base
  for (let k = 1; k < 5; k++) idx.push(0, k, k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tapered box: guards, langets, flanges, pommel blocks. */
function bar(w, h, d, taper = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 3, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = (y / h) + 0.5;               // 0..1 along the bar
    const k = 1 - taper * Math.abs(t - 0.5) * 2;
    p.setX(i, p.getX(i) * (1 - taper * 0.5 * t));
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// ════════════════════════════════════════════════════════════════════════════
//  PHYSICS CAPSULES
//  Each weapon carries the capsules the collision sweep tests against. They are
//  what the blow is MEASURED on: every capsule knows which part of the weapon
//  it is, so a hit can be told from a shove by the shaft.
// ════════════════════════════════════════════════════════════════════════════
const seg = (a, b, r, part) => ({ a, b, r, part: part || 'blade' });

/** Wrap a line (x,z) = f(y) in capsules of the given radius. */
function tube(y0, y1, r, n, part, bend = null) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ta = i / n, tb = (i + 1) / n;
    const ya = lerp(y0, y1, ta), yb = lerp(y0, y1, tb);
    const za = bend ? bend(ta) : 0, zb = bend ? bend(tb) : 0;
    out.push(seg(V(0, ya, za), V(0, yb, zb), r, part));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  COMPONENT BUILDERS
// ════════════════════════════════════════════════════════════════════════════
function addMesh(group, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  group.add(m);
  return m;
}

/**
 * A hilted blade: grip, crossguard, blade, pommel — plus the capsules.
 * o: { name, bladeLen, bladeW, bladeThick, curve, singleEdge, tip, gripLen,
 *      guard: {w, h, d, style}, pommel: {style, size}, finish, furniture,
 *      baseY, ricasso }
 */
function makeHiltedBlade(o) {
  const g = new THREE.Group();
  const bladeMat = FINISH[o.finish || 'steel']();
  const furnMat = o.furniture === 'gold' ? GOLD() : FINISH[o.furniture || 'iron']();
  const gripMat = LEATHER(o.gripColour || 'brown');
  const pommelY = o.baseY ?? 0;
  const gripLen = o.gripLen ?? 0.12;
  // the grip runs from the pommel to the guard; the SECOND hand rides low on
  // it (below the strong hand) on a two-handed weapon
  const gripTop = pommelY + gripLen;
  const gripY2 = o.hands === 1 ? pommelY + gripLen * 0.62 : pommelY + gripLen * 0.17;
  const guardY = gripTop + (o.guardH ?? 0.022);
  const bladeY = guardY + (o.ricasso ? 0 : 0.01);

  // ── grip: a wrapped, waisted block ──
  const gripGeo = new THREE.CylinderGeometry(0.0145, 0.0175, gripLen, 12, 6);
  {
    const p = gripGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = (y / gripLen) + 0.5;
      const k = 1 + 0.22 * Math.sin(t * Math.PI);          // swell in the middle
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    gripGeo.computeVertexNormals();
  }
  addMesh(g, gripGeo, gripMat, 0, (pommelY + gripTop) / 2, 0);

  // ── pommel ──
  const ps = o.pommel?.size ?? 0.032;
  const py = pommelY - ps * 0.42;
  if ((o.pommel?.style ?? 'disc') === 'wheel') {
    const t = new THREE.TorusGeometry(ps * 0.85, ps * 0.3, 8, 20);
    addMesh(g, t, furnMat, 0, py, 0);
    addMesh(g, new THREE.CylinderGeometry(ps * 0.6, ps * 0.6, ps * 0.36, 10), furnMat, 0, py, 0);
  } else if (o.pommel?.style === 'scent') {
    const c = new THREE.ConeGeometry(ps * 0.92, ps * 1.7, 14);
    addMesh(g, c, furnMat, 0, py, 0).rotation.x = Math.PI;
  } else if (o.pommel?.style === 'ball') {
    addMesh(g, new THREE.SphereGeometry(ps * 0.82, 16, 12), furnMat, 0, py, 0);
  } else {
    const d = new THREE.CylinderGeometry(ps, ps * 0.86, ps * 0.42, 16);
    addMesh(g, d, furnMat, 0, py, 0);
    addMesh(g, new THREE.CylinderGeometry(ps * 0.35, ps * 0.35, ps * 0.5, 8), furnMat, 0, py, 0).rotation.z = Math.PI / 2;
  }

  // ── crossguard ──
  const gw = o.guard?.w ?? 0.2, gh = o.guard?.h ?? 0.03, gd = o.guard?.d ?? 0.05;
  const style = o.guard?.style ?? 'straight';
  if (style === 'ring') {
    addMesh(g, bar(gh * 1.1, gw, gd * 0.8), furnMat, 0, guardY, 0).rotation.z = Math.PI / 2;
    const ring = new THREE.TorusGeometry(gw * 0.34, gh * 0.24, 5, 12);
    addMesh(g, ring, furnMat, gw * 0.34, guardY + 0.02, 0);
  } else if (style === 'curved') {
    for (const s of [-1, 1]) {
      const b = bar(gw * 0.55, gd, gh * 1.1);
      const m = addMesh(g, b, furnMat, s * gw * 0.3, guardY + 0.005, 0);
      m.rotation.z = s * -0.5;
    }
  } else if (style === 'sleeve') {
    addMesh(g, bar(gw, gh * 2.2, gd * 0.9), furnMat, 0, guardY, 0);
    // the nagel: a small side plate that stops another man's edge
    const n = bar(0.05, 0.035, 0.014);
    addMesh(g, n, furnMat, -gw * 0.55, guardY + 0.035, -0.005).rotation.z = 0.25;
  } else {
    // A crossguard is a bar ACROSS the sword. Without the rotation it spans x,
    // which is what a fist holding the grip presents to another man's edge.
    addMesh(g, bar(gw, gh, gd, 0.35), furnMat, 0, guardY, 0);
  }

  // ── blade ──
  const bLen = o.bladeLen;
  const bGeo = bladeGeometry({
    y0: bladeY, len: bLen, w: o.bladeW, thick: o.bladeThick, curve: o.curve || 0,
    singleEdge: !!o.singleEdge, tip: o.tip || 'point', edgeBias: o.edgeBias ?? 1,
    distally: o.distally ?? 0.72,
  });
  addMesh(g, bGeo, bladeMat, 0, 0, 0);
  // a fuller: a shallow groove down each flat, drawn as a thin dark plate
  if (o.fuller) {
    const fLen = bLen * 0.62;
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(o.bladeW * 0.34, fLen), flatMat(0x6f767e, 0.5, 1));
      f.position.set(s * (o.bladeThick / 2 + 0.0008), bladeY + fLen / 2, 0);
      f.rotation.y = s * Math.PI / 2;
      g.add(f);
    }
  }

  // ── capsules ──
  const segs = [];
  segs.push(seg(V(0, pommelY - ps * 0.5, 0), V(0, pommelY + 0.01, 0), ps * 0.55, 'pommel'));
  segs.push(seg(V(0, pommelY, 0), V(0, gripY2, 0), 0.021, 'grip'));
  // crosswise means across the BLADE, so the capsule runs along local x — the
  // same axis the quillons span. (It used to run along z, i.e. along the cut,
  // which is the one direction a guard can never be.)
  segs.push(seg(V(-gw * 0.5, guardY, 0), V(gw * 0.5, guardY, 0), gh * 0.5, 'guard'));
  const bend = o.curve ? (t) => o.curve * t * t : null;
  segs.push(...tube(bladeY, bladeY + bLen, o.bladeThick * 0.55, 8, 'blade', bend));

  const parts = {
    type: o.type || 'sword', kind: o.type || 'sword',
    baseY: pommelY, gripY: pommelY + gripLen * (o.hands === 1 ? 0.62 : 0.72), gripY2, gripLen,
    gripTop: gripTop, tipY: bladeY + bLen, bladeLen: bLen, bladeStart: bladeY,
    guardY, quill: gw * 0.5, singleEdge: !!o.singleEdge,
    spike: !!o.spike, haft: !!o.haft, edge: !o.blunt,
    widthAt: (y) => o.bladeW * clamp01(1 - (y - bladeY) / bLen * 0.3),
    thickAt: () => o.bladeThick,
  };
  return { group: g, segs, parts };
}

/** The hafted weapons: shaft, langets, and whatever is on the end. */
function makePoleaxe(o) {
  const g = new THREE.Group();
  const headMat = FINISH[o.finish || 'iron']();
  const furnMat = FINISH[o.furniture || 'iron']();
  const woodMatG = WOOD();
  const buttY = o.baseY ?? -0.42;
  const headY = buttY + o.shaftLen;
  // ── shaft ──
  const shaft = new THREE.CylinderGeometry(0.019, 0.023, o.shaftLen, 9, 4);
  addMesh(g, shaft, woodMatG, 0, (buttY + headY) / 2, 0);
  // langets: two steel straps down the head end
  for (const s of [-1, 1]) {
    const t = 0.2 + Math.abs(s) * 0.02;
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.3, 0.008), furnMat);
    l.position.set(s * (t - 0.006), headY - 0.17, 0);
    g.add(l);
  }
  // butt cap
  addMesh(g, new THREE.ConeGeometry(0.021, 0.07, 8), furnMat, 0, buttY - 0.015, 0).rotation.x = Math.PI;

  const segs = [];
  segs.push(seg(V(0, buttY - 0.05, 0), V(0, buttY, 0), 0.024, 'butt'));
  segs.push(...tube(buttY, headY, 0.022, 5, 'haft'));
  const parts = {
    type: o.type || 'poleaxe', kind: o.type || 'poleaxe', spike: true, haft: true,
    baseY: buttY, gripY: o.gripY, gripY2: o.gripY2, gripLen: (o.gripY2 ?? 0) - (o.gripY ?? 0),
    gripTop: (o.gripY2 ?? 0.2) + 0.06, guardY: (o.gripY2 ?? 0.2) + 0.06, tipY: headY, bladeLen: 0.34, bladeStart: headY - 0.2,
    quill: 0, singleEdge: true, edge: true, headY,
  };

  if (o.head === 'axe') {
    // the spike: the top half of a pollaxe, and the reason it can punch a helmet
    addMesh(g, new THREE.ConeGeometry(0.022, 0.17, 4), headMat, 0, headY + 0.30, 0).rotation.y = Math.PI / 4;
    parts.spikeTop = true;
    // an axe blade: a fan of steel on the +Z side, with a curved cutting edge
    const bladeH = 0.26, reach = 0.19, th = 0.016;
    const shape = new THREE.Shape();
    shape.moveTo(0.012, -bladeH * 0.5);
    shape.lineTo(reach * 0.55, -bladeH * 0.46);
    shape.quadraticCurveTo(reach * 1.05, -bladeH * 0.28, reach, 0);
    shape.quadraticCurveTo(reach * 1.05, bladeH * 0.28, reach * 0.55, bladeH * 0.46);
    shape.lineTo(0.012, bladeH * 0.5);
    shape.lineTo(0.012, -bladeH * 0.5);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 1, steps: 1 });
    geo.rotateY(-Math.PI / 2);        // the flat of the axe faces ±X, the edge +Z
    geo.translate(0, headY + 0.03, -th / 2);
    addMesh(g, geo, headMat, 0, 0, 0);
    // edge capsule along the curve
    for (let i = 0; i < 4; i++) {
      const t0 = i / 4, t1 = (i + 1) / 4;
      const zf = (t) => reach * (0.9 + 0.1 * Math.sin(t * Math.PI));
      const yf = (t) => headY + 0.03 + lerp(-bladeH * 0.44, bladeH * 0.44, t);
      segs.push(seg(V(0, yf(t0), zf(t0)), V(0, yf(t1), zf(t1)), 0.012, 'blade'));
    }
    parts.axe = { y: headY + 0.03, h: bladeH, reach };
    parts.tipY = headY + 0.38;
    parts.bladeLen = 0.6;
    segs.push(seg(V(0, headY + 0.21, 0), V(0, headY + 0.38, 0), 0.016, 'blade'));
  } else if (o.head === 'hammer') {
    // the beak: a tapered steel beak on the −Z side and a hammer face on +Z
    const b = new THREE.ConeGeometry(0.035, 0.19, 4);
    const m = addMesh(g, b, headMat, 0, headY + 0.02, -0.1);
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4;
    addMesh(g, bar(0.05, 0.07, 0.055), furnMat, 0, headY + 0.02, 0.045);
    segs.push(seg(V(0, headY + 0.02, -0.02), V(0, headY + 0.02, -0.19), 0.026, 'blade'));
    segs.push(seg(V(0, headY + 0.02, 0.02), V(0, headY + 0.02, 0.07), 0.03, 'head'));
    parts.spike = true;
  } else if (o.head === 'mace') {
    const fl = 6, len = 0.175, r = 0.036;
    addMesh(g, new THREE.CylinderGeometry(r * 0.72, r * 0.72, len, 10), headMat, 0, headY + len / 2, 0);
    for (let i = 0; i < fl; i++) {
      const a = (i / fl) * Math.PI * 2;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.008, len * 0.92, r * 1.5), headMat);
      plate.position.set(Math.sin(a) * r * 0.92, headY + len / 2, Math.cos(a) * r * 0.92);
      plate.rotation.y = a;
      g.add(plate);
      segs.push(seg(V(0, headY, 0), V(Math.sin(a) * r * 1.2, headY + len, Math.cos(a) * r * 1.2), 0.02, 'head'));
    }
    addMesh(g, new THREE.ConeGeometry(r * 0.5, 0.07, 8), headMat, 0, headY + len + 0.03, 0);
    parts.blunt = true; parts.edge = false; parts.mace = { y: headY, len, r };
    parts.bladeStart = headY; parts.tipY = headY + len + 0.07;
  } else if (o.head === 'spear') {
    const hl = 0.34, hw = 0.072;
    const geo = bladeGeometry({ y0: headY - 0.02, len: hl, w: hw, thick: 0.018, tip: 'spear' });
    addMesh(g, geo, headMat, 0, 0, 0);
    addMesh(g, new THREE.CylinderGeometry(0.03, 0.022, 0.1, 8), furnMat, 0, headY - 0.03, 0);
    segs.push(...tube(headY - 0.02, headY + hl - 0.03, 0.014, 4, 'blade'));
    segs.push(seg(V(0, headY + hl - 0.04, 0), V(0, headY + hl, 0), 0.012, 'blade'));
    parts.spike = true; parts.edge = true; parts.bladeLen = hl;
    parts.bladeStart = headY - 0.02; parts.tipY = headY + hl;
  }
  return { group: g, segs, parts };
}

/** The Fenwick bell-mace: a one-handed haft with a flanged bell. */
function makeMace(o) {
  const g = new THREE.Group();
  const steel = FINISH[o.finish || 'iron']();
  const gripMat = LEATHER(o.gripColour || 'black');
  const buttY = o.baseY ?? -0.24;
  const headY = o.headY ?? 0.42;
  const headLen = o.headLen ?? 0.19;
  // haft, wrapped where it is held
  addMesh(g, new THREE.CylinderGeometry(0.0165, 0.019, headY - buttY, 9, 3), WOOD(), 0, (buttY + headY) / 2, 0);
  addMesh(g, new THREE.CylinderGeometry(0.0195, 0.0205, 0.15, 9, 2), gripMat, 0, o.gripY + 0.02, 0);
  addMesh(g, new THREE.ConeGeometry(0.02, 0.05, 8), steel, 0, buttY - 0.01, 0).rotation.x = Math.PI;
  // the bell: a squat drum, flanged, with a crowning spike
  addMesh(g, new THREE.CylinderGeometry(0.038, 0.034, headLen, 12, 2), steel, 0, headY + headLen / 2, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.009, headLen * 0.9, 0.052), steel);
    plate.position.set(Math.sin(a) * 0.036, headY + headLen / 2, Math.cos(a) * 0.036);
    plate.rotation.y = a;
    g.add(plate);
  }
  addMesh(g, new THREE.ConeGeometry(0.019, 0.06, 8), steel, 0, headY + headLen + 0.028, 0);
  addMesh(g, new THREE.TorusGeometry(0.036, 0.008, 5, 12), steel, 0, headY + 0.012, 0).rotation.x = Math.PI / 2;

  const segs = [
    seg(V(0, buttY - 0.04, 0), V(0, buttY, 0), 0.02, 'butt'),
    seg(V(0, buttY, 0), V(0, headY, 0), 0.019, 'haft'),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    segs.push(seg(V(0, headY + 0.01, 0), V(Math.sin(a) * 0.046, headY + headLen - 0.01, Math.cos(a) * 0.046), 0.019, 'head'));
  }
  segs.push(seg(V(0, headY + headLen, 0), V(0, headY + headLen + 0.055, 0), 0.014, 'head'));
  const parts = {
    type: 'mace', kind: 'mace', blunt: true, edge: false, haft: true,
    baseY: buttY, gripY: o.gripY, gripY2: o.hands === 1 ? o.gripY : o.gripY2, gripLen: (o.gripY2 ?? 0) - (o.gripY ?? 0),
    gripTop: o.gripY2 ?? 0.1, guardY: o.gripY2 ?? 0.1, tipY: headY + headLen + 0.055, bladeStart: headY, bladeLen: headLen,
    quill: 0, singleEdge: false, headY, headLen,
    widthAt: () => 0.09, thickAt: () => 0.076,
  };
  return { group: g, segs, parts };
}

// ════════════════════════════════════════════════════════════════════════════
//  THE WEAPON TABLE — one entry per model in data.js
// ════════════════════════════════════════════════════════════════════════════
const MODELS = {
  sword1: () => makeHiltedBlade({
    type: 'sword', bladeLen: 0.87, bladeW: 0.062, bladeThick: 0.021, fuller: true,
    baseY: -0.115, gripLen: 0.115, hands: 1, guard: { w: 0.19, h: 0.026, d: 0.042, style: 'straight' },
    pommel: { style: 'disc', size: 0.033 }, furniture: 'iron', finish: 'steel', gripColour: 'brown',
  }),
  sword2: () => makeHiltedBlade({
    type: 'sword', bladeLen: 1.10, bladeW: 0.056, bladeThick: 0.022, fuller: true,
    baseY: -0.185, gripLen: 0.245, guard: { w: 0.245, h: 0.022, d: 0.036, style: 'straight' },
    pommel: { style: 'wheel', size: 0.042 }, furniture: 'steel', finish: 'steel', gripColour: 'black',
  }),
  sword3: () => makeHiltedBlade({
    type: 'greatsword', bladeLen: 1.42, bladeW: 0.078, bladeThick: 0.027, fuller: true,
    baseY: -0.215, gripLen: 0.32, ricasso: true, distally: 0.5,
    guard: { w: 0.31, h: 0.03, d: 0.05, style: 'ring' },
    pommel: { style: 'scent', size: 0.05 }, furniture: 'black', finish: 'iron', gripColour: 'brown',
  }),
  messer: () => makeHiltedBlade({
    type: 'messer', bladeLen: 0.84, bladeW: 0.078, bladeThick: 0.019, curve: 0.05,
    singleEdge: true, tip: 'cleaver', edgeBias: 0.92,
    baseY: -0.13, gripLen: 0.125, hands: 1, guard: { w: 0.1, h: 0.03, d: 0.036, style: 'sleeve' },
    pommel: { style: 'disc', size: 0.028 }, furniture: 'iron', finish: 'steel', gripColour: 'brown',
  }),
  falcon: () => makeHiltedBlade({
    type: 'falchion', bladeLen: 0.95, bladeW: 0.082, bladeThick: 0.02, curve: 0.075,
    singleEdge: true, tip: 'cleaver', edgeBias: 0.9, fuller: false, distally: 0.8,
    baseY: -0.15, gripLen: 0.115, hands: 1,
    guard: { w: 0.16, h: 0.028, d: 0.04, style: 'curved' },
    pommel: { style: 'scent', size: 0.03 }, furniture: 'gold', finish: 'steel', gripColour: 'tan',
  }),
  poleaxe: () => makePoleaxe({
    type: 'poleaxe', shaftLen: 1.78, baseY: -0.4, gripY: -0.02, gripY2: -0.20,
    head: 'axe', finish: 'iron', furniture: 'black',
  }),
  mace: () => makeMace({
    type: 'mace', hands: 1, baseY: -0.235, headY: 0.40, headLen: 0.185, gripY: -0.07, gripY2: -0.07,
    finish: 'black', gripColour: 'black',
  }),
  spear: () => makePoleaxe({
    type: 'spear', shaftLen: 2.06, baseY: -0.38, gripY: 0.24, gripY2: -0.12,
    head: 'spear', finish: 'steel', furniture: 'iron',
  }),
};

/**
 * Clone a built weapon.
 *
 * A THREE object can only have one parent, and two men on a field often carry
 * the same pattern of sword — so the cache holds TEMPLATES and every fighter
 * gets his own copy. Geometry and materials are shared (they are immutable and
 * expensive); the capsules are copied, because the sweep writes into them.
 */
export function cloneWeapon(src) {
  const out = new THREE.Group();
  for (const child of src.children) {
    if (!child.isMesh) continue;
    const m = new THREE.Mesh(child.geometry, child.material);
    m.position.copy(child.position);
    m.quaternion.copy(child.quaternion);
    m.scale.copy(child.scale);
    m.castShadow = true;
    out.add(m);
  }
  const ud = src.userData || {};
  out.userData = {
    def: ud.def, parts: ud.parts,
    gripY: ud.gripY, gripY2: ud.gripY2, gripLen: ud.gripLen, reachTip: ud.reachTip,
    segs: (ud.segs || []).map((s) => ({ a: s.a.clone(), b: s.b.clone(), r: s.r, part: s.part })),
  };
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  SHIELDS
// ════════════════════════════════════════════════════════════════════════════
/**
 * Shield face: local +Y = up (long axis), +X = across, +Z = the face normal.
 * The owning hand holds the grip at the middle, so the collider must lie along
 * the face — a shield is a wall, and the capsules have to be that wall.
 */
function shieldSegments(model) {
  const out = [];
  if (model === 'buckler') {
    out.push(seg(V(0, -0.16, 0.05), V(0, 0.16, 0.05), 0.09, 'shield'));
    for (const y of [-0.1, 0, 0.1]) out.push(seg(V(-0.15, y, 0.05), V(0.15, y, 0.05), 0.08, 'shield'));
  } else if (model === 'kite') {
    out.push(seg(V(0, -0.42, 0.05), V(0, 0.42, 0.05), 0.11, 'shield'));
    for (const y of [-0.3, -0.08, 0.14, 0.34]) {
      const w = y > 0.2 ? 0.2 : 0.23;
      out.push(seg(V(-w, y, 0.05), V(w, y, 0.05), 0.09, 'shield'));
    }
    out.push(seg(V(0, -0.42, 0.05), V(0, -0.56, 0.05), 0.07, 'shield'));
  } else if (model === 'tower') {
    out.push(seg(V(0, -0.6, 0.05), V(0, 0.6, 0.05), 0.13, 'shield'));
    for (const y of [-0.44, -0.2, 0.06, 0.32, 0.52]) out.push(seg(V(-0.26, y, 0.05), V(0.26, y, 0.05), 0.11, 'shield'));
  } else {
    out.push(seg(V(0, -0.19, 0.05), V(0, 0.19, 0.05), 0.1, 'shield'));
    out.push(seg(V(-0.17, 0, 0.05), V(0.17, 0, 0.05), 0.09, 'shield'));
  }
  return out;
}

export function buildShield(def, house = 'ashcombe', cloth = [90, 70, 50]) {
  const key = `shield:${def.id}:${house}`;
  if (cache.has(key)) return cloneWeapon(cache.get(key));
  const g = new THREE.Group();
  const model = def.model || (def.id === 'none' ? null : def.id);
  const woodMatG = def.face === 'steel' ? metalMat('steel', [1, 1], 0.35) : woodMat('oak', [1, 1]);
  const rimMat = metalMat('iron', [1, 1], 0.42);
  const bossMat = def.face === 'steel' ? metalMat('steel', [1, 1], 0.3) : metalMat('bronze', [1, 1], 0.4);
  const paint = flatMat(new THREE.Color(cloth[0] / 255, cloth[1] / 255, cloth[2] / 255).getHex(), 0.72, 0.05);

  if (model) {
    let gw = 0.42, gh = 0.44, depth = 0.045, thick = 0.014;
    if (model === 'buckler') { gw = 0.34; gh = 0.36; depth = 0.05; thick = 0.012; }
    else if (model === 'kite') { gw = 0.5; gh = 1.0; depth = 0.06; thick = 0.016; }
    else if (model === 'tower') { gw = 0.58; gh = 1.28; depth = 0.075; thick = 0.019; }
    const pos = [], uv = [], idx = [];
    const rows = 9, cols = 13;
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const y = -gh / 2 + v * gh;
      // a kite draws its edges in toward the point; a pavise stays a plank
      const inset = (model === 'kite' && v > 0.62) ? Math.pow((v - 0.62) / 0.38, 0.8)
        : (model === 'kite' && v < 0.16 ? Math.pow((0.16 - v) / 0.16, 0.9) * 0.35 : 0);
      const w = (gw / 2) * (1 - inset);
      for (let c = 0; c <= 12; c++) {
        const t = c / 12;
        const x = lerp(-w, w, t);
        // the face bows out in the middle and is drawn back at the edges
        const z = Math.cos((t - 0.5) * Math.PI * 1.05) * depth * 0.5 + depth * 0.35;
        pos.push(x, y, z);
        uv.push(t, v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const face = new THREE.Mesh(geo, def.face === 'steel' ? metalMat('steel', [1, 1], 0.3) : paint);
    face.material.side = THREE.DoubleSide;
    g.add(face);
    // rim: a tube of iron around the edge
    const rim = new THREE.TorusGeometry(Math.min(gw, gh) * 0.42, thick, 4, model === 'kite' || model === 'tower' ? 24 : 16);
    const rimMesh = new THREE.Mesh(rim, rimMat);
    rimMesh.scale.set(gw / Math.min(gw, gh), gh / Math.min(gw, gh), 1);
    rimMesh.position.z = -depth * 0.1;
    g.add(rimMesh);
    // boss
    if (model === 'buckler' || def.boss !== false) {
      const boss = new THREE.SphereGeometry(model === 'buckler' ? 0.062 : 0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const bm = new THREE.Mesh(boss, bossMat);
      bm.rotation.x = -Math.PI / 2;
      bm.position.z = depth * 0.55;
      g.add(bm);
    }
    // straps on the back + the house's chevron painted on the face
    for (const y of [-0.12, 0.12]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(gw * 0.8, 0.05, 0.012), leatherMat('brown'));
      strap.position.set(0, y, -depth * 0.4);
      g.add(strap);
    }
    const chevron = new THREE.Mesh(new THREE.PlaneGeometry(gw * 0.44, 0.12), flatMat(new THREE.Color(cloth[0] / 255 * 0.6, cloth[1] / 255 * 0.6, cloth[2] / 255 * 0.6).getHex(), 0.8));
    chevron.position.set(0, gh * 0.16, depth * 0.34);
    g.add(chevron);
    g.userData.parts = {
      kind: 'shield', type: 'shield', model,
      baseY: -gh / 2, tipY: gh / 2, bladeLen: gh, bladeStart: -gh / 2,
      gripY: 0, gripY2: 0, gripLen: 0.1, gripTop: -0.05,
      widthAt: () => gw, thickAt: () => depth, singleEdge: false,
    };
  }
  g.userData.segs = model ? shieldSegments(model) : [];
  g.userData.def = def;
  g.castShadow = true;
  cache.set(key, g);
  return g;
}

// ════════════════════════════════════════════════════════════════════════════
//  THE DOOR
// ════════════════════════════════════════════════════════════════════════════
/**
 * Build (or recall) the mesh for a weapon. Everything downstream — the pose
 * code, the collision sweep, the wound resolver — reads userData:
 *   segs   capsules: {a, b, r, part}   (local frame)
 *   parts  the surface description: where the edge is, how wide, how thick
 *   gripY  the hand's station        gripY2 the second hand's
 *   reachTip  fist → point           gripLen  how much grip there is
 */
export function buildWeapon(def, house = 'ashcombe') {
  const key = `w:${def.id}:${house}`;
  if (cache.has(key)) return cloneWeapon(cache.get(key));
  const make = MODELS[def.model];
  if (!make) throw new Error(`no weapon model "${def.model}"`);
  const built = make();
  const g = built.group;
  g.userData.def = def;
  g.userData.segs = built.segs;
  g.userData.parts = built.parts;
  const p = built.parts;
  g.userData.gripY = p.gripY;
  g.userData.gripY2 = p.gripY2;
  g.userData.gripLen = p.gripLen;
  g.userData.reachTip = p.tipY - p.gripY;
  // a weapon is not one solid thing: keep the metal shapes off each other's z
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  cache.set(key, g);
  return g;
}

/**
 * Which face of the weapon met the man?
 *
 * The velocity is transformed into the weapon's own frame — the frame the
 * smithy built the blade in — and then the question is simply which local axis
 * the metal was travelling along:
 *   • mostly ±Y  → the POINT (pierce, if the weapon has a point at all)
 *   • mostly ±Z  → the EDGE (a cut, scaled by how much of the travel is edgeways)
 *   • mostly ±X  → the FLAT (a clubbing blow, a shove)
 * Anything that lands on the haft, the guard or the pommel is not a cut at all.
 *
 * @returns { strike, sharpness, surface, part }
 */
export function classifyContact(group, localPoint, localVel, def = {}, opts = {}) {
  const p = group.userData.parts || {};
  const y = localPoint.y;
  const v = localVel;
  const speed = v.length();
  // where the blade begins is the weapon's own business: a sword's grip, guard
  // and pommel are steel, but a blow with them is a shove, not a cut
  const inBlade = y >= (p.bladeStart ?? p.headY ?? -Infinity) - 0.02;
  if (!inBlade || p.blunt) {
    // haft, stock, bell: a shove, however hard
    return { strike: 'haft', sharpness: 0.05, surface: 'haft', part: 'haft', speed };
  }
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  // The point leads: if the metal is travelling down the weapon's own long axis,
  // it is a thrust, whatever weapon it is — even a sword driven straight in.
  // A spike or a spearhead reads as a point sooner, because that is all it is.
  const pointBias = p.spike || p.type === 'spear' ? 0.55 : 1.25;
  const nearTip = y > (p.bladeStart ?? 0) + (p.bladeLen ?? 0.6) * 0.7;
  if (opts.kind === 'thrust' && (nearTip || ay > Math.max(ax, az) * 0.4)) {
    return { strike: 'thrust', sharpness: clamp01(0.55 + speed / 20), surface: 'point', part: 'blade', speed };
  }
  if (ay > Math.max(ax, az) * pointBias) {
    return { strike: 'thrust', sharpness: clamp01(0.5 + speed / 20), surface: 'point', part: 'blade', speed };
  }
  if (az >= ax) {
    // how squarely the edge led: a grazing edge is a torn cut, not a clean one
    const lead = az / Math.max(1e-4, az + ax);
    return { strike: 'cut', sharpness: clamp01(0.35 + lead * 0.85) * (p.singleEdge ? 0.96 : 1), surface: 'edge', part: 'blade', speed };
  }
  const flatLead = ax / Math.max(1e-4, ax + az);
  return { strike: 'flat', sharpness: clamp01(0.12 + (1 - flatLead) * 0.3), surface: 'flat', part: 'blade', speed };
}

/** Local +Y in world space: which way the steel is pointing. */
export function weaponAxis(group, out) { return out.set(0, 1, 0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())); }
