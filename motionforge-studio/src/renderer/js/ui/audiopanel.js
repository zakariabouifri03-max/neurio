// Audio tracks (volume / fades / trim / waveform) and Smart Lip Sync.
import { h, mkCanvas, baseName, clamp } from '../core/util.js';
import { S, bus, scene, allLayers, fps, curLayer } from '../core/state.js';
import { H } from '../core/history.js';
import { peaks, decodeAsset, bufferOf, clipDuration, clipEndFrame, ensureSceneAudio } from '../core/audio.js';
import { importAudioBytes } from '../core/io.js';
import { analyze, classify, scriptToFrames, mergeScriptWithAudio, applyVisemeFrames, VIS } from '../core/lipsync.js';
import { roleMap } from '../core/rig.js';
import { toast, button, section, numField, selectField, slider, checkField, progressModal } from './common.js';
import { Playback } from '../core/playback.js';

const mf = () => window.mf;
const st = { mode: 'audio', sens: 1, script: '', clipId: null, charId: null, secs: 4 };

function setAudio(id, patch, label = 'Audio') { H.tx(label, () => { const c = scene().audio.find((a) => a.id === id); if (c) Object.assign(c, patch); }); }
export async function addAudioFromDialog() {
  const files = await mf().dialog.open({ title: 'Add audio', multi: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }] });
  for (const p of files || []) {
    try { const b = await mf().file.read(p); const ext = (p.match(/\.(\w+)$/) || [])[1] || 'wav'; await importAudioBytes(b, baseName(p), { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' }[ext.toLowerCase()] || 'audio/wav'); toast('Audio added at the playhead.', 'success'); }
    catch (e) { toast(e.message || String(e), 'error'); }
  }
}
function wave(assetId, w = 260, hh = 38, c = {}) {
  const cv = h('canvas.wave', { width: w * 2, height: hh * 2, style: { width: '100%', height: hh + 'px' } }); const g = cv.getContext('2d');
  const draw = () => { const p = peaks(assetId, 300); g.clearRect(0, 0, cv.width, cv.height); if (!p) return; const buf = bufferOf(assetId); const full = buf ? buf.duration : 1; const a = (c.trimIn || 0) / full, b = (c.trimOut != null ? c.trimOut : full) / full; const n = p.length / 2;
    g.fillStyle = '#4fb6a3'; for (let x = 0; x < cv.width; x++) { const i = Math.floor((a + (b - a) * x / cv.width) * n); const mn = p[i * 2] ?? 0, mx = p[i * 2 + 1] ?? 0; const y0 = cv.height / 2 - mx * cv.height / 2, y1 = cv.height / 2 - mn * cv.height / 2; g.fillRect(x, y0, 1, Math.max(1, y1 - y0)); } };
  draw(); if (!peaks(assetId, 300)) decodeAsset(assetId).then(draw).catch(() => {});
  return cv;
}
export function audioPanel(el) {
  el.innerHTML = ''; const sc = scene(); const F = fps();
  el.append(h('div.pad', h('div.flex', button('Add audio…', addAudioFromDialog, { cls: 'primary', ic: 'audio', tip: 'WAV, MP3 or OGG — placed at the playhead' }), button('Preview', () => Playback.toggle(), { cls: 'small', tip: 'Play / pause (Space)' })), h('div.hint', 'You can also drop audio files straight onto the window. Clips show as tracks in the timeline.')));
  if (!sc.audio.length) el.append(h('div.pad.hint', 'No audio in this scene yet.'));
  for (const c of sc.audio) {
    const dur = clipDuration(c); const buf = bufferOf(c.assetId); const full = buf ? buf.duration : dur;
    el.append(h('div.aclip', h('div.row.tight', h('b.grow', { title: c.name }, c.name || 'Audio'), h('span.hint', `${dur.toFixed(2)} s · frames ${c.start + 1}–${clipEndFrame(c, F)}`),
        h('button.icon-btn', { tip: c.muted ? 'Unmute' : 'Mute', on: { click: () => setAudio(c.id, { muted: !c.muted }, 'Mute audio') } }, c.muted ? '🔇' : '🔊'),
        h('button.icon-btn', { tip: 'Remove clip', on: { click: () => { H.tx('Remove audio', () => { sc.audio = sc.audio.filter((a) => a.id !== c.id); }); } } }, '✕')),
      wave(c.assetId, 260, 38, c),
      slider({ label: 'Volume', min: 0, max: 2, step: 0.05, value: c.volume ?? 1, onChange: (v) => setAudio(c.id, { volume: v }, 'Audio volume'), fmt: (v) => Math.round(v * 100) + '%' }),
      h('div.grid2', numField('Start frame', c.start + 1, (v) => setAudio(c.id, { start: Math.max(0, Math.round(v) - 1) }, 'Move audio'), { step: 1, min: 1, width: '60px' }),
        numField('Fade in (s)', c.fadeIn || 0, (v) => setAudio(c.id, { fadeIn: Math.max(0, v) }, 'Fade'), { step: 0.1, min: 0, width: '60px' }),
        numField('Trim in (s)', c.trimIn || 0, (v) => setAudio(c.id, { trimIn: clamp(v, 0, Math.max(0, (c.trimOut ?? full) - 0.05)) }, 'Trim'), { step: 0.1, min: 0, width: '60px' }),
        numField('Fade out (s)', c.fadeOut || 0, (v) => setAudio(c.id, { fadeOut: Math.max(0, v) }, 'Fade'), { step: 0.1, min: 0, width: '60px' }),
        numField('Trim out (s)', +(c.trimOut ?? full).toFixed(2), (v) => setAudio(c.id, { trimOut: clamp(v, (c.trimIn || 0) + 0.05, full) }, 'Trim'), { step: 0.1, min: 0, width: '60px' }))));
  }
  el.append(lipSection());
}
function lipSection() {
  const sc = scene(); const chars = allLayers(sc).filter((l) => l.char && roleMap(l.char).mouth);
  const wrap = h('div');
  if (!chars.length) return section('Smart Lip Sync', h('div.hint', 'Add a character with a mouth part to lip-sync it. (Layers ▸ Character ▸ Add starter character, or import parts with a “mouth”.)'));
  if (!st.charId || !chars.some((c) => c.id === st.charId)) st.charId = (curLayer() && curLayer().char && chars.find((c) => c.id === curLayer().id) ? curLayer().id : chars[0].id);
  if (!sc.audio.some((a) => a.id === st.clipId)) st.clipId = sc.audio[0] ? sc.audio[0].id : null;
  const ta = h('textarea', { rows: 3, placeholder: 'Optional script / dialogue — improves accuracy and works without audio', on: { input: () => { st.script = ta.value; }, keydown: (e) => e.stopPropagation() } }); ta.value = st.script;
  const modes = [['audio', 'Audio analysis'], ['script', 'Script text only'], ['both', 'Audio timing + script shapes']];
  const body = [
    h('div.hint', 'Mouth shapes: A E I O U M F L and Rest. Written as real keyframes on the mouth track — edit them afterwards.'),
    selectField('Character', chars.map((c) => [c.id, c.name]), st.charId, (v) => { st.charId = v; }),
    selectField('Method', modes, st.mode, (v) => { st.mode = v; redo(); }),
  ];
  if (st.mode !== 'script' || sc.audio.length) body.push(selectField('Audio clip', [['', '(none)'], ...sc.audio.map((a) => [a.id, a.name || 'Audio'])], st.clipId || '', (v) => { st.clipId = v || null; }));
  if (st.mode !== 'audio') body.push(ta);
  if (st.mode === 'script' && !st.clipId) body.push(numField('Duration (s)', st.secs, (v) => { st.secs = Math.max(0.3, v); }, { step: 0.5, width: '60px' }));
  if (st.mode !== 'script') body.push(slider({ label: 'Sensitivity', min: 0.4, max: 2.5, step: 0.05, value: st.sens, onChange: (v) => { st.sens = v; }, fmt: (v) => v.toFixed(2) }));
  body.push(h('div.flex', button('Generate lip sync', generate, { cls: 'primary', ic: 'mic', tip: 'Replaces mouth keys in the clip’s time range (undoable)' }), button('Reset mouth', () => { const l = chars.find((c) => c.id === st.charId); if (l) H.tx('Clear lip sync', () => { delete l.tracks.mouth; }); }, { cls: 'small', tip: 'Remove all mouth keys' })));
  function redo() { const parent = wrap.parentNode; if (parent) parent.replaceChild(lipSection(), wrap); }
  async function generate() {
    const layer = chars.find((c) => c.id === st.charId); if (!layer) return; const F = fps(); const clip = sc.audio.find((a) => a.id === st.clipId);
    if (st.mode !== 'script' && !clip) { toast('Add an audio clip first (or use “Script text only”).', 'warn'); return; }
    if (st.mode !== 'audio' && !st.script.trim()) { toast('Type the script / dialogue first.', 'warn'); return; }
    const pg = progressModal('Lip sync'); let canceled = false; pg.onCancel(() => { canceled = true; });
    try {
      let seq, start;
      if (clip) {
        pg.set(0.02, 'Decoding audio…'); const buf = await decodeAsset(clip.assetId); start = clip.start; const frames = Math.max(1, Math.ceil(clipDuration(clip) * F));
        if (st.mode === 'script') seq = scriptToFrames(st.script, frames);
        else { pg.set(0.05, 'Analysing speech…'); const an = await analyze(buf, { t0: clip.trimIn || 0, t1: clip.trimOut ?? buf.duration, onProgress: (p) => pg.set(0.05 + 0.9 * p, 'Analysing speech…') }); if (canceled) { pg.close(); return; }
          seq = classify(an, { fps: F, frames, sens: st.sens }); if (st.mode === 'both') seq = mergeScriptWithAudio(seq, st.script); }
      } else { start = S.frame; seq = scriptToFrames(st.script, Math.max(2, Math.round(st.secs * F))); }
      if (!seq.some((v) => v)) { pg.close(); toast('No speech detected. Try raising Sensitivity or provide a script.', 'warn', 5000); return; }
      const n = await applyVisemeFrames(layer, seq, start); pg.close();
      const sc2 = scene(); sc2.duration = Math.max(sc2.duration, start + seq.length + 1);
      const used = [...new Set(seq)].map((v) => VIS[v]).join(' ');
      toast(`Lip sync created: ${n} mouth keys (${used}).`, 'success', 4500); bus.emit('change'); bus.emit('render');
    } catch (e) { pg.close(); console.error(e); toast('Lip sync failed: ' + (e.message || e), 'error', 6000); }
  }
  wrap.append(section('Smart Lip Sync', ...body)); return wrap;
}
