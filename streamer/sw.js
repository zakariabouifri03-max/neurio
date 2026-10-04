// Streamer Life Sim 2 — offline service worker
const C = 'sls2-v1';
const CORE = ['index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'src/main.js', 'src/world.js', 'src/player.js', 'src/pc.js', 'src/net.js', 'src/save.js',
  'src/audio.js', 'src/tex.js', 'src/util.js', 'src/data.js', '../vendor/three.module.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const cp = res.clone();
          caches.open(C).then((c) => c.put(e.request, cp));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
