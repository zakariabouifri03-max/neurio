// Service Worker — اللعبة كتخدم أوفلاين — sw.js
const CACHE = 'jazira-v4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './src/style.css', './src/main.js', './src/game.js', './src/world.js', './src/entities.js',
  './src/render.js', './src/view2d.js', './src/view3d.js', './src/models3d.js', './src/geom3d.js',
  './src/ui.js', './src/data.js', './src/audio.js', './src/util.js',
  './vendor/three.module.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => { });
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
