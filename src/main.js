import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { createShowroom } from './showroom.js';
import { loadCar, updateCar } from './car.js';
import { initUI } from './ui.js';
import { EngineAudio } from './engine.js';

const BASE = import.meta.env.BASE_URL;

/* ================================================================
   Renderer / scene / camera
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
window.__scene = scene; // debug hook used by scripts/shot.mjs

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 140);
camera.position.set(4.4, 1.45, -4.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.8;
controls.maxDistance = 11;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.target.set(0, 0.55, 0);
controls.autoRotateSpeed = 0.9;
controls.update();

/* ================================================================
   Loading manager + loader UI
   ================================================================ */
const manager = new THREE.LoadingManager();
const loaderEl = document.getElementById('loader');
const fillEl = document.getElementById('loader-fill');
const pctEl = document.getElementById('loader-pct');
const tipEl = document.getElementById('loader-tip');

const TIPS = [
  'Calibrating paint booth…',
  'Polishing the clear coat…',
  'Waking up the V8…',
  'Charging the LEDs…',
  'Inflating Pirellis…',
  'Focusing the studio lights…'
];
let tipIdx = 0;
const tipTimer = setInterval(() => {
  tipIdx = (tipIdx + 1) % TIPS.length;
  if (tipEl) tipEl.textContent = TIPS[tipIdx];
}, 1400);

manager.onProgress = (_url, loaded, total) => {
  const pct = total ? Math.round((loaded / total) * 100) : 100;
  fillEl.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;
};

let revealed = false;
manager.onLoad = () => {
  if (revealed) return;
  revealed = true;
  clearInterval(tipTimer);
  fillEl.style.width = '100%';
  pctEl.textContent = '100%';
  setTimeout(() => {
    loaderEl.classList.add('done');
    ui.reveal();
  }, 450);
};

/* ================================================================
   Showroom + environment + car
   ================================================================ */
const showroom = createShowroom(scene, renderer);
const carState = loadCar(manager, scene);
const engine = new EngineAudio();

// HDR studio environment for realistic paint reflections.
// NOTE: three.js only honors per-material envMapIntensity when the material
// carries its own envMap — so the floor (and paint) get the PMREM assigned
// explicitly, otherwise the dark floor would receive the full-bright IBL.
new HDRLoader(manager).load(`${BASE}hdri/studio.hdr`, (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(hdr);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.8;
  showroom.floorMaterial.envMap = envRT.texture;
  showroom.floorMaterial.envMapIntensity = 0.0;
  showroom.floorMaterial.needsUpdate = true;
  if (carState.paintMat) {
    carState.paintMat.envMap = envRT.texture;
    carState.paintMat.envMapIntensity = 0.85;
    carState.paintMat.needsUpdate = true;
  }
  hdr.dispose();
  pmrem.dispose();
});

/* ================================================================
   Post-processing — bloom + vignette/grain
   ================================================================ */
const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  samples: 4
});
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4, // strength
  0.6, // radius
  0.92 // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      // vignette
      float d = distance(vUv, vec2(0.5, 0.46));
      float vig = smoothstep(0.92, 0.32, d);
      col.rgb *= mix(0.62, 1.04, vig);
      // film grain
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 43.0);
      col.rgb += (g - 0.5) * 0.032;
      gl_FragColor = col;
    }
  `
};
const cinematicPass = new ShaderPass(CinematicShader);
composer.addPass(cinematicPass);

window.__bloom = bloom; // debug hook used by scripts/*.mjs

/* ================================================================
   Camera views
   ================================================================ */
const VIEWS = [
  { name: 'HERO', pos: new THREE.Vector3(4.4, 1.45, -4.6), target: new THREE.Vector3(0, 0.55, 0) },
  { name: 'FRONT', pos: new THREE.Vector3(0, 1.0, -6.4), target: new THREE.Vector3(0, 0.62, -0.4) },
  { name: 'SIDE', pos: new THREE.Vector3(6.6, 0.95, 0.25), target: new THREE.Vector3(0, 0.6, 0) },
  { name: 'REAR', pos: new THREE.Vector3(-1.1, 1.4, 6.3), target: new THREE.Vector3(0, 0.7, 0.6) },
  { name: 'TOP', pos: new THREE.Vector3(0.2, 7.2, 0.5), target: new THREE.Vector3(0, 0, 0) }
];
let viewIdx = 0;
const tween = { active: false, t: 0, dur: 1.25, fromP: new THREE.Vector3(), fromT: new THREE.Vector3() };

function goToView(idx) {
  const v = VIEWS[idx];
  tween.active = true;
  tween.t = 0;
  tween.fromP.copy(camera.position);
  tween.fromT.copy(controls.target);
  controls.enabled = false;
}
function cycleView() {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  goToView(viewIdx);
  return VIEWS[viewIdx].name;
}
controls.addEventListener('start', () => {
  tween.active = false;
  controls.enabled = true;
});

/* ================================================================
   Drive state
   ================================================================ */
const drive = { on: false, speed01: 0 };
let turntable = false;

const ui = initUI(carState, {
  cycleView,
  toggleTurntable: () => {
    turntable = !turntable;
    controls.autoRotate = turntable;
    return turntable;
  },
  onIgnite: (on) => {
    drive.on = on;
    if (on && turntable) {
      turntable = false;
      controls.autoRotate = false;
      document.getElementById('btn-turntable').classList.remove('active');
    }
  },
  engine
});

const GEARS = [
  [0, 58],
  [58, 102],
  [102, 148],
  [148, 196],
  [196, 252],
  [252, 335]
];

function computeGears(kmh) {
  let gear = 1;
  for (let i = 0; i < GEARS.length; i++) {
    if (kmh >= GEARS[i][0] && kmh < GEARS[i][1]) {
      gear = i + 1;
      break;
    }
    if (kmh >= GEARS[i][1]) gear = i + 1;
  }
  const [lo, hi] = GEARS[Math.min(gear, GEARS.length) - 1];
  const within = THREE.MathUtils.clamp((kmh - lo) / (hi - lo), 0, 1);
  return { gear, rpm01: 0.16 + 0.84 * within };
}

/* ================================================================
   Main loop
   ================================================================ */
const clock = new THREE.Timer();
let shakeT = 0;

function easeInOut(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

renderer.setAnimationLoop(() => {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsed();

  // ----- speed envelope -----
  const target = drive.on ? 1 : 0;
  const lambda = drive.on ? 1.5 : 2.4;
  drive.speed01 = THREE.MathUtils.damp(drive.speed01, target, lambda, dt);
  if (drive.speed01 < 0.001) drive.speed01 = 0;

  // ----- camera tween -----
  if (tween.active) {
    tween.t += dt / tween.dur;
    const k = easeInOut(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.fromP, VIEWS[viewIdx].pos, k);
    controls.target.lerpVectors(tween.fromT, VIEWS[viewIdx].target, k);
    if (tween.t >= 1) {
      tween.active = false;
      controls.enabled = true;
    }
  }

  controls.update();

  // ----- drive fx: shake + fov + engine vibration -----
  const sp = drive.speed01;
  if (sp > 0.01) {
    shakeT += dt * (18 + sp * 26);
    const amp = 0.011 * sp;
    camera.position.x += Math.sin(shakeT * 3.1) * amp;
    camera.position.y += Math.sin(shakeT * 4.7 + 1.3) * amp * 0.7;
  }
  const wantFov = 40 + sp * 7;
  if (Math.abs(camera.fov - wantFov) > 0.01) {
    camera.fov = THREE.MathUtils.damp(camera.fov, wantFov, 4, dt);
    camera.updateProjectionMatrix();
  }

  if (carState.car) {
    carState.car.position.y = Math.sin(t * 64) * 0.004 * sp;
  }

  // ----- car + showroom + audio -----
  updateCar(carState, dt, { speed01: sp });
  showroom.update(dt, { speed01: sp });

  const kmh = sp * 320;
  const { gear, rpm01 } = computeGears(kmh);
  ui.setHUD(kmh, sp > 0 ? rpm01 : 0, drive.on ? gear : 0);
  engine.update(sp > 0 ? rpm01 : 0, sp);

  cinematicPass.uniforms.uTime.value = t;
  composer.render();
});

/* ================================================================
   Resize
   ================================================================ */
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});
