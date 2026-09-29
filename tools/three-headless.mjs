// Test-only view of the vendored build: everything is real three.js except
// WebGLRenderer, which is replaced by a headless stub so main.js can boot inside
// node (no GPU, no canvas). `globalThis.__glFrames` counts render() calls and
// `globalThis.__renderLoop` receives whatever setAnimationLoop() was given.
export * from '../vendor/three.module.js';

class WebGLRenderer {
  constructor(o = {}) {
    this.domElement = o.canvas || { addEventListener() {}, style: {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }) };
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    this.capabilities = { isWebGL2: true, maxTextureSize: 4096, getMaxAnisotropy: () => 4 };
    this.info = { render: { calls: 0, triangles: 0, frame: 0 }, memory: { geometries: 0, textures: 0 }, autoReset: true, reset() {} };
    this.outputColorSpace = 'srgb-linear'; this.toneMapping = 0; this.toneMappingExposure = 1;
    this._pr = 1; this.width = 800; this.height = 600;
    globalThis.__glFrames = 0;
  }
  setPixelRatio(v) { this._pr = v || 1; }
  getPixelRatio() { return this._pr; }
  setSize(w, h) { this.width = w; this.height = h; }
  setSizeOverrideCSS() {}
  setClearColor() {} setClearAlpha() {} setScissor() {} setViewport() {} clear() {}
  setRenderTarget(t) { this._rt = t; } getRenderTarget() { return this._rt || null; }
  render(scene, cam) {
    globalThis.__glFrames++;
    this.info.render.frame++;
    if (!scene || !scene.isScene || !cam || !cam.isCamera) throw new Error('render(): bad scene/camera — ' + (scene && scene.type) + '/' + (cam && cam.type));
    let calls = 0, tris = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (!o.geometry) throw new Error('mesh with no geometry: ' + o.name);
      if (!o.material) throw new Error('mesh with no material: ' + o.name);
      calls++;
      tris += ((o.geometry.index && o.geometry.index.count) || (o.geometry.attributes.position && o.geometry.attributes.position.count) || 0) / 3;
    });
    this.info.render.calls = calls; this.info.render.triangles = tris;
  }
  initTexture() {} compile() {} dispose() {} forceContextLoss() {} getContext() { return null; }
  setAnimationLoop(cb) { globalThis.__renderLoop = cb; }
}
export { WebGLRenderer };
