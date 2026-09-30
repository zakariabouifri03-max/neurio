// ── The Long Drive 3D — service worker: offline support + always-fresh updates ──
// Network-first strategy so code updates apply immediately; cache is only an
// offline fallback. Bump VERSION whenever the asset list changes.
const VERSION = 'tld3d-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/game.js',
  './src/world.js',
  './src/builders.js',
  './src/data.js',
  './src/tex.js',
  './src/audio.js',
  './src/util.js',
  './src/save.js',
  './src/post.js',
  './src/style.css',
  './vendor/three.module.js',
  './vendor/utils/BufferGeometryUtils.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Network-first: always prefer the fresh server copy (so game updates load
  // instantly), falling back to the cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
