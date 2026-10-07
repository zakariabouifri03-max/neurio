// Keyframes panel: every key of the selected layer, grouped by property, with easing + jump + delete.
import { h } from '../core/util.js';
import { S, curLayer, scene } from '../core/state.js';
import { EASE_LIST } from '../core/anim.js';
import * as ops from '../core/ops.js';
import { Playback } from '../core/playback.js';
import { button, section, toast } from './common.js';

const LABEL = { x: 'Position X', y: 'Position Y', rotation: 'Rotation', scaleX: 'Scale X', scaleY: 'Scale Y', skewX: 'Skew', opacity: 'Opacity', mouth: 'Mouth shape' };
const PROPN = { rot: 'rotation', x: 'x', y: 'y', sx: 'scale X', sy: 'scale Y' };
const filt = { q: '', camera: false };
function labelOf(l, name) {
  const m = /^b\.(.+)\.(\w+)$/.exec(name);
  if (m && l.char) { const b = l.char.bones.find((x) => x.id === m[1]); return `${b ? b.name : 'bone'} · ${PROPN[m[2]] || m[2]}`; }
  return LABEL[name] || name;
}
export function keysPanel(el) {
  el.innerHTML = ''; const l = filt.camera ? null : curLayer(); const sc = scene();
  const target = filt.camera ? sc.camera : l;
  el.append(h('div.pad', h('div.flex', button('Add keyframe', () => ops.addKeyframeSel(), { cls: 'primary', ic: 'keyadd', tip: 'Key all properties of the selected layer at the playhead (K)' }),
    button(filt.camera ? 'Show layer' : 'Show camera', () => { filt.camera = !filt.camera; keysPanel(el); }, { cls: 'small', tip: 'Switch between the selected layer and the scene camera' })),
    h('input.txt', { placeholder: 'Filter properties…', value: filt.q, on: { input: (e) => { filt.q = e.target.value.toLowerCase(); draw(); }, keydown: (e) => e.stopPropagation() } })));
  const list = h('div.keylist'); el.append(list);
  function draw() {
    list.innerHTML = '';
    if (!target) { list.append(h('div.pad.hint', 'Select a layer to see its keyframes.')); return; }
    const names = Object.keys(target.tracks || {}).filter((n) => target.tracks[n].length && (!filt.q || labelOf(target, n).toLowerCase().includes(filt.q)));
    if (!names.length) { list.append(h('div.pad.hint', 'No keyframes yet. Move or rotate the layer with Auto-key on, or press K.')); return; }
    names.sort((a, b) => (/^b\./.test(a) - /^b\./.test(b)) || labelOf(target, a).localeCompare(labelOf(target, b)));
    for (const n of names) {
      const tr = target.tracks[n];
      list.append(section(`${labelOf(target, n)}  (${tr.length})`, ...tr.map((k) => h('div.keyrow' + (k.f === S.frame ? '.cur' : ''), { on: { click: () => Playback.seek(k.f) } },
        h('span.kf', 'F' + (k.f + 1)), h('span.kv', (+k.v).toFixed(2)),
        h('select', { on: { click: (e) => e.stopPropagation(), change: (e) => { e.stopPropagation(); if (filt.camera) { import('../core/history.js').then(({ H }) => H.tx('Set easing', () => { k.e = e.target.value; if (k.e === 'bezier') k.bz = k.bz || [0.25, 0.1, 0.25, 1]; })); } else ops.setKeyEase(l.id, n, k.f, e.target.value); } } }, EASE_LIST.map(([v, t]) => h('option', { value: v, selected: (k.e || 'easeInOut') === v }, t))),
        h('button.icon-btn', { tip: 'Delete this key', on: { click: (e) => { e.stopPropagation(); if (filt.camera) import('../core/history.js').then(({ H }) => H.tx('Delete key', () => { const i = tr.indexOf(k); if (i >= 0) tr.splice(i, 1); })); else ops.deleteKey(l.id, n, k.f); } } }, '✕')))));
    }
    list.append(h('div.pad.hint', 'Open the Motion Editor (bottom dock) to edit curves with Bezier handles.'));
  }
  draw();
}
