// Shared UI helpers: modals, toasts, tooltips, context menus, form controls.
import { h, $, clamp } from '../core/util.js';
import { icon } from './icons.js';

export function toast(msg, kind = 'info', ms = 3200) {
  let host = $('#toasts'); if (!host) { host = h('div#toasts'); document.body.append(host); }
  const t = h('div.toast.' + kind, { html: '' }, msg);
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); }, ms);
  return t;
}

let modalStack = [];
export function modal({ title, body, buttons = [{ label: 'OK', primary: true }], width = 460, onClose, closable = true, cls = '' }) {
  return new Promise((resolve) => {
    const ov = h('div.modal-ov');
    const dlg = h('div.modal.' + cls, { style: { width: width + 'px' }, role: 'dialog', 'aria-modal': 'true' });
    const close = (v) => { ov.classList.remove('in'); setTimeout(() => ov.remove(), 150); modalStack = modalStack.filter((m) => m !== ov); document.removeEventListener('keydown', key, true); onClose && onClose(v); resolve(v); };
    const key = (e) => { if (modalStack[modalStack.length - 1] !== ov) return; if (e.key === 'Escape' && closable) { e.stopPropagation(); close(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { const pb = buttons.find((b) => b.primary); if (pb) { e.preventDefault(); e.stopPropagation(); pb.onClick ? pb.onClick(close) : close(pb.value ?? pb.label); } } };
    const head = h('div.modal-h', h('span', title || ''), closable && h('button.icon-btn', { tip: 'Close', on: { click: () => close(null) }, html: icon('x', 16) }));
    const foot = h('div.modal-f', buttons.map((b) => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { on: { click: () => (b.onClick ? b.onClick(close) : close(b.value ?? b.label)) } }, b.label)));
    dlg.append(head, h('div.modal-b', body), buttons.length ? foot : null);
    ov.append(dlg); document.body.append(ov); modalStack.push(ov);
    document.addEventListener('keydown', key, true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && closable) close(null); });
    requestAnimationFrame(() => { ov.classList.add('in'); const f = dlg.querySelector('input,select,textarea'); if (f) f.focus(); });
    ov.close = close;
  });
}
export const modalOpen = () => modalStack.length > 0;
export async function askText(title, label, value = '', opts = {}) {
  const inp = h('input.txt', { type: 'text', value, placeholder: opts.placeholder || '' });
  const r = await modal({ title, width: 420, body: h('div.form', h('label', label), inp), buttons: [{ label: 'Cancel', value: null }, { label: opts.ok || 'OK', primary: true, onClick: (c) => c(inp.value) }] });
  return r === null ? null : r;
}
export async function confirmBox(title, message, ok = 'OK', danger = false) {
  const r = await modal({ title, width: 420, body: h('p.msg', message), buttons: [{ label: 'Cancel', value: false }, { label: ok, primary: !danger, danger, onClick: (c) => c(true) }] });
  return r === true;
}

// ── context menu ──
let ctxEl = null;
export function closeMenus() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
export function contextMenu(items, x, y) {
  closeMenus();
  const m = h('div.menu.ctx');
  buildMenuItems(m, items);
  document.body.append(m); ctxEl = m;
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 4, innerWidth - r.width - 4) + 'px'; m.style.top = clamp(y, 4, innerHeight - r.height - 4) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function f(e) { if (!m.contains(e.target)) { closeMenus(); } document.removeEventListener('mousedown', f); }, { once: false }), 0);
}
export function buildMenuItems(container, items, onPick) {
  for (const it of items) {
    if (it === '-' || it.sep) { container.append(h('div.msep')); continue; }
    const en = it.enabled === undefined ? true : typeof it.enabled === 'function' ? it.enabled() : it.enabled;
    const chk = it.checked ? (typeof it.checked === 'function' ? it.checked() : it.checked) : false;
    const el = h('div.mi' + (en ? '' : '.disabled'), { on: { click: (e) => { if (!en) return; if (it.sub) return; closeMenus(); onPick && onPick(); it.run && it.run(); } } },
      h('span.ck', chk ? '✓' : ''), h('span.lb', it.label), it.shortcut ? h('span.sc', it.shortcut) : h('span.sc'), it.sub ? h('span.arrow', '▸') : null);
    if (it.sub) {
      const sub = h('div.menu.sub'); buildMenuItems(sub, it.sub, onPick); el.append(sub);
    }
    container.append(el);
  }
}

// ── tooltips (any element with data-tip) ──
let tipEl = null, tipTimer = null;
export function initTooltips() {
  tipEl = h('div#tooltip'); document.body.append(tipEl);
  const hide = () => { clearTimeout(tipTimer); tipEl.classList.remove('show'); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { hide(); return; }
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      tipEl.innerHTML = ''; const [a, b] = el.dataset.tip.split('||');
      tipEl.append(h('b', a)); if (b) tipEl.append(h('span', b));
      const r = el.getBoundingClientRect(); tipEl.classList.add('show');
      const tr = tipEl.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 8;
      if (y + tr.height > innerHeight - 4) y = r.top - tr.height - 8;
      if (r.left < 70 && r.width < 60 && r.top > 60) { x = r.right + 8; y = r.top + r.height / 2 - tr.height / 2; }
      tipEl.style.left = clamp(x, 4, innerWidth - tr.width - 4) + 'px'; tipEl.style.top = clamp(y, 4, innerHeight - tr.height - 4) + 'px';
    }, 450);
  });
  document.addEventListener('mousedown', hide, true); document.addEventListener('keydown', hide, true); document.addEventListener('wheel', hide, { passive: true });
}

// ── form controls ──
export function slider({ label, min, max, step = 1, value, onInput, onChange, fmt, tip }) {
  const out = h('span.val');
  const inp = h('input', { type: 'range', min, max, step, value });
  const num = h('input.num', { type: 'number', min, max, step, value });
  const upd = (v) => { out.textContent = fmt ? fmt(+v) : v; };
  inp.addEventListener('input', () => { num.value = inp.value; onInput && onInput(+inp.value); });
  inp.addEventListener('change', () => { onChange && onChange(+inp.value); });
  num.addEventListener('change', () => { const v = clamp(parseFloat(num.value) || 0, +min, +max); num.value = v; inp.value = v; onInput && onInput(v); onChange && onChange(v); });
  const row = h('div.row.slider', { tip }, h('label', label), inp, num);
  row.set = (v) => { inp.value = v; num.value = +(+v).toFixed(3); };
  return row;
}
export function numField(label, value, onChange, { step = 1, min, max, tip, width } = {}) {
  const inp = h('input.num', { type: 'number', step, value: +(+value).toFixed(3), min, max, style: width ? { width } : null });
  inp.addEventListener('change', () => { let v = parseFloat(inp.value); if (!Number.isFinite(v)) return; if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v); inp.value = v; onChange(v); });
  inp.addEventListener('keydown', (e) => e.stopPropagation());
  const row = h('div.row', { tip }, h('label', label), inp); row.input = inp; return row;
}
export function selectField(label, options, value, onChange, tip) {
  const sel = h('select', options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  sel.addEventListener('change', () => onChange(sel.value));
  const row = h('div.row', { tip }, h('label', label), sel); row.select = sel; return row;
}
export function checkField(label, value, onChange, tip) {
  const c = h('input', { type: 'checkbox', checked: !!value });
  c.addEventListener('change', () => onChange(c.checked));
  return h('label.row.check', { tip }, c, h('span', label));
}
export function colorField(label, value, onChange, tip) {
  const c = h('input', { type: 'color', value });
  c.addEventListener('input', () => onChange(c.value));
  return h('div.row', { tip }, h('label', label), c);
}
export function button(label, onClick, { tip, cls = '', ic } = {}) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { tip, on: { click: onClick } }, ic ? h('span.bic', { html: icon(ic, 15) }) : null, label);
}
export function iconButton(ic, tip, onClick, cls = '') {
  const b = h('button.icon-btn' + (cls ? '.' + cls : ''), { tip, on: { click: onClick }, html: icon(ic, 17) }); return b;
}
export function section(title, ...kids) { return h('div.sec', h('div.sec-h', title), h('div.sec-b', kids)); }
export function progressModal(title) {
  const bar = h('div.bar', h('i')); const msg = h('div.pmsg', 'Starting…'); let cancelCb = null; let closeFn;
  const p = modal({ title, width: 420, closable: false, body: h('div', msg, bar), buttons: [{ label: 'Cancel', onClick: () => { cancelCb && cancelCb(); } }] });
  setTimeout(() => { closeFn = document.querySelector('.modal-ov:last-child'); }, 20);
  const api = {
    set(frac, text) { bar.firstChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; if (text) msg.textContent = text; },
    onCancel(f) { cancelCb = f; },
    close() { const ov = [...document.querySelectorAll('.modal-ov')].pop(); if (ov && ov.close) ov.close(null); },
  };
  return api;
}
