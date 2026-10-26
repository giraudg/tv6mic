/* Écrans TV 6MIC : règles de programmation.
   Calcule, pour un flux et un instant, la liste des étapes à faire tourner.
   Partagé par le lecteur des écrans et les tests (et plus tard le back-office).
   ES5 uniquement : les écrans utilisent Chromium 56. */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) { module.exports = fabrique(); }
  else { racine.Regles = fabrique(); }
}(this, function () {
  'use strict';

  var DUREES = { soiree: 10, lineup: 12, agenda: 15, serie: 12, image: 8, video: 0, web: 30, veille: 60 };
  var SERIE_MAX = 4;         // dates d'une série
  var PAR_PAGE = 6;          // dates par page d'agenda (au-delà de 6 lignes, la lecture à distance devient difficile)
  var BASCULE = 6 * 60;      // avant 6 h du matin, on est encore dans la soirée de la veille

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function indexDe(liste, valeur) {
    for (var i = 0; i < liste.length; i++) { if (liste[i] === valeur) { return i; } }
    return -1;
  }

  /* ---- heure de Paris, sans dépendre du fuseau ni d'Intl ---- */
  function dernierDimanche(annee, mois) {
    var d = new Date(Date.UTC(annee, mois + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  }
  // Heure d'été : du dernier dimanche de mars au dernier dimanche d'octobre, à 1 h UTC.
  function decalageParis(ms) {
    var a = new Date(ms).getUTCFullYear();
    var ete = Date.UTC(a, 2, dernierDimanche(a, 2), 1), hiver = Date.UTC(a, 9, dernierDimanche(a, 9), 1);
    return (ms >= ete && ms < hiver) ? 120 : 60;
  }
  function dateTexte(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  // { date: 'AAAA-MM-JJ', minutes: 0…1439, secondes, semaine: 1 (lundi) … 7 (dimanche) }
  function heureParis(ms) {
    var d = new Date(ms + decalageParis(ms) * 60000), j = d.getUTCDay();
    return { date: dateTexte(d), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), secondes: d.getUTCSeconds(), semaine: j === 0 ? 7 : j };
  }
  function ajouterJours(date, n) {
    var p = date.split('-');
    return dateTexte(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)));
  }
  function jourSemaine(date) {
    var p = date.split('-'), j = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return j === 0 ? 7 : j;
  }
  function enMinutes(hhmm) {
    var p = String(hhmm || '0:0').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  // La soirée en cours : avant 6 h, c'est encore celle de la veille.
  function jourDeService(h) { return h.minutes < BASCULE ? ajouterJours(h.date, -1) : h.date; }

  /* ---- une diffusion est-elle active ? ---- */
  function couvreJour(d, date) {
    if (date < d.debut || date > d.fin) { return false; }
    if (d.jours && d.jours.length && indexDe(d.jours, date) < 0) { return false; }
    if (d.semaine && d.semaine.length && indexDe(d.semaine, jourSemaine(date)) < 0) { return false; }
    return true;
  }
  // Sans plage horaire, une journée va de 6 h à 6 h le lendemain (comme une soirée de concert).
  // Une plage qui passe minuit (20:00–02:00) appartient au jour où elle commence.
  function estActive(d, h) {
    var plages = d.plages, i, debut, fin;
    if (!plages || !plages.length) { return couvreJour(d, jourDeService(h)); }
    for (i = 0; i < plages.length; i++) {
      debut = enMinutes(plages[i][0]); fin = enMinutes(plages[i][1]);
      if (fin > debut) {
        if (h.minutes >= debut && h.minutes < fin && couvreJour(d, h.date)) { return true; }
      } else {
        if (h.minutes >= debut && couvreJour(d, h.date)) { return true; }
        if (h.minutes < fin && couvreJour(d, ajouterJours(h.date, -1))) { return true; }
      }
    }
    return false;
  }

  /* ---- étapes de la boucle ---- */
  function datesAVenir(c, service) {
    var dates = (c.donnees && c.donnees.dates) || [], r = [], i;
    for (i = 0; i < dates.length; i++) { if (dates[i] && dates[i].date >= service) { r.push({ d: dates[i], i: i }); } }
    // même jour : l'heure, puis l'ordre saisi (le tri de Chromium 56 n'est pas stable au-delà de 10 éléments)
    r.sort(function (a, b) {
      var x = a.d.date + ' ' + (a.d.heure || ''), y = b.d.date + ' ' + (b.d.heure || '');
      return x < y ? -1 : (x > y ? 1 : a.i - b.i);
    });
    for (i = 0; i < r.length; i++) { r[i] = r[i].d; }
    return r;
  }
  // Contenu affichable : soirée pas encore passée, agenda ou série avec des dates à venir, média présent.
  function utilisable(c, service) {
    var d = c.donnees || {};
    if (c.type === 'soiree' || c.type === 'lineup') { return !(d.date && service > d.date); }
    if (c.type === 'agenda' || c.type === 'serie') { return datesAVenir(c, service).length > 0; }
    if (c.type === 'web') { return !!d.url; }
    return !!d.src;
  }
  function duree(c) {
    if (c.duree > 0) { return c.duree; }
    if (c.type === 'video') { return (c.donnees && c.donnees.duree) || 0; }
    return DUREES[c.type] || 10;
  }
  function cleSoiree(c) { return ((c.donnees && c.donnees.date) || '9999') + ' ' + ((c.donnees && c.donnees.heure) || ''); }
  function comparer(a, b) {
    var oa = a.d.ordre || 0, ob = b.d.ordre || 0, sa, sb;
    if (oa !== ob) { return oa === 0 ? 1 : (ob === 0 ? -1 : oa - ob); }
    sa = a.c.type === 'soiree'; sb = b.c.type === 'soiree';
    if (sa !== sb) { return sa ? -1 : 1; }
    if (sa) { sa = cleSoiree(a.c); sb = cleSoiree(b.c); if (sa !== sb) { return sa < sb ? -1 : 1; } }
    sa = a.d.cree_le || ''; sb = b.d.cree_le || '';
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
  }
  function etapesDe(c, service, extra, minutes) {
    var r = [], dates, pages, parPage, p;
    if (c.type === 'agenda') {
      dates = datesAVenir(c, service);
      pages = Math.ceil(dates.length / PAR_PAGE);
      parPage = Math.ceil(dates.length / (pages || 1));   // pages équilibrées : 10 dates = 5 + 5
      for (p = 0; p < pages; p++) {
        r.push({ cle: c.id + '#' + (p + 1), type: 'agenda', contenu: c, duree: duree(c), page: p + 1, pages: pages,
          dates: dates.slice(p * parPage, (p + 1) * parPage), defaut: !!extra });
      }
      return r;
    }
    if (c.type === 'lineup') {
      // l'heure de Paris permet de marquer le passage en cours et le suivant, le jour de la soirée
      return [{ cle: c.id, type: 'lineup', contenu: c, duree: duree(c), service: service, minutes: minutes, defaut: !!extra }];
    }
    if (c.type === 'serie') {
      // les dates passées disparaissent ; « ce soir » et « demain » se calculent sur le jour de service
      return [{ cle: c.id, type: 'serie', contenu: c, duree: duree(c), dates: datesAVenir(c, service).slice(0, SERIE_MAX), service: service, defaut: !!extra }];
    }
    return [{ cle: c.id, type: c.type, contenu: c, duree: duree(c), defaut: !!extra }];
  }

  /* prog : { contenus: {id: contenu}, diffusions: [...], defaut: id|null }
     → { etapes: [...], prioritaire: bool, service: 'AAAA-MM-JJ' } */
  function etapes(prog, ms) {
    var h = heureParis(ms), service = jourDeService(h), retenues = [], vus = {}, i, d, c, pri = null, r = [], def;
    var diffs = (prog && prog.diffusions) || [], contenus = (prog && prog.contenus) || {};
    for (i = 0; i < diffs.length; i++) {
      d = diffs[i]; c = contenus[d.contenu];
      if (!c || !estActive(d, h) || !utilisable(c, service)) { continue; }
      if (d.prioritaire) {
        if (!pri || (d.modifie_le || '') > (pri.d.modifie_le || '')) { pri = { d: d, c: c }; }
        continue;
      }
      retenues.push({ d: d, c: c });
    }
    if (pri) { retenues = [pri]; }
    retenues.sort(comparer);
    for (i = 0; i < retenues.length; i++) {
      c = retenues[i].c;
      if (vus[c.id]) { continue; }
      vus[c.id] = true;
      r = r.concat(etapesDe(c, service, false, h.minutes));
    }
    if (!r.length) {
      def = prog && prog.defaut && contenus[prog.defaut];
      if (def && utilisable(def, service)) { r = etapesDe(def, service, true, h.minutes); }
      if (!r.length) { r = [{ cle: 'veille', type: 'veille', contenu: null, duree: DUREES.veille, defaut: true }]; }
    }
    return { etapes: r, prioritaire: !!pri, service: service };
  }

  // Étape qui suit celle de clé « cle » (la première si elle n'est plus dans la liste).
  function suivante(liste, cle) {
    var i;
    for (i = 0; i < liste.length; i++) { if (liste[i].cle === cle) { return liste[(i + 1) % liste.length]; } }
    if (cle && cle.indexOf('#') > 0) {           // page d'agenda disparue : reprendre au même contenu
      var id = cle.split('#')[0];
      for (i = 0; i < liste.length; i++) { if (liste[i].contenu && liste[i].contenu.id === id) { return liste[i]; } }
    }
    return liste[0];
  }
  function contient(liste, cle) {
    for (var i = 0; i < liste.length; i++) { if (liste[i].cle === cle) { return true; } }
    return false;
  }

  return {
    DUREES: DUREES, PAR_PAGE: PAR_PAGE, SERIE_MAX: SERIE_MAX,
    decalageParis: decalageParis, heureParis: heureParis, ajouterJours: ajouterJours, jourSemaine: jourSemaine,
    jourDeService: jourDeService, estActive: estActive, couvreJour: couvreJour, utilisable: utilisable,
    etapes: etapes, suivante: suivante, contient: contient
  };
}));
