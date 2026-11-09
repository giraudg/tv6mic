/* Surveillance des écrans (tâche planifiée, toutes les 5 minutes) : un e-mail quand un écran se tait alors que
   d'autres écrans de sa famille fonctionnent, un autre quand il revient, et un quand un lecteur signale une erreur
   grave (démarrage, affichage bloqué). Après le Hall resté noir trois jours sans que personne ne soit prévenu
   (6-9 nov. 2026). Une seule alerte par coupure ; les erreurs graves, une fois toutes les 6 h par écran au plus.
   Envoi par Resend : secrets RESEND_API_KEY et ALERTES_A (adresses séparées par des virgules), posés dans le
   tableau de bord Cloudflare. Sans eux, les alertes sont seulement notées dans le Journal. */

export const VIVANT = 3 * 60e3;     // un écran qui a parlé il y a moins de 3 min est en route
export const MUET = 15 * 60e3;      // silence au-delà duquel on alerte
export const STABLE = 15 * 60e3;    // les écrans témoins doivent tourner depuis au moins 15 min (pas d'alerte à l'allumage)
const ERREUR_RECENTE = 6 * 3600e3;
const ERREURS_GRAVES = /démarrage|affichage bloqué|chien de garde|vérification :|programmation reçue|JS /;
const EXPEDITEUR = 'Écrans 6MIC <alertes@notifications.6mic-aix.fr>';
const BACK_OFFICE = 'https://tv.6mic-aix.fr/admin/';

export const famille = code => /^bar-/.test(code) ? 'bar' : 'hall';
const dernierContact = e => e.contact_le || e.vu_le || 0;

/* Décision, sans effet de bord (testée seule) :
   ecrans : [{ flux_code, nom, contact_le, vu_le, erreur }] ; retours : { flux_code: dernier retour après silence (ms) } ;
   ouvertes : alertes « muet » encore ouvertes ; erreursRecentes : { flux_code: ms de la dernière alerte d'erreur }. */
export function decider({ ecrans, retours = {}, ouvertes = [], erreursRecentes = {}, maintenant }) {
  const ouvrir = [], fermer = [];
  const vivants = ecrans.filter(e => maintenant - dernierContact(e) < VIVANT);
  for (const e of ecrans) {
    const d = dernierContact(e);
    if (!d) continue;                                        // jamais vu (flux de réserve)
    const ouverte = ouvertes.find(a => a.flux_code === e.flux_code && a.type === 'muet');
    if (maintenant - d < VIVANT) { if (ouverte) fermer.push({ alerte: ouverte, ecran: e }); continue; }
    if (ouverte || maintenant - d < MUET) continue;
    const temoins = vivants.filter(o => o.flux_code !== e.flux_code && famille(o.flux_code) === famille(e.flux_code)
      && maintenant - (retours[o.flux_code] || 0) > STABLE);
    if (temoins.length >= 2) ouvrir.push({ type: 'muet', ecran: e, depuis: d, temoins: temoins.map(o => o.nom || o.flux_code) });
  }
  for (const e of vivants) {
    if (!ERREURS_GRAVES.test(e.erreur || '')) continue;
    if (erreursRecentes[e.flux_code] && maintenant - erreursRecentes[e.flux_code] < ERREUR_RECENTE) continue;
    ouvrir.push({ type: 'erreur', ecran: e, depuis: maintenant, detail: e.erreur });
  }
  return { ouvrir, fermer };
}

// ---------- textes ----------
const heure = ms => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', ' h ');
export function duree(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 60) return m + ' min';
  if (m < 48 * 60) return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  return Math.round(m / 1440) + ' jours';
}
const liste = l => l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1];
export function message(action, maintenant) {
  const nom = action.ecran.nom || action.ecran.flux_code;
  if (action.type === 'muet') {
    return {
      sujet: `Écran ${nom} : plus de contact depuis ${duree(maintenant - action.depuis)}`,
      texte: `L'écran ${nom} n'a plus contacté le serveur depuis ${heure(action.depuis)}, soit ${duree(maintenant - action.depuis)}, `
        + `alors que ${liste(action.temoins)} fonctionnent normalement.\n\n`
        + `À vérifier sur place : l'écran est-il allumé, sur la bonne source (MagicINFO pour les écrans du hall), et relié au réseau ? `
        + `Le plus souvent, l'éteindre puis le rallumer suffit.\n\n`
        + `S'il est éteint volontairement, ignorez ce message : une seule alerte est envoyée par coupure, et un message vous préviendra quand il reviendra.\n\n`
        + `État des écrans : ${BACK_OFFICE}`
    };
  }
  if (action.type === 'retour') {
    return {
      sujet: `Écran ${nom} : de nouveau en ligne`,
      texte: `L'écran ${nom} contacte de nouveau le serveur, après une coupure de ${duree(maintenant - action.depuis)} (depuis ${heure(action.depuis)}).\n\n`
        + `Le détail est dans le Journal du back-office, section « Connexions des écrans » : ${BACK_OFFICE}`
    };
  }
  if (action.type === 'erreur') {
    return {
      sujet: `Écran ${nom} : erreur du lecteur`,
      texte: `Le lecteur de l'écran ${nom} signale une erreur :\n\n${action.detail}\n\n`
        + `L'écran continue normalement de contacter le serveur ; si l'affichage semble anormal, éteignez-le puis rallumez-le. `
        + `Pas d'autre message pour cet écran pendant 6 heures.\n\nÉtat des écrans : ${BACK_OFFICE}`
    };
  }
  return {
    sujet: 'Alertes des écrans activées',
    texte: `Les alertes des écrans TV du 6MIC arrivent désormais à cette adresse.\n\n`
      + `Vous serez prévenu quand un écran ne contacte plus le serveur depuis 15 minutes alors que d'autres écrans fonctionnent, `
      + `quand il revient, et quand un lecteur signale une erreur grave. Une seule alerte par coupure.\n\nÉtat des écrans : ${BACK_OFFICE}`
  };
}

async function envoyer(env, m) {
  const a = String(env.ALERTES_A || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!env.RESEND_API_KEY || !a.length) return 'non envoyé (clé Resend ou destinataires absents)';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EXPEDITEUR, to: a, subject: m.sujet, text: m.texte })
  });
  if (!r.ok) return 'échec de l’envoi (' + r.status + ' ' + (await r.text()).slice(0, 120) + ')';
  return 'e-mail envoyé';
}

export async function surveiller(env, maintenant = Date.now()) {
  const db = env.DB;
  const [ecrans, retours, ouvertes, erreurs, active] = await Promise.all([
    db.prepare('SELECT e.flux_code, f.nom, e.contact_le, e.vu_le, e.erreur FROM ecrans e LEFT JOIN flux f ON f.code = e.flux_code').all(),
    db.prepare("SELECT flux_code, MAX(quand) AS q FROM ecrans_historique WHERE evenement = 'retour' AND quand > ? GROUP BY flux_code").bind(maintenant - 2 * 86400e3).all(),
    db.prepare("SELECT id, flux_code, type, debut FROM alertes WHERE fin IS NULL").all(),
    db.prepare("SELECT flux_code, MAX(debut) AS q FROM alertes WHERE type = 'erreur' AND debut > ? GROUP BY flux_code").bind(maintenant - ERREUR_RECENTE).all(),
    db.prepare("SELECT valeur FROM meta WHERE cle = 'alertes_activees'").first('valeur')
  ]);
  const parCode = l => Object.fromEntries(l.results.map(x => [x.flux_code, x.q]));
  const { ouvrir, fermer } = decider({ ecrans: ecrans.results, retours: parCode(retours), ouvertes: ouvertes.results, erreursRecentes: parCode(erreurs), maintenant });
  const ecritures = [];
  const journal = (action, detail) => ecritures.push(db.prepare('INSERT INTO journal (qui, action, detail) VALUES (?, ?, ?)').bind('Surveillance', action, String(detail).slice(0, 500)));
  // première fois que l'envoi est possible : un message de confirmation
  if (!active && env.RESEND_API_KEY && env.ALERTES_A) {
    const r = await envoyer(env, message({ type: 'activation', ecran: {} }, maintenant));
    journal('Alertes activées', r);
    if (r === 'e-mail envoyé') ecritures.push(db.prepare("INSERT OR REPLACE INTO meta (cle, valeur) VALUES ('alertes_activees', '1')"));
  }
  for (const a of ouvrir) {
    const r = await envoyer(env, message(a, maintenant));
    const nom = a.ecran.nom || a.ecran.flux_code;
    ecritures.push(db.prepare('INSERT INTO alertes (flux_code, type, debut, fin, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(a.ecran.flux_code, a.type, a.type === 'erreur' ? maintenant : a.depuis, a.type === 'erreur' ? maintenant : null, String(a.detail || a.temoins.join(', ')).slice(0, 300)));
    journal(a.type === 'muet' ? 'Alerte : écran muet' : 'Alerte : erreur du lecteur', nom + ' · ' + r);
  }
  for (const f of fermer) {
    const r = await envoyer(env, message({ type: 'retour', ecran: f.ecran, depuis: f.alerte.debut }, maintenant));
    ecritures.push(db.prepare('UPDATE alertes SET fin = ? WHERE id = ?').bind(maintenant, f.alerte.id));
    journal('Alerte levée : écran revenu', (f.ecran.nom || f.ecran.flux_code) + ' · ' + r);
  }
  if (ecritures.length) await db.batch(ecritures);
  return { ouvrir: ouvrir.length, fermer: fermer.length };
}
