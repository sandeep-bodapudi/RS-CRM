const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.auditEvent.create({
      data: {
        actor_id: 10,
        action: 'SECURITY_ALERT',
        entity_type: 'AUTH_FAILED',
        entity_id: 10,
        new_value: `Invalid password attempt`
      }
    });
    console.log('Success!');
  } catch (e) {
    console.error('ERROR:', e);
  } finally {
    await prisma.$disconnect();
  }
}
run();
