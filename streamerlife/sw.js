const V = 'slm-v1';
const A = ['./','./index.html','./manifest.webmanifest','./src/main.js','./src/game.js','./src/world.js','./src/player.js',
'./src/pc.js','./src/ui.js','./src/net.js','./src/npc.js','./src/data.js','./src/tex.js','./src/util.js','./src/style.css',
'./vendor/three.module.js','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(A)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const cl = res.clone(); caches.open(V).then(c => c.put(e.request, cl)); return res;
  }).catch(() => caches.match('./index.html'))));
});
