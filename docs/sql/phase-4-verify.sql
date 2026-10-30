SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256')) AS columnas_adjuntos,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
