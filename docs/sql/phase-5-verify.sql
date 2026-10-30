SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappTemplate') AS tabla_plantillas,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('templateId','templateSnapshot')) AS columnas_mensajes,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name IN ('templatesSyncedAt','templatesNextCursor','templatesSyncId','templatesSyncVersion')) AS columnas_catalogo,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
