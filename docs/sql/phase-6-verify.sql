SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AiAgent') AS tabla_agente,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent') AS columnas_agente,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
