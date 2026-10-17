// RABONA: local assets only
const VERSION = 'rabona-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/rabona.svg',
  './src/rabona/main.js', './src/rabona/world.js', './src/rabona/models.js',
  './src/rabona/game.js', './src/rabona/rules.js', './src/rabona/audio.js', './src/rabona/style.css',
  './vendor/three.module.js', './vendor/utils/BufferGeometryUtils.js',
  './assets/fonts/barlow-condensed-latin-700-normal.woff2',
  './assets/fonts/barlow-condensed-latin-600-normal.woff2',
  './assets/fonts/dm-sans-latin-400-normal.woff2',
  './assets/fonts/dm-sans-latin-500-normal.woff2',
  './assets/fonts/dm-sans-latin-600-normal.woff2',
  './assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=> /^(bbr-|deadbolt-|outrun-|rabona-)/.test(k) && k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  const known = ASSETS.some(a=> new URL(a, self.location.href).pathname===path);
  if (!known && event.request.mode!=='navigate') return;
  event.respondWith(fetch(event.request).then(r=>{
    if(r.ok){ const c=r.clone(); caches.open(VERSION).then(cache=>cache.put(event.request,c)); }
    return r;
  }).catch(async()=>{
    const cached = await caches.match(event.request, {ignoreSearch:true});
    if(cached) return cached;
    if(event.request.mode==='navigate') return caches.match('./index.html');
    return Response.error();
  }));
});
