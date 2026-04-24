# Migration: `expand_roles_add_user_roles_schoolteam_type`

Part 1 of 3 in the April 2026 staff-role expansion. Schema-only — no feature changes yet.

## What this migration does

1. Extends the `Role` enum from 3 values (ADMIN/STAFF/CLIENT) to 13 (keeps the legacy 3, adds 10 new fine-grained roles).
2. Adds `SchoolTeamType` enum (HIGH_SCHOOL / TRAVEL_TEAM / COLLEGE) + `type` column on `school_teams` (default HIGH_SCHOOL so existing rows stay valid).
3. Adds `OutsideCoachType` enum (8 values) + nullable `coachType` column on `outside_coach_links`.
4. Creates `user_roles` junction table so a user can hold multiple roles simultaneously (e.g. Performance Coach + Content & Marketing layered on the same account).

## Deploy order

1. **Apply this migration** (`prisma migrate deploy` — runs automatically on Railway).
2. **After the deploy completes, run the data migration script ONCE:**

   ```bash
   railway run -- npx tsx scripts/migrate-user-roles.ts
   ```

   This backfills `user_roles` rows from existing `User.role` + `StaffLocation`:
   - `ADMIN` → `UserRole(ADMIN, global)`
   - `STAFF` → `UserRole(PERFORMANCE_COACH, locationId)` for each active StaffLocation
   - `CLIENT` → `UserRole(PARENT)` if they parent a Family, `UserRole(ATHLETE)` if they have their own AthleteProfile (both if both).

   The script is idempotent — safe to re-run; the unique constraint on `(userId, role, locationId, schoolTeamId)` prevents duplicates.

3. **After running the script**, visit the Admin → Staff page (ships in Commit 3) to manually promote the PERFORMANCE_COACH defaults to COORDINATOR / MEDICAL / etc. where appropriate.

## Important

- The legacy `User.role` column is **not dropped** in this migration. Existing code still reads it. Commits 2 + 3 will gradually switch callers to read from `UserRole` instead.
- No existing queries or routes change in this commit — it's schema-only so we can deploy safely and verify the data migration before any permission-enforcement changes.
