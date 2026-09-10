const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const emp = await prisma.employee.findUnique({ where: { employee_code: 'RRH-TST-004' }});
  console.log(emp);
  await prisma.$disconnect();
}

run();
