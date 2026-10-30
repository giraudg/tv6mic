-- Incidents du serveur, lisibles depuis le Journal du back-office (les journaux Cloudflare ne le sont pas toujours) :
-- « erreur » = requête terminée en erreur 500 ; « reprise » = erreur passagère de la base, réussie au nouvel essai.
CREATE TABLE IF NOT EXISTS erreurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quand TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  niveau TEXT NOT NULL,          -- erreur | reprise
  methode TEXT,
  chemin TEXT,
  message TEXT
);
CREATE INDEX IF NOT EXISTS erreurs_quand ON erreurs (quand);
