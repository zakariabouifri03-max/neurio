/* ==========================================================================
   ATLAS INK — storefront logic
   Catalogue rendering · product preview · cart · demo checkout · file export
   ========================================================================== */

import { PRODUCTS, FREE_PRODUCT, BUNDLE, COLLECTIONS, TEE_COLORS, getItem, getCollection } from './data.js';
import { DESIGNS } from './designs.js';
import { makeT } from './i18n.js';

/* ── tiny helpers ───────────────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const STORE_KEY = 'atlasink.store.v1';
const ORDER_KEY = 'atlasink.order.v1';
const PROMOS = { INK20: 0.2, WELCOME10: 0.1 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LTR_NUM = new Intl.NumberFormat('en-US');

const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const money = (n) => {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? `$${num}` : `$${num.toFixed(2)}`;
};

const esc = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatInt = (n) => LTR_NUM.format(Number(n) || 0);

const formatDate = (iso) => {
  try {
    return new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-MA' : 'en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).format(new Date(iso));
  } catch {
    return '';
  }
};

/* ── persisted state ────────────────────────────────────────────── */
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { saved = {}; }

const detectedLang = (() => {
  if (saved.lang === 'ar' || saved.lang === 'en') return saved.lang;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  return langs.some((l) => String(l).toLowerCase().startsWith('ar')) ? 'ar' : 'en';
})();

const state = {
  lang: detectedLang,
  cart: [],
  wishlist: [],
  promo: null,
  filter: 'all',
  sort: 'featured',
  q: ''
};

const cartIsValid = (line) => line && getItem(line.id) && line.id !== 'welcome' && line.id !== 'free';
if (Array.isArray(saved.cart)) {
  state.cart = saved.cart
    .filter(cartIsValid)
    .map((l) => ({ id: l.id, qty: Math.min(9, Math.max(1, parseInt(l.qty, 10) || 1)) }));
}
if (Array.isArray(saved.wishlist)) {
  state.wishlist = [...new Set(saved.wishlist.filter((id) => getItem(id) && id !== 'vault' && id !== 'welcome'))];
}
if (typeof saved.promo === 'string' && PROMOS[saved.promo]) state.promo = saved.promo;

let translator = makeT(state.lang);
const t = (key, vars) => translator(key, vars);

const persist = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      lang: state.lang,
      cart: state.cart,
      wishlist: state.wishlist,
      promo: state.promo
    }));
  } catch { /* private mode — state still works for this visit */ }
};

const saveOrder = (order) => {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
};
const readOrder = () => {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/* ── t-shirt mockups ───────────────────────────────────────────── */
const TEE_PATH = 'M300 58C332 58 356 66 373 78L449 108C472 118 489 132 501 153L550 236C559 252 554 269 540 277L489 303C474 310 458 305 448 292L421 259C433 340 436 486 432 606C431 628 415 642 393 642L207 642C185 642 170 628 169 606C165 486 167 340 179 259L152 292C142 305 126 310 111 303L60 277C46 269 41 252 50 236L99 153C111 132 128 118 151 108L227 78C244 66 268 58 300 58Z';
let uidSeq = 0;

function teeSvg(uid) {
  return `
  <svg class="tee-svg" viewBox="0 0 600 700" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="teeclip-${uid}"><path d="${TEE_PATH}"/></clipPath>
      <linearGradient id="teesheen-${uid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".2"/>
        <stop offset=".42" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset=".78" stop-color="#000000" stop-opacity=".06"/>
        <stop offset="1" stop-color="#000000" stop-opacity=".16"/>
      </linearGradient>
      <radialGradient id="teeglow-${uid}" cx=".5" cy=".22" r=".65">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".16"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <filter id="teesoft-${uid}" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="15"/>
      </filter>
      <filter id="teegrain-${uid}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" stitchTiles="stitch" result="noise"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .65 .65 .65 0 0"/>
      </filter>
    </defs>
    <ellipse cx="300" cy="664" rx="190" ry="15" fill="#14120e" opacity=".16"/>
    <path d="${TEE_PATH}" fill="var(--tee, #171714)" stroke="rgba(20, 18, 14, .34)" stroke-width="2"/>
    <g clip-path="url(#teeclip-${uid})">
      <rect x="30" y="30" width="540" height="650" fill="url(#teesheen-${uid})"/>
      <rect x="150" y="40" width="300" height="260" fill="url(#teeglow-${uid})"/>
      <path d="M252 145C238 300 245 470 258 650" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="58" filter="url(#teesoft-${uid})"/>
      <path d="M362 120C374 310 369 500 355 650" fill="none" stroke="#000" stroke-opacity=".055" stroke-width="44" filter="url(#teesoft-${uid})"/>
      <path d="M196 290C212 420 211 548 205 645" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="26" filter="url(#teesoft-${uid})"/>
      <path d="M332 300C328 430 330 550 334 650" fill="none" stroke="#fff" stroke-opacity=".05" stroke-width="20" filter="url(#teesoft-${uid})"/>
      <rect x="0" y="0" width="600" height="700" filter="url(#teegrain-${uid})" opacity=".14"/>
    </g>
    <ellipse cx="300" cy="88" rx="62" ry="24" fill="#000" opacity=".2"/>
    <path d="M232 66C258 120 342 120 368 66" fill="none" stroke="rgba(0, 0, 0, .3)" stroke-width="17" stroke-linecap="round"/>
    <path d="M237 68C261 112 339 112 363 68" fill="none" stroke="rgba(255, 255, 255, .16)" stroke-width="6" stroke-linecap="round"/>
    <path d="M164 86C190 106 208 134 213 168" fill="none" stroke="rgba(0, 0, 0, .12)" stroke-width="2"/>
    <path d="M436 86C410 106 392 134 387 168" fill="none" stroke="rgba(0, 0, 0, .12)" stroke-width="2"/>
    <path d="M206 622H394" fill="none" stroke="rgba(0, 0, 0, .11)" stroke-width="1.4" stroke-dasharray="4 5"/>
    <path d="M72 196L130 254" fill="none" stroke="rgba(0, 0, 0, .1)" stroke-width="1.4" stroke-dasharray="4 5"/>
    <path d="M528 196L470 254" fill="none" stroke="rgba(0, 0, 0, .1)" stroke-width="1.4" stroke-dasharray="4 5"/>
  </svg>`;
}

function designSvg(item, uid) {
  const draw = DESIGNS[item.art];
  return draw ? draw(uid) : '';
}

const hasDesign = (id) => {
  const item = getItem(id);
  return Boolean(item && DESIGNS[item.art]);
};
const PRINTABLE = PRODUCTS.filter((p) => hasDesign(p.id));

function stageHTML(item, uid, teeKey) {
  const color = TEE_COLORS[teeKey || item.tee]?.hex || '#171714';
  return `
    <div class="tee-stage" style="--pw:${item.printWidth || 55}%;--tee:${color}">
      ${teeSvg(uid)}
      <div class="tee-print">${designSvg(item, uid)}</div>
    </div>`;
}

function setMockVars(el, item, teeKey) {
  if (!el) return;
  const color = TEE_COLORS[teeKey || item.tee]?.hex || '#171714';
  el.style.setProperty('--bg', item.bg);
  el.style.setProperty('--tee', color);
}

const collectionLabel = (id) => {
  if (id === 'sample') return t('coll.sample');
  if (id === 'bundle') return t('coll.bundle');
  const c = getCollection(id);
  return c ? c.label[state.lang] : id;
};

const nameOf = (item) => item.name[state.lang] || item.name.en;
const descOf = (item) => item.desc[state.lang] || item.desc.en;

/* ── header + catalogue ───────────────────────────────────────── */
const cartQty = () => state.cart.reduce((sum, line) => sum + line.qty, 0);

function updateHeader() {
  const count = cartQty();
  const cartCount = $('#cartCount');
  const drawerCount = $('#cartDrawerCount');
  if (cartCount) cartCount.textContent = count;
  if (drawerCount) drawerCount.textContent = count;
  const wishCount = $('#wishCount');
  if (wishCount) {
    wishCount.textContent = state.wishlist.length;
    wishCount.hidden = state.wishlist.length === 0;
  }
}

function chipCounts(id) {
  if (id === 'all') return PRODUCTS.length;
  if (id === 'best') return PRODUCTS.filter((p) => p.badge === 'best').length;
  if (id === 'saved') return state.wishlist.length;
  return PRODUCTS.filter((p) => p.collection === id).length;
}

function renderChips() {
  const holder = $('#filterChips');
  if (!holder) return;
  const chips = [...COLLECTIONS, { id: 'saved', label: { en: 'Saved', ar: 'المحفوظة' } }];
  holder.innerHTML = chips.map((c) => {
    const active = state.filter === c.id;
    return `<button class="chip${c.id === 'saved' ? ' chip--saved' : ''}${active ? ' is-on' : ''}"
      type="button" data-filter="${c.id}" aria-pressed="${active}">
      ${c.id === 'saved' ? icon('heart') : ''}${esc(c.id === 'saved' ? t('filter.saved') : (c.label[state.lang] || c.label.en))}
      <span>${chipCounts(c.id)}</span>
    </button>`;
  }).join('');
}

function matchesQuery(p, q) {
  if (!q) return true;
  const c = getCollection(p.collection);
  const haystack = [
    p.name.en, p.name.ar, p.desc.en, p.desc.ar, p.tagline?.en, p.tagline?.ar,
    p.tags.join(' '), p.collection, c?.label.en, c?.label.ar
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function filteredProducts() {
  let list = PRODUCTS.slice();
  if (state.filter === 'saved') {
    list = list.filter((p) => state.wishlist.includes(p.id));
  } else if (state.filter === 'best') {
    list = list.filter((p) => p.badge === 'best');
  } else if (state.filter !== 'all') {
    list = list.filter((p) => p.collection === state.filter);
  }
  const q = state.q.trim().toLowerCase();
  if (q) list = list.filter((p) => matchesQuery(p, q));
  switch (state.sort) {
    case 'price-asc': list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'rating': list.sort((a, b) => (b.rating - a.rating) || (b.reviews - a.reviews)); break;
    case 'newest': list.sort((a, b) => String(b.date).localeCompare(String(a.date))); break;
    default: break;
  }
  return list;
}

function resultsText(n) {
  const total = PRODUCTS.length;
  if (n === total) return t('shop.results', { n });
  if (n === 1) return t('shop.resultsOneFiltered', { total });
  return t('shop.resultsFiltered', { n, total });
}

function cardHTML(p, index) {
  const uid = `${p.id}-c${++uidSeq}`;
  const wished = state.wishlist.includes(p.id);
  const badge = p.badge ? `<span class="badge badge--${p.badge}">${esc(t(`badge.${p.badge}`))}</span>` : '';
  const compare = p.compareAt ? `<s>${money(p.compareAt)}</s>` : '';
  return `
  <article class="card" style="--i:${index}" data-card="${p.id}">
    <div class="mock" style="--bg:${p.bg};--tee:${TEE_COLORS[p.tee]?.hex || '#171714'}">
      ${badge}
      <button class="mock__open" type="button" data-open="${p.id}"
        aria-label="${esc(t('card.viewAria', { name: nameOf(p) }))}"></button>
      <button class="wish-btn${wished ? ' is-active' : ''}" type="button" data-wish="${p.id}"
        aria-pressed="${wished}" aria-label="${esc(t(wished ? 'card.unsaveAria' : 'card.saveAria', { name: nameOf(p) }))}">
        ${icon('heart')}
      </button>
      ${stageHTML(p, uid)}
      <span class="mock__no">Nº ${String(index + 1).padStart(2, '0')}</span>
      <span class="mock__files">SVG · PNG · DTF</span>
      <button class="quick-add" type="button" data-add="${p.id}">
        <span>${esc(t('card.quickAdd'))}</span><b>${money(p.price)}</b>
      </button>
    </div>
    <div class="card__body">
      <div class="card__top">
        <span>${esc(collectionLabel(p.collection))}</span>
        <span class="card__rating">${icon('star', 'ic--fill')} ${p.rating.toFixed(1)}</span>
      </div>
      <h3 class="card__name">
        <button type="button" data-open="${p.id}">${esc(nameOf(p))}</button>
      </h3>
      <div class="card__bottom">
        <span class="card__price">${money(p.price)} ${compare}</span>
        <span class="card__formats">${esc(t('card.files'))}</span>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('#productGrid');
  const empty = $('#emptyState');
  if (!grid) return;
  const list = filteredProducts();
  grid.innerHTML = list.map(cardHTML).join('');
  grid.hidden = list.length === 0;
  if (empty) empty.hidden = list.length > 0;

  const label = $('#resultsLabel');
  if (label) label.textContent = resultsText(list.length);

  const reset = $('#resetFilters');
  if (reset) reset.hidden = !(state.filter !== 'all' || state.q || state.sort !== 'featured');
  const clear = $('#searchClear');
  if (clear) clear.hidden = !state.q;
}

/* ── hero / vault / free sample ───────────────────────────────── */
function renderHero() {
  const front = $('.float-card--front');
  const frontMock = $('#heroFrontMock');
  const backMock = $('#heroBackMock');
  const back = $('.float-card--back');
  const frontItem = getItem('sahara');
  const backItem = getItem('atlas');

  if (frontMock && frontItem) {
    setMockVars(frontMock, frontItem);
    frontMock.innerHTML = stageHTML(frontItem, 'hero-front');
  }
  if (backMock && backItem) {
    setMockVars(backMock, backItem);
    backMock.innerHTML = stageHTML(backItem, 'hero-back');
  }
  if (front && frontItem) {
    front.setAttribute('aria-label', t('card.viewAria', { name: nameOf(frontItem) }));
    const n = front.querySelector('.float-card__name');
    const price = front.querySelector('.float-card__price');
    if (n) n.textContent = nameOf(frontItem);
    if (price) price.textContent = money(frontItem.price);
  }
  const filetag = $('.hero__filetag');
  if (filetag) filetag.textContent = t('hero.files');
  if (back && backItem) {
    const foot = back.querySelector('.float-card__foot');
    if (foot) foot.innerHTML = `<span>${esc(nameOf(backItem))}</span><span class="mono">${money(backItem.price)}</span>`;
  }
}

function renderVault() {
  const stack = $('#vaultStack');
  if (!stack) return;
  const picks = ['sahara', 'casablanca', 'love-bites'].map(getItem).filter(Boolean);
  const classes = ['a', 'b', 'c'];
  stack.innerHTML = picks.map((p, i) => {
    const uid = `vault-${i}-${++uidSeq}`;
    return `<div class="vault-card vault-card--${classes[i]}">
      <div class="vault-card__mock" style="--bg:${p.bg};--tee:${TEE_COLORS[p.tee]?.hex || '#171714'}">
        ${stageHTML(p, uid)}
      </div>
      <div class="vault-card__foot"><span>${esc(nameOf(p))}</span><span>${String(i + 1).padStart(2, '0')} / 12</span></div>
    </div>`;
  }).join('');
}

function renderFreebie() {
  const holder = $('#freebieMock');
  if (!holder) return;
  setMockVars(holder, FREE_PRODUCT);
  holder.innerHTML = `
    <div class="mock" style="--bg:${FREE_PRODUCT.bg};--tee:${TEE_COLORS[FREE_PRODUCT.tee]?.hex || '#171714'}">
      <span class="badge badge--free">${esc(t('badge.free'))}</span>
      ${stageHTML(FREE_PRODUCT, `freebie-${++uidSeq}`)}
    </div>`;
}

/* ── product modal ─────────────────────────────────────────────── */
const pm = { id: null, view: 'tee', color: null, qty: 1 };
let pmUid = 0;

function renderProductModal() {
  const p = getItem(pm.id);
  const panel = $('#pmPanel');
  if (!p || !panel) return;
  if (!pm.color) pm.color = p.tee;
  const files = [
    ['SVG', t('file.svgD')],
    ['PNG', t('file.pngD')],
    ['DTF', t('file.dtfD')],
    ['EPS', t('file.epsD')]
  ];
  const swatches = p.colors.map((key) => {
    const c = TEE_COLORS[key];
    return `<button class="swatch${pm.color === key ? ' is-on' : ''}" type="button"
      data-color="${key}" style="background:${c.hex}" title="${esc(c.name[state.lang])}"
      aria-label="${esc(c.name[state.lang])}" aria-pressed="${pm.color === key}"></button>`;
  }).join('');
  const stage = pm.view === 'flat'
    ? `<div class="pm__flat">${designSvg(p, `pmflat-${++pmUid}`)}</div><span class="pm__flat-tag">CMYK · 300 DPI</span>`
    : stageHTML(p, `pmtee-${++pmUid}`, pm.color);
  const compare = p.compareAt ? `<s>${money(p.compareAt)}</s>` : '';
  const wished = state.wishlist.includes(p.id);

  panel.innerHTML = `
  <div class="pm__grid">
    <div class="pm__visual">
      <div class="pm__toolbar">
        <span class="pm__toolbar-label">${esc(t('modal.preview'))}</span>
        <div class="seg" role="group" aria-label="${esc(t('modal.preview'))}">
          <button type="button" data-view="tee" class="${pm.view === 'tee' ? 'is-on' : ''}">${esc(t('modal.onTee'))}</button>
          <button type="button" data-view="flat" class="${pm.view === 'flat' ? 'is-on' : ''}">${esc(t('modal.flat'))}</button>
        </div>
      </div>
      <div class="pm__stage${pm.view === 'flat' ? ' pm__stage--flat' : ''}" style="--bg:${p.bg};--tee:${TEE_COLORS[pm.color]?.hex || '#171714'}">
        ${stage}
      </div>
      <div class="pm__colors">
        <span class="pm__colors-label">${esc(t('modal.previewOn'))}</span>
        <div class="swatches">${swatches}</div>
      </div>
      <p class="pm__preview-note">${esc(t('modal.previewNote'))}</p>
    </div>

    <div class="pm__info">
      <p class="pm__coll">${esc(collectionLabel(p.collection))}</p>
      <h2 class="pm__title" id="pmTitle">${esc(nameOf(p))}</h2>
      <div class="pm__meta">
        <span class="stars" aria-hidden="true">★★★★★</span>
        <span>${p.rating.toFixed(1)}</span>
        <span class="pm__dot"></span>
        <span>${esc(t('modal.reviews', { n: formatInt(p.reviews) }))}</span>
        <span class="pm__dot"></span>
        <span>${esc(t('modal.sold', { n: formatInt(p.sales) }))}</span>
      </div>
      <p class="pm__desc">${esc(descOf(p))}</p>
      <p class="pm__files-title">${esc(t('modal.includes'))}</p>
      <div class="pm__files">
        ${files.map(([fmt, label]) => `<div class="pm__file">${icon('file')}<span><b>${fmt}</b><small>${esc(label)}</small></span></div>`).join('')}
      </div>
      <div class="pm__price"><b>${money(p.price)}</b>${compare}</div>
      <div class="pm__actions">
        <div class="pm__qty">
          <button type="button" data-pm-qty="-1" aria-label="${esc(t('cart.qty'))}">${icon('minus')}</button>
          <span id="pmQty">${pm.qty}</span>
          <button type="button" data-pm-qty="1" aria-label="${esc(t('cart.qty'))}">${icon('plus')}</button>
        </div>
        <button class="btn btn--solid pm__add" id="pmAdd" type="button">${esc(t('modal.add'))} — ${money(p.price * pm.qty)}</button>
        <button class="pm__wish${wished ? ' is-active' : ''}" type="button" data-wish="${p.id}"
          aria-pressed="${wished}" aria-label="${esc(t(wished ? 'card.unsaveAria' : 'card.saveAria', { name: nameOf(p) }))}">
          ${icon('heart')}
        </button>
      </div>
      <button class="pm__buy" id="pmBuy" type="button">${esc(t('modal.buy'))} ${icon('arrow')}</button>
      <ul class="pm__guarantees">
        <li>${icon('download')} ${esc(t('modal.g1'))}</li>
        <li>${icon('shield')} ${esc(t('modal.g2'))}</li>
        <li>${icon('check')} ${esc(t('modal.g3'))}</li>
      </ul>
      <span class="pm__license">${icon('check')} ${esc(t('modal.licenseIncluded'))}</span>
    </div>
  </div>`;
}


function openProduct(id) {
  const p = getItem(id);
  if (!p || p.id === 'vault' || p.id === 'welcome') return;
  pm.id = id;
  pm.view = 'tee';
  pm.color = p.tee;
  pm.qty = 1;
  renderProductModal();
  openLayer($('#productModal'), document.activeElement);
}

/* ── cart ──────────────────────────────────────────────────────── */
function computeTotals() {
  const subtotal = state.cart.reduce((sum, line) => {
    const item = getItem(line.id);
    return sum + (item ? item.price * line.qty : 0);
  }, 0);
  const rate = state.promo ? PROMOS[state.promo] || 0 : 0;
  const discount = Math.round(subtotal * rate * 100) / 100;
  return { subtotal, discount, total: Math.max(0, subtotal - discount), rate };
}

function cartLineHTML(line) {
  const p = getItem(line.id);
  if (!p) return '';
  const uid = `line-${p.id}-${++uidSeq}`;
  const isBundle = p.id === 'vault';
  const thumb = isBundle
    ? `<div class="line__thumb line__thumb--bundle"><b>12</b><span>${esc(t('vault.designs'))}</span></div>`
    : `<div class="line__thumb" style="--bg:${p.bg};--tee:${TEE_COLORS[p.tee]?.hex || '#171714'}">${stageHTML(p, uid)}</div>`;
  return `
  <div class="cart-line">
    ${thumb}
    <div class="line__info">
      <p class="line__coll">${esc(collectionLabel(p.collection))}</p>
      <h4 class="line__name">${esc(nameOf(p))}</h4>
      <p class="line__meta">${isBundle ? '12 DIGITAL FILES · SVG / PNG / DTF / EPS' : 'DIGITAL DOWNLOAD · 4 FILES'}</p>
      <div class="line__row">
        <div class="qty">
          <button type="button" data-cart-dec="${p.id}" aria-label="${esc(t('cart.qty'))}">${icon('minus')}</button>
          <span>${line.qty}</span>
          <button type="button" data-cart-inc="${p.id}" aria-label="${esc(t('cart.qty'))}">${icon('plus')}</button>
        </div>
        <span class="line__price">${money(p.price * line.qty)}</span>
      </div>
    </div>
    <button class="line__remove" type="button" data-cart-remove="${p.id}" aria-label="${esc(t('cart.remove'))}">${icon('close')}</button>
  </div>`;
}

function renderPromo() {
  const area = $('#promoArea');
  if (!area) return;
  if (state.promo) {
    const rate = PROMOS[state.promo] || 0;
    area.innerHTML = `
      <div class="promo-applied">
        ${icon('check')}
        <span><b>${esc(state.promo)}</b> · −${Math.round(rate * 100)}%</span>
        <button type="button" data-remove-promo>${esc(t('cart.removePromo'))}</button>
      </div>`;
  } else {
    area.innerHTML = `
      <form class="promo-form" novalidate>
        <input type="text" id="promoInput" placeholder="${esc(t('cart.promoPlaceholder'))}"
          aria-label="${esc(t('cart.promoPlaceholder'))}" autocomplete="off" spellcheck="false">
        <button type="submit">${esc(t('cart.apply'))}</button>
      </form>
      <p class="promo-hint">${esc(t('cart.promoHint'))}</p>`;
  }
}

function renderCart() {
  const lines = $('#cartLines');
  const empty = $('#cartEmpty');
  const foot = $('#cartFoot');
  if (!lines || !empty || !foot) return;
  const valid = state.cart.filter((l) => getItem(l.id));
  state.cart = valid;
  const count = cartQty();

  if (!valid.length) {
    lines.innerHTML = '';
    empty.hidden = false;
    foot.hidden = true;
    const promoArea = $('#promoArea');
    if (promoArea) promoArea.innerHTML = '';
  } else {
    empty.hidden = true;
    foot.hidden = false;
    lines.innerHTML = valid.map(cartLineHTML).join('');
    renderPromo();
    const totals = computeTotals();
    const sub = $('#cartSubtotal');
    const dis = $('#cartDiscount');
    const disRow = $('#discountRow');
    const total = $('#cartTotal');
    if (sub) sub.textContent = money(totals.subtotal);
    if (dis) dis.textContent = `−${money(totals.discount)}`;
    if (disRow) disRow.hidden = totals.discount <= 0;
    if (total) total.textContent = money(totals.total);
  }
  updateHeader();
}

function pulseCart() {
  const btn = $('#btnCart');
  if (!btn) return;
  btn.classList.remove('is-bumped');
  void btn.offsetWidth;
  btn.classList.add('is-bumped');
  setTimeout(() => btn.classList.remove('is-bumped'), 400);
}

function addToCart(id, qty = 1) {
  const p = getItem(id);
  if (!p) return;
  if (p.id === 'welcome') { downloadSVG(p); return; }
  const add = Math.max(1, Math.min(9, qty));
  const line = state.cart.find((l) => l.id === id);
  if (line) line.qty = Math.min(9, line.qty + add);
  else state.cart.push({ id, qty: add });
  persist();
  renderCart();
  pulseCart();
  showToast(p.id === 'vault'
    ? t('toast.addedBundle')
    : t('toast.added', { name: nameOf(p) }));
}

function setQty(id, delta) {
  const line = state.cart.find((l) => l.id === id);
  if (!line) return;
  line.qty = Math.min(9, line.qty + delta);
  if (line.qty <= 0) state.cart = state.cart.filter((l) => l.id !== id);
  persist();
  renderCart();
}

function removeFromCart(id) {
  state.cart = state.cart.filter((l) => l.id !== id);
  persist();
  renderCart();
  showToast(t('toast.removed'));
}

function applyPromo(raw) {
  if (!state.cart.length) { showToast(t('cart.promoEmpty')); return; }
  const code = String(raw || '').trim().toUpperCase();
  if (PROMOS[code]) {
    state.promo = code;
    persist();
    renderCart();
    showToast(t('toast.promoOk', { code }));
  } else {
    showToast(t('toast.promoBad'));
  }
}

function removePromo() {
  state.promo = null;
  persist();
  renderCart();
}

function openCart() {
  renderCart();
  openLayer($('#cartDrawer'), document.activeElement);
}

function openCheckout() {
  if (!state.cart.length) { showToast(t('toast.cartEmpty')); return; }
  const drawer = $('#cartDrawer');
  if (drawer && drawer.classList.contains('is-open')) {
    drawer.classList.remove('is-open');
    setTimeout(() => { if (activeLayer !== drawer) drawer.hidden = true; }, 360);
    activeLayer = null;
  }
  renderCheckout();
  openLayer($('#checkoutModal'), $('#btnCart'));
}

/* ── checkout ──────────────────────────────────────────────────── */
let viewOrder = null;

function orderLineHTML(line) {
  const p = getItem(line.id);
  if (!p) return '';
  const isBundle = p.id === 'vault';
  const thumb = isBundle
    ? `<div class="co__line-thumb co__line-thumb--bundle">12</div>`
    : `<div class="co__line-thumb" style="--bg:${p.bg};--tee:${TEE_COLORS[p.tee]?.hex || '#171714'}">${stageHTML(p, `coline-${p.id}-${++uidSeq}`)}</div>`;
  return `
  <div class="co__line">
    ${thumb}
    <div>
      <div class="co__line-name">${esc(nameOf(p))}${line.qty > 1 ? ` × ${line.qty}` : ''}</div>
      <div class="co__line-meta">${esc(isBundle ? t('checkout.bundleNote') : collectionLabel(p.collection))}</div>
    </div>
    <div class="co__line-price">${money(p.price * line.qty)}</div>
  </div>`;
}

function renderCheckout() {
  const panel = $('#coPanel');
  if (!panel) return;
  const totals = computeTotals();
  const lines = state.cart.map(orderLineHTML).join('');
  panel.innerHTML = `
  <div class="co__grid">
    <div class="co__main">
      <p class="co__eyebrow">ATLAS INK — DIGITAL GOODS</p>
      <h2 class="co__title" id="coTitle">${esc(t('checkout.title'))}</h2>
      <p class="co__sub">${esc(t('checkout.sub'))}</p>
      <form class="co__form" id="coForm" novalidate>
        <div class="field">
          <label for="coEmail">${esc(t('checkout.email'))}</label>
          <input id="coEmail" name="email" type="email" data-autofocus placeholder="${esc(t('checkout.emailPh'))}"
            autocomplete="email" inputmode="email" required>
        </div>
        <div class="field">
          <label for="coName">${esc(t('checkout.name'))}</label>
          <input id="coName" name="name" type="text" placeholder="${esc(t('checkout.namePh'))}"
            autocomplete="name" required>
        </div>
        <div class="field">
          <label for="coCard">${esc(t('checkout.card'))}</label>
          <input id="coCard" name="card" type="text" placeholder="${esc(t('checkout.cardPh'))}"
            autocomplete="cc-number" inputmode="numeric" maxlength="19" required>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="coExp">${esc(t('checkout.expiry'))}</label>
            <input id="coExp" name="expiry" type="text" placeholder="${esc(t('checkout.expiryPh'))}"
              autocomplete="cc-exp" inputmode="numeric" maxlength="7" required>
          </div>
          <div class="field">
            <label for="coCvc">${esc(t('checkout.cvc'))}</label>
            <input id="coCvc" name="cvc" type="text" placeholder="${esc(t('checkout.cvcPh'))}"
              autocomplete="cc-csc" inputmode="numeric" maxlength="4" required>
          </div>
        </div>
        <div class="co__demo">
          <span>${esc(t('checkout.demo'))}</span>
          <button type="button" id="coFill">${esc(t('checkout.fill'))}</button>
        </div>
        <p class="co__err" id="coErr" hidden></p>
        <button class="btn btn--solid btn--wide co__pay" id="coPay" type="submit">
          ${esc(t('checkout.pay', { total: money(totals.total) }))}
        </button>
        <p class="co__secure">${icon('lock')} ${esc(t('checkout.secure'))}</p>
      </form>
    </div>
    <aside class="co__aside">
      <h3 class="co__aside-title">${esc(t('checkout.summary'))}</h3>
      <div class="co__lines">${lines}</div>
      ${totals.discount > 0 ? `<div class="totals__row"><span>${esc(t('cart.discount'))} (${esc(state.promo)})</span><b>−${money(totals.discount)}</b></div>` : ''}
      <div class="co__aside-total"><span>${esc(t('cart.total'))}</span><b>${money(totals.total)}</b></div>
      <div class="co__aside-note">
        <strong>${icon('download')} ${esc(t('cart.digital'))}</strong>
        ${esc(t('checkout.instant'))}
      </div>
      <div class="co__aside-note">
        <strong>${icon('shield')} ${esc(t('modal.licenseIncluded'))}</strong>
        SVG · PNG · DTF · EPS
      </div>
    </aside>
  </div>`;
}

function handlePayment() {
  const errEl = $('#coErr');
  const emailEl = $('#coEmail');
  const nameEl = $('#coName');
  const cardEl = $('#coCard');
  const expEl = $('#coExp');
  const cvcEl = $('#coCvc');
  if (!emailEl || !nameEl || !cardEl || !expEl || !cvcEl) return;

  const fail = (message, field) => {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = message;
    }
    field?.focus();
  };
  const email = emailEl.value.trim();
  const name = nameEl.value.trim();
  const digits = cardEl.value.replace(/\D/g, '');
  const exp = expEl.value.trim();
  const cvc = cvcEl.value.trim();

  if (!EMAIL_RE.test(email)) return fail(t('checkout.errEmail'), emailEl);
  if (name.length < 2) return fail(t('checkout.errName'), nameEl);
  if (digits.length < 15) return fail(t('checkout.errCard'), cardEl);
  if (!/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(exp)) return fail(t('checkout.errExpiry'), expEl);
  if (!/^\d{3,4}$/.test(cvc)) return fail(t('checkout.errCvc'), cvcEl);

  if (errEl) errEl.hidden = true;
  const totals = computeTotals();
  const items = state.cart.map((l) => ({ id: l.id, qty: l.qty, price: getItem(l.id)?.price || 0 }));
  if (!items.length) { openCheckout(); return; }

  const order = {
    id: `AI-${Math.floor(10000 + Math.random() * 90000)}`,
    date: new Date().toISOString(),
    email,
    name,
    items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    promo: state.promo
  };

  const payBtn = $('#coPay');
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(t('checkout.processing'))}`;
  }

  setTimeout(() => {
    saveOrder(order);
    state.cart = [];
    state.promo = null;
    persist();
    renderCart();
    updateOrderLink();
    renderSuccess(order, 'order');
  }, 1150);
}

function orderDownloadsHTML(order) {
  const rows = order.items.map((line) => {
    const p = getItem(line.id);
    if (!p) return '';
    if (p.id === 'vault') {
      return `<div class="dl-row">
        <div class="dl-name"><b>${esc(nameOf(p))}</b><small>${esc(t('checkout.bundleNote'))}</small></div>
        <button class="dl-btn" type="button" data-dlb="svg">${icon('download')} SVG ZIP</button>
        <button class="dl-btn" type="button" data-dlb="png">${icon('download')} PNG ZIP</button>
      </div>`;
    }
    if (!hasDesign(p.id)) return '';
    return `<div class="dl-row">
      <div class="dl-name"><b>${esc(nameOf(p))}</b><small>${esc(collectionLabel(p.collection))} · ${esc(t('checkout.fileReady'))}</small></div>
      <button class="dl-btn" type="button" data-dl="${p.id}:svg">${icon('download')} SVG</button>
      <button class="dl-btn" type="button" data-dl="${p.id}:png">PNG</button>
    </div>`;
  }).join('');
  return rows;
}

function renderSuccess(order, mode = 'order') {
  const panel = $('#coPanel');
  if (!panel) return;
  viewOrder = order;
  const isLibrary = mode === 'library';
  const rows = orderDownloadsHTML(order);
  const date = formatDate(order.date);
  const title = isLibrary ? t('downloads.title') : t('checkout.successTitle');
  const eyebrow = isLibrary ? t('downloads.my') : t('checkout.successEyebrow');
  const description = isLibrary
    ? t('downloads.desc')
    : t('checkout.successDesc', { id: order.id, email: order.email });

  panel.innerHTML = `
  <div class="co__success">
    <div class="co__success-head">
      <div class="co__success-mark">${icon(isLibrary ? 'download' : 'check')}</div>
      <div>
        <p class="co__eyebrow">${esc(eyebrow)}</p>
        <h2 id="coTitle">${esc(title)}</h2>
        <p class="co__success-desc">${esc(description)}</p>
        <div class="co__order-meta">
          <span class="co__chip">${esc(t('checkout.order'))}: <b>${esc(order.id)}</b></span>
          <span class="co__chip">${esc(t('checkout.total'))}: <b>${money(order.total)}</b></span>
          ${date ? `<span class="co__chip">${esc(date)}</span>` : ''}
          ${order.email ? `<span class="co__chip">${esc(order.email)}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="dl-block">
      <div class="dl-head">
        <h3>${esc(t('checkout.downloads'))}</h3>
        <button class="link-btn" type="button" data-dlall>${esc(t('checkout.downloadAll'))}</button>
      </div>
      <div class="dl-list">${rows}</div>
      <p class="dl-note">${esc(t('checkout.pngNote'))}</p>
    </div>

    <div class="co__success-actions">
      <button class="btn btn--solid" type="button" data-close-checkout>${esc(t('checkout.continue'))}</button>
      <button class="btn btn--ghost" type="button" data-save-order>${esc(t('checkout.saveOrder'))}</button>
      <span class="co__license-note">${icon('shield')} ${esc(t('modal.licenseIncluded'))}</span>
    </div>
    <p class="co__success-foot">${esc(t('checkout.savedNote'))}</p>
  </div>`;
}

function updateOrderLink() {
  const link = $('#linkDownloads');
  if (!link) return;
  const order = readOrder();
  link.hidden = !order;
}

function openDownloads() {
  const order = readOrder();
  if (!order) { showToast(t('toast.noOrder')); return; }
  renderSuccess(order, 'library');
  openLayer($('#checkoutModal'), $('#linkDownloads'));
}

/* ── downloads: SVG, PNG + a tiny ZIP writer ───────────────────── */
const FONT_DEFS = [
  { family: 'Anton', file: 'anton.woff2', weight: '400', style: 'normal' },
  { family: 'Space Mono', file: 'space-mono.woff2', weight: '400', style: 'normal' },
  { family: 'Space Mono', file: 'space-mono-bold.woff2', weight: '700', style: 'normal' },
  { family: 'Instrument Serif', file: 'instrument-serif.woff2', weight: '400', style: 'normal' },
  { family: 'Instrument Serif', file: 'instrument-serif-italic.woff2', weight: '400', style: 'italic' },
  { family: 'Inter', file: 'inter.woff2', weight: '100 900', style: 'normal' },
  { family: 'Cairo', file: 'cairo-900.woff2', weight: '900', style: 'normal' }
];
const fontCache = new Map();
let downloadBusy = false;

function fontBlob(file) {
  if (!fontCache.has(file)) {
    const url = new URL(`../assets/fonts/${file}`, import.meta.url);
    fontCache.set(file, fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Font ${file} failed`);
      return res.blob();
    }).catch((err) => { fontCache.delete(file); throw err; }));
  }
  return fontCache.get(file);
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

async function standaloneSVG(item) {
  const raw = designSvg(item, `download-${item.id}`);
  const used = FONT_DEFS.filter((f) => raw.includes(f.family));
  const faces = await Promise.all(used.map(async (f) => {
    const b64 = await blobToBase64(await fontBlob(f.file));
    return `@font-face{font-family:'${f.family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${f.weight};font-style:${f.style};}`;
  }));
  const style = `<style>${faces.join('')}</style>`;
  return raw.replace(/<svg([^>]*)>/, `<svg$1>${style}`);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 16000);
}

async function downloadSVG(item) {
  if (!hasDesign(item.id)) { showToast(t('toast.downloadError')); return; }
  try {
    showToast(t('toast.preparing'));
    const svg = await standaloneSVG(item);
    saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `atlas-ink-${item.id}.svg`);
    showToast(t('toast.downloaded'));
  } catch (err) {
    console.error(err);
    showToast(t('toast.downloadError'));
  }
}

async function pngBlob(item, width = 3000) {
  const svg = await standaloneSVG(item);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Could not rasterise SVG'));
      img.src = url;
    });
    const height = Math.round(width * 1.2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downloadPNG(item) {
  if (!hasDesign(item.id)) { showToast(t('toast.downloadError')); return; }
  try {
    showToast(t('toast.pngPreparing'));
    const blob = await pngBlob(item, 3000);
    saveBlob(blob, `atlas-ink-${item.id}-300dpi.png`);
    showToast(t('toast.downloaded'));
  } catch (err) {
    console.error(err);
    showToast(t('toast.downloadError'));
  }
}

/* Minimal ZIP writer (store method, UTF-8 names). Keeps bundle downloads
   to a single file instead of a dozen browser prompts. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 0x5C21; /* 2026-01-01 */

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}

async function downloadSet(ids, fmt = 'svg') {
  if (downloadBusy) return;
  downloadBusy = true;
  showToast(t(fmt === 'png' ? 'toast.pngPreparing' : 'toast.bundlePreparing'));
  try {
    const unique = [...new Set(ids)];
    const files = [];
    for (const id of unique) {
      const item = getItem(id);
      if (!item || !hasDesign(id)) continue;
      if (fmt === 'svg') {
        const svg = await standaloneSVG(item);
        files.push({
          name: `atlas-ink-${item.id}.svg`,
          blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
        });
      } else {
        const blob = await pngBlob(item, 1800);
        files.push({ name: `atlas-ink-${item.id}.png`, blob });
      }
    }
    if (!files.length) throw new Error('Nothing to download');
    const zip = await buildZip(files);
    saveBlob(zip, `atlas-ink-${fmt === 'svg' ? 'svg' : 'png'}-pack.zip`);
    showToast(t('toast.downloaded'));
  } catch (err) {
    console.error(err);
    showToast(t('toast.downloadError'));
  } finally {
    downloadBusy = false;
  }
}

const downloadBundle = (fmt) => downloadSet(PRINTABLE.map((p) => p.id), fmt);

function downloadOrder(order) {
  if (!order) return;
  const ids = new Set();
  order.items.forEach((line) => {
    if (line.id === 'vault') PRINTABLE.forEach((p) => ids.add(p.id));
    else if (hasDesign(line.id)) ids.add(line.id);
  });
  if (!ids.size) { showToast(t('toast.downloadError')); return; }
  downloadSet([...ids], 'svg');
}

/* ── save / share as plain text ───────────────────────────────── */
const formatLine = (line) => {
  const p = getItem(line.id);
  return p ? `• ${nameOf(p)} × ${line.qty} — ${money(p.price * line.qty)}` : '';
};

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the textarea trick */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

async function saveCartText() {
  if (!state.cart.length) { showToast(t('toast.cartEmpty')); return; }
  const totals = computeTotals();
  const lines = [
    'ATLAS INK — cart',
    '',
    ...state.cart.map(formatLine),
    '',
    `${t('cart.subtotal')}: ${money(totals.subtotal)}`,
    totals.discount ? `${t('cart.discount')} (${state.promo}): −${money(totals.discount)}` : '',
    `${t('cart.total')}: ${money(totals.total)}`,
    '',
    'atlasink.studio'
  ].filter(Boolean).join('\n');
  const ok = await copyText(lines);
  showToast(ok ? t('cart.savedText') : t('toast.downloadError'));
}

async function saveOrderText() {
  if (!viewOrder) return;
  const order = viewOrder;
  const lines = [
    t('checkout.textHead'),
    '',
    `${t('checkout.order')}: ${order.id}`,
    `${t('checkout.email')}: ${order.email}`,
    `${t('checkout.total')}: ${money(order.total)}`,
    '',
    ...order.items.map(formatLine),
    '',
    'atlasink.studio'
  ].join('\n');
  const ok = await copyText(lines);
  showToast(ok ? t('checkout.savedOrder') : t('toast.downloadError'));
}

/* ── overlays: drawer + modals + focus handling ───────────────── */
let activeLayer = null;
let scrollLocked = false;

function lockScroll(on) {
  if (on === scrollLocked) return;
  scrollLocked = on;
  document.documentElement.classList.toggle('no-scroll', on);
}

function openScrim() {
  const scrim = $('#scrim');
  if (!scrim) return;
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add('is-open'));
  lockScroll(true);
}

function closeScrimIfIdle() {
  setTimeout(() => {
    if (activeLayer) return;
    const scrim = $('#scrim');
    if (scrim) {
      scrim.classList.remove('is-open');
      setTimeout(() => { if (!activeLayer && scrim) scrim.hidden = true; }, 320);
    }
    lockScroll(false);
  }, 380);
}

function finalizeLayer(layer) {
  if (!layer) return;
  layer.hidden = true;
  if (layer.id === 'productModal') {
    const panel = $('#pmPanel');
    if (panel) panel.innerHTML = '';
  }
  if (layer.id === 'checkoutModal') {
    const panel = $('#coPanel');
    if (panel) panel.innerHTML = '';
  }
}

function focusables(layer) {
  return $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', layer)
    .filter((el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true');
}

function openLayer(layer, returnFocus) {
  if (!layer) return;
  if (activeLayer && activeLayer !== layer) {
    const prev = activeLayer;
    prev.classList.remove('is-open');
    setTimeout(() => finalizeLayer(prev), 360);
    activeLayer = null;
  }
  layer._returnFocus = returnFocus || document.activeElement;
  activeLayer = layer;
  layer.hidden = false;
  openScrim();
  requestAnimationFrame(() => layer.classList.add('is-open'));
  setTimeout(() => {
    if (activeLayer !== layer) return;
    const target = $('[data-autofocus]', layer) || focusables(layer)[0];
    target?.focus({ preventScroll: true });
  }, 140);
}

function closeLayer(layer = activeLayer) {
  if (!layer) return;
  const ret = layer._returnFocus;
  layer.classList.remove('is-open');
  if (activeLayer === layer) activeLayer = null;
  closeScrimIfIdle();
  setTimeout(() => finalizeLayer(layer), 380);
  setTimeout(() => {
    if (activeLayer) return;
    if (ret && ret.isConnected && ret.getClientRects().length) ret.focus({ preventScroll: true });
    else $('#btnCart')?.focus({ preventScroll: true });
  }, 400);
}

/* ── language / static copy ───────────────────────────────────── */
function applyI18n() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  translator = makeT(state.lang);
  document.title = state.lang === 'ar'
    ? 'ATLAS INK — تصاميم تيشيرت رقمية جاهزة للطباعة'
    : 'ATLAS INK — Digital T-Shirt Designs, Print-Ready';

  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });

  const langLabel = $('#langLabel');
  if (langLabel) langLabel.textContent = state.lang === 'ar' ? 'EN' : 'العربية';
  const footerLang = $('#btnLangFooter');
  if (footerLang) footerLang.textContent = state.lang === 'ar' ? 'English' : 'العربية';
}

function setLanguage(lang) {
  if (lang !== 'ar' && lang !== 'en') return;
  state.lang = lang;
  persist();
  applyI18n();
  renderChips();
  renderGrid();
  renderHero();
  renderVault();
  renderFreebie();
  renderCart();
  updateOrderLink();
  updateHeader();
  if (activeLayer?.id === 'productModal' && pm.id) {

    renderProductModal();
  }
  closeMobileMenu();
}

/* ── toasts ────────────────────────────────────────────────────── */
function showToast(message) {
  const holder = $('#toasts');
  if (!holder || !message) return;
  while (holder.children.length >= 3) holder.firstElementChild?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  holder.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-out');
    setTimeout(() => toast.remove(), 260);
  }, 3300);
}

/* ── wishlist ──────────────────────────────────────────────────── */
function syncWishUI() {
  $$('[data-wish]').forEach((btn) => {
    const id = btn.dataset.wish;
    const on = state.wishlist.includes(id);
    const p = getItem(id);
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', String(on));
    if (p) btn.setAttribute('aria-label', t(on ? 'card.unsaveAria' : 'card.saveAria', { name: nameOf(p) }));
  });
  const wishCount = $('#wishCount');
  if (wishCount) {
    wishCount.textContent = state.wishlist.length;
    wishCount.hidden = state.wishlist.length === 0;
  }
}

function toggleWish(id) {
  const p = getItem(id);
  if (!p) return;
  const on = state.wishlist.includes(id);
  if (on) state.wishlist = state.wishlist.filter((x) => x !== id);
  else state.wishlist.push(id);
  persist();
  syncWishUI();
  renderChips();
  showToast(t(on ? 'toast.wishRemoved' : 'toast.wishAdded', { name: nameOf(p) }));
  if (state.filter === 'saved') renderGrid();
}

/* ── mobile menu ───────────────────────────────────────────────── */
let menuFocusReturn = null;

function openMobileMenu() {
  const menu = $('#mobileMenu');
  if (!menu) return;
  menuFocusReturn = document.activeElement;
  menu.hidden = false;
  $('#btnMenu')?.setAttribute('aria-expanded', 'true');
  lockScroll(true);
  $('#mobileClose')?.focus({ preventScroll: true });
}

function closeMobileMenu() {
  const menu = $('#mobileMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('#btnMenu')?.setAttribute('aria-expanded', 'false');
  if (!activeLayer) lockScroll(false);
  if (menuFocusReturn?.isConnected) menuFocusReturn.focus({ preventScroll: true });
}

/* ── filters / shop interactions ──────────────────────────────── */
function setFilter(id) {
  state.filter = id;
  renderChips();
  renderGrid();
}

function resetFilters() {
  state.filter = 'all';
  state.q = '';
  state.sort = 'featured';
  const search = $('#searchInput');
  const sort = $('#sortSelect');
  if (search) search.value = '';
  if (sort) sort.value = 'featured';
  renderChips();
  renderGrid();
}

function focusSearch() {
  $('#shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('#searchInput')?.focus({ preventScroll: true }), 420);
}

function showSaved() {
  setFilter('saved');
  $('#shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── event wiring ──────────────────────────────────────────────── */
function bindEvents() {
  document.addEventListener('click', (event) => {
    const filterBtn = event.target.closest('[data-filter]');
    if (filterBtn) { setFilter(filterBtn.dataset.filter); return; }

    const openBtn = event.target.closest('[data-open]');
    if (openBtn) { event.preventDefault(); openProduct(openBtn.dataset.open); return; }

    const addBtn = event.target.closest('[data-add]');
    if (addBtn) {
      event.preventDefault();
      addToCart(addBtn.dataset.add, 1);
      return;
    }

    const wishBtn = event.target.closest('[data-wish]');
    if (wishBtn) { event.preventDefault(); toggleWish(wishBtn.dataset.wish); return; }

    const cartClose = event.target.closest('[data-close-cart]');
    if (cartClose) {
      closeLayer($('#cartDrawer'));
      if (cartClose.closest('#cartEmpty')) {
        setTimeout(() => $('#shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260);
      }
      return;
    }

    const productClose = event.target.closest('[data-close-modal]');
    if (productClose) { closeLayer($('#productModal')); return; }

    const checkoutClose = event.target.closest('[data-close-checkout]');
    if (checkoutClose) { closeLayer($('#checkoutModal')); return; }

    const inc = event.target.closest('[data-cart-inc]');
    if (inc) { setQty(inc.dataset.cartInc, 1); return; }
    const dec = event.target.closest('[data-cart-dec]');
    if (dec) { setQty(dec.dataset.cartDec, -1); return; }
    const remove = event.target.closest('[data-cart-remove]');
    if (remove) { removeFromCart(remove.dataset.cartRemove); return; }

    const removePromoBtn = event.target.closest('[data-remove-promo]');
    if (removePromoBtn) { removePromo(); return; }

    const promoFilterLink = event.target.closest('[data-scroll-shop]');
    if (promoFilterLink) { $('#shop')?.scrollIntoView({ behavior: 'smooth' }); return; }

    if (event.target.closest('#btnTop')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  $('#btnCart')?.addEventListener('click', openCart);
  $('#btnWish')?.addEventListener('click', showSaved);
  $('#btnSearch')?.addEventListener('click', focusSearch);
  $('#btnLang')?.addEventListener('click', () => setLanguage(state.lang === 'ar' ? 'en' : 'ar'));
  $('#btnLangFooter')?.addEventListener('click', () => setLanguage(state.lang === 'ar' ? 'en' : 'ar'));
  $('#btnLangMobile')?.addEventListener('click', () => setLanguage(state.lang === 'ar' ? 'en' : 'ar'));

  $('#btnMenu')?.addEventListener('click', openMobileMenu);
  $('#mobileClose')?.addEventListener('click', closeMobileMenu);

  $('#searchInput')?.addEventListener('input', (event) => {
    state.q = event.target.value;
    renderGrid();
  });
  $('#searchClear')?.addEventListener('click', () => {
    state.q = '';
    const input = $('#searchInput');
    if (input) { input.value = ''; input.focus(); }
    renderGrid();
  });
  $('#sortSelect')?.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderGrid();
  });
  $('#resetFilters')?.addEventListener('click', resetFilters);
  $('#emptyReset')?.addEventListener('click', resetFilters);

  $('#btnCheckout')?.addEventListener('click', openCheckout);
  $('#btnSaveCart')?.addEventListener('click', saveCartText);
  $('#linkDownloads')?.addEventListener('click', openDownloads);

  $('#btnFreeSvg')?.addEventListener('click', () => downloadSVG(FREE_PRODUCT));
  $('#btnFreePng')?.addEventListener('click', () => downloadPNG(FREE_PRODUCT));
  $('#newsDownload')?.addEventListener('click', () => downloadSVG(FREE_PRODUCT));

  $('#scrim')?.addEventListener('click', () => { if (activeLayer) closeLayer(activeLayer); });

  $('#promoArea')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#promoInput');
    applyPromo(input?.value || '');
  });

  $('#newsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#newsEmail');
    const err = $('#newsErr');
    const form = $('#newsForm');
    const success = $('#newsSuccess');
    const value = input?.value.trim() || '';
    if (!EMAIL_RE.test(value)) {
      if (err) err.hidden = false;
      input?.focus();
      return;
    }
    if (err) err.hidden = true;
    if (form) form.hidden = true;
    if (success) success.hidden = false;
    showToast(t('toast.welcome'));
  });

  /* product modal internals */
  $('#pmPanel')?.addEventListener('click', (event) => {
    const view = event.target.closest('[data-view]');
    if (view) {
      pm.view = view.dataset.view;
      renderProductModal();
      return;
    }
    const swatch = event.target.closest('[data-color]');
    if (swatch) {
      pm.color = swatch.dataset.color;
      $$('.swatch', $('#pmPanel')).forEach((s) => {
        const on = s.dataset.color === pm.color;
        s.classList.toggle('is-on', on);
        s.setAttribute('aria-pressed', String(on));
      });
      const p = getItem(pm.id);
      const stage = $('.pm__stage', $('#pmPanel'));
      if (p && stage && pm.view === 'tee') {
        stage.style.setProperty('--tee', TEE_COLORS[pm.color]?.hex || '#171714');
        const old = $('.tee-stage', stage);
        if (old) old.outerHTML = stageHTML(p, `pmtee-${++pmUid}`, pm.color);
      }
      return;
    }
    const qtyBtn = event.target.closest('[data-pm-qty]');
    if (qtyBtn) {
      pm.qty = Math.max(1, Math.min(9, pm.qty + parseInt(qtyBtn.dataset.pmQty, 10)));
      const label = $('#pmQty');
      const add = $('#pmAdd');
      const p = getItem(pm.id);
      if (label) label.textContent = pm.qty;
      if (add && p) add.textContent = `${t('modal.add')} — ${money(p.price * pm.qty)}`;
      return;
    }
    if (event.target.closest('#pmAdd')) {
      const btn = $('#pmAdd');
      addToCart(pm.id, pm.qty);
      if (btn) {
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = t('modal.added');
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 1100);
      }
      return;
    }
    if (event.target.closest('#pmBuy')) {
      addToCart(pm.id, pm.qty);
      closeLayer($('#productModal'));
      openCheckout();
    }
  });

  /* checkout internals */
  $('#coPanel')?.addEventListener('submit', (event) => {
    if (event.target.id === 'coForm') {
      event.preventDefault();
      handlePayment();
    }
  });
  $('#coPanel')?.addEventListener('input', (event) => {
    const field = event.target;
    if (field.id === 'coCard') {
      const digits = field.value.replace(/\D/g, '').slice(0, 16);
      field.value = digits.replace(/(.{4})/g, '$1 ').trim();
    } else if (field.id === 'coExp') {
      const digits = field.value.replace(/\D/g, '').slice(0, 4);
      field.value = digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
    } else if (field.id === 'coCvc') {
      field.value = field.value.replace(/\D/g, '').slice(0, 4);
    }
  });
  $('#coPanel')?.addEventListener('click', (event) => {
    if (event.target.closest('#coFill')) {
      const email = $('#coEmail');
      const name = $('#coName');
      const card = $('#coCard');
      const exp = $('#coExp');
      const cvc = $('#coCvc');
      if (email) email.value = 'you@studio.com';
      if (name) name.value = 'Amina Studio';
      if (card) card.value = '4242 4242 4242 4242';
      if (exp) exp.value = '12 / 28';
      if (cvc) cvc.value = '123';
      $('#coPay')?.focus();
      return;
    }
    const dl = event.target.closest('[data-dl]');
    if (dl) {
      const [id, fmt] = dl.dataset.dl.split(':');
      const item = getItem(id);
      if (item) (fmt === 'png' ? downloadPNG(item) : downloadSVG(item));
      return;
    }
    const bundleDl = event.target.closest('[data-dlb]');
    if (bundleDl) { downloadBundle(bundleDl.dataset.dlb); return; }
    if (event.target.closest('[data-dlall]')) { downloadOrder(viewOrder); return; }
    if (event.target.closest('[data-save-order]')) { saveOrderText(); return; }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeLayer) { closeLayer(activeLayer); return; }
      const menu = $('#mobileMenu');
      if (menu && !menu.hidden) { closeMobileMenu(); return; }
    }
    if (event.key !== 'Tab') return;
    const layer = activeLayer || ($('#mobileMenu') && !$('#mobileMenu').hidden ? $('#mobileMenu') : null);
    if (!layer) return;
    const items = focusables(layer);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  $('#mobileMenu')?.addEventListener('click', (event) => {
    if (event.target.closest('a[href^="#"]')) closeMobileMenu();
  });
}

/* ── boot ──────────────────────────────────────────────────────── */
function init() {
  applyI18n();
  renderChips();
  renderGrid();
  renderHero();
  renderVault();
  renderFreebie();
  renderCart();
  updateHeader();
  updateOrderLink();
  bindEvents();
}

init();
