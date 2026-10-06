// ============================================================================
// NEXUS ENGINE — Renderer
// Three.js WebGL2 renderer with PBR lighting, shadows, fog, gradient sky and
// optional bloom post-processing. Quality presets drive real settings.
// ============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { GraphicsQuality } from '../core/types';

export interface QualityPreset {
  shadowMapSize: number;
  shadowRadius: number;
  bloom: boolean;
  pixelRatioCap: number;
  anisotropy: number;
  shadowType: THREE.ShadowMapType;
}

export const QUALITY_PRESETS: Record<GraphicsQuality, QualityPreset> = {
  low:    { shadowMapSize: 512,  shadowRadius: 2, bloom: false, pixelRatioCap: 1.0,  anisotropy: 1,  shadowType: THREE.BasicShadowMap },
  medium: { shadowMapSize: 1024, shadowRadius: 3, bloom: false, pixelRatioCap: 1.25, anisotropy: 2,  shadowType: THREE.PCFShadowMap },
  high:   { shadowMapSize: 2048, shadowRadius: 4, bloom: true,  pixelRatioCap: 1.5,  anisotropy: 4,  shadowType: THREE.PCFSoftShadowMap },
  ultra:  { shadowMapSize: 4096, shadowRadius: 5, bloom: true,  pixelRatioCap: 2.0,  anisotropy: 8,  shadowType: THREE.PCFSoftShadowMap },
};

export class NexusRenderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null;
  bloomPass: UnrealBloomPass | null = null;
  preset: QualityPreset;
  private canvas: HTMLCanvasElement;
  private skyMesh: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private renderPass: RenderPass;
  private outputPass: OutputPass;
  private _renderCalls = 0;

  constructor(canvas: HTMLCanvasElement, quality: GraphicsQuality = 'high') {
    this.canvas = canvas;
    this.preset = QUALITY_PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.preset.shadowType;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(14, 12, 14);
    this.camera.lookAt(0, 0, 0);

    // Gradient sky dome (custom shader — cheap and dependency-free)
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color('#0e1420') },
        bottomColor: { value: new THREE.Color('#3a4a63') },
        offset: { value: 40.0 }, exponent: { value: 0.7 },
      },
      vertexShader: `varying vec3 vWorldPosition; void main() { vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition;
        void main() { float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
      side: THREE.BackSide, depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.ambient = new THREE.HemisphereLight(0xbcd2ff, 0x50565e, 0.5);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 400;
    const d = 90;
    this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Post-processing
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.outputPass = new OutputPass();
    this.setupComposer();

    this.resize();
  }

  private setupComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.preset.bloom) return;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(size, 0.32, 0.65, 0.92);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
  }

  setQuality(q: GraphicsQuality) {
    this.preset = QUALITY_PRESETS[q];
    this.renderer.shadowMap.type = this.preset.shadowType;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatioCap));
    this.sun.shadow.mapSize.set(this.preset.shadowMapSize, this.preset.shadowMapSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.setupComposer();
    this.resize();
  }

  setSky(top: string, bottom: string) {
    (this.skyMesh.material as THREE.ShaderMaterial).uniforms.topColor.value.set(top);
    (this.skyMesh.material as THREE.ShaderMaterial).uniforms.bottomColor.value.set(bottom);
  }

  setAmbient(color: string, intensity: number) {
    this.ambient.color.set(color);
    this.ambient.intensity = intensity;
  }

  setSun(color: string, intensity: number, angleDeg: number, elevationDeg: number, shadows: boolean) {
    this.sun.color.set(color);
    this.sun.intensity = intensity;
    this.sun.castShadow = shadows;
    const a = angleDeg * Math.PI / 180, e = elevationDeg * Math.PI / 180;
    const dir = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    this.sun.position.copy(dir.multiplyScalar(120));
    this.sun.target.position.set(0, 0, 0);
  }

  /** Track shadow camera to a world position so shadows stay crisp around the action. */
  focusSunShadows(pos: { x: number; y: number; z: number }) {
    this.sun.target.position.set(pos.x, pos.y, pos.z);
    this.sun.position.set(pos.x + this.sunOffset.x, pos.y + this.sunOffset.y, pos.z + this.sunOffset.z);
  }
  private sunOffset = new THREE.Vector3(60, 90, 40);
  setSunFromDirection(dir: THREE.Vector3) {
    this.sunOffset.copy(dir).normalize().multiplyScalar(110);
    this.sun.position.copy(this.sunOffset);
  }

  setFog(mode: 'none' | 'linear' | 'exponential', color: string, near: number, far: number, density: number) {
    if (mode === 'none') { this.scene.fog = null; return; }
    if (mode === 'linear') this.scene.fog = new THREE.Fog(new THREE.Color(color), near, far);
    else this.scene.fog = new THREE.FogExp2(new THREE.Color(color), density);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  render(camera?: THREE.PerspectiveCamera) {
    const cam = camera ?? this.camera;
    if (this.composer) {
      // RenderPass needs the active camera
      this.renderPass.camera = cam;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, cam);
    }
    this._renderCalls++;
  }

  get stats() {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }

  dispose() {
    this.composer?.dispose?.();
    this.renderer.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as any;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x: any) => x.dispose?.());
    });
  }
}
