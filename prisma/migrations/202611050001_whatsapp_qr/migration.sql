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
