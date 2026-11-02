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
