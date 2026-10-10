// BLOCK CITY ULTRA — time of day + weather (browser vertical slice)
// Mirrors World/BCUEnvironmentSystem.cpp: solar azimuth/elevation from a real
// hour-angle model, wetness that lingers after rain, volumetric-ish fog, and a
// night factor that drives every emissive material in the city.

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp } from './util.js';

export const WEATHERS = ['Clear', 'PartlyCloudy', 'Overcast', 'LightRain', 'HeavyRain', 'Storm', 'Fog'];

const WEATHER_TARGETS = {
  Clear:        { intensity: 0.0,  fog: 0.0016, wind: 6,  cloud: 0.25 },
  PartlyCloudy: { intensity: 0.0,  fog: 0.0021, wind: 12, cloud: 0.45 },
  Overcast:     { intensity: 0.0,  fog: 0.0032, wind: 16, cloud: 0.95 },
  LightRain:    { intensity: 0.3,  fog: 0.0040, wind: 22, cloud: 0.62 },
  HeavyRain:    { intensity: 0.7,  fog: 0.0056, wind: 38, cloud: 0.85 },
  Storm:        { intensity: 1.0,  fog: 0.0072, wind: 68, cloud: 1.0 },
  Fog:          { intensity: 0.0,  fog: 0.0120, wind: 4,  cloud: 0.5 },
};

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.timeOfDay = 8.5;          // hours
    this.secondsPerHour = 60;      // 24 min per full day
    this.autoAdvance = true;
    this.latitude = 34;

    this.weatherName = 'Clear';
    this.weatherTarget = 'Clear';
    this.intensity = 0;
    this.wetness = 0;
    this.wind = 8;
    this.fogDensity = 0.0016;
    this.cloudCoverage = 0.25;
    this.lightningTimer = 8;
    this.flash = 0;

    // ---- lights ---------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 220;
    this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9dbbe0, 0x4a4a44, 0.9);
    scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.15);
    scene.add(this.ambient);

    // ---- sky dome ----------------------------------------------------------------
    const skyGeo = new THREE.SphereGeometry(2600, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2b6bd6) },
        midColor: { value: new THREE.Color(0x9dc4ea) },
        botColor: { value: new THREE.Color(0xdfe7ef) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffd9a0) },
        sunIntensity: { value: 1 },
        cloud: { value: 0.25 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor, midColor, botColor, sunColor;
        uniform vec3 sunDir;
        uniform float sunIntensity, cloud;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(botColor, midColor, smoothstep(0.35, 0.55, h));
          col = mix(col, topColor, smoothstep(0.55, 1.0, h));
          // sun disc + glow
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * pow(sd, 900.0) * 12.0 * sunIntensity;
          col += sunColor * pow(sd, 8.0) * 0.45 * sunIntensity;
          // cheap cloud bands
          float band = hash(floor(vec2(d.x * 22.0, d.z * 22.0 + d.y * 30.0)));
          float cover = smoothstep(0.35, 0.75, h) * cloud;
          col = mix(col, mix(vec3(0.75), vec3(0.30), 1.0 - sunIntensity), band * cover * 0.55);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    scene.fog = new THREE.FogExp2(0x9aa8bb, this.fogDensity);

    // ---- rain --------------------------------------------------------------------
    const n = 9000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 420;
      pos[i * 3 + 1] = Math.random() * 130;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 420;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({
      color: 0xbdd4f0, size: 0.35, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    this.onWetnessChange = null;
  }

  setTime(h) { this.timeOfDay = ((h % 24) + 24) % 24; this._updateSun(0); }
  setWeather(name, blend = 8) { this.weatherTarget = name; this.blend = blend; }
  get isNight() { return this.timeOfDay < 6 || this.timeOfDay > 20; }

  get nightFactor() {
    const t = this.timeOfDay;
    if (t >= 22 || t <= 4.5) return 1;
    if (t >= 8 && t <= 17.5) return 0;
    if (t > 17.5) return clamp((t - 17.5) / 4.5, 0, 1);
    return clamp((8 - t) / 3.5, 0, 1);
  }

  _updateSun(dt) {
    const t = this.timeOfDay;
    const hourAngle = ((t - 12) / 24) * 360;
    const decl = 23.44 * Math.sin((360 / 365) * (284 + 100) * Math.PI / 180);
    const lat = this.latitude * Math.PI / 180;
    const dec = decl * Math.PI / 180;
    const ha = hourAngle * Math.PI / 180;

    const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
    const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * 180 / Math.PI;

    let cosAz = (Math.sin(dec) - Math.sin(lat) * sinEl) /
      (Math.cos(lat) * Math.cos(Math.asin(Math.max(-1, Math.min(1, sinEl)))) + 1e-6);
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
    if (hourAngle > 0) azimuth = 360 - azimuth;

    const az = (azimuth + 180) * Math.PI / 180;
    const el = elevation * Math.PI / 180;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    );

    // Sun sits 400 m away and follows the camera target so shadows stay stable.
    this.sunDir = dir;
    this.sunElevation = elevation;

    const daylight = clamp(Math.sin(Math.max(0, elevation + 6) * Math.PI / 180), 0, 1);
    const night = this.nightFactor;

    const noon = new THREE.Color(0xfff6e8);
    const golden = new THREE.Color(0xff8a3c);
    const nightCol = new THREE.Color(0x1a2340);
    const goldenness = 1 - clamp(daylight * 2.2, 0, 1);
    const col = noon.clone().lerp(golden, goldenness).lerp(nightCol, 1 - clamp(daylight * 4, 0, 1));

    const flashBoost = 1 + this.flash * 7;
    this.sun.color.copy(col);
    this.sun.intensity = lerp(0.15, 3.4, daylight) * (1 - night * 0.9) * flashBoost
      * (1 - this.cloudCoverage * 0.45);
    this.sun.castShadow = elevation > -2;

    this.hemi.intensity = lerp(0.15, 1.25, daylight) * (1 - night * 0.75) * flashBoost;
    this.hemi.color.copy(col).lerp(new THREE.Color(0x9dbbe0), 0.45);
    this.ambient.intensity = lerp(0.35, 0.06, daylight) * flashBoost;

    // sky colours
    const u = this.skyMat.uniforms;
    u.sunDir.value.copy(dir);
    u.sunColor.value.copy(col);
    u.sunIntensity.value = clamp(daylight * 1.2, 0.02, 1) * flashBoost;
    u.cloud.value = this.cloudCoverage;
    const day = 1 - night;
    u.topColor.value.setHex(0x2b6bd6).lerp(new THREE.Color(0x05070f), night);
    u.midColor.value.setHex(0x9dc4ea).lerp(new THREE.Color(0x0b1024), night);
    u.botColor.value.copy(col).lerp(new THREE.Color(0x18203a), night * 0.85);
    if (elevation < 8 && elevation > -8) {
      u.botColor.value.lerp(golden, (1 - Math.abs(elevation) / 8) * 0.6);
    }

    // fog follows weather + daylight
    const fogCol = new THREE.Color(0x9aa8bb).lerp(new THREE.Color(0x0a0e1a), night)
      .lerp(new THREE.Color(0x8892a0), this.intensity * 0.5);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = this.fogDensity * (1 + (1 - daylight) * 0.55);
    this.renderer.setClearColor(fogCol);

    // shadow camera follows the sun direction
    if (this.shadowAnchor) {
      this.sun.target.position.copy(this.shadowAnchor);
      this.sun.position.copy(this.shadowAnchor).addScaledVector(dir, 320);
      this.sun.target.updateMatrixWorld();
    }
  }

  update(dt, time, anchor) {
    if (this.autoAdvance) this.timeOfDay = (this.timeOfDay + dt / this.secondsPerHour) % 24;
    if (anchor) this.shadowAnchor = anchor;

    // ---- weather blend ------------------------------------------------------------
    const target = WEATHER_TARGETS[this.weatherTarget] ?? WEATHER_TARGETS.Clear;
    this.intensity = damp(this.intensity, target.intensity, 0.5, dt);
    this.wind = damp(this.wind, target.wind, 0.4, dt);
    this.fogDensity = damp(this.fogDensity, target.fog, 0.5, dt);
    this.cloudCoverage = damp(this.cloudCoverage, target.cloud, 0.35, dt);

    const raining = this.intensity > 0.05;
    this.wetness = damp(this.wetness, raining ? 1 : 0, raining ? 0.35 : 0.02, dt);
    if (this.onWetnessChange) this.onWetnessChange(this.wetness);

    if (this.weatherName !== this.weatherTarget && Math.abs(this.intensity - target.intensity) < 0.02) {
      this.weatherName = this.weatherTarget;
    }

    // ---- lightning ------------------------------------------------------------------
    if (this.weatherTarget === 'Storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 12;
        this.flash = 1;
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5.5);

    // ---- rain particles --------------------------------------------------------------
    const rp = this.rain.geometry.attributes.position;
    const fall = (60 + this.wind * 1.2) * dt;
    for (let i = 0; i < rp.count; i++) {
      let y = rp.getY(i) - fall;
      let x = rp.getX(i) + this.wind * dt * 0.6;
      if (y < 0) { y += 130; x = (Math.random() - 0.5) * 420; }
      rp.setY(i, y); rp.setX(i, x);
    }
    rp.needsUpdate = true;
    this.rain.material.opacity = clamp(this.intensity * 1.4, 0, 0.85);
    if (anchor) this.rain.position.set(anchor.x, 0, anchor.z);

    this._updateSun(dt);
    this.sky.position.set(anchor?.x ?? 0, 0, anchor?.z ?? 0);
  }

  get clockString() {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
