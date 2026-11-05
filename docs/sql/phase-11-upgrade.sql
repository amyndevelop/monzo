-- MONZO fase 11: ejecutar TODO en neondb antes de publicar 0.3.0.
-- Agrega campos comerciales sin modificar mensajes, flujos, credenciales ni contactos existentes.
DO $monzo_phase_11$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Contact"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name<>ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows','202610310001_dynamic_variables','202611020001_contact_follow_up'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290001_foundation' AND (checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND (checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND (checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND (checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND (checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND (checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300003_gemini_lab' AND (checksum<>'725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300003_gemini_lab.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300004_guided_flows' AND (checksum<>'7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300004_guided_flows.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610310001_dynamic_variables' AND (checksum<>'75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610310001_dynamic_variables.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202611020001_contact_follow_up' AND (checksum<>'de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202611020001_contact_follow_up.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows','202610310001_dynamic_variables']))<>9 THEN RAISE EXCEPTION 'MONZO: se esperan nueve migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202611020001_contact_follow_up') THEN

 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES
 ('crmName','text','YES'),('email','text','YES'),('company','text','YES'),('salesStage','text','NO'),
 ('tags','ARRAY','NO'),('ownerUserId','text','YES'),('profileNotes','text','YES'),('crmRevision','integer','NO')
 ) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable
 WHERE c.table_schema='public' AND c.table_name='Contact')<>8 THEN RAISE EXCEPTION 'MONZO: esquema comercial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."Contact"'::regclass AND convalidated AND conname IN ('Contact_salesStage_check','Contact_ownerUserId_fkey'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de seguimiento.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('Contact_tenantId_salesStage_updatedAt_idx','Contact_ownerUserId_idx'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan indices de seguimiento.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='salesStage') IS DISTINCT FROM '''NEW''::text' THEN RAISE EXCEPTION 'MONZO: estado inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='crmRevision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;

 RAISE NOTICE 'MONZO: seguimiento ya aplicado; datos conservados.'; RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY['crmName','email','company','salesStage','tags','ownerUserId','profileNotes','crmRevision'])) THEN RAISE EXCEPTION 'MONZO: hay campos comerciales sin historial.'; END IF;
ALTER TABLE "Contact"
 ADD COLUMN "crmName" TEXT,
 ADD COLUMN "email" TEXT,
 ADD COLUMN "company" TEXT,
 ADD COLUMN "salesStage" TEXT NOT NULL DEFAULT 'NEW',
 ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "ownerUserId" TEXT,
 ADD COLUMN "profileNotes" TEXT,
 ADD COLUMN "crmRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_salesStage_check" CHECK ("salesStage" IN ('NEW','FOLLOW_UP','CLOSED'));
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contact_tenantId_salesStage_updatedAt_idx" ON "Contact"("tenantId", "salesStage", "updatedAt");
CREATE INDEX "Contact_ownerUserId_idx" ON "Contact"("ownerUserId");


 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES
 ('crmName','text','YES'),('email','text','YES'),('company','text','YES'),('salesStage','text','NO'),
 ('tags','ARRAY','NO'),('ownerUserId','text','YES'),('profileNotes','text','YES'),('crmRevision','integer','NO')
 ) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable
 WHERE c.table_schema='public' AND c.table_name='Contact')<>8 THEN RAISE EXCEPTION 'MONZO: esquema comercial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."Contact"'::regclass AND convalidated AND conname IN ('Contact_salesStage_check','Contact_ownerUserId_fkey'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de seguimiento.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('Contact_tenantId_salesStage_updatedAt_idx','Contact_ownerUserId_idx'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan indices de seguimiento.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='salesStage') IS DISTINCT FROM '''NEW''::text' THEN RAISE EXCEPTION 'MONZO: estado inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='crmRevision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;

 INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES (md5(random()::text||clock_timestamp()::text),'de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2',now(),'202611020001_contact_follow_up',1);
 RAISE NOTICE 'MONZO: seguimiento aplicado; contactos y conversaciones conservados.';
END
$monzo_phase_11$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name IN ('crmName','email','company','salesStage','tags','ownerUserId','profileNotes','crmRevision')) AS columnas_seguimiento,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
