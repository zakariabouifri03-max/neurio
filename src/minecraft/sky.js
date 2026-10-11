// ═══════════════════════════════════════════════════════════════════════════
//  SKY + LIGHTING RIG — procedural gradient dome (sun, moon, stars),
//  drifting voxel clouds, directional sun/moon lights with soft shadows,
//  hemisphere fill and a PMREM environment probe regenerated from the sky so
//  every PBR material gets real image-based lighting that follows time of day.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mulberry32, clamp, lerp } from '../util.js';

const C = (h) => new THREE.Color(h);

// keyframes: hour → palette. Interpolated around the 24 h clock.
const KEYS = [
  { h: 0.0, zen: '#05070f', hor: '#0a1020', sun: '#93a8d8', si: 0.0, moon: '#b9c9f0', mi: 0.34, hemiSky: '#121a30', hemiGnd: '#070a10', hemi: 0.22, fog: '#080c16', star: 1.0, cloud: '#1a2036', amb: 0.16 },
  { h: 4.2, zen: '#0d1330', hor: '#37294d', sun: '#b07a9a', si: 0.0, moon: '#9fb2dd', mi: 0.22, hemiSky: '#2a2b4d', hemiGnd: '#0c0d16', hemi: 0.34, fog: '#221c33', star: 0.55, cloud: '#3a3352', amb: 0.2 },
  { h: 5.6, zen: '#2a3f77', hor: '#e0814e', sun: '#ff9a4d', si: 1.5, moon: '#8d9fd0', mi: 0.06, hemiSky: '#6d7fb5', hemiGnd: '#2a2419', hemi: 0.72, fog: '#c98a63', star: 0.06, cloud: '#e7a077', amb: 0.34 },
  { h: 7.2, zen: '#3d7fd4', hor: '#ffd9a6', sun: '#ffd7a0', si: 3.1, moon: '#ffffff', mi: 0.0, hemiSky: '#9dc6f2', hemiGnd: '#4c4530', hemi: 1.05, fog: '#cfe4f5', star: 0.0, cloud: '#fff1de', amb: 0.5 },
  { h: 12.0, zen: '#2f78d8', hor: '#b6dcf7', sun: '#fffaf0', si: 4.4, moon: '#ffffff', mi: 0.0, hemiSky: '#a9d8ff', hemiGnd: '#5e5a44', hemi: 1.25, fog: '#cfe6fa', star: 0.0, cloud: '#ffffff', amb: 0.6 },
  { h: 16.6, zen: '#3a72c4', hor: '#ffd9a0', sun: '#ffdca8', si: 3.3, moon: '#ffffff', mi: 0.0, hemiSky: '#a6cdf0', hemiGnd: '#5b5238', hemi: 1.05, fog: '#e2d5bb', star: 0.0, cloud: '#fff0d6', amb: 0.5 },
  { h: 18.6, zen: '#28356b', hor: '#f2793f', sun: '#ff7f3a', si: 1.6, moon: '#c8d4f2', mi: 0.05, hemiSky: '#6f6796', hemiGnd: '#2e2418', hemi: 0.7, fog: '#c4714a', star: 0.12, cloud: '#f09a63', amb: 0.34 },
  { h: 20.0, zen: '#0b1130', hor: '#2b2246', sun: '#8a6fa8', si: 0.05, moon: '#c2d0f4', mi: 0.28, hemiSky: '#25294a', hemiGnd: '#0b0d15', hemi: 0.34, fog: '#171527', star: 0.75, cloud: '#332e4c', amb: 0.2 },
  { h: 24.0, zen: '#05070f', hor: '#0a1020', sun: '#93a8d8', si: 0.0, moon: '#b9c9f0', mi: 0.34, hemiSky: '#121a30', hemiGnd: '#070a10', hemi: 0.22, fog: '#080c16', star: 1.0, cloud: '#1a2036', amb: 0.16 },
];

function sampleSky(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) if (h >= KEYS[i].h && h <= KEYS[i + 1].h) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const t = (h - a.h) / Math.max(1e-6, b.h - a.h);
  const mix = (ka, kb) => C(ka).lerp(C(kb), t);
  return {
    zenith: mix(a.zen, b.zen), horizon: mix(a.hor, b.hor),
    sunColor: mix(a.sun, b.sun), moonColor: mix(a.moon, b.moon),
    hemiSky: mix(a.hemiSky, b.hemiSky), hemiGnd: mix(a.hemiGnd, b.hemiGnd),
    fog: mix(a.fog, b.fog), cloud: mix(a.cloud, b.cloud),
    sunI: lerp(a.si, b.si, t), moonI: lerp(a.mi, b.mi, t),
    hemiI: lerp(a.hemi, b.hemi, t), star: lerp(a.star, b.star, t), amb: lerp(a.amb, b.amb, t),
    sunUp: lerp(a.si, b.si, t) > 0.02,
  };
}

// ── star field (equirect) ───────────────────────────────────────────────────
function starTexture(seed = 99) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const rnd = mulberry32(seed);
  // faint milky band
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = h * 0.5 + (rnd() - 0.5) * h * 0.34 + Math.sin(x / w * Math.PI * 2) * 40;
    const a = 0.03 + rnd() * 0.05;
    g.fillStyle = `rgba(150,170,220,${a})`;
    g.fillRect(x, y, 1 + rnd() * 2, 1);
  }
  for (let i = 0; i < 1500; i++) {
    const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h * 0.96);
    const t = rnd();
    const b = 0.35 + t * 0.65;
    const size = t > 0.985 ? 2 : 1;
    const warm = rnd();
    const col = warm < 0.2 ? `rgba(255,214,180,${b})` : warm < 0.35 ? `rgba(190,214,255,${b})` : `rgba(255,255,255,${b})`;
    g.fillStyle = col;
    g.fillRect(x, y, size, size);
    if (size > 1) { g.fillStyle = `rgba(255,255,255,${b * 0.35})`; g.fillRect(x - 1, y, 4, 1); g.fillRect(x, y - 1, 1, 4); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunCol; uniform vec3 uMoonCol;
uniform vec3 uSunDir; uniform float uStar; uniform sampler2D uStars; uniform float uTime;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  float t = pow(h, 0.52);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.42, 0.95, t));
  // warm band right at the horizon
  col = mix(col, uHorizon * 1.06, pow(1.0 - h, 7.0) * 0.75);

  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float disc = smoothstep(0.99925, 0.99965, sd);
  col += uSunCol * disc * 9.0;
  col += uSunCol * pow(sd, 220.0) * 0.85;
  col += uSunCol * pow(sd, 14.0) * 0.22;
  col += uSunCol * pow(sd, 3.0) * 0.055;

  vec3 md = -normalize(uSunDir);
  float mdot = max(dot(d, md), 0.0);
  float mdisc = smoothstep(0.99945, 0.99972, mdot);
  vec3 mcol = uMoonCol * (0.82 + 0.18 * sin(mdot * 4200.0));
  col += mcol * mdisc * 4.2;
  col += uMoonCol * pow(mdot, 900.0) * 0.5;

  // stars (equirect lookup, slow rotation)
  if (uStar > 0.001) {
    vec3 sd3 = normalize(d + vec3(0.0, 0.0, 0.0));
    float u = atan(sd3.z, sd3.x) / 6.2831853 + 0.5 + uTime * 0.0006;
    float v = asin(clamp(sd3.y, -1.0, 1.0)) / 3.1415926 + 0.5;
    vec3 st = texture2D(uStars, vec2(fract(u), v)).rgb;
    float tw = 0.72 + 0.28 * sin(uTime * 2.1 + u * 260.0);
    col += st * uStar * tw * smoothstep(-0.06, 0.22, d.y);
  }

  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.007;   // dither away the gradient banding
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

export class Sky {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = opts.hour ?? 9.2;
    this.autoSpeed = 0.35;          // hours per real minute at 1×
    this.speed = 1;
    this.playing = false;
    this.shadowSize = opts.shadowSize || 3072;
    this.sunDir = new THREE.Vector3(0.4, 0.7, 0.25).normalize();

    // ── dome ───────────────────────────────────────────────────────────────
    this.stars = starTexture();
    this.uniforms = {
      uZenith: { value: C('#2f78d8') }, uHorizon: { value: C('#b6dcf7') },
      uSunCol: { value: C('#fffaf0') }, uMoonCol: { value: C('#c8d4f2') },
      uSunDir: { value: this.sunDir.clone() }, uStar: { value: 0 },
      uStars: { value: this.stars }, uTime: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 40, 24), this.mat);
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    this.dome.name = 'sky';
    scene.add(this.dome);

    // ── lights ─────────────────────────────────────────────────────────────
    this.sun = new THREE.DirectionalLight(0xffffff, 3.6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -72; sc.right = 72; sc.top = 72; sc.bottom = -72; sc.near = 1; sc.far = 420;
    this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.55;
    this.sun.shadow.radius = 2.2;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0xbcd0ff, 0.3);
    this.moon.castShadow = false;
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0xa9d8ff, 0x5e5a44, 1.1);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(this.ambient);

    // ── environment probe (PMREM from the dome) ────────────────────────────
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.envScene = new THREE.Scene();
    this.envMat = this.mat.clone();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), this.envMat);
    this.envScene.add(this.envDome);
    this.envRT = null;
    this._envClock = 0;

    // ── voxel clouds ───────────────────────────────────────────────────────
    this.clouds = new THREE.Group();
    this.clouds.name = 'clouds';
    scene.add(this.clouds);
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.88,
      flatShading: true, depthWrite: false, fog: true,
    });
    this._buildClouds(opts.cloudSeed || 4242, opts.cloudCount ?? 34);

    scene.fog = new THREE.Fog(C('#cfe6fa'), 150, 900);
    this.fog = scene.fog;
    this.setTime(this.hour);
  }

  _buildClouds(seed, count) {
    const rnd = mulberry32(seed);
    const R = 340;
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const cells = 5 + Math.floor(rnd() * 9);
      const parts = [];
      for (let c = 0; c < cells; c++) {
        const w = 6 + rnd() * 16, d = 6 + rnd() * 14;
        const geo = new THREE.BoxGeometry(w, 3.2 + rnd() * 2.4, d);
        geo.translate((rnd() - 0.5) * 26, (rnd() - 0.5) * 2.2, (rnd() - 0.5) * 22);
        parts.push(geo);
      }
      const merged = mergeBoxes(parts);
      const m = new THREE.Mesh(merged, this.cloudMat);
      m.castShadow = false; m.receiveShadow = false;
      g.add(m);
      const a = rnd() * Math.PI * 2, r = 60 + rnd() * R;
      g.position.set(Math.cos(a) * r, 108 + rnd() * 46, Math.sin(a) * r);
      g.userData.speed = 0.5 + rnd() * 1.5;
      g.userData.r = r; g.userData.a = a;
      this.clouds.add(g);
      parts.forEach((p) => p.dispose());
    }
  }

  setTime(hour) {
    this.hour = ((hour % 24) + 24) % 24;
    const s = sampleSky(this.hour);
    this.sky = s;
    const u = this.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uSunCol.value.copy(s.sunColor);
    u.uMoonCol.value.copy(s.moonColor);
    u.uStar.value = s.star;

    // sun travels east→west, tilted so shadows sweep nicely
    const ang = (this.hour / 24) * Math.PI * 2 - Math.PI / 2;
    const elev = Math.sin(ang);
    const dir = new THREE.Vector3(Math.cos(ang) * 0.86, elev, 0.34).normalize();
    this.sunDir.copy(dir);
    u.uSunDir.value.copy(dir);

    const D = 150;
    this.sun.position.copy(dir).multiplyScalar(D);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunI;
    this.sun.visible = s.sunI > 0.001;
    this.moon.position.copy(dir).multiplyScalar(-D);
    this.moon.color.copy(s.moonColor);
    this.moon.intensity = s.moonI;
    this.moon.visible = s.moonI > 0.001;

    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGnd);
    this.hemi.intensity = s.hemiI;
    this.ambient.color.copy(s.hemiSky).lerp(C('#ffffff'), 0.35);
    this.ambient.intensity = s.amb;

    this.fog.color.copy(s.fog);
    this.fog.near = lerp(90, 170, clamp(elev, 0, 1));
    this.fog.far = lerp(620, 1050, clamp(elev, 0, 1));
    this.cloudMat.color.copy(s.cloud);
    this.cloudMat.opacity = lerp(0.5, 0.92, clamp(elev * 0.5 + 0.5, 0, 1));
    this.night = clamp((0.12 - elev) / 0.4, 0, 1);     // 1 = full night
  }

  update(dt, camPos) {
    if (this.playing) this.setTime(this.hour + dt * this.autoSpeed * this.speed / 60);
    this.uniforms.uTime.value += dt;
    // keep the dome centred on the camera so it never clips
    this.dome.position.copy(camPos);
    // clouds drift and wrap
    for (const g of this.clouds.children) {
      g.userData.a += dt * 0.0022 * g.userData.speed;
      g.position.x = Math.cos(g.userData.a) * g.userData.r;
      g.position.z = Math.sin(g.userData.a) * g.userData.r;
    }
    this.clouds.position.set(camPos.x, 0, camPos.z);
    // shadow frustum follows the camera so we keep full resolution nearby
    const p = camPos;
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.position.copy(this.sunDir).multiplyScalar(150).add(new THREE.Vector3(p.x, 0, p.z));
    this.moon.target.position.set(p.x, 0, p.z);
    this.moon.position.copy(this.sunDir).multiplyScalar(-150).add(new THREE.Vector3(p.x, 0, p.z));

    // refresh the environment probe a couple of times a second — the PMREM
    // bake is the only expensive thing here, so it is rate limited
    this._envClock += dt;
    const period = this.playing ? 0.6 : 1.4;
    if (this._envClock > period) { this._envClock = 0; this.refreshEnv(); }
  }

  refreshEnv() {
    if (!this.pmrem || this.pmremEnabled === false) return;
    this.envMat.uniforms.uZenith.value.copy(this.uniforms.uZenith.value);
    this.envMat.uniforms.uHorizon.value.copy(this.uniforms.uHorizon.value);
    this.envMat.uniforms.uSunCol.value.copy(this.uniforms.uSunCol.value);
    this.envMat.uniforms.uMoonCol.value.copy(this.uniforms.uMoonCol.value);
    this.envMat.uniforms.uSunDir.value.copy(this.uniforms.uSunDir.value);
    this.envMat.uniforms.uStar.value = this.uniforms.uStar.value * 0.6;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.85;
  }

  setQuality(shadowSize) {
    this.shadowSize = shadowSize;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }
  dispose() {
    this.dome.geometry.dispose(); this.mat.dispose(); this.envMat.dispose();
    this.stars.dispose(); if (this.envRT) this.envRT.dispose(); this.pmrem.dispose();
  }
}

// merge an array of BoxGeometries without pulling in BufferGeometryUtils
function mergeBoxes(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    pos.set(p, vo * 3); nrm.set(n, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export { sampleSky, starTexture, mergeBoxes, KEYS };
