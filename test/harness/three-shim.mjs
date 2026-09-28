// three shim for Node: real three, but WebGLRenderer stubbed.
export * from '/home/user/neurio/vendor/three.module.js';
import { Vector2 } from '/home/user/neurio/vendor/three.module.js';

export class WebGLRenderer {
  constructor({ canvas } = {}) {
    this.domElement = canvas || { addEventListener() {} };
    this.shadowMap = {};
    this.outputColorSpace = '';
    this._loop = null;
    this.capabilities = { getMaxAnisotropy: () => 4 };
    this.size = { x: 1280, y: 720 };
  }
  setPixelRatio() {}
  setSize(w, h) { this.size.x = w; this.size.y = h; }
  getSize(v) { return v ? v.set(this.size.x, this.size.y) : new Vector2(this.size.x, this.size.y); }
  setAnimationLoop(cb) { this._loop = cb; }
  setRenderTarget() {}
  render() {}
  dispose() {}
  getContext() { return null; }
}
