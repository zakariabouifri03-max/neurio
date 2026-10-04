// Streamer Life 2 — service worker: full offline support
const VERSION = 'sl2-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/city.js',
  './src/houses.js',
  './src/player.js',
  './src/npc.js',
  './src/pc.js',
  './src/mp.js',
  './src/ui.js',
  './src/data.js',
  './src/tex.js',
  './src/audio.js',
  './src/util.js',
  './src/save.js',
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
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    )
  );
});
