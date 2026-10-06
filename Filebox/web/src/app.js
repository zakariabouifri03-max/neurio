// ── Filebox — UI ────────────────────────────────────────────────────────────
import { T, setLang, LANG, esc, fmtBytes, fmtDate, relTime, iconOf, kindOf, uid,
         downloadBlob, fingerprint, store } from './util.js';
import { zipCreate, zipList, zipExtractAll, zipExtractEntry, zipVerify } from './zip.js';
import * as DB from './db.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

// ── toasts / modals ─────────────────────────────────────────────────────────
function toast(msg, kind = '') {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

function modal({ title, body, actions = [], wide = false }) {
  return new Promise((resolve) => {
    const card = h('div', { class: 'card' + (wide ? ' wide' : '') });
    card.append(h('div', { class: 'cardTitle' }, title));
    const content = h('div', { class: 'cardBody' });
    if (typeof body === 'string') content.innerHTML = body; else content.append(body);
    card.append(content);
    const bar = h('div', { class: 'cardActions' });
    actions.forEach((a) => bar.append(h('button', {
      class: 'btn ' + (a.kind || ''),
      onclick: () => { const v = a.onClick ? a.onClick(card) : a.value; if (v !== false) close(v); },
    }, a.label)));
    card.append(bar);
    const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(null); } }, card);
    const close = (v) => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 180); resolve(v); };
    $('#modals').append(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
  });
}

function prompt2(title, { label = '', value = '', password = false, ok = T('ok'), cancel = T('cancel') } = {}) {
  const input = h('input', { class: 'input', type: password ? 'password' : 'text', value });
  input.setAttribute('inputmode', password ? 'text' : 'text');
  const wrap = h('div', {}, label ? h('label', { class: 'lbl' }, label) : null, input);
  return modal({
    title, body: wrap,
    actions: [{ label: cancel, kind: 'ghost', value: null }, { label: ok, kind: 'primary', onClick: () => input.value }],
  }).then((v) => { setTimeout(() => input.focus(), 220); return v; });
}

function confirm2(title, text, { ok = T('yes'), cancel = T('no'), danger = false } = {}) {
  return modal({
    title, body: `<p>${esc(text)}</p>`,
    actions: [{ label: cancel, kind: 'ghost', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }],
  });
}

function progressModal(title) {
  const bar = h('div', { class: 'bar' }, h('div', { class: 'barFill' }));
  const label = h('div', { class: 'progLabel' }, '0%');
  const card = h('div', { class: 'card' },
    h('div', { class: 'cardTitle' }, title),
    h('div', { class: 'cardBody' }, bar, label),
    h('div', { class: 'cardActions' }));
  const scrim = h('div', { class: 'scrim in' }, card);
  $('#modals').append(scrim);
  return {
    set(p) {
      const v = Math.max(0, Math.min(1, p));
      bar.firstChild.style.width = (v * 100).toFixed(1) + '%';
      label.textContent = Math.round(v * 100) + '%';
    },
    close() { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 180); },
  };
}

// ── app state ───────────────────────────────────────────────────────────────
const S = {
  tab: 'dash',
  files: [],
  vaults: [],
  selected: new Set(),
  query: '',
  filter: 'all',
  sort: store.get('fb.sort', 'date'),
  installEvt: null,
};

// ── PIN ─────────────────────────────────────────────────────────────────────
async function hashPin(pin, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin + '|' + salt), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode('filebox.pin'), iterations: 150000, hash: 'SHA-256' }, base, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pinPad({ onSubmit, title, subtitle }) {
  const dots = h('div', { class: 'dots' }, ...Array.from({ length: 6 }, () => h('span')));
  let value = '';
  const render = () => $$('#pinScreen .dots span').forEach((d, i) => d.classList.toggle('on', i < value.length));
  const press = (d) => {
    if (d === 'del') value = value.slice(0, -1);
    else if (value.length < 8) value += d;
    render();
    if (value.length >= 4) {
      clearTimeout(press.t);
      press.t = setTimeout(() => { if (value.length >= 4) onSubmit(value, () => { value = ''; render(); }); }, 220);
    }
  };
  const keys = h('div', { class: 'pad' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button', { class: 'padKey', onclick: () => press(d) }, d)),
    h('button', { class: 'padKey ghost', onclick: () => press('del') }, '⌫'),
    h('button', { class: 'padKey', onclick: () => press('0') }, '0'),
    h('button', { class: 'padKey ghost', onclick: () => { if (value) onSubmit(value, () => { value = ''; render(); }); } }, '⏎'));
  return h('div', { id: 'pinScreen', class: 'pinScreen' },
    h('div', { class: 'pinLogo' }, '📦'),
    h('div', { class: 'pinTitle' }, title),
    h('div', { class: 'pinSub' }, subtitle || ''),
    dots, keys);
}

async function lockScreen() {
  const stored = await DB.getMeta('pin');
  const root = $('#app');
  root.innerHTML = '';
  if (!stored) {
    // first run — offer a PIN, but let the user skip
    const el = pinPad({
      title: T('set_pin'),
      subtitle: T('pin_hint'),
      onSubmit: async (v, reset) => {
        if (v.length < 4) { toast(T('pin_bad'), 'err'); return reset(); }
        const again = await new Promise((res) => {
          root.innerHTML = '';
          root.append(pinPad({ title: T('set_pin2'), subtitle: '', onSubmit: (v2, r2) => res(v2) }));
        });
        if (again !== v) { toast(T('pin_bad'), 'err'); return lockScreen(); }
        const salt = uid();
        await DB.setMeta('pin', { salt, hash: await hashPin(v, salt) });
        toast(T('pin_changed'));
        start();
      },
    });
    root.append(el);
    const skip = h('button', { class: 'btn ghost skipPin', onclick: () => start() }, T('cancel'));
    root.append(skip);
  } else {
    root.append(pinPad({
      title: T('enter_pin'),
      onSubmit: async (v, reset) => {
        const ok = await hashPin(v, stored.salt) === stored.hash;
        if (!ok) { toast(T('pin_wrong'), 'err'); $('#pinScreen')?.classList.add('shake'); return reset(); }
        start();
      },
    }));
  }
}

// ── shell ───────────────────────────────────────────────────────────────────
const TABS = [
  ['dash', '🏠', 'nav_dash'],
  ['inbox', '📁', 'nav_inbox'],
  ['vault', '🔒', 'nav_vault'],
  ['clean', '🧹', 'nav_clean'],
  ['set', '⚙️', 'nav_set'],
];

function start() {
  const root = $('#app');
  root.innerHTML = '';
  root.append(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, '📦 ', T('app_name')),
      h('div', { class: 'topRight' },
        S.installEvt ? h('button', { class: 'iconBtn', title: T('install'), onclick: doInstall }, '📱') : null,
        h('button', { class: 'iconBtn', onclick: cycleLang }, langFlag()))),
    h('main', { id: 'view' }),
    h('nav', { class: 'tabs' }, ...TABS.map(([id, ico, key]) =>
      h('button', { class: 'tab', 'data-tab': id, onclick: () => go(id) },
        h('span', { class: 'tabIco' }, ico), h('span', { class: 'tabLbl' }, T(key))))),
  );
  go('dash');
}

function langFlag() { return { darija: '🇲🇦', fr: '🇫🇷', en: '🇬🇧' }[LANG] || '🌐'; }
function cycleLang() {
  const order = ['darija', 'fr', 'en'];
  setLang(order[(order.indexOf(LANG) + 1) % order.length]);
  toast(LANG.toUpperCase());
  start();
}

async function go(tab) {
  S.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const view = $('#view');
  view.innerHTML = '';
  await refresh();
  ({ dash: viewDash, inbox: viewInbox, vault: viewVault, clean: viewClean, set: viewSet })[tab](view);
}

async function refresh() {
  S.files = await DB.listFiles();
  S.vaults = await DB.listVaults();
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function viewDash(view) {
  const u = await DB.usage();
  const storedBytes = S.files.reduce((a, f) => a + f.size, 0);
  const vaultBytes = S.vaults.reduce((a, v) => a + (v.size || 0), 0);
  const saved = S.vaults.reduce((a, v) => a + Math.max(0, (v.origSize || 0) - (v.size || 0)), 0);

  const stat = (label, value, sub, cls = '') =>
    h('div', { class: 'stat ' + cls }, h('div', { class: 'statVal' }, value),
      h('div', { class: 'statLbl' }, label), sub ? h('div', { class: 'statSub' }, sub) : null);

  const quotaPct = u.quota ? Math.min(100, (u.usage / u.quota) * 100) : 0;

  view.append(
    h('section', { class: 'pad' },
      h('h1', { class: 'hi' }, T('dash_hi')),
      h('div', { class: 'hero' },
        h('div', { class: 'heroVal' }, fmtBytes(saved)),
        h('div', { class: 'heroLbl' }, T('dash_saved'))),
      h('div', { class: 'stats' },
        stat(T('dash_files'), String(S.files.length), fmtBytes(storedBytes)),
        stat(T('dash_vaults'), String(S.vaults.length), fmtBytes(vaultBytes)),
        stat(T('dash_stored'), fmtBytes(vaultBytes), `${S.vaults.length} × .zip`)),
      h('div', { class: 'quota' },
        h('div', { class: 'quotaRow' },
          h('span', {}, T('dash_usage')),
          h('span', { class: 'muted' }, `${fmtBytes(u.usage)} / ${fmtBytes(u.quota)}`)),
        h('div', { class: 'bar' }, h('div', { class: 'barFill', style: `width:${quotaPct}%` }))),
      h('div', { class: 'tip' },
        h('div', { class: 'tipTitle' }, T('dash_tip_title')),
        h('p', {}, T('dash_tip'))),
      h('div', { class: 'quick' },
        h('button', { class: 'btn primary big', onclick: () => pickFiles() }, T('inbox_add')),
        h('button', { class: 'btn big', onclick: () => go('vault') }, T('vault_new')),
        h('button', { class: 'btn big', onclick: () => go('clean') }, T('clean_title')))),
  );
}

// ── inbox ───────────────────────────────────────────────────────────────────
const KINDS = ['all', 'image', 'video', 'audio', 'pdf', 'doc', 'archive', 'file'];

async function pickFiles(folder = false) {
  const inp = h('input', { type: 'file', multiple: true, style: 'display:none' });
  if (folder) inp.webkitdirectory = true;
  inp.onchange = async () => {
    const list = [...inp.files];
    if (!list.length) return;
    const pm = progressModal(T('importing', 0));
    let added = 0, dup = 0;
    for (let i = 0; i < list.length; i++) {
      const r = await DB.addFile(list[i]);
      if (r.added) added++; else dup++;
      pm.set((i + 1) / list.length);
    }
    pm.close();
    await refresh();
    toast(dup ? T('imported_dup', added, dup) : T('imported', added), 'ok');
    go(S.tab);
  };
  document.body.append(inp);
  inp.click();
  setTimeout(() => inp.remove(), 60000);
}

function fileRow(f) {
  const on = S.selected.has(f.id);
  const thumb = f.thumb
    ? h('img', { class: 'thumb', src: f.thumb, loading: 'lazy' })
    : h('div', { class: 'thumb ico' }, iconOf(f.name));
  return h('div', { class: 'row' + (on ? ' sel' : ''), onclick: (e) => {
      if (e.target.closest('.rowAct')) return;
      S.selected.has(f.id) ? S.selected.delete(f.id) : S.selected.add(f.id);
      go('inbox');
    } },
    h('div', { class: 'check' + (on ? ' on' : '') }, on ? '✓' : ''),
    thumb,
    h('div', { class: 'rowMain' },
      h('div', { class: 'rowName' }, f.name),
      h('div', { class: 'rowMeta' }, `${fmtBytes(f.size)} · ${relTime(f.addedAt)}`)),
    h('button', { class: 'rowAct', onclick: () => preview(f) }, '👁️'));
}

function visibleFiles() {
  let out = S.files;
  if (S.filter !== 'all') out = out.filter((f) => (S.filter === 'file' ? !['image', 'video', 'audio', 'pdf', 'doc', 'archive'].includes(f.kind) : f.kind === S.filter));
  if (S.query) {
    const q = S.query.toLowerCase();
    out = out.filter((f) => (f.relPath || f.name).toLowerCase().includes(q));
  }
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => b.size - a.size,
    date: (a, b) => b.addedAt - a.addedAt,
  }[S.sort];
  return [...out].sort(cmp);
}

async function viewInbox(view) {
  const list = visibleFiles();
  const selCount = S.selected.size;
  const selBytes = S.files.filter((f) => S.selected.has(f.id)).reduce((a, f) => a + f.size, 0);

  view.append(
    h('div', { class: 'sticky' },
      h('div', { class: 'toolbar' },
        h('input', { class: 'input search', type: 'search', placeholder: T('inbox_search'), value: S.query,
          oninput: (e) => { S.query = e.target.value; rerenderList(); } }),
        h('select', { class: 'input sel', onchange: (e) => { S.sort = e.target.value; store.set('fb.sort', S.sort); go('inbox'); } },
          ...[['date', T('sort_date')], ['size', T('sort_size')], ['name', T('sort_name')]].map(([v, l]) =>
            h('option', { value: v, selected: S.sort === v }, l)))),
      h('div', { class: 'chips' }, ...KINDS.map((k) =>
        h('button', { class: 'chip' + (S.filter === k ? ' on' : ''), onclick: () => { S.filter = k; go('inbox'); } },
          k === 'all' ? T('filter_all') : (iconOf('x.' + k) + ' ' + k)))),
      selCount ? h('div', { class: 'selbar' },
        h('span', { class: 'selCount' }, T('inbox_sel', selCount) + ' · ' + fmtBytes(selBytes)),
        h('button', { class: 'btn small primary', onclick: vaultFromSelection }, T('act_vault')),
        h('button', { class: 'btn small', onclick: exportSelection }, T('act_export')),
        h('button', { class: 'btn small danger', onclick: deleteSelection }, T('act_del'))) : null),
    h('div', { class: 'pad' },
      list.length
        ? h('div', { id: 'fileList', class: 'list' }, ...list.map(fileRow))
        : h('div', { class: 'empty' },
            h('div', { class: 'emptyIco' }, '📭'),
            h('p', {}, T('inbox_empty')),
            h('button', { class: 'btn primary big', onclick: () => pickFiles() }, T('inbox_add')),
            h('button', { class: 'btn big', onclick: () => pickFiles(true) }, T('inbox_add_folder')))),
    h('div', { class: 'fab' },
      h('button', { class: 'fabBtn', onclick: () => pickFiles() }, '➕')),
  );
}

function rerenderList() {
  const box = $('#fileList');
  if (!box) return;
  const list = visibleFiles();
  box.innerHTML = '';
  list.forEach((f) => box.append(fileRow(f)));
}

async function preview(f) {
  const rec = await DB.getFile(f.id);
  if (!rec?.blob) return toast(T('err_generic', 'no data'), 'err');
  const url = URL.createObjectURL(rec.blob);
  const kind = rec.kind;
  let inner;
  if (kind === 'image') inner = h('img', { class: 'pv', src: url });
  else if (kind === 'video') inner = h('video', { class: 'pv', src: url, controls: true, playsinline: true });
  else if (kind === 'audio') inner = h('audio', { class: 'pv', src: url, controls: true });
  else if (kind === 'pdf') inner = h('iframe', { class: 'pv frame', src: url });
  else inner = h('p', { class: 'muted center' }, T('preview_unsupported'));
  const body = h('div', {}, inner,
    h('div', { class: 'pvMeta' }, `${rec.name} · ${fmtBytes(rec.size)} · ${fmtDate(rec.addedAt)}`));
  await modal({
    title: rec.name, body, wide: true,
    actions: [
      { label: '📥', kind: 'ghost', value: false, onClick: () => { downloadBlob(rec.blob, rec.name); return false; } },
      { label: T('close'), kind: 'primary', value: null },
    ],
  });
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteSelection() {
  const n = S.selected.size;
  if (!await confirm2(T('act_del'), T('del_confirm', n), { danger: true })) return;
  await DB.deleteFiles([...S.selected]);
  S.selected.clear();
  await refresh();
  toast(T('act_del') + ' ✓', 'ok');
  go('inbox');
}

async function exportSelection() {
  const files = S.files.filter((f) => S.selected.has(f.id));
  if (!files.length) return toast(T('inbox_sel_none'), 'err');
  const pm = progressModal(T('act_export'));
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    const rec = await DB.getFile(files[i].id);
    entries.push({ name: rec.relPath || rec.name, blob: rec.blob, lastModified: rec.lastModified });
    pm.set((i + 1) / files.length * 0.5);
  }
  const blob = await zipCreate(entries, { level: 'normal', onProgress: (p) => pm.set(0.5 + p * 0.5) });
  pm.close();
  downloadBlob(blob, `filebox-${new Date().toISOString().slice(0, 10)}.zip`);
}

async function vaultFromSelection() {
  const files = S.files.filter((f) => S.selected.has(f.id));
  if (!files.length) return toast(T('inbox_sel_none'), 'err');
  await newVaultDialog(files);
}

// ── vaults ──────────────────────────────────────────────────────────────────
async function newVaultDialog(files) {
  const nameIn = h('input', { class: 'input', value: `coffre-${new Date().toISOString().slice(0, 10)}` });
  const levelIn = h('select', { class: 'input' },
    h('option', { value: 'normal', selected: true }, T('comp_normal')),
    h('option', { value: 'max' }, T('comp_max')),
    h('option', { value: 'store' }, T('comp_store')));
  const passIn = h('input', { class: 'input', type: 'password', placeholder: T('vault_pass') });
  const encBox = h('input', { type: 'checkbox' });
  const encRow = h('label', { class: 'checkRow' }, encBox, h('span', {}, T('vault_encrypt')));
  passIn.style.display = 'none';
  encBox.onchange = () => { passIn.style.display = encBox.checked ? '' : 'none'; };

  const total = files.reduce((a, f) => a + f.size, 0);
  const body = h('div', {},
    h('div', { class: 'muted small' }, T('vault_files', files.length, fmtBytes(total))),
    h('label', { class: 'lbl' }, T('vault_name')), nameIn,
    h('label', { class: 'lbl' }, T('vault_compress')), levelIn,
    encRow, passIn);

  const ok = await modal({
    title: T('vault_new'), body,
    actions: [{ label: T('cancel'), kind: 'ghost', value: false }, { label: T('vault_create'), kind: 'primary', value: true }],
  });
  if (!ok) return;

  const password = encBox.checked ? passIn.value.trim() : '';
  if (encBox.checked && password.length < 4) return toast(T('vault_pass'), 'err');

  const pm = progressModal(T('vault_creating', 0));
  try {
    const entries = [];
    for (let i = 0; i < files.length; i++) {
      const rec = await DB.getFile(files[i].id);
      entries.push({ name: rec.relPath || rec.name, blob: rec.blob, lastModified: rec.lastModified });
      pm.set((i + 1) / files.length * 0.4);
    }
    const blob = await zipCreate(entries, {
      level: levelIn.value,
      password: password || null,
      cipher: 'gcm',
      onProgress: (p) => pm.set(0.4 + p * 0.6),
    });
    const saved = Math.max(0, total - blob.size);
    await DB.saveVault({
      id: uid(), name: nameIn.value.trim() || 'coffre', entries: entries.length,
      origSize: total, encrypted: !!password, level: levelIn.value, cipher: 'gcm',
    }, blob);
    pm.close();
    S.selected.clear();
    await refresh();
    toast(T('vault_done', fmtBytes(saved)), 'ok');
    go('vault');
  } catch (e) {
    pm.close();
    toast(T('err_generic', e.message), 'err');
  }
}

async function viewVault(view) {
  view.append(h('div', { class: 'pad' },
    h('div', { class: 'sectionHead' },
      h('h2', {}, T('vault_title')),
      h('button', { class: 'btn small primary', onclick: async () => {
        const files = S.files;
        if (!files.length) return toast(T('inbox_empty'), 'err');
        await newVaultDialog(files);
      } }, T('vault_new'))),
    S.vaults.length
      ? h('div', { class: 'list' }, ...S.vaults.map((v) => h('div', { class: 'row vaultRow' },
          h('div', { class: 'thumb ico' }, v.encrypted ? '🔐' : '🗜️'),
          h('div', { class: 'rowMain' },
            h('div', { class: 'rowName' }, v.name),
            h('div', { class: 'rowMeta' },
              `${v.entries} · ${fmtBytes(v.size)}`,
              v.origSize ? h('span', { class: 'savedTag' }, ' −' + fmtBytes(Math.max(0, v.origSize - v.size))) : null,
              ` · ${relTime(v.createdAt)}`)),
          h('div', { class: 'rowBtns' },
            h('button', { class: 'rowAct', title: T('vault_open'), onclick: () => openVault(v) }, '📂'),
            h('button', { class: 'rowAct', title: T('vault_export'), onclick: () => exportVault(v) }, '📥'),
            h('button', { class: 'rowAct', title: T('vault_integrity'), onclick: () => verifyVault(v) }, '🔍'),
            h('button', { class: 'rowAct danger', title: T('vault_delete'), onclick: () => removeVault(v) }, '🗑️')))))
      : h('div', { class: 'empty' }, h('div', { class: 'emptyIco' }, '🔒'), h('p', {}, T('vault_empty'))),
    h('div', { class: 'sectionHead' },
      h('button', { class: 'btn', onclick: importVault }, T('vault_import'))),
  ));
}

async function askVaultPassword(v) {
  if (!v.encrypted) return '';
  const p = await prompt2(T('vault_ask_pass', v.name), { password: true, ok: T('vault_open') });
  return p == null ? null : p;
}

async function openVault(v) {
  const rec = await DB.getVault(v.id);
  if (!rec?.blob) return toast(T('err_generic', 'missing blob'), 'err');
  const pass = await askVaultPassword(v);
  if (pass === null) return;
  const pm = progressModal(T('vault_open'));
  try {
    const list = await zipList(rec.blob);
    pm.close();
    const body = h('div', { class: 'entryList' }, ...list.map((e) =>
      h('div', { class: 'row slim' },
        h('div', { class: 'thumb ico small' }, iconOf(e.name)),
        h('div', { class: 'rowMain' },
          h('div', { class: 'rowName' }, e.name),
          h('div', { class: 'rowMeta' }, `${fmtBytes(e.size)} · ${e.encrypted ? '🔐' : ''}`)),
        h('button', { class: 'rowAct', onclick: async () => {
          const data = await zipExtractEntry(rec.blob, e, pass);
          downloadBlob(new Blob([data]), e.name.split('/').pop());
        } }, '📥'))));
    await modal({
      title: v.name, body, wide: true,
      actions: [
        { label: T('vault_extract'), kind: '', value: 'extract' },
        { label: T('close'), kind: 'primary', value: null },
      ],
    }).then(async (r) => { if (r === 'extract') await extractVault(v, pass); });
  } catch (e) {
    pm.close();
    toast(e.message.includes('password') ? T('vault_bad_pass') : T('err_generic', e.message), 'err');
  }
}

async function extractVault(v, pass) {
  const rec = await DB.getVault(v.id);
  if (pass === undefined) {
    pass = await askVaultPassword(v);
    if (pass === null) return;
  }
  const pm = progressModal(T('vault_extract'));
  try {
    const out = await zipExtractAll(rec.blob, pass, (p) => pm.set(p * 0.7));
    let n = 0;
    for (const o of out) {
      const name = o.name.split('/').pop();
      const file = new File([o.data], name, { lastModified: o.date?.getTime() || Date.now() });
      const r = await DB.addFile(file, { relPath: o.name });
      if (r.added) n++;
      pm.set(0.7 + (out.indexOf(o) + 1) / out.length * 0.3);
    }
    pm.close();
    await refresh();
    toast(T('vault_extracted', n), 'ok');
    go('inbox');
  } catch (e) {
    pm.close();
    toast(e.message.includes('password') ? T('vault_bad_pass') : T('err_generic', e.message), 'err');
  }
}

async function exportVault(v) {
  const rec = await DB.getVault(v.id);
  if (!rec?.blob) return;
  downloadBlob(rec.blob, `${v.name}.zip`);
}

async function verifyVault(v) {
  const rec = await DB.getVault(v.id);
  const pass = await askVaultPassword(v);
  if (pass === null) return;
  const pm = progressModal(T('vault_integrity'));
  const r = await zipVerify(rec.blob, pass || undefined);
  pm.close();
  if (r.ok) toast(T('vault_ok', r.entries), 'ok');
  else toast(T('vault_corrupt', r.error), 'err');
}

async function removeVault(v) {
  if (!await confirm2(T('vault_delete'), T('vault_del_confirm', v.name), { danger: true })) return;
  await DB.deleteVault(v.id);
  await refresh();
  go('vault');
}

async function importVault() {
  const inp = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const blob = f;
    let list;
    try { list = await zipList(blob); } catch (e) { return toast(T('err_generic', e.message), 'err'); }
    const encrypted = list.some((e) => e.encrypted);
    let pass = '';
    if (encrypted) {
      pass = await prompt2(T('vault_ask_pass', f.name), { password: true });
      if (pass === null) return;
    }
    const stored = await DB.writeBlob(uid(), blob);
    await DB.saveVault({
      id: stored.id ? stored.id : uid(), name: f.name.replace(/\.zip$/i, ''),
      entries: list.filter((e) => !e.name.endsWith('/')).length,
      origSize: list.reduce((a, e) => a + e.size, 0),
      encrypted, cipher: list[0]?.scheme === 'gcm' ? 'gcm' : 'wz', imported: true,
    }, blob);
    await refresh();
    toast(T('vault_import') + ' ✓', 'ok');
    go('vault');
  };
  document.body.append(inp);
  inp.click();
  setTimeout(() => inp.remove(), 60000);
}

// ── cleanup ─────────────────────────────────────────────────────────────────
function duplicateGroups() {
  const byFp = new Map();
  for (const f of S.files) {
    if (!byFp.has(f.fp)) byFp.set(f.fp, []);
    byFp.get(f.fp).push(f);
  }
  return [...byFp.values()].filter((g) => g.length > 1);
}

async function viewClean(view) {
  const groups = duplicateGroups();
  const wasted = groups.reduce((a, g) => a + g[0].size * (g.length - 1), 0);
  const BIG = 50 * 1024 * 1024;
  const big = S.files.filter((f) => f.size >= BIG).sort((a, b) => b.size - a.size).slice(0, 30);

  view.append(h('div', { class: 'pad' },
    h('h2', {}, T('clean_title')),
    groups.length || big.length
      ? h('div', { class: 'tip ok' }, T('clean_groups', groups.length, fmtBytes(wasted)))
      : h('div', { class: 'empty' }, h('div', { class: 'emptyIco' }, '✨'), h('p', {}, T('clean_none'))),

    groups.length ? h('section', { class: 'cleanSec' },
      h('h3', {}, T('clean_dup')),
      h('p', { class: 'muted small' }, T('clean_dup_hint')),
      ...groups.map((g) => {
        const keep = [...g].sort((a, b) => b.addedAt - a.addedAt)[0];
        return h('div', { class: 'dupGroup' },
          h('div', { class: 'dupHead' }, `${iconOf(keep.name)} ${fmtBytes(keep[0] ? keep[0].size : keep.size)} × ${g.length}`,
            h('button', { class: 'btn small', onclick: async () => {
              const ids = g.filter((f) => f.id !== keep.id).map((f) => f.id);
              await DB.deleteFiles(ids);
              await refresh(); toast(T('act_del') + ' ✓', 'ok'); go('clean');
            } }, T('clean_keep_newest'))),
          ...g.map((f) => h('div', { class: 'row slim' },
            h('div', { class: 'thumb ico small' }, f.id === keep.id ? '✅' : iconOf(f.name)),
            h('div', { class: 'rowMain' },
              h('div', { class: 'rowName' }, f.name),
              h('div', { class: 'rowMeta' }, relTime(f.addedAt))))));
      })) : null,

    big.length ? h('section', { class: 'cleanSec' },
      h('h3', {}, T('clean_big', fmtBytes(BIG))),
      h('div', { class: 'list' }, ...big.map((f) => h('div', { class: 'row slim' },
        h('div', { class: 'thumb ico small' }, iconOf(f.name)),
        h('div', { class: 'rowMain' },
          h('div', { class: 'rowName' }, f.name),
          h('div', { class: 'rowMeta' }, fmtBytes(f.size))),
        h('button', { class: 'rowAct', onclick: async () => { await newVaultDialog([f]); } }, '🔒'))))) : null,
  ));
}

// ── settings ────────────────────────────────────────────────────────────────
async function viewSet(view) {
  const u = await DB.usage();
  const persisted = await DB.isPersistent();
  const hasPin = !!(await DB.getMeta('pin'));

  const row = (label, right) => h('div', { class: 'setRow' }, h('div', {}, label), h('div', {}, right));

  view.append(h('div', { class: 'pad' },
    h('h2', {}, T('set_title')),

    h('section', { class: 'setSec' },
      h('h3', {}, T('set_storage')),
      row(T('set_used'), h('b', {}, fmtBytes(u.usage))),
      row(T('set_quota'), h('span', { class: 'muted' }, fmtBytes(u.quota))),
      row(T('set_persist'),
        h('button', { class: 'btn small ' + (persisted ? '' : 'primary'), onclick: async () => {
          if (persisted) return toast(T('set_persist_on'), 'ok');
          const ok = await DB.requestPersistent();
          toast(ok ? T('set_persist_granted') : T('set_persist_denied'), ok ? 'ok' : 'err');
          go('set');
        } }, persisted ? '✅' : '⚠️')),
      h('p', { class: 'muted small' }, persisted ? T('set_persist_on') : T('set_persist_off'))),

    h('section', { class: 'setSec' },
      h('h3', {}, T('set_pin')),
      row(T('change_pin'), h('button', { class: 'btn small', onclick: changePin }, hasPin ? '🔑' : '➕')),
      hasPin ? row(T('remove_pin'), h('button', { class: 'btn small danger', onclick: removePin }, '🗑️')) : null,
      h('p', { class: 'muted small' }, T('pin_hint'))),

    h('section', { class: 'setSec' },
      h('h3', {}, T('set_lang')),
      h('div', { class: 'chips' }, ...['darija', 'fr', 'en'].map((l) =>
        h('button', { class: 'chip' + (LANG === l ? ' on' : ''), onclick: () => { setLang(l); start(); } },
          { darija: '🇲🇦 Darija', fr: '🇫🇷 Français', en: '🇬🇧 English' }[l])))),

    h('section', { class: 'setSec' },
      h('h3', {}, T('backup_title')),
      h('p', { class: 'muted small' }, T('backup_why')),
      h('button', { class: 'btn', onclick: () => backupDialog() }, '⬆️ ' + T('backup_title'))),

    h('section', { class: 'setSec' },
      h('h3', {}, T('set_about')),
      row(T('set_version'), h('span', { class: 'muted' }, '1.0.0')),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirm2(T('set_wipe'), T('set_wipe_confirm'), { danger: true })) return;
        await DB.wipeAll();
        location.reload();
      } }, T('set_wipe'))),
  ));
}

async function changePin() {
  const a = await prompt2(T('set_pin'), { password: true });
  if (!a || a.length < 4) return;
  const b = await prompt2(T('set_pin2'), { password: true });
  if (a !== b) return toast(T('pin_bad'), 'err');
  const salt = uid();
  await DB.setMeta('pin', { salt, hash: await hashPin(a, salt) });
  toast(T('pin_changed'), 'ok');
  go('set');
}
async function removePin() {
  await DB.setMeta('pin', null);
  toast(T('remove_pin') + ' ✓', 'ok');
  go('set');
}

// ── backup (WebDAV / Filebox server) ────────────────────────────────────────
async function backupDialog() {
  const cfg = (await DB.getMeta('backup')) || {};
  const urlIn = h('input', { class: 'input', value: cfg.url || '', placeholder: 'https://nas.example/remote.php/dav/files/me/' });
  const userIn = h('input', { class: 'input', value: cfg.user || '', autocomplete: 'username' });
  const passIn = h('input', { class: 'input', type: 'password', value: cfg.pass || '', autocomplete: 'current-password' });
  const pathIn = h('input', { class: 'input', value: cfg.path || 'filebox', placeholder: 'filebox' });
  const vaultSel = h('select', { class: 'input' },
    ...S.vaults.map((v) => h('option', { value: v.id }, `${v.name} (${fmtBytes(v.size)})`)));

  const body = h('div', {},
    h('p', { class: 'muted small' }, T('backup_why')),
    h('label', { class: 'lbl' }, T('srv_url')), urlIn,
    h('label', { class: 'lbl' }, T('srv_user')), userIn,
    h('label', { class: 'lbl' }, T('srv_pass')), passIn,
    h('label', { class: 'lbl' }, T('srv_path')), pathIn,
    S.vaults.length ? h('div', {}, h('label', { class: 'lbl' }, T('vault_title')), vaultSel) : null);

  const r = await modal({
    title: T('backup_title'), body, wide: true,
    actions: [
      { label: T('bk_test'), kind: 'ghost', onClick: async (card) => {
          const ok = await webdavProbe(urlIn.value.trim(), userIn.value, passIn.value);
          toast(ok ? T('bk_test_ok') : T('bk_test_bad', ok === false ? 'HTTP ' + ok : '?'), ok ? 'ok' : 'err');
          return false;
        } },
      { label: T('cancel'), kind: 'ghost', value: null },
      { label: T('bk_push'), kind: 'primary', value: 'push' },
    ],
  });
  await DB.setMeta('backup', { url: urlIn.value.trim(), user: userIn.value, pass: passIn.value, path: pathIn.value.trim() });
  if (r !== 'push') return;
  const id = vaultSel.value || S.vaults[0]?.id;
  if (!id) return toast(T('vault_empty'), 'err');
  const v = await DB.getVault(id);
  const pm = progressModal(T('bk_pushing', 0));
  const ok = await webdavPut(
    `${urlIn.value.trim().replace(/\/$/, '')}/${pathIn.value.trim() || 'filebox'}/${v.name}.zip`,
    v.blob, userIn.value, passIn.value, (p) => pm.set(p));
  pm.close();
  toast(ok ? T('bk_pushed', v.name, urlIn.value.trim()) : T('bk_test_bad', 'HTTP ' + ok), ok ? 'ok' : 'err');
}

function basicAuth(user, pass) {
  if (!user) return {};
  return { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${user}:${pass || ''}`))) };
}
async function webdavProbe(url, user, pass) {
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/', { method: 'PROPFIND', headers: { ...basicAuth(user, pass), Depth: '0' } });
    return r.ok ? true : r.status;
  } catch { return false; }
}
async function webdavPut(url, blob, user, pass, onProgress) {
  try {
    // make sure the parent collection exists
    const parts = url.split('/');
    const file = parts.pop();
    let base = parts.join('/');
    const dirUrl = base;
    await fetch(dirUrl + '/', { method: 'MKCOL', headers: basicAuth(user, pass) }).catch(() => {});
    const r = await fetch(dirUrl + '/' + file, {
      method: 'PUT',
      headers: { ...basicAuth(user, pass), 'Content-Type': 'application/zip' },
      body: blob,
      duplex: 'half',
    });
    return r.ok || r.status === 201 || r.status === 204 ? true : r.status;
  } catch { return false; }
}

// ── install ─────────────────────────────────────────────────────────────────
async function doInstall() {
  if (!S.installEvt) return toast(T('install_hint'));
  S.installEvt.prompt();
  const r = await S.installEvt.userChoice;
  if (r.outcome === 'accepted') toast('✅', 'ok');
  S.installEvt = null;
  start();
}

// ── drag & drop ─────────────────────────────────────────────────────────────
function wireDrop() {
  const stop = (e) => { e.preventDefault(); };
  ['dragenter', 'dragover', 'drop'].forEach((ev) => window.addEventListener(ev, stop));
  window.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const pm = progressModal(T('importing', 0));
    let added = 0, dup = 0;
    for (let i = 0; i < files.length; i++) {
      const r = await DB.addFile(files[i]);
      r.added ? added++ : dup++;
      pm.set((i + 1) / files.length);
    }
    pm.close();
    await refresh();
    toast(dup ? T('imported_dup', added, dup) : T('imported', added), 'ok');
    go(S.tab);
  });
}

// ── boot ────────────────────────────────────────────────────────────────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installEvt = e;
  if ($('#app .top')) start();
});

if (!window.indexedDB) {
  $('#app').innerHTML = `<div class="pad"><h2>⚠️</h2><p>${T('no_fs')}</p></div>`;
} else {
  wireDrop();
  lockScreen();
}
