import { PropertyService } from './src/services/property.service';
import { prisma } from './src/lib/prisma';

async function test() {
  const user = { id: 1, roles: ['SUPER_ADMIN'], companyId: 1, employeeId: 1, permissions: ['properties.create', 'properties.update'] };
  const payload = {
    title: "Test Property Minimal",
    description: "",
    brand_type: "SONTHILLU",
    category: "APARTMENT",
    price: 5000000,
    area_sqft: 1200,
    location: "KPHB",
    pricing: {},
  };

  try {
    const res = await PropertyService.createProperty(user as any, payload as any);
    console.log("Success:", res);
  } catch (e) {
    console.error("Error creating property:");
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

test();
