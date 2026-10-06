/* 📡 نوريو تواصل — service worker
   Two jobs:
     1. cache the app shell so the UI opens instantly (even if the LAN drops)
     2. never cache the chat traffic (websocket / uploads / files are live data)

   Network-first for the shell: a fresh copy is used when the server answers,
   the cache is only a fallback — so the app updates itself whenever you reload. */

const CACHE = 'nurio-chat-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => { }),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // live data → always straight to the network
  if (url.pathname.startsWith('/api/') || request.headers.get('upgrade') === 'websocket') return;
  if (request.method !== 'GET') return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => { });
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
  );
});
