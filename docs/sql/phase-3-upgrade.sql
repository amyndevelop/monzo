-- MONZO Fase 3: actualizar monzo-db / main / neondb, que ya tiene Fase 2.
-- Ejecutar TODO el bloque. Una sola sentencia atomica: todo o nada.
-- Agrega las migraciones 3 y 4. No borra ni reemplaza usuarios, empresas o tablas.
-- Generado por node scripts/prepare-phase-3-sql.mjs; no editar ni ejecutar el bootstrap de Fase 2.
DO $monzo_phase_3$
DECLARE
 target_table text;
 applied integer;
BEGIN
 PERFORM pg_catalog.set_config('search_path', 'public', true);
 IF current_database() <> 'neondb' THEN
  RAISE EXCEPTION 'MONZO: elegi la base neondb antes de ejecutar. No se modifico nada.';
 END IF;
 IF to_regclass('public._prisma_migrations') IS NULL THEN
  RAISE EXCEPTION 'MONZO: falta el historial de Fase 2. No se modifico nada.';
 END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN
  RAISE EXCEPTION 'MONZO: historial duplicado. No se modifico nada.';
 END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL (ARRAY['202610290001_foundation', '202610290002_auth_tenants', '202610290003_whatsapp_inbox', '202610290004_event_dispatch'])) THEN
  RAISE EXCEPTION 'MONZO: hay migraciones no previstas. Revisar antes de continuar.';
 END IF;

 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290001_foundation'
   AND (checksum <> '63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation. No se modifico nada.';
 END IF;

 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290002_auth_tenants'
   AND (checksum <> '67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants. No se modifico nada.';
 END IF;

 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290003_whatsapp_inbox'
   AND (checksum <> '3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox. No se modifico nada.';
 END IF;

 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290004_event_dispatch'
   AND (checksum <> '3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch. No se modifico nada.';
 END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = ANY (ARRAY['202610290001_foundation', '202610290002_auth_tenants'])) <> 2 THEN
  RAISE EXCEPTION 'MONZO: se esperan las dos migraciones de Fase 2, una vez cada una.';
 END IF;
 FOREACH target_table IN ARRAY ARRAY['User', 'Tenant', 'Membership', 'TenantSettings', 'Session', 'Account', 'Verification', 'RateLimit', 'TenantInvitation'] LOOP
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
   RAISE EXCEPTION 'MONZO: falta la tabla % de Fase 2. No se modifico nada.', target_table;
  END IF;
 END LOOP;
 SELECT count(*) INTO applied FROM public._prisma_migrations WHERE migration_name = ANY (ARRAY['202610290003_whatsapp_inbox', '202610290004_event_dispatch']);
 IF applied = 2 AND (SELECT count(*) FROM public._prisma_migrations) = 4 THEN
  FOREACH target_table IN ARRAY ARRAY['WhatsappAccount', 'Contact', 'Conversation', 'Message', 'ConversationNote', 'WhatsappWebhookEvent', 'WorkerHeartbeat'] LOOP
   IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RAISE EXCEPTION 'MONZO: historial aplicado pero falta %. Revisar el esquema.', target_table;
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('Message', 'WhatsappWebhookEvent') AND column_name = 'jobPublishedAt') <> 2 THEN
   RAISE EXCEPTION 'MONZO: historial aplicado pero faltan columnas. Revisar el esquema.';
  END IF;
  RAISE NOTICE 'MONZO: Fase 3 ya estaba aplicada; no se modificaron datos.';
  RETURN;
 END IF;
 IF applied <> 0 OR (SELECT count(*) FROM public._prisma_migrations) <> 2 THEN
  RAISE EXCEPTION 'MONZO: historial parcial o duplicado. No se modifico nada.';
 END IF;
 FOREACH target_table IN ARRAY ARRAY['WhatsappAccount', 'Contact', 'Conversation', 'Message', 'ConversationNote', 'WhatsappWebhookEvent', 'WorkerHeartbeat'] LOOP
  IF to_regclass(format('public.%I', target_table)) IS NOT NULL THEN
   RAISE EXCEPTION 'MONZO: ya existe % sin historial completo. Revisar antes de continuar.', target_table;
  END IF;
 END LOOP;

-- 202610290003_whatsapp_inbox; copia exacta de la migracion versionada.
-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN', 'CANCELED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "WhatsappAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT NOT NULL,
    "displayPhone" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tokenEncrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastErrorCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "mediaId" TEXT,
    "providerId" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "errorCode" TEXT,
    "attemptedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "payload" JSONB,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsappWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccount_phoneNumberId_key" ON "WhatsappAccount"("phoneNumberId");

-- CreateIndex
CREATE INDEX "WhatsappAccount_tenantId_idx" ON "WhatsappAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccount_id_tenantId_key" ON "WhatsappAccount"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_name_idx" ON "Contact"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_accountId_waId_key" ON "Contact"("tenantId", "accountId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_accountId_tenantId_key" ON "Contact"("id", "accountId", "tenantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_status_lastMessageAt_idx" ON "Conversation"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_accountId_contactId_key" ON "Conversation"("accountId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_accountId_tenantId_key" ON "Conversation"("id", "accountId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_tenantId_key" ON "Conversation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Message_tenantId_conversationId_createdAt_idx" ON "Message"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_createdAt_idx" ON "Message"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_accountId_providerId_key" ON "Message"("accountId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_idempotencyKey_key" ON "Message"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ConversationNote_tenantId_conversationId_createdAt_idx" ON "ConversationNote"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappWebhookEvent_state_createdAt_idx" ON "WhatsappWebhookEvent"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappWebhookEvent_accountId_digest_key" ON "WhatsappWebhookEvent"("accountId", "digest");

-- AddForeignKey
ALTER TABLE "WhatsappAccount" ADD CONSTRAINT "WhatsappAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsappAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsappAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_accountId_tenantId_fkey" FOREIGN KEY ("contactId", "accountId", "tenantId") REFERENCES "Contact"("id", "accountId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsappAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_accountId_tenantId_fkey" FOREIGN KEY ("conversationId", "accountId", "tenantId") REFERENCES "Conversation"("id", "accountId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversationId_tenantId_fkey" FOREIGN KEY ("conversationId", "tenantId") REFERENCES "Conversation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappWebhookEvent" ADD CONSTRAINT "WhatsappWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappWebhookEvent" ADD CONSTRAINT "WhatsappWebhookEvent_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "WhatsappAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
VALUES ('3b922830-d49c-4401-a5a3-b41ce5e8825e', '3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63', now(), '202610290003_whatsapp_inbox', 1);


-- 202610290004_event_dispatch; copia exacta de la migracion versionada.
ALTER TABLE "Message" ADD COLUMN "jobPublishedAt" TIMESTAMP(3);
ALTER TABLE "WhatsappWebhookEvent" ADD COLUMN "jobPublishedAt" TIMESTAMP(3);

INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
VALUES ('3224c27b-3445-41a9-aad4-2b9ba1c698ed', '3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21', now(), '202610290004_event_dispatch', 1);

 RAISE NOTICE 'MONZO: Fase 3 aplicada; cuatro migraciones registradas. Usuarios y empresas conservados.';
END
$monzo_phase_3$;
