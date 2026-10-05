import * as THREE from 'three';
import { SandboxGame } from './game.js';
import { BLOCK, DESCRIPTIONS, ID, ITEM_BY_ID, ITEMS, RECIPES, itemEmoji, itemName } from './blocks.js';
import { LanConnection, decodeSignal } from './network.js';
import { DEFAULT_SETTINGS, deleteWorld, listWorlds, loadSettings, newWorldRecord, saveSettings, saveWorld } from './storage.js';
import { audio } from './audio.js';
import { hashSeed } from './world.js';

const $ = (id) => document.getElementById(id);
const q = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const biomeNames = { meadow: 'سهول', forest: 'غابة', desert: 'صحراء', snow: 'ثلوج', swamp: 'مستنقع', savanna: 'سافانا' };

class NeurioApp {
  constructor() {
    this.renderer = null;
    this.game = null;
    this.settings = loadSettings();
    this.worlds = listWorlds();
    this.lan = null;
    this.lanRole = null;
    this.lanConnected = false;
    this.chatOpen = false;
    this.modalWasRunning = false;
    this.inventoryTab = 'all';
    this.selectedInfoId = null;
    this.playerSendClock = 0;
    this._saveTimer = 0;
    this._toastTimer = 0;
    this._joystickPointer = null;
    this._lookPointer = null;
    this._offerPrompt = null;
    this._lastTouch = 0;
    this.init();
  }

  init() {
    this._installErrorHandlers();
    this._makeRenderer();
    this._wireMenu();
    this._wireGame();
    this._wireDialogs();
    this._installPrompt();
    this.refreshMenu();
    this._startLoop();
    setTimeout(() => $('loadingCover').classList.add('hide'), 160);
    setTimeout(() => $('loadingCover').remove(), 800);
    addEventListener('pagehide', () => this.saveActiveWorld());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveActiveWorld(); });
  }

  _installErrorHandlers() {
    addEventListener('error', (event) => {
      const box = $('errorBox');
      box.hidden = false;
      box.textContent = `Game error: ${event.message || 'unexpected error'}`;
    });
    addEventListener('unhandledrejection', (event) => {
      const box = $('errorBox'); box.hidden = false;
      box.textContent = `Game error: ${event.reason?.message || event.reason || 'unexpected error'}`;
    });
  }

  _makeRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.settings.quality === 'high' ? 1.75 : this.settings.quality === 'low' ? 0.85 : 1.25));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.renderer.shadowMap.enabled = false;
      $('viewport').appendChild(this.renderer.domElement);
      addEventListener('resize', () => {
        this.renderer?.setSize(innerWidth, innerHeight);
        if (this.game) { this.game.camera.aspect = innerWidth / innerHeight; this.game.camera.updateProjectionMatrix(); }
      });
    } catch (error) {
      const box = $('errorBox'); box.hidden = false;
      box.textContent = 'WebGL is not available on this device. Update Chrome or try a device with 3D graphics support.';
      console.error(error);
    }
  }

  _startLoop() {
    const clock = new THREE.Clock();
    const frame = () => {
      requestAnimationFrame(frame);
      if (!this.renderer || !this.game) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!this.game.paused) this.game.update(dt);
      this.renderer.render(this.game.scene, this.game.camera);
    };
    requestAnimationFrame(frame);
  }

  _wireMenu() {
    $('btnNewWorld').addEventListener('click', () => { audio.unlock(); audio.click(); this.openNewWorld(); });
    $('btnWorlds').addEventListener('click', () => { audio.unlock(); audio.click(); this.openWorldList(); });
    $('btnContinue').addEventListener('click', () => {
      const world = this.worlds[0]; if (world) this.startWorld(world, 'solo'); else this.openNewWorld();
    });
    $('btnJoinLan').addEventListener('click', () => { audio.unlock(); this.openLanDialog('guest'); });
    $('btnSettingsMenu').addEventListener('click', () => { audio.unlock(); this.openSettings(); });
    $('btnFullscreenMenu').addEventListener('click', () => this.toggleFullscreen());
  }

  _wireGame() {
    $('btnPause').addEventListener('click', () => this.openPause());
    $('btnResume').addEventListener('click', () => this.closePause());
    $('btnInventory').addEventListener('click', () => this.openInventory());
    $('btnCraft').addEventListener('click', () => this.openCrafting());
    $('btnLanHost').addEventListener('click', () => this.openLanDialog('host'));
    $('btnLanJoinGame').addEventListener('click', () => this.openLanDialog('guest'));
    $('btnSettingsGame').addEventListener('click', () => this.openSettings());
    $('btnToMenu').addEventListener('click', () => { this.saveActiveWorld(); this.closeLan(); this.showMenu(); });
    $('btnChat').addEventListener('click', () => this.toggleChat());
    $('btnPlace').addEventListener('click', () => { if (this.game) { audio.unlock(); this.game.place(); } });
    $('btnUse').addEventListener('click', () => { if (this.game) { audio.unlock(); this.game.useSelected(); } });
    $('btnAttack').addEventListener('click', () => { if (this.game) { audio.unlock(); this.game.creatures.attack(); } });

    this._bindHold('btnMine', () => this.game?.setMining(true), () => this.game?.setMining(false));
    this._bindHold('btnJump', () => { if (this.game) { this.game.input.jump = true; audio.unlock(); } }, () => { if (this.game) this.game.input.jump = false; });
    this._bindJoystick();
    this._bindTouchLook();
    this._bindDesktopMouse();

    addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Escape') {
        if (!$('dialogOverlay').hidden) { this.closeDialog(); event.preventDefault(); return; }
        if (this.game) { this.game.paused ? this.closePause() : this.openPause(); event.preventDefault(); }
        return;
      }
      if (!this.game || event.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      audio.unlock(); this.game.keyDown(event.code);
    });
    addEventListener('keyup', (event) => { this.game?.keyUp(event.code); });
    addEventListener('blur', () => { this.game?.setMining(false); if (this.game) this.game.input.jump = false; });

    $('chatForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('chatInput'), message = input.value.trim().slice(0, 120);
      if (!message) return;
      input.value = '';
      this.addChat('أنا', message);
      this.lan?.send({ type: 'chat', text: message });
    });
  }

  _wireDialogs() {
    $('dialogClose').addEventListener('click', () => this.closeDialog());
    $('dialogOverlay').addEventListener('pointerdown', (event) => { if (event.target === $('dialogOverlay')) this.closeDialog(); });
    $('dialog').addEventListener('click', (event) => event.stopPropagation());
  }

  _installPrompt() {
    addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); this._offerPrompt = event; $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', async () => {
      if (!this._offerPrompt) { this.toast('من Chrome اختار ⋮ ثم Add to Home screen.', ''); return; }
      this._offerPrompt.prompt(); await this._offerPrompt.userChoice.catch(() => {}); this._offerPrompt = null; $('btnInstall').hidden = true;
    });
  }

  _bindHold(id, down, up) {
    const button = $(id);
    const release = (event) => { if (event) event.preventDefault(); up(); button.classList.remove('held'); };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault(); event.stopPropagation(); down(); button.classList.add('held');
      try { button.setPointerCapture(event.pointerId); } catch { /* no capture required */ }
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  _bindJoystick() {
    const base = $('stickBase'), knob = $('stickKnob');
    const move = (event) => {
      if (!this.game || this._joystickPointer !== event.pointerId) return;
      const rect = base.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = event.clientX - cx, dy = event.clientY - cy;
      const max = rect.width * 0.32, length = Math.hypot(dx, dy);
      if (length > max) { dx *= max / length; dy *= max / length; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.game.input.strafe = dx / max;
      this.game.input.forward = -dy / max;
    };
    const end = (event) => {
      if (this._joystickPointer !== event.pointerId) return;
      this._joystickPointer = null; base.classList.remove('active');
      knob.style.transform = 'translate(-50%,-50%)';
      if (this.game) { this.game.input.strafe = 0; this.game.input.forward = 0; }
    };
    base.addEventListener('pointerdown', (event) => {
      event.preventDefault(); event.stopPropagation(); audio.unlock();
      this._joystickPointer = event.pointerId; base.classList.add('active');
      try { base.setPointerCapture(event.pointerId); } catch { /* optional */ }
      move(event);
    });
    base.addEventListener('pointermove', move); base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end); base.addEventListener('lostpointercapture', end);
  }

  _bindTouchLook() {
    const area = $('lookArea');
    area.addEventListener('pointerdown', (event) => {
      if (!this.game || event.pointerType !== 'touch' || event.clientX < innerWidth * 0.34) return;
      event.preventDefault(); this._lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try { area.setPointerCapture(event.pointerId); } catch { /* optional */ }
    });
    area.addEventListener('pointermove', (event) => {
      const p = this._lookPointer;
      if (!p || p.id !== event.pointerId || !this.game) return;
      event.preventDefault();
      const dx = event.clientX - p.x, dy = event.clientY - p.y;
      p.x = event.clientX; p.y = event.clientY; this.game.look(dx, dy);
    });
    const end = (event) => { if (this._lookPointer?.id === event.pointerId) this._lookPointer = null; };
    area.addEventListener('pointerup', end); area.addEventListener('pointercancel', end); area.addEventListener('lostpointercapture', end);
  }

  _bindDesktopMouse() {
    const canvas = this.renderer?.domElement;
    if (!canvas) return;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.game || event.pointerType !== 'mouse') return;
      if (event.button === 0) {
        this.game.setMining(true);
        if (document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock();
      } else if (event.button === 2) this.game.place();
    });
    addEventListener('pointerup', (event) => { if (event.pointerType === 'mouse' && event.button === 0) this.game?.setMining(false); });
    addEventListener('mousemove', (event) => {
      if (this.game && document.pointerLockElement === canvas) this.game.look(event.movementX, event.movementY);
    });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) this.game?.setMining(false); });
  }

  openDialog(title, html, options = {}) {
    if (this.game && !this.game.paused) { this.game.paused = true; this.modalWasRunning = true; }
    $('dialogTitle').textContent = title;
    $('dialogBody').innerHTML = html;
    $('dialogOverlay').hidden = false;
    $('dialogBody').scrollTop = 0;
    options.after?.();
  }

  closeDialog() {
    $('dialogOverlay').hidden = true;
    if (this.modalWasRunning && this.game) this.game.paused = false;
    this.modalWasRunning = false;
    this.game?.updateHud(true);
  }

  openPause() {
    if (!this.game) return;
    this.saveActiveWorld(); this.game.paused = true;
    $('pauseWorldName').textContent = this.game.record.name || 'عالمك باقي كيتسناك.';
    $('pauseOverlay').hidden = false;
    document.exitPointerLock?.();
  }

  closePause() {
    if (!this.game) return;
    $('pauseOverlay').hidden = true; this.game.paused = false; audio.unlock();
  }

  openNewWorld() {
    const html = `
      <form id="newWorldForm" class="form-stack">
        <div class="form-row"><label for="worldName">اسم العالم</label><input id="worldName" name="name" maxlength="30" value="عالمي الجديد" required></div>
        <div class="form-row"><label for="worldSeed">Seed (اختياري)</label><input id="worldSeed" name="seed" maxlength="36" placeholder="خليه خاوي لعالم عشوائي"><small>نفس الـ Seed كيعطي نفس التضاريس عندك وعند صاحبك.</small></div>
        <div class="form-grid">
          <div class="form-row"><label for="worldMode">نمط اللعب</label><select id="worldMode" name="mode"><option value="survival">بقاء — صحة وجوع وموارد</option><option value="creative">إبداع — بناء حر ومخزون كامل</option></select></div>
          <div class="form-row"><label for="worldDifficulty">الصعوبة</label><select id="worldDifficulty" name="difficulty"><option value="peaceful">هادئ — بلا وحوش</option><option value="normal" selected>عادي</option><option value="hard">صعب — ضرر أكبر</option></select></div>
        </div>
        <div class="lan-notice">العالم كيتخزن محلياً فهاد الجهاز. تقدر تلعب أوفلاين وتبدل الصعوبة والنمط فكل عالم.</div>
        <div class="form-actions"><button class="primary-btn" type="submit">✦ بدا العالم</button><button class="secondary-btn" type="button" id="cancelWorld">إلغاء</button></div>
      </form>`;
    this.openDialog('عالم جديد', html, { after: () => {
      $('newWorldForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const record = newWorldRecord({ name: form.get('name'), seed: form.get('seed'), mode: form.get('mode'), difficulty: form.get('difficulty') });
        this.closeDialog(); this.startWorld(record, 'solo');
      });
      $('cancelWorld').addEventListener('click', () => this.closeDialog());
    } });
  }

  refreshMenu() {
    this.worlds = listWorlds();
    const last = this.worlds[0];
    $('continueCard').hidden = !last;
    if (last) {
      $('lastWorldName').textContent = last.name || 'عالمي';
      $('lastWorldMeta').textContent = `Seed ${last.seed} · ${last.mode === 'creative' ? 'Creative' : 'Survival'}`;
    }
  }

  openWorldList() {
    this.worlds = listWorlds();
    const html = this.worlds.length ? `<div class="world-list">${this.worlds.map((w) => `
      <article class="world-list-card"><div class="world-icon">▦</div><div class="world-list-meta"><strong>${esc(w.name || 'عالمي')}</strong><small>Seed ${esc(w.seed)} · ${w.mode === 'creative' ? 'Creative' : 'Survival'} · ${new Date(w.updatedAt || w.createdAt || Date.now()).toLocaleDateString()}</small></div><div class="world-list-actions"><button class="small-action play" data-play="${esc(w.id)}">دخول</button><button class="small-action danger" data-delete="${esc(w.id)}" title="حذف">×</button></div></article>`).join('')}</div>` : '<div class="empty-state">مازال ما صايبتي حتى عالم.<br>بدا بعالم جديد، وغادي يتحفظ هنا بوحدو.</div>';
    this.openDialog('العوالم المحفوظة', html, { after: () => {
      $('dialogBody').querySelectorAll('[data-play]').forEach((button) => button.addEventListener('click', () => {
        const world = this.worlds.find((w) => w.id === button.dataset.play); if (world) { this.closeDialog(); this.startWorld(world, 'solo'); }
      }));
      $('dialogBody').querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', () => {
        const world = this.worlds.find((w) => w.id === button.dataset.delete);
        if (world && confirm(`حذف العالم "${world.name}"؟ هاد العملية مايمكنش ترجع.`)) { deleteWorld(world.id); this.openWorldList(); this.refreshMenu(); }
      }));
    } });
  }

  startWorld(record, role = 'solo') {
    if (!this.renderer) { this.toast('هاد الجهاز ما كيدعمش WebGL. جرّب تحديث المتصفح.', ''); return; }
    $('loadingCover').classList.remove('hide'); $('loadingCover').style.display = 'flex';
    this.closeDialog();
    if (this.game) { this.game.dispose(); this.game = null; }
    const normalised = { ...record, mode: record.mode || 'survival', difficulty: record.difficulty || 'normal', seed: String(record.seed || Math.floor(Math.random() * 99999999)) };
    this.game = new SandboxGame(this, normalised, role);
    this.lanRole = role;
    $('menu').hidden = true; $('game').hidden = false; $('pauseOverlay').hidden = true;
    this.updateHotbar(); this.updateHud(true);
    $('chatPanel').hidden = true; this.chatOpen = false;
    $('btnChat').hidden = !(this.lan && this.lanConnected);
    $('btnChat').classList.toggle('active', false);
    this.refreshMenu();
    document.exitPointerLock?.();
    setTimeout(() => { $('loadingCover').classList.add('hide'); }, 120);
    this.saveActiveWorld();
    if (role === 'guest') this.lan?.send({ type: 'ready', player: this.game.serializePlayer() });
  }

  showMenu() {
    if (this.game) { this.game.dispose(); this.game = null; }
    $('pauseOverlay').hidden = true; $('game').hidden = true; $('menu').hidden = false;
    $('chatPanel').hidden = true; $('dialogOverlay').hidden = true;
    this.refreshMenu();
  }

  saveActiveWorld() {
    if (!this.game) return;
    const snapshot = this.game.serializeWorld();
    Object.assign(this.game.record, snapshot);
    try { saveWorld(this.game.record); } catch (error) { console.warn('World save failed', error); }
    this.worlds = listWorlds();
  }

  updateHotbar() {
    if (!this.game || $('game').hidden) return;
    const host = $('hotbar'); host.innerHTML = '';
    this.game.inventory.slots.forEach((id, slot) => {
      const item = ITEM_BY_ID.get(id);
      const button = document.createElement('button');
      button.type = 'button'; button.className = `hotbar-slot${this.game.inventory.selected === slot ? ' selected' : ''}`;
      button.setAttribute('aria-label', item ? `${item.name}, ${this.game.inventory.getCount(id)}` : `Slot ${slot + 1}`);
      button.innerHTML = `<span class="slot-number">${slot + 1}</span>${item ? `<span class="slot-icon">${item.emoji}</span><span class="slot-count">${this.game.record.mode === 'creative' ? '∞' : this.game.inventory.getCount(id)}</span>` : ''}`;
      button.addEventListener('click', () => { this.game.inventory.selectSlot(slot); this.game.updateHeldItem(); });
      host.appendChild(button);
    });
    const selected = this.game.inventory.selectedItem();
    $('selectedHint').textContent = selected ? `${selected.emoji} ${selected.name} · ${this.game.record.mode === 'creative' ? '∞' : this.game.inventory.getCount(selected.id)}  |  E الحقيبة · F هجوم · Space قفز` : 'E الحقيبة · WASD للحركة · Space للقفز';
    this.game.updateHeldItem();
  }

  updateHud(force = false) {
    if (!this.game || $('game').hidden) return;
    const p = this.game.player;
    $('healthFill').style.width = `${p.health / 20 * 100}%`;
    $('hungerFill').style.width = `${p.hunger / 20 * 100}%`;
    $('healthText').textContent = `${Math.ceil(p.health)}`; $('hungerText').textContent = `${Math.ceil(p.hunger)}`;
    $('timeText').textContent = this.game.formatTime();
    $('weatherIcon').textContent = this.game.isNight ? '☾' : '☀';
    $('coordsText').hidden = !this.settings.showCoordinates;
    if (this.settings.showCoordinates) $('coordsText').textContent = `X ${Math.floor(p.pos.x)} · Y ${Math.floor(p.pos.y)} · Z ${Math.floor(p.pos.z)}  ·  ${biomeNames[this.game.biome] || 'عالم'}`;
    const hit = this.game.target;
    if (hit) { $('targetBadge').hidden = false; $('targetBadge').textContent = `${itemEmoji(hit.id)} ${itemName(hit.id)}`; }
    else $('targetBadge').hidden = true;
    if (force) this.updateHotbar();
  }

  setMineProgress(value) {
    $('mineMeter').hidden = value <= 0;
    $('mineProgress').style.width = `${Math.round(value * 100)}%`;
  }

  toast(message, mode = '') {
    const node = $('toast'); node.textContent = String(message ?? '');
    node.className = `toast${mode === 'quiet' ? ' quiet' : ''} show`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { node.classList.remove('show'); }, mode === 'quiet' ? 1050 : 2300);
  }

  openSettings() {
    const s = this.settings;
    const html = `
      <div class="setting-row"><div class="setting-copy"><strong>مجال الرؤية</strong><small>زاوية الكاميرا (FOV)</small></div><div><input class="setting-control" data-setting="fov" type="range" min="60" max="100" value="${s.fov}"><span class="setting-value" data-value="fov">${s.fov}°</span></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>سرعة النظر</strong><small>حساسية الماوس والسحب</small></div><div><input class="setting-control" data-setting="sensitivity" type="range" min="8" max="42" value="${Math.round(s.sensitivity * 10000)}"><span class="setting-value" data-value="sensitivity">${Math.round(s.sensitivity * 10000)}%</span></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>مسافة الرؤية</strong><small>كتأثر على تفاصيل العالم والأداء</small></div><select class="setting-control select" data-setting="renderDistance"><option value="1" ${s.renderDistance === 1 ? 'selected' : ''}>قريبة · أسرع</option><option value="2" ${s.renderDistance === 2 ? 'selected' : ''}>متوسطة</option><option value="3" ${s.renderDistance === 3 ? 'selected' : ''}>بعيدة</option><option value="4" ${s.renderDistance === 4 ? 'selected' : ''}>بعيدة بزاف · ثقيلة</option></select></div>
      <div class="setting-row"><div class="setting-copy"><strong>جودة الرسوم</strong><small>هبط الجودة إلا كان الهاتف كيسخن</small></div><select class="setting-control select" data-setting="quality"><option value="low" ${s.quality === 'low' ? 'selected' : ''}>اقتصادية</option><option value="balanced" ${s.quality === 'balanced' ? 'selected' : ''}>متوازنة</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>عالية</option></select></div>
      <div class="setting-row"><div class="setting-copy"><strong>إظهار الإحداثيات</strong><small>مكانك الحالي وسط العالم</small></div><label class="choice-pill"><input type="checkbox" data-setting="showCoordinates" ${s.showCoordinates ? 'checked' : ''}> إظهار</label></div>
      <div class="setting-row"><div class="setting-copy"><strong>عكس حركة النظر عمودياً</strong><small>خيار مناسب لبعض اللاعبين</small></div><label class="choice-pill"><input type="checkbox" data-setting="invertY" ${s.invertY ? 'checked' : ''}> عكس</label></div>
      <div class="setting-row"><div class="setting-copy"><strong>مؤثرات صوتية</strong><small>حفر، بناء، أكل وقفز</small></div><label class="choice-pill"><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}> صوت</label></div>
      <div class="setting-row"><div class="setting-copy"><strong>موسيقى هادئة</strong><small>نغمة بسيطة مولّدة داخل اللعبة</small></div><label class="choice-pill"><input type="checkbox" data-setting="music" ${s.music ? 'checked' : ''}> موسيقى</label></div>
      <div class="lan-notice">على الهاتف: العصا اليسرى للحركة، سحب الشاشة للنظر، وأزرار ⛏ و▦ للحفر والبناء.</div>`;
    this.openDialog('الإعدادات', html, { after: () => {
      $('dialogBody').querySelectorAll('[data-setting]').forEach((input) => {
        input.addEventListener('input', () => this._changeSetting(input));
        input.addEventListener('change', () => this._changeSetting(input));
      });
    } });
  }

  _changeSetting(input) {
    const key = input.dataset.setting;
    if (key === 'fov') this.settings.fov = Number(input.value);
    else if (key === 'sensitivity') this.settings.sensitivity = Number(input.value) / 10000;
    else if (key === 'renderDistance') this.settings.renderDistance = Number(input.value);
    else if (key === 'quality') this.settings.quality = input.value;
    else this.settings[key] = input.checked;
    saveSettings(this.settings);
    if (key === 'fov') q('[data-value="fov"]').textContent = `${this.settings.fov}°`;
    if (key === 'sensitivity') q('[data-value="sensitivity"]').textContent = `${Math.round(this.settings.sensitivity * 10000)}%`;
    if (key === 'sound') audio.setEnabled(this.settings.sound);
    if (key === 'music') { audio.unlock(); audio.setMusic(this.settings.music); }
    this.game?.setSettings(this.settings);
    this.game?.updateEnvironment(); this.updateHud(true);
  }

  openInventory() {
    if (!this.game) return;
    this.inventoryTab = 'all'; this.selectedInfoId = this.game.inventory.selectedItem()?.id ?? ITEMS[0].id;
    this._renderInventoryDialog();
  }

  _renderInventoryDialog() {
    const game = this.game; if (!game) return;
    const tabs = [['all', 'الكل'], ['blocks', 'بلوكات'], ['resources', 'موارد'], ['tools', 'أدوات'], ['food', 'أكل']];
    const html = `<div class="inventory-tabs">${tabs.map(([key, name]) => `<button class="inventory-tab ${this.inventoryTab === key ? 'active' : ''}" data-tab="${key}">${name}</button>`).join('')}<button class="inventory-tab" data-open-craft>⚒ الصناعة</button><button class="inventory-tab" data-open-catalog>📖 الدليل</button></div>
      <div class="inventory-layout"><div id="inventoryGrid" class="inventory-grid"></div><aside id="itemInfo" class="item-info"></aside></div>
      <div class="inventory-footer"><span>${game.record.mode === 'creative' ? 'Creative · موارد غير محدودة' : 'المخزون كيتخزن تلقائياً'}</span><button class="small-action" data-close-inventory>رجوع للعالم</button></div>`;
    this.openDialog('الحقيبة والموارد', html, { after: () => {
      $('dialogBody').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.inventoryTab = b.dataset.tab; this._renderInventoryDialog(); }));
      q('[data-open-craft]').addEventListener('click', () => this.openCrafting());
      q('[data-open-catalog]').addEventListener('click', () => this.openCatalog());
      q('[data-close-inventory]').addEventListener('click', () => this.closeDialog());
      this._populateInventory();
    } });
  }

  _populateInventory() {
    if (!this.game) return;
    const inventory = this.game.inventory;
    let list = ITEMS.filter((item) => this.game.record.mode === 'creative' || inventory.getCount(item.id) > 0);
    if (this.inventoryTab !== 'all') list = list.filter((item) => item.category === this.inventoryTab);
    const grid = $('inventoryGrid');
    if (!grid) return;
    grid.innerHTML = list.map((item) => `<button class="inventory-card ${this.selectedInfoId === item.id ? 'is-selected' : ''}" data-item="${item.id}"><span class="info-dot">ⓘ</span><span class="item-emoji">${item.emoji}</span><span class="item-name">${esc(item.name)}</span><span class="item-count">${this.game.record.mode === 'creative' ? '∞' : inventory.getCount(item.id)}</span></button>`).join('') || '<div class="empty-state">ما عندك حتى غرض فهاد المجموعة دابا.</div>';
    grid.querySelectorAll('[data-item]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.item); this.selectedInfoId = id;
      if (inventory.getCount(id) || this.game.record.mode === 'creative') inventory.selectItem(id);
      this._populateInventory(); this.updateHotbar();
    }));
    const item = ITEM_BY_ID.get(this.selectedInfoId) || list[0];
    if (item) {
      const info = DESCRIPTIONS[item.id] || (item.block ? `${item.name}: بلوك قابل للبناء. جرّب تحفره أو استعمله فالوصفات.` : `${item.name}: مورد أو أداة كتدخل فالصناعة والاستكشاف.`);
      $('itemInfo').innerHTML = `<span class="info-emoji">${item.emoji}</span><div><h3>${esc(item.name)}</h3><p>${esc(info)}</p></div>`;
    } else $('itemInfo').innerHTML = '<p>ختار غرض باش تشوف المعلومات ديالو.</p>';
  }

  _hasKilnNearby() {
    if (!this.game) return false;
    const p = this.game.player.pos;
    for (let y = Math.floor(p.y - 1); y <= Math.floor(p.y + 2); y++) for (let x = Math.floor(p.x - 3); x <= Math.floor(p.x + 3); x++) for (let z = Math.floor(p.z - 3); z <= Math.floor(p.z + 3); z++) {
      if (this.game.world.getBlock(x, y, z) === ID.FURNACE) return true;
    }
    return false;
  }

  openCrafting() {
    if (!this.game) return;
    const game = this.game;
    const html = `<div class="inventory-tabs"><button class="inventory-tab active" data-back-inv>▤ الحقيبة</button><button class="inventory-tab" data-open-catalog>📖 دليل الموارد</button></div><div class="recipe-list">${RECIPES.map((recipe) => {
      const output = Object.entries(recipe.output).map(([id, count]) => `${itemEmoji(id)} ${itemName(id)} ×${count}`).join('، ');
      const needs = Object.entries(recipe.input).map(([id, count]) => `${itemEmoji(id)} ${itemName(id)} ×${count}`).join('، ');
      const kilnNeeded = recipe.category === 'smelt' && !this._hasKilnNearby();
      const canPay = game.inventory.canPay(recipe.input) && !kilnNeeded;
      return `<article class="recipe-card"><div class="recipe-top"><strong>${esc(recipe.name)}</strong><span class="recipe-type">${recipe.category === 'smelt' ? 'صهر' : 'صناعة'}</span></div><div class="recipe-needs">${esc(needs)}<br><b>⬅ ${esc(output)}</b>${recipe.note ? `<br><small>${esc(recipe.note)}</small>` : ''}</div><button class="small-action" data-craft="${esc(recipe.id)}" ${canPay ? '' : 'disabled'}>${kilnNeeded ? 'خصك فرن قريب' : canPay ? 'صنع الوصفة' : 'المواد ناقصة'}</button></article>`;
    }).join('')}</div>`;
    this.openDialog('الصناعة والوصفات', html, { after: () => {
      q('[data-back-inv]').addEventListener('click', () => this.openInventory());
      q('[data-open-catalog]').addEventListener('click', () => this.openCatalog());
      $('dialogBody').querySelectorAll('[data-craft]').forEach((button) => button.addEventListener('click', () => {
        const recipe = RECIPES.find((r) => r.id === button.dataset.craft); if (!recipe) return;
        if (recipe.category === 'smelt' && !this._hasKilnNearby()) { this.toast('حطّ الفرن قريب ليك باش تصهر الموارد.', ''); return; }
        if (!game.inventory.pay(recipe.input)) { this.toast('ما عندكش الموارد الكافية.', ''); return; }
        for (const [id, count] of Object.entries(recipe.output)) game.inventory.add(Number(id), count);
        audio.craft(); this.toast(`صايبتي: ${recipe.name}`, ''); this.openCrafting();
      }));
    } });
  }

  openCatalog(searchText = '') {
    const html = `<div class="catalog-search"><input id="catalogSearch" placeholder="قلّب على بلوك، مورد أو أداة…" value="${esc(searchText)}"></div><div id="catalogGrid" class="catalog-grid"></div><div class="inventory-footer"><span>${ITEMS.length} عنصر فدليل العالم</span><button class="small-action" data-back-inv>رجوع للحقيبة</button><button class="small-action" data-open-craft>الوصفات</button></div>`;
    this.openDialog('دليل الموارد والمعلومات', html, { after: () => {
      q('[data-back-inv]').addEventListener('click', () => this.openInventory());
      q('[data-open-craft]').addEventListener('click', () => this.openCrafting());
      const search = $('catalogSearch');
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        const results = ITEMS.filter((item) => `${item.name} ${item.key}`.toLowerCase().includes(q));
        $('catalogGrid').innerHTML = results.map((item) => `<article class="catalog-card"><div class="catalog-title"><span>${item.emoji}</span><b>${esc(item.name)}</b></div><p>${esc(DESCRIPTIONS[item.id] || (item.block ? 'بلوك قابل للوضع والتكسير ضمن عالمك.' : 'مورد للصناعة أو أداة للاستكشاف.'))}</p></article>`).join('') || '<div class="empty-state">ما لقيناش هاد العنصر.</div>';
      };
      search.addEventListener('input', fill); fill();
    } });
  }

  openLanDialog(role) {
    if (role === 'host' && !this.game) { this.toast('دخل لعالمك أولاً، ومن قائمة الإيقاف اختار استضافة LAN.', ''); return; }
    this.closeLan(); this.lanRole = role; this.lanConnected = false;
    let body = '';
    if (role === 'host') {
      body = `<div id="lanStatus" class="lan-status">كنحضّر كود الاستضافة…</div><div class="form-row"><label>1 · صيفط هاد Offer لصاحبك</label><textarea id="offerCode" class="lan-textarea" readonly></textarea><button id="copyOffer" class="small-action">نسخ الكود</button></div><div class="form-row" style="margin-top:14px"><label>2 · لصق Answer ديالو هنا</label><textarea id="answerCode" class="lan-textarea" placeholder="NEURIO-LAN:…"></textarea><button id="acceptAnswer" class="primary-btn">تّاصل باللاعب</button></div><div class="lan-notice" style="margin-top:12px">خاص الجهازين يكونو على نفس شبكة Wi‑Fi. تبادل الكود يدوي، وما كاين لا سيرفر ولا حساب.</div>`;
    } else {
      body = `<div id="lanStatus" class="lan-status">لصق Offer ديال اللاعب اللي استضاف العالم.</div><div class="form-row"><label>1 · كود Offer ديال المضيف</label><textarea id="offerCode" class="lan-textarea" placeholder="NEURIO-LAN:…"></textarea><button id="createAnswer" class="primary-btn">صايب Answer</button></div><div id="answerStep" hidden class="form-row" style="margin-top:14px"><label>2 · رجّع هاد Answer للمضيف</label><textarea id="answerCode" class="lan-textarea" readonly></textarea><button id="copyAnswer" class="small-action">نسخ الكود</button></div><div class="lan-notice" style="margin-top:12px">LAN مباشر عبر WebRTC. ما كاينش لعب عام عبر الإنترنت أو سيرفر matchmaking فهاد النسخة.</div>`;
    }
    this.openDialog(role === 'host' ? 'استضافة عالم عبر LAN' : 'دخول عالم عبر LAN', body, { after: () => {
      try {
        this.lan = new LanConnection({
          onMessage: (message) => this._onLanMessage(message),
          onStatus: (state, text) => this._lanStatus(state, text),
          onOpen: () => this._onLanOpen(role),
        });
      } catch (error) { this._lanStatus('failed', error.message); return; }
      if (role === 'host') {
        this.lan.role = 'host';
        this.lan.createHostOffer().then((code) => { if ($('offerCode')) $('offerCode').value = code; }).catch((error) => this._lanStatus('failed', error.message));
        $('acceptAnswer').addEventListener('click', async () => {
          const btn = $('acceptAnswer'); btn.disabled = true;
          try { await this.lan.acceptAnswer($('answerCode').value); }
          catch (error) { this._lanStatus('failed', error.message); btn.disabled = false; }
        });
        $('copyOffer').addEventListener('click', () => this.copyCode($('offerCode').value));
      } else {
        $('createAnswer').addEventListener('click', async () => {
          const btn = $('createAnswer'); btn.disabled = true;
          try {
            const code = await this.lan.createJoinAnswer($('offerCode').value);
            $('answerCode').value = code; $('answerStep').hidden = false;
          } catch (error) { this._lanStatus('failed', error.message); btn.disabled = false; }
        });
        $('copyAnswer').addEventListener('click', () => this.copyCode($('answerCode').value));
      }
    } });
  }

  _lanStatus(state, text) {
    this.lanConnected = state === 'connected';
    const el = $('lanStatus');
    if (el) { el.className = `lan-status ${state}`; el.textContent = text; }
    $('btnChat').hidden = !this.lanConnected || !this.game;
    if (state === 'connected') this.toast('LAN تّاصل مباشرة بين الجهازين.', '');
  }

  _onLanOpen(role) {
    if (role === 'host' && this.game) this.lan?.send({ type: 'init', world: this.game.serializeWorld() });
    if (role === 'guest') this.toast('تّاصلنا بالمضيف. كنتسناو العالم…', '');
  }

  _onLanMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' && this.lanRole === 'guest' && message.world?.seed) {
      const hostWorld = message.world;
      const local = { ...hostWorld, id: `lan-${hashSeed(hostWorld.seed)}`, name: `${hostWorld.name || 'عالم LAN'}`, hostPosition: hostWorld.position, position: null };
      this.startWorld(local, 'guest');
      this.toast('دخلتي للعالم. البناء والتكسير كيتشاركو عبر LAN.', '');
      return;
    }
    if (!this.game) return;
    if (message.type === 'block' && [message.x, message.y, message.z, message.id].every(Number.isInteger)) {
      if (message.y >= 0 && message.y < 64 && message.id >= 0 && message.id < 72) this.game.world.setBlock(message.x, message.y, message.z, message.id, true);
    } else if (message.type === 'player') this.game.setRemoteState(message);
    else if (message.type === 'chat' && typeof message.text === 'string') this.addChat('لاعب LAN', message.text.slice(0, 120));
    else if (message.type === 'ready') this.toast('اللاعب الآخر دخل للعالم.', '');
  }

  onBlockChange(patch) { this.lan?.send({ type: 'block', ...patch }); }

  sendPlayerState(dt) {
    if (!this.lan || !this.lanConnected || !this.game) return;
    this.playerSendClock += dt;
    if (this.playerSendClock < 0.12) return;
    this.playerSendClock = 0;
    const p = this.game.player;
    this.lan.send({ type: 'player', position: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw });
  }

  closeLan() {
    if (this.lan) this.lan.close();
    this.lan = null; this.lanConnected = false; this.lanRole = null;
    $('btnChat').hidden = true; $('chatPanel').hidden = true;
  }

  async copyCode(value) {
    if (!value) { this.toast('الكود باقي كيتوجد.', ''); return; }
    try { await navigator.clipboard.writeText(value); this.toast('تنسخ الكود. صيفطو لصاحبك.', ''); }
    catch {
      const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); this.toast('تنسخ الكود. صيفطو لصاحبك.', ''); }
      catch { this.toast('حدّد الكود ونسخو يدوياً.', ''); }
      area.remove();
    }
  }

  toggleChat() {
    this.chatOpen = !this.chatOpen; $('chatPanel').hidden = !this.chatOpen;
    if (this.chatOpen) $('chatInput').focus();
  }

  addChat(sender, text) {
    const row = document.createElement('div'); row.className = 'chat-message';
    const name = document.createElement('b'); name.textContent = `${sender}: `;
    row.append(name, document.createTextNode(String(text).slice(0, 120)));
    $('chatMessages').appendChild(row); $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch { /* mobile browser can refuse fullscreen */ }
  }
}

const app = new NeurioApp();
window.NEURIO = app;
