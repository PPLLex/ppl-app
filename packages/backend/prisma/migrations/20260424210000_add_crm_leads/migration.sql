-- CRM foundation: leads + lead_activities tables + supporting enums.
-- Part of the April 2026 sales-funnel build for the Content & Marketing
-- + Admin roles. See schema.prisma Lead model for design notes.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "LeadSource" AS ENUM (
  'WEBSITE_FORM',
  'REFERRAL',
  'WALK_IN',
  'EVENT',
  'PARTNER_SCHOOL',
  'COLD_OUTREACH',
  'PAID_AD',
  'SOCIAL',
  'OTHER'
);

CREATE TYPE "PipelineStage" AS ENUM (
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'ASSESSMENT_BOOKED',
  'ASSESSMENT_DONE',
  'CLOSED_WON',
  'CLOSED_LOST',
  'NURTURE'
);

CREATE TYPE "LeadActivityType" AS ENUM (
  'NOTE',
  'EMAIL_SENT',
  'EMAIL_OPENED',
  'CALL',
  'TEXT',
  'MEETING',
  'FORM_SUBMISSION',
  'STAGE_CHANGE',
  'ASSIGNED'
);

-- ============================================================
-- 2. leads table
-- ============================================================
CREATE TABLE "leads" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL DEFAULT 'ppl',
  "firstName"         TEXT NOT NULL,
  "lastName"          TEXT NOT NULL,
  "email"             TEXT NOT NULL,
  "phone"             TEXT,
  "ageGroup"          TEXT,
  "source"            "LeadSource" NOT NULL DEFAULT 'OTHER',
  "stage"             "PipelineStage" NOT NULL DEFAULT 'NEW',
  "locationId"        TEXT,
  "ownerUserId"       TEXT,
  "convertedToUserId" TEXT,
  "convertedAt"       TIMESTAMP(3),
  "lostReason"        TEXT,
  "nextFollowUpAt"    TIMESTAMP(3),
  "notes"             TEXT,
  "sourceMetadata"    JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- One lead per email within an organization — dedupe inbound form subs.
CREATE UNIQUE INDEX "leads_organizationId_email_key"
  ON "leads"("organizationId", "email");

-- After conversion, link to the User row; unique so we can't double-link.
CREATE UNIQUE INDEX "leads_convertedToUserId_key"
  ON "leads"("convertedToUserId");

CREATE INDEX "leads_stage_ownerUserId_idx"  ON "leads"("stage", "ownerUserId");
CREATE INDEX "leads_source_idx"             ON "leads"("source");
CREATE INDEX "leads_nextFollowUpAt_idx"     ON "leads"("nextFollowUpAt");
CREATE INDEX "leads_organizationId_idx"     ON "leads"("organizationId");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_convertedToUserId_fkey"
  FOREIGN KEY ("convertedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. lead_activities table — append-only history of interactions
-- ============================================================
CREATE TABLE "lead_activities" (
  "id"           TEXT NOT NULL,
  "leadId"       TEXT NOT NULL,
  "type"         "LeadActivityType" NOT NULL,
  "content"      TEXT,
  "authorUserId" TEXT,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_activities_leadId_createdAt_idx"
  ON "lead_activities"("leadId", "createdAt");

ALTER TABLE "lead_activities"
  ADD CONSTRAINT "lead_activities_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_activities"
  ADD CONSTRAINT "lead_activities_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
