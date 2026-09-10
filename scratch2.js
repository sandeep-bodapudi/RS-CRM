const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function run() {
  const employee_code = 'RRH-TST-004';
  const password = 'password123';
  try {
    const employee = await prisma.employee.findUnique({
      where: { employee_code },
      include: {
        company: true,
        branch: true,
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } }
            },
          },
        },
        permission_overrides: { include: { permission: true } },
      },
    });

    if (!employee || employee.status !== 'ACTIVE') {
      console.log('Invalid/Inactive');
      return;
    }

    const isMatch = await bcrypt.compare(password, employee.password_hash);
    if (!isMatch) {
      console.log('Invalid password');
      return;
    }

    console.log('Password matches!');
    
    // Test creating AuthSession
    await prisma.authSession.create({
      data: {
        employee_id: employee.id,
        family_token: 'test-token',
        refresh_token_hash: 'test-hash',
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
