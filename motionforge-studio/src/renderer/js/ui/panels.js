// Right-side panels: Layers, Properties, Camera, Scenes/Storyboard.
import { h, clamp, mkCanvas } from '../core/util.js';
import { S, bus, scene, layerById, allLayers, curLayer, fps, sceneDuration } from '../core/state.js';
import { H } from '../core/history.js';
import { BLEND_MODES, celCanvas, assetImage } from '../core/model.js';
import { celAt, layerProp, getKey, setKey, removeKey, layerBase, hasKeys } from '../core/anim.js';
import * as ops from '../core/ops.js';
import { makeFrameCanvas } from '../core/render.js';
import { icon } from './icons.js';
import { button, iconButton, numField, selectField, checkField, colorField, section, slider, contextMenu, askText, confirmBox, toast } from './common.js';
import { layerLocalBBox } from '../tools/tools.js';
import { evalLayer, layerMatrix } from '../core/rig.js';
import { M } from '../core/util.js';
import { runCommand } from '../core/commands.js';

// ═════════════ Layers ═════════════
let dragId = null;
export function layersPanel(el) {
  el.innerHTML = '';
  const sc = scene(); const wrap = h('div.layers');
  const walk = (list, depth) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i]; const sel = S.selection.layerId === l.id;
      const thumb = h('canvas.thumb', { width: 68, height: 44 }); drawThumb(thumb, l);
      const row = h('div.lrow' + (sel ? '.sel' : '') + (l.visible ? '' : '.hidden'), { draggable: 'true', style: { paddingLeft: 4 + depth * 14 + 'px' }, dataset: { id: l.id },
        on: {
          click: () => ops.select(l.id), dblclick: async (e) => { if (e.target.closest('button')) return; const n = await askText('Rename layer', 'Name', l.name); if (n) ops.renameLayer(l.id, n); },
          contextmenu: (e) => { e.preventDefault(); ops.select(l.id); layerCtx(e, l); },
          dragstart: (e) => { dragId = l.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); },
          dragover: (e) => { if (!dragId || dragId === l.id) return; e.preventDefault(); const r = row.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; row.className = row.className.replace(/ ?drop-\w+/g, ''); row.classList.add(l.type === 'group' && y > 0.3 && y < 0.7 ? 'drop-into' : y < 0.5 ? 'drop-above' : 'drop-below'); },
          dragleave: () => { row.className = row.className.replace(/ ?drop-\w+/g, ''); },
          drop: (e) => { e.preventDefault(); const cl = row.classList; const where = cl.contains('drop-into') ? 'into' : cl.contains('drop-above') ? 'above' : 'below'; row.className = row.className.replace(/ ?drop-\w+/g, ''); if (dragId) ops.moveLayer(dragId, l.id, where === 'above' ? 'above' : where === 'below' ? 'below' : 'into'); dragId = null; },
          dragend: () => { dragId = null; },
        } },
        l.type === 'group' ? h('button.icon-btn', { style: { width: '18px', height: '18px' }, on: { click: (e) => { e.stopPropagation(); H.tx('Toggle group', () => { l.expanded = !l.expanded; }); } }, html: icon(l.expanded ? 'down' : 'chevron', 13) }) : h('span', { style: { width: '18px' } }),
        thumb, h('span.nm', { title: l.name }, l.name),
        l.clip ? h('span.pill', { title: 'Clipped to layer below' }, 'clip') : null,
        l.alphaLock ? h('span.ti', { html: icon('lock', 12), title: 'Alpha locked' }) : null,
        h('button.icon-btn.tg' + (l.visible ? '' : '.off'), { tip: l.visible ? 'Hide layer' : 'Show layer', style: { width: '22px', height: '22px' }, on: { click: (e) => { e.stopPropagation(); ops.setLayerFlag(l.id, 'visible', !l.visible); } }, html: icon(l.visible ? 'eye' : 'eyeoff', 14) }),
        h('button.icon-btn.tg' + (l.locked ? '.off' : ''), { tip: l.locked ? 'Unlock layer' : 'Lock layer', style: { width: '22px', height: '22px' }, on: { click: (e) => { e.stopPropagation(); ops.setLayerFlag(l.id, 'locked', !l.locked); } }, html: icon(l.locked ? 'lock' : 'unlock', 14) }));
      wrap.append(row);
      if (l.type === 'group' && l.expanded) walk(l.children, depth + 1);
    }
  };
  if (sc) walk(sc.layers, 0);
  const tools = h('div.layer-tools', iconButton('plus', 'New drawing layer (Ctrl+Shift+N)', () => runCommand('layer.new')), iconButton('folder', 'New group', () => runCommand('layer.group')), iconButton('copy', 'Duplicate layer', () => runCommand('layer.duplicate')), iconButton('layers', 'Merge down', () => runCommand('layer.mergeDown')), h('span', { style: { flex: 1 } }), iconButton('trash', 'Delete layer', () => runCommand('layer.delete')));
  el.append(wrap, tools);
}
function drawThumb(c, l) {
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  try {
    if (l.type === 'draw') { const k = celAt(l, S.frame); const cv = k && k.id && celCanvas(k.id); if (cv) g.drawImage(cv, 0, 0, c.width, c.height); }
    else if (l.type === 'image' && l.image) { const im = assetImage(l.image.assetId); if (im) { const k = Math.min(c.width / im.width, c.height / im.height); g.drawImage(im, (c.width - im.width * k) / 2, (c.height - im.height * k) / 2, im.width * k, im.height * k); } }
    else if (l.char) { const P = S.project; const tmp = makeFrameCanvas({ ...scene(), layers: [l], bg: { color: '#fff', transparent: true }, camera: { base: { x: P.width / 2, y: P.height / 2, zoom: 1, rotation: 0 }, tracks: {}, follow: null, shake: null } }, S.frame, c.width, c.height, { transparent: true }); g.drawImage(tmp, 0, 0); }
    else if (l.type === 'group') { g.fillStyle = '#2a3042'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#8a95b5'; g.font = '22px sans-serif'; g.fillText('▤', 24, 30); }
  } catch {}
}
function layerCtx(e, l) {
  contextMenu([
    { label: 'Rename…', run: () => runCommand('layer.rename') }, { label: 'Duplicate', run: () => ops.duplicateLayer(l.id) }, { label: 'Merge Down', run: () => ops.mergeDown(l.id), enabled: l.type === 'draw' },
    { label: l.type === 'group' ? 'Ungroup' : 'Group', run: () => (l.type === 'group' ? ops.ungroup(l.id) : ops.groupLayers([l.id])) }, '-',
    { label: 'Clip to Layer Below', checked: l.clip, run: () => ops.setLayerFlag(l.id, 'clip', !l.clip) }, { label: 'Lock Transparency (Alpha Lock)', checked: l.alphaLock, run: () => ops.setLayerFlag(l.id, 'alphaLock', !l.alphaLock) }, '-',
    { label: 'Delete', run: () => ops.deleteLayer(l.id) }], e.clientX, e.clientY);
}

// ═════════════ Properties ═════════════
function keyBtn(layer, name, onToggle) {
  const has = layer.tracks && layer.tracks[name] && getKey(layer.tracks[name], S.frame); const anim = hasKeys(layer, name);
  return h('button.icon-btn', { style: { width: '22px', height: '22px', color: has ? 'var(--key)' : anim ? '#8a7a40' : 'var(--tx3)' }, tip: has ? 'Remove keyframe at this frame' : 'Set keyframe at this frame', on: { click: onToggle }, html: icon(has ? 'key' : 'keyadd', 14) });
}
export function propRow(layerOrCam, name, label, opts = {}) {
  const isCam = layerOrCam === scene().camera;
  const getV = () => layerProp(layerOrCam, name, S.frame);
  const f = numField(label, getV(), (v) => { if (isCam) ops.setCameraProp(name, v); else ops.setProp(layerOrCam.id, name, v); }, { step: opts.step ?? 1, width: '70px' });
  f.append(keyBtn(layerOrCam, name, () => {
    H.tx('Toggle keyframe', () => {
      const tr = (layerOrCam.tracks[name] = layerOrCam.tracks[name] || []); const k = getKey(tr, S.frame);
      if (k) removeKey(tr, S.frame); else { const v = getV(); if (!tr.length && S.frame > 0) setKey(tr, 0, layerBase(layerOrCam, name), 'easeInOut'); setKey(tr, S.frame, v); }
    });
  }));
  return f;
}
export function propertiesPanel(el) {
  el.innerHTML = ''; const l = curLayer(); const sc = scene();
  if (!l) { el.append(h('div.pad.hint', 'Select a layer to edit its properties.')); }
  else {
    const kids = [];
    const nm = h('input.txt', { type: 'text', value: l.name, style: { width: '100%' } }); nm.addEventListener('change', () => ops.renameLayer(l.id, nm.value)); nm.addEventListener('keydown', (e) => e.stopPropagation());
    kids.push(section('Layer', h('div.row', nm), h('div.hint', `Type: ${l.type}${l.cat ? ' · ' + l.cat : ''}`)));
    kids.push(section('Transform', propRow(l, 'x', 'Position X'), propRow(l, 'y', 'Position Y'), propRow(l, 'rotation', 'Rotation °', { step: 1 }), propRow(l, 'scaleX', 'Scale X', { step: 0.05 }), propRow(l, 'scaleY', 'Scale Y', { step: 0.05 }), propRow(l, 'skewX', 'Skew °'),
      h('div.flex', button('Center pivot', () => centerPivot(l), { cls: 'small', tip: 'Move the pivot (rotation/scale origin) to the middle of the artwork' }), button('Flip H', () => ops.setProp(l.id, 'scaleX', -layerProp(l, 'scaleX', S.frame), { label: 'Flip' }), { cls: 'small' }))));
    kids.push(section('Appearance', propRow(l, 'opacity', 'Opacity', { step: 0.05 }), selectField('Blend mode', BLEND_MODES.map((b) => [b[0], b[1]]), l.blend, (v) => ops.setLayerFlag(l.id, 'blend', v), 'How this layer mixes with the layers below'),
      checkField('Clip to layer below', l.clip, (v) => ops.setLayerFlag(l.id, 'clip', v), 'Only visible where the layer underneath has pixels'), checkField('Lock transparency (alpha lock)', l.alphaLock, (v) => ops.setLayerFlag(l.id, 'alphaLock', v), 'Painting only affects existing pixels'),
      checkField('Visible', l.visible, (v) => ops.setLayerFlag(l.id, 'visible', v)), checkField('Locked', l.locked, (v) => ops.setLayerFlag(l.id, 'locked', v))));
    if (l.type === 'draw') {
      const k = celAt(l, S.frame);
      kids.push(section('Frames', h('div.flex', button('New key', () => ops.newKeyframe(), { cls: 'small' }), button('Blank key', () => ops.blankKeyframe(), { cls: 'small' }), button('Hold +1', () => ops.holdFrame(), { cls: 'small' }), button('Delete', () => ops.deleteFrames(l.id, S.selection.range ? S.selection.range.start : S.frame, S.selection.range ? S.selection.range.end : S.frame), { cls: 'small' })), h('div.hint', k ? `Drawing starts at frame ${k.f + 1}.` : 'No drawing on this frame yet — paint to create one.')));
    }
  kids.forEach((k) => el.append(k)); }
  el.append(section('Scene', colorField('Background', sc.bg.color, (v) => H.tx('Background', () => { sc.bg.color = v; })), checkField('Transparent background', sc.bg.transparent, (v) => H.tx('Background', () => { sc.bg.transparent = v; }), 'Exports with alpha (WebM, GIF, PNG)'),
    numField('Length (frames)', sceneDuration(), (v) => ops.setSceneLength(v), { min: 1, step: 1, width: '70px' }), h('div.hint', `${S.project.width}×${S.project.height} px @ ${S.project.fps} fps`)));
}
function centerPivot(l) {
  const hasXY = hasKeys(l, 'x') || hasKeys(l, 'y'); if (hasXY) return toast('Remove position keyframes first — moving the pivot would shift the animation.', 'warn');
  H.tx('Center pivot', () => { const bb = layerLocalBBox(l); const ev = evalLayer(l, S.frame); const lm = layerMatrix(l, ev); const c = [bb.x + bb.w / 2, bb.y + bb.h / 2]; const sp = M.pt(lm, c[0], c[1]); l.pivot = { x: c[0], y: c[1] }; l.base.x = sp[0]; l.base.y = sp[1]; });
}

// ═════════════ Camera ═════════════
export function cameraPanel(el) {
  el.innerHTML = ''; const sc = scene(); const cam = sc.camera; const sel = curLayer();
  el.append(section('Camera view',
    checkField('Look through camera', S.ui.cameraView, (v) => { S.ui.cameraView = v; bus.emit('render'); bus.emit('view'); }, 'See the scene exactly as it will be exported'),
    h('div.flex', button('Set from view', () => setCamFromView(), { cls: 'small', tip: 'Keyframe the camera so the current canvas view fills the frame' }), button('Reset', () => ops.setCameraProp('zoom', 1), { cls: 'small' }), button('Add key', () => ops.addCameraKey(), { cls: 'small', ic: 'keyadd' }))));
  el.append(section('Transform', propRow(cam, 'x', 'Center X'), propRow(cam, 'y', 'Center Y'), propRow(cam, 'zoom', 'Zoom', { step: 0.05 }), propRow(cam, 'rotation', 'Roll °')));
  el.append(section('Follow', h('div.hint', 'Make the camera track a layer with smoothing.'),
    selectField('Target', [['', '— none —'], ...allLayers(sc).filter((l) => l.type !== 'group').map((l) => [l.id, l.name])], cam.follow ? cam.follow.layerId : '', (v) => ops.setCameraFollow(v || null, { lag: cam.follow ? cam.follow.lag : 8 })),
    cam.follow ? numField('Smoothing', cam.follow.lag, (v) => H.tx('Follow', () => { cam.follow.lag = v; }), { min: 1, max: 60, width: '60px' }) : null,
    cam.follow ? numField('Offset Y', cam.follow.oy || 0, (v) => H.tx('Follow', () => { cam.follow.oy = v; }), { width: '60px' }) : null,
    sel && !cam.follow ? button(`Follow “${sel.name}”`, () => ops.setCameraFollow(sel.id), { cls: 'small' }) : null));
  const sh = cam.shake;
  el.append(section('Shake', h('div.hint', 'Adds a decaying handheld/impact shake starting at the playhead.'),
    numField('Strength px', sh ? sh.amp : 14, (v) => { shakeUI.amp = v; }, { width: '60px' }), numField('Frames', sh ? sh.len : Math.round(fps()), (v) => { shakeUI.len = v; }, { width: '60px' }),
    h('div.flex', button('Apply shake', () => ops.setCameraShake(true, shakeUI), { cls: 'small' }), sh ? button('Remove', () => ops.setCameraShake(false), { cls: 'small' }) : null)));
  el.append(section('Shots (storyboard cuts)', h('div.flex', button('Cut here', () => ops.addShot(), { cls: 'small', ic: 'film', tip: 'Start a new shot at the playhead; the camera holds until then, then cuts' })),
    ...(sc.shots || []).map((s) => h('div.item', { on: { click: () => import('../core/playback.js').then((m) => m.Playback.seek(s.start)) } }, h('span', { style: { flex: 1 } }, `${s.name}`), h('span.pill', `${s.start + 1}–${s.end + 1}`), iconButton('trash', 'Delete shot', () => ops.deleteShot(s.id))))));
}
const shakeUI = { amp: 14, len: 24 };
function setCamFromView() {
  import('./viewport.js').then(({ VP }) => {
    const P = S.project; const z = S.view.zoom; const cx = (VP.w / 2 - S.view.panX) / z, cy = (VP.h / 2 - S.view.panY) / z;
    const vz = clamp(Math.min(P.width / (VP.w / z), P.height / (VP.h / z)), 0.1, 10);
    ops.setCameraProp('x', cx); ops.setCameraProp('y', cy); ops.setCameraProp('zoom', vz);
  });
}

// ═════════════ Scenes / storyboard ═════════════
export function scenesPanel(el) {
  el.innerHTML = ''; const P = S.project;
  const grid = h('div', { style: { padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: '8px' } });
  P.scenes.forEach((s, i) => {
    const c = h('canvas', { width: 260, height: Math.round(260 * P.height / P.width), style: { width: '100%', borderRadius: '5px', background: '#fff', display: 'block' } });
    try { const sceneObj = s; const tmp = makeFrameCanvas(sceneObj, 0, c.width, c.height, { camera: true, transparent: false }); c.getContext('2d').drawImage(tmp, 0, 0); } catch {}
    const card = h('div.tile', { style: { cursor: 'pointer', outline: s.id === P.activeScene ? '2px solid var(--acc)' : 'none' }, on: { click: () => ops.switchScene(s.id), contextmenu: (e) => { e.preventDefault(); sceneMenu(e, s); } } }, c, h('div.tn', `${i + 1}. ${s.name}`), h('div.tn', { style: { color: 'var(--tx3)' } }, `${Math.round(sceneDuration(s) / P.fps * 10) / 10}s`));
    grid.append(card);
  });
  el.append(h('div.flex', { style: { padding: '8px' } }, button('New scene', () => ops.addScene(), { ic: 'plus', cls: 'small' }), button('Duplicate', () => ops.duplicateScene(P.activeScene), { ic: 'copy', cls: 'small' }), button('Delete', async () => { if (P.scenes.length < 2) return toast('A project needs at least one scene.', 'warn'); if (await confirmBox('Delete scene', 'Delete this scene and all of its layers?', 'Delete', true)) ops.deleteScene(P.activeScene); }, { ic: 'trash', cls: 'small' })), grid, h('div.hint.pad', 'Scenes play in order when you export “All scenes”. Right-click a scene for more.'));
}
function sceneMenu(e, s) {
  contextMenu([{ label: 'Rename…', run: async () => { const n = await askText('Rename scene', 'Name', s.name); if (n) ops.renameScene(s.id, n); } }, { label: 'Duplicate', run: () => ops.duplicateScene(s.id) }, { label: 'Move earlier', run: () => ops.moveScene(s.id, -1) }, { label: 'Move later', run: () => ops.moveScene(s.id, 1) }, '-', { label: 'Delete', run: async () => { if (await confirmBox('Delete scene', 'Delete this scene?', 'Delete', true)) ops.deleteScene(s.id); } }], e.clientX, e.clientY);
}
