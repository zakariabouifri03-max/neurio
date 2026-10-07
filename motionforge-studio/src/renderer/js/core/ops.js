// High-level, undoable editing operations (layers, frames, keyframes, camera, scenes).
import { S, bus, scene, layerById, containerOf, allLayers, fps, sceneDuration, notify } from './state.js';
import { H } from './history.js';
import { newLayer, newScene, createCel, cloneCel, cels, celCanvas, touchCel } from './model.js';
import { uid, deepClone, mkCanvas, clamp } from './util.js';
import { celIndexAt, celAt, celSpan, setKey, removeKey, getKey, trackIndex, layerProp, layerBase, writeProp, hasKeys, evalTrack, layerKeyFrames } from './anim.js';
import { evalLayer } from './rig.js';

// ───────── layers ─────────
export function select(layerId) { S.selection.layerId = layerId; S.selection.boneId = null; bus.emit('selection'); bus.emit('render'); }
export function addLayer(type = 'draw', name, opts = {}) {
  return H.tx('Add layer', () => {
    const sc = scene(); const l = newLayer(type, name || (type === 'group' ? 'Group' : type === 'draw' ? `Drawing ${allLayers(sc).filter((x) => x.type === 'draw').length + 1}` : 'Layer'));
    if (opts.layer) Object.assign(l, opts.layer);
    const cur = S.selection.layerId && containerOf(S.selection.layerId);
    if (cur) cur.list.splice(cur.index + 1, 0, l); else sc.layers.push(l);
    S.selection.layerId = l.id; S.selection.boneId = null;
    return l;
  });
}
export function insertLayer(l, atTop = true) {
  const sc = scene();
  const cur = S.selection.layerId && containerOf(S.selection.layerId);
  if (cur && !atTop) cur.list.splice(cur.index + 1, 0, l); else if (cur) cur.list.splice(cur.index + 1, 0, l); else sc.layers.push(l);
  S.selection.layerId = l.id;
}
export function cloneLayerDeep(l) {
  const c = deepClone(l); c.id = uid('ly'); c.name = l.name + ' copy';
  if (c.cels) c.cels = c.cels.map((k) => ({ f: k.f, id: k.id ? cloneCel(k.id) : null }));
  if (c.children) c.children = c.children.map((ch) => { const cc = cloneLayerDeep(ch); cc.name = ch.name; return cc; });
  return c;
}
export function duplicateLayer(id) {
  return H.tx('Duplicate layer', () => {
    const ct = containerOf(id); if (!ct) return;
    const c = cloneLayerDeep(ct.list[ct.index]); ct.list.splice(ct.index + 1, 0, c); S.selection.layerId = c.id; return c;
  });
}
export function deleteLayer(id) {
  H.tx('Delete layer', () => {
    const ct = containerOf(id); if (!ct) return;
    ct.list.splice(ct.index, 1);
    const sc = scene(); const nxt = ct.list[Math.min(ct.index, ct.list.length - 1)] || allLayers(sc)[0];
    S.selection.layerId = nxt ? nxt.id : null; S.selection.boneId = null;
  });
}
export function renameLayer(id, name) { H.tx('Rename layer', () => { const l = layerById(id); if (l && name) l.name = name; }); }
export function setLayerFlag(id, key, v) {
  H.tx('Layer ' + key, () => { const l = layerById(id); if (l) l[key] = v; });
}
export function setLayerBase(id, key, v) { H.tx('Layer ' + key, () => { const l = layerById(id); if (l) l.base[key] = v; }); }
export function moveLayer(id, targetId, where) { // where: 'above'|'below'|'into'
  H.tx('Reorder layers', () => {
    const src = containerOf(id); const dst = containerOf(targetId); if (!src || !dst || id === targetId) return;
    const l = src.list[src.index];
    // prevent dropping group into itself
    const inside = (g, tid) => g.children && g.children.some((c) => c.id === tid || inside(c, tid));
    if (inside(l, targetId)) return;
    src.list.splice(src.index, 1);
    const d2 = containerOf(targetId);
    if (where === 'into' && d2.list[d2.index].type === 'group') d2.list[d2.index].children.push(l);
    else d2.list.splice(where === 'above' ? d2.index + 1 : d2.index, 0, l); // array is bottom→top; "above" = higher index
  });
}
export function groupLayers(ids) {
  H.tx('Group layers', () => {
    const sc = scene(); const first = containerOf(ids[0]); if (!first) return;
    const g = newLayer('group', 'Group'); const items = [];
    for (const id of ids) { const ct = containerOf(id); if (ct && ct.list === first.list) items.push(ct.list[ct.index]); }
    items.sort((a, b) => first.list.indexOf(a) - first.list.indexOf(b));
    const at = first.list.indexOf(items[0]);
    items.forEach((it) => first.list.splice(first.list.indexOf(it), 1));
    g.children = items; first.list.splice(at, 0, g); S.selection.layerId = g.id;
  });
}
export function ungroup(id) {
  H.tx('Ungroup', () => { const ct = containerOf(id); const g = ct && ct.list[ct.index]; if (!g || g.type !== 'group') return; ct.list.splice(ct.index, 1, ...g.children); S.selection.layerId = g.children[0] ? g.children[0].id : null; });
}
export function mergeDown(id) {
  H.tx('Merge down', () => {
    const ct = containerOf(id); if (!ct || ct.index === 0) return;
    const top = ct.list[ct.index], below = ct.list[ct.index - 1];
    if (top.type !== 'draw' || below.type !== 'draw') return;
    const f = S.frame; const a = celAt(top, f), b = celAt(below, f); if (!a || !a.id) return;
    let bid = b && b.id; if (!bid) { bid = createCel(); below.cels.push({ f: 0, id: bid }); below.cels.sort((x, y) => x.f - y.f); }
    const dst = celCanvas(bid, true); const src = celCanvas(a.id); if (!src) return;
    const g = dst.getContext('2d'); g.save(); g.globalAlpha = top.base.opacity; g.drawImage(src, 0, 0); g.restore(); touchCel(bid);
    ct.list.splice(ct.index, 1); S.selection.layerId = below.id;
  });
}

// ───────── frame / cel operations ─────────
function shiftCels(layer, from, delta) { for (const k of layer.cels) if (k.f >= from) k.f += delta; }
function shiftProps(layer, from, delta) { for (const tr of Object.values(layer.tracks || {})) for (const k of tr) if (k.f >= from) k.f += delta; }
export function curDrawLayer() { const l = layerById(S.selection.layerId); return l && l.type === 'draw' ? l : null; }
function sortCels(l) { l.cels.sort((a, b) => a.f - b.f); }
function ensureCels(l) { if (!l.cels) l.cels = []; }

export function newBlankFrame(layerId = S.selection.layerId, f = S.frame) {
  H.tx('New blank frame', () => {
    const l = layerById(layerId); if (!l) return;
    if (l.type === 'draw') { ensureCels(l); shiftCels(l, f + 1, 1); l.cels.push({ f: f + 1, id: createCel() }); sortCels(l); }
    else shiftProps(l, f + 1, 1);
    S.frame = f + 1; S.selection.range = { layerId: l.id, start: f + 1, end: f + 1 };
  });
}
export function duplicateFrame(layerId = S.selection.layerId, f = S.frame) {
  H.tx('Duplicate frame', () => {
    const l = layerById(layerId); if (!l) return;
    if (l.type === 'draw') {
      ensureCels(l); const c = celAt(l, f); shiftCels(l, f + 1, 1);
      l.cels.push({ f: f + 1, id: c && c.id ? cloneCel(c.id) : null }); sortCels(l);
    } else {
      shiftProps(l, f + 1, 1);
      for (const [n, tr] of Object.entries(l.tracks || {})) if (tr.length) setKey(tr, f + 1, evalTrack(tr, f, layerBase(l, n)), 'linear');
    }
    S.frame = f + 1; S.selection.range = { layerId: l.id, start: f + 1, end: f + 1 };
  });
}
export function newKeyframe(layerId = S.selection.layerId, f = S.frame) {
  return H.tx('New keyframe', () => {
    const l = layerById(layerId); if (!l) return;
    if (l.type === 'draw') {
      ensureCels(l); const i = celIndexAt(l, f);
      if (i >= 0 && l.cels[i].f === f) return;
      const c = i >= 0 ? l.cels[i] : null;
      l.cels.push({ f, id: c && c.id ? cloneCel(c.id) : createCel() }); sortCels(l);
    } else addKeyframeAt(l, f);
  });
}
export function blankKeyframe(layerId = S.selection.layerId, f = S.frame) {
  H.tx('Blank keyframe', () => {
    const l = layerById(layerId); if (!l || l.type !== 'draw') return;
    ensureCels(l); const i = celIndexAt(l, f);
    if (i >= 0 && l.cels[i].f === f) l.cels[i].id = createCel(); else { l.cels.push({ f, id: createCel() }); sortCels(l); }
  });
}
export function holdFrame(layerId = S.selection.layerId, f = S.frame, n = 1) {
  H.tx('Extend hold', () => {
    const l = layerById(layerId); if (!l) return;
    if (l.type === 'draw') { ensureCels(l); const i = celIndexAt(l, f); if (i < 0) return; const [, e] = celSpan(l, i, sceneDuration()); shiftCels(l, e, n); if (i === l.cels.length - 1) scene().duration = Math.max(scene().duration, e + n); }
    else shiftProps(l, f + 1, n);
    scene().duration = Math.max(scene().duration, sceneDuration() + 0);
  });
}
export function setExposure(layerId, f, n) {
  H.tx('Set exposure', () => {
    const l = layerById(layerId); if (!l || l.type !== 'draw') return; const i = celIndexAt(l, f); if (i < 0) return;
    const [s, e] = celSpan(l, i, sceneDuration()); const cur = e - s; n = Math.max(1, Math.round(n)); const d = n - cur;
    if (i === l.cels.length - 1) { scene().duration = Math.max(scene().duration, s + n); return; }
    if (d > 0) shiftCels(l, e, d); else if (d < 0) { for (const k of l.cels) if (k.f >= e) k.f += d; }
  });
}
export function deleteFrames(layerId = S.selection.layerId, start = S.frame, end = start) {
  H.tx('Delete frame', () => {
    const l = layerById(layerId); if (!l) return; const n = end - start + 1;
    if (l.type === 'draw') {
      ensureCels(l); const dur = sceneDuration();
      const keep = [];
      for (let i = 0; i < l.cels.length; i++) {
        const k = l.cels[i]; const nextF = i + 1 < l.cels.length ? l.cels[i + 1].f : Infinity;
        if (k.f >= start && k.f <= end) { if (nextF > end + 1 && nextF !== Infinity) keep.push({ f: end + 1, id: k.id }); else if (nextF === Infinity && k.f <= end && dur > end + 1) keep.push({ f: end + 1, id: k.id }); }
        else keep.push({ ...k });
      }
      // dedupe same frame
      const m = new Map(); keep.forEach((k) => m.set(k.f, k)); l.cels = [...m.values()].sort((a, b) => a.f - b.f);
      for (const k of l.cels) if (k.f > end) k.f -= n;
      if (!l.cels.length) l.cels.push({ f: 0, id: null });
    } else {
      for (const tr of Object.values(l.tracks || {})) { for (let i = tr.length - 1; i >= 0; i--) if (tr[i].f >= start && tr[i].f <= end) tr.splice(i, 1); for (const k of tr) if (k.f > end) k.f -= n; }
    }
    S.frame = Math.max(0, start - (start > 0 && start >= sceneDuration() ? 1 : 0)); S.selection.range = { layerId, start: S.frame, end: S.frame };
  });
}
export function moveCel(layerId, fromF, toF, copy = false) {
  H.tx(copy ? 'Copy frame' : 'Move frame', () => {
    const l = layerById(layerId); if (!l || !l.cels) return; const i = l.cels.findIndex((k) => k.f === fromF); if (i < 0 || fromF === toF) return;
    const k = l.cels[i]; const id = copy && k.id ? cloneCel(k.id) : k.id;
    if (!copy) l.cels.splice(i, 1);
    l.cels = l.cels.filter((x) => x.f !== toF); l.cels.push({ f: toF, id }); sortCels(l); if (!l.cels.some((x) => x.f === 0)) { /* fine: nothing before first key */ }
  });
}
export function moveKeyframeColumn(layerId, fromF, toF, copy = false) {
  H.tx('Move keyframes', () => {
    const l = layerById(layerId); if (!l) return;
    for (const tr of Object.values(l.tracks || {})) { const k = getKey(tr, fromF); if (!k) continue; const nk = { ...k, f: toF, bz: k.bz && k.bz.slice() }; if (!copy) removeKey(tr, fromF); removeKey(tr, toF); tr.push(nk); tr.sort((a, b) => a.f - b.f); }
  });
}
export function setSceneLength(n) { H.tx('Scene length', () => { scene().duration = Math.max(1, Math.round(n)); }); }

// ───────── property keyframes ─────────
export function layerKeyNames(l) {
  const names = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'opacity'];
  if (l.char) for (const b of l.char.bones) names.push(`b.${b.id}.rot`);
  return names;
}
export function addKeyframeAt(l, f) {
  l.tracks = l.tracks || {}; l.base = l.base || {};
  const ev = l.type === 'group' || l.char || true ? evalLayer(l, f) : null;
  const valOf = (name) => {
    if (name in ev) return ev[name];
    const m = /^b\.(.+)\.rot$/.exec(name); if (m && ev.bone && ev.bone[m[1]]) return ev.bone[m[1]].rot;
    return layerProp(l, name, f);
  };
  for (const name of layerKeyNames(l)) {
    const tr = (l.tracks[name] = l.tracks[name] || []);
    if (!tr.length && f > 0) setKey(tr, 0, layerBase(l, name), 'easeInOut');
    setKey(tr, f, valOf(name));
  }
}
export function addKeyframeSel() { H.tx('Add keyframe', () => { const l = layerById(S.selection.layerId); if (l) addKeyframeAt(l, S.frame); }); }
export function deleteKeyframeAt(layerId = S.selection.layerId, f = S.frame) {
  H.tx('Delete keyframe', () => { const l = layerById(layerId); if (!l) return; for (const tr of Object.values(l.tracks || {})) removeKey(tr, f); });
}
export function deleteKey(layerId, name, f) { H.tx('Delete key', () => { const l = layerById(layerId); if (l && l.tracks[name]) removeKey(l.tracks[name], f); }); }
export function setKeyEase(layerId, name, f, e, bz) {
  H.tx('Set easing', () => { const l = layerById(layerId); if (!l) return; const k = getKey(l.tracks[name], f); if (k) { k.e = e; if (e === 'bezier') k.bz = bz || k.bz || [0.25, 0.1, 0.25, 1]; } });
}
export function setEaseForFrame(layerId, f, e, bz) {
  H.tx('Set easing', () => { const l = layerById(layerId); if (!l) return; for (const tr of Object.values(l.tracks || {})) { const k = getKey(tr, f); if (k) { k.e = e; if (e === 'bezier') k.bz = bz || k.bz || [0.25, 0.1, 0.25, 1]; } } });
}
export function setProp(layerId, name, v, { frame = S.frame, label } = {}) {
  H.tx(label || 'Edit ' + name, () => { const l = layerById(layerId); if (l) writeProp(l, name, frame, v, S.ui.autokey); });
}
let keyClip = null;
export function copyKeysAt(layerId = S.selection.layerId, f = S.frame) {
  const l = layerById(layerId); if (!l) return false; const out = {};
  for (const [n, tr] of Object.entries(l.tracks || {})) { const k = getKey(tr, f); if (k) out[n] = { v: k.v, e: k.e, bz: k.bz }; }
  keyClip = Object.keys(out).length ? out : null; return !!keyClip;
}
export function pasteKeysAt(layerId = S.selection.layerId, f = S.frame) {
  if (!keyClip) return false;
  H.tx('Paste keyframe', () => { const l = layerById(layerId); if (!l) return; for (const [n, k] of Object.entries(keyClip)) { const tr = (l.tracks[n] = l.tracks[n] || []); if (!tr.length && f > 0) setKey(tr, 0, layerBase(l, n)); setKey(tr, f, k.v, k.e, k.bz); } });
  return true;
}
export function nextKeyFrame(dir) {
  const l = layerById(S.selection.layerId); if (!l) return null;
  const set = new Set(layerKeyFrames(l)); if (l.cels) l.cels.forEach((c) => set.add(c.f));
  const a = [...set].sort((x, y) => x - y);
  if (dir > 0) return a.find((x) => x > S.frame) ?? null;
  return [...a].reverse().find((x) => x < S.frame) ?? null;
}

// ───────── camera ─────────
export function setCameraProp(name, v, f = S.frame) { H.tx('Camera ' + name, () => { writeProp(scene().camera, name, f, v, S.ui.autokey); }); }
export function addCameraKey(f = S.frame) {
  H.tx('Camera keyframe', () => {
    const cam = scene().camera;
    for (const n of ['x', 'y', 'zoom', 'rotation']) { const tr = (cam.tracks[n] = cam.tracks[n] || []); if (!tr.length && f > 0) setKey(tr, 0, cam.base[n]); setKey(tr, f, layerProp(cam, n, f)); }
  });
}
export function setCameraShake(on, o = {}) {
  H.tx('Camera shake', () => { const cam = scene().camera; cam.shake = on ? { start: o.start ?? S.frame, len: o.len ?? Math.round(fps()), amp: o.amp ?? 14, seed: Math.round(Math.random() * 1000), decay: true } : null; });
}
export function setCameraFollow(layerId, o = {}) { H.tx('Camera follow', () => { scene().camera.follow = layerId ? { layerId, lag: o.lag ?? 8, ox: 0, oy: o.oy ?? 0 } : null; }); }
export function addShot(name) {
  H.tx('Add shot', () => {
    const sc = scene(); const f = S.frame; const cam = sc.camera;
    sc.shots = sc.shots || []; sc.shots.push({ id: uid('sh'), name: name || `Shot ${sc.shots.length + 1}`, start: f, end: Math.max(f, sceneDuration(sc) - 1) });
    sc.shots.sort((a, b) => a.start - b.start);
    sc.shots.forEach((s, i) => { s.end = i + 1 < sc.shots.length ? sc.shots[i + 1].start - 1 : Math.max(s.start, sceneDuration(sc) - 1); });
    // hard cut: hold previous camera values until this frame
    for (const n of ['x', 'y', 'zoom', 'rotation']) {
      const tr = (cam.tracks[n] = cam.tracks[n] || []);
      const v = layerProp(cam, n, f);
      if (f > 0) { if (!tr.length) setKey(tr, 0, cam.base[n], 'hold'); else { const i = trackIndex(tr, f - 1); if (i >= 0) tr[i].e = 'hold'; } }
      setKey(tr, f, v, 'easeInOut');
    }
  });
}
export function deleteShot(id) { H.tx('Delete shot', () => { const sc = scene(); sc.shots = sc.shots.filter((s) => s.id !== id); sc.shots.forEach((s, i) => { s.end = i + 1 < sc.shots.length ? sc.shots[i + 1].start - 1 : Math.max(s.start, sceneDuration(sc) - 1); }); }); }

// ───────── scenes ─────────
export function switchScene(id) { if (!S.project.scenes.some((s) => s.id === id)) return; S.project.activeScene = id; S.frame = 0; S.selection = { layerId: null, boneId: null, range: null, keyFrame: null }; const l = allLayers(scene())[0]; if (l) S.selection.layerId = l.id; bus.emit('scene'); bus.emit('change'); bus.emit('render'); bus.emit('selection'); }
export function addScene(name) {
  const P = S.project; const sc = newScene(name || `Scene ${P.scenes.length + 1}`, P.width, P.height, P.fps * 2);
  H.tx('Add scene', () => { sc.bg.color = scene().bg.color; sc.layers.push(newLayer('draw', 'Drawing 1')); P.scenes.push(sc); });
  switchScene(sc.id);
}
export function duplicateScene(id) {
  const P = S.project; const src = P.scenes.find((s) => s.id === id); if (!src) return;
  let nid;
  H.tx('Duplicate scene', () => {
    const c = deepClone(src); c.id = uid('sc'); c.name = src.name + ' copy'; nid = c.id;
    const fix = (list) => list.map((l) => { const ll = { ...l, id: uid('ly') }; if (ll.cels) ll.cels = ll.cels.map((k) => ({ f: k.f, id: k.id ? cloneCel(k.id) : null })); if (ll.children) ll.children = fix(ll.children); return ll; });
    const idMap = {}; // keep follow target consistent
    c.layers = fix(c.layers); c.camera.follow = null;
    P.scenes.splice(P.scenes.indexOf(src) + 1, 0, c);
  });
  switchScene(nid);
}
export function deleteScene(id) {
  const P = S.project; if (P.scenes.length < 2) return false;
  H.tx('Delete scene', () => { const i = P.scenes.findIndex((s) => s.id === id); P.scenes.splice(i, 1); if (P.activeScene === id) P.activeScene = P.scenes[Math.max(0, i - 1)].id; });
  switchScene(S.project.activeScene); return true;
}
export function renameScene(id, name) { H.tx('Rename scene', () => { const s = S.project.scenes.find((x) => x.id === id); if (s && name) s.name = name; }); }
export function moveScene(id, dir) { H.tx('Reorder scenes', () => { const a = S.project.scenes; const i = a.findIndex((s) => s.id === id); const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; }); }

export function ensureDrawLayer() {
  let l = layerById(S.selection.layerId);
  if (l && l.type === 'draw') return l;
  l = [...allLayers()].reverse().find((x) => x.type === 'draw' && !x.locked);
  if (l) { S.selection.layerId = l.id; bus.emit('selection'); return l; }
  return addLayer('draw');
}
