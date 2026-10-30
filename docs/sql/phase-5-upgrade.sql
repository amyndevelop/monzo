-- MONZO Fase 5: ejecutar TODO en neondb. Conserva cuentas, mensajes y adjuntos.
-- Actualizar la base ANTES de publicar el codigo de Fase 5.
-- Una sola transaccion atomica. Checksums generados desde migraciones originales.
DO $monzo_phase_5$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 4.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290001_foundation' AND (checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND (checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND (checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND (checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND (checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND (checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media'])) <> 5 THEN RAISE EXCEPTION 'MONZO: se esperan cinco migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates') THEN

 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('Message','templateId','text','YES'),('Message','templateSnapshot','jsonb','YES'),('WhatsappAccount','templatesNextCursor','text','YES'),('WhatsappAccount','templatesSyncId','text','YES'),('WhatsappAccount','templatesSyncVersion','integer','NO'),('WhatsappAccount','templatesSyncedAt','timestamp without time zone','YES'),('WhatsappTemplate','id','text','NO'),('WhatsappTemplate','tenantId','text','NO'),('WhatsappTemplate','accountId','text','NO'),('WhatsappTemplate','businessAccountId','text','NO'),('WhatsappTemplate','providerId','text','NO'),('WhatsappTemplate','name','text','NO'),('WhatsappTemplate','language','text','NO'),('WhatsappTemplate','category','text','NO'),('WhatsappTemplate','status','text','NO'),('WhatsappTemplate','definitionHash','text','NO'),('WhatsappTemplate','syncId','text','NO'),('WhatsappTemplate','definition','jsonb','NO'),('WhatsappTemplate','syncedAt','timestamp without time zone','NO'),('WhatsappTemplate','createdAt','timestamp without time zone','NO'),('WhatsappTemplate','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 21 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 5 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='templatesSyncVersion') IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'MONZO: valor inicial del catalogo incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('Message_templateId_accountId_tenantId_fkey','WhatsappTemplate_tenantId_fkey','WhatsappTemplate_accountId_tenantId_fkey')) <> 3 THEN RAISE EXCEPTION 'MONZO: faltan relaciones de Fase 5.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='WhatsappTemplate' AND indexname IN ('WhatsappTemplate_pkey','WhatsappTemplate_tenantId_accountId_status_idx','WhatsappTemplate_id_accountId_tenantId_key','WhatsappTemplate_accountId_providerId_key','WhatsappTemplate_accountId_name_language_key')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan indices de Fase 5.'; END IF;

  RAISE NOTICE 'MONZO: Fase 5 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF to_regclass('public."WhatsappTemplate"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns c JOIN (VALUES ('Message','templateId','text','YES'),('Message','templateSnapshot','jsonb','YES'),('WhatsappAccount','templatesNextCursor','text','YES'),('WhatsappAccount','templatesSyncId','text','YES'),('WhatsappAccount','templatesSyncVersion','integer','NO'),('WhatsappAccount','templatesSyncedAt','timestamp without time zone','YES'),('WhatsappTemplate','id','text','NO'),('WhatsappTemplate','tenantId','text','NO'),('WhatsappTemplate','accountId','text','NO'),('WhatsappTemplate','businessAccountId','text','NO'),('WhatsappTemplate','providerId','text','NO'),('WhatsappTemplate','name','text','NO'),('WhatsappTemplate','language','text','NO'),('WhatsappTemplate','category','text','NO'),('WhatsappTemplate','status','text','NO'),('WhatsappTemplate','definitionHash','text','NO'),('WhatsappTemplate','syncId','text','NO'),('WhatsappTemplate','definition','jsonb','NO'),('WhatsappTemplate','syncedAt','timestamp without time zone','NO'),('WhatsappTemplate','createdAt','timestamp without time zone','NO'),('WhatsappTemplate','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col WHERE c.table_schema='public') THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de Fase 5. Revisar antes de continuar.'; END IF;
-- AlterTable
ALTER TABLE "WhatsappAccount" ADD COLUMN     "templatesNextCursor" TEXT,
ADD COLUMN     "templatesSyncId" TEXT,
ADD COLUMN     "templatesSyncVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "templatesSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateSnapshot" JSONB;

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "definitionHash" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappTemplate_tenantId_accountId_status_idx" ON "WhatsappTemplate"("tenantId", "accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_id_accountId_tenantId_key" ON "WhatsappTemplate"("id", "accountId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_accountId_providerId_key" ON "WhatsappTemplate"("accountId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_accountId_name_language_key" ON "WhatsappTemplate"("accountId", "name", "language");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_templateId_accountId_tenantId_fkey" FOREIGN KEY ("templateId", "accountId", "tenantId") REFERENCES "WhatsappTemplate"("id", "accountId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplate" ADD CONSTRAINT "WhatsappTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappTemplate" ADD CONSTRAINT "WhatsappTemplate_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsappAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;



 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('Message','templateId','text','YES'),('Message','templateSnapshot','jsonb','YES'),('WhatsappAccount','templatesNextCursor','text','YES'),('WhatsappAccount','templatesSyncId','text','YES'),('WhatsappAccount','templatesSyncVersion','integer','NO'),('WhatsappAccount','templatesSyncedAt','timestamp without time zone','YES'),('WhatsappTemplate','id','text','NO'),('WhatsappTemplate','tenantId','text','NO'),('WhatsappTemplate','accountId','text','NO'),('WhatsappTemplate','businessAccountId','text','NO'),('WhatsappTemplate','providerId','text','NO'),('WhatsappTemplate','name','text','NO'),('WhatsappTemplate','language','text','NO'),('WhatsappTemplate','category','text','NO'),('WhatsappTemplate','status','text','NO'),('WhatsappTemplate','definitionHash','text','NO'),('WhatsappTemplate','syncId','text','NO'),('WhatsappTemplate','definition','jsonb','NO'),('WhatsappTemplate','syncedAt','timestamp without time zone','NO'),('WhatsappTemplate','createdAt','timestamp without time zone','NO'),('WhatsappTemplate','updatedAt','timestamp without time zone','NO')) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> 21 THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 5 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='templatesSyncVersion') IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'MONZO: valor inicial del catalogo incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('Message_templateId_accountId_tenantId_fkey','WhatsappTemplate_tenantId_fkey','WhatsappTemplate_accountId_tenantId_fkey')) <> 3 THEN RAISE EXCEPTION 'MONZO: faltan relaciones de Fase 5.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='WhatsappTemplate' AND indexname IN ('WhatsappTemplate_pkey','WhatsappTemplate_tenantId_accountId_status_idx','WhatsappTemplate_id_accountId_tenantId_key','WhatsappTemplate_accountId_providerId_key','WhatsappTemplate_accountId_name_language_key')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan indices de Fase 5.'; END IF;

 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('8a8fbe18-1ca9-4118-ad0b-74c5fa246516','8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106',now(),'202610300002_whatsapp_templates',1);
 RAISE NOTICE 'MONZO: Fase 5 aplicada. Datos existentes conservados.';
END
$monzo_phase_5$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappTemplate') AS tabla_plantillas,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('templateId','templateSnapshot')) AS columnas_mensajes,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name IN ('templatesSyncedAt','templatesNextCursor','templatesSyncId','templatesSyncVersion')) AS columnas_catalogo,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
