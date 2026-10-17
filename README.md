# Écrans TV 6MIC

Affichage dynamique des écrans Samsung du 6MIC (Aix-en-Provence) : chaque écran lit en continu un flux,
dont la programmation se règle à la journée ou à l'heure. Cahier des charges : document « Écrans TV 6MIC — Cahier des charges ».

| Adresse | Rôle |
| --- | --- |
| `https://tv.6mic-aix.fr/?flux=billetterie` | Lecteur de l'écran Billetterie (idem `club`, `hall`, `grande-salle`, `regie`, `reserve`) |
| `https://tv.6mic-aix.fr/` | Liste des flux (pour tester sur un ordinateur) |
| `https://tv.6mic-aix.fr/admin/` | Back-office (mot de passe partagé + prénom) |
| `/api/flux` | Liste des flux (JSON) |
| `/api/flux/{code}` | Programmation d'un flux (JSON) ; en `POST`, le lecteur y joint l'état de l'écran |
| `/api/admin/…` | API du back-office (session obligatoire) |
| `/medias/{clé}` | Médias importés (R2), avec requêtes partielles pour la vidéo |
| `/test.html` | Page de test de l'écran (compteur d'ouvertures), puis diagnostic ; `?stay=1` reste sur la page |
| `/diagnostic/` | Diagnostic complet des écrans (version 8) |

Options du lecteur : `&debug=1` affiche le suivi technique en bas à droite, `&ident=1` affiche le nom du flux pendant 20 s.

## Lot 1 (livré) : le lecteur

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

Gabarits (`public/lecteur/gabarits.js` et `gabarits.css`, partagés avec l'aperçu du back-office) :

| Type | Données (`contenus.donnees`, JSON) | Durée par défaut |
| --- | --- | --- |
| `soiree` | `nom`, `date` (AAAA-MM-JJ), `heure` (HH:MM), `photo.src`, `infos` (lignes séparées par `\n`), `mention`, `billetterie` (URL → QR code), `motif` (`type` faisceaux, rayons, hachures ou aucun ; `position` droite, gauche, haut, bas ; `couleur` rose, violet, degrade, blanc ou une teinte `#rrggbb` (pipette) — absent : faisceaux, droite, dégradé) | 10 s |
| `lineup` | `titre` (vide : tête d'affiche), `date`, `lieu`, `photo.src`, `passages` : 1 à 8 `{ heure, role (ouverture, premiere, tete, dj, fermeture, autre), libelle, nom }`, rangés par heure (après minuit en fin de soirée) ; le jour J, passage en cours et suivant signalés | 12 s |
| `agenda` | `titre`, `dates` : liste de `{ date, nom, mention }`, `photo.src` facultative ; 6 dates au plus par page (pages équilibrées), barre de progression façon « story » | 15 s par page |
| `serie` | `accroche`, `titre`, `fond` (`violet`, `rose`, `degrade`, `noir`), `dates` : 1 à 4 `{ date, heure, nom, mention, photo.src }` ; dates passées masquées, « Ce soir » / « Demain » automatiques | 12 s |
| `image` | `src`, `ajustement` (`remplir` ou `ajuster`) | 8 s |
| `video` | `src`, `poster`, `duree` (s), `taille` (octets), `son` (booléen) | durée de la vidéo |

Format vidéo lu sans conversion : MP4, H.264 profil High niveau 4.0, 1920 × 1080, 30 i/s constants, 4:2:0 8 bits,
environ 5 Mbit/s, AAC ou sans son, option « fast start ».

## Lot 2 (livré) : le back-office

`public/admin/` (page, `admin.css` reprenant le style de Navettes, `admin.js` en module, sans dépendance), servi sous `/admin/`.

- **Connexion** : un mot de passe d'équipe (secret `ADMIN_PASSWORD` du Worker) et le prénom de la personne, inscrit au journal.
  Cookie de session signé (HMAC), valable 30 jours ; 10 essais ratés en 15 min bloquent l'adresse IP pendant 15 min.
  Toute écriture exige la même origine et un corps JSON (ou l'en-tête `X-TV6MIC: 1` pour les envois de fichiers).
- **Écrans** : état de chaque écran (en ligne, contenu affiché, boucle en cours, incidents), bouton « Identifier ».
- **Contenus** : filtres par type, mois de la soirée, mois de programmation, contenus non programmés (raccourci vers les
  soirées à venir sans programmation), tri par date de soirée (groupé par mois), modification ou nom ; 60 vignettes puis
  « Afficher plus » ; réglages gardés dans le navigateur.
  Création et modification des 4 types avec aperçu fidèle (mêmes gabarits que les écrans), duplication,
  archivage, suppression. Deux personnes qui modifient le même contenu : la seconde est prévenue (conflit 409) au lieu d'écraser.
- **Calendrier** : vue mensuelle par écran ; glisser sur des jours (ou Ctrl/⌘ + clic) pour programmer un contenu.
- **Programmation** : un ou plusieurs écrans, période ou jours choisis, jours de la semaine, plages horaires, priorité.
  Pour retirer : un contenu d'un écran (Flux et boucles, bouton ×, les autres écrans ne changent pas), un seul jour
  (clic sur le contenu dans le Calendrier, la période est coupée en deux), ou toute la programmation (éditeur du contenu).
- **Flux et boucles** : nom des écrans, contenu par défaut, adresse MagicINFO, simulation de la boucle à une date et une heure,
  ordre de passage par glisser-déposer.
- **Journal** : qui a modifié quoi et quand.
- **Réglages** : couleurs primaire, secondaire et dégradé (nommables, aperçu en direct, contrôle de lisibilité), qui habillent
  les écrans (variables CSS posées par `Gabarits.appliquerReglages`) et le back-office ; listes de choix réglables : rôles du
  line-up (libellé, ordre, mise en valeur par défaut), mentions (rouge ou non), salles. Les rôles sont enregistrés par clé ;
  renommer une mention ou une salle met à jour les contenus qui l'utilisent ; un élément utilisé s'archive au lieu d'être
  supprimé. Valeurs d'origine : `REGLAGES_DEFAUT` dans `src/worker.js` (seule source) ; enregistrement dans `meta` (clé
  `reglages`, versionnée), transmis aux écrans avec la programmation.
- **Import** : glisser-déposer sur chaque champ image ou vidéo (plusieurs affiches d'un coup sur une série) ; la vignette
  prend le format du cadre à l'écran (`Gabarits.CADRES`, `cadreSerie`) et l'import signale recadrage et netteté.
- **Images** : converties en JPEG dans le navigateur (2560 px au plus sur le grand côté), puis débarrassées de leur profil ICC
  (Chromium 56 affiche en couleurs « postérisées » les JPEG portant le profil sRGB compact ajouté par Chrome).
- **Vidéos** : le navigateur lit l'en-tête MP4 (codec, profil, taille, cadence, débit, son). Ce que les écrans ne liraient pas
  (HEVC, 10 bits, 4K, plus de 60 i/s, plus de 12 Mbit/s ou 80 Mo, autre format que MP4/MOV) est converti à l'import, dans le
  navigateur (WebCodecs, bibliothèque [Mediabunny](https://mediabunny.dev) 1.61.5, MPL-2.0, dans `public/vendor/`, chargée
  à la demande) : H.264 8 bits, 1920 × 1080 au plus (bandes noires si le format diffère), 24, 25 ou 30 i/s constants,
  5 Mbit/s en 1080p (abaissé pour tenir sous 75 Mo), images clés toutes les 2 s, son AAC (encodeur WebAssembly si le
  navigateur n'en a pas), « fast start ». Une vidéo seulement perfectible (50/60 i/s, cadence variable, débit lourd, son
  non AAC) : conversion proposée. Le résultat est relu avant l'envoi. HEVC : décodé si la machine le sait (Mac, PC
  récents) ; sinon, l'encart HandBrake s'affiche.
- Les médias qui ne servent plus à aucun contenu sont supprimés de R2 à l'enregistrement.

## Architecture

- **Cloudflare Workers** avec ressources statiques : `public/` est servi tel quel, `src/worker.js` gère l'API.
- **Cloudflare D1** (base `tv-6mic`) : `flux`, `contenus`, `diffusions`, `diffusion_flux`, `ecrans`, `journal`, `meta`
  (`version` de la programmation, à incrémenter à chaque modification pour que les écrans la rechargent ; `reglages`).
- **Cloudflare R2** (compartiment `tv-6mic-medias`, liaison `MEDIAS`) : images et vidéos importées, clés `m/AAAA-MM/…`,
  servies sous `/medias/` avec cache Cloudflare. Les fichiers d'essai du lot 1 restent dans `public/test-medias/`.

## Mise en ligne (une seule fois)

1. Cloudflare → zone `6mic-aix.fr` → **DNS** : supprimer l'enregistrement `tv` (CNAME vers `giraudg.github.io`).
2. Cloudflare → **Workers & Pages** → **Créer** → **Importer un dépôt** → GitHub `giraudg/tv6mic`.
   - Nom du Worker : `tv-6mic` (doit correspondre à `wrangler.jsonc`).
   - Commande de build : vide. Commande de déploiement : `npx wrangler deploy`.
3. Le domaine `tv.6mic-aix.fr` est déclaré dans `wrangler.jsonc` (`custom_domain`) : il est créé au déploiement.
4. GitHub → dépôt `giraudg/tv6mic` → **Settings → Pages** : désactiver GitHub Pages (il ne sert plus).
5. Workers & Pages → `tv-6mic` → **Paramètres → Variables et secrets** : ajouter le secret `ADMIN_PASSWORD`
   (le mot de passe du back-office). Sans lui, la connexion est refusée.
6. Adobe Fonts → projet web `trm8rah` (celui de Navettes) → ajouter le domaine `tv.6mic-aix.fr` pour afficher Owners et Zuume Cut.
   À défaut, le lecteur affiche ses polices de repli (Archivo, Anton).

Ensuite, chaque `git push` sur `main` redéploie automatiquement. Les fichiers à la racine du dépôt (`index.html`, `test.html`,
`media/`…) sont l'ancienne version GitHub Pages du diagnostic : ils seront supprimés une fois le domaine passé sur Cloudflare.

## Base de données

Les migrations de `migrations/` sont déjà appliquées sur la base de production. Pour une nouvelle migration :
ajouter `migrations/0004_….sql`, puis `npm run db:migrate:remote` (ou l'exécuter depuis le tableau de bord D1).
La programmation d'essai (`0002_essai.sql`) se retire depuis le back-office (Contenus → chaque contenu « essai » → Supprimer).
`0003_admin.sql` ajoute le compteur d'échecs de connexion. `0004_serie.sql` ajoute le type « serie » : SQLite ne modifiant pas
une contrainte CHECK, la table `contenus` est reconstruite ; les programmations sont mises de côté puis remises à l'identique
(sinon la suppression de l'ancienne table les effacerait en cascade). `0005_types_libres.sql` ajoute « lineup » en retirant
la contrainte sur le type (même méthode) : le Worker n'accepte que les types connus, et un nouveau type ne demande plus de migration.

## Développement local

```sh
npm install
npm run db:migrate:local
npm run dev -- --var ADMIN_PASSWORD:essai   # http://localhost:8787/?flux=hall&debug=1 et /admin/
npm test             # règles de programmation, ES5 et CSS compatibles Chromium 56
python3 scripts/medias-essai.py   # régénère les médias d'essai (Pillow, ffmpeg)
```
