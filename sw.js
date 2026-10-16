// Nour Studio, Blockyard, Drift, and the racing demo are cached for offline use.
const VERSION = 'playground-v4-nour-studio';
const ASSETS = [
  './', './index.html', './clearcall.webmanifest', './sw.js', './icons/nour.svg',
  './src/clearcall/app.js', './src/clearcall/processing.js', './src/clearcall/style.css',
  './blockyard.html', './manifest.webmanifest', './drift.html', './drift.webmanifest', './racing.html',
  './src/blockyard/game.js', './src/blockyard/models.js', './src/blockyard/world.js',
  './src/blockyard/rules.js', './src/blockyard/ui.js', './src/blockyard/icons.js', './src/blockyard/style.css', './icons/blockyard.svg',
  './src/raft/game.js', './src/raft/models.js', './src/raft/world.js',
  './src/raft/rules.js', './src/raft/ui.js', './src/raft/icons.js',
  './src/raft/audio.js', './src/raft/export.js', './src/raft/style.css',
  './src/raft/waves.js', './src/raft/ocean.js', './src/raft/textures.js', './src/raft/tropics.js',
  './vendor/three.module.js', './vendor/utils/BufferGeometryUtils.js',
  './icons/drift.svg', './icons/drift-192.png', './icons/drift-512.png',
  './assets/fonts/dm-sans-400.woff2', './assets/fonts/dm-sans-500.woff2',
  './assets/fonts/dm-sans-600.woff2', './assets/fonts/dm-sans-700.woff2',
  './assets/fonts/outfit-500.woff2', './assets/fonts/outfit-600.woff2',
  './assets/fonts/outfit-700.woff2', './assets/fonts/outfit-800.woff2',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => /^(bbr-|drift-|playground-)/.test(key) && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      const hit = await cache.match(event.request, { ignoreSearch: true });
      if (hit) return hit;
      if (event.request.mode === 'navigate') return await cache.match('./index.html') || Response.error();
      return Response.error();
    }
  })());
});
