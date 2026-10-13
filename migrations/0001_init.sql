-- Écrans TV 6MIC : schéma initial (lot 1).
-- Une diffusion associe un contenu, un ou plusieurs flux (diffusion_flux) et un calendrier.

CREATE TABLE IF NOT EXISTS meta (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

-- Un flux par écran. Le code figure dans l'adresse (?flux=hall) et ne change jamais ;
-- le nom affiché se modifie librement.
CREATE TABLE IF NOT EXISTS flux (
  code TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  contenu_defaut TEXT,                         -- contenu affiché quand rien n'est programmé (NULL : logo sur fond noir)
  identifier_jusqua INTEGER NOT NULL DEFAULT 0 -- ms depuis 1970 : l'écran affiche le nom du flux jusqu'à cet instant
);

CREATE TABLE IF NOT EXISTS contenus (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('soiree', 'agenda', 'image', 'video')),
  titre TEXT NOT NULL,                         -- nom dans le back-office
  donnees TEXT NOT NULL DEFAULT '{}',          -- JSON, selon le type (voir README)
  duree INTEGER,                               -- secondes ; NULL = durée par défaut du type
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('brouillon', 'actif', 'archive')),
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS diffusions (
  id TEXT PRIMARY KEY,
  contenu_id TEXT NOT NULL REFERENCES contenus(id) ON DELETE CASCADE,
  debut TEXT NOT NULL,                         -- AAAA-MM-JJ, inclus
  fin TEXT NOT NULL,                           -- AAAA-MM-JJ, inclus
  jours TEXT,                                  -- JSON ["2026-11-14", …] : jours choisis un par un (NULL : toute la période)
  semaine TEXT,                                -- JSON [5, 6] : jours de la semaine, 1 = lundi … 7 = dimanche (NULL : tous)
  plages TEXT,                                 -- JSON [["19:00", "01:00"]] : plages horaires (NULL : toute la journée)
  prioritaire INTEGER NOT NULL DEFAULT 0,      -- 1 : remplace toute la boucle pendant ses plages
  ordre INTEGER NOT NULL DEFAULT 0,            -- place dans la boucle (0 : ordre automatique)
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS diffusions_fin ON diffusions (fin);

CREATE TABLE IF NOT EXISTS diffusion_flux (
  diffusion_id TEXT NOT NULL REFERENCES diffusions(id) ON DELETE CASCADE,
  flux_code TEXT NOT NULL REFERENCES flux(code) ON DELETE CASCADE,
  PRIMARY KEY (diffusion_id, flux_code)
);
CREATE INDEX IF NOT EXISTS diffusion_flux_flux ON diffusion_flux (flux_code);

-- Dernier signal de chaque écran (envoyé à chaque interrogation, toutes les 30 s).
CREATE TABLE IF NOT EXISTS ecrans (
  flux_code TEXT PRIMARY KEY,
  vu_le INTEGER NOT NULL,
  lecteur TEXT,
  version INTEGER,
  contenu TEXT,
  memoire INTEGER,
  video TEXT,
  erreur TEXT,
  demarre_le INTEGER,
  chargements INTEGER,
  taille TEXT,
  agent TEXT
);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quand TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  qui TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

INSERT OR IGNORE INTO meta (cle, valeur) VALUES ('version', '1');

INSERT OR IGNORE INTO flux (code, nom, ordre) VALUES
  ('billetterie', 'Billetterie', 1),
  ('club', 'Club', 2),
  ('hall', 'Hall', 3),
  ('grande-salle', 'Grande salle', 4),
  ('regie', 'Régie', 5),
  ('reserve', 'Réserve', 6);
