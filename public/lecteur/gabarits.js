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
    var taille = max, essais = 0, cs = window.getComputedStyle(noeud);
    // hauteur du texte seul : sans la marge intérieure (place des accents du titre de l'agenda)
    function hauteur() { return noeud.offsetHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0); }
    noeud.style.fontSize = taille + 'px';
    while (essais < 40 && taille > min &&
           (noeud.scrollWidth > noeud.clientWidth + 2 || hauteur() > taille * 0.92 * lignes + 4)) {
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

  /* Motifs du design system 6MIC, posés sur la photo des soirées.
     faisceaux : traits du logo (motif « focus », vectoriel) ; rayons : texture rayonnante des aplats du site ;
     hachures : traits à 41,3° des affiches de l'agenda. Chaque motif se colore (masque CSS) et se place sur un bord. */
  var MOTIFS = { faisceaux: 'Faisceaux', rayons: 'Rayons', hachures: 'Hachures', aucun: 'Aucun' };
  var POSITIONS = { droite: 'Droite', gauche: 'Gauche', haut: 'Haut', bas: 'Bas' };
  var COULEURS = { rose: 'Rose', violet: 'Violet', degrade: 'Dégradé', blanc: 'Blanc' };
  var MOTIF_DEFAUT = { type: 'faisceaux', position: 'droite', couleur: 'degrade' };
  // Couleur personnalisée : « #rrggbb » à la place d'un nom de couleur.
  var TEINTE = /^#[0-9a-fA-F]{6}$/;
  var TEINTES = { rose: '#e744a8', violet: '#8e63ff', degrade: '#e744a8', blanc: '#ffffff' };
  // Réglage complet : celui du contenu, complété par le motif par défaut (les soirées sans réglage ont le motif par défaut).
  function connu(liste, v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(liste, v); }
  function motifDe(d) {
    var m = (d && d.motif) || {};
    return {
      type: connu(MOTIFS, m.type) ? m.type : MOTIF_DEFAUT.type,
      position: connu(POSITIONS, m.position) ? m.position : MOTIF_DEFAUT.position,
      couleur: connu(COULEURS, m.couleur) || (typeof m.couleur === 'string' && TEINTE.test(m.couleur)) ? m.couleur.toLowerCase() : MOTIF_DEFAUT.couleur
    };
  }
  function motif(d) {
    var m = motifDe(d), boite;
    if (m.type === 'aucun') { return null; }
    var perso = TEINTE.test(m.couleur), calque = el('div', 'g-deco-m');
    boite = el('div', 'g-deco a a0 g-d-' + m.type + ' g-d-' + m.position + ' g-c-' + (perso ? 'perso' : m.couleur));
    if (perso) { calque.style.backgroundColor = m.couleur; }
    boite.appendChild(calque);
    return boite;
  }

  /* 1. Soirée : photo plein cadre, date, nom, infos, mention, QR code de la billetterie */
  function soiree(etape, url) {
    var c = etape.contenu, d = c.donnees || {}, g = el('div', 'g g-soiree');
    var photo = el('div', 'g-photo'), bloc = el('div', 'g-bloc'), nom, q, deco;
    fond(photo, d.photo && d.photo.src, url);
    photo.style.webkitAnimationDuration = photo.style.animationDuration = Math.max(8, (etape.duree || 10) + 2) + 's';
    g.appendChild(photo);
    g.appendChild(el('div', 'g-voile'));
    deco = motif(d);
    if (deco) { g.appendChild(deco); }
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

  /* 4. Série : 2 à 4 dates mises en avant (promo thématique, même esthétique, artistes proches de la soirée).
     Aplat de couleur du design system avec la texture rayonnante, titre façon section du site (marqueur ■■■),
     affiches côte à côte, le texte sous la photo (jamais dessus), « Ce soir » et « Demain » mis en évidence. */
  var FONDS_SERIE = { violet: 'Violet', rose: 'Rose', degrade: 'Dégradé', noir: 'Noir' };
  function lendemain(date) {
    var p = String(date).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function quandSerie(x, service) {
    var p = parties(x.date), h = x.heure ? ' · ' + heureTexte(x.heure) : '';
    if (service && x.date === service) { return { texte: 'Ce soir' + h, proche: true }; }
    if (service && x.date === lendemain(service)) { return { texte: 'Demain' + h, proche: true }; }
    return { texte: JOURS_COURTS[p.j] + ' ' + (p.n === 1 ? '1er' : p.n) + ' ' + MOIS_COURTS[p.m] + h, proche: false };
  }
  // Cadre de la photo à l'écran, en pixels : le back-office l'indique à l'import et y recadre ses vignettes.
  var CADRES = {
    soiree: { largeur: 1920, hauteur: 1080 },   // plein cadre (zoom lent de 8 %)
    agenda: { largeur: 1920, hauteur: 1080 },   // fond très assombri
    lineup: { largeur: 820, hauteur: 1080 },    // panneau de droite, bord gauche fondu au noir
    image: { largeur: 1920, hauteur: 1080 }
  };
  // Série : 1680 px partagés entre les affiches (écart 48 px), 816 px au plus ; photo 3:4, 470 px de haut au plus.
  function cadreSerie(n) {
    n = Math.max(1, n);
    var largeur = Math.min(816, Math.floor((1680 - (n - 1) * 48) / n));
    return { largeur: largeur, hauteur: Math.min(n <= 2 ? 440 : 470, Math.round(largeur * 4 / 3)) };
  }
  function serie(etape, url) {
    var c = etape.contenu, d = c.donnees || {}, dates = etape.dates || [], n = Math.max(1, dates.length);
    var g = el('div', 'g g-serie g-f-' + (FONDS_SERIE[d.fond] ? d.fond : 'violet') + ' g-s-' + n);
    var tete = el('div', 'g-s-tete'), rang = el('div', 'g-s-cartes'), titre, noms = [], i, x, carte, photo, corps, q, nom;
    var cadre = cadreSerie(n), largeur = cadre.largeur, hauteur = cadre.hauteur;
    var tailleNom = n <= 2 ? 72 : (n === 3 ? 66 : 64);
    g.appendChild(el('div', 'g-s-rayons'));
    g.appendChild(logo('g-logo a a0'));
    if (d.accroche) { tete.appendChild(el('div', 'g-s-accroche a a0', d.accroche)); }
    titre = el('div', 'g-s-titre a a1', d.titre || c.titre);
    tete.appendChild(titre);
    tete.appendChild(el('div', 'g-s-marque a a1'));
    g.appendChild(tete);
    for (i = 0; i < dates.length; i++) {
      x = dates[i]; q = quandSerie(x, etape.service);
      carte = el('div', 'g-s-carte');
      carte.style.width = largeur + 'px';
      carte.style.webkitAnimationDelay = carte.style.animationDelay = (0.45 + i * 0.16).toFixed(2) + 's';
      photo = el('div', 'g-s-photo' + (x.photo && x.photo.src ? '' : ' g-s-vide'));
      photo.style.height = hauteur + 'px';
      if (x.photo && x.photo.src) { fond(photo, x.photo.src, url); } else { photo.appendChild(el('div', 'g-s-vide-m')); }
      if (x.mention) { photo.appendChild(el('div', 'g-s-mention' + (/complet|annul/i.test(x.mention) ? ' g-rouge' : ''), x.mention)); }
      carte.appendChild(photo);
      corps = el('div', 'g-s-corps');
      corps.appendChild(el('div', 'g-s-quand' + (q.proche ? ' g-s-proche' : ''), q.texte));
      nom = el('div', 'g-s-nom', x.nom || '');
      noms.push(nom);
      corps.appendChild(nom);
      carte.appendChild(corps);
      rang.appendChild(carte);
    }
    g.appendChild(rang);
    return { noeud: g, ajuster: function () {
      ajusterTexte(titre, 136, 72, 1);
      for (var k = 0; k < noms.length; k++) { ajusterTexte(noms[k], tailleNom, 34, 2); }
    } };
  }

  /* 5. Line-up : programme de la soirée en frise horaire (ouverture, première partie, tête d'affiche, fermeture…).
     Le jour de la soirée, le passage en cours est mis en avant (« En ce moment »), le suivant annoncé (« À suivre »),
     les passages terminés s'estompent. Photo de la tête d'affiche à droite (sinon aplat avec les faisceaux du logo). */
  var ROLES_LINEUP = { ouverture: 'Ouverture des portes', premiere: 'Première partie', tete: 'Tête d’affiche', dj: 'DJ set', fermeture: 'Fermeture', autre: '' };
  // Mise en valeur d'un passage, choisie librement ; sans choix, elle suit le rôle (la tête d'affiche en vedette).
  var NIVEAUX_LINEUP = { vedette: 'Vedette', forte: 'Forte', normale: 'Normale', discrete: 'Discrète' };
  var TAILLES_NIVEAU = { vedette: [96, 72], forte: [82, 64], normale: [68, 56], discrete: [48, 40] };
  function niveauParDefaut(role) { return role === 'tete' ? 'vedette' : 'normale'; }
  function niveauPassage(p) { return p && NIVEAUX_LINEUP[p.niveau] ? p.niveau : niveauParDefaut(p && p.role); }
  // Nom mis en avant (titre par défaut) : le premier passage en vedette, sinon la première tête d'affiche.
  function vedetteDe(passages) {
    var i, t = null, p;
    for (i = 0; i < (passages || []).length; i++) {
      p = passages[i];
      if (p && p.nom) {
        if (niveauPassage(p) === 'vedette') { return p.nom; }
        if (!t && p.role === 'tete') { t = p.nom; }
      }
    }
    return t;
  }
  // minutes depuis minuit, la soirée continuant après minuit (00:30 vient après 23:00 ; bascule à 6 h comme les programmations)
  function minutesSoiree(hhmm) {
    var p = String(hhmm || '').split(':'), m = (+p[0]) * 60 + (+p[1] || 0);
    return m < 360 ? m + 1440 : m;
  }
  function lineup(etape, url) {
    var c = etape.contenu, d = c.donnees || {}, g = el('div', 'g g-lineup'), i, p, ligne, texte, role, nom, etat, niveau, noms = [];
    var passages = [], brut = d.passages || [];
    for (i = 0; i < brut.length; i++) { if (brut[i] && brut[i].heure) { passages.push(brut[i]); } }
    passages.sort(function (a, b) { return minutesSoiree(a.heure) - minutesSoiree(b.heure); });
    var n = passages.length, jourJ = !!(etape.service && d.date === etape.service);
    var maintenant = jourJ && typeof etape.minutes === 'number' ? (etape.minutes < 360 ? etape.minutes + 1440 : etape.minutes) : null;
    var courant = -1, tete = vedetteDe(passages);
    for (i = 0; i < n; i++) {
      if (maintenant !== null && minutesSoiree(passages[i].heure) <= maintenant) { courant = i; }
    }
    // panneau de droite : photo, sinon aplat dégradé avec les faisceaux
    var panneau = el('div', 'g-l-panneau a a0' + (d.photo && d.photo.src ? '' : ' g-l-sansphoto'));
    if (d.photo && d.photo.src) { fond(panneau, d.photo.src, url); } else { panneau.appendChild(el('div', 'g-l-motif')); }
    g.appendChild(panneau);
    g.appendChild(el('div', 'g-l-fondu'));
    g.appendChild(logo('g-logo a a0'));
    var entete = el('div', 'g-l-tete');
    entete.appendChild(el('div', 'g-l-quand a a0', (jourJ ? 'Ce soir' : (d.date ? dateLongue(d.date) : 'Programme de la soirée')) + (d.lieu ? ' · ' + d.lieu : '')));
    var titre = el('div', 'g-l-titre a a1', d.titre || tete || c.titre);
    entete.appendChild(titre);
    g.appendChild(entete);
    // frise : hauteur des lignes selon leur nombre (670 px disponibles)
    var liste = el('div', 'g-l-liste g-l-' + Math.max(1, Math.min(n, 8))), hauteurLigne = Math.min(176, Math.floor(670 / Math.max(n, 1)));
    liste.appendChild(el('div', 'g-l-trait'));
    for (i = 0; i < n; i++) {
      p = passages[i];
      etat = maintenant === null ? '' : (i < courant ? ' g-l-passe' : (i === courant ? ' g-l-encours' : (i === courant + 1 ? ' g-l-suivant' : '')));
      niveau = niveauPassage(p);
      ligne = el('div', 'g-l-ligne g-l-r-' + (ROLES_LINEUP[p.role] !== undefined ? p.role : 'autre') + ' g-l-v-' + niveau + etat + (p.nom ? '' : ' g-l-seul'));
      ligne.style.height = hauteurLigne + 'px';
      ligne.style.webkitAnimationDelay = ligne.style.animationDelay = (0.35 + i * 0.12).toFixed(2) + 's';
      ligne.appendChild(el('div', 'g-l-heure', p.heure));
      ligne.appendChild(el('div', 'g-l-point'));
      texte = el('div', 'g-l-texte');
      role = el('div', 'g-l-role', p.libelle || ROLES_LINEUP[p.role] || '');
      if (i === courant) { role.appendChild(el('span', 'g-l-badge', 'En ce moment')); }
      else if (maintenant !== null && i === courant + 1) { role.appendChild(el('span', 'g-l-badge g-l-badge-suivant', 'À suivre')); }
      texte.appendChild(role);
      if (p.nom) {
        nom = el('div', 'g-l-nom', p.nom);
        noms.push([nom, TAILLES_NIVEAU[niveau]]);
        texte.appendChild(nom);
      }
      ligne.appendChild(texte);
      liste.appendChild(ligne);
    }
    g.appendChild(liste);
    return { noeud: g, ajuster: function () {
      var grand = hauteurLigne >= 150, k;
      ajusterTexte(titre, 120, 64, 1);
      for (k = 0; k < noms.length; k++) { ajusterTexte(noms[k][0], noms[k][1][grand ? 0 : 1], 28, 1); }
    } };
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
    soiree: soiree, lineup: lineup, agenda: agenda, serie: serie, image: image, veille: veille, identification: identification,
    FONDS_SERIE: FONDS_SERIE, ROLES_LINEUP: ROLES_LINEUP, NIVEAUX_LINEUP: NIVEAUX_LINEUP, niveauPassage: niveauPassage, niveauParDefaut: niveauParDefaut, vedetteDe: vedetteDe, minutesSoiree: minutesSoiree, CADRES: CADRES, cadreSerie: cadreSerie,
    dateLongue: dateLongue, heureTexte: heureTexte, el: el,
    MOTIFS: MOTIFS, POSITIONS: POSITIONS, COULEURS: COULEURS, MOTIF_DEFAUT: MOTIF_DEFAUT, TEINTES: TEINTES, TEINTE: TEINTE, motifDe: motifDe
  };
}(this));
