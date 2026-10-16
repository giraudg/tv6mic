-- 0006 : journal vidéo de chaque écran (source mémoire ou réseau, étapes du chargement, images décodées),
-- envoyé avec le signal pour diagnostiquer à distance une vidéo qui reste noire.
ALTER TABLE ecrans ADD COLUMN trace TEXT;
