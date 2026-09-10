const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const company = await p.company.findUnique({
      where: { code: 'SONTHILLU' },
      select: { id: true }
    });
    if (!company) { console.log('NO_SONTHILLU_COMPANY'); return; }

    console.log('Company id:', company.id);

    // Get all LIVE + SONTHILLU properties
    const props = await p.property.findMany({
      where: { status: 'LIVE', brand_type: 'SONTHILLU' },
      select: { id: true, property_code: true, title: true }
    });
    console.log('LIVE+SONTHILLU properties:', props.length);
    for (const prop of props) console.log(`  id=${prop.id} ${prop.property_code} "${prop.title}"`);

    // Check existing publications for these properties
    const propIds = props.map(p => p.id);
    const existing = await p.propertyPublication.findMany({
      where: { property_id: { in: propIds } },
      select: { property_id: true, company_id: true, is_published: true }
    });
    console.log('\nExisting publications:', existing.length);

    // Create publications for any missing
    let created = 0;
    for (const prop of props) {
      const hasPub = existing.some(e => e.property_id === prop.id && e.company_id === company.id);
      if (!hasPub) {
        await p.propertyPublication.create({
          data: {
            property_id: prop.id,
            company_id: company.id,
            is_published: true
          }
        });
        console.log(`Published: property_id=${prop.id} (${prop.property_code})`);
        created++;
      } else {
        console.log(`Already published: property_id=${prop.id}`);
      }
    }
    console.log(`\nCreated ${created} publication(s)`);
  } catch (e) {
    console.log('ERR:', e.message);
  } finally {
    await p.$disconnect();
  }
})().catch(e => console.log('FATAL:', e.message));
