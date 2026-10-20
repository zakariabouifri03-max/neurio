// Bash Baqi Racing — cache-first for the offline game, network-first for the store.
const VERSION = 'bbr-v2';
const ASSETS = [
  './', './index.html', './success.html', './src/store.css',
  './game.html',
  './manifest.webmanifest',
  './src/main.js', './src/race.js', './src/menu.js', './src/builders.js',
  './src/data.js', './src/tex.js', './src/audio.js', './src/util.js',
  './src/save.js', './src/post.js', './src/style.css',
  './vendor/three.module.js', './vendor/utils/BufferGeometryUtils.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './video/poster.jpg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isStore = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/success.html');
  if (isStore) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(hit => hit || caches.match('./game.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    if (response.ok) caches.open(VERSION).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match('./game.html'))));
});
