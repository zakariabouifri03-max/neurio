// ocean.js — Gerstner ocean surface, tsunami fronts & flood (CPU + GPU share one model)
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { clamp, lerp, smoothstep, mulberry32, damp, Noise, ctx2d, TAU } from './util.js';

const MAX_WAVES = 8;
const MAX_FRONTS = 4;

/* ---------------------------------------------------------------- wave model */
export function buildWaveSet(seed, sigHeight, windDir, storm) {
  const rng = mulberry32(seed);
  const out = [];
  const wd = Math.atan2(windDir[1], windDir[0]);
  for (let i = 0; i < MAX_WAVES; i++) {
    const t = i / (MAX_WAVES - 1);
    const len = lerp(96, 6.5, t) * lerp(1, 0.7, storm) * (0.85 + rng() * 0.3);
    const ang = wd + (rng() - 0.5) * (0.8 + t * 1.5);
    const amp = sigHeight * lerp(0.45, 0.05, t) * (0.8 + rng() * 0.4);
    const k = TAU / len;
    out.push({
      dir: [Math.cos(ang), Math.sin(ang)],
      amp, k,
      steep: clamp(0.5 / (k * amp * MAX_WAVES) * (0.7 + rng() * 0.6), 0, 1.0),
      speed: Math.sqrt(9.81 / k),
    });
  }
  return out;
}

function frontProfile(d, lead, trail) {
  if (d > 0) return Math.exp(-Math.pow(d / lead, 1.35));
  return Math.exp(-Math.pow(-d / trail, 1.15));
}

export class Front {
  constructor({ x, z, dirX, dirZ, height, speed, lead = 34, trail = 210 }) {
    const l = Math.hypot(dirX, dirZ) || 1;
    this.dir = [dirX / l, dirZ / l];
    this.x = x; this.z = z;
    this.height = height; this.speed = speed; this.lead = lead; this.trail = trail;
    this.alive = true; this.reachedShore = false; this.t = 0;
    this.sprayPower = 0; this.decay = 0.018;
  }
  update(dt, onShore) {
    if (!this.alive) return;
    this.x += this.dir[0] * this.speed * dt;
    this.z += this.dir[1] * this.speed * dt;
    this.decay += dt * 0.009;
    if (!this.reachedShore && onShore(this.x, this.z)) this.reachedShore = true;
    this.height *= Math.exp(-dt * (this.reachedShore ? this.decay * 2.4 : this.decay));
    this.t += dt;
    if (this.height < 0.3) this.alive = false;
    this.sprayPower = clamp(this.height / 14, 0, 1);
  }
}

/* ---------------------------------------------------------------- geometry */
export function makeDiscGeometry(inner = 1.6, growth = 1.055, rings = 150, segments = 192) {
  const verts = [0, 0, 0];
  const idx = [];
  const radii = [];
  let r = inner;
  for (let i = 0; i < rings; i++) { radii.push(r); r *= growth; }
  for (let i = 0; i < rings; i++) {
    const rr = radii[i];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * TAU;
      verts.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    }
  }
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments;
    idx.push(0, 1 + s2, 1 + s);
  }
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segments, b0 = 1 + (i + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s2, b0 + s);
      idx.push(a0 + s2, b0 + s2, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/** long tsunami crest: dense sampling near the crest line, coarse further out */
export function makeCrestGeometry(width = 1100, aheadLen = 300, behindLen = 1600) {
  const zs = [];
  for (let z = 0; z <= aheadLen; z += 3.5) zs.push(z);
  let step = 1.2;
  for (let z = 0; z > -300; z -= step) { zs.push(z); step *= 1.05; }
  step = 6;
  for (let z = -300; z > -behindLen; z -= step) { zs.push(z); step *= 1.05; }
  zs.sort((a, b) => a - b);
  const xs = [];
  const NX = 192;
  for (let i = 0; i <= NX; i++) xs.push((i / NX - 0.5) * width);
  const verts = [], idx = [], uvs = [];
  for (let zi = 0; zi < zs.length; zi++) for (let xi = 0; xi < xs.length; xi++) {
    verts.push(xs[xi], 0, zs[zi]);
    uvs.push(xi / xs.length, zi / zs.length);
  }
  const S = xs.length;
  for (let zi = 0; zi < zs.length - 1; zi++) for (let xi = 0; xi < S - 1; xi++) {
    const a = zi * S + xi, b = a + 1, c = a + S, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/* ---------------------------------------------------------------- shaders */
const WAVE_UNIFORM_DECL = `
uniform float uTime, uLevel, uAmp;
uniform int uWaveCount;
uniform vec2 uWaveDir[${MAX_WAVES}];
uniform float uWaveAmp[${MAX_WAVES}], uWaveK[${MAX_WAVES}], uWaveSteep[${MAX_WAVES}];
uniform int uFrontCount;
uniform vec4 uFrontPos[${MAX_FRONTS}];  // xy=pos, z=height, w=lead
uniform vec4 uFrontDir[${MAX_FRONTS}];  // xy=dir, z=trail, w=unused
`;

const WATER_DISP = `
float wavePhase(vec2 p, int i){ return uWaveK[i] * dot(uWaveDir[i], p) - sqrt(9.81 * uWaveK[i]) * uTime; }

float surfaceY(vec2 p, out float foam, out float crest) {
  float y = 0.0; foam = 0.0; crest = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    float a = uWaveAmp[i] * uAmp;
    y += a * sin(wavePhase(p, i));
  }
  for (int i = 0; i < ${MAX_FRONTS}; i++) {
    if (i >= uFrontCount) break;
    vec2 fd = uFrontDir[i].xy;
    float d = dot(p - uFrontPos[i].xy, fd);
    float H = uFrontPos[i].z;
    float lead = uFrontPos[i].w;
    float trail = uFrontDir[i].z;
    float prof = d > 0.0 ? exp(-pow(d / lead, 1.35)) : exp(-pow(-d / trail, 1.15));
    y += H * prof;
    crest = max(crest, prof);
    foam += smoothstep(0.22, 1.0, prof) * (0.5 + 0.5 * smoothstep(-1.0, 1.0, d / max(trail, 1.0)));
  }
  return y;
}

vec2 surfaceXZ(vec2 p) {
  vec2 o = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    o += uWaveDir[i] * (uWaveSteep[i] * uWaveAmp[i] * uAmp) * cos(wavePhase(p, i));
  }
  // fronts push water forward at the face
  for (int i = 0; i < ${MAX_FRONTS}; i++) {
    if (i >= uFrontCount) break;
    vec2 fd = uFrontDir[i].xy;
    float d = dot(p - uFrontPos[i].xy, fd);
    float H = uFrontPos[i].z;
    float lead = uFrontPos[i].w;
    o += fd * H * 0.34 * exp(-abs(d) / (lead * 0.85));
  }
  return o;
}
`;

const WATER_VERT = `
precision highp float;
${WAVE_UNIFORM_DECL}
uniform vec2 uMeshOffset;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vCrest;
${WATER_DISP}
void main(){
  vec2 p = position.xz + uMeshOffset;
  float foam, crest;
  float h = uLevel + surfaceY(p, foam, crest);
  vec2 off = surfaceXZ(p);
  const float e = 0.7;
  float f0, c0;
  float hx = uLevel + surfaceY(p + vec2(e, 0.0), f0, c0);
  float hz = uLevel + surfaceY(p + vec2(0.0, e), f0, c0);
  vec3 n = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  vFoam = foam; vCrest = crest; vNormalW = n;
  vec3 wp = vec3(p.x + off.x, h, p.y + off.y);
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const WATER_FRAG = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vCrest;
uniform vec3 uCamPos, uSunDir, uSunCol, uDeep, uShallow, uFogColor;
uniform float uTime, uAmp, uStorm, uUnderwater, uFoamBoost, uFloodAge, uFogDensity, uFlash;
uniform sampler2D uTerrainTex, uNormalTex;
uniform float uTerrainSize, uTerrainMin, uTerrainTexel;
uniform samplerCube uEnvMap;
uniform float uEnvOn, uEnvInt;
${NOISE}

float sampleTerrain(vec2 w) {
  vec2 uv = w / uTerrainSize + 0.5;
  if (uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999) return -8.0;
  float px = uTerrainTexel;
  vec2 f = fract(uv / px - 0.5);
  vec2 base = (floor(uv / px - 0.5) + 0.5) * px;
  float a = texture2D(uTerrainTex, base).r;
  float b = texture2D(uTerrainTex, base + vec2(px, 0.0)).r;
  float c = texture2D(uTerrainTex, base + vec2(0.0, px)).r;
  float d = texture2D(uTerrainTex, base + px).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 skyReflect(vec3 rd) {
  vec3 sDir = normalize(uSunDir);
  float up = clamp(rd.y, 0.0, 1.0);
  vec3 zen = mix(vec3(0.15,0.28,0.58), vec3(0.26,0.29,0.33), uStorm);
  vec3 hor = mix(vec3(0.70,0.80,0.93), vec3(0.30,0.32,0.35), uStorm);
  vec3 col = mix(hor, zen, pow(up, 0.55));
  float mu = max(dot(rd, sDir), 0.0);
  col += uSunCol * (pow(mu, 6.0) * 0.3 + pow(mu, 260.0) * 7.0);
  col += vec3(0.8,0.85,1.0) * uFlash * 2.0;
  return col;
}

void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);
  float terrain = sampleTerrain(vWorld.xz);
  float depth = max(vWorld.y - terrain, 0.0);

  vec2 uvw = vWorld.xz * 0.05;
  vec3 n = normalize(vNormalW);
  vec3 nm1 = texture2D(uNormalTex, uvw + vec2(uTime*0.013, uTime*0.020)).rgb * 2.0 - 1.0;
  vec3 nm2 = texture2D(uNormalTex, uvw * 2.35 - vec2(uTime*0.024, uTime*0.010)).rgb * 2.0 - 1.0;
  float dscale = mix(1.05, 1.9, uStorm) / (1.0 + dist * 0.010);
  n = normalize(n + vec3(nm1.x + nm2.x * 0.6, 0.0, nm1.y + nm2.y * 0.6) * dscale);

  bool under = uUnderwater > 0.5 && uCamPos.y < vWorld.y;
  if (!gl_FrontFacing) n = -n;

  vec3 L = normalize(uSunDir);
  float ndl = max(dot(n, L), 0.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
  float F = 0.02 + 0.98 * fres;

  vec3 waterCol = mix(uShallow, uDeep, clamp(depth / 16.0, 0.0, 1.0));
  waterCol = mix(waterCol, uShallow * 1.3, clamp((2.5 - depth) / 2.5, 0.0, 1.0) * 0.5);
  waterCol = mix(waterCol, vec3(0.36, 0.33, 0.25), clamp(uFloodAge, 0.0, 1.0) * 0.5 * clamp(depth / 7.0, 0.0, 1.0));

  vec3 refl = skyReflect(reflect(-V, n));
  if (uEnvOn > 0.5) refl = mix(refl, textureCube(uEnvMap, reflect(-V, n)).rgb, 0.72);
  refl *= uEnvInt;

  vec3 Hh = normalize(L + V);
  float spec = pow(max(dot(n, Hh), 0.0), mix(80.0, 300.0, uStorm)) * (0.5 + 2.2 * (1.0 - uStorm));
  vec3 col = mix(waterCol * (0.35 + 0.65 * ndl), refl, F);
  col += uSunCol * spec * (1.0 - fres * 0.35) * 1.5;

  float sss = pow(max(dot(V, -L), 0.0), 3.0) * clamp(vCrest + (1.0 - clamp(depth/3.0, 0.0, 1.0)), 0.0, 1.2);
  col += vec3(0.10, 0.42, 0.36) * sss * 0.85;

  float fn = ridged2(vWorld.xz * 0.085 + vec2(uTime * 0.08, uTime * 0.05), 4);
  float fn2 = fbm2(vWorld.xz * 0.33 + vec2(-uTime*0.2, uTime*0.16), 3);
  float whitewater = clamp(vFoam + uFoamBoost, 0.0, 1.6) * smoothstep(0.18, 0.7, fn * 0.65 + fn2 * 0.55);
  float shoreFoam = smoothstep(1.4, 0.05, depth) * (1.0 - smoothstep(3.0, 9.0, depth)) * (0.4 + 0.6 * fn);
  float crestFoam = smoothstep(0.55, 1.0, uAmp * 0.25 + uStorm * 0.4 + vCrest * 1.5) * fn * uStorm;
  float foam = clamp(whitewater + shoreFoam + crestFoam, 0.0, 1.35);
  foam = pow(foam, 0.85);
  vec3 foamCol = vec3(0.93, 0.95, 0.97) * (0.35 + 0.85 * ndl) + uSunCol * spec * 0.08;
  foamCol = mix(foamCol, vec3(0.70, 0.68, 0.60), clamp(uFloodAge, 0.0, 1.0) * 0.45);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0));

  if (under) {
    col = mix(col, vec3(0.05, 0.20, 0.26) * (0.35 + 0.9 * ndl), 0.5);
    col += uSunCol * pow(max(dot(reflect(-V, n), L), 0.0), 22.0) * 0.45;
  }

  float fg = 1.0 - exp(-uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fg, 0.0, 1.0));

  float alpha = 1.0;
  if (depth < 0.85) alpha = smoothstep(-0.02, 0.7, depth) * 0.8 + 0.2;
  alpha = mix(alpha, 1.0, clamp(uFloodAge, 0.0, 1.0) * 0.8);
  alpha = max(alpha, foam * 0.9);
  if (under) alpha = 0.93;

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CREST_VERT = `
precision highp float;
uniform float uTime, uLevel, uHeight, uLead, uTrail, uSurge;
uniform vec2 uMeshOffset;
varying vec3 vWorld; varying vec3 vNormalW; varying float vFoam; varying float vFace;

float profileY(float z){
  float H = uHeight;
  float y;
  if (z > 0.0) y = H * exp(-pow(z / uLead, 1.35));
  else { y = H * exp(-pow(-z / uTrail, 1.15)); y += H * 0.10 * sin(-z * 0.018) * exp(z * 0.003); }
  return y;
}

vec3 crestPos(vec2 xz){
  float wx = xz.x + uMeshOffset.x;
  float wob = sin(wx * 0.021 + uTime * 0.7) * 0.5 + sin(wx * 0.0075 - uTime * 0.35) * 0.9;
  float wob2 = sin(wx * 0.06 + uTime * 1.3) * 0.28;
  float h = profileY(xz.y);
  float hn = clamp(h / max(uHeight, 0.001), 0.0, 1.0);
  float y = uLevel + h + (wob + wob2) * uHeight * 0.11 * (0.35 + hn);
  // curling lip juts forward in the travel direction (+z)
  float curl = pow(hn, 2.2) * uHeight * 0.26 * exp(-max(xz.y, 0.0) / (uLead * 1.5));
  return vec3(xz.x, y, xz.y + curl);
}

void main(){
  vec2 p = position.xz;
  vec3 pos = crestPos(p);
  const float e = 1.2;
  vec3 px = crestPos(p + vec2(e, 0.0));
  vec3 pz = crestPos(p + vec2(0.0, e));
  vec3 n = normalize(cross(px - pos, pz - pos));
  if (n.y < 0.0) n = -n;
  vWorld = pos;
  vNormalW = n;
  float hn = clamp((pos.y - uLevel) / max(uHeight, 0.001), 0.0, 1.0);
  float face = 1.0 - smoothstep(0.0, uTrail * 0.55, -p.y);
  vFoam = clamp((smoothstep(0.24, 0.95, hn) * 1.25 + smoothstep(0.75, 1.0, hn) * 0.6) * uSurge, 0.0, 1.6) * face;
  vFace = hn;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

const CREST_FRAG = `
precision highp float;
varying vec3 vWorld; varying vec3 vNormalW; varying float vFoam; varying float vFace;
uniform vec3 uCamPos, uSunDir, uSunCol, uFogColor;
uniform float uTime, uFogDensity, uFlash;
${NOISE}
void main(){
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(uSunDir);
  vec3 n = normalize(vNormalW);
  float ndl = max(dot(n, L), 0.0);
  float f1 = ridged2(vWorld.xz * 0.11 + vec2(uTime*0.3, -uTime*0.2), 4);
  float f2 = fbm2(vWorld.xz * 0.42 + vec2(uTime*0.5, uTime*0.28), 3);
  float streak = smoothstep(0.18, 0.8, f1*0.62 + f2*0.6);
  float foam = clamp(vFoam * (0.6 + 0.75*streak), 0.0, 1.0);
  vec3 col = mix(vec3(0.03, 0.18, 0.20), vec3(0.95,0.96,0.97), foam);
  col *= (0.4 + 0.85 * ndl);
  col += vec3(0.16, 0.52, 0.44) * pow(max(dot(V, -L), 0.0), 2.0) * (1.0 - foam) * 0.75;
  col += uSunCol * pow(max(dot(n, normalize(L+V)), 0.0), 48.0) * 0.6;
  col += vec3(0.8,0.85,1.0) * uFlash * 1.4;
  float dist = length(uCamPos - vWorld);
  col = mix(col, uFogColor, clamp(1.0 - exp(-uFogDensity*dist*dist), 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(0.7 + foam*0.3, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ---------------------------------------------------------------- normal map */
function makeWaterNormal(seed = 5, size = 256) {
  const nz = new Noise(seed);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let px = 0; px < size; px++) {
    const u = px / size, v = y / size;
    let n = 0, amp = 0.5, f = 5;
    for (let o = 0; o < 4; o++) {
      n += amp * (nz.fbm(Math.cos(u * TAU) * f + o * 7.3, Math.sin(u * TAU) * f + o * 3.1, 3) * 0.5
        + nz.fbm(Math.cos(v * TAU) * f + o * 2.7, Math.sin(v * TAU) * f + o * 9.4, 3) * 0.5);
      amp *= 0.5; f *= 2.07;
    }
    height[y * size + px] = n;
  }
  const { c, x } = ctx2d(size, size);
  const img = x.createImageData(size, size);
  const at = (a, b) => height[((b + size) % size) * size + ((a + size) % size)];
  for (let y = 0; y < size; y++) for (let px = 0; px < size; px++) {
    const dx = (at(px + 1, y) - at(px - 1, y)) * 2.2;
    const dy = (at(px, y + 1) - at(px, y - 1)) * 2.2;
    let nx = -dx, ny = -dy, nz2 = 1;
    const l = Math.hypot(nx, ny, nz2);
    const i = (y * size + px) * 4;
    img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((nz2 / l) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ---------------------------------------------------------------- ocean */
export class Ocean {
  constructor(scene, terrain, quality = 'high', renderer = null) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = quality;
    this.level = 0; this.levelTarget = 0;
    this.waveSig = 0.75; this.waveSigTarget = 0.75;
    this.windDir = [0.86, 0.51];
    this.storm = 0; this.t = 0;
    this.fronts = [];
    this.floodAge = 0;
    this.envOn = quality !== 'low' && !!renderer;
    this.current = { x: 0, z: 0, speed: 0 };

    const rings = quality === 'low' ? 96 : quality === 'medium' ? 126 : 150;
    const segments = quality === 'low' ? 128 : quality === 'medium' ? 160 : 192;
    this.geo = makeDiscGeometry(1.5, quality === 'low' ? 1.075 : 1.055, rings, segments);

    this.waves = [
      ...buildWaveSet(9, this.waveSig, this.windDir, 0),
      ...buildWaveSet(23, this.waveSig, this.windDir, 0),
    ].slice(0, MAX_WAVES);
    const dirs = this.waves.map((w) => new THREE.Vector2(w.dir[0], w.dir[1]));
    const amps = new Float32Array(MAX_WAVES), ks = new Float32Array(MAX_WAVES), steep = new Float32Array(MAX_WAVES);
    this.waves.forEach((w, i) => { amps[i] = w.amp; ks[i] = w.k; steep[i] = w.steep; });

    this.uniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uAmp: { value: 1 },
      uWaveCount: { value: MAX_WAVES },
      uWaveDir: { value: dirs }, uWaveAmp: { value: amps }, uWaveK: { value: ks }, uWaveSteep: { value: steep },
      uMeshOffset: { value: new THREE.Vector2() },
      uFrontCount: { value: 0 },
      uFrontPos: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uFrontDir: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 0, 210, 0)) },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      uDeep: { value: new THREE.Color(0.005, 0.05, 0.095) },
      uShallow: { value: new THREE.Color(0.055, 0.35, 0.35) },
      uStorm: { value: 0 }, uUnderwater: { value: 0 }, uFoamBoost: { value: 0 }, uFloodAge: { value: 0 },
      uTerrainTex: { value: terrain.heightTex }, uTerrainSize: { value: terrain.size },
      uTerrainMin: { value: terrain.minHeight }, uTerrainTexel: { value: 1 / terrain.texSize },
      uNormalTex: { value: makeWaterNormal(5, quality === 'low' ? 128 : 256) },
      uEnvMap: { value: null }, uEnvOn: { value: 0 }, uEnvInt: { value: 1 },
      uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) }, uFogDensity: { value: 0.00035 },
      uFlash: { value: 0 },
    };

    this.mat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: this.uniforms,
      transparent: true, side: THREE.DoubleSide, depthWrite: true, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    this.crestUniforms = {
      uTime: { value: 0 }, uLevel: { value: 0 }, uHeight: { value: 0 }, uLead: { value: 34 }, uTrail: { value: 210 },
      uSurge: { value: 1 }, uMeshOffset: { value: new THREE.Vector2() },
      uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uFogColor: { value: new THREE.Color(0.7, 0.8, 0.9) },
      uFogDensity: { value: 0.00035 }, uFlash: { value: 0 },
    };
    this.crest = new THREE.Mesh(makeCrestGeometry(1200, 320, 1700), new THREE.ShaderMaterial({
      vertexShader: CREST_VERT, fragmentShader: CREST_FRAG, uniforms: this.crestUniforms,
      transparent: true, side: THREE.DoubleSide, depthWrite: true, fog: false,
    }));
    this.crest.visible = false;
    this.crest.frustumCulled = false;
    this.crest.renderOrder = 6;
    this.crest.matrixAutoUpdate = false;
    scene.add(this.crest);
    this.crestOwner = null;

    if (this.envOn) {
      const size = quality === 'ultra' ? 256 : 128;
      this.envRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
      this.cubeCam = new THREE.CubeCamera(1, 20000, this.envRT);
      this.envTimer = 99;
      this.uniforms.uEnvMap.value = this.envRT.texture;
      this.uniforms.uEnvOn.value = 1;
    }
  }

  /* ---------- control ---------- */
  setStorm(v) { this.storm = clamp(v, 0, 1); }
  setLevel(y) { this.levelTarget = y; }
  setWaveHeight(h) { this.waveSigTarget = h; }
  setFoam(v) { this.uniforms.uFoamBoost.value = v; }
  setCurrent(x, z, speed) { this.current = { x, z, speed }; }

  spawnFront(opts) {
    const f = new Front(opts);
    this.fronts.push(f);
    if (this.fronts.length > MAX_FRONTS) this.fronts.shift();
    if (!this.crestOwner || !this.crestOwner.alive) this.crestOwner = f;
    return f;
  }
  clearFronts() { this.fronts.length = 0; this.crestOwner = null; this.crest.visible = false; this.uniforms.uFrontCount.value = 0; }

  /* ---------- CPU water model (matches the GPU shader) ---------- */
  waterYAt(x, z, t = this.t) {
    const amp = this.uniforms.uAmp.value;
    let y = this.level;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const phase = w.k * (w.dir[0] * x + w.dir[1] * z) - w.speed * w.k * t;
      y += w.amp * amp * Math.sin(phase);
    }
    for (const f of this.fronts) {
      if (!f.alive) continue;
      const d = (x - f.x) * f.dir[0] + (z - f.z) * f.dir[1];
      y += f.height * frontProfile(d, f.lead, f.trail);
    }
    return y;
  }
  depthAt(x, z) { return this.waterYAt(x, z) - this.terrain.heightAt(x, z); }
  get waveAmp() { return this.uniforms.uAmp.value; }
  setWaveAmp(a) { this.uniforms.uAmp.value = clamp(a, 0, 4); }

  /* ---------- update ---------- */
  update(dt, camera, focus) {
    this.t += dt;
    // level eases toward its target (fast rise = tsunami, slower drain)
    const dl = this.levelTarget - this.level;
    const rate = dl > 0 ? Math.max(0.45, dl * 0.22) : Math.max(0.3, Math.abs(dl) * 0.13);
    this.level += clamp(dl, -rate * dt, rate * dt);
    this.waveSig = damp(this.waveSig, this.waveSigTarget, 0.3, dt);
    this.floodAge = damp(this.floodAge, this.level > 0.8 ? 1 : 0, 0.4, dt);

    const u = this.uniforms;
    u.uTime.value = this.t;
    u.uLevel.value = this.level;
    u.uStorm.value = this.storm;
    u.uFloodAge.value = this.floodAge;

    // refresh the wave spectrum (keeps CPU & GPU identical)
    const a = buildWaveSet(9, this.waveSig, this.windDir, this.storm);
    const b = buildWaveSet(23, this.waveSig, this.windDir, this.storm);
    for (let i = 0; i < MAX_WAVES; i++) {
      const s = (i % 2 === 0 ? a[i >> 1] || a[0] : b[i >> 1] || b[0]);
      const w = this.waves[i];
      w.amp = s.amp; w.k = s.k; w.steep = s.steep; w.dir = s.dir; w.speed = s.speed;
      u.uWaveDir.value[i].set(s.dir[0], s.dir[1]);
      u.uWaveAmp.value[i] = s.amp; u.uWaveK.value[i] = s.k; u.uWaveSteep.value[i] = s.steep;
    }

    // fronts
    let n = 0;
    for (const f of this.fronts) {
      f.update(dt, (x, z) => this.terrain.heightAt(x, z) > this.level - 0.4);
      if (!f.alive) continue;
      if (n < MAX_FRONTS) {
        u.uFrontPos.value[n].set(f.x, f.z, f.height, f.lead);
        u.uFrontDir.value[n].set(f.dir[0], f.dir[1], f.trail, 0);
        n++;
      }
    }
    if (this.fronts.some((f) => !f.alive)) this.fronts = this.fronts.filter((f) => f.alive);
    u.uFrontCount.value = n;
    if (this.crestOwner && !this.crestOwner.alive) this.crestOwner = this.fronts.find((f) => f.height > 1) || null;

    // crest mesh
    const c = this.crestOwner;
    if (c && c.alive && c.height > 0.8) {
      this.crest.visible = true;
      const yaw = Math.atan2(c.dir[0], c.dir[1]);
      const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(c.x, 0, c.z);
      this.crest.matrix.copy(m);
      this.crest.matrixWorldNeedsUpdate = true;
      const cu = this.crestUniforms;
      cu.uHeight.value = c.height; cu.uLead.value = c.lead; cu.uTrail.value = c.trail;
      cu.uSurge.value = 1 + clamp((c.height - 8) / 20, 0, 0.6);
      cu.uTime.value = this.t; cu.uLevel.value = this.level;
      cu.uMeshOffset.value.set(c.x, c.z);
      cu.uCamPos.value.copy(camera.position);
    } else {
      this.crest.visible = false;
    }

    // follow the play focus (snapped to avoid vertex swimming)
    const snap = 4;
    const cx = Math.round(focus.x / snap) * snap, cz = Math.round(focus.z / snap) * snap;
    this.mesh.position.set(cx, 0, cz);
    this.mesh.updateMatrix();
    this.mesh.matrixWorldNeedsUpdate = true;
    u.uMeshOffset.value.set(cx, cz);
    u.uCamPos.value.copy(camera.position);
    u.uUnderwater.value = camera.position.y < this.waterYAt(camera.position.x, camera.position.z) ? 1 : 0;

    if (this.envRT) {
      this.envTimer += dt;
      if (this.envTimer > (this.quality === 'ultra' ? 3.5 : 6.5)) { this.envTimer = 0; this._pendingCube = true; }
    }
  }

  /** render the reflection probe (needs the renderer; call after update) */
  bakeProbe(renderer, scene, focus) {
    if (!this._pendingCube || !this.envRT) return false;
    this._pendingCube = false;
    const wv = this.mesh.visible, cv = this.crest.visible;
    this.mesh.visible = false; this.crest.visible = false;
    try {
      this.cubeCam.position.set(focus.x, Math.max(this.level, 0) + 2.5, focus.z);
      this.cubeCam.update(renderer, scene);
    } catch (e) {
      // A camera/renderer that cannot render into the cube target must never take the sea
      // with it: drop the reflection probe and keep the analytic sky reflection.
      this.envFailures = (this.envFailures || 0) + 1;
      if (this.envFailures === 1) console.warn('[ocean] reflection probe failed, using the analytic sky:', e && e.message);
      this.uniforms.uEnvOn.value = 0;
      this.envRT = null; this.cubeCam = null;
    } finally {
      this.mesh.visible = wv;             // never leave the ocean hidden
      this.crest.visible = cv;
    }
    return true;
  }

  syncSky(sky) {
    const u = this.uniforms, cu = this.crestUniforms;
    const sun = sky.palette ? sky.palette.sunCol : new THREE.Color(1, 0.95, 0.85);
    for (const t of [u, cu]) {
      if (t.uSunDir) t.uSunDir.value.copy(sky.sunDir);
      if (t.uSunCol) t.uSunCol.value.copy(sun);
      if (t.uFogColor) t.uFogColor.value.copy(sky.fog.color);
      if (t.uFogDensity) t.uFogDensity.value = sky.fog.density;
      if (t.uFlash) t.uFlash.value = sky.flash * 0.8;
      if (t.uStorm) t.uStorm.value = sky.storm;
    }
    if (u.uEnvInt) u.uEnvInt.value = lerp(1.0, 1.35, sky.storm);
    // storm build-up also roughens the wave field a little
    this.weatherStorm = sky.storm;
  }
}
