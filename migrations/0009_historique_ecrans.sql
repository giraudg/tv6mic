-- Historique des écrans, pour comprendre après coup une coupure (Hall et Club, 6 nov. 2026) :
-- chaque retour de contact après un silence, et chaque changement de version, de mode vidéo, d'erreurs ou de réseau.
ALTER TABLE ecrans ADD COLUMN contact_le INTEGER;  -- dernier signal reçu (ms), mis à jour à chaque envoi
ALTER TABLE ecrans ADD COLUMN ip TEXT;             -- adresse publique de l'écran vue par Cloudflare
ALTER TABLE ecrans ADD COLUMN reseau TEXT;         -- fournisseur d'accès de cette adresse
CREATE TABLE IF NOT EXISTS ecrans_historique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flux_code TEXT NOT NULL,
  quand INTEGER NOT NULL,        -- ms
  evenement TEXT NOT NULL,       -- retour | version | mode | erreur | reseau
  depuis INTEGER,                -- retour : dernier contact avant le silence (ms)
  detail TEXT                    -- JSON
);
CREATE INDEX IF NOT EXISTS ecrans_historique_quand ON ecrans_historique (quand);
