// ============================================================================
// NEXUS ENGINE — Standalone game runtime boot
// This module is bundled (IIFE) by vite.runtime.config.ts and inlined into
// exported <Game>.html builds. It boots the actual game from embedded data:
//   window.NEXUS_GAME = { project, embedded, config }
// Everything runs offline in a single HTML file — no server, no editor.
// ============================================================================
import * as THREE from 'three';
import { NexusRenderer } from '../render/renderer';
import { GameRuntime } from './game';
import { AssetResolver } from './assetresolver';
import type { ProjectData } from '../core/types';

declare const window: any;

export function nexusBoot() {
  const payload = window.NEXUS_GAME;
  if (!payload?.project) {
    document.body.innerHTML = '<div style="font-family:monospace;color:#e66;padding:40px;">NEXUS RUNTIME ERROR: no game data found.</div>';
    return;
  }
  const project: ProjectData = payload.project;
  const config = payload.config ?? { mode: 'Release', showStats: false, gameName: project.name };

  document.title = config.gameName ?? project.name;

  // --- fullscreen canvas + HUD layer ---
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none;';
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;inset:0;font-family:-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8edf4;';
  const vignette = document.createElement('div');
  vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, transparent 62%, rgba(0,0,0,0.32) 100%);';
  document.body.style.cssText = 'margin:0;background:#07090d;overflow:hidden;';
  document.body.appendChild(canvas);
  document.body.appendChild(hud);
  document.body.appendChild(vignette);

  // --- renderer + runtime ---
  const renderer = new NexusRenderer(canvas, project.settings.graphicsQuality ?? 'high');
  const resolver = new AssetResolver(project.assets ?? [], { embedded: payload.embedded ?? {} });

  const runtime = new GameRuntime({
    project, resolver, renderer, canvas, hudHost: hud,
    mode: 'standalone',
    savePrefix: `nexus:${project.id}`,
    onLog: (level, msg) => {
      if (config.mode === 'Development') console[level === 'error' ? 'error' : 'log'](`[${level}] ${msg}`);
      if (level === 'error') showErrorToast(msg);
    },
  });
  (window as any).__NEXUS_RUNTIME = runtime;

  function showErrorToast(msg: string) {
    const el = document.createElement('div');
    el.textContent = `⚠ ${msg}`;
    el.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:70%;background:rgba(60,14,14,0.92);border:1px solid #a33;color:#fbb;padding:8px 12px;border-radius:6px;font:12px/1.4 monospace;z-index:99;';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  // --- resize handling ---
  const resize = () => {
    renderer.resize();
    runtime.resize(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  };
  window.addEventListener('resize', resize);

  // --- main menu flow ---
  const hasMenu = (project.uiDocuments ?? []).some(d => d.name === 'MainMenu');
  const mainMenuName = hasMenu ? 'MainMenu' : null;

  let menuActive = false;
  const startGame = (continueFromSave: boolean) => {
    if (menuActive) { runtime.hud?.hideAllMenus(); menuActive = false; runtime.setPaused(false); }
    // pointer lock hint
    showHint('Click to capture mouse');
  };

  runtime.events.on('gameStart', () => startGame(false));
  runtime.events.on('gameContinue', async () => {
    startGame(true);
    const save = loadSave();
    if (save) {
      runtime.saveSystem?.apply?.(save);
      runtime.hud?.showMessage('Game loaded.', 2);
    } else runtime.hud?.showMessage('No save found — starting new game.', 2.5);
  });
  runtime.events.on('requestRestart', () => { window.location.reload(); });
  runtime.events.on('requestQuit', () => {
    runtime.hud?.hideAllMenus();
    runtime.setPaused(false);
    if (mainMenuName) { runtime.hud?.show(mainMenuName); menuActive = true; runtime.setPaused(true); }
    else document.title += ' — quit';
  });

  function loadSave(): any {
    try {
      const raw = localStorage.getItem(`nexus:${project.id}:nexus_save`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function showHint(text: string) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;bottom:9%;transform:translateX(-50%);color:#cfe3f5;background:rgba(8,12,18,0.6);padding:6px 14px;border-radius:20px;font-size:12px;pointer-events:none;transition:opacity .6s;z-index:50;';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 2600);
  }

  // --- pause with Esc ---
  let escConsumedByMenu = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (runtime.hud?.hasMenuOpen) { runtime.hud.hideAllMenus(); escConsumedByMenu = true; return; }
      const pauseDoc = (project.uiDocuments ?? []).find(d => d.name === 'PauseMenu');
      if (pauseDoc) { runtime.hud.show('PauseMenu'); runtime.setPaused(true); }
    }
    if (e.code === 'Tab') { // inventory
      e.preventDefault();
      if ((project.uiDocuments ?? []).some(d => d.name === 'Inventory')) runtime.hud?.toggle('Inventory');
    }
  });
  window.addEventListener('mousedown', () => {
    // audio contexts need a user gesture to start
    runtime.audio?.ensureContext?.();
    if (!menuActive && !runtime.hud?.hasMenuOpen && document.pointerLockElement !== canvas) {
      runtime.input?.requestPointerLock(canvas);
    }
  });

  // --- stats overlay (Development builds) ---
  if (config.showStats) {
    const stats = document.createElement('div');
    stats.style.cssText = 'position:fixed;left:8px;top:8px;background:rgba(8,12,18,0.7);padding:8px 10px;border-radius:6px;font:11px/1.6 monospace;color:#9fe8ff;z-index:60;pointer-events:none;';
    document.body.appendChild(stats);
    let frames = 0, last = performance.now(), fps = 0;
    const updateStats = () => {
      frames++;
      const now = performance.now();
      if (now - last > 500) {
        fps = Math.round(frames * 1000 / (now - last));
        frames = 0; last = now;
        const s = renderer.stats;
        stats.textContent = `${fps} FPS  ${runtime.profile.updateMs.toFixed(1)}ms upd  ${s.drawCalls} draws  ${s.triangles.toLocaleString()} tris`;
      }
      requestAnimationFrame(updateStats);
    };
    requestAnimationFrame(updateStats);
  }

  // --- boot ---
  runtime.start();               // standalone mode starts its own rAF loop
  if (mainMenuName) {
    runtime.hud?.show(mainMenuName);
    menuActive = true;
    runtime.setPaused(true);
  } else {
    runtime.setPaused(false);
  }
  resize();
}

// Boot when loaded as plain script
if (typeof window !== 'undefined') {
  window.NEXUS_BOOT = nexusBoot;
  if (window.NEXUS_GAME) nexusBoot();
}
