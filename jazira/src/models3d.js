// نماذج 3D — كل شي مرسوم بالكود — models3d.js
import * as THREE from '../../vendor/three.module.js';
import { box, cyl, cone, sphere, ico, frond, curvedTrunk, tint, pack, merge, moveGeo, rotGeo } from './geom3d.js';

export const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// ألوان
const WOOD = 0x8a5e34, WOOD_D = 0x6b4826, WOOD_L = 0xc9a06a;
const LEAF = 0x3f8f45, LEAF_D = 0x2f7a3a, LEAF_L = 0x4faa52;
const SAND = 0xe8d6a8, STONE = 0x9aa0a6, STONE_D = 0x7d838a;

// ============================================================
//  الأغراض الطبيعية
// ============================================================
export function buildModels() {
  const M = {};

  // نخلة
  {
    const list = [];
    merge(list, curvedTrunk(4.2, 0.26, 0.16, WOOD, 0.5));
    const tx = 0.5, ty = 4.2;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const g = frond(2.7, 0.75, i % 2 ? LEAF : LEAF_D);
      g.rotateY(a);
      g.translate(tx, ty, 0);
      g.rotateX(-0.15 - (i % 3) * 0.12);
      merge(list, g);
    }
    for (const [dx, dy, dz] of [[0.34, 4.0, 0.3], [0.5, 3.95, -0.34], [0.62, 4.02, 0.02]]) {
      merge(list, sphere(0.22, 0x6b4423, { x: dx, y: dy, z: dz }));
    }
    M.palm1 = pack(list);
    M.palm2 = M.palm1;
  }

  // شجرة عريضة (مع راتنج ولا بلا)
  for (const resin of [false, true]) {
    const list = [];
    merge(list, cyl(0.22, 0.32, 2.6, 7, WOOD));
    if (resin) {
      for (const [dx, dy, dz] of [[0.18, 1.5, 0.12], [-0.15, 0.9, -0.14], [0.2, 0.5, -0.05]])
        merge(list, sphere(0.13, 0xe0a13c, { x: dx, y: dy, z: dz, sy: 1.5 }));
    }
    const blobs = [[0, 3.3, 0, 1.45], [-1.0, 2.9, 0.25, 1.05], [1.0, 2.95, -0.2, 1.1], [0.2, 4.2, 0.1, 1.05], [-0.55, 4.05, -0.35, 0.85]];
    blobs.forEach(([x, y, z, r], i) => {
      merge(list, ico(r, i % 3 === 0 ? LEAF : i % 2 ? LEAF_L : LEAF_D, { x, y, z, sy: 0.85, detail: 0 }));
    });
    M[resin ? 'tree1r' : 'tree1'] = pack(list);
  }

  // شجرة صنوبر
  for (const resin of [false, true]) {
    const list = [];
    merge(list, cyl(0.18, 0.26, 1.5, 6, WOOD));
    if (resin) merge(list, sphere(0.12, 0xe0a13c, { x: 0.16, y: 1.0, z: 0.1, sy: 1.6 }));
    merge(list, cone(1.45, 2.1, 7, 0x2f6b3a, { y: 1.4 }));
    merge(list, cone(1.1, 1.9, 7, 0x357a41, { y: 2.6 }));
    merge(list, cone(0.72, 1.7, 7, 0x3f8f45, { y: 3.8 }));
    M[resin ? 'tree2r' : 'tree2'] = pack(list);
  }

  // شجيرة / شجيرة بالتوت
  for (const berry of [false, true]) {
    const list = [];
    const blobs = [[0, 0.5, 0, 0.62], [-0.42, 0.4, 0.15, 0.46], [0.4, 0.42, -0.12, 0.44], [0.05, 0.72, 0.1, 0.42]];
    blobs.forEach(([x, y, z, r], i) => merge(list, ico(r, i % 2 ? LEAF_L : LEAF, { x, y, z })));
    if (berry) for (const [x, y, z] of [[-0.3, 0.7, 0.3], [0.35, 0.6, 0.3], [0.1, 0.95, -0.1]])
      merge(list, sphere(0.1, 0xe0453f, { x, y, z }));
    M[berry ? 'bushBerry' : 'bush'] = pack(list);
  }

  // عشبة البزر
  {
    const list = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      merge(list, cyl(0.02, 0.05, 0.75, 4, 0x6fa844, { x: Math.cos(a) * 0.12, z: Math.sin(a) * 0.12, rz: Math.cos(a) * 0.22, rx: -Math.sin(a) * 0.22 }));
      merge(list, sphere(0.07, 0xd9c56a, { x: Math.cos(a) * 0.22, y: 0.8, z: Math.sin(a) * 0.22, sy: 1.4 }));
    }
    M.tuft = pack(list);
  }

  // زهرة
  {
    const list = [];
    merge(list, cyl(0.025, 0.03, 0.45, 4, 0x5c9a3f));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      merge(list, sphere(0.09, 0xf8668d, { x: Math.cos(a) * 0.12, y: 0.5, z: Math.sin(a) * 0.12 }));
    }
    merge(list, sphere(0.07, 0xffd75e, { y: 0.52 }));
    M.flowerA = pack(list);
  }

  // صخرة كبيرة / صغيرة
  M.rockA = pack([
    ico(0.95, STONE, { sy: 0.85, detail: 0 }),
    ico(0.6, 0x8b8f96, { x: 0.7, z: 0.35, sy: 0.7 }),
    ico(0.5, STONE_D, { x: -0.6, z: -0.4, sy: 0.8 }),
  ]);
  M.rockB = pack([ico(0.62, STONE, { sy: 0.9 }), ico(0.4, STONE_D, { x: 0.45, z: 0.2 })]);
  M.pebble = pack([ico(0.24, STONE, { sy: 0.75 })]);

  // قصب
  {
    const list = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.16, z = Math.sin(a) * 0.16;
      merge(list, cyl(0.02, 0.035, 1.05, 4, 0x7fa64a, { x, z, rz: Math.cos(a) * 0.18, rx: -Math.sin(a) * 0.18 }));
      merge(list, sphere(0.07, 0x8a6b3c, { x: x * 1.4, y: 1.1, z: z * 1.4, sy: 2 }));
    }
    M.reeds = pack(list);
  }

  // نار المخيم (الحطب والحيط)
  {
    const list = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      merge(list, ico(0.2, STONE, { x: Math.cos(a) * 0.62, y: 0.08, z: Math.sin(a) * 0.62, sy: 0.8 }));
    }
    merge(list, cyl(0.08, 0.1, 1.0, 5, WOOD_D, { rx: Math.PI / 2, rz: 0.5, y: 0.15 }));
    merge(list, cyl(0.08, 0.1, 1.0, 5, 0x4a3220, { rx: Math.PI / 2, rz: -0.5, y: 0.15 }));
    M.campfire = pack(list);
  }

  // كوخ
  {
    const list = [];
    merge(list, box(3.1, 2.1, 2.4, 0xb58a55, { y: 1.05 }));
    merge(list, box(3.3, 0.18, 2.6, WOOD_D, { y: 2.16 }));
    const roof = cone(2.85, 1.7, 4, 0xc9a24f, { y: 2.95, ry: Math.PI / 4 });
    merge(list, roof);
    merge(list, box(0.8, 1.5, 0.14, 0x6b4826, { y: 0.75, z: 1.24 }));
    merge(list, box(0.66, 1.36, 0.1, 0xc9a06a, { y: 0.72, z: 1.3 }));
    merge(list, box(0.5, 0.5, 0.12, 0x4d5c66, { x: 1.0, y: 1.45, z: 1.22 }));
    merge(list, ico(0.1, 0xe2c58f, { x: 0.28, y: 0.75, z: 1.36 }));
    M.hut = pack(list);
  }

  // قفص الدجاج
  {
    const list = [];
    merge(list, box(1.9, 0.12, 1.5, WOOD_L, { y: 0.06 }));
    for (const [x, z] of [[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]])
      merge(list, box(0.12, 1.0, 0.12, WOOD_L, { x, y: 0.56, z }));
    merge(list, box(2.0, 0.14, 1.6, WOOD_L, { y: 1.12 }));
    merge(list, cone(1.35, 0.7, 4, 0xb3823c, { y: 1.55, ry: Math.PI / 4, sy: 0.9 }));
    // سياج خفيف
    for (let i = -2; i <= 2; i++) {
      merge(list, cyl(0.045, 0.05, 0.55, 4, WOOD_D, { x: i * 0.38 - 0.0, z: 0.78, y: 0.28 }));
    }
    merge(list, box(1.9, 0.06, 0.06, WOOD_D, { y: 0.45, z: 0.78 }));
    // عش
    merge(list, cyl(0.5, 0.42, 0.12, 8, 0xe8c66a, { x: -0.2, z: -0.25, y: 0.2 }));
    M.coop = pack(list);
  }

  // طابلة الخدمة
  {
    const list = [];
    merge(list, box(1.7, 0.12, 0.9, 0xa5733f, { y: 0.95 }));
    for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]])
      merge(list, box(0.12, 0.9, 0.12, 0x7a5230, { x, y: 0.45, z }));
    merge(list, box(1.6, 0.08, 0.5, WOOD_L, { y: 1.6, z: -0.35 }));
    merge(list, box(0.12, 0.55, 0.12, WOOD_L, { x: -0.6, y: 1.3, z: -0.35 }));
    merge(list, box(0.12, 0.55, 0.12, WOOD_L, { x: 0.6, y: 1.3, z: -0.35 }));
    // أدوات فوق الطابلة
    merge(list, box(0.5, 0.06, 0.2, STONE, { x: 0.4, y: 1.04, z: 0.15, ry: 0.3 }));
    merge(list, cyl(0.04, 0.04, 0.4, 5, WOOD_D, { x: 0.4, y: 1.15, z: 0.15, rz: 1.1 }));
    M.bench = pack(list);
  }

  // جذع مقطوع
  M.stump = pack([cyl(0.3, 0.34, 0.45, 6, WOOD), cyl(0.28, 0.28, 0.03, 6, WOOD_L, { y: 0.46 })]);
  // شتلة
  M.sprout = pack([cyl(0.03, 0.05, 0.3, 4, 0x4f9a45), sphere(0.16, 0x63b04f, { y: 0.36, sy: 0.6 })]);

  return M;
}

// ============================================================
//  الحيوانات والناس
// ============================================================
function limb(w, h, d, hex, y, x = 0, z = 0) {
  const g = box(w, h, d, hex, { y: -h / 2 });
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(g, MAT);
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

export function buildPlayer() {
  const root = new THREE.Group();
  const parts = {};

  parts.legL = limb(0.17, 0.55, 0.17, 0x3b5b8c, 0.55, -0.13);
  parts.legR = limb(0.17, 0.55, 0.17, 0x3b5b8c, 0.55, 0.13);
  root.add(parts.legL, parts.legR);

  const torso = new THREE.Mesh(pack([
    box(0.52, 0.5, 0.3, 0xe2564a, { y: 0.82 }),
    box(0.54, 0.16, 0.32, 0x2f4a75, { y: 0.6 }),
  ]), MAT);
  torso.castShadow = true;
  root.add(torso);

  parts.armL = limb(0.13, 0.46, 0.13, 0xf0c090, 1.02, -0.32);
  parts.armR = limb(0.13, 0.46, 0.13, 0xf0c090, 1.02, 0.32);
  root.add(parts.armL, parts.armR);

  const head = new THREE.Group();
  head.position.y = 1.11;
  const headMesh = new THREE.Mesh(pack([
    sphere(0.21, 0xf0c090, { y: 0.16, seg: 10, seg2: 8 }),
    box(0.06, 0.06, 0.06, 0x241a12, { x: 0.09, y: 0.2, z: 0.17 }),
    box(0.06, 0.06, 0.06, 0x241a12, { x: -0.09, y: 0.2, z: 0.17 }),
    // القبعة
    cyl(0.24, 0.24, 0.04, 10, 0xc98b3f, { y: 0.3 }),
    cyl(0.15, 0.16, 0.14, 10, 0xc98b3f, { y: 0.38 }),
  ]), MAT);
  headMesh.castShadow = true;
  head.add(headMesh);
  parts.head = head;
  root.add(head);

  // الأداة فال يد
  const axe = new THREE.Group();
  const axeBody = pack([
    cyl(0.035, 0.035, 0.75, 5, WOOD, { y: 0.34 }),
    box(0.3, 0.16, 0.06, 0xc9ccd2, { y: 0.68, x: 0.1 }),
  ]);
  const axeMesh = new THREE.Mesh(axeBody, MAT);
  axeMesh.castShadow = true;
  axe.add(axeMesh);

  const pick = new THREE.Group();
  const pickMesh = new THREE.Mesh(pack([
    cyl(0.035, 0.035, 0.72, 5, WOOD, { y: 0.32 }),
    box(0.5, 0.07, 0.07, 0xb9bcc2, { y: 0.66, rz: 0.25 }),
    box(0.07, 0.07, 0.3, 0xb9bcc2, { y: 0.64, z: 0.02, rz: 0.25 }),
  ]), MAT);
  pickMesh.castShadow = true;
  pick.add(pickMesh);

  parts.axe = axe;
  parts.pick = pick;
  parts.armR.add(axe, pick);
  axe.rotation.x = -0.5; pick.rotation.x = -0.5;

  return { root, parts, height: 1.55 };
}

export function buildChicken(variant) {
  const root = new THREE.Group();
  const parts = {};
  root.name = 'chicken';
  const body = variant ? 0xf3e9d2 : 0xfbf6ea;
  const bodyGeo = pack([
    sphere(0.3, body, { y: 0.42, sx: 1.15, sy: 1.0, sz: 1.0, seg: 9, seg2: 7 }),
    sphere(0.17, body, { y: 0.62, x: 0.22, z: 0, seg: 8, seg2: 6 }),          // راس
    cone(0.07, 0.16, 5, 0xf2a13c, { y: 0.6, x: 0.36, z: 0, rz: -Math.PI / 2 }), // منقار
    sphere(0.07, 0xe0453f, { y: 0.76, x: 0.22, z: 0, sy: 0.8 }),
    sphere(0.05, 0xe0453f, { y: 0.66, x: 0.3, z: 0.02 }),
    cone(0.2, 0.34, 5, body, { y: 0.5, x: -0.26, z: 0, rz: Math.PI / 2.2 }),   // ديل
    box(0.05, 0.05, 0.06, 0x241a12, { x: 0.34, y: 0.65, z: 0.08 }),
    box(0.05, 0.05, 0.06, 0x241a12, { x: 0.34, y: 0.65, z: -0.08 }),
  ]);
  const bodyMesh = new THREE.Mesh(bodyGeo, MAT);
  bodyMesh.castShadow = true;
  parts.body = new THREE.Group();
  parts.body.add(bodyMesh);
  root.add(parts.body);

  parts.legL = limb(0.06, 0.26, 0.06, 0xe0a13c, 0.3, -0.1); parts.legL.name = 'legL';
  parts.legR = limb(0.06, 0.26, 0.06, 0xe0a13c, 0.3, 0.1); parts.legR.name = 'legR';
  parts.body.name = 'body';
  root.add(parts.legL, parts.legR);
  return { root, parts, height: 0.85 };
}

export function buildGoat() {
  const root = new THREE.Group();
  const parts = {};
  const hoof = 0xdad2bf, skin = 0xf0e6d2;
  const bodyGeo = pack([
    sphere(0.45, skin, { y: 0.72, sx: 1.35, sy: 0.95, sz: 1.0, seg: 9, seg2: 7 }),
    sphere(0.24, 0xf6efe0, { x: 0.62, y: 0.98, seg: 8, seg2: 6 }),
    cone(0.06, 0.36, 5, 0xc9bda1, { x: 0.58, y: 1.22, rz: -0.5 }),
    cone(0.06, 0.36, 5, 0xc9bda1, { x: 0.72, y: 1.2, rz: 0.3 }),
    sphere(0.07, 0x241a12, { x: 0.82, y: 0.96 }),
    sphere(0.2, skin, { x: -0.62, y: 0.86, sy: 0.7 }),  // ديل
  ]);
  parts.body = new THREE.Group();
  const bm = new THREE.Mesh(bodyGeo, MAT);
  bm.castShadow = true;
  parts.body.add(bm);
  root.add(parts.body);
  parts.legL = limb(0.12, 0.62, 0.12, hoof, 0.66, -0.34, 0.16); parts.legL.name = 'legL';
  parts.legR = limb(0.12, 0.62, 0.12, hoof, 0.66, 0.34, 0.16); parts.legR.name = 'legR';
  parts.legL2 = limb(0.12, 0.62, 0.12, hoof, 0.66, -0.34, -0.16); parts.legL2.name = 'legL2';
  parts.legR2 = limb(0.12, 0.62, 0.12, hoof, 0.66, 0.34, -0.16); parts.legR2.name = 'legR2';
  parts.body.name = 'body';
  root.add(parts.legL, parts.legR, parts.legL2, parts.legR2);
  return { root, parts, height: 1.3 };
}

export function buildBoar() {
  const root = new THREE.Group();
  const parts = {};
  const skin = 0x6b5340, skinL = 0x7a6150;
  const bodyGeo = pack([
    sphere(0.52, skin, { y: 0.66, sx: 1.4, sy: 0.95, sz: 1.05, seg: 9, seg2: 7 }),
    sphere(0.3, skinL, { x: 0.72, y: 0.6, seg: 8, seg2: 6 }),
    cone(0.11, 0.2, 5, 0x9c8370, { x: 1.0, y: 0.56, rz: -Math.PI / 2 }),
    cone(0.05, 0.18, 4, 0xf3ecdc, { x: 0.92, y: 0.42, rz: -0.9 }),
    cone(0.05, 0.18, 4, 0xf3ecdc, { x: 0.92, y: 0.66, rz: -2.2 }),
    sphere(0.06, 0x241a12, { x: 0.9, y: 0.68 }),
    cone(0.1, 0.22, 4, 0x3d2f22, { x: -0.7, y: 0.78, rz: 2.4 }),
  ]);
  for (let i = -2; i <= 2; i++) {
    bodyGeo.attributes.position.array[0] = bodyGeo.attributes.position.array[0]; // لا شي — الشعر كيتزاد تحت
  }
  parts.body = new THREE.Group();
  const bm = new THREE.Mesh(bodyGeo, MAT);
  bm.castShadow = true;
  parts.body.add(bm);
  root.add(parts.body);
  parts.legL = limb(0.15, 0.5, 0.15, 0x4a3a2c, 0.58, -0.4, 0.2); parts.legL.name = 'legL';
  parts.legR = limb(0.15, 0.5, 0.15, 0x4a3a2c, 0.58, 0.4, 0.2); parts.legR.name = 'legR';
  parts.legL2 = limb(0.15, 0.5, 0.15, 0x4a3a2c, 0.58, -0.4, -0.2); parts.legL2.name = 'legL2';
  parts.legR2 = limb(0.15, 0.5, 0.15, 0x4a3a2c, 0.58, 0.4, -0.2); parts.legR2.name = 'legR2';
  parts.body.name = 'body';
  root.add(parts.legL, parts.legR, parts.legL2, parts.legR2);
  return { root, parts, height: 1.15 };
}

export function buildCrab() {
  const root = new THREE.Group();
  const parts = {};
  const red = 0xd8452f;
  const bodyMesh = new THREE.Mesh(pack([
    sphere(0.26, red, { y: 0.22, sx: 1.3, sy: 0.72, seg: 9, seg2: 6 }),
    sphere(0.09, 0xe8624a, { y: 0.36, x: 0.12 }),
    sphere(0.09, 0xe8624a, { y: 0.36, x: -0.12 }),
    box(0.05, 0.05, 0.05, 0x241a12, { y: 0.4, x: 0.13, z: 0.07 }),
    box(0.05, 0.05, 0.05, 0x241a12, { y: 0.4, x: -0.13, z: 0.07 }),
  ]), MAT);
  parts.body = new THREE.Group();
  parts.body.add(bodyMesh);
  root.add(parts.body);
  parts.clawL = limb(0.14, 0.24, 0.16, red, 0.28, -0.34, 0.2); parts.clawL.name = 'clawL';
  parts.clawR = limb(0.14, 0.24, 0.16, red, 0.28, 0.34, 0.2); parts.clawR.name = 'clawR';
  parts.legL = limb(0.06, 0.22, 0.06, red, 0.26, -0.3, -0.1); parts.legL.name = 'legL';
  parts.legR = limb(0.06, 0.22, 0.06, red, 0.26, 0.3, -0.1); parts.legR.name = 'legR';
  parts.body.name = 'body';
  root.add(parts.clawL, parts.clawR, parts.legL, parts.legR);
  return { root, parts, height: 0.45 };
}

// ============================================================
//  القارب (كيتبنى على مراحل)
// ============================================================
export function buildBoat() {
  const root = new THREE.Group();
  const g = {};
  const hull = () => {
    const list = [];
    // بدن على شكل قارب: صناديق مائلة
    merge(list, box(2.3, 0.7, 3.8, WOOD, { y: 0.35 }));
    merge(list, box(2.6, 0.4, 1.0, WOOD_L, { y: 0.75, z: -1.3 }));
    merge(list, box(2.6, 0.4, 1.0, WOOD_L, { y: 0.75, z: 1.3 }));
    merge(list, box(0.5, 0.4, 3.2, WOOD_L, { y: 0.75, x: 1.05 }));
    merge(list, box(0.5, 0.4, 3.2, WOOD_L, { y: 0.75, x: -1.05 }));
    merge(list, box(0.9, 0.5, 1.1, WOOD_D, { y: 1.1, z: -1.9 }));   // المقدمة
    return pack(list);
  };
  g.hull = new THREE.Group();
  const hullMesh = new THREE.Mesh(hull(), MAT);
  hullMesh.castShadow = true;
  g.hull.add(hullMesh);
  root.add(g.hull);

  g.mast = new THREE.Group();
  const mastMesh = new THREE.Mesh(pack([
    cyl(0.09, 0.11, 4.2, 6, WOOD_D, { y: 2.1 }),
    box(0.15, 0.15, 2.6, WOOD_D, { y: 2.2, rz: Math.PI / 2 }),
  ]), MAT);
  mastMesh.castShadow = true;
  g.mast.add(mastMesh);
  g.mast.visible = false;
  root.add(g.mast);

  g.ropes = new THREE.Group();
  const ropeMesh = new THREE.Mesh(pack([
    cyl(0.03, 0.03, 4.4, 4, 0xd8c08a, { x: 1.6, y: 1.6, rz: 0.42 }),
    cyl(0.03, 0.03, 4.4, 4, 0xd8c08a, { x: -1.6, y: 1.6, rz: -0.42 }),
  ]), MAT);
  g.ropes.add(ropeMesh);
  g.ropes.visible = false;
  root.add(g.ropes);

  g.sail = new THREE.Group();
  const sailMesh = new THREE.Mesh(pack([
    box(0.12, 2.6, 2.4, 0xf6f1e2, { x: 0.1, y: 2.4, z: 0.6 }),
    box(0.14, 0.5, 0.6, 0x2f8f3f, { y: 3.8, z: 0.1 }),
  ]), MAT);
  sailMesh.castShadow = true;
  g.sail.add(sailMesh);
  g.sail.visible = false;
  root.add(g.sail);

  return { root, parts: g };
}
