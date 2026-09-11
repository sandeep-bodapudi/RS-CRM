import { prisma } from '../../lib/prisma';

const p = prisma;

/**
 * Helper to generate sequential static lead code: RRH-LD-YYYY-XXXX
 */
export async function generateNextLeadCode(): Promise<string> {
  const currentYear = new Date().getFullYear();
  const count = await p.lead.count();
  const sequentialNum = (count + 1).toString().padStart(4, '0');
  return `RRH-LD-${currentYear}-${sequentialNum}`;
}

/**
 * Replaces a lead's full preferred-location list (§ Phase 2). Case-insensitive
 * de-dupe before insert — MySQL's utf8mb4_unicode_ci collation already treats
 * case-variants as the same unique key, so an un-deduped array would throw.
 * Caller is responsible for also keeping `Lead.preferred_location` (the
 * primary/first entry) in sync — this only manages the full-list table.
 */
export async function syncLeadPreferredLocations(
  tx: import('@prisma/client').Prisma.TransactionClient,
  leadId: number,
  locations: string[],
): Promise<void> {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const raw of locations) {
    const loc = raw.trim();
    if (!loc) continue;
    const key = loc.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(loc);
    }
  }

  await tx.leadPreferredLocation.deleteMany({ where: { lead_id: leadId } });
  if (deduped.length > 0) {
    await tx.leadPreferredLocation.createMany({
      data: deduped.map((location, idx) => ({ lead_id: leadId, location, sort_order: idx })),
    });
  }
}

export function calculateLeadScore(leadData: any): number {
  let score = 0;
  // Base score based on source
  if (leadData.source === 'WALK_IN' || leadData.source === 'REFERRAL') score += 20;
  else if (leadData.source === 'WEBSITE') score += 10;

  // Profile completeness
  if (leadData.email) score += 10;
  if (leadData.budget_min && leadData.budget_max) score += 15;
  if (leadData.preferred_location) score += 10;
  if (leadData.property_type_preference) score += 5;

  return score;
}
