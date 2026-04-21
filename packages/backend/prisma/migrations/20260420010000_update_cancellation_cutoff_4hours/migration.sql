-- Update default cancellation cutoff from 1 hour to 4 hours
-- This affects new sessions/templates/configs going forward.
-- Existing sessions keep their current value.

ALTER TABLE "sessions" ALTER COLUMN "cancellationCutoffHours" SET DEFAULT 4;
ALTER TABLE "schedule_templates" ALTER COLUMN "cancellationCutoffHours" SET DEFAULT 4;
ALTER TABLE "session_type_configs" ALTER COLUMN "cancellationCutoffHours" SET DEFAULT 4;

-- Also update all existing sessions that still have the old 1-hour default
-- to use the new 4-hour standard (per Chad's requirement)
UPDATE "sessions" SET "cancellationCutoffHours" = 4 WHERE "cancellationCutoffHours" = 1;
UPDATE "schedule_templates" SET "cancellationCutoffHours" = 4 WHERE "cancellationCutoffHours" = 1;
UPDATE "session_type_configs" SET "cancellationCutoffHours" = 4 WHERE "cancellationCutoffHours" = 1;
