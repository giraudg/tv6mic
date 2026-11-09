// Essai du lecteur des écrans dans un navigateur simulé (jsdom), avec une horloge simulée : il démarre, contacte
// le serveur, affiche sa boucle et survit aux cas qui ont déjà fait tomber un écran (Hall, 6-9 nov. 2026 :
// rien de programmé → plantage au démarrage, avant tout contact avec le serveur, écran noir trois jours).
// Lancé avant chaque mise en ligne (wrangler.jsonc, build.command) : un échec bloque la mise en ligne.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');

const PUB = path.join(__dirname, '..', 'public');
const SCRIPTS = ['vendor/qrcode.js', 'lecteur/regles.js', 'lecteur/gabarits.js', 'lecteur/lecteur.js'].map(f => fs.readFileSync(path.join(PUB, f), 'utf8'));
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const DEBUT = Date.parse('2026-11-06T20:30:00Z');   // un vendredi soir, 21 h 30 à Paris

// ---------- programmations d'essai ----------
const JOUR = '2026-11-06';
const photo = { src: '/medias/essai/photo.jpg', largeur: 1600, hauteur: 900 };
const CONTENUS = {
  soiree: { nom: 'Artiste', date: JOUR, heure: '20:30', photo, infos: 'Ouverture 19 h 30\nTarif 25 €', mention: 'Complet', billetterie: 'https://example.com/billets' },
  lineup: { titre: '', date: JOUR, lieu: 'Grande salle', photo, passages: [{ heure: '20:00', role: 'ouverture', nom: 'Premier' }, { heure: '21:30', role: 'tete', nom: 'Tête' }] },
  agenda: { titre: 'Agenda', dates: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ date: '2026-11-' + String(6 + n).padStart(2, '0'), nom: 'Concert ' + n, mention: n === 2 ? 'Complet' : '' })) },
  serie: { accroche: 'Cette semaine', titre: 'Rap', fond: 'violet', dates: [{ date: JOUR, heure: '20:00', nom: 'Un', photo }, { date: '2026-11-07', heure: '20:00', nom: 'Deux' }] },
  image: { src: '/medias/essai/visuel.jpg', ajustement: 'remplir' },
  video: { src: '/medias/essai/film.mp4', poster: '/medias/essai/film.jpg', duree: 12, taille: 3000000 },
  web: { url: 'https://example.com/' },
  carte: { titre: 'Bar', colonnes: 0, fond: 'blanc', mention: 'Prix TTC', rubriques: [{ titre: 'Bières', formats: ['25 cl', '50 cl'], produits: [{ nom: 'Blonde', prix: ['3,5', '6'] }, { nom: 'IPA', prix: ['4', '7'], statut: 'rupture' }] }] },
  promo: { accroche: 'Ce soir', titre: 'Happy hour', fond: 'rose', mention: 'Avec modération', produits: [{ nom: 'Pinte', prix: '5', ancien: '7', photo }, { nom: 'Planche', prix: '12' }] },
  direction: { fond: 'noir', directions: [{ fleche: 'gauche', titre: 'Toilettes', picto: 'emoji', emoji: '🚻' }, { fleche: 'droite', titre: 'Vestiaire', picto: 'image', image: { src: '/medias/essai/picto.png' } }] }
};
function programmation(types, donnees) {
  const contenus = {}, diffusions = [];
  types.forEach((t, i) => {
    contenus['c-' + t] = { id: 'c-' + t, type: t, titre: 'Essai ' + t, donnees: donnees ? donnees(t) : CONTENUS[t], duree: null };
    diffusions.push({ id: 'd-' + t, contenu: 'c-' + t, debut: '2026-11-01', fin: '2026-11-30', jours: null, semaine: null, plages: null, prioritaire: 0, ordre: i });
  });
  return { flux: { code: 'hall', nom: 'Hall' }, version: 7, defaut: null, contenus, diffusions,
    reglages: { couleurs: { primaire: { valeur: '#e744a8' }, secondaire: { valeur: '#8e63ff' }, degrade: 'linear-gradient(90deg, #e744a8, #8e63ff)' },
      roles: [], mentions: [{ libelle: 'Complet', alerte: true }] } };
}

// ---------- un écran simulé ----------
function ecran({ prog, serveur = 'ok', garde = null }) {
  const erreursPage = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) { erreursPage.push(e.message); } });
  const dom = new JSDOM(HTML, { url: 'https://tv.6mic-aix.fr/?flux=hall', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const W = dom.window;
  const horloge = FakeTimers.withGlobal(W).install({ now: DEBUT, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  W.addEventListener('error', e => erreursPage.push(e.message));
  // ce que jsdom ne sait pas faire : lire une vidéo, charger une image
  W.HTMLMediaElement.prototype.play = function () { return W.Promise.resolve(); };
  W.HTMLMediaElement.prototype.load = function () {};
  W.HTMLMediaElement.prototype.pause = function () {};
  W.fetch = () => W.Promise.reject(new W.TypeError('réseau simulé absent'));
  if (garde) { W.localStorage.setItem('tv6mic.prog.hall', JSON.stringify(garde)); }
  // le serveur : chaque POST /api/flux/hall reçoit la programmation (ou rien si le serveur est injoignable)
  const envois = [];
  W.XMLHttpRequest = class {
    open(m, u) { this.m = m; this.u = u; this.readyState = 1; }
    setRequestHeader() {}
    send(corps) {
      envois.push({ m: this.m, u: this.u, corps: corps && JSON.parse(corps) });
      const x = this;
      W.setTimeout(() => {
        x.readyState = 4;
        if (serveur === 'ok') { x.status = 200; x.responseText = JSON.stringify(Object.assign({ maintenant: W.Date.now() }, prog)); }
        else { x.status = 0; x.responseText = ''; }
        if (x.onreadystatechange) { x.onreadystatechange(); }
        if (x.onload && x.status) { x.onload(); }
        if (x.onerror && !x.status) { x.onerror(); }
        if (x.onloadend) { x.onloadend(); }
      }, 50);
    }
    abort() {}
  };
  for (const s of SCRIPTS) { W.eval(s); }
  // avance l'horloge seconde par seconde et note chaque étape affichée
  const vues = new Set(), planteES = [];
  function avancer(secondes) {
    for (let i = 0; i < secondes; i++) {
      try { horloge.tick(1000); } catch (e) { planteES.push(e.message); }
      const c = W.TV6MIC && W.TV6MIC.etat().courante;
      if (c) { vues.add(c.cle.split('#')[0]); }
    }
  }
  return { W, envois, vues, avancer, erreursPage, planteES, etat: () => W.TV6MIC.etat(), fermer: () => { horloge.uninstall(); W.close(); } };
}

test('écran sans rien de programmé : veille, sans plantage, et contact avec le serveur', () => {
  const e = ecran({ prog: programmation([]) });
  e.avancer(120);
  assert.deepStrictEqual(e.planteES, [], 'aucune erreur non rattrapée');
  assert.deepStrictEqual(e.erreursPage, []);
  assert.strictEqual(e.etat().courante.cle, 'veille');
  assert.ok(e.envois.filter(x => x.m === 'POST').length >= 3, 'le lecteur contacte le serveur régulièrement');
  e.fermer();
});

test('tous les types de contenus passent à l\'écran, sans erreur', () => {
  const types = Object.keys(CONTENUS);
  const e = ecran({ prog: programmation(types) });
  e.avancer(900);
  assert.deepStrictEqual(e.planteES, []);
  assert.deepStrictEqual(e.erreursPage, []);
  for (const t of types) { assert.ok(e.vues.has('c-' + t), 'étape affichée : ' + t); }
  // (tableau venu de la page simulée : comparé par sa longueur, pas par deepStrictEqual)
  const gabarits = Array.from(e.etat().erreurs).filter(x => /gabarit|réglages|JS |démarrage|programmation reçue|chien de garde|vérification/.test(x));
  assert.strictEqual(gabarits.length, 0, 'aucun gabarit en erreur : ' + gabarits.join(' | '));
  e.fermer();
});

test('contenus aux données manquantes : la boucle continue', () => {
  const types = Object.keys(CONTENUS);
  const e = ecran({ prog: programmation(types, () => ({})) });
  e.avancer(900);
  assert.deepStrictEqual(e.planteES, []);
  assert.deepStrictEqual(e.erreursPage, []);
  // les contenus sans l'essentiel (agenda sans dates…) sont écartés par les règles ; tous les autres passent
  const attendues = e.W.Regles.etapes(e.etat().prog, e.W.Date.now()).etapes.map(x => x.cle.split('#')[0]);
  assert.ok(attendues.length >= 1);
  for (const c of attendues) { assert.ok(e.vues.has(c), 'étape affichée : ' + c); }
  assert.ok(!e.etat().erreurs.some(x => /JS |démarrage|chien de garde/.test(x)), e.etat().erreurs.join(' | '));
  e.fermer();
});

test('serveur injoignable : programmation gardée affichée, sinon veille, et nouvelles tentatives', () => {
  const avec = ecran({ prog: null, serveur: 'injoignable', garde: programmation(['image', 'agenda']) });
  avec.avancer(120);
  assert.deepStrictEqual(avec.planteES, []);
  assert.ok(avec.vues.has('c-image') && avec.vues.has('c-agenda'), 'la programmation gardée tourne');
  avec.fermer();
  const sans = ecran({ prog: null, serveur: 'injoignable' });
  sans.avancer(60);
  assert.deepStrictEqual(sans.planteES, []);
  assert.strictEqual(sans.etat().courante.cle, 'veille');
  assert.ok(sans.envois.length >= 4, 'il réessaie');
  sans.fermer();
});

test('chien de garde : une boucle arrêtée par une erreur imprévue repart d\'elle-même', () => {
  const e = ecran({ prog: programmation(['image', 'carte']) });
  e.avancer(20);
  const etapes = e.W.Regles.etapes;
  let pannes = 0;
  e.W.Regles.etapes = function () { if (pannes < 1) { pannes++; throw new Error('panne simulée'); } return etapes.apply(this, arguments); };
  e.avancer(30);                       // la fin de l'étape plante : plus rien ne s'enchaîne
  const avant = e.etat().courante.cle;
  e.vues.clear();
  e.avancer(180);
  assert.ok(e.etat().erreurs.some(x => /affichage bloqué/.test(x)), 'le chien de garde a relancé l\'affichage');
  assert.ok(e.vues.size >= 2 && [...e.vues].some(v => v !== avant.split('#')[0]), 'les étapes s\'enchaînent de nouveau');
  e.fermer();
});
