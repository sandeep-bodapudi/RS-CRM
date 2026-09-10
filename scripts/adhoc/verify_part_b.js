const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const companyId = 2;
  const salesValue = await p.booking.aggregate({
    _sum: { agreed_price: true },
    where: { company_id: companyId, status: 'CONFIRMED' },
  });
  const due = await p.$queryRaw`
    SELECT COALESCE(SUM(i.expected_amount - i.received_amount), 0) as due
    FROM Installment i
    JOIN Booking b ON b.id = i.booking_id
    WHERE b.company_id = ${companyId}
      AND i.status NOT IN ('CANCELLED', 'RECEIVED')
  `;
  const totalLeads = await p.lead.count({ where: { company_id: companyId } });
  const activeEmp = await p.$queryRaw`SELECT COUNT(*) as count FROM Employee WHERE status = 'ACTIVE' AND company_id = ${companyId}`;
  console.log(JSON.stringify({ salesValue: salesValue._sum.agreed_price, due: due.map(r => ({due: Number(r.due)})), totalLeads, activeEmp: activeEmp.map(r => ({count: Number(r.count)})) }, null, 2));
  await p.$disconnect();
})();
