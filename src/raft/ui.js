import { HOTBAR, ITEMS, RECIPES, canAfford, objective } from './rules.js';
import { icon, itemIcon, hydrateIcons } from './icons.js';
import { SEA_STATES } from './waves.js';

const $ = id => document.getElementById(id);
export class UI {
  constructor(game) {
    this.game = game;
    this.panel = null;
    this.modal = null;
    this.tipDismissed = false;
    this.inventorySignature = '';
    this.objectiveSignature = '';
    this.lastFocus = null;
    hydrateIcons();
    if (matchMedia('(pointer: coarse)').matches) $('first-hint').querySelector('span:nth-child(2)').innerHTML = 'The ocean provides. <b>Tap floating supplies to collect.</b>';
    $('hotbar').innerHTML = HOTBAR.map(tool => `<button class="tool-slot${tool.id === 'hook' ? ' active' : ''}" data-tool="${tool.id}" title="${tool.name} (${tool.key}) — ${tool.hint}" aria-label="${tool.name}, key ${tool.key}" aria-pressed="${tool.id === 'hook'}"><span class="tool-key">${tool.key}</span>${itemIcon(tool.icon)}${tool.item ? `<span class="tool-quantity" data-count="${tool.item}">3</span>` : ''}</button>`).join('');
    $('hotbar').addEventListener('click', event => {
      const button = event.target.closest('[data-tool]');
      if (button) game.selectTool(button.dataset.tool);
    });
    $('sound-button').onclick = () => game.toggleSound();
    $('help-button').onclick = () => this.showModal('help');
    $('pause-button').onclick = () => this.showModal('pause');
    $('view-button').onclick = () => game.setCameraMode(game.cameraMode === 'deck' ? 'orbit' : 'deck');
    $('island-course').onclick = () => game.startCourse();
    $('build-button').onclick = () => game.selectTool(game.tool === 'hammer' ? 'hook' : 'hammer');
    $('inventory-button').onclick = () => this.togglePanel('inventory');
    $('craft-guide').onclick = () => this.openPanel('crafting');
    $('close-panel').onclick = () => this.closePanel();
    $('inventory-tab').onclick = () => this.openPanel('inventory');
    $('crafting-tab').onclick = () => this.openPanel('crafting');
    $('cancel-build').onclick = () => game.selectTool('hook');
    $('dismiss-hint').onclick = () => this.dismissTip();
    $('exit-photo').onclick = () => game.photoMode(false);
    $('touch-action').onclick = () => game.action();
    $('inventory-grid').addEventListener('click', event => {
      const key = event.target.closest('[data-item]')?.dataset.item;
      if (!key) return;
      if (key === 'water' || key === 'food') game.consume(key);
      else this.toast(ITEMS[key].description, 'info');
    });
    $('recipe-list').addEventListener('click', event => {
      const button = event.target.closest('[data-recipe]');
      if (button) game.chooseRecipe(button.dataset.recipe);
    });
    $('modal-overlay').addEventListener('click', event => {
      if (event.target === $('modal-overlay') && this.modal !== 'gameover' && this.modal !== 'restart') this.closeModal();
    });
    $('modal').addEventListener('keydown', event => this.trapFocus(event));
    this.update();
  }

  selectTool(tool) {
    for (const button of document.querySelectorAll('[data-tool]')) {
      const selected = button.dataset.tool === tool.id;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    }
    $('selected-tool').textContent = tool.name.toUpperCase();
    $('touch-action').innerHTML = tool.id === 'hammer' ? icon('plus', 26) : itemIcon(tool.icon, 31);
    $('touch-action').setAttribute('aria-label', `Use ${tool.name.toLowerCase()}`);
    $('first-hint').hidden = tool.id !== 'hook' || this.tipDismissed;
    $('build-button').classList.toggle('selected', tool.id === 'hammer');
  }

  dismissTip() { this.tipDismissed = true; $('first-hint').hidden = true; }

  update() {
    const state = this.game.state;
    for (const stat of ['health', 'thirst', 'hunger']) {
      const value = Math.ceil(state.stats[stat]);
      $(`${stat}-value`).innerHTML = `${value} <small>/ 100</small>`;
      $(`${stat}-bar`).style.width = `${state.stats[stat]}%`;
      $(`${stat}-bar`).closest('.vital-row').classList.toggle('low', value < 25);
    }
    for (const item of ['water', 'food']) document.querySelector(`[data-count="${item}"]`).textContent = state.inventory[item];
    const chapter = objective(state), signature = JSON.stringify(chapter);
    if (signature !== this.objectiveSignature) {
      const previous = this.objectiveSignature ? JSON.parse(this.objectiveSignature) : null;
      if (previous && previous.chapter !== chapter.chapter) this.toast(`Chapter ${chapter.chapter} unlocked. ${chapter.name}`, 'success');
      $('chapter-number').textContent = chapter.chapter;
      $('chapter-title').textContent = chapter.name;
      $('chapter-description').textContent = chapter.description;
      $('chapter-tasks').innerHTML = chapter.tasks.map(task => `<div class="chapter-task ${task.current >= task.goal ? 'done' : ''}"><span class="task-check">${task.current >= task.goal ? icon('check', 10) : ''}</span><span class="task-label">${task.label}</span><span class="task-count"><b>${task.current}</b> / ${task.goal}</span></div>`).join('');
      this.objectiveSignature = signature;
    }
    const totalMinutes = 522 + Math.floor(state.elapsed);
    const hour = Math.floor(totalMinutes / 60) % 24, minute = totalMinutes % 60;
    $('day-label').textContent = `DAY ${String(Math.floor(totalMinutes / 1440) + 1).padStart(2, '0')}`;
    $('day-time').innerHTML = `${String(hour % 12 || 12).padStart(2, '0')}:${String(minute).padStart(2, '0')} <small>${hour < 12 ? 'AM' : 'PM'}</small>`;
    const north = Math.floor(14 - state.travel.z * 0.012), west = Math.floor(8 - state.travel.x * 0.012);
    $('coordinates').textContent = `26° ${String(((north % 60) + 60) % 60).padStart(2, '0')}′ N   142° ${String(((west % 60) + 60) % 60).padStart(2, '0')}′ W`;
    $('sound-button').innerHTML = icon(state.settings.sound ? 'sound' : 'muted');
    $('sound-button').setAttribute('aria-label', state.settings.sound ? 'Mute ocean sound' : 'Enable ocean sound');
    $('sound-button').setAttribute('aria-pressed', String(state.settings.sound));
    $('sea-description').textContent = (SEA_STATES[state.settings.sea] || SEA_STATES.rolling).description;
    const cove = this.game.world?.islands[0];
    if (cove) {
      const distance = Math.hypot(cove.x - state.travel.x, cove.z - state.travel.z);
      const arrived = distance < cove.radius * 1.15 + 6;
      $('island-distance').textContent = `${Math.ceil(Math.max(0, distance - cove.radius))} m`;
      $('course-label').textContent = this.game.course ? 'Cancel course' : arrived ? 'At the cove' : 'Set course';
      $('island-course').classList.toggle('underway', !!this.game.course);
      $('island-course').setAttribute('aria-pressed', String(!!this.game.course));
    }
    if (this.panel) this.renderInventory();
    this.drawMinimap();
  }

  updateViewButton() {
    const deck = this.game.cameraMode === 'deck';
    $('view-button-label').textContent = deck ? 'Raft overview' : 'Step aboard';
    $('view-hint').textContent = deck ? 'V returns to overview' : 'Scroll to zoom';
    $('view-button').setAttribute('aria-label', deck ? 'Switch to raft overview' : 'Switch to first-person deck view');
    $('view-button').setAttribute('aria-pressed', String(deck));
    $('view-button').classList.toggle('selected', deck);
  }

  updateCompass(angle) {
    const bearing = Math.round(((-angle * 180 / Math.PI) % 360 + 360) % 360);
    if (bearing === this.compassBearing) return;
    this.compassBearing = bearing;
    const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
    $('compass-heading').textContent = cardinal;
    $('compass-bearing').textContent = `${String(bearing).padStart(3, '0')}°`;
    const neighbors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    const labels = document.querySelectorAll('.compass-directions span');
    [-2, -1, 1, 2].forEach((offset, i) => labels[i].textContent = neighbors[(index + offset + 8) % 8]);
  }

  drawMinimap() {
    if (!this.game.world) return;
    const ctx = $('minimap').getContext('2d'), state = this.game.state;
    ctx.clearRect(0, 0, 260, 260); ctx.save(); ctx.translate(130, 130);
    ctx.beginPath(); ctx.arc(0, 0, 107, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(187,213,185,.11)'; ctx.lineWidth = 1;
    for (let y = -100; y <= 100; y += 23) {
      ctx.beginPath();
      for (let x = -115; x <= 115; x += 4) { const z = y + Math.sin(x * .035 + y) * 3; x === -115 ? ctx.moveTo(x, z) : ctx.lineTo(x, z); }
      ctx.stroke();
    }
    const scale = 1.3;
    for (const island of this.game.world.islands) {
      const x = (island.x - state.travel.x) * scale, y = (island.z - state.travel.z) * scale;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-.5);
      ctx.fillStyle = '#b7c4a1'; ctx.beginPath(); ctx.ellipse(0, 0, island.radius * .87, island.radius * .58, .2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#74947b'; ctx.beginPath(); ctx.ellipse(-1, -1, island.radius * .65, island.radius * .37, .2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#d8d4a177';
    for (const resource of this.game.resources || []) {
      ctx.beginPath(); ctx.arc(resource.position.x * scale, resource.position.z * scale, resource.userData.kind === 'barrel' ? 2.3 : 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#d6d9ab3b'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(34, -94); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#e2d8a7'; ctx.save(); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    ctx.strokeStyle = '#ede5b150'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
    const angle = this.game.cameraAngle || 0;
    ctx.save(); ctx.rotate(-angle); ctx.fillStyle = '#f5eed2'; ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(-4, -15); ctx.lineTo(4, -15); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.restore();
  }

  togglePanel(tab = 'inventory') { if (this.panel === tab) this.closePanel(); else this.openPanel(tab); }
  openPanel(tab) {
    if (this.modal || this.game.photo) return;
    this.panel = tab;
    this.game.clearKeys();
    $('backpack-panel').hidden = false;
    $('interface').classList.add('panel-open');
    $('inventory-view').hidden = tab !== 'inventory'; $('crafting-view').hidden = tab !== 'crafting';
    for (const name of ['inventory', 'crafting']) {
      $(`${name}-tab`).classList.toggle('active', name === tab); $(`${name}-tab`).setAttribute('aria-selected', String(name === tab));
    }
    this.renderInventory(true);
  }
  closePanel() {
    this.panel = null; $('backpack-panel').hidden = true; $('interface').classList.remove('panel-open');
  }
  renderInventory(force = false) {
    const state = this.game.state;
    const signature = JSON.stringify(state.inventory) + state.tiles.length + state.raftHealth;
    $('time-at-sea').textContent = `${Math.floor(state.elapsed / 60)}m ${Math.floor(state.elapsed % 60)}s`;
    if (!force && signature === this.inventorySignature) return;
    this.inventorySignature = signature;
    $('supply-count').textContent = Object.values(state.inventory).reduce((a, b) => a + b, 0);
    $('raft-size').textContent = `${state.tiles.length} tiles`;
    $('raft-condition').textContent = `${Math.ceil(state.raftHealth)}%`;
    $('inventory-grid').innerHTML = Object.entries(ITEMS).map(([key, item]) => `<button class="inventory-item" data-item="${key}" title="${item.description}" aria-label="${item.name}: ${state.inventory[key]}. ${item.description}" ${state.inventory[key] === 0 ? 'disabled' : ''}>${itemIcon(item.icon)}<span>${item.name}</span><b>${state.inventory[key]}</b></button>`).join('');
    $('recipe-list').innerHTML = Object.entries(RECIPES).map(([key, recipe]) => {
      const affordable = canAfford(state, recipe.cost);
      return `<article class="recipe"><div class="recipe-heading">${itemIcon(recipe.icon)}<div><h3>${recipe.name}</h3><p>${recipe.description}</p></div></div><div class="recipe-bottom"><div class="recipe-cost">${Object.entries(recipe.cost).map(([item, count]) => `<span class="${state.inventory[item] < count ? 'missing' : ''}" title="${ITEMS[item].name}: ${state.inventory[item]} / ${count}">${itemIcon(ITEMS[item].icon, 22)}${count}</span>`).join('')}</div><button class="recipe-button" data-recipe="${key}" ${affordable ? '' : 'disabled'} aria-label="${recipe.place ? 'Build' : 'Craft'} ${recipe.name}" title="${affordable ? recipe.place ? 'Choose a place on your raft' : 'Craft now' : 'Collect more supplies to craft'}">${recipe.place ? 'Build' : 'Craft'}${icon('plus', 12)}</button></div></article>`;
    }).join('');
  }

  setBuild(type) {
    $('build-banner').hidden = !type;
    if (!type) return;
    const recipe = RECIPES[type];
    $('build-name').textContent = `Build ${type === 'foundation' ? 'a foundation' : recipe.name.toLowerCase()}`;
    $('build-cost').textContent = Object.entries(recipe.cost).map(([key, count]) => `${count} ${ITEMS[key].name.toLowerCase()}`).join(' · ');
  }

  setWorldLabel(resource, screen) {
    const label = $('world-label');
    if (!resource || !screen || this.game.buildType || this.modal || this.game.photo || screen.z > 1 || screen.x < 150 || screen.x > innerWidth - (this.panel ? 380 : 50) || screen.y < 125 || screen.y > innerHeight - 145) { label.hidden = true; return; }
    label.hidden = false;
    label.style.left = `${screen.x}px`; label.style.top = `${screen.y}px`;
    const kind = resource.userData.kind;
    const name = { wood: 'Driftwood', plastic: 'Plastic bottle', leaf: 'Palm leaves', barrel: 'Floating barrel', crate: 'Lost cargo' }[kind];
    if (this.labelKind !== kind) {
      $('world-label-title').textContent = name;
      $('world-label-icon').innerHTML = itemIcon(kind === 'crate' ? 'foundation' : kind, 29);
      this.labelKind = kind;
    }
    $('world-label-action').textContent = this.game.hook ? 'REELING IT IN…' : matchMedia('(pointer: coarse)').matches ? 'TAP TO REEL IN' : 'CLICK TO REEL IN';
  }

  toast(message, type = 'success', contents = null) {
    const element = document.createElement('div'); element.className = `toast ${type === 'warn' ? 'warn' : ''}`;
    if (contents) element.innerHTML = `${icon('plus', 16)}<div class="toast-gains">${Object.entries(contents).map(([key, amount]) => `<span title="${ITEMS[key].name}">${itemIcon(ITEMS[key].icon, 26)}+${amount}</span>`).join('')}</div>`;
    else { element.innerHTML = icon(type === 'warn' ? 'warning' : type === 'info' ? 'compass' : 'check', 17); const text = document.createElement('span'); text.textContent = message; element.appendChild(text); }
    const container = $('toasts'); container.appendChild(element);
    while (container.children.length > 3) container.firstChild.remove();
    setTimeout(() => { element.classList.add('out'); setTimeout(() => element.remove(), 300); }, contents ? 3300 : 3900);
  }

  showModal(type) {
    this.closePanel();
    if (!this.modal) this.lastFocus = document.activeElement;
    this.modal = type; this.game.setPaused(true); $('modal-overlay').hidden = false;
    const state = this.game.state;
    const close = `<button class="icon-button modal-close" data-modal-action="close" aria-label="Close dialog">${icon('close')}</button>`;
    if (type === 'pause') {
      $('modal-content').innerHTML = `${close}<span class="modal-symbol">${icon('waves', 32)}</span><span class="modal-eyebrow">A MOMENT TO YOURSELF</span><h2 id="modal-title">Take a breath.</h2><p>The tide can wait. Your little world is right where you left it.</p><button class="primary-button" data-modal-action="close">${icon('play', 16)}Back to the ocean</button><button class="secondary-button" data-modal-action="photo">${icon('camera', 17)}Just enjoy the view</button><div class="modal-settings"><div class="setting-row"><span>${icon('sound', 15)}Ocean sounds</span><button class="toggle-button" data-modal-action="sound">${state.settings.sound ? 'On' : 'Off'}</button></div><div class="setting-row"><span>${icon('sun', 15)}Graphics quality</span><button class="toggle-button" data-modal-action="quality">${state.settings.quality === 'high' ? 'High' : 'Light'}</button></div><div class="setting-row"><span>${icon('waves', 15)}Ocean conditions</span><button class="toggle-button" data-modal-action="sea">${(SEA_STATES[state.settings.sea] || SEA_STATES.rolling).label}</button></div><div class="setting-row"><span>${icon('camera', 15)}Viewpoint</span><button class="toggle-button" data-modal-action="view">${this.game.cameraMode === 'deck' ? 'On deck' : 'Overview'}</button></div><div class="setting-row"><span>${icon('expand', 15)}A wider horizon</span><button class="toggle-button" data-modal-action="fullscreen">Fullscreen</button></div><div class="setting-row"><span>${icon('download', 15)}Your raft as a 3D model</span><button class="toggle-button" data-modal-action="export">Get .glb</button></div><div class="setting-row"><span>${icon('download', 15)}Palmwood Cove 3D model</span><button class="toggle-button" data-modal-action="export-island">Get .glb</button></div></div><button class="text-button" data-modal-action="help">A little help? ${icon('chevron', 13)}</button><button class="text-danger" data-modal-action="restart-confirm">Start a new voyage</button><div class="modal-small">Progress saves automatically · An original ocean survival game</div>`;
    } else if (type === 'help') {
      $('modal-content').innerHTML = `${close}<span class="modal-symbol">${icon('compass', 34)}</span><span class="modal-eyebrow">FIND YOUR SEA LEGS</span><h2 id="modal-title">A little know-how.</h2><p>The ocean has everything you need. Rescue supplies, build your home, and take care of yourself.</p><div class="help-controls"><div><span>Walk around your raft</span><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><div><span>Reel in floating supplies</span><span><kbd>Click</kbd> or <kbd>E</kbd></span></div><div><span>Look around / zoom</span><span><kbd>Drag</kbd> / <kbd>Scroll</kbd></span></div><div><span>First-person / raft overview</span><kbd>V</kbd></div><div><span>Set course for Palmwood Cove</span><kbd>G</kbd></div><div><span>Select a tool</span><span><kbd>1</kbd> – <kbd>6</kbd></span></div><div><span>Build / crafting recipes</span><span><kbd>B</kbd> / <kbd>C</kbd></span></div><div><span>Open your backpack</span><kbd>Tab</kbd></div><div><span>Drink / eat</span><span><kbd>5</kbd> / <kbd>6</kbd> then <kbd>E</kbd></span></div><div><span>Steer your raft</span><span><kbd>3</kbd> then <kbd>WASD</kbd></span></div><div><span>Defend against a shark</span><span><kbd>4</kbd> then <kbd>E</kbd></span></div><div><span>Pause / cancel building</span><kbd>Esc</kbd></div></div><p class="help-tip">On touch screens, use the joystick to move, drag the ocean to look, and tap supplies to hook them. Tap the round action button to use your tool.<br><br>Water purifiers make a drink every minute. Growing beds produce food. Visit an island with your paddle for bonus supplies.</p><button class="primary-button" data-modal-action="close">I’m ready for the tide ${icon('arrow', 16)}</button>`;
    } else if (type === 'restart') {
      $('modal-content').innerHTML = `<span class="modal-symbol">${icon('anchor', 32)}</span><span class="modal-eyebrow">A NEW BEGINNING</span><h2 id="modal-title">Another horizon?</h2><p>This will replace your saved raft, supplies, and progress. Your current voyage cannot be recovered.</p><button class="primary-button" data-modal-action="restart">Start a new voyage</button><button class="secondary-button" data-modal-action="pause">Keep my little world</button>`;
    } else if (type === 'gameover') {
      $('modal-content').innerHTML = `<span class="modal-symbol">${icon('waves', 34)}</span><span class="modal-eyebrow">THE OCEAN IS A GOOD TEACHER</span><h2 id="modal-title">A new tide awaits.</h2><p>You spent ${Math.floor(state.elapsed / 60)} minutes at sea and made a home of ${state.tiles.length} foundations. Next time, keep a little food and fresh water in your backpack.</p><button class="primary-button" data-modal-action="restart">Try a new voyage ${icon('arrow', 16)}</button><button class="secondary-button" data-modal-action="export">${icon('download', 16)}Keep my raft as a 3D model</button>`;
    }
    $('modal-content').querySelectorAll('[data-modal-action]').forEach(button => button.onclick = () => this.modalAction(button.dataset.modalAction, button));
    requestAnimationFrame(() => $('modal').focus());
  }

  async modalAction(action, button) {
    if (action === 'close') this.closeModal();
    if (action === 'photo') { this.closeModal(); this.game.photoMode(true); }
    if (action === 'sound') { this.game.toggleSound(); button.textContent = this.game.state.settings.sound ? 'On' : 'Off'; }
    if (action === 'quality') { this.game.toggleQuality(); button.textContent = this.game.state.settings.quality === 'high' ? 'High' : 'Light'; }
    if (action === 'sea') { this.game.cycleSea(); button.textContent = SEA_STATES[this.game.state.settings.sea].label; }
    if (action === 'view') { this.game.setCameraMode(this.game.cameraMode === 'deck' ? 'orbit' : 'deck', false); this.game.save(false); button.textContent = this.game.cameraMode === 'deck' ? 'On deck' : 'Overview'; }
    if (action === 'fullscreen') {
      try {
        if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else throw new Error('Fullscreen unsupported');
      } catch { button.textContent = 'Unavailable'; }
    }
    if (action === 'export' || action === 'export-island') {
      button.disabled = true; const original = button.innerHTML; button.textContent = 'Saving…';
      try { if (action === 'export-island') await this.game.exportIsland(); else await this.game.exportModel(); button.textContent = 'Downloaded'; }
      catch (error) { console.error(error); button.textContent = 'Try again'; }
      finally { button.disabled = false; setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 2500); }
    }
    if (action === 'help' || action === 'pause') this.showModal(action);
    if (action === 'restart-confirm') this.showModal('restart');
    if (action === 'restart') this.game.restart();
  }

  closeModal() {
    if (this.modal === 'gameover') return;
    this.modal = null; $('modal-overlay').hidden = true; this.game.setPaused(false);
    if (this.lastFocus?.isConnected) this.lastFocus.focus({ preventScroll: true });
    this.lastFocus = null;
  }
  trapFocus(event) {
    if (event.key !== 'Tab') return;
    const buttons = [...$('modal').querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
    else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus(); }
  }
}
