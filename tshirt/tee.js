/* NEURIO Tee Studio — 100% procedural T-shirt.
 * The tee is lofted from superellipse cross-sections (torso, sleeves,
 * collar, cuffs, hem) — no external model files, matching the repo's
 * zero-dependency convention.
 */
import * as THREE from 'three';

export const BODY_H = 66;          // hem → shoulder line (≈ cm)
export const CHEST_Y = 47;         // decal anchor height
export const CHEST_Z = 18.4;       // decal anchor depth (front)

/* ─────────────────────────── helpers ─────────────────────────── */

function superellipse(phi, a, b, n) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return [
    Math.sign(c) * Math.abs(c) ** (2 / n) * a,
    Math.sign(s) * Math.abs(s) ** (2 / n) * b,
  ];
}

/* body profile: t (0 hem → 1 shoulders) → [halfWidth, halfDepth] */
const PROFILE = [
  [0.00, 25.2, 17.1],
  [0.12, 25.6, 17.3],
  [0.45, 26.5, 17.9],
  [0.75, 27.0, 18.3],
  [0.90, 27.3, 18.5],
  [0.955, 26.9, 15.0],
  [0.985, 25.6, 9.5],
  [1.00, 24.5, 6.0],
];
function profileAt(t) {
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [t0, a0, b0] = PROFILE[i];
    const [t1, a1, b1] = PROFILE[i + 1];
    if (t <= t1 || i === PROFILE.length - 2) {
      let k = (t - t0) / (t1 - t0);
      k = Math.max(0, Math.min(1, k));
      k = k * k * (3 - 2 * k); // smoothstep
      return [a0 + (a1 - a0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [PROFILE.at(-1)[1], PROFILE.at(-1)[2]];
}

/* subtle cloth wrinkles */
function wrinkle(phi, t, amp = 1) {
  const fade = Math.sin(Math.PI * Math.min(1, t * 1.05) * 0.85);
  return 1
    + amp * 0.012 * Math.sin(3 * phi + 1.7) * fade
    + amp * 0.006 * Math.sin(7 * phi + t * 6.2) * (0.3 + 0.7 * fade);
}

/* indexed grid with welded seams → smooth normals everywhere */
function gridGeometry(posFn, steps, radial, { wrapPath = false, uvx = 6, uvy = 4 } = {}) {
  const pos = [], uv = [], idx = [];
  const R = radial;
  for (let i = 0; i <= steps; i++) {
    const ti = i / steps;
    for (let j = 0; j <= R; j++) {
      const tj = j / R;
      const p = posFn(ti, tj);
      pos.push(p[0], p[1], p[2]);
      uv.push(tj * uvx, ti * uvy);
    }
  }
  const row = R + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * row + j, b = (i + 1) * row + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  // weld the radial seam (j=0 ↔ j=R)
  const pairs = [];
  for (let i = 0; i <= steps; i++) pairs.push([i * row, i * row + R]);
  // weld a wrapped path (first ring ↔ last ring)
  if (wrapPath) for (let j = 0; j <= R; j++) pairs.push([j, steps * row + j]);

  const n = g.attributes.normal;
  for (const [a, b] of pairs) {
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const len = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / len, y / len, z / len);
    n.setXYZ(b, x / len, y / len, z / len);
  }
  n.needsUpdate = true;
  return g;
}

/* ─────────────────────────── parts ─────────────────────────── */

function bodyGeometry() {
  return gridGeometry((t, tj) => {
    const phi = tj * Math.PI * 2;
    const [a, b] = profileAt(t);
    const w = wrinkle(phi, t);
    const [x, z] = superellipse(phi, a * w, b * w, 2.6);
    return [x, t * BODY_H, z];
  }, 72, 96, { uvx: 8, uvy: 6 });
}

/* neck cap — shallow dome that dips down under the collar */
function neckCapGeometry() {
  const a1 = 24.8, b1 = 6.2;
  return gridGeometry((ti, tj) => {
    const phi = tj * Math.PI * 2;
    const s = 1 - ti * 0.97;
    const [x, z] = superellipse(phi, a1 * s, b1 * s, 2.4);
    const y = BODY_H + 0.1 - 4.0 * Math.pow(1 - s, 1.7);
    return [x, y, z + 0.9 * (1 - s)];
  }, 7, 72, { uvx: 4, uvy: 1 });
}

/* shared sleeve path so sleeve + cuff align perfectly */
function sleevePath(side) {
  const root = new THREE.Vector3(side * 22, 58, 0.2);
  const dir = new THREE.Vector3(side, -0.46, 0.10).normalize();
  const L = 23;
  const mid = root.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, 0.9, 0));
  const end = root.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, -0.7, 0));
  const bez = (s) => {
    const u = 1 - s;
    return new THREE.Vector3()
      .addScaledVector(root, u * u)
      .addScaledVector(mid, 2 * u * s)
      .addScaledVector(end, s * s);
  };
  const tan = (s) => {
    const u = 1 - s;
    return new THREE.Vector3()
      .addScaledVector(mid.clone().sub(root), 2 * u)
      .addScaledVector(end.clone().sub(mid), 2 * s)
      .normalize();
  };
  return { bez, tan, end };
}

function sleeveGeometry(side) {
  const { bez, tan } = sleevePath(side);
  const UP = new THREE.Vector3(0, 1, 0);
  return gridGeometry((ti, tj) => {
    const phi = tj * Math.PI * 2;
    const p = bez(ti), t = tan(ti);
    const n1 = new THREE.Vector3().crossVectors(UP, t).normalize();
    const n2 = new THREE.Vector3().crossVectors(t, n1).normalize();
    const w = 1 + 0.014 * Math.sin(4 * phi + ti * 7) * (1 - ti * 0.5);
    const rA = (10.4 - 2.0 * ti) * w;            // front–back
    const rB = (8.6 + 0.8 * ti) * w;             // up–down (relaxed flare)
    const pt = p.clone()
      .addScaledVector(n1, Math.cos(phi) * rA)
      .addScaledVector(n2, Math.sin(phi) * rB);
    return [pt.x, pt.y, pt.z];
  }, 30, 56, { uvx: 4, uvy: 3 });
}

/* closed band lofted around an ellipse (collar) or along a ring path */
function bandGeometry({ center, rx, rz, drop = 0, radialR = 1.8, radialFlat = null, steps = 40, radial = 28, uvx = 6 }) {
  return gridGeometry((ti, tj) => {
    const ang = ti * Math.PI * 2;
    const psi = tj * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const cx = center.x + ca * rx;
    const cy = center.y - ti * drop;
    const cz = center.z + sa * rz;
    // outward direction of the ellipse
    let ox = ca * rz, oz = sa * rx;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol; oz /= ol;
    const rr = radialFlat ?? radialR;
    const rv = radialFlat ? radialFlat * 1.35 : radialR;
    return [
      cx + ox * Math.cos(psi) * rr,
      cy + Math.sin(psi) * rv,
      cz + oz * Math.cos(psi) * rr,
    ];
  }, steps, radial, { wrapPath: true, uvx, uvy: 1 });
}

function cuffGeometry(side) {
  // same frame as the sleeve so the ribbed cuff hugs the opening
  const { tan, end } = sleevePath(side);
  const tanV = tan(1);
  const UP = new THREE.Vector3(0, 1, 0);
  const n1 = new THREE.Vector3().crossVectors(UP, tanV).normalize();
  const n2 = new THREE.Vector3().crossVectors(tanV, n1).normalize();

  const rA = 8.5, rB = 9.5;
  const rings = 44, radial = 22;
  const pos = [], uv = [], idx = [];
  const row = radial + 1;
  for (let i = 0; i <= rings; i++) {
    const ang = (i / rings) * Math.PI * 2;
    const ringC = end.clone()
      .addScaledVector(n1, Math.cos(ang) * rA)
      .addScaledVector(n2, Math.sin(ang) * rB);
    for (let j = 0; j <= radial; j++) {
      const psi = (j / radial) * Math.PI * 2;
      const pt = ringC.clone()
        .addScaledVector(tanV, Math.cos(psi) * 1.9)
        .addScaledVector(new THREE.Vector3().copy(n1).multiplyScalar(Math.cos(ang))
          .addScaledVector(n2, Math.sin(ang)), Math.sin(psi) * 1.9);
      pos.push(pt.x, pt.y, pt.z);
      uv.push((j / radial) * 6, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = (i + 1) * row + j, c = b + 1, d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld seams (ring wrap + radial wrap)
  const n = g.attributes.normal;
  const weld = (a, b) => {
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  };
  for (let j = 0; j <= radial; j++) weld(j, rings * row + j);
  for (let i = 0; i <= rings; i++) weld(i * row, i * row + radial);
  n.needsUpdate = true;
  return g;
}

/* ─────────────────────────── material ─────────────────────────── */

export const FABRICS = {
  heavy:   { name: 'Heavyweight · 240 GSM', roughness: 0.92, sheen: 0.42, sheenRoughness: 0.8, bump: 0.75, tint: 0 },
  vintage: { name: 'Vintage Wash · 200 GSM', roughness: 1.0, sheen: 0.22, sheenRoughness: 0.9, bump: 1.05, tint: 0.16 },
  perf:    { name: 'Performance Knit · 180 GSM', roughness: 0.62, sheen: 0.95, sheenRoughness: 0.5, bump: 0.3, tint: 0 },
};

export function createFabricMaterial(bumpTex) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d1f24,
    roughness: 0.92,
    metalness: 0,
    sheen: 0.42,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffffff),
    bumpMap: bumpTex,
    bumpScale: 0.75,
    side: THREE.DoubleSide,
  });
}

/* ─────────────────────────── assembly ─────────────────────────── */

export function buildTee(bumpTex) {
  const fabric = createFabricMaterial(bumpTex);
  const group = new THREE.Group();
  const mk = (geo) => {
    const m = new THREE.Mesh(geo, fabric);
    group.add(m);
    return m;
  };

  const meshes = {
    body: mk(bodyGeometry()),
    neckCap: mk(neckCapGeometry()),
    sleeveL: mk(sleeveGeometry(-1)),
    sleeveR: mk(sleeveGeometry(1)),
    collar: mk(bandGeometry({
      center: new THREE.Vector3(0, BODY_H + 1.1, 1.2),
      rx: 10.2, rz: 8.6, radialR: 2.1, steps: 56, radial: 26, uvx: 8,
    })),
    hem: mk(bandGeometry({
      center: new THREE.Vector3(0, 0.4, 0),
      rx: 25.5, rz: 17.3, drop: 3.0, radialR: 1.55, steps: 72, radial: 20, uvx: 10,
    })),
    cuffL: mk(cuffGeometry(-1)),
    cuffR: mk(cuffGeometry(1)),
  };

  // closes the tiny hole under the neck dip (back-neck interior)
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48).scale(8.4, 6.6, 1).rotateX(-Math.PI / 2),
    fabric
  );
  disk.position.set(0, BODY_H - 4.4, 0.9);
  group.add(disk);
  meshes.neckDisk = disk;

  return { group, meshes, fabric };
}

/* ─────────────────────────── studio env ─────────────────────────── */

export function createStudioEnv(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(1, 1);
  const panel = (hex, intensity, w, h, x, y, z) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      })
    );
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    m.lookAt(0, 30, 0);
    scene.add(m);
  };
  panel('#ffffff', 8.5, 70, 70, 0, 70, 0);       // top softbox
  panel('#eef3ff', 4.5, 32, 60, -60, 24, 30);    // cool key (left)
  panel('#ffe7cd', 3.8, 28, 52, 62, 18, -8);     // warm kicker (right)
  panel('#dfe8ff', 2.8, 80, 26, 0, 28, -62);     // back rim
  panel('#fff3dd', 2.0, 52, 12, 8, 2, 58);       // low front fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.07).texture;
  pmrem.dispose();
  geo.dispose();
  return env;
}
