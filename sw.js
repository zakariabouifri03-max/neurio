// Offline cache for Neurio Blocks (all game code and Three.js are local).
const VERSION = 'neurio-blocks-v1';
const CORE = [
  './', './index.html', './manifest.webmanifest', './src/style.css',
  './src/main.js', './src/game.js', './src/world.js', './src/blocks.js',
  './src/inventory.js', './src/entities.js', './src/network.js', './src/storage.js', './src/audio.js',
  './vendor/three.module.js', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => {
    if (cached) return cached;
    return fetch(event.request).then((response) => {
      if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match('./index.html'));
  }));
});
