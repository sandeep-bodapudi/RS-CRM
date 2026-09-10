const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const codes = process.argv.slice(2);
  const hash = await bcrypt.hash('Test@1234', 12);
  for (const code of codes) {
    await p.employee.update({ where: { employee_code: code }, data: { password_hash: hash } });
    console.log('reset', code);
  }
  await p.$disconnect();
})();
