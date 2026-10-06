// NEXUS Game Studio — browser app shell and local Three.js asset cache.
const VERSION = 'nexus-studio-v1';
const ASSETS = [
  './',
  './index.html',
  './racing.html',
  './manifest.webmanifest',
  './icons/nexus-icon.svg',
  './src/studio.css',
  './src/studio.js',
  './src/engine.js',
  './src/project.js',
  './src/asset-import.js',
  './src/agent.js',
  './src/graph.js',
  './src/exporter.js',
  './src/main.js',
  './src/race.js',
  './src/menu.js',
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
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => {
    if (cached) return cached;
    return fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html'));
  }));
});
