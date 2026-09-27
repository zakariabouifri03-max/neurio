// ============================================================
// effects.js — retro post pipeline: scene renders into a small
// render target, then a fullscreen shader applies film grain,
// vignette, brightness, flash & chromatic-aberration impulses.
// ============================================================
import * as THREE from 'three';
import { clamp, rand } from './utils.js';

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const QUAD_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uTime, uGrain, uBright, uVig, uFlashA, uChroma, uScan, uPulse;
  uniform vec3 uFlashC;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec2 uv = vUv;
    // subtle lens pulse on scares
    uv = (uv - 0.5) * (1.0 - uPulse * 0.05) + 0.5;
    // chromatic aberration impulse
    vec2 off = (uv - 0.5) * uChroma * 0.012;
    vec3 col;
    col.r = texture2D(tDiffuse, uv + off).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - off).b;
    // brightness / lift
    col *= uBright;
    // scanlines (very subtle)
    col *= 1.0 - uScan * 0.5 * (0.5 + 0.5 * sin(uv.y * 900.0));
    // animated film grain
    float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime * vec2(13.7, 61.3)) * 100.0);
    col += (g - 0.5) * uGrain;
    // vignette — heavy, horror-style
    float d = distance(uv, vec2(0.5));
    col *= smoothstep(0.95, 0.28, d * (1.0 + uVig));
    // flash overlay
    col = mix(col, uFlashC, uFlashA);
    // faint green phosphor tint in shadows for camcorder feel
    col = mix(col, col * vec3(0.92, 1.05, 0.96), 0.35);
    // linear -> sRGB (final blit to screen)
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Effects {
  constructor(renderer, scene, camera, settings) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.settings = settings;
    this.w = 2; this.h = 2;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true,
    });
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tDiffuse: { value: this.rt.texture },
      uTime: { value: 0 }, uGrain: { value: 0.045 }, uBright: { value: 1 },
      uVig: { value: 0.85 }, uFlashA: { value: 0 }, uFlashC: { value: new THREE.Color(1, 1, 1) },
      uChroma: { value: 0 }, uScan: { value: 0.06 }, uPulse: { value: 0 },
    };
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: QUAD_FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false })
    );
    quad.frustumCulled = false;
    this.quadScene.add(quad);
    this.shakeAmp = 0; this.flashA = 0; this.chromaA = 0; this.pulseA = 0;
    this.baseVig = 0.85; this.vigTarget = 0.85;
    this.fovKick = 0;
    this.applySettings();
  }

  applySettings() {
    const s = this.settings;
    this.uniforms.uGrain.value = [0.0, 0.05, 0.11][s.grain] ?? 0.05;
    this.uniforms.uScan.value = [0.0, 0.05, 0.1][s.grain] ?? 0.05;
    this.uniforms.uBright.value = s.bright;
    if (this.camera) { this.camera.fov = s.fov + this.fovKick; this.camera.updateProjectionMatrix(); }
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    // low internal resolution => crunchy upscale, PS1 style
    const scale = 0.5;
    this.rt.setSize(Math.max(320, Math.floor(w * scale)), Math.max(180, Math.floor(h * scale)));
  }

  shake(amt) { this.shakeAmp = Math.max(this.shakeAmp, amt); }
  flash(color = 0xffffff, amt = 0.75) {
    this.uniforms.uFlashC.value.set(color);
    this.flashA = Math.max(this.flashA, amt);
  }
  impulse(chroma = 1, pulse = 1) { this.chromaA = Math.max(this.chromaA, chroma); this.pulseA = Math.max(this.pulseA, pulse); }
  fovPunch(deg) { this.fovKick = deg; }
  vignetteBoost(v) { this.vigTarget = v; }

  render(dt, time, overrideCam = null) {
    // decay
    this.shakeAmp *= Math.exp(-5.2 * dt);
    this.flashA *= Math.exp(-6.5 * dt);
    this.chromaA *= Math.exp(-4.5 * dt);
    this.pulseA *= Math.exp(-4.5 * dt);
    this.fovKick *= Math.exp(-6 * dt);
    this.uniforms.uVig.value += (this.vigTarget - this.uniforms.uVig.value) * Math.min(1, 3 * dt);
    const u = this.uniforms;
    u.uTime.value = time;
    u.uFlashA.value = clamp(this.flashA, 0, 1);
    u.uChroma.value = clamp(this.chromaA, 0, 1.6);
    u.uPulse.value = clamp(this.pulseA, 0, 1.4);

    // apply camera shake (temporarily)
    const cam = overrideCam || this.camera;
    const sx = (Math.random() - 0.5), sy = (Math.random() - 0.5), sz = (Math.random() - 0.5);
    const a = this.shakeAmp;
    if (a > 0.001) {
      cam.rotation.x += sy * 0.03 * a; cam.rotation.y += sx * 0.03 * a; cam.rotation.z += sz * 0.02 * a;
      cam.position.y += sy * 0.05 * a;
    }
    if (this.fovKick > 0.01 || Math.abs(cam.fov - (this.settings.fov + this.fovKick)) > 0.01) {
      cam.fov = this.settings.fov + this.fovKick; cam.updateProjectionMatrix();
    }
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, cam);
    if (a > 0.001) {
      cam.rotation.x -= sy * 0.03 * a; cam.rotation.y -= sx * 0.03 * a; cam.rotation.z -= sz * 0.02 * a;
      cam.position.y -= sy * 0.05 * a;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  renderSceneOnly(camera) { // menu background (still goes through grain)
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
