-- Add kiosk PIN field to locations for self-service check-in tablets
-- AlterTable
ALTER TABLE "locations" ADD COLUMN "kioskPin" TEXT;
