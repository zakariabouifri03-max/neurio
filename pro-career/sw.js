// Pro Career 27 — service worker: play offline after the first visit
const VERSION = 'proc27-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './src/ui.js', './src/career.js', './src/match.js', './src/engine.js',
  './src/worldgen.js', './src/data.js', './src/rng.js', './src/style.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => { try { c.put(e.request, copy); } catch (_) {} });
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
