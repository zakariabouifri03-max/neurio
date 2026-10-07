// Character panel (rig hierarchy, bone properties, creation/import) and Animation panel (premade clips, poses, generate motion).
import { h, clamp, mkCanvas, baseName, stripExt, uid, DEG } from '../core/util.js';
import { S, bus, scene, layerById, curLayer, allLayers, fps } from '../core/state.js';
import { H, copyCanvas } from '../core/history.js';
import { addCanvasAsset } from '../core/model.js';
import { STARTER_STYLES, createStarterCharacter, autoRigImage, importPartsAsCharacter, matchRole, ROLES, roleLabel, makeCharacterLayer } from '../core/charbuild.js';
import { CLIPS, CLIP_LIST, POSES, expandClip, bakeClip, setPoseAt, readPoseAt, generateMotion, mirrorPose, ALL_ROLES, charHeight } from '../core/motionlib.js';
import { tailRest, roleMap, boneDescendants, boneOrder } from '../core/rig.js';
import { layerProp, setKey, removeKey, getKey } from '../core/anim.js';
import * as ops from '../core/ops.js';
import { Playback } from '../core/playback.js';
import { icon } from './icons.js';
import { button, iconButton, numField, selectField, checkField, section, modal, toast, askText, slider } from './common.js';
import { importFiles, addImageLayerFromCanvas } from '../core/io.js';
import { charSolve, boneEnds } from '../tools/overlays.js';
import { evalLayer, layerMatrix } from '../core/rig.js';
import { M } from '../core/util.js';
import { bakeTrack } from '../core/motionlib.js';
import { celAt } from '../core/anim.js';
import { celCanvas, assetImage } from '../core/model.js';
import { EASE_LIST } from '../core/anim.js';

const mf = () => window.mf;
async function pickImageCanvases(multi = false) {
  const paths = await mf().dialog.open({ title: 'Choose image' + (multi ? 's' : ''), multi, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'psd'] }] });
  const out = [];
  for (const p of paths || []) { const b = await mf().file.read(p); const type = /svg$/i.test(p) ? 'image/svg+xml' : /jpe?g$/i.test(p) ? 'image/jpeg' : 'image/png'; const bmp = await createImageBitmap(new Blob([b], { type })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); out.push({ name: baseName(p), canvas: c }); }
  return out;
}
export function addCharacter(style) { H.tx('Add character', () => { const l = createStarterCharacter(style); ops.insertLayer(l); }); }
export async function autoRigFromPicker() {
  const imgs = await pickImageCanvases(false); if (!imgs.length) return;
  doAutoRig(imgs[0].canvas, stripExt(imgs[0].name));
}
export function doAutoRig(canvas, name, replaceLayerId) {
  try {
    let result; H.tx('Auto Rig', () => { result = autoRigImage(canvas, { name: name + ' (rigged)' }); ops.insertLayer(result.layer); if (replaceLayerId) { const l = layerById(replaceLayerId); if (l) l.visible = false; } });
    toast(`Auto Rig: ${result.detected} parts detected and rigged with skeleton, IK on arms and legs. Fine-tune bones with the Bone tool (R).`, 'success', 6500);
  } catch (e) { console.error(e); toast('Auto Rig failed: ' + (e.message || e), 'error', 6000); }
}
export async function importPartsFromPicker() {
  const imgs = await pickImageCanvases(true); if (!imgs.length) return;
  const l = importPartsAsCharacter(imgs, { name: 'Imported Character' });
  if (!l) return toast('None of the files looked like body parts. Name them like head.png, body.png, arm_left.png, leg_right.png …', 'warn', 7000);
  H.tx('Import character', () => ops.insertLayer(l)); toast(`Character built from ${imgs.length} images.`, 'success');
}

export function characterPanel(el) {
  el.innerHTML = ''; const l = curLayer(); const sc = scene();
  const create = section('Create character',
    h('div.hint', 'Start from a ready rig, or import your own artwork.'),
    h('div.flex', Object.entries(STARTER_STYLES).map(([k, v]) => button(v.label, () => addCharacter(k), { cls: 'small', tip: `Add a fully rigged ${v.label} character` }))),
    h('div.col', { style: { marginTop: '8px' } },
      button('Auto Rig from one image…', autoRigFromPicker, { ic: 'wand', tip: 'Pick a single character picture. The app finds the head, torso, arms and legs, splits them into parts and builds a skeleton with IK.' }),
      button('Import body-part images…', importPartsFromPicker, { ic: 'image', tip: 'Pick several PNGs named head, body, arm_left, leg_right … (or a PSD with layers named that way).' }),
      l && (l.type === 'image' || l.type === 'draw') ? button(`Auto Rig “${l.name}”`, () => autoRigLayer(l), { ic: 'person' }) : null));
  if (!l || !l.char) {
    el.append(create);
    const draw = l && (l.type === 'draw' || l.type === 'image');
    el.append(section('Separate parts from a drawing', h('div.hint', draw ? 'Use the Selection tool to box a body part on a drawing layer, then cut it into a rig part.' : 'Select a drawing layer first.'), button('Cut part from selection…', () => cutPartDialog(), { cls: 'small', ic: 'copy' })));
    return;
  }
  const rm = roleMap(l.char); const order = boneOrder(l.char); const b = l.char.bones.find((x) => x.id === S.selection.boneId);
  el.append(section('Rig',
    h('div.flex', button(S.ui.rigEdit ? 'Exit Rig Edit' : 'Rig Edit (bones)', () => { S.tool = S.ui.rigEdit ? 'transform' : 'bone'; bus.emit('tool'); bus.emit('selection'); }, { cls: S.ui.rigEdit ? 'primary' : '', ic: 'bone', tip: 'Edit the skeleton in rest pose: create bones, drag joints.' }),
      button('Add bone', () => addBoneTo(l, b), { cls: 'small', ic: 'plus' }), button('Delete bone', () => deleteBone(l, b), { cls: 'small', ic: 'trash', tip: 'Delete the selected bone (children move up).' })),
    checkField('Show bones', S.ui.showBones, (v) => { S.ui.showBones = v; bus.emit('render'); }), checkField('Autokey', S.ui.autokey, (v) => { S.ui.autokey = v; bus.emit('autokey'); }, 'Record a keyframe automatically whenever you pose'),
    selectField('Gizmo target', [['auto', 'Auto (click part = bone)'], ['layer', 'Whole character']], S.tfTarget, (v) => { S.tfTarget = v; }),
    h('div.flex', button('Reset pose', () => resetPose(l), { cls: 'small', tip: 'Set every bone back to the rest pose at this frame' }), button('Mirror pose', () => mirrorCurrentPose(l), { cls: 'small', tip: 'Swap left/right limbs at this frame' }), button('Auto-fit IK', () => autoIK(l), { cls: 'small', tip: 'Enable IK on hands and feet' }))));
  const tree = h('div.list', { style: { maxHeight: '190px', overflow: 'auto', background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: '6px' } });
  const depthOf = (bn) => { let d = 0, c = bn; while (c.parent) { c = l.char.bones.find((x) => x.id === c.parent); if (!c) break; d++; } return d; };
  for (const bn of order) tree.append(h('div.item' + (bn.id === S.selection.boneId ? '.sel' : ''), { style: { paddingLeft: 8 + depthOf(bn) * 14 + 'px', padding: '3px 8px 3px ' + (8 + depthOf(bn) * 14) + 'px' }, on: { click: () => { S.selection.boneId = bn.id; bus.emit('selection'); bus.emit('render'); } } },
    h('span.ti', { html: icon('bone', 12) }), h('span', { style: { flex: 1 } }, bn.name), bn.ik ? h('span.pill', 'IK') : null, bn.pin ? h('span.pill', 'pin') : null, bn.hidden ? h('span.pill', 'hid') : null));
  el.append(section('Hierarchy', tree));
  if (b) el.append(boneProps(l, b));
  else el.append(section('Bone', h('div.hint', 'Click a part on the canvas or a bone above.')));
  const draw2 = h('div'); el.append(section('Parts', h('div.hint', 'Cut a region from a drawing layer into a new part of this character.'), button('Cut part from selection…', () => cutPartDialog(l), { cls: 'small', ic: 'copy' }), button('Assign image to bone…', () => assignImage(l, b), { cls: 'small', ic: 'image' })));
  void sc; void draw2; void rm;
}
function setBone(l, b, patch, label = 'Edit bone') { H.tx(label, () => { Object.assign(b, patch); }); }
function boneProps(l, b) {
  const bones = l.char.bones; const roles = ROLES.map((r) => [r[0], r[1]]);
  const nm = h('input.txt', { type: 'text', value: b.name, style: { width: '100%' } }); nm.addEventListener('change', () => setBone(l, b, { name: nm.value || b.name })); nm.addEventListener('keydown', (e) => e.stopPropagation());
  const desc = new Set(boneDescendants(l.char, b.id));
  return h('div',
    section('Bone', h('div.row', nm),
      selectField('Role', [['', '— none —'], ...roles], b.role || '', (v) => setBone(l, b, { role: v || null }), 'Roles let animations (walk, wave…) find this bone'),
      selectField('Parent', [['', '— none —'], ...bones.filter((x) => x.id !== b.id && !desc.has(x.id)).map((x) => [x.id, x.name])], b.parent || '', (v) => setBone(l, b, { parent: v || null }, 'Reparent bone')),
      numField('Z-order', b.z || 0, (v) => setBone(l, b, { z: v }), { width: '60px' }), checkField('Hidden', b.hidden, (v) => setBone(l, b, { hidden: v }))),
    section('Constraints',
      checkField('Lock rotation', b.lockRot, (v) => setBone(l, b, { lockRot: v })),
      h('div.flex', numField('Min °', b.min ?? -180, (v) => setBone(l, b, { min: v }), { width: '58px' }), numField('Max °', b.max ?? 180, (v) => setBone(l, b, { max: v }), { width: '58px' })),
      checkField('Inverse kinematics (IK)', !!b.ik, (v) => setBone(l, b, { ik: v ? { chain: 2, on: true } : null }, 'Toggle IK'), 'Drag the red handle at the bone tip and the chain follows'),
      b.ik ? numField('IK chain length', b.ik.chain || 2, (v) => setBone(l, b, { ik: { ...b.ik, chain: clamp(Math.round(v), 1, 6) } }), { width: '58px', min: 1, max: 6 }) : null,
      b.ik ? checkField('IK enabled', b.ik.on !== false, (v) => setBone(l, b, { ik: { ...b.ik, on: v } })) : null,
      checkField('Pin tip in place', !!b.pin, (v) => pinBone(l, b, v), 'Fixes the tip of this chain in the scene (e.g. a planted foot)')),
    section('Rest geometry', h('div.flex', numField('Head X', b.hx, (v) => setBone(l, b, { hx: v }), { width: '66px' }), numField('Head Y', b.hy, (v) => setBone(l, b, { hy: v }), { width: '66px' })), h('div.flex', numField('Length', b.len, (v) => setBone(l, b, { len: Math.max(2, v) }), { width: '66px' }), numField('Angle °', b.a0, (v) => setBone(l, b, { a0: v }), { width: '66px' }))));
}
function pinBone(l, b, on) {
  H.tx('Pin bone', () => {
    if (!on) { b.pin = null; return; }
    if (!b.ik) b.ik = { chain: 2, on: true };
    const { sol } = charSolve(l); const [, t] = boneEnds(b, sol); const p = M.pt(sol.lm, t[0], t[1]); b.pin = { x: p[0], y: p[1] };
  });
}
function addBoneTo(l, parent) {
  H.tx('Add bone', () => { const p = parent || l.char.bones[0]; const nb = { id: uid('b'), name: 'Bone ' + (l.char.bones.length + 1), role: null, parent: p ? p.id : null, hx: p ? tailRest(p)[0] : 0, hy: p ? tailRest(p)[1] : 0, len: 40, a0: 90, min: -180, max: 180, lockRot: false, ik: null, pin: null, z: (p ? p.z || 0 : 0) + 1, hidden: false, img: null, visemes: null }; l.char.bones.push(nb); S.selection.boneId = nb.id; });
}
function deleteBone(l, b) {
  if (!b) return toast('Select a bone first.', 'info'); if (l.char.bones.length < 2) return toast('A character needs at least one bone.', 'warn');
  H.tx('Delete bone', () => { for (const c of l.char.bones) if (c.parent === b.id) c.parent = b.parent; l.char.bones.splice(l.char.bones.indexOf(b), 1); for (const k of Object.keys(l.tracks)) if (k.includes(b.id)) delete l.tracks[k]; S.selection.boneId = null; });
}
function resetPose(l) { H.tx('Reset pose', () => { setPoseAt(l, S.frame, {}, { ease: 'easeInOut' }); }); }
function mirrorCurrentPose(l) { H.tx('Mirror pose', () => { const p = readPoseAt(l, S.frame); setPoseAt(l, S.frame, mirrorPose(p)); }); }
function autoIK(l) { H.tx('Auto IK', () => { for (const b of l.char.bones) if (['handL', 'handR', 'footL', 'footR'].includes(b.role)) { /* IK on shin/foreArm tips */ } for (const b of l.char.bones) if (['foreArmL', 'foreArmR', 'shinL', 'shinR'].includes(b.role)) b.ik = b.ik || { chain: 2, on: true }; }); toast('IK enabled on forearms and shins — drag the red handles.', 'info'); }
async function autoRigLayer(l) {
  let canvas;
  if (l.type === 'image') { const im = assetImage(l.image.assetId); if (!im) return; canvas = mkCanvas(im.width, im.height); canvas.getContext('2d').drawImage(im, 0, 0); }
  else { const c = celAt(l, S.frame); const cv = c && c.id && celCanvas(c.id); if (!cv) return toast('Nothing drawn on this frame.', 'warn'); canvas = mkCanvas(cv.width, cv.height); canvas.getContext('2d').drawImage(cv, 0, 0); }
  doAutoRig(canvas, l.name, l.id);
}
async function assignImage(l, b) {
  if (!b) return toast('Select a bone first.', 'info');
  const imgs = await pickImageCanvases(false); if (!imgs.length) return; const c = imgs[0].canvas;
  H.tx('Assign image', () => { const a = addCanvasAsset(c, imgs[0].name, { hidden: true, group: 'char' }); const t = tailRest(b); const cx = (b.hx + t[0]) / 2, cy = (b.hy + t[1]) / 2; b.img = { assetId: a.assetId || a.id, x: cx - c.width / 2, y: cy - c.height / 2, w: c.width, h: c.height }; });
}
export async function cutPartDialog(targetChar) {
  const src = curLayer(); const m = S.marquee;
  const srcLayer = allLayers(scene()).find((x) => x.id === S.ui.cutSource) || src;
  const draw = srcLayer && (srcLayer.type === 'draw'); if (!draw || !m) return toast('Select a drawing layer, drag a box around a body part with the Selection tool (V), then try again.', 'info', 6500);
  const chars = allLayers(scene()).filter((x) => x.char);
  const name = await askText('Cut part', 'Part name (e.g. “hat”, “tail”, “left hand”)', 'Part'); if (!name) return;
  const cs = chars.find((c) => c.id === (targetChar && targetChar.id)) || null;
  let target = cs;
  if (!target && chars.length) { const sel = h('select', [h('option', { value: '' }, 'New character from this part'), ...chars.map((c) => h('option', { value: c.id }, 'Attach to ' + c.name))]); const r = await modal({ title: 'Where should the part go?', body: h('div.form', sel), buttons: [{ label: 'Cancel', value: null }, { label: 'Cut', primary: true, onClick: (c) => c(sel.value || 'new') }] }); if (r === null) return; target = r === 'new' ? null : chars.find((c) => c.id === r); }
  const cel = celAt(srcLayer, S.frame); const cv = cel && cel.id && celCanvas(cel.id); if (!cv) return toast('Nothing drawn on this frame.', 'warn');
  const x = Math.max(0, Math.round(m.x)), y = Math.max(0, Math.round(m.y)), w = Math.min(cv.width - x, Math.round(m.w)), hh = Math.min(cv.height - y, Math.round(m.h)); if (w < 2 || hh < 2) return;
  const part = mkCanvas(w, hh); part.getContext('2d').drawImage(cv, x, y, w, hh, 0, 0, w, hh);
  H.begin('Cut part');
  const before = copyCanvas(cv); cv.getContext('2d').clearRect(x, y, w, hh); H.pixelEdit('Cut part', cel.id, before, { x, y, w, h: hh });
  const a = addCanvasAsset(part, name, { hidden: true, group: 'char' });
  if (!target) {
    const l = makeCharacterLayer({ bones: [], pool: [] }, name + ' rig', [x + w / 2, y + hh / 2], 1, [x + w / 2, y + hh / 2]);
    l.char.bones.push({ id: uid('b'), name, role: 'body', parent: null, hx: x + w / 2, hy: y + hh / 2, len: Math.min(w, hh) / 2, a0: 90, min: -180, max: 180, lockRot: false, ik: null, pin: null, z: 1, hidden: false, img: { assetId: a.id, x, y, w, h: hh }, visemes: null });
    ops.insertLayer(l);
  } else {
    const sel = target.char.bones.find((b) => b.id === S.selection.boneId) || target.char.bones[0];
    const inv = M.inv(layerMatrix(target, evalLayer(target, S.frame)));
    const p0 = M.pt(inv, x, y), p1 = M.pt(inv, x + w, y + hh); const cx = Math.min(p0[0], p1[0]), cy = Math.min(p0[1], p1[1]), cw = Math.abs(p1[0] - p0[0]), ch = Math.abs(p1[1] - p0[1]);
    const nb = { id: uid('b'), name, role: 'extra', parent: sel.id, hx: cx + cw / 2, hy: cy + ch / 2, len: 20, a0: 90, min: -180, max: 180, lockRot: false, ik: null, pin: null, z: 20, hidden: false, img: { assetId: a.id, x: cx, y: cy, w: cw, h: ch }, visemes: null };
    target.char.bones.push(nb); S.selection.boneId = nb.id; S.selection.layerId = target.id;
  }
  H.end(); S.marquee = null;
  toast('Part created. Use the Bone tool (R) to place its joint and choose its parent.', 'success');
}

// ═════════════ Animation panel ═════════════
let poseA = null, poseB = null; const gm = { frames: 12, ease: 'easeInOut', follow: 0.12, overshoot: 0 };
export function animationPanel(el) {
  el.innerHTML = ''; const l = curLayer();
  if (!l || !l.char) { el.append(h('div.pad.hint', 'Select a character layer to use premade animations, poses and motion generation.'), h('div.pad', button('Add a starter character', () => addCharacter('cartoon'), { ic: 'person' }))); return; }
  const opts = { seconds: 2, speed: 1 };
  const clipRow = (name) => { const c = CLIPS[name]; return h('button.btn.small', { tip: `${c.label}||Bakes real keyframes at the playhead — fully editable afterwards.`, on: { click: () => applyClip(l, name, opts) } }, c.label); };
  el.append(section('Premade animations', h('div.row', h('label', 'Duration (s)'), h('input.num', { type: 'number', value: 2, min: 0.2, step: 0.25, on: { change: (e) => { opts.seconds = clamp(parseFloat(e.target.value) || 2, 0.2, 60); }, keydown: (e) => e.stopPropagation() } })),
    h('div.row', h('label', 'Speed'), h('input.num', { type: 'number', value: 1, min: 0.25, max: 4, step: 0.25, on: { change: (e) => { opts.speed = clamp(parseFloat(e.target.value) || 1, 0.25, 4); }, keydown: (e) => e.stopPropagation() } })),
    h('div.flex', Object.keys(CLIPS).map(clipRow)), h('div.hint', 'Applied at the playhead on the selected character. Moving clips (walk, run) travel across the screen; edit the keyframes afterwards in the timeline or Motion Editor.')));
  el.append(section('Poses', h('div.flex', Object.keys(POSES).map((p) => h('button.btn.small', { on: { click: () => { H.tx('Apply pose', () => setPoseAt(l, S.frame, POSES[p], { layerLevel: false })); toast(`Pose “${p}” set at frame ${S.frame + 1}`, 'info', 1400); } } }, p))),
    h('div.flex', { style: { marginTop: '8px' } }, button('Store pose', () => { poseA = readPoseAt(l, S.frame); toast('Pose stored (A).', 'info', 1200); }, { cls: 'small' }), button('Apply stored', () => { if (!poseA) return toast('Store a pose first.', 'info'); H.tx('Apply pose', () => setPoseAt(l, S.frame, poseA)); }, { cls: 'small' }))));
  el.append(section('Generate Motion (pose A → B)', h('div.hint', 'Pick two poses; the app generates natural in-between keys with follow-through.'),
    h('div.flex', button('A = current pose', () => { poseA = readPoseAt(l, S.frame); gm.f0 = S.frame; toast(`A captured at frame ${S.frame + 1}`, 'info', 1200); }, { cls: 'small' }), button('B = current pose', () => { poseB = readPoseAt(l, S.frame); toast('B captured.', 'info', 1200); }, { cls: 'small' })),
    selectField('A', [['', '(stored A)'], ...Object.keys(POSES).map((p) => [p, p])], '', (v) => { if (v) poseA = POSES[v]; }), selectField('B', [['', '(stored B)'], ...Object.keys(POSES).map((p) => [p, p])], '', (v) => { if (v) poseB = POSES[v]; }),
    numField('Frames', gm.frames, (v) => { gm.frames = Math.max(2, Math.round(v)); }, { width: '60px' }), selectField('Easing', EASE_LIST.map((e) => [e[0], e[1]]), gm.ease, (v) => { gm.ease = v; }), numField('Follow-through', gm.follow, (v) => { gm.follow = v; }, { step: 0.05, width: '60px' }), numField('Overshoot', gm.overshoot, (v) => { gm.overshoot = v; }, { step: 0.05, width: '60px' }),
    button('Generate', () => { if (!poseA || !poseB) return toast('Choose pose A and pose B first.', 'info'); H.tx('Generate motion', () => { const f0 = S.frame; generateMotion(l, poseA, poseB, f0, f0 + gm.frames, { ease: gm.ease, followThrough: gm.follow, overshoot: gm.overshoot }); const sc = scene(); sc.duration = Math.max(sc.duration, f0 + gm.frames + 1); }); toast('Motion generated as editable keyframes.', 'success'); }, { cls: 'primary', ic: 'sparkle' })));
  el.append(inbetweenSection(l));
}
function applyClip(l, name, opts) {
  H.tx('Apply ' + name, () => {
    const exp = expandClip(name, { seconds: opts.seconds, speed: opts.speed }); const start = S.frame; const r = bakeClip(l, exp, start, {});
    const clip = CLIPS[name]; const sc = scene();
    if (clip.move) { const dir = Math.sign(layerProp(l, 'scaleX', start)) || 1; const speed = (clip.move === 'run' ? 1.9 : 0.8) * charHeight(l); const x0 = layerProp(l, 'x', start); import_x(l, start, r.endFrame, x0, speed * exp.seconds * dir); }
    sc.duration = Math.max(sc.duration, r.endFrame + 1);
  });
  toast(`${CLIPS[name].label} applied from frame ${S.frame + 1}.`, 'success', 1800);
}
function import_x(l, start, end, x0, dist) { bakeTrack(l, 'x', start, end, [{ f: end, v: x0 + dist, e: 'linear' }], x0); }
function inbetweenSection(l) {
  const ib = S.ib || (S.ib = { n: 4, ease: 'keep' });
  return section('Auto Inbetween', h('div.hint', 'Fill the gaps between your keyframes with generated in-between keys (every N frames).'),
    selectField('Frames between', [['4', '4'], ['8', '8'], ['12', '12'], ['24', '24']], String(ib.n), (v) => { ib.n = +v; }), selectField('Easing', [['keep', 'Keep existing curve'], ...EASE_LIST.map((e) => [e[0], e[1]])], ib.ease, (v) => { ib.ease = v; }),
    h('div.flex', button('Generate inbetweens', () => runInbetween(l, ib), { cls: 'primary', ic: 'sparkle' }), button('Regenerate', () => runInbetween(l, ib), { tip: 'Run again with different settings' })));
}
export async function runInbetween(l, ib) {
  const { autoInbetween } = await import('../core/inbetween.js');
  const n = await autoInbetween(l.id, ib.n, ib.ease);
  toast(n ? `Added ${n} in-between keys.` : 'No gaps wider than that to fill — add keyframes further apart first.', n ? 'success' : 'info');
}
