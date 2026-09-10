const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const customer = await p.customer.findFirst({ where: { company_id: 2 } });
  const property = await p.property.findFirst({ where: { company_id: 2 } });
  console.log(JSON.stringify({ customerId: customer?.id, propertyId: property?.id }, null, 2));
  await p.$disconnect();
})();
