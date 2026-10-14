// Les fichiers chargés par les écrans doivent rester en ES5 (Chromium 56) et le CSS
// ne doit pas employer ce que ce moteur ignore (grid, gap, aspect-ratio, inset…).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const racine = path.join(__dirname, '..', 'public');
const SCRIPTS = ['lecteur/regles.js', 'lecteur/gabarits.js', 'lecteur/lecteur.js', 'vendor/qrcode.js', 'sw.js'];

for (const f of SCRIPTS) {
  test('ES5 : ' + f, () => {
    const code = fs.readFileSync(path.join(racine, f), 'utf8');
    assert.doesNotThrow(() => acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' }));
  });
}

test('ES5 : scripts en ligne de index.html', () => {
  const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
  const blocs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocs.length > 0);
  for (const b of blocs) acorn.parse(b, { ecmaVersion: 5, sourceType: 'script' });
});

test('CSS compatible Chromium 56', () => {
  const css = ['lecteur/lecteur.css', 'lecteur/gabarits.css'].map(f => fs.readFileSync(path.join(racine, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const interdits = [/display\s*:\s*grid/, /(^|[;{\s])gap\s*:/, /aspect-ratio/, /(^|[;{\s])inset\s*:/, /clamp\(/, /:is\(/, /:where\(/, /backdrop-filter/];
  for (const r of interdits) assert.ok(!r.test(css), 'propriété non prise en charge : ' + r);
});
