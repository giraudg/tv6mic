-- 0005 : nouveau type « lineup » (programme de la soirée). Plutôt que d'élargir encore la contrainte CHECK
-- sur le type (ce qui oblige à reconstruire la table à chaque nouveau type), on la retire : le Worker
-- n'accepte que les types connus (TYPES dans src/worker.js). Même méthode qu'en 0004 : les programmations
-- sont mises de côté puis remises à l'identique (supprimer l'ancienne table les effacerait en cascade).

CREATE TABLE IF NOT EXISTS sauv_diffusions AS SELECT * FROM diffusions;
CREATE TABLE IF NOT EXISTS sauv_diffusion_flux AS SELECT * FROM diffusion_flux;
DELETE FROM diffusion_flux;
DELETE FROM diffusions;

CREATE TABLE contenus_nouveau (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                          -- soiree, lineup, agenda, serie, image, video (contrôlé par le Worker)
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
