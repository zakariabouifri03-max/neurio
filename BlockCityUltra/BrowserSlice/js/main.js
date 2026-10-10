// BLOCK CITY ULTRA — browser vertical slice.
//
// Original code, original city, original vehicles, original characters. Nothing
// here reproduces any existing game, brand or asset. See Docs/08.
//
// This slice is the same design as the UE5 project in ../Source: a procedurally
// generated voxel city, third-person character, enterable vehicles with real
// driving physics, traffic, pedestrians, a progressive wanted level with police
// pursuit, a mission chain, day/night and weather. It runs in a browser so the
// design can be played without installing an engine.

import * as THREE from './three.module.js';
import { City, MATERIAL_TABLE, MAT } from './world.js';
import { PRESETS, DISTRICTS, DAY_LENGTH_SECONDS, STARTING_CASH, PLAYER, WANTED } from './config.js';
import { Input, Player, CameraRig, buildPedestrianMesh } from './player.js';
import { TrafficManager, Vehicle } from './vehicles.js';
import { PoliceSystem } from './police.js';
import { MissionSystem } from './mission.js';
import { Hud } from './hud.js';
import { clamp, lerp, damp, dist2, makeRng } from './util.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

const canvas = document.getElementById('view');
const titleEl = document.getElementById('title');

let renderer, scene, camera, rig, input, city, player, traffic, police, missions, hud;
let sun, skyLight, ambient, hemi, streetLightGlow, rainPoints, rainMaterial;
let pedestrians = [];
let running = false;
let lastTime = 0;
let preset = PRESETS.quality;

// Persistent player state (survives a slice restart within the session).
const save = {
  cash: STARTING_CASH,
  reputation: 0,
  completedMissions: [],
  distanceDrivenKm: 0,
  distanceWalkedKm: 0,
  vehiclesStolen: 0,
  timesArrested: 0,
  timesWasted: 0,
  highestWanted: 0,
};

let timeOfDay = 0.93;
let weather = { name: 'CLEAR', intensity: 0, wetness: 0.2, windSpeed: 6, nextChange: 60 };

document.getElementById('play').addEventListener('click', start);
document.getElementById('preset').addEventListener('change', e => {
  preset = PRESETS[e.target.value];
  if (running) applyPreset();
});

window.addEventListener('keydown', e => {
  if (!running) return;
  if (e.code === 'KeyM') { hud.toggleMap(); }
  if (e.code === 'KeyR') { restart(); }
  if (e.code === 'Escape' && hud.mapOpen) { hud.toggleMap(false); }
});

// ── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  titleEl.classList.add('hidden');
  hud = new Hud(new City(1));   // temporary, replaced after generation
  hud.showLoading();

  const seed = parseInt(document.getElementById('seed').value, 10) || 20260710;
  timeOfDay = parseFloat(document.getElementById('time').value);
  preset = PRESETS[document.getElementById('preset').value] || PRESETS.quality;

  // Yield to the browser between generation stages so the loading bar animates
  // instead of freezing — generation is synchronous, but it is chunked.
  const stage = async (fraction, label, fn) => {
    hud.setLoading(fraction, label);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    return fn();
  };

  city = await stage(0.05, 'allocating city', () => new City(seed, (f, s) => hud.setLoading(f * 0.8, s)));
  await stage(0.10, 'road layout', () => city.generate());
  await stage(0.85, 'merging geometry', () => null);

  const built = city.buildMeshes();

  await stage(0.95, 'building renderer', () => null);

  hud = new Hud(city);
  hud.show();
  hud.hideLoading();

  initRenderer(built);
  initWorld(built);
  initGameplay();

  running = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);

  hud.toast(`Vault City generated — seed ${seed}, ${city.buildings.length} buildings, ${built.stats.drawCalls} draw calls`, '', 5);
  console.log('[BCU] generation', city.generationMs.toFixed(1), 'ms', built.stats);
}

function restart() {
  running = false;
  document.getElementById('seed').value = String((Math.random() * 2 ** 31) | 0);
  start();
}

// ── Renderer + scene ─────────────────────────────────────────────────────────

function initRenderer(built) {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: preset.antialias, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(preset.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1018, preset.fogNear, preset.fogFar);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.35, preset.drawDistance * 2.4);
  rig = new CameraRig(camera);
  input = new Input(canvas);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // City geometry: one mesh per material, so the whole slice is ~26 draw calls.
  for (const mesh of built.meshes) scene.add(mesh);
  for (const mesh of built.emissive) scene.add(mesh);
  cityMeshes = [...built.meshes, ...built.emissive];

  // Expose for the camera occlusion test.
  city.buildCollision();
  window.__bcuCity = city;
}

let cityMeshes = [];

function applyPreset() {
  if (!renderer) return;
  renderer.setPixelRatio(preset.pixelRatio);
  renderer.shadowMap.enabled = preset.shadows;
  scene.fog.near = preset.fogNear;
  scene.fog.far = preset.fogFar;
  camera.far = preset.drawDistance * 2.4;
  camera.updateProjectionMatrix();
  if (traffic) traffic.setPreset(preset);
  if (sun) sun.castShadow = preset.shadows;
  buildRain();
  hud.toast(`Graphics preset → ${preset.label}`, '', 2.4);
}

// ── Lighting, sky and weather ────────────────────────────────────────────────

function initWorld(built) {
  // Sun: a single directional light that orbits on a real solar path.
  sun = new THREE.DirectionalLight(0xfff2dc, 3.0);
  sun.castShadow = preset.shadows;
  sun.shadow.mapSize.set(preset.label === 'ULTRA' ? 4096 : 2048, preset.label === 'ULTRA' ? 4096 : 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 460;
  const s = 190;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
  sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  // Sky light: hemisphere for the ambient bounce Lumen would give us in UE5.
  hemi = new THREE.HemisphereLight(0x8fb4e8, 0x2a2620, 0.85);
  scene.add(hemi);

  ambient = new THREE.AmbientLight(0x30405a, 0.35);
  scene.add(ambient);

  // Streetlight glow: one pooled point light that follows the player at night,
  // standing in for the thousands of emissive lamp voxels. Emissive geometry
  // does the visual work; this light does the lighting work.
  streetLightGlow = new THREE.PointLight(0xffd9a0, 0, 60, 1.7);
  scene.add(streetLightGlow);

  buildRain();
  updateSky(0);
}

function buildRain() {
  if (rainPoints) { scene.remove(rainPoints); rainPoints.geometry.dispose(); rainPoints = null; }
  if (!preset.rain) return;

  const count = preset.label === 'ULTRA' ? 9000 : preset.label === 'QUALITY' ? 5200 : 1800;
  const positions = new Float32Array(count * 3);
  const rng = makeRng(99);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * 160;
    positions[i * 3 + 1] = rng() * 90;
    positions[i * 3 + 2] = (rng() - 0.5) * 160;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  rainMaterial = new THREE.PointsMaterial({
    color: 0xa8c8e8, size: 0.14, transparent: true, opacity: 0.0,
    depthWrite: false, sizeAttenuation: true,
  });

  rainPoints = new THREE.Points(geometry, rainMaterial);
  rainPoints.frustumCulled = false;
  scene.add(rainPoints);
}

/** Solar geometry: elevation + azimuth from the clock and a fixed latitude. */
function sunAngles(t) {
  const lat = 41.5 * Math.PI / 180;
  const declination = 0.4093 * Math.sin(2 * Math.PI * 0.35 - 1.405);
  const hourAngle = (t - 0.5) * 2 * Math.PI;
  const sinElev = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(clamp(sinElev, -1, 1));
  const azimuth = hourAngle + Math.PI / 2;
  return { elevation, azimuth };
}

/** 0 = full night, 1 = full day. Drives every "is it night" decision. */
function daylightFactor(t) {
  const { elevation } = sunAngles(t);
  const deg = elevation * 180 / Math.PI;
  return clamp((deg + 6) / 14, 0, 1);
}

function updateSky(dt) {
  const { elevation, azimuth } = sunAngles(timeOfDay);
  const daylight = daylightFactor(timeOfDay);

  // Sun direction and colour: warm at the horizon, neutral at noon.
  const dist = 300;
  sun.position.set(
    Math.cos(azimuth) * Math.cos(elevation) * dist,
    Math.sin(elevation) * dist,
    Math.sin(azimuth) * Math.cos(elevation) * dist
  );
  if (player) sun.target.position.copy(player.isDriving ? player.vehicle.position : player.position);

  const horizonT = clamp((elevation * 180 / Math.PI + 2) / 45, 0, 1);
  const sunColor = new THREE.Color().lerpColors(new THREE.Color(0xff6a24), new THREE.Color(0xfff6e8), horizonT);
  sun.color.copy(sunColor);
  sun.intensity = Math.max(0, daylight) * 3.4 * (1 - weather.intensity * 0.62);
  sun.visible = sun.intensity > 0.02;

  // Sky colour and fog: night blue → twilight violet → day blue, desaturated by
  // cloud cover and darkened by rain.
  const nightSky = new THREE.Color(0x050a16);
  const twilightSky = new THREE.Color(0x3a2b52);
  const daySky = new THREE.Color(0x5f8fd0);
  const sky = new THREE.Color();
  if (daylight < 0.5) sky.lerpColors(nightSky, twilightSky, daylight * 2);
  else sky.lerpColors(twilightSky, daySky, (daylight - 0.5) * 2);

  const overcast = new THREE.Color(0x3b4149);
  sky.lerp(overcast, weather.intensity * 0.6);

  scene.background = sky;
  scene.fog.color.copy(sky).multiplyScalar(0.82);
  scene.fog.density = undefined;

  hemi.color.copy(sky);
  hemi.groundColor.setHex(0x1a1712);
  hemi.intensity = lerp(0.16, 0.95, daylight) * (1 - weather.intensity * 0.4);
  ambient.intensity = lerp(0.30, 0.16, daylight);
  ambient.color.lerpColors(new THREE.Color(0x2a3a5c), new THREE.Color(0x50607a), daylight);

  // Night lighting: windows and streetlamps come up as daylight goes down, with
  // a lag so dusk reads as lights switching on rather than a crossfade.
  const nightLight = clamp(1 - daylight * 1.35, 0, 1);
  for (const mesh of cityMeshes) {
    if (mesh.material.emissiveIntensity !== undefined && mesh.material.emissive.getHex() !== 0) {
      const base = mesh.material.userData.baseEmissive ?? mesh.material.emissiveIntensity;
      mesh.material.userData.baseEmissive = base;
      mesh.material.emissiveIntensity = base * nightLight * (1 + weather.wetness * 0.35);
    }
  }

  // One pooled streetlight near the player at night.
  if (streetLightGlow && player) {
    const p = player.isDriving ? player.vehicle.position : player.position;
    let best = null, bestD = 34;
    for (const l of city.streetLights) {
      const d = dist2(l.x, l.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = l; }
    }
    if (best) {
      streetLightGlow.position.set(best.x, 7.0, best.z);
      streetLightGlow.intensity = nightLight * 26;
      streetLightGlow.visible = nightLight > 0.05;
    } else {
      streetLightGlow.visible = false;
    }
  }

  // Rain: falls around the player, opacity follows intensity.
  if (rainPoints && player) {
    const p = player.isDriving ? player.vehicle.position : player.position;
    rainPoints.position.set(p.x, 0, p.z);
    rainMaterial.opacity = weather.intensity * 0.55;
    rainPoints.visible = weather.intensity > 0.04;

    const positions = rainPoints.geometry.attributes.position.array;
    const fallSpeed = 34 + weather.windSpeed * 0.6;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] -= fallSpeed * dt;
      positions[i] += weather.windSpeed * 0.05 * dt;
      if (positions[i + 1] < 0) {
        positions[i + 1] = 88;
        positions[i] = (Math.random() - 0.5) * 160;
        positions[i + 2] = (Math.random() - 0.5) * 160;
      }
    }
    rainPoints.geometry.attributes.position.needsUpdate = true;
  }

  // Wet roads: roughness down, so the asphalt picks up the neon and the lights.
  // This is the single cheapest change that makes rain look expensive.
  const wet = weather.wetness;
  for (const mesh of cityMeshes) {
    if (mesh.material.userData.baseRoughness === undefined) {
      mesh.material.userData.baseRoughness = mesh.material.roughness;
    }
    const base = mesh.material.userData.baseRoughness;
    mesh.material.roughness = lerp(base, base * 0.22, wet);
    mesh.material.metalness = lerp(mesh.material.metalness, Math.max(mesh.material.metalness, 0.28), wet * 0.35);
  }
}

// ── Weather ──────────────────────────────────────────────────────────────────

const WEATHER_TABLE = [
  { name: 'CLEAR', intensity: 0.0, cloud: 0.06, wind: 6 },
  { name: 'PARTLY CLOUDY', intensity: 0.0, cloud: 0.38, wind: 10 },
  { name: 'OVERCAST', intensity: 0.0, cloud: 0.86, wind: 12 },
  { name: 'LIGHT RAIN', intensity: 0.30, cloud: 0.78, wind: 14 },
  { name: 'HEAVY RAIN', intensity: 0.80, cloud: 0.94, wind: 26 },
  { name: 'THUNDERSTORM', intensity: 0.98, cloud: 1.0, wind: 38 },
  { name: 'FOG', intensity: 0.0, cloud: 0.70, wind: 4 },
];

function updateWeather(dt) {
  weather.nextChange -= dt;
  if (weather.nextChange <= 0) {
    // Markov-ish: usually persist or step one, rarely jump.
    const current = WEATHER_TABLE.findIndex(w => w.name === weather.name);
    const roll = Math.random();
    let next = current;
    if (roll > 0.45 && roll <= 0.80) next = clamp(current + (Math.random() < 0.5 ? 1 : -1), 0, WEATHER_TABLE.length - 1);
    else if (roll > 0.80) next = (Math.random() * WEATHER_TABLE.length) | 0;

    const chosen = WEATHER_TABLE[next];
    if (chosen.name !== weather.name) {
      weather.name = chosen.name;
      hud.toast(`Weather — ${chosen.name}`, '', 2.6);
    }
    weather.intensity = chosen.intensity * (0.8 + Math.random() * 0.4);
    weather.windSpeed = chosen.wind * (0.7 + Math.random() * 0.6);
    weather.nextChange = 45 + Math.random() * 90;
  }

  // Wetness rises in rain, dries slowly otherwise; sun and wind speed it up.
  const raining = weather.intensity > 0.05 && (weather.name.includes('RAIN') || weather.name === 'THUNDERSTORM');
  if (raining) {
    weather.wetness = Math.min(1, weather.wetness + 0.010 * dt * 60 * weather.intensity);
  } else {
    const dryRate = 0.0022 * dt * 60 * lerp(0.35, 2.2, daylightFactor(timeOfDay));
    weather.wetness = Math.max(0, weather.wetness - dryRate);
  }

  // Lightning during a storm: a brief spike in ambient and sun intensity.
  if (weather.name === 'THUNDERSTORM') {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningTimer = 6 + Math.random() * 16;
      lightningFlash = 1.0;
    }
  }
  if (lightningFlash > 0) {
    lightningFlash = Math.max(0, lightningFlash - dt * 4.2);
    ambient.intensity += lightningFlash * 2.6;
    hemi.intensity += lightningFlash * 1.8;
  }
}

let lightningTimer = 8;
let lightningFlash = 0;

// ── Gameplay ─────────────────────────────────────────────────────────────────

function initGameplay() {
  player = new Player(city, scene);
  player.spawnAt(city.playerStart.x, city.playerStart.z);
  window.__bcuPlayer = player;

  traffic = new TrafficManager(scene, city, preset);
  traffic.spawnNear(player.position, preset.trafficCount * 0.5);
  window.__bcuTraffic = traffic;

  police = new PoliceSystem(scene, city);
  police.onWantedChanged = (level, old) => {
    if (level > old) hud.toast(level >= 3 ? `WANTED — ${level} stars` : `WANTED — ${level} star`, 'bad', 2.6);
    else if (level === 0) hud.toast('You lost them.', 'good', 2.8);
    save.highestWanted = Math.max(save.highestWanted, level);
  };
  police.onBark = text => hud.bark(text);
  police.onArrested = () => onArrested();
  police.onEscaped = () => hud.toast('ESCAPED', 'good', 3.0);

  missions = new MissionSystem(scene, city, police, traffic);
  missions.onStarted = def => {
    hud.toast(`${def.title} — ${def.briefing}`, '', 5.5);
    hud.toast(`${def.giver}: ${def.objectives[0].text}`, '', 4.5);
  };
  missions.onObjectiveChanged = (obj, i) => hud.toast(obj.text, '', 3.2);
  missions.onProgress = (p, n) => hud.toast(`Progress ${p}/${n}`, '', 1.8);
  missions.onCompleted = (def, cash, elapsed, bonus) => {
    save.cash += cash;
    save.reputation += def.rewardRep;
    save.completedMissions.push(def.id);
    hud.showCard('MISSION COMPLETE', `${def.title} — ${elapsed.toFixed(1)}s${bonus.length ? ' (' + bonus.join(', ') + ')' : ''}`,
      `+$${cash.toLocaleString()}   +${def.rewardRep} REP`);
    hud.onCardButton(() => { hud.hideCard(); canvas.requestPointerLock?.(); });
  };
  missions.onFailed = (def, reason) => {
    hud.showCard('MISSION FAILED', reason || '', '', 'fail');
    hud.onCardButton(() => { hud.hideCard(); canvas.requestPointerLock?.(); });
  };

  spawnPedestrians();

  player.onDamaged = () => rig.notifyImpact(0.25);
  player.onDowned = () => onWasted();
  player.onHorn = () => hud.toast('📢', '', 0.8);

  hud.toast('Walk to a car and press F. Press M for the map.', '', 6);
}

function spawnPedestrians() {
  const rng = makeRng(0xbed1);
  const palettes = [
    { skin: 0xc99a76, shirt: 0x2a528c, trousers: 0x24262c, shoes: 0x141312 },
    { skin: 0x8d5a3b, shirt: 0x9e3b3b, trousers: 0x2b2f3a, shoes: 0x1a1a1a },
    { skin: 0xe0b48c, shirt: 0x3f7a4a, trousers: 0x3a3428, shoes: 0x201a14 },
    { skin: 0x6b4227, shirt: 0xd6c37a, trousers: 0x1f2a3a, shoes: 0x141312 },
    { skin: 0xf0c9a8, shirt: 0x4a3f6b, trousers: 0x2c2c30, shoes: 0x181818 },
    { skin: 0xa9744f, shirt: 0xc8ccd4, trousers: 0x3a3a3f, shoes: 0x222222 },
  ];

  // One shared mesh per palette, cloned — so 140 pedestrians cost 6 geometries.
  const templates = palettes.map(p => buildPedestrianMesh(p));

  pedestrians = [];
  for (let i = 0; i < preset.pedCount; i++) {
    const point = city.pedPoints[(rng() * city.pedPoints.length) | 0];
    if (!point) break;

    const template = templates[i % templates.length];
    const mesh = template.clone(true);
    mesh.visible = false;
    scene.add(mesh);

    pedestrians.push({
      mesh,
      x: point.x + (rng() - 0.5) * 2,
      z: point.z + (rng() - 0.5) * 2,
      yaw: rng() * Math.PI * 2,
      speed: 1.1 + rng() * 0.7,
      turnTimer: 2 + rng() * 6,
      state: 'walk',
      panicTimer: 0,
      phase: rng() * 10,
      active: false,
    });
  }
}

function updatePedestrians(dt) {
  const p = player.isDriving ? player.vehicle.position : player.position;
  const playerSpeed = player.isDriving ? player.vehicle.speedKmh : 0;
  const spawnRadius = 78;
  const despawnRadius = 105;

  let activeCount = 0;

  for (const ped of pedestrians) {
    const d = dist2(ped.x, ped.z, p.x, p.z);

    // Two-tier crowd: near pedestrians are simulated and visible; far ones are
    // simply not. This is the same rule the UE5 subsystem uses.
    if (!ped.active) {
      if (d < spawnRadius && activeCount < preset.pedCount * 0.6) {
        ped.active = true;
        ped.mesh.visible = true;
      } else {
        ped.mesh.visible = false;
        continue;
      }
    } else if (d > despawnRadius) {
      ped.active = false;
      ped.mesh.visible = false;
      continue;
    }

    activeCount++;

    // Panic: gunfire, a fast car nearby, or a police pursuit.
    const threat = (playerSpeed > 55 && d < 22) || (police.spotted && d < 40) || (police.wantedLevel >= 3 && d < 26);
    if (threat && ped.state !== 'panic') {
      ped.state = 'panic';
      ped.panicTimer = 7 + Math.random() * 7;
      // Run directly away from the player.
      ped.yaw = Math.atan2(ped.x - p.x, ped.z - p.z);
    }

    if (ped.state === 'panic') {
      ped.panicTimer -= dt;
      if (ped.panicTimer <= 0) ped.state = 'walk';
    } else {
      ped.turnTimer -= dt;
      if (ped.turnTimer <= 0) {
        ped.turnTimer = 3 + Math.random() * 7;
        // Turn onto a new heading, biased to keep walking along the street.
        ped.yaw += (Math.random() - 0.5) * 1.9;
      }
    }

    const speed = ped.state === 'panic' ? ped.speed * 3.1 : ped.speed;
    const nx = ped.x + Math.sin(ped.yaw) * speed * dt;
    const nz = ped.z + Math.cos(ped.yaw) * speed * dt;

    // Do not walk into buildings; turn around instead.
    const probe = { x: nx, y: 0.3, z: nz };
    city.resolveCollision(probe, 0.32);
    if (Math.hypot(probe.x - nx, probe.z - nz) > 0.02) {
      ped.yaw += Math.PI * (0.6 + Math.random() * 0.8);
    } else {
      ped.x = nx; ped.z = nz;
    }

    // Struck by the player's car: a crime, a panic radius, and a body.
    if (player.isDriving && d < 2.6 && playerSpeed > 18) {
      police.reportCrime('pedestrian', ped.x, ped.z, true);
      ped.state = 'downed';
      ped.mesh.rotation.z = Math.PI / 2;
      ped.mesh.position.y = 0.35;
      ped.speed = 0;
      hud.toast('You hit a pedestrian.', 'bad', 2.6);
      // Everyone nearby panics.
      for (const other of pedestrians) {
        if (other === ped || !other.active) continue;
        if (dist2(other.x, other.z, ped.x, ped.z) < 30) {
          other.state = 'panic';
          other.panicTimer = 9;
          other.yaw = Math.atan2(other.x - ped.x, other.z - ped.z);
        }
      }
      continue;
    }

    if (ped.state === 'downed') continue;

    ped.mesh.position.set(ped.x, 0.3, ped.z);
    ped.mesh.rotation.y = ped.yaw;

    // Limb swing.
    ped.phase += dt * (ped.state === 'panic' ? 14 : 7.5);
    const swing = Math.sin(ped.phase) * (ped.state === 'panic' ? 0.95 : 0.6);
    for (const part of ped.mesh.children) {
      if (part.name === 'legL' || part.name === 'shoeL') part.rotation.x = swing;
      else if (part.name === 'legR' || part.name === 'shoeR') part.rotation.x = -swing;
      else if (part.name === 'armL' || part.name === 'handL') part.rotation.x = -swing * 0.8;
      else if (part.name === 'armR' || part.name === 'handR') part.rotation.x = swing * 0.8;
    }
  }
}

// ── Interaction ──────────────────────────────────────────────────────────────

function updateInteraction() {
  // Vehicle entry.
  const target = player.findEnterableVehicle(traffic, police.units.filter(u => !u.dead).map(u => u.vehicle));

  if (player.isDriving) {
    const v = player.vehicle;
    const canExit = v.speedKmh < 7;
    hud.el.prompt && (document.getElementById('prompt').classList.remove('hidden'));
    document.getElementById('prompt-text').textContent = canExit ? 'Exit vehicle' : 'Too fast to exit';
    document.getElementById('prompt').classList.remove('hidden');
    document.getElementById('prompt').innerHTML = `<b>F</b> <span id="prompt-text">${canExit ? 'Exit vehicle' : 'Too fast to exit'}</span>`;
  } else if (target) {
    document.getElementById('prompt').classList.remove('hidden');
    document.getElementById('prompt').innerHTML =
      `<b>F</b> <span>${target.isPolice ? 'Enter police cruiser' : 'Enter ' + target.def.name}</span>`;
  } else {
    document.getElementById('prompt').classList.add('hidden');
  }

  return target;
}

function handleInput(dt) {
  // Look.
  rig.addLook(input.mouse.dx, input.mouse.dy);
  if (!player.isDriving) rig.yaw += 0; // driving yaw is handled by the rig

  // F: enter / exit.
  if (input.hit('KeyF')) {
    if (player.isDriving) {
      const v = player.vehicle;
      if (v.speedKmh < 7) {
        const wasPolice = v.isPolice;
        const wasTraffic = v.isTraffic;
        player.exitVehicle();
        if (wasPolice) police.reportCrime('theft', v.position.x, v.position.z, true);
        hud.toast(`Exited the ${v.def.name}.`, '', 2.0);
      } else {
        hud.toast('Slow down before you get out.', '', 1.6);
      }
    } else {
      const target = player.findEnterableVehicle(traffic, police.units.filter(u => !u.dead).map(u => u.vehicle));
      if (target) {
        const stolen = !target.__playerEntered;
        target.__playerEntered = true;
        // Pull it out of traffic so the AI stops driving it.
        const idx = traffic.vehicles.indexOf(target);
        if (idx >= 0) traffic.vehicles.splice(idx, 1);
        target.isTraffic = false;

        player.enterVehicle(target);
        save.vehiclesStolen++;

        if (target.isPolice) {
          police.reportCrime('theft', target.position.x, target.position.z, true);
          police.reportCrime('officer', target.position.x, target.position.z, true);
          hud.toast('You just took a police cruiser.', 'bad', 3.0);
        } else if (stolen) {
          // Theft is witnessed only if a pedestrian or another car is close.
          const witnessed = pedestrians.some(p => p.active && dist2(p.x, p.z, target.position.x, target.position.z) < 26);
          police.reportCrime('theft', target.position.x, target.position.z, witnessed);
          hud.toast(`Took the ${target.def.name}${witnessed ? ' — someone saw it.' : '.'}`, witnessed ? 'bad' : '', 2.8);
        }
      }
    }
  }

  // C: camera mode.
  if (input.hit('KeyC')) {
    const mode = rig.cycleMode();
    hud.toast(`Camera — ${mode}`, '', 1.4);
  }

  // Q: look back.
  rig.lookBack = input.down('KeyQ');

  // E / Enter: start the next mission when near the marker and idle.
  if (input.hit('KeyE') || input.hit('Enter')) {
    if (!missions.active) {
      const next = missions.nextMission;
      if (next) {
        missions.start();
      } else {
        hud.toast('Every job in the city is done. Drive.', '', 2.6);
      }
    }
  }

  // H: horn while driving (handled in Player#driveVehicle).
}

// ── Reckless driving detection ───────────────────────────────────────────────

let recklessTimer = 0;
let speedingTimer = 0;

function updateCrimeDetection(dt) {
  if (!player.isDriving) { recklessTimer = 0; speedingTimer = 0; return; }

  const v = player.vehicle;

  // Speeding in a built-up area.
  const district = DISTRICTS[city.districtIndexAt(v.position.x, v.position.z)];
  const limit = district.verticality > 0.5 ? 60 : 50;
  if (v.speedKmh > limit + 45) {
    speedingTimer += dt;
    if (speedingTimer > 6) {
      speedingTimer = 0;
      police.reportCrime('traffic', v.position.x, v.position.z, police.spotted);
    }
  } else {
    speedingTimer = Math.max(0, speedingTimer - dt * 0.5);
  }

  // Drifting near pedestrians is reckless driving.
  if (v.drifting && v.speedKmh > 45) {
    const nearPed = pedestrians.some(p => p.active && dist2(p.x, p.z, v.position.x, v.position.z) < 16);
    if (nearPed) {
      recklessTimer += dt;
      if (recklessTimer > 1.6) {
        recklessTimer = 0;
        police.reportCrime('reckless', v.position.x, v.position.z, true);
      }
    }
  } else {
    recklessTimer = Math.max(0, recklessTimer - dt);
  }

  // Ramming another car is property damage.
  if (v.lastImpactSpeed > 22) {
    police.reportCrime('damage', v.position.x, v.position.z, police.spotted);
  }
}

// ── Death / arrest ───────────────────────────────────────────────────────────

function onWasted() {
  save.timesWasted++;
  save.cash = Math.max(0, save.cash - 250);
  police.clear(false);
  missions.abandon();

  hud.showCard('WASTED', 'You were taken to Calder General. The bill was $250.', '-$250', 'fail');
  hud.onCardButton(() => {
    hud.hideCard();
    player.revive();
    player.spawnAt(city.playerStart.x, city.playerStart.z);
    rig.smoothTarget.copy(player.position);
    canvas.requestPointerLock?.();
  });
}

function onArrested() {
  save.timesArrested++;
  save.cash = Math.max(0, save.cash - 400);
  missions.abandon();

  hud.showCard('BUSTED', 'Vault City PD processed you at the precinct. Fine: $400.', '-$400', 'fail');
  hud.onCardButton(() => {
    hud.hideCard();
    player.revive();
    if (player.isDriving) player.exitVehicle();
    player.spawnAt(city.playerStart.x + 14, city.playerStart.z + 14);
    rig.smoothTarget.copy(player.position);
    canvas.requestPointerLock?.();
  });
}

// ── Frame loop ───────────────────────────────────────────────────────────────

let fpsAccum = 0, fpsFrames = 0, fpsDisplay = 0;
let impactCooldown = 0;

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);

  // Clamp dt: a backgrounded tab must not teleport the player across the city.
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (hud.mapOpen) {
    // Paused: still render, but do not simulate.
    renderer.render(scene, camera);
    input.endFrame();
    return;
  }

  // Clock.
  timeOfDay = (timeOfDay + dt / DAY_LENGTH_SECONDS) % 1;
  updateWeather(dt);

  handleInput(dt);
  player.update(dt, input, rig.yaw, rig.pitch);

  if (player.isDriving) {
    save.distanceDrivenKm += player.vehicle.odometer - (player.vehicle._lastOdo || 0);
    player.vehicle._lastOdo = player.vehicle.odometer;
    traffic.update(dt, player.vehicle.position, player.vehicle);
    police.update(dt, player, traffic);

    // Impact feedback: the vehicle sets health down on collision.
    const v = player.vehicle;
    if (v._lastHealth === undefined) v._lastHealth = v.health;
    impactCooldown = Math.max(0, impactCooldown - dt);
    if (v.health < v._lastHealth - 0.001 && impactCooldown <= 0) {
      const severity = clamp((v._lastHealth - v.health) * 40, 0.1, 1.2);
      rig.notifyImpact(severity);
      impactCooldown = 0.35;
      v.lastImpactSpeed = severity * 60;
      setTimeout(() => { v.lastImpactSpeed = 0; }, 60);
    }
    v._lastHealth = v.health;

    updateCrimeDetection(dt);
  } else {
    traffic.update(dt, player.position, null);
    police.update(dt, player, traffic);
  }

  updatePedestrians(dt);
  missions.update(dt);
  updateSky(dt);

  // Camera.
  rig.update(dt, player, player.isDriving);
  camera.fov = rig.fov;

  // Headlights come on automatically at night.
  const night = clamp(1 - daylightFactor(timeOfDay) * 1.35, 0, 1);
  for (const v of traffic.vehicles) v.setHeadlights(night > 0.25);
  if (player.isDriving) player.vehicle.setHeadlights(night > 0.25);
  for (const u of police.units) if (!u.dead) u.vehicle.setHeadlights(true);

  // HUD.
  const promptTarget = updateInteraction();
  const districtIndex = city.districtIndexAt(
    player.isDriving ? player.vehicle.position.x : player.position.x,
    player.isDriving ? player.vehicle.position.z : player.position.z
  );

  hud.update({
    player, mission: missions, police,
    timeOfDay, weather: weather.name,
    cash: save.cash, health: player.health,
    prompt: promptTarget ? `Enter ${promptTarget.def.name}` : null,
    district: DISTRICTS[districtIndex].name,
  });

  hud.drawMinimap(
    player.isDriving ? player.vehicle.position : player.position,
    player.isDriving ? player.vehicle.yaw : rig.yaw + Math.PI,
    missions, police,
    player.isDriving ? lerp(110, 190, clamp(player.vehicle.speedKmh / 220, 0, 1)) : 100
  );

  if (hud.mapOpen) {
    hud.drawBigMap(
      player.isDriving ? player.vehicle.position : player.position,
      player.isDriving ? player.vehicle.yaw : rig.yaw,
      missions, police
    );
  }

  // Stats.
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.5) {
    fpsDisplay = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0; fpsFrames = 0;
    document.getElementById('weather').textContent =
      `${weather.name} · ${fpsDisplay} fps · ${traffic.count} cars`;
  }

  renderer.render(scene, camera);
  input.endFrame();
}
