-- Add new LocationRole values
ALTER TYPE "LocationRole" ADD VALUE IF NOT EXISTS 'PITCHING_COORDINATOR';
ALTER TYPE "LocationRole" ADD VALUE IF NOT EXISTS 'YOUTH_COORDINATOR';
ALTER TYPE "LocationRole" ADD VALUE IF NOT EXISTS 'TRAINER';

-- Migrate StaffLocation from single locationRole to roles array
-- Step 1: Add the new roles column
ALTER TABLE "staff_locations" ADD COLUMN "roles" "LocationRole"[] DEFAULT ARRAY['COACH']::"LocationRole"[];

-- Step 2: Copy existing locationRole into the roles array
UPDATE "staff_locations" SET "roles" = ARRAY["locationRole"]::"LocationRole"[];

-- Step 3: Drop old column and index
DROP INDEX IF EXISTS "staff_locations_locationId_locationRole_idx";
ALTER TABLE "staff_locations" DROP COLUMN "locationRole";

-- Step 4: Create new index
CREATE INDEX "staff_locations_locationId_idx" ON "staff_locations"("locationId");

-- Create StaffInvite table
CREATE TABLE "staff_invites" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "token" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "locations" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "staff_invites_token_key" ON "staff_invites"("token");
CREATE INDEX "staff_invites_token_idx" ON "staff_invites"("token");
CREATE INDEX "staff_invites_email_idx" ON "staff_invites"("email");
