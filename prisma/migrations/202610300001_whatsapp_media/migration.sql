-- Add nullable metadata; preserve existing messages and all previous migrations.
ALTER TABLE "Message"
  ADD COLUMN "mediaMimeType" TEXT,
  ADD COLUMN "mediaFilename" TEXT,
  ADD COLUMN "mediaSize" INTEGER,
  ADD COLUMN "mediaSha256" TEXT;
