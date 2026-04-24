-- Add PITCHING_ASSESSMENT to the SessionType enum. Dedicated first-contact
-- evaluation session for new athletes before they start regular training.
-- See schema.prisma SessionType enum comment for design notes.
--
-- Postgres ADD VALUE is idempotent with IF NOT EXISTS — safe to re-run.

ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'PITCHING_ASSESSMENT';
