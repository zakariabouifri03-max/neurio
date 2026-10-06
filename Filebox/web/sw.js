// Filebox — service worker: the app shell works offline.
// Only the app's own files are cached — never the user's blobs (those live in
// IndexedDB / OPFS and must survive cache cleanups).
const VERSION = 'filebox-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js',
  './src/db.js',
  './src/i18n.js',
  './src/style.css',
  './src/util.js',
  './src/zip.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;      // never touch WebDAV / backups
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    }));
});
