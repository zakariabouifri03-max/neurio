// Minimal DOM + Canvas2D stub so the Minecraft modules can be exercised under
// Node (headless validation). Only the calls the generator code makes exist.
class Gradient { addColorStop() {} }
class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
class Ctx2D {
  constructor(c) { this.canvas = c; this._img = new ImageData(c.width, c.height); this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; }
  clearRect() { this._img.data.fill(0); }
  save() {} restore() {} translate() {} scale() {} rotate() {} setTransform() {}
  _parse(col) {
    if (typeof col !== 'string') return [0, 0, 0, 0];
    if (col[0] === '#') {
      const n = parseInt(col.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    }
    const m = col.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 255) : 255]; }
    return [0, 0, 0, 255];
  }
  fillRect(x, y, w, h) {
    const c = this._parse(this.fillStyle);
    const a = c[3] / 255;
    for (let j = Math.max(0, y | 0); j < Math.min(this.canvas.height, (y | 0) + Math.ceil(h)); j++) {
      for (let i = Math.max(0, x | 0); i < Math.min(this.canvas.width, (x | 0) + Math.ceil(w)); i++) {
        const o = (j * this.canvas.width + i) * 4;
        this._img.data[o] = c[0] * a + this._img.data[o] * (1 - a);
        this._img.data[o + 1] = c[1] * a + this._img.data[o + 1] * (1 - a);
        this._img.data[o + 2] = c[2] * a + this._img.data[o + 2] * (1 - a);
        this._img.data[o + 3] = Math.min(255, this._img.data[o + 3] + c[3]);
      }
    }
  }
  stroke() {} beginPath() {} moveTo() {} lineTo() {} quadraticCurveTo() {} ellipse() {} arc() {} fill() {}
  createRadialGradient() { return new Gradient(); }
  createLinearGradient() { return new Gradient(); }
  createImageData(w, h) { return w === undefined ? new ImageData(this.canvas.width, this.canvas.height) : new ImageData(w, h); }
  getImageData(x, y, w, h) {
    const o = new ImageData(w, h), s = this._img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const a = ((y + j) * this.canvas.width + (x + i)) * 4, b = (j * w + i) * 4;
      if (a < 0 || a + 3 >= s.length) continue;
      o.data[b] = s[a]; o.data[b + 1] = s[a + 1]; o.data[b + 2] = s[a + 2]; o.data[b + 3] = s[a + 3];
    }
    return o;
  }
  putImageData(d, x, y) {
    for (let j = 0; j < d.height; j++) for (let i = 0; i < d.width; i++) {
      const t = ((y + j) * this.canvas.width + (x + i)) * 4, s = (j * d.width + i) * 4;
      if (t < 0 || t + 3 >= this._img.data.length) continue;
      this._img.data[t] = d.data[s]; this._img.data[t + 1] = d.data[s + 1]; this._img.data[t + 2] = d.data[s + 2]; this._img.data[t + 3] = d.data[s + 3];
    }
  }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (dw === undefined) { dx = sx; dy = sy; dw = img.width; dh = img.height; sx = 0; sy = 0; sw = img.width; sh = img.height; }
    const src = img.getContext ? img.getContext('2d')._img.data : null;
    if (!src) return;
    const scale = dw / sw;
    for (let j = 0; j < dh; j++) {
      const sy2 = Math.min(sh - 1, Math.max(0, Math.floor(j / scale)));
      for (let i = 0; i < dw; i++) {
        const sx2 = Math.min(sw - 1, Math.max(0, Math.floor(i / scale)));
        const a = ((sy + sy2) * img.width + (sx + sx2)) * 4;
        const b = ((dy + j) * this.canvas.width + (dx + i)) * 4;
        if (b < 0 || b + 3 >= this._img.data.length) continue;
        this._img.data[b] = src[a]; this._img.data[b + 1] = src[a + 1];
        this._img.data[b + 2] = src[a + 2]; this._img.data[b + 3] = src[a + 3];
      }
    }
  }
}
class HTMLCanvasElement {
  constructor() { this.width = 300; this.height = 150; this.style = {}; this.nodeName = 'CANVAS'; }
}
class HTMLImageElement {}
class ImageBitmap {}
class OffscreenCanvas {}
class ImageDataStub extends ImageData {
  constructor(data, w, h) {
    super(w, h);
    if (data && data.length === this.data.length) this.data.set(data);
  }
}
globalThis.ImageData = ImageDataStub;
class FileReaderStub {
  readAsArrayBuffer(blob) {
    Promise.resolve(blob && blob.arrayBuffer ? blob.arrayBuffer() : new ArrayBuffer(0))
      .then((b) => { this.result = b; this.onloadend && this.onloadend({ target: this }); });
  }
  readAsDataURL(blob) {
    Promise.resolve(blob && blob.arrayBuffer ? blob.arrayBuffer() : new ArrayBuffer(0)).then((b) => {
      this.result = 'data:image/png;base64,' + Buffer.from(b).toString('base64');
      this.onloadend && this.onloadend({ target: this });
    });
  }
}
globalThis.FileReader = FileReaderStub;
globalThis.HTMLCanvasElement = HTMLCanvasElement;
globalThis.HTMLImageElement = HTMLImageElement;
globalThis.ImageBitmap = ImageBitmap;
globalThis.OffscreenCanvas = OffscreenCanvas;
class Canvas extends HTMLCanvasElement {
  constructor() { super(); }
  getContext() { return (this._ctx ||= new Ctx2D(this)); }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(cb) {
    const d = this._ctx ? this._ctx._img.data : new Uint8ClampedArray(this.width * this.height * 4);
    const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const body = new Uint8Array(d.buffer ? d.slice(0, Math.min(d.length, 4096)) : 4);
    cb && cb(new Blob([head, body], { type: 'image/png' }));
  }
  convertToBlob(o) { return new Promise((res) => this.toBlob(res, o && o.type)); }
  addEventListener() {} removeEventListener() {}
}
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? new Canvas() : { style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  getElementById: () => null,
  querySelectorAll: () => [],
  body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.navigator = globalThis.navigator || { hardwareConcurrency: 8, userAgent: 'node' };
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
