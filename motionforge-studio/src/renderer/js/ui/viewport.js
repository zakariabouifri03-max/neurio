// The animation canvas: display, pan/zoom, overlays and pointer dispatch to tools.
import { h, M, mkCanvas, clamp, raf } from '../core/util.js';
import { S, bus, scene, curLayer, layerById } from '../core/state.js';
import { renderScene, currentCamera, sceneCamMatrix } from '../core/render.js';
import { cameraMatrix } from '../core/anim.js';
import { TOOLS } from '../tools/tools.js';
import { overlayRig } from '../tools/overlays.js';

export const QUALITY = { draft: { s: 0.5, smooth: false }, normal: { s: 1, smooth: true }, high: { s: 1.5, smooth: true }, final: { s: 2, smooth: true } };
let el, canvas, g, sceneCv, sg;
let spaceDown = false, panning = null, lastMouse = { x: 0, y: 0 }, hover = null;
const state = { fitted: false, autoProxy: false, renderMs: 0 };
export const VP = { state };

function sizeCanvas() {
  const r = el.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(10, Math.round(r.width * dpr)); canvas.height = Math.max(10, Math.round(r.height * dpr));
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  VP.dpr = dpr; VP.w = r.width; VP.h = r.height;
  if (!state.fitted && S.project) VP.fit();
  VP.render();
}
VP.init = function (container) {
  el = container; canvas = h('canvas.main'); g = canvas.getContext('2d'); sceneCv = mkCanvas(16, 16); sg = sceneCv.getContext('2d');
  el.append(canvas);
  new ResizeObserver(sizeCanvas).observe(el);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', () => { hover = null; VP.render(); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const t = TOOLS[S.tool]; if (t && t.dbl) { t.dbl(norm(e)); VP.render(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => { if (e.key === ' ' ) spaceDown = true; });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  bus.on('render', VP.render);
  bus.on('tool', () => { canvas.style.cursor = (TOOLS[S.tool] && TOOLS[S.tool].cursor) || 'default'; const t = TOOLS[S.tool]; t && t.activate && t.activate(); VP.render(); });
  sizeCanvas();
};
VP.el = () => el; VP.canvas = () => canvas;
VP.sceneCanvas = () => sceneCv;
VP.fit = function () {
  const P = S.project; if (!P || !VP.w) return;
  const z = Math.min((VP.w - 80) / P.width, (VP.h - 80) / P.height);
  S.view.zoom = clamp(z, 0.05, 16); S.view.panX = (VP.w - P.width * S.view.zoom) / 2; S.view.panY = (VP.h - P.height * S.view.zoom) / 2; state.fitted = true;
  bus.emit('view'); VP.render();
};
VP.zoomTo = function (z, cx = VP.w / 2, cy = VP.h / 2) {
  const v = S.view; z = clamp(z, 0.05, 32);
  const sx = (cx - v.panX) / v.zoom, sy = (cy - v.panY) / v.zoom;
  v.zoom = z; v.panX = cx - sx * z; v.panY = cy - sy * z; bus.emit('view'); VP.render();
};
/** screen → scene coordinates (accounts for camera view) */
VP.viewMatrix = () => M.mul(M.T(S.view.panX, S.view.panY), M.S(S.view.zoom, S.view.zoom));
VP.camInv = () => (S.ui.cameraView && S.project ? M.inv(sceneCamMatrix(scene(), S.frame, 1)) : M.I());
VP.toScene = (sx, sy) => { const v = S.view; const x = (sx - v.panX) / v.zoom, y = (sy - v.panY) / v.zoom; return M.pt(VP.camInv(), x, y); };
VP.toScreen = (x, y) => { const v = S.view; const c = S.ui.cameraView ? sceneCamMatrix(scene(), S.frame, 1) : M.I(); const p = M.pt(c, x, y); return [p[0] * v.zoom + v.panX, p[1] * v.zoom + v.panY]; };
/** Matrix mapping scene → screen css px (for overlays) */
VP.sceneToScreen = () => M.mul(VP.viewMatrix(), S.ui.cameraView ? sceneCamMatrix(scene(), S.frame, 1) : M.I());

function norm(e) {
  const r = canvas.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; const p = VP.toScene(sx, sy);
  return { x: p[0], y: p[1], sx, sy, pressure: e.pointerType === 'mouse' ? (e.buttons ? 0.5 : 0) : e.pressure, pointerType: e.pointerType, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, e };
}
function onDown(e) {
  canvas.focus && canvas.focus(); try { canvas.setPointerCapture(e.pointerId); } catch {}
  if (e.button === 1 || e.button === 2 || S.tool === 'hand' || (spaceDown && e.button === 0 && false)) { panning = { x: e.clientX, y: e.clientY, px: S.view.panX, py: S.view.panY }; canvas.style.cursor = 'grabbing'; return; }
  if (S.playing && S.tool !== 'hand') return;
  const t = TOOLS[S.tool]; if (!t || !t.down) return;
  const p = norm(e); VP.drag = true; t.down(p); VP.render();
}
function onMove(e) {
  lastMouse = { x: e.offsetX, y: e.offsetY };
  if (panning) { S.view.panX = panning.px + e.clientX - panning.x; S.view.panY = panning.py + e.clientY - panning.y; bus.emit('view'); VP.render(); return; }
  const t = TOOLS[S.tool]; const p = norm(e);
  hover = p;
  if (VP.drag && t && t.move) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs.length ? evs : [e]) { const q = norm(ce); q.pressure = ce.pointerType === 'mouse' ? 0.5 : ce.pressure; t.move(q); }
  } else if (t && t.hover) t.hover(p);
  VP.render();
}
function onUp(e) {
  if (panning) { panning = null; canvas.style.cursor = (TOOLS[S.tool] && TOOLS[S.tool].cursor) || 'default'; return; }
  if (!VP.drag) return; VP.drag = false;
  const t = TOOLS[S.tool]; if (t && t.up) t.up(norm(e)); VP.render();
}
function onWheel(e) {
  e.preventDefault();
  if (e.shiftKey) { S.view.panX -= e.deltaY; bus.emit('view'); VP.render(); return; }
  if (e.ctrlKey || true) { const k = Math.exp(-e.deltaY * 0.0015); const r = canvas.getBoundingClientRect(); VP.zoomTo(S.view.zoom * k, e.clientX - r.left, e.clientY - r.top); }
}
VP.hover = () => hover;

let rendering = false;
VP.render = raf(function renderNow() {
  if (!g || !S.project || !VP.w) return;
  const t0 = performance.now();
  const P = S.project, sc = scene(); if (!sc) return;
  const dpr = VP.dpr; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0d0f14'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let q = QUALITY[S.ui.quality] || QUALITY.normal;
  let qs = q.s; if (S.playing && state.autoProxy) qs = Math.min(qs, 0.5); // proxy preview for heavy scenes
  // scene render target scale (limit to 4096)
  const sW = clamp(Math.round(P.width * qs), 64, 4096), sH = Math.round(sW * P.height / P.width);
  if (sceneCv.width !== sW || sceneCv.height !== sH) { sceneCv.width = sW; sceneCv.height = sH; }
  const useCam = S.playing || S.ui.cameraView || S.exportingPreview;
  const onion = !S.playing && S.project.settings.onion.enabled ? S.project.settings.onion : null;
  const lay = curLayer();
  renderScene(sg, sc, S.frame, { camera: useCam, scale: sW / P.width, transparent: true, smooth: q.smooth, onion, onionLayerId: lay && onion ? lay.id : null, restLayerId: S.ui.rigEdit && lay && lay.char ? lay.id : null });
  const V = VP.viewMatrix(); const z = S.view.zoom;
  g.save(); M.apply(g, V);
  // canvas backdrop
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 30 / z; g.fillStyle = '#fff'; g.fillRect(0, 0, P.width, P.height); g.shadowBlur = 0;
  if (sc.bg.transparent) { drawChecker(g, P.width, P.height, z); } else { g.fillStyle = sc.bg.color; g.fillRect(0, 0, P.width, P.height); }
  g.imageSmoothingEnabled = z < 2 && q.smooth; g.imageSmoothingQuality = 'high';
  g.drawImage(sceneCv, 0, 0, P.width, P.height);
  g.restore();
  if (!S.playing) drawOverlays(sc, z);
  state.renderMs = state.renderMs * 0.8 + (performance.now() - t0) * 0.2;
});
function drawChecker(ctx, W, H, z) {
  const s = 16 / z; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#d9dce3';
  for (let y = 0; y * s < H; y++) for (let x = 0; x * s < W; x++) if ((x + y) & 1) ctx.fillRect(x * s, y * s, s, s);
  ctx.restore();
}
function drawOverlays(sc, z) {
  const P = S.project; const V = VP.viewMatrix(); const c2s = VP.sceneToScreen();
  // frame border
  g.save(); M.apply(g, V); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1 / z; g.strokeRect(0, 0, P.width, P.height);
  if (S.ui.showGrid) { g.strokeStyle = 'rgba(120,130,160,.25)'; g.lineWidth = 1 / z; const step = 64; g.beginPath(); for (let x = step; x < P.width; x += step) { g.moveTo(x, 0); g.lineTo(x, P.height); } for (let y = step; y < P.height; y += step) { g.moveTo(0, y); g.lineTo(P.width, y); } g.stroke(); }
  if (S.ui.showSafe) { g.strokeStyle = 'rgba(255,200,60,.5)'; g.setLineDash([6 / z, 4 / z]); g.strokeRect(P.width * 0.05, P.height * 0.05, P.width * 0.9, P.height * 0.9); g.strokeRect(P.width * 0.1, P.height * 0.1, P.width * 0.8, P.height * 0.8); g.setLineDash([]); }
  // camera frame
  if (!S.ui.cameraView) {
    const cam = currentCamera(sc, S.frame); const inv = M.inv(cameraMatrix(cam, P.width, P.height));
    const pts = [[0, 0], [P.width, 0], [P.width, P.height], [0, P.height]].map(([x, y]) => M.pt(inv, x, y));
    const moved = Math.abs(cam.zoom - 1) > 0.001 || Math.abs(cam.rot) > 0.01 || Math.abs(cam.x - P.width / 2) > 0.5 || Math.abs(cam.y - P.height / 2) > 0.5;
    if (moved || sc.camera.tracks.zoom || sc.camera.follow) {
      g.strokeStyle = '#ffb454'; g.lineWidth = 1.5 / z; g.setLineDash([8 / z, 5 / z]); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffb454'; g.font = `${11 / z}px sans-serif`; g.fillText('CAMERA', pts[0][0] + 4 / z, pts[0][1] + 14 / z);
    }
  }
  g.restore();
  const lay = curLayer();
  if (lay && lay.char) overlayRig(g, lay, c2s, z);
  const t = TOOLS[S.tool]; if (t && t.overlay) { g.save(); t.overlay(g, c2s, z, hover); g.restore(); }
  // brush cursor
  if (hover && ['brush', 'pencil', 'eraser'].includes(S.tool) && !VP.panning) {
    const r = Math.max(1, S.brush.size * S.view.zoom / 2); g.save(); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1; g.beginPath(); g.arc(hover.sx, hover.sy, r, 0, Math.PI * 2); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(hover.sx, hover.sy, r + 1, 0, Math.PI * 2); g.stroke(); g.restore();
  }
}
