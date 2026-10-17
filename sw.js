// MONKEY CO. — ultra store, local assets only
const VERSION = 'monkey-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/rabona.svg',
  './src/monkey-store/main.js', './src/monkey-store/models.js', './src/monkey-store/store.js', './src/monkey-store/rules.js', './src/monkey-store/style.css',
  './vendor/three.module.js', './vendor/utils/BufferGeometryUtils.js',
  './assets/fonts/barlow-condensed-latin-700-normal.woff2',
  './assets/fonts/barlow-condensed-latin-600-normal.woff2',
  './assets/fonts/dm-sans-latin-400-normal.woff2',
  './assets/fonts/dm-sans-latin-500-normal.woff2',
  './assets/fonts/dm-sans-latin-600-normal.woff2',
  './assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>/^(bbr-|deadbolt-|outrun-|rabona-|monkey-)/.test(k) && k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET' || new URL(e.request.url).origin!==self.location.origin) return;
  const path=new URL(e.request.url).pathname;
  const known=ASSETS.some(a=> new URL(a, self.location.href).pathname===path);
  if(!known && e.request.mode!=='navigate') return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok){ const c=r.clone(); caches.open(VERSION).then(cache=>cache.put(e.request,c)); }
    return r;
  }).catch(async()=>{
    const cached=await caches.match(e.request,{ignoreSearch:true});
    if(cached) return cached;
    if(e.request.mode==='navigate') return caches.match('./index.html');
    return Response.error();
  }));
});
