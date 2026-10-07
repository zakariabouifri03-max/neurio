// Export pipeline: render frames in the renderer, stream PNG/JPEG bytes to the main process (FFmpeg / files).
import { h, mkCanvas, canvasToBytes, canvasToBlob, clamp, yieldUI, stripExt } from '../core/util.js';
import { S, scene, fps as projFps, sceneDuration, allLayers } from '../core/state.js';
import { makeFrameCanvas } from '../core/render.js';
import { collectCelIds, preloadCels, loadAssetImage } from '../core/model.js';
import { ensureSceneAudio, mixdown } from '../core/audio.js';
import { modal, toast, progressModal, selectField, checkField, section } from './common.js';
import { Playback } from '../core/playback.js';
import { VP } from './viewport.js';

const mf = () => window.mf;
export const RESOLUTIONS = [[480, '480p'], [720, '720p (HD)'], [1080, '1080p (Full HD)'], [1440, '1440p (2K)'], [2160, '2160p (4K)']];
export const FORMATS = { mp4: { label: 'MP4 (H.264)', ext: 'mp4', alpha: false }, webm: { label: 'WebM (VP9)', ext: 'webm', alpha: true }, gif: { label: 'Animated GIF', ext: 'gif', alpha: true, noAudio: true }, png: { label: 'PNG sequence', ext: 'png', alpha: true, seq: true, noAudio: true }, jpg: { label: 'JPEG sequence', ext: 'jpg', alpha: false, seq: true, noAudio: true } };
const evenSize = (w, h2) => [Math.max(2, Math.round(w / 2) * 2), Math.max(2, Math.round(h2 / 2) * 2)];
export function outputSize(height) { const P = S.project; const hh = Math.round(height); return evenSize(hh * P.width / P.height, hh); }

function wavData(wav) { // 44-byte header PCM16
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength); return { sr: dv.getUint32(24, true), ch: dv.getUint16(22, true), pcm: wav.subarray(44) };
}
function concatWavs(parts, sr = 44100, ch = 2) {
  const total = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(44 + total); const dv = new DataView(out.buffer);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + total, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, total, true);
  let o = 44; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

/** Build the export timeline: [{scene, from, to}] in order. */
function segments(o) {
  const P = S.project; const cur = scene();
  const list = o.scope === 'all' ? P.scenes : [cur];
  return list.map((sc) => {
    let from = 0, to = sceneDuration(sc) - 1;
    if (o.scope !== 'all' && o.range === 'loop' && Playback.range) { from = Playback.range.start; to = Playback.range.end; }
    return { sc, from, to };
  });
}
export async function runExport(o, onProgress, cancelToken) {
  const P = S.project; const F = FORMATS[o.format]; const [W, Hh] = outputSize(o.height);
  const segs = segments(o); const outFps = o.fps || P.fps;
  const frames = []; // {sc, f}
  for (const s of segs) { const n = Math.max(1, Math.round((s.to - s.from + 1) / P.fps * outFps)); for (let i = 0; i < n; i++) frames.push({ sc: s.sc, f: Math.min(s.to, s.from + Math.floor(i * P.fps / outFps)) }); }
  if (!frames.length) throw new Error('Nothing to export.');
  onProgress(0, 'Loading artwork…');
  const ids = await collectCelIds(P); await preloadCels(ids, (i, n) => onProgress(0.05 * i / n, 'Loading artwork…'));
  for (const a of P.assets) if (a.kind === 'image') await loadAssetImage(a.id);
  for (const s of segs) await ensureSceneAudio(s.sc);
  // audio
  let audioWav = null;
  if (o.audio && !F.noAudio) {
    onProgress(0.06, 'Mixing audio…'); const parts = []; let any = false;
    for (const s of segs) { const w = await mixdown(s.sc, P.fps, s.from, s.to); if (w) { any = true; parts.push(wavData(w).pcm); } else parts.push(new Uint8Array(Math.round((s.to - s.from + 1) / P.fps * 44100) * 4)); }
    if (any) audioWav = segs.length === 1 && parts.length === 1 ? await mixdown(segs[0].sc, P.fps, segs[0].from, segs[0].to) : concatWavs(parts);
  }
  const spec = { format: o.format, fps: outFps, transparent: !!o.transparent && F.alpha, crf: o.crf, preset: o.preset, audioWav, width: W, height: Hh };
  if (F.seq) { spec.dir = o.dir; spec.baseName = o.baseName || stripExt(P.name || 'frame'); } else spec.outPath = o.outPath;
  const id = await mf().export.begin(spec);
  let aborted = false;
  try {
    const cv = mkCanvas(W, Hh); const g = cv.getContext('2d');
    for (let i = 0; i < frames.length; i++) {
      if (cancelToken.canceled) { aborted = true; break; }
      const fr = frames[i];
      const opts = { camera: true, transparent: spec.transparent, scale: W / P.width, smooth: true };
      const c = makeFrameCanvas(fr.sc, fr.f, W, Hh, { ...opts, transparent: spec.transparent });
      let bytes;
      if (o.format === 'jpg') { const t = mkCanvas(W, Hh); const tg = t.getContext('2d'); tg.fillStyle = fr.sc.bg.color || '#fff'; tg.fillRect(0, 0, W, Hh); tg.drawImage(c, 0, 0); bytes = await canvasToBytes(t, 'image/jpeg', (o.jpgQuality || 92) / 100); }
      else if (!spec.transparent) { // flatten onto the scene background colour
        const t = mkCanvas(W, Hh); const tg = t.getContext('2d'); tg.fillStyle = fr.sc.bg.color || '#fff'; tg.fillRect(0, 0, W, Hh); tg.drawImage(c, 0, 0); bytes = await canvasToBytes(t);
      } else bytes = await canvasToBytes(c);
      await mf().export.frame(id, i, bytes);
      if (i % 3 === 0) { onProgress(0.08 + 0.9 * (i + 1) / frames.length, `Rendering frame ${i + 1} / ${frames.length}`); await yieldUI(); }
    }
  } catch (e) { await mf().export.cancel(id).catch(() => {}); throw e; }
  if (aborted) { await mf().export.cancel(id); return { canceled: true }; }
  onProgress(0.99, 'Finishing…');
  const res = await mf().export.finish(id);
  if (!res.ok) throw new Error(res.error || 'Export failed');
  return { ...res, frames: frames.length, width: W, height: Hh };
}

export async function exportDialog(preset = {}) {
  const P = S.project; let caps = { available: false }; try { caps = await mf().ffmpeg.caps(); } catch {}
  const prefs = Object.assign({ format: 'mp4', height: Math.min(1080, P.height >= 1080 ? 1080 : 720), fps: P.fps, range: 'all', scope: 'scene', transparent: false, audio: true, quality: 'normal' }, S.project.settings.exportPrefs, preset);
  const o = prefs;
  const body = h('div.form');
  const avail = (k) => (k === 'png' || k === 'jpg') || (caps.available && ((k === 'mp4' && (caps.h264 || caps.mpeg4)) || (k === 'webm' && (caps.vp9 || caps.vp8)) || (k === 'gif' && caps.gif)));
  const summary = h('div.hint');
  const render = () => {
    body.innerHTML = '';
    const F = FORMATS[o.format]; if (!avail(o.format)) o.format = Object.keys(FORMATS).find(avail) || 'png';
    const chips = h('div.tabs2', Object.entries(FORMATS).map(([k, v]) => h('span.chip' + (o.format === k ? '.on' : '') + (avail(k) ? '' : '.disabled'), { title: avail(k) ? '' : 'This encoder is not available in the bundled FFmpeg', style: avail(k) ? null : { opacity: 0.4 }, on: { click: () => { if (!avail(k)) return; o.format = k; if (!FORMATS[k].alpha) o.transparent = false; render(); } } }, v.label)));
    const Fm = FORMATS[o.format];
    body.append(chips,
      selectField('Resolution', RESOLUTIONS.map(([v, l]) => [String(v), `${l} — ${outputSize(v).join('×')}`]), String(o.height), (v) => { o.height = +v; upd(); }),
      selectField('Frame rate', [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps'], [String(P.fps), `Project (${P.fps} fps)`]].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i), String(o.fps), (v) => { o.fps = +v; upd(); }),
      P.scenes.length > 1 ? selectField('Scenes', [['scene', 'Current scene'], ['all', `All ${P.scenes.length} scenes in order`]], o.scope, (v) => { o.scope = v; upd(); }) : null,
      selectField('Range', [['all', 'Entire timeline'], ['loop', 'Loop range only' + (Playback.range ? '' : ' (none set)')]], o.range, (v) => { o.range = v; upd(); }),
      !Fm.seq && o.format !== 'gif' ? selectField('Quality', [['draft', 'Draft (small, fast)'], ['normal', 'Normal'], ['high', 'High'], ['final', 'Final (best, large)']], o.quality, (v) => { o.quality = v; upd(); }) : null,
      Fm.alpha ? checkField('Transparent background', o.transparent, (v) => { o.transparent = v; }, 'Keeps the alpha channel (WebM, GIF, PNG)') : h('div.hint', 'This format has no transparency — the scene background colour is used.'),
      !Fm.noAudio ? checkField('Include audio', o.audio, (v) => { o.audio = v; }) : null, summary);
    upd();
  };
  const upd = () => { const segs = segments(o); const n = segs.reduce((a, s) => a + Math.round((s.to - s.from + 1) / P.fps * o.fps), 0); const [w, hh] = outputSize(o.height); summary.textContent = `${n} frames · ${w}×${hh} · ${(n / o.fps).toFixed(1)} s${caps.available ? '' : ' · FFmpeg unavailable (image sequences only)'}`; };
  render();
  const r = await modal({ title: 'Export', width: 520, body, buttons: [{ label: 'Cancel', value: null }, { label: 'Export…', primary: true, onClick: (c) => c(true) }] });
  if (!r) return null;
  S.project.settings.exportPrefs = { ...o, outPath: undefined };
  const F = FORMATS[o.format];
  const crf = { mp4: { draft: 28, normal: 21, high: 18, final: 14 }, webm: { draft: 40, normal: 32, high: 26, final: 20 } }[o.format]; if (crf) o.crf = crf[o.quality]; o.preset = { draft: 'veryfast', normal: 'medium', high: 'slow', final: 'slower' }[o.quality];
  if (F.seq) { const d = await mf().dialog.folder({ title: 'Choose a folder for the image sequence' }); if (!d) return null; o.dir = d; o.baseName = stripExt(P.name || 'frame'); }
  else { const p = await mf().dialog.save({ title: 'Export video', defaultPath: (S.lastExportDir || '') + (P.name || 'animation') + '.' + F.ext, filters: [{ name: F.label, extensions: [F.ext] }] }); if (!p) return null; o.outPath = /\.\w+$/.test(p) ? p : p + '.' + F.ext; }
  const pg = progressModal('Exporting…'); const tok = { canceled: false }; pg.onCancel(() => { tok.canceled = true; });
  let res;
  try { res = await runExport(o, (f, t) => pg.set(f, t), tok); } catch (e) { pg.close(); toast('Export failed: ' + (e.message || e), 'error', 8000); console.error(e); return null; }
  pg.close();
  if (res.canceled) { toast('Export canceled.', 'info'); return res; }
  const where = F.seq ? o.dir : o.outPath;
  const open = await modal({ title: 'Export complete', width: 440, body: h('div', h('p.msg', `${res.frames} frames · ${res.width}×${res.height}${res.size ? ' · ' + (res.size / 1048576).toFixed(1) + ' MB' : ''}`), h('p.msg.strong', { style: { wordBreak: 'break-all', userSelect: 'text' } }, where)), buttons: [{ label: 'Close', value: null }, { label: 'Show in folder', primary: true, value: 'show' }] });
  if (open === 'show') mf().app.reveal(where);
  return res;
}
export async function exportCurrentFrame() {
  const P = S.project; const sc = scene();
  const p = await mf().dialog.save({ title: 'Export current frame', defaultPath: (P.name || 'frame') + '.png', filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg'] }] }); if (!p) return;
  const ids = await collectCelIds(P); await preloadCels(ids);
  const c = makeFrameCanvas(sc, S.frame, P.width, P.height, { camera: true, transparent: sc.bg.transparent });
  let bytes; if (/\.jpe?g$/i.test(p)) { const t = mkCanvas(P.width, P.height); const g = t.getContext('2d'); g.fillStyle = sc.bg.color; g.fillRect(0, 0, t.width, t.height); g.drawImage(c, 0, 0); bytes = await canvasToBytes(t, 'image/jpeg', 0.94); } else bytes = await canvasToBytes(c);
  await mf().file.write(p, bytes); toast('Frame exported.', 'success');
}
