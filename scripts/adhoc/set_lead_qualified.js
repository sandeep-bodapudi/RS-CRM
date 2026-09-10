const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const lead = await p.lead.findFirst({ where: { company_id: 2 }, orderBy: { id: 'desc' } });
  console.log('before', lead.id, lead.lead_code, lead.status);
  await p.lead.update({ where: { id: lead.id }, data: { status: 'QUALIFIED' } });
  console.log('updated', lead.id, 'to QUALIFIED');
  await p.$disconnect();
})();
