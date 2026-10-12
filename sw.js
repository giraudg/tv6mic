/* Service Worker du diagnostic 6MIC : prouve qu'un script peut intercepter les requêtes,
   ce qui permettra au futur lecteur de fonctionner sans réseau. ES5 uniquement. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  if (event.request.url.indexOf('__diag_sw_ping') >= 0) {
    event.respondWith(new Response('pong', { headers: { 'Content-Type': 'text/plain' } }));
  }
});
