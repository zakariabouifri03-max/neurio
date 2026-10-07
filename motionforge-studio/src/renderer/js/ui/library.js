// Asset library: reusable layers / characters / images / sounds, stored per-user in the app data folder as .mfa files.
import { h, mkCanvas, canvasToBytes, uid, deepClone, clamp, stripExt, baseName } from '../core/util.js';
import { S, bus, scene, curLayer, layerById, allLayers } from '../core/state.js';
import { H } from '../core/history.js';
import { celBytes, createCel, cels, assetBytes, assetMeta, addAsset, loadAssetImage, assetImage } from '../core/model.js';
import { makeFrameCanvas } from '../core/render.js';
import { insertLayer } from '../core/ops.js';
import { importAudioBytes, addImageLayerFromCanvas } from '../core/io.js';
import { toast, modal, askText, confirmBox, contextMenu, button, iconButton } from './common.js';
import { icon } from './icons.js';
import * as fflate from '../../vendor/fflate.js';

const mf = () => window.mf;
const enc = new TextEncoder(), dec = new TextDecoder();
let index = { folders: ['General'], items: [] };
let ui = { folder: 'All', q: '', tag: null, sel: null };
const thumbs = new Map();

export async function refreshIndex() { try { index = await mf().lib.list(); } catch { index = { folders: ['General'], items: [] }; } index.folders = index.folders || ['General']; index.items = index.items || []; bus.emit('library'); return index; }

function walkLayers(list, fn) { for (const l of list) { fn(l); if (l.children) walkLayers(l.children, fn); } }
async function autocropThumb(cv, size = 96) {
  const g = cv.getContext('2d'); const d = g.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const out = mkCanvas(size, size); const og = out.getContext('2d'); if (x1 < 0) return out.toDataURL('image/png');
  const w = x1 - x0 + 1, hh = y1 - y0 + 1, k = Math.min((size - 8) / w, (size - 8) / hh, 3);
  og.imageSmoothingQuality = 'high'; og.drawImage(cv, x0, y0, w, hh, (size - w * k) / 2, (size - hh * k) / 2, w * k, hh * k); return out.toDataURL('image/png');
}
async function layersThumb(layers) {
  const P = S.project; const sc = { ...scene(), layers, bg: { color: '#ffffff', transparent: true }, camera: null, shots: [] };
  const W = 480, Hh = Math.round(480 * P.height / P.width);
  try { const c = makeFrameCanvas(sc, S.frame, W, Hh, { camera: false, transparent: true }); return await autocropThumb(c); } catch (e) { return null; }
}

/** Serialize layers (deep) into an .mfa container. */
export async function packLayers(layers, name) {
  const files = {}; const celIds = new Set(), assetIds = new Set();
  const copy = deepClone(layers);
  walkLayers(copy, (l) => { if (l.cels) for (const c of l.cels) if (c.id) celIds.add(c.id); if (l.image && l.image.assetId) assetIds.add(l.image.assetId); });
  for (const id of celIds) { const b = await celBytes(id); if (b && b.length) files[`cels/${id}.png`] = [b, { level: 0 }]; }
  const assets = []; for (const id of assetIds) { const b = await assetBytes(id); const m = assetMeta(id); if (b && m) { files[`assets/${id}`] = [b, { level: 0 }]; assets.push(m); } }
  files['payload.json'] = [enc.encode(JSON.stringify({ format: 'mfa', version: 1, kind: 'layers', name, layers: copy, assets, size: [S.project.width, S.project.height] })), { level: 6 }];
  return fflate.zipSync(files);
}
function unpack(bytes) { const files = fflate.unzipSync(bytes); if (!files['payload.json']) throw new Error('Not a MotionForge asset (.mfa).'); const p = JSON.parse(dec.decode(files['payload.json'])); if (p.format !== 'mfa') throw new Error('Not a MotionForge asset (.mfa).'); return { p, files }; }

export async function saveSelectionToLibrary() {
  const l = curLayer(); if (!l) { toast('Select a layer (or character) first.', 'warn'); return; }
  const nameInput = h('input.txt', { value: l.name }); const tagInput = h('input.txt', { placeholder: 'tags, comma separated' });
  const fsel = h('select.sel', index.folders.map((f) => h('option', { value: f }, f)));
  const r = await modal({ title: 'Save to asset library', body: h('div.form', h('label.fld', h('span', 'Name'), nameInput), h('label.fld', h('span', 'Folder'), fsel), h('label.fld', h('span', 'Tags'), tagInput)), buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: true }] });
  if (!r) return;
  const bytes = await packLayers([l], nameInput.value);
  const thumb = await layersThumb([l]);
  const meta = { id: uid('lib'), name: nameInput.value || l.name, kind: 'layers', folder: fsel.value, tags: tagInput.value.split(',').map((s) => s.trim()).filter(Boolean), created: Date.now(), thumb, char: !!l.char };
  index = await mf().lib.put(meta, bytes); bus.emit('library'); toast(`Saved “${meta.name}” to the library.`, 'success');
}
export async function addFilesToLibrary(files, folder) {
  let n = 0;
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer()); const name = stripExt(f.name); const folderName = folder && folder !== 'All' ? folder : 'General';
      if (/\.mfa$/i.test(f.name)) { const { p } = unpack(bytes); const meta = { id: uid('lib'), name: p.name || name, kind: p.kind || 'layers', folder: folderName, tags: [], created: Date.now(), thumb: null }; index = await mf().lib.put(meta, bytes); n++; continue; }
      let kind, thumb = null, payload;
      if (/^audio\//.test(f.type) || /\.(wav|mp3|ogg)$/i.test(f.name)) { kind = 'audio'; payload = { format: 'mfa', version: 1, kind, name, mime: f.type || 'audio/wav', assets: [{ id: 'a0', name: f.name, mime: f.type || 'audio/wav', kind: 'audio' }] }; }
      else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|svg|webp)$/i.test(f.name)) {
        kind = 'image'; const bmpUrl = URL.createObjectURL(new Blob([bytes], { type: f.type || 'image/png' }));
        try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = bmpUrl; }); const c = mkCanvas(Math.min(img.naturalWidth || 512, 2048), 0); const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512; const k = Math.min(1, 2048 / Math.max(w0, h0)); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); thumb = await autocropThumb(c); payload = { format: 'mfa', version: 1, kind, name, mime: 'image/png', assets: [{ id: 'a0', name: f.name, mime: 'image/png', kind: 'image', w: c.width, h: c.height }] }; bytes.__png = await canvasToBytes(c); } finally { URL.revokeObjectURL(bmpUrl); }
      } else { toast(`Unsupported file: ${f.name}`, 'warn'); continue; }
      const data = kind === 'image' ? bytes.__png : bytes;
      const zip = fflate.zipSync({ 'payload.json': [enc.encode(JSON.stringify(payload)), { level: 6 }], 'assets/a0': [data, { level: 0 }] });
      const meta = { id: uid('lib'), name, kind, folder: folderName, tags: [kind], created: Date.now(), thumb };
      index = await mf().lib.put(meta, zip); n++;
    } catch (e) { console.error(e); toast(`Could not add ${f.name}: ${e.message}`, 'error'); }
  }
  if (n) { bus.emit('library'); toast(`Added ${n} item${n > 1 ? 's' : ''} to the library.`, 'success'); }
}

/** Instantiate a library item into the current scene. */
export async function insertItem(id, at) {
  const bytes = await mf().lib.get(id); return insertMfa(bytes, at);
}
export async function insertMfa(bytes, at) {
  const { p, files } = unpack(bytes); const P = S.project;
  if (p.kind === 'audio') { const a = files['assets/a0']; await importAudioBytes(a, p.name || 'Sound', p.mime || 'audio/wav'); return true; }
  if (p.kind === 'image') { const a = files['assets/a0']; const bmp = await createImageBitmap(new Blob([a], { type: 'image/png' })); const c = mkCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); H.tx('Insert asset', () => { const l = addImageLayerFromCanvas(c, p.name || 'Image', at ? { x: at.x, y: at.y } : {}); insertLayer(l); }); return true; }
  const amap = {}; const layers = p.layers;
  H.tx('Insert from library', () => {
    for (const a of p.assets || []) { const data = files['assets/' + a.id]; if (!data) continue; const rec = addAsset({ name: a.name, mime: a.mime, bytes: data, kind: a.kind, w: a.w, h: a.h }); amap[a.id] = rec.id; }
    walkLayers(layers, (l) => {
      l.id = uid('ly');
      if (l.cels) l.cels = l.cels.map((c) => { if (!c.id) return c; const b = files[`cels/${c.id}.png`]; const nid = createCel(); if (b) cels.get(nid).bytes = b; return { f: c.f, id: nid }; });
      if (l.image && l.image.assetId) { l.image.assetId = amap[l.image.assetId] || l.image.assetId; assetImage(l.image.assetId); }
    });
    if (at && layers[0] && layers[0].base) { const dx = at.x - layers[0].base.x, dy = at.y - layers[0].base.y; for (const l of layers) if (l.base) { l.base.x += dx; l.base.y += dy; } }
    else if (p.size && (p.size[0] !== P.width || p.size[1] !== P.height)) { const k = Math.min(P.width / p.size[0], P.height / p.size[1]); for (const l of layers) if (l.base && k < 1 && !l.children) { l.base.scaleX = (l.base.scaleX ?? 1) * k; l.base.scaleY = (l.base.scaleY ?? 1) * k; } }
    for (const l of layers) insertLayer(l);
  });
  return true;
}
/** .mfa dropped/opened from disk: add to the library and place it in the scene. */
export async function importMfa(bytes) {
  const { p } = unpack(bytes);
  const meta = { id: uid('lib'), name: p.name || 'Imported asset', kind: p.kind || 'layers', folder: 'General', tags: ['imported'], created: Date.now(), thumb: null };
  index = await mf().lib.put(meta, bytes); bus.emit('library');
  await insertMfa(bytes);
}
async function exportItem(it) {
  const p = await mf().dialog.save({ title: 'Export asset', defaultPath: it.name + '.mfa', filters: [{ name: 'MotionForge asset', extensions: ['mfa'] }] }); if (!p) return;
  const b = await mf().lib.get(it.id); await mf().file.write(p, b); toast('Asset exported.', 'success');
}

// ───────────────────────── Panel ─────────────────────────
export function assetsPanel() {
  const root = h('div.panel.assets');
  const grid = h('div.lib-grid'); const folderBar = h('div.chips');
  const search = h('input.txt', { placeholder: 'Search name or tag…', on: { input: () => { ui.q = search.value.toLowerCase(); draw(); } } });
  function filtered() {
    return index.items.filter((it) => (ui.folder === 'All' || it.folder === ui.folder) && (!ui.tag || (it.tags || []).includes(ui.tag)) && (!ui.q || it.name.toLowerCase().includes(ui.q) || (it.tags || []).some((t) => t.toLowerCase().includes(ui.q))));
  }
  function draw() {
    folderBar.innerHTML = '';
    for (const f of ['All', ...index.folders]) {
      const c = h('span.chip' + (ui.folder === f ? '.on' : ''), { on: { click: () => { ui.folder = f; draw(); }, contextmenu: (e) => { e.preventDefault(); if (f === 'All') return; contextMenu([{ label: 'Rename folder', run: async () => { const n = await askText('Rename folder', 'Name', f); if (n && n !== f) { const fs = index.folders.map((x) => (x === f ? n : x)); for (const it of index.items) if (it.folder === f) await mf().lib.put({ ...it, folder: n }); index = await mf().lib.folders(fs); ui.folder = n; draw(); } } }, { label: 'Delete folder (items move to General)', run: async () => { if (f === 'General') { toast('The General folder cannot be removed.', 'warn'); return; } for (const it of index.items) if (it.folder === f) await mf().lib.put({ ...it, folder: 'General' }); index = await mf().lib.folders(index.folders.filter((x) => x !== f)); ui.folder = 'All'; draw(); } }], e.clientX, e.clientY); },
        dragover: (e) => { if (f !== 'All') { e.preventDefault(); c.classList.add('drop'); } }, dragleave: () => c.classList.remove('drop'),
        drop: async (e) => { c.classList.remove('drop'); const id = e.dataTransfer.getData('application/x-mf-lib'); if (id && f !== 'All') { e.preventDefault(); e.stopPropagation(); const it = index.items.find((x) => x.id === id); if (it) { index = await mf().lib.put({ ...it, folder: f }); draw(); } } } } }, f);
      folderBar.append(c);
    }
    folderBar.append(h('span.chip.add', { title: 'New folder', on: { click: async () => { const n = await askText('New folder', 'Folder name', ''); if (n && !index.folders.includes(n)) { index = await mf().lib.folders([...index.folders, n]); ui.folder = n; draw(); } } } }, '+'));
    const tags = [...new Set(index.items.flatMap((i) => i.tags || []))].sort();
    const items = filtered(); grid.innerHTML = '';
    if (!items.length) grid.append(h('div.empty', index.items.length ? 'No assets match this filter.' : 'Your library is empty.\nSelect a layer or character and choose “Save selection”, or drop images / sounds / .mfa files here.'));
    for (const it of items) {
      const th = it.thumb ? h('img', { src: it.thumb, draggable: false }) : h('div.noth', { html: icon(it.kind === 'audio' ? 'audio' : 'image', 28) });
      const card = h('div.lib-card' + (ui.sel === it.id ? '.sel' : ''), { draggable: true, title: `${it.name}\n${it.kind}${(it.tags || []).length ? ' · ' + it.tags.join(', ') : ''}\nDouble-click to insert`, on: {
        click: () => { ui.sel = it.id; draw(); }, dblclick: () => insertItem(it.id).catch((e) => toast(e.message, 'error')),
        dragstart: (e) => { e.dataTransfer.setData('application/x-mf-lib', it.id); e.dataTransfer.effectAllowed = 'copyMove'; },
        contextmenu: (e) => { e.preventDefault(); ui.sel = it.id; contextMenu([
          { label: 'Insert into scene', run: () => insertItem(it.id).catch((er) => toast(er.message, 'error')) }, '-',
          { label: 'Rename…', run: async () => { const n = await askText('Rename asset', 'Name', it.name); if (n) { index = await mf().lib.put({ ...it, name: n }); draw(); } } },
          { label: 'Edit tags…', run: async () => { const n = await askText('Tags', 'Comma separated', (it.tags || []).join(', ')); if (n != null) { index = await mf().lib.put({ ...it, tags: n.split(',').map((s) => s.trim()).filter(Boolean) }); draw(); } } },
          { label: 'Move to folder', sub: index.folders.map((f) => ({ label: f, checked: it.folder === f, run: async () => { index = await mf().lib.put({ ...it, folder: f }); draw(); } })) },
          { label: 'Export .mfa…', run: () => exportItem(it) }, '-',
          { label: 'Delete', run: async () => { if (await confirmBox('Delete asset', `Delete “${it.name}” from the library?`, 'Delete', true)) { index = await mf().lib.remove(it.id); draw(); } } }], e.clientX, e.clientY); } } },
        th, h('div.nm', it.name), h('div.kd', it.kind === 'layers' && it.char ? 'character' : it.kind));
      grid.append(card);
    }
    tagBar.innerHTML = ''; for (const t of tags.slice(0, 14)) tagBar.append(h('span.chip.sm' + (ui.tag === t ? '.on' : ''), { on: { click: () => { ui.tag = ui.tag === t ? null : t; draw(); } } }, '#' + t));
  }
  const tagBar = h('div.chips.tags');
  const bar = h('div.row.tight', search,
    iconButton('plus', 'Add images, sounds or .mfa files to the library', async () => { const files = await mf().dialog.open({ title: 'Add to library', multi: true, filters: [{ name: 'Assets', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'wav', 'mp3', 'ogg', 'mfa'] }] }); if (!files || !files.length) return; const fl = []; for (const p of files) { const b = await mf().file.read(p); fl.push(new File([b], baseName(p), { type: /\.mp3$/i.test(p) ? 'audio/mpeg' : /\.wav$/i.test(p) ? 'audio/wav' : /\.ogg$/i.test(p) ? 'audio/ogg' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.gif$/i.test(p) ? 'image/gif' : /\.png$/i.test(p) ? 'image/png' : '' })); } await addFilesToLibrary(fl, ui.folder); }));
  root.append(h('div.hint', 'Reusable characters, props, images and sounds. Drag a card onto the canvas, or double-click to insert.'), bar, folderBar, tagBar,
    h('div.row.tight', button('Save selection', () => saveSelectionToLibrary(), { tip: 'Save the selected layer / character to the library', ic: 'save' }), button('Insert', () => { if (ui.sel) insertItem(ui.sel).catch((e) => toast(e.message, 'error')); else toast('Select an asset first.', 'info'); }, { tip: 'Insert the selected asset into the scene' })), grid);
  root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
  root.addEventListener('drop', (e) => { if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); addFilesToLibrary([...e.dataTransfer.files], ui.folder); } });
  bus.on('library', draw);
  refreshIndex().then(draw); draw();
  return root;
}
