import { Game } from './game.js';
addEventListener('error', e => {
  const l = document.getElementById('errLog');
  if (!l) return; l.style.display = 'block';
  l.textContent = '⚠️ ' + (e.message || e) + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '');
});
window.GAME = new Game();
document.getElementById('loading').style.display = 'none';
if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
