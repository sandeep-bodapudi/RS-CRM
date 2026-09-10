const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  const apiKey = key.api_key;
  console.log('=== CRM: RRH properties list ===');
  const listRes = await fetch('http://localhost:3000/api/v1/public/rrh/properties?limit=5', {
    headers: { 'x-api-key': apiKey }
  });
  const listData = await listRes.json();
  console.log('Status: ' + listRes.status + ' | Count: ' + (Array.isArray(listData) ? listData.length : 'N/A'));
  if (Array.isArray(listData)) {
    listData.forEach(p => console.log('  ' + p.id + ' | ' + p.property_code + ' | ' + p.title + ' | ' + p.category));
  } else {
    console.log('  Response: ' + JSON.stringify(listData));
  }

  console.log('\n=== CRM: RRH property detail ===');
  const detailRes = await fetch('http://localhost:3000/api/v1/public/rrh/properties/8889536', {
    headers: { 'x-api-key': apiKey }
  });
  const detailData = await detailRes.json();
  console.log('Status: ' + detailRes.status);
  console.log('Title: ' + detailData.title);
  console.log('Category: ' + detailData.category);
  console.log('Price: ' + detailData.price);
  console.log('Area: ' + detailData.area_sqft);

  console.log('\n=== Radha-Backend: RRH properties proxy ===');
  const proxyRes = await fetch('http://localhost:4001/api/properties?limit=5');
  const proxyData = await proxyRes.json();
  console.log('Status: ' + proxyRes.status + ' | Count: ' + (Array.isArray(proxyData) ? proxyData.length : 'N/A'));
  if (Array.isArray(proxyData)) {
    proxyData.forEach(p => console.log('  ' + p.id + ' | ' + p.property_code + ' | ' + p.title + ' | ' + p.category));
  }

  console.log('\n=== Radha-Backend: RRH detail proxy ===');
  const detailProxyRes = await fetch('http://localhost:4001/api/properties/8889536');
  const detailProxyData = await detailProxyRes.json();
  console.log('Status: ' + detailProxyRes.status);
  console.log('Title: ' + detailProxyData.title);

  await prisma.$disconnect();
}

main().catch(console.error);
