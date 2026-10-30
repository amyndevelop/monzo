SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationFlow') AS tabla_flujo,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name IN ('automationPaused','automationGeneration','automationState')) AS columnas_conversacion,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('automationFlowId','automationSnapshot','automationSourceId','automationEventId')) AS columnas_mensaje,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
