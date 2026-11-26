ALTER TABLE "WhatsappAccount" DROP CONSTRAINT "WhatsappAccount_provider_check";
ALTER TABLE "WhatsappAccount" ADD CONSTRAINT "WhatsappAccount_provider_check" CHECK ("provider" IN ('META','BAILEYS','EVOLUTION'));
ALTER TABLE "Message" ADD COLUMN "channelGeneration" INTEGER;
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelGeneration_check" CHECK ("channelGeneration" IS NULL OR "channelGeneration">0);

CREATE TABLE "EvolutionSession" (
 "accountId" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "expectedWaId" TEXT NOT NULL,
 "connectedWaId" TEXT,
 "generation" INTEGER NOT NULL DEFAULT 1,
 "desiredState" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "state" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "qrEncrypted" TEXT,
 "qrExpiresAt" TIMESTAMP(3),
 "lastSeenAt" TIMESTAMP(3),
 "lastEventSequence" BIGINT NOT NULL DEFAULT 0,
 "lastErrorCode" TEXT,
 "commandId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EvolutionSession_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "EvolutionSession_phone_check" CHECK ("expectedWaId" ~ '^[1-9][0-9]{5,14}$'),
 CONSTRAINT "EvolutionSession_identity_check" CHECK ("connectedWaId" IS NULL OR "connectedWaId"="expectedWaId"),
 CONSTRAINT "EvolutionSession_generation_check" CHECK ("generation">0 AND "lastEventSequence">=0),
 CONSTRAINT "EvolutionSession_desired_check" CHECK ("desiredState" IN ('CONNECTED','DISCONNECTED')),
 CONSTRAINT "EvolutionSession_state_check" CHECK ("state" IN ('DISCONNECTED','CONNECTING','QR','CONNECTED','DISCONNECTING','ERROR'))
);
CREATE UNIQUE INDEX "EvolutionSession_accountId_tenantId_key" ON "EvolutionSession"("accountId","tenantId");
CREATE UNIQUE INDEX "EvolutionSession_tenantId_expectedWaId_key" ON "EvolutionSession"("tenantId","expectedWaId");
CREATE INDEX "EvolutionSession_tenantId_idx" ON "EvolutionSession"("tenantId");
CREATE UNIQUE INDEX "EvolutionSession_active_phone_key" ON "EvolutionSession"("expectedWaId") WHERE "desiredState"='CONNECTED';

CREATE TABLE "EvolutionDelivery" (
 "id" VARCHAR(64) NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "generation" INTEGER NOT NULL,
 "sequence" BIGINT NOT NULL,
 "digest" VARCHAR(64) NOT NULL,
 "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EvolutionDelivery_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "EvolutionDelivery_identity_check" CHECK ("id" ~ '^[a-f0-9]{64}$' AND "digest" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "EvolutionDelivery_generation_check" CHECK ("generation">0 AND "sequence">0)
);
CREATE INDEX "EvolutionDelivery_accountId_processedAt_idx" ON "EvolutionDelivery"("accountId","processedAt");
CREATE INDEX "EvolutionDelivery_processedAt_idx" ON "EvolutionDelivery"("processedAt");
