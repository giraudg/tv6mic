-- 0004 : nouveau type de contenu « serie » (2 à 4 dates mises en avant, avec visuels).
-- SQLite ne sait pas modifier une contrainte CHECK : on reconstruit la table « contenus ».
-- Les programmations la référencent (ON DELETE CASCADE) : on les met de côté, on les vide,
-- on reconstruit, puis on les remet à l'identique. Aucune ligne n'est perdue ni modifiée.

CREATE TABLE IF NOT EXISTS sauv_diffusions AS SELECT * FROM diffusions;
CREATE TABLE IF NOT EXISTS sauv_diffusion_flux AS SELECT * FROM diffusion_flux;
DELETE FROM diffusion_flux;
DELETE FROM diffusions;

CREATE TABLE contenus_nouveau (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('soiree', 'agenda', 'serie', 'image', 'video')),
  titre TEXT NOT NULL,                         -- nom dans le back-office
  donnees TEXT NOT NULL DEFAULT '{}',          -- JSON, selon le type (voir README)
  duree INTEGER,                               -- secondes ; NULL = durée par défaut du type
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('brouillon', 'actif', 'archive')),
  cree_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modifie_le TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO contenus_nouveau (id, type, titre, donnees, duree, statut, cree_le, modifie_le)
  SELECT id, type, titre, donnees, duree, statut, cree_le, modifie_le FROM contenus;
DROP TABLE contenus;
ALTER TABLE contenus_nouveau RENAME TO contenus;

INSERT INTO diffusions SELECT * FROM sauv_diffusions;
INSERT INTO diffusion_flux SELECT * FROM sauv_diffusion_flux;
DROP TABLE sauv_diffusions;
DROP TABLE sauv_diffusion_flux;
