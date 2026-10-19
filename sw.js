// VICE CARTON — GTA 6 carton anime — offline support v2 (cache bust)
const VERSION = 'vice-carton-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/style.css',
  './vendor/three.module.js',
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
  // network-first for JS/CSS to avoid stale cache errors
  if (e.request.url.endsWith('.js') || e.request.url.endsWith('.css')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-store'}).then((res)=>{
        if(res.ok) { const copy=res.clone(); caches.open(VERSION).then(c=>c.put(e.request, copy)); }
        return res;
      }).catch(()=> caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
