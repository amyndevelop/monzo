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

