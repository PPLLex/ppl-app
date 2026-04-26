/**
 * Seed system tags on every server boot. Idempotent — uses (orgId, name)
 * unique constraint to upsert.
 *
 * Built-ins:
 *   - LOCATION: one per Location row in the DB (resolved at runtime, not
 *     hardcoded — handles new locations Chad adds without redeploying)
 *   - PLAYING_LEVEL: Youth, Middle School, High School, College, Pro
 *   - LIFECYCLE: Lead, Trial, Active Member, Churned
 *
 * All marked `system: true` so admins can't accidentally delete them.
 */

import { PrismaClient, TagKind } from '@prisma/client';

type TagSeed = { name: string; color: string; kind: TagKind; description?: string };

const PLAYING_LEVEL_TAGS: TagSeed[] = [
  { name: 'Youth', color: '#3B82F6', kind: TagKind.PLAYING_LEVEL, description: '12 and under' },
  { name: 'Middle School', color: '#06B6D4', kind: TagKind.PLAYING_LEVEL },
  { name: 'High School', color: '#8B5CF6', kind: TagKind.PLAYING_LEVEL },
  { name: 'College', color: '#F59E0B', kind: TagKind.PLAYING_LEVEL },
  { name: 'Pro', color: '#95C83C', kind: TagKind.PLAYING_LEVEL, description: 'MiLB / MLB' },
];

const LIFECYCLE_TAGS: TagSeed[] = [
  { name: 'Lead', color: '#6B7280', kind: TagKind.LIFECYCLE, description: 'In the funnel, not yet a member' },
  { name: 'Trial', color: '#F59E0B', kind: TagKind.LIFECYCLE },
  { name: 'Active Member', color: '#95C83C', kind: TagKind.LIFECYCLE },
  { name: 'Churned', color: '#EF4444', kind: TagKind.LIFECYCLE },
];

export async function bootstrapTags(prisma: PrismaClient): Promise<void> {
  try {
    const orgId = 'ppl';

    // Pull current locations to seed one tag per location dynamically.
    const locations = await prisma.location.findMany({ select: { name: true } });
    const locationTags: TagSeed[] = locations.map((l) => ({
      name: l.name,
      color: '#0EA5E9',
      kind: TagKind.LOCATION,
    }));

    const allSeeds = [...locationTags, ...PLAYING_LEVEL_TAGS, ...LIFECYCLE_TAGS];

    let created = 0;
    let updated = 0;
    for (const seed of allSeeds) {
      const result = await prisma.tag.upsert({
        where: { organizationId_name: { organizationId: orgId, name: seed.name } },
        create: {
          organizationId: orgId,
          name: seed.name,
          color: seed.color,
          kind: seed.kind,
          description: seed.description ?? null,
          system: true,
        },
        update: {
          // Only sync color/kind on existing rows — preserve the description
          // admins may have edited.
          color: seed.color,
          kind: seed.kind,
          system: true,
        },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
      else updated++;
    }

    console.log(
      `[bootstrapTags] ${created} created, ${updated} synced (${allSeeds.length} total system tags)`
    );
  } catch (err) {
    // Never block server startup on a tag seed failure.
    console.error('[bootstrapTags] failed (non-fatal):', err);
  }
}
