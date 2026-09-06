import { LeadService } from './src/services/lead.service';
import { prisma } from './src/lib/prisma';

async function test() {
  try {
    // Make sure a lead exists
    let lead = await prisma.lead.findFirst({ where: { assigned_to_id: { not: null } } });
    if (!lead) {
      console.log('No lead found to test');
      return;
    }
    
    // Force it to QUALIFIED
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'QUALIFIED', budget_min: 100, budget_max: 200, property_type_preference: 'Villa', preferred_location: 'Hyderabad' }
    });
    
    // refetch
    lead = await prisma.lead.findUnique({ where: { id: lead.id } });

    const user = {
      employeeId: lead!.assigned_to_id,
      employeeCode: 'TEST',
      companyId: 1,
      branchId: 1,
      roles: ['admin'],
      permissions: ['leads.update', 'leads.read'],
    };

    console.log(`Testing transition to DEMO_SCHEDULED for lead ${lead!.id}`);

    const result = await LeadService.updateLeadStatus(
      user as any,
      lead!.id,
      'DEMO_SCHEDULED',
      undefined,
      {
        demo_scheduled_at: new Date().toISOString(),
        demo_handler_id: 1,
      }
    );

    console.log('Success:', result.status);
  } catch (error: any) {
    console.error('Error occurred:');
    console.error(error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

test();
