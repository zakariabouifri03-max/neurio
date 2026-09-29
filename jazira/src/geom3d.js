// أدوات هندسية للأشكال 3D — geom3d.js
import * as THREE from '../../vendor/three.module.js';

const _c = new THREE.Color();

// كيلوّن هندسة بلون (vertex colors)
export function tint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// دمج عدة هندسات فوحدة (كولشي non-indexed)
export function merge(target, geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.color) tint(g, 0xffffff);
  if (!g.attributes.normal) g.computeVertexNormals();
  target.push(g);
  return target;
}

export function pack(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array;
    pos.set(p, o * 3); nor.set(n, o * 3); col.set(c, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  for (const g of list) g.dispose();
  return out;
}

// ---------- أشكال أساسية ----------
// كل شي كيرجع هندسة فلبلاصة (0,0,0) = وسط القاعدة

export function box(w, h, d, hex, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  tint(g, hex);
  g.translate(o.x || 0, (o.y ?? h / 2), o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

export function cyl(rt, rb, h, seg, hex, o = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  tint(g, hex);
  g.translate(o.x || 0, (o.y ?? h / 2), o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

export function cone(r, h, seg, hex, o = {}) {
  const g = new THREE.ConeGeometry(r, h, seg);
  tint(g, hex);
  g.translate(o.x || 0, (o.y ?? h / 2), o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

export function sphere(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, o.seg || 8, o.seg2 || 6);
  tint(g, hex);
  if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1);
  g.translate(o.x || 0, o.y ?? r, o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

export function ico(r, hex, o = {}) {
  const g = new THREE.IcosahedronGeometry(r, o.detail || 0);
  tint(g, hex);
  if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1);
  g.translate(o.x || 0, o.y ?? r, o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

// ورقة نخلة (مسطحة منحنية)
export function frond(len, w, hex, o = {}) {
  const g = new THREE.PlaneGeometry(len, w, 6, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const t = (x + len / 2) / len;         // 0..1 من الأساس
    p.setZ(i, -Math.pow(t, 2) * len * 0.42); // تنحية للأسفل
    p.setY(i, y * (1 - t * 0.75));          // كترقّ
  }
  g.computeVertexNormals();
  tint(g, hex);
  g.rotateX(Math.PI / 2);
  g.translate(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx) g.rotateX(o.rx);
  if (o.ry) g.rotateY(o.ry);
  if (o.rz) g.rotateZ(o.rz);
  return g;
}

// جذع منحني شوية
export function curvedTrunk(h, r0, r1, hex, bend = 0) {
  const parts = [];
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const rA = r0 + (r1 - r0) * t0, rB = r0 + (r1 - r0) * t1;
    const g = new THREE.CylinderGeometry(rB, rA, h / seg, 6);
    tint(g, hex);
    const bx = Math.sin(t0 * Math.PI * 0.5) * bend;
    g.translate(bx, h * (t0 + t1) / 2, 0);
    g.rotateZ(-bend * 0.12 * t0);
    parts.push(g);
  }
  return pack(parts);
}

// ---------- رسم بالقياسات ----------
export function scaleGeo(g, sx, sy, sz) { g.scale(sx, sy, sz); return g; }

export function rotGeo(g, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g;
}

export function moveGeo(g, x = 0, y = 0, z = 0) { g.translate(x, y, z); return g; }
