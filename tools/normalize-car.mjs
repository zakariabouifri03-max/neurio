// Offline car-model normalizer (gltf-transform): orient to -Z, scale to real length, put on ground, group wheels as wheel_fl/fr/rl/rr.
// Usage: node tools/normalize-car.mjs <id> <realLengthMeters> [front:+1|-1]   (reads /tmp/out/<id>.glb → /tmp/norm/<id>.glb)
// Deps: npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf gl-matrix
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { mat4, quat, vec3 } from 'gl-matrix';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
const [id, realLen, forceFront] = process.argv.slice(2);
const doc = await io.read(`/tmp/out/${id}.glb`);
const scene = doc.getRoot().listScenes()[0];
const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
const info = meshNodes.map((n) => {
  const bb = getBounds(n); // world, incl. children
  const nm = [n.getName(), n.getMesh().getName(), ...n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName() || '')].join('|');
  return { n, nm, c: bb.min.map((v, i) => (v + bb.max[i]) / 2), s: bb.max.map((v, i) => v - bb.min[i]), bb };
}).filter((m) => m.s.every(Number.isFinite));
// robust overall bounds: median-based outlier rejection
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const cx = med(info.map((m) => m.c[0])), cz = med(info.map((m) => m.c[2]));
const spread = med(info.map((m) => Math.hypot(m.c[0] - cx, m.c[2] - cz))) * 6 + 1e-9;
const core = info.filter((m) => Math.hypot(m.c[0] - cx, m.c[2] - cz) < spread && Math.max(m.s[0], m.s[2]) < spread * 1.2);
const B = { min: [0, 1, 2].map((i) => Math.min(...core.map((m) => m.bb.min[i]))), max: [0, 1, 2].map((i) => Math.max(...core.map((m) => m.bb.max[i]))) };
const ext = B.max.map((v, i) => v - B.min[i]), mid = B.max.map((v, i) => (v + B.min[i]) / 2);
function detect(lenAx) {
  const widAx = 2 - lenAx, L = ext[lenAx];
  const cands = core.filter((m) => {
    const d = Math.max(m.s[1], m.s[lenAx]), round = Math.min(m.s[1], m.s[lenAx]) / d;
    return round > 0.8 && d > 0.09 * L && d < 0.3 * L && m.s[widAx] < 0.65 * d && m.c[1] - B.min[1] < 0.8 * d
      && Math.abs(m.c[widAx] - mid[widAx]) > 0.2 * ext[widAx] && !/calip|susp|steer|pad/i.test(m.nm);
  });
  const q = {};
  for (const k of cands) { const key = (k.c[lenAx] > mid[lenAx] ? 'A' : 'B') + (k.c[widAx] > mid[widAx] ? 'P' : 'N'); (q[key] ||= []).push(k); }
  return { q, n: Object.keys(q).length, cands: cands.length, widAx };
}
let lenAx = ext[0] > ext[2] ? 0 : 2, det = detect(lenAx);
const alt = detect(2 - lenAx); if (alt.n > det.n) { lenAx = 2 - lenAx; det = alt; }
const widAx = det.widAx;
// front direction: +lenAx unless name hints say otherwise
let score = 0;
for (const m of core) {
  const s = Math.sign(m.c[lenAx] - mid[lenAx]);
  if (/head ?light|headlamp|front|bumper_?f|_f_|grill|_lf|_rf|fl_|fr_/i.test(m.nm)) score += s;
  if (/tail|rear|back|trunk|boot|exhaust|_lr|_rr|rl_|rr_/i.test(m.nm)) score -= s;
}
let front = forceFront ? +forceFront : (score >= 0 ? 1 : -1);
// rotation (about Y) mapping front direction → -Z
const fwd = [0, 0, 0]; fwd[lenAx] = front;
const yaw = Math.atan2(-fwd[0], -fwd[2]); // rotate so that fwd → (0,0,-1)
const Rq = quat.setAxisAngle(quat.create(), [0, 1, 0], -yaw);
const scale = +realLen / ext[lenAx];
// wheels
const wheels = {};
if (det.n === 4) for (const key in det.q) {
  const arr = det.q[key]; const tire = arr.reduce((a, b) => (Math.max(a.s[1], a.s[lenAx]) > Math.max(b.s[1], b.s[lenAx]) ? a : b));
  const r = Math.max(tire.s[1], tire.s[lenAx]) / 2;
  const members = core.filter((m) => [0, 1, 2].every((i) => m.bb.min[i] >= tire.bb.min[i] - r * 0.15 && m.bb.max[i] <= tire.bb.max[i] + r * 0.15) && !/calip|susp|pad/i.test(m.nm));
  const isFront = (key[0] === 'A') === (front === 1);
  // side: car left = after rotation x<0. compute rotated x of the center
  const p = vec3.transformQuat(vec3.create(), tire.c, Rq);
  const pm = vec3.transformQuat(vec3.create(), mid, Rq);
  const side = p[0] < pm[0] ? 'l' : 'r';
  wheels[(isFront ? 'f' : 'r') + side] = { c: tire.c, members, r };
}
// build: P (rotate+scale+center) → all old roots
const P = doc.createNode('car_root');
const ctr = mid.slice(); ctr[1] = B.min[1];
if (Object.keys(wheels).length === 4) { const ws = Object.values(wheels); ctr[1] = Math.min(...ws.map((w) => w.c[1] - w.r)); }
const Pm = mat4.fromRotationTranslationScale(mat4.create(), Rq, [0, 0, 0], [scale, scale, scale]);
mat4.multiply(Pm, Pm, mat4.fromTranslation(mat4.create(), ctr.map((v) => -v)));
for (const ch of scene.listChildren()) P.addChild(ch);
scene.addChild(P); P.setMatrix(Pm);
const invR = quat.invert(quat.create(), Rq);
for (const k in wheels) {
  const w = wheels[k];
  const W = doc.createNode('wheel_' + k);
  // W in P-local: translation = c, rotation = inverse(P rotation) so W axes == car axes, scale 1/scale so W is metric
  W.setTranslation(Array.from(w.c)); W.setRotation(Array.from(invR)); W.setScale([1, 1, 1]);
  P.addChild(W);
  const Wlocal = mat4.fromRotationTranslation(mat4.create(), invR, w.c); // in pre-P space
  const invW = mat4.invert(mat4.create(), Wlocal);
  const set = new Set(w.members.map((m) => m.n));
  for (const m of w.members) {
    let a = m.n.getParentNode(), skip = false; while (a) { if (set.has(a)) skip = true; a = a.getParentNode(); }
    if (skip) continue;
    // world (pre-P) matrix: P not applied yet? P is now ancestor → compute world then remove P
    const Mw = m.n.getWorldMatrix();
    const Mpre = mat4.multiply(mat4.create(), mat4.invert(mat4.create(), Pm), Mw);
    const local = mat4.multiply(mat4.create(), invW, Mpre);
    W.addChild(m.n); m.n.setMatrix(Array.from(local));
  }
}
await io.write(`/tmp/norm/${id}.glb`, doc);
console.log(id.padEnd(9), 'lenAx', 'XYZ'[lenAx], 'front', front, 'score', score, 'wheels', Object.keys(wheels).join(','), 'members', Object.values(wheels).map((w) => w.members.length).join('/'), 'ext', ext.map((v) => v.toFixed(3)).join(','), 'core', core.length + '/' + info.length);
