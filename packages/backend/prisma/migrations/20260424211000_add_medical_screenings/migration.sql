-- Medical screenings: support for the MEDICAL / MEDICAL_ADMIN roles
-- (Renewed Performance partnership). See schema.prisma MedicalScreening
-- model comment for design rationale.

-- ============================================================
-- 1. ScreeningStatus enum
-- ============================================================
CREATE TYPE "ScreeningStatus" AS ENUM (
  'SCHEDULED',
  'CHECKED_IN',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED'
);

-- ============================================================
-- 2. medical_screenings table
-- ============================================================
CREATE TABLE "medical_screenings" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL DEFAULT 'ppl',
  "athleteId"        TEXT NOT NULL,
  "providerUserId"   TEXT,
  "locationId"       TEXT NOT NULL,
  "scheduledAt"      TIMESTAMP(3) NOT NULL,
  "status"           "ScreeningStatus" NOT NULL DEFAULT 'SCHEDULED',
  "checkedInAt"      TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "durationMinutes"  INTEGER NOT NULL DEFAULT 30,
  "providerFeeCents" INTEGER NOT NULL DEFAULT 7500,
  "shareableNotes"   TEXT,
  "medicalNotes"     TEXT,
  "marketingOptIn"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "medical_screenings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medical_screenings_providerUserId_scheduledAt_idx"
  ON "medical_screenings"("providerUserId", "scheduledAt");
CREATE INDEX "medical_screenings_athleteId_scheduledAt_idx"
  ON "medical_screenings"("athleteId", "scheduledAt");
CREATE INDEX "medical_screenings_locationId_scheduledAt_idx"
  ON "medical_screenings"("locationId", "scheduledAt");
CREATE INDEX "medical_screenings_status_idx"
  ON "medical_screenings"("status");
CREATE INDEX "medical_screenings_organizationId_idx"
  ON "medical_screenings"("organizationId");

ALTER TABLE "medical_screenings"
  ADD CONSTRAINT "medical_screenings_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "athlete_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medical_screenings"
  ADD CONSTRAINT "medical_screenings_providerUserId_fkey"
  FOREIGN KEY ("providerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medical_screenings"
  ADD CONSTRAINT "medical_screenings_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 3. screening_results table — measurements per screening
-- ============================================================
CREATE TABLE "screening_results" (
  "id"          TEXT NOT NULL,
  "screeningId" TEXT NOT NULL,
  "metric"      TEXT NOT NULL,
  "value"       DOUBLE PRECISION,
  "unit"        TEXT,
  "passOrFail"  BOOLEAN,
  "side"        TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "screening_results_screeningId_idx"
  ON "screening_results"("screeningId");

ALTER TABLE "screening_results"
  ADD CONSTRAINT "screening_results_screeningId_fkey"
  FOREIGN KEY ("screeningId") REFERENCES "medical_screenings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
