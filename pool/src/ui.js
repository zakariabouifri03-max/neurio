// ── ui.js — tiny DOM layer (no framework, no dependencies) ──────────────────
export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
export const show = (n, on = true) => { if (n) n.classList[on ? 'remove' : 'add']('hidden'); return on; };
export const screen = (n, on = true) => { if (n) n.classList[on ? 'add' : 'remove']('show'); return on; };
export const txt = (id, v) => { const n = $(id); if (n) n.textContent = v; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** frame-rate independent damping factor */
export const damp = (t, dt) => 1 - Math.pow(1 - t, dt * 60);

// ── toasts ──────────────────────────────────────────────────────────────────
export function toast(msg, kind = '', ms = 2600) {
  const host = $('toasts');
  if (!host) return;
  const n = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
  host.appendChild(n);
  setTimeout(() => { n.classList.add('gone'); setTimeout(() => n.remove(), 400); }, ms);
  while (host.children.length > 4) host.firstChild.remove();
}

// ── notifications (top-right stack, richer than a toast) ────────────────────
export function notify(title, body, icon = '🎱', buttons = []) {
  const host = $('notifs');
  if (!host) return;
  const n = el('div', 'notif',
    `<div class="nh"><div class="ava">${icon}</div><b>${title}</b></div>` +
    (body ? `<div class="nb">${body}</div>` : '') +
    (buttons.length ? `<div class="nbtns"></div>` : ''));
  if (buttons.length) {
    const row = n.querySelector('.nbtns');
    for (const b of buttons) {
      const btn = el('button', 'btn ' + (b.cls || 'ghost'), b.label);
      btn.addEventListener('click', (e) => { e.stopPropagation(); n.remove(); b.onClick && b.onClick(); });
      row.appendChild(btn);
    }
  } else {
    n.addEventListener('click', () => n.remove());
  }
  host.appendChild(n);
  setTimeout(() => { n.classList.add('gone'); setTimeout(() => n.remove(), 450); }, buttons.length ? 12000 : 6000);
  while (host.children.length > 5) host.firstChild.remove();
}

// ── modal ───────────────────────────────────────────────────────────────────
let modalOpen = false;
export function modal(title, bodyHtml, buttons = []) {
  const wrap = $('modalWrap');
  if (!wrap) return Promise.resolve(null);
  txt('modalTitle', title);
  $('modalBody').innerHTML = bodyHtml;
  const btns = $('modalBtns');
  btns.innerHTML = '';
  modalOpen = true;
  show(wrap, true);
  return new Promise((resolve) => {
    const close = (v) => { modalOpen = false; show(wrap, false); resolve(v); };
    if (!buttons.length) buttons = [{ label: 'OK', value: true, cls: 'primary' }];
    for (const b of buttons) {
      const n = el('button', 'btn ' + (b.cls || 'ghost'), b.label);
      n.addEventListener('click', () => close(b.value));
      btns.appendChild(n);
    }
    $('modalScrim').onclick = () => close(null);
  });
}
export const isModalOpen = () => modalOpen;

// ── slide-in panel ──────────────────────────────────────────────────────────
let panelOpen = null;
export function openPanel(title, buildFn) {
  const wrap = $('panelWrap');
  txt('panelTitle', title);
  const body = $('panelBody');
  body.innerHTML = '';
  wrap.classList.add('show');
  panelOpen = title;
  buildFn(body);
  body.scrollTop = 0;
}
export function closePanel() {
  $('panelWrap').classList.remove('show');
  panelOpen = null;
}
export const currentPanel = () => panelOpen;

// ── shared markup builders ──────────────────────────────────────────────────
export function kv(k, v) { return `<div class="kv"><span>${k}</span><b>${v}</b></div>`; }
export function bar(pct, label) {
  return `<div class="bar"><div style="width:${clamp(pct, 0, 100).toFixed(1)}%"></div></div>${label ? `<div class="hint">${label}</div>` : ''}`;
}
export function seg(items, active, onPick) {
  const n = el('div', 'seg');
  for (const it of items) {
    const b = el('button', it.id === active ? 'on' : '', it.label);
    b.addEventListener('click', () => onPick(it.id));
    n.appendChild(b);
  }
  return n;
}
export function setRow(label, control, hint) {
  const r = el('div', 'setRow', `<div class="lbl"><b>${label}</b>${hint ? `<i>${hint}</i>` : ''}</div>`);
  r.appendChild(control);
  return r;
}
export function toggle(on, onChange) {
  const n = el('button', 'toggle' + (on ? ' on' : ''), '<span></span>');
  n.addEventListener('click', () => { on = !on; n.classList.toggle('on', on); onChange(on); });
  return n;
}
export function range(min, max, step, value, onInput) {
  const n = el('input');
  n.type = 'range'; n.min = min; n.max = max; n.step = step; n.value = value;
  n.addEventListener('input', () => onInput(parseFloat(n.value)));
  return n;
}

/**
 * One ball chip for the score-bar trays. Solids are flat colour, stripes are a
 * white ball with a colour band across the middle, exactly like the real thing.
 * `.balls i.out` (already in the stylesheet) dims the ones that are down.
 */
export function ballChip(n, out = false) {
  const colors = ['', '#f2c200', '#1f5fd0', '#e0342c', '#5b2a8c', '#f07c14', '#137a3c', '#8c2018',
    '#131313', '#f2c200', '#1f5fd0', '#e0342c', '#5b2a8c', '#f07c14', '#137a3c', '#8c2018'];
  const c = colors[n] || '#f7f5ef';
  const stripe = n >= 9 && n <= 15;
  const bg = stripe
    ? `linear-gradient(180deg,#f8f6f0 0 24%,${c} 24% 76%,#f8f6f0 76% 100%)`
    : c;
  return `<i class="${out ? 'out' : ''}" title="${n}" style="background:${bg}"></i>`;
}

/** a full tray of the 7 balls of one group, dimmed as they are potted */
export function ballTray(group, potted) {
  const nums = group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
  if (!nums.length) return `<i class="out" style="background:#131313"></i>`.repeat(1);
  return nums.map((n) => ballChip(n, potted.includes(n))).join('');
}
