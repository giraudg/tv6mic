/* Écrans TV 6MIC : lecteur d'un flux (https://tv.6mic-aix.fr/?flux=hall).
   - interroge la programmation toutes les 30 s et envoie l'état de l'écran ;
   - fait tourner les étapes calculées par Regles (gabarits, images, vidéos) ;
   - garde les médias dans le stockage de l'écran (Cache API, 150 Mo au plus) ;
   - reprend après un rechargement de la page par MagicINFO, continue sans réseau.
   Options d'adresse : debug=1 (suivi technique), ident=1 (affiche le nom du flux 20 s).
   ES5 uniquement : les écrans utilisent Chromium 56. */
(function () {
  'use strict';

  var VERSION = '1.3.4';
  var W = window, D = document;
  var INTERVALLE = 30000;
  var CACHE = 'tv6mic-medias-1';
  var PLAFOND = 150 * 1024 * 1024;
  var params = lireParams();
  var CODE = String(params.flux || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  var SUIVI = params.debug === '1';
  var K = {
    prog: 'tv6mic.prog.' + CODE, etat: 'tv6mic.etat.' + CODE, medias: 'tv6mic.medias',
    decalage: 'tv6mic.decalage', chargements: 'tv6mic.chargements', video: 'tv6mic.video'
  };

  var scene, couches, videos, identNoeud = null, suiviNoeud = null;
  var prog = null, decalage = 0, demarreLe = Date.now(), chargements = 0;
  var enRoute = false, courante = null, actif = null, jeton = 0, zHaut = 10;
  var minuterie = null, garde = null, minuterieReseau = null, identJusqua = 0;
  var modeVideo = 'double', preparee = null;
  var horsLigne = false, dernierContact = 0, premierSignal = true, erreurs = [];
  var memoire = {}, blobs = {}, echoues = {}, telechargementEnCours = false, dernierTri = 0;
  var cacheOk = !!(W.caches && W.fetch && W.Promise && W.URL && W.URL.createObjectURL);

  /* ---------- outils ---------- */
  function lireParams() {
    var r = {}, q = (W.location.search || '').replace(/^\?/, '').split('&'), i, p;
    for (i = 0; i < q.length; i++) {
      if (!q[i]) { continue; }
      p = q[i].split('=');
      try { r[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) {}
    }
    return r;
  }
  function lire(cle) { try { return W.localStorage.getItem(cle); } catch (e) { return null; } }
  function ecrire(cle, valeur) { try { W.localStorage.setItem(cle, valeur); } catch (e) {} }
  function lireJSON(cle) { try { return JSON.parse(lire(cle) || 'null'); } catch (e) { return null; } }
  function maintenant() { return Date.now() + decalage; }
  function rien() {}
  function horodatage() {
    var h = Regles.heureParis(maintenant());
    return ('0' + Math.floor(h.minutes / 60)).slice(-2) + ':' + ('0' + h.minutes % 60).slice(-2) + ':' + ('0' + h.secondes).slice(-2);
  }
  function noter(message) {
    erreurs.push(horodatage() + ' ' + message);
    if (erreurs.length > 20) { erreurs.shift(); }
    tracer('! ' + message);
    if (W.console && W.console.log) { W.console.log('[tv6mic] ' + message); }
  }
  // Journal vidéo, envoyé avec le signal : diagnostic à distance d'une vidéo qui ne s'affiche pas.
  var traceVideo = [];
  function tracer(message) {
    traceVideo.push(horodatage() + ' ' + message);
    if (traceVideo.length > 16) { traceVideo.shift(); }
  }
  W.addEventListener('error', function (e) {
    noter('JS ' + (e.message || 'erreur') + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  function chemin(src) {
    try { return new W.URL(src, W.location.href).pathname; } catch (e) { return String(src); }
  }
  function sourcesDe(c) {
    var d = (c && c.donnees) || {}, r = [];
    if (d.src) { r.push(d.src); }
    if (d.poster) { r.push(d.poster); }
    if (d.photo && d.photo.src) { r.push(d.photo.src); }
    if (d.dates && d.dates.length) {           // photos d'une série
      for (var i = 0; i < d.dates.length; i++) { if (d.dates[i] && d.dates[i].photo && d.dates[i].photo.src) { r.push(d.dates[i].photo.src); } }
    }
    return r;
  }

  /* ---------- scène 1920 × 1080 ---------- */
  function ajuster() {
    var w = W.innerWidth || 1920, h = W.innerHeight || 1080, z = Math.min(w / 1920, h / 1080);
    scene.style.zoom = z;
    scene.style.left = Math.round((w - 1920 * z) / 2 / z) + 'px';
    scene.style.top = Math.round((h - 1080 * z) / 2 / z) + 'px';
  }
  function vider(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
  function estActif(c) { return !!(actif && c && actif.type === c.type && actif.index === c.index); }
  function noeudDe(c) { return c.type === 'couche' ? couches[c.index] : videos[c.index]; }

  function montrer(cible, fondu) {
    var n = noeudDe(cible), precedent = actif, clePrec = (precedent && precedent.type === 'video') ? videos[precedent.index].__cle : null;
    if (cible.type === 'couche' && n.classList.contains('visible')) {   // couche réutilisée : repartir de l'opacité 0
      n.style.transition = n.style.webkitTransition = 'none';
      n.classList.remove('visible');
      void n.offsetWidth;
      n.style.transition = n.style.webkitTransition = '';
    }
    if (cible.type === 'video' && fondu && precedent && precedent.type === 'couche') {
      // fondu vers une vidéo : la vidéo apparaît sous la couche, qui s'efface (l'opacité ne touche jamais la vidéo)
      n.style.zIndex = (parseInt(noeudDe(precedent).style.zIndex, 10) || zHaut) - 1;
      n.classList.add('visible');
      noeudDe(precedent).classList.remove('visible');
    } else {
      zHaut++;
      n.style.zIndex = zHaut;
      n.classList.add('visible');
    }
    actif = cible;
    if (precedent && !estActif(precedent)) {
      setTimeout(function () { cacher(precedent, clePrec); }, cible.type === 'couche' || fondu ? 700 : 80);
    }
  }
  // Cache l'élément précédent une fois le nouveau affiché (sans toucher à ce qui a été réutilisé entre-temps).
  function cacher(c, cle) {
    if (estActif(c)) { return; }
    if (c.type === 'video') {
      if (videos[c.index].__cle === cle) { liberer(c.index); } else { videos[c.index].classList.remove('visible'); }
      return;
    }
    var contenu = couches[c.index].firstChild;
    couches[c.index].classList.remove('visible');
    setTimeout(function () { if (!estActif(c) && couches[c.index].firstChild === contenu) { vider(couches[c.index]); } }, 700);
  }
  function coucheLibre() { return (actif && actif.type === 'couche') ? 1 - actif.index : 0; }
  function libre(i) { return !estActif({ type: 'video', index: i }); }
  // Lecteur vidéo pour l'étape s : celui qui l'a déjà préparée, sinon un lecteur caché.
  function videoPour(s, accepterVisible) {
    var i;
    for (i = 0; i < 2; i++) { if (videos[i].__cle === s.cle && libre(i)) { return i; } }
    for (i = 0; i < 2; i++) { if (libre(i) && !videos[i].classList.contains('visible')) { return i; } }
    if (!accepterVisible) { return -1; }
    return libre(0) ? 0 : 1;
  }

  /* ---------- médias : URL locale (mémoire de l'écran) ou réseau ---------- */
  function urlDe(src) { return blobs[chemin(src)] || src; }
  function absolue(src) { try { return new W.URL(src, W.location.href).href; } catch (e) { return src; } }
  function resoudre(etape, fin) {
    var srcs = sourcesDe(etape.contenu), reste = srcs.length, i, termine = false;
    var garde2 = setTimeout(function () { finir(); }, 4000);
    function finir() { if (termine) { return; } termine = true; clearTimeout(garde2); fin(urlDe); }
    function un() { reste--; if (reste <= 0) { finir(); } }
    if (!reste) { finir(); return; }
    for (i = 0; i < srcs.length; i++) { preparerSource(srcs[i], etape.type === 'video' && srcs[i] === etape.contenu.donnees.src, un); }
  }
  function preparerSource(src, estVideo, fin) {
    var c = chemin(src);
    function precharger() {
      if (estVideo) { fin(); return; }
      var img = new Image();
      img.onload = img.onerror = function () { fin(); };
      img.src = urlDe(src);
    }
    if (blobs[c] || !cacheOk || !memoire[c]) { precharger(); return; }
    W.caches.open(CACHE).then(function (cache) { return cache.match(c); })
      .then(function (r) { return r ? r.blob() : null; })
      .then(function (b) { if (b && b.size) { if (!blobs[c]) { blobs[c] = W.URL.createObjectURL(b); } } else { delete memoire[c]; } }, rien)
      .then(precharger, precharger);
  }
  // Ne garde en mémoire vive que les médias de l'étape en cours et de la suivante.
  function libererBlobs(etapes) {
    var garder = {}, i, j, s, k;
    for (i = 0; i < etapes.length; i++) {
      if (!etapes[i]) { continue; }
      s = sourcesDe(etapes[i].contenu);
      for (j = 0; j < s.length; j++) { garder[chemin(s[j])] = true; }
    }
    for (k in blobs) {
      if (blobs.hasOwnProperty(k) && !garder[k]) { try { W.URL.revokeObjectURL(blobs[k]); } catch (e) {} delete blobs[k]; }
    }
  }

  /* ---------- boucle ---------- */
  var quarantaine = {}, minuterieVerif = null, inconnu = false;

  function demarrer() {
    if (enRoute) { return; }
    enRoute = true;
    W.__tvStarted = true;
    var secours = D.getElementById('secours');
    if (secours && secours.parentNode) { secours.parentNode.removeChild(secours); }
    if (!minuterieVerif) { minuterieVerif = setInterval(verifier, 15000); }
    reprendre(lireJSON(K.etat));
  }
  // Après un rechargement de la page : rejoue l'étape interrompue là où elle en était
  // (3 fois au plus de suite, pour ne pas boucler sur un contenu qui ferait planter l'écran), sinon passe à la suivante.
  function reprendre(etat) {
    var calc = Regles.etapes(prog, maintenant()), i, e, ecoule;
    if (etat && etat.cle && (etat.reprises || 0) < 3) {
      ecoule = (Date.now() - (etat.depuis || 0)) / 1000;
      for (i = 0; i < calc.etapes.length; i++) {
        e = calc.etapes[i];
        if (e.cle === etat.cle && e.duree > 0 && ecoule >= 0 && ecoule < e.duree - 3) {
          afficher(e, calc.etapes, { ecoule: ecoule, depuis: etat.depuis, reprises: (etat.reprises || 0) + 1 });
          return;
        }
      }
    }
    avancer(etat ? etat.cle : null);
  }
  // Étape suivante, en écartant pendant 2 min celles qui viennent d'échouer.
  function avancer(apres) {
    clearTimeout(minuterie); clearTimeout(garde);
    var liste = Regles.etapes(prog, maintenant()).etapes, cle = apres !== undefined ? apres : (courante && courante.cle), e = null, i;
    for (i = 0; i <= liste.length; i++) {
      e = Regles.suivante(liste, cle);
      if (!(quarantaine[e.cle] > Date.now())) { break; }
      cle = e.cle; e = null;
    }
    if (!e) { e = { cle: 'veille', type: 'veille', contenu: null, duree: 30, defaut: true }; }
    afficher(e, liste);
  }
  function ecarter(cle) { quarantaine[cle] = Date.now() + 120000; }
  function afficher(e, liste, reprise) {
    var n = ++jeton, ecoule = reprise ? reprise.ecoule : 0;
    courante = e;
    ecrire(K.etat, JSON.stringify({ cle: e.cle, depuis: reprise ? reprise.depuis : Date.now(), reprises: reprise ? reprise.reprises : 0 }));
    if (e.type === 'video') { jouerVideo(e, n, liste, ecoule); return; }
    resoudre(e, function (url) {
      if (n !== jeton) { return; }
      var g, i = coucheLibre();
      try {
        if (e.type === 'soiree') { g = Gabarits.soiree(e, url); }
        else if (e.type === 'agenda') { g = Gabarits.agenda(e, url, ecoule); }
        else if (e.type === 'serie') { g = Gabarits.serie(e, url); }
        else if (e.type === 'lineup') { g = Gabarits.lineup(e, url); }
        else if (e.type === 'image') { g = Gabarits.image(e, url); }
        else { g = Gabarits.veille(!prog ? (horsLigne ? 'Connexion au serveur…' : 'Chargement…') : ''); }
      } catch (err) {
        noter('gabarit ' + e.cle + ' : ' + err.message);
        g = Gabarits.veille('');
      }
      vider(couches[i]);
      couches[i].appendChild(g.noeud);
      if (g.ajuster) {
        try { g.ajuster(); } catch (x) { noter('ajustement : ' + x.message); }
        // Juste après un rechargement, les polices ne sont pas encore prêtes : la taille des noms a été calculée
        // avec la police de secours (plus large). On recalcule dès qu'elles arrivent, si l'étape est toujours affichée.
        if (D.fonts && D.fonts.status !== 'loaded' && D.fonts.ready) {
          D.fonts.ready.then(function () { if (n === jeton) { try { g.ajuster(); } catch (x) { /* déjà noté */ } } });
        }
      }
      void couches[i].offsetWidth;
      g.noeud.className += ' joue';
      montrer({ type: 'couche', index: i });
      minuterie = setTimeout(function () { avancer(); }, Math.max(3, (e.duree || 10) - ecoule) * 1000);
      setTimeout(function () { if (n === jeton) { preparerSuivante(liste, e); } }, 900);
    });
  }

  /* ---------- vidéo : deux lecteurs en alternance (4 ms d'écart mesurés dans MagicINFO) ---------- */
  function indexDe(v) { return v === videos[0] ? 0 : 1; }
  function charger(v, etape, url) {
    var d = etape.contenu.donnees || {};
    v.__cle = etape.cle; v.__actif = false;
    v.muted = !d.son;
    v.preload = 'auto';
    v.onplaying = v.onended = v.onloadedmetadata = v.oncanplay = null;
    v.onerror = function () {                       // erreur pendant le préchargement
      if (v.__actif) { return; }
      noter('préchargement refusé : ' + etape.cle + ' (' + codeErreur(v) + ')');
      if (v.error && v.error.code === 3 && videos[1 - indexDe(v)].getAttribute('src')) { echecVideo(); }
      liberer(indexDe(v));
    };
    v.src = absolue(d.src);              // toujours depuis le réseau (voir gererMedias)
    try { v.load(); } catch (e) {}
  }
  function liberer(i) {
    var v = videos[i];
    v.classList.remove('visible');
    v.__cle = null; v.__actif = false;
    v.onplaying = v.onended = v.onerror = v.onloadedmetadata = v.oncanplay = null;
    try { v.pause(); } catch (e) {}
    if (v.getAttribute('src')) { v.removeAttribute('src'); try { v.load(); } catch (e2) {} }
    if (preparee && preparee.index === i) { preparee = null; }
  }
  function codeErreur(v) { return v.error ? 'code ' + v.error.code : 'inconnue'; }
  // Trois échecs de décodage en 24 h avec deux lecteurs chargés : on n'en garde plus qu'un.
  function echecVideo() {
    var s = lireJSON(K.video) || {}, t = Date.now();
    if (!s.le || t - s.le > 86400000 || s.lecteur !== VERSION) { s = { echecs: 0 }; }
    s.echecs = (s.echecs || 0) + 1; s.le = t; s.lecteur = VERSION;
    if (s.echecs >= 3 && modeVideo === 'double') { modeVideo = 'simple'; noter('passage à un seul lecteur vidéo'); }
    s.mode = modeVideo;
    ecrire(K.video, JSON.stringify(s));
  }
  // Un seul lecteur vidéo : l'image fixe de la vidéo suivante couvre le passage d'une vidéo à l'autre.
  function couvrirAvecPoster(d, suite) {
    var i = coucheLibre(), g = Gabarits.el('div', 'g');
    if (d.poster) { g = Gabarits.image({ contenu: { donnees: { src: d.poster } } }, urlDe).noeud; }
    vider(couches[i]); couches[i].appendChild(g);
    montrer({ type: 'couche', index: i });
    setTimeout(suite, 800);
  }
  function jouerVideo(e, n, liste, ecoule) {
    var d = e.contenu.donnees || {}, i, v, depuisCouche = !actif || actif.type === 'couche';
    preparee = null;
    // Page rechargée en pleine vidéo : on la relance du début. Sur les téléviseurs, l'avance jusqu'au point
    // d'interruption reste bloquée (journal du Hall : « bloquée après 10001 ms, état 1, temps 5.6 »).
    if (ecoule > 1) { tracer('reprise après rechargement : ' + e.cle + ' relancée du début'); ecoule = 0; }
    // Rien à l'écran (page rechargée) : l'image fixe de la vidéo couvre le chargement au lieu d'un écran noir.
    if (!actif && d.poster) {
      var ic = coucheLibre();
      vider(couches[ic]);
      couches[ic].appendChild(Gabarits.image({ contenu: { donnees: { src: d.poster } } }, urlDe).noeud);
      montrer({ type: 'couche', index: ic });
      depuisCouche = true;
    }
    if (modeVideo === 'simple' && actif && actif.type === 'video') {
      couvrirAvecPoster(d, function () { if (n === jeton) { jouerVideo(e, n, liste, ecoule); } });
      return;
    }
    i = videoPour(e, true);
    if (modeVideo === 'simple' && !estActif({ type: 'video', index: 1 - i })) { liberer(1 - i); }
    if (videos[i].__cle === e.cle && videos[i].getAttribute('src') && !videos[i].error) {
      lancer();
    } else {
      resoudre(e, function (url) { if (n !== jeton) { return; } charger(videos[i], e, url); lancer(); });
    }
    function echec(message, decodage) {
      clearTimeout(garde);
      noter(message + ' : ' + e.cle + ' (' + codeErreur(v) + ')');
      if (decodage && videos[1 - i].getAttribute('src')) { echecVideo(); }
      ecarter(e.cle);
      if (!estActif({ type: 'video', index: i })) { liberer(i); }
      avancer();
    }
    function lancer() {
      var parti = false, reste = Math.max((e.duree || d.duree || 120) - (ecoule || 0), 0), t0 = Date.now();
      v = videos[i];
      v.__actif = true;
      tracer('vidéo ' + e.cle + (v.readyState ? ' : préchargée (état ' + v.readyState + ')' : ''));
      v.onloadedmetadata = function () { tracer('métadonnées ' + v.videoWidth + '×' + v.videoHeight + ' en ' + (Date.now() - t0) + ' ms'); };
      v.oncanplay = function () { v.oncanplay = null; tracer('prête en ' + (Date.now() - t0) + ' ms'); };
      v.onplaying = function () {
        if (n !== jeton || parti) { return; }
        parti = true;
        clearTimeout(garde);
        tracer('lecture en ' + (Date.now() - t0) + ' ms');
        montrer({ type: 'video', index: i }, depuisCouche);
        // trois secondes plus tard : l'image avance-t-elle vraiment ? (une vidéo noire « qui joue » se voit ici)
        var c0 = v.currentTime, f0 = v.webkitDecodedFrameCount || 0;
        setTimeout(function () {
          if (n !== jeton) { return; }
          tracer('après 3 s : temps ' + (v.currentTime - c0).toFixed(1) + ' s, images ' + ((v.webkitDecodedFrameCount || 0) - f0) + ' (perdues ' + (v.webkitDroppedFrameCount || 0) + '), ' +
            v.videoWidth + '×' + v.videoHeight + ', visible ' + (v.classList.contains('visible') ? 'oui' : 'non'));
        }, 3000);
        garde = setTimeout(function () { if (n === jeton) { noter('vidéo trop longue : ' + e.cle); avancer(); } }, (reste + 15) * 1000);
        setTimeout(function () { if (n === jeton) { preparerSuivante(liste, e); } }, depuisCouche ? 900 : 300);
      };
      v.onended = function () { if (n === jeton) { avancer(); } };
      v.onerror = function () {
        if (n !== jeton) { return; }
        tracer('erreur ' + codeErreur(v));
        echec('vidéo illisible', v.error && v.error.code === 3);
      };
      // Pas de lecture au bout de 10 s : on passe à la suite (la vidéo est écartée 2 min).
      garde = setTimeout(function () {
        if (n !== jeton || parti) { return; }
        tracer('bloquée après ' + (Date.now() - t0) + ' ms : état ' + v.readyState + ', réseau ' + v.networkState + ', temps ' + v.currentTime.toFixed(1));
        echec('vidéo bloquée', true);
      }, 10000);
      function jouer() {
        var p;
        try {
          p = v.play();
          if (p && p['catch']) { p['catch'](function (err) { if (n === jeton && !parti) { noter('lecture refusée : ' + (err && err.name) + (err && err.message ? ' (' + String(err.message).slice(0, 80) + ')' : '')); } }); }
        } catch (x3) { tracer('play() : ' + x3.message); }
      }
      jouer();
    }
  }

  // Prépare l'étape suivante pendant que la courante s'affiche.
  function preparerSuivante(liste, e) {
    var s = Regles.suivante(liste, e.cle), i;
    libererBlobs([e, s]);
    if (!s || s.cle === e.cle || quarantaine[s.cle] > Date.now()) { return; }
    if (s.type === 'video') {
      if (modeVideo !== 'double') { return; }
      i = videoPour(s, false);
      if (i < 0) { return; }
      resoudre(s, function (url) {
        if (courante !== e || !libre(i)) { return; }
        if (videos[i].__cle !== s.cle || !videos[i].getAttribute('src') || videos[i].error) { charger(videos[i], s, url); }
        preparee = { cle: s.cle, index: i };
      });
    } else {
      resoudre(s, rien);
    }
  }

  // Toutes les 15 s : étape retirée, expirée, ou diffusion prioritaire qui commence ; nuit.
  function verifier() {
    if (!enRoute || !courante) { return; }
    var h = Regles.heureParis(maintenant()), calc;
    if (h.minutes >= 300 && h.minutes < 310 && Date.now() - demarreLe > 3 * 3600000) { W.location.reload(); return; }
    calc = Regles.etapes(prog, maintenant());
    if (!Regles.contient(calc.etapes, courante.cle) && !(courante.cle === 'veille' && calc.etapes[0].cle === 'veille')) { avancer(); }
  }

  /* ---------- programmation et signal ---------- */
  function requete(methode, url, corps, delai, ok, ko) {
    var x = new XMLHttpRequest(), fini = false;
    function fin(f, a, b) { if (!fini) { fini = true; f(a, b); } }
    try { x.open(methode, url, true); } catch (e) { fin(ko, 0, null); return; }
    x.timeout = delai;
    if (corps) { x.setRequestHeader('Content-Type', 'application/json'); }
    x.onload = function () {
      var r = null;
      try { r = JSON.parse(x.responseText); } catch (e) {}
      if (x.status >= 200 && x.status < 300 && r) { fin(ok, r); } else { fin(ko, x.status, r); }
    };
    x.onerror = x.ontimeout = function () { fin(ko, 0, null); };
    x.send(corps ? JSON.stringify(corps) : null);
  }
  function totalMemoire() {
    var t = 0, k;
    for (k in memoire) { if (memoire.hasOwnProperty(k)) { t += memoire[k] || 0; } }
    return t;
  }
  function interroger() {
    clearTimeout(minuterieReseau);
    var t0 = Date.now(), signal = {
      lecteur: VERSION, version: prog ? prog.version : 0, contenu: courante ? courante.cle : null,
      memoire: totalMemoire(), video: modeVideo, erreur: erreurs.length ? erreurs.slice(-3).join(' | ').slice(-300) : null,
      trace: traceVideo.length ? traceVideo.join(' | ').slice(-1900) : null,
      demarre: demarreLe, chargements: chargements, taille: W.innerWidth + 'x' + W.innerHeight
    };
    if (premierSignal) { signal.agent = navigator.userAgent; }
    requete('POST', '/api/flux/' + CODE, signal, 15000, function (r) {
      var t1 = Date.now();
      premierSignal = false; horsLigne = false; dernierContact = t1;
      if (typeof r.maintenant === 'number') {
        decalage = r.maintenant - Math.round((t0 + t1) / 2);
        ecrire(K.decalage, String(decalage));
      }
      if (!r.inchange) { recevoir(r); }
      else if (Date.now() - dernierTri > 600000) { gererMedias(); }
      if (r.flux && prog) { prog.flux = r.flux; }
      identifier(r.identifier || 0, r.flux && r.flux.nom);
      minuterieReseau = setTimeout(interroger, INTERVALLE);
    }, function (statut) {
      if (statut === 404) { fluxInconnu(); minuterieReseau = setTimeout(interroger, 300000); return; }
      horsLigne = true;
      noter('réseau : ' + (statut ? 'réponse ' + statut : 'serveur injoignable'));
      if (!enRoute && !inconnu) { demarrer(); }
      minuterieReseau = setTimeout(interroger, prog ? INTERVALLE : 10000);
    });
  }
  function recevoir(r) {
    inconnu = false;
    prog = { version: r.version, flux: r.flux, defaut: r.defaut || null, contenus: r.contenus || {}, diffusions: r.diffusions || [], reglages: r.reglages || null };
    ecrire(K.prog, JSON.stringify(prog));
    try { Gabarits.appliquerReglages(prog.reglages); } catch (e) { noter('réglages : ' + e.message); }
    gererMedias();
    if (!enRoute) { demarrer(); } else { verifier(); }
  }
  function identifier(jusqua, nom) {
    if (!(jusqua > maintenant()) || jusqua === identJusqua) { return; }
    identJusqua = jusqua;
    montrerIdentification(nom, Math.min(jusqua - maintenant(), 120000));
  }
  function montrerIdentification(nom, ms) {
    if (identNoeud && identNoeud.parentNode) { identNoeud.parentNode.removeChild(identNoeud); }
    identNoeud = Gabarits.identification(nom || (prog && prog.flux && prog.flux.nom) || CODE, CODE);
    scene.appendChild(identNoeud);
    var n = identNoeud;
    setTimeout(function () { if (n.parentNode) { n.parentNode.removeChild(n); } }, ms);
  }

  /* ---------- mémoire de l'écran (Cache API) ---------- */
  function gererMedias() {
    if (!cacheOk || !prog) { return; }
    dernierTri = Date.now();
    var h = Regles.heureParis(maintenant()), limite = Regles.ajouterJours(h.date, 2), ordre = [], utiles = {}, i, d, calc;
    // Images et images fixes seulement : sur les téléviseurs, une vidéo lue depuis cette mémoire ne charge jamais
    // (journal du Hall, 16 octobre 2026) ; les vidéos sont lues depuis le réseau, préchargées par le second lecteur.
    function ajouter(c) {
      var s = sourcesDe(c), j, p;
      for (j = 0; j < s.length; j++) {
        if (c.type === 'video' && c.donnees && s[j] === c.donnees.src) { continue; }
        p = chemin(s[j]); if (!utiles[p]) { utiles[p] = (c.donnees && s[j] === c.donnees.src && c.donnees.taille) || 0; ordre.push(p); }
      }
    }
    calc = Regles.etapes(prog, maintenant());
    for (i = 0; i < calc.etapes.length; i++) { if (calc.etapes[i].contenu) { ajouter(calc.etapes[i].contenu); } }
    for (i = 0; i < prog.diffusions.length; i++) {
      d = prog.diffusions[i];
      if (d.fin >= Regles.ajouterJours(h.date, -1) && d.debut <= limite && prog.contenus[d.contenu]) { ajouter(prog.contenus[d.contenu]); }
    }
    if (prog.defaut && prog.contenus[prog.defaut]) { ajouter(prog.contenus[prog.defaut]); }
    W.caches.open(CACHE).then(function (cache) {
      return cache.keys().then(function (cles) {
        var presents = {}, k, p;
        for (k = 0; k < cles.length; k++) {
          p = chemin(cles[k].url);
          if (!utiles.hasOwnProperty(p)) { cache['delete'](cles[k]); delete memoire[p]; }
          else { presents[p] = true; }
        }
        for (p in memoire) { if (memoire.hasOwnProperty(p) && !presents[p]) { delete memoire[p]; } }
        ecrire(K.medias, JSON.stringify(memoire));
      });
    }).then(function () { telecharger(ordre, utiles); }, function (err) { noter('mémoire : ' + (err && err.message)); });
  }
  function telecharger(liste, tailles) {
    if (telechargementEnCours) { return; }
    telechargementEnCours = true;
    var i = 0;
    function suivant() {
      var src, prevu;
      while (i < liste.length && (memoire[liste[i]] || echoues[liste[i]] > Date.now())) { i++; }
      if (i >= liste.length) { telechargementEnCours = false; ecrire(K.medias, JSON.stringify(memoire)); return; }
      src = liste[i++]; prevu = tailles[src] || 0;
      if (totalMemoire() + prevu > PLAFOND) { noter('mémoire pleine, lu depuis le réseau : ' + src); suivant(); return; }
      W.fetch(src, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) { throw new Error('réponse ' + r.status); }
        var taille = parseInt(r.headers.get('Content-Length'), 10) || prevu;
        if (taille && totalMemoire() + taille > PLAFOND) { throw new Error('mémoire pleine'); }
        return W.caches.open(CACHE).then(function (cache) {
          return cache.put(src, r).then(function () {
            if (taille) { memoire[src] = taille; return; }
            return cache.match(src).then(function (m) { return m.blob(); }).then(function (b) { memoire[src] = b.size || 1; });
          });
        });
      }).then(null, function (err) { echoues[src] = Date.now() + 600000; noter('téléchargement ' + src + ' : ' + (err && (err.name === 'QuotaExceededError' ? 'stockage plein' : err.message))); })
        .then(function () { ecrire(K.medias, JSON.stringify(memoire)); setTimeout(suivant, 300); });
    }
    suivant();
  }

  /* ---------- écrans sans flux ---------- */
  function ecranMessage(titre, texte, liens) {
    var g = Gabarits.el('div', 'g g-veille'), m = Gabarits.el('div', 'g-menu'), i, a;
    m.appendChild(Gabarits.el('h1', '', titre));
    if (texte) { m.appendChild(Gabarits.el('p', '', texte)); }
    for (i = 0; liens && i < liens.length; i++) {
      a = Gabarits.el('a', '', liens[i].nom);
      a.href = '/?flux=' + liens[i].code;
      a.appendChild(Gabarits.el('span', '', 'tv.6mic-aix.fr/?flux=' + liens[i].code));
      m.appendChild(a);
    }
    g.appendChild(m);
    clearTimeout(minuterie);
    jeton++;
    vider(couches[0]); couches[0].appendChild(g);
    couches[0].style.zIndex = ++zHaut;
    couches[0].classList.add('visible');
    vider(couches[1]); couches[1].classList.remove('visible');
    actif = { type: 'couche', index: 0 };
    D.body.style.cursor = 'default';
    W.__tvStarted = true;
  }
  function menu(titre, texte) {
    ecranMessage(titre || 'Écrans TV 6MIC', texte || 'Choisissez le flux de cet écran :', []);
    requete('GET', '/api/flux', null, 15000, function (r) {
      ecranMessage(titre || 'Écrans TV 6MIC', texte || 'Choisissez le flux de cet écran :', r.flux || []);
    }, rien);
  }
  function fluxInconnu() {
    inconnu = true; enRoute = false;
    clearTimeout(minuterie); clearTimeout(garde);
    liberer(0); liberer(1);
    prog = null; courante = null;
    try { W.localStorage.removeItem(K.prog); } catch (e) {}
    menu('Flux inconnu', 'L’adresse demande le flux « ' + CODE + ' », qui n’existe pas. Flux disponibles :');
  }

  /* ---------- suivi technique (?debug=1) ---------- */
  function majSuivi() {
    if (!suiviNoeud) { suiviNoeud = Gabarits.el('div'); suiviNoeud.id = 'suivi'; D.body.appendChild(suiviNoeud); }
    var h = Regles.heureParis(maintenant());
    suiviNoeud.textContent = [
      'flux ' + CODE + ' · lecteur ' + VERSION + ' · programmation v' + (prog ? prog.version : '–'),
      'heure de Paris ' + h.date + ' ' + Math.floor(h.minutes / 60) + ':' + ('0' + h.minutes % 60).slice(-2) + ' · décalage ' + decalage + ' ms',
      'étape ' + (courante ? courante.cle + ' (' + courante.type + ', ' + courante.duree + ' s)' : '–'),
      'vidéo ' + modeVideo + (preparee ? ' · préparée ' + preparee.cle : ''),
      'mémoire ' + (totalMemoire() / 1048576).toFixed(1) + ' Mo' + (telechargementEnCours ? ' · téléchargement…' : ''),
      (horsLigne ? 'HORS LIGNE' : 'en ligne') + ' · chargements ' + chargements + ' · page ' + W.innerWidth + '×' + W.innerHeight
    ].concat(erreurs.slice(-4)).join('\n');
  }

  /* ---------- démarrage ---------- */
  function init() {
    scene = D.getElementById('scene');
    couches = [D.getElementById('c0'), D.getElementById('c1')];
    videos = [D.getElementById('v0'), D.getElementById('v1')];
    ajuster();
    W.addEventListener('resize', ajuster);
    chargements = (parseInt(lire(K.chargements), 10) || 0) + 1;
    ecrire(K.chargements, String(chargements));
    decalage = parseInt(lire(K.decalage), 10) || 0;
    var mv = lireJSON(K.video);
    if (mv && mv.mode === 'simple' && mv.lecteur === VERSION && Date.now() - mv.le < 7 * 86400000) { modeVideo = 'simple'; }
    if (SUIVI) { setInterval(majSuivi, 1000); }
    if (!CODE) { menu(); return; }
    memoire = lireJSON(K.medias) || {};
    prog = lireJSON(K.prog);
    if (prog && prog.reglages) { try { Gabarits.appliquerReglages(prog.reglages); } catch (e) {} }
    demarrer();                                   // tout de suite : programmation gardée, ou écran « Chargement… »
    if (prog) { gererMedias(); }
    interroger();
    if (params.ident === '1') { setTimeout(function () { montrerIdentification(null, 20000); }, 1500); }
    if (navigator.serviceWorker && (W.location.protocol === 'https:' || W.location.hostname === 'localhost')) {
      try { navigator.serviceWorker.register('/sw.js').then(null, rien); } catch (e) {}
    }
  }

  W.TV6MIC = { version: VERSION, etat: function () { return { courante: courante, prog: prog, modeVideo: modeVideo, memoire: memoire, erreurs: erreurs, actif: actif }; } };
  init();
}());
