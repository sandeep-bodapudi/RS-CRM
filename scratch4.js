const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const employee_code = 'RRH-TST-004';
  try {
    const employee = await prisma.employee.findUnique({
      where: { employee_code },
    });

    // Test creating AuthSession
    await prisma.authSession.create({
      data: {
        employee_id: employee.id,
        family_token: 'test-token-' + Date.now(),
        refresh_token_hash: 'test-hash-' + Date.now(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });
    console.log('Session created!');
    
  } catch (e) {
    console.error('ERROR OCCURRED:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
