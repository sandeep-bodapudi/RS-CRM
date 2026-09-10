const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const emps = await p.employee.findMany({
    select: { id: true, employee_code: true, full_name: true, company_id: true, status: true, roles: { select: { role: { select: { name: true } } } } },
    take: 30,
    orderBy: { id: 'asc' }
  });
  console.log(JSON.stringify(emps, null, 2));
  await p.$disconnect();
})();
