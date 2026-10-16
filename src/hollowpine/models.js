import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { random } from "./rules.js";

export const material = (color, options = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...options });
export const mesh = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};
export const box = (p, m, w, h, d, x = 0, y = 0, z = 0) =>
  mesh(p, new THREE.BoxGeometry(w, h, d), m, x, y, z);
export const ball = (p, m, r, x = 0, y = 0, z = 0, scale = [1, 1, 1]) => {
  const o = mesh(p, new THREE.SphereGeometry(r, 10, 8), m, x, y, z);
  o.scale.set(...scale);
  return o;
};
export class Batch {
  constructor(parent) {
    this.parent = parent;
    this.groups = new Map();
  }
  add(geometry, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g);
  }
  box(m, w, h, d, x = 0, y = 0, z = 0, ry = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, ry);
  }
  cylinder(m, r, h, x = 0, y = 0, z = 0, top = r, segments = 7) {
    this.add(new THREE.CylinderGeometry(top, r, h, segments), m, x, y, z);
  }
  between(m, a, b, r1 = 0.04, r2 = r1, segments = 6) {
    const dir = new THREE.Vector3().subVectors(b, a),
      g = new THREE.CylinderGeometry(r2, r1, dir.length(), segments);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.normalize(),
      ),
    );
    this.add(g, m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  }
  finish() {
    for (const [m, gs] of this.groups) {
      const result = mesh(this.parent, mergeGeometries(gs, false), m);
      gs.forEach((g) => g.dispose());
      result.name = "Batched_" + (m.name || "geometry");
    }
    this.groups.clear();
  }
}
export function batchChildren(root) {
  [...root.children].filter((c) => c.isGroup).forEach(batchChildren);
  const groups = new Map();
  for (const child of root.children)
    if (child.isMesh) {
      if (!groups.has(child.material)) groups.set(child.material, []);
      groups.get(child.material).push(child);
    }
  for (const [mat, parts] of groups) {
    if (parts.length < 2) continue;
    const b = new Batch(root);
    for (const p of parts) {
      p.updateMatrix();
      b.add(p.geometry.clone().applyMatrix4(p.matrix), mat);
      root.remove(p);
      p.geometry.dispose();
    }
    b.finish();
  }
}
function createCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}
function toTexture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let cachedMaterials;
export function forestMaterials() {
  if (cachedMaterials) return cachedMaterials;
  const rng = random(19),
    [bark, g] = createCanvas(128, 256);
  g.fillStyle = "#766249";
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 280; i++) {
    g.strokeStyle = `rgba(${rng() > 0.4 ? "33,31,24" : "159,145,107"},${0.1 + rng() * 0.5})`;
    g.lineWidth = 0.5 + rng() * 3;
    let x = rng() * 128,
      y = rng() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(
      x + 4,
      y + 12,
      x - 2,
      y + 21,
      x + rng() * 5,
      y + 20 + rng() * 65,
    );
    g.stroke();
  }
  const barkMap = toTexture(bark, true);
  barkMap.repeat.set(2, 3);
  const [cut, cg] = createCanvas(128, 128);
  cg.fillStyle = "#b59a69";
  cg.fillRect(0, 0, 128, 128);
  cg.strokeStyle = "#70603d66";
  for (let r = 5; r < 80; r += 5 + rng() * 4) {
    cg.beginPath();
    cg.ellipse(66, 62, r, r * 0.94, 0.1, 0, 7);
    cg.stroke();
  }
  for (let i = 0; i < 18; i++) {
    cg.fillStyle = "#614d3533";
    cg.fillRect(rng() * 128, rng() * 128, 1, 1);
  }
  const [needles, ng] = createCanvas(256, 128);
  ng.clearRect(0, 0, 256, 128);
  ng.strokeStyle = "#5f6842";
  ng.lineWidth = 2.5;
  ng.beginPath();
  ng.moveTo(8, 64);
  ng.quadraticCurveTo(100, 74, 246, 61);
  ng.stroke();
  for (let j = 0; j < 29; j++) {
    const x = 12 + j * 7.6,
      t = j / 29,
      len = 46 * (1 - t * 0.7);
    for (const s of [-1, 1]) {
      const endX = x + 25 * (1 - t),
        endY = 64 + s * len * (0.65 + rng() * 0.35);
      ng.strokeStyle = "#48603c";
      ng.lineWidth = 1;
      ng.beginPath();
      ng.moveTo(x, 64);
      ng.lineTo(endX, endY);
      ng.stroke();
      for (let k = 0; k < 11; k++) {
        const f = k / 11,
          px = x + (endX - x) * f,
          py = 64 + (endY - 64) * f;
        for (const side of [-1, 1]) {
          ng.strokeStyle = ["#7d9057", "#5b7545", "#405b39", "#a0a269"][
            Math.floor(rng() * 4)
          ];
          ng.lineWidth = 0.8 + rng() * 0.8;
          ng.beginPath();
          ng.moveTo(px, py);
          ng.lineTo(px + side * (5 + rng() * 7), py + s * (5 + rng() * 8));
          ng.stroke();
        }
      }
    }
  }
  const needleMap = toTexture(needles);
  cachedMaterials = {
    bark: material("#b0a28b", { map: barkMap }),
    cut: material("#ffffff", { map: toTexture(cut) }),
    needles: material("#c7d0ae", {
      map: needleMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 1,
    }),
    pineCrown: material("#ffffff", { vertexColors: true }),
    pineDark: material("#3b5744"),
    pineMid: material("#49634a"),
    pineLight: material("#536e4d"),
    rock: material("#747b70", { roughness: 0.96 }),
    moss: material("#667149"),
    wood: material("#827252"),
    woodDark: material("#5c503c"),
    fern: material("#687e48", { side: THREE.DoubleSide }),
    fernLight: material("#87904d", { side: THREE.DoubleSide }),
    grass: material("#737d48", { side: THREE.DoubleSide }),
    canvas: material("#9c976e"),
    rope: material("#bcaa77"),
    ash: material("#383e32"),
    steel: material("#7f8985", { metalness: 0.7, roughness: 0.36 }),
  };
  return cachedMaterials;
}
export function buildPine(height = 14, seed = 12, detailed = true) {
  const root = new THREE.Group();
  root.name = "Scots_pine";
  const b = new Batch(root),
    m = forestMaterials(),
    rng = random(seed);
  const radius = height * 0.023;
  b.cylinder(
    m.bark,
    radius,
    height,
    0,
    height / 2,
    0,
    radius * 0.18,
    detailed ? 9 : 6,
  );
  if (detailed) {
    // Volumetric, irregular crowns; small needle sprays soften their silhouettes.
    for (let tier = 0; tier < 7; tier++) {
      const t = tier / 7,
        y = height * (0.36 + t * 0.57),
        radius = height * (0.18 * Math.pow(1 - t, 0.8) + 0.009),
        crownHeight = height * (0.25 - t * 0.09);
      const geo = new THREE.ConeGeometry(radius, crownHeight, 13, 2),
        p = geo.attributes.position,
        colors = new Float32Array(p.count * 3);
      const shade = new THREE.Color(),
        low = new THREE.Color("#294936"),
        high = new THREE.Color("#718254");
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v),
          yy = p.getY(v),
          z = p.getZ(v),
          a = Math.atan2(z, x),
          f = (yy + crownHeight / 2) / crownHeight;
        const jitter =
          1 +
          Math.sin(a * 5 + seed + tier) * 0.12 +
          Math.cos(a * 3 + seed) * 0.055;
        p.setXYZ(
          v,
          x * jitter,
          yy + Math.sin(a * 6 + seed) * 0.18 * (1 - f),
          z * jitter,
        );
        shade.copy(low).lerp(high, 0.22 + f * 0.6 + Math.sin(a * 2) * 0.06);
        colors.set([shade.r, shade.g, shade.b], v * 3);
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      b.add(geo, m.pineCrown, 0, y, 0);
      if (tier < 5)
        for (let j = 0; j < 4; j++) {
          const a = (j * Math.PI) / 2 + tier * 1.8,
            dx = Math.cos(a),
            dz = Math.sin(a);
          b.between(
            m.bark,
            new THREE.Vector3(0, y - crownHeight * 0.35, 0),
            new THREE.Vector3(
              dx * radius * 0.86,
              y - crownHeight * 0.25,
              dz * radius * 0.86,
            ),
            0.035,
            0.009,
            5,
          );
          const spray = new THREE.PlaneGeometry(radius * 0.83, radius * 0.54);
          spray.rotateX(-0.65 - (j % 2) * 0.65);
          spray.rotateY(-a);
          b.add(
            spray,
            m.needles,
            dx * radius * 0.82,
            y - crownHeight * 0.31,
            dz * radius * 0.82,
          );
        }
    }
    b.add(
      new THREE.ConeGeometry(height * 0.033, height * 0.18, 9),
      m.pineMid,
      0,
      height * 0.97,
      0,
    );
  } else {
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      b.add(
        new THREE.ConeGeometry(height * (0.19 - t * 0.15), height * 0.29, 7),
        [m.pineDark, m.pineMid, m.pineLight][i % 3],
        0,
        height * (0.39 + t * 0.57),
        0,
      );
    }
  }
  b.finish();
  return root;
}
export function rockGeometry(radius = 1, seed = 1) {
  const g = new THREE.IcosahedronGeometry(radius, 1),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      n = 0.9 + Math.sin(x * 17.1 + y * 27.2 + z * 13.8 + seed) * 0.12;
    p.setXYZ(i, x * n, Math.max(-radius * 0.4, y * n) * 0.72, z * n * 0.83);
  }
  g.computeVertexNormals();
  return g;
}
function leafGeometry(length, width) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0,
        0,
        0,
        -width * 0.5,
        0.05,
        length * 0.45,
        0,
        0.08,
        length,
        0,
        0,
        0,
        0,
        0.08,
        length,
        width * 0.5,
        0.05,
        length * 0.45,
      ],
      3,
    ),
  );
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      [0.5, 0, 0, 0.45, 0.5, 1, 0.5, 0, 0.5, 1, 1, 0.45],
      2,
    ),
  );
  g.computeVertexNormals();
  return g;
}
export function buildFern(scale = 1, seed = 0) {
  const root = new THREE.Group(),
    b = new Batch(root),
    m = forestMaterials(),
    rng = random(seed);
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7 + rng() * 0.3,
      dx = Math.cos(a),
      dz = Math.sin(a),
      len = 0.65 + rng() * 0.35;
    for (let j = 1; j < 7; j++) {
      const t = j / 7,
        x = dx * len * t,
        z = dz * len * t,
        y = Math.sin(t * 2.6) * 0.4 + 0.07;
      for (const s of [-1, 1]) {
        const g = leafGeometry(0.25 * (1 - t * 0.65), 0.09);
        g.rotateY(-a + s * 0.95 + Math.PI / 2);
        b.add(g, j % 2 ? m.fern : m.fernLight, x, y, z);
      }
    }
  }
  b.finish();
  root.scale.setScalar(scale);
  root.name = "Woodland_fern";
  return root;
}
export function buildLog(length = 1.5, radius = 0.13) {
  const group = new THREE.Group(),
    m = forestMaterials();
  group.name = "Fallen_branch";
  const log = mesh(
    group,
    new THREE.CylinderGeometry(radius * 0.82, radius, length, 7),
    m.bark,
    0,
    radius,
    0,
  );
  log.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    const cap = mesh(
      group,
      new THREE.CircleGeometry(radius * 0.9, 7),
      m.cut,
      0,
      radius,
      s * (length / 2 + 0.002),
    );
    if (s < 0) cap.rotation.y = Math.PI;
  }
  const twig = mesh(
    group,
    new THREE.CylinderGeometry(0.012, 0.04, 0.34, 5),
    m.bark,
    0.08,
    radius + 0.11,
    0.2,
  );
  twig.rotation.z = -0.75;
  return group;
}
export function buildHatchet() {
  const root = new THREE.Group();
  root.name = "Field_hatchet";
  const m = forestMaterials(),
    strap = material("#493f30");
  const handle = mesh(
    root,
    new THREE.CylinderGeometry(0.027, 0.037, 0.55, 8),
    m.wood,
    0,
    0.25,
    0,
  );
  handle.rotation.z = -0.07;
  for (let i = 0; i < 6; i++) {
    const grip = mesh(
      root,
      new THREE.CylinderGeometry(0.037, 0.038, 0.016, 8),
      strap,
      0.012,
      0.035 + i * 0.021,
      0,
    );
    grip.rotation.z = -0.07;
  }
  const shape = new THREE.Shape();
  shape.moveTo(-0.055, 0);
  shape.lineTo(0.09, 0.035);
  shape.lineTo(0.17, 0.075);
  shape.lineTo(0.18, -0.115);
  shape.lineTo(0.1, -0.13);
  shape.lineTo(0.025, -0.06);
  shape.lineTo(-0.055, -0.05);
  shape.closePath();
  const blade = mesh(
    root,
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.052,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.006,
      bevelThickness: 0.004,
    }),
    m.steel,
    0,
    0.54,
    -0.026,
  );
  box(
    root,
    material("#c5cbc3", { metalness: 0.8, roughness: 0.24 }),
    0.015,
    0.18,
    0.061,
    0.172,
    0.515,
    0,
  ).rotation.z = 0.02;
  box(root, strap, 0.075, 0.095, 0.071, -0.015, 0.51, 0);
  batchChildren(root);
  return root;
}
export function buildTorch() {
  const root = new THREE.Group(),
    m = forestMaterials();
  root.name = "Field_torch";
  mesh(
    root,
    new THREE.CylinderGeometry(0.028, 0.038, 0.47, 7),
    m.wood,
    0,
    0.2,
    0,
  );
  mesh(
    root,
    new THREE.CylinderGeometry(0.063, 0.045, 0.12, 8),
    m.canvas,
    0,
    0.45,
    0,
  );
  const flame = mesh(
    root,
    new THREE.ConeGeometry(0.065, 0.23, 7),
    material("#ffb850", {
      emissive: "#ff8b25",
      emissiveIntensity: 2.5,
      transparent: true,
      opacity: 0.9,
    }),
    0,
    0.6,
    0,
  );
  flame.name = "Flame";
  return { root, flame };
}
export function buildSurvivor() {
  const root = new THREE.Group();
  root.name = "HOLLOWPINE_Survivor";
  const jacket = material("#586553"),
    cloth = material("#697763"),
    pants = material("#3a4949"),
    boots = material("#4b4236"),
    skin = material("#cfa986"),
    hair = material("#4c4135"),
    bag = material("#a99468"),
    strap = material("#726143"),
    lining = material("#ad7850"),
    dark = material("#282f2b"),
    seam = material("#8f9778");
  const body = new THREE.Group();
  body.name = "Spine";
  root.add(body);
  const torso = mesh(
    body,
    new THREE.CylinderGeometry(0.31, 0.255, 0.55, 6),
    jacket,
    0,
    1.19,
    0,
  );
  torso.scale.z = 0.6;
  torso.rotation.y = Math.PI / 6;
  box(body, jacket, 0.49, 0.2, 0.29, 0, 0.89, 0.015);
  box(body, lining, 0.12, 0.42, 0.018, 0, 1.2, -0.18);
  box(body, seam, 0.018, 0.52, 0.012, 0.05, 1.19, -0.194);
  for (const s of [-1, 1]) {
    box(body, jacket, 0.17, 0.15, 0.028, s * 0.16, 1.05, -0.17);
    box(body, seam, 0.15, 0.012, 0.033, s * 0.16, 1.12, -0.183);
    box(body, strap, 0.054, 0.47, 0.025, s * 0.205, 1.23, -0.17).rotation.z =
      -s * 0.13;
    box(body, bag, 0.055, 0.09, 0.034, s * 0.22, 1.14, -0.19);
  }
  box(body, strap, 0.42, 0.031, 0.026, 0, 1.25, -0.199);
  ball(body, skin, 0.065, 0, 1.52, 0, [1, 1.3, 1]);
  const head = new THREE.Group();
  head.name = "Head";
  head.position.set(0, 1.68, 0);
  body.add(head);
  ball(head, skin, 0.145, 0, 0, -0.01, [0.96, 1.14, 0.88]);
  ball(head, hair, 0.131, 0, -0.062, -0.045, [0.98, 0.64, 0.88]);
  ball(head, skin, 0.027, 0, -0.005, -0.143, [0.7, 1.3, 1]);
  for (const s of [-1, 1]) {
    ball(head, dark, 0.009, s * 0.049, 0.035, -0.129);
    ball(head, skin, 0.027, s * 0.137, -0.005, 0, [0.5, 1, 0.8]);
  }
  ball(head, jacket, 0.158, 0, 0.1, 0.015, [1.02, 0.74, 0.95]);
  mesh(
    head,
    new THREE.CylinderGeometry(0.156, 0.157, 0.045, 12),
    cloth,
    0,
    0.087,
    0.012,
  );
  box(body, bag, 0.35, 0.44, 0.18, 0, 1.18, 0.24);
  ball(body, bag, 0.17, 0, 1.4, 0.23, [1, 0.47, 0.55]);
  box(body, bag, 0.29, 0.18, 0.08, 0, 1.08, 0.36);
  box(body, lining, 0.27, 0.025, 0.013, 0, 1.15, 0.408);
  for (const s of [-1, 1]) {
    box(body, strap, 0.028, 0.42, 0.022, s * 0.12, 1.2, 0.346);
    box(body, seam, 0.041, 0.048, 0.035, s * 0.12, 1.11, 0.415);
  }
  box(body, dark, 0.1, 0.075, 0.014, 0, 1.3, 0.338);
  box(body, lining, 0.06, 0.035, 0.02, 0, 1.3, 0.35);
  const bedroll = mesh(
    body,
    new THREE.CylinderGeometry(0.105, 0.105, 0.45, 12),
    cloth,
    0,
    0.91,
    0.25,
  );
  bedroll.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const band = mesh(
      body,
      new THREE.CylinderGeometry(0.108, 0.108, 0.031, 12),
      strap,
      s * 0.145,
      0.91,
      0.25,
    );
    band.rotation.z = Math.PI / 2;
  }
  const limbs = {};
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    const arm = new THREE.Group();
    arm.name = `Shoulder_${side}`;
    arm.position.set(s * 0.285, 1.4, 0);
    arm.rotation.z = s * 0.085;
    body.add(arm);
    mesh(
      arm,
      new THREE.CapsuleGeometry(0.087, 0.19, 3, 8),
      jacket,
      0,
      -0.13,
      0,
    );
    const elbow = new THREE.Group();
    elbow.name = `Elbow_${side}`;
    elbow.position.y = -0.29;
    arm.add(elbow);
    mesh(
      elbow,
      new THREE.CapsuleGeometry(0.071, 0.18, 3, 8),
      cloth,
      0,
      -0.13,
      -0.005,
    );
    mesh(
      elbow,
      new THREE.CylinderGeometry(0.077, 0.075, 0.045, 8),
      lining,
      0,
      -0.25,
      -0.005,
    );
    ball(elbow, skin, 0.063, 0, -0.31, -0.006, [0.88, 1.1, 0.8]);
    const leg = new THREE.Group();
    leg.name = `Hip_${side}`;
    leg.position.set(s * 0.135, 0.86, 0);
    root.add(leg);
    const thigh = mesh(
      leg,
      new THREE.CapsuleGeometry(0.105, 0.22, 3, 8),
      pants,
      0,
      -0.16,
      0,
    );
    thigh.scale.z = 1.08;
    box(leg, pants, 0.043, 0.16, 0.15, s * 0.1, -0.22, 0.01);
    const knee = new THREE.Group();
    knee.name = `Knee_${side}`;
    knee.position.y = -0.36;
    leg.add(knee);
    mesh(
      knee,
      new THREE.CapsuleGeometry(0.08, 0.2, 3, 8),
      pants,
      0,
      -0.145,
      0.0,
    );
    box(knee, boots, 0.18, 0.14, 0.28, 0, -0.395, -0.04);
    box(knee, dark, 0.185, 0.035, 0.29, 0, -0.45, -0.04);
    box(knee, boots, 0.17, 0.16, 0.19, 0, -0.3, 0.0);
    for (let i = 0; i < 3; i++)
      box(knee, bag, 0.13, 0.012, 0.014, 0, -0.28 - i * 0.029, -0.1);
    limbs["arm" + side] = arm;
    limbs["elbow" + side] = elbow;
    limbs["leg" + side] = leg;
    limbs["knee" + side] = knee;
  }
  const socket = new THREE.Group();
  socket.name = "Tool_socket";
  socket.position.set(0, -0.32, -0.017);
  limbs.elbowR.add(socket);
  const axe = buildHatchet();
  axe.rotation.x = Math.PI;
  socket.add(axe);
  const torch = buildTorch();
  socket.add(torch.root);
  torch.root.visible = false;
  batchChildren(root);
  function equip(tool, lit = false) {
    axe.visible = tool === "axe";
    torch.root.visible = tool === "torch";
    torch.flame.visible = tool === "torch" && lit;
  }
  function animate(
    t,
    speed = 0,
    attack = 0,
    equipped = "axe",
    jumping = false,
  ) {
    const running = speed > 4.5,
      walk = Math.min(1, speed / 3),
      phase = t * (running ? 11 : 7.8),
      swing = Math.sin(phase) * walk;
    body.position.y = Math.abs(swing) * 0.025 + Math.sin(t * 1.5) * 0.005;
    body.rotation.x = running ? -0.07 : 0;
    body.rotation.z = Math.cos(phase) * walk * 0.022;
    head.rotation.y = walk ? 0 : Math.sin(t * 0.28) * 0.12;
    for (const [i, side] of ["L", "R"].entries()) {
      const s = i === 0 ? 1 : -1;
      limbs["leg" + side].rotation.x = swing * s * 0.52 + (jumping ? -0.22 : 0);
      limbs["knee" + side].rotation.x =
        Math.max(0, -swing * s) * 0.65 + (jumping ? 0.48 : 0);
      limbs["arm" + side].rotation.x = -swing * s * 0.3;
      limbs["elbow" + side].rotation.x = running ? 0.45 : 0.12;
    }
    if (equipped === "torch") {
      limbs.armR.rotation.x = 0.4;
      limbs.elbowR.rotation.x = 0.4;
    }
    if (attack > 0) {
      const a = Math.sin(attack * Math.PI);
      limbs.armR.rotation.x = 2.2 * a;
      limbs.elbowR.rotation.x = 0.25 + 0.4 * a;
      body.rotation.y = -a * 0.22;
    } else body.rotation.y = 0;
    torch.flame.scale.set(
      1 + Math.sin(t * 19) * 0.12,
      1 + Math.sin(t * 15) * 0.17,
      1,
    );
  }
  return { root, body, head, limbs, socket, axe, torch, equip, animate };
}
export function buildCampfire(lit = true) {
  const root = new THREE.Group();
  root.name = "Stone_ring_campfire";
  const m = forestMaterials(),
    rng = random(223),
    b = new Batch(root);
  b.cylinder(m.ash, 0.72, 0.035, 0, 0.02, 0);
  for (let i = 0; i < 11; i++) {
    const a = (i * Math.PI * 2) / 11;
    b.add(
      rockGeometry(0.2 + rng() * 0.04, i),
      m.rock,
      Math.cos(a) * 0.72,
      0.1,
      Math.sin(a) * 0.72,
      0,
      a,
      0,
    );
  }
  for (let i = 0; i < 4; i++) {
    const log = buildLog(0.9, 0.08);
    log.position.set(Math.sin(i * 2) * 0.16, 0.07, Math.cos(i * 2) * 0.16);
    log.rotation.y = i * 0.85;
    root.add(log);
  }
  b.finish();
  const flames = new THREE.Group();
  flames.name = "Flames";
  root.add(flames);
  flames.visible = lit;
  for (let i = 0; i < 6; i++) {
    const f = mesh(
      flames,
      new THREE.ConeGeometry(0.1 + (i % 2) * 0.035, 0.5 + (i % 3) * 0.12, 6),
      material(i % 2 ? "#ffbb59" : "#eb7739", {
        emissive: i % 2 ? "#ffc15c" : "#ff7732",
        emissiveIntensity: 2.3,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
      Math.cos(i * 2.4) * 0.16,
      0.4,
      Math.sin(i * 2.4) * 0.16,
    );
    f.rotation.z = Math.sin(i) * 0.16;
  }
  const ember = mesh(
    flames,
    new THREE.SphereGeometry(0.24, 10, 6),
    material("#ffd384", { emissive: "#ffb44b", emissiveIntensity: 3 }),
    0,
    0.16,
    0,
  );
  ember.scale.y = 0.18;
  return {
    root,
    flames,
    animate(t) {
      flames.children.forEach((f, i) => {
        f.scale.y = 0.9 + Math.sin(t * 9 + i * 1.6) * 0.21;
        f.rotation.z = Math.sin(t * 4 + i) * 0.13;
      });
    },
  };
}
export function buildShelter() {
  const root = new THREE.Group();
  root.name = "Pine_bough_lean_to";
  const m = forestMaterials(),
    b = new Batch(root);
  const posts = [
    [-1.35, 0, -0.8],
    [1.35, 0, -0.8],
    [-1.35, 0, 1.05],
    [1.35, 0, 1.05],
  ];
  posts.forEach(([x, y, z], i) =>
    b.cylinder(
      m.bark,
      0.075,
      i < 2 ? 1.9 : 0.65,
      x,
      (i < 2 ? 1.9 : 0.65) / 2,
      z,
      0.06,
    ),
  );
  b.between(
    m.bark,
    new THREE.Vector3(-1.55, 1.88, -0.8),
    new THREE.Vector3(1.55, 1.88, -0.8),
    0.09,
    0.08,
  );
  for (let x = -1.45; x < 1.6; x += 0.28)
    b.between(
      m.wood,
      new THREE.Vector3(x, 1.9, -0.9),
      new THREE.Vector3(x, 0.68, 1.2),
      0.035,
      0.025,
    );
  for (let z = -0.82; z < 1.25; z += 0.2) {
    const y = 1.9 - (z + 0.9) * 0.581;
    b.box(m.pineDark, 3.15, 0.07, 0.31, 0, y, z);
  }
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.45), m.needles);
  cover.position.set(0, 1.34, 0.15);
  cover.rotation.x = -1.05;
  root.add(cover);
  b.box(m.canvas, 0.76, 0.065, 1.65, 0, 0.08, 0.1);
  b.box(m.woodDark, 0.78, 0.045, 0.25, 0, 0.13, -0.6);
  for (const x of [-1.35, 1.35])
    for (const y of [1.82, 1.88]) {
      const rope = new THREE.TorusGeometry(0.085, 0.009, 4, 8);
      b.add(rope, m.rope, x, y, -0.8, Math.PI / 2);
    }
  b.finish();
  return root;
}
export function buildDeer() {
  const root = new THREE.Group();
  root.name = "Woodland_deer";
  const fur = material("#8c8062"),
    pale = material("#c2b38c"),
    dark = material("#493f31");
  ball(root, fur, 0.38, 0, 0.9, 0, [0.65, 0.84, 1.5]);
  const neck = mesh(
    root,
    new THREE.CylinderGeometry(0.1, 0.16, 0.5, 7),
    fur,
    0,
    1.16,
    -0.4,
  );
  neck.rotation.x = -0.32;
  ball(root, fur, 0.16, 0, 1.46, -0.53, [0.7, 1.05, 1.3]);
  ball(root, dark, 0.055, 0, 1.4, -0.72, [0.8, 0.7, 1]);
  for (const s of [-1, 1]) {
    ball(root, fur, 0.08, s * 0.1, 1.62, -0.47, [0.6, 1.4, 0.5]);
    ball(root, dark, 0.013, s * 0.105, 1.48, -0.62);
  }
  const legs = [];
  for (const x of [-0.17, 0.17])
    for (const z of [-0.35, 0.35]) {
      const g = new THREE.Group();
      g.position.set(x, 0.75, z);
      root.add(g);
      mesh(
        g,
        new THREE.CylinderGeometry(0.045, 0.025, 0.71, 6),
        fur,
        0,
        -0.35,
        0,
      );
      box(g, dark, 0.08, 0.08, 0.1, 0, -0.7, -0.015);
      legs.push(g);
    }
  ball(root, pale, 0.1, 0, 1.01, 0.56, [0.65, 0.6, 1.3]);
  batchChildren(root);
  return {
    root,
    animate(t, speed = 0) {
      legs.forEach(
        (g, i) =>
          (g.rotation.x = Math.sin(t * 5 + (i % 2) * Math.PI) * speed * 0.25),
      );
    },
  };
}
export function buildWolf() {
  const root = new THREE.Group();
  root.name = "Grey_wolf";
  const fur = material("#656c65"),
    light = material("#899187"),
    dark = material("#303a35");
  ball(root, fur, 0.31, 0, 0.62, 0, [0.65, 0.9, 1.55]);
  ball(root, light, 0.22, 0, 0.81, -0.39, [0.8, 1.1, 0.9]);
  ball(root, fur, 0.17, 0, 0.89, -0.53, [0.9, 1, 1.15]);
  ball(root, light, 0.1, 0, 0.82, -0.72, [0.75, 0.72, 1.5]);
  ball(root, dark, 0.043, 0, 0.84, -0.85);
  for (const s of [-1, 1]) {
    const ear = mesh(
      root,
      new THREE.ConeGeometry(0.085, 0.19, 4),
      fur,
      s * 0.11,
      1.06,
      -0.48,
    );
    ear.rotation.z = -s * 0.15;
    ball(root, dark, 0.012, s * 0.112, 0.91, -0.65);
  }
  const tail = mesh(
    root,
    new THREE.CylinderGeometry(0.035, 0.11, 0.52, 7),
    fur,
    0,
    0.56,
    0.64,
  );
  tail.rotation.x = -1;
  const legs = [];
  for (const x of [-0.15, 0.15])
    for (const z of [-0.29, 0.3]) {
      const g = new THREE.Group();
      g.position.set(x, 0.63, z);
      root.add(g);
      mesh(
        g,
        new THREE.CylinderGeometry(0.065, 0.037, 0.57, 6),
        fur,
        0,
        -0.27,
        0,
      );
      box(g, dark, 0.1, 0.08, 0.17, 0, -0.56, -0.04);
      legs.push(g);
    }
  batchChildren(root);
  return {
    root,
    animate(t) {
      legs.forEach(
        (g, i) => (g.rotation.x = Math.sin(t * 7 + (i % 2) * Math.PI) * 0.38),
      );
    },
  };
}
export function buildDiorama() {
  const root = new THREE.Group();
  root.name = "HOLLOWPINE_Forest_Campsite";
  const m = forestMaterials(),
    rng = random(822);
  mesh(
    root,
    new THREE.CylinderGeometry(6.8, 6.3, 0.7, 64),
    material("#4e5d40"),
    0,
    -0.37,
    0,
  );
  mesh(
    root,
    new THREE.CylinderGeometry(6.32, 6.15, 0.65, 64),
    material("#514637"),
    0,
    -0.83,
    0,
  );
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2,
      r = 4.5 + rng() * 1.2;
    if (a > 0.15 && a < 1.85) continue;
    const tree = buildPine(5.5 + rng() * 3, i * 19, true);
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    root.add(tree);
  }
  const shelter = buildShelter();
  shelter.position.set(1.8, 0, -1);
  shelter.rotation.y = -0.35;
  root.add(shelter);
  const fire = buildCampfire(true);
  fire.root.position.set(-0.7, 0, 1);
  root.add(fire.root);
  const log = buildLog(2.1, 0.22);
  log.rotation.y = 1.5;
  log.position.set(-0.7, 0, 2.6);
  root.add(log);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2,
      r = 2.5 + rng() * 3.5;
    if (i % 3 === 0)
      mesh(
        root,
        rockGeometry(0.3 + rng() * 0.5, i),
        m.rock,
        Math.cos(a) * r,
        0.15,
        Math.sin(a) * r,
      );
    else {
      const f = buildFern(0.5 + rng() * 0.4, i);
      f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      root.add(f);
    }
  }
  return root;
}
