// setup_all.js — Create projects + published properties for both Sonthillu and RRH
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function setup() {
  console.log('=== SETUP: Projects + Published Properties for both brands ===\n');

  // ── 1. Get companies and keys ──────────────────────────────────────────────
  const soth = await p.company.findUnique({ where: { code: 'SONTHILLU' } });
  const rrh  = await p.company.findUnique({ where: { code: 'RRH' } });
  if (!soth) throw new Error('Sonthillu company not found');
  if (!rrh)  throw new Error('RRH company not found');
  console.log('Sonthillu:', soth.id, soth.name);
  console.log('RRH:', rrh.id, rrh.name);

  // ── 2. Create a Sonthillu project ──────────────────────────────────────────
  console.log('\n--- Creating Sonthillu project ---');
  const sothProject = await p.project.upsert({
    where: { id: 9000001 },
    update: {},
    create: {
      id: 9000001,
      project_code: 'PRJ-SOTH-001',
      company_id: soth.id,
      name: 'Sonthillu Green Acres',
      description: 'Premium residential community with 2/3/4 BHK apartments and independent villas in Gachibowli.',
      location: 'Gachibowli, Hyderabad',
      project_type: 'APARTMENT',
      developer_name: 'Sonthillu Constructions',
      status: 'UNDER_CONSTRUCTION',
      rera_number: 'RERA-HYD-2024-12345',
      rera_status: 'APPROVED',
      total_area_value: 1200000,
      total_area_unit: 'SQFT',
      towers_count: 4,
      blocks_count: 2,
      floors_count: 12,
      launch_date: new Date('2024-06-01'),
      completion_date: new Date('2026-03-31'),
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500032',
      address: 'Green Acres, Near Hitachi Corporate Office, Gachibowli, Hyderabad - 500032',
      latitude: 17.4440,
      longitude: 78.3210,
      default_price_basis: 'SUPER_BUILT_UP',
      default_area_unit: 'SQFT',
      is_published: true,
      slug: 'sonthillu-green-acres',
      amenities: JSON.stringify(['Swimming Pool', 'Gym', 'Club House', 'Park', 'Children Play Area']),
    },
  });
  console.log('Created Sonthillu project:', sothProject.id, sothProject.project_code, sothProject.name, 'slug:', sothProject.slug);

  // ── 3. Create Sonthillu properties (residential) ───────────────────────────
  console.log('\n--- Creating Sonthillu residential properties ---');
  const sothProperties = [
    {
      id: 9000002,
      property_code: 'SOTH-APT-001',
      title: '2 BHK Apartment - Green Acres',
      description: 'Spacious 2 BHK apartment in Sonthillu Green Acres with modern amenities and excellent connectivity.',
      category: 'APARTMENT',
      brand_type: 'SONTHILLU',
      status: 'LIVE',
      price: 4500000,
      area_sqft: 950,
      location: 'Gachibowli',
      address: 'Block A, Floor 5, Green Acres, Gachibowli, Hyderabad - 500032',
      bedrooms: 2,
      bathrooms: 2,
      facing: 'East',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: sothProject.id,
      company_id: soth.id,
      id: 9000003,
      property_code: 'SOTH-APT-002',
      title: '3 BHK Apartment - Green Acres',
      description: 'Premium 3 BHK apartment with 2 balconies, club house access, and underground parking.',
      category: 'APARTMENT',
      brand_type: 'SONTHILLU',
      status: 'LIVE',
      price: 6500000,
      area_sqft: 1350,
      location: 'Gachibowli',
      address: 'Block B, Floor 8, Green Acres, Gachibowli, Hyderabad - 500032',
      bedrooms: 3,
      bathrooms: 2,
      facing: 'South',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: sothProject.id,
      company_id: soth.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      pincode: '500032',
      amenities: JSON.stringify(['Swimming Pool', 'Gym', 'Club House', 'Parking', 'Power Backup']),
      project: { connect: { id: sothProject.id } },
    },
    {
      id: 9000004,
      property_code: 'SOTH-VIL-001',
      title: '3 BHK Villa - Green Acres',
      description: 'Independent 3 BHK villa with private garden, parking for 2 cars, and premium finishes.',
      category: 'VILLA',
      brand_type: 'SONTHILLU',
      status: 'LIVE',
      price: 12000000,
      area_sqft: 2200,
      location: 'Gachibowli',
      address: 'Villa Plot 12, Green Acres, Gachibowli, Hyderabad - 500032',
      bedrooms: 3,
      bathrooms: 3,
      facing: 'North',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: sothProject.id,
      company_id: soth.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      pincode: '500032',
      amenities: JSON.stringify(['Private Garden', '2 Car Parking', 'Power Backup', 'Club House']),
      project: { connect: { id: sothProject.id } },
    },
    {
      id: 9000005,
      property_code: 'SOTH-APT-003',
      title: '4 BHK Apartment - Green Acres Premium',
      description: 'Luxurious 4 BHK duplex with terrace, 3 bathrooms, and panoramic city views.',
      category: 'APARTMENT',
      brand_type: 'SONTHILLU',
      status: 'LIVE',
      price: 9500000,
      area_sqft: 1850,
      location: 'Gachibowli',
      address: 'Block C, Floor 10, Green Acres Premium, Gachibowli, Hyderabad - 500032',
      bedrooms: 4,
      bathrooms: 3,
      facing: 'West',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: sothProject.id,
      company_id: soth.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Gachibowli',
      pincode: '500032',
      amenities: JSON.stringify(['Swimming Pool', 'Gym', 'Club House', 'Terrace', '24/7 Security']),
      project: { connect: { id: sothProject.id } },
    },
  ];

  for (const prop of sothProperties) {
    await p.property.upsert({
      where: { id: prop.id },
      update: {},
      create: prop,
    });
    // Publish
    await p.propertyPublication.upsert({
      where: { id: `soth-${prop.id}` },
      update: {},
      create: {
        id: `soth-${prop.id}`,
        company_id: soth.id,
        property_id: prop.id,
        is_published: true,
      },
    });
    console.log('  Created+published:', prop.id, prop.property_code, prop.title, '₹' + prop.price.toLocaleString(), prop.area_sqft + ' sqft');
  }

  // ── 4. Create RRH project ──────────────────────────────────────────────────
  console.log('\n--- Creating RRH project ---');
  const rrhProject = await p.project.upsert({
    where: { id: 9000011 },
    update: {},
    create: {
      id: 9000011,
      project_code: 'PRJ-RRH-001',
      company_id: rrh.id,
      name: 'Radha Corporate Hub',
      description: 'Premium commercial complex with Grade-A offices, retail showrooms, and a large warehouse facility in the heart of Hyderabad.',
      location: 'Banjara Hills, Hyderabad',
      project_type: 'COMMERCIAL',
      developer_name: 'Radha Real Homes',
      status: 'UNDER_CONSTRUCTION',
      rera_number: 'RERA-HYD-2024-67890',
      rera_status: 'APPROVED',
      total_area_value: 850000,
      total_area_unit: 'SQFT',
      towers_count: 2,
      blocks_count: 3,
      floors_count: 8,
      launch_date: new Date('2024-09-01'),
      completion_date: new Date('2025-12-31'),
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500034',
      address: 'Radha Corporate Hub, Road No. 12, Banjara Hills, Hyderabad - 500034',
      latitude: 17.4150,
      longitude: 78.4420,
      default_price_basis: 'SUPER_BUILT_UP',
      default_area_unit: 'SQFT',
      is_published: true,
      slug: 'radha-corporate-hub',
      amenities: JSON.stringify(['Concierge', 'Parking', 'Security', 'Backup Power', 'Pantry']),
    },
  });
  console.log('Created RRH project:', rrhProject.id, rrhProject.project_code, rrhProject.name, 'slug:', rrhProject.slug);

  // ── 5. Create RRH commercial properties ────────────────────────────────────
  console.log('\n--- Creating RRH commercial properties ---');
  const rrhProperties = [
    {
      id: 9000012,
      property_code: 'RRH-OFF-001',
      title: 'Grade-A Office - Radha Corporate Hub',
      description: 'Premium Grade-A office space on the 5th floor with panoramic city views and modern infrastructure.',
      category: 'OFFICE',
      brand_type: 'RADHA_REAL_HOMES',
      status: 'LIVE',
      price: 8500000,
      area_sqft: 2500,
      location: 'Banjara Hills',
      address: 'Radha Corporate Hub, Floor 5, Banjara Hills, Hyderabad - 500034',
      bedrooms: 0,
      bathrooms: 2,
      facing: 'North',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: rrhProject.id,
      company_id: rrh.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Banjara Hills',
      pincode: '500034',
      amenities: JSON.stringify(['Conference Room', 'Pantry', 'Parking', 'Security', 'Backup Power']),
      project: { connect: { id: rrhProject.id } },
    },
    {
      id: 9000013,
      property_code: 'RRH-RET-001',
      title: 'Retail Showroom - Radha Corporate Hub',
      description: 'Premium retail showroom on the ground floor with high visibility, outdoor display area, and full power backup.',
      category: 'RETAIL',
      brand_type: 'RADHA_REAL_HOMES',
      status: 'LIVE',
      price: 15000000,
      area_sqft: 3200,
      location: 'Banjara Hills',
      address: 'Radha Corporate Hub, Ground Floor, Banjara Hills, Hyderabad - 500034',
      bedrooms: 0,
      bathrooms: 1,
      facing: 'Main Road',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: rrhProject.id,
      company_id: rrh.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Banjara Hills',
      pincode: '500034',
      amenities: JSON.stringify(['Outdoor Display', 'Parking', 'Security', 'Power Backup', 'Signage Rights']),
      project: { connect: { id: rrhProject.id } },
    },
    {
      id: 9000014,
      property_code: 'RRH-WAR-001',
      title: 'Industrial Warehouse - Radha Corporate Hub',
      description: 'Spacious industrial warehouse with loading bays, high ceiling, heavy-duty flooring, and 24/7 access.',
      category: 'WAREHOUSE',
      brand_type: 'RADHA_REAL_HOMES',
      status: 'LIVE',
      price: 7200000,
      area_sqft: 12000,
      location: 'Banjara Hills',
      address: 'Radha Corporate Hub, Warehouse Block, Banjara Hills, Hyderabad - 500034',
      bedrooms: 0,
      bathrooms: 2,
      facing: 'East',
      possession_status: 'UNDER_CONSTRUCTION',
      listing_type: 'NEW',
      project_id: rrhProject.id,
      company_id: rrh.id,
      state: 'Telangana',
      city: 'Hyderabad',
      locality: 'Banjara Hills',
      pincode: '500034',
      amenities: JSON.stringify(['Loading Bay', 'Heavy Flooring', '24/7 Access', 'Security', 'Power Backup']),
      project: { connect: { id: rrhProject.id } },
    },
  ];

  for (const prop of rrhProperties) {
    await p.property.upsert({
      where: { id: prop.id },
      update: {},
      create: prop,
    });
    await p.propertyPublication.upsert({
      where: { id: `rrh-${prop.id}` },
      update: {},
      create: {
        id: `rrh-${prop.id}`,
        company_id: rrh.id,
        property_id: prop.id,
        is_published: true,
      },
    });
    console.log('  Created+published:', prop.id, prop.property_code, prop.title, '₹' + prop.price.toLocaleString(), prop.area_sqft + ' sqft');
  }

  // ── 6. Verify ──────────────────────────────────────────────────────────────
  console.log('\n=== VERIFICATION ===');
  const sothPubs = await p.property.findMany({
    where: {
      company_id: soth.id,
      publications: { some: { company_id: soth.id, is_published: true } },
      OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
    },
    select: { id: true, property_code: true, title: true, category: true, price: true, area_sqft: true, status: true, brand_type: true, project_id: true },
    orderBy: { id: 'asc' },
  });
  console.log('Sonthillu published+LIVE properties:', sothPubs.length);
  sothPubs.forEach(x => console.log('  ', x.id, x.property_code, x.title, x.category, '₹'+x.price.toLocaleString(), x.area_sqft+'sqft', 'proj:', x.project_id));

  const rrhPubs = await p.property.findMany({
    where: {
      company_id: rrh.id,
      publications: { some: { company_id: rrh.id, is_published: true } },
      OR: [{ status: 'LIVE' }, { status: 'LOCKED', locked_until: { lt: new Date() } }],
    },
    select: { id: true, property_code: true, title: true, category: true, price: true, area_sqft: true, status: true, brand_type: true, project_id: true },
    orderBy: { id: 'asc' },
  });
  console.log('RRH published+LIVE properties:', rrhPubs.length);
  rrhPubs.forEach(x => console.log('  ', x.id, x.property_code, x.title, x.category, '₹'+x.price.toLocaleString(), x.area_sqft+'sqft', 'proj:', x.project_id));

  const sothProjCheck = await p.project.findMany({
    where: {
      company_id: soth.id,
      properties: { some: { brand_type: 'SONTHILLU', publications: { some: { company_id: soth.id, is_published: true } } } },
      status: { not: 'CANCELLED' },
    },
    select: { id: true, project_code: true, name: true, is_published: true, slug: true },
  });
  console.log('\nSonthillu published projects:', sothProjCheck.length);
  sothProjCheck.forEach(x => console.log('  ', x.id, x.project_code, x.name, 'slug:', x.slug));

  const rrhProjCheck = await p.project.findMany({
    where: {
      company_id: rrh.id,
      properties: { some: { brand_type: 'RADHA_REAL_HOMES', publications: { some: { company_id: rrh.id, is_published: true } } } },
      status: { not: 'CANCELLED' },
    },
    select: { id: true, project_code: true, name: true, is_published: true, slug: true },
  });
  console.log('RRH published projects:', rrhProjCheck.length);
  rrhProjCheck.forEach(x => console.log('  ', x.id, x.project_code, x.name, 'slug:', x.slug));

  await p.$disconnect();
  console.log('\n=== SETUP COMPLETE ===');
}

setup().catch(e => { console.error('FATAL:', e); process.exit(1); });
