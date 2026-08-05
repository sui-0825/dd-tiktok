/* D&D TikTok Ver25.92 cache reset service worker
   This worker intentionally stores no application data. */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'DD_SW_REMOVED', version: '25.92' });
    }
  })());
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
