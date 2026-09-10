const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

async function main() {
  const prisma = new PrismaClient();
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });

  const apiKey = key.api_key;
  console.log('RRH API Key: ' + apiKey);
  console.log('Length: ' + apiKey.length);

  // Radha-Backend .env
  const backendEnvPath = 'D:/HYD/Sonthillu/Radha_real_home/Radha-Backend/.env';
  let backendEnv = fs.readFileSync(backendEnvPath, 'utf8');
  backendEnv = backendEnv.replace(/CRM_API_KEY=.*/, 'CRM_API_KEY=' + apiKey);
  fs.writeFileSync(backendEnvPath, backendEnv);
  console.log('\nUpdated Radha-Backend .env:');
  console.log(fs.readFileSync(backendEnvPath, 'utf8'));

  // Radha project .env
  const projectEnvPath = 'D:/HYD/Sonthillu/Radha_real_home/radha-real-home-properties/.env';
  const projectEnv = 'CRM_API_BASE_URL=http://localhost:3000/api/v1\n' +
    'CRM_API_KEY=' + apiKey + '\n' +
    'NEXT_PUBLIC_BACKEND_URL=http://localhost:4001\n' +
    'NEXT_PUBLIC_SITE_URL=http://localhost:3002\n';
  fs.writeFileSync(projectEnvPath, projectEnv);
  console.log('Created Radha project .env:');
  console.log(fs.readFileSync(projectEnvPath, 'utf8'));

  await prisma.$disconnect();
}

main().catch(console.error);
