const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  
  // Get RRH key
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true, id: true, company_id: true }
  });
  console.log('RRH key (id=' + key.id + ', company_id=' + key.company_id + '):', key.api_key);
  console.log('Length:', key.api_key.length);

  // Also check what company the Sonthillu key maps to
  const sonthilluKey = await prisma.publicApiKey.findFirst({
    where: { company_id: 1027, is_active: true },
    select: { api_key: true, id: true, company_id: true }
  });
  console.log('Sonthillu key (id=' + sonthilluKey.id + ', company_id=' + sonthilluKey.company_id + '):', sonthilluKey.api_key);
  
  // Now test: does the RRH key actually work for RRH brand?
  console.log('\n=== Direct CRM test with RRH key ===');
  const crmRes = await fetch('http://localhost:3000/api/v1/public/rrh/properties?limit=3', {
    headers: { 'x-api-key': key.api_key }
  });
  console.log('CRM status:', crmRes.status);
  const crmData = await crmRes.json();
  console.log('Response:', JSON.stringify(crmData));
  
  // Test Sonthillu key with RRH brand
  console.log('\n=== Direct CRM test with Sonthillu key on RRH brand ===');
  const sRes = await fetch('http://localhost:3000/api/v1/public/rrh/properties?limit=3', {
    headers: { 'x-api-key': sonthilluKey.api_key }
  });
  console.log('CRM status:', sRes.status);
  const sData = await sRes.json();
  console.log('Response:', JSON.stringify(sData));
  
  await prisma.$disconnect();
}

main().catch(console.error);
