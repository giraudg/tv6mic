// Tests des règles de programmation (public/lecteur/regles.js) : node --test test/
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/lecteur/regles.js');

// Instant UTC correspondant à une heure de Paris donnée.
function paris(date, hhmm) {
  const [a, m, j] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  let ms = Date.UTC(a, m - 1, j, h, mi);
  ms -= R.decalageParis(ms - 3600000) * 60000;
  return ms;
}
function contenu(id, type, donnees, extra) { return Object.assign({ id, type, titre: id, donnees: donnees || {} }, extra); }
function diff(id, contenuId, extra) { return Object.assign({ id, contenu: contenuId, debut: '2026-10-01', fin: '2026-12-31', ordre: 0 }, extra); }
function cles(prog, date, hhmm) { return R.etapes(prog, paris(date, hhmm)).etapes.map(e => e.cle); }

test('heure de Paris : été, hiver et changements d\'heure', () => {
  assert.deepStrictEqual(R.heureParis(Date.UTC(2026, 9, 13, 12, 0)).date, '2026-10-13');
  assert.strictEqual(R.heureParis(Date.UTC(2026, 9, 13, 12, 0)).minutes, 14 * 60);      // UTC+2
  assert.strictEqual(R.heureParis(Date.UTC(2026, 11, 1, 12, 0)).minutes, 13 * 60);      // UTC+1
  assert.strictEqual(R.decalageParis(Date.UTC(2026, 9, 25, 0, 59)), 120);              // 25 octobre 2026, avant 1 h UTC
  assert.strictEqual(R.decalageParis(Date.UTC(2026, 9, 25, 1, 0)), 60);
  assert.strictEqual(R.decalageParis(Date.UTC(2027, 2, 28, 1, 0)), 120);               // 28 mars 2027
  assert.strictEqual(R.heureParis(Date.UTC(2026, 9, 13, 22, 30)).date, '2026-10-14');  // 0 h 30 à Paris
  assert.strictEqual(R.heureParis(Date.UTC(2026, 9, 13, 12, 0)).semaine, 2);           // mardi
});

test('période, jours choisis et jours de la semaine', () => {
  const prog = {
    contenus: { a: contenu('a', 'image', { src: '/a.jpg' }), b: contenu('b', 'image', { src: '/b.jpg' }), c: contenu('c', 'image', { src: '/c.jpg' }) },
    diffusions: [
      diff('1', 'a', { debut: '2026-10-10', fin: '2026-10-20' }),
      diff('2', 'b', { jours: ['2026-10-14', '2026-10-16'] }),
      diff('3', 'c', { semaine: [5, 6] })
    ]
  };
  assert.deepStrictEqual(cles(prog, '2026-10-14', '12:00'), ['a', 'b']);     // mercredi
  assert.deepStrictEqual(cles(prog, '2026-10-16', '12:00'), ['a', 'b', 'c']); // vendredi
  assert.deepStrictEqual(cles(prog, '2026-10-21', '12:00'), ['veille']);      // mercredi, hors période
});

test('plages horaires, y compris après minuit', () => {
  const prog = {
    contenus: { a: contenu('a', 'image', { src: '/a.jpg' }) },
    diffusions: [diff('1', 'a', { debut: '2026-10-16', fin: '2026-10-16', plages: [['20:00', '02:00']] })]
  };
  assert.deepStrictEqual(cles(prog, '2026-10-16', '19:59'), ['veille']);
  assert.deepStrictEqual(cles(prog, '2026-10-16', '20:00'), ['a']);
  assert.deepStrictEqual(cles(prog, '2026-10-17', '01:59'), ['a']);   // la nuit appartient au 16
  assert.deepStrictEqual(cles(prog, '2026-10-17', '02:00'), ['veille']);
  assert.deepStrictEqual(cles(prog, '2026-10-17', '21:00'), ['veille']); // le 17 n'est pas dans la diffusion
});

test('ordre : manuel, puis soirées par date, puis ordre d\'ajout', () => {
  const prog = {
    contenus: {
      s1: contenu('s1', 'soiree', { nom: 'Un', date: '2026-11-20' }),
      s2: contenu('s2', 'soiree', { nom: 'Deux', date: '2026-10-30' }),
      i: contenu('i', 'image', { src: '/i.jpg' }),
      v: contenu('v', 'video', { src: '/v.mp4', duree: 8 }),
      m: contenu('m', 'image', { src: '/m.jpg' })
    },
    diffusions: [
      diff('1', 's1', { cree_le: '2026-10-01T10:00' }), diff('2', 'i', { cree_le: '2026-10-01T09:00' }),
      diff('3', 's2', { cree_le: '2026-10-01T11:00' }), diff('4', 'v', { cree_le: '2026-10-01T08:00' }),
      diff('5', 'm', { ordre: 1 })
    ]
  };
  assert.deepStrictEqual(cles(prog, '2026-10-20', '12:00'), ['m', 's2', 's1', 'v', 'i']);
});

test('sans plage horaire, la journée va de 6 h à 6 h', () => {
  const prog = {
    contenus: { a: contenu('a', 'image', { src: '/a.jpg' }), b: contenu('b', 'image', { src: '/b.jpg' }) },
    diffusions: [diff('1', 'a', { debut: '2026-10-24', fin: '2026-10-24' }), diff('2', 'b', { debut: '2026-10-25', fin: '2026-10-25' })]
  };
  assert.deepStrictEqual(cles(prog, '2026-10-24', '05:59'), ['veille']);
  assert.deepStrictEqual(cles(prog, '2026-10-24', '06:00'), ['a']);
  assert.deepStrictEqual(cles(prog, '2026-10-25', '00:30'), ['a']);   // la soirée du 24 continue
  assert.deepStrictEqual(cles(prog, '2026-10-25', '06:00'), ['b']);
});

test('contenu par défaut inutilisable : écran de veille', () => {
  const prog = { defaut: 'd', contenus: { d: contenu('d', 'video', {}) }, diffusions: [] };
  assert.deepStrictEqual(cles(prog, '2026-10-24', '12:00'), ['veille']);
});

test('une soirée s\'arrête après le concert (bascule à 6 h)', () => {
  const prog = { contenus: { s: contenu('s', 'soiree', { nom: 'X', date: '2026-10-24' }) }, diffusions: [diff('1', 's')] };
  assert.deepStrictEqual(cles(prog, '2026-10-24', '23:00'), ['s']);
  assert.deepStrictEqual(cles(prog, '2026-10-25', '02:00'), ['s']);
  assert.deepStrictEqual(cles(prog, '2026-10-25', '06:00'), ['veille']);
});

test('agenda : dates passées masquées, 8 dates par page', () => {
  const dates = [];
  for (let j = 10; j < 20; j++) dates.push({ date: '2026-10-' + j, nom: 'Concert ' + j });
  const prog = { contenus: { ag: contenu('ag', 'agenda', { titre: 'Agenda', dates }) }, diffusions: [diff('1', 'ag')] };
  let r = R.etapes(prog, paris('2026-10-10', '12:00')).etapes;
  assert.deepStrictEqual(r.map(e => e.cle), ['ag#1', 'ag#2']);
  assert.strictEqual(r[0].dates.length, 5);   // 10 dates : deux pages de 5
  assert.strictEqual(r[1].dates.length, 5);
  r = R.etapes(prog, paris('2026-10-13', '12:00')).etapes;
  assert.deepStrictEqual(r.map(e => e.cle), ['ag#1']);
  assert.strictEqual(r[0].dates[0].date, '2026-10-13');
  assert.deepStrictEqual(cles(prog, '2026-10-20', '12:00'), ['veille']);
});

test('une diffusion prioritaire remplace la boucle, la plus récente l\'emporte', () => {
  const prog = {
    contenus: { a: contenu('a', 'image', { src: '/a.jpg' }), p1: contenu('p1', 'image', { src: '/p1.jpg' }), p2: contenu('p2', 'image', { src: '/p2.jpg' }) },
    diffusions: [
      diff('1', 'a'),
      diff('2', 'p1', { prioritaire: 1, plages: [['19:30', '23:00']], modifie_le: '2026-10-02' }),
      diff('3', 'p2', { prioritaire: 1, plages: [['20:00', '21:00']], modifie_le: '2026-10-05' })
    ]
  };
  const r = R.etapes(prog, paris('2026-10-16', '19:45'));
  assert.strictEqual(r.prioritaire, true);
  assert.deepStrictEqual(r.etapes.map(e => e.cle), ['p1']);
  assert.deepStrictEqual(cles(prog, '2026-10-16', '20:30'), ['p2']);
  assert.deepStrictEqual(cles(prog, '2026-10-16', '18:00'), ['a']);
});

test('contenu par défaut, sinon écran de veille ; durées', () => {
  const prog = { defaut: 'd', contenus: { d: contenu('d', 'image', { src: '/d.jpg' }), v: contenu('v', 'video', { src: '/v.mp4', duree: 12 }) }, diffusions: [diff('1', 'v', { debut: '2026-12-01' })] };
  let r = R.etapes(prog, paris('2026-10-16', '12:00')).etapes;
  assert.strictEqual(r[0].cle, 'd');
  assert.strictEqual(r[0].duree, 8);
  r = R.etapes(prog, paris('2026-12-02', '12:00')).etapes;
  assert.strictEqual(r[0].duree, 12);
  assert.deepStrictEqual(R.etapes({ contenus: {}, diffusions: [] }, Date.now()).etapes.map(e => e.cle), ['veille']);
  assert.deepStrictEqual(R.etapes(null, Date.now()).etapes.map(e => e.cle), ['veille']);
});

test('suivante : boucle, reprise après rechargement, étape disparue', () => {
  const l = [{ cle: 'a' }, { cle: 'b' }, { cle: 'ag#1', contenu: { id: 'ag' } }];
  assert.strictEqual(R.suivante(l, 'a').cle, 'b');
  assert.strictEqual(R.suivante(l, 'ag#1').cle, 'a');
  assert.strictEqual(R.suivante(l, 'ag#2').cle, 'ag#1');
  assert.strictEqual(R.suivante(l, 'inconnue').cle, 'a');
  assert.strictEqual(R.suivante(l, null).cle, 'a');
});

test('série : dates passées retirées, 4 au plus, jour de service transmis, masquée sans date à venir', () => {
  const dates = [
    { date: '2026-11-02', nom: 'passée' }, { date: '2026-11-10', nom: 'ce soir' }, { date: '2026-11-11', nom: 'demain' },
    { date: '2026-11-20', nom: 'c' }, { date: '2026-11-25', nom: 'd' }, { date: '2026-11-30', nom: 'e' }];
  const prog = { contenus: { s: contenu('s', 'serie', { titre: 'Série', dates }) }, diffusions: [diff('d1', 's')] };
  // 1 h du matin le 11 : la journée de service est encore le 10 (une journée va de 6 h à 6 h)
  const e = R.etapes(prog, paris('2026-11-11', '01:00')).etapes[0];
  assert.strictEqual(e.type, 'serie');
  assert.strictEqual(e.service, '2026-11-10');
  assert.deepStrictEqual(e.dates.map(x => x.nom), ['ce soir', 'demain', 'c', 'd']);
  assert.strictEqual(e.duree, R.DUREES.serie);
  const passee = { contenus: { s: contenu('s', 'serie', { dates: [{ date: '2026-10-02' }] }) }, diffusions: [diff('d1', 's')] };
  assert.deepStrictEqual(cles(passee, '2026-11-10', '12:00'), ['veille']);
});
