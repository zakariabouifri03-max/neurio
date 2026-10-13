// ── Neurio City · sky, day/night cycle, lighting ───────────────────────────
// A procedural sky dome (gradient + sun glow + fbm clouds + stars). The same
// shader is rendered into a PMREM environment so reflections on paint, glass
// and wet asphalt follow the time of day. Everything is driven by one clock.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.999999;   // always behind the far plane
}`;

const FRAG = /* glsl */`
uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground;
uniform vec3 sunCol; uniform float sunI; uniform float night; uniform float cloud;
uniform vec3 cloudCol; uniform float time;
varying vec3 vDir;

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col = mix(ground, col, smoothstep(-0.05, 0.015, h));

  float sd = max(dot(d, sunDir), 0.0);
  col += sunCol * (pow(sd, 7.0) * 0.32 + pow(sd, 90.0) * 0.55) * sunI;
  col += sunCol * smoothstep(0.99935, 0.99975, sd) * 24.0 * sunI;

  if (night > 0.01 && h > -0.02) {
    vec3 q = floor(d * 240.0);
    float s = step(0.9968, hash13(q)) * (0.5 + 0.5 * hash13(q + 3.7));
    col += vec3(0.85, 0.9, 1.0) * s * night * smoothstep(-0.02, 0.25, h) * 1.8;
  }

  if (h > 0.005) {
    vec2 p = d.xz / (h + 0.18) * 1.5 + vec2(time * 0.010, time * 0.004);
    float c = fbm(p);
    float cov = smoothstep(1.0 - cloud, 1.0 - cloud + 0.3, c);
    float lit = 0.75 + 0.35 * pow(sd, 2.0);
    col = mix(col, cloudCol * lit, cov * smoothstep(0.005, 0.22, h) * 0.92);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixC = (a, b, t) => new THREE.Color().copy(a).lerp(b, t);

const C = {
  dayZen: new THREE.Color('#2f78d2'), dayHor: new THREE.Color('#bddfff'),
  nightZen: new THREE.Color('#02040b'), nightHor: new THREE.Color('#111c35'),
  sunsetHor: new THREE.Color('#ff8a4c'), sunsetZen: new THREE.Color('#4b4f93'),
  dayGround: new THREE.Color('#6d7f66'), nightGround: new THREE.Color('#06080d'),
  sunDay: new THREE.Color('#fff6e6'), sunSet: new THREE.Color('#ffa868'),
  moon: new THREE.Color('#9bb8ff'),
  cloudDay: new THREE.Color('#f4f6fa'), cloudNight: new THREE.Color('#1a2130'),
  hemiDay: new THREE.Color('#9cc8ff'), hemiNight: new THREE.Color('#1c2a48'),
};

/** One source of truth for the sky, sun, moon, fog and the city's lamps. */
export function dayState(t) {
  const h = ((t - 6) / 12) * Math.PI;          // 06:00 sunrise, 18:00 sunset
  const se = Math.sin(h);
  const sunDir = new THREE.Vector3(Math.cos(h), se, 0.35).normalize();
  const moonDir = new THREE.Vector3(-Math.cos(h) * 0.55, 0.8, -0.35).normalize();
  const day = smooth(-0.08, 0.2, se);
  const night = smooth(0.05, -0.2, se);
  const sunset = Math.exp(-Math.pow(se / 0.16, 2));
  return { t, se, sunDir, moonDir, day, night, sunset };
}

export function createSky() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
    sunCol: { value: new THREE.Color() }, sunI: { value: 1 }, night: { value: 0 },
    cloud: { value: 0.4 }, cloudCol: { value: new THREE.Color() }, time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.SphereGeometry(2600, 40, 20);
  const mesh = new THREE.Mesh(dome, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), mat);
  envMesh.frustumCulled = false;

  /** Applies a dayState + rain amount to every sky, light and fog parameter. */
  function apply(ds, rain) {
    const { day, night, sunset, sunDir } = ds;
    uniforms.sunDir.value.copy(sunDir);
    const zen = mixC(C.nightZen, C.dayZen, day).lerp(C.sunsetZen, sunset * 0.35);
    const hor = mixC(C.nightHor, C.dayHor, day).lerp(C.sunsetHor, sunset * 0.85);
    const gnd = mixC(C.nightGround, C.dayGround, day);
    const greyed = (c) => c.clone().lerp(new THREE.Color('#4b5563'), rain * 0.7);
    uniforms.zenith.value.copy(greyed(zen));
    uniforms.horizon.value.copy(greyed(hor));
    uniforms.ground.value.copy(gnd);
    uniforms.sunCol.value.copy(mixC(C.sunDay, C.sunSet, sunset * 0.8));
    uniforms.sunI.value = day;
    uniforms.night.value = night;
    uniforms.cloud.value = 0.42 + rain * 0.42;
    uniforms.cloudCol.value.copy(mixC(C.cloudNight, C.cloudDay, day).lerp(new THREE.Color('#5b6270'), rain * 0.7));
    return { horizon: uniforms.horizon.value };
  }

  return { mesh, envMesh, uniforms, apply, material: mat };
}

/** Key light (sun by day, cool moon by night), hemisphere fill, colours. */
export function applyLights(ds, rain, key, hemi, sky) {
  const { day, night, sunset, sunDir, moonDir } = ds;
  key.position.copy(new THREE.Vector3().lerpVectors(moonDir, sunDir, day).normalize());
  key.color.copy(mixC(C.moon, C.sunDay, day).lerp(C.sunSet, sunset * 0.6));
  key.intensity = (0.32 + 3.1 * day) * (1 - rain * 0.55);
  hemi.color.copy(mixC(C.hemiNight, C.hemiDay, day));
  hemi.groundColor.setRGB(0.12, 0.11, 0.1).lerp(new THREE.Color(0.08, 0.1, 0.13), night);
  hemi.intensity = (0.3 + 0.75 * day) * (1 - rain * 0.3);
  void sky;
}
