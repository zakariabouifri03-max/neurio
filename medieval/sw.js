// ── IRONVOW — offline shell ──────────────────────────────────────────────────
// The whole game is a handful of modules and one vendored library, so it caches
// complete. Bump CACHE when anything under src/ changes.
const CACHE = 'ironvow-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './icons/ironvow.svg',
  './src/style.css', './src/main.js', './src/mathx.js', './src/tex.js',
  './src/tuning.js', './src/data.js', './src/weapons.js', './src/combat.js',
  './src/characters.js', './src/moves.js', './src/defense.js', './src/exchange.js',
  './src/fighter.js', './src/arena.js', './src/vfx.js', './src/audio.js',
  './src/hud.js', './src/menu.js', './src/state.js', './src/input.js',
  './src/view.js', './src/ai.js',
  './vendor/three.module.js', './vendor/utils/BufferGeometryUtils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // One missing file must not fail the whole install: cache what exists.
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // A pass through the hall should open instantly: serve the shell from cache,
  // but go to the network first for the page itself so an update is picked up.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (_) {
      return Response.error();
    }
  })());
});
