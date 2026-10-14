/* Écrans TV 6MIC : Worker Cloudflare.
   Écrans (public) :
   - GET  /api/flux                 liste des flux (code, nom)
   - GET  /api/flux/{code}          programmation du flux (JSON)
   - POST /api/flux/{code}          idem ; le corps porte l'état de l'écran (signal), enregistré dans D1
   - GET  /medias/{clé}             images et vidéos importées (R2), avec lecture partielle (Range)
   Back-office (session par cookie signé, mot de passe partagé ADMIN_PASSWORD) :
   - GET  /api/admin/statut, POST /api/admin/connexion, POST /api/admin/deconnexion
   - GET  /api/admin/etat           flux, contenus, diffusions, écrans
   - POST /api/admin/contenus, PUT|DELETE /api/admin/contenus/{id}, POST /api/admin/contenus/{id}/dupliquer
   - POST /api/admin/diffusions, PUT|DELETE /api/admin/diffusions/{id}
   - POST /api/admin/diffusions/{id}/retirer-jour   retire un jour d'une programmation (période coupée en deux si besoin)
   - POST /api/admin/retirer-ecran   retire un contenu de la boucle d'un écran (ses programmations à venir sur cet écran)
   - PUT  /api/admin/flux/{code}, POST /api/admin/flux/{code|tous}/identifier, POST /api/admin/ordre
   - POST /api/admin/medias         import d'un fichier (corps brut) vers R2
   - GET  /api/admin/journal?page=N
   Tout le reste est servi depuis public/ (lecteur, back-office, diagnostic, médias d'essai). */

const COOKIE = 'tv6mic_admin';
const SESSION_JOURS = 30;
const ECHECS_MAX = 10, FENETRE_ECHECS = 15 * 60e3;
const CODE_VALIDE = /^[a-z0-9-]{1,40}$/;
const ID_VALIDE = /^[a-z0-9-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES = ['soiree', 'agenda', 'image', 'video'];
const MEDIAS_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const MEDIAS_MAX = 100 * 1024 * 1024;

class ErreurHttp extends Error { constructor(status, message) { super(message); this.status = status; } }
const refus = message => new ErreurHttp(400, message);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/medias/')) return await media(req, env, ctx, p.slice(8));
      if (p === '/api/sante') return json({ ok: true, maintenant: Date.now() });
      if (p === '/api/flux') {
        if (req.method !== 'GET') return json({ erreur: 'Méthode non permise' }, 405);
        const { results } = await env.DB.prepare('SELECT code, nom FROM flux ORDER BY ordre, nom').all();
        return json({ flux: results });
      }
      const m = p.match(/^\/api\/flux\/([^/]+)$/);
      if (m) {
        if (req.method !== 'GET' && req.method !== 'POST') return json({ erreur: 'Méthode non permise' }, 405);
        const code = decodeURIComponent(m[1]).toLowerCase();
        if (!CODE_VALIDE.test(code)) return json({ erreur: 'Flux inconnu', code }, 404);
        return await programme(req, env, ctx, code);
      }
      if (p.startsWith('/api/admin/')) return await admin(req, env, url);
      if (p.startsWith('/api/')) return json({ erreur: 'Adresse inconnue' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof ErreurHttp) return json({ erreur: e.message }, e.status);
      console.error('erreur', p, e && e.stack || e);
      return json({ erreur: 'Erreur interne du serveur.' }, 500);
    }
  }
};

function json(obj, status = 200, entetes = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes } });
}
// Date du jour à Paris (AAAA-MM-JJ).
function dateParis(ms) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function lireJSON(texte, defaut) {
  if (texte === null || texte === undefined || texte === '') return defaut;
  try { return JSON.parse(texte); } catch { return defaut; }
}
const maintenantIso = () => new Date().toISOString();
const nouvelId = prefixe => prefixe + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/* ================= écrans ================= */

async function programme(req, env, ctx, code) {
  const db = env.DB;
  const maintenant = Date.now();
  const [flux, versionTexte] = await Promise.all([
    db.prepare('SELECT code, nom, contenu_defaut, identifier_jusqua FROM flux WHERE code = ?').bind(code).first(),
    db.prepare("SELECT valeur FROM meta WHERE cle = 'version'").first('valeur')
  ]);
  if (!flux) return json({ erreur: 'Flux inconnu', code }, 404);
  const version = parseInt(versionTexte, 10) || 0;

  let signal = null;
  if (req.method === 'POST') {
    signal = await req.json().catch(() => null);
    if (signal && typeof signal === 'object') ctx.waitUntil(enregistrerSignal(db, code, signal, maintenant).catch(e => console.error('signal', e)));
  }

  const base = { flux: { code: flux.code, nom: flux.nom }, version, maintenant, identifier: flux.identifier_jusqua || 0 };
  if (signal && Number(signal.version) === version && version > 0) return json({ ...base, inchange: true });

  // Diffusions de ce flux qui ne sont pas terminées (depuis hier, pour les soirées qui passent minuit).
  const hier = dateParis(maintenant - 86400000);
  const { results: lignes } = await db.prepare(
    `SELECT d.id, d.contenu_id, d.debut, d.fin, d.jours, d.semaine, d.plages, d.prioritaire, d.ordre, d.cree_le, d.modifie_le
       FROM diffusions d
       JOIN diffusion_flux df ON df.diffusion_id = d.id
       JOIN contenus c ON c.id = d.contenu_id
      WHERE df.flux_code = ? AND d.fin >= ? AND c.statut = 'actif'`
  ).bind(code, hier).all();

  const ids = [...new Set(lignes.map(l => l.contenu_id).concat(flux.contenu_defaut ? [flux.contenu_defaut] : []))];
  const contenus = {};
  for (let i = 0; i < ids.length; i += 90) {
    const lot = ids.slice(i, i + 90);
    const { results } = await db.prepare(
      `SELECT id, type, titre, donnees, duree, modifie_le FROM contenus WHERE id IN (${lot.map(() => '?').join(',')}) AND statut = 'actif'`
    ).bind(...lot).all();
    for (const c of results) {
      contenus[c.id] = { id: c.id, type: c.type, titre: c.titre, donnees: lireJSON(c.donnees, {}), duree: c.duree, modifie_le: c.modifie_le };
    }
  }
  const diffusions = lignes.map(diffusionVersJson);
  return json({ ...base, defaut: flux.contenu_defaut && contenus[flux.contenu_defaut] ? flux.contenu_defaut : null, contenus, diffusions });
}

function diffusionVersJson(l) {
  return {
    id: l.id, contenu: l.contenu_id, debut: l.debut, fin: l.fin,
    jours: lireJSON(l.jours, null), semaine: lireJSON(l.semaine, null), plages: lireJSON(l.plages, null),
    prioritaire: l.prioritaire ? 1 : 0, ordre: l.ordre || 0, cree_le: l.cree_le, modifie_le: l.modifie_le
  };
}

function texte(v, max) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, max);
}
function entier(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function enregistrerSignal(db, code, s, maintenant) {
  await db.prepare(
    `INSERT INTO ecrans (flux_code, vu_le, lecteur, version, contenu, memoire, video, erreur, demarre_le, chargements, taille, agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT (flux_code) DO UPDATE SET
       vu_le = excluded.vu_le, lecteur = excluded.lecteur, version = excluded.version, contenu = excluded.contenu,
       memoire = excluded.memoire, video = excluded.video, erreur = excluded.erreur, demarre_le = excluded.demarre_le,
       chargements = excluded.chargements, taille = excluded.taille, agent = COALESCE(excluded.agent, ecrans.agent)`
  ).bind(
    code, maintenant, texte(s.lecteur, 20), entier(s.version), texte(s.contenu, 120), entier(s.memoire),
    texte(s.video, 10), texte(s.erreur, 300), entier(s.demarre), entier(s.chargements), texte(s.taille, 20), texte(s.agent, 300)
  ).run();
}

/* Médias importés (R2). Les clés sont uniques : le navigateur et l'écran peuvent les garder longtemps. */
// Les fichiers complets passent par le cache de Cloudflare : les écrans suivants les reçoivent depuis Paris.
async function media(req, env, ctx, cle) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json({ erreur: 'Méthode non permise' }, 405);
  if (!env.MEDIAS || !/^[a-z0-9/._-]{1,120}$/i.test(cle) || cle.includes('..')) return new Response('Introuvable', { status: 404 });
  const plage = req.headers.get('Range');
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cleCache = new Request(new URL(req.url).origin + '/medias/' + cle);
  if (req.method === 'GET' && !plage && cache) {
    const r = await cache.match(cleCache).catch(() => null);
    if (r) return r;
  }
  let objet;
  try { objet = req.method === 'HEAD' ? await env.MEDIAS.head(cle) : await env.MEDIAS.get(cle, plage ? { range: req.headers } : {}); }
  catch { return new Response('Plage invalide', { status: 416 }); }
  if (!objet) return new Response('Introuvable', { status: 404 });
  const h = new Headers();
  objet.writeHttpMetadata(h);
  h.set('ETag', objet.httpEtag);
  h.set('Cache-Control', 'public, max-age=31536000, immutable');
  h.set('Accept-Ranges', 'bytes');
  if (req.method === 'HEAD') { h.set('Content-Length', String(objet.size)); return new Response(null, { headers: h }); }
  if (plage && objet.range) {
    const debut = objet.range.offset || 0;
    const longueur = objet.range.length !== undefined ? objet.range.length : objet.size - debut;
    h.set('Content-Range', `bytes ${debut}-${debut + longueur - 1}/${objet.size}`);
    h.set('Content-Length', String(longueur));
    return new Response(objet.body, { status: 206, headers: h });
  }
  h.set('Content-Length', String(objet.size));
  const r = new Response(objet.body, { headers: h });
  if (cache) ctx.waitUntil(cache.put(cleCache, r.clone()).catch(() => {}));
  return r;
}

/* ================= back-office ================= */

async function admin(req, env, url) {
  const p = url.pathname, m = req.method;
  const secret = motDePasse(env);
  if (p === '/api/admin/statut' && m === 'GET') return json({ configure: !!secret, r2: !!env.MEDIAS });
  if (!secret) throw new ErreurHttp(503, 'Le mot de passe du back-office n’est pas encore configuré : ajoutez le secret ADMIN_PASSWORD dans les réglages du Worker tv-6mic sur Cloudflare (Settings > Variables and Secrets).');
  if (m !== 'GET') verifierOrigine(req, url, p === '/api/admin/medias');

  if (p === '/api/admin/connexion' && m === 'POST') return connexion(req, env, url, secret);
  if (p === '/api/admin/deconnexion' && m === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, url) });

  const qui = await session(req, env, secret);
  if (!qui) throw new ErreurHttp(401, 'Connexion requise.');

  if (p === '/api/admin/etat' && m === 'GET') return etat(env, qui);
  if (p === '/api/admin/journal' && m === 'GET') return journal(env, url);
  if (p === '/api/admin/medias' && m === 'POST') return importerMedia(req, env, qui);
  if (p === '/api/admin/contenus' && m === 'POST') return creerContenu(req, env, qui);
  if (p === '/api/admin/diffusions' && m === 'POST') return enregistrerDiffusion(req, env, qui, null);
  if (p === '/api/admin/ordre' && m === 'POST') return ordonner(req, env, qui);
  if (p === '/api/admin/retirer-ecran' && m === 'POST') return retirerEcran(req, env, qui);

  let r = p.match(/^\/api\/admin\/contenus\/([a-z0-9-]+)(\/dupliquer)?$/);
  if (r) {
    if (r[2] && m === 'POST') return dupliquerContenu(env, qui, r[1]);
    if (!r[2] && m === 'PUT') return modifierContenu(req, env, qui, r[1]);
    if (!r[2] && m === 'DELETE') return supprimerContenu(env, qui, r[1]);
  }
  r = p.match(/^\/api\/admin\/diffusions\/([a-z0-9-]+)(\/retirer-jour)?$/);
  if (r) {
    if (r[2] && m === 'POST') return retirerJour(req, env, qui, r[1]);
    if (!r[2] && m === 'PUT') return enregistrerDiffusion(req, env, qui, r[1]);
    if (!r[2] && m === 'DELETE') return supprimerDiffusion(env, qui, r[1]);
  }
  r = p.match(/^\/api\/admin\/flux\/([a-z0-9-]+)(\/identifier)?$/);
  if (r) {
    if (r[2] && m === 'POST') return identifier(env, qui, r[1]);
    if (!r[2] && m === 'PUT') return modifierFlux(req, env, qui, r[1]);
  }
  throw new ErreurHttp(404, 'Adresse inconnue.');
}

function motDePasse(env) {
  const v = env.ADMIN_PASSWORD;
  return typeof v === 'string' && v.trim() ? v : '';
}
// Écritures : même origine ; JSON, ou en-tête X-TV6MIC pour l'import de fichiers.
function verifierOrigine(req, url, fichier) {
  const origine = req.headers.get('Origin');
  if (origine && origine !== url.origin) throw new ErreurHttp(403, 'Origine non autorisée.');
  if (fichier) { if (req.headers.get('X-TV6MIC') !== '1') throw new ErreurHttp(403, 'Requête non autorisée.'); return; }
  if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) throw new ErreurHttp(415, 'Format de requête non accepté.');
}
async function lireCorps(req, max = 400000) {
  if ((parseInt(req.headers.get('Content-Length'), 10) || 0) > max) throw new ErreurHttp(413, 'Requête trop volumineuse.');
  const t = await req.text();
  if (t.length > max) throw new ErreurHttp(413, 'Requête trop volumineuse.');
  let o;
  try { o = JSON.parse(t || '{}'); } catch { throw refus('JSON invalide.'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw refus('Requête invalide.');
  return o;
}

/* ---- sessions : cookie « prénom.expiration.signature », signé en HMAC-SHA256 ---- */
const enc = new TextEncoder();
let cleCache = null, graine = null;
// Graine aléatoire tirée une fois et gardée dans D1 : sans elle, la signature des sessions ne dépendrait
// que du mot de passe. Changer le mot de passe déconnecte tout le monde.
async function graineSession(env) {
  if (graine) return graine;
  let g = await env.DB.prepare("SELECT valeur FROM meta WHERE cle = 'graine_session'").first('valeur');
  if (!g) {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    await env.DB.prepare("INSERT OR IGNORE INTO meta (cle, valeur) VALUES ('graine_session', ?)").bind(b64u(b)).run();
    g = await env.DB.prepare("SELECT valeur FROM meta WHERE cle = 'graine_session'").first('valeur');
  }
  return (graine = g);
}
async function cleHmac(env, mdp) {
  const s = mdp + '|tv-6mic|' + await graineSession(env) + '|' + (typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET : '');
  if (cleCache && cleCache.s === s) return cleCache.cle;
  const cle = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cleCache = { s, cle };
  return cle;
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
function cookie(valeur, duree, url) {
  return COOKIE + '=' + valeur + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + duree + (url.protocol === 'https:' ? '; Secure' : '');
}
async function session(req, env, mdp) {
  const brut = (req.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!brut) return null;
  const parties = brut.slice(COOKIE.length + 1).split('.');
  if (parties.length !== 3) return null;
  const [nom64, exp, sig] = parties;
  if (!(+exp > Date.now())) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await cleHmac(env, mdp), b64uDec(sig), enc.encode(nom64 + '.' + exp));
    return ok ? { nom: new TextDecoder().decode(b64uDec(nom64)) } : null;
  } catch { return null; }
}
async function egal(env, a, b) {
  const k = await cleHmac(env, b);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', k, enc.encode('mdp:' + a)), crypto.subtle.sign('HMAC', k, enc.encode('mdp:' + b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
async function connexion(req, env, url, secret) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const depuis = Date.now() - FENETRE_ECHECS;
  const corps = await lireCorps(req, 2000);
  const prenom = String(corps.prenom || '').trim().slice(0, 40);
  const mdp = String(corps.motdepasse || '');
  if (!prenom) throw refus('Indiquez votre prénom.');
  // L'essai est compté avant la vérification, pour que des essais simultanés ne passent pas entre les mailles.
  const [, , compte] = await env.DB.batch([
    env.DB.prepare('DELETE FROM echecs_connexion WHERE quand < ?').bind(depuis),
    env.DB.prepare('INSERT INTO echecs_connexion (ip, quand) VALUES (?, ?)').bind(ip, Date.now()),
    env.DB.prepare('SELECT COUNT(*) AS n FROM echecs_connexion WHERE ip = ? AND quand > ?').bind(ip, depuis)
  ]);
  if (compte.results[0].n > ECHECS_MAX) throw new ErreurHttp(429, 'Trop de tentatives. Réessayez dans un quart d’heure.');
  if (!(await egal(env, mdp, secret))) {
    await new Promise(r => setTimeout(r, 400));
    throw new ErreurHttp(401, 'Mot de passe incorrect.');
  }
  await env.DB.prepare('DELETE FROM echecs_connexion WHERE ip = ?').bind(ip).run();
  const exp = String(Date.now() + SESSION_JOURS * 86400e3);
  const nom64 = b64u(enc.encode(prenom));
  const sig = b64u(await crypto.subtle.sign('HMAC', await cleHmac(env, secret), enc.encode(nom64 + '.' + exp)));
  return json({ ok: true, prenom }, 200, { 'Set-Cookie': cookie(nom64 + '.' + exp + '.' + sig, SESSION_JOURS * 86400, url) });
}

/* ---- lecture ---- */
async function etat(env, qui) {
  const db = env.DB;
  const [flux, contenus, diffusions, liens, ecrans, version] = await Promise.all([
    db.prepare('SELECT code, nom, ordre, contenu_defaut, identifier_jusqua FROM flux ORDER BY ordre, nom').all(),
    db.prepare('SELECT id, type, titre, donnees, duree, statut, cree_le, modifie_le FROM contenus ORDER BY modifie_le DESC').all(),
    db.prepare('SELECT * FROM diffusions ORDER BY debut, cree_le').all(),
    db.prepare('SELECT diffusion_id, flux_code FROM diffusion_flux').all(),
    db.prepare('SELECT * FROM ecrans').all(),
    db.prepare("SELECT valeur FROM meta WHERE cle = 'version'").first('valeur')
  ]);
  const parDiffusion = {};
  for (const l of liens.results) (parDiffusion[l.diffusion_id] = parDiffusion[l.diffusion_id] || []).push(l.flux_code);
  return json({
    moi: qui.nom, version: parseInt(version, 10) || 0, maintenant: Date.now(), r2: !!env.MEDIAS,
    flux: flux.results,
    contenus: contenus.results.map(c => ({ ...c, donnees: lireJSON(c.donnees, {}) })),
    diffusions: diffusions.results.map(d => ({ ...diffusionVersJson(d), flux: parDiffusion[d.id] || [] })),
    ecrans: ecrans.results
  });
}
async function journal(env, url) {
  const par = 30;
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM journal').first('n')) || 0;
  const pages = Math.max(1, Math.ceil(total / par));
  const page = Math.min(pages, Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1));
  const { results } = await env.DB.prepare('SELECT quand, qui, action, detail FROM journal ORDER BY id DESC LIMIT ? OFFSET ?').bind(par, (page - 1) * par).all();
  return json({ lignes: results, total, page, pages });
}

/* ---- écriture : chaque modification est journalisée et fait monter la version (les écrans rechargent) ---- */
function versionSuivante(env) {
  return env.DB.prepare("UPDATE meta SET valeur = CAST(CAST(valeur AS INTEGER) + 1 AS TEXT) WHERE cle = 'version'");
}
function noter(env, qui, action, detail) {
  return env.DB.prepare('INSERT INTO journal (qui, action, detail) VALUES (?, ?, ?)').bind(qui.nom, action, detail ? String(detail).slice(0, 500) : null);
}
async function ecrire(env, qui, requetes, action, detail) {
  await env.DB.batch([...requetes, versionSuivante(env), noter(env, qui, action, detail)]);
}

/* ---- validation ---- */
function chaine(v, max, nom) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') throw refus('Champ invalide : ' + nom + '.');
  const t = v.trim();
  if (t.length > max) throw refus(nom + ' : ' + max + ' caractères au plus.');
  return t;
}
function date(v, nom, obligatoire) {
  if (!v && !obligatoire) return '';
  if (typeof v !== 'string' || !DATE.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw refus('Date invalide : ' + nom + '.');
  return v;
}
function heure(v, nom) {
  if (!v) return '';
  if (typeof v !== 'string' || !HEURE.test(v)) throw refus('Heure invalide : ' + nom + '.');
  return v;
}
function source(v, nom, obligatoire) {
  if (!v && !obligatoire) return null;
  const s = v && typeof v === 'object' ? v.src : v;
  if (typeof s !== 'string' || !/^\/(medias|test-medias)\/[A-Za-z0-9/._-]{1,140}$/.test(s) || s.includes('..')) throw refus('Fichier manquant ou invalide : ' + nom + '.');
  return s;
}
function nombre(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
function lien(v) {
  const s = chaine(v, 300, 'lien de la billetterie');
  if (!s) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw refus('Le lien de la billetterie doit commencer par https://.');
  return s;
}
// Motif des soirées (design system) : les trois réglages ensemble, sinon rien (le lecteur prend alors le motif par défaut).
const MOTIF = { type: ['faisceaux', 'rayons', 'hachures', 'aucun'], position: ['droite', 'gauche', 'haut', 'bas'], couleur: ['rose', 'violet', 'degrade', 'blanc'] };
function motifValide(m) {
  if (!m || typeof m !== 'object') return null;
  const r = {};
  for (const k of Object.keys(MOTIF)) { if (MOTIF[k].indexOf(m[k]) < 0) return null; r[k] = m[k]; }
  return r;
}
function validerDonnees(type, d) {
  if (!d || typeof d !== 'object') throw refus('Données manquantes.');
  if (type === 'soiree') {
    const photo = source(d.photo, 'photo', false);
    return {
      nom: chaine(d.nom, 120, 'nom du concert'), date: date(d.date, 'date du concert', false), heure: heure(d.heure, 'heure'),
      photo: photo ? { src: photo, largeur: nombre(d.photo.largeur, 0, 20000), hauteur: nombre(d.photo.hauteur, 0, 20000) } : null,
      infos: chaine(d.infos, 300, 'infos'), mention: chaine(d.mention, 40, 'mention'), billetterie: lien(d.billetterie),
      motif: motifValide(d.motif)
    };
  }
  if (type === 'agenda') {
    if (d.dates !== undefined && !Array.isArray(d.dates)) throw refus('Dates invalides.');
    const dates = (d.dates || []).slice(0, 80).map((x, i) => ({
      date: date(x && x.date, 'ligne ' + (i + 1), true), nom: chaine(x.nom, 120, 'nom, ligne ' + (i + 1)), mention: chaine(x.mention, 40, 'mention, ligne ' + (i + 1))
    })).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const photo = source(d.photo, 'photo de fond', false);
    return { titre: chaine(d.titre, 80, 'titre de l’agenda'), dates, photo: photo ? { src: photo } : null };
  }
  if (type === 'image') {
    return {
      src: source(d.src, 'image', false), ajustement: d.ajustement === 'ajuster' ? 'ajuster' : 'remplir', fichier: chaine(d.fichier, 120, 'nom du fichier'),
      taille: nombre(d.taille, 0, 1e10), largeur: nombre(d.largeur, 0, 20000), hauteur: nombre(d.hauteur, 0, 20000)
    };
  }
  return {
    src: source(d.src, 'vidéo', false), poster: source(d.poster, 'image de la vidéo', false), son: !!d.son, fichier: chaine(d.fichier, 120, 'nom du fichier'),
    duree: nombre(d.duree, 0, 86400), taille: nombre(d.taille, 0, 1e10), largeur: nombre(d.largeur, 0, 20000), hauteur: nombre(d.hauteur, 0, 20000),
    analyse: d.analyse && typeof d.analyse === 'object' && JSON.stringify(d.analyse).length <= 3000 ? d.analyse : null
  };
}
function validerContenu(c, typeImpose) {
  const type = typeImpose || c.type;
  if (TYPES.indexOf(type) < 0) throw refus('Type de contenu inconnu.');
  const titre = chaine(c.titre, 120, 'nom du contenu') || 'Sans titre';
  const duree = c.duree === null || c.duree === undefined || c.duree === '' ? null : Math.round(nombre(c.duree, 3, 600));
  const statut = c.statut === 'archive' ? 'archive' : 'actif';
  return { type, titre, donnees: validerDonnees(type, c.donnees), duree, statut };
}

/* ---- contenus ---- */
async function lireContenu(env, id) {
  const c = await env.DB.prepare('SELECT * FROM contenus WHERE id = ?').bind(id).first();
  if (!c) throw new ErreurHttp(404, 'Contenu introuvable (supprimé entre-temps ?).');
  return { ...c, donnees: lireJSON(c.donnees, {}) };
}
// Les nouveaux fichiers doivent exister dans R2 (un fichier supprimé entre-temps donnerait un écran noir).
async function verifierFichiers(env, donnees, avant) {
  const anciens = sources(avant || {});
  for (const src of sources(donnees)) {
    if (!src.startsWith('/medias/') || anciens.includes(src)) continue;
    if (!env.MEDIAS || !(await env.MEDIAS.head(src.slice(8)))) throw refus('Un fichier de ce contenu est introuvable : importez-le à nouveau.');
  }
}
async function creerContenu(req, env, qui) {
  const c = validerContenu(await lireCorps(req));
  await verifierFichiers(env, c.donnees, null);
  const id = nouvelId('c');
  await ecrire(env, qui, [
    env.DB.prepare('INSERT INTO contenus (id, type, titre, donnees, duree, statut) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.type, c.titre, JSON.stringify(c.donnees), c.duree, c.statut)
  ], 'Contenu créé', c.titre);
  return json({ contenu: await lireContenu(env, id) });
}
async function modifierContenu(req, env, qui, id) {
  const avant = await lireContenu(env, id);
  const corps = await lireCorps(req);
  if (corps.modifie_le && corps.modifie_le !== avant.modifie_le) throw new ErreurHttp(409, 'Ce contenu a été modifié entre-temps (autre onglet ou autre personne). Rechargez la page pour voir la dernière version.');
  const c = validerContenu(corps, avant.type);
  await verifierFichiers(env, c.donnees, avant.donnees);
  await ecrire(env, qui, [
    env.DB.prepare("UPDATE contenus SET titre = ?, donnees = ?, duree = ?, statut = ?, modifie_le = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .bind(c.titre, JSON.stringify(c.donnees), c.duree, c.statut, id)
  ], c.statut !== avant.statut ? (c.statut === 'archive' ? 'Contenu archivé' : 'Contenu restauré') : 'Contenu modifié', c.titre);
  await nettoyerMedias(env, sources(avant.donnees));
  return json({ contenu: await lireContenu(env, id) });
}
async function dupliquerContenu(env, qui, id) {
  const c = await lireContenu(env, id);
  const nid = nouvelId('c'), titre = (c.titre + ' (copie)').slice(0, 120);
  await ecrire(env, qui, [
    env.DB.prepare("INSERT INTO contenus (id, type, titre, donnees, duree, statut) VALUES (?, ?, ?, ?, ?, 'actif')").bind(nid, c.type, titre, JSON.stringify(c.donnees), c.duree)
  ], 'Contenu dupliqué', titre);
  return json({ contenu: await lireContenu(env, nid) });
}
async function supprimerContenu(env, qui, id) {
  const c = await lireContenu(env, id);
  await ecrire(env, qui, [
    env.DB.prepare('UPDATE flux SET contenu_defaut = NULL WHERE contenu_defaut = ?').bind(id),
    env.DB.prepare('DELETE FROM diffusion_flux WHERE diffusion_id IN (SELECT id FROM diffusions WHERE contenu_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM diffusions WHERE contenu_id = ?').bind(id),
    env.DB.prepare('DELETE FROM contenus WHERE id = ?').bind(id)
  ], 'Contenu supprimé', c.titre);
  await nettoyerMedias(env, sources(c.donnees));
  return json({ ok: true });
}
function sources(d) {
  const r = [];
  if (!d) return r;
  if (d.src) r.push(d.src);
  if (d.poster) r.push(d.poster);
  if (d.photo && d.photo.src) r.push(d.photo.src);
  return r;
}
// Supprime de R2 les fichiers qu'aucun contenu n'utilise plus.
async function nettoyerMedias(env, liste) {
  if (!env.MEDIAS) return;
  for (const src of liste) {
    if (!src || !src.startsWith('/medias/')) continue;
    const utilise = await env.DB.prepare('SELECT 1 FROM contenus WHERE instr(donnees, ?) > 0 LIMIT 1').bind('"' + src + '"').first();
    if (!utilise) await env.MEDIAS.delete(src.slice(8)).catch(e => console.error('r2 delete', e));
  }
}

/* ---- diffusions ---- */
async function enregistrerDiffusion(req, env, qui, id) {
  const b = await lireCorps(req);
  const contenu = await lireContenu(env, String(b.contenu || ''));
  const debut = date(b.debut, 'début', true), fin = date(b.fin, 'fin', true);
  if (fin < debut) throw refus('La date de fin est avant la date de début.');
  const jours = Array.isArray(b.jours) && b.jours.length ? [...new Set(b.jours.map(j => date(j, 'jour choisi', true)))].sort() : null;
  if (jours && jours.length > 400) throw refus('Trop de jours choisis.');
  const semaineBrute = Array.isArray(b.semaine) && b.semaine.length && b.semaine.length < 7 ? [...new Set(b.semaine.map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= 7).sort() : null;
  const semaine = semaineBrute && semaineBrute.length ? semaineBrute : null;
  const plages = Array.isArray(b.plages) && b.plages.length ? b.plages.slice(0, 8).map((p, i) => {
    if (!Array.isArray(p)) throw refus('Plage horaire invalide.');
    const a = heure(p[0], 'début de la plage ' + (i + 1)), z = heure(p[1], 'fin de la plage ' + (i + 1));
    if (!a || !z) throw refus('Plage horaire ' + (i + 1) + ' incomplète.');
    return [a, z];
  }) : null;
  const { results: tous } = await env.DB.prepare('SELECT code, nom FROM flux').all();
  const codes = tous.map(f => f.code);
  const flux = [...new Set((Array.isArray(b.flux) ? b.flux : []).map(String))].filter(c => codes.indexOf(c) >= 0);
  if (!flux.length) throw refus('Choisissez au moins un écran.');
  const prioritaire = b.prioritaire ? 1 : 0;
  const ordre = Math.round(nombre(b.ordre, 0, 100000) || 0);
  const noms = flux.map(c => tous.find(f => f.code === c).nom).join(', ');
  const detail = contenu.titre + ' → ' + noms + ' (' + (debut === fin ? debut : debut + ' au ' + fin) + ')';
  const nid = id || nouvelId('d');
  const req1 = id
    ? env.DB.prepare("UPDATE diffusions SET contenu_id = ?, debut = ?, fin = ?, jours = ?, semaine = ?, plages = ?, prioritaire = ?, modifie_le = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .bind(contenu.id, debut, fin, jours ? JSON.stringify(jours) : null, semaine ? JSON.stringify(semaine) : null, plages ? JSON.stringify(plages) : null, prioritaire, id)
    : env.DB.prepare('INSERT INTO diffusions (id, contenu_id, debut, fin, jours, semaine, plages, prioritaire, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(nid, contenu.id, debut, fin, jours ? JSON.stringify(jours) : null, semaine ? JSON.stringify(semaine) : null, plages ? JSON.stringify(plages) : null, prioritaire, ordre);
  if (id && !(await env.DB.prepare('SELECT 1 FROM diffusions WHERE id = ?').bind(id).first())) throw new ErreurHttp(404, 'Diffusion introuvable (supprimée entre-temps ?).');
  await ecrire(env, qui, [
    req1,
    env.DB.prepare('DELETE FROM diffusion_flux WHERE diffusion_id = ?').bind(nid),
    ...flux.map(c => env.DB.prepare('INSERT INTO diffusion_flux (diffusion_id, flux_code) VALUES (?, ?)').bind(nid, c))
  ], id ? 'Programmation modifiée' : 'Programmation ajoutée', detail);
  return json({ ok: true, id: nid });
}
async function supprimerDiffusion(env, qui, id) {
  const d = await env.DB.prepare('SELECT d.debut, d.fin, c.titre FROM diffusions d JOIN contenus c ON c.id = d.contenu_id WHERE d.id = ?').bind(id).first();
  if (!d) throw new ErreurHttp(404, 'Diffusion introuvable (supprimée entre-temps ?).');
  await ecrire(env, qui, [
    env.DB.prepare('DELETE FROM diffusion_flux WHERE diffusion_id = ?').bind(id),
    env.DB.prepare('DELETE FROM diffusions WHERE id = ?').bind(id)
  ], 'Programmation retirée', d.titre + ' (' + (d.debut === d.fin ? d.debut : d.debut + ' au ' + d.fin) + ')');
  return json({ ok: true });
}
const jourPlus = (j, n) => new Date(Date.parse(j + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// Jour de service en cours (une journée va de 6 h à 6 h, heure de Paris).
const jourDeService = () => dateParis(Date.now() - 6 * 3600e3);

// Retire un seul jour d'une programmation, pour tous ses écrans. Une période est coupée en deux
// (avant / après ce jour) ; une liste de jours perd ce jour ; sans jour restant, la programmation disparaît.
async function retirerJour(req, env, qui, id) {
  const b = await lireCorps(req);
  const jour = date(b.jour, 'jour', true);
  const d = await env.DB.prepare('SELECT d.*, c.titre FROM diffusions d JOIN contenus c ON c.id = d.contenu_id WHERE d.id = ?').bind(id).first();
  if (!d) throw new ErreurHttp(404, 'Programmation introuvable (supprimée entre-temps ?).');
  const db = env.DB, maj = "modifie_le = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  const supprimer = [db.prepare('DELETE FROM diffusion_flux WHERE diffusion_id = ?').bind(id), db.prepare('DELETE FROM diffusions WHERE id = ?').bind(id)];
  let requetes;
  const jours = lireJSON(d.jours, null);
  if (jours && jours.length) {
    if (jours.indexOf(jour) < 0) throw refus('Ce jour ne fait pas partie de la programmation.');
    const reste = jours.filter(j => j !== jour);
    requetes = reste.length
      ? [db.prepare(`UPDATE diffusions SET jours = ?, debut = ?, fin = ?, ${maj} WHERE id = ?`).bind(JSON.stringify(reste), reste[0], reste[reste.length - 1], id)]
      : supprimer;
  } else {
    if (jour < d.debut || jour > d.fin) throw refus('Ce jour est en dehors de la programmation.');
    if (d.debut === d.fin) requetes = supprimer;
    else if (jour === d.debut) requetes = [db.prepare(`UPDATE diffusions SET debut = ?, ${maj} WHERE id = ?`).bind(jourPlus(jour, 1), id)];
    else if (jour === d.fin) requetes = [db.prepare(`UPDATE diffusions SET fin = ?, ${maj} WHERE id = ?`).bind(jourPlus(jour, -1), id)];
    else {
      // Coupure : la programmation s'arrête la veille, une copie reprend le lendemain sur les mêmes écrans.
      const nid = nouvelId('d');
      requetes = [
        db.prepare(`UPDATE diffusions SET fin = ?, ${maj} WHERE id = ?`).bind(jourPlus(jour, -1), id),
        db.prepare('INSERT INTO diffusions (id, contenu_id, debut, fin, jours, semaine, plages, prioritaire, ordre) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)')
          .bind(nid, d.contenu_id, jourPlus(jour, 1), d.fin, d.semaine, d.plages, d.prioritaire, d.ordre),
        db.prepare('INSERT INTO diffusion_flux (diffusion_id, flux_code) SELECT ?, flux_code FROM diffusion_flux WHERE diffusion_id = ?').bind(nid, id)
      ];
    }
  }
  await ecrire(env, qui, requetes, 'Jour retiré d’une programmation', d.titre + ' (' + jour + ')');
  return json({ ok: true });
}

// Retire un contenu de la boucle d'un écran : cet écran est enlevé de toutes les programmations
// de ce contenu qui ne sont pas terminées ; une programmation sans autre écran disparaît. Les autres écrans ne changent pas.
async function retirerEcran(req, env, qui) {
  const b = await lireCorps(req);
  const contenu = await lireContenu(env, String(b.contenu || ''));
  const code = String(b.flux || '');
  const f = CODE_VALIDE.test(code) && await env.DB.prepare('SELECT nom FROM flux WHERE code = ?').bind(code).first();
  if (!f) throw new ErreurHttp(404, 'Écran inconnu.');
  const { results } = await env.DB.prepare(
    `SELECT d.id, (SELECT COUNT(*) FROM diffusion_flux x WHERE x.diffusion_id = d.id) AS n
       FROM diffusions d JOIN diffusion_flux df ON df.diffusion_id = d.id
      WHERE d.contenu_id = ? AND df.flux_code = ? AND d.fin >= ?`
  ).bind(contenu.id, code, jourDeService()).all();
  if (!results.length) throw refus('Ce contenu n’est pas programmé sur cet écran.');
  const requetes = [];
  for (const d of results) {
    requetes.push(env.DB.prepare('DELETE FROM diffusion_flux WHERE diffusion_id = ? AND flux_code = ?').bind(d.id, code));
    if (d.n <= 1) requetes.push(env.DB.prepare('DELETE FROM diffusions WHERE id = ?').bind(d.id));
  }
  await ecrire(env, qui, requetes, 'Contenu retiré d’un écran', contenu.titre + ' → ' + f.nom);
  return json({ ok: true, programmations: results.length });
}

// Ordre de la boucle : la liste des diffusions dans l'ordre voulu (1, 2, 3…).
async function ordonner(req, env, qui) {
  const b = await lireCorps(req);
  const ids = Array.isArray(b.ordre) ? b.ordre.map(String).filter(x => ID_VALIDE.test(x)).slice(0, 300) : [];
  if (!ids.length) throw refus('Ordre vide.');
  await ecrire(env, qui, ids.map((x, i) => env.DB.prepare('UPDATE diffusions SET ordre = ? WHERE id = ?').bind(i + 1, x)),
    'Ordre de la boucle modifié', b.flux ? 'flux ' + String(b.flux).slice(0, 40) : null);
  return json({ ok: true });
}

/* ---- flux ---- */
async function modifierFlux(req, env, qui, code) {
  const b = await lireCorps(req);
  const f = await env.DB.prepare('SELECT * FROM flux WHERE code = ?').bind(code).first();
  if (!f) throw new ErreurHttp(404, 'Flux inconnu.');
  const nom = chaine(b.nom, 40, 'nom de l’écran') || f.nom;
  let defaut = b.contenu_defaut ? String(b.contenu_defaut) : null;
  if (defaut) await lireContenu(env, defaut);
  await ecrire(env, qui, [env.DB.prepare('UPDATE flux SET nom = ?, contenu_defaut = ? WHERE code = ?').bind(nom, defaut, code)],
    'Écran modifié', nom + (nom !== f.nom ? ' (ancien nom : ' + f.nom + ')' : ''));
  return json({ ok: true });
}
// L'écran affiche le nom de son flux pendant environ 30 s (il interroge toutes les 30 s).
async function identifier(env, qui, code) {
  const jusqua = Date.now() + 60000;
  const r = code === 'tous'
    ? await env.DB.prepare('UPDATE flux SET identifier_jusqua = ?').bind(jusqua).run()
    : await env.DB.prepare('UPDATE flux SET identifier_jusqua = ? WHERE code = ?').bind(jusqua, code).run();
  if (!r.meta.changes) throw new ErreurHttp(404, 'Flux inconnu.');
  await noter(env, qui, 'Identification des écrans', code === 'tous' ? 'tous' : code).run();
  return json({ ok: true, jusqua });
}

/* ---- médias : import d'un fichier (corps brut) vers R2 ---- */
async function importerMedia(req, env, qui) {
  if (!env.MEDIAS) throw new ErreurHttp(503, 'Le stockage des médias (Cloudflare R2) n’est pas encore activé.');
  const type = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = MEDIAS_TYPES[type];
  if (!ext) throw new ErreurHttp(415, 'Format de fichier non accepté : JPEG, PNG, WebP, MP4 ou MOV.');
  const taille = parseInt(req.headers.get('Content-Length'), 10) || 0;
  if (taille > MEDIAS_MAX) throw new ErreurHttp(413, 'Fichier trop lourd (100 Mo au plus).');
  let nomOrigine = '';
  try { nomOrigine = decodeURIComponent(req.headers.get('X-Nom') || '').slice(0, 120); } catch { nomOrigine = ''; }
  const mois = dateParis(Date.now()).slice(0, 7);
  const cle = 'm/' + mois + '/' + crypto.randomUUID().replace(/-/g, '').slice(0, 16) + '.' + ext;
  const objet = await env.MEDIAS.put(cle, req.body, { httpMetadata: { contentType: type }, customMetadata: { nom: nomOrigine, par: qui.nom } });
  if (objet.size > MEDIAS_MAX) { await env.MEDIAS.delete(cle); throw new ErreurHttp(413, 'Fichier trop lourd (100 Mo au plus).'); }
  return json({ src: '/medias/' + cle, taille: objet.size, type });
}
