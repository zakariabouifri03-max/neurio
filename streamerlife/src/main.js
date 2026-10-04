import { Game } from './game.js';
addEventListener('error', e => {
  const l = document.getElementById('errLog');
  if (!l) return; l.style.display = 'block';
  l.textContent = '⚠️ ' + (e.message || e) + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '');
});
window.GAME = new Game();
document.getElementById('loading').style.display = 'none';
export const BUILD = 'v1.4';
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) r.update();
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) location.reload();
        });
      });
    } catch { }
  });
}
