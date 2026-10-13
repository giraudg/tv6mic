-- Programmation d'essai du lot 1 : les mêmes six contenus sur tous les flux, du 13 octobre au 31 décembre 2026.
-- À retirer avant l'exploitation : DELETE FROM contenus WHERE id LIKE 'essai-%';  (les diffusions suivent)

INSERT OR REPLACE INTO contenus (id, type, titre, donnees, duree) VALUES
  ('essai-soiree-1', 'soiree', 'Soirée d’essai 1',
   '{"nom":"Concert d’essai","date":"2026-10-24","heure":"20:00","photo":{"src":"/test-medias/photo-soiree-1.jpg"},"infos":"Ouverture des portes 19 h 30\nTarifs 25 € / 22 € en prévente","mention":"Dernières places","billetterie":"https://billetterie.6mic-aix.fr/"}',
   NULL),
  ('essai-video-a', 'video', 'Vidéo d’essai A',
   '{"src":"/test-medias/video-essai-a.mp4","poster":"/test-medias/video-essai-a.jpg","duree":8,"taille":4937385}',
   NULL),
  ('essai-video-b', 'video', 'Vidéo d’essai B',
   '{"src":"/test-medias/video-essai-b.mp4","poster":"/test-medias/video-essai-b.jpg","duree":8,"taille":4934093}',
   NULL),
  ('essai-agenda', 'agenda', 'Agenda d’essai',
   '{"titre":"Prochainement au 6MIC","dates":[{"date":"2026-10-17","nom":"Groupe d’essai A"},{"date":"2026-10-24","nom":"Concert d’essai","mention":"Dernières places"},{"date":"2026-10-31","nom":"Soirée d’essai Halloween"},{"date":"2026-11-07","nom":"Soirée club d’essai","mention":"Complet"},{"date":"2026-11-14","nom":"Groupe d’essai B"},{"date":"2026-11-21","nom":"Groupe d’essai C","mention":"Nouvelle date"},{"date":"2026-11-28","nom":"Festival d’essai, jour 1"},{"date":"2026-11-29","nom":"Festival d’essai, jour 2"},{"date":"2026-12-05","nom":"Groupe d’essai D"},{"date":"2026-12-12","nom":"Groupe d’essai E","mention":"Gratuit"}]}',
   NULL),
  ('essai-image', 'image', 'Visuel d’essai',
   '{"src":"/test-medias/visuel-essai.jpg","ajustement":"remplir","taille":466576}',
   NULL),
  ('essai-soiree-2', 'soiree', 'Soirée d’essai 2',
   '{"nom":"Soirée club d’essai","date":"2026-11-07","heure":"23:00","photo":{"src":"/test-medias/photo-soiree-2.jpg"},"infos":"Club\nGratuit sur réservation","mention":"Complet"}',
   NULL);

INSERT OR REPLACE INTO diffusions (id, contenu_id, debut, fin, ordre) VALUES
  ('essai-d1', 'essai-soiree-1', '2026-10-13', '2026-12-31', 1),
  ('essai-d2', 'essai-video-a', '2026-10-13', '2026-12-31', 2),
  ('essai-d3', 'essai-video-b', '2026-10-13', '2026-12-31', 3),
  ('essai-d4', 'essai-agenda', '2026-10-13', '2026-12-31', 4),
  ('essai-d5', 'essai-image', '2026-10-13', '2026-12-31', 5),
  ('essai-d6', 'essai-soiree-2', '2026-10-13', '2026-12-31', 6);

INSERT OR IGNORE INTO diffusion_flux (diffusion_id, flux_code)
  SELECT d.id, f.code FROM diffusions d, flux f WHERE d.id LIKE 'essai-d%';

UPDATE meta SET valeur = CAST(CAST(valeur AS INTEGER) + 1 AS TEXT) WHERE cle = 'version';
