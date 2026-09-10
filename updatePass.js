const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function run() {
  const hash = await bcrypt.hash('password123', 12);
  await prisma.employee.update({
    where: { employee_code: 'RRH-TST-004' },
    data: { password_hash: hash }
  });
  console.log('Password updated to password123');
  await prisma.$disconnect();
}
run();
