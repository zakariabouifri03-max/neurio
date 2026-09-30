// ── Advanced Post-Processing Pipeline (HDR Bloom, Filmic Grading, Chromatic, Grain) ─
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT = /* glsl */`
uniform sampler2D tInput;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(threshold - 0.15, threshold + 0.22, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = /* glsl */`
uniform sampler2D tInput;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  vec2 o1 = dir * 1.3846153846;
  vec2 o2 = dir * 3.2307692308;
  c += (texture2D(tInput, vUv + o1).rgb + texture2D(tInput, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(tInput, vUv + o2).rgb + texture2D(tInput, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float strength;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform float chromatic;
uniform float grain;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 centerOffset = uv - vec2(0.5);
  float dist = length(centerOffset);

  // Optional Subtle Radial Chromatic Aberration (Ultra / Extreme)
  vec3 s;
  if (chromatic > 0.0001) {
    vec2 shift = centerOffset * dist * chromatic;
    s.r = texture2D(tScene, uv + shift).r;
    s.g = texture2D(tScene, uv).g;
    s.b = texture2D(tScene, uv - shift).b;
  } else {
    s = texture2D(tScene, uv).rgb;
  }

  vec3 b = texture2D(tBloom, uv).rgb;
  vec3 col = s + b * strength;

  // Filmic exposure curve
  col = vec3(1.0) - exp(-col * exposure);

  // Contrast & Saturation grading
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, saturation);
  col = (col - 0.5) * contrast + 0.5;
  col = max(col, vec3(0.0));

  // Linear -> sRGB gamma
  col = pow(col, vec3(0.4545));

  // Subtle desert cinema film grain
  if (grain > 0.001) {
    float n = (hash(uv * 500.0 + time) - 0.5) * grain;
    col += vec3(n);
  }

  // Natural lens vignette
  col *= 0.80 + 0.20 * smoothstep(0.95, 0.32, dist);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class BloomFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.strength = 0.52;
    this.threshold = 0.80;
    this.exposure = 1.28;
    this.contrast = 1.06;
    this.saturation = 1.12;
    this.chromatic = 0.003;
    this.grain = 0.018;
    this.msaaSamples = 4;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BRIGHT,
      depthTest: false,
      depthWrite: false,
      uniforms: { tInput: { value: null }, threshold: { value: this.threshold } },
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR,
      depthTest: false,
      depthWrite: false,
      uniforms: { tInput: { value: null }, dir: { value: new THREE.Vector2() } },
    });
    this.matComp = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        strength: { value: this.strength },
        exposure: { value: this.exposure },
        contrast: { value: this.contrast },
        saturation: { value: this.saturation },
        chromatic: { value: this.chromatic },
        grain: { value: this.grain },
        time: { value: 0 },
      },
    });

    this._makeTargets(2, 2);
  }

  _makeTargets(w, h) {
    this.dispose();
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...o, depthBuffer: true });
    try {
      this.rtScene.samples = this.msaaSamples;
    } catch (e) { /* fallback */ }
    this.rtA = new THREE.WebGLRenderTarget(w >> 1 || 1, h >> 1 || 1, o);
    this.rtB = new THREE.WebGLRenderTarget(w >> 1 || 1, h >> 1 || 1, o);
    this.blurSize = new THREE.Vector2(w >> 1 || 1, h >> 1 || 1);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    this._makeTargets(Math.max(2, (w * dpr) | 0), Math.max(2, (h * dpr) | 0));
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);

    this.matBright.uniforms.tInput.value = this.rtScene.texture;
    this.matBright.uniforms.threshold.value = this.threshold;
    this._pass(this.matBright, this.rtA);

    for (let i = 0; i < 2; i++) {
      this.matBlur.uniforms.tInput.value = this.rtA.texture;
      this.matBlur.uniforms.dir.value.set(1.25 / this.blurSize.x, 0);
      this._pass(this.matBlur, this.rtB);
      this.matBlur.uniforms.tInput.value = this.rtB.texture;
      this.matBlur.uniforms.dir.value.set(0, 1.25 / this.blurSize.y);
      this._pass(this.matBlur, this.rtA);
    }

    const u = this.matComp.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtA.texture;
    u.strength.value = this.strength;
    u.exposure.value = this.exposure;
    u.contrast.value = this.contrast;
    u.saturation.value = this.saturation;
    u.chromatic.value = this.chromatic;
    u.grain.value = this.grain;
    u.time.value = (performance.now() * 0.001) % 100.0;
    this._pass(this.matComp, null);
  }

  dispose() {
    if (this.rtScene) {
      this.rtScene.dispose();
      this.rtA.dispose();
      this.rtB.dispose();
    }
  }

  // Apply user-configured post-processing settings from the Settings Studio
  applySettings(s) {
    if (!s) return;
    if (s.bloom !== undefined) this.enabled = !!s.bloom;
    if (s.bloomStrength !== undefined) this.strength = s.bloomStrength;
    if (s.bloomThreshold !== undefined) this.threshold = s.bloomThreshold;
    if (s.exposure !== undefined) this.exposure = Number(s.exposure);
    if (s.contrast !== undefined) this.contrast = s.contrast;
    if (s.saturation !== undefined) this.saturation = s.saturation;
    if (s.chromaticAberration !== undefined) this.chromatic = Number(s.chromaticAberration);
    if (s.filmGrain !== undefined) this.grain = Number(s.filmGrain);
    if (s.msaaSamples !== undefined && s.msaaSamples !== this.msaaSamples) {
      this.msaaSamples = s.msaaSamples;
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      this.setSize(size.x, size.y);
    }
  }
}
