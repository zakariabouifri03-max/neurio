// Command definitions: the single source for menus, keyboard shortcuts and the command palette.
import { S, bus, scene, curLayer, layerById, allLayers, fps, sceneDuration, containerOf } from '../core/state.js';
import { H } from '../core/history.js';
import { defCommand, runCommand } from '../core/commands.js';
import * as ops from '../core/ops.js';
import { Playback } from '../core/playback.js';
import { VP, QUALITY } from './viewport.js';
import { Sel, TOOLS } from '../tools/tools.js';
import { cfgFor } from '../tools/tools.js';
import { newProjectDialog, settingsDialog, aboutDialog, saveSettings } from './dialogs.js';
import { saveProject, openDialog, importDialog, revertToBackup, titleText } from '../core/io.js';
import { exportDialog, exportCurrentFrame } from './exporter.js';
import { toast, modal, askText, confirmBox } from './common.js';
import { h, clamp } from '../core/util.js';
import { STARTER_STYLES, createStarterCharacter } from '../core/charbuild.js';
import { addCharacter, autoRigFromPicker, importPartsFromPicker, cutPartDialog, runInbetween } from './charpanel.js';
import { readPoseAt, setPoseAt, mirrorPose } from '../core/motionlib.js';
import { saveSelectionToLibrary } from './library.js';
import { addAudioFromDialog } from './audiopanel.js';
import { copyKeysAt, pasteKeysAt } from '../core/ops.js';

const mf = () => window.mf;
const def = (id, label, cat, run, o = {}) => defCommand({ id, label, cat, run, ...o });
const hasProject = () => !!S.project;
export function setTool(t) { if (!TOOLS[t]) return; if (S.tool === t) return; S.tool = t; bus.emit('tool'); bus.emit('selection'); }
export const TOOL_DEFS = [
  ['select', 'Select (marquee)', 'V', 'select'], ['brush', 'Brush / Ink / Marker / Soft', 'B', 'brush'], ['pencil', 'Pencil', 'N', 'pencil'], ['eraser', 'Eraser', 'E', 'eraser'],
  ['fill', 'Fill bucket', 'G', 'fill'], ['shape', 'Shapes (line, rect, circle, polygon, bezier)', 'U', 'shape'], ['text', 'Text', 'T', 'text'], ['transform', 'Transform / Move layer', 'Q', 'transform'],
  ['bone', 'Rig edit — bones', 'R', 'bone'], ['hand', 'Hand (pan)', 'H', 'hand'], ['zoom', 'Zoom', 'Z', 'zoom'],
];
const step = (d) => Playback.seek(clamp(S.frame + d, 0, Math.max(sceneDuration() + 60, 1)));
const curChar = () => { const l = curLayer(); return l && l.char ? l : null; };
const needChar = () => { const l = curChar(); if (!l) toast('Select a character layer first.', 'warn'); return l; };
const showRight = (t) => bus.emit('ui:right', t); const showDock = (t) => bus.emit('ui:dock', t);

export function registerCommands() {
  // ── File ──
  def('file.new', 'New Project…', 'File', () => newProjectDialog(), { key: 'Ctrl+N' });
  def('file.open', 'Open…', 'File', () => openDialog(), { key: 'Ctrl+O' });
  def('file.save', 'Save', 'File', () => saveProject(false), { key: 'Ctrl+S', enabled: hasProject });
  def('file.saveAs', 'Save As…', 'File', () => saveProject(true), { key: 'Ctrl+Shift+S', enabled: hasProject });
  def('file.import', 'Import Media…', 'File', () => importDialog(), { key: 'Ctrl+I', enabled: hasProject });
  def('file.addAudio', 'Import Audio…', 'File', () => addAudioFromDialog(), { enabled: hasProject });
  def('file.revert', 'Restore Previous Save (backup)…', 'File', () => revertToBackup(), { enabled: () => !!S.filePath });
  def('file.projectSettings', 'Project Settings…', 'File', () => projectSettings(), { enabled: hasProject });
  def('file.exit', 'Exit', 'File', () => window.close(), { key: 'Ctrl+Q' });
  // ── Edit ──
  def('edit.undo', 'Undo', 'Edit', () => { H.undo(); }, { key: 'Ctrl+Z', enabled: () => H.canUndo() });
  def('edit.redo', 'Redo', 'Edit', () => { H.redo(); }, { key: 'Ctrl+Y|Ctrl+Shift+Z', enabled: () => H.canRedo() });
  def('edit.copy', 'Copy', 'Edit', () => { if (!Sel.copy()) copyKeysAt(); }, { key: 'Ctrl+C' });
  def('edit.cut', 'Cut', 'Edit', () => { Sel.del(true); }, { key: 'Ctrl+X' });
  def('edit.paste', 'Paste', 'Edit', () => { if (!Sel.paste()) pasteKeysAt(); }, { key: 'Ctrl+V' });
  def('edit.delete', 'Delete', 'Edit', () => deleteSmart(), { key: 'Delete|Backspace' });
  def('edit.selectAll', 'Select All', 'Edit', () => { setTool('select'); Sel.all(); }, { key: 'Ctrl+A' });
  def('edit.deselect', 'Deselect', 'Edit', () => { Sel.clear(); S.selection.range = null; bus.emit('selection'); }, { key: 'Escape' });
  def('edit.swapColors', 'Swap foreground / background colour', 'Edit', () => { [S.color, S.color2] = [S.color2, S.color]; bus.emit('colors'); }, { key: 'X' });
  def('brush.bigger', 'Increase brush size', 'Edit', () => { const c = cfgFor(); c.size = clamp(Math.round(c.size * 1.2 + 1), 1, 400); bus.emit('tool-options'); }, { key: ']' });
  def('brush.smaller', 'Decrease brush size', 'Edit', () => { const c = cfgFor(); c.size = clamp(Math.round(c.size / 1.2 - 1), 1, 400); bus.emit('tool-options'); }, { key: '[' });
  // ── Tools ──
  for (const [id, label, key] of TOOL_DEFS) def('tool.' + id, label, 'Tools', () => setTool(id), { key, hidden: false });
  // ── View ──
  def('view.zoomIn', 'Zoom In', 'View', () => VP.zoomTo(S.view.zoom * 1.25), { key: 'Ctrl+=|Ctrl+Shift+=|=|+' });
  def('view.zoomOut', 'Zoom Out', 'View', () => VP.zoomTo(S.view.zoom / 1.25), { key: 'Ctrl+-|-' });
  def('view.fit', 'Fit Canvas to Window', 'View', () => VP.fit(), { key: 'Ctrl+0' });
  def('view.actual', 'Actual Size (100%)', 'View', () => { VP.zoomTo(1); }, { key: 'Ctrl+1' });
  def('view.grid', 'Show Grid', 'View', () => { S.ui.showGrid = !S.ui.showGrid; bus.emit('render'); }, { key: "Ctrl+'", checked: () => S.ui.showGrid });
  def('view.safe', 'Show Safe Areas', 'View', () => { S.ui.showSafe = !S.ui.showSafe; bus.emit('render'); }, { checked: () => S.ui.showSafe });
  def('view.camera', 'Look Through Camera', 'View', () => { S.ui.cameraView = !S.ui.cameraView; bus.emit('render'); bus.emit('view'); bus.emit('selection'); }, { key: 'C', checked: () => S.ui.cameraView });
  def('view.bones', 'Show Bones', 'View', () => { S.ui.showBones = !S.ui.showBones; bus.emit('render'); }, { checked: () => S.ui.showBones });
  def('view.onion', 'Onion Skin', 'View', () => { const o = S.project.settings.onion; o.enabled = !o.enabled; S.dirty = true; bus.emit('onion'); bus.emit('render'); }, { key: 'O', checked: () => S.project && S.project.settings.onion.enabled, enabled: hasProject });
  def('view.onionSettings', 'Onion Skin Settings…', 'View', () => onionDialog(), { enabled: hasProject });
  for (const q of Object.keys(QUALITY)) def('view.quality.' + q, `Preview Quality: ${q[0].toUpperCase() + q.slice(1)}`, 'View', () => { S.ui.quality = q; S.settings.quality = q; saveSettings(); bus.emit('quality'); bus.emit('render'); }, { checked: () => S.ui.quality === q });
  def('view.beginner', 'Beginner Mode', 'View', () => bus.emit('ui:mode', 'beginner'), { checked: () => S.ui.mode === 'beginner' });
  def('view.pro', 'Pro Mode', 'View', () => bus.emit('ui:mode', 'pro'), { checked: () => S.ui.mode === 'pro' });
  def('view.fullscreen', 'Full Screen', 'View', () => mf().app.fullscreen(), { key: 'F11' });
  def('view.timeline', 'Timeline', 'View', () => showDock('timeline'));
  def('view.motion', 'Motion Editor (graph)', 'View', () => showDock('graph'));
  def('view.storyboard', 'Storyboard / Scenes', 'View', () => showDock('storyboard'));
  for (const [id, label] of [['layers', 'Layers'], ['props', 'Properties'], ['character', 'Character'], ['keys', 'Keyframes'], ['animation', 'Animation'], ['camera', 'Camera'], ['ai', 'AI Assistant'], ['assets', 'Assets'], ['audio', 'Audio']]) def('panel.' + id, label + ' panel', 'View', () => showRight(id));
  // ── Animation ──
  def('anim.play', 'Play / Pause', 'Animation', () => Playback.toggle(), { key: 'Space', enabled: hasProject });
  def('anim.stop', 'Stop (return to start)', 'Animation', () => Playback.stop(), { key: 'Shift+Space', enabled: hasProject });
  def('anim.prev', 'Previous Frame', 'Animation', () => step(-1), { key: 'Left|,', enabled: hasProject });
  def('anim.next', 'Next Frame', 'Animation', () => step(1), { key: 'Right|.', enabled: hasProject });
  def('anim.first', 'First Frame', 'Animation', () => Playback.seek(0), { key: 'Home' });
  def('anim.last', 'Last Frame', 'Animation', () => Playback.seek(sceneDuration() - 1), { key: 'End' });
  def('anim.prevKey', 'Previous Keyframe', 'Animation', () => { const f = ops.nextKeyFrame(-1); if (f != null) Playback.seek(f); }, { key: 'Ctrl+Left' });
  def('anim.nextKey', 'Next Keyframe', 'Animation', () => { const f = ops.nextKeyFrame(1); if (f != null) Playback.seek(f); }, { key: 'Ctrl+Right' });
  def('frame.new', 'New Blank Frame', 'Animation', () => { ops.newBlankFrame(); }, { key: 'F', enabled: hasProject });
  def('frame.duplicate', 'Duplicate Frame', 'Animation', () => { ops.duplicateFrame(); }, { key: 'D', enabled: hasProject });
  def('frame.hold', 'Hold Frame (+1)', 'Animation', () => { ops.holdFrame(); }, { key: 'Alt+.' });
  def('frame.delete', 'Delete Frame(s)', 'Animation', () => deleteFrames(), { key: 'Shift+Delete' });
  def('key.new', 'Insert Keyframe', 'Animation', () => ops.addKeyframeSel(), { key: 'K', enabled: hasProject });
  def('key.blank', 'Insert Blank Keyframe', 'Animation', () => { ops.blankKeyframe(); }, { key: 'Shift+K' });
  def('key.delete', 'Delete Keyframe at Playhead', 'Animation', () => ops.deleteKeyframeAt());
  def('anim.autokey', 'Auto-Key', 'Animation', () => { S.ui.autokey = !S.ui.autokey; bus.emit('autokey'); toast(S.ui.autokey ? 'Auto-key ON — transforms record keyframes.' : 'Auto-key OFF — transforms change the base pose.', 'info', 1800); }, { key: 'A', checked: () => S.ui.autokey });
  def('anim.loop', 'Loop Playback', 'Animation', () => { S.loop = !S.loop; bus.emit('loop'); }, { key: 'L', checked: () => S.loop });
  def('anim.setRange', 'Set Loop Range from Selection', 'Animation', () => { const r = S.selection.range; if (!r) { toast('Select frames in the timeline first (drag across the frame cells).', 'info'); return; } Playback.range = { start: r.start, end: r.end }; bus.emit('frame'); bus.emit('render'); toast(`Loop range: frames ${r.start + 1}–${r.end + 1}`, 'success', 1800); });
  def('anim.clearRange', 'Clear Loop Range', 'Animation', () => { Playback.range = null; bus.emit('frame'); bus.emit('render'); });
  def('anim.marker', 'Add Marker at Playhead', 'Animation', () => { H.tx('Add marker', () => { const sc = scene(); const i = sc.markers.findIndex((m) => m.f === S.frame); if (i >= 0) sc.markers.splice(i, 1); else sc.markers.push({ f: S.frame, name: 'Marker', color: '#ffb454' }); }); }, { key: 'M' });
  def('anim.sceneLength', 'Set Scene Length…', 'Animation', async () => { const v = await askText('Scene length', 'Number of frames', String(sceneDuration())); const n = parseInt(v, 10); if (n > 0) ops.setSceneLength(n); }, { enabled: hasProject });
  // ── Layers / scenes ──
  def('layer.new', 'New Drawing Layer', 'Layer', () => { ops.addLayer('draw'); }, { key: 'Ctrl+Shift+N', enabled: hasProject });
  def('layer.group', 'Group Layer', 'Layer', () => { const l = curLayer(); if (l) ops.groupLayers([l.id]); else ops.addLayer('group'); }, { key: 'Ctrl+G' });
  def('layer.duplicate', 'Duplicate Layer', 'Layer', () => { const l = curLayer(); if (l) ops.duplicateLayer(l.id); }, { key: 'Ctrl+J' });
  def('layer.delete', 'Delete Layer', 'Layer', () => { const l = curLayer(); if (l) ops.deleteLayer(l.id); });
  def('layer.rename', 'Rename Layer…', 'Layer', async () => { const l = curLayer(); if (!l) return; const n = await askText('Rename layer', 'Name', l.name); if (n) ops.renameLayer(l.id, n); }, { key: 'F2' });
  def('layer.mergeDown', 'Merge Down', 'Layer', () => { const l = curLayer(); if (l) ops.mergeDown(l.id); }, { key: 'Ctrl+E' });
  def('layer.up', 'Move Layer Up', 'Layer', () => moveSel(1), { key: 'Ctrl+]' });
  def('layer.down', 'Move Layer Down', 'Layer', () => moveSel(-1), { key: 'Ctrl+[' });
  def('layer.toggleVisible', 'Toggle Layer Visibility', 'Layer', () => { const l = curLayer(); if (l) ops.setLayerFlag(l.id, 'visible', !l.visible); }, { key: 'Ctrl+H' });
  def('layer.toggleLock', 'Toggle Layer Lock', 'Layer', () => { const l = curLayer(); if (l) ops.setLayerFlag(l.id, 'locked', !l.locked); }, { key: 'Ctrl+L' });
  def('layer.saveLibrary', 'Save Layer to Asset Library…', 'Layer', () => saveSelectionToLibrary());
  def('scene.add', 'New Scene', 'Scene', () => ops.addScene(), { enabled: hasProject });
  def('scene.duplicate', 'Duplicate Scene', 'Scene', () => ops.duplicateScene(S.project.activeScene), { enabled: hasProject });
  def('scene.addShot', 'Add Camera Shot Cut', 'Scene', () => ops.addShot(), { enabled: hasProject });
  def('camera.key', 'Add Camera Keyframe', 'Scene', () => ops.addCameraKey(), { key: 'Shift+C', enabled: hasProject });
  // ── Character ──
  for (const [k, v] of Object.entries(STARTER_STYLES)) def('char.add.' + k, `Add ${v.label} Character`, 'Character', () => addCharacter(k), { enabled: hasProject });
  def('char.autorig', 'Auto Rig from Image…', 'Character', () => autoRigFromPicker(), { enabled: hasProject });
  def('char.importParts', 'Import Body Parts / PSD…', 'Character', () => importPartsFromPicker(), { enabled: hasProject });
  def('char.cutPart', 'Cut Selection into Rig Part…', 'Character', () => cutPartDialog(curChar()), { enabled: hasProject });
  def('char.rigEdit', 'Rig Edit Mode (Bones)', 'Character', () => setTool(S.tool === 'bone' ? 'transform' : 'bone'), { checked: () => S.tool === 'bone' });
  def('char.reset', 'Reset Pose at Playhead', 'Character', () => { const l = needChar(); if (l) H.tx('Reset pose', () => setPoseAt(l, S.frame, {}, { layerLevel: false })); });
  def('char.mirror', 'Mirror Pose (left ↔ right)', 'Character', () => { const l = needChar(); if (l) H.tx('Mirror pose', () => setPoseAt(l, S.frame, mirrorPose(readPoseAt(l, S.frame)))); });
  // ── AI ──
  def('ai.assistant', 'AI Animation Assistant', 'AI', () => showRight('ai'), { key: 'Ctrl+Shift+A' });
  def('ai.pose', 'AI Pose', 'AI', () => { showRight('ai'); setTimeout(() => { const i = document.querySelector('.ai-pose input'); i && i.focus(); }, 60); });
  def('ai.motion', 'Generate Motion (pose A → B)', 'AI', () => showRight('animation'));
  def('ai.inbetween', 'Auto Inbetween', 'AI', () => { const l = curLayer(); if (!l) { toast('Select a layer with keyframes first.', 'warn'); return; } runInbetween(l, S.ib || (S.ib = { n: 4, ease: 'keep' })); }, { enabled: hasProject });
  def('ai.lipsync', 'Smart Lip Sync', 'AI', () => showRight('audio'));
  def('ai.settings', 'AI Provider Settings…', 'AI', () => settingsDialog('ai'));
  // ── Export ──
  def('export.video', 'Export Video / Sequence…', 'Export', () => exportDialog(), { key: 'Ctrl+M', enabled: hasProject });
  def('export.mp4', 'Export MP4…', 'Export', () => exportDialog({ format: 'mp4' }), { enabled: hasProject });
  def('export.webm', 'Export WebM (transparent)…', 'Export', () => exportDialog({ format: 'webm', transparent: true }), { enabled: hasProject });
  def('export.gif', 'Export GIF…', 'Export', () => exportDialog({ format: 'gif' }), { enabled: hasProject });
  def('export.png', 'Export PNG Sequence…', 'Export', () => exportDialog({ format: 'png', transparent: true }), { enabled: hasProject });
  def('export.jpg', 'Export JPEG Sequence…', 'Export', () => exportDialog({ format: 'jpg' }), { enabled: hasProject });
  def('export.frame', 'Export Current Frame…', 'Export', () => exportCurrentFrame(), { key: 'Ctrl+Shift+E', enabled: hasProject });
  // ── Settings / help ──
  def('settings.open', 'Preferences…', 'Settings', () => settingsDialog('general'), { key: 'Ctrl+,' });
  def('settings.shortcuts', 'Keyboard Shortcuts…', 'Settings', () => settingsDialog('shortcuts'), { key: 'Ctrl+Alt+K' });
  def('help.about', 'About MotionForge Studio', 'Settings', () => aboutDialog());
  def('palette.open', 'Command Palette…', 'Settings', () => commandPalette(), { key: 'Ctrl+K|Ctrl+Shift+P' });
}

function moveSel(d) { const l = curLayer(); if (!l) return; const c = containerOf(l.id); if (!c) return; const j = c.index + d; if (j < 0 || j >= c.list.length) return; ops.moveLayer(l.id, c.list[j].id, d > 0 ? 'above' : 'below'); }
function deleteFrames() { const r = S.selection.range; if (r) ops.deleteFrames(r.layerId, r.start, r.end); else ops.deleteFrames(); }
function deleteSmart() {
  if (Sel.has() && Sel.del(false)) return;
  const r = S.selection.range; if (r && r.layerId) { ops.deleteFrames(r.layerId, r.start, r.end); return; }
  if (S.selection.keyFrame != null) { ops.deleteKeyframeAt(S.selection.layerId, S.selection.keyFrame); return; }
  const l = curLayer(); if (l && l.type === 'draw') ops.deleteFrames();
}
async function projectSettings() {
  const P = S.project; const name = h('input.txt', { value: P.name }); const f = h('input.num', { type: 'number', min: 1, max: 120, value: P.fps });
  const r = await modal({ title: 'Project settings', width: 420, body: h('div.form', h('label.fld', h('span', 'Name'), name), h('div.row', h('label', 'Frame rate'), f, h('span.hint', 'fps (1–120)')), h('div.hint', `Canvas: ${P.width} × ${P.height} px (set when the project is created). Changing the frame rate keeps frame numbers; durations in seconds change.`)), buttons: [{ label: 'Cancel', value: null }, { label: 'Apply', primary: true, value: true }] });
  if (!r) return; H.tx('Project settings', () => { P.name = name.value.trim() || P.name; P.fps = clamp(Math.round(+f.value) || P.fps, 1, 120); }); bus.emit('project-loaded'); bus.emit('title');
}
async function onionDialog() {
  const o = S.project.settings.onion; const mk = (label, key, min, max, step = 1) => h('div.row', h('label', label), h('input', { type: 'range', min, max, step, value: o[key], on: { input: (e) => { o[key] = +e.target.value; bus.emit('render'); S.dirty = true; } } }));
  await modal({ title: 'Onion skin', width: 420, body: h('div.form', h('label.row.check', h('input', { type: 'checkbox', checked: o.enabled, on: { change: (e) => { o.enabled = e.target.checked; bus.emit('onion'); bus.emit('render'); } } }), h('span', 'Enable onion skin')), mk('Frames before', 'prev', 0, 8), mk('Frames after', 'next', 0, 8), mk('Opacity', 'opacity', 0.05, 0.9, 0.05),
    h('div.row', h('label', 'Before colour'), h('input', { type: 'color', value: o.prevColor, on: { input: (e) => { o.prevColor = e.target.value; bus.emit('render'); } } })), h('div.row', h('label', 'After colour'), h('input', { type: 'color', value: o.nextColor, on: { input: (e) => { o.nextColor = e.target.value; bus.emit('render'); } } })),
    h('label.row.check', h('input', { type: 'checkbox', checked: o.tint, on: { change: (e) => { o.tint = e.target.checked; bus.emit('render'); } } }), h('span', 'Tint ghosts with the before / after colours')), h('div.hint', 'Onion skin shows ghosts of neighbouring frames of the selected layer while you draw (toggle with O).')), buttons: [{ label: 'Done', primary: true, value: true }] });
  bus.emit('onion');
}
export function commandPalette() {
  const { COMMANDS, shortcutOf, prettyKey } = _cmdMod; const inp = h('input.txt', { placeholder: 'Type a command…', style: { width: '100%' } }); const list = h('div.palette-list'); let items = [], sel = 0; let closeFn;
  const draw = () => { const q = inp.value.toLowerCase().trim(); items = [...COMMANDS.values()].filter((c) => c.label && (!c.enabled || c.enabled()) && (!q || (c.label + ' ' + c.cat).toLowerCase().includes(q))).slice(0, 60); sel = Math.min(sel, Math.max(0, items.length - 1)); list.innerHTML = ''; items.forEach((c, i) => list.append(h('div.pal' + (i === sel ? '.sel' : ''), { on: { click: () => run(c), mousemove: () => { if (sel !== i) { sel = i; draw(); } } } }, h('span.pc', c.cat), h('span.pl', c.label), h('span.ps', prettyKey(shortcutOf(c.id)))))); const s = list.querySelector('.sel'); s && s.scrollIntoView({ block: 'nearest' }); };
  const run = (c) => { closeFn && closeFn(null); setTimeout(() => runCommand(c.id), 30); };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel]); } });
  draw(); modal({ title: 'Command palette', width: 560, body: h('div', inp, list), buttons: [], cls: 'palette', onClose: () => {} }); setTimeout(() => { const ov = [...document.querySelectorAll('.modal-ov')].pop(); closeFn = ov && ov.close; inp.focus(); }, 30);
}
import * as _cmdMod from '../core/commands.js';
