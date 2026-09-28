// post.js — HDR pipeline: bloom, sun rays, filmic tonemap, colour grade, underwater, grain
import * as THREE from 'three';
import { TONEMAP } from './glsl.js';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

class Quad {
  constructor(material, renderer) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = renderer;
  }
  set(material) { this.mesh.material = material; }
  render(target = null) {
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.mesh.geometry.dispose(); }
}

const BRIGHT_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold, uSoft, uExposure;
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = smoothstep(uThreshold, uThreshold + uSoft, l);
  gl_FragColor = vec4(c * knee, 1.0);
}
`;

const BLUR_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDir;
void main(){
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
  sum += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
  sum += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

const RAYS_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uSun;
uniform float uStrength, uDecay, uDensity, uWeight;
void main(){
  vec2 delta = (vUv - uSun) * uDensity / 8.0;
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float illum = 1.0;
  for (int i = 0; i < 24; i++) {
    uv -= delta;
    vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
    acc += c * illum * uWeight;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc * uStrength, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene, tBloom, tRays;
uniform vec2 uResolution;
uniform float uTime, uExposure, uBloom, uRays, uVignette, uGrain, uChroma;
uniform float uUnderwater, uWet, uDamage, uCold;
uniform vec3 uTint;
${TONEMAP}

vec3 sampleScene(vec2 uv){
  // underwater wobble + chromatic aberration
  float w = uUnderwater;
  if (w > 0.001) {
    uv += vec2(sin(uv.y * 34.0 + uTime * 2.2), cos(uv.x * 30.0 + uTime * 1.9)) * 0.0022 * w;
  }
  vec2 d = (uv - 0.5) * uChroma * (1.0 + w * 1.5);
  vec3 c;
  c.r = texture2D(tScene, uv + d).r;
  c.g = texture2D(tScene, uv).g;
  c.b = texture2D(tScene, uv - d).b;
  return c;
}

void main(){
  vec2 uv = vUv;
  vec3 col = sampleScene(uv);
  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec3 rays = texture2D(tRays, uv).rgb;
  col += bloom * uBloom + rays * uRays;
  col *= uExposure;
  // underwater absorption
  col = mix(col, col * vec3(0.32, 0.62, 0.78) + vec3(0.0, 0.02, 0.045), uUnderwater * 0.85);
  // cold / damage grading
  col = mix(col, col * vec3(0.86, 0.92, 1.06), uCold * 0.5);
  col += vec3(0.36, 0.02, 0.02) * uDamage * 0.32;
  // wet lens (rain on the camera)
  if (uWet > 0.01) {
    vec2 duv = uv * 3.0;
    float drop = smoothstep(0.86, 1.0, sin(duv.x * 13.0) * sin(duv.y * 11.0 + uTime * 0.4));
    col += drop * uWet * 0.16;
  }
  col *= uTint;
  col = acesFilm(col);
  // grade: slight teal shadows / warm highlights, contrast, saturation
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.14);
  col = (col - 0.5) * 1.06 + 0.5;
  col += (1.0 - l) * vec3(0.012, 0.02, 0.032) - l * vec3(0.01, 0.005, 0.0);
  // vignette
  vec2 vd = uv - 0.5;
  float vig = 1.0 - dot(vd, vd) * uVignette;
  col *= clamp(vig, 0.0, 1.0);
  // grain
  float g = fract(sin(dot(uv * uResolution + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * uGrain;
  col = clamp(col, 0.0, 1.0);
  col = linearToSRGB(col);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  constructor(renderer, quality = 'high') {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = quality !== 'low';
    const dpr = renderer.getPixelRatio();
    this.samples = quality === 'ultra' ? 4 : quality === 'high' ? 4 : quality === 'medium' ? 2 : 0;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: this.samples,
    });
    this.rtBright = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtBlurA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtBlurB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtRays = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtRays2 = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    void dpr;

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 1.05 }, uSoft: { value: 0.6 }, uExposure: { value: 1 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
    });
    this.raysMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RAYS_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0.9 }, uDecay: { value: 0.95 }, uDensity: { value: 0.9 }, uWeight: { value: 0.06 } },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: this.rtScene.texture }, tBloom: { value: this.rtBlurA.texture }, tRays: { value: this.rtRays2.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uExposure: { value: 1.05 }, uBloom: { value: 0.62 }, uRays: { value: 0.55 },
        uVignette: { value: 0.85 }, uGrain: { value: 0.028 }, uChroma: { value: 0.0016 },
        uUnderwater: { value: 0 }, uWet: { value: 0 }, uDamage: { value: 0 }, uCold: { value: 0 },
        uTint: { value: new THREE.Vector3(1, 0.995, 0.985) },
      },
    });
    this.quad = new Quad(this.brightMat, renderer);
  }

  setSize(w, h) {
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'ultra' ? 2 : 1.5);
    r.setPixelRatio(dpr);
    r.setSize(w, h, false);
    const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
    this.rtScene.setSize(W, H);
    const bw = Math.max(2, Math.floor(W / 2)), bh = Math.max(2, Math.floor(H / 2));
    this.rtBright.setSize(bw, bh);
    this.rtBlurA.setSize(bw, bh);
    this.rtBlurB.setSize(bw, bh);
    const rw = Math.max(2, Math.floor(W / 4)), rh = Math.max(2, Math.floor(H / 4));
    this.rtRays.setSize(rw, rh);
    this.rtRays2.setSize(rw, rh);
    this.compMat.uniforms.uResolution.value.set(W, H);
    this.size = { W, H };
  }

  /** blur `src` into `dst` (separable, 1 pass each axis) */
  blur(src, dst, tmp, radius = 1) {
    const { W, H } = this.size;
    this.quad.set(this.blurMat);
    this.blurMat.uniforms.tDiffuse.value = src.texture;
    this.blurMat.uniforms.uDir.value.set(radius / (W / 2), 0);
    this.quad.render(dst);
    this.blurMat.uniforms.tDiffuse.value = dst.texture;
    this.blurMat.uniforms.uDir.value.set(0, radius / (H / 2));
    this.quad.render(tmp);
    return tmp;
  }

  render(scene, camera, opts = {}) {
    const r = this.renderer;
    if (!this.enabled) { r.render(scene, camera); return; }
    // ---- 1. scene → HDR buffer
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    // ---- 2. bright pass
    this.quad.set(this.brightMat);
    this.brightMat.uniforms.tDiffuse.value = this.rtScene.texture;
    this.brightMat.uniforms.uThreshold.value = opts.bloomThreshold ?? 1.0;
    this.quad.render(this.rtBright);

    // ---- 3. bloom chain (two radii)
    const b1 = this.blur(this.rtBright, this.rtBlurA, this.rtBlurB, 1.0);
    const b2 = this.blur(b1, this.rtBlurA, this.rtBlurB, 2.4);
    this.blur(b2, this.rtBlurA, this.rtBlurB, 4.2);

    // ---- 4. sun rays (from the bright pass, radially toward the sun)
    if (opts.sunScreen && opts.sunVisible) {
      this.quad.set(this.raysMat);
      this.raysMat.uniforms.tDiffuse.value = this.rtBright.texture;
      this.raysMat.uniforms.uSun.value.copy(opts.sunScreen);
      this.raysMat.uniforms.uStrength.value = opts.raysStrength ?? 0.9;
      this.quad.render(this.rtRays);
      const t = this.rtRays2;
      this.quad.set(this.blurMat);
      this.blurMat.uniforms.tDiffuse.value = this.rtRays.texture;
      this.blurMat.uniforms.uDir.value.set(1 / (this.size.W / 4), 0);
      this.quad.render(t);
      this.blurMat.uniforms.tDiffuse.value = t.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1 / (this.size.H / 4));
      this.quad.render(this.rtRays);
    } else {
      const prev = new THREE.Color();
      r.getClearColor(prev);
      const prevA = r.getClearAlpha();
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.rtRays); r.clear(true, false, false);
      r.setRenderTarget(this.rtRays2); r.clear(true, false, false);
      r.setClearColor(prev, prevA);
      r.setRenderTarget(null);
    }

    // ---- 5. composite → screen
    const u = this.compMat.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtBlurB.texture;
    u.tRays.value = this.rtRays.texture;
    u.uTime.value = opts.time || 0;
    u.uExposure.value = opts.exposure ?? 1.05;
    u.uBloom.value = opts.bloom ?? 0.62;
    u.uRays.value = opts.rays ?? 0.5;
    u.uUnderwater.value = opts.underwater ? 1 : 0;
    u.uWet.value = opts.wet ?? 0;
    u.uDamage.value = opts.damage ?? 0;
    u.uCold.value = opts.cold ?? 0;
    u.uChroma.value = 0.0011 + (opts.damage || 0) * 0.006;
    u.uVignette.value = 0.75 + (opts.damage || 0) * 0.6;
    u.uGrain.value = 0.02 + (opts.damage || 0) * 0.05;
    if (opts.tint) u.uTint.value.set(opts.tint[0], opts.tint[1], opts.tint[2]);
    this.quad.set(this.compMat);
    this.quad.render(null);
    r.setRenderTarget(null);
  }
}
