// sky.js — procedural atmosphere: analytic sky dome, baked cloud panoramas, weather, lights
import * as THREE from 'three';
import { NOISE, SKY } from './glsl.js';
import { clamp, lerp, smoothstep, mulberry32, Noise, ctx2d, texFromCanvas, TAU } from './util.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always at far plane
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon, uGround, uSunCol;
uniform float uStorm, uFlash, uTime, uNight, uCloudRot, uCloudH, uSunSize;
uniform sampler2D uCloudA, uCloudB;
uniform float uCloudAOn, uCloudBOn;
${NOISE}
${SKY}

/* The cloud panoramas are baked in equirectangular space (u = azimuth/2π, v = elevation/(π/2),
   v = 1 at the zenith), so sample them exactly like that instead of re-projecting the noise
   domain: the old flat-plane lookup (dir.xz/dir.y + fract) blew up near the horizon, where the
   coordinates race to infinity, and turned the sky into radial moiré streaks. */
vec4 sampleClouds(sampler2D tex, vec3 dir, float drift, float vScale, float vBias){
  if (dir.y < 0.006) return vec4(0.0);
  float u = atan(dir.z, dir.x) * 0.15915494 + 0.5;
  float v = asin(clamp(dir.y, 0.0, 1.0)) * 0.63661977;
  vec2 p = vec2(u + drift * uTime * 0.0009, v * vScale + vBias);
  vec4 c = texture2D(tex, p);
  // fade into the haze band at the horizon (the panorama's bottom rows are the cloud bases)
  c.a *= smoothstep(0.008, 0.055, dir.y);
  return c;
}

void main(){
  vec3 dir = normalize(vDir);
  vec3 sunDir = normalize(uSunDir);
  vec3 col = skyRadiance(dir, sunDir, uZenith, uHorizon, uGround, uSunCol, uSunSize);

  // ---- clouds: two baked panoramic layers (fair weather + storm) ----
  vec3 cA = vec3(0.0); float aA = 0.0;
  vec4 s = sampleClouds(uCloudA, dir, 1.0, 0.98, 0.01);
  cA = s.rgb; aA = s.a * uCloudAOn;
  vec4 s2 = sampleClouds(uCloudB, dir, 2.1, 0.88, 0.06);
  vec3 cB = s2.rgb; float aB = s2.a * uCloudBOn;
  vec3 cloudCol = mix(cA, cB, clamp(aB/(aA+aB+1e-4), 0.0, 1.0));
  float cloudA = clamp(aA + aB, 0.0, 1.0);
  // storm darkening + silver lining toward the sun
  float mu = max(dot(dir, sunDir), 0.0);
  cloudCol *= mix(1.0, 0.42, uStorm);
  cloudCol += uSunCol * pow(mu, 6.0) * 0.25 * (1.0-uStorm*0.7);
  col = mix(col, cloudCol, cloudA);

  // ---- night stars ----
  if (uNight > 0.01) {
    vec2 sp = dir.xz / max(dir.y, 0.06);
    float st = hash21(floor(sp*90.0));
    float twinkle = 0.6 + 0.4*sin(uTime*2.0 + st*40.0);
    float star = smoothstep(0.9985, 1.0, st) * twinkle * smoothstep(0.0, 0.25, dir.y) * uNight;
    col += vec3(0.9,0.95,1.0) * star * 2.0;
    // moon
    vec3 moonDir = -sunDir;
    float md = dot(dir, normalize(moonDir));
    col += vec3(0.9,0.93,1.0) * (smoothstep(0.9990,0.9997,md)*3.0 + pow(max(md,0.0),120.0)*0.3) * uNight;
  }

  // ---- lightning flash ----
  col += vec3(0.8,0.85,1.0) * uFlash * (0.6 + cloudA);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function bakeCloudPanorama({ w = 640, h = 320, seed = 12, cover = 0.45, soft = 1.0, brightness = 1.0, tint = [1, 1, 1], stormy = 0 } = {}) {
  const { c, x } = ctx2d(w, h);
  const img = x.createImageData(w, h);
  const nz = new Noise(seed);
  const lightAz = 0.0;
  const lx = Math.cos(lightAz), lz = Math.sin(lightAz);
  for (let y = 0; y < h; y++) {
    // equirect: v=0 top (zenith), v=1 horizon
    const elev = (1 - y / h) * Math.PI * 0.5;
    const sy = Math.sin(elev), cy = Math.cos(elev);
    for (let px = 0; px < w; px++) {
      const az = (px / w) * TAU;
      const i = (y * w + px) * 4;
      if (sy < 0.02) { img.data[i + 3] = 0; continue; }
      // project to a flat cloud deck
      const p = 1 / Math.max(sy, 0.02) * 0.6;
      const cx = Math.cos(az) * p * cy, cz = Math.sin(az) * p * cy;
      const height = elev * 0.8;
      // coverage field
      let d = nz.fbm(cx * 0.8 + 11, cz * 0.8 - 3, 5, 2.05, 0.55) * 0.5 + 0.5;
      d += 0.25 * (nz.fbm(cx * 2.4, cz * 2.4, 3) * 0.5 + 0.5);
      d -= cover;
      let a = clamp(d * 2.6 * soft, 0, 1);
      a = Math.pow(a, 0.9);
      // fade near the horizon (perspective compression) and only in the upper half
      a *= smoothstep(0.0, 0.10, sy) * (1 - smoothstep(0.55, 1.0, elev / (Math.PI / 2)) * 0.05);
      if (stormy) a = Math.pow(a, 0.55);
      // shading: sample density offset toward the light for a shadowed base
      const dOff = nz.fbm((cx + lx * 0.16) * 0.8 + 11, (cz + lz * 0.16) * 0.8 - 3, 4) * 0.5 + 0.5 - cover;
      const shade = clamp(0.5 - dOff * 2.2, -1, 1);
      const top = clamp(0.55 + shade * 0.5, 0, 1);
      let g = lerp(0.36, 1.05, top) * brightness * lerp(1, 0.55, stormy);
      const r = g * tint[0] * lerp(1.0, 0.86, stormy);
      const gg = g * tint[1] * lerp(1.0, 0.88, stormy);
      const b = g * tint[2] * lerp(1.0, 1.05, stormy);
      img.data[i] = clamp(r, 0, 255); img.data[i + 1] = clamp(gg, 0, 255); img.data[i + 2] = clamp(b, 0, 255); img.data[i + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

export class Sky {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6) },
          uZenith: { value: new THREE.Color(0.18, 0.36, 0.72) },
          uHorizon: { value: new THREE.Color(0.72, 0.80, 0.90) },
          uGround: { value: new THREE.Color(0.30, 0.30, 0.30) },
          uSunCol: { value: new THREE.Color(1.0, 0.92, 0.78) },
          uStorm: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 },
          uNight: { value: 0 }, uCloudRot: { value: 0 }, uCloudH: { value: 1 }, uSunSize: { value: 0.0004 },
          uCloudA: { value: null }, uCloudB: { value: null }, uCloudAOn: { value: 1 }, uCloudBOn: { value: 0 },
          uCloudAOn2: { value: 0 },
        },
      })
    );
    this.mesh.scale.setScalar(9000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    this.clouds = { fair: null, storm: null };
    this.sunDir = new THREE.Vector3(0.35, 0.55, 0.75).normalize();

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xfff2dc, 3.1);
    this.sun.castShadow = true;
    const sh = quality === 'low' ? 1024 : quality === 'ultra' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sh, sh);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1200;
    this.shadowExtent = quality === 'low' ? 90 : 140;
    const e = this.shadowExtent;
    this.sun.shadow.camera.left = -e; this.sun.shadow.camera.right = e;
    this.sun.shadow.camera.top = e; this.sun.shadow.camera.bottom = -e;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6b6350, 0.85);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x8899bb, 0.25);
    scene.add(this.ambient);

    this.storm = 0; this.stormTarget = 0;
    this.flash = 0; this.flashTimer = 6 + Math.random() * 10;
    this.timeOfDay = 0.28;
    this.turbidity = 0.4;
    this.fog = new THREE.FogExp2(0xa8c4dd, 0.00035);
    scene.fog = this.fog;
    this.setTimeOfDay(this.timeOfDay);
  }

  /** bake cloud panoramas (called during loading) */
  bakeClouds(onProgress) {
    const q = this.quality;
    const w = q === 'low' ? 384 : q === 'medium' ? 512 : 768;
    const h = w / 2;
    if (onProgress) onProgress(0.4);
    this.clouds.fair = texFromCanvas(bakeCloudPanorama({ w, h, seed: 21, cover: 0.52, brightness: 1.0 }), { srgb: false, wrap: THREE.RepeatWrapping });
    if (onProgress) onProgress(0.75);
    this.clouds.storm = texFromCanvas(bakeCloudPanorama({ w, h, seed: 77, cover: 0.30, brightness: 0.85, soft: 1.5, stormy: 1, tint: [0.86, 0.88, 0.95] }), { srgb: false, wrap: THREE.RepeatWrapping });
    const u = this.mesh.material.uniforms;
    u.uCloudA.value = this.clouds.fair;
    u.uCloudB.value = this.clouds.storm;
    if (onProgress) onProgress(1);
  }

  setTimeOfDay(t) {
    this.timeOfDay = t;
    // t: 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
    const sunAngle = (t - 0.0) * TAU; // 0 → east horizon
    const elev = Math.sin(Math.PI * (t * 2)) ; // 0..1..0 over the day half
    const dayElev = Math.sin((t) * Math.PI * 2 - Math.PI * 0.5);
    // Keep it simple & controllable: sun sweep from east to west
    const az = lerp(-1.15, 1.15, clamp(t / 0.5, 0, 1)) * Math.PI * 0.5 - Math.PI * 0.5;
    const el = Math.sin(clamp(t / 0.5, 0, 1) * Math.PI) * (Math.PI * 0.42) + 0.02;
    const el2 = t > 0.5 ? -Math.sin((t - 0.5) * 2 * Math.PI) * 0.5 - 0.02 : el;
    const e = t > 0.5 ? Math.max(el2, -0.3) : el;
    void elev; void dayElev; void sunAngle;
    this.sunDir.set(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)).normalize();
    this.updatePalette(e);
  }

  updatePalette(elev) {
    const dayness = smoothstep(-0.08, 0.22, elev);
    const golden = clamp(1 - Math.abs(elev - 0.12) / 0.30, 0, 1) * dayness;
    const night = 1 - smoothstep(-0.14, 0.05, elev);
    const storm = this.storm;

    const zenith = new THREE.Color(0.24, 0.45, 0.85).lerp(new THREE.Color(0.05, 0.09, 0.22), night);
    const horizonDay = new THREE.Color(0.80, 0.87, 0.96);
    const horizonGold = new THREE.Color(1.0, 0.62, 0.34);
    let horizon = horizonDay.clone().lerp(horizonGold, golden).lerp(new THREE.Color(0.06, 0.09, 0.18), night);
    const sunCol = new THREE.Color(1.0, 0.95, 0.85).lerp(new THREE.Color(1.0, 0.45, 0.16), golden).lerp(new THREE.Color(0.55, 0.62, 0.9), night);
    // storm: desaturate + darken everything
    const gray = new THREE.Color(0.34, 0.36, 0.39);
    horizon.lerp(gray, storm * 0.85);
    zenith.lerp(new THREE.Color(0.10, 0.11, 0.13), storm * 0.9);
    const sIntensity = lerp(3.1, 0.9, storm) * lerp(1, 0.08, night);
    this.sun.intensity = sIntensity;
    this.sun.color.copy(sunCol);
    this.hemi.intensity = lerp(0.85, 0.45, storm) * lerp(1, 0.2, night);
    this.hemi.color.copy(horizon).lerp(new THREE.Color(0x223355), night * 0.6);
    this.ambient.intensity = lerp(0.25, 0.35, storm) * lerp(1, 0.35, night);

    const u = this.mesh.material.uniforms;
    u.uZenith.value.copy(zenith);
    u.uHorizon.value.copy(horizon);
    u.uSunCol.value.copy(sunCol);
    u.uGround.value.copy(horizon).multiplyScalar(0.55);
    u.uNight.value = night;
    u.uSunSize.value = 0.0006 + this.turbidity * 0.0025;
    // fog follows the horizon colour, denser in storms / at night
    this.fog.color.copy(horizon).lerp(zenith, 0.25);
    this.fog.density = lerp(0.00030, 0.0011, storm) * lerp(1, 0.85, night);
    this.palette = { zenith, horizon, sunCol, night, storm, elev };
  }

  setWeather(storm, instant = false) {
    this.stormTarget = clamp(storm, 0, 1);
    if (instant) this.storm = this.stormTarget;
  }

  update(dt, camera) {
    this.storm = Math.abs(this.storm - this.stormTarget) < 0.002 ? this.stormTarget : lerp(this.storm, this.stormTarget, 1 - Math.exp(-0.25 * dt));
    this.setTimeOfDay(this.timeOfDay);
    const u = this.mesh.material.uniforms;
    u.uStorm.value = this.storm;
    u.uCloudAOn.value = 1;
    u.uCloudBOn.value = this.storm;
    u.uTime.value += dt;
    if (this.palette && this.palette.night > 0.5) u.uCloudAOn.value = (1 - this.palette.night) * 0.85;
    // lightning during storms
    if (this.storm > 0.55) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) { this.flash = 1.0; this.flashTimer = 3 + Math.random() * 14; this.lastFlashPos = null; }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    u.uFlash.value = this.flash * 0.8;
    if (this.flash > 0.05) {
      this.hemi.intensity += this.flash * 2.2;
      this.ambient.intensity += this.flash * 1.2;
    }
    // keep dome on the camera & rotate clouds slowly
    this.mesh.position.copy(camera.position);
    this.mesh.rotation.y += dt * 0.0022 * (1 + this.storm * 6);
    u.uCloudRot.value = this.mesh.rotation.y;
    // shadow camera follows the focus point
    this.sun.position.copy(this.sunDir).multiplyScalar(600);
    if (camera.userData.focus) {
      this.sunTarget.position.copy(camera.userData.focus);
      this.sun.position.add(camera.userData.focus);
    } else {
      this.sunTarget.position.set(camera.position.x, 0, camera.position.z);
      this.sun.position.add(this.sunTarget.position);
    }
  }

  /** approximate fog colour for external users (water, HUD) */
  get horizonColor() { return this.fog ? this.fog.color : new THREE.Color(0.7, 0.8, 0.9); }
  get sunLight() { return this.sun; }
}
