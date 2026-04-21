-- CreateTable: org_settings (singleton for PPL branding & defaults)
CREATE TABLE "org_settings" (
    "id" TEXT NOT NULL DEFAULT 'ppl',
    "businessName" TEXT NOT NULL DEFAULT 'Pitching Performance Lab',
    "tagline" TEXT NOT NULL DEFAULT 'Train like a pro.',
    "logoData" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#166534',
    "accentColor" TEXT NOT NULL DEFAULT '#4ade80',
    "defaultCapacity" INTEGER NOT NULL DEFAULT 8,
    "sessionDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "registrationCutoffHours" INTEGER NOT NULL DEFAULT 1,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id")
);

-- Insert default row
INSERT INTO "org_settings" ("id", "updatedAt")
VALUES ('ppl', NOW())
ON CONFLICT ("id") DO NOTHING;
