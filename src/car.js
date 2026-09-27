import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js';

const BASE = import.meta.env.BASE_URL;

export const PAINTS = [
  { id: 'rosso', name: 'Rosso Corsa', hex: '#cc0a12' },
  { id: 'giallo', name: 'Giallo Modena', hex: '#f2b705' },
  { id: 'bianco', name: 'Bianco Avus', hex: '#eef0f3' },
  { id: 'nero', name: 'Nero Daytona', hex: '#0b0b0e' },
  { id: 'blu', name: 'Blu Pozzi', hex: '#1140a0' },
  { id: 'verde', name: 'Verde Scuderia', hex: '#0b7a45' },
  { id: 'arancio', name: 'Arancio', hex: '#ff5a1f' },
  { id: 'viola', name: 'Viola Dino', hex: '#5b2d8e' },
  { id: 'argento', name: 'Argento Nürburgring', hex: '#a9adb4' },
  { id: 'rosa', name: 'Rosa Corsa', hex: '#e0559a' }
];

const FINISHES = {
  gloss: { roughness: 0.24, metalness: 0.85, clearcoat: 1.0, clearcoatRoughness: 0.03, iridescence: 0.0 },
  satin: { roughness: 0.58, metalness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.55, iridescence: 0.0 },
  pearl: { roughness: 0.3, metalness: 0.9, clearcoat: 1.0, clearcoatRoughness: 0.06, iridescence: 1.0 }
};

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Loads the Ferrari 458 (Draco GLB) and wires up every material,
 * light and wheel. Returns a small API used by the UI.
 */
export function loadCar(manager, scene) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_GLTF_CONFIG);

  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);

  const state = {
    car: null,
    wheels: [],
    driving: false,
    lightsOn: false,
    paintHex: PAINTS[0].hex,
    finish: 'gloss',
    wheelSpin: 0,
    headlightSpots: [],
    headlightCones: [],
    headGlows: [],
    tailGlows: [],
    paintMat: null,
    projectorMat: null,
    drlMat: null,
    tailMat: null
  };

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(state.paintHex),
    metalness: 0.85,
    roughness: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 0.85 // assigned once the PMREM env exists (see main.js)
  });
  state.paintMat = paintMat;

  const glowTex = makeGlowTexture();

  loader.load(`${BASE}models/ferrari.glb`, (gltf) => {
    const car = gltf.scene.children[0];
    car.name = 'car';

    // ---------- material tuning by GLB material name ----------
    gltf.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const m = obj.material;
      if (!m) return;

      switch (obj.name) {
        case 'body':
          obj.material = paintMat;
          break;
        case 'glass':
          m.metalness = 0.4;
          m.roughness = 0.02;
          m.transparent = true;
          m.opacity = 0.55;
          m.color.set(0x0c1016);
          m.envMapIntensity = 2.0;
          break;
        case 'tire':
          m.roughness = 0.92;
          m.metalness = 0.0;
          m.color.set(0x0a0a0c);
          m.envMapIntensity = 0.35;
          break;
        case 'rim_fl':
        case 'rim_fr':
        case 'rim_rl':
        case 'rim_rr':
          m.color.set(0x3a3f47);
          m.metalness = 1.0;
          m.roughness = 0.3;
          m.envMapIntensity = 1.5;
          break;
        case 'trim':
        case 'grills':
        case 'wipers':
          m.color.set(0x101114);
          m.metalness = 0.9;
          m.roughness = 0.45;
          break;
        case 'chrome':
          m.metalness = 1.0;
          m.roughness = 0.07;
          m.envMapIntensity = 2.2;
          break;
        case 'carbon fibre':
        case 'carbon_fibre_trim':
        case 'steering_carbon':
          m.metalness = 0.6;
          m.roughness = 0.32;
          m.clearcoat !== undefined && (m.clearcoat = 0.8);
          m.color.set(0x12141a);
          break;
        case 'metal':
          m.metalness = 1.0;
          m.roughness = 0.34;
          m.envMapIntensity = 1.4;
          break;
        case 'brakes':
          // rear rain-light strip
          state.tailMat = m;
          m.emissive = new THREE.Color(0xff1020);
          m.emissiveIntensity = 0.8;
          break;
        case 'lights_red':
          if (!state.tailMat) {
            state.tailMat = m;
            m.emissive = new THREE.Color(0xff1020);
            m.emissiveIntensity = 0.8;
          }
          break;
        case 'lights':
          // main projectors
          state.projectorMat = m;
          m.emissive = new THREE.Color(0xdfeaff);
          m.emissiveIntensity = 0.0;
          m.color.set(0x0a0c10);
          m.roughness = 0.05;
          m.metalness = 0.4;
          break;
        case 'leds':
          // daytime running lights — always on
          state.drlMat = m;
          m.emissive = new THREE.Color(0xcfe4ff);
          m.emissiveIntensity = 2.4;
          break;
        default:
          break;
      }
    });

    // GLB material names (fallback tuning for shared PBR sets)
    const mats = {};
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material) mats[o.material.name] = o.material;
    });
    if (mats.Tires) {
      mats.Tires.roughness = 0.92;
      mats.Tires.color?.set(0x0a0a0c);
    }
    if (mats.metal_chrome) {
      mats.metal_chrome.envMapIntensity = 2.2;
      mats.metal_chrome.roughness = 0.07;
    }

    // ---------- wheels ----------
    ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].forEach((n) => {
      const w = car.getObjectByName(n);
      if (w) state.wheels.push(w);
    });

    // ---------- contact shadow (AO card) ----------
    new THREE.TextureLoader(manager).load(`${BASE}models/ferrari_ao.png`, (tex) => {
      const ao = new THREE.Mesh(
        new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
        new THREE.MeshBasicMaterial({
          map: tex,
          blending: THREE.MultiplyBlending,
          toneMapped: false,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false
        })
      );
      ao.rotation.x = -Math.PI / 2;
      ao.position.y = 0.015;
      ao.renderOrder = 3;
      car.add(ao);
    });

    // ---------- headlight beams ----------
    const headY = 0.62;
    const headZ = -2.12;
    [-0.6, 0.6].forEach((x) => {
      const spot = new THREE.SpotLight(0xdcebff, 0, 30, 0.42, 0.55, 1.6);
      spot.position.set(x, headY, headZ);
      spot.target.position.set(x * 2.4, -0.35, headZ - 14);
      car.add(spot, spot.target);
      state.headlightSpots.push(spot);

      // soft glow sprite at the lens
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xdcebff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      spr.position.set(x, headY, headZ - 0.06);
      spr.scale.setScalar(0.55);
      car.add(spr);
      state.headGlows.push(spr);

      // fake volumetric cone
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 9, 32, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xbfd8ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false
        })
      );
      cone.rotation.x = Math.PI / 2;
      cone.position.set(x, headY - 0.12, headZ - 4.5);
      car.add(cone);
      state.headlightCones.push(cone);
    });

    // ---------- taillight glow ----------
    [-0.58, 0.58].forEach((x) => {
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xff2030,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      spr.position.set(x, 0.78, 2.16);
      spr.scale.setScalar(0.5);
      car.add(spr);
      state.tailGlows.push(spr);
    });

    scene.add(car);
    state.car = car;
    applyFinish(state, state.finish);
  });

  return state;
}

function applyFinish(state, finishName) {
  const f = FINISHES[finishName] || FINISHES.gloss;
  const m = state.paintMat;
  m.roughness = f.roughness;
  m.metalness = f.metalness;
  m.clearcoat = f.clearcoat;
  m.clearcoatRoughness = f.clearcoatRoughness;
  m.iridescence = f.iridescence;
  if (f.iridescence > 0) {
    m.iridescenceIOR = 1.6;
    m.iridescenceThicknessRange = [120, 480];
  }
  m.needsUpdate = true;
  state.finish = finishName;
}

/** Per-frame car update. `drive` = { speed01, dt } */
export function updateCar(state, dt, drive) {
  if (!state.car) return;

  // wheels — angular velocity follows vehicle speed
  const target = drive.speed01 * 62;
  state.wheelVel = THREE.MathUtils.damp(state.wheelVel || 0, target, 2.2, dt);
  const delta = state.wheelVel * dt;
  for (const w of state.wheels) w.rotation.x -= delta;

  // headlights
  const on = state.lightsOn ? 1 : 0;
  for (const s of state.headlightSpots) {
    s.intensity = THREE.MathUtils.damp(s.intensity, on * 260, 6, dt);
  }
  for (const g of state.headGlows) {
    g.material.opacity = THREE.MathUtils.damp(g.material.opacity, on * 0.85, 6, dt);
  }
  for (const c of state.headlightCones) {
    const driveBoost = drive.speed01 * 0.03;
    c.material.opacity = THREE.MathUtils.damp(
      c.material.opacity,
      on * (0.05 + driveBoost),
      6,
      dt
    );
  }
  if (state.projectorMat) {
    state.projectorMat.emissiveIntensity = THREE.MathUtils.damp(
      state.projectorMat.emissiveIntensity,
      on * 5.5,
      6,
      dt
    );
  }
  // taillights brighten with speed
  if (state.tailMat) {
    const t = 0.8 + drive.speed01 * 3.2;
    state.tailMat.emissiveIntensity = THREE.MathUtils.damp(
      state.tailMat.emissiveIntensity,
      t,
      5,
      dt
    );
  }
  for (const g of state.tailGlows) {
    g.material.opacity = THREE.MathUtils.damp(
      g.material.opacity,
      0.3 + drive.speed01 * 0.65,
      5,
      dt
    );
  }
}

export function setPaint(state, hex) {
  state.paintHex = hex;
  state.paintMat.color.set(hex);
}

export function setFinish(state, finish) {
  applyFinish(state, finish);
}

export function setLights(state, on) {
  state.lightsOn = on;
}
