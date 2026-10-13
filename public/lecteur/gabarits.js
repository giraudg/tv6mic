/* Écrans TV 6MIC : gabarits (Soirée, Agenda, Image, écran de veille, identification).
   Chaque gabarit fabrique un nœud 1920 × 1080 ; ses animations d'entrée démarrent quand
   le lecteur ajoute la classe « joue ». Partagé par le lecteur et l'aperçu du back-office.
   ES5 uniquement : les écrans utilisent Chromium 56. */
(function (racine) {
  'use strict';

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var LOGO = '/logo/6mic-logo-blanc-tv.png';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function el(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) { n.className = classe; }
    if (texte !== undefined && texte !== null && texte !== '') { n.appendChild(document.createTextNode(String(texte))); }
    return n;
  }
  function parties(date) {
    var p = String(date).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return { j: d.getUTCDay(), n: d.getUTCDate(), m: d.getUTCMonth() };
  }
  function dateLongue(date) {
    var p = parties(date);
    return JOURS[p.j] + ' ' + (p.n === 1 ? '1er' : p.n) + ' ' + MOIS[p.m];
  }
  function heureTexte(h) {
    if (!h) { return ''; }
    var p = String(h).split(':'), m = parseInt(p[1], 10) || 0;
    return (parseInt(p[0], 10) || 0) + ' h' + (m ? ' ' + pad(m) : '');
  }
  function logo(classe) {
    var i = el('img', classe);
    i.src = LOGO; i.alt = '6MIC';
    return i;
  }
  function fond(noeud, src, url) {
    if (src) { noeud.style.backgroundImage = 'url("' + url(src).replace(/"/g, '%22') + '")'; }
  }
  // Réduit la taille du texte jusqu'à tenir dans sa boîte (largeur du bloc, nombre de lignes).
  function ajusterTexte(noeud, max, min, lignes) {
    var taille = max, essais = 0;
    noeud.style.fontSize = taille + 'px';
    while (essais < 40 && taille > min &&
           (noeud.scrollWidth > noeud.clientWidth + 2 || noeud.offsetHeight > taille * 0.92 * lignes + 4)) {
      taille -= 6; essais++;
      noeud.style.fontSize = taille + 'px';
    }
  }
  function qr(texte, legende) {
    var boite = el('div', 'g-qr a a4');
    try {
      var q = racine.qrcode(0, 'M');
      q.addData(texte); q.make();
      boite.innerHTML = q.createSvgTag(6, 0);
    } catch (e) { return null; }
    boite.appendChild(el('span', '', legende));
    return boite;
  }

  /* 1. Soirée : photo plein cadre, date, nom, infos, mention, QR code de la billetterie */
  function soiree(etape, url) {
    var c = etape.contenu, d = c.donnees || {}, g = el('div', 'g g-soiree');
    var photo = el('div', 'g-photo'), bloc = el('div', 'g-bloc'), nom, q;
    fond(photo, d.photo && d.photo.src, url);
    photo.style.webkitAnimationDuration = photo.style.animationDuration = Math.max(8, (etape.duree || 10) + 2) + 's';
    g.appendChild(photo);
    g.appendChild(el('div', 'g-voile'));
    g.appendChild(logo('g-logo a a0'));
    if (d.mention) { g.appendChild(el('div', 'g-mention a a0' + (/complet|annul/i.test(d.mention) ? ' g-rouge' : ''), d.mention)); }
    if (d.date) { bloc.appendChild(el('div', 'g-date a a1', dateLongue(d.date) + (d.heure ? ' · ' + heureTexte(d.heure) : ''))); }
    nom = el('div', 'g-nom a a2', d.nom || c.titre);
    bloc.appendChild(nom);
    if (d.infos) { bloc.appendChild(el('div', 'g-infos a a3', d.infos)); }
    g.appendChild(bloc);
    if (d.billetterie) { q = qr(d.billetterie, 'Billetterie'); if (q) { g.appendChild(q); g.className += ' g-avec-qr'; } }
    return { noeud: g, ajuster: function () { ajusterTexte(nom, 190, 90, 2); } };
  }

  /* 2. Agenda : titre, puis une ligne par date (8 au plus par page) */
  function agenda(etape, url) {
    var c = etape.contenu, d = c.donnees || {}, g = el('div', 'g g-agenda' + (etape.dates.length <= 5 ? ' g-court' : ''));
    var tete = el('div', 'g-entete'), liste = el('div', 'g-liste'), titre, i, x, p, ligne, quand;
    if (d.photo && d.photo.src) { var f = el('div', 'g-fond'); fond(f, d.photo.src, url); g.appendChild(f); }
    tete.appendChild(el('div', 'g-motif'));
    titre = el('div', 'g-titre a a1', d.titre || c.titre);
    tete.appendChild(titre);
    tete.appendChild(logo('g-logo'));
    g.appendChild(tete);
    for (i = 0; i < etape.dates.length; i++) {
      x = etape.dates[i]; p = parties(x.date);
      ligne = el('div', 'g-ligne');
      ligne.style.webkitAnimationDelay = ligne.style.animationDelay = (0.3 + i * 0.09).toFixed(2) + 's';
      quand = el('div', 'g-quand');
      quand.appendChild(el('span', 'g-j', JOURS_COURTS[p.j]));
      quand.appendChild(el('b', '', p.n));
      quand.appendChild(el('span', 'g-m', MOIS_COURTS[p.m]));
      ligne.appendChild(quand);
      ligne.appendChild(el('div', 'g-quoi', x.nom));
      if (x.mention) { ligne.appendChild(el('div', 'g-etiq' + (/complet|annul/i.test(x.mention) ? ' g-rouge' : ''), x.mention)); }
      liste.appendChild(ligne);
    }
    g.appendChild(liste);
    if (etape.pages > 1) { g.appendChild(el('div', 'g-page a a3', etape.page + ' / ' + etape.pages)); }
    return { noeud: g, ajuster: function () { ajusterTexte(titre, 128, 64, 1); } };
  }

  /* 3. Image importée */
  function image(etape, url) {
    var d = etape.contenu.donnees || {}, g = el('div', 'g g-image' + (d.ajustement === 'ajuster' ? ' g-contenir' : ''));
    fond(g, d.src, url);
    return { noeud: g };
  }

  /* Écran de veille : logo sur fond noir, déplacé à chaque passage pour éviter le marquage */
  function veille(texte) {
    var g = el('div', 'g g-veille'), l = logo('g-veille-logo');
    var dx = Math.round(Math.random() * 240 - 120), dy = Math.round(Math.random() * 160 - 80);
    l.style.webkitTransform = l.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    g.appendChild(l);
    if (texte) { g.appendChild(el('div', 'g-veille-texte', texte)); }
    return { noeud: g };
  }

  /* Identification de l'écran : nom du flux en grand */
  function identification(nom, code) {
    var g = el('div', 'g-ident');
    g.appendChild(el('div', 'g-ident-l', 'Cet écran affiche le flux'));
    g.appendChild(el('div', 'g-ident-nom', nom));
    g.appendChild(el('div', 'g-ident-code', 'tv.6mic-aix.fr/?flux=' + code));
    return g;
  }

  racine.Gabarits = {
    soiree: soiree, agenda: agenda, image: image, veille: veille, identification: identification,
    dateLongue: dateLongue, heureTexte: heureTexte, el: el
  };
}(this));
