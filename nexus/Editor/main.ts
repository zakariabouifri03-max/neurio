// ============================================================================
// NEXUS GAME STUDIO — editor entry point
// ============================================================================
import './styles.css';
import 'codemirror/lib/codemirror.css';
import { EditorApp } from './app';
import { runCommand } from './commands';

const bootStatus = document.getElementById('boot-status');

async function boot() {
  const host = document.getElementById('app')!;
  try {
    bootStatus && (bootStatus.textContent = 'LOADING ENGINE MODULES…');
    const app = new EditorApp(host);
    bootStatus && (bootStatus.textContent = 'READY');
    // remove splash
    const splash = document.getElementById('boot-splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 450);
    }
    (window as any).__NEXUS_APP = app;
    // Native menu (Electron desktop build) → web command registry,
    // so every native menu item runs the same real command as the web UI.
    const desktop = (window as any).nexusDesktop;
    if (desktop?.onMenu) {
      desktop.onMenu((cmd: string) => { try { runCommand(cmd); } catch { /* unknown command */ } });
    }
  } catch (e: any) {
    bootStatus && (bootStatus.textContent = `BOOT ERROR: ${e?.message ?? e}`);
    console.error(e);
  }
}

boot();
