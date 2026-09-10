const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  await prisma.employee.update({
    where: { employee_code: 'RRH-TST-004' },
    data: { password_hash: '$2a$12$j8Rjn4T3nt0Yev37gAABmeyVwRSfahuq5EMDnISJ5bvibTCQ87XSS' }
  });
  console.log('Password restored');
  await prisma.$disconnect();
}
run();
