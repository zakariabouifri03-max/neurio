// Neurio Studio — cache the editor shell; imported media remains in local IndexedDB.
const VERSION = 'neurio-studio-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/editor.css',
  './src/editor/main.js',
  './src/editor/catalog.js',
  './src/editor/audio.js',
  './src/editor/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(hit => {
    if (hit) return hit;
    return fetch(event.request).then(response => {
      if (response.ok) caches.open(VERSION).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match('./index.html'));
  }));
});
