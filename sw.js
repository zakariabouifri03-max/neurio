// SAWT+ app + games archive: network-first application updates, offline fallback, local assets only.
const VERSION = "sawt-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./hollowpine.html",
  "./hollowpine.webmanifest",
  "./ghostline.html",
  "./ghostline.webmanifest",
  "./icons/hollowpine.svg",
  "./icons/sawt.svg",
  "./icons/sawt-192.png",
  "./icons/sawt-512.png",
  "./racing.html",
  "./racing.webmanifest",
  "./manifest.webmanifest",
  "./icons/ghostline.svg",
  "./src/sawt/app.js",
  "./src/sawt/audio.js",
  "./src/sawt/style.css",
  "./src/hollowpine/main.js",
  "./src/hollowpine/style.css",
  "./src/hollowpine/rules.js",
  "./src/hollowpine/world.js",
  "./src/hollowpine/models.js",
  "./src/hollowpine/map.js",
  "./src/hollowpine/model-viewer.js",
  "./src/hollowpine/sound.js",
  "./assets/fonts/instrument-serif-400.woff2",
  "./assets/fonts/instrument-serif-italic.woff2",
  "./src/ghostline/main.js",
  "./src/ghostline/style.css",
  "./src/ghostline/city.js",
  "./src/ghostline/operative.js",
  "./src/ghostline/rules.js",
  "./src/ghostline/map.js",
  "./src/ghostline/sound.js",
  "./src/ghostline/model-viewer.js",
  "./vendor/three.module.js",
  "./vendor/utils/BufferGeometryUtils.js",
  "./vendor/exporters/GLTFExporter.js",
  "./assets/fonts/space-grotesk-400.woff2",
  "./assets/fonts/space-grotesk-500.woff2",
  "./assets/fonts/space-grotesk-600.woff2",
  "./assets/fonts/space-grotesk-700.woff2",
  "./assets/fonts/ibm-plex-mono-400.woff2",
  "./assets/fonts/ibm-plex-mono-500.woff2",
  "./src/main.js",
  "./src/race.js",
  "./src/menu.js",
  "./src/builders.js",
  "./src/data.js",
  "./src/tex.js",
  "./src/audio.js",
  "./src/util.js",
  "./src/save.js",
  "./src/post.js",
  "./src/style.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== VERSION &&
                (k.startsWith("hollowpine-") ||
                  k.startsWith("sawt-") ||
                  k.startsWith("ghostline-") ||
                  k.startsWith("bbr-")),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin ||
    request.headers.has("range")
  )
    return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(
            caches.open(VERSION).then((cache) => cache.put(request, copy)),
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === "navigate")
          return (await caches.match("./index.html")) || Response.error();
        return Response.error();
      }),
  );
});
