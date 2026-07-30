// Ver21.0: 更新安定化のため、この版ではキャッシュを保持しません。
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).then(() => self.registration.unregister()).then(() => self.clients.claim()));
});
self.addEventListener('fetch', () => {});
