// NAR SURVIVOR 3D — service worker: full offline support
const VERSION = 'nar3d-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/util.js', './js/state.js', './js/tex.js', './js/world.js', './js/char.js',
  './js/fx.js', './js/weapons.js', './js/loot.js', './js/entities.js', './js/audio.js',
  './js/input.js', './js/hud.js', './js/main.js',
  './vendor/three.module.js',
  './vendor/utils/BufferGeometryUtils.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k.startsWith('nar3d')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cache-first for same-origin assets, network fallback (never blocks a fresh load)
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
