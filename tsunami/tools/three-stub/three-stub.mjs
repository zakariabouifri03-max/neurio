// Headless `three` replacement: the real library, minus WebGLRenderer (stubbed).
export * from '../../vendor/three.module.js';

const noop = () => { };
function fakeCanvas() {
  return {
    style: {}, width: 300, height: 150, clientWidth: 1280, clientHeight: 720,
    addEventListener: noop, removeEventListener: noop, remove: noop,
    requestPointerLock() { }, getContext: () => null, setAttribute: noop,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  };
}

/** minimal WebGLRenderer stand-in: enough for the game loop + post pipeline */
export class WebGLRenderer {
  constructor(params = {}) {
    this.params = params;
    this.domElement = fakeCanvas();
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    this.capabilities = { getMaxAnisotropy: () => 8, isWebGL2: true, maxTextures: 16, precision: 'highp' };
    this.extensions = { has: () => true, get: () => ({}) };
    this.info = { render: { calls: 0, triangles: 0, frame: 0 }, memory: { geometries: 0, textures: 0 }, programs: [], autoReset: true, reset: noop };
    this.properties = { get: () => ({}), remove: noop };
    // three's shader-error hook (real renderer: renderer.debug.onShaderError)
    this.debug = { checkShaderErrors: true, onShaderError: null };
    this.state = { setBlending: noop, reset: noop, buffers: {} };
    this.xr = { enabled: false, isPresenting: false, addEventListener: noop, getSession: () => null, setAnimationLoop: noop };
    this.isWebGLRenderer = true;
    this.coordinateSystem = 2000;      // WebGLCoordinateSystem (used by CubeCamera)
    this.outputColorSpace = 'srgb';
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.autoClear = true;
    this.sortObjects = true;
    this.localClippingEnabled = false;
    this.clippingPlanes = [];
    this._pixelRatio = 1;
    this._size = { width: 1280, height: 720 };
    this._target = null;
    this._clearColor = { r: 0, g: 0, b: 0, a: 1 };
    this.renderCount = 0;
  }
  setPixelRatio(v) { this._pixelRatio = v; }
  getPixelRatio() { return this._pixelRatio; }
  getDrawingBufferSize(v) { return v ? v.set(this._size.width, this._size.height) : { width: this._size.width, height: this._size.height }; }
  setSize(w, h) { this._size = { width: w, height: h }; }
  getSize(v) { return v ? v.set(this._size.width, this._size.height) : { width: this._size.width, height: this._size.height }; }
  setAnimationLoop(cb) { this._loop = cb; }
  render(scene, camera) {
    if (!scene || !camera) throw new Error('renderer.render called without a scene/camera');
    const p = camera.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) throw new Error('camera position is not finite');
    if (scene.children.length === 0) throw new Error('scene is empty');
    this.renderCount++;
  }
  setRenderTarget(t) { this._target = t; }
  getRenderTarget() { return this._target; }
  getActiveCubeFace() { return 0; }
  getActiveMipmapLevel() { return 0; }
  clear() { }
  setClearColor(c, a = 1) {
    const col = typeof c === 'number'
      ? { r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 } : c;
    this._clearColor = { r: col.r, g: col.g, b: col.b, a };
  }
  getClearColor(target) { return target.setRGB(this._clearColor.r, this._clearColor.g, this._clearColor.b); }
  getClearAlpha() { return this._clearColor.a; }
  setScissorTest() { }
  setViewport() { }
  setScissor() { }
  readRenderTargetPixels(rt, x, y, w, h, buffer) { if (buffer && buffer.fill) buffer.fill(0); }
  compile() { }
  dispose() { }
  resetState() { }
  getContext() { return {}; }
}
