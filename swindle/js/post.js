// ── hand-rolled post stack: HDR scene → bright pass → separable blur → composite
//    (bloom + gentle chromatic edge + vignette + film grain, all one pass)
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT = /* glsl */`
uniform sampler2D tInput; uniform float threshold; uniform float knee;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(threshold - knee, threshold + knee, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR = /* glsl */`
uniform sampler2D tInput; uniform vec2 dir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tInput, vUv).rgb * 0.2270270270;
  vec2 a = dir * 1.3846153846, b = dir * 3.2307692308;
  c += (texture2D(tInput, vUv + a).rgb + texture2D(tInput, vUv - a).rgb) * 0.3162162162;
  c += (texture2D(tInput, vUv + b).rgb + texture2D(tInput, vUv - b).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMP = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float bloom, grain, aberr, vig, flash, time, sat, desat;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main(){
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  // cheap chromatic aberration toward the edges
  vec3 s;
  float ab = aberr * (0.0018 + r2 * 0.02);
  s.r = texture2D(tScene, vUv + d * ab).r;
  s.g = texture2D(tScene, vUv).g;
  s.b = texture2D(tScene, vUv - d * ab).b;
  vec3 b = texture2D(tBloom, vUv).rgb;
  vec3 col = s + b * bloom;
  col = 1.0 - exp(-col * 1.22);              // filmic-ish tonemap
  col = pow(max(col, vec3(0.0)), vec3(0.4545));
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(lum), col, sat);
  col = mix(col, vec3(1.0), flash);
  col *= 1.0 - vig * smoothstep(0.05, 0.62, r2);
  col += (hash(vUv * vec2(1024.0, 1024.0) + time) - 0.5) * grain;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, scene, camera) {
    this.r = renderer; this.scene = scene; this.cam = camera;
    this.enabled = true;
    this.params = { bloom: 0.62, grain: 0.035, aberr: 1, vig: 0.55, flash: 0, sat: 1.06 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 3 - 1));
    this.quad = new THREE.Mesh(g, null); this.quad.frustumCulled = false;
    this.q = new THREE.Scene(); this.q.add(this.quad);
    this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mBright = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false, uniforms: { tInput: { value: null }, threshold: { value: 0.72 }, knee: { value: 0.26 } } });
    this.mBlur = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: { tInput: { value: null }, dir: { value: new THREE.Vector2() } } });
    this.mComp = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMP, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, bloom: { value: 0.62 }, grain: { value: 0.03 },
        aberr: { value: 1 }, vig: { value: 0.55 }, flash: { value: 0 }, time: { value: 0 }, sat: { value: 1.06 },
      },
    });
    this.setSize(2, 2);
    this._flash = 0;
  }
  setSize(w, h) {
    const hw = Math.max(2, (w * 0.5) | 0), hh = Math.max(2, (h * 0.5) | 0);
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType };
    if (this.rtScene) { this.rtScene.dispose(); this.rtA.dispose(); this.rtB.dispose(); }
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...o, depthBuffer: true, samples: 4 });
    this.rtA = new THREE.WebGLRenderTarget(hw, hh, o);
    this.rtB = new THREE.WebGLRenderTarget(hw, hh, o);
    this.sz = new THREE.Vector2(hw, hh);
  }
  kick(v = 0.5) { this._flash = Math.min(1, this._flash + v); }
  setBloom(on, strength = 0.62) { this.enabled = on; this.params.bloom = strength; }
  _pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.q, this.qc); }
  render(t) {
    const r = this.r;
    if (!this.enabled) { r.setRenderTarget(null); r.render(this.scene, this.cam); return; }
    r.setRenderTarget(this.rtScene); r.render(this.scene, this.cam);
    this.mBright.uniforms.tInput.value = this.rtScene.texture;
    this._pass(this.mBright, this.rtA);
    for (let i = 0; i < 2; i++) {
      this.mBlur.uniforms.tInput.value = this.rtA.texture;
      this.mBlur.uniforms.dir.value.set(1.15 / this.sz.x, 0);
      this._pass(this.mBlur, this.rtB);
      this.mBlur.uniforms.tInput.value = this.rtB.texture;
      this.mBlur.uniforms.dir.value.set(0, 1.15 / this.sz.y);
      this._pass(this.mBlur, this.rtA);
    }
    this._flash *= 0.86;
    const u = this.mComp.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtA.texture;
    u.bloom.value = this.params.bloom;
    u.grain.value = this.params.grain;
    u.aberr.value = this.params.aberr;
    u.vig.value = this.params.vig;
    u.sat.value = this.params.sat;
    u.flash.value = this._flash;
    u.time.value = t % 100;
    this._pass(this.mComp, null);
  }
}
