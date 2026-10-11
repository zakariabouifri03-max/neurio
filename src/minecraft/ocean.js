// ═══════════════════════════════════════════════════════════════════════════
//  OCEAN — one big disc of animated water: layered sine swell with analytic
//  normals, depth-tinted body colour, fresnel sky reflection, sun glitter,
//  shoreline foam and fog. Pure GLSL, no textures, no dependencies.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime;
uniform float uAmp;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vH;

float wave(vec2 p, vec2 dir, float freq, float speed, out float dx, out float dz) {
  float ph = dot(p, dir) * freq + uTime * speed;
  float s = sin(ph);
  float c = cos(ph);
  dx = c * dir.x * freq;
  dz = c * dir.y * freq;
  return s;
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float gx = 0.0, gz = 0.0, h = 0.0;
  float dx, dz;
  h += wave(p, normalize(vec2(1.0, 0.32)), 0.085, 0.85, dx, dz) * 0.30 * uAmp; gx += dx * 0.30 * uAmp; gz += dz * 0.30 * uAmp;
  h += wave(p, normalize(vec2(-0.42, 1.0)), 0.145, 1.20, dx, dz) * 0.17 * uAmp; gx += dx * 0.17 * uAmp; gz += dz * 0.17 * uAmp;
  h += wave(p, normalize(vec2(0.78, -0.62)), 0.27, 1.75, dx, dz) * 0.085 * uAmp; gx += dx * 0.085 * uAmp; gz += dz * 0.085 * uAmp;
  h += wave(p, normalize(vec2(-0.9, -0.2)), 0.52, 2.4, dx, dz) * 0.035 * uAmp; gx += dx * 0.035 * uAmp; gz += dz * 0.035 * uAmp;
  wp.y += h;
  vH = h;
  vWorld = wp.xyz;
  vNrm = normalize(vec3(-gx, 1.0, -gz));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uSea;
uniform float uOpacity;
uniform float uNight;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vH;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // body colour: shallow near the swell crest, deep in the trough
  float depth = clamp((uSea - vWorld.y) * 0.25 + 0.45 - vH * 0.5, 0.0, 1.0);
  vec3 body = mix(uShallow, uDeep, depth);
  body *= 0.55 + 0.65 * (1.0 - uNight);

  // fresnel sky reflection
  float fres = pow(1.0 - ndv, 4.0) * 0.88 + 0.06;
  vec3 col = mix(body, uSky * (0.55 + 0.6 * (1.0 - uNight)), fres);

  // sun / moon glitter
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 240.0);
  float sparkle = pow(max(dot(N, H), 0.0), 42.0) * (0.35 + 0.65 * noise(vWorld.xz * 3.0 + uTime * 0.6));
  col += uSunColor * (spec * 3.2 + sparkle * 0.28) * (1.0 - uNight * 0.72);

  // foam on the crests + shoreline fizz
  float foam = smoothstep(0.20, 0.34, vH) * 0.45;
  float fizz = noise(vWorld.xz * 1.4 - uTime * 0.35) * noise(vWorld.xz * 4.7 + uTime * 0.2);
  foam += smoothstep(0.62, 0.9, fizz) * 0.16;
  col = mix(col, vec3(0.92, 0.96, 1.0), clamp(foam, 0.0, 0.75) * (1.0 - uNight * 0.5));

  // subtle subsurface tint when looking into a wave face
  col += uShallow * pow(max(0.0, dot(-V, L)), 3.0) * 0.09;

  float alpha = clamp(uOpacity + fres * 0.14, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export class Ocean {
  constructor(scene, opts = {}) {
    this.sea = opts.sea ?? 13;
    // logarithmic ring layout: dense under the camera, vast at the horizon so
    // the disc edge always hides inside the fog
    const R0 = 1.6, R1 = opts.radius ?? 2400, RINGS = 60, SEG = 144;
    const verts = [];
    const idx = [];
    verts.push(0, 0, 0);
    for (let r = 0; r <= RINGS; r++) {
      const rad = R0 * Math.pow(R1 / R0, r / RINGS);
      for (let i = 0; i < SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        verts.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      }
    }
    const ring = (r, i) => 1 + r * SEG + (i % SEG);
    for (let i = 0; i < SEG; i++) idx.push(0, ring(0, i), ring(0, i + 1));
    for (let r = 0; r < RINGS; r++) {
      for (let i = 0; i < SEG; i++) {
        const a = ring(r, i), b = ring(r, i + 1), c = ring(r + 1, i), d = ring(r + 1, i + 1);
        idx.push(a, c, d, a, d, b);
      }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g2.setIndex(idx);
    g2.computeVertexNormals();

    this.uniforms = {
      uTime: { value: 0 }, uAmp: { value: 1 },
      uDeep: { value: new THREE.Color(0x0a3a68) },
      uShallow: { value: new THREE.Color(0x2f92c4) },
      uSky: { value: new THREE.Color(0xa9d8ff) },
      uSunColor: { value: new THREE.Color(0xfff4dd) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.25) },
      uSea: { value: this.sea },
      uOpacity: { value: 0.88 },
      uNight: { value: 0 },
      fogColor: { value: new THREE.Color(0xcfe6fa) },
      fogNear: { value: 90 }, fogFar: { value: 620 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.FrontSide, fog: true,
    });
    this.mesh = new THREE.Mesh(g2, this.mat);
    this.mesh.position.y = this.sea + 0.88;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt, sky, camPos) {
    const u = this.uniforms;
    u.uTime.value += dt;
    const s = sky.sky;
    u.uSky.value.copy(s.zenith).lerp(s.horizon, 0.45);
    u.uSunColor.value.copy(s.sunI > 0.05 ? s.sunColor : s.moonColor);
    u.uSunDir.value.copy(sky.sunDir);
    u.uNight.value = sky.night;
    u.uOpacity.value = 0.86 + sky.night * 0.08;
    u.uAmp.value = 1.0;
    if (sky.fog) { u.fogColor.value.copy(sky.fog.color); u.fogNear.value = sky.fog.near; u.fogFar.value = sky.fog.far; }
    // keep the disc centred under the camera (infinite water, no edge in view)
    this.mesh.position.x = camPos.x;
    this.mesh.position.z = camPos.z;
  }

  setVisible(v) { this.mesh.visible = v; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
