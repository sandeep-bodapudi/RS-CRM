"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateSystemEmployee = void 0;
const prisma_1 = require("../lib/prisma");
const p = prisma_1.prisma;
/**
 * A company's non-login placeholder Employee, used as the FK-required
 * "actor" for automated system actions (e.g. the LeadActivity audit-trail
 * row for a website-originated lead) where no real employee performed the
 * action. `password_hash` is intentionally empty so it can never
 * authenticate — bcrypt.compare against '' always fails.
 *
 * Company 1 already had one seeded by hand (SYSTEM-DEFAULT-001); this
 * lazily provisions the same thing for every other company the first time
 * it's needed, so public-website lead ingestion works for any company, not
 * just the one that happened to get seeded manually.
 */
async function getOrCreateSystemEmployee(companyId) {
    const existing = await p.employee.findFirst({
        where: { company_id: companyId, employee_code: { startsWith: 'SYSTEM-DEFAULT-' } },
    });
    if (existing)
        return existing;
    return p.employee.create({
        data: {
            employee_code: `SYSTEM-DEFAULT-${String(companyId).padStart(3, '0')}`,
            company_id: companyId,
            password_hash: '',
            status: 'ACTIVE',
            full_name: 'System Default Actor',
            attendance_required: false,
            first_login_done: true,
            report_required: false,
        },
    });
}
exports.getOrCreateSystemEmployee = getOrCreateSystemEmployee;
