const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function main() {
  const prisma = new PrismaClient();
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  const apiKey = key.api_key;
  console.log('RRH Key:', apiKey, '| len:', apiKey.length);

  // Write Radha-Backend .env
  const backendEnv = `CRM_API_BASE_URL=http://localhost:3000/api/v1
CRM_API_KEY=${apiKey}
PORT=4001
FRONTEND_URL=http://localhost:3002
`;
  fs.writeFileSync('D:/HYD/Sonthillu/Radha_real_home/Radha-Backend/.env', backendEnv);
  console.log('Wrote Radha-Backend .env');

  // Write Radha project .env
  const projectEnv = `CRM_API_BASE_URL=http://localhost:3000/api/v1
CRM_API_KEY=${apiKey}
NEXT_PUBLIC_BACKEND_URL=http://localhost:4001
NEXT_PUBLIC_SITE_URL=http://localhost:3002
`;
  fs.writeFileSync('D:/HYD/Sonthillu/Radha_real_home/radha-real-home-properties/.env', projectEnv);
  console.log('Wrote Radha project .env');

  // Copy Sonthillu-Backend files
  const srcDir = 'D:/HYD/Sonthillu/Sonthillu-Backend/src';
  const dstDir = 'D:/HYD/Sonthillu/Radha_real_home/Radha-Backend/src';

  // Copy index.ts (modify PORT)
  let indexTs = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  indexTs = indexTs.replace('process.env.PORT || 4000', 'process.env.PORT || 4001');
  indexTs = indexTs.replace("origin: process.env.FRONTEND_URL || 'http://localhost:3000'", "origin: process.env.FRONTEND_URL || 'http://localhost:3002'");
  // Remove auth/customer/search/admin/analytics routes (not needed for Radha)
  indexTs = indexTs.replace(/\nimport authRoutes.*\n/, '');
  indexTs = indexTs.replace(/\nimport customerRoutes.*\n/, '');
  indexTs = indexTs.replace(/\nimport searchRoutes.*\n/, '');
  indexTs = indexTs.replace(/\nimport adminRoutes.*\n/, '');
  indexTs = indexTs.replace(/\nimport analyticsRoutes.*\n/, '');
  indexTs = indexTs.replace(/\napp\.use\(\'\/api\/auth\'.*?\n/, '');
  indexTs = indexTs.replace(/\napp\.use\(\'\/api\/customer\'.*?\n/, '');
  indexTs = indexTs.replace(/\napp\.use\(\'\/api\/search\'.*?\n/, '');
  indexTs = indexTs.replace(/\napp\.use\(\'\/api\/admin\'.*?\n/, '');
  indexTs = indexTs.replace(/\napp\.use\(\'\/api\/analytics\'.*?\n/, '');
  fs.writeFileSync(path.join(dstDir, 'index.ts'), indexTs);
  console.log('Copied index.ts');

  // Copy crm.ts (change brand)
  let crmTs = fs.readFileSync(path.join(srcDir, 'services/crm.ts'), 'utf8');
  crmTs = crmTs.replace("const BRAND_PARAMETER = 'sonthillu'", "const BRAND_PARAMETER = 'rrh'");
  fs.writeFileSync(path.join(dstDir, 'services/crm.ts'), crmTs);
  console.log('Copied services/crm.ts (brand=rrh)');

  // Copy routes
  for (const route of ['properties', 'projects', 'leads']) {
    fs.copyFileSync(path.join(srcDir, 'routes', route + '.ts'), path.join(dstDir, 'routes', route + '.ts'));
  }
  console.log('Copied routes/');

  // Copy db.ts
  fs.copyFileSync(path.join(srcDir, 'db.ts'), path.join(dstDir, 'db.ts'));
  console.log('Copied db.ts');

  await prisma.$disconnect();
  console.log('\nDone! Radha-Backend ready.');
}

main().catch(console.error);
