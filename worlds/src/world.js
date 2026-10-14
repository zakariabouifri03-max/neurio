// ── World builder ───────────────────────────────────────────────────────────
// Turns one planet definition into a walkable scene: rolling terrain, sky
// dome, sun/moon light, water, and a forest of instanced giants.
// All sizes are metres. The explorer is 1.7 m tall.

import * as THREE from 'three';
import { mulberry32, makeNoise2D, fbm, rand, randi, clamp } from './rng.js';
import { SPECIES, GROUND_FLORA, SPECIES_RANGE, GROUND_RANGE, speciesLabel } from './flora.js';

export const TERRAIN_SIZE = 1200;   // metres across
export const EYE_HEIGHT = 1.7;      // your height, for scale

const QUALITY = {
  low: { seg: 96, giants: 0.55, cover: 0.35, shadow: false, dpr: 1.0, fog: 520 },
  med: { seg: 148, giants: 0.85, cover: 0.7, shadow: true, dpr: 1.35, fog: 700 },
  high: { seg: 210, giants: 1.0, cover: 1.0, shadow: true, dpr: 1.6, fog: 820 },
};
export const qualityOf = (k) => QUALITY[k] || QUALITY.med;

// ── terrain maths (shared by mesh, plant placement and the explorer) ────────
export function makeTerrain(planet) {
  const noise = makeNoise2D(planet.seed);
  const noise2 = makeNoise2D(planet.seed ^ 0x5bf03635);
  const f = planet.terrainFreq, amp = planet.terrainAmp, rough = planet.rough;

  function heightAt(x, z) {
    const h = fbm(noise, x * f, z * f, 4) * amp
      + fbm(noise2, x * f * 3.3 + 21.7, z * f * 3.3 - 9.2, 3) * amp * 0.3 * rough
      + Math.sin(x * f * 0.7) * Math.cos(z * f * 0.6) * amp * 0.45;
    return h;
  }
  function slopeAt(x, z) {
    const d = 2.5;
    const dx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d);
    const dz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
    return Math.sqrt(dx * dx + dz * dz);
  }
  return { heightAt, slopeAt, noise };
}

// ── sky dome canvas (gradient + sun/moon glow + stars) ─────────────────────
function skyTexture(planet, rng) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const top = planet.palette.skyTop, bot = planet.palette.skyBottom;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(0.55, bot);
  grad.addColorStop(1, planet.palette.fog);
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);

  // sun / moon glow
  const sx = 0.28 * 1024, sy = planet.night ? 150 : 120;
  const glow = g.createRadialGradient(sx, sy, 4, sx, sy, planet.night ? 150 : 260);
  glow.addColorStop(0, planet.palette.sun);
  glow.addColorStop(0.12, planet.palette.sun);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = planet.night ? 0.85 : 0.95;
  g.fillStyle = glow;
  g.beginPath(); g.arc(sx, sy, planet.night ? 150 : 260, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(sx, sy, planet.night ? 16 : 26, 0, Math.PI * 2); g.fill();

  // planet rings painted across the sky
  if (planet.ringed) {
    g.save();
    g.globalAlpha = 0.22;
    g.strokeStyle = planet.palette.leaf[0];
    g.lineWidth = 14;
    g.beginPath(); g.ellipse(720, 190, 300, 70, -0.35, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 5;
    g.beginPath(); g.ellipse(720, 190, 240, 54, -0.35, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  if (planet.night) {
    for (let i = 0; i < 900; i++) {
      const x = rng() * 1024, y = rng() * 360;
      g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.75})`;
      g.fillRect(x, y, rng() < 0.06 ? 2 : 1, rng() < 0.06 ? 2 : 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// ── main build ──────────────────────────────────────────────────────────────
export function buildWorld(planet, qualityKey = 'med') {
  const q = qualityOf(qualityKey);
  const rng = mulberry32(planet.seed);
  const terrain = makeTerrain(planet);
  const pal = planet.palette;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(pal.fog), q.fog * 0.25, q.fog);

  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ── sky ──
  const skyGeo = track(new THREE.SphereGeometry(4200, 32, 18));
  const skyTex = track(skyTexture(planet, rng));
  const skyMat = track(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // ── lights ─
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(pal.skyBottom), new THREE.Color(pal.groundLow),
    planet.night ? 0.95 : 1.05,
  );
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(pal.sun), planet.night ? 1.05 : 1.6);
  sun.position.set(-180, 240, 120);
  if (q.shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 170;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.6;
  }
  scene.add(sun);
  scene.add(sun.target);
  if (planet.glow > 0.4) {
    const rim = new THREE.DirectionalLight(new THREE.Color(pal.bloom), 0.35 * planet.glow);
    rim.position.set(120, 60, -160);
    scene.add(rim);
  }
  if (planet.night) {
    scene.add(new THREE.AmbientLight(
      new THREE.Color(pal.skyBottom).lerp(new THREE.Color('#ffffff'), 0.3), 0.4));
  }

  // ── terrain ──
  const seg = q.seg;
  const geo = track(new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(pal.groundLow), cHigh = new THREE.Color(pal.groundHigh);
  const cDark = cLow.clone().multiplyScalar(0.55);
  const tmp = new THREE.Color();
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrain.heightAt(x, z);
    pos.setY(i, h);
    if (h < hMin) hMin = h; if (h > hMax) hMax = h;
  }
  const span = Math.max(1, hMax - hMin);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const t = clamp((h - hMin) / span, 0, 1);
    tmp.copy(cLow).lerp(cHigh, t * 0.85 + 0.15 * (terrain.noise(pos.getX(i) * 0.05, pos.getZ(i) * 0.05) * 0.5 + 0.5));
    if (t < 0.28) tmp.lerp(cDark, (0.28 - t) * 1.6);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // fine ground detail (multiplied over the vertex colours)
  const gc = document.createElement('canvas');
  gc.width = gc.height = 256;
  const gg = gc.getContext('2d');
  gg.fillStyle = '#9a9a9a'; gg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.floor(rng() * 110);
    gg.fillStyle = `rgba(${v},${v + Math.floor(rng() * 14)},${v - 6},${0.06 + rng() * 0.22})`;
    gg.beginPath();
    gg.ellipse(rng() * 256, rng() * 256, 1 + rng() * 7, 1 + rng() * 5, rng() * 3, 0, Math.PI * 2);
    gg.fill();
  }
  for (let i = 0; i < 900; i++) {   // blade-like flecks
    gg.strokeStyle = `rgba(60,60,52,${0.1 + rng() * 0.25})`;
    gg.lineWidth = 1;
    const x = rng() * 256, y = rng() * 256;
    gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + rng() * 4 - 2, y - 2 - rng() * 5); gg.stroke();
  }
  const gTex = track(new THREE.CanvasTexture(gc));
  gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping;
  gTex.repeat.set(TERRAIN_SIZE / 9, TERRAIN_SIZE / 9);
  gTex.colorSpace = THREE.SRGBColorSpace;
  gTex.anisotropy = 4;
  const groundMat = track(new THREE.MeshLambertMaterial({ vertexColors: true, map: gTex }));
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = q.shadow;
  scene.add(ground);

  // ── water ──
  let water = null;
  if (planet.waterLevel !== null) {
    const wg = track(new THREE.PlaneGeometry(TERRAIN_SIZE * 1.4, TERRAIN_SIZE * 1.4, 1, 1));
    wg.rotateX(-Math.PI / 2);
    const wm = track(new THREE.MeshPhongMaterial({
      color: new THREE.Color(pal.water), transparent: true, opacity: 0.68,
      shininess: 110, specular: new THREE.Color('#ffffff'),
      emissive: new THREE.Color(pal.water).multiplyScalar(0.16),
    }));
    water = new THREE.Mesh(wg, wm);
    water.position.y = planet.waterLevel;
    scene.add(water);
  }

  // ── materials ──
  const barkMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(pal.trunk) }));
  const leafMats = pal.leaf.map((c) => track(new THREE.MeshLambertMaterial({
    color: new THREE.Color(c), side: THREE.DoubleSide,
    emissive: new THREE.Color(c).multiplyScalar(planet.glow * 0.55),
  })));
  const glowMat = track(new THREE.MeshLambertMaterial({
    color: new THREE.Color(pal.bloom),
    emissive: new THREE.Color(pal.bloom).multiplyScalar(0.35 + planet.glow * 0.9),
    side: THREE.DoubleSide,
  }));

  // spawn point: a flat-ish spot near the middle (picked first, so the
  // meadow patches below can grow around your landing site)
  let spawn = { x: 0, z: 0 };
  for (let i = 0; i < 60; i++) {
    const x = rand(rng, -40, 40), z = rand(rng, -40, 40);
    if (planet.waterLevel !== null && terrain.heightAt(x, z) < planet.waterLevel + 1.2) continue;
    if (terrain.slopeAt(x, z) < 0.3) { spawn = { x, z }; break; }
  }

  // ── plant placement ──
  const colliders = [];   // { x, z, r }  trunk collisions
  const plantIndex = [];  // { x, z, h, label }  for the HUD "nearest giant"
  const R = TERRAIN_SIZE * 0.42;

  const placeables = (list, ranges, countScale, collide, labeler) => {
    for (const id of list) {
      const builder = (list === planet.species) ? SPECIES[id] : GROUND_FLORA[id];
      if (!builder) continue;
      const range = ranges[id] || [10, 20];
      const baseCount = (list === planet.species) ? 34 : 1500;
      const count = Math.max(6, Math.round(baseCount * countScale));
      const Href = (range[0] + range[1]) * 0.5 * planet.floraScale;
      const built = builder(Href, mulberry32(planet.seed + id.length * 977));
      if (!built) continue;

      const dummy = new THREE.Object3D();
      const buckets = [];
      const pushBucket = (geometry, mat) => {
        if (!geometry) return;
        track(geometry);
        const im = new THREE.InstancedMesh(geometry, mat, count);
        im.castShadow = q.shadow && collide;
        im.receiveShadow = q.shadow;
        im.frustumCulled = false;
        scene.add(im);
        buckets.push(im);
      };
      pushBucket(built.bark, barkMat);
      pushBucket(built.leaf, leafMats[id.length % leafMats.length]);
      pushBucket(built.glow, glowMat);
      if (!buckets.length) continue;

      const col = new THREE.Color();
      let placed = 0, guard = 0;
      // clump the ground cover into meadow patches instead of uniform noise
      const patches = [];
      for (let i = 0; i < 8; i++) {   // always some cover around where you land
        patches.push({
          x: spawn.x + rand(rng, -30, 30), z: spawn.z + rand(rng, -30, 30),
          s: rand(rng, 14, 34),
        });
      }
      for (let i = 0; i < 30; i++) {
        const pa = rng() * Math.PI * 2, pr = Math.sqrt(rng()) * R * 0.9;
        patches.push({ x: Math.cos(pa) * pr, z: Math.sin(pa) * pr, s: rand(rng, 18, 55) });
      }
      while (placed < count && guard < count * 30) {
        guard++;
        let x, z;
        if (collide || rng() < 0.12) {
          const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * R;
          x = Math.cos(a) * rr; z = Math.sin(a) * rr;
        } else {
          const pc = patches[(rng() * patches.length) | 0];
          x = pc.x + (rng() + rng() - 1) * pc.s;
          z = pc.z + (rng() + rng() - 1) * pc.s;
          if (Math.hypot(x, z) > R) continue;
        }
        const y = terrain.heightAt(x, z);
        if (planet.waterLevel !== null && y < planet.waterLevel - 0.8) continue;
        if (collide && terrain.slopeAt(x, z) > 0.62) continue;
        const s = rand(rng, 0.72, 1.28);
        // keep giants apart so you can actually walk between them
        if (collide) {
          const need = (built.radius || 1) * s * 2.6 + 7;
          let ok = true;
          for (let k = colliders.length - 1; k >= 0 && k > colliders.length - 260; k--) {
            const c = colliders[k];
            const dx = c.x - x, dz = c.z - z;
            if (dx * dx + dz * dz < need * need) { ok = false; break; }
          }
          if (!ok) continue;
        }
        dummy.position.set(x, y - 0.4, z);
        dummy.rotation.set(0, rng() * Math.PI * 2, rand(rng, -0.05, 0.05));
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        for (const im of buckets) {
          im.setMatrixAt(placed, dummy.matrix);
          col.setRGB(rand(rng, 0.82, 1.14), rand(rng, 0.85, 1.12), rand(rng, 0.82, 1.12));
          im.setColorAt(placed, col);
        }
        if (collide) {
          colliders.push({ x, z, r: Math.max(0.9, (built.radius || 1) * s) });
          plantIndex.push({ x, z, h: (built.height || Href) * s, label: labeler(id) });
        }
        placed++;
      }
      for (const im of buckets) {
        im.count = placed;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  };

  placeables(planet.species, SPECIES_RANGE, planet.floraDensity * q.giants, true, speciesLabel);

  const groundList = ['grassTuft', 'fernClump'];
  if (planet.glow > 0.35) groundList.push('glowBulb');
  placeables(groundList, GROUND_RANGE, planet.floraDensity * q.cover, false, speciesLabel);

  // ── drifting spores / pollen ──
  const sporeCount = planet.night ? 900 : 450;
  const sp = new Float32Array(sporeCount * 3);
  for (let i = 0; i < sporeCount; i++) {
    sp[i * 3] = rand(rng, -160, 160);
    sp[i * 3 + 1] = rand(rng, 1, 90);
    sp[i * 3 + 2] = rand(rng, -160, 160);
  }
  const spGeo = track(new THREE.BufferGeometry());
  spGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const sc = document.createElement('canvas');
  sc.width = sc.height = 64;
  const sg = sc.getContext('2d');
  const sgrad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
  sgrad.addColorStop(0, 'rgba(255,255,255,1)');
  sgrad.addColorStop(0.35, 'rgba(255,255,255,.75)');
  sgrad.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = sgrad; sg.fillRect(0, 0, 64, 64);
  const sTex = track(new THREE.CanvasTexture(sc));
  const spMat = track(new THREE.PointsMaterial({
    color: new THREE.Color(pal.bloom), size: planet.night ? 0.7 : 0.42,
    map: sTex, transparent: true, opacity: planet.night ? 0.9 : 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  const spores = new THREE.Points(spGeo, spMat);
  spores.position.set(0, 0, 0);
  scene.add(spores);

  const tallest = plantIndex.reduce((m, p) => Math.max(m, p.h), 0);

  return {
    planet, scene, terrain, colliders, plantIndex, spores, sporeCount,
    sun, sunTarget: sun.target, water, quality: q, qualityKey,
    spawn: { x: spawn.x, y: terrain.heightAt(spawn.x, spawn.z), z: spawn.z },
    tallest,
    stats: {
      giants: plantIndex.length,
      tris: (() => {
        let t = 0;
        scene.traverse((o) => {
          if (o.isMesh && o.geometry) {
            const g = o.geometry;
            const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
            t += n * (o.isInstancedMesh ? o.count : 1);
          }
        });
        return Math.round(t);
      })(),
    },
    dispose(renderer) {
      for (const d of disposables) { if (d && typeof d.dispose === 'function') d.dispose(); }
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      });
      scene.clear();
      renderer?.renderLists?.dispose?.();
    },
  };
}
