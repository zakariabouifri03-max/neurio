// Neurio: offline app shell; never cache uploaded videos, API calls, or external requests.
const VERSION = "neurio-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/neurio.js",
  "./src/neurio.css",
  "./assets/fonts/noto-sans-arabic-arabic-400-normal.woff2",
  "./assets/fonts/noto-sans-arabic-arabic-600-normal.woff2",
  "./assets/neurio.svg",
  "./assets/creator-desk.jpg",
  "./assets/marrakech.jpg",
  "./assets/mountain.jpg",
  "./icons/neurio-192.png",
  "./icons/neurio-512.png",
  "./icons/neurio-maskable-512.png",
  "./assets/fonts/dm-sans-latin-400-normal.woff2",
  "./assets/fonts/dm-sans-latin-500-normal.woff2",
  "./assets/fonts/dm-sans-latin-600-normal.woff2",
  "./assets/fonts/dm-sans-latin-700-normal.woff2",
  "./assets/fonts/manrope-latin-600-normal.woff2",
  "./assets/fonts/manrope-latin-700-normal.woff2",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("neurio-") || key.startsWith("bbr-")) &&
                key !== VERSION,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin)
    return;
  const path = url.pathname.slice(
    new URL(self.registration.scope).pathname.length,
  );
  const asset = ASSETS.find((asset) => asset.slice(2) === path);
  if (!asset) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(VERSION)
              .then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
