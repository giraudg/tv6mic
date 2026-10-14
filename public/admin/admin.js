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
const TYPES = { soiree: 'Soirée', agenda: 'Agenda', image: 'Image', video: 'Vidéo' };
const SEMAINE = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']];
const MENTIONS = ['Complet', 'Dernières places', 'Nouvelle date', 'Annulé', 'Gratuit', 'Gratuit sur réservation'];

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
const mo = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' Mo';
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
  remplacer($('#sync'), h('i'), 'Programmation v' + E.version + ' · à jour');
}
const maintenant = () => Date.now() + decalage;
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
  const avertissement = (w < 1920 && ht < 1080) || w < 1280 || ht < 720
    ? 'Image de petite taille (' + w + ' × ' + ht + ' px) : elle sera floue en plein écran. Idéal : 1920 × 1080 px ou plus.' : '';
  return { blob, largeur: cw, hauteur: ch, avertissement };
}
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
  if (a.illisible || !a.codec) { n('x', 'Fichier illisible : ce n’est pas une vidéo MP4 ou MOV.'); return { lignes: l, refus }; }
  if (a.codec === 'avc1' || a.codec === 'avc3') n('v', 'Codec H.264');
  else if (a.codec === 'hvc1' || a.codec === 'hev1') n('x', 'Codec HEVC (H.265, vidéos d’iPhone) : à exporter en H.264');
  else n('x', 'Codec « ' + a.codec + ' » non lu par les écrans : à exporter en H.264');
  if (a.profil) {
    if ([66, 77, 100].includes(a.profil)) n('v', 'Profil ' + ({ 66: 'Baseline', 77: 'Main', 100: 'High' })[a.profil] + (a.niveau ? ', niveau ' + a.niveau : ''));
    else n('x', 'Profil H.264 ' + a.profil + ' (10 bits ou 4:2:2) : à exporter en 8 bits, profil High');
  }
  if (a.largeur > 1920 || a.hauteur > 1080) n('x', a.largeur + ' × ' + a.hauteur + ' px : à réduire en 1920 × 1080');
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
const TYPE_PAR_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const nomSansExtension = n => n.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 100);
function typeFichier(f) { return f.type || TYPE_PAR_EXT[(f.name.split('.').pop() || '').toLowerCase()] || ''; }

/* Champ d'import : image (visuel, photo de soirée, fond d'agenda) ou vidéo. */
function champMedia({ genre, valeur, facultatif, change }) {
  const video = genre === 'video';
  const racine = h('div', { class: 'media' });
  const vignette = h('div', { class: 'media-vignette' });
  const info = h('div', { class: 'aide' });
  const barre = h('div', { class: 'barre', hidden: true }, h('i'));
  const controle = h('ul', { class: 'controle', hidden: true });
  const encart = h('div', { class: 'encart rose', hidden: true },
    h('b', { text: 'Exporter au bon format' }),
    h('span', { text: 'HandBrake (gratuit) : préréglage « Fast 1080p30 », cocher « Web Optimized », vidéo H.264, 30 i/s constants, débit moyen 5000 kbit/s, son AAC. Le détail est dans le cahier des charges (section 4).' }));
  const entree = h('input', { type: 'file', accept: video ? 'video/mp4,video/quicktime,.mp4,.mov,.m4v' : 'image/jpeg,image/png,image/webp', hidden: true });
  const bouton = h('button', { type: 'button', class: 'btn', onclick: () => entree.click(), disabled: !E.r2 },
    video ? 'Choisir une vidéo…' : 'Choisir une image…');
  const retirer = facultatif ? h('button', { type: 'button', class: 'btn btn-danger pt', onclick: () => { change(null); montrer(null); } }, 'Retirer') : null;
  function montrer(v) {
    const src = v && (video ? v.poster : v.src);
    vignette.style.backgroundImage = src ? 'url("' + src + '")' : '';
    if (retirer) retirer.hidden = !v;
    info.textContent = !v ? (video ? 'Aucune vidéo.' : 'Aucune image.')
      : video ? [v.largeur && v.largeur + ' × ' + v.hauteur, v.duree && Math.round(v.duree) + ' s', v.taille && mo(v.taille)].filter(Boolean).join(' · ')
        : [v.largeur && v.largeur + ' × ' + v.hauteur + ' px', v.taille && mo(v.taille)].filter(Boolean).join(' · ');
  }
  entree.addEventListener('change', async () => {
    const f = entree.files[0];
    entree.value = '';
    if (!f) return;
    const type = typeFichier(f);
    controle.hidden = true; encart.hidden = true; bouton.disabled = true;
    const progresser = x => { barre.hidden = false; barre.firstChild.style.width = Math.round(x * 100) + '%'; };
    try {
      if (!video) {
        if (!type.startsWith('image/')) throw new Error('Choisissez une image JPEG, PNG ou WebP.');
        info.textContent = 'Préparation de l’image…';
        const p = await preparerImage(f);
        info.textContent = 'Envoi…';
        const r = await televerser(p.blob, f.name, progresser);
        const v = { src: r.src, largeur: p.largeur, hauteur: p.hauteur, taille: r.taille, fichier: nomSansExtension(f.name) };
        change(v); montrer(v);
        if (p.avertissement) annoncer(p.avertissement, true);
      } else {
        if (!type.startsWith('video/')) throw new Error('Choisissez une vidéo MP4 ou MOV.');
        info.textContent = 'Contrôle du format…';
        const a = await analyserVideo(f), verdict = verdictVideo(a);
        remplacer(controle, ...verdict.lignes.map(([e, t]) => h('li', { class: e, text: t })));
        controle.hidden = false;
        if (verdict.refus) { encart.hidden = false; info.textContent = 'Vidéo refusée : les écrans ne la liraient pas correctement.'; return; }
        info.textContent = 'Extraction de l’image fixe…';
        // L'image fixe sert d'aperçu et de secours entre deux vidéos ; sans elle, la vidéo reste utilisable.
        const p = await posterVideo(f).catch(err => { annoncer('Image fixe non extraite (' + err.message + ') : la vidéo sera importée sans.', true); return null; });
        const rp = p ? await televerser(p.blob, f.name + '.jpg', null) : null;
        info.textContent = 'Envoi de la vidéo…';
        const rv = await televerser(new Blob([f], { type: type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4' }), f.name, progresser);
        const v = { src: rv.src, poster: rp ? rp.src : null, duree: Math.round((a.duree || (p && p.duree) || 0) * 100) / 100, taille: rv.taille, largeur: a.largeur || (p && p.largeur), hauteur: a.hauteur || (p && p.hauteur),
          fichier: nomSansExtension(f.name), analyse: { codec: a.codec, profil: a.profil, niveau: a.niveau, ips: a.ips, debit: a.debit, avert: verdict.lignes.filter(x => x[0] === 'a').length } };
        change(v); montrer(v);
      }
    } catch (e) {
      info.textContent = e.message;
      annoncer(e.message, true);
    } finally {
      bouton.disabled = !E.r2; barre.hidden = true;
    }
  });
  montrer(valeur);
  racine.append(h('div', { class: 'media-ligne' }, vignette, h('div', { class: 'actions' }, bouton, retirer)), info, barre, controle, encart, entree);
  if (!E.r2) racine.append(h('p', { class: 'erreur', text: 'Import impossible : le stockage Cloudflare R2 n’est pas encore activé.' }));
  return racine;
}

/* ================= résumés de programmation ================= */
function nomsFlux(codes) {
  if (codes.length === E.flux.length) return 'Tous les écrans';
  return codes.map(c => (E.fluxParCode.get(c) || { nom: c }).nom).join(', ');
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
  if (edition && edition.sale && !(nom === 'contenu' && arg === edition.id)) {
    if (!(await demander('Modifications non enregistrées', 'Quitter ce contenu sans enregistrer vos modifications ?', 'Quitter sans enregistrer', true))) {
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
    else vueEcrans();
  } catch (e) {
    console.error(e);
    afficher(h('p', { class: 'erreur', text: 'Erreur d’affichage : ' + e.message }));
  }
}
window.addEventListener('hashchange', naviguer);
window.addEventListener('beforeunload', e => { if (edition && edition.sale) { e.preventDefault(); e.returnValue = ''; } });
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
const filtre = { type: 'tous', archives: false, texte: '' };
function vignette(c) {
  const d = c.donnees, img = h('div', { class: 'vignette-img' });
  const src = c.type === 'video' ? d.poster : c.type === 'image' ? d.src : d.photo && d.photo.src;
  if (src) img.style.backgroundImage = 'url("' + src + '")';
  if (c.type === 'agenda') img.append(h('div', { class: 'vignette-ag' }, h('b', { text: d.titre || c.titre }), h('span', { text: plur((d.dates || []).length, 'date') })));
  if (c.type === 'soiree') img.append(h('div', { class: 'vignette-soiree', text: d.nom || '' }));
  img.append(h('span', { class: 'puce t-' + c.type, text: TYPES[c.type] }));
  const t = auj(), actives = diffsDe(c.id).filter(x => x.fin >= t);
  const flux = [...new Set(actives.flatMap(x => x.flux))];
  const sous = c.type === 'soiree' ? (d.date ? dateLongue(d.date) + (d.date < t ? ' (passée)' : '') : 'Date à préciser')
    : c.type === 'agenda' ? plur((d.dates || []).filter(x => x.date >= t).length, 'date') + ' à venir'
      : c.type === 'video' ? (d.duree ? Math.round(d.duree) + ' s · ' + mo(d.taille || 0) : 'Sans fichier') : (d.largeur ? d.largeur + ' × ' + d.hauteur + ' px' : 'Sans fichier');
  return h('a', { class: 'vignette' + (c.statut === 'archive' ? ' archive' : ''), href: '#contenu/' + c.id }, img,
    h('div', { class: 'vignette-c' }, h('b', { text: c.titre }), h('span', { text: sous }),
      h('div', { class: 'prog-resume' }, c.statut === 'archive' ? h('span', { class: 'puce puce-gris', text: 'Archivé' })
        : flux.length ? [h('span', { class: 'puce puce-noir', text: flux.length === E.flux.length ? 'Tous les écrans' : plur(flux.length, 'écran') }),
          h('span', { class: 'aide', text: 'jusqu’au ' + dateCourte(actives.map(x => x.fin).sort().pop()) })]
          : h('span', { class: 'puce puce-filet', text: 'Non programmé' }))));
}
function vueContenus() {
  const grille = h('div', { class: 'vignettes' });
  const remplir = () => {
    const q = filtre.texte.trim().toLowerCase();
    const l = E.contenus.filter(c => (filtre.type === 'tous' || c.type === filtre.type) && (filtre.archives ? c.statut === 'archive' : c.statut !== 'archive')
      && (!q || (c.titre + ' ' + (c.donnees.nom || '') + ' ' + (c.donnees.titre || '')).toLowerCase().includes(q)));
    remplacer(grille, ...(l.length ? l.map(vignette) : [h('p', { class: 'aide', text: filtre.archives ? 'Aucun contenu archivé.' : 'Aucun contenu pour ce filtre.' })]));
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Type' }, [['tous', 'Tous'], ['soiree', 'Soirées'], ['agenda', 'Agendas'], ['image', 'Images'], ['video', 'Vidéos']].map(([k, t]) =>
    h('button', { type: 'button', 'aria-pressed': String(filtre.type === k), onclick: e => { filtre.type = k; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); remplir(); } }, t)));
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: plur(E.contenus.filter(c => c.statut !== 'archive').length, 'contenu') }), h('h1', { class: 'titre', text: 'Contenus' })),
      h('div', { class: 'nouveau' }, h('span', { class: 'lbl', text: 'Nouveau :' }),
        Object.entries(TYPES).map(([k, t]) => h('a', { class: 'btn' + (k === 'soiree' ? ' btn-noir' : ''), href: '#nouveau/' + k }, '+ ' + t)))),
    h('div', { class: 'filtres' }, seg,
      h('input', { type: 'search', placeholder: 'Rechercher…', value: filtre.texte, 'aria-label': 'Rechercher', oninput: e => { filtre.texte = e.target.value; remplir(); } }),
      h('label', { class: 'coche' }, h('input', { type: 'checkbox', checked: filtre.archives, onchange: e => { filtre.archives = e.target.checked; remplir(); } }), 'Archives')),
    grille);
  remplir();
}

/* ================= vue : éditeur de contenu ================= */
function donneesVides(type) {
  if (type === 'soiree') return { nom: '', date: '', heure: '20:00', photo: null, infos: '', mention: '', billetterie: '' };
  if (type === 'agenda') return { titre: 'Prochainement au 6MIC', dates: [], photo: null };
  if (type === 'image') return { src: null, ajustement: 'remplir' };
  return { src: null, poster: null, son: false };
}
function titreAuto(ed) {
  const d = ed.donnees;
  if (ed.type === 'soiree') return (d.nom || 'Soirée') + (d.date ? ' · ' + dateCourte(d.date) : '');
  if (ed.type === 'agenda') return d.titre || 'Agenda';
  return d.fichier || TYPES[ed.type];
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
        champMedia({ genre: 'image', valeur: d.photo, facultatif: true, change: v => { d.photo = v; changer(); } }), h('small', { text: 'Idéal : 1920 × 1080 px ou plus, sujet à droite (le texte est à gauche).' })),
      texte('infos', 'Infos', { multi: true, max: 300, aide: 'Deux ou trois lignes : ouverture des portes, tarifs, première partie…' }));
    const autre = !!d.mention && !MENTIONS.includes(d.mention);
    const libre = h('input', { type: 'text', id: 'f-mention-libre', value: autre ? d.mention : '', maxLength: 40, hidden: !autre, placeholder: 'Mention', oninput: e => { d.mention = e.target.value; changer(); } });
    const sel = h('select', { id: 'f-mention', onchange: e => { const v = e.target.value; libre.hidden = v !== '*'; d.mention = v === '*' ? libre.value : v; changer(); } },
      h('option', { value: '', text: 'Aucune' }), MENTIONS.map(m => h('option', { value: m, text: m, selected: d.mention === m })), h('option', { value: '*', text: 'Autre…', selected: autre }));
    champs.push(h('div', { class: 'grille2' }, h('div', { class: 'champ' }, h('label', { for: 'f-mention', text: 'Mention' }), sel, libre),
      texte('billetterie', 'Lien billetterie', { type: 'url', max: 300, placeholder: 'https://', aide: 'Affiche un QR code. Laisser vide pour ne pas en mettre.' })));
  } else if (ed.type === 'agenda') {
    const lignes = h('div', { class: 'dates-ag' });
    const remplir = () => {
      remplacer(lignes, ...d.dates.map((x, i) => {
        const pm = MENTIONS.includes(x.mention) || !x.mention;
        return h('div', { class: 'date-ag' + (x.date && x.date < auj() ? ' passee' : '') },
          h('input', { type: 'date', value: x.date, 'aria-label': 'Date', oninput: e => { x.date = e.target.value; changer(); } }),
          h('input', { type: 'text', value: x.nom, maxLength: 120, placeholder: 'Nom', 'aria-label': 'Nom', oninput: e => { x.nom = e.target.value; changer(); } }),
          h('select', { 'aria-label': 'Mention', onchange: e => { x.mention = e.target.value; changer(); } },
            h('option', { value: '', text: 'Sans mention' }), MENTIONS.map(m => h('option', { value: m, text: m, selected: x.mention === m })),
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
        champMedia({ genre: 'image', valeur: d.photo, facultatif: true, change: v => { d.photo = v; changer(); } })));
  } else if (ed.type === 'image') {
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Image' }),
      champMedia({ genre: 'image', valeur: d.src ? d : null, change: v => { Object.assign(d, v || { src: null }); changer(); } }),
      h('small', { text: 'JPEG, PNG ou WebP, idéalement 1920 × 1080 px. Les visuels de Declinator conviennent.' })));
    const seg = h('div', { class: 'seg', role: 'group' }, [['remplir', 'Remplir l’écran (recadrer)'], ['ajuster', 'Image entière (bandes noires)']].map(([k, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(d.ajustement === k), onclick: e => { d.ajustement = k; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); changer(); } }, t)));
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Cadrage' }), seg));
  } else {
    champs.push(h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Vidéo' }),
      champMedia({ genre: 'video', valeur: d.src ? d : null, change: v => { Object.assign(d, v || { src: null, poster: null }); changer(); } }),
      h('small', { text: 'MP4 H.264, 1920 × 1080, 25 ou 30 images par seconde, environ 5 Mbit/s, 60 s au plus conseillé.' })),
    h('label', { class: 'coche' }, h('input', { type: 'checkbox', checked: !!d.son, onchange: e => { d.son = e.target.checked; changer(false); } }), 'Diffuser le son de la vidéo'));
  }
  if (ed.type !== 'video') {
    champs.push(champ('Durée d’affichage (secondes)', h('input', { id: 'f-duree', type: 'number', min: 3, max: 600, value: ed.duree || '', placeholder: String(R.DUREES[ed.type]),
      oninput: e => { ed.duree = e.target.value ? Number(e.target.value) : null; changer(); } }), 'Vide : ' + R.DUREES[ed.type] + ' s' + (ed.type === 'agenda' ? ' par page' : '') + '.'));
  }

  /* actions */
  const enregistrer = h('button', { type: 'button', class: 'btn btn-noir', disabled: !!ed.id, onclick: () => sauver() }, ed.id ? 'Enregistrer' : 'Créer le contenu');
  async function sauver(apres) {
    if ((ed.type === 'image' || ed.type === 'video') && !d.src) { annoncer('Importez d’abord le fichier.', true); return; }
    if (ed.type === 'soiree' && !d.nom.trim()) { annoncer('Indiquez le nom du concert.', true); $('#f-nom').focus(); return; }
    if (ed.type === 'agenda' && d.dates.some(x => !x.date)) { annoncer('Chaque ligne de l’agenda doit avoir une date.', true); return; }
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
      return h('ul', { class: 'diffs' }, l.map(x => h('li', { class: x.fin < auj() ? 'finie' : null },
        h('span', { class: 'resume' }, h('b', { text: nomsFlux(x.flux) }), x.prioritaire ? h('span', { class: 'puce prio', text: 'Prioritaire', style: { marginLeft: '8px' } }) : null,
          h('small', { text: resumeJours(x) + ' · ' + resumeHoraires(x) + (x.fin < auj() ? ' · terminée' : '') })),
        h('button', { type: 'button', class: 'btn pt', onclick: () => dialogueDiffusion({ diffusion: x }) }, 'Modifier'))));
    })()) : null;

  afficher(
    h('div', { class: 'tete' },
      h('div', null, h('p', { class: 'surtitre' }, h('a', { href: '#contenus', text: '← Contenus' }), ' · ', TYPES[ed.type], ed.statut === 'archive' ? ' · archivé' : ''),
        h('h1', { class: 'titre', text: ed.id ? ed.titre : 'Nouveau contenu : ' + TYPES[ed.type].toLowerCase() })),
      actions),
    h('div', { class: 'editeur' },
      h('div', { style: { display: 'grid', gap: '24px', minWidth: 0 } },
        h('section', { class: 'panneau' }, h('div', { class: 'panneau-t' }, h('h2', { text: 'Contenu' })),
          champ('Nom dans le back-office', champTitre, 'Rempli automatiquement ; modifiable.'), champs),
        prog),
      h('div', { class: 'colle' }, h('p', { class: 'lbl', text: 'Aperçu à l’écran' }), ap.noeud, pager, infoApercu)));
  majApercu();
  if (ouvrirProgrammation && ouvrirProgrammation === ed.id) { ouvrirProgrammation = null; dialogueDiffusion({ contenu: ed.id }); }
}
let ouvrirProgrammation = null;

/* ================= fenêtre : programmer un contenu ================= */
function dialogueDiffusion({ diffusion, contenu, jours }) {
  const x = diffusion ? structuredClone(diffusion) : {
    id: null, contenu: contenu || '', flux: E.flux.filter(f => f.code !== 'reserve').map(f => f.code),
    debut: jours ? jours[0] : auj(), fin: jours ? jours[jours.length - 1] : R.ajouterJours(auj(), 6),
    jours: jours && !contigus(jours) ? jours.slice() : null, semaine: null, plages: null, prioritaire: 0
  };
  if (!diffusion && contenu) {
    const c = E.contenuParId.get(contenu);
    if (c && c.type === 'soiree' && c.donnees.date && c.donnees.date >= auj() && !jours) { x.debut = auj(); x.fin = c.donnees.date; }
  }
  let mode = x.jours ? 'jours' : 'periode', horaires = x.plages ? 'plages' : 'journee';
  if (!x.plages) x.plages = [['19:00', '23:30']];
  if (!x.jours) x.jours = [];
  const miniCal = { mois: null };
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
            c && c.type === 'soiree' && c.donnees.date && h('button', { type: 'button', class: 'btn pt', onclick: () => { x.debut = auj(); x.fin = c.donnees.date; rendre(); } }, 'Jusqu’au concert (' + dateCourte(c.donnees.date) + ')'))
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
      x.id && h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        if (!(await demander('Retirer cette programmation ?', 'Le contenu ne s’affichera plus sur ces écrans pour ces dates.', 'Retirer', true))) return;
        try { await ecrire(() => api('DELETE', '/api/admin/diffusions/' + x.id), 'Programmation retirée.'); } catch { return; }
        fen.close(); naviguerSansPerte();
      } }, 'Retirer'),
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
const cal = { mois: null, flux: 'tous', sel: [] };
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
  for (let d = debut; ; d = R.ajouterJours(d, 1)) {
    const p = parts(d);
    if (p.j === 1 && d > premier && (p.m + 1 !== m || p.a !== a)) break;
    if (p.j === 1) nbSemaines++;
    const items = diffs.filter(x => R.couvreJour(x, d)).map(x => ({ x, c: E.contenuParId.get(x.contenu) }))
      .sort((u, v) => (v.x.prioritaire - u.x.prioritaire) || ((u.x.plages ? u.x.plages[0][0] : '') < (v.x.plages ? v.x.plages[0][0] : '') ? -1 : 1));
    const visibles = items.filter(({ x, c }) => !(c.type === 'soiree' && c.donnees.date && c.donnees.date < d) && !(c.type === 'agenda' && !(c.donnees.dates || []).some(z => z.date >= d)));
    const concerts = soirees.filter(c => c.donnees.date === d);
    const cellule = h('div', { class: 'cal-c' + (p.m + 1 !== m ? ' hors' : '') + (d === t ? ' auj' : '') + (d < t ? ' passe' : ''), 'data-date': d, role: 'gridcell' },
      h('span', { class: 'cal-n', text: p.n === 1 ? '1er ' + MC[p.m] : String(p.n) }),
      concerts.map(c => h('span', { class: 'cal-plus', text: '★ ' + (c.donnees.nom || c.titre) })),
      visibles.slice(0, 5).map(({ x, c }) => h('button', { type: 'button', class: 'cal-e t-' + c.type + (x.prioritaire ? ' prio' : ''), title: c.titre + ' — ' + resumeDiffusion(x),
        text: (x.plages ? x.plages[0][0] + ' ' : '') + c.titre, onclick: e => { e.stopPropagation(); cal.sel = []; majSel(); dialogueDiffusion({ diffusion: x }); } })),
      visibles.length > 5 && h('span', { class: 'cal-plus', text: '+ ' + (visibles.length - 5) + ' autres' }));
    cellule.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
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
  const segFlux = h('div', { class: 'seg', role: 'group', 'aria-label': 'Écran' },
    [['tous', 'Tous les écrans'], ...E.flux.map(f => [f.code, f.nom])].map(([k, n]) => h('button', { type: 'button', 'aria-pressed': String(cal.flux === k), onclick: () => { cal.flux = k; vueCalendrier(); } }, n)));
  afficher(
    h('div', { class: 'tete' }, h('div', null, h('p', { class: 'surtitre', text: 'Calendrier' }), h('h1', { class: 'titre', text: MOIS[m - 1] + ' ' + a })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn carre', href: '#calendrier/' + decalerMois(cal.mois, -1), 'aria-label': 'Mois précédent' }, '‹'),
        h('a', { class: 'btn', href: '#calendrier/' + auj().slice(0, 7) }, 'Aujourd’hui'),
        h('a', { class: 'btn carre', href: '#calendrier/' + decalerMois(cal.mois, 1), 'aria-label': 'Mois suivant' }, '›'))),
    h('div', { class: 'cal-barre' }, segFlux),
    h('p', { class: 'aide', text: 'Glissez sur plusieurs jours (ou Ctrl / ⌘ + clic pour des jours séparés) pour programmer un contenu en série. Cliquez sur une programmation pour la modifier. ★ : date d’une soirée enregistrée.' }),
    h('div', { class: 'legende' }, Object.entries(TYPES).map(([k, n]) => h('span', { class: 'puce t-' + k, text: n })), h('span', { class: 'puce prio', text: 'Prioritaire' })),
    grille, barre);
  majSel();
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
        h('button', { type: 'button', class: 'btn carre pt', 'aria-label': 'Descendre', disabled: i === ligne.length - 1, onclick: () => deplacer(i, i + 1) }, '↓')));
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

/* ================= vue : journal ================= */
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
