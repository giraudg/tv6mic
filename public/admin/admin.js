/* Écrans TV 6MIC : back-office (navigateurs récents).
   Vues : Écrans (tableau de bord), Contenus (+ éditeur), Calendrier, Flux et boucles, Journal.
   Les règles de programmation (Regles) et les gabarits (Gabarits) sont ceux du lecteur des écrans. */
const R = window.Regles, G = window.Gabarits;

/* ================= outils ================= */
function h(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    n.append(e instanceof Node ? e : String(e));
  }
  return n;
}
const $ = (s, r = document) => r.querySelector(s);
// Remplace les enfants d'un nœud en ignorant null, undefined et false (champs conditionnels).
const remplacer = (n, ...e) => n.replaceChildren(...e.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false));
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JC = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MC = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const TYPES = { soiree: 'Soirée', lineup: 'Line-up', agenda: 'Agenda', serie: 'Série', image: 'Image', video: 'Vidéo' };
const SEMAINE = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];
// Listes de choix : celles des Réglages (éléments archivés exclus).
const actifs = l => l.filter(x => !x.archive);
const mentionsChoix = () => actifs(E.reglages.mentions).map(m => m.libelle);
const sallesChoix = () => actifs(E.reglages.salles).map(x => x.libelle);

const auj = () => R.heureParis(Date.now()).date;
function parts(date) { const p = date.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2])); return { a: p[0], m: p[1] - 1, n: p[2], j: d.getUTCDay() }; }
const dateCourte = d => { const p = parts(d); return p.n + ' ' + MC[p.m]; };
const dateMoy = d => { const p = parts(d); return JC[p.j] + ' ' + p.n + ' ' + MC[p.m]; };
const dateLongue = d => { const p = parts(d); return JOURS[p.j] + ' ' + (p.n === 1 ? '1er' : p.n) + ' ' + MOIS[p.m] + ' ' + p.a; };
function parisVersMs(date, hhmm) {
  const [a, m, j] = date.split('-').map(Number), [hh, mm] = (hhmm || '12:00').split(':').map(Number);
  const ms = Date.UTC(a, m - 1, j, hh, mm);
  return ms - R.decalageParis(ms - 3600000) * 60000;
}
function heureIso(iso) {
  const ms = Date.parse(iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z');
  const x = R.heureParis(ms), p = parts(x.date);
  return p.n + ' ' + MC[p.m] + ' ' + String(Math.floor(x.minutes / 60)).padStart(2, '0') + ':' + String(x.minutes % 60).padStart(2, '0');
}
const mo = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' Mo';
const plur = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);
const enListe = l => l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
function annoncer(message, erreur) {
  const t = $('#toast');
  t.textContent = message; t.className = 'toast' + (erreur ? ' erreur' : ''); t.hidden = false;
  clearTimeout(annoncer.m); annoncer.m = setTimeout(() => { t.hidden = true; }, erreur ? 7000 : 3500);
}

/* ================= serveur ================= */
let E = null, decalage = 0, chargeLe = 0;
async function api(methode, chemin, corps) {
  const o = { method: methode, headers: {}, credentials: 'same-origin' };
  // Le serveur exige ce type sur toute écriture, même sans corps (suppression).
  if (methode !== 'GET') o.headers['Content-Type'] = 'application/json';
  if (corps !== undefined) o.body = JSON.stringify(corps);
  let r;
  try { r = await fetch(chemin, o); } catch { throw Object.assign(new Error('Serveur injoignable : vérifiez la connexion.'), { status: 0 }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && E && !chemin.endsWith('/connexion')) montrerConnexion('Votre session a expiré : reconnectez-vous.');
    throw Object.assign(new Error(d.erreur || 'Erreur ' + r.status), { status: r.status });
  }
  return d;
}
async function recharger() {
  const e = await api('GET', '/api/admin/etat');
  decalage = e.maintenant - Date.now();
  e.contenuParId = new Map(e.contenus.map(c => [c.id, c]));
  e.fluxParCode = new Map(e.flux.map(f => [f.code, f]));
  E = e; chargeLe = Date.now();
  appliquerCouleurs(E.reglages);
  remplacer($('#sync'), h('i'), 'Programmation v' + E.version + ' · à jour');
}
const maintenant = () => Date.now() + decalage;
// Couleurs des Réglages : gabarits (aperçus) et habillage du back-office (en-tête, accents).
function appliquerCouleurs(r) {
  G.appliquerReglages(r);
  const k = r.couleurs, st = document.documentElement.style;
  const perso = k.primaire.valeur !== E.reglagesDefaut.couleurs.primaire.valeur || k.secondaire.valeur !== E.reglagesDefaut.couleurs.secondaire.valeur;
  const v = { '--magenta': k.primaire.valeur, '--violet': k.secondaire.valeur, '--violet-f': G.melanger(k.secondaire.valeur, '#000000', 0.25),
    '--violet-clair': G.melanger(k.secondaire.valeur, '#ffffff', 0.86), '--rose-clair': G.melanger(k.primaire.valeur, '#ffffff', 0.86) };
  for (const [n, x] of Object.entries(v)) { if (perso) st.setProperty(n, x); else st.removeProperty(n); }
}
function progFlux(code) {
  const f = E.fluxParCode.get(code), contenus = {};
  const diffusions = E.diffusions.filter(d => d.flux.includes(code) && (E.contenuParId.get(d.contenu) || {}).statut === 'actif');
  for (const d of diffusions) contenus[d.contenu] = E.contenuParId.get(d.contenu);
  const def = f.contenu_defaut && E.contenuParId.get(f.contenu_defaut);
  // Comme le serveur : un contenu par défaut archivé ne s'affiche plus.
  const defOk = def && def.statut === 'actif' ? def : null;
  if (defOk) contenus[defOk.id] = defOk;
  return { contenus, diffusions, defaut: defOk ? defOk.id : null };
}
async function ecrire(action, message) {
  remplacer($('#sync'), h('i'), 'Enregistrement…');
  try {
    const r = await action();
    await recharger();
    if (message) annoncer(message);
    return r;
  } catch (e) {
    if (e.status !== 409) annoncer(e.message, true); // le conflit a sa propre fenêtre dans l'éditeur
    if (E) remplacer($('#sync'), h('i'), 'Programmation v' + E.version);
    throw e;
  }
}

/* ================= fenêtres ================= */
function fenetre({ surtitre, titre, corps, pied, petit, fermer }) {
  const d = h('dialog', { class: 'dlg' + (petit ? ' petit' : '') },
    h('div', { class: 'dlg-h' }, surtitre && h('p', { class: 'surtitre', text: surtitre }), h('h2', { text: titre }),
      h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Fermer', onclick: () => d.close() }, '×')),
    h('div', { class: 'dlg-c' }, corps), pied && h('div', { class: 'dlg-p' }, pied));
  d.addEventListener('close', () => { d.remove(); if (fermer) fermer(); });
  document.body.append(d);
  d.showModal();
  return d;
}
function demander(titre, message, bouton, danger) {
  return new Promise(ok => {
    let rep = false;
    const d = fenetre({
      titre, petit: true, corps: h('p', { text: message }), fermer: () => ok(rep),
      pied: [h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Annuler'),
        h('button', { type: 'button', class: danger ? 'btn btn-rouge' : 'btn btn-noir', onclick: () => { rep = true; d.close(); } }, bouton)]
    });
  });
}

/* ================= aperçu (gabarits du lecteur) ================= */
function apercu() {
  const boite = h('div', { class: 'apercu' }), scene = h('div', { class: 'apercu-scene' });
  boite.append(scene);
  const ajuster = () => { scene.style.transform = 'scale(' + (boite.clientWidth / 1920) + ')'; };
  new ResizeObserver(ajuster).observe(boite);
  return {
    noeud: boite,
    rendre(etape, message) {
      boite.querySelectorAll('video, .apercu-msg').forEach(n => n.remove());
      remplacer(scene);
      ajuster();
      if (message) { boite.append(h('div', { class: 'apercu-msg', text: message })); return; }
      if (etape.type === 'video') {
        const d = etape.contenu.donnees;
        if (!d.src) { boite.append(h('div', { class: 'apercu-msg', text: 'Importez une vidéo pour la voir ici.' })); return; }
        boite.append(h('video', { src: d.src, poster: d.poster || null, controls: true, muted: true, autoplay: true, playsInline: true }));
        return;
      }
      let g;
      if (etape.type === 'soiree') g = G.soiree(etape, s => s);
      else if (etape.type === 'agenda') g = G.agenda(etape, s => s);
      else if (etape.type === 'serie') g = G.serie(etape, s => s);
      else if (etape.type === 'lineup') g = G.lineup(etape, s => s);
      else if (etape.type === 'image') g = G.image(etape, s => s);
      else g = G.veille('');
      scene.append(g.noeud);
      if (g.ajuster) g.ajuster();
      void g.noeud.offsetWidth;
      g.noeud.classList.add('joue');
    }
  };
}
// Étapes d'aperçu d'un contenu (les pages d'un agenda), même si sa date est passée.
function etapesApercu(c) {
  const contenu = { id: c.id || 'apercu', type: c.type, titre: c.titre, donnees: c.donnees, duree: c.duree };
  if (c.type === 'lineup') {
    // heure de Paris réelle : le jour de la soirée, l'aperçu montre le passage en cours comme l'écran
    const hp = R.heureParis(maintenant());
    return [{ cle: 'apercu', type: 'lineup', contenu, duree: c.duree || R.DUREES.lineup, service: R.jourDeService(hp), minutes: hp.minutes }];
  }
  if (c.type === 'serie') {
    // dates à venir ; si toutes sont passées (ou pas encore saisies), on montre quand même ce qui est rempli
    const prochaines = (c.donnees.dates || []).filter(x => x.date && x.date >= auj());
    const dates = (prochaines.length ? prochaines : (c.donnees.dates || []).filter(x => x.date)).slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(0, R.SERIE_MAX);
    return [{ cle: 'apercu', type: 'serie', contenu, duree: c.duree || R.DUREES.serie, dates, service: auj() }];
  }
  if (c.type !== 'agenda') return [{ cle: 'apercu', type: c.type, contenu, duree: c.duree || R.DUREES[c.type] }];
  const prog = { contenus: { [contenu.id]: contenu }, diffusions: [{ id: 'x', contenu: contenu.id, debut: '2000-01-01', fin: '2999-12-31' }] };
  let e = R.etapes(prog, maintenant()).etapes.filter(x => x.type === 'agenda');
  if (!e.length) {
    const dates = (c.donnees.dates || []).slice(0, R.PAR_PAGE);
    e = [{ cle: 'apercu#1', type: 'agenda', contenu, duree: c.duree || 15, page: 1, pages: 1, dates }];
  }
  return e;
}

/* ================= médias : images, vidéos, envoi ================= */
// Retire le profil de couleur ICC qu'ajoute le navigateur aux JPEG : Chromium 56 (les écrans) affiche
// les images munies du profil sRGB compact de Google avec des couleurs fausses (aplats, postérisation).
async function sansProfilIcc(blob) {
  const d = new Uint8Array(await blob.arrayBuffer());
  if (d[0] !== 0xFF || d[1] !== 0xD8) return blob;
  const morceaux = [d.subarray(0, 2)];
  let i = 2, retire = false;
  while (i + 4 <= d.length && d[i] === 0xFF) {
    const m = d[i + 1];
    if (m === 0xDA) { morceaux.push(d.subarray(i)); return retire ? new Blob(morceaux, { type: 'image/jpeg' }) : blob; }
    const l = (d[i + 2] << 8) | d[i + 3], seg = d.subarray(i, i + 2 + l);
    if (m === 0xE2 && String.fromCharCode(...seg.subarray(4, 15)) === 'ICC_PROFILE') retire = true;
    else morceaux.push(seg);
    i += 2 + l;
  }
  return blob;
}
async function preparerImage(fichier) {
  let img;
  try { img = await createImageBitmap(fichier, { imageOrientation: 'from-image' }); }
  catch {
    img = await new Promise((ok, ko) => { const i = new Image(), u = URL.createObjectURL(fichier); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => ko(new Error('Image illisible.')); i.src = u; });
  }
  const w = img.width, ht = img.height;
  let e = Math.min(1, Math.max(1920 / w, 1080 / ht));
  e = Math.min(e, 2560 / Math.max(w * e, ht * e));
  const cw = Math.round(w * e), ch = Math.round(ht * e);
  const c = h('canvas', { width: cw, height: ch }), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, cw, ch);
  x.drawImage(img, 0, 0, cw, ch);
  const blob = await sansProfilIcc(await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.86)));
  return { blob, largeur: cw, hauteur: ch };
}
// Format d'une image en mots : « paysage 16:9 », « portrait ≈ 4:5 », « presque carré »…
const RAPPORTS = [[16 / 9, '16:9'], [3 / 2, '3:2'], [4 / 3, '4:3'], [5 / 4, '5:4'], [4 / 5, '4:5'], [3 / 4, '3:4'], [2 / 3, '2:3'], [9 / 16, '9:16']];
function nomFormat(w, ht) {
  const r = w / ht, ecart = x => Math.abs(Math.log(r / x));
  if (ecart(1) < 0.02) return 'carré';
  if (r > 0.87 && r < 1.15) return 'presque carré';
  const [v, nom] = RAPPORTS.reduce((a, b) => ecart(b[0]) < ecart(a[0]) ? b : a);
  const sens = r > 1 ? 'paysage' : 'portrait';
  if (ecart(v) < 0.012) return sens + ' ' + nom;
  if (ecart(v) < 0.06) return sens + ' ≈ ' + nom;
  return sens + ' ' + (r > 1 ? r.toFixed(2).replace('.', ',') + ':1' : '1:' + (1 / r).toFixed(2).replace('.', ','));
}
// Une image face au cadre où l'écran l'affiche : recadrage (ou bandes noires) et netteté.
function verdictCadre(img, c) {
  const l = [];
  if (!img || !img.largeur || !img.hauteur) return l;
  const ri = img.largeur / img.hauteur, rf = c.largeur / c.hauteur;
  const desc = 'Votre image ' + img.largeur + ' × ' + img.hauteur + ' px (' + nomFormat(img.largeur, img.hauteur) + ')';
  let echelle;
  if (c.contenir) {
    echelle = Math.min(c.largeur / img.largeur, c.hauteur / img.hauteur);
    if (ri > rf * 1.02) l.push(['a', desc + ' : bandes noires en haut et en bas']);
    else if (ri < rf / 1.02) l.push(['a', desc + ' : bandes noires sur les côtés']);
    else l.push(['v', desc + ' : occupe tout l’écran']);
  } else {
    echelle = Math.max(c.largeur / img.largeur, c.hauteur / img.hauteur);
    if (ri > rf * 1.03) { const p = Math.round(rf / ri * 100); l.push([p < 70 ? 'a' : 'v', desc + ' : côtés coupés, ' + p + ' % de la largeur visible']); }
    else if (ri < rf / 1.03) { const p = Math.round(ri / rf * 100); l.push([p < 70 ? 'a' : 'v', desc + ' : haut et bas coupés, ' + p + ' % de la hauteur visible']); }
    else l.push(['v', desc + ' : au bon format']);
  }
  const mini = Math.ceil(img.largeur * echelle) + ' × ' + Math.ceil(img.hauteur * echelle) + ' px';
  if (echelle > 1.5) l.push(['a', 'Trop petite : agrandie ' + echelle.toFixed(1).replace('.', ',') + ' fois, elle sera floue (il faudrait ' + mini + ').']);
  else if (echelle > 1.1) l.push(['a', 'Un peu petite : légèrement floue (idéal ' + mini + ' ou plus).']);
  return l;
}

/* Glisser-déposer. Un seul gestionnaire pour la page : une zone porte la classe « depot » et une fonction
   _recevoir(fichiers) ; la plus proche du pointeur l'emporte. Ailleurs, le dépôt est neutralisé : sinon le
   navigateur ouvrirait l'image à la place du back-office et la saisie en cours serait perdue. */
let zoneSurvolee = null;
const avecFichiers = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
function survoler(z) {
  if (z === zoneSurvolee) return;
  if (zoneSurvolee) zoneSurvolee.classList.remove('survol');
  zoneSurvolee = z;
  if (z) z.classList.add('survol');
}
const zoneSous = e => { const z = e.target instanceof Element ? e.target.closest('.depot') : null; return z && z._recevoir && !z.classList.contains('occupe') ? z : null; };
document.addEventListener('dragover', e => {
  if (!avecFichiers(e)) return;
  e.preventDefault();
  const z = zoneSous(e);
  e.dataTransfer.dropEffect = z ? 'copy' : 'none';
  survoler(z);
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) survoler(null); });
document.addEventListener('drop', e => {
  if (!avecFichiers(e)) return;
  e.preventDefault();
  const z = zoneSous(e);
  survoler(null);
  if (z && e.dataTransfer.files.length) z._recevoir(Array.from(e.dataTransfer.files));
});
async function vue(f, debut, n) { return new DataView(await f.slice(debut, debut + n).arrayBuffer()); }
const cc4 = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
function boites(v, debut, fin) {
  const r = [];
  let p = debut;
  while (p + 8 <= fin) {
    let t = v.getUint32(p), e = 8;
    const type = cc4(v, p + 4);
    if (t === 1) { t = Number(v.getBigUint64(p + 8)); e = 16; } else if (t === 0) t = fin - p;
    if (t < 8) break;
    r.push({ type, pos: p, taille: t, entete: e });
    p += t;
  }
  return r;
}
// Lit l'en-tête MP4/MOV : codec, profil, niveau, taille d'image, cadence, durée, son, « fast start ».
async function analyserVideo(f) {
  const a = { taille: f.size };
  const racine = [];
  for (let p = 0; p + 8 <= f.size && racine.length < 60;) {
    const v = await vue(f, p, 16);
    let t = v.getUint32(0), e = 8;
    const type = cc4(v, 4);
    if (t === 1) { t = Number(v.getBigUint64(8)); e = 16; } else if (t === 0) t = f.size - p;
    if (t < 8) break;
    racine.push({ type, pos: p, taille: t, entete: e });
    p += t;
  }
  const moov = racine.find(b => b.type === 'moov'), mdat = racine.find(b => b.type === 'mdat');
  if (!moov || moov.taille > 64 * 1048576) return { ...a, illisible: true };
  a.debutRapide = !mdat || moov.pos < mdat.pos;
  const v = await vue(f, moov.pos, moov.taille);
  for (const trak of boites(v, moov.entete, moov.taille).filter(b => b.type === 'trak')) {
    const mdia = boites(v, trak.pos + trak.entete, trak.pos + trak.taille).find(b => b.type === 'mdia');
    if (!mdia) continue;
    const k = boites(v, mdia.pos + mdia.entete, mdia.pos + mdia.taille);
    const hdlr = k.find(b => b.type === 'hdlr'), mdhd = k.find(b => b.type === 'mdhd'), minf = k.find(b => b.type === 'minf');
    const role = hdlr ? cc4(v, hdlr.pos + hdlr.entete + 8) : '';
    let echelle = 0, duree = 0;
    if (mdhd) {
      const o = mdhd.pos + mdhd.entete;
      if (v.getUint8(o) === 1) { echelle = v.getUint32(o + 20); duree = Number(v.getBigUint64(o + 24)); }
      else { echelle = v.getUint32(o + 12); duree = v.getUint32(o + 16); }
    }
    const stbl = minf && boites(v, minf.pos + minf.entete, minf.pos + minf.taille).find(b => b.type === 'stbl');
    if (!stbl) continue;
    const s = boites(v, stbl.pos + stbl.entete, stbl.pos + stbl.taille);
    const stsd = s.find(b => b.type === 'stsd'), stts = s.find(b => b.type === 'stts');
    if (!stsd) continue;
    const e = stsd.pos + stsd.entete + 8;
    if (role === 'vide' && !a.codec) {
      a.codec = cc4(v, e + 4);
      a.largeur = v.getUint16(e + 32); a.hauteur = v.getUint16(e + 34);
      const conf = boites(v, e + 86, e + v.getUint32(e)), avcC = conf.find(b => b.type === 'avcC');
      if (avcC) { const o = avcC.pos + avcC.entete; a.profil = v.getUint8(o + 1); a.niveau = v.getUint8(o + 3) / 10; }
      if (echelle) a.duree = duree / echelle;
      if (stts && echelle) {
        const o = stts.pos + stts.entete + 4, n = v.getUint32(o), deltas = new Set();
        let images = 0, total = 0;
        for (let i = 0; i < n && i < 200000; i++) { const c = v.getUint32(o + 4 + i * 8), d = v.getUint32(o + 8 + i * 8); images += c; total += c * d; deltas.add(d); }
        if (total) a.ips = Math.round(images / (total / echelle) * 100) / 100;
        a.cadenceVariable = deltas.size > 3;
      }
    }
    if (role === 'soun' && !a.audio) a.audio = cc4(v, e + 4);
  }
  if (a.duree) a.debit = Math.round(f.size * 8 / a.duree / 1e4) / 100;
  return a;
}
// Contrôle du format vidéo lu par les écrans (cahier des charges, section 4).
function verdictVideo(a) {
  const l = [];
  let refus = false;
  const n = (etat, texte) => { l.push([etat, texte]); if (etat === 'x') refus = true; };
  if (a.illisible || !a.codec) { n('x', 'Format non lu par les écrans (ce n’est pas un MP4 ou un MOV H.264)'); return { lignes: l, refus }; }
  if (a.codec === 'avc1' || a.codec === 'avc3') n('v', 'Codec H.264');
  else if (a.codec === 'hvc1' || a.codec === 'hev1') n('x', 'Codec HEVC (H.265, vidéos d’iPhone) : non lu par les écrans');
  else n('x', 'Codec « ' + a.codec + ' » non lu par les écrans');
  if (a.profil) {
    if ([66, 77, 100].includes(a.profil)) n('v', 'Profil ' + ({ 66: 'Baseline', 77: 'Main', 100: 'High' })[a.profil] + (a.niveau ? ', niveau ' + a.niveau : ''));
    else n('x', 'Profil H.264 ' + a.profil + ' (10 bits ou 4:2:2) : non lu par les écrans');
  }
  if (a.largeur > 1920 || a.hauteur > 1080) n('x', a.largeur + ' × ' + a.hauteur + ' px : plus grand que les écrans (1920 × 1080)');
  else if (a.largeur < 1280 || a.hauteur < 720) n('a', a.largeur + ' × ' + a.hauteur + ' px : basse définition, image floue');
  else n('v', a.largeur + ' × ' + a.hauteur + ' px');
  if (a.ips) {
    const t = String(a.ips).replace('.', ',') + ' images par seconde';
    if (a.ips <= 30.5) n('v', t); else if (a.ips <= 60.5) n('a', t + ' : accepté, 25 ou 30 conseillé'); else n('x', t + ' : trop élevé');
  }
  if (a.cadenceVariable) n('a', 'Cadence variable (vidéo de téléphone) : peut saccader');
  if (a.debit) {
    const t = String(a.debit).replace('.', ',') + ' Mbit/s';
    if (a.debit <= 8.5) n('v', t); else if (a.debit <= 12) n('a', t + ' : lourd, 5 Mbit/s conseillé'); else n('x', t + ' : trop lourd (12 au plus, 5 conseillé)');
  }
  if (a.taille > 80 * 1048576) n('x', mo(a.taille) + ' : trop lourd (80 Mo au plus)');
  else if (a.taille > 40 * 1048576) n('a', mo(a.taille) + ' : lourd, la mémoire d’un écran est de 150 Mo');
  else n('v', mo(a.taille));
  if (a.duree) n(a.duree > 120 ? 'a' : 'v', 'Durée ' + Math.round(a.duree) + ' s' + (a.duree > 120 ? ' : longue pour un écran d’affichage' : ''));
  if (!a.audio) n('v', 'Sans son');
  else if (a.audio === 'mp4a') n('v', 'Son AAC');
  else n('a', 'Son « ' + a.audio + ' » : il ne sera pas lu');
  if (a.debutRapide === false) n('a', 'Sans l’option « fast start » (sans gravité : l’écran télécharge la vidéo en entier)');
  return { lignes: l, refus };
}
function posterVideo(f) {
  return new Promise((ok, ko) => {
    const u = URL.createObjectURL(f), v = document.createElement('video');
    const fin = () => URL.revokeObjectURL(u);
    const m = setTimeout(() => { fin(); ko(new Error('Lecture de la vidéo trop longue.')); }, 30000);
    v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const c = h('canvas', { width: 1920, height: 1080 }), x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 1920, 1080);
      const e = Math.min(1920 / v.videoWidth, 1080 / v.videoHeight), w = v.videoWidth * e, ht = v.videoHeight * e;
      x.drawImage(v, (1920 - w) / 2, (1080 - ht) / 2, w, ht);
      c.toBlob(b => { clearTimeout(m); fin(); sansProfilIcc(b).then(x => ok({ blob: x, duree: v.duration, largeur: v.videoWidth, hauteur: v.videoHeight })); }, 'image/jpeg', 0.85);
    };
    v.onerror = () => { clearTimeout(m); fin(); ko(new Error('Ce navigateur ne sait pas lire cette vidéo : utilisez Chrome ou Edge.')); };
    v.src = u;
  });
}
/* Conversion des vidéos au format des écrans, dans le navigateur (WebCodecs) : H.264 8 bits, 1920 × 1080 au plus,
   24, 25 ou 30 images par seconde constantes, environ 5 Mbit/s, son AAC, « fast start ». La bibliothèque Mediabunny
   (MPL-2.0, public/vendor/) n'est chargée qu'au moment d'une conversion ; l'encodeur AAC en WebAssembly ne l'est
   que si le navigateur n'en a pas (Firefox, Chrome sous Linux). */
const CONVERSION = { debit: 5e6, debitMin: 2e6, son: 128000, cleImage: 2, tailleMax: 75 * 1048576 };
const conversionsEnCours = new Set();   // annulations possibles (quitter la page pendant une conversion)
function ipsCible(ips) {
  if (!ips) return 30;
  if (ips > 30.5) return Math.abs(ips - 50) < 2 ? 25 : 30;   // 50 → 25 ; 60, 59,94, 120… → 30
  return ips < 24.5 ? 24 : ips < 27 ? 25 : 30;              // 23,976 → 24 ; 29,97 et cadence variable → 30
}
const conversionPossible = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
async function convertirVideo(fichier, duree, progression) {
  const M = await import('mediabunny');
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(fichier) });
  const piste = await input.getPrimaryVideoTrack();
  if (!piste) throw new Error('Ce fichier ne contient pas d’image vidéo lisible.');
  const son = await input.getPrimaryAudioTrack();
  if (son && !(await M.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, quality: new M.Quality({ bitrate: CONVERSION.son }) }))) {
    const { registerAacEncoder } = await import('/vendor/mediabunny-aac-encoder-1.61.5.min.mjs');
    if (!window.aacEnregistre) { registerAacEncoder(); window.aacEnregistre = true; }
  }
  const stats = await piste.computePacketStats(150);
  const ips = ipsCible(stats.averagePacketRate);
  // 16:9 jusqu'à 1920 × 1080 : taille gardée ; sinon cadre 1920 × 1080 (bandes noires si le format diffère)
  const w = piste.displayWidth, ht = piste.displayHeight;
  const garde = Math.abs(w / ht - 16 / 9) < 0.02 && w <= 1920 && w >= 1280;
  const [lw, lh] = garde ? [w - w % 2, ht - ht % 2] : [1920, 1080];
  // débit : 5 Mbit/s en 1080p, au prorata des pixels ; abaissé pour une vidéo longue (75 Mo au plus)
  const secondes = duree || (await input.computeDuration()) || 0;
  let debit = Math.max(CONVERSION.debitMin, CONVERSION.debit * lw * lh / (1920 * 1080));
  if (secondes) debit = Math.max(CONVERSION.debitMin, Math.min(debit, (CONVERSION.tailleMax * 8 / secondes) * 0.92 - (son ? CONVERSION.son : 0)));
  const qualite = new M.Quality({ bitrate: Math.round(debit), bitrateMode: 'variable' });
  if (!(await M.canEncodeVideo('avc', { width: lw, height: lh, quality: qualite, frameRate: ips })))
    throw Object.assign(new Error('Ce navigateur ne sait pas encoder en H.264 : utilisez Chrome ou Edge à jour.'), { exporter: true });
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const conv = await M.Conversion.init({
    input, output, tracks: 'primary', showWarnings: false, tags: {},
    video: { codec: 'avc', width: lw, height: lh, fit: 'contain', frameRate: ips, quality: qualite, keyFrameInterval: CONVERSION.cleImage, allowTransformationMetadata: false, forceTranscode: true },
    audio: { codec: 'aac', quality: new M.Quality({ bitrate: CONVERSION.son }) }
  });
  const rejetee = conv.discardedTracks.find(t => t.track.isVideoTrack());
  if (!conv.isValid || rejetee) {
    const raison = rejetee ? rejetee.reason : '';
    const nom = { hevc: 'HEVC (vidéos d’iPhone)', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', avc: 'H.264' }[piste.codec] || 'de ce fichier';
    throw Object.assign(new Error(raison === 'no_encodable_target_codec' ? 'Ce navigateur ne sait pas encoder en H.264 : utilisez Chrome ou Edge à jour.'
      : 'Ce navigateur ne sait pas lire le codec ' + nom + '. Sur Mac ou sur un PC récent, Chrome, Edge ou Safari le lisent ; sinon, exportez la vidéo avec HandBrake.'), { exporter: true });
  }
  const sonRetire = !!son && !conv.utilizedTracks.some(t => t.isAudioTrack());
  let annule = false;
  const annuler = () => { annule = true; return conv.cancel(); };
  conversionsEnCours.add(annuler);
  conv.onProgress = (x) => progression(x, annuler);
  progression(0, annuler);
  try { await conv.execute(); }
  catch (e) { if (annule || e instanceof M.ConversionCanceledError) throw Object.assign(new Error('Conversion annulée.'), { annulee: true }); throw e; }
  finally { conversionsEnCours.delete(annuler); }
  return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ips, largeur: lw, hauteur: lh, debit: Math.round(debit), sonRetire };
}
const dureeTexte = s => s < 60 ? Math.max(1, Math.round(s)) + ' s' : Math.floor(s / 60) + ' min' + (s % 60 >= 10 && s < 600 ? ' ' + Math.round(s % 60) + ' s' : '');

function televerser(blob, nom, progression) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/medias');
    x.setRequestHeader('Content-Type', blob.type);
    x.setRequestHeader('X-Nom', encodeURIComponent(nom));
    x.setRequestHeader('X-TV6MIC', '1');
    x.upload.onprogress = e => { if (e.lengthComputable && progression) progression(e.loaded / e.total); };
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch { /* réponse vide */ }
      if (x.status >= 200 && x.status < 300) ok(d); else ko(new Error(d.erreur || 'Import refusé (' + x.status + ').'));
    };
    x.onerror = () => ko(new Error('Import interrompu : vérifiez la connexion.'));
    x.send(blob);
  });
}
const TYPE_PAR_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const nomSansExtension = n => n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 100);
function typeFichier(f) { return f.type || TYPE_PAR_EXT[(f.name.split('.').pop() || '').toLowerCase()] || ''; }

/* Champ d'import : image (visuel, photo de soirée, fond d'agenda) ou vidéo.
   cadre : { largeur, hauteur, contenir?, conseil? } (ou une fonction qui le renvoie) = où l'écran affiche
   l'image ; la vignette en prend le format (on y voit le recadrage) et le champ le rappelle.
   On peut glisser un fichier sur le champ ; surplus(fichiers) reçoit les fichiers en trop d'un dépôt multiple. */
function champMedia({ genre, valeur, facultatif, change, cadre, boite = [200, 150], surplus }) {
  const video = genre === 'video';
  const racine = h('div', { class: 'media depot' });
  const vide = h('span', { class: 'media-vide' }, h('b'), h('small', { text: video ? 'Glisser une vidéo ici' : 'Glisser une image ici' }));
  const vignette = h('div', { class: 'media-vignette', 'aria-hidden': 'true', onclick: () => { if (!bouton.disabled) entree.click(); } }, vide);
  const format = h('div', { class: 'format' });
  const info = h('div', { class: 'aide' });
  const barre = h('div', { class: 'barre', hidden: true }, h('i'));
  const controle = h('ul', { class: 'controle', hidden: true });
  const encart = h('div', { class: 'encart rose', hidden: true },
    h('b', { text: 'Exporter au bon format' }),
    h('span', { text: 'HandBrake (gratuit) : préréglage « Fast 1080p30 », cocher « Web Optimized », vidéo H.264, 30 i/s constants, débit moyen 5000 kbit/s, son AAC. Le détail est dans le cahier des charges (section 4).' }));
  const choix = h('div', { class: 'choix-conv', hidden: true });
  const annulerConv = h('button', { type: 'button', class: 'btn pt', hidden: true }, 'Annuler la conversion');
  const entree = h('input', { type: 'file', accept: video ? 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,.mkv' : 'image/jpeg,image/png,image/webp', hidden: true });
  const bouton = h('button', { type: 'button', class: 'btn', onclick: () => entree.click(), disabled: !E.r2 },
    video ? 'Choisir une vidéo…' : 'Choisir une image…');
  const retirer = facultatif ? h('button', { type: 'button', class: 'btn btn-danger pt', onclick: () => { change(null); montrer(null); } }, 'Retirer') : null;
  let courant = null, dims = null;
  const cadreActuel = () => typeof cadre === 'function' ? cadre() : cadre;
  // Le format du cadre peut changer (nombre de dates d'une série, cadrage d'une image) : l'éditeur rappelle majCadre.
  function majCadre() {
    const c = cadreActuel();
    if (!c) { format.hidden = true; return; }
    const r = c.largeur / c.hauteur, w = Math.min(boite[0], Math.round(boite[1] * r));
    Object.assign(vignette.style, { width: w + 'px', height: Math.round(w / r) + 'px', aspectRatio: 'auto', backgroundSize: c.contenir ? 'contain' : 'cover' });
    vide.firstChild.textContent = c.largeur + ' × ' + c.hauteur;
    const img = courant && !video ? (courant.largeur ? courant : dims) : null;
    remplacer(format,
      h('p', {}, h('b', { text: 'À l’écran : ' + c.largeur + ' × ' + c.hauteur + ' px' }), ', ' + nomFormat(c.largeur, c.hauteur) + (c.conseil ? ' · ' + c.conseil : '')),
      img && h('ul', { class: 'controle' }, verdictCadre(img, c).map(([e, t]) => h('li', { class: e, text: t }))));
    format.hidden = false;
  }
  racine.majCadre = majCadre;
  function montrer(v) {
    courant = v; dims = null;
    const src = v && (video ? v.poster : v.src);
    vignette.style.backgroundImage = src ? 'url("' + src + '")' : '';
    vide.hidden = !!src;
    if (retirer) retirer.hidden = !v;
    info.textContent = !v ? (video ? 'Aucune vidéo.' : 'Aucune image.')
      : video ? [v.largeur && v.largeur + ' × ' + v.hauteur, v.duree && Math.round(v.duree) + ' s', v.taille && mo(v.taille)].filter(Boolean).join(' · ')
        : [v.fichier, v.taille && mo(v.taille)].filter(Boolean).join(' · ');
    // images importées sans leurs dimensions : on les lit pour pouvoir juger le format
    if (v && !video && v.src && !v.largeur) {
      const i = new Image();
      i.onload = () => { if (courant === v) { dims = { largeur: i.naturalWidth, hauteur: i.naturalHeight }; majCadre(); } };
      i.src = v.src;
    }
    majCadre();
  }
  let occupe = false;
  async function importer(f) {
    const type = typeFichier(f);
    controle.hidden = true; encart.hidden = true; bouton.disabled = true;
    occupe = true; racine.classList.add('occupe');
    const progresser = x => { barre.hidden = false; barre.firstChild.style.width = Math.round(x * 100) + '%'; };
    try {
      if (!video) {
        if (!type.startsWith('image/')) throw new Error('« ' + f.name + ' » n’est pas une image : choisissez un JPEG, PNG ou WebP.');
        info.textContent = 'Préparation de l’image…';
        const p = await preparerImage(f);
        info.textContent = 'Envoi…';
        const r = await televerser(p.blob, f.name, progresser);
        const v = { src: r.src, largeur: p.largeur, hauteur: p.hauteur, taille: r.taille, fichier: nomSansExtension(f.name) };
        change(v); montrer(v);
        const c = cadreActuel(), flou = c && verdictCadre(v, c).find(([e, t]) => e === 'a' && /petite/.test(t));
        if (flou) annoncer(flou[1], true);
      } else {
        if (!type.startsWith('video/')) throw new Error('« ' + f.name + ' » n’est pas une vidéo : choisissez un MP4, un MOV ou un WebM.');
        info.textContent = 'Contrôle du format…';
        const lignes = (titre, verdict) => [titre && h('li', { class: 'titre-ctrl', text: titre }), verdict.lignes.map(([e, t]) => h('li', { class: e, text: t }))];
        let a = await analyserVideo(f), verdict = verdictVideo(a), fichier = f, depart = null, conv = null;
        remplacer(controle, lignes(null, verdict));
        controle.hidden = false;
        // Ce que la conversion corrige sans être indispensable : on propose, l'utilisateur choisit.
        const ameliorable = !verdict.refus && (a.ips > 30.5 || a.cadenceVariable || a.debit > 8.5 || a.taille > 40 * 1048576 || (a.audio && a.audio !== 'mp4a') || a.debutRapide === false);
        let convertir = verdict.refus;
        if (ameliorable && conversionPossible()) {
          info.textContent = 'Cette vidéo passera, mais une conversion la rendra plus fluide et plus légère pour les écrans.';
          convertir = await new Promise(ok => {
            remplacer(choix, h('button', { type: 'button', class: 'btn btn-violet', onclick: () => ok(true) }, 'Optimiser pour les écrans (conseillé)'),
              h('button', { type: 'button', class: 'btn', onclick: () => ok(false) }, 'Importer telle quelle'));
            choix.hidden = false;
          });
          choix.hidden = true;
        }
        if (convertir) {
          if (!conversionPossible()) { encart.hidden = false; throw new Error('Ce navigateur ne sait pas convertir les vidéos : utilisez Chrome ou Edge à jour, ou exportez la vidéo avec HandBrake.'); }
          info.textContent = 'Conversion au format des écrans… (chargement)';
          const debut = Date.now();
          try {
            conv = await convertirVideo(f, a.duree, (x, annuler) => {
              annulerConv.hidden = false; annulerConv.onclick = () => { annulerConv.disabled = true; annuler(); };
              progresser(x);
              const reste = x > 0.03 ? (Date.now() - debut) / 1000 * (1 - x) / x : null;
              info.textContent = 'Conversion : ' + Math.round(x * 100) + ' %' + (reste !== null ? ' · encore ' + dureeTexte(reste) : '') + '. Restez sur cette page.';
            });
          } catch (e) { if (e.exporter) encart.hidden = false; throw e; }
          finally { annulerConv.hidden = true; annulerConv.disabled = false; barre.hidden = true; }
          depart = { codec: a.codec, largeur: a.largeur, hauteur: a.hauteur, ips: a.ips, debit: a.debit, taille: f.size, duree: Math.round((Date.now() - debut) / 1000) };
          fichier = new File([conv.blob], nomSansExtension(f.name).replace(/\s+/g, '-') + '.mp4', { type: 'video/mp4' });
          a = await analyserVideo(fichier); verdict = verdictVideo(a);
          remplacer(controle, lignes('Après conversion (' + mo(f.size) + ' → ' + mo(fichier.size) + ', en ' + dureeTexte(depart.duree) + ')', verdict),
            conv.sonRetire ? h('li', { class: 'a', text: 'Son retiré : il n’a pas pu être converti' }) : null);
          if (verdict.refus) throw new Error('Même convertie, la vidéo ne convient pas aux écrans (voir ci-dessus) : raccourcissez-la.');
        } else if (verdict.refus) { encart.hidden = false; info.textContent = 'Vidéo refusée : les écrans ne la liraient pas correctement.'; return; }
        info.textContent = 'Extraction de l’image fixe…';
        // L'image fixe sert d'aperçu et de secours entre deux vidéos ; sans elle, la vidéo reste utilisable.
        const p = await posterVideo(fichier).catch(err => { annoncer('Image fixe non extraite (' + err.message + ') : la vidéo sera importée sans.', true); return null; });
        const rp = p ? await televerser(p.blob, fichier.name + '.jpg', null) : null;
        info.textContent = 'Envoi de la vidéo…';
        const typeEnvoi = conv ? 'video/mp4' : type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
        const rv = await televerser(new Blob([fichier], { type: typeEnvoi }), fichier.name, progresser);
        const v = { src: rv.src, poster: rp ? rp.src : null, duree: Math.round((a.duree || (p && p.duree) || 0) * 100) / 100, taille: rv.taille, largeur: a.largeur || (p && p.largeur), hauteur: a.hauteur || (p && p.hauteur),
          fichier: nomSansExtension(f.name), analyse: { codec: a.codec, profil: a.profil, niveau: a.niveau, ips: a.ips, debit: a.debit, avert: verdict.lignes.filter(x => x[0] === 'a').length, converti: depart || undefined } };
        change(v); montrer(v);
        if (conv) annoncer('Vidéo convertie et importée : ' + a.largeur + ' × ' + a.hauteur + ', ' + a.ips + ' i/s, ' + mo(rv.taille) + '.');
      }
    } catch (e) {
      info.textContent = e.message;
      annoncer(e.message, true);
    } finally {
      bouton.disabled = !E.r2; barre.hidden = true; choix.hidden = true;
      occupe = false; racine.classList.remove('occupe');
    }
  }
  // Dépôt (glisser-déposer) : le premier fichier ici, les autres à surplus() s'il existe.
  racine._recevoir = fichiers => {
    if (!E.r2 || !fichiers.length) return;
    if (occupe) { annoncer('Un import est déjà en cours ici.', true); return; }
    const [f, ...reste] = fichiers;
    importer(f);
    if (reste.length) { if (surplus) surplus(reste); else annoncer('Un seul fichier par emplacement : « ' + f.name + ' » a été retenu.', true); }
  };
  entree.addEventListener('change', () => {
    const f = entree.files[0];
    entree.value = '';
    if (f) importer(f);
  });
  if (!E.r2) racine.classList.add('occupe');
  racine.append(h('div', { class: 'media-ligne' }, vignette, h('div', { class: 'actions' }, bouton, retirer)), format, info, barre, annulerConv, choix, controle, encart, entree);
  montrer(valeur);
  if (!E.r2) racine.append(h('p', { class: 'erreur', text: 'Import impossible : le stockage Cloudflare R2 n’est pas encore activé.' }));
  return racine;
}

/* ================= résumés de programmation ================= */
function nomsFlux(codes) {
  if (codes.length === E.flux.length) return 'Tous les écrans';
  // Dans l'ordre des écrans (Billetterie, Club, Hall…), quel que soit l'ordre de saisie.
  return E.flux.filter(f => codes.includes(f.code)).map(f => f.nom).concat(codes.filter(c => !E.fluxParCode.has(c))).join(', ');
}
function resumeJours(d) {
  let t;
  if (d.jours && d.jours.length) t = d.jours.length > 4 ? plur(d.jours.length, 'jour') + ' choisis, du ' + dateCourte(d.jours[0]) + ' au ' + dateCourte(d.jours[d.jours.length - 1]) : 'le' + (d.jours.length > 1 ? 's' : '') + ' ' + enListe(d.jours.map(dateCourte));
  else t = d.debut === d.fin ? 'le ' + dateMoy(d.debut) : 'du ' + dateCourte(d.debut) + ' au ' + dateCourte(d.fin);
  if (d.semaine && d.semaine.length) t += ', les ' + enListe(d.semaine.map(n => JC[n % 7]));
  return t;
}
const resumeHoraires = d => d.plages && d.plages.length ? d.plages.map(p => p[0] + '–' + p[1]).join(', ') : 'toute la journée';
function resumeDiffusion(d) { return nomsFlux(d.flux) + ' · ' + resumeJours(d) + ' · ' + resumeHoraires(d) + (d.prioritaire ? ' · prioritaire' : ''); }
const diffsDe = id => E.diffusions.filter(d => d.contenu === id);

/* ================= routeur ================= */
const app = $('#app');
let route = '#ecrans', edition = null, minuterieVue = null, bloquerRoute = false;
const afficher = (...n) => remplacer(app, ...n);
// Après une attente réseau, ne redessine que si l'utilisateur est resté sur la même rubrique.
const surVue = nom => (route.slice(1).split('/')[0] || 'ecrans') === nom;
async function naviguer() {
  if (bloquerRoute) { bloquerRoute = false; return; }
  const [nom, arg] = (location.hash.slice(1) || 'ecrans').split('/');
  if (conversionsEnCours.size) {
    if (!(await demander('Conversion en cours', 'Quitter cette page annule la conversion de la vidéo.', 'Quitter et annuler', true))) {
      bloquerRoute = true; location.hash = route; return;
    }
    for (const annuler of [...conversionsEnCours]) annuler();
  }
  if (edition && edition.sale && !(nom === 'contenu' && arg === edition.id)) {
    if (!(await demander('Modifications non enregistrées', 'Quitter cette page sans enregistrer vos modifications ?', 'Quitter sans enregistrer', true))) {
      bloquerRoute = true; location.hash = route; return;
    }
  }
  edition = null; route = location.hash || '#ecrans';
  clearInterval(minuterieVue);
  // Données de plus de 20 s : on les rafraîchit (autre personne, autre onglet) avant d'afficher.
  if (Date.now() - chargeLe > 20000) {
    const ici = route;
    try { await recharger(); } catch { /* hors ligne : on affiche ce qu'on a */ }
    if (route !== ici) return;
  }
  const onglet = { contenu: 'contenus', nouveau: 'contenus' }[nom] || nom;
  document.querySelectorAll('.ah-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vue === onglet || (onglet === 'ecrans' && b.dataset.vue === 'tableau'))));
  window.scrollTo(0, 0);
  try {
    if (nom === 'contenus') vueContenus();
    else if (nom === 'contenu') vueEditeur(arg, null);
    else if (nom === 'nouveau') vueEditeur(null, arg);
    else if (nom === 'calendrier') vueCalendrier(arg);
    else if (nom === 'flux') vueFlux();
    else if (nom === 'journal') vueJournal(1);
    else if (nom === 'reglages') vueReglages();
    else vueEcrans();
  } catch (e) {
    console.error(e);
    afficher(h('p', { class: 'erreur', text: 'Erreur d’affichage : ' + e.message }));
  }
}
window.addEventListener('hashchange', naviguer);
window.addEventListener('beforeunload', e => { if ((edition && edition.sale) || conversionsEnCours.size) { e.preventDefault(); e.returnValue = ''; } });
document.querySelectorAll('.ah-tabs button').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.vue === 'tableau' ? '#ecrans' : '#' + b.dataset.vue; }));

/* ================= vue : écrans ================= */
function etatEcran(code) {
  const e = E.ecrans.find(x => x.flux_code === code);
  if (!e) return { e: null, puce: h('span', { class: 'puce puce-gris', text: 'Jamais vu' }) };
  const age = (maintenant() - e.vu_le) / 1000;
  const depuis = age < 90 ? 'en ligne' : age < 3600 ? 'vu il y a ' + Math.round(age / 60) + ' min' : age < 86400 ? 'vu il y a ' + Math.round(age / 3600) + ' h' : 'vu le ' + heureIso(new Date(e.vu_le).toISOString());
  return { e, enLigne: age < 90, puce: h('span', { class: 'puce ' + (age < 90 ? 'puce-ok' : 'puce-ko') }, h('i'), depuis) };
}
function titreEtape(et) {
  if (!et.contenu) return 'Logo 6MIC (rien de programmé)';
  return et.contenu.titre + (et.pages > 1 ? ' (page ' + et.page + '/' + et.pages + ')' : '') + (et.defaut ? ' — par défaut' : '');
}
function listeBoucle(code, ms, cleActuelle) {
  const calc = R.etapes(progFlux(code), ms);
  const l = h('ol', { class: 'boucle' });
  for (const et of calc.etapes) {
    l.append(h('li', { class: et.cle === cleActuelle ? 'ici' : null },
      h('span', { class: 'puce t-' + (et.contenu ? et.contenu.type : 'image'), text: et.contenu ? TYPES[et.contenu.type] : 'Veille' }),
      h('span', { class: 'nom', text: titreEtape(et) }),
      h('span', { class: 'aide', text: et.type === 'video' ? (et.duree ? Math.round(et.duree) + ' s' : 'vidéo') : et.duree + ' s' })));
  }
  return { liste: l, prioritaire: calc.prioritaire };
}
function alertes() {
  const l = [];
  const t = auj(), limite = R.ajouterJours(t, 2);
  for (const c of E.contenus) {
    if (c.statut !== 'actif' || !diffsDe(c.id).some(d => d.fin >= t)) continue;
    if ((c.type === 'image' || c.type === 'video') && !c.donnees.src) l.push('« ' + c.titre + ' » est programmé mais n’a pas de fichier.');
  }
  for (const f of E.flux) {
    const p = progFlux(f.code);
    let total = 0;
    const vus = new Set();
    for (const d of p.diffusions) {
      const c = p.contenus[d.contenu];
      if (c.type === 'video' && d.fin >= t && d.debut <= limite && !vus.has(c.id)) { vus.add(c.id); total += c.donnees.taille || 0; }
    }
    if (total > 150 * 1048576) l.push(f.nom + ' : ' + mo(total) + ' de vidéos dans les 3 prochains jours, au-delà des 150 Mo de mémoire de l’écran (elles seront lues depuis le réseau).');
  }
  if (!E.r2) l.push('Le stockage Cloudflare R2 n’est pas activé : l’import d’images et de vidéos est impossible.');
  return l.length ? h('section', { class: 'alertes' }, h('h2', { text: 'À vérifier' }), h('ul', null, l.map(x => h('li', { text: x })))) : null;
}
function vueEcrans() {
  const ms = maintenant();
  afficher(
    h('div', { class: 'tete' },
      h('div', null, h('p', { class: 'surtitre', text: dateLongue(auj()) }), h('h1', { class: 'titre', text: 'Écrans' })),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => identifier('tous') }, 'Identifier tous les écrans'),
        h('a', { class: 'btn btn-noir', href: '#nouveau/soiree' }, '+ Annoncer une soirée'))),
    alertes(),
    h('div', { class: 'ecrans' }, E.flux.map(f => {
      const s = etatEcran(f.code), cle = s.e && s.e.contenu;
      const enCours = cle ? (cle === 'veille' ? 'Logo 6MIC (veille)' : ((E.contenuParId.get(cle.split('#')[0]) || {}).titre || cle)) : '—';
      const b = listeBoucle(f.code, ms, s.enLigne ? cle : null);
      return h('article', { class: 'carte' },
        h('div', { class: 'carte-t' }, h('h2', { text: f.nom }), s.puce),
        h('div', { class: 'carte-c' },
          s.e && h('p', { class: 'ecran-maint' }, s.enLigne ? 'À l’écran en ce moment' : 'Dernier contenu affiché', h('b', { text: enCours })),
          h('div', { class: 'lbl', text: b.prioritaire ? 'Boucle en ce moment : diffusion prioritaire' : 'Boucle en ce moment' }), b.liste,
          s.e && h('p', { class: 'meta' },
            h('span', { text: 'Lecteur ' + (s.e.lecteur || '?') }), h('span', { text: 'mémoire ' + mo(s.e.memoire || 0) }),
            h('span', { text: plur(s.e.chargements || 0, 'chargement') }), s.e.taille && h('span', { text: 'page ' + s.e.taille.replace('x', ' × ') }),
            s.e.video === 'simple' && h('span', { class: 'attention', text: 'un seul lecteur vidéo' })),
          s.e && s.e.erreur && h('p', { class: 'meta attention', text: 'Dernier incident : ' + s.e.erreur })),
        h('div', { class: 'carte-p' },
          h('button', { type: 'button', class: 'btn pt', onclick: () => identifier(f.code) }, 'Identifier'),
          h('a', { class: 'btn pt', href: '/?flux=' + f.code + '&debug=1', target: '_blank', rel: 'noopener' }, 'Voir le flux ↗')));
    })));
  clearInterval(minuterieVue);
  minuterieVue = setInterval(async () => { try { await recharger(); if (surVue('ecrans')) vueEcrans(); } catch { /* hors ligne */ } }, 30000);
}
async function identifier(code) {
  try {
    await ecrire(() => api('POST', '/api/admin/flux/' + code + '/identifier', {}),
      code === 'tous' ? 'Chaque écran affichera son nom d’ici 30 secondes.' : 'L’écran ' + E.fluxParCode.get(code).nom + ' affichera son nom d’ici 30 secondes.');
  } catch { /* message déjà affiché */ }
}

/* ================= vue : contenus ================= */
function vignette(c) {
  const d = c.donnees, img = h('div', { class: 'vignette-img' });
  const src = c.type === 'video' ? d.poster : c.type === 'image' ? d.src : d.photo && d.photo.src;
  if (src) img.style.backgroundImage = 'url("' + src + '")';
  if (c.type === 'agenda') img.append(h('div', { class: 'vignette-ag' }, h('b', { text: d.titre || c.titre }), h('span', { text: plur((d.dates || []).length, 'date') })));
  if (c.type === 'serie') {
    // planche des affiches de la série, sur la couleur de fond choisie
    img.classList.add('vignette-serie', 'f-' + (d.fond || 'violet'));
    img.append(h('div', { class: 'vignette-ser' }, (d.dates || []).slice(0, 4).map(x => h('i', { style: x.photo && x.photo.src ? { backgroundImage: 'url("' + x.photo.src + '")' } : null }))),
      h('b', { class: 'vignette-ser-t', text: d.titre || c.titre }));
  }
  if (c.type === 'soiree') img.append(h('div', { class: 'vignette-soiree', text: d.nom || '' }));
  if (c.type === 'lineup') {
    img.append(h('div', { class: 'vignette-soiree', text: d.titre || G.vedetteDe(d.passages) || 'Line-up' }));
  }
  img.append(h('span', { class: 'puce t-' + c.type, text: TYPES[c.type] }));
  const t = auj(), actives = diffsDe(c.id).filter(x => x.fin >= t);
  const flux = [...new Set(actives.flatMap(x => x.flux))];
  const sous = c.type === 'soiree' || c.type === 'lineup' ? (d.date ? dateLongue(d.date) + (d.date < t ? ' (passée)' : '') : 'Date à préciser') + (c.type === 'lineup' ? ' · ' + plur((d.passages || []).length, 'passage') : '')
    : c.type === 'agenda' || c.type === 'serie' ? plur((d.dates || []).filter(x => x.date >= t).length, 'date') + ' à venir'
      : c.type === 'video' ? (d.duree ? Math.round(d.duree) + ' s' + (d.taille ? ' · ' + mo(d.taille) : '') : d.src ? 'Vidéo' : 'Sans fichier')
        : (d.largeur ? d.largeur + ' × ' + d.hauteur + ' px' : d.src ? 'Image' : 'Sans fichier');
  return h('a', { class: 'vignette' + (c.statut === 'archive' ? ' archive' : ''), href: '#contenu/' + c.id }, img,
    h('div', { class: 'vignette-c' }, h('b', { text: c.titre }), h('span', { text: sous }),
      h('div', { class: 'prog-resume' }, c.statut === 'archive' ? h('span', { class: 'puce puce-gris', text: 'Archivé' })
        : flux.length ? [h('span', { class: 'puce puce-noir', text: flux.length === E.flux.length ? 'Tous les écrans' : plur(flux.length, 'écran') }),
          h('span', { class: 'aide', text: 'jusqu’au ' + dateCourte(actives.map(x => x.fin).sort().pop()) })]
          : h('span', { class: 'puce puce-filet', text: 'Non programmé' }))));
}
/* Filtres des contenus. Avec ~140 soirées par an, on filtre par mois de la soirée, par mois de programmation,
   et on repère les contenus non programmés. Réglages gardés dans ce navigateur (localStorage). */
const FILTRE_VIDE = { type: 'tous', archives: false, texte: '', soiree: '', prog: '', tri: 'date' };
const filtre = Object.assign({}, FILTRE_VIDE, (() => { try { return JSON.parse(localStorage.getItem('tv6mic-filtre-contenus')) || {}; } catch { return {}; } })());
const garderFiltre = () => { try { localStorage.setItem('tv6mic-filtre-contenus', JSON.stringify(filtre)); } catch { /* navigation privée */ } };
const moisLong = m => { const [a, n] = m.split('-').map(Number); return MOIS[n - 1] + ' ' + a; };
// Dates « de soirée » d'un contenu : la date du concert, ou toutes les dates d'un agenda.
const datesDe = c => c.type === 'soiree' || c.type === 'lineup' ? (c.donnees.date ? [c.donnees.date] : []) : c.type === 'agenda' || c.type === 'serie' ? (c.donnees.dates || []).map(x => x.date).filter(Boolean) : [];
// Pour le tri : la date de la soirée ; pour un agenda, sa prochaine date (sinon la dernière).
function dateRef(c, t) {
  const l = datesDe(c).slice().sort();
  if (!l.length) return null;
  return c.type === 'agenda' || c.type === 'serie' ? (l.find(x => x >= t) || l[l.length - 1]) : l[0];
}
// Mois couverts par les programmations d'un contenu (jours réellement diffusés : période, jours choisis, jours de semaine).
function moisProgrammes(c) {
  const mois = new Set();
  for (const d of diffsDe(c.id)) {
    let j = d.debut, n = 0;
    while (j <= d.fin && n++ < 800) { if (R.couvreJour(d, j)) mois.add(j.slice(0, 7)); j = R.ajouterJours(j, 1); }
  }
  return mois;
}
// Index calculé une fois par affichage : évite de reparcourir les programmations pour chaque filtre.
function indexContenus() {
  const t = auj();
  return E.contenus.map(c => {
    const diffs = diffsDe(c.id);
    return { c, dates: datesDe(c), ref: dateRef(c, t), mois: moisProgrammes(c),
      aVenir: diffs.some(d => d.fin >= t), aujourdhui: diffs.some(d => R.couvreJour(d, t)) };
  });
}
function correspond(x, f, t, sauf) {
  const c = x.c;
  if (f.type !== 'tous' && c.type !== f.type) return false;
  if (f.archives ? c.statut !== 'archive' : c.statut === 'archive') return false;
  const q = f.texte.trim().toLowerCase();
  if (q && !(c.titre + ' ' + (c.donnees.nom || '') + ' ' + (c.donnees.titre || '') + ' ' + (c.donnees.dates || []).map(z => z.nom).join(' ')).toLowerCase().includes(q)) return false;
  if (sauf !== 'soiree' && f.soiree) {
    if (f.soiree === 'avenir' ? !x.dates.some(d => d >= t)
      : f.soiree === 'passees' ? !(x.dates.length && x.dates.every(d => d < t))
        : f.soiree === 'sans' ? x.dates.length > 0
          : !x.dates.some(d => d.startsWith(f.soiree))) return false;
  }
  if (sauf !== 'prog' && f.prog) {
    if (f.prog === 'non' ? x.aVenir : f.prog === 'oui' ? !x.aVenir : f.prog === 'auj' ? !x.aujourdhui : !x.mois.has(f.prog)) return false;
  }
  return true;
}
function vueContenus() {
  const t = auj(), index = indexContenus();
  let limite = 60;
  const zone = h('div', { class: 'resultats' }), compte = h('span', { class: 'aide' });
  const selSoiree = h('select', { 'aria-label': 'Date de la soirée', onchange: e => { filtre.soiree = e.target.value; changer(); } });
  const selProg = h('select', { 'aria-label': 'Programmation', onchange: e => { filtre.prog = e.target.value; changer(); } });
  const selTri = h('select', { 'aria-label': 'Trier par', onchange: e => { filtre.tri = e.target.value; changer(); } },
    [['date', 'Date de la soirée'], ['modif', 'Dernière modification'], ['nom', 'Nom']].map(([v, l]) => h('option', { value: v, text: l, selected: filtre.tri === v })));
  const changer = () => { limite = 60; garderFiltre(); remplir(); };
  // Options des deux listes de mois, avec le nombre de contenus que chacune afficherait (compte tenu des autres filtres).
  const options = (sel, cle, fixes, mois, titreMois) => {
    const base = index.filter(x => correspond(x, filtre, t, cle));
    const n = v => base.filter(x => correspond(x, Object.assign({}, filtre, { [cle]: v }), t)).length;
    const valeur = filtre[cle];
    const groupe = mois.length ? h('optgroup', { label: titreMois }, mois.map(m => h('option', { value: m, text: moisLong(m) + ' (' + n(m) + ')', selected: valeur === m }))) : null;
    remplacer(sel, fixes.map(([v, l]) => h('option', { value: v, text: l + (v ? ' (' + n(v) + ')' : ''), selected: valeur === v })), groupe);
    if (valeur && !sel.value) { filtre[cle] = ''; sel.value = ''; }
  };
  const remplir = () => {
    const visibles = index.filter(x => x.c.statut !== 'archive' || filtre.archives);
    const moisSoirees = [...new Set(visibles.flatMap(x => x.dates.map(d => d.slice(0, 7))))].sort();
    const moisProg = [...new Set(visibles.flatMap(x => [...x.mois]))].sort();
    options(selSoiree, 'soiree', [['', 'Toutes les dates'], ['avenir', 'À venir'], ['passees', 'Passées'], ['sans', 'Sans date (images, vidéos)']], moisSoirees, 'Mois de la soirée');
    options(selProg, 'prog', [['', 'Toutes'], ['non', 'Non programmés'], ['oui', 'Programmés'], ['auj', 'À l’écran aujourd’hui']], moisProg, 'Programmés en');
    const l = index.filter(x => correspond(x, filtre, t));
    const total = index.filter(x => filtre.archives ? x.c.statut === 'archive' : x.c.statut !== 'archive').length;
    compte.textContent = l.length === total ? plur(l.length, 'contenu') : plur(l.length, 'contenu affiché', 'contenus affichés') + ' sur ' + total;
    reinit.hidden = ['type', 'archives', 'texte', 'soiree', 'prog'].every(k => filtre[k] === FILTRE_VIDE[k]);
    // tri et regroupement
    let groupes;
    if (filtre.tri === 'nom') groupes = [[null, l.slice().sort((a, b) => a.c.titre.localeCompare(b.c.titre, 'fr'))]];
    else if (filtre.tri === 'modif') groupes = [[null, l.slice().sort((a, b) => a.c.modifie_le < b.c.modifie_le ? 1 : -1)]];
    else {
      // à venir (mois croissants), puis passées (mois décroissants), puis sans date
      const avenir = l.filter(x => x.ref && x.ref >= t).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
      const passees = l.filter(x => x.ref && x.ref < t).sort((a, b) => a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0);
      const sans = l.filter(x => !x.ref).sort((a, b) => a.c.modifie_le < b.c.modifie_le ? 1 : -1);
      const parMois = (liste, passe) => {
        const g = new Map();
        for (const x of liste) { const m = x.ref.slice(0, 7); if (!g.has(m)) g.set(m, []); g.get(m).push(x); }
        return [...g].map(([m, xs]) => [moisLong(m) + (passe ? ' · passé' : ''), xs]);
      };
      groupes = [...parMois(avenir, false), ...parMois(passees, true), ...(sans.length ? [['Sans date : images, vidéos…', sans]] : [])];
    }
    // affichage progressif : 60 vignettes, puis « Afficher plus »
    let reste = limite;
    const blocs = [];
    for (const [titre, xs] of groupes) {
      if (reste <= 0) break;
      const part = xs.slice(0, reste); reste -= part.length;
      blocs.push(titre ? h('h2', { class: 'groupe-t' }, titre, h('span', { text: plur(xs.length, 'contenu') })) : null,
        h('div', { class: 'vignettes' }, part.map(x => vignette(x.c))));
    }
    const restants = l.length - Math.min(l.length, limite);
    remplacer(zone, ...(l.length ? blocs : [h('p', { class: 'aide vide', text: filtre.archives ? 'Aucun contenu archivé pour ces filtres.' : 'Aucun contenu pour ces filtres.' })]),
      restants > 0 && h('div', { class: 'plus' }, h('button', { type: 'button', class: 'btn', onclick: () => { limite += 60; remplir(); } }, 'Afficher plus (' + restants + ' restants)')));
    majAlerte();
  };
  // Raccourci : soirées à venir qui ne passent sur aucun écran.
  const alerte = h('div', { class: 'alerte-prog', hidden: true });
  const majAlerte = () => {
    const n = index.filter(x => x.c.type === 'soiree' && x.c.statut !== 'archive' && x.dates.some(d => d >= t) && !x.aVenir).length;
    const deja = filtre.type === 'soiree' && filtre.soiree === 'avenir' && filtre.prog === 'non' && !filtre.archives;
    alerte.hidden = !n || deja;
    remplacer(alerte, h('span', { text: n > 1 ? n + ' soirées à venir ne sont programmées sur aucun écran.' : '1 soirée à venir n’est programmée sur aucun écran.' }),
      h('button', { type: 'button', class: 'btn pt', onclick: () => {
        Object.assign(filtre, FILTRE_VIDE, { type: 'soiree', soiree: 'avenir', prog: 'non', tri: 'date' }); synchro(); changer();
      } }, n > 1 ? 'Les afficher' : 'L’afficher'));
  };
  const seg = h('div', { class: 'seg seg-types', role: 'group', 'aria-label': 'Type' }, [['tous', 'Tous'], ['soiree', 'Soirées'], ['lineup', 'Line-up'], ['agenda', 'Agendas'], ['serie', 'Séries'], ['image', 'Images'], ['video', 'Vidéos']].map(([k, tx]) =>
    h('button', { type: 'button', 'data-v': k, onclick: () => { filtre.type = k; synchro(); changer(); } }, tx)));
  const recherche = h('input', { type: 'search', placeholder: 'Rechercher un nom…', value: filtre.texte, 'aria-label': 'Rechercher', oninput: e => { filtre.texte = e.target.value; changer(); } });
  const archives = h('input', { type: 'checkbox', checked: filtre.archives, onchange: e => { filtre.archives = e.target.checked; changer(); } });
  const reinit = h('button', { type: 'button', class: 'lien', onclick: () => { Object.assign(filtre, FILTRE_VIDE); synchro(); changer(); } }, 'Réinitialiser les filtres');
  const synchro = () => {
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === filtre.type)));
    recherche.value = filtre.texte; archives.checked = filtre.archives; selTri.value = filtre.tri;
  };
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: plur(E.contenus.filter(c => c.statut !== 'archive').length, 'contenu') }), h('h1', { class: 'titre', text: 'Contenus' })),
      h('div', { class: 'nouveau' }, h('span', { class: 'lbl', text: 'Nouveau :' }),
        Object.entries(TYPES).map(([k, tx]) => h('a', { class: 'btn' + (k === 'soiree' ? ' btn-noir' : ''), href: '#nouveau/' + k }, '+ ' + tx)))),
    h('div', { class: 'filtres' }, seg, recherche, h('label', { class: 'coche' }, archives, 'Archives')),
    h('div', { class: 'filtres filtres-2' },
      h('label', { class: 'filtre' }, h('span', { class: 'lbl', text: 'Date de la soirée' }), selSoiree),
      h('label', { class: 'filtre' }, h('span', { class: 'lbl', text: 'Programmation' }), selProg),
      h('label', { class: 'filtre' }, h('span', { class: 'lbl', text: 'Trier par' }), selTri),
      h('p', { class: 'compte' }, compte, reinit)),
    alerte, zone);
  synchro();
  remplir();
}

/* ================= vue : éditeur de contenu ================= */
function donneesVides(type) {
  if (type === 'soiree') return { nom: '', date: '', heure: '20:00', photo: null, infos: '', mention: '', billetterie: '' };
  if (type === 'agenda') return { titre: 'Prochainement au 6MIC', dates: [], photo: null };
  if (type === 'serie') return { accroche: '', titre: '', fond: 'violet', dates: [] };
  if (type === 'lineup') return { titre: '', date: '', lieu: '', photo: null, passages: [
    { heure: '19:30', role: 'ouverture', libelle: '', nom: '' }, { heure: '20:30', role: 'premiere', libelle: '', nom: '' },
    { heure: '21:30', role: 'tete', libelle: '', nom: '' }, { heure: '00:00', role: 'fermeture', libelle: '', nom: '' }] };
  if (type === 'image') return { src: null, ajustement: 'remplir' };
  return { src: null, poster: null, son: false };
}
function titreAuto(ed) {
  const d = ed.donnees;
  if (ed.type === 'soiree') return (d.nom || 'Soirée') + (d.date ? ' · ' + dateCourte(d.date) : '');
  if (ed.type === 'agenda') return d.titre || 'Agenda';
  if (ed.type === 'serie') return d.titre || 'Série';
  if (ed.type === 'lineup') {
    return 'Line-up · ' + (d.titre || G.vedetteDe(d.passages) || 'soirée') + (d.date ? ' · ' + dateCourte(d.date) : '');
  }
  return d.fichier || TYPES[ed.type];
}
// Motif du design system posé sur la photo d'une soirée : sans réglage, le motif par défaut s'affiche.
// Couleur : une des couleurs de la charte, ou une teinte personnalisée (nuancier, code « #rrggbb » ou pipette).
const ICONE_PIPETTE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5"/><path d="M17 2.5a2.1 2.1 0 013 3l-2.5 2.5-3-3z"/><path d="M14.5 5.5l-9.3 9.3a2 2 0 00-.5.9L4 19.5l3.8-.7a2 2 0 00.9-.5l9.3-9.3"/></svg>';
function champMotif(d, changer, apercuNoeud) {
  const reglage = G.motifDe(d);
  const lignes = {};
  let saisieCode = false;   // pendant la frappe du code, on ne réécrit pas le champ sous les doigts
  const estTeinte = c => G.TEINTE.test(c || '');
  const maj = () => {
    for (const cle of ['type', 'position', 'couleur']) lignes[cle].querySelectorAll('button[data-v]').forEach(b => {
      const v = b.dataset.v;
      b.setAttribute('aria-pressed', String(v === 'perso' ? estTeinte(reglage.couleur) : v === reglage[cle]));
    });
    const sans = reglage.type === 'aucun', perso = estTeinte(reglage.couleur);
    lignes.position.closest('.champ').hidden = sans; lignes.couleur.closest('.champ').hidden = sans;
    rangPerso.hidden = sans || !perso;
    if (perso) {
      pastillePerso.style.background = reglage.couleur;
      nuancier.value = reglage.couleur;
      if (!saisieCode) code.value = reglage.couleur;
    }
    defaut.hidden = !d.motif;
  };
  const choisir = (cle, v) => { reglage[cle] = v; d.motif = Object.assign({}, reglage); maj(); changer(); };
  const teinte = hex => { if (estTeinte(hex)) choisir('couleur', hex.toLowerCase()); };
  const ligne = (cle, choix, label, ...plus) => {
    lignes[cle] = h('div', { class: 'seg', role: 'group', 'aria-label': label }, Object.entries(choix).map(([k, t]) =>
      h('button', { type: 'button', 'data-v': k, onclick: () => choisir(cle, k) }, cle === 'couleur' ? h('i', { class: 'pastille p-' + k }) : null, t)), plus);
    return h('div', { class: 'champ' }, h('span', { class: 'lbl', text: label }), lignes[cle]);
  };

  /* couleur personnalisée */
  const pastillePerso = h('i', { class: 'pastille p-perso' });
  const boutonPerso = h('button', { type: 'button', 'data-v': 'perso', onclick: () => {
    // on part de la couleur affichée (le dégradé commence par le rose)
    if (!estTeinte(reglage.couleur)) teinte(G.teinteDe(reglage.couleur));
  } }, pastillePerso, 'Personnalisée');
  const nuancier = h('input', { type: 'color', 'aria-label': 'Nuancier', value: '#e744a8', oninput: e => teinte(e.target.value) });
  const code = h('input', { type: 'text', class: 'code-teinte', maxLength: 7, spellcheck: false, autocomplete: 'off', 'aria-label': 'Code couleur', placeholder: '#e744a8',
    oninput: e => { let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v; saisieCode = true; if (estTeinte(v)) teinte(v); saisieCode = false; },
    onblur: () => { code.value = reglage.couleur; } });
  const bulle = h('p', { class: 'aide pipette-aide', hidden: true });
  const pipette = h('button', { type: 'button', class: 'btn pt', title: 'Prélever une couleur à l’écran', onclick: () => prelever() });
  pipette.innerHTML = ICONE_PIPETTE + '<span>Pipette</span>';
  const rangPerso = h('div', { class: 'perso' }, nuancier, code, pipette, bulle);

  // Pipette : celle du navigateur quand il en a une (Chrome, Edge), sinon un clic dans la photo de l'aperçu.
  let annulerPrelevement = null;
  async function prelever() {
    if (annulerPrelevement) { annulerPrelevement(); return; }
    if ('EyeDropper' in window) {
      try { const r = await new window.EyeDropper().open(); teinte(versHex(r.sRGBHex)); } catch { /* annulé */ }
      return;
    }
    const src = d.photo && d.photo.src;
    if (!src || !apercuNoeud) { annoncer('Ajoutez d’abord une photo, ou choisissez la teinte dans le nuancier.', true); return; }
    apercuNoeud.classList.add('preleve');
    bulle.hidden = false; bulle.textContent = 'Cliquez dans la photo de l’aperçu pour prélever sa couleur (Échap pour annuler).';
    const fin = () => { apercuNoeud.classList.remove('preleve'); bulle.hidden = true; apercuNoeud.removeEventListener('click', clic, true); document.removeEventListener('keydown', echap); annulerPrelevement = null; };
    const echap = e => { if (e.key === 'Escape') fin(); };
    const clic = async e => {
      e.preventDefault(); e.stopPropagation(); fin();
      try { teinte(await couleurDansPhoto(src, apercuNoeud, e)); } catch { annoncer('Couleur illisible dans cette photo.', true); }
    };
    apercuNoeud.addEventListener('click', clic, true);
    document.addEventListener('keydown', echap);
    annulerPrelevement = fin;
  }

  const defaut = h('button', { type: 'button', class: 'lien', onclick: () => {
    d.motif = null; Object.assign(reglage, G.motifDe(d)); maj(); changer();
  } }, 'Revenir au motif par défaut');
  const boite = h('fieldset', { class: 'motif' }, h('legend', { text: 'Motif 6MIC' }),
    ligne('type', G.MOTIFS, 'Motif'), ligne('position', G.POSITIONS, 'Position'), ligne('couleur', Object.fromEntries(Object.keys(G.COULEURS).map(k => [k, G.nomCouleur(k)])), 'Couleur', boutonPerso), rangPerso,
    h('small', null, 'Les motifs du design system 6MIC, posés sur la photo. Par défaut : ' + G.MOTIFS[G.MOTIF_DEFAUT.type].toLowerCase() + ', ' +
      G.POSITIONS[G.MOTIF_DEFAUT.position].toLowerCase() + ', ' + G.nomCouleur(G.MOTIF_DEFAUT.couleur).toLowerCase() + '. ', defaut));
  maj();
  return boite;
}
// « rgb(r, g, b) » ou « #rrggbb » → « #rrggbb »
function versHex(c) {
  const m = String(c).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return m ? '#' + m.slice(1, 4).map(n => (+n).toString(16).padStart(2, '0')).join('') : String(c).toLowerCase();
}
// Couleur de la photo sous le clic : même cadrage que l'écran (photo « cover », centrée), moyenne sur 5 × 5 px.
const imagesPrelevement = new Map();
async function couleurDansPhoto(src, boite, e) {
  let img = imagesPrelevement.get(src);
  if (!img) { img = new Image(); img.src = src; await img.decode(); imagesPrelevement.set(src, img); }
  const r = boite.getBoundingClientRect(), s = r.width / 1920;
  const X = (e.clientX - r.left) / s, Y = (e.clientY - r.top) / s;
  const k = Math.max(1920 / img.naturalWidth, 1080 / img.naturalHeight);
  const ix = (X - (1920 - img.naturalWidth * k) / 2) / k, iy = (Y - (1080 - img.naturalHeight * k) / 2) / k;
  const c = h('canvas', { width: 5, height: 5 }), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, ix - 2.5, iy - 2.5, 5, 5, 0, 0, 5, 5);
  const p = x.getImageData(0, 0, 5, 5).data, t = [0, 0, 0];
  for (let i = 0; i < p.length; i += 4) { t[0] += p[i]; t[1] += p[i + 1]; t[2] += p[i + 2]; }
  return '#' + t.map(v => Math.round(v / 25).toString(16).padStart(2, '0')).join('');
}
// Série : accroche, titre, couleur de fond, 1 à 4 dates (photo, jour, heure, nom, mention).
// Les dates peuvent venir des soirées déjà enregistrées (avec leur photo).
function champsSerie(d, changer) {
  d.dates = d.dates || [];
  const max = R.SERIE_MAX;
  const lignes = h('div', { class: 'dates-serie' });
  const choixSoiree = h('select', { 'aria-label': 'Ajouter une soirée enregistrée', onchange: e => {
    const c = E.contenuParId.get(e.target.value); e.target.value = '';
    if (!c || d.dates.length >= max) return;
    const x = c.donnees;
    d.dates.push({ date: x.date, heure: x.heure || '', nom: x.nom || c.titre, mention: x.mention || '', photo: x.photo && x.photo.src ? Object.assign({}, x.photo) : null });
    d.dates.sort((a, b) => (a.date || '9') < (b.date || '9') ? -1 : 1);
    remplir(); changer();
  } });
  const ajouter = h('button', { type: 'button', class: 'btn', onclick: () => {
    if (d.dates.length >= max) return;
    d.dates.push({ date: R.ajouterJours(auj(), 7), heure: '20:30', nom: '', mention: '', photo: null }); remplir(); changer();
    lignes.lastChild.querySelector('input[type="text"]').focus();
  } }, '+ Ajouter une date');
  const compte = h('small');
  // Nombre d'affiches à l'écran (dates à venir, 4 au plus) : il fixe le cadre des photos.
  const nAffiches = () => Math.max(1, etapesApercu({ type: 'serie', donnees: d })[0].dates.length);
  const cadrePhoto = () => G.cadreSerie(nAffiches());
  const formats = [1, 3, 4].map(n => { const c = G.cadreSerie(n); return c.largeur + ' × ' + c.hauteur + ' px ' + (n === 1 ? 'pour 1 ou 2 dates' : 'pour ' + n); });
  // Plusieurs images déposées sur une date : les suivantes vont aux dates suivantes.
  const repartir = (i, reste) => {
    const medias = Array.from(lignes.querySelectorAll('.date-serie .media')).slice(i + 1);
    reste.slice(0, medias.length).forEach((f, k) => medias[k]._recevoir([f]));
    if (reste.length > medias.length) annoncer(plur(reste.length - medias.length, 'image') + ' en trop : ajoutez d’abord les dates correspondantes, puis déposez-les.', true);
  };
  function majChoix() {
    const t = auj(), deja = new Set(d.dates.map(x => x.date + '|' + x.nom));
    const soirees = E.contenus.filter(c => c.type === 'soiree' && c.statut === 'actif' && c.donnees.date && c.donnees.date >= t && !deja.has(c.donnees.date + '|' + (c.donnees.nom || c.titre)))
      .sort((a, b) => a.donnees.date < b.donnees.date ? -1 : 1);
    remplacer(choixSoiree, h('option', { value: '', text: soirees.length ? 'Ajouter une soirée enregistrée…' : 'Aucune autre soirée à venir' }),
      soirees.map(c => h('option', { value: c.id, text: dateCourte(c.donnees.date) + ' · ' + (c.donnees.nom || c.titre) })));
    const plein = d.dates.length >= max;
    choixSoiree.disabled = plein || !soirees.length; ajouter.disabled = plein;
    compte.textContent = plur(d.dates.length, 'date') + ' sur ' + max + ' au plus. Les dates passées disparaissent seules ; « Ce soir » et « Demain » s’affichent d’eux-mêmes.';
  }
  function remplir() {
    remplacer(lignes, ...d.dates.map((x, i) => {
      const pm = mentionsChoix().includes(x.mention) || !x.mention;
      const media = champMedia({ genre: 'image', valeur: x.photo, facultatif: true, change: v => { x.photo = v; changer(); },
        cadre: cadrePhoto, boite: [168, 150], surplus: reste => repartir(i, reste) });
      // toute la carte de la date reçoit les images déposées
      const carte = h('div', { class: 'date-serie depot' + (x.date && x.date < auj() ? ' passee' : '') },
        h('span', { class: 'num', text: String(i + 1) }),
        h('div', { class: 'date-serie-photo' }, media),
        h('div', { class: 'date-serie-champs' },
          h('div', { class: 'grille2' },
            h('input', { type: 'date', value: x.date || '', 'aria-label': 'Date', oninput: e => { x.date = e.target.value; changer(); } }),
            h('input', { type: 'time', value: x.heure || '', 'aria-label': 'Heure', oninput: e => { x.heure = e.target.value; changer(); } })),
          h('input', { type: 'text', value: x.nom || '', maxLength: 120, placeholder: 'Nom de l’artiste ou de la soirée', 'aria-label': 'Nom', oninput: e => { x.nom = e.target.value; changer(); } }),
          h('select', { 'aria-label': 'Mention', onchange: e => { x.mention = e.target.value; changer(); } },
            h('option', { value: '', text: 'Sans mention' }), mentionsChoix().map(m => h('option', { value: m, text: m, selected: x.mention === m })),
            !pm && h('option', { value: x.mention, text: x.mention, selected: true }))),
        h('button', { type: 'button', class: 'btn carre btn-danger', 'aria-label': 'Retirer cette date', onclick: () => { d.dates.splice(i, 1); remplir(); changer(); } }, '×'));
      carte._recevoir = f => media._recevoir(f);
      return carte;
    }));
    majChoix();
  }
  remplir();
  const fondSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Couleur de fond' }, Object.keys(G.FONDS_SERIE).map(k => [k, G.nomCouleur(k)]).map(([k, t]) =>
    h('button', { type: 'button', 'data-v': k, 'aria-pressed': String((d.fond || 'violet') === k), onclick: e => {
      d.fond = k; fondSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); changer();
    } }, h('i', { class: 'pastille p-' + (k === 'noir' ? 'noir' : k) }), t)));
  const champ = (label, entree, aide) => h('div', { class: 'champ' }, h('label', { text: label, for: entree.id }), entree, aide && h('small', { text: aide }));
  const ligneTexte = (cle, label, placeholder, aide) => champ(label, h('input', { id: 'f-' + cle, type: 'text', value: d[cle] || '', maxLength: 80, placeholder,
    oninput: e => { d[cle] = e.target.value; changer(); } }), aide);
  return [
    ligneTexte('accroche', 'Accroche (facultative)', 'Vous aimez Kery James ? / Esthétique rap / Ce soir au 6MIC…', 'Petite ligne au-dessus du titre.'),
    ligneTexte('titre', 'Titre', 'Rap au 6MIC', 'Affiché en très grand ; la taille du texte s’adapte toute seule.'),
    h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Couleur de fond' }), fondSeg),
    h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Dates mises en avant (3 ou 4 conseillées)' }), lignes,
      h('div', { class: 'actions' }, ajouter, choixSoiree), compte,
      h('small', { text: 'Photos : glissez-les sur chaque date (plusieurs d’un coup sur la première : elles se répartissent dans l’ordre). Le cadre dépend du nombre de dates à venir : ' + enListe(formats) + '. Gardez le sujet au centre : quand une date passe, les affiches restantes s’élargissent.' }))
  ];
}
// Line-up : programme d'une soirée (passages : heure, rôle, nom), date, lieu, titre, photo de la tête d'affiche.
// « Préremplir depuis une soirée » reprend la date, la photo et les noms (« TÊTE + PREMIÈRE PARTIE »).
const NIVEAU_PICTO = { vedette: '★★★', forte: '★★', normale: '★', discrete: '·' };
function champsLineup(d, changer) {
  d.passages = d.passages || [];
  const max = 8;
  const boite = h('div', { class: 'lineup-champs' });
  const decaler = (hhmm, min) => { const m = (((Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  function preremplir(c) {
    const x = c.donnees, noms = String(x.nom || c.titre).split(/\s+\+\s+/).map(z => z.trim()).filter(Boolean);
    const debut = x.heure || '20:30', tete = noms[0] || '', premieres = noms.slice(1);
    const fermeture = (d.passages.find(p => p.role === 'fermeture') || {}).heure || '00:00';
    d.date = x.date || d.date; d.photo = x.photo && x.photo.src ? Object.assign({}, x.photo) : d.photo;
    d.passages = [{ heure: decaler(debut, -60), role: 'ouverture', libelle: '', nom: '' }]
      .concat(premieres.map(n => ({ heure: debut, role: 'premiere', libelle: '', nom: n })))
      .concat([{ heure: premieres.length ? decaler(debut, 60) : debut, role: 'tete', libelle: '', nom: tete },
        { heure: fermeture, role: 'fermeture', libelle: '', nom: '' }]);
    rendre(); changer();
    annoncer('Line-up prérempli depuis « ' + c.titre + ' » : vérifiez les heures.');
  }
  function rendre() {
    const t = auj();
    const soirees = E.contenus.filter(c => c.type === 'soiree' && c.statut === 'actif' && c.donnees.date && c.donnees.date >= t).sort((a, b) => a.donnees.date < b.donnees.date ? -1 : 1);
    const lignes = d.passages.map((p, i) => h('div', { class: 'passage' + (G.niveauPassage(p) === 'vedette' ? ' tete' : '') },
      h('input', { type: 'time', value: p.heure || '', 'aria-label': 'Heure', oninput: e => { p.heure = e.target.value; changer(); } }),
      h('select', { 'aria-label': 'Rôle', onchange: e => { p.role = e.target.value; rendre(); changer(); } },
        E.reglages.roles.filter(r => !r.archive || r.cle === p.role).map(r => h('option', { value: r.cle, text: r.cle === 'autre' ? 'Autre…' : r.libelle + (r.archive ? ' (archivé)' : ''), selected: p.role === r.cle }))),
      p.role === 'autre' && h('input', { type: 'text', value: p.libelle || '', maxLength: 40, placeholder: 'Intitulé (Entracte, Dédicaces…)', 'aria-label': 'Intitulé', oninput: e => { p.libelle = e.target.value; changer(); } }),
      h('input', { type: 'text', class: 'passage-nom', value: p.nom || '', maxLength: 120, 'aria-label': 'Nom',
        placeholder: p.role === 'ouverture' || p.role === 'fermeture' ? 'Nom (facultatif)' : 'Nom de l’artiste', oninput: e => { p.nom = e.target.value; changer(); } }),
      h('select', { class: 'passage-niveau', 'aria-label': 'Mise en valeur', title: 'Mise en valeur à l’écran', onchange: e => { p.niveau = e.target.value; rendre(); changer(); } },
        h('option', { value: '', text: 'Auto · ' + G.NIVEAUX_LINEUP[G.niveauParDefaut(p.role)], selected: !p.niveau }),
        Object.entries(G.NIVEAUX_LINEUP).map(([k, l]) => h('option', { value: k, text: (NIVEAU_PICTO[k] || '') + ' ' + l, selected: p.niveau === k }))),
      h('button', { type: 'button', class: 'btn carre btn-danger', 'aria-label': 'Retirer ce passage', onclick: () => { d.passages.splice(i, 1); rendre(); changer(); } }, '×')));
    const ajout = h('button', { type: 'button', class: 'btn', disabled: d.passages.length >= max, onclick: () => {
      const der = d.passages[d.passages.length - 1];
      d.passages.push({ heure: der && der.heure ? decaler(der.heure, 30) : '20:30', role: 'autre', libelle: '', nom: '' }); rendre(); changer();
    } }, '+ Ajouter un passage');
    remplacer(boite,
      h('div', { class: 'champ' }, h('label', { for: 'f-depuis', text: 'Préremplir depuis une soirée enregistrée (facultatif)' }),
        h('select', { id: 'f-depuis', onchange: e => { const c = E.contenuParId.get(e.target.value); if (c) preremplir(c); } },
          h('option', { value: '', text: soirees.length ? 'Choisir une soirée…' : 'Aucune soirée à venir' }),
          soirees.map(c => h('option', { value: c.id, text: dateCourte(c.donnees.date) + ' · ' + (c.donnees.nom || c.titre) })))),
      h('div', { class: 'grille2' },
        h('div', { class: 'champ' }, h('label', { for: 'f-date', text: 'Date de la soirée' }),
          h('input', { id: 'f-date', type: 'date', value: d.date || '', oninput: e => { d.date = e.target.value; changer(); } }),
          h('small', { text: 'Le jour J, l’écran signale le passage en cours et le suivant.' })),
        h('div', { class: 'champ' }, h('label', { for: 'f-lieu', text: 'Salle (facultative)' }),
          h('input', { id: 'f-lieu', type: 'text', value: d.lieu || '', maxLength: 40, list: 'lieux-6mic', placeholder: 'Grande salle, Club…', oninput: e => { d.lieu = e.target.value; changer(); } }),
          h('datalist', { id: 'lieux-6mic' }, sallesChoix().map(l => h('option', { value: l }))))),
      h('div', { class: 'champ' }, h('label', { for: 'f-titre', text: 'Titre (facultatif)' }),
        h('input', { id: 'f-titre', type: 'text', value: d.titre || '', maxLength: 80, placeholder: 'Vide : nom de la tête d’affiche', oninput: e => { d.titre = e.target.value; changer(); } })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Passages' }), h('div', { class: 'passages' }, lignes),
        h('div', { class: 'actions' }, ajout),
        h('small', { text: 'Rangés par heure à l’écran ; un passage après minuit (00:30) compte pour la même soirée. 8 passages au plus. Mise en valeur : « Auto » suit le rôle (la tête d’affiche en vedette) ; Vedette, Forte, Normale ou Discrète la fixent, par exemple pour une co-tête d’affiche ou une info pratique.' })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Photo de la tête d’affiche (facultative)' }),
        champMedia({ genre: 'image', valeur: d.photo, facultatif: true, change: v => { d.photo = v; changer(); },
          cadre: Object.assign({ conseil: 'côté droit de l’écran, bord gauche fondu au noir : sujet au centre ou à droite' }, G.CADRES.lineup) }),
        h('small', { text: 'Sans photo : aplat dégradé du 6MIC.' })));
  }
  rendre();
  return boite;
}
function vueEditeur(id, typeNouveau) {
  const base = id ? E.contenuParId.get(id) : (TYPES[typeNouveau] ? { id: null, type: typeNouveau, titre: '', donnees: donneesVides(typeNouveau), duree: null, statut: 'actif' } : null);
  if (!base) { annoncer('Contenu introuvable.', true); location.hash = '#contenus'; return; }
  const ed = edition = { id: base.id, type: base.type, titre: base.titre, donnees: structuredClone(base.donnees), duree: base.duree, statut: base.statut, modifie_le: base.modifie_le || null, sale: false, titreManuel: !!base.id };
  const d = ed.donnees;
  const ap = apercu();
  let pageApercu = 0;
  const infoApercu = h('p', { class: 'aide' });
  const pager = h('div', { class: 'actions' });
  const majApercu = () => {
    const etapes = etapesApercu(ed);
    pageApercu = Math.min(pageApercu, etapes.length - 1);
    const e = etapes[pageApercu];
    const vide = ed.type === 'image' && !d.src ? 'Importez une image pour la voir ici.' : null;
    ap.rendre(e, vide);
    document.querySelectorAll('.editeur .media').forEach(m => m.majCadre && m.majCadre());
    const duree = ed.type === 'video' ? (d.duree ? Math.round(d.duree) + ' s (durée de la vidéo)' : '—') : (ed.duree || R.DUREES[ed.type]) + ' s' + (ed.type === 'agenda' && etapes.length > 1 ? ' par page' : '');
    infoApercu.textContent = 'Durée à l’écran : ' + duree + (ed.type === 'soiree' && d.date && d.date < auj() ? ' · Date passée : cette soirée ne s’affiche plus.' : '');
    remplacer(pager, 
      ed.type !== 'video' && h('button', { type: 'button', class: 'btn pt', onclick: majApercu }, '↻ Rejouer l’animation'),
      etapes.length > 1 && etapes.map((x, i) => h('button', { type: 'button', class: 'btn pt', 'aria-pressed': String(i === pageApercu), onclick: () => { pageApercu = i; majApercu(); } }, 'Page ' + (i + 1))));
  };
  let minuterieApercu = null;
  const changer = (rendre = true) => {
    ed.sale = true;
    enregistrer.disabled = false;
    if (!ed.titreManuel) { ed.titre = titreAuto(ed); champTitre.value = ed.titre; }
    if (rendre) { clearTimeout(minuterieApercu); minuterieApercu = setTimeout(majApercu, 250); }
  };
  const champ = (label, entree, aide) => h('div', { class: 'champ' }, h('label', { text: label, for: entree.id }), entree, aide && h('small', { text: aide }));
  const texte = (cle, label, opts = {}) => {
    const e = h(opts.multi ? 'textarea' : 'input', { id: 'f-' + cle, type: opts.multi ? null : (opts.type || 'text'), value: d[cle] || '', maxLength: opts.max || 120, placeholder: opts.placeholder || null, rows: opts.multi ? 3 : null,
      oninput: ev => { d[cle] = ev.target.value; changer(); } });
    if (opts.multi) e.value = d[cle] || '';
    return champ(label, e, opts.aide);
  };
  const champTitre = h('input', { id: 'f-nomback', type: 'text', value: ed.titre, maxLength: 120, placeholder: titreAuto(ed),
    oninput: e => { ed.titre = e.target.value; ed.titreManuel = !!e.target.value; ed.sale = true; enregistrer.disabled = false; } });

  /* champs selon le type */
  const champs = [];
  if (ed.type === 'soiree') {
    champs.push(texte('nom', 'Nom du concert', { aide: 'Affiché en très grand ; la taille du texte s’adapte toute seule.' }),
      h('div', { class: 'grille2' }, texte('date', 'Date', { type: 'date', aide: 'La soirée disparaît des écrans le lendemain à 6 h.' }), texte('heure', 'Heure', { type: 'time' })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Photo' }),
        champMedia({ genre: 'image', valeur: d.photo, facultatif: true, change: v => { d.photo = v; changer(); },
          cadre: Object.assign({ conseil: 'plein écran, sujet à droite : le texte occupe la gauche' }, G.CADRES.soiree) })),
      texte('infos', 'Infos', { multi: true, max: 300, aide: 'Deux ou trois lignes : ouverture des portes, tarifs, première partie…' }));
    const autre = !!d.mention && !mentionsChoix().includes(d.mention);
    const libre = h('input', { type: 'text', id: 'f-mention-libre', value: autre ? d.mention : '', maxLength: 40, hidden: !autre, placeholder: 'Mention', oninput: e => { d.mention = e.target.value; changer(); } });
    const sel = h('select', { id: 'f-mention', onchange: e => { const v = e.target.value; libre.hidden = v !== '*'; d.mention = v === '*' ? libre.value : v; changer(); } },
      h('option', { value: '', text: 'Aucune' }), mentionsChoix().map(m => h('option', { value: m, text: m, selected: d.mention === m })), h('option', { value: '*', text: 'Autre…', selected: autre }));
    champs.push(h('div', { class: 'grille2' }, h('div', { class: 'champ' }, h('label', { for: 'f-mention', text: 'Mention' }), sel, libre),
      texte('billetterie', 'Lien billetterie', { type: 'url', max: 300, placeholder: 'https://', aide: 'Affiche un QR code. Laisser vide pour ne pas en mettre.' })));
    champs.push(champMotif(d, changer, ap.noeud));
  } else if (ed.type === 'agenda') {
    const lignes = h('div', { class: 'dates-ag' });
    const remplir = () => {
      remplacer(lignes, ...d.dates.map((x, i) => {
        const pm = mentionsChoix().includes(x.mention) || !x.mention;
        return h('div', { class: 'date-ag' + (x.date && x.date < auj() ? ' passee' : '') },
          h('input', { type: 'date', value: x.date, 'aria-label': 'Date', oninput: e => { x.date = e.target.value; changer(); } }),
          h('input', { type: 'text', value: x.nom, maxLength: 120, placeholder: 'Nom', 'aria-label': 'Nom', oninput: e => { x.nom = e.target.value; changer(); } }),
          h('select', { 'aria-label': 'Mention', onchange: e => { x.mention = e.target.value; changer(); } },
            h('option', { value: '', text: 'Sans mention' }), mentionsChoix().map(m => h('option', { value: m, text: m, selected: x.mention === m })),
            !pm && h('option', { value: x.mention, text: x.mention, selected: true })),
          h('button', { type: 'button', class: 'btn carre btn-danger', 'aria-label': 'Retirer cette date', onclick: () => { d.dates.splice(i, 1); remplir(); changer(); } }, '×'));
      }));
    };
    remplir();
    const importer = () => {
      const t = auj(), deja = new Set(d.dates.map(x => x.date + '|' + x.nom));
      const n = E.contenus.filter(c => c.type === 'soiree' && c.statut === 'actif' && c.donnees.date && c.donnees.date >= t && !deja.has(c.donnees.date + '|' + c.donnees.nom));
      if (!n.length) { annoncer('Aucune nouvelle soirée à ajouter.'); return; }
      for (const c of n) d.dates.push({ date: c.donnees.date, nom: c.donnees.nom || c.titre, mention: c.donnees.mention || '' });
      d.dates.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      remplir(); changer();
      annoncer(plur(n.length, 'soirée ajoutée', 'soirées ajoutées') + '.');
    };
    champs.push(texte('titre', 'Titre de l’agenda', { max: 80 }),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Dates' }), lignes,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { d.dates.push({ date: R.ajouterJours(auj(), 7), nom: '', mention: '' }); remplir(); changer(); lignes.lastChild.querySelector('input[type="text"]').focus(); } }, '+ Ajouter une date'),
          h('button', { type: 'button', class: 'btn', onclick: importer }, 'Ajouter les soirées enregistrées')),
        h('small', { text: 'Les dates passées disparaissent seules. 8 dates au plus par page ; au-delà, les pages s’enchaînent.' })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Photo de fond (facultative)' }),
        champMedia({ genre: 'image', valeur: d.photo, facultatif: true, change: v => { d.photo = v; changer(); },
          cadre: Object.assign({ conseil: 'en fond, très assombrie : une image simple suffit' }, G.CADRES.agenda) })));
  } else if (ed.type === 'serie') {
    champs.push(...champsSerie(d, changer));
  } else if (ed.type === 'lineup') {
    champs.push(champsLineup(d, changer));
  } else if (ed.type === 'image') {
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Image' }),
      champMedia({ genre: 'image', valeur: d.src ? d : null, change: v => { Object.assign(d, v || { src: null }); changer(); },
        cadre: () => Object.assign({ contenir: d.ajustement === 'ajuster', conseil: d.ajustement === 'ajuster' ? 'image entière, sans recadrage' : 'plein écran, recadrée si le format diffère' }, G.CADRES.image) }),
      h('small', { text: 'JPEG, PNG ou WebP. Les visuels 1920 × 1080 de Declinator conviennent tels quels.' })));
    const seg = h('div', { class: 'seg', role: 'group' }, [['remplir', 'Remplir l’écran (recadrer)'], ['ajuster', 'Image entière (bandes noires)']].map(([k, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(d.ajustement === k), onclick: e => { d.ajustement = k; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); changer(); } }, t)));
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Cadrage' }), seg));
  } else {
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Vidéo' }),
      champMedia({ genre: 'video', valeur: d.src ? d : null, change: v => { Object.assign(d, v || { src: null, poster: null }); changer(); } }),
      h('small', { text: 'MP4, MOV ou WebM. Ce que les écrans ne liraient pas (HEVC, 4K, 60 images par seconde, débit trop fort…) est converti à l’import, dans ce navigateur : Chrome ou Edge à jour conseillés. 60 s au plus conseillé.' })),
    h('label', { class: 'coche' }, h('input', { type: 'checkbox', checked: !!d.son, onchange: e => { d.son = e.target.checked; changer(false); } }), 'Diffuser le son de la vidéo'));
  }
  if (ed.type !== 'video') {
    champs.push(champ('Durée d’affichage (secondes)', h('input', { id: 'f-duree', type: 'number', min: 3, max: 600, value: ed.duree || '', placeholder: String(R.DUREES[ed.type]),
      oninput: e => { ed.duree = e.target.value ? Number(e.target.value) : null; changer(); } }), 'Vide : ' + R.DUREES[ed.type] + ' s' + (ed.type === 'agenda' ? ' par page' : '') + '.'));
  }

  /* actions */
  const enregistrer = h('button', { type: 'button', class: 'btn btn-noir principal', disabled: !!ed.id, onclick: () => sauver() }, ed.id ? 'Enregistrer' : 'Créer le contenu');
  async function sauver(apres) {
    if ((ed.type === 'image' || ed.type === 'video') && !d.src) { annoncer('Importez d’abord le fichier.', true); return; }
    if (ed.type === 'soiree' && !d.nom.trim()) { annoncer('Indiquez le nom du concert.', true); $('#f-nom').focus(); return; }
    if (ed.type === 'agenda' && d.dates.some(x => !x.date)) { annoncer('Chaque ligne de l’agenda doit avoir une date.', true); return; }
    if (ed.type === 'lineup' && !d.passages.length) { annoncer('Ajoutez au moins un passage au line-up.', true); return; }
    if (ed.type === 'lineup' && d.passages.some(x => !x.heure)) { annoncer('Chaque passage du line-up doit avoir une heure.', true); return; }
    if (ed.type === 'serie' && !d.dates.length) { annoncer('Ajoutez au moins une date à la série.', true); return; }
    if (ed.type === 'serie' && d.dates.some(x => !x.date)) { annoncer('Chaque date de la série doit avoir un jour.', true); return; }
    enregistrer.disabled = true;
    const corps = { type: ed.type, titre: ed.titre || titreAuto(ed), donnees: d, duree: ed.duree, statut: apres === 'archiver' ? 'archive' : apres === 'restaurer' ? 'actif' : ed.statut };
    // Version lue à l'ouverture : le serveur refuse (409) si quelqu'un a enregistré entre-temps.
    if (ed.id && ed.modifie_le) corps.modifie_le = ed.modifie_le;
    try {
      const r = await ecrire(() => ed.id ? api('PUT', '/api/admin/contenus/' + ed.id, corps) : api('POST', '/api/admin/contenus', corps),
        apres === 'archiver' ? 'Contenu archivé : il ne s’affiche plus sur les écrans.' : apres === 'restaurer' ? 'Contenu restauré.' : ed.id ? 'Modifications enregistrées. Les écrans les afficheront d’ici une minute.' : 'Contenu créé. Programmez-le maintenant sur les écrans.');
      ed.sale = false;
      if (!ed.id) { ouvrirProgrammation = r.contenu.id; location.hash = '#contenu/' + r.contenu.id; }
      else vueEditeur(ed.id);
    } catch (e) {
      enregistrer.disabled = false;
      if (e.status === 409) {
        const ok = await demander('Contenu modifié entre-temps', 'Quelqu’un (ou un autre onglet) a enregistré ce contenu après que vous l’avez ouvert. Recharger la dernière version ? Vos modifications ici seront perdues.', 'Recharger la dernière version', true);
        if (ok && surVue('contenu')) {
          try { await recharger(); } catch { /* hors ligne : on réessaiera */ }
          ed.sale = false; vueEditeur(ed.id);
        }
      }
    }
  }
  const actions = h('div', { class: 'actions' }, enregistrer,
    ed.id && h('button', { type: 'button', class: 'btn', onclick: async () => {
      // La copie part de la version enregistrée : on ne laisse pas filer des modifications en cours.
      if (ed.sale) { annoncer('Enregistrez d’abord vos modifications, puis dupliquez.', true); return; }
      let r;
      try { r = await ecrire(() => api('POST', '/api/admin/contenus/' + ed.id + '/dupliquer', {}), 'Copie créée : modifiez-la puis programmez-la.'); } catch { return; }
      location.hash = '#contenu/' + r.contenu.id;
    } }, 'Dupliquer'),
    ed.id && h('button', { type: 'button', class: 'btn', onclick: () => sauver(ed.statut === 'archive' ? 'restaurer' : 'archiver') }, ed.statut === 'archive' ? 'Restaurer' : 'Archiver'),
    h('span', { class: 'sep' }),
    ed.id && h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
      const n = diffsDe(ed.id).length;
      if (!(await demander('Supprimer ce contenu ?', '« ' + ed.titre + ' » sera supprimé' + (n ? ' avec ' + plur(n, 'programmation') : '') + '. Cette action est définitive.', 'Supprimer', true))) return;
      try { await ecrire(() => api('DELETE', '/api/admin/contenus/' + ed.id), 'Contenu supprimé.'); } catch { return; }
      ed.sale = false; location.hash = '#contenus';
    } }, 'Supprimer'));

  /* programmation de ce contenu */
  const prog = ed.id ? h('section', { class: 'panneau bleu' },
    h('div', { class: 'panneau-t' }, h('h2', { text: 'Programmation sur les écrans' }),
      h('button', { type: 'button', class: 'btn btn-violet', onclick: () => dialogueDiffusion({ contenu: ed.id }) }, '+ Programmer')),
    (() => {
      const l = diffsDe(ed.id).sort((a, b) => a.debut < b.debut ? -1 : 1);
      if (!l.length) return h('p', { class: 'aide', text: 'Pas encore programmé : ce contenu ne s’affiche sur aucun écran.' });
      return h('ul', { class: 'diffs' }, l.map(x => {
        const li = h('li', { class: x.fin < auj() ? 'finie' : null },
          h('span', { class: 'resume' }, h('b', { text: nomsFlux(x.flux) }), x.prioritaire ? h('span', { class: 'puce prio', text: 'Prioritaire', style: { marginLeft: '8px' } }) : null,
            h('small', { text: resumeJours(x) + ' · ' + resumeHoraires(x) + (x.fin < auj() ? ' · terminée' : '') })),
          h('span', { class: 'fl' },
            h('button', { type: 'button', class: 'btn pt', onclick: () => dialogueDiffusion({ diffusion: x }) }, 'Modifier'),
            h('button', { type: 'button', class: 'btn pt btn-danger', onclick: async () => {
              if (!(await demander('Retirer cette programmation ?', '« ' + ed.titre + ' » ne s’affichera plus sur ' + nomsFlux(x.flux) + ' (' + resumeJours(x) + ').', 'Retirer', true))) return;
              try { await ecrire(() => api('DELETE', '/api/admin/diffusions/' + x.id), 'Programmation retirée.'); } catch { return; }
              li.remove(); naviguerSansPerte();
            } }, 'Retirer')));
        return li;
      }));
    })()) : null;

  // Téléphone : barre collante en bas (aperçu, enregistrer) ; le bouton du haut est masqué, celui-ci le reflète.
  const enregistrerBas = h('button', { type: 'button', class: 'btn btn-noir', onclick: () => enregistrer.click() });
  const refleter = () => { enregistrerBas.disabled = enregistrer.disabled; enregistrerBas.textContent = enregistrer.textContent; };
  new MutationObserver(refleter).observe(enregistrer, { attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true, characterData: true });
  refleter();
  const colle = h('div', { class: 'colle ed-apercu' }, h('p', { class: 'lbl', text: 'Aperçu à l’écran' }), ap.noeud, pager, infoApercu);
  afficher(
    h('div', { class: 'tete' },
      h('div', null, h('p', { class: 'surtitre' }, h('a', { href: '#contenus', text: '← Contenus' }), ' · ', TYPES[ed.type], ed.statut === 'archive' ? ' · archivé' : ''),
        h('h1', { class: 'titre', text: ed.id ? ed.titre : 'Nouveau contenu : ' + TYPES[ed.type].toLowerCase() })),
      actions),
    // contenu, aperçu, programmation : deux colonnes sur grand écran (aperçu à droite), à la suite sur téléphone
    h('div', { class: 'editeur' },
      h('section', { class: 'panneau ed-contenu' }, h('div', { class: 'panneau-t' }, h('h2', { text: 'Contenu' })),
        champ('Nom dans le back-office', champTitre, 'Rempli automatiquement ; modifiable.'), champs),
      colle,
      prog && Object.assign(prog, { className: prog.className + ' ed-prog' })),
    h('div', { class: 'barre-ed' },
      h('button', { type: 'button', class: 'btn', onclick: () => colle.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Aperçu'),
      enregistrerBas));
  majApercu();
  if (ouvrirProgrammation && ouvrirProgrammation === ed.id) { ouvrirProgrammation = null; dialogueDiffusion({ contenu: ed.id }); }
}
let ouvrirProgrammation = null;

/* ================= fenêtre : programmer un contenu ================= */
function dialogueDiffusion({ diffusion, contenu, jours, jour }) {
  const x = diffusion ? structuredClone(diffusion) : {
    id: null, contenu: contenu || '', flux: E.flux.filter(f => f.code !== 'reserve').map(f => f.code),
    debut: jours ? jours[0] : auj(), fin: jours ? jours[jours.length - 1] : R.ajouterJours(auj(), 6),
    jours: jours && !contigus(jours) ? jours.slice() : null, semaine: null, plages: null, prioritaire: 0
  };
  if (!diffusion && contenu) {
    const c = E.contenuParId.get(contenu);
    if (c && c.type === 'soiree' && c.donnees.date && c.donnees.date >= auj() && !jours) { x.debut = auj(); x.fin = c.donnees.date; }
    if (c && c.type === 'lineup' && c.donnees.date && c.donnees.date >= auj() && !jours) { x.debut = x.fin = c.donnees.date; }
  }
  let mode = x.jours ? 'jours' : 'periode', horaires = x.plages ? 'plages' : 'journee';
  if (!x.plages) x.plages = [['19:00', '23:30']];
  if (!x.jours) x.jours = [];
  const miniCal = { mois: null };
  const unJour = !!(diffusion && jour && (diffusion.jours && diffusion.jours.length ? diffusion.jours.length > 1 : diffusion.debut !== diffusion.fin));
  const resume = h('p', { class: 'resume-diff' });
  const corps = h('div', { style: { display: 'grid', gap: '18px' } });
  const majResume = () => {
    const c = E.contenuParId.get(x.contenu);
    const d = finale();
    resume.textContent = (c ? '« ' + c.titre + ' »' : 'Aucun contenu') + ' → ' + (d.flux.length ? resumeDiffusion(d) : 'aucun écran');
  };
  function finale() {
    const d = { contenu: x.contenu, flux: x.flux, semaine: x.semaine && x.semaine.length ? x.semaine : null, prioritaire: x.prioritaire ? 1 : 0, plages: horaires === 'plages' ? x.plages : null };
    if (mode === 'jours') { const j = x.jours.slice().sort(); d.jours = j; d.debut = j[0] || auj(); d.fin = j[j.length - 1] || auj(); }
    else { d.jours = null; d.debut = x.debut; d.fin = x.fin; }
    return d;
  }
  const rendre = () => {
    const c = E.contenuParId.get(x.contenu);
    remplacer(corps, 
      !diffusion && contenu ? null : h('div', { class: 'champ' }, h('label', { for: 'd-contenu', text: 'Contenu' }),
        h('select', { id: 'd-contenu', onchange: e => { x.contenu = e.target.value; rendre(); } },
          h('option', { value: '', text: 'Choisir un contenu…' }),
          Object.entries(TYPES).map(([k, t]) => h('optgroup', { label: t }, E.contenus.filter(z => z.type === k && z.statut === 'actif').map(z => h('option', { value: z.id, text: z.titre, selected: z.id === x.contenu })))))),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Écrans' }),
        h('div', { class: 'ecrans-choix' },
          h('label', { class: 'coche tous' }, h('input', { type: 'checkbox', checked: x.flux.length === E.flux.length, onchange: e => { x.flux = e.target.checked ? E.flux.map(f => f.code) : []; rendre(); } }), 'Tous les écrans'),
          E.flux.map(f => h('label', { class: 'coche' }, h('input', { type: 'checkbox', checked: x.flux.includes(f.code), onchange: e => { x.flux = e.target.checked ? [...x.flux, f.code] : x.flux.filter(k => k !== f.code); rendre(); } }), f.nom)))),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Jours' }),
        h('div', { class: 'seg', role: 'group' },
          h('button', { type: 'button', 'aria-pressed': String(mode === 'periode'), onclick: () => { mode = 'periode'; rendre(); } }, 'Période'),
          h('button', { type: 'button', 'aria-pressed': String(mode === 'jours'), onclick: () => { mode = 'jours'; if (!x.jours.length) x.jours = [x.debut]; rendre(); } }, 'Jours choisis')),
        mode === 'periode' ? [
          h('div', { class: 'grille2' },
            h('div', { class: 'champ' }, h('label', { for: 'd-debut', text: 'Du' }), h('input', { id: 'd-debut', type: 'date', value: x.debut, onchange: e => { x.debut = e.target.value; if (x.fin < x.debut) x.fin = x.debut; rendre(); } })),
            h('div', { class: 'champ' }, h('label', { for: 'd-fin', text: 'Au (inclus)' }), h('input', { id: 'd-fin', type: 'date', value: x.fin, min: x.debut, onchange: e => { x.fin = e.target.value; rendre(); } }))),
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = x.fin = auj(); rendre(); } }, 'Aujourd’hui seulement'),
            h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = auj(); x.fin = R.ajouterJours(auj(), 6); rendre(); } }, '7 jours'),
            h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = auj(); x.fin = R.ajouterJours(auj(), 29); rendre(); } }, '30 jours'),
            c && c.type === 'soiree' && c.donnees.date && h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = auj(); x.fin = c.donnees.date; rendre(); } }, 'Jusqu’au concert (' + dateCourte(c.donnees.date) + ')'),
            c && c.type === 'lineup' && c.donnees.date && h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = x.fin = c.donnees.date; rendre(); } }, 'Le jour J (' + dateCourte(c.donnees.date) + ')'))
        ] : miniCalendrier(x.jours, () => rendre(), miniCal),
        h('small', { text: 'Une journée va de 6 h à 6 h le lendemain : la soirée continue après minuit.' })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Seulement certains jours de la semaine (facultatif)' }),
        h('div', { class: 'semaine', role: 'group' }, SEMAINE.map(([n, l]) => h('button', { type: 'button', title: JOURS[n % 7], 'aria-pressed': String(!!(x.semaine && x.semaine.includes(n))),
          onclick: () => { x.semaine = x.semaine && x.semaine.includes(n) ? x.semaine.filter(k => k !== n) : [...(x.semaine || []), n].sort(); rendre(); } }, l))),
        h('small', { text: 'Aucun jour coché : tous les jours de la période.' })),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Horaires' }),
        h('div', { class: 'seg', role: 'group' },
          h('button', { type: 'button', 'aria-pressed': String(horaires === 'journee'), onclick: () => { horaires = 'journee'; rendre(); } }, 'Toute la journée'),
          h('button', { type: 'button', 'aria-pressed': String(horaires === 'plages'), onclick: () => { horaires = 'plages'; rendre(); } }, 'Plages horaires')),
        horaires === 'plages' && [
          x.plages.map((p, i) => h('div', { class: 'plage' },
            h('input', { type: 'time', value: p[0], 'aria-label': 'Début', onchange: e => { p[0] = e.target.value; majResume(); } }), '→',
            h('input', { type: 'time', value: p[1], 'aria-label': 'Fin', onchange: e => { p[1] = e.target.value; majResume(); } }),
            x.plages.length > 1 && h('button', { type: 'button', class: 'btn carre btn-danger', 'aria-label': 'Retirer la plage', onclick: () => { x.plages.splice(i, 1); rendre(); } }, '×'))),
          h('div', null, h('button', { type: 'button', class: 'btn pt', onclick: () => { x.plages.push(['12:00', '14:00']); rendre(); } }, '+ Ajouter une plage')),
          h('small', { text: 'Une plage peut passer minuit (20:00 → 02:00) : elle appartient au soir où elle commence.' })]),
      h('label', { class: 'coche' }, h('input', { type: 'checkbox', checked: !!x.prioritaire, onchange: e => { x.prioritaire = e.target.checked ? 1 : 0; majResume(); } }),
        'Prioritaire : remplace toute la boucle des écrans choisis pendant ces horaires'),
      resume);
    majResume();
  };
  const sauver = async () => {
    const d = finale();
    if (!d.contenu) { annoncer('Choisissez un contenu.', true); return; }
    if (!d.flux.length) { annoncer('Choisissez au moins un écran.', true); return; }
    if (mode === 'jours' && !d.jours.length) { annoncer('Choisissez au moins un jour.', true); return; }
    if (d.plages && d.plages.some(p => !p[0] || !p[1])) { annoncer('Complétez les plages horaires.', true); return; }
    try {
      await ecrire(() => x.id ? api('PUT', '/api/admin/diffusions/' + x.id, d) : api('POST', '/api/admin/diffusions', d), 'Programmation enregistrée. Les écrans la prendront en compte d’ici une minute.');
      fen.close();
      if (jours) cal.sel = [];
      naviguerSansPerte();
    } catch { /* message déjà affiché */ }
  };
  const fen = fenetre({
    surtitre: x.id ? 'Modifier la programmation' : 'Programmer',
    titre: x.contenu && E.contenuParId.get(x.contenu) ? E.contenuParId.get(x.contenu).titre : 'Programmer un contenu',
    corps,
    pied: [
      // Depuis le calendrier : retirer seulement le jour cliqué (la période est coupée en deux, les autres jours restent).
      x.id && unJour && h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        const titre = (E.contenuParId.get(x.contenu) || {}).titre || 'Ce contenu';
        if (!(await demander('Retirer le ' + dateLongue(jour) + ' ?', '« ' + titre + ' » ne s’affichera pas ce jour-là' + (x.flux.length > 1 ? ', sur aucun de ses écrans (' + nomsFlux(x.flux) + ')' : '') + '. Les autres jours de la programmation ne changent pas.', 'Retirer ce jour', true))) return;
        try { await ecrire(() => api('POST', '/api/admin/diffusions/' + x.id + '/retirer-jour', { jour }), 'Jour retiré de la programmation.'); } catch { return; }
        fen.close(); naviguerSansPerte();
      } }, 'Retirer le ' + dateCourte(jour)),
      x.id && h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        if (!(await demander(unJour ? 'Retirer toute la programmation ?' : 'Retirer cette programmation ?', 'Le contenu ne s’affichera plus sur ces écrans pour ' + (unJour ? 'toutes ces dates.' : 'ces dates.'), unJour ? 'Tout retirer' : 'Retirer', true))) return;
        try { await ecrire(() => api('DELETE', '/api/admin/diffusions/' + x.id), 'Programmation retirée.'); } catch { return; }
        fen.close(); naviguerSansPerte();
      } }, unJour ? 'Tout retirer' : 'Retirer'),
      h('span', { class: 'sep' }),
      h('button', { type: 'button', class: 'btn', onclick: () => fen.close() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn btn-noir', onclick: sauver }, 'Enregistrer')]
  });
  rendre();
}
function contigus(j) { for (let i = 1; i < j.length; i++) if (R.ajouterJours(j[i - 1], 1) !== j[i]) return false; return true; }
// Réaffiche la vue en cours après un enregistrement, en gardant l'éditeur s'il a des modifications en cours.
function naviguerSansPerte() {
  if (edition && edition.id && edition.sale) return;
  if (edition && edition.id) { vueEditeur(edition.id); return; }
  naviguer();
}
// `etat.mois` appartient à la fenêtre appelante : le mois affiché survit aux re-rendus après chaque clic.
function miniCalendrier(selection, change, etat) {
  if (!etat.mois) etat.mois = (selection[0] || auj()).slice(0, 7);
  const boite = h('div', { class: 'mini-cal' });
  const rendre = () => {
    const mois = etat.mois;
    const [a, m] = mois.split('-').map(Number), premier = mois + '-01';
    const decal = (parts(premier).j + 6) % 7, nb = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const cases = [];
    for (let i = 0; i < decal; i++) cases.push(h('button', { type: 'button', disabled: true }));
    for (let n = 1; n <= nb; n++) {
      const d = mois + '-' + String(n).padStart(2, '0');
      cases.push(h('button', { type: 'button', class: (selection.includes(d) ? 'on ' : '') + (d === auj() ? 'auj' : ''), text: String(n), 'aria-pressed': String(selection.includes(d)),
        onclick: () => { const i = selection.indexOf(d); if (i >= 0) selection.splice(i, 1); else selection.push(d); selection.sort(); change(); } }));
    }
    remplacer(boite, 
      h('div', { class: 'mini-cal-t' },
        h('button', { type: 'button', class: 'btn carre', 'aria-label': 'Mois précédent', onclick: () => { etat.mois = decalerMois(mois, -1); rendre(); } }, '‹'),
        h('span', { text: MOIS[m - 1] + ' ' + a + ' · ' + plur(selection.length, 'jour choisi', 'jours choisis') }),
        h('button', { type: 'button', class: 'btn carre', 'aria-label': 'Mois suivant', onclick: () => { etat.mois = decalerMois(mois, 1); rendre(); } }, '›')),
      h('div', { class: 'mini-cal-g' }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(l => h('span', { text: l })), cases));
  };
  rendre();
  return boite;
}
function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number), d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

/* ================= vue : calendrier ================= */
const cal = { mois: null, flux: 'tous', sel: [], jour: null, plusieurs: false };
// Téléphone : la grille du mois ne montre que des repères ; la programmation du jour touché s'affiche dessous.
const TELEPHONE = matchMedia('(max-width: 640px)');
TELEPHONE.addEventListener('change', () => { if (surVue('calendrier') && !document.querySelector('dialog[open]')) vueCalendrier(); });
let calGlisse = null;
document.addEventListener('pointerup', () => { calGlisse = null; });
function vueCalendrier(arg) {
  if (arg && /^\d{4}-\d{2}$/.test(arg)) cal.mois = arg;
  if (!cal.mois) cal.mois = auj().slice(0, 7);
  const [a, m] = cal.mois.split('-').map(Number);
  const premier = cal.mois + '-01', t = auj();
  const debut = R.ajouterJours(premier, -((parts(premier).j + 6) % 7));
  const grille = h('div', { class: 'cal', role: 'grid' }, ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(j => h('div', { class: 'cal-j', title: j }, h('span', { class: 'long', text: j }), h('span', { class: 'court', text: j.slice(0, 3) }))));
  const diffs = E.diffusions.filter(d => (cal.flux === 'tous' || d.flux.includes(cal.flux)) && (E.contenuParId.get(d.contenu) || {}).statut === 'actif');
  const soirees = E.contenus.filter(c => c.type === 'soiree' && c.statut === 'actif' && c.donnees.date);
  const tel = TELEPHONE.matches;
  if (tel && (!cal.jour || cal.jour.slice(0, 7) !== cal.mois)) cal.jour = t.slice(0, 7) === cal.mois ? t : premier;
  const jourBoite = h('section', { class: 'cal-jour' });
  const barre = h('div', { class: 'selection', hidden: !cal.sel.length });
  const majSel = () => {
    grille.querySelectorAll('.cal-c').forEach(c => c.classList.toggle('sel', cal.sel.includes(c.dataset.date)));
    barre.hidden = !cal.sel.length;
    if (cal.sel.length) {
      remplacer(barre, h('span', { text: plur(cal.sel.length, 'jour sélectionné', 'jours sélectionnés') + ' : ' + (contigus(cal.sel) && cal.sel.length > 2 ? 'du ' + dateCourte(cal.sel[0]) + ' au ' + dateCourte(cal.sel[cal.sel.length - 1]) : enListe(cal.sel.map(dateCourte))) }),
        h('span', { class: 'actions' },
          h('button', { type: 'button', class: 'btn pt', onclick: () => { cal.sel = []; majSel(); } }, 'Effacer'),
          h('button', { type: 'button', class: 'btn btn-violet', onclick: () => dialogueDiffusion({ jours: cal.sel.slice() }) }, 'Programmer un contenu sur ces jours')));
    }
  };
  let nbSemaines = 0;
  const jours = new Map();
  for (let d = debut; ; d = R.ajouterJours(d, 1)) {
    const p = parts(d);
    if (p.j === 1 && d > premier && (p.m + 1 !== m || p.a !== a)) break;
    if (p.j === 1) nbSemaines++;
    const items = diffs.filter(x => R.couvreJour(x, d)).map(x => ({ x, c: E.contenuParId.get(x.contenu) }))
      .sort((u, v) => (v.x.prioritaire - u.x.prioritaire) || ((u.x.plages ? u.x.plages[0][0] : '') < (v.x.plages ? v.x.plages[0][0] : '') ? -1 : 1));
    const visibles = items.filter(({ x, c }) => !((c.type === 'soiree' || c.type === 'lineup') && c.donnees.date && c.donnees.date < d) && !((c.type === 'agenda' || c.type === 'serie') && !(c.donnees.dates || []).some(z => z.date >= d)));
    const concerts = soirees.filter(c => c.donnees.date === d);
    jours.set(d, { visibles, concerts });
    const cellule = h('div', { class: 'cal-c' + (p.m + 1 !== m ? ' hors' : '') + (d === t ? ' auj' : '') + (d < t ? ' passe' : '') + (tel && d === cal.jour && !cal.plusieurs ? ' jour' : ''), 'data-date': d, role: 'gridcell' },
      h('span', { class: 'cal-n', text: p.n === 1 && !tel ? '1er ' + MC[p.m] : String(p.n) }),
      // téléphone : un repère par programmation (couleur du type), une étoile les jours de concert
      tel ? h('span', { class: 'cal-pts' }, concerts.length ? h('span', { class: 'cal-etoile', text: '★' }) : null,
        visibles.slice(0, 6).map(({ x, c }) => h('i', { class: 'cal-pt t-' + c.type + (x.prioritaire ? ' prio-pt' : '') })),
        visibles.length > 6 && h('span', { class: 'cal-plus', text: '+' + (visibles.length - 6) })) : null,
      !tel && concerts.map(c => h('span', { class: 'cal-plus', text: '★ ' + (c.donnees.nom || c.titre) })),
      !tel && visibles.slice(0, 5).map(({ x, c }) => h('button', { type: 'button', class: 'cal-e t-' + c.type + (x.prioritaire ? ' prio' : ''), title: c.titre + ' — ' + resumeDiffusion(x),
        text: (x.plages ? x.plages[0][0] + ' ' : '') + c.titre, onclick: e => { e.stopPropagation(); cal.sel = []; majSel(); dialogueDiffusion({ diffusion: x, jour: d }); } })),
      !tel && visibles.length > 5 && h('span', { class: 'cal-plus', text: '+ ' + (visibles.length - 5) + ' autres' }));
    cellule.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (tel && !cal.plusieurs) { cal.jour = d; grille.querySelectorAll('.cal-c').forEach(c => c.classList.toggle('jour', c.dataset.date === d)); majJour(); return; }
      // Ctrl / ⌘ / Maj + clic, ou toucher sur tablette : ajoute ou retire un jour
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.pointerType === 'touch') { const i = cal.sel.indexOf(d); if (i >= 0) cal.sel.splice(i, 1); else cal.sel.push(d); cal.sel.sort(); majSel(); return; }
      calGlisse = d; cal.sel = [d]; majSel();
    });
    cellule.addEventListener('pointerenter', () => {
      if (!calGlisse) return;
      const [u, v] = calGlisse < d ? [calGlisse, d] : [d, calGlisse];
      cal.sel = [];
      for (let k = u; k <= v; k = R.ajouterJours(k, 1)) cal.sel.push(k);
      majSel();
    });
    grille.append(cellule);
  }
  // programmation du jour choisi (téléphone)
  function majJour() {
    if (!tel) return;
    if (cal.plusieurs) {
      remplacer(jourBoite, h('div', { class: 'cal-jour-t' }, h('h2', { text: 'Plusieurs jours' }),
        h('button', { type: 'button', class: 'btn pt', onclick: () => { cal.plusieurs = false; cal.sel = []; vueCalendrier(); } }, 'Terminer')),
        h('p', { class: 'aide', text: 'Touchez les jours à programmer, puis « Programmer » dans la barre du bas.' }));
      return;
    }
    const d = cal.jour, x = jours.get(d) || { visibles: [], concerts: [] }, p = parts(d);
    remplacer(jourBoite,
      h('div', { class: 'cal-jour-t' }, h('h2', { text: JOURS[p.j] + ' ' + (p.n === 1 ? '1er' : p.n) + ' ' + MOIS[p.m] }),
        h('button', { type: 'button', class: 'btn btn-violet', onclick: () => dialogueDiffusion({ jours: [d] }) }, '+ Programmer')),
      x.concerts.map(c => h('a', { class: 'cal-jour-concert', href: '#contenu/' + c.id }, '★ Concert : ' + (c.donnees.nom || c.titre))),
      x.visibles.length ? h('ul', { class: 'cal-jour-l' }, x.visibles.map(({ x: dif, c }) => h('li', null, h('button', { type: 'button', onclick: () => dialogueDiffusion({ diffusion: dif, jour: d }) },
        h('span', { class: 'puce t-' + c.type, text: TYPES[c.type] }),
        h('span', { class: 'cal-jour-n' }, h('b', { text: c.titre }), h('small', { text: nomsFlux(dif.flux) + ' · ' + resumeHoraires(dif) })),
        dif.prioritaire ? h('span', { class: 'puce prio', text: 'Prioritaire' }) : null, h('span', { class: 'cal-jour-f', 'aria-hidden': 'true', text: '›' })))))
        : h('p', { class: 'aide', text: 'Rien de programmé ce jour' + (cal.flux === 'tous' ? '' : ' sur cet écran') + '.' }),
      h('button', { type: 'button', class: 'btn pt cal-plusieurs', onclick: () => { cal.plusieurs = true; cal.sel = []; vueCalendrier(); } }, 'Programmer sur plusieurs jours…'));
  }
  const segFlux = h('div', { class: 'seg', role: 'group', 'aria-label': 'Écran' },
    [['tous', 'Tous les écrans'], ...E.flux.map(f => [f.code, f.nom])].map(([k, n]) => h('button', { type: 'button', 'aria-pressed': String(cal.flux === k), onclick: () => { cal.flux = k; vueCalendrier(); } }, n)));
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: 'Calendrier' }), h('h1', { class: 'titre', text: MOIS[m - 1] + ' ' + a })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn carre', href: '#calendrier/' + decalerMois(cal.mois, -1), 'aria-label': 'Mois précédent' }, '‹'),
        h('a', { class: 'btn', href: '#calendrier/' + auj().slice(0, 7) }, 'Aujourd’hui'),
        h('a', { class: 'btn carre', href: '#calendrier/' + decalerMois(cal.mois, 1), 'aria-label': 'Mois suivant' }, '›'))),
    h('div', { class: 'cal-barre' }, segFlux),
    h('p', { class: 'aide', text: tel ? 'Touchez un jour pour voir sa programmation. ★ : date d’une soirée enregistrée.' : 'Glissez sur plusieurs jours (ou Ctrl / ⌘ + clic pour des jours séparés) pour programmer un contenu en série. Cliquez sur une programmation pour la modifier. ★ : date d’une soirée enregistrée.' }),
    h('div', { class: 'legende' }, Object.entries(TYPES).map(([k, n]) => h('span', { class: 'puce t-' + k, text: n })), h('span', { class: 'puce prio', text: 'Prioritaire' })),
    Object.assign(grille, { className: 'cal' + (tel ? ' cal-tel' + (cal.plusieurs ? ' cal-multi' : '') : '') }), tel ? jourBoite : null, barre);
  majSel(); majJour();
}

/* ================= vue : flux et boucles ================= */
const simu = { date: null, heure: null };
function vueFlux() {
  if (!simu.date) { const x = R.heureParis(maintenant()); simu.date = x.date; simu.heure = String(Math.floor(x.minutes / 60)).padStart(2, '0') + ':' + String(x.minutes % 60).padStart(2, '0'); }
  const ms = parisVersMs(simu.date, simu.heure);
  const cartes = h('div', { class: 'ecrans' }, E.flux.map(f => carteFlux(f, ms)));
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: 'Un flux par écran' }), h('h1', { class: 'titre', text: 'Flux et boucles' })),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => identifier('tous') }, 'Identifier tous les écrans'))),
    h('div', { class: 'simu' },
      h('div', { class: 'champ' }, h('label', { for: 's-date', text: 'Voir les boucles le' }), h('input', { id: 's-date', type: 'date', value: simu.date, onchange: e => { simu.date = e.target.value; vueFlux(); } })),
      h('div', { class: 'champ' }, h('label', { for: 's-heure', text: 'à' }), h('input', { id: 's-heure', type: 'time', value: simu.heure, onchange: e => { simu.heure = e.target.value; vueFlux(); } })),
      h('button', { type: 'button', class: 'btn', onclick: () => { simu.date = null; vueFlux(); } }, 'Maintenant'),
      h('p', { class: 'aide', text: 'Glissez les contenus (ou utilisez ↑ ↓) pour changer l’ordre de la boucle. L’ordre vaut aussi pour les autres écrans qui diffusent ces contenus.' })),
    cartes);
}
function carteFlux(f, ms) {
  const adresse = location.origin + '/?flux=' + f.code;
  const calc = R.etapes(progFlux(f.code), ms);
  const p = progFlux(f.code);
  // contenus de la boucle (une ligne par contenu, même pour un agenda de plusieurs pages)
  const vus = new Set(), ligne = [];
  for (const et of calc.etapes) {
    if (!et.contenu || et.defaut || vus.has(et.contenu.id)) continue;
    vus.add(et.contenu.id);
    ligne.push({ c: et.contenu, pages: et.pages || 1, duree: et.duree, diffs: p.diffusions.filter(d => d.contenu === et.contenu.id) });
  }
  const liste = h('ol', { class: 'boucle-ed' });
  const deplacer = async (de, vers) => {
    if (vers < 0 || vers >= ligne.length || de === vers) return;
    const [x] = ligne.splice(de, 1); ligne.splice(vers, 0, x);
    const ordre = [];
    for (const l of ligne) for (const d of l.diffs) if (!ordre.includes(d.id)) ordre.push(d.id);
    try { await ecrire(() => api('POST', '/api/admin/ordre', { ordre, flux: f.code }), 'Ordre enregistré.'); } catch { /* message déjà affiché */ }
    if (surVue('flux')) vueFlux();
  };
  let glisse = null;
  ligne.forEach((l, i) => {
    const li = h('li', { draggable: 'true' },
      h('span', { class: 'poignee', text: i + 1 }),
      h('span', { class: 'puce t-' + l.c.type, text: TYPES[l.c.type] }),
      h('a', { class: 'nom', href: '#contenu/' + l.c.id, text: l.c.titre + (l.pages > 1 ? ' (' + l.pages + ' pages)' : '') }),
      h('span', { class: 'fl' },
        h('button', { type: 'button', class: 'btn carre pt', 'aria-label': 'Monter', disabled: i === 0, onclick: () => deplacer(i, i - 1) }, '↑'),
        h('button', { type: 'button', class: 'btn carre pt', 'aria-label': 'Descendre', disabled: i === ligne.length - 1, onclick: () => deplacer(i, i + 1) }, '↓'),
        h('button', { type: 'button', class: 'btn carre pt btn-danger', 'aria-label': 'Retirer de cet écran', title: 'Retirer de cet écran', onclick: () => retirerDeLEcran(l.c, f) }, '×')));
    li.addEventListener('dragstart', e => { glisse = i; li.classList.add('glisse'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    li.addEventListener('dragend', () => { li.classList.remove('glisse'); liste.querySelectorAll('.cible').forEach(n => n.classList.remove('cible')); });
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('cible'); });
    li.addEventListener('dragleave', () => li.classList.remove('cible'));
    li.addEventListener('drop', e => { e.preventDefault(); li.classList.remove('cible'); if (glisse !== null) deplacer(glisse, i); });
    liste.append(li);
  });
  if (!ligne.length) liste.append(h('li', null, h('span'), h('span'), h('span', { class: 'aide', text: calc.etapes[0] && calc.etapes[0].defaut && calc.etapes[0].contenu ? 'Rien de programmé : contenu par défaut « ' + calc.etapes[0].contenu.titre + ' ».' : 'Rien de programmé : logo 6MIC sur fond noir.' })));
  const nom = h('input', { type: 'text', value: f.nom, maxLength: 40, 'aria-label': 'Nom de l’écran' });
  // Un contenu par défaut archivé reste listé (pour ne pas le perdre en silence) mais ne s'affiche plus.
  const defaut = h('select', { 'aria-label': 'Contenu par défaut' }, h('option', { value: '', text: 'Logo 6MIC sur fond noir' }),
    E.contenus.filter(c => c.statut === 'actif' || c.id === f.contenu_defaut).map(c => h('option', { value: c.id, selected: c.id === f.contenu_defaut,
      text: TYPES[c.type] + ' : ' + c.titre + (c.statut === 'actif' ? '' : ' (archivé : logo affiché à la place)') })));
  const sauver = () => ecrire(() => api('PUT', '/api/admin/flux/' + f.code, { nom: nom.value, contenu_defaut: defaut.value || null }), 'Écran enregistré.')
    .then(() => { if (surVue('flux')) vueFlux(); }, () => {});
  nom.addEventListener('change', sauver);
  defaut.addEventListener('change', sauver);
  return h('article', { class: 'carte' },
    h('div', { class: 'carte-t' }, h('h2', { text: f.nom }), calc.prioritaire ? h('span', { class: 'puce prio', text: 'Prioritaire en cours' }) : etatEcran(f.code).puce),
    h('div', { class: 'carte-c' },
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Nom de l’écran' }), nom),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Adresse à saisir dans MagicINFO (ne change jamais)' }),
        h('div', { class: 'adresse' }, h('code', { text: adresse }),
          h('button', { type: 'button', class: 'btn pt', onclick: () => navigator.clipboard.writeText(adresse).then(() => annoncer('Adresse copiée.'), () => annoncer(adresse)) }, 'Copier'))),
      h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Quand rien n’est programmé' }), defaut),
      h('div', { class: 'lbl', text: 'Boucle le ' + dateMoy(simu.date) + ' à ' + simu.heure }), liste),
    h('div', { class: 'carte-p' },
      h('button', { type: 'button', class: 'btn pt', onclick: () => identifier(f.code) }, 'Identifier'),
      h('a', { class: 'btn pt', href: '/?flux=' + f.code + '&debug=1', target: '_blank', rel: 'noopener' }, 'Voir le flux ↗')));
}

// Retire un contenu de la boucle d'un écran (ses programmations à venir sur cet écran) ; les autres écrans ne changent pas.
async function retirerDeLEcran(c, f) {
  const autres = [...new Set(E.diffusions.filter(d => d.contenu === c.id && d.fin >= auj() && d.flux.includes(f.code)).flatMap(d => d.flux))].filter(k => k !== f.code);
  if (!(await demander('Retirer de l’écran ' + f.nom + ' ?', '« ' + c.titre + ' » ne passera plus sur ' + f.nom + '.' + (autres.length ? ' Il reste programmé sur ' + nomsFlux(autres) + '.' : ''), 'Retirer de ' + f.nom, true))) return;
  try { await ecrire(() => api('POST', '/api/admin/retirer-ecran', { contenu: c.id, flux: f.code }), '« ' + c.titre + ' » retiré de ' + f.nom + '.'); } catch { return; }
  if (surVue('flux')) vueFlux();
}

/* ================= vue : journal ================= */
/* ================= vue : réglages ================= */
// Couleurs du 6MIC et listes de choix (rôles du line-up, mentions, salles). Un brouillon est modifié, puis
// enregistré d'un coup ; les écrans le reçoivent avec la programmation (version suivante).
const ROLES_FIXES = ['ouverture', 'premiere', 'tete', 'dj', 'fermeture', 'autre'];
const nouvelleCle = (prefixe, l) => { let c; do { c = prefixe + '-' + Math.random().toString(36).slice(2, 8); } while (l.some(x => x.cle === c)); return c; };
function usagesReglages() {
  const roles = new Map(), mentions = new Map(), salles = new Map();
  const plus = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const c of E.contenus) {
    const d = c.donnees;
    if (c.type === 'lineup') { new Set((d.passages || []).map(p => p.role)).forEach(r => plus(roles, r)); if (d.lieu) plus(salles, d.lieu); }
    const ms = c.type === 'soiree' ? [d.mention] : c.type === 'agenda' || c.type === 'serie' ? (d.dates || []).map(x => x && x.mention) : [];
    new Set(ms.filter(Boolean)).forEach(m => plus(mentions, m));
  }
  return { roles, mentions, salles };
}
const ratio = x => x.toFixed(1).replace('.', ',') + ':1';
function vueReglages() {
  const base = E.reglages;
  const r = structuredClone({ couleurs: base.couleurs, roles: base.roles, mentions: base.mentions, salles: base.salles });
  const ed = edition = { id: null, sale: false };
  const usages = usagesReglages();
  const enregistrer = h('button', { type: 'button', class: 'btn btn-noir principal', disabled: true, onclick: () => sauver() }, 'Enregistrer');
  const annuler = h('button', { type: 'button', class: 'btn principal', disabled: true, onclick: () => { edition = null; vueReglages(); } }, 'Annuler les modifications');
  let minuterie = null;
  // barre d'enregistrement collante, visible dès la première modification (pages longues, téléphone)
  const pied = h('div', { class: 'reglages-pied', hidden: true }, h('span', { text: 'Modifications non enregistrées' }),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => annuler.click() }, 'Annuler'),
      h('button', { type: 'button', class: 'btn btn-noir', onclick: () => sauver() }, 'Enregistrer')));
  const changer = () => {
    ed.sale = true; enregistrer.disabled = false; annuler.disabled = false; pied.hidden = false;
    clearTimeout(minuterie); minuterie = setTimeout(majApercus, 200);
  };

  /* ---- couleurs ---- */
  const k = r.couleurs;
  const suit = { v: k.degrade[0] === k.primaire.valeur && k.degrade[2] === k.secondaire.valeur };
  const pickers = {};
  function champTeinte(lire, ecrire, titre) {
    const code = h('input', { type: 'text', class: 'code-teinte', value: lire(), maxLength: 7, spellcheck: false, 'aria-label': titre + ' (code)' });
    const pick = h('input', { type: 'color', value: lire(), 'aria-label': titre });
    pick.addEventListener('input', () => { ecrire(pick.value); code.value = pick.value; });
    code.addEventListener('input', () => { const v = code.value.trim().toLowerCase(); if (/^#[0-9a-f]{6}$/.test(v)) { ecrire(v); pick.value = v; } });
    return { pick, code, maj: () => { pick.value = lire(); code.value = lire(); } };
  }
  // le dégradé suit la primaire et la secondaire (milieu : leur mélange) tant que la case est cochée
  function suivre() {
    if (!suit.v) return;
    k.degrade[0] = k.primaire.valeur; k.degrade[2] = k.secondaire.valeur; k.degrade[1] = G.melanger(k.primaire.valeur, k.secondaire.valeur, 0.5);
    [0, 1, 2].forEach(i => pickers['d' + i].maj());
  }
  const couleur = (cle, titre) => {
    const t = champTeinte(() => k[cle].valeur, v => { k[cle].valeur = v; suivre(); majDegrade(); changer(); }, titre);
    const nom = h('input', { type: 'text', value: k[cle].nom, maxLength: 20, 'aria-label': 'Nom de la couleur ' + titre.toLowerCase(), placeholder: 'Nom affiché',
      oninput: e => { k[cle].nom = e.target.value; changer(); } });
    pickers[cle] = t;
    return h('div', { class: 'champ' }, h('span', { class: 'lbl', text: titre }), h('div', { class: 'perso' }, t.pick, t.code, nom));
  };
  const barre = h('div', { class: 'barre-degrade' });
  const etapesDegrade = ['Début', 'Milieu', 'Fin'].map((t, i) => {
    const x = champTeinte(() => k.degrade[i], v => { k.degrade[i] = v; majDegrade(); changer(); }, 'Dégradé, ' + t.toLowerCase());
    pickers['d' + i] = x;
    return h('div', { class: 'perso' }, h('span', { class: 'etape-d', text: t }), x.pick, x.code);
  });
  const coche = h('input', { type: 'checkbox', checked: suit.v, onchange: e => { suit.v = e.target.checked; suivre(); majDegrade(); changer(); } });
  const controles = h('ul', { class: 'controle' });
  function majDegrade() {
    barre.style.background = 'linear-gradient(90deg, ' + k.degrade[0] + ', ' + k.degrade[1] + ' 55%, ' + k.degrade[2] + ')';
    pickers.d0.pick.disabled = pickers.d0.code.disabled = pickers.d2.pick.disabled = pickers.d2.code.disabled = suit.v;
    // lisibilité : texte blanc sur les couleurs (badges, bandeaux), couleurs en texte sur le fond nuit des écrans
    const l = [], nuit = '#0b0a0d';
    const blanc = (c, ou) => { const x = G.contraste('#ffffff', c); l.push([x >= 3 ? 'v' : 'a', (x >= 3 ? 'Texte blanc lisible ' : 'Texte blanc peu lisible ') + ou + ' (' + ratio(x) + (x >= 3 ? ')' : ', 3:1 au moins conseillé)')]); };
    blanc(k.primaire.valeur, 'sur la primaire');
    blanc(k.secondaire.valeur, 'sur la secondaire');
    const bandeau = Math.min(...[G.melanger(k.degrade[0], '#000000', 0.14), k.degrade[1], k.degrade[2]].map(c => G.contraste('#ffffff', c)));
    l.push([bandeau >= 3 ? 'v' : 'a', (bandeau >= 3 ? 'Bandeaux en dégradé lisibles' : 'Bandeaux en dégradé peu lisibles en blanc') + ' (' + ratio(bandeau) + ')']);
    for (const [c, nom] of [[k.primaire.valeur, 'La primaire'], [k.secondaire.valeur, 'La secondaire']]) {
      const x = G.contraste(c, nuit);
      if (x < 3) l.push(['a', nom + ' se lit mal en texte sur le fond noir des écrans (' + ratio(x) + ')']);
    }
    remplacer(controles, l.map(([e, t]) => h('li', { class: e, text: t })));
  }
  const panneauCouleurs = h('section', { class: 'panneau' },
    h('div', { class: 'panneau-t' }, h('h2', { text: 'Couleurs du 6MIC' }),
      h('button', { type: 'button', class: 'btn pt', onclick: () => {
        Object.assign(r.couleurs, structuredClone(E.reglagesDefaut.couleurs));
        remplacerCouleurs();
      } }, 'Revenir aux couleurs d’origine')),
    h('p', { class: 'aide', text: 'Elles habillent les écrans (badges, vedettes, fonds de série, motifs, bandeaux) et le back-office. Le nom remplace « Rose » et « Violet » dans les choix de couleur des contenus.' }),
    couleur('primaire', 'Couleur primaire'), couleur('secondaire', 'Couleur secondaire'),
    h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Dégradé' }), barre, etapesDegrade,
      h('label', { class: 'coche' }, coche, 'Le dégradé suit les couleurs primaire et secondaire')),
    controles);
  function remplacerCouleurs() {
    k.primaire = r.couleurs.primaire; k.secondaire = r.couleurs.secondaire; k.degrade = r.couleurs.degrade;
    suit.v = k.degrade[0] === k.primaire.valeur && k.degrade[2] === k.secondaire.valeur; coche.checked = suit.v;
    ['primaire', 'secondaire', 'd0', 'd1', 'd2'].forEach(x => pickers[x].maj());
    panneauCouleurs.querySelectorAll('input[aria-label^="Nom de la couleur"]').forEach((n, i) => { n.value = k[i ? 'secondaire' : 'primaire'].nom; });
    majDegrade(); changer();
  }

  /* ---- aperçus : brouillon des réglages, sans toucher au reste de la page ---- */
  const apLineup = apercu(), apSerie = apercu();
  function majApercus() {
    const t = auj(), demain = R.ajouterJours(t, 1);
    const alerte = actifs(r.mentions).find(m => m.alerte), simple = actifs(r.mentions).find(m => !m.alerte);
    const role = c => c;   // rôles d'origine (même archivés) : leur libellé du brouillon s'affiche
    G.utiliserReglages(r);
    try {
      apLineup.rendre({ cle: 'apercu', type: 'lineup', duree: 12, service: t, minutes: 21 * 60 + 40, contenu: { id: 'apercu', type: 'lineup', titre: 'Aperçu', donnees: { titre: '', date: t, lieu: (actifs(r.salles)[0] || {}).libelle || '', photo: null, passages: [
        { heure: '19:30', role: role('ouverture'), nom: '', niveau: 'discrete' }, { heure: '20:15', role: role('premiere'), nom: 'Yellow Record', niveau: 'forte' },
        { heure: '21:15', role: role('premiere'), nom: 'La Locale', niveau: '' }, { heure: '22:30', role: role('tete'), nom: 'Benjamin Biolay', niveau: '' },
        { heure: '00:30', role: role('dj'), nom: 'DJ Résident', niveau: '' }] } } });
      const dates = [{ date: t, heure: '20:30', nom: 'Kery James', mention: alerte ? alerte.libelle : '' }, { date: demain, heure: '20:00', nom: 'Nèg’ Marrons', mention: '' },
        { date: R.ajouterJours(t, 9), heure: '20:30', nom: 'Danyl', mention: simple ? simple.libelle : '' }];
      apSerie.rendre({ cle: 'apercu', type: 'serie', duree: 12, service: t, dates, contenu: { id: 'apercu', type: 'serie', titre: 'Aperçu', donnees: { accroche: 'Vous aimez le rap ?', titre: 'Rap au 6MIC', fond: fondApercu.v, dates } } });
    } finally { G.utiliserReglages(E.reglages); }
    for (const ap of [apLineup, apSerie]) for (const [n, v] of Object.entries(G.variablesCouleurs(r.couleurs))) ap.noeud.style.setProperty(n, v);
  }
  const fondApercu = { v: 'rose' };
  const segFond = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fond de la série en aperçu' }, Object.keys(G.FONDS_SERIE).map(f =>
    h('button', { type: 'button', 'aria-pressed': String(f === fondApercu.v), onclick: e => {
      fondApercu.v = f; segFond.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); majApercus();
    } }, f === 'rose' ? 'Primaire' : f === 'violet' ? 'Secondaire' : G.nomCouleur(f))));

  /* ---- listes ---- */
  function editeurListe(nom, o) {
    const boite = h('div', { class: 'liste-r' });
    const l = r[nom];
    const rendre = () => remplacer(boite, l.map((x, i) => {
      const n = o.usage(x), avant = base[nom].find(a => a.cle === x.cle);
      const renomme = avant && avant.libelle !== x.libelle && n && o.reporte;
      const bouger = (d) => { const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; rendre(); changer(); };
      return h('div', { class: 'ligne-r' + (x.archive ? ' archive' : '') },
        h('div', { class: 'ordre' },
          h('button', { type: 'button', 'aria-label': 'Monter', disabled: i === 0, onclick: () => bouger(-1) }, '↑'),
          h('button', { type: 'button', 'aria-label': 'Descendre', disabled: i === l.length - 1, onclick: () => bouger(1) }, '↓')),
        h('div', { class: 'ligne-r-nom' },
          h('input', { type: 'text', value: x.libelle, maxLength: 40, 'aria-label': o.mot, placeholder: o.placeholder(x), disabled: !!o.fige && o.fige(x),
            oninput: e => { x.libelle = e.target.value; changer(); if (o.reporte) majNote(); } }),
          x.archive && h('span', { class: 'puce puce-gris', text: 'Archivé' }),
          renomme && h('small', { class: 'attention', text: 'Renommé : ' + plur(n, o.motUsage) + ' mis à jour à l’enregistrement.' })),
        o.extra ? o.extra(x) : h('span'),
        h('span', { class: 'usage', text: n ? plur(n, o.motUsage) : 'inutilisé' }),
        o.archivable(x) ? h('button', { type: 'button', class: 'btn pt', onclick: () => { if (x.archive) delete x.archive; else x.archive = true; rendre(); changer(); } }, x.archive ? 'Réactiver' : 'Archiver') : h('span'),
        h('button', { type: 'button', class: 'btn carre btn-danger', 'aria-label': 'Supprimer « ' + (x.libelle || o.mot) + ' »', disabled: !o.supprimable(x) || n > 0,
          title: n ? 'Utilisé : archivez-le plutôt' : (!o.supprimable(x) ? 'Élément d’origine : archivez-le plutôt' : null),
          onclick: () => { l.splice(i, 1); rendre(); changer(); } }, '×'));
    }));
    // la note de renommage suit la saisie sans redessiner la ligne (le curseur reste dans le champ)
    const majNote = () => { clearTimeout(majNote.m); majNote.m = setTimeout(() => { const f = document.activeElement, pos = f && f.selectionStart; const idx = [...boite.querySelectorAll('input[type=text]')].indexOf(f); rendre(); if (idx >= 0) { const n = boite.querySelectorAll('input[type=text]')[idx]; n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 600); };
    const ajout = h('button', { type: 'button', class: 'btn', onclick: () => {
      if (l.length >= o.max) { annoncer(o.max + ' éléments au plus.', true); return; }
      l.push(Object.assign({ cle: nouvelleCle(o.prefixe, l), libelle: '' }, o.nouveau || {})); rendre(); changer();
      boite.lastChild.querySelector('input[type=text]').focus();
    } }, '+ ' + o.ajouter);
    rendre();
    return h('section', { class: 'panneau' }, h('div', { class: 'panneau-t' }, h('h2', { text: o.titre })),
      h('p', { class: 'aide', text: o.aide }), boite, h('div', { class: 'actions' }, ajout));
  }
  const listeRoles = editeurListe('roles', {
    titre: 'Rôles du line-up', mot: 'Rôle', ajouter: 'Ajouter un rôle', prefixe: 'r', max: 40, motUsage: 'line-up', nouveau: { niveau: 'normale' },
    aide: 'Proposés pour chaque passage d’un line-up. La mise en valeur par défaut s’applique quand un passage est en « Auto ». Renommer un rôle change aussi les line-up déjà faits.',
    placeholder: x => x.cle === 'autre' ? 'Autre : intitulé saisi à chaque passage' : 'Libellé du rôle',
    fige: x => x.cle === 'autre', usage: x => usages.roles.get(x.cle) || 0, archivable: x => x.cle !== 'autre', supprimable: x => !ROLES_FIXES.includes(x.cle),
    extra: x => h('select', { 'aria-label': 'Mise en valeur par défaut', title: 'Mise en valeur par défaut', onchange: e => { x.niveau = e.target.value; changer(); } },
      Object.entries(G.NIVEAUX_LINEUP).map(([v, t]) => h('option', { value: v, text: t, selected: x.niveau === v })))
  });
  const listeMentions = editeurListe('mentions', {
    titre: 'Mentions', mot: 'Mention', ajouter: 'Ajouter une mention', prefixe: 'm', max: 30, motUsage: 'contenu', reporte: true, nouveau: { alerte: false },
    aide: 'Proposées sur les soirées, agendas et séries (un texte libre reste possible). En rouge : sur fond d’alerte à l’écran, comme Complet ou Annulé.',
    placeholder: () => 'Libellé de la mention', usage: x => usages.mentions.get((base.mentions.find(a => a.cle === x.cle) || x).libelle) || 0,
    archivable: () => true, supprimable: () => true,
    extra: x => {
      const chip = h('span', { class: 'chip-mention' + (x.alerte ? ' rouge' : ''), text: x.libelle || 'Mention' });
      return h('div', { class: 'mention-style' }, chip, h('label', { class: 'coche' },
        h('input', { type: 'checkbox', checked: !!x.alerte, onchange: e => { x.alerte = e.target.checked; chip.classList.toggle('rouge', x.alerte); changer(); } }), 'En rouge'));
    },
  });
  const listeSalles = editeurListe('salles', {
    titre: 'Salles', mot: 'Salle', ajouter: 'Ajouter une salle', prefixe: 's', max: 20, motUsage: 'line-up', reporte: true,
    aide: 'Proposées pour le lieu d’un line-up (un texte libre reste possible).',
    placeholder: () => 'Nom de la salle', usage: x => usages.salles.get((base.salles.find(a => a.cle === x.cle) || x).libelle) || 0,
    archivable: () => true, supprimable: () => true
  });

  async function sauver() {
    for (const [nom, mot] of [['roles', 'rôle'], ['mentions', 'mention'], ['salles', 'salle']]) {
      const vide = r[nom].findIndex(x => !x.libelle.trim() && x.cle !== 'autre');
      if (vide >= 0) { annoncer('Un ' + (mot === 'rôle' ? 'rôle' : mot === 'salle' ? 'nom de salle' : 'libellé de mention') + ' est vide (ligne ' + (vide + 1) + ').', true); return; }
    }
    enregistrer.disabled = true; pied.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res = await api('PUT', '/api/admin/reglages', { version: base.version, reglages: r });
      ed.sale = false;
      await recharger();
      annoncer('Réglages enregistrés' + (res.contenusModifies ? ' (' + plur(res.contenusModifies, 'contenu mis à jour', 'contenus mis à jour') + ')' : '') + '. Les écrans les appliquent sous une minute.');
      if (surVue('reglages')) vueReglages();
    } catch (e) { enregistrer.disabled = false; pied.querySelectorAll('button').forEach(b => { b.disabled = false; }); annoncer(e.message, true); }
  }

  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: 'Couleurs et listes de choix' }), h('h1', { class: 'titre', text: 'Réglages' })),
      h('div', { class: 'actions' }, annuler, enregistrer)),
    base.modifie_le && h('p', { class: 'aide', text: 'Dernière modification le ' + heureIso(base.modifie_le) + (base.par ? ' par ' + base.par : '') + '.' }),
    h('div', { class: 'reglages' },
      h('div', { class: 'reglages-couleurs' }, panneauCouleurs,
        h('section', { class: 'apercus' }, h('p', { class: 'lbl', text: 'Aperçu, avant enregistrement' }), apLineup.noeud, apSerie.noeud,
          h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Fond de la série' }), segFond))),
      listeRoles, listeMentions, listeSalles),
    pied);
  majDegrade(); majApercus();
}

async function vueJournal(page) {
  afficher(h('p', { class: 'chargement', text: 'Chargement du journal…' }));
  let j;
  try { j = await api('GET', '/api/admin/journal?page=' + page); } catch (e) { if (surVue('journal')) afficher(h('p', { class: 'erreur', text: e.message })); return; }
  if (!surVue('journal')) return;
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: plur(j.total, 'modification') }), h('h1', { class: 'titre', text: 'Journal' }))),
    j.lignes.length ? h('table', { class: 'tableau' },
      h('thead', null, h('tr', null, h('th', { text: 'Quand' }), h('th', { text: 'Qui' }), h('th', { text: 'Quoi' }))),
      h('tbody', null, j.lignes.map(l => h('tr', null, h('td', { text: heureIso(l.quand) }), h('td', { text: l.qui || '' }),
        h('td', null, h('b', { text: l.action }), l.detail ? h('span', { class: 'aide', text: ' — ' + l.detail }) : null)))))
      : h('p', { class: 'aide', text: 'Aucune modification pour l’instant.' }),
    j.pages > 1 && h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', disabled: page <= 1, onclick: () => vueJournal(page - 1) }, '‹ Plus récentes'),
      h('span', { class: 'aide', text: 'Page ' + j.page + ' sur ' + j.pages }),
      h('button', { type: 'button', class: 'btn', disabled: page >= j.pages, onclick: () => vueJournal(page + 1) }, 'Plus anciennes ›')));
}

/* ================= connexion et démarrage ================= */
function montrerConnexion(message) {
  E = null;
  $('#demarrage').hidden = true; $('#app').hidden = true; $('#nav').hidden = true; $('#moi').hidden = true; $('#deconnexion').hidden = true;
  const f = $('#connexion');
  f.hidden = false;
  const err = $('#cx-erreur');
  err.hidden = !message; err.textContent = message || '';
  ($('#cx-prenom').value ? $('#cx-mdp') : $('#cx-prenom')).focus();
}
function montrerApp() {
  $('#demarrage').hidden = true; $('#connexion').hidden = true;
  $('#app').hidden = false; $('#nav').hidden = false;
  $('#moi').hidden = false; $('#moi').textContent = E.moi;
  $('#deconnexion').hidden = false;
  naviguer();
}
$('#connexion').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#cx-erreur');
  err.hidden = true;
  try {
    await api('POST', '/api/admin/connexion', { prenom: $('#cx-prenom').value, motdepasse: $('#cx-mdp').value });
    try { localStorage.setItem('tv6mic.prenom', $('#cx-prenom').value); } catch { /* stockage indisponible */ }
    $('#cx-mdp').value = '';
    await recharger();
    montrerApp();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
});
$('#deconnexion').addEventListener('click', async () => {
  if (edition && edition.sale && !(await demander('Modifications non enregistrées', 'Se déconnecter sans enregistrer ?', 'Se déconnecter', true))) return;
  edition = null;
  await api('POST', '/api/admin/deconnexion', {}).catch(() => {});
  montrerConnexion();
});
(async function demarrer() {
  try { $('#cx-prenom').value = localStorage.getItem('tv6mic.prenom') || ''; } catch { /* stockage indisponible */ }
  try {
    await recharger();
    montrerApp();
  } catch (e) {
    if (e.status === 401) { montrerConnexion(); return; }
    if (e.status === 503) { montrerConnexion(e.message); $('#connexion button[type="submit"]').disabled = true; return; }
    $('#demarrage').textContent = 'Impossible de charger le back-office : ' + e.message;
  }
})();
