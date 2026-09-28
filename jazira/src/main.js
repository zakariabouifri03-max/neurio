// نقطة البداية — main.js
import { Game } from './game.js';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function pickMode() {
  const q = new URLSearchParams(location.search).get('mode');
  if (q === '2d' || q === '3d') return q;
  let saved = null;
  try { saved = localStorage.getItem('jazira_mode'); } catch (e) { }
  if (saved === '2d' || saved === '3d') return saved;
  return hasWebGL() ? '3d' : '2d';
}

async function makeView(mode) {
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  let shadows = true;
  try { shadows = localStorage.getItem('jazira_shadows') !== '0'; } catch (e) { }
  if (touch) shadows = false;   // أخف فالتيليفون
  if (mode === '3d' && hasWebGL()) {
    try {
      const { View3D } = await import('./view3d.js');
      const v = new View3D({
        shadows,
        pixelRatio: Math.min(window.devicePixelRatio || 1, touch ? 1.35 : 1.6),
      });
      return v;
    } catch (e) {
      console.warn('3D ما خدمش، كنرجعو لـ2D', e);
    }
  }
  const { View2D } = await import('./view2d.js');
  return new View2D();
}

// ?play=1 ولا ?auto=1 → كيتحل اللعب ديريكت (بلا قائمة وبلا شاشة التعليم)
function wantAutoPlay() {
  try {
    const q = new URLSearchParams(location.search);
    for (const k of ['play', 'auto', 'start']) {
      if (!q.has(k)) continue;
      const v = (q.get(k) || '').toLowerCase();
      if (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    }
  } catch (e) { }
  return false;
}

// ?seed=123 → جزيرة معيّنة (كيفما كتشارك جزيرة مع صاحبك)
function seedFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get('seed');
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? (n >>> 0) : null;
  } catch (e) { return null; }
}

async function boot() {
  let canvas = document.getElementById('game');
  const loading = document.getElementById('loading');
  const auto = wantAutoPlay();
  const mode = pickMode();
  let view = await makeView(mode);

  let game;
  try {
    game = new Game(canvas, view);   // attach/init كيتدارو فالكونستركتور
  } catch (e) {
    console.warn('المصيّر 3D طاح، كنرجعو لـ2D', e);
    const { View2D } = await import('./view2d.js');
    // كانفاس جديد (حيت القديم يمكن خدّم webgl)
    const fresh = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    view = new View2D();
    game = new Game(canvas, view);
  }

  window.game = game;
  game.idleWorld();

  if (auto) {
    // كنقلبو نيشان للعب: كمّل إلا كان حفظ، وإلا جزيرة جديدة — وبلا شاشة تعليم
    const seed = seedFromUrl();
    try {
      if (seed !== null) game.newGame(seed);          // بذرة من الرابط = جزيرة معيّنة
      else if (game.hasSave()) game.loadSave();
      else game.newGame();
    } catch (e) { if (seed !== null) game.newGame(seed); else game.newGame(); }
    game.ui.hideAll();
    game.state = 'playing';
    game.fade = 1;
    document.body.classList.add('autoplay');
  } else {
    game.ui.open('menu');
  }
  canvas.addEventListener('pointerdown', () => game.audio.resume(), { once: true });

  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  setInterval(() => { if (window.game.state === 'playing') window.game.saveNow(); }, 30000);
  window.addEventListener('pagehide', () => {
    if (window.game.state === 'playing' || window.game.state === 'paused') window.game.saveNow();
  });

  if (loading) loading.remove();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
