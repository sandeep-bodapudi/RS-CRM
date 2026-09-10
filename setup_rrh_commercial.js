const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Get RRH API key
  const key = await prisma.publicApiKey.findFirst({
    where: { company_id: 1, is_active: true },
    select: { api_key: true }
  });
  console.log('RRH_API_KEY=' + key.api_key);
  console.log('RRH_API_KEY_LENGTH=' + key.api_key.length);

  // 2. Create 3 commercial properties for RRH
  const startId = 8889536;
  const commercialTypes = ['OFFICE', 'RETAIL', 'WAREHOUSE'];
  const offices = [
    { title: 'Prime Corporate Office - Banjara Hills', location: 'Banjara Hills', area: 5000, price: 25000000, category: 'OFFICE' },
    { title: 'Retail Showroom - Jubilee Hills', location: 'Jubilee Hills', area: 3000, price: 15000000, category: 'RETAIL' },
    { title: 'Industrial Warehouse - Pashamylaram', location: 'Pashamylaram', area: 12000, price: 8000000, category: 'WAREHOUSE' },
  ];

  const created = [];
  for (let i = 0; i < offices.length; i++) {
    const off = offices[i];
    const prop = await prisma.property.create({
      data: {
        id: startId + i,
        property_code: 'RRH-COM-' + (startId + i),
        company_id: 1,
        title: off.title,
        description: 'Premium ' + off.category.toLowerCase() + ' space available for lease in ' + off.location + '. Contact for details.',
        brand_type: 'RADHA_REAL_HOMES',
        category: off.category,
        price: off.price,
        area_sqft: off.area,
        location: off.location,
        address: off.location + ', Hyderabad, Telangana',
        status: 'LIVE',
        listing_type: 'NEW',
      }
    });
    created.push(prop);
    console.log('Created property: ' + prop.id + ' | ' + prop.property_code + ' | ' + prop.title + ' | ' + prop.category);
  }

  // 3. Publish all 3 properties
  for (const prop of created) {
    await prisma.propertyPublication.create({
      data: {
        property_id: prop.id,
        company_id: 1,
        is_published: true,
        published_at: new Date(),
      }
    });
    console.log('Published: ' + prop.id);
  }

  console.log('');
  console.log('DONE: Created and published ' + created.length + ' commercial properties for RRH');
}

main().finally(() => prisma.$disconnect());
