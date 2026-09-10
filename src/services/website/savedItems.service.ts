import { prisma } from '../../lib/prisma';
import { WebsiteSavedItemInput } from '../../shared';

const p = prisma;

const SELECT = {
  id: true,
  property_id: true,
  project_unit_id: true,
  created_at: true,
} as const;

/** Shortlist and Compare are identical in shape (one polymorphic saved-item
 * row per account, XOR'd between property_id/project_unit_id) — one service
 * parameterized by which Prisma delegate to use rather than two near-copies. */
export class WebsiteSavedItemsService {
  private static delegate(kind: 'shortlist' | 'compare'): any {
    return kind === 'shortlist' ? p.websiteShortlistItem : p.websiteCompareItem;
  }

  static async list(accountId: number, kind: 'shortlist' | 'compare') {
    return this.delegate(kind).findMany({
      where: { account_id: accountId },
      select: SELECT,
      orderBy: { created_at: 'desc' },
    });
  }

  static async add(accountId: number, kind: 'shortlist' | 'compare', data: WebsiteSavedItemInput) {
    const delegate = this.delegate(kind) as any;
    return delegate.upsert({
      where: data.property_id
        ? { account_id_property_id: { account_id: accountId, property_id: data.property_id } }
        : { account_id_project_unit_id: { account_id: accountId, project_unit_id: data.project_unit_id! } },
      create: {
        account_id: accountId,
        property_id: data.property_id ?? null,
        project_unit_id: data.project_unit_id ?? null,
      },
      update: {},
      select: SELECT,
    });
  }

  static async remove(accountId: number, kind: 'shortlist' | 'compare', data: WebsiteSavedItemInput) {
    const delegate = this.delegate(kind) as any;
    const where = data.property_id
      ? { account_id: accountId, property_id: data.property_id }
      : { account_id: accountId, project_unit_id: data.project_unit_id };
    await delegate.deleteMany({ where });
    return { removed: true };
  }
}
