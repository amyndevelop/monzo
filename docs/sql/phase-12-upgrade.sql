-- MONZO QR: ejecutar TODO en neondb. Incluye Contactos si su migracion aun no fue aplicada.
-- Operacion atomica y repetible. Conserva los canales oficiales, mensajes y fichas existentes.
DO $monzo_phase_12$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."WhatsappAccount"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE _prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM _prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name<>ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows','202610310001_dynamic_variables','202611020001_contact_follow_up','202611050001_whatsapp_qr'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610290001_foundation' AND(checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND(checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND(checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND(checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND(checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND(checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610300003_gemini_lab' AND(checksum<>'725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300003_gemini_lab.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610300004_guided_flows' AND(checksum<>'7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300004_guided_flows.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202610310001_dynamic_variables' AND(checksum<>'75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610310001_dynamic_variables.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202611020001_contact_follow_up' AND(checksum<>'de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202611020001_contact_follow_up.'; END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202611050001_whatsapp_qr' AND(checksum<>'7489f7a231bcf9ecf9fd27dceeba9a65e5767d18d388a48810ccd3e009d3de6b' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202611050001_whatsapp_qr.'; END IF;
 IF (SELECT count(*) FROM _prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows','202610310001_dynamic_variables']))<>9 THEN RAISE EXCEPTION 'MONZO: se esperan nueve migraciones previas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202611020001_contact_follow_up') THEN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY['crmName','email','company','salesStage','tags','ownerUserId','profileNotes','crmRevision'])) THEN RAISE EXCEPTION 'MONZO: hay campos comerciales sin historial.'; END IF;
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

 INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES(md5(random()::text||clock_timestamp()::text),'de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2',now(),'202611020001_contact_follow_up',1);
 END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY['crmName','email','company','salesStage','tags','ownerUserId','profileNotes','crmRevision']))<>8 THEN RAISE EXCEPTION 'MONZO: esquema comercial incompatible.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202611050001_whatsapp_qr') THEN
 IF to_regclass('public."WhatsappWebSession"') IS NOT NULL OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='provider') THEN RAISE EXCEPTION 'MONZO: hay esquema QR sin historial.'; END IF;
ALTER TABLE "WhatsappAccount" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'META';
ALTER TABLE "WhatsappAccount" ADD CONSTRAINT "WhatsappAccount_provider_check" CHECK ("provider" IN ('META','BAILEYS'));
CREATE TABLE "WhatsappWebSession" (
 "accountId" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "expectedWaId" TEXT NOT NULL,
 "connectedWaId" TEXT,
 "desiredState" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "state" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "generation" INTEGER NOT NULL DEFAULT 1,
 "authEncrypted" TEXT,
 "qrEncrypted" TEXT,
 "qrExpiresAt" TIMESTAMP(3),
 "leaseOwner" TEXT,
 "leaseUntil" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WhatsappWebSession_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "WhatsappWebSession_desired_check" CHECK ("desiredState" IN ('CONNECTED','DISCONNECTED')),
 CONSTRAINT "WhatsappWebSession_state_check" CHECK ("state" IN ('CONNECTING','QR','CONNECTED','DISCONNECTING','DISCONNECTED','ERROR')),
 CONSTRAINT "WhatsappWebSession_number_check" CHECK ("expectedWaId" ~ '^[1-9][0-9]{5,14}$')
);
CREATE INDEX "WhatsappWebSession_tenantId_idx" ON "WhatsappWebSession"("tenantId");
CREATE UNIQUE INDEX "WhatsappWebSession_accountId_tenantId_key" ON "WhatsappWebSession"("accountId","tenantId");

 INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES(md5(random()::text||clock_timestamp()::text),'7489f7a231bcf9ecf9fd27dceeba9a65e5767d18d388a48810ccd3e009d3de6b',now(),'202611050001_whatsapp_qr',1);
 END IF;

 IF to_regclass('public."WhatsappWebSession"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta la tabla de sesiones QR.'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappWebSession' AND column_name=ANY(ARRAY['accountId','tenantId','expectedWaId','connectedWaId','desiredState','state','generation','authEncrypted','qrEncrypted','qrExpiresAt','leaseOwner','leaseUntil','lastErrorCode','createdAt','updatedAt']))<>15 THEN RAISE EXCEPTION 'MONZO: columnas QR incompatibles.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='provider') IS DISTINCT FROM '''META''::text' THEN RAISE EXCEPTION 'MONZO: proveedor inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('WhatsappAccount_provider_check','WhatsappWebSession_pkey','WhatsappWebSession_accountId_tenantId_fkey','WhatsappWebSession_desired_check','WhatsappWebSession_state_check','WhatsappWebSession_number_check'))<>6 THEN RAISE EXCEPTION 'MONZO: faltan restricciones QR.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('WhatsappWebSession_pkey','WhatsappWebSession_tenantId_idx','WhatsappWebSession_accountId_tenantId_key'))<>3 THEN RAISE EXCEPTION 'MONZO: faltan indices QR.'; END IF;

 RAISE NOTICE 'MONZO: esquema QR preparado; datos existentes conservados. Esto no vincula ningun telefono.';
END
$monzo_phase_12$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappWebSession') AS tabla_sesion_qr,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappWebSession') AS columnas_sesion_qr,
 (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
