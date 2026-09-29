// ═════════════════════════════════════════════════════════════════════════════
// SWINDLE SQUAD — service worker.
// The client is fully offline-capable (the solo table runs its own authority in
// the tab). Online play is never cached: /api and /ws always hit the house.
// ═════════════════════════════════════════════════════════════════════════════
const VERSION = 'swindle-squad-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const MODULES = [
  './js/main.js', './js/util.js', './js/save.js', './js/ui.js', './js/net.js',
  './js/audio.js', './js/chars.js', './js/tex.js', './js/room3d.js', './js/fx.js', './js/post.js',
  '../shared/util.js', '../shared/content.js', '../shared/engine.js', '../shared/bots.js',
  '../vendor/three.module.js', '../vendor/utils/BufferGeometryUtils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled([...SHELL, ...MODULES].map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isApi = (u) => u.pathname.startsWith('/api/') || u.pathname === '/ws' || u.pathname.endsWith('/ws');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let u; try { u = new URL(req.url); } catch { return; }
  if (isApi(u)) return;                       // never cache the house
  const nav = req.mode === 'navigate' || req.destination === 'document';

  e.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req, { ignoreSearch: !nav });
      if (nav) {
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          return (await cache.match('./index.html')) || Response.error();
        }
      }
      // background revalidate so a patched build lands on the next load
      if (u.origin === self.location.origin) {
        fetch(req).then((fresh) => { if (fresh && fresh.ok) cache.put(req, fresh.clone()); }).catch(() => {});
      }
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return Response.error();
      }
    })()
  );
});

// the app posts a message after a successful update check → nudge the client
self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});
