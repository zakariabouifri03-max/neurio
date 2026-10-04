// network-first service worker: you ALWAYS get the latest build when online,
// and the cached copy only kicks in when you are offline.
const V = 'slm-' + (self.__BUILD__ || Date.now());
const CORE = ['./', './index.html', './manifest.webmanifest', './src/main.js', './src/game.js', './src/world.js',
  './src/player.js', './src/pc.js', './src/ui.js', './src/net.js', './src/npc.js', './src/data.js', './src/tex.js',
  './src/util.js', './src/style.css', './vendor/three.module.js', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.map(x => x !== V && caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(V).then(c => c.put(e.request, copy)).catch(() => { });
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
