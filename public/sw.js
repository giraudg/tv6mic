/* Service Worker du lecteur des écrans 6MIC : garde une copie des fichiers du lecteur
   pour qu'il redémarre même sans réseau (la programmation et les médias sont gardés par le lecteur).
   Il remplace aussi l'ancien Service Worker du diagnostic, enregistré à la même adresse. ES5. */
var SHELL = 'tv6mic-lecteur-1';
var FICHIERS = ['/', '/lecteur/lecteur.css', '/lecteur/regles.js', '/lecteur/gabarits.js', '/lecteur/lecteur.js',
  '/vendor/qrcode.js', '/logo/6mic-logo-blanc-tv.png', '/logo/motif-6mic.svg',
  '/polices/anton-latin-400-normal.woff2', '/polices/archivo-latin-400-normal.woff2',
  '/polices/archivo-latin-600-normal.woff2', '/polices/archivo-latin-700-normal.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return Promise.all(FICHIERS.map(function (f) { return c.add(f)['catch'](function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k.indexOf('tv6mic-lecteur-') === 0 && k !== SHELL; })
      .map(function (k) { return caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url), cle = null;
  if (req.method !== 'GET' || url.origin !== self.location.origin) { return; }
  if (req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) { cle = '/'; }
  else if (FICHIERS.indexOf(url.pathname) >= 0) { cle = url.pathname; }
  if (!cle) { return; }
  e.respondWith(reseauPuisCopie(req, cle));
});

// Réseau d'abord (pour recevoir les mises à jour du lecteur), copie locale si le réseau ne répond pas en 5 s.
function reseauPuisCopie(req, cle) {
  function copie() { return caches.open(SHELL).then(function (c) { return c.match(cle); }); }
  return new Promise(function (repondre) {
    var fini = false;
    var minuterie = setTimeout(function () {
      copie().then(function (r) { if (r && !fini) { fini = true; repondre(r); } });
    }, 5000);
    fetch(req).then(function (r) {
      if (r && r.ok && r.type === 'basic') {
        var c = r.clone();
        caches.open(SHELL).then(function (cache) { return cache.put(cle, c); })['catch'](function () {});
      }
      if (!fini) { fini = true; clearTimeout(minuterie); repondre(r); }
    }, function () {
      copie().then(function (r) {
        if (!fini) { fini = true; clearTimeout(minuterie); repondre(r || Response.error()); }
      });
    });
  });
}
