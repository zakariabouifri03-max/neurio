/* ═══════════════════════════════════════════════════════════════
   برج إيفل · Tour Eiffel 3D — procedural Three.js model
   Real proportions: base 124.9 m · floors 57.6 / 115.7 / 276.1 · 330 m
   ═══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------- ثوابت حقيقية (بالأمتار) ---------------- */
const H1 = 57.6;    // الطابق الأول
const H2 = 115.7;   // الطابق الثاني
const H3 = 276.1;   // الطابق الثالث
const H_TOP = 300;  // أعلى منصة
const H_MAX = 330;  // قمة الهوائي
const STEP = 6.9;   // ارتفاع خلية الشبكة

/* منحنى جانب البرج: نصف عرض المربع عند الارتفاع y */
const w = (y) => 3.0 + 59.5 * Math.exp(-y / 78);

/* سماكة العناصر الحديدية تتقلص مع الارتفاع */
const legR   = (y) => Math.max(0.30, 2.30 * Math.exp(-y / 90));
const beamR  = (y) => Math.max(0.20, 1.35 * Math.exp(-y / 90));
const braceR = (y) => Math.max(0.14, 0.70 * Math.exp(-y / 90));

/* ---------------- Renderer / Scene / Camera ---------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe2f0, 600, 3200);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 12000);
camera.position.set(325, 190, 325);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 126, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 70;
controls.maxDistance = 1600;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.7;

/* ---------------- السماء (قبة متدرجة) ---------------- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    uTop:    { value: new THREE.Color(0x6db3e8) },
    uBottom: { value: new THREE.Color(0xdfeef9) },
  },
  vertexShader: /* glsl */`
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uTop; uniform vec3 uBottom;
    varying vec3 vPos;
    void main() {
      float h = clamp(vPos.y / 5000.0, -1.0, 1.0) * 0.5 + 0.5;
      gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 1.15)), 1.0);
    }`,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat));

/* ---------------- الأرض ---------------- */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x86a066, roughness: 1.0, metalness: 0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(3400, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* --- ساحة تحت البرج (Champ-de-Mars) --- */
const plazaMat = new THREE.MeshStandardMaterial({ color: 0xa79b82, roughness: 1.0, metalness: 0 });
const plaza = new THREE.Mesh(new THREE.CircleGeometry(155, 64), plazaMat);
plaza.rotation.x = -Math.PI / 2;
plaza.position.y = 0.08;
plaza.receiveShadow = true;
scene.add(plaza);

/* ---------------- الإضاءة ---------------- */
const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x8f7f5c, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffedd0, 2.4);
sun.position.set(500, 620, 300);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -430; sun.shadow.camera.right = 430;
sun.shadow.camera.top = 430;   sun.shadow.camera.bottom = -430;
sun.shadow.camera.near = 200;  sun.shadow.camera.far = 1800;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 1.5;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xbdd0ff, 0.35);
fill.position.set(-400, 300, -350);
scene.add(fill);

/* ═══════════════ بناء الهيكل الحديدي ═══════════════ */
const ironGeoms = [];

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** قضيب بين نقطتين — p1 قاعدة, p2 قمة */
function strut(p1, p2, r1, r2, seg = 6) {
  _dir.subVectors(p2, p1);
  const len = _dir.length();
  if (len < 0.05) return;
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _dir.normalize());
  g.applyQuaternion(_q);
  g.translate(p1.x, p1.y, p1.z);
  ironGeoms.push(g);
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const CORNERS = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // ترتيب دائري

/* --- مستويات الشبكة --- */
const levels = [];
for (let y = 0; y < H3 - 0.001; y += STEP) levels.push(y);
levels.push(H3);

/* --- الأعمدة الأربعة الرئيسية --- */
for (let i = 0; i < levels.length - 1; i++) {
  const y1 = levels[i], y2 = levels[i + 1];
  for (const [cx, cz] of CORNERS) {
    strut(V3(cx * w(y1), y1, cz * w(y1)), V3(cx * w(y2), y2, cz * w(y2)), legR(y1), legR(y2), 8);
  }
}

/* --- حلقات أفقية كل نصف خلية + مقطعيات X + عمودي وسطي --- */
for (let i = 0; i < levels.length - 1; i++) {
  const y1 = levels[i], y2 = levels[i + 1];
  const ym = (y1 + y2) / 2;

  // الحلقات (كاملة + نصفية)
  for (const y of [y1, ym]) {
    const r = beamR(y) * 0.8;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = CORNERS[k];
      const [bx, bz] = CORNERS[(k + 1) % 4];
      strut(V3(ax * w(y), y, az * w(y)), V3(bx * w(y), y, bz * w(y)), r, r);
    }
  }

  // 4 وجوه: مقطعيات X + عارضة وسطى + عموديان وسطيان
  const rb = braceR(y1);
  const faces = [
    (s) => [V3(w(s), s, w(s)), V3(w(s), s, -w(s))],   // face x+
    (s) => [V3(-w(s), s, -w(s)), V3(-w(s), s, w(s))], // face x-
    (s) => [V3(-w(s), s, w(s)), V3(w(s), s, w(s))],   // face z+
    (s) => [V3(w(s), s, -w(s)), V3(-w(s), s, -w(s))], // face z-
  ];
  for (const face of faces) {
    const [a1, b1] = face(y1);
    const [a2, b2] = face(y2);
    strut(a1, b2, rb, rb * 0.85);   // X
    strut(b1, a2, rb, rb * 0.85);
    const am = face(ym)[0], bm = face(ym)[1];
    strut(am, bm, rb * 0.7, rb * 0.7);              // عارضة وسطى
    strut(V3((a1.x + b1.x) / 2, y1, (a1.z + b1.z) / 2),
          V3((am.x + bm.x) / 2, ym, (am.z + bm.z) / 2),
          rb * 0.55, rb * 0.55);                    // عمودي وسطي (نصف سفلي)
    strut(V3((a2.x + b2.x) / 2, y2, (a2.z + b2.z) / 2),
          V3((am.x + bm.x) / 2, ym, (am.z + bm.z) / 2),
          rb * 0.55, rb * 0.55);                    // عمودي وسطي (نصف علوي)
  }
}

/* --- القسم العلوي (276 → 300) --- */
for (let y = H3; y < H_TOP - 0.001; y += 4) {
  const y2 = Math.min(y + 4, H_TOP);
  for (const [cx, cz] of CORNERS) {
    strut(V3(cx * w(y), y, cz * w(y)), V3(cx * w(y2), y2, cz * w(y2)), legR(y), legR(y2), 8);
  }
  const r = beamR(y);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = CORNERS[k];
    const [bx, bz] = CORNERS[(k + 1) % 4];
    strut(V3(ax * w(y), y, az * w(y)), V3(bx * w(y), y, bz * w(y)), r * 0.7, r * 0.7);
    strut(V3(ax * w(y), y, az * w(y)), V3(bx * w(y2), y2, bz * w(y2)), braceR(y), braceR(y));
  }
}

/* --- الهوائي --- */
strut(V3(0, H_TOP, 0), V3(0, H_MAX - 1, 0), 0.9, 0.18, 8);
strut(V3(0, H_TOP - 3, 0), V3(0, H_TOP + 2.5, 0), 3.0, 2.4, 10); // كبينة القمة

/* --- الأرجل + قواعد الإسناد --- */
for (const [cx, cz] of CORNERS) {
  const bx = cx * w(0), bz = cz * w(0);
  const g = new THREE.BoxGeometry(11, 3.2, 11);
  g.translate(bx, 1.6, bz);
  ironGeoms.push(g);
}

/* --- الأقواس الشهيرة تحت الطابق الأول --- */
function addArch(axis, sign) {
  const yS = 29;                 // نقطة الانطلاق
  const yTop = H1 - 3.5;         // قمة القوس (تحت المنصة)
  const b = yTop - yS;           // نصف المحور الرأسي
  const a = w(yS + 6) * 0.80;    // نصف المحور الأفقي
  const off = w((yS + yTop) / 2) * 0.90;

  const pts2 = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI).getPoints(48);
  const pts3 = pts2.map((p) => V3(0, p.y, p.x));
  const curve = new THREE.CatmullRomCurve3(pts3);
  const g = new THREE.TubeGeometry(curve, 56, 1.8, 8, false);

  // مركز القوس عند yS
  const m = new THREE.Matrix4();
  if (axis === 'x') { // الوجه في مستوى YZ
    m.makeTranslation(sign * off, yS, 0);
  } else {            // الوجه في مستوى XY
    if (sign > 0) m.makeTranslation(0, yS, off);
    else { m.makeRotationY(Math.PI); m.setPosition(0, yS, -off); }
  }
  g.applyMatrix4(m);
  ironGeoms.push(g);
}
addArch('x', 1); addArch('x', -1); addArch('z', 1); addArch('z', -1);

/* --- المنصات (الطوابق) --- */
function addPlatform(y, extra, thick) {
  const s = 2 * w(y) + extra;
  const g = new THREE.BoxGeometry(s, thick, s);
  g.translate(0, y, 0);
  ironGeoms.push(g);
  // درابزين زجاجي
  const rg = new THREE.BoxGeometry(s + 0.6, 1.3, s + 0.6);
  rg.translate(0, y + thick / 2 + 0.65, 0);
  return rg;
}
const rails = [];
rails.push(addPlatform(H1, 10, 4));
rails.push(addPlatform(H2, 8, 3.5));
rails.push(addPlatform(H3, 6, 3));
rails.push(addPlatform(H_TOP, 4, 2.5));

/* --- دمج كل الحديد في شبكة واحدة --- */
const ironMat = new THREE.MeshStandardMaterial({
  color: 0x9a6f45,
  metalness: 0.8,
  roughness: 0.5,
  emissive: 0xffb35c,
  emissiveIntensity: 0,
});
const tower = new THREE.Mesh(mergeGeometries(ironGeoms), ironMat);
tower.castShadow = true;
tower.receiveShadow = true;
scene.add(tower);

const railMat = new THREE.MeshStandardMaterial({
  color: 0xcfd8e6, metalness: 0.1, roughness: 0.15,
  transparent: true, opacity: 0.35,
});
scene.add(new THREE.Mesh(mergeGeometries(rails), railMat));

/* --- ضوء المنارة الأحمر (تحذير الطيران) --- */
const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 1 });
const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), beaconMat);
beacon.position.set(0, H_MAX + 0.5, 0);
scene.add(beacon);

/* ═══════════════ بريق 20,000 مصباح ═══════════════ */
const SPARKS = 900;
const sPos = new Float32Array(SPARKS * 3);
const sPhase = new Float32Array(SPARKS);
const sSize = new Float32Array(SPARKS);
for (let i = 0; i < SPARKS; i++) {
  const y = 4 + Math.random() * (H_TOP - 8);
  const fw = w(y) * 1.03;
  const t = Math.random() * 2 - 1;
  const face = i % 4;
  let x, z;
  if (face === 0)      { x = t * fw;  z = fw;  }
  else if (face === 1) { x = fw;      z = -t * fw; }
  else if (face === 2) { x = t * fw;  z = -fw; }
  else                 { x = -fw;     z = t * fw; }
  sPos[i * 3] = x + (Math.random() - 0.5) * 2;
  sPos[i * 3 + 1] = y;
  sPos[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
  sPhase[i] = Math.random() * Math.PI * 2;
  sSize[i] = 0.9 + Math.random() * 1.9;
}
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
sparkGeo.setAttribute('aPhase', new THREE.BufferAttribute(sPhase, 1));
sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));

const sparkMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uScale: { value: 1 },
  },
  vertexShader: /* glsl */`
    attribute float aPhase;
    attribute float aSize;
    uniform float uTime;
    uniform float uScale;
    varying float vA;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float tw = sin(uTime * 2.7 + aPhase);
      vA = pow(max(tw, 0.0), 2.2);
      gl_PointSize = aSize * uScale * (620.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uIntensity;
    varying float vA;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.08, d) * vA * uIntensity;
      if (a < 0.01) discard;
      gl_FragColor = vec4(1.0, 0.93, 0.72, a);
    }`,
});
scene.add(new THREE.Points(sparkGeo, sparkMat));

/* ---------------- النجوم ---------------- */
const STARS = 1300;
const stPos = new Float32Array(STARS * 3);
for (let i = 0; i < STARS; i++) {
  const v = new THREE.Vector3().randomDirection();
  v.y = Math.abs(v.y) * 0.95 + 0.05;
  v.normalize().multiplyScalar(3800 + Math.random() * 500);
  stPos[i * 3] = v.x; stPos[i * 3 + 1] = v.y; stPos[i * 3 + 2] = v.z;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
const starMat = new THREE.PointsMaterial({
  color: 0xdfe8ff, size: 2.6, sizeAttenuation: false,
  transparent: true, opacity: 0, depthWrite: false, fog: false,
});
scene.add(new THREE.Points(starGeo, starMat));

/* ═══════════════ الوضع الليلي / النهاري ═══════════════ */
const ENV = {
  day: {
    skyTop: new THREE.Color(0x6db3e8), skyBottom: new THREE.Color(0xdfeef9),
    fog: new THREE.Color(0xcfe2f0), fogNear: 600, fogFar: 3200,
    hemiSky: new THREE.Color(0xcfe5ff), hemiGround: new THREE.Color(0x8f7f5c), hemiI: 0.95,
    sunC: new THREE.Color(0xffedd0), sunI: 2.4, fillI: 0.35,
    ground: new THREE.Color(0x86a066), plaza: new THREE.Color(0xa79b82), emissiveI: 0,
    sparks: 0, stars: 0, exposure: 1.05,
  },
  night: {
    skyTop: new THREE.Color(0x070b26), skyBottom: new THREE.Color(0x232c54),
    fog: new THREE.Color(0x1b2140), fogNear: 420, fogFar: 2500,
    hemiSky: new THREE.Color(0x3a4a80), hemiGround: new THREE.Color(0x1c2038), hemiI: 0.38,
    sunC: new THREE.Color(0x93a7ff), sunI: 0.3, fillI: 0.08,
    ground: new THREE.Color(0x1a2138), plaza: new THREE.Color(0x232a45), emissiveI: 0.38,
    sparks: 1.0, stars: 0.85, exposure: 0.95,
  },
};

let nightK = 0, nightTarget = 0; // 0 = نهار, 1 = ليل
const _c = new THREE.Color();

function applyEnv() {
  const d = ENV.day, n = ENV.night, k = nightK;
  skyMat.uniforms.uTop.value.lerpColors(d.skyTop, n.skyTop, k);
  skyMat.uniforms.uBottom.value.lerpColors(d.skyBottom, n.skyBottom, k);
  scene.fog.color.lerpColors(d.fog, n.fog, k);
  scene.fog.near = d.fogNear + (n.fogNear - d.fogNear) * k;
  scene.fog.far = d.fogFar + (n.fogFar - d.fogFar) * k;
  hemi.color.lerpColors(d.hemiSky, n.hemiSky, k);
  hemi.groundColor.lerpColors(d.hemiGround, n.hemiGround, k);
  hemi.intensity = d.hemiI + (n.hemiI - d.hemiI) * k;
  sun.color.lerpColors(d.sunC, n.sunC, k);
  sun.intensity = d.sunI + (n.sunI - d.sunI) * k;
  fill.intensity = d.fillI + (n.fillI - d.fillI) * k;
  groundMat.color.lerpColors(d.ground, n.ground, k);
  plazaMat.color.lerpColors(d.plaza, n.plaza, k);
  ironMat.emissiveIntensity = d.emissiveI + (n.emissiveI - d.emissiveI) * k;
  sparkMat.uniforms.uIntensity.value = d.sparks + (n.sparks - d.sparks) * k;
  starMat.opacity = d.stars + (n.stars - d.stars) * k;
  renderer.toneMappingExposure = d.exposure + (n.exposure - d.exposure) * k;
}
applyEnv();

/* ═══════════════ واجهة التحكم ═══════════════ */
const btnTheme = document.getElementById('btn-theme');
const btnRotate = document.getElementById('btn-rotate');
const btnFull = document.getElementById('btn-full');

function toggleNight() {
  nightTarget = nightTarget === 1 ? 0 : 1;
  btnTheme.textContent = nightTarget === 1 ? '☀️' : '🌙';
}
btnTheme.addEventListener('click', toggleNight);
window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') toggleNight();
});

let rotateOn = true;
let interacting = false;
let lastEnd = 0;
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; lastEnd = performance.now(); });

btnRotate.addEventListener('click', () => {
  rotateOn = !rotateOn;
  btnRotate.textContent = rotateOn ? '⏸' : '▶';
});

btnFull.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sparkMat.uniforms.uScale.value = renderer.getPixelRatio() * (window.innerHeight / 900);
});
sparkMat.uniforms.uScale.value = renderer.getPixelRatio() * (window.innerHeight / 900);

/* ═══════════════ حلقة الرسم ═══════════════ */
const clock = new THREE.Clock();
let firstFrame = true;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  nightK += (nightTarget - nightK) * Math.min(1, dt * 2.2);
  if (Math.abs(nightTarget - nightK) > 0.0005) applyEnv();

  sparkMat.uniforms.uTime.value = t;
  beaconMat.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.6));
  starMat.size = 2.6 + Math.sin(t * 0.8) * 0.3;

  controls.autoRotate = rotateOn && !interacting && (performance.now() - lastEnd > 2200);
  controls.update();
  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    const loader = document.getElementById('loader');
    setTimeout(() => loader.classList.add('hide'), 350);
  }
}
animate();
