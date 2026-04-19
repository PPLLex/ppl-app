-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF', 'CLIENT');
CREATE TYPE "SessionType" AS ENUM ('COLLEGE_PITCHING', 'MS_HS_PITCHING', 'YOUTH_PITCHING', 'PRIVATE_LESSON', 'CAGE_RENTAL');
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "BillingDay" AS ENUM ('MONDAY', 'THURSDAY');
CREATE TYPE "LocationRole" AS ENUM ('OWNER', 'COORDINATOR', 'COACH');
CREATE TYPE "AccountType" AS ENUM ('INDIVIDUAL', 'FAMILY', 'PARTNER_SCHOOL');
CREATE TYPE "AthleteRelationType" AS ENUM ('SELF', 'CHILD', 'TEAM_MEMBER');
CREATE TYPE "OnboardingStatus" AS ENUM ('NEW', 'RETURNING', 'PARTNER_SCHOOL');
CREATE TYPE "OnboardingFeeStatus" AS ENUM ('REQUIRED', 'PROCESSING', 'PAID', 'WAIVED', 'NOT_APPLICABLE');
CREATE TYPE "TrainingDeliveryPreference" AS ENUM ('IN_PERSON', 'REMOTE', 'HYBRID');
CREATE TYPE "SchoolInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'VOID');
CREATE TYPE "CoachInviteStatus" AS ENUM ('NOT_SENT', 'SENT', 'ACCEPTED', 'EXPIRED');
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'VOIDED');
CREATE TYPE "SchoolCoachRole" AS ENUM ('HEAD_COACH', 'ASSISTANT_COACH', 'DIRECTOR');
CREATE TYPE "MetricType" AS ENUM ('FASTBALL_VELO', 'CHANGEUP_VELO', 'CURVEBALL_VELO', 'SLIDER_VELO', 'CUTTER_VELO', 'SPIN_RATE', 'COMMAND_SCORE', 'MECHANICAL_SCORE', 'BODY_WEIGHT', 'CUSTOM');
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'RETRYING', 'REFUNDED');
CREATE TYPE "CardChangeRequestStatus" AS ENUM ('PENDING', 'LINK_SENT', 'COMPLETED', 'DENIED');
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'CREDITS_REVOKED', 'CREDITS_RESTORED', 'NEW_MESSAGE', 'SCHEDULE_CHANGED', 'MEMBERSHIP_STATUS_CHANGE');
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "TrainingCategory" AS ENUM ('PITCHING_MECHANICS', 'VELOCITY_TRAINING', 'ARM_CARE', 'BULLPEN_SESSION', 'LIVE_AT_BATS', 'VIDEO_REVIEW', 'STRENGTH_CONDITIONING', 'MENTAL_PERFORMANCE', 'GENERAL', 'OTHER');
CREATE TYPE "GoalType" AS ENUM ('SHORT_TERM', 'LONG_TERM');
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateTable: locations
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "operatingHours" JSONB,
    "closedDay" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "homeLocationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stripeCustomerId" TEXT,
    "accountType" "AccountType" NOT NULL DEFAULT 'INDIVIDUAL',
    "isParent" BOOLEAN NOT NULL DEFAULT false,
    "parentUserId" TEXT,
    "authProvider" TEXT,
    "googleId" TEXT,
    "appleId" TEXT,
    "avatarUrl" TEXT,
    "magicLinkToken" TEXT,
    "magicLinkExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: client_profiles
CREATE TABLE "client_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ageGroup" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "trainingGoals" TEXT,
    "trainingPreference" "TrainingDeliveryPreference",
    "notes" TEXT,
    "waiverSignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: staff_locations
CREATE TABLE "staff_locations" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationRole" "LocationRole" NOT NULL DEFAULT 'COACH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: rooms
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sessions
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "roomId" TEXT,
    "coachId" TEXT,
    "title" TEXT NOT NULL,
    "sessionType" "SessionType" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "maxCapacity" INTEGER NOT NULL DEFAULT 8,
    "currentEnrolled" INTEGER NOT NULL DEFAULT 0,
    "recurringRule" TEXT,
    "recurringGroupId" TEXT,
    "registrationCutoffHours" INTEGER NOT NULL DEFAULT 2,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: bookings
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "creditsUsed" INTEGER NOT NULL DEFAULT 1,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: membership_plans
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ageGroup" TEXT NOT NULL,
    "sessionsPerWeek" INTEGER,
    "priceCents" INTEGER NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'weekly',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable: client_memberships
CREATE TABLE "client_memberships" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "athleteId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "billingDay" "BillingDay" NOT NULL,
    "billingAnchorDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: weekly_credits
CREATE TABLE "weekly_credits" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "creditsTotal" INTEGER NOT NULL,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable: credit_transactions
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: payments
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "membershipId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeInvoiceId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: card_change_requests
CREATE TABLE "card_change_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "adminId" TEXT,
    "status" "CardChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "secureLinkToken" TEXT,
    "secureLinkExpiry" TIMESTAMP(3),
    "newCardVerified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: conversations
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "locationId" TEXT,
    "participants" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: messages
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "readBy" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coach_notes
CREATE TABLE "coach_notes" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT,
    "schoolCoachId" TEXT,
    "trainingCategory" "TrainingCategory" NOT NULL,
    "rawContent" TEXT NOT NULL,
    "cleanedContent" TEXT,
    "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coach_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: note_digests
CREATE TABLE "note_digests" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "recipients" JSONB NOT NULL,
    "noteIds" JSONB NOT NULL,
    "htmlContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: digest_recipients
CREATE TABLE "digest_recipients" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "relation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digest_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable: goals
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "coachId" TEXT,
    "type" "GoalType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: form_templates
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "isOnboarding" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: form_responses
CREATE TABLE "form_responses" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: programs
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: program_weeks
CREATE TABLE "program_weeks" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: program_days
CREATE TABLE "program_days" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "dayNum" INTEGER NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable: program_exercises
CREATE TABLE "program_exercises" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "exerciseId" TEXT,
    "customName" TEXT,
    "sets" INTEGER,
    "reps" TEXT,
    "intensity" TEXT,
    "restSeconds" INTEGER,
    "tempo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable: exercises
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "equipment" TEXT,
    "description" TEXT,
    "videoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable: families
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "primaryLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable: athlete_profiles
CREATE TABLE "athlete_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT,
    "schoolTeamId" TEXT,
    "relationToParent" "AthleteRelationType" NOT NULL DEFAULT 'SELF',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "ageGroup" TEXT,
    "trainingDeliveryPref" "TrainingDeliveryPreference",
    "lastAgeMovedUpAlert" TIMESTAMP(3),
    "parentOptOut" BOOLEAN NOT NULL DEFAULT false,
    "parentOptOutAckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "athlete_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: onboarding_records
CREATE TABLE "onboarding_records" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NEW',
    "feeStatus" "OnboardingFeeStatus" NOT NULL DEFAULT 'REQUIRED',
    "onboardingFeeCents" INTEGER NOT NULL DEFAULT 30000,
    "stripePaymentId" TEXT,
    "stripeCheckoutId" TEXT,
    "isYouthGraduate" BOOLEAN NOT NULL DEFAULT false,
    "hadFreeAssessment" BOOLEAN NOT NULL DEFAULT false,
    "qualifyingAnswers" JSONB,
    "selfReportedStatus" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable: school_teams
CREATE TABLE "school_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "primaryLocationId" TEXT,
    "brandLogoUrl" TEXT,
    "brandColors" JSONB,
    "signupUrl" TEXT,
    "coachName" TEXT,
    "coachEmail" TEXT,
    "coachPhone" TEXT,
    "coachInviteToken" TEXT,
    "coachInviteStatus" "CoachInviteStatus" NOT NULL DEFAULT 'NOT_SENT',
    "coachInviteSentAt" TIMESTAMP(3),
    "rosterSubmittedAt" TIMESTAMP(3),
    "paymentContactName" TEXT,
    "paymentContactEmail" TEXT,
    "totalAnnualBudget" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable: school_invoices
CREATE TABLE "school_invoices" (
    "id" TEXT NOT NULL,
    "schoolTeamId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "description" TEXT,
    "totalCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "status" "SchoolInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "dueDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable: school_contracts
CREATE TABLE "school_contracts" (
    "id" TEXT NOT NULL,
    "schoolTeamId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalValueCents" INTEGER,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "signatureToken" TEXT,
    "signedByName" TEXT,
    "signedByEmail" TEXT,
    "signedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: school_coaches
CREATE TABLE "school_coaches" (
    "id" TEXT NOT NULL,
    "schoolTeamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "SchoolCoachRole" NOT NULL DEFAULT 'HEAD_COACH',
    "title" TEXT,
    "canViewDashboard" BOOLEAN NOT NULL DEFAULT true,
    "canTakeNotes" BOOLEAN NOT NULL DEFAULT true,
    "canViewPrograms" BOOLEAN NOT NULL DEFAULT true,
    "canViewGoals" BOOLEAN NOT NULL DEFAULT true,
    "canViewMetrics" BOOLEAN NOT NULL DEFAULT true,
    "canMessageAthletes" BOOLEAN NOT NULL DEFAULT false,
    "receivesWeeklySummary" BOOLEAN NOT NULL DEFAULT true,
    "pushSubscription" JSONB,
    "notifyReminders" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_coaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: athlete_metrics
CREATE TABLE "athlete_metrics" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "schoolCoachId" TEXT,
    "staffCoachId" TEXT,
    "metricType" "MetricType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "customLabel" TEXT,
    "sessionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "athlete_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "locationId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraints
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
CREATE UNIQUE INDEX "users_appleId_key" ON "users"("appleId");
CREATE UNIQUE INDEX "users_magicLinkToken_key" ON "users"("magicLinkToken");
CREATE UNIQUE INDEX "client_profiles_userId_key" ON "client_profiles"("userId");
CREATE UNIQUE INDEX "staff_locations_staffId_locationId_key" ON "staff_locations"("staffId", "locationId");
CREATE UNIQUE INDEX "bookings_clientId_sessionId_key" ON "bookings"("clientId", "sessionId");
CREATE UNIQUE INDEX "membership_plans_slug_key" ON "membership_plans"("slug");
CREATE UNIQUE INDEX "client_memberships_stripeSubscriptionId_key" ON "client_memberships"("stripeSubscriptionId");
CREATE UNIQUE INDEX "weekly_credits_clientId_membershipId_weekStartDate_key" ON "weekly_credits"("clientId", "membershipId", "weekStartDate");
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");
CREATE UNIQUE INDEX "payments_stripeInvoiceId_key" ON "payments"("stripeInvoiceId");
CREATE UNIQUE INDEX "card_change_requests_secureLinkToken_key" ON "card_change_requests"("secureLinkToken");
CREATE UNIQUE INDEX "note_digests_athleteId_weekStart_key" ON "note_digests"("athleteId", "weekStart");
CREATE UNIQUE INDEX "digest_recipients_athleteId_email_key" ON "digest_recipients"("athleteId", "email");
CREATE UNIQUE INDEX "form_responses_formId_athleteId_key" ON "form_responses"("formId", "athleteId");
CREATE UNIQUE INDEX "program_weeks_programId_weekNum_key" ON "program_weeks"("programId", "weekNum");
CREATE UNIQUE INDEX "program_days_weekId_dayNum_key" ON "program_days"("weekId", "dayNum");
CREATE UNIQUE INDEX "families_parentUserId_key" ON "families"("parentUserId");
CREATE UNIQUE INDEX "families_stripeCustomerId_key" ON "families"("stripeCustomerId");
CREATE UNIQUE INDEX "athlete_profiles_userId_key" ON "athlete_profiles"("userId");
CREATE UNIQUE INDEX "onboarding_records_athleteId_key" ON "onboarding_records"("athleteId");
CREATE UNIQUE INDEX "school_teams_slug_key" ON "school_teams"("slug");
CREATE UNIQUE INDEX "school_teams_signupUrl_key" ON "school_teams"("signupUrl");
CREATE UNIQUE INDEX "school_teams_coachInviteToken_key" ON "school_teams"("coachInviteToken");
CREATE UNIQUE INDEX "school_invoices_stripeInvoiceId_key" ON "school_invoices"("stripeInvoiceId");
CREATE UNIQUE INDEX "school_contracts_signatureToken_key" ON "school_contracts"("signatureToken");
CREATE UNIQUE INDEX "school_coaches_email_key" ON "school_coaches"("email");

-- CreateIndex: performance indexes
CREATE INDEX "users_homeLocationId_idx" ON "users"("homeLocationId");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "staff_locations_locationId_locationRole_idx" ON "staff_locations"("locationId", "locationRole");
CREATE INDEX "rooms_locationId_idx" ON "rooms"("locationId");
CREATE INDEX "sessions_locationId_startTime_idx" ON "sessions"("locationId", "startTime");
CREATE INDEX "sessions_coachId_idx" ON "sessions"("coachId");
CREATE INDEX "sessions_sessionType_idx" ON "sessions"("sessionType");
CREATE INDEX "sessions_recurringGroupId_idx" ON "sessions"("recurringGroupId");
CREATE INDEX "bookings_clientId_status_idx" ON "bookings"("clientId", "status");
CREATE INDEX "bookings_sessionId_idx" ON "bookings"("sessionId");
CREATE INDEX "client_memberships_clientId_status_idx" ON "client_memberships"("clientId", "status");
CREATE INDEX "client_memberships_status_idx" ON "client_memberships"("status");
CREATE INDEX "client_memberships_billingDay_idx" ON "client_memberships"("billingDay");
CREATE INDEX "weekly_credits_clientId_weekStartDate_idx" ON "weekly_credits"("clientId", "weekStartDate");
CREATE INDEX "credit_transactions_clientId_createdAt_idx" ON "credit_transactions"("clientId", "createdAt");
CREATE INDEX "payments_clientId_createdAt_idx" ON "payments"("clientId", "createdAt");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "card_change_requests_clientId_idx" ON "card_change_requests"("clientId");
CREATE INDEX "card_change_requests_status_idx" ON "card_change_requests"("status");
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX "notifications_status_idx" ON "notifications"("status");
CREATE INDEX "coach_notes_athleteId_createdAt_idx" ON "coach_notes"("athleteId", "createdAt");
CREATE INDEX "coach_notes_coachId_createdAt_idx" ON "coach_notes"("coachId", "createdAt");
CREATE INDEX "coach_notes_schoolCoachId_createdAt_idx" ON "coach_notes"("schoolCoachId", "createdAt");
CREATE INDEX "coach_notes_athleteId_trainingCategory_idx" ON "coach_notes"("athleteId", "trainingCategory");
CREATE INDEX "note_digests_weekStart_idx" ON "note_digests"("weekStart");
CREATE INDEX "goals_athleteId_status_idx" ON "goals"("athleteId", "status");
CREATE INDEX "goals_athleteId_type_idx" ON "goals"("athleteId", "type");
CREATE INDEX "form_responses_athleteId_idx" ON "form_responses"("athleteId");
CREATE INDEX "programs_coachId_idx" ON "programs"("coachId");
CREATE INDEX "programs_athleteId_status_idx" ON "programs"("athleteId", "status");
CREATE INDEX "program_exercises_dayId_sortOrder_idx" ON "program_exercises"("dayId", "sortOrder");
CREATE INDEX "exercises_category_idx" ON "exercises"("category");
CREATE INDEX "athlete_profiles_familyId_idx" ON "athlete_profiles"("familyId");
CREATE INDEX "athlete_profiles_schoolTeamId_idx" ON "athlete_profiles"("schoolTeamId");
CREATE INDEX "athlete_profiles_ageGroup_idx" ON "athlete_profiles"("ageGroup");
CREATE INDEX "school_teams_slug_idx" ON "school_teams"("slug");
CREATE INDEX "school_teams_coachInviteToken_idx" ON "school_teams"("coachInviteToken");
CREATE INDEX "school_invoices_schoolTeamId_status_idx" ON "school_invoices"("schoolTeamId", "status");
CREATE INDEX "school_contracts_schoolTeamId_idx" ON "school_contracts"("schoolTeamId");
CREATE INDEX "school_contracts_signatureToken_idx" ON "school_contracts"("signatureToken");
CREATE INDEX "school_coaches_schoolTeamId_idx" ON "school_coaches"("schoolTeamId");
CREATE INDEX "school_coaches_email_idx" ON "school_coaches"("email");
CREATE INDEX "athlete_metrics_athleteId_metricType_idx" ON "athlete_metrics"("athleteId", "metricType");
CREATE INDEX "athlete_metrics_athleteId_createdAt_idx" ON "athlete_metrics"("athleteId", "createdAt");
CREATE INDEX "athlete_metrics_schoolCoachId_idx" ON "athlete_metrics"("schoolCoachId");
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_locations" ADD CONSTRAINT "staff_locations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athlete_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_credits" ADD CONSTRAINT "weekly_credits_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weekly_credits" ADD CONSTRAINT "weekly_credits_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "client_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "client_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "card_change_requests" ADD CONSTRAINT "card_change_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "card_change_requests" ADD CONSTRAINT "card_change_requests_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_schoolCoachId_fkey" FOREIGN KEY ("schoolCoachId") REFERENCES "school_coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "note_digests" ADD CONSTRAINT "note_digests_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "digest_recipients" ADD CONSTRAINT "digest_recipients_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_formId_fkey" FOREIGN KEY ("formId") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "program_weeks" ADD CONSTRAINT "program_weeks_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "program_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "program_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "families" ADD CONSTRAINT "families_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "families" ADD CONSTRAINT "families_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "athlete_profiles" ADD CONSTRAINT "athlete_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "athlete_profiles" ADD CONSTRAINT "athlete_profiles_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "athlete_profiles" ADD CONSTRAINT "athlete_profiles_schoolTeamId_fkey" FOREIGN KEY ("schoolTeamId") REFERENCES "school_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_records_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athlete_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_teams" ADD CONSTRAINT "school_teams_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "school_invoices" ADD CONSTRAINT "school_invoices_schoolTeamId_fkey" FOREIGN KEY ("schoolTeamId") REFERENCES "school_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_contracts" ADD CONSTRAINT "school_contracts_schoolTeamId_fkey" FOREIGN KEY ("schoolTeamId") REFERENCES "school_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "school_coaches" ADD CONSTRAINT "school_coaches_schoolTeamId_fkey" FOREIGN KEY ("schoolTeamId") REFERENCES "school_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_schoolCoachId_fkey" FOREIGN KEY ("schoolCoachId") REFERENCES "school_coaches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "athlete_metrics" ADD CONSTRAINT "athlete_metrics_staffCoachId_fkey" FOREIGN KEY ("staffCoachId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
