// Décisions de la surveillance des écrans (src/surveillance.mjs) : quand alerter, quand se taire.
const test = require('node:test');
const assert = require('node:assert');

const M = 60e3, T = Date.parse('2026-11-09T08:00:00Z');
const ecran = (code, silenceMin, extra) => Object.assign({ flux_code: code, nom: code, contact_le: T - silenceMin * M, vu_le: null, erreur: null }, extra);
let S;
test.before(async () => { S = await import('../src/surveillance.mjs'); });

test('un écran muet alors que d\'autres tournent depuis longtemps : une alerte', () => {
  const r = S.decider({ maintenant: T, ecrans: [ecran('hall', 40), ecran('club', 1), ecran('regie', 0), ecran('billetterie', 2)] });
  assert.strictEqual(r.ouvrir.length, 1);
  assert.strictEqual(r.ouvrir[0].type, 'muet');
  assert.strictEqual(r.ouvrir[0].ecran.flux_code, 'hall');
  assert.deepStrictEqual(r.ouvrir[0].temoins, ['club', 'regie', 'billetterie']);
});

test('pas d\'alerte la nuit (tout est éteint), ni juste après l\'allumage, ni pour moins de 15 min', () => {
  const nuit = S.decider({ maintenant: T, ecrans: [ecran('hall', 500), ecran('club', 480), ecran('regie', 490)] });
  assert.strictEqual(nuit.ouvrir.length, 0);
  // les autres viennent d'être rallumés (retour il y a 5 min) : on attend qu'ils tournent depuis 15 min
  const allumage = S.decider({ maintenant: T, ecrans: [ecran('hall', 600), ecran('club', 0), ecran('regie', 1)],
    retours: { club: T - 5 * M, regie: T - 6 * M } });
  assert.strictEqual(allumage.ouvrir.length, 0);
  const court = S.decider({ maintenant: T, ecrans: [ecran('hall', 10), ecran('club', 0), ecran('regie', 1)] });
  assert.strictEqual(court.ouvrir.length, 0);
});

test('les écrans du bar ne servent pas de témoins aux écrans du hall, et inversement', () => {
  const r = S.decider({ maintenant: T, ecrans: [ecran('hall', 40), ecran('club', 1), ecran('bar-1', 0), ecran('bar-2', 0)] });
  assert.strictEqual(r.ouvrir.length, 0, 'un seul témoin du hall');
  const b = S.decider({ maintenant: T, ecrans: [ecran('bar-3', 30), ecran('bar-1', 0), ecran('bar-2', 1), ecran('hall', 0)] });
  assert.strictEqual(b.ouvrir.length, 1);
});

test('une seule alerte par coupure, levée au retour de l\'écran', () => {
  const ouvertes = [{ id: 7, flux_code: 'hall', type: 'muet', debut: T - 60 * M }];
  const pendant = S.decider({ maintenant: T, ouvertes, ecrans: [ecran('hall', 60), ecran('club', 0), ecran('regie', 0)] });
  assert.strictEqual(pendant.ouvrir.length, 0);
  assert.strictEqual(pendant.fermer.length, 0);
  const retour = S.decider({ maintenant: T, ouvertes, ecrans: [ecran('hall', 0), ecran('club', 0), ecran('regie', 0)] });
  assert.strictEqual(retour.fermer.length, 1);
  assert.strictEqual(retour.fermer[0].alerte.id, 7);
});

test('erreur grave d\'un lecteur : une alerte, puis plus rien pendant 6 h', () => {
  const ecrans = [ecran('regie', 0, { erreur: '09:40:00 affichage bloqué sur c-x depuis 95 s : relancé' }), ecran('club', 0, { erreur: '09:41:00 réseau : serveur injoignable' })];
  const r = S.decider({ maintenant: T, ecrans });
  assert.strictEqual(r.ouvrir.length, 1, 'une erreur réseau seule ne suffit pas');
  assert.strictEqual(r.ouvrir[0].type, 'erreur');
  const ensuite = S.decider({ maintenant: T, ecrans, erreursRecentes: { regie: T - 2 * 3600e3 } });
  assert.strictEqual(ensuite.ouvrir.length, 0);
});

test('les messages disent quel écran, depuis quand, et quels écrans fonctionnent', () => {
  const m = S.message({ type: 'muet', ecran: { flux_code: 'hall', nom: 'Hall' }, depuis: T - 75 * M, temoins: ['Club', 'Régie'] }, T);
  assert.match(m.sujet, /Hall : plus de contact depuis 1 h 15/);
  assert.match(m.texte, /alors que Club et Régie fonctionnent/);
  assert.match(m.texte, /lundi 9 novembre à 07 h 45|lundi 9 novembre 07 h 45/);
  assert.strictEqual(S.duree(3 * 86400e3), '3 jours');
});
