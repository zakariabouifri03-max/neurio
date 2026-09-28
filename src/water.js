// ── Realistic procedural water ──────────────────────────────────────────────
// Island ocean / lava lake / swamp. Pure three.js core (no addons).
//   • Gerstner-ish wave sum → real displaced geometry + analytic normals
//   • high frequency ripples done per-pixel (cheap, no aliasing)
//   • depth based colour: bright turquoise shallows → deep blue (depth baked
//     from the real terrain height field, so the shoreline + foam always
//     hug the actual island)
//   • Fresnel + sky gradient + (optional) real planar reflection of the world
//   • sun glitter / specular sparkle that feeds the bloom pass
//   • animated foam band on the beach + foam on wave crests
import * as THREE from 'three';

const OCEAN_WAVES = [
  // dir.x, dir.z, amplitude, wavelength  (long swell → short chop)
  [0.97, 0.24, 0.75, 62],
  [0.72, -0.69, 0.50, 34],
  [-0.42, 0.91, 0.30, 21],
  [0.86, 0.51, 0.18, 13.5],
  [-0.78, -0.62, 0.09, 7.5],
];

const RIPPLES = [
  [1.0, 0.0, 0.030, 2.6],
  [0.6, 0.8, 0.024, 1.7],
  [-0.5, 0.86, 0.018, 1.1],
  [0.25, -0.97, 0.012, 0.7],
];

const PRESETS = {
  // 0 Beach — tropical island water
  0: {
    waves: OCEAN_WAVES, ripples: RIPPLES, waveAmp: 1.0, minWl: 20,
    shallow: '#35d6c2', deep: '#0a4d8c', foam: '#f6ffff',
    murk: 0.24, fresPow: 5.0, f0: 0.02, specPower: 150, specK: 2.2,
    foamAmt: 1.0, foamWidth: 2.6, transparency: 1.0,
    emissive: '#000000', emissiveK: 0, refl: 1.0,
  },
  // 5 Volcano — lava
  5: {
    waves: OCEAN_WAVES, ripples: RIPPLES, waveAmp: 0.28, minWl: 20,
    shallow: '#ff7a1e', deep: '#5c1200', foam: '#3b1408',
    murk: 0.55, fresPow: 3.0, f0: 0.05, specPower: 30, specK: 0.25,
    foamAmt: 0.5, foamWidth: 1.8, transparency: 0.0,
    emissive: '#ff3a00', emissiveK: 1.35, refl: 0.0,
  },
  // 6 Swamp — murky green
  6: {
    waves: OCEAN_WAVES, ripples: RIPPLES, waveAmp: 0.34, minWl: 20,
    shallow: '#6ea04a', deep: '#12301a', foam: '#cdd9a4',
    murk: 0.75, fresPow: 4.0, f0: 0.03, specPower: 90, specK: 0.7,
    foamAmt: 0.3, foamWidth: 2.2, transparency: 0.25,
    emissive: '#000000', emissiveK: 0, refl: 0.35,
  },
};

// ── shared glsl ─────────────────────────────────────────────────────────────
const WAVE_GLSL = /* glsl */`
uniform float uTime;
uniform vec4 uWaves[5];    // xy = dir, z = amplitude, w = wavelength
uniform vec4 uRipples[4];
uniform float uWaveAmp;

float waveField(vec2 p, float amp, float minWl, out vec2 grad) {
  float h = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    float wl = uWaves[i].w;
    if (wl < minWl) continue;
    vec2 d = uWaves[i].xy;
    float a = uWaves[i].z * amp;
    float k = 6.2831853 / wl;
    float c = sqrt(9.8 / k) * 0.85;          // gravity wave speed
    float f = k * dot(d, p) - k * c * uTime;
    h += a * sin(f);
    grad += d * (a * k * cos(f));
  }
  return h;
}

float rippleField(vec2 p, float amp, out vec2 grad) {
  float h = 0.0;
  grad = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 d = uRipples[i].xy;
    float a = uRipples[i].z * amp;
    float wl = uRipples[i].w;
    float k = 6.2831853 / wl;
    float c = 1.4 + float(i) * 0.35;
    float f = k * dot(d, p) - k * c * uTime;
    h += a * sin(f);
    grad += d * (a * k * cos(f));
  }
  return h;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p) {
  float s = vnoise(p) * 0.6;
  s += vnoise(p * 2.03 + 11.7) * 0.3;
  s += vnoise(p * 4.11 - 5.3) * 0.1;
  return s;
}
`;

const VERT = /* glsl */`
${WAVE_GLSL}
uniform sampler2D uDepthTex;
uniform float uDepthExtent;
uniform float uWaterLevel;
uniform float uMinWl;

#include <fog_pars_vertex>
varying vec3 vWorld;
varying float vDepth;
varying float vDist;
varying float vWaveH;

float sampleDepth(vec2 xz) {
  vec2 uv = clamp(xz / uDepthExtent + 0.5, vec2(0.0), vec2(1.0));
  float e = texture2D(uDepthTex, uv).r;
  return e * e * 16.0;                 // decode (sqrt curve → precise near 0)
}

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vDepth = sampleDepth(wp.xz);

  vec4 mvBase = modelViewMatrix * vec4(position, 1.0);
  float dist = -mvBase.z;
  float distFade = 1.0 - smoothstep(140.0, 620.0, dist);
  float ampFade = smoothstep(0.0, 2.2, vDepth);        // flat right at the sand

  vec2 grad;
  float h = waveField(wp.xz, uWaveAmp * ampFade * (0.35 + 0.65 * distFade), uMinWl, grad);
  vWaveH = h;
  wp.y = uWaterLevel + h;
  vWorld = wp;

  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  vDist = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
${WAVE_GLSL}
uniform vec3 uShallow, uDeep, uFoamCol, uSunDir, uSunCol;
uniform vec3 uSkyTop, uSkyMid, uSkyHor, uEmissive;
uniform float uEmissiveK, uMurk, uSpecPower, uSpecK, uFresPow, uF0;
uniform float uFoamAmt, uFoamWidth, uTransparency, uReflK;
uniform sampler2D uReflTex;
uniform vec2 uResolution;

#include <fog_pars_fragment>

varying vec3 vWorld;
varying float vDepth;
varying float vDist;
varying float vWaveH;

vec3 skyCol(vec3 d) {
  float y = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uSkyHor, uSkyMid, smoothstep(0.47, 0.66, y));
  c = mix(c, uSkyTop, smoothstep(0.64, 0.99, y));
  return c;
}

void main() {
  float ampFade = smoothstep(0.0, 2.2, vDepth);
  float nearFade = 1.0 - smoothstep(60.0, 320.0, vDist);   // kill ripples far away (anti-alias)
  float midFade  = 1.0 - smoothstep(120.0, 620.0, vDist);

  vec2 g1, g2;
  float h = waveField(vWorld.xz, uWaveAmp * ampFade, 0.0, g1);
  float hr = rippleField(vWorld.xz, uWaveAmp * ampFade * (0.35 + 0.65 * nearFade) * (0.3 + 0.7 * midFade), g2);
  vec2 grad = g1 + g2;
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = uF0 + (1.0 - uF0) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uFresPow);

  // ── reflection: sky gradient, or the real mirrored world ──
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) * 0.9 + 0.02;
  vec3 refl = skyCol(R);
  if (uReflK > 0.001) {
    vec2 ruv = gl_FragCoord.xy / uResolution;
    ruv += N.xz * 0.045 * (1.0 - smoothstep(20.0, 380.0, vDist));
    vec3 rr = texture2D(uReflTex, clamp(ruv, vec2(0.002), vec2(0.998))).rgb;
    refl = mix(refl, rr, clamp(uReflK, 0.0, 1.0));
  }

  // ── body colour, shallow → deep ──
  float dT = 1.0 - exp(-max(vDepth, 0.0) * uMurk);
  vec3 body = mix(uShallow, uDeep, dT);
  float sss = exp(-max(vDepth, 0.0) * 0.45) *
    (0.35 + 0.65 * clamp(h / max(uWaveAmp, 0.001) * 0.5 + 0.5, 0.0, 1.0));
  body += uShallow * sss * 0.32 * max(uSunDir.y, 0.0);

  vec3 col = mix(body, refl, fres);

  // ── sun glitter ──
  vec3 Hv = normalize(uSunDir + V);
  float nh = max(dot(N, Hv), 0.0);
  float spec = pow(nh, uSpecPower) * uSpecK + pow(nh, 18.0) * 0.10;
  col += uSunCol * spec;

  // ── lava / glow ──
  if (uEmissiveK > 0.0) {
    float cr = fbm2(vWorld.xz * 0.055 + vec2(uTime * 0.02, -uTime * 0.015));
    col += uEmissive * uEmissiveK * (0.30 + 0.95 * pow(1.0 - cr, 2.0));
  }

  // ── foam ──
  float foam = 0.0;
  if (uFoamAmt > 0.001) {
    float n1 = fbm2(vWorld.xz * 0.17 + vec2(uTime * 0.05, -uTime * 0.037));
    float n2 = fbm2(vWorld.xz * 0.55 - vec2(uTime * 0.11, uTime * 0.08));
    float shore = 1.0 - smoothstep(0.0, uFoamWidth, vDepth);
    float band = shore * (0.25 + 1.30 * n1);
    foam = smoothstep(0.58, 0.92, band);
    float hn = clamp(h / max(uWaveAmp, 0.001) * 0.5 + 0.45, 0.0, 1.0);
    foam = max(foam, smoothstep(0.74, 0.99, hn) * shore * (0.35 + 0.80 * n2));
    foam *= uFoamAmt;
  }
  col = mix(col, uFoamCol, clamp(foam, 0.0, 1.0));

  // ── transparency: you can see the sand through the shallows ──
  float alpha = mix(0.45, 1.0, smoothstep(0.0, 4.5, vDepth));
  alpha = clamp(max(alpha, fres * 0.95 + foam * 0.9), 0.0, 1.0);
  alpha = mix(1.0, alpha, clamp(uTransparency, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

// ── depth bake: terrain height → 8bit texture (sqrt encoded) ────────────────
function buildDepthTexture(heightAt, waterLevel, extent = 1000, res = 512) {
  const data = new Uint8Array(res * res * 4);
  const inv = 1 / 16;
  for (let j = 0; j < res; j++) {
    const z = (-0.5 + (j + 0.5) / res) * extent;
    for (let i = 0; i < res; i++) {
      const x = (-0.5 + (i + 0.5) / res) * extent;
      const d = Math.max(0, waterLevel - heightAt(x, z));
      const v = Math.sqrt(Math.min(d, 16) * inv);
      const b = Math.max(0, Math.min(255, (v * 255) | 0));
      const o = (j * res + i) * 4;
      data[o] = b; data[o + 1] = b; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ── planar reflection (mirrored camera → render target) ─────────────────────
class PlanarReflection {
  constructor(size = 512) {
    this.size = size;
    this.enabled = true;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.cam = new THREE.PerspectiveCamera();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  update(renderer, scene, camera, waterLevel, hideMesh) {
    const aspect = camera.aspect || 1;
    const w = this.size;
    const h = Math.max(64, Math.round(this.size / Math.max(0.35, aspect)));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    camera.updateMatrixWorld();
    camera.getWorldPosition(this._p);
    camera.getWorldDirection(this._t);

    // mirror the eye and the look-at point through the horizontal water plane
    const c = this.cam;
    c.position.set(this._p.x, 2 * waterLevel - this._p.y, this._p.z);
    c.up.set(0, -1, 0);
    if (Math.abs(this._t.y) > 0.995) c.up.set(0, 0, -1).normalize();   // straight-down camera guard
    c.lookAt(
      c.position.x + this._t.x,
      c.position.y - this._t.y,
      c.position.z + this._t.z,
    );
    c.projectionMatrix.copy(camera.projectionMatrix);
    c.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    c.updateMatrixWorld(true);

    // only geometry ABOVE the water may show up in the reflection
    this.plane.constant = -waterLevel;
    const prevClip = renderer.clippingPlanes;
    const prevTarget = renderer.getRenderTarget();
    const prevXR = renderer.xr.enabled;
    renderer.clippingPlanes = [this.plane];
    if (hideMesh) hideMesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, c);
    renderer.setRenderTarget(prevTarget);
    renderer.clippingPlanes = prevClip;
    renderer.xr.enabled = prevXR;
    if (hideMesh) hideMesh.visible = true;
  }

  dispose() { this.rt.dispose(); }
}

const _v2 = new THREE.Vector2();

// ── public API ──────────────────────────────────────────────────────────────
export function createWater(opts) {
  const { theme, themeIndex, map, waterLevel = -0.75, heightAt, sunDir, quality = true,
    depthExtent = 1000, extent = 2400 } = opts;
  const P = PRESETS[themeIndex] || PRESETS[0];
  const seg = quality ? 192 : 96;

  const depthTex = buildDepthTexture(heightAt, waterLevel, depthExtent, quality ? 512 : 256);
  const reflections = quality && P.refl > 0;
  const refl = reflections ? new PlanarReflection(quality ? 512 : 256) : null;
  const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  dummy.needsUpdate = true;

  const waves = P.waves.map((w) => {
    const l = Math.hypot(w[0], w[1]) || 1;
    return new THREE.Vector4(w[0] / l, w[1] / l, w[2], w[3]);
  });
  const ripples = P.ripples.map((w) => {
    const l = Math.hypot(w[0], w[1]) || 1;
    return new THREE.Vector4(w[0] / l, w[1] / l, w[2], w[3]);
  });

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uWaves: { value: waves },
    uRipples: { value: ripples },
    uWaveAmp: { value: P.waveAmp },
    uMinWl: { value: quality ? P.minWl : P.minWl * 1.5 },
    uDepthTex: { value: depthTex },
    uDepthExtent: { value: depthExtent },
    uWaterLevel: { value: waterLevel },
    uShallow: { value: new THREE.Color(P.shallow) },
    uDeep: { value: new THREE.Color(P.deep) },
    uFoamCol: { value: new THREE.Color(P.foam) },
    uSunDir: { value: (sunDir || new THREE.Vector3(0.5, 0.7, 0.35)).clone().normalize() },
    uSunCol: { value: new THREE.Color(theme.sun[0]) },
    uSkyTop: { value: new THREE.Color(theme.sky[0]) },
    uSkyMid: { value: new THREE.Color(theme.sky[1]) },
    uSkyHor: { value: new THREE.Color(theme.sky[2]) },
    uEmissive: { value: new THREE.Color(P.emissive) },
    uEmissiveK: { value: P.emissiveK },
    uMurk: { value: P.murk },
    uSpecPower: { value: P.specPower },
    uSpecK: { value: P.specK },
    uFresPow: { value: P.fresPow },
    uF0: { value: P.f0 },
    uFoamAmt: { value: P.foamAmt },
    uFoamWidth: { value: P.foamWidth },
    uTransparency: { value: P.transparency },
    uReflK: { value: reflections ? P.refl : 0 },
    uReflTex: { value: dummy },
    uResolution: { value: new THREE.Vector2(1, 1) },
  }]);
  // render-target textures cannot survive UniformsUtils.merge → bind after
  if (refl) uniforms.uReflTex.value = refl.rt.texture;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: true,
    fog: true,
    side: THREE.FrontSide,
  });

  const geo = new THREE.PlaneGeometry(extent, extent, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;   // draw before dust/flames so particles stay visible over the sea
  mesh.name = 'water';

  const water = {
    mesh,
    material: mat,
    depthTex,
    reflections,
    update(time, camera, renderer, scene) {
      uniforms.uTime.value = time;
      if (renderer) {
        renderer.getDrawingBufferSize(_v2);
        uniforms.uResolution.value.set(Math.max(1, _v2.x), Math.max(1, _v2.y));
      }
      if (refl && refl.enabled && renderer && scene && camera) {
        refl.update(renderer, scene, camera, waterLevel, mesh);
      }
    },
    setReflections(on) {
      if (!refl) return;
      refl.enabled = !!on;
      uniforms.uReflK.value = on ? P.refl : 0;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      depthTex.dispose();
      dummy.dispose();
      if (refl) refl.dispose();
    },
  };
  return water;
}

// exported for shader-lint tooling / debugging
export const WATER_SHADERS = { VERT, FRAG, WAVE_GLSL };
