/* Service Worker du lecteur des écrans 6MIC : garde une copie des fichiers du lecteur
   pour qu'il redémarre même sans réseau (la programmation et les médias sont gardés par le lecteur).
   Il remplace aussi l'ancien Service Worker du diagnostic, enregistré à la même adresse. ES5.
   Il ne doit JAMAIS laisser une page en attente : écran du Hall, 6-9 nov. 2026, resté noir des jours
   (la page ne démarrait plus, même après réinitialisation du téléviseur). Chaque accès à la copie locale
   est donc borné dans le temps, une copie absente ou abîmée renvoie au réseau, et une réponse part
   toujours au bout de 30 s au plus. */
var SHELL = 'tv6mic-lecteur-4';
var FICHIERS = ['/', '/lecteur/gabarits.css', '/lecteur/lecteur.css', '/lecteur/regles.js', '/lecteur/gabarits.js', '/lecteur/lecteur.js',
  '/vendor/qrcode.js', '/logo/6mic-logo-blanc-tv.png', '/logo/motif-6mic.svg', '/motifs/rayons.webp',
  '/polices/anton-latin-400-normal.woff2', '/polices/archivo-latin-400-normal.woff2',
  '/polices/archivo-latin-600-normal.woff2', '/polices/archivo-latin-700-normal.woff2'];
var ATTENTE_RESEAU = 5000, ATTENTE_COPIE = 3000, ATTENTE_MAX = 30000;

// Une promesse qui se résout au plus tard après `ms` (avec `defaut`), même si `p` ne répond jamais ou échoue.
function borne(p, ms, defaut) {
  return new Promise(function (ok) {
    var fait = false;
    function fin(v) { if (!fait) { fait = true; ok(v); } }
    setTimeout(function () { fin(defaut); }, ms);
    Promise.resolve(p).then(fin, function () { fin(defaut); });
  });
}

self.addEventListener('install', function (e) {
  var copie = caches.open(SHELL).then(function (c) {
    return Promise.all(FICHIERS.map(function (f) { return c.add(f)['catch'](function () {}); }));
  });
  e.waitUntil(borne(copie, 20000, null).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  var menage = caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) { return k.indexOf('tv6mic-lecteur-') === 0 && k !== SHELL; })
      .map(function (k) { return caches['delete'](k); }));
  });
  e.waitUntil(borne(menage, 10000, null).then(function () { return self.clients.claim(); }));
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
  // copie locale : jamais plus de 3 s, et rien (undefined) si elle est absente ou abîmée
  function copie() {
    return borne(caches.open(SHELL).then(function (c) { return c.match(cle); }), ATTENTE_COPIE, undefined);
  }
  return new Promise(function (repondre) {
    var fini = false;
    function rendre(r) { if (!fini && r) { fini = true; clearTimeout(minuterie); clearTimeout(butoir); repondre(r); } }
    var minuterie = setTimeout(function () { copie().then(rendre); }, ATTENTE_RESEAU);
    // ni réseau ni copie au bout de 30 s : erreur franche (MagicINFO rechargera), plutôt qu'une page en attente
    var butoir = setTimeout(function () { rendre(Response.error()); }, ATTENTE_MAX);
    fetch(req).then(function (r) {
      if (r && r.ok && r.type === 'basic') {
        var c = r.clone();
        borne(caches.open(SHELL).then(function (cache) { return cache.put(cle, c); }), 10000, null);
      }
      rendre(r || Response.error());
    }, function () {
      copie().then(function (r) { rendre(r || Response.error()); });
    });
  });
}
