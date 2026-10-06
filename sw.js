/* ============================================================
   Botola 25 — service worker
   Cache-first: after the first visit the whole game (Three.js and
   all) is on the device and plays with no network at all.
   ============================================================ */

const CACHE = 'botola25-v1';
const ASSETS = [
  './',
  './index.html',
  './src/style.css',
  './src/main.js',
  './src/engine.js',
  './src/render.js',
  './src/tex.js',
  './src/data.js',
  './src/career.js',
  './src/save.js',
  './src/audio.js',
  './src/ui.js',
  './src/util.js',
  './vendor/three.module.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // only cache same-origin successes
        if (res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
