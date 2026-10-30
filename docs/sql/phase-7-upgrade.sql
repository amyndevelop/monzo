-- MONZO Fase 7: ejecutar TODO en neondb. Conserva cuentas, mensajes y adjuntos.
-- Actualizar la base ANTES de publicar el codigo de Fase 7.
-- Una sola transaccion atomica. Checksums generados desde migraciones originales.
DO $monzo_phase_7$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 6.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290001_foundation' AND (checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND (checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND (checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND (checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND (checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND (checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300003_gemini_lab' AND (checksum<>'725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300003_gemini_lab.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300004_guided_flows' AND (checksum<>'7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300004_guided_flows.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab'])) <> 7 THEN RAISE EXCEPTION 'MONZO: se esperan siete migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300004_guided_flows') THEN

 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('AutomationFlow','id','text','NO'),('AutomationFlow','tenantId','text','NO'),('AutomationFlow','accountId','text','NO'),('AutomationFlow','draft','jsonb','NO'),('AutomationFlow','published','jsonb','YES'),('AutomationFlow','revision','integer','NO'),('AutomationFlow','publishedVersion','integer','NO'),('AutomationFlow','publishedByUserId','text','YES'),('AutomationFlow','enabled','boolean','NO'),('AutomationFlow','activatedAt','timestamp without time zone','YES'),('AutomationFlow','createdAt','timestamp without time zone','NO'),('AutomationFlow','updatedAt','timestamp without time zone','NO'),('Conversation','automationPaused','boolean','NO'),('Conversation','automationGeneration','integer','NO'),('Conversation','automationState','jsonb','YES'),('Message','automationFlowId','text','YES'),('Message','automationSourceId','text','YES'),('Message','automationEventId','text','YES'),('Message','automationSnapshot','jsonb','YES')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 19 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 7 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationFlow' AND column_name='enabled') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'MONZO: el flujo debe comenzar pausado.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name='automationPaused') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MONZO: conversaciones deben comenzar bajo control humano.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name='automationGeneration') IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'MONZO: generacion inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('AutomationFlow_tenantId_fkey','AutomationFlow_accountId_tenantId_fkey','Message_automationFlowId_accountId_tenantId_fkey')) <> 3 THEN RAISE EXCEPTION 'MONZO: faltan relaciones de automatizaciones.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('AutomationFlow_pkey','AutomationFlow_accountId_key','AutomationFlow_id_accountId_tenantId_key','AutomationFlow_accountId_tenantId_key','AutomationFlow_tenantId_idx','Message_automationSourceId_key','Message_automationEventId_status_idx')) <> 7 THEN RAISE EXCEPTION 'MONZO: faltan indices de automatizaciones.'; END IF;

  RAISE NOTICE 'MONZO: Fase 7 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF to_regclass('public."AutomationFlow"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns c JOIN (VALUES ('AutomationFlow','id','text','NO'),('AutomationFlow','tenantId','text','NO'),('AutomationFlow','accountId','text','NO'),('AutomationFlow','draft','jsonb','NO'),('AutomationFlow','published','jsonb','YES'),('AutomationFlow','revision','integer','NO'),('AutomationFlow','publishedVersion','integer','NO'),('AutomationFlow','publishedByUserId','text','YES'),('AutomationFlow','enabled','boolean','NO'),('AutomationFlow','activatedAt','timestamp without time zone','YES'),('AutomationFlow','createdAt','timestamp without time zone','NO'),('AutomationFlow','updatedAt','timestamp without time zone','NO'),('Conversation','automationPaused','boolean','NO'),('Conversation','automationGeneration','integer','NO'),('Conversation','automationState','jsonb','YES'),('Message','automationFlowId','text','YES'),('Message','automationSourceId','text','YES'),('Message','automationEventId','text','YES'),('Message','automationSnapshot','jsonb','YES')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col WHERE c.table_schema='public') THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de Fase 7. Revisar antes de continuar.'; END IF;
ALTER TABLE "Conversation" ADD COLUMN "automationPaused" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "automationGeneration" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "automationState" JSONB;
-- Existing conversations stay under human control until explicitly resumed.
-- The inbound handler explicitly enables only brand-new conversations.
CREATE TABLE "AutomationFlow" (
 "id" TEXT NOT NULL,
 "tenantId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "draft" JSONB NOT NULL,
 "published" JSONB,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "publishedVersion" INTEGER NOT NULL DEFAULT 0,
 "publishedByUserId" TEXT,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "activatedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AutomationFlow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationFlow_accountId_key" ON "AutomationFlow"("accountId");
CREATE UNIQUE INDEX "AutomationFlow_id_accountId_tenantId_key" ON "AutomationFlow"("id","accountId","tenantId");
CREATE UNIQUE INDEX "AutomationFlow_accountId_tenantId_key" ON "AutomationFlow"("accountId","tenantId");
CREATE INDEX "AutomationFlow_tenantId_idx" ON "AutomationFlow"("tenantId");
ALTER TABLE "AutomationFlow" ADD CONSTRAINT "AutomationFlow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationFlow" ADD CONSTRAINT "AutomationFlow_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD COLUMN "automationFlowId" TEXT,
 ADD COLUMN "automationSnapshot" JSONB,
 ADD COLUMN "automationSourceId" TEXT,
 ADD COLUMN "automationEventId" TEXT;
CREATE UNIQUE INDEX "Message_automationSourceId_key" ON "Message"("automationSourceId");
CREATE INDEX "Message_automationEventId_status_idx" ON "Message"("automationEventId","status");
ALTER TABLE "Message" ADD CONSTRAINT "Message_automationFlowId_accountId_tenantId_fkey" FOREIGN KEY ("automationFlowId","accountId","tenantId") REFERENCES "AutomationFlow"("id","accountId","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('AutomationFlow','id','text','NO'),('AutomationFlow','tenantId','text','NO'),('AutomationFlow','accountId','text','NO'),('AutomationFlow','draft','jsonb','NO'),('AutomationFlow','published','jsonb','YES'),('AutomationFlow','revision','integer','NO'),('AutomationFlow','publishedVersion','integer','NO'),('AutomationFlow','publishedByUserId','text','YES'),('AutomationFlow','enabled','boolean','NO'),('AutomationFlow','activatedAt','timestamp without time zone','YES'),('AutomationFlow','createdAt','timestamp without time zone','NO'),('AutomationFlow','updatedAt','timestamp without time zone','NO'),('Conversation','automationPaused','boolean','NO'),('Conversation','automationGeneration','integer','NO'),('Conversation','automationState','jsonb','YES'),('Message','automationFlowId','text','YES'),('Message','automationSourceId','text','YES'),('Message','automationEventId','text','YES'),('Message','automationSnapshot','jsonb','YES')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 19 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 7 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationFlow' AND column_name='enabled') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'MONZO: el flujo debe comenzar pausado.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name='automationPaused') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'MONZO: conversaciones deben comenzar bajo control humano.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name='automationGeneration') IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'MONZO: generacion inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('AutomationFlow_tenantId_fkey','AutomationFlow_accountId_tenantId_fkey','Message_automationFlowId_accountId_tenantId_fkey')) <> 3 THEN RAISE EXCEPTION 'MONZO: faltan relaciones de automatizaciones.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('AutomationFlow_pkey','AutomationFlow_accountId_key','AutomationFlow_id_accountId_tenantId_key','AutomationFlow_accountId_tenantId_key','AutomationFlow_tenantId_idx','Message_automationSourceId_key','Message_automationEventId_status_idx')) <> 7 THEN RAISE EXCEPTION 'MONZO: faltan indices de automatizaciones.'; END IF;

 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('7140c472-9614-4139-ab7b-dd80f24c6095','7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80',now(),'202610300004_guided_flows',1);
 RAISE NOTICE 'MONZO: Fase 7 aplicada. Datos existentes conservados.';
END
$monzo_phase_7$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationFlow') AS tabla_flujo,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Conversation' AND column_name IN ('automationPaused','automationGeneration','automationState')) AS columnas_conversacion,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('automationFlowId','automationSnapshot','automationSourceId','automationEventId')) AS columnas_mensaje,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
