// Global application state + event bus.
import { Emitter } from './util.js';
export const bus = new Emitter();
export const S = {
  project: null,
  filePath: null,
  dirty: false,
  frame: 0,
  playing: false,
  loop: true,
  selection: { layerId: null, boneId: null, range: null /* {layerId,start,end} */, keyFrame: null },
  tool: 'brush',
  color: '#1b1f2a',
  color2: '#ffffff',
  brush: { type: 'ink', size: 8, opacity: 1, hardness: 0.85, smoothing: 0.4, stabilization: 0.2, pressure: true, spacing: 0.12 },
  shape: { kind: 'rect', fill: false, stroke: true, lineWidth: 4 },
  text: { size: 48, font: 'Segoe UI', bold: false },
  fillOpt: { tolerance: 24, gap: 2, contiguous: true },
  ui: { mode: 'pro', autokey: true, quality: 'normal', cameraView: false, showGrid: false, showSafe: false, showBones: true, snap: false, tlZoom: 14, ikDrag: true, rigEdit: false, onlyActiveOnion: true },
  view: { zoom: 1, panX: 0, panY: 0 },
  settings: {},
  aiBusy: false,
};
export const scene = () => S.project && S.project.scenes.find((s) => s.id === S.project.activeScene);
export function layerById(id, sc = scene()) {
  if (!sc || !id) return null;
  let r = null;
  const walk = (list) => { for (const l of list) { if (l.id === id) { r = l; return; } if (l.children) walk(l.children); if (r) return; } };
  walk(sc.layers);
  return r;
}
export const curLayer = () => layerById(S.selection.layerId);
export function allLayers(sc = scene(), out = []) {
  const walk = (list) => { for (const l of list) { out.push(l); if (l.children) walk(l.children); } };
  if (sc) walk(sc.layers);
  return out;
}
export function containerOf(id, sc = scene()) {
  let r = null;
  const walk = (list, parent) => { list.forEach((l, i) => { if (l.id === id) r = { list, index: i, parent }; else if (l.children && !r) walk(l.children, l); }); };
  if (sc) walk(sc.layers, null);
  return r;
}
export const sceneDuration = (sc = scene()) => {
  if (!sc) return 1;
  let m = sc.duration || 1;
  for (const l of allLayers(sc)) {
    if (l.cels && l.cels.length) m = Math.max(m, l.cels[l.cels.length - 1].f + 1);
    if (l.tracks) for (const k in l.tracks) { const t = l.tracks[k]; if (t.length) m = Math.max(m, t[t.length - 1].f + 1); }
  }
  return m;
};
export const fps = () => (S.project ? S.project.fps : 24);
export function notify(what = 'change') { S.dirty = true; bus.emit(what); bus.emit('render'); }
