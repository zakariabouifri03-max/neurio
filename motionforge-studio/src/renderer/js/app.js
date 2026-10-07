// MotionForge Studio — application shell: layout, menus, toolbar, options bar, transport, panels, keyboard, drag & drop, lifecycle.
import { h, $, clamp } from './core/util.js';
import { S, bus, scene, curLayer, fps, sceneDuration, allLayers, layerById } from './core/state.js';
import { H } from './core/history.js';
import { COMMANDS, runCommand, matchCommand, shortcutOf, prettyKey } from './core/commands.js';
import { Playback } from './core/playback.js';
import { startProject, startAutosave, clearAutosave, checkRecovery, openPath, importFiles, confirmDiscard, updateTitle, saveProject } from './core/io.js';
import { TEMPLATES } from './core/templates.js';
import { trimMemory, celCanvas } from './core/model.js';
import { celAt } from './core/anim.js';
import { icon } from './ui/icons.js';
import { initTooltips, toast, modal, buildMenuItems, closeMenus, modalOpen, contextMenu, button } from './ui/common.js';
import { VP, QUALITY } from './ui/viewport.js';
import { Timeline } from './ui/timeline.js';
import { Graph } from './ui/graph.js';
import { layersPanel, propertiesPanel, cameraPanel, scenesPanel } from './ui/panels.js';
import { characterPanel, animationPanel } from './ui/charpanel.js';
import { aiPanel } from './ui/aipanel.js';
import { audioPanel } from './ui/audiopanel.js';
import { keysPanel } from './ui/keyspanel.js';
import { assetsPanel } from './ui/library.js';
import { insertItem } from './ui/library.js';
import { registerCommands, TOOL_DEFS, setTool, commandPalette } from './ui/cmds.js';
import { loadSettings, saveSettings, newProjectDialog, addRecent } from './ui/dialogs.js';
import { TOOLS, cfgFor, Sel } from './tools/tools.js';
import './tools/bonetool.js';
import { BRUSH_PRESETS } from './tools/draw.js';

const mf = () => window.mf;

// ───────────────────────── mode ─────────────────────────
export function setMode(m) {
  S.ui.mode = m; S.settings.mode = m; saveSettings();
  document.body.classList.toggle('mode-pro', m === 'pro'); document.body.classList.toggle('mode-beginner', m === 'beginner');
  for (const b of document.querySelectorAll('#mode-switch button')) b.classList.toggle('on', b.dataset.mode === m);
  buildRightTabs(); buildDockTabs(); buildToolbar();
  if (m === 'beginner' && !RIGHT.find((t) => t.id === rightTab && !t.pro)) showRight('character');
  if (m === 'beginner' && dockTab !== 'timeline') showDock('timeline');
  bus.emit('mode'); VP.render && VP.render();
}

// ───────────────────────── toolbar ─────────────────────────
function buildToolbar() {
  const tb = $('#toolbar'); tb.innerHTML = '';
  const proOnly = new Set(['bone']);
  TOOL_DEFS.forEach(([id, label, key, ic], i) => {
    if (i === 8 || i === 9) { if (i === 8) tb.append(h('div.tsep.pro-only')); else tb.append(h('div.tsep')); }
    tb.append(h('button.tool' + (S.tool === id ? '.on' : '') + (proOnly.has(id) ? '.pro-only' : ''), { 'data-tool': id, tip: `${label}||Shortcut: ${key}`, on: { click: () => setTool(id) }, html: icon(ic, 20) }));
  });
  const c1 = h('input.c1', { type: 'color', value: S.color, tip: 'Foreground colour||Click to change · X swaps colours', on: { input: (e) => { S.color = e.target.value; bus.emit('colors'); } } });
  const c2 = h('input.c2', { type: 'color', value: S.color2, tip: 'Background colour', on: { input: (e) => { S.color2 = e.target.value; bus.emit('colors'); } } });
  tb.append(h('div#colors', c2, c1));
  bus.on('colors', () => { c1.value = S.color; c2.value = S.color2; });
}
bus.on('tool', () => { for (const b of document.querySelectorAll('#toolbar .tool')) b.classList.toggle('on', b.dataset.tool === S.tool); S.ui.rigEdit = S.tool === 'bone'; buildOptions(); updateStatus(); bus.emit('render'); });

// ───────────────────────── options bar ─────────────────────────
function opt(label, input) { return h('div.row', h('label', label), input); }
function rng(label, obj, key, min, max, step = 1, fmt) {
  const out = h('span.ov', fmt ? fmt(obj[key]) : String(obj[key])); const i = h('input', { type: 'range', min, max, step, value: obj[key], on: { input: () => { obj[key] = +i.value; out.textContent = fmt ? fmt(obj[key]) : String(obj[key]); }, keydown: (e) => e.stopPropagation() } });
  return h('div.row', h('label', label), i, out);
}
function chk(label, obj, key, after) { const c = h('input', { type: 'checkbox', checked: !!obj[key], on: { change: () => { obj[key] = c.checked; after && after(); } } }); return h('label.row.check', c, h('span', label)); }
function sel(label, pairs, val, fn) { const s = h('select', pairs.map(([v, l]) => h('option', { value: v, selected: v === val }, l)), { on: { change: () => fn(s.value) } }); return h('div.row', h('label', label), s); }
const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact', 'Verdana', 'Trebuchet MS', 'Consolas'];
function buildOptions() {
  const ob = $('#optionsbar'); if (!ob) return; ob.innerHTML = ''; const t = S.tool; const kids = [];
  const px = (v) => v + ' px', pct = (v) => Math.round(v * 100) + '%';
  if (t === 'brush') {
    kids.push(sel('Brush', Object.entries(BRUSH_PRESETS).filter(([k]) => !['pencil', 'eraser'].includes(k)).map(([k, v]) => [k, v.label]), S.brush.type || 'ink', (v) => { Object.assign(S.brush, BRUSH_PRESETS[v], { type: v }); buildOptions(); }),
      rng('Size', S.brush, 'size', 1, 200, 1, px), rng('Opacity', S.brush, 'opacity', 0.05, 1, 0.05, pct), rng('Hardness', S.brush, 'hardness', 0, 1, 0.05, pct), rng('Smoothing', S.brush, 'smoothing', 0, 1, 0.05, pct), rng('Stabilizer', S.brush, 'stabilization', 0, 1, 0.05, pct), chk('Pressure', S.brush, 'pressure'));
  } else if (t === 'pencil') kids.push(rng('Size', S.pencil, 'size', 1, 60, 1, px), rng('Opacity', S.pencil, 'opacity', 0.05, 1, 0.05, pct), rng('Smoothing', S.pencil, 'smoothing', 0, 1, 0.05, pct), rng('Stabilizer', S.pencil, 'stabilization', 0, 1, 0.05, pct), chk('Pressure', S.pencil, 'pressure'));
  else if (t === 'eraser') kids.push(rng('Size', S.eraserCfg, 'size', 1, 300, 1, px), rng('Hardness', S.eraserCfg, 'hardness', 0, 1, 0.05, pct), rng('Opacity', S.eraserCfg, 'opacity', 0.05, 1, 0.05, pct), chk('Pressure', S.eraserCfg, 'pressure'));
  else if (t === 'fill') kids.push(rng('Tolerance', S.fillOpt, 'tolerance', 0, 128, 1), rng('Gap close', S.fillOpt, 'gap', 0, 12, 1, px), rng('Grow', S.fillOpt, 'grow', 0, 6, 1, px), chk('Contiguous', S.fillOpt, 'contiguous'), chk('Sample all layers', S.fillOpt, 'sampleAll'));
  else if (t === 'shape') kids.push(sel('Shape', [['line', 'Line'], ['rect', 'Rectangle'], ['circle', 'Circle / Ellipse'], ['polygon', 'Polygon (Enter to finish)'], ['bezier', 'Bezier curve (Enter to finish)']], S.shape.kind, (v) => { S.shape.kind = v; }), rng('Line width', S.shape, 'lineWidth', 1, 80, 1, px), chk('Stroke', S.shape, 'stroke'), chk('Fill', S.shape, 'fill'), h('span.hint', 'Shift = constrain'));
  else if (t === 'text') kids.push(rng('Size', S.text, 'size', 8, 300, 1, px), sel('Font', FONTS.map((f) => [f, f]), S.text.font, (v) => { S.text.font = v; }), chk('Bold', S.text, 'bold'), h('span.hint', 'Click the canvas and type · Ctrl+Enter to commit'));
  else if (t === 'select') kids.push(h('span.hint', 'Drag a box on a drawing layer · Ctrl+C / X / V · Delete clears'), button('Select all', () => Sel.all(), { cls: 'small' }), button('Deselect', () => Sel.clear(), { cls: 'small' }), button('Cut into rig part…', () => runCommand('char.cutPart'), { cls: 'small', tip: 'Turn the selected pixels into a bone-driven body part of the selected character' }));
  else if (t === 'transform') kids.push(sel('Move', [['auto', 'Auto (part = bone)'], ['layer', 'Whole layer / character']], S.tfTarget, (v) => { S.tfTarget = v; }), chk('IK drag (hands/feet)', S.ui, 'ikDrag'), chk('Snap', S.ui, 'snap'), h('span.hint', 'Drag to move · handles rotate / scale · Shift = constrain'));
  else if (t === 'bone') kids.push(h('span.hint', 'Drag to create a bone from its start point · click to chain the next bone · Enter / right-click ends · select a bone to set IK, limits and pin in the Character panel'));
  else if (t === 'hand') kids.push(h('span.hint', 'Drag to pan · mouse wheel zooms · Space plays the animation'), button('Fit', () => VP.fit(), { cls: 'small' }), button('100%', () => VP.zoomTo(1), { cls: 'small' }));
  else if (t === 'zoom') kids.push(h('span.hint', 'Click to zoom in · Alt+click to zoom out · drag to zoom to an area'), button('Fit', () => VP.fit(), { cls: 'small' }), button('100%', () => VP.zoomTo(1), { cls: 'small' }));
  ob.append(...kids, h('span.grow', { style: { flex: 1 } }),
    chk('Auto-key', S.ui, 'autokey', () => bus.emit('autokey')), h('label.row.check', h('input', { type: 'checkbox', checked: !!(S.project && S.project.settings.onion.enabled), on: { change: (e) => { runCommand('view.onion'); e.target.checked = S.project.settings.onion.enabled; } } }), h('span', 'Onion skin')));
}
bus.on('tool-options', buildOptions); bus.on('autokey', () => { if (S.project) buildOptions(); }); bus.on('onion', buildOptions);
bus.on('project-loaded', buildOptions);

// ───────────────────────── menus ─────────────────────────
const C = (id, label) => { const c = COMMANDS.get(id); return { label: label || (c && c.label) || id, shortcut: c ? prettyKey(shortcutOf(id)) : '', enabled: () => (c && c.enabled ? !!c.enabled() : true), checked: c && c.checked ? () => !!c.checked() : undefined, run: () => runCommand(id) }; };
const MENUS = () => [
  ['File', [C('file.new'), C('file.open'), { label: 'Open Recent', sub: (S.settings.recent || []).length ? S.settings.recent.map((p) => ({ label: p.replace(/^.*[\\/]/, ''), run: () => openPath(p) })) : [{ label: '(none)', enabled: false }] }, '-', C('file.save'), C('file.saveAs'), C('file.revert'), '-', C('file.import'), C('file.addAudio'), '-', C('file.projectSettings'), '-', C('file.exit')]],
  ['Edit', [{ ...C('edit.undo'), label: 'Undo' + (H.labels().undo ? ' ' + H.labels().undo : '') }, { ...C('edit.redo'), label: 'Redo' + (H.labels().redo ? ' ' + H.labels().redo : '') }, '-', C('edit.cut'), C('edit.copy'), C('edit.paste'), C('edit.delete'), '-', C('edit.selectAll'), C('edit.deselect'), C('edit.swapColors'), '-',
    { label: 'Layer', sub: ['layer.new', 'layer.group', 'layer.duplicate', 'layer.mergeDown', 'layer.rename', 'layer.up', 'layer.down', 'layer.toggleVisible', 'layer.toggleLock', 'layer.delete', 'layer.saveLibrary'].map((i) => C(i)) }]],
  ['View', [C('view.zoomIn'), C('view.zoomOut'), C('view.fit'), C('view.actual'), '-', C('view.grid'), C('view.safe'), C('view.camera'), C('view.bones'), '-', C('view.onion'), C('view.onionSettings'), '-',
    { label: 'Preview Quality', sub: Object.keys(QUALITY).map((q) => C('view.quality.' + q, q[0].toUpperCase() + q.slice(1))) }, '-', C('view.beginner'), C('view.pro'), C('view.fullscreen'), '-',
    { label: 'Panels', sub: ['layers', 'props', 'character', 'keys', 'animation', 'camera', 'ai', 'assets', 'audio'].map((i) => C('panel.' + i)) }, { label: 'Bottom dock', sub: [C('view.timeline'), C('view.motion'), C('view.storyboard')] }]],
  ['Animation', [C('anim.play'), C('anim.stop'), C('anim.prev'), C('anim.next'), C('anim.first'), C('anim.last'), C('anim.prevKey'), C('anim.nextKey'), '-', C('frame.new'), C('frame.duplicate'), C('frame.hold'), C('frame.delete'), '-', C('key.new'), C('key.blank'), C('key.delete'), C('anim.autokey'), '-', C('anim.loop'), C('anim.setRange'), C('anim.clearRange'), C('anim.marker'), C('anim.sceneLength'), '-', C('scene.add'), C('scene.duplicate'), C('scene.addShot'), C('camera.key')]],
  ['Character', [{ label: 'Add Character', sub: Object.keys(COMMANDS.size ? Object.fromEntries([...COMMANDS.keys()].filter((k) => k.startsWith('char.add.')).map((k) => [k, 1])) : {}).map((k) => C(k)) }, C('char.autorig'), C('char.importParts'), C('char.cutPart'), '-', C('char.rigEdit'), C('view.bones'), C('char.reset'), C('char.mirror'), '-', C('layer.saveLibrary')]],
  ['AI', [C('ai.assistant'), C('ai.pose'), C('ai.motion'), C('ai.inbetween'), C('ai.lipsync'), '-', C('ai.settings')]],
  ['Export', [C('export.video'), '-', C('export.mp4'), C('export.webm'), C('export.gif'), C('export.png'), C('export.jpg'), '-', C('export.frame')]],
  ['Settings', [C('settings.open'), C('settings.shortcuts'), C('palette.open'), '-', C('help.about')]],
];
let openMenu = null;
function buildMenubar() {
  const bar = $('#menubar'); bar.innerHTML = '';
  const close = () => { if (openMenu) { openMenu.el.remove(); openMenu.top.classList.remove('open'); openMenu = null; } };
  const open = (top, name) => {
    close(); closeMenus(); const def = MENUS().find((m) => m[0] === name); const m = h('div.menu.bar'); buildMenuItems(m, def[1], close); document.body.append(m);
    const r = top.getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = r.bottom + 2 + 'px'; top.classList.add('open'); openMenu = { el: m, top, name };
  };
  for (const [name] of MENUS()) { const top = h('div.menu-top', { on: { mousedown: (e) => { e.preventDefault(); openMenu && openMenu.name === name ? close() : open(top, name); }, mouseenter: () => { if (openMenu && openMenu.name !== name) open(top, name); } } }, name); bar.append(top); }
  document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !e.target.closest('.menu-top')) close(); }, true);
  window.addEventListener('blur', close);
}

// ───────────────────────── transport ─────────────────────────
let tFrame, tTime, tFps, tPlay, tLoop, tAuto, tOnion;
function buildTransport() {
  const t = $('#transport'); t.innerHTML = '';
  const ib = (ic, tip, id) => h('button.icon-btn', { tip, on: { click: () => runCommand(id) }, html: icon(ic, 17) });
  tPlay = h('button.icon-btn.play', { tip: 'Play / Pause||Space', on: { click: () => runCommand('anim.play') }, html: icon('play', 18) });
  tLoop = h('button.icon-btn', { tip: 'Loop playback||L', on: { click: () => runCommand('anim.loop') }, html: icon('loop', 17) });
  tAuto = h('button.icon-btn.rec', { tip: 'Auto-key||Records a keyframe whenever you transform or pose', on: { click: () => runCommand('anim.autokey') }, html: icon('record', 16) });
  tOnion = h('button.icon-btn', { tip: 'Onion skin||O', on: { click: () => runCommand('view.onion') }, html: icon('onion', 17) });
  tFrame = h('input.num', { type: 'number', min: 1, tip: 'Current frame', style: { width: '62px' }, on: { change: () => Playback.seek(Math.max(0, Math.round(+tFrame.value) - 1)), keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } } });
  tTime = h('span.hint', { style: { minWidth: '92px' } }, '');
  tFps = h('input.num', { type: 'number', min: 1, max: 120, tip: 'Frames per second (1–120)', style: { width: '56px' }, on: { change: () => { const v = clamp(Math.round(+tFps.value) || 24, 1, 120); H.tx('Frame rate', () => { S.project.fps = v; }); bus.emit('project-loaded'); }, keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } } });
  t.append(ib('first', 'First frame||Home', 'anim.first'), ib('prev', 'Previous frame||←', 'anim.prev'), tPlay, ib('next', 'Next frame||→', 'anim.next'), ib('last', 'Last frame||End', 'anim.last'), ib('stop', 'Stop||Shift+Space', 'anim.stop'), tLoop, h('span.sepv'),
    h('label.hint', 'Frame'), tFrame, h('span.hint', { id: 'tot' }, '/ 0'), tTime, h('span.sepv'), h('label.hint', 'FPS'), tFps, h('span.grow'),
    ib('key', 'Insert keyframe||K', 'key.new'), ib('keyadd', 'New blank frame||F', 'frame.new'), ib('copy', 'Duplicate frame||D', 'frame.duplicate'), h('span.sepv'), tAuto, tOnion, h('span.sepv'), h('input', { type: 'range', id: 'tl-zoom', min: 2, max: 60, step: 0.5, value: S.ui.tlZoom, tip: 'Timeline zoom (Ctrl+wheel)', style: { width: '84px' }, on: { input: (e) => { S.ui.tlZoom = +e.target.value; bus.emit('timeline-zoom'); } } }));
  syncTransport();
}
function syncTransport() {
  if (!tFrame || !S.project) return; const F = fps(); const sec = S.frame / F;
  if (document.activeElement !== tFrame) tFrame.value = S.frame + 1;
  if (document.activeElement !== tFps) tFps.value = F;
  const tot = $('#tot'); if (tot) tot.textContent = '/ ' + sceneDuration();
  tTime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(2).padStart(5, '0')}`;
  tPlay.innerHTML = icon(S.playing ? 'pause' : 'play', 18); tPlay.classList.toggle('on', S.playing);
  tLoop.classList.toggle('on', S.loop); tAuto.classList.toggle('on', S.ui.autokey); tOnion.classList.toggle('on', !!S.project.settings.onion.enabled);
}
for (const e of ['frame', 'playing', 'loop', 'autokey', 'project-loaded', 'change', 'onion']) bus.on(e, () => requestAnimationFrame(syncTransport));

// ───────────────────────── dock ─────────────────────────
const DOCK = [{ id: 'timeline', label: 'Timeline' }, { id: 'graph', label: 'Motion Editor', pro: true }, { id: 'storyboard', label: 'Storyboard / Scenes', pro: true }];
let dockTab = 'timeline'; const dockHosts = {}; let graphBuilt = false;
function buildDockTabs() {
  const el = $('#dock-tabs'); el.innerHTML = '';
  for (const d of DOCK) el.append(h('button.tab' + (d.id === dockTab ? '.on' : '') + (d.pro ? '.pro-only' : ''), { on: { click: () => showDock(d.id) } }, d.label));
}
function showDock(id) {
  if (!DOCK.some((d) => d.id === id)) return; if (S.ui.mode === 'beginner' && id !== 'timeline') id = 'timeline'; dockTab = id; buildDockTabs();
  for (const k in dockHosts) dockHosts[k].style.display = k === id ? (k === 'timeline' || k === 'graph' ? 'flex' : 'block') : 'none';
  if (id === 'graph') { if (!graphBuilt) { Graph.build(dockHosts.graph); graphBuilt = true; } Graph.refresh(); Graph.fit && Graph.fit(); }
  if (id === 'storyboard') scenesPanel(dockHosts.storyboard);
  if (id === 'timeline') Timeline.refresh();
}
bus.on('ui:dock', showDock);
for (const e of ['change', 'scene', 'project-loaded', 'history']) bus.on(e, () => { if (dockTab === 'storyboard') debounce('sb', () => scenesPanel(dockHosts.storyboard)); if (dockTab === 'graph' && graphBuilt) debounce('gr', () => Graph.refresh()); });
bus.on('selection', () => { if (dockTab === 'graph' && graphBuilt) debounce('gr', () => Graph.refresh()); });
bus.on('frame', () => { if (dockTab === 'graph' && graphBuilt && !S.playing) debounce('gr', () => Graph.refresh()); });

// ───────────────────────── right panels ─────────────────────────
const RIGHT = [
  { id: 'layers', label: 'Layers', ic: 'layers', fn: layersPanel, pro: true },
  { id: 'props', label: 'Properties', ic: 'settings', fn: propertiesPanel, pro: true },
  { id: 'character', label: 'Character', ic: 'person', fn: characterPanel },
  { id: 'keys', label: 'Keyframes', ic: 'key', fn: keysPanel, pro: true },
  { id: 'animation', label: 'Animation', ic: 'film', fn: animationPanel },
  { id: 'camera', label: 'Camera', ic: 'camera', fn: cameraPanel, pro: true },
  { id: 'ai', label: 'AI', ic: 'sparkle', fn: aiPanel },
  { id: 'assets', label: 'Assets', ic: 'folder', fn: null },
  { id: 'audio', label: 'Audio', ic: 'audio', fn: audioPanel },
];
let rightTab = 'layers'; let assetsEl = null;
function buildRightTabs() {
  const el = $('#right-tabs'); el.innerHTML = '';
  for (const t of RIGHT) el.append(h('button.tab' + (t.id === rightTab ? '.on' : '') + (t.pro ? '.pro-only' : ''), { tip: t.label, on: { click: () => showRight(t.id) } }, h('span', { html: icon(t.ic, 15) }), t.label));
}
function showRight(id) { const t = RIGHT.find((x) => x.id === id); if (!t) return; if (S.ui.mode === 'beginner' && t.pro) id = 'character'; rightTab = id; buildRightTabs(); renderRight(); }
bus.on('ui:right', showRight); bus.on('ui:mode', setMode);
function renderRight() {
  const body = $('#right-body'); const t = RIGHT.find((x) => x.id === rightTab); if (!body || !S.project) return;
  const st = body.scrollTop;
  if (t.id === 'assets') { if (!assetsEl) assetsEl = assetsPanel(); body.innerHTML = ''; body.append(assetsEl); return; }
  const host = h('div.panel'); try { t.fn(host); } catch (e) { console.error('panel', t.id, e); host.append(h('div.pad.err', 'Panel error: ' + e.message)); }
  const focused = document.activeElement; if (focused && body.contains(focused) && /INPUT|TEXTAREA|SELECT/.test(focused.tagName) && S.__keepFocus) return;
  body.innerHTML = ''; body.append(host); body.scrollTop = st;
}
const timers = {}; function debounce(k, fn, ms = 0) { cancelAnimationFrame(timers[k]); timers[k] = requestAnimationFrame(fn); }
const LIVE = { layers: ['change', 'selection', 'project-loaded', 'history', 'scene'], props: ['change', 'selection', 'project-loaded', 'history', 'frame', 'scene'], character: ['change', 'selection', 'project-loaded', 'history', 'tool'], keys: ['change', 'selection', 'project-loaded', 'history', 'frame'], animation: ['selection', 'project-loaded', 'scene'], camera: ['change', 'selection', 'project-loaded', 'history', 'frame', 'view'], ai: ['selection', 'project-loaded', 'settings', 'scene'], assets: [], audio: ['change', 'project-loaded', 'history', 'scene', 'selection'] };
for (const ev of ['change', 'selection', 'project-loaded', 'history', 'frame', 'scene', 'tool', 'view', 'settings']) bus.on(ev, () => {
  if ((ev === 'frame') && S.playing) return; const live = LIVE[rightTab] || []; if (!live.includes(ev)) return;
  const ae = document.activeElement; if ((ev === 'change' || ev === 'frame') && ae && $('#right-body').contains(ae) && /TEXTAREA/.test(ae.tagName)) return;
  debounce('right', renderRight);
});

// ───────────────────────── status bar ─────────────────────────
let stTool, stFrame, stZoom, stMsg, stQuality, stPerf;
function buildStatus() {
  const s = $('#status'); s.innerHTML = '';
  stTool = h('span'); stFrame = h('span'); stZoom = h('span'); stMsg = h('span.grow');
  stQuality = h('select', { tip: 'Preview quality||Draft is fastest · Final supersamples 2×', on: { change: () => { S.ui.quality = stQuality.value; S.settings.quality = stQuality.value; saveSettings(); bus.emit('render'); } } }, Object.keys(QUALITY).map((q) => h('option', { value: q }, q[0].toUpperCase() + q.slice(1))));
  stPerf = h('span');
  s.append(stTool, stFrame, stZoom, stMsg, h('label', 'Preview '), stQuality, stPerf);
}
function updateStatus() {
  if (!stTool || !S.project) return; const P = S.project; const l = curLayer();
  stTool.innerHTML = `Tool: <b>${(TOOL_DEFS.find((t) => t[0] === S.tool) || [])[1] || S.tool}</b>${l ? ` · Layer: <b>${l.name}</b>` : ''}`;
  stFrame.innerHTML = `Frame <b>${S.frame + 1}</b> / ${sceneDuration()} · ${fps()} fps`; stZoom.innerHTML = `${P.width}×${P.height} · <b>${Math.round(S.view.zoom * 100)}%</b>`;
  if (stQuality.value !== S.ui.quality) stQuality.value = S.ui.quality;
}
for (const e of ['frame', 'selection', 'view', 'project-loaded', 'change', 'tool', 'quality']) bus.on(e, () => requestAnimationFrame(updateStatus));
bus.on('autosaved', () => { if (stMsg) { stMsg.textContent = 'Autosaved ' + new Date().toLocaleTimeString(); } });
setInterval(() => { if (stPerf && S.project) stPerf.textContent = VP.state && VP.state.renderMs ? `${VP.state.renderMs.toFixed(1)} ms/frame` : ''; }, 1000);

// ───────────────────────── splitters ─────────────────────────
function initSplitters() {
  const drag = (el, move, done) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); const mv = (ev) => move(ev); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); done && done(); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
  const dock = $('#dock'), right = $('#right');
  if (S.settings.dockH) dock.style.height = S.settings.dockH + 'px'; if (S.settings.rightW) right.style.width = S.settings.rightW + 'px';
  drag($('#vsplit'), (e) => { const r = $('#center').getBoundingClientRect(); dock.style.height = clamp(r.bottom - e.clientY, 150, r.height - 200) + 'px'; }, () => { S.settings.dockH = parseInt(dock.style.height); saveSettings(); });
  drag($('#hsplit'), (e) => { right.style.width = clamp(innerWidth - e.clientX, 240, 640) + 'px'; }, () => { S.settings.rightW = parseInt(right.style.width); saveSettings(); });
}

// ───────────────────────── keyboard ─────────────────────────
const CTRL_IN_INPUT = new Set(['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+N', 'Ctrl+O', 'Ctrl+K', 'Ctrl+M', 'Ctrl+Shift+P', 'Ctrl+,', 'Ctrl+Q']);
function onKey(e) {
  if (modalOpen()) return;
  const tg = e.target; const typing = tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) && !(tg.tagName === 'INPUT' && /^(range|checkbox|color|button)$/.test(tg.type)));
  if (typing) { const cmd = matchCommand(e); if (!(cmd && CTRL_IN_INPUT.has(shortcutOf(cmd.id).split('|').find((k) => k.startsWith('Ctrl')) || ''))) return; }
  if (!typing) { const t = TOOLS[S.tool]; if (t && t.key && t.key(e)) { e.preventDefault(); return; } }
  const cmd = matchCommand(e); if (!cmd) return;
  if (cmd.enabled && !cmd.enabled()) { return; }
  e.preventDefault(); runCommand(cmd.id);
}

// ───────────────────────── drag & drop ─────────────────────────
function initDnD() {
  const dz = $('#dropzone'); let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; dz.classList.add('show'); e.preventDefault(); } });
  window.addEventListener('dragleave', (e) => { if (isFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('show'); } });
  window.addEventListener('dragover', (e) => { if (isFiles(e) || [...(e.dataTransfer?.types || [])].includes('application/x-mf-lib')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    depth = 0; dz.classList.remove('show');
    const lib = e.dataTransfer.getData && e.dataTransfer.getData('application/x-mf-lib');
    const host = $('#canvas-host'); const r = host.getBoundingClientRect(); const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    let at; if (over && S.project) { const p = VP.toScene(e.clientX - r.left, e.clientY - r.top); at = { x: p[0], y: p[1] }; }
    if (lib) { e.preventDefault(); try { await insertItem(lib, at); } catch (er) { toast(er.message, 'error'); } return; }
    if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); await importFiles(e.dataTransfer.files, at || {}); }
  });
}

// ───────────────────────── memory virtualisation ─────────────────────────
function nearIds() {
  const ids = new Set(); const sc = scene(); if (!sc) return ids; const F = fps();
  for (const l of allLayers(sc)) { if (!l.cels) continue; for (let f = S.frame - 2; f <= S.frame + F * 2; f += 1) { const c = celAt(l, f); if (c && c.id) ids.add(c.id); } }
  return ids;
}
setInterval(() => { if (S.project && !S.playing && !H.inGesture()) trimMemory((S.settings.memoryMB ?? 900) * 1024 * 1024, nearIds()).catch(() => {}); }, 15000);

// ───────────────────────── welcome ─────────────────────────
async function welcome() {
  const recent = S.settings.recent || [];
  const body = h('div.welcome', h('div', h('h1', 'Welcome to MotionForge Studio'), h('div.hint', 'Draw frame by frame, rig characters, animate with keyframes and let the AI assistant do the first pass.')),
    h('div.row', h('span.hint', 'Tip: press Ctrl+K anytime to search every command.')),
    recent.length ? h('div', h('div.hint', 'Recent projects'), ...recent.slice(0, 5).map((p) => h('div.item', { on: { click: () => { ov().close('open:' + p); } } }, h('span', { html: icon('film', 15) }), p.replace(/^.*[\\/]/, ''), h('span.hint', p)))) : null);
  const ov = () => [...document.querySelectorAll('.modal-ov')].pop();
  const r = await modal({ title: 'MotionForge Studio', width: 560, body, buttons: [{ label: 'Open project…', value: 'open' }, { label: 'New project…', primary: true, value: 'new' }, { label: 'Start with sample character', value: 'sample' }] });
  if (r === 'new') await newProjectDialog(); else if (r === 'open') await runCommand('file.open'); else if (typeof r === 'string' && r.startsWith('open:')) await openPath(r.slice(5));
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  if (!window.mf) { document.body.innerHTML = '<div style="padding:40px;color:#ddd;font:15px Segoe UI">MotionForge Studio must be started through its desktop launcher (the secure preload bridge is missing).</div>'; return; }
  await loadSettings();
  document.body.classList.toggle('mode-pro', S.ui.mode === 'pro'); document.body.classList.toggle('mode-beginner', S.ui.mode === 'beginner');
  initTooltips(); registerCommands();
  $('#logo').innerHTML = icon('logo', 20); $('#btn-palette').innerHTML = icon('wand', 17);
  $('#btn-palette').addEventListener('click', () => commandPalette());
  for (const b of document.querySelectorAll('#mode-switch button')) { b.addEventListener('click', () => setMode(b.dataset.mode)); b.classList.toggle('on', b.dataset.mode === S.ui.mode); }
  const info = await mf().app.info().catch(() => ({}));
  startProject({ template: TEMPLATES.find((t) => t.id === 'character') || TEMPLATES[0], name: 'Untitled' });
  VP.init($('#canvas-host'));
  buildMenubar(); buildToolbar(); buildOptions(); buildTransport(); buildStatus(); buildRightTabs(); buildDockTabs();
  const dockBody = $('#dock-body');
  for (const d of DOCK) { dockHosts[d.id] = h('div.dockpane', { style: { display: 'none', flex: 1, minWidth: 0, minHeight: 0, overflow: d.id === 'storyboard' ? 'auto' : 'hidden' } }); dockBody.append(dockHosts[d.id]); }
  Timeline.build(dockHosts.timeline); initSplitters(); showDock('timeline'); initDnD();
  window.addEventListener('keydown', onKey);
  bus.on('title', () => { $('#doc-title').textContent = (S.dirty ? '• ' : '') + (S.project ? S.project.name : '') ; });
  bus.on('history', buildMenubarLabelsSoon); bus.on('change', () => { $('#doc-title').textContent = (S.dirty ? '• ' : '') + (S.project ? S.project.name : ''); });
  bus.on('project-loaded', () => { VP.state.fitted = false; setTimeout(() => VP.fit(), 0); Playback.range = null; if (S.filePath) addRecent(S.filePath); buildMenubar(); Timeline.refresh(); renderRight(); updateStatus(); syncTransport(); $('#doc-title').textContent = S.project.name; });
  bus.on('project-replaced', () => { renderRight(); Timeline.refresh(); });
  mf().app.onRequestClose(async () => { if (await confirmDiscard()) { await clearAutosave(); mf().app.confirmClose(); } });
  mf().app.onOpenFile((p) => openPath(p));
  window.addEventListener('error', (e) => { console.error(e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('Unexpected error: ' + (e.reason && e.reason.message || e.reason), 'error', 5000); });
  window.addEventListener('beforeunload', () => {});
  setMode(S.ui.mode); showRight(S.ui.mode === 'beginner' ? 'character' : 'layers');
  bus.emit('project-loaded'); bus.emit('tool');
  startAutosave();
  window.__MF = { S, bus, H, VP, runCommand, COMMANDS, scene };
  // lifecycle: launch file → recovery → welcome
  if (info.selftest) { const { runSelfTest } = await import('./selftest.js'); await runSelfTest(info); return; }
  let opened = false;
  const lf = info.launchFile || (await mf().app.takeLaunchFile().catch(() => null));
  if (lf) opened = await openPath(lf);
  if (!opened) opened = await checkRecovery(!!info.crashed);
  if (!opened && !lf) await welcome();
}
function buildMenubarLabelsSoon() { /* menus are rebuilt on open; nothing to do */ }
boot().catch((e) => { console.error('boot failed', e); document.body.append(h('pre', { style: { position: 'fixed', inset: 0, background: '#200', color: '#fcc', padding: '20px', zIndex: 99999, whiteSpace: 'pre-wrap' } }, 'MotionForge failed to start:\n' + (e.stack || e))); });
