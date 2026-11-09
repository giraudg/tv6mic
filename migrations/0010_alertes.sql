-- Alertes envoyées par la surveillance des écrans (src/surveillance.mjs) : une ligne par coupure (« muet »,
-- fermée au retour de l'écran) ou par erreur grave signalée par un lecteur.
CREATE TABLE IF NOT EXISTS alertes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flux_code TEXT NOT NULL,
  type TEXT NOT NULL,            -- muet | erreur
  debut INTEGER NOT NULL,        -- ms : dernier contact (muet) ou heure de l'erreur
  fin INTEGER,                   -- ms : retour de l'écran ; NULL = coupure en cours
  detail TEXT
);
CREATE INDEX IF NOT EXISTS alertes_ouvertes ON alertes (fin);
