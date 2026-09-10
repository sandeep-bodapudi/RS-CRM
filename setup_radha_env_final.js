const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function main() {
  const prisma = new PrismaClient();
  
  // Get RRH API key
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  const apiKey = key.api_key;
  console.log('RRH Key:', apiKey);
  console.log('Length:', apiKey.length);
  
  // Write Radha-Backend .env with the correct key
  const envPath = 'D:/HYD/Sonthillu/Radha_real_home/Radha-Backend/.env';
  const envContent = [
    'CRM_API_BASE_URL=http://localhost:3000/api/v1',
    'CRM_API_KEY=' + apiKey,
    'PORT=4001',
    'FRONTEND_URL=http://localhost:3002',
    ''
  ].join('\n');
  
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('\nWrote .env to:', envPath);
  
  // Verify by reading back
  const readBack = fs.readFileSync(envPath, 'utf8');
  console.log('Verified .env:');
  console.log(readBack);
  
  // Also write Radha project .env
  const projectEnvPath = 'D:/HYD/Sonthillu/Radha_real_home/radha-real-home-properties/.env';
  const projectEnv = [
    'CRM_API_BASE_URL=http://localhost:3000/api/v1',
    'CRM_API_KEY=' + apiKey,
    'NEXT_PUBLIC_BACKEND_URL=http://localhost:4001',
    'NEXT_PUBLIC_SITE_URL=http://localhost:3002',
    ''
  ].join('\n');
  fs.writeFileSync(projectEnvPath, projectEnv, 'utf8');
  console.log('Wrote project .env to:', projectEnvPath);
  
  await prisma.$disconnect();
}

main().catch(console.error);
