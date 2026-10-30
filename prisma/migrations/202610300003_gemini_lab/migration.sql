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
