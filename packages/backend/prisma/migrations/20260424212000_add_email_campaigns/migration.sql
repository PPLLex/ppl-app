-- Marketing email campaigns — EmailCampaign + CampaignRecipient + enums.
-- Foundation only; fan-out worker + Resend webhook plumbing land in
-- follow-up commits. See schema.prisma EmailCampaign model comment.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "CampaignType" AS ENUM (
  'MARKETING',
  'ANNOUNCEMENT',
  'NURTURE',
  'TRANSACTIONAL'
);

CREATE TYPE "CampaignStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
  'FAILED'
);

CREATE TYPE "CampaignAudience" AS ENUM (
  'ALL_MEMBERS',
  'ALL_PARENTS',
  'ALL_ATHLETES',
  'ALL_LEADS',
  'PAST_DUE_MEMBERS',
  'LOCATION_MEMBERS',
  'AGE_GROUP',
  'CUSTOM_SEGMENT',
  'IMPORTED_LIST'
);

CREATE TYPE "RecipientStatus" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'BOUNCED',
  'FAILED',
  'UNSUBSCRIBED'
);

-- ============================================================
-- 2. email_campaigns table
-- ============================================================
CREATE TABLE "email_campaigns" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL DEFAULT 'ppl',
  "name"             TEXT NOT NULL,
  "subject"          TEXT NOT NULL,
  "fromName"         TEXT NOT NULL DEFAULT 'Pitching Performance Lab',
  "fromAddress"      TEXT NOT NULL DEFAULT 'info@pitchingperformancelab.com',
  "replyToAddress"   TEXT,
  "bodyHtml"         TEXT NOT NULL,
  "bodyText"         TEXT,
  "type"             "CampaignType"     NOT NULL DEFAULT 'MARKETING',
  "audience"         "CampaignAudience" NOT NULL DEFAULT 'CUSTOM_SEGMENT',
  "audienceFilter"   JSONB,
  "status"           "CampaignStatus"   NOT NULL DEFAULT 'DRAFT',
  "scheduledFor"     TIMESTAMP(3),
  "sentAt"           TIMESTAMP(3),
  "totalRecipients"  INTEGER NOT NULL DEFAULT 0,
  "sentCount"        INTEGER NOT NULL DEFAULT 0,
  "deliveredCount"   INTEGER NOT NULL DEFAULT 0,
  "openCount"        INTEGER NOT NULL DEFAULT 0,
  "clickCount"       INTEGER NOT NULL DEFAULT 0,
  "bounceCount"      INTEGER NOT NULL DEFAULT 0,
  "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId"  TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_campaigns_status_scheduledFor_idx"
  ON "email_campaigns"("status", "scheduledFor");
CREATE INDEX "email_campaigns_createdByUserId_idx"
  ON "email_campaigns"("createdByUserId");
CREATE INDEX "email_campaigns_organizationId_idx"
  ON "email_campaigns"("organizationId");

ALTER TABLE "email_campaigns"
  ADD CONSTRAINT "email_campaigns_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 3. campaign_recipients table
-- ============================================================
CREATE TABLE "campaign_recipients" (
  "id"              TEXT NOT NULL,
  "campaignId"      TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "fullName"        TEXT,
  "userId"          TEXT,
  "leadId"          TEXT,
  "status"          "RecipientStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt"          TIMESTAMP(3),
  "deliveredAt"     TIMESTAMP(3),
  "openedAt"        TIMESTAMP(3),
  "clickedAt"       TIMESTAMP(3),
  "bouncedAt"       TIMESTAMP(3),
  "bounceReason"    TEXT,
  "unsubscribedAt"  TIMESTAMP(3),
  "resendMessageId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_recipients_resendMessageId_key"
  ON "campaign_recipients"("resendMessageId");
CREATE INDEX "campaign_recipients_campaignId_status_idx"
  ON "campaign_recipients"("campaignId", "status");
CREATE INDEX "campaign_recipients_email_idx"
  ON "campaign_recipients"("email");
CREATE INDEX "campaign_recipients_userId_idx"
  ON "campaign_recipients"("userId");

ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
