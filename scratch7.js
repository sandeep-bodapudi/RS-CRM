const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.company.findUnique({ where: { id: 2 } }).then(console.log).catch(console.error).finally(() => prisma.$disconnect());
