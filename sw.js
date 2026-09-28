const CACHE='neurio-v1';
const ASSETS=['./','./index.html','./manifest.json','./src/main.js','./src/long_maps.js','./src/levels_ultra.js','./src/candy_engine.js','./src/physics_ultra.js','./src/audio_ultra.js','./vendor/three.module.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))) )});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{ const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return res; })).catch(()=>caches.match('./index.html')))});
