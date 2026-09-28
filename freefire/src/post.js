// ── Minimal bloom post-processing (core three.js only, no addons) ───────────
// scene → MSAA RT → bright pass (½ res) → 2× separable blur → filmic composite
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT = /* glsl */`
uniform sampler2D tInput; uniform float threshold; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(threshold - 0.18, threshold + 0.22, l);
  gl_FragColor = vec4(c * k, 1.0);
}
`;

const BLUR = /* glsl */`
uniform sampler2D tInput; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
  vec2 o1 = dir * 1.3846153846, o2 = dir * 3.2307692308;
  c += (texture2D(tInput, vUv + o1).rgb + texture2D(tInput, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(tInput, vUv + o2).rgb + texture2D(tInput, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float strength; varying vec2 vUv;
void main() {
  vec3 s = texture2D(tScene, vUv).rgb;
  vec3 b = texture2D(tBloom, vUv).rgb;
  vec3 col = s + b * strength;
  col = 1.0 - exp(-col * 1.2);                     // soft filmic exposure
  col = pow(max(col, vec3(0.0)), vec3(0.4545));    // linear → sRGB
  float d = distance(vUv, vec2(0.5));
  col *= 0.86 + 0.14 * smoothstep(1.05, 0.3, d);   // gentle vignette
  gl_FragColor = vec4(col, 1.0);
}
`;

export class BloomFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = !!renderer;
    this.strength = 0.42;
    this.threshold = 0.85;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.matBright = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, threshold: { value: this.threshold } },
    });
    this.matBlur = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, dir: { value: new THREE.Vector2() } },
    });
    this.matComp = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tBloom: { value: null }, strength: { value: this.strength } },
    });
    this._makeTargets(2, 2);
  }

  _makeTargets(w, h) {
    this.dispose();
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...o, depthBuffer: true });
    try { this.rtScene.samples = 4; } catch (e) { /* older GPU */ }
    this.rtA = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), o);
    this.rtB = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), o);
    this.blurSize = new THREE.Vector2(Math.max(1, w >> 1), Math.max(1, h >> 1));
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
    if (!r || !this.enabled) { if (r) { r.setRenderTarget(null); r.render(scene, camera); } return; }
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);

    this.matBright.uniforms.tInput.value = this.rtScene.texture;
    this.matBright.uniforms.threshold.value = this.threshold;
    this._pass(this.matBright, this.rtA);

    for (let i = 0; i < 2; i++) {
      this.matBlur.uniforms.tInput.value = this.rtA.texture;
      this.matBlur.uniforms.dir.value.set(1.2 / this.blurSize.x, 0);
      this._pass(this.matBlur, this.rtB);
      this.matBlur.uniforms.tInput.value = this.rtB.texture;
      this.matBlur.uniforms.dir.value.set(0, 1.2 / this.blurSize.y);
      this._pass(this.matBlur, this.rtA);
    }

    this.matComp.uniforms.tScene.value = this.rtScene.texture;
    this.matComp.uniforms.tBloom.value = this.rtA.texture;
    this.matComp.uniforms.strength.value = this.strength;
    this._pass(this.matComp, null);
  }

  dispose() {
    if (this.rtScene) { this.rtScene.dispose(); this.rtA.dispose(); this.rtB.dispose(); }
  }
}
