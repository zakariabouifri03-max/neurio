// UIManager: DOM screens (menus, pause, settings, results) and the in-match HUD.
// Screens are plain data: { id, title, sub, items:[{id,label,value,disabled,onOk,onLeft,onRight}],
// html, onBack, onPause }. Keyboard, gamepad and mouse all drive the same focus list.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class UIManager {
  constructor(doc = document) {
    this.doc = doc;
    this.overlay = doc.getElementById('overlay');
    this.screenEl = doc.getElementById('screen');
    this.hud = doc.getElementById('hud');
    this.banner = doc.getElementById('banner');
    this.restartLabel = doc.getElementById('restartLabel');
    this.flashEl = doc.getElementById('flash');
    this.screen = null;
    this.focus = 0;
    this.bannerTimer = 0;
    this.restartTimer = 0;
    this.onSound = null;   // (name) => void, wired by main
  }

  // ---------- screens ----------
  show(screen, opts = {}) {
    this.screen = screen;
    this.focus = 0;
    this.overlay.classList.remove('hidden');
    this.overlay.classList.toggle('menuBg', !!(screen.bg || opts.bg));
    this.render();
  }

  hideOverlay() {
    this.screen = null;
    this.overlay.classList.add('hidden');
  }

  get visible() {
    return !this.overlay.classList.contains('hidden');
  }

  render() {
    const s = this.screen;
    if (!s) return;
    const items = (s.items || []).map((it, i) => {
      const cls = ['item', i === this.focus ? 'focus' : '', it.disabled ? 'disabled' : ''].join(' ');
      const val = it.value !== undefined ? `<span class="val">‹ ${esc(it.value)} ›</span>` : (it.tag ? `<span class="tag">${esc(it.tag)}</span>` : '');
      return `<div class="${cls}" data-i="${i}"><span>${esc(it.label)}</span>${val}</div>`;
    }).join('');
    this.screenEl.className = 'screen' + (s.wide ? ' wide' : '');
    this.screenEl.innerHTML = `
      ${s.title ? `<h1>${esc(s.title)}</h1>` : ''}
      ${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ''}
      ${s.html || ''}
      ${items ? `<div class="items">${items}</div>` : ''}
      ${s.hint ? `<div class="hint">${s.hint}</div>` : ''}`;
    this.screenEl.querySelectorAll('.item').forEach((el) => {
      const i = +el.dataset.i;
      el.addEventListener('mouseenter', () => { this.focus = i; this.updateFocusClasses(); });
      el.addEventListener('click', () => { this.focus = i; this.activate(); });
    });
  }

  updateFocusClasses() {
    this.screenEl.querySelectorAll('.item').forEach((el, i) => {
      el.classList.toggle('focus', i === this.focus);
    });
  }

  moveFocus(dir) {
    const items = (this.screen && this.screen.items) || [];
    if (!items.length) return;
    let i = this.focus;
    for (let k = 0; k < items.length; k++) {
      i = (i + dir + items.length) % items.length;
      if (!items[i].disabled) { this.focus = i; break; }
    }
    this.updateFocusClasses();
    this.onSound && this.onSound('focus');
  }

  activate() {
    const s = this.screen;
    const it = s && s.items && s.items[this.focus];
    if (!it || it.disabled) return;
    this.onSound && this.onSound('click');
    if (it.onOk) it.onOk();
  }

  change(dir) {
    const s = this.screen;
    const it = s && s.items && s.items[this.focus];
    if (!it || it.disabled) return;
    const fn = dir < 0 ? it.onLeft : it.onRight;
    if (fn) { fn(); this.onSound && this.onSound('focus'); }
  }

  // Handle menu events from the input layer. Returns true if the event was used.
  handleMenu(events) {
    if (!this.screen) return false;
    let used = false;
    for (const e of events) {
      if (e === 'up') { this.moveFocus(-1); used = true; }
      else if (e === 'down') { this.moveFocus(1); used = true; }
      else if (e === 'left') { this.change(-1); used = true; }
      else if (e === 'right') { this.change(1); used = true; }
      else if (e === 'ok') { this.activate(); used = true; }
      else if (e === 'back') { if (this.screen.onBack) this.screen.onBack(); used = true; }
      else if (e === 'pause') {
        if (this.screen.onPause) this.screen.onPause();
        else if (this.screen.onBack) this.screen.onBack();
        used = true;
      }
    }
    if (events.length && this.screen) this.render();
    return used;
  }

  // ---------- HUD ----------
  showHud(on) {
    this.hud.classList.toggle('hidden', !on);
  }

  setHud(d) {
    const $ = (id) => this.doc.getElementById(id);
    $('hName').textContent = d.homeName;
    $('aName').textContent = d.awayName;
    $('hBadge').style.background = d.homeColor;
    $('aBadge').style.background = d.awayColor;
    $('hScore').textContent = d.score[0];
    $('aScore').textContent = d.score[1];
    $('clock').textContent = d.clock;
    $('half').textContent = d.half;
    $('ctlName').textContent = d.ctlName;
    $('ctlMeta').textContent = d.ctlMeta;
    $('stamina').style.width = `${Math.round(d.stamina * 100)}%`;
    $('stamina').style.background = d.stamina > 0.3 ? '#3ddc97' : '#ff5d6c';
    $('charge').style.width = `${Math.round(d.charge * 100)}%`;
    $('camLabel').textContent = d.camLabel;
    $('hints').innerHTML = d.hints;
    $('control').style.display = d.showControl ? '' : 'none';
  }

  // Centre banner: text, class (goal | warn | ''), duration in seconds
  say(text, cls = '', secs = 1.8) {
    this.banner.textContent = text;
    this.banner.className = cls;
    this.bannerTimer = secs;
    this.banner.style.opacity = '1';
  }

  restart(text, secs = 2.2) {
    this.restartLabel.textContent = text;
    this.restartLabel.classList.remove('hidden');
    this.restartTimer = secs;
  }

  flash() {
    this.flashEl.classList.remove('hidden');
    this.flashEl.style.opacity = '1';
    setTimeout(() => { this.flashEl.style.opacity = '0'; }, 60);
    setTimeout(() => this.flashEl.classList.add('hidden'), 700);
  }

  tick(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.className = 'hidden';
    }
    if (this.restartTimer > 0) {
      this.restartTimer -= dt;
      if (this.restartTimer <= 0) this.restartLabel.classList.add('hidden');
    }
  }
}
