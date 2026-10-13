# Écrans TV 6MIC

Affichage dynamique des écrans Samsung du 6MIC (Aix-en-Provence) : chaque écran lit en continu un flux,
dont la programmation se règle à la journée ou à l'heure. Cahier des charges : document « Écrans TV 6MIC — Cahier des charges ».

| Adresse | Rôle |
| --- | --- |
| `https://tv.6mic-aix.fr/?flux=billetterie` | Lecteur de l'écran Billetterie (idem `club`, `hall`, `grande-salle`, `regie`, `reserve`) |
| `https://tv.6mic-aix.fr/` | Liste des flux (pour tester sur un ordinateur) |
| `/api/flux` | Liste des flux (JSON) |
| `/api/flux/{code}` | Programmation d'un flux (JSON) ; en `POST`, le lecteur y joint l'état de l'écran |
| `/test.html` | Page de test de l'écran (compteur d'ouvertures), puis diagnostic ; `?stay=1` reste sur la page |
| `/diagnostic/` | Diagnostic complet des écrans (version 8) |

Options du lecteur : `&debug=1` affiche le suivi technique en bas à droite, `&ident=1` affiche le nom du flux pendant 20 s.

## Lot 1 (en cours) : le lecteur

- **Écrans** : Samsung QM55R, Tizen 4.0, Chromium 56, ouverts par MagicINFO Lite (widget Flux Web, un programme fixe par écran).
  Le lecteur est en ES5 sans framework ; la scène 1920 × 1080 est réduite par `zoom` (un `transform: scale` ne s'affiche pas).
- **Boucle** : les étapes actives du flux tournent avec un fondu de 0,6 s ; les règles (période, jours, jours de la semaine,
  plages horaires passant minuit, priorité, ordre, contenu par défaut) sont dans `public/lecteur/regles.js`.
- **Vidéo** : deux lecteurs vidéo en alternance, la vidéo suivante préparée pendant que l'autre joue (4 ms d'écart mesurés
  dans MagicINFO) ; repli automatique sur un seul lecteur si le second échoue.
- **Mémoire** : les médias des 2 prochains jours sont gardés dans le stockage de l'écran (Cache API, 150 Mo au plus).
  Au-delà, ils sont lus depuis le réseau.
- **Résistance** : reprise à l'étape suivante après un rechargement de la page par MagicINFO ; sans réseau, la dernière
  programmation continue de tourner ; rechargement automatique chaque nuit vers 5 h ; un Service Worker garde une copie du lecteur.
- **Supervision** : à chaque interrogation (toutes les 30 s), l'écran envoie son état, enregistré dans la table `ecrans`.

Gabarits (`public/lecteur/gabarits.js`, partagés avec le futur back-office) :

| Type | Données (`contenus.donnees`, JSON) | Durée par défaut |
| --- | --- | --- |
| `soiree` | `nom`, `date` (AAAA-MM-JJ), `heure` (HH:MM), `photo.src`, `infos` (lignes séparées par `\n`), `mention`, `billetterie` (URL → QR code) | 10 s |
| `agenda` | `titre`, `dates` : liste de `{ date, nom, mention }`, `photo.src` facultative ; 8 dates au plus par page | 15 s par page |
| `image` | `src`, `ajustement` (`remplir` ou `ajuster`) | 8 s |
| `video` | `src`, `poster`, `duree` (s), `taille` (octets), `son` (booléen) | durée de la vidéo |

Format vidéo lu sans conversion : MP4, H.264 profil High niveau 4.0, 1920 × 1080, 30 i/s constants, 4:2:0 8 bits,
environ 5 Mbit/s, AAC ou sans son, option « fast start ».

## Architecture

- **Cloudflare Workers** avec ressources statiques : `public/` est servi tel quel, `src/worker.js` gère l'API.
- **Cloudflare D1** (base `tv-6mic`) : `flux`, `contenus`, `diffusions`, `diffusion_flux`, `ecrans`, `journal`, `meta`
  (`version` de la programmation, à incrémenter à chaque modification pour que les écrans la rechargent).
- **Médias** : pour le lot 1, fichiers d'essai dans `public/test-medias/`. Au lot 2, imports dans Cloudflare R2, servis sous `/medias/`.

## Mise en ligne (une seule fois)

1. Cloudflare → zone `6mic-aix.fr` → **DNS** : supprimer l'enregistrement `tv` (CNAME vers `giraudg.github.io`).
2. Cloudflare → **Workers & Pages** → **Créer** → **Importer un dépôt** → GitHub `giraudg/tv6mic`.
   - Nom du Worker : `tv-6mic` (doit correspondre à `wrangler.jsonc`).
   - Commande de build : vide. Commande de déploiement : `npx wrangler deploy`.
3. Le domaine `tv.6mic-aix.fr` est déclaré dans `wrangler.jsonc` (`custom_domain`) : il est créé au déploiement.
4. GitHub → dépôt `giraudg/tv6mic` → **Settings → Pages** : désactiver GitHub Pages (il ne sert plus).
5. Adobe Fonts → projet web `trm8rah` (celui de Navettes) → ajouter le domaine `tv.6mic-aix.fr` pour afficher Owners et Zuume Cut.
   À défaut, le lecteur affiche ses polices de repli (Archivo, Anton).

Ensuite, chaque `git push` sur `main` redéploie automatiquement. Les fichiers à la racine du dépôt (`index.html`, `test.html`,
`media/`…) sont l'ancienne version GitHub Pages du diagnostic : ils seront supprimés une fois le domaine passé sur Cloudflare.

## Base de données

Les migrations de `migrations/` sont déjà appliquées sur la base de production. Pour une nouvelle migration :
ajouter `migrations/0003_….sql`, puis `npm run db:migrate:remote` (ou l'exécuter depuis le tableau de bord D1).
La programmation d'essai (`0002_essai.sql`) se retire avec `DELETE FROM contenus WHERE id LIKE 'essai-%';`.

## Développement local

```sh
npm install
npm run db:migrate:local
npm run dev          # http://localhost:8787/?flux=hall&debug=1
npm test             # règles de programmation, ES5 et CSS compatibles Chromium 56
python3 scripts/medias-essai.py   # régénère les médias d'essai (Pillow, ffmpeg)
```
