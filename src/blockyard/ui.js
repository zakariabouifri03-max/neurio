import { OUTFITS, STAGES, COINS, formatTime } from './rules.js';
import { icon, hydrate } from './icons.js';
const $ = id => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game; this.modal = null; this.lastStage = -1; this.lastCoins = -1;
    hydrate();
    document.querySelectorAll('[data-panel]').forEach(button => button.onclick = () => this.open(button.dataset.panel));
    $('play-tab').onclick = () => { this.close(); game.renderer.domElement.focus({ preventScroll: true }); };
    $('close-modal').onclick = () => this.close();
    $('sound-button').onclick = () => game.toggleSound();
    $('modal-overlay').onclick = e => { if (e.target === $('modal-overlay') && !['win', 'restart'].includes(this.modal)) this.close(); };
    $('modal').addEventListener('keydown', e => this.trapFocus(e));
    this.update(true);
  }
  update(force = false) {
    const state = this.game.state, stage = STAGES[state.checkpoint];
    $('time-value').textContent = formatTime(state.elapsed);
    if (force || this.lastStage !== state.checkpoint) {
      this.lastStage = state.checkpoint;
      $('stage-value').textContent = String(state.checkpoint + 1).padStart(2, '0');
      $('stage-name').textContent = stage.name; $('stage-hint').textContent = stage.hint;
      $('stage-dots').innerHTML = STAGES.map((_, i) => `<span class="stage-dot${i < state.checkpoint ? ' done' : ''}${i === state.checkpoint ? ' current' : ''}"></span>`).join('');
      $('stage-dots').setAttribute('aria-label', `Checkpoint ${state.checkpoint + 1} of ${STAGES.length}`);
    }
    if (force || this.lastCoins !== state.collected.length) {
      this.lastCoins = state.collected.length; $('coins-value').textContent = state.collected.length;
      $('quest-count').textContent = `${state.collected.length} / ${COINS.length}`;
      $('coin-progress').style.width = `${state.collected.length / COINS.length * 100}%`;
    }
    $('mini-shirt').style.background = OUTFITS[state.outfit].shirt;
    $('sound-button').innerHTML = icon(state.sound ? 'sound' : 'mute');
    $('sound-button').setAttribute('aria-label', state.sound ? 'Mute game sound' : 'Enable game sound'); $('sound-button').setAttribute('aria-pressed', String(state.sound));
    this.updateJumps();
  }
  updateJumps() {
    const jumps = this.game.player.jumps;
    $('jump-pip-1').classList.toggle('used', jumps >= 1); $('jump-pip-2').classList.toggle('used', jumps >= 2);
    $('jump-description').textContent = jumps >= 2 ? 'Stick the landing. You’ve got this.' : jumps === 1 ? 'One more jump. A little more sky.' : 'A second jump goes a long way.';
  }
  toast(text, kind = 'check') {
    const div = document.createElement('div'); div.className = `toast${kind === 'reset' ? ' warn' : ''}`;
    const graphic = document.createElement('span'); graphic.innerHTML = icon(kind, 17); div.append(graphic, document.createTextNode(text));
    $('toasts').append(div);
    while ($('toasts').children.length > 2) $('toasts').firstChild.remove();
    setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 260); }, 3200);
  }
  open(type) {
    this.modal = type; this.game.setPaused(true); document.body.classList.add('has-modal');
    $('modal-overlay').hidden = false; $('modal').classList.toggle('avatar-modal', type === 'avatar');
    const state = this.game.state;
    const title = (eyebrow, name, description, symbol = 'cube') => `<span class="modal-emblem ${type === 'win' ? 'win-emblem' : ''}">${icon(symbol, 28)}</span><span class="modal-eyebrow">${eyebrow}</span><h2 id="modal-title">${name}</h2><p class="modal-description">${description}</p>`;
    let html = '';
    if (type === 'pause') {
      html = title('TAKE YOUR TIME', 'The sky can wait.', 'Your next little adventure will be right here.', 'pause') + `<button class="primary" data-action="close">Keep hopping ${icon('play', 15)}</button><div class="settings"><div class="setting"><span>${icon('sound', 17)}Game sound</span><button data-action="sound">${state.sound ? 'On' : 'Off'}</button></div><div class="setting"><span>${icon('spark', 17)}Graphics</span><button data-action="quality">${state.quality === 'high' ? 'Detailed' : 'Light'}</button></div><div class="setting"><span>${icon('mouse', 17)}Camera view</span><button data-action="camera">Reset view</button></div><div class="setting"><span>${icon('flag', 17)}Latest checkpoint</span><button data-action="respawn">Respawn</button></div></div><button class="text-button" data-action="help">${icon('help', 16)} A little help?</button><button class="text-button" data-action="models">${icon('download', 16)} Download the 3D models</button><button class="danger-button" data-action="restart-confirm">Start a fresh adventure</button><p class="modal-note">Single player · Saved on this device${document.documentElement.dataset.standalone ? '' : '<br><a href="drift.html">Looking for the ocean? Open Drift ↗</a>'}</p>`;
    } else if (type === 'avatar') {
      html = `<span class="modal-eyebrow">A LITTLE CHARACTER. A LOT OF YOU.</span><h2 id="modal-title">Meet your new you.</h2><div class="avatar-layout"><div id="avatar-preview" class="avatar-preview" aria-label="Rotating 3D preview of your character"></div><div class="avatar-options"><h3>Pick your happy color.</h3><p>Same adventurous spirit. A fresh little look.</p><div class="outfit-options">${Object.entries(OUTFITS).map(([id, outfit]) => `<button class="outfit-button${state.outfit === id ? ' active' : ''}" data-outfit="${id}" aria-pressed="${state.outfit === id}"><span class="outfit-swatch" style="background:${outfit.shirt}"></span>${outfit.name}</button>`).join('')}</div><button class="primary" data-action="close">Looking good. Let’s go ${icon('arrow', 16)}</button><button class="text-button" data-action="export-avatar">${icon('download', 14)}Download your character</button></div></div><p class="modal-note">Your look saves automatically. All outfits are free.</p>`;
    } else if (type === 'route') {
      html = title('ONE SKY. SIX LITTLE MILESTONES.', 'Your way to the top.', 'Touch down on each island to save a checkpoint. Fall? You’ll land right back at the last one.', 'map') + `<div class="route-list">${STAGES.map((s, i) => `<div class="route-node${i < state.checkpoint ? ' done' : ''}${i === state.checkpoint ? ' current' : ''}"><span class="route-number">${String(i + 1).padStart(2, '0')}</span><div><b>${s.name}</b><small>${s.short}</small></div><span class="route-status">${icon(i < state.checkpoint ? 'check' : i === state.checkpoint ? 'flag' : 'lock', 16)}</span></div>`).join('')}</div><button class="primary" data-action="close">Onwards & upwards ${icon('arrow', 16)}</button>`;
    } else if (type === 'help') {
      html = title('A FEW SMALL POINTERS', 'Find your happy feet.', 'Reach the gold arch, collect sky coins, and make every little leap count.', 'help') + `<div class="help-grid"><div class="help-row"><span>Move around</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><div class="help-row"><span>Jump · press again in the air</span><kbd>Space ×2</kbd></div><div class="help-row"><span>Sprint</span><kbd>Shift</kbd></div><div class="help-row"><span>Look around · zoom</span><span><kbd>Drag</kbd><kbd>Scroll</kbd></span></div><div class="help-row"><span>Back to your checkpoint</span><kbd>R</kbd></div><div class="help-row"><span>Pause · close a menu</span><kbd>Esc</kbd></div></div><div class="help-callout">Blue platforms move. Yellow springs bounce. Coral lava and the pink spinner? Jump over them.<br><br>On a phone, use the joystick and <b>JUMP</b> button. Tap it again while airborne to double jump.</div><button class="primary" data-action="close">Got it. Let’s hop ${icon('arrow', 16)}</button><p class="help-disclaimer">An original blocky parkour game, inspired by the playful style of games like Roblox. Not an official Roblox game; no accounts, Robux, or multiplayer.</p>`;
    } else if (type === 'models') {
      html = title('A LITTLE PIECE OF YOUR WORLD', 'Made to go places.', 'Take your character or the floating course into Blender or a compatible 3D app.', 'download') + `<button class="model-choice" data-action="export-avatar"><span>${icon('shirt', 25)}</span><span><b>Your blocky character</b><small>Your selected outfit · .glb</small></span>${icon('download', 18)}</button><button class="model-choice" data-action="export-world"><span>${icon('cloud', 26)}</span><span><b>The Cloud Hop world</b><small>Islands, obstacles & scenery · .glb</small></span>${icon('download', 18)}</button><p class="modal-note">Original, self-contained glTF 2.0 models.<br>Static geometry and materials. Game code, movement, and animation are not included in the model files.</p>`;
    } else if (type === 'restart') {
      html = title('A BRAND-NEW FIRST STEP', 'One more adventure?', 'This resets your coins, checkpoints, and current run. Your outfit and personal best stay with you.', 'reset') + `<button class="primary" data-action="restart">Start fresh ${icon('arrow', 16)}</button><button class="secondary" data-action="close">Keep my adventure</button>`;
    } else if (type === 'win') {
      html = title('LOOK AT YOU GO', 'The sky is yours.', 'Six islands. A few brave leaps. One very happy little adventurer.', 'trophy') + `<div class="win-stats"><div class="win-stat"><b>${formatTime(state.elapsed)}</b><small>YOUR TIME</small></div><div class="win-stat"><b>${state.collected.length}<span style="font-size:13px"> / ${COINS.length}</span></b><small>SKY COINS</small></div><div class="win-stat"><b>${state.deaths}</b><small>COMEBACKS</small></div></div><p class="best-time">${icon('trophy', 14)} Personal best: ${formatTime(state.best || state.elapsed)}</p><button class="primary" data-action="restart">Another little adventure ${icon('arrow', 17)}</button><button class="secondary" data-action="close">Stay a little longer</button><button class="text-button" data-action="export-avatar">${icon('download', 15)}Keep my character as a 3D model</button>`;
    }
    $('modal-content').innerHTML = html;
    $('modal-content').querySelectorAll('[data-action]').forEach(button => button.onclick = () => this.action(button.dataset.action, button));
    $('modal-content').querySelectorAll('[data-outfit]').forEach(button => button.onclick = () => {
      this.game.changeOutfit(button.dataset.outfit);
      document.querySelectorAll('[data-outfit]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    });
    requestAnimationFrame(() => $('modal').focus({ preventScroll: true }));
  }
  async action(action, button) {
    if (action === 'close') this.close();
    else if (['help', 'models', 'avatar'].includes(action)) this.open(action);
    else if (action === 'sound') { await this.game.toggleSound(); button.textContent = this.game.state.sound ? 'On' : 'Off'; }
    else if (action === 'quality') { this.game.toggleQuality(); button.textContent = this.game.state.quality === 'high' ? 'Detailed' : 'Light'; }
    else if (action === 'camera') { this.game.resetCamera(); button.textContent = 'All set'; }
    else if (action === 'respawn') { this.close(); this.game.respawn(false); }
    else if (action === 'restart-confirm') this.open('restart');
    else if (action === 'restart') { this.close(); this.game.restart(); }
    else if (action.startsWith('export-')) {
      const previous = button.innerHTML; button.disabled = true; button.textContent = 'Putting the blocks together…';
      try { await this.game.exportModel(action === 'export-world' ? 'world' : 'avatar'); button.textContent = 'Downloaded. Happy creating!'; }
      catch (e) { console.error('Model export failed:', e); button.textContent = 'Couldn’t export. Try again.'; }
      finally { button.disabled = false; setTimeout(() => { if (button.isConnected) button.innerHTML = previous; }, 2400); }
    }
  }
  close() {
    this.modal = null; $('modal-overlay').hidden = true; document.body.classList.remove('has-modal'); this.game.setPaused(false);
    this.game.renderer.domElement.focus({ preventScroll: true });
  }
  trapFocus(e) {
    if (e.key !== 'Tab') return;
    const buttons = [...$('modal').querySelectorAll('button:not(:disabled),a[href]')];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (e.shiftKey && index <= 0) { e.preventDefault(); buttons.at(-1).focus(); }
    else if (!e.shiftKey && (index < 0 || index === buttons.length - 1)) { e.preventDefault(); buttons[0].focus(); }
  }
}
