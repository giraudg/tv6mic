-- Format de chaque écran : « paysage » (téléviseurs 16:9, scène 1920 × 1080) ou « kakemono » (écran LED vertical
-- 320 × 900 sur roulettes, boîtier Novastar Taurus, fourni par Phocea Media, nov. 2026). Le lecteur adapte sa scène
-- et n'affiche sur le kakémono que les contenus plein écran (images, vidéos, pages web) : cf. Regles.FORMATS.
ALTER TABLE flux ADD COLUMN format TEXT NOT NULL DEFAULT 'paysage';

-- Le kakémono : n'est pas coché d'office quand on programme un contenu (les gabarits paysage n'y passent pas).
INSERT OR IGNORE INTO flux (code, nom, ordre, propose, format)
  SELECT 'kakemono', 'Kakémono', COALESCE(MAX(ordre), 0) + 1, 0, 'kakemono' FROM flux;
