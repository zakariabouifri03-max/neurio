// BOOYAH FIRE — service worker: full offline support.
// Scoped to /freefire/ so it wins over the racing game's root-scoped worker.
const VERSION = 'booyah-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/sim.js',
  './src/view.js',
  './src/world.js',
  './src/hud.js',
  './src/post.js',
  './src/audio.js',
  './src/data.js',
  './src/tex.js',
  './src/util.js',
  './src/style.css',
  './vendor/three.module.js',
  './vendor/utils/BufferGeometryUtils.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[booyah] precache skipped:', err))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.startsWith('booyah-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // navigations: network-first so updates land, offline falls back to the cached shell
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // everything else: cache-first, fill the cache on the way through
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      });
    })
  );
});
