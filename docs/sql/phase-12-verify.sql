SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappWebSession') AS tabla_sesion_qr,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappWebSession') AS columnas_sesion_qr,
 (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
