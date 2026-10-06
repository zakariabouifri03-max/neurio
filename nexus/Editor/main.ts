// ============================================================================
// NEXUS GAME STUDIO — editor entry point
// ============================================================================
import './styles.css';
import 'codemirror/lib/codemirror.css';
import { EditorApp } from './app';

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
  } catch (e: any) {
    bootStatus && (bootStatus.textContent = `BOOT ERROR: ${e?.message ?? e}`);
    console.error(e);
  }
}

boot();
