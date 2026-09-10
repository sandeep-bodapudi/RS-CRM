const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const invalidExitReasons = await prisma.$queryRaw`
      SELECT DISTINCT exit_reason
      FROM Lead
      WHERE exit_reason IS NOT NULL
        AND exit_reason NOT IN ('NO_MATCHING_INVENTORY', 'CHOSE_COMPETITOR', 'BUDGET_MISMATCH', 'NOT_READY', 'OTHER')
    `;
    console.log('Invalid Lead.exit_reasons:', invalidExitReasons);

    const invalidStatuses = await prisma.$queryRaw`
      SELECT DISTINCT status
      FROM SiteVisitBooking
      WHERE status NOT IN (
        'REQUESTED', 'PENDING_ACCEPTANCE', 'REASSIGNED', 'ESCALATED_TO_MARKETING_DIRECTOR',
        'ACCEPTED', 'PENDING_CUSTOMER_RECONFIRMATION', 'RESCHEDULE_REQUESTED',
        'PENDING_PM_RECONFIRMATION', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED',
        'ON_HOLD', 'CANCELLATION_PENDING_PM_CONFIRMATION'
      )
    `;
    console.log('Invalid SiteVisitBooking.statuses:', invalidStatuses);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
