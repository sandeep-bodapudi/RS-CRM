const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const status = process.argv[2];
  const visit = await p.siteVisitBooking.findFirst({ orderBy: { id: 'desc' } });
  console.log('before', visit.id, visit.status);
  await p.siteVisitBooking.update({ where: { id: visit.id }, data: { status } });
  console.log('updated', visit.id, 'to', status);
  await p.$disconnect();
})();
