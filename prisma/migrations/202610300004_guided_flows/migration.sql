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
