const { PrismaClient } = require('@prisma/client');
const https = require('https');

async function main() {
  const prisma = new PrismaClient();
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  const apiKey = key.api_key;
  console.log('Using API key: ' + apiKey);
  console.log('Key length: ' + apiKey.length);

  // Test CRM: list properties
  console.log('\n=== CRM: RRH properties list ===');
  const listUrl = 'http://localhost:3000/api/v1/public/rrh/properties?limit=5';
  const listRes = await fetch(listUrl, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }
  });
  const listData = await listRes.json();
  console.log('Status: ' + listRes.status + ' | Count: ' + (Array.isArray(listData) ? listData.length : 'N/A'));
  if (Array.isArray(listData)) {
    listData.forEach(p => console.log('  ' + p.id + ' | ' + p.property_code + ' | ' + p.title + ' | ' + p.category + ' | ' + p.status));
  } else {
    console.log('  Response: ' + JSON.stringify(listData));
  }

  // Test CRM: property detail
  console.log('\n=== CRM: RRH property detail 8889536 ===');
  const detailUrl = 'http://localhost:3000/api/v1/public/rrh/properties/8889536';
  const detailRes = await fetch(detailUrl, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }
  });
  const detailData = await detailRes.json();
  console.log('Status: ' + detailRes.status);
  console.log('Title: ' + detailData.title);
  console.log('Category: ' + detailData.category);
  console.log('Price: ' + detailData.price);
  console.log('Area: ' + detailData.area_sqft);
  console.log('Location: ' + detailData.location);

  await prisma.$disconnect();
}

main().catch(console.error);
