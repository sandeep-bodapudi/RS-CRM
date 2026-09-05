const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.project.findFirst().then(() => {
  console.log('Connected!');
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
