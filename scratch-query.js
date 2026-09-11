const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "mysql://u988844918_RS_CRM:RSCRMrs369@82.25.121.145/u988844918_RS_DB"
    }
  }
});

async function main() {
  console.log('Applying migrations...');

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Demo\` ADD COLUMN \`accepted_at\` DATETIME(3) NULL`);
    console.log('Added Demo.accepted_at');
  } catch (e) { console.log('Demo.accepted_at:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Demo\` ADD COLUMN \`accepted_by\` INTEGER NULL`);
    console.log('Added Demo.accepted_by');
  } catch (e) { console.log('Demo.accepted_by:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Demo\` ADD COLUMN \`status\` VARCHAR(191) NOT NULL DEFAULT 'PENDING'`);
    console.log('Added Demo.status');
  } catch (e) { console.log('Demo.status:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Project\` ADD COLUMN \`verification_notes\` TEXT NULL`);
    console.log('Added Project.verification_notes');
  } catch (e) { console.log('Project.verification_notes:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Project\` ADD COLUMN \`verification_status\` VARCHAR(191) NOT NULL DEFAULT 'DRAFT'`);
    console.log('Added Project.verification_status');
  } catch (e) { console.log('Project.verification_status:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Project\` ADD COLUMN \`verified_at\` DATETIME(3) NULL`);
    console.log('Added Project.verified_at');
  } catch (e) { console.log('Project.verified_at:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Project\` ADD COLUMN \`verified_by_id\` INTEGER NULL`);
    console.log('Added Project.verified_by_id');
  } catch (e) { console.log('Project.verified_by_id:', e.message); }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`Project\` ADD CONSTRAINT \`Project_verified_by_id_fkey\` FOREIGN KEY (\`verified_by_id\`) REFERENCES \`Employee\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`);
    console.log('Added Project.verified_by_id FK');
  } catch (e) { console.log('Project FK:', e.message); }

  console.log('Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
