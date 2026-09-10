const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const leads = await p.lead.findMany({
    where: { status: 'QUALIFIED' },
    select: { id: true, lead_code: true, customer_name: true, company_id: true, status: true },
    take: 5,
  });
  console.log(JSON.stringify(leads, null, 2));
  await p.$disconnect();
})();
