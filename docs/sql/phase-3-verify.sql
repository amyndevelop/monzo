-- Solo lectura: comprobar despues de ejecutar y confirmar la actualizacion.
SELECT
  current_database() AS base,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     AND table_name IN ('WhatsappAccount', 'Contact', 'Conversation', 'Message',
                        'ConversationNote', 'WhatsappWebhookEvent', 'WorkerHeartbeat')) AS tablas_whatsapp,
  (SELECT count(*) FROM public._prisma_migrations
   WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     AND migration_name IN ('202610290001_foundation', '202610290002_auth_tenants',
                            '202610290003_whatsapp_inbox', '202610290004_event_dispatch')) AS migraciones_aplicadas,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('Message', 'WhatsappWebhookEvent')
     AND column_name = 'jobPublishedAt') AS columnas_de_cola;
-- Resultado esperado: neondb | 7 | 4 | 2
