import * as THREE from 'three';
const cache = new Map();
function random(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function canvasTexture(id, width, height, draw) {
  if (cache.has(id)) return cache.get(id);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
  cache.set(id, texture); return texture;
}
export function timberTexture() {
  return canvasTexture('timber', 512, 128, (ctx, w, h) => {
    const rng = random(86); ctx.fillStyle = '#ddd8cb'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1300; i++) {
      const y = rng() * h, x = rng() * w, length = 8 + rng() * 300;
      ctx.strokeStyle = `rgba(${rng() > .5 ? '95,78,56' : '255,249,230'},${.04 + rng() * .14})`;
      ctx.lineWidth = .4 + rng() * 1.3; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + length * .2, y + rng() * 5, x + length * .7, y - rng() * 3, x + length, y); ctx.stroke();
    }
    for (let knot = 0; knot < 3; knot++) {
      const x = 45 + rng() * 420, y = 10 + rng() * 108;
      for (let ring = 0; ring < 7; ring++) { ctx.strokeStyle = `rgba(92,72,51,${.11 - ring * .01})`; ctx.lineWidth = .8; ctx.beginPath(); ctx.ellipse(x, y, 2 + ring * 3.4, 1 + ring * .9, 0, 0, Math.PI * 2); ctx.stroke(); }
    }
  });
}
export function barkTexture() {
  return canvasTexture('bark', 128, 512, (ctx, w, h) => {
    const rng = random(931); ctx.fillStyle = '#c5b8a0'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      ctx.fillStyle = `rgba(59,49,31,${.06 + rng() * .1})`; ctx.fillRect(0, y, w, 1);
      if (y % 26 === 0) {
        ctx.fillStyle = '#746954'; ctx.fillRect(0, y, w, 3);
        ctx.fillStyle = '#e2d8bd'; ctx.fillRect(0, y + 3, w, 2);
      }
    }
    for (let i = 0; i < 150; i++) { ctx.fillStyle = 'rgba(43,43,26,.15)'; ctx.fillRect(rng() * w, rng() * h, 1, 6 + rng() * 35); }
  });
}
export function sandTexture() {
  return canvasTexture('sand', 256, 256, (ctx, w, h) => {
    const rng = random(1293), image = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const n = 215 + rng() * 39; image.data[i * 4] = n; image.data[i * 4 + 1] = n - 4; image.data[i * 4 + 2] = n - 13; image.data[i * 4 + 3] = 255; }
    ctx.putImageData(image, 0, 0);
    for (let y = 0; y < h; y += 7) { ctx.strokeStyle = 'rgba(110,102,82,.06)'; ctx.beginPath(); for (let x = 0; x < w; x += 3) ctx.lineTo(x, y + Math.sin(x * .045) * 2); ctx.stroke(); }
  });
}
export function waterTextures() {
  if (cache.has('water')) return cache.get('water');
  const N = 256, rng = random(32456), height = new Float32Array(N * N), cells = [];
  const layers = [8, 16, 32, 64].map(size => ({ size, data: Float32Array.from({ length: size * size }, rng) }));
  const smooth = x => x * x * (3 - 2 * x);
  function noise(x, y, layer) {
    const size = layer.size, px = x / N * size, py = y / N * size, ix = Math.floor(px), iy = Math.floor(py), fx = smooth(px - ix), fy = smooth(py - iy);
    const at = (a, b) => layer.data[((b + size) % size) * size + (a + size) % size];
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) height[y * N + x] = layers.reduce((sum, layer, index) => sum + noise(x, y, layer) * [.54, .25, .14, .07][index], 0);
  const normal = new Uint8Array(N * N * 4), caustic = new Uint8Array(N * N * 4);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) cells.push([x + rng(), y + rng()]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, at = (a, b) => height[((b + N) % N) * N + (a + N) % N];
    const dx = (at(x - 1, y) - at(x + 1, y)) * 10, dz = (at(x, y - 1) - at(x, y + 1)) * 10;
    normal[i * 4] = Math.round(Math.max(0, Math.min(255, 128 + dx * 127)));
    normal[i * 4 + 1] = Math.round(Math.max(0, Math.min(255, 128 + dz * 127)));
    normal[i * 4 + 2] = Math.round(height[i] * 255); normal[i * 4 + 3] = 255;
    const px = x / N * 12, py = y / N * 12, ix = Math.floor(px), iy = Math.floor(py);
    let first = 20, second = 20;
    for (let by = -1; by <= 1; by++) for (let bx = -1; bx <= 1; bx++) {
      const cx = (ix + bx + 12) % 12, cy = (iy + by + 12) % 12, point = cells[cy * 12 + cx];
      const dx = point[0] - cx + ix + bx - px, dy = point[1] - cy + iy + by - py, d = Math.hypot(dx, dy);
      if (d < first) { second = first; first = d; } else if (d < second) second = d;
    }
    const light = Math.pow(Math.max(0, 1 - (second - first) / .13), 2);
    caustic[i * 4] = caustic[i * 4 + 1] = caustic[i * 4 + 2] = Math.round(light * 255); caustic[i * 4 + 3] = 255;
  }
  const make = data => { const texture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true; texture.anisotropy = 4; return texture; };
  const result = { normal: make(normal), caustic: make(caustic) }; cache.set('water', result); return result;
}
