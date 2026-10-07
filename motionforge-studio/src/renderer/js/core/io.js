// Project lifecycle: new / open / save / autosave / recovery / import.
import { S, bus, scene, layerById, allLayers, fps } from './state.js';
import { H } from './history.js';
import { newProject, serializeProject, loadProject, thumbnailOf, resetStores, addAsset, addCanvasAsset, newLayer, createCel, celCanvas, assets, assetMeta } from './model.js';
import { makeFrameCanvas } from './render.js';
import { TEMPLATES, applyTemplate } from './templates.js';
import { toast, modal, confirmBox, progressModal } from '../ui/common.js';
import { h, mkCanvas, canvasToBytes, baseName, stripExt, clamp, loadImage, uid } from './util.js';
import { decodeAsset, ensureSceneAudio } from './audio.js';
import { importPartsAsCharacter } from './charbuild.js';
import { addLayer, insertLayer } from './ops.js';

const mf = () => window.mf;
export const FILE_FILTER = [{ name: 'MotionForge Project', extensions: ['mfs'] }];
let autosaveId = uid('as'); let autosaveTimer = null; let lastAutosaveVer = '';

export function titleText() { const P = S.project; return `${S.dirty ? '• ' : ''}${P ? P.name : 'MotionForge Studio'}${S.filePath ? ' — ' + baseName(S.filePath) : ''}`; }
export function updateTitle() { document.title = titleText() + ' — MotionForge Studio'; try { mf().app.setTitle(document.title); } catch {} bus.emit('title'); }
bus.on('change', () => { S.dirty = true; updateTitle(); });

function resetSession() {
  H.clear(); S.frame = 0; S.playing = false; S.marquee = null; S.floating = null; S.live = null;
  S.selection = { layerId: null, boneId: null, range: null, keyFrame: null };
}
export function startProject(opts) {
  const t = opts.template || TEMPLATES.find((x) => x.id === 'blank');
  newProject({ name: opts.name || 'Untitled', width: opts.width || t.w, height: opts.height || t.h, fps: opts.fps || t.fps, bg: opts.bg || t.bg });
  resetSession(); S.filePath = null; applyTemplate(t); S.dirty = false; autosaveId = uid('as');
  bus.emit('project-loaded'); bus.emit('selection'); bus.emit('render'); updateTitle();
}
async function snapshotBytes() {
  const sc = scene(); let thumb = null;
  try { const c = makeFrameCanvas(sc, 0, 320, Math.round(320 * S.project.height / S.project.width), { camera: true, transparent: false }); thumb = await canvasToBytes(c); } catch {}
  return serializeProject(thumb);
}
export async function saveProject(saveAs = false) {
  let p = S.filePath;
  if (!p || saveAs) {
    const dp = (S.lastDir || '') + (S.project.name || 'Untitled') + '.mfs';
    p = await mf().dialog.save({ title: 'Save project', defaultPath: dp, filters: FILE_FILTER }); if (!p) return false;
    if (!/\.mfs$/i.test(p)) p += '.mfs';
  }
  const pg = progressModal('Saving project…');
  try { pg.set(0.2, 'Packing frames…'); const bytes = await snapshotBytes(); pg.set(0.7, 'Writing file…'); await mf().project.write(p, bytes); }
  catch (e) { pg.close(); toast('Save failed: ' + (e.message || e), 'error', 6000); return false; }
  pg.close();
  S.filePath = p; S.dirty = false; if (!S.project.name || S.project.name === 'Untitled') S.project.name = stripExt(baseName(p));
  updateTitle(); toast('Saved ' + baseName(p), 'success', 1800); bus.emit('saved'); return true;
}
export async function confirmDiscard() {
  if (!S.dirty) return true;
  const r = await modal({ title: 'Unsaved changes', width: 440, body: h('p.msg', `Save changes to “${S.project.name}” before continuing?`), buttons: [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'no', danger: true }, { label: 'Save', value: 'yes', primary: true }], closable: true });
  if (r === 'yes') return await saveProject(false);
  return r === 'no';
}
export async function openBytes(bytes, path) {
  const pg = progressModal('Opening project…');
  try {
    await loadProject(bytes, (f) => pg.set(f * 0.8, 'Loading frames…'));
    resetSession(); S.filePath = path || null; S.dirty = false;
    const sc = scene(); const first = allLayers(sc).find((l) => l.type === 'character') || allLayers(sc)[allLayers(sc).length - 1]; S.selection.layerId = first ? first.id : null;
    pg.set(0.9, 'Preparing audio…'); await ensureSceneAudio(sc).catch(() => {});
    bus.emit('project-loaded'); bus.emit('selection'); bus.emit('render'); updateTitle();
  } catch (e) { pg.close(); toast('Could not open project: ' + (e.message || e), 'error', 7000); return false; }
  pg.close(); return true;
}
export async function openPath(p) {
  if (!(await confirmDiscard())) return false;
  try { const b = await mf().file.read(p); S.lastDir = p.replace(/[^\\/]+$/, ''); return openBytes(b, p); } catch (e) { toast('Could not read file: ' + e.message, 'error'); return false; }
}
export async function openDialog() {
  const r = await mf().dialog.open({ title: 'Open project', filters: [...FILE_FILTER, { name: 'All files', extensions: ['*'] }] });
  if (r && r[0]) return openPath(r[0]); return false;
}
export async function revertToBackup() {
  if (!S.filePath) return toast('Save the project first.', 'info');
  const list = await mf().project.backups(S.filePath); if (!list.length) return toast('No backups exist yet for this project.', 'info');
  const rows = list.map((b) => h('button.btn.wide', { on: { click: () => ov.close(b) } }, `${baseName(b.path)} — ${new Date(b.mtime).toLocaleString()}`));
  const ov = { close: () => {} };
  const r = await modal({ title: 'Restore backup', width: 460, body: h('div.col', h('p.msg', 'Open an earlier automatic backup (the current file is not changed until you save):'), ...rows.map((b, i) => h('button.btn.wide', { on: { click: (e) => e.target.closest('.modal-ov').close(list[i]) } }, `${baseName(list[i].path)} — ${new Date(list[i].mtime).toLocaleString()}`))), buttons: [{ label: 'Cancel', value: null }] });
  if (r) { if (!(await confirmDiscard())) return; const b = await mf().file.read(r.path); await openBytes(b, null); S.dirty = true; updateTitle(); }
}

// ── autosave + recovery ──
export function startAutosave() {
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(async () => {
    if (!S.project || !S.dirty || S.playing || H.inGesture()) return;
    const minutes = (S.settings.autosaveMinutes ?? 2); if (minutes <= 0) return;
    const ver = String(H.count()) + ':' + (S.project.modified || 0); if (ver === lastAutosaveVer && false) return;
    try { const bytes = await snapshotBytes(); await mf().autosave.write(autosaveId, { name: S.project.name, path: S.filePath || null }, bytes); lastAutosaveVer = ver; bus.emit('autosaved'); } catch (e) { console.warn('autosave failed', e); }
  }, 20 * 1000);
}
export async function autosaveNow() { if (!S.project) return; const bytes = await snapshotBytes(); await mf().autosave.write(autosaveId, { name: S.project.name, path: S.filePath || null }, bytes); }
export async function clearAutosave() { try { await mf().autosave.remove(autosaveId); } catch {} }
export async function checkRecovery(crashed) {
  let list = []; try { list = await mf().autosave.list(); } catch {}
  if (!list.length) return false;
  if (!crashed && list.every((x) => Date.now() - x.time < 5000)) return false;
  const m = list[0];
  const r = await modal({ title: crashed ? 'Recover unsaved work' : 'Recovered autosave found', width: 480, body: h('div', h('p.msg', crashed ? 'MotionForge Studio did not close properly last time. An automatic recovery copy is available:' : 'An autosaved project that was never saved normally was found:'), h('p.msg.strong', `${m.name || 'Untitled'} — ${new Date(m.time).toLocaleString()}`)), buttons: [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Later', value: 'later' }, { label: 'Recover', value: 'recover', primary: true }] });
  if (r === 'recover') { const b = await mf().autosave.read(m.id); const ok = await openBytes(b, null); if (ok) { S.dirty = true; S.filePath = null; if (m.path) toast('Recovered. Use Save As to keep it — the original was at ' + m.path, 'info', 6000); updateTitle(); } }
  else if (r === 'discard') { for (const x of list) await mf().autosave.remove(x.id); }
  return r === 'recover';
}

// ── import ──
const pathFor = (f) => f.__path || (mf().app.pathForFile ? mf().app.pathForFile(f) : '');
const IMG = /\.(png|jpe?g|webp|bmp|avif)$/i, AUD = /\.(wav|mp3|ogg|oga|m4a|flac|aac|opus)$/i, VID = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;
async function fileBytes(f) { return new Uint8Array(await f.arrayBuffer()); }
function fitCanvasLayerBox(w, h2) { const P = S.project; const k = Math.min(1, (P.width * 0.8) / w, (P.height * 0.8) / h2); return { w: w * k, h: h2 * k }; }
export function addImageLayerFromCanvas(canvas, name, opts = {}) {
  const P = S.project; const rec = addCanvasAsset(canvas, name, opts.meta);
  const sz = fitCanvasLayerBox(canvas.width, canvas.height);
  const l = newLayer('image', name, opts.cat || 'draw'); l.image = { assetId: rec.id, x: -sz.w / 2, y: -sz.h / 2, w: sz.w, h: sz.h };
  l.pivot = { x: 0, y: 0 }; l.base.x = opts.x ?? P.width / 2; l.base.y = opts.y ?? P.height / 2;
  return l;
}
async function toCanvas(src) { const c = mkCanvas(src.naturalWidth || src.width, src.naturalHeight || src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
async function importRaster(f) {
  const bytes = await fileBytes(f); const bmp = await createImageBitmap(new Blob([bytes], { type: f.type || 'image/png' })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
  H.tx('Import image', () => { insertLayer(addImageLayerFromCanvas(c, stripExt(f.name))); }); return true;
}
async function importSvg(f) {
  const text = await f.text(); const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try { const img = await loadImage(url); let w = img.naturalWidth || 512, hh = img.naturalHeight || 512; const k = Math.min(4, 2048 / Math.max(w, hh)); const c = mkCanvas(w * k, hh * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); const lay = addImageLayerFromCanvas(c, stripExt(f.name)); const sz = fitCanvasLayerBox(w, hh); lay.image.x = -sz.w / 2; lay.image.y = -sz.h / 2; lay.image.w = sz.w; lay.image.h = sz.h; H.tx('Import SVG', () => insertLayer(lay)); }
  finally { URL.revokeObjectURL(url); }
}
async function importGif(f, path) {
  const bytes = await fileBytes(f); const frames = [];
  if (typeof ImageDecoder !== 'undefined') {
    const dec = new ImageDecoder({ data: bytes, type: 'image/gif' }); await dec.tracks.ready; const n = dec.tracks.selectedTrack.frameCount;
    for (let i = 0; i < n; i++) { const r = await dec.decode({ frameIndex: i }); const c = mkCanvas(r.image.displayWidth, r.image.displayHeight); c.getContext('2d').drawImage(r.image, 0, 0); frames.push({ c, dur: (r.image.duration || 100000) / 1e6 }); r.image.close(); }
  } else if (path) { const arr = await mf().media.extractFrames(path, { fps: fps(), maxWidth: S.project.width }); for (const b of arr) { const bmp = await createImageBitmap(new Blob([b], { type: 'image/png' })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); frames.push({ c, dur: 1 / fps() }); } }
  else { const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/gif' })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); frames.push({ c, dur: 1 / fps() }); toast('Only the first GIF frame could be read on this system.', 'warn'); }
  placeFramesAsLayer(frames, stripExt(f.name)); return true;
}
function placeFramesAsLayer(frames, name) {
  const P = S.project; H.tx('Import frames', () => {
    const l = newLayer('draw', name); l.cels = []; let t = 0; const F = fps();
    for (const fr of frames) {
      const id = createCel(); const cv = celCanvas(id, true); const k = Math.min(P.width / fr.c.width, P.height / fr.c.height, 1);
      cv.getContext('2d').drawImage(fr.c, (P.width - fr.c.width * k) / 2, (P.height - fr.c.height * k) / 2, fr.c.width * k, fr.c.height * k);
      l.cels.push({ f: Math.round(t * F), id }); t += fr.dur;
    }
    const seen = new Set(); l.cels = l.cels.filter((c) => (seen.has(c.f) ? false : (seen.add(c.f), true)));
    insertLayer(l); const sc = scene(); sc.duration = Math.max(sc.duration, Math.round(t * F));
  });
}
export async function importAudioBytes(bytes, name, mime = 'audio/wav') {
  const rec = addAsset({ name, mime, bytes, kind: 'audio' });
  let buf; try { buf = await decodeAsset(rec.id); } catch (e) { S.project.assets.splice(S.project.assets.indexOf(rec), 1); assets.delete(rec.id); throw new Error('Could not decode this audio file.'); }
  rec.duration = buf.duration;
  H.tx('Import audio', () => { const sc = scene(); sc.audio.push({ id: uid('au'), assetId: rec.id, name, start: S.frame, trimIn: 0, trimOut: null, volume: 1, fadeIn: 0, fadeOut: 0, muted: false }); sc.duration = Math.max(sc.duration, S.frame + Math.ceil(buf.duration * fps())); });
  return rec;
}
async function importAudio(f) { const b = await fileBytes(f); await importAudioBytes(b, f.name, f.type || 'audio/mpeg'); toast('Audio added to the timeline.', 'success'); return true; }
async function importVideo(f, path) {
  const p = path || pathFor(f);
  if (!p) { toast('Video import needs a file path — use File ▸ Import.', 'warn'); return false; }
  const choice = await modal({ title: `Import video — ${f.name}`, width: 460, body: h('p.msg', 'How should this video be imported?'), buttons: [{ label: 'Cancel', value: null }, { label: 'Audio track only', value: 'audio' }, { label: 'Frames as drawing layer', value: 'frames', primary: true }] });
  if (!choice) return false;
  const pg = progressModal('Reading video…'); pg.set(0.3, 'Extracting with FFmpeg…');
  try {
    if (choice === 'audio') { const wav = await mf().media.extractAudio(p); await importAudioBytes(wav, stripExt(f.name) + ' (audio)', 'audio/wav'); }
    else { const arr = await mf().media.extractFrames(p, { fps: Math.min(fps(), 24), maxWidth: Math.min(1280, S.project.width), maxFrames: 360 }); const frames = []; for (const b of arr) { const bmp = await createImageBitmap(new Blob([b], { type: 'image/png' })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); frames.push({ c, dur: 1 / Math.min(fps(), 24) }); } placeFramesAsLayer(frames, stripExt(f.name)); }
  } catch (e) { pg.close(); toast(e.message || String(e), 'error', 6000); return false; }
  pg.close(); toast('Video imported.', 'success'); return true;
}
async function importPsd(f) {
  const { loadPsd } = await import('../ui/psd.js'); const items = await loadPsd(await fileBytes(f));
  const l = importPartsAsCharacter(items, { name: stripExt(f.name) });
  if (!l) { toast('No recognisable body-part layer names (head, body, arm_L …). Imported layers as images instead.', 'warn', 6000); H.tx('Import PSD', () => { items.forEach((it) => insertLayer(addImageLayerFromCanvas(it.canvas, it.name, { x: it.x + it.canvas.width / 2, y: it.y + it.canvas.height / 2 }))); }); return true; }
  H.tx('Import character', () => insertLayer(l)); toast('Character built from PSD layers.', 'success'); return true;
}
export async function importFiles(files, { x, y } = {}) {
  let ok = 0; const list = [...files];
  // multiple images with part names → character
  const imgs = list.filter((f) => IMG.test(f.name) || /\.png$/i.test(f.name));
  if (imgs.length >= 3) {
    const { matchRole } = await import('./charbuild.js'); const named = imgs.filter((f) => matchRole(f.name));
    if (named.length >= 3) {
      const items = []; for (const f of named) { const bmp = await createImageBitmap(f); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); items.push({ name: f.name, canvas: c }); }
      const l = importPartsAsCharacter(items, { name: 'Imported Character' }); if (l) { H.tx('Import character', () => insertLayer(l)); toast(`Built a rigged character from ${named.length} part images.`, 'success', 4000); ok += named.length; list.splice(0, list.length, ...list.filter((f) => !named.includes(f))); }
    }
  }
  for (const f of list) {
    try {
      const n = f.name; const path = pathFor(f);
      if (/\.mfs$/i.test(n)) { if (path) await openPath(path); else { if (await confirmDiscard()) await openBytes(await fileBytes(f), null); } ok++; }
      else if (/\.svg$/i.test(n)) { await importSvg(f); ok++; }
      else if (/\.gif$/i.test(n)) { await importGif(f, path); ok++; }
      else if (IMG.test(n)) { await importRaster(f); ok++; }
      else if (AUD.test(n)) { await importAudio(f); ok++; }
      else if (VID.test(n)) { if (await importVideo(f, path)) ok++; }
      else if (/\.psd$/i.test(n)) { await importPsd(f); ok++; }
      else if (/\.mfa$/i.test(n)) { const { importMfa } = await import('../ui/library.js'); await importMfa(await fileBytes(f)); ok++; }
      else toast(`Unsupported file type: ${n}`, 'warn');
    } catch (e) { console.error(e); toast(`Could not import ${f.name}: ${e.message || e}`, 'error', 6000); }
  }
  return ok;
}
export async function importDialog() {
  const paths = await mf().dialog.open({ title: 'Import media', multi: true, filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'wav', 'mp3', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'psd', 'mfa'] }] });
  if (!paths || !paths.length) return;
  const files = []; for (const p of paths) { const b = await mf().file.read(p); const f = new File([b], baseName(p), { type: mimeFor(p) }); Object.defineProperty(f, '__path', { value: p }); files.push(f); }
  await importFiles(files);
}
function mimeFor(p) { const e = (p.match(/\.([^.]+)$/) || [])[1]; return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' }[(e || '').toLowerCase()] || ''; }
