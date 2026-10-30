-- MONZO Fase 6: ejecutar TODO en neondb. Conserva cuentas, mensajes y adjuntos.
-- Actualizar la base ANTES de publicar el codigo de Fase 6.
-- Una sola transaccion atomica. Checksums generados desde migraciones originales.
DO $monzo_phase_6$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 5.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290001_foundation' AND (checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND (checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND (checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND (checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND (checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND (checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300003_gemini_lab' AND (checksum<>'725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300003_gemini_lab.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates'])) <> 6 THEN RAISE EXCEPTION 'MONZO: se esperan seis migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300003_gemini_lab') THEN

 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('AiAgent','id','text','NO'),('AiAgent','tenantId','text','NO'),('AiAgent','name','text','NO'),('AiAgent','instructions','text','NO'),('AiAgent','knowledge','text','NO'),('AiAgent','enabled','boolean','NO'),('AiAgent','dailyLimit','integer','NO'),('AiAgent','revision','integer','NO'),('AiAgent','createdAt','timestamp without time zone','NO'),('AiAgent','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 10 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 6 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='enabled') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'MONZO: agente debe comenzar pausado.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='dailyLimit') IS DISTINCT FROM '20' THEN RAISE EXCEPTION 'MONZO: limite inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname='AiAgent_tenantId_fkey') <> 1 THEN RAISE EXCEPTION 'MONZO: falta relacion de empresa del agente.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='AiAgent' AND indexname IN ('AiAgent_pkey','AiAgent_tenantId_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices del agente.'; END IF;

  RAISE NOTICE 'MONZO: Fase 6 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF to_regclass('public."AiAgent"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns c JOIN (VALUES ('AiAgent','id','text','NO'),('AiAgent','tenantId','text','NO'),('AiAgent','name','text','NO'),('AiAgent','instructions','text','NO'),('AiAgent','knowledge','text','NO'),('AiAgent','enabled','boolean','NO'),('AiAgent','dailyLimit','integer','NO'),('AiAgent','revision','integer','NO'),('AiAgent','createdAt','timestamp without time zone','NO'),('AiAgent','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col WHERE c.table_schema='public') THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de Fase 6. Revisar antes de continuar.'; END IF;
CREATE TABLE "AiAgent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Asistente de prueba',
  "instructions" TEXT NOT NULL DEFAULT '',
  "knowledge" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "dailyLimit" INTEGER NOT NULL DEFAULT 20,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiAgent_tenantId_key" ON "AiAgent"("tenantId");
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('AiAgent','id','text','NO'),('AiAgent','tenantId','text','NO'),('AiAgent','name','text','NO'),('AiAgent','instructions','text','NO'),('AiAgent','knowledge','text','NO'),('AiAgent','enabled','boolean','NO'),('AiAgent','dailyLimit','integer','NO'),('AiAgent','revision','integer','NO'),('AiAgent','createdAt','timestamp without time zone','NO'),('AiAgent','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 10 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 6 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='enabled') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'MONZO: agente debe comenzar pausado.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='dailyLimit') IS DISTINCT FROM '20' THEN RAISE EXCEPTION 'MONZO: limite inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname='AiAgent_tenantId_fkey') <> 1 THEN RAISE EXCEPTION 'MONZO: falta relacion de empresa del agente.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='AiAgent' AND indexname IN ('AiAgent_pkey','AiAgent_tenantId_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices del agente.'; END IF;

 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('725b5f5a-81ab-422b-ae8f-92637756cb61','725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d',now(),'202610300003_gemini_lab',1);
 RAISE NOTICE 'MONZO: Fase 6 aplicada. Datos existentes conservados.';
END
$monzo_phase_6$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AiAgent') AS tabla_agente,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent') AS columnas_agente,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
