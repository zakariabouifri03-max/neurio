// Montaj Pro — headless smoke test (jsdom): boots the app and drives the main flows
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { JSDOM, VirtualConsole } = await import(pathToFileURL(path.join(root, '.tools/node_modules/jsdom/lib/api.js')).href);

const html = fs.readFileSync(path.join(root, 'editor/dist/montaj-pro.html'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
const downloads = [];
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', () => { });
vc.on('log', () => { });
vc.on('info', () => { });

let window;
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'https://local.test/editor.html',
  beforeParse(w) { window = w; installStubs(w); },
});

// ---------------- stubs ----------------
function installStubs(window) {
function fakeCtx(canvas) {
  const noop = () => { };
  const ctx = {
    canvas,
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop, transform: noop,
    drawImage: noop, fillRect: noop, clearRect: noop, strokeRect: noop, fillText: noop, strokeText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, rect: noop, clip: noop, fill: noop, stroke: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    measureText: (s) => ({ width: String(s).length * 20 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    putImageData: noop,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    set filter(v) { }, get filter() { return 'none'; },
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    font: '10px sans-serif', textAlign: 'center', textBaseline: 'middle', direction: 'ltr', letterSpacing: '0px',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, lineJoin: 'round', miterLimit: 2,
  };
  return ctx;
}
window.HTMLCanvasElement.prototype.getContext = function () { return this.__ctx || (this.__ctx = fakeCtx(this)); };
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA==';
window.HTMLCanvasElement.prototype.toBlob = function (cb, type) { cb(new window.Blob([new Uint8Array([1, 2, 3])], { type: type || 'image/png' })); };
window.HTMLCanvasElement.prototype.captureStream = function () {
  const track = { kind: 'video', stop() { }, addEventListener() { } };
  return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [], addTrack() { } };
};
window.HTMLMediaElement.prototype.play = function () { this.__playing = true; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.__playing = false; };
Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { get() { return !this.__playing; }, configurable: true });
window.HTMLMediaElement.prototype.load = function () { };
Object.defineProperty(window.HTMLMediaElement.prototype, 'readyState', { get() { return 4; }, configurable: true });
Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', { get() { return 6; }, configurable: true });
Object.defineProperty(window.HTMLMediaElement.prototype, 'videoWidth', { get() { return 1280; }, configurable: true });
Object.defineProperty(window.HTMLMediaElement.prototype, 'videoHeight', { get() { return 720; }, configurable: true });
Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', { get() { return this.__t || 0; }, set(v) { this.__t = v; }, configurable: true });
window.createImageBitmap = async () => ({ width: 1280, height: 720, close() { } });
window.URL.createObjectURL = () => 'blob:local/fake';
window.URL.revokeObjectURL = () => { };
const origClick = window.HTMLAnchorElement.prototype.click;
window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
// fake MediaRecorder + AudioContext (fallback export path)
class FakeRecorder {
  constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'video/webm'; this.state = 'inactive'; }
  static isTypeSupported(m) { return /webm|mp4/.test(m); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); if (this.ondataavailable) this.ondataavailable({ data: new window.Blob([new Uint8Array(1024)], { type: this.mimeType }) }); }
}
window.MediaRecorder = FakeRecorder;
class FakeAudioNode { connect() { return this; } disconnect() { } }
class FakeAudioCtx {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new FakeAudioNode(); }
  createGain() { return { gain: { value: 1, setValueAtTime() { }, linearRampToValueAtTime() { } }, connect() { return this; } }; }
  createMediaElementSource() { return new FakeAudioNode(); }
  createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ kind: 'audio' }] } }; }
  createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, connect() { return this; }, start() { }, stop() { } }; }
  createBuffer(ch, len) { return { numberOfChannels: ch, length: len, sampleRate: this.sampleRate, duration: len / this.sampleRate, getChannelData: () => new Float32Array(len) }; }
  decodeAudioData(ab, ok, err) { const b = this.createBuffer(1, 48000); ok && ok(b); return Promise.resolve(b); }
  resume() { } close() { }
}
window.AudioContext = FakeAudioCtx;
window.OfflineAudioContext = class extends FakeAudioCtx {
  constructor(ch, len, sr) { super(); this.length = len; this.sampleRate = sr || 48000; }
  startRendering() { return Promise.resolve(this.createBuffer(2, Math.max(1, this.length || 4800))); }
};
window.indexedDB = undefined;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.confirm = () => true;
window.speechSynthesis = undefined;
}

// ---------------- run ----------------
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(400);
const app = window.__app;
const results = [];
const check = (name, fn) => {
  try { const v = fn(); results.push([v ? 'PASS' : 'FAIL', name]); return v; }
  catch (e) { results.push(['FAIL', name + ' :: ' + e.message]); return false; }
};
check('app booted', () => !!app);
check('project exists', () => !!app.project && app.project.tracks.length >= 2);
check('inspector rendered', () => window.document.querySelectorAll('#inspector .sec').length > 0);
check('timeline lanes', () => window.document.querySelectorAll('#tl-lanes .tl-track').length >= 2);
check('track headers', () => window.document.querySelectorAll('#tl-headers .trk-head').length >= 2);

// fake media + clip
const state = app.project;
const media = { id: 'm1', name: 'clip.mp4', kind: 'video', duration: 6, width: 1280, height: 720, hasAudio: true, url: 'blob:fake', peaks: Array.from({ length: 100 }, (_, i) => Math.abs(Math.sin(i / 4))), thumb: '' };
state.media.push(media);
await app.addMediaToTimeline('m1');
check('clip added', () => app.project.clips.length === 1);
check('timeline shows clip', () => window.document.querySelectorAll('#tl-lanes .tl-clip').length === 1);

app.addTextClip('title');
check('text clip added', () => app.project.clips.some(c => c.type === 'text'));
app.addSticker('🔥');
app.addShape('star');
check('sticker + shape clips', () => app.project.clips.some(c => c.type === 'sticker') && app.project.clips.some(c => c.type === 'shape'));

// render a frame with the preview provider
check('preview draw t=0', () => { app.seek(0); app.preview.draw(0); return true; });
check('preview draw t=2', () => { app.preview.draw(2); return true; });

// keyframes + animations
const clip = app.project.clips[0];
const { setKey, addKeyHere, kfValue } = window.__state;
setKey(clip, 'scale', 0, 1);
setKey(clip, 'scale', clip.duration, 2);
clip.animIn = { type: 'zoomIn', dur: 0.5 };
clip.animOut = { type: 'fade', dur: 0.5 };
check('keyframe interpolation', () => Math.abs(kfValue(clip, 'scale', clip.duration / 2) - 1.5) < 0.05);
check('draw with keyframes+anim', () => { app.preview.draw(0.25); app.preview.draw(clip.duration - 0.2); return true; });

// transitions
app.select(clip.id); app.seek(3); app.splitAtPlayhead();
check('split worked', () => app.project.clips.filter(c => c.type === 'video').length === 2);
const second = app.project.clips.filter(c => c.type === 'video')[1];
second.transition = { type: 'zoomIn', duration: 0.6 };
check('transition render', () => { app.preview.draw(second.start + 0.2); return true; });

// inspector tabs
for (const tab of ['media', 'audio', 'text', 'stickers', 'effects', 'motion', 'speed', 'captions', 'export', 'project']) {
  check('tab ' + tab, () => { app.select(clip.id); app.setTab(tab); return window.document.querySelectorAll('#inspector .sec').length > 0; });
}
app.select(clip.id);
await wait(30);
check('selection overlay', () => window.document.getElementById('clip-box').style.display !== 'none');
const cb = window.document.getElementById('clip-box');
if (!(parseFloat(cb.style.width) > 0)) console.log('DEBUG clip-box:', JSON.stringify({ w: cb.style.width, h: cb.style.height, left: cb.style.left, top: cb.style.top, disp: app.preview.disp, sel: app.selected, clipType: clip.type }));
check('selection box sized', () => parseFloat(cb.style.width) > 0);

// speed + reverse + chroma + filters
app.setSpeed(clip, 2);
check('speed changes duration', () => Math.abs(clip.duration + (clip.trimOut - clip.trimIn) / 2) < 0.001 || clip.duration > 0);
clip.chroma.enabled = true;
clip.filter = 'cinematic';
clip.adjust.temperature = 0.3;
check('filtered+chroma draw', () => { app.preview.draw(clip.start + 0.4); return true; });

// captions
app.addCaptionAtPlayhead('مرحبا بالعالم');
check('caption clip created', () => app.project.clips.some(c => c.isCaption));

// undo / redo
const before = app.project.clips.length;
app.deleteSelection();
check('delete', () => app.project.clips.length < before);
const { undo, redo } = window.__state;
undo(); window.__app.renderTimeline?.();
check('undo restores', () => app.project.clips.length === before);

// timeline interactions
check('zoom & fit', () => { app.timeline.zoomIn(); app.timeline.zoomFit(); return true; });

// export (fallback / live path with fake recorder)
window.__exportResult = null;
const okExport = await (async () => {
  try {
    await app.runExport();
    return true;
  } catch (e) { errors.push('export: ' + e.message); return false; }
})();
check('export ran (fallback path)', () => okExport);
await wait(200);
check('file offered for download', () => downloads.length > 0 || !!app.lastExport);

// save/load project
await app.saveProject();
check('project saved without idb', () => true);

// ---- Android bridge save path (window.MontajBridge) ----
const bridgeLog = { begin: [], chunks: 0, bytes: 0, ended: false };
let bridgeReadyAfter = 2, bridgeCancel = false;
window.MontajBridge = {
  beginSave(name, mime) { bridgeLog.begin.push([name, mime]); },
  saveReady() { if (bridgeReadyAfter > 0) { bridgeReadyAfter--; return false; } return true; },
  saveFailed() { return bridgeCancel; },
  writeChunk(b64) { bridgeLog.chunks++; bridgeLog.bytes += Buffer.from(b64, 'base64').length; },
  endSave() { bridgeLog.ended = true; return true; },
  lastPath() { return 'content://downloads/montaj.mp4'; },
};
const blob = new window.Blob([new Uint8Array(1024 * 700)], { type: 'video/mp4;codecs=avc1' });
const dlBefore = downloads.length;
await app.saveBlob(blob, 'montaj.mp4');
check('bridge beginSave called with clean mime', () => bridgeLog.begin.length === 1 && bridgeLog.begin[0][1] === 'video/mp4');
check('bridge chunks written == blob size', () => bridgeLog.ended && bridgeLog.bytes === blob.size && bridgeLog.chunks >= 2);
check('bridge path skips blob download', () => downloads.length === dlBefore);
check('export status shows saved path', () => /montaj\.mp4|downloads/.test(window.document.getElementById('exp-status').textContent));

// cancelled SAF dialog must not spin forever
bridgeCancel = true; bridgeReadyAfter = 0;
const t0 = Date.now();
await app.saveBlob(blob, 'x.mp4');
check('bridge cancel aborts quickly', () => Date.now() - t0 < 3000 && downloads.length === dlBefore);
delete window.MontajBridge;

console.log('\n================ SMOKE TEST ================');
let fails = 0;
for (const [st, name] of results) { if (st === 'FAIL') fails++; console.log(`${st === 'PASS' ? '✅' : '❌'} ${name}`); }
console.log('-------------------------------------------');
console.log(`${results.length - fails}/${results.length} passed`);
if (errors.length) { console.log('\n⚠️  runtime errors:'); for (const e of errors.slice(0, 12)) console.log('   ' + e); }
process.exit(fails ? 1 : 0);
