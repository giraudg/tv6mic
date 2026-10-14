-- Back-office (lot 2) : essais de connexion ratés, pour bloquer une adresse IP après 10 échecs en 15 min.
CREATE TABLE IF NOT EXISTS echecs_connexion (
  ip TEXT NOT NULL,
  quand INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS echecs_connexion_ip ON echecs_connexion (ip, quand);
CREATE INDEX IF NOT EXISTS contenus_statut ON contenus (statut);
CREATE INDEX IF NOT EXISTS diffusions_contenu ON diffusions (contenu_id);
