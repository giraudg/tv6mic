/* Écrans TV 6MIC : Worker Cloudflare.
   - /api/flux                 GET  : liste des flux (code, nom)
   - /api/flux/{code}          GET  : programmation du flux (JSON)
                               POST : idem, le corps porte l'état de l'écran (signal), enregistré dans D1
   - /api/sante                GET  : vérification rapide
   Tout le reste est servi depuis public/ (lecteur, diagnostic, médias d'essai). */

const JSON_EN_TETES = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const CODE_VALIDE = /^[a-z0-9-]{1,40}$/;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
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
      if (p.startsWith('/api/')) return json({ erreur: 'Adresse inconnue' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error('erreur', p, e && e.stack || e);
      return json({ erreur: 'Erreur interne' }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_EN_TETES });
}

// Date du jour à Paris, décalée de n jours (AAAA-MM-JJ).
function dateParis(ms) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function lireJSON(texte, defaut) {
  if (texte === null || texte === undefined || texte === '') return defaut;
  try { return JSON.parse(texte); } catch { return defaut; }
}

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
      `SELECT id, type, titre, donnees, duree, modifie_le FROM contenus WHERE id IN (${lot.map(() => '?').join(',')})`
    ).bind(...lot).all();
    for (const c of results) {
      contenus[c.id] = { id: c.id, type: c.type, titre: c.titre, donnees: lireJSON(c.donnees, {}), duree: c.duree, modifie_le: c.modifie_le };
    }
  }
  const diffusions = lignes.map(l => ({
    id: l.id, contenu: l.contenu_id, debut: l.debut, fin: l.fin,
    jours: lireJSON(l.jours, null), semaine: lireJSON(l.semaine, null), plages: lireJSON(l.plages, null),
    prioritaire: l.prioritaire ? 1 : 0, ordre: l.ordre || 0, cree_le: l.cree_le, modifie_le: l.modifie_le
  }));

  return json({ ...base, defaut: flux.contenu_defaut && contenus[flux.contenu_defaut] ? flux.contenu_defaut : null, contenus, diffusions });
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
