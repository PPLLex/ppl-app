-- Expand Role enum to 11 fine-grained values + add UserRole junction table
-- + SchoolTeamType + OutsideCoachType enums. See schema.prisma `Role` comment
-- for the full rationale. STAFF/CLIENT kept as legacy values during migration.

-- ============================================================
-- 1. Extend the Role enum
-- Postgres requires ALTER TYPE ... ADD VALUE statements; each must be its own
-- statement because ADDed values can't be used in the same transaction.
-- Prisma migrations are run with autocommit off by default, so we commit
-- before adding each new value.
-- ============================================================
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COORDINATOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PERFORMANCE_COACH';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CONTENT_MARKETING_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CONTENT_MARKETING';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MEDICAL_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MEDICAL';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNERSHIP_COACH';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OUTSIDE_COACH';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARENT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ATHLETE';

-- ============================================================
-- 2. New enums for partner-school segmentation & outside-coach typing
-- ============================================================
CREATE TYPE "SchoolTeamType" AS ENUM ('HIGH_SCHOOL', 'TRAVEL_TEAM', 'COLLEGE');

CREATE TYPE "OutsideCoachType" AS ENUM (
  'REC_BALL',
  'TRAVEL_BALL',
  'MIDDLE_SCHOOL',
  'HIGH_SCHOOL',
  'COLLEGE',
  'PITCHING_PRO',
  'PITCHING_COORDINATOR_PRO',
  'PLAYER_DEVELOPMENT'
);

-- ============================================================
-- 3. Add `type` column to school_teams (default HIGH_SCHOOL for existing rows)
-- ============================================================
ALTER TABLE "school_teams"
  ADD COLUMN "type" "SchoolTeamType" NOT NULL DEFAULT 'HIGH_SCHOOL';

-- ============================================================
-- 4. Add optional `coachType` column to outside_coach_links
-- Nullable so existing rows stay valid until Chad or a backfill sets it.
-- ============================================================
ALTER TABLE "outside_coach_links"
  ADD COLUMN "coachType" "OutsideCoachType";

-- ============================================================
-- 5. UserRole junction table — a user can hold multiple roles
-- (e.g. Performance Coach + Content & Marketing layered on the same user).
-- See schema.prisma UserRole model doc for scoping semantics.
-- ============================================================
CREATE TABLE "user_roles" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "role"         "Role" NOT NULL,
  "locationId"   TEXT,
  "schoolTeamId" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- UNIQUE constraint prevents duplicate (user, role, location, school) tuples.
-- Postgres treats NULLs as distinct by default in UNIQUE constraints, which
-- is what we want here: a user can have one ADMIN row (all nulls) AND one
-- PERFORMANCE_COACH row at location X (locationId set).
CREATE UNIQUE INDEX "user_roles_userId_role_locationId_schoolTeamId_key"
  ON "user_roles"("userId", "role", "locationId", "schoolTeamId");

CREATE INDEX "user_roles_userId_idx"          ON "user_roles"("userId");
CREATE INDEX "user_roles_role_locationId_idx" ON "user_roles"("role", "locationId");
CREATE INDEX "user_roles_schoolTeamId_idx"    ON "user_roles"("schoolTeamId");

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_schoolTeamId_fkey"
  FOREIGN KEY ("schoolTeamId") REFERENCES "school_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
