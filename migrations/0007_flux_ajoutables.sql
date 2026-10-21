-- Flux ajoutables depuis le back-office (écrans du bar, écrans futurs).
-- « propose » : l'écran est coché d'office quand on programme un nouveau contenu (1) ou non (0).
ALTER TABLE flux ADD COLUMN propose INTEGER NOT NULL DEFAULT 1;
UPDATE flux SET propose = 0 WHERE code = 'reserve';

-- Quatre écrans Samsung QB75C au bar (deux paires de deux), pour la carte et les promos :
-- chacun a son flux, et ils ne reçoivent pas d'office les annonces de soirées.
INSERT OR IGNORE INTO flux (code, nom, ordre, propose) VALUES
  ('bar-1', 'Bar 1', 7, 0),
  ('bar-2', 'Bar 2', 8, 0),
  ('bar-3', 'Bar 3', 9, 0),
  ('bar-4', 'Bar 4', 10, 0);
