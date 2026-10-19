/*
 * Cartoon Drift — service-worker kill switch
 * ------------------------------------------
 * This file intentionally replaces the old "Bash Baqi Racing" service worker
 * that used to cache the whole app. Any browser that still has the old worker
 * installed will fetch this file on its next update check, activate it, wipe
 * every cache, unregister itself and reload the page so the new game shows up.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (err) { /* ignore */ }

    try { await self.registration.unregister(); } catch (err) { /* ignore */ }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        if ('navigate' in client) await client.navigate(client.url);
        else client.postMessage({ type: 'sw-killed' });
      } catch (err) { /* ignore */ }
    }
  })());
});

// No fetch handler on purpose: everything goes straight to the network.
