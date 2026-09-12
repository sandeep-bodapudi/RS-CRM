import { prisma } from '../lib/prisma';
import { PrismaClient, Customer } from '@prisma/client';
import { TokenPayload } from '../utils/jwt';
import { Roles } from '../shared';
import { buildCustomerScope } from '../authz/dataScope';
import { CustomerPolicy } from '../policies/customer.policy';
import { WorkflowEngine } from '../workflows/workflowEngine';

const p = prisma;

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class CustomerService {
  private static async generateNextCustomerCode(tx: any = p): Promise<string> {
    const currentYear = new Date().getFullYear();
    const count = await tx.customer.count();
    const sequentialNum = (count + 1).toString().padStart(4, '0');
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RRH-CUST-${currentYear}-${sequentialNum}-${randomHex}`;
  }

  static async getCustomers(user: TokenPayload, take: number = 50, skip: number = 0) {
    const whereCondition = await buildCustomerScope(user);

    return await p.customer.findMany({
      where: whereCondition,
      take,
      skip,
      include: {
        assigned_to: { select: { id: true, employee_code: true, full_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  static async getCustomerById(user: TokenPayload, id: number) {
    const whereCondition = await buildCustomerScope(user);

    const customer = await p.customer.findFirst({
      where: { id, ...whereCondition },
      include: {
        assigned_to: { select: { id: true, employee_code: true, full_name: true } },
        origin_lead: { select: { id: true, lead_code: true, status: true } },
      },
    });

    if (!customer) {
      throw new AppError(404, 'Customer not found or access denied');
    }

    return customer;
  }

  static async createCustomer(user: TokenPayload, dto: any) {
    const customerCode = await this.generateNextCustomerCode();

    // Soft duplicate check
    if (dto.phone) {
      const existing = await p.customer.findFirst({
        where: { phone: dto.phone },
      });
      if (existing) {
        throw new AppError(
          409,
          'A customer with this phone number already exists in your company.',
        );
      }
    }

    if (dto.assigned_to_id) {
      const emp = await p.employee.findFirst({ where: { id: dto.assigned_to_id } });
      if (!emp) {
        throw new AppError(400, 'Assigned employee not found or cross-company assignment');
      }
    }

    return await p.customer.create({
      data: {
        customer_code: customerCode,
        company_id: user.companyId,
        branch_id: user.branchId || null,
        first_name: dto.first_name,
        last_name: dto.last_name || null,
        phone: dto.phone,
        email: dto.email || null,
        status: dto.status || 'ACTIVE',
        source: dto.source || 'MANUAL_ENTRY',
        assigned_to_id: dto.assigned_to_id || user.employeeId,
      },
    });
  }

  static async updateCustomer(user: TokenPayload, id: number, dto: any) {
    const customer = await this.getCustomerById(user, id);

    if (!CustomerPolicy.canMutate(user, customer)) {
      throw new AppError(403, 'You do not have permission to update this customer');
    }

    return await p.customer.update({
      where: { id },
      data: {
        first_name: dto.first_name,
        last_name: dto.last_name,
        phone: dto.phone,
        email: dto.email,
        status: dto.status,
      },
    });
  }

  static async convertFromLead(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({
      where: { id: leadId, company_id: user.companyId },
      include: { converted_customer: true },
    });

    if (!lead) {
      throw new AppError(404, 'Lead not found or access denied');
    }

    // Phase-19 audit #9: Channel Partner Managers manage leads for an
    // external partner company's own inventory -- they may only convert
    // leads they personally entered, never a lead introduced or worked by
    // someone else in the normal internal sales pipeline.
    const isChannelPartnerManager = user.roles.includes(Roles.CHANNEL_PARTNER_MANAGER);
    const isManagement = user.roles.includes(Roles.MD) || user.roles.includes(Roles.ADMIN);
    if (isChannelPartnerManager && !isManagement && lead.created_by_id !== user.employeeId) {
      throw new AppError(
        403,
        'Channel Partner Managers may only convert leads they personally created.',
      );
    }

    if (lead.converted_customer) {
      throw new AppError(409, 'This lead has already been converted to a customer');
    }

    // Converting force-transitions the lead straight to BOOKED, and the
    // workflow only allows that from BOOKING_INITIATED (see
    // apps/api/src/workflows/lead.workflow.ts) — check explicitly up front
    // for a clear message rather than letting the transition fail generically
    // after a Customer row has already been created in this transaction.
    if (lead.status !== 'BOOKING_INITIATED') {
      throw new AppError(
        409,
        'This lead can only be converted to a customer once it reaches Booking Initiated.',
      );
    }

    const customerCode = await this.generateNextCustomerCode();

    // Parse names from customer_name
    const nameParts = lead.customer_name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const customer = await tx.customer.create({
        data: {
          customer_code: customerCode,
          company_id: user.companyId,
          branch_id: lead.branch_id,
          first_name: firstName,
          last_name: lastName,
          phone: lead.phone,
          email: lead.email,
          status: 'ACTIVE',
          source: lead.source,
          campaign: lead.campaign,
          utm_source: lead.utm_source,
          utm_medium: lead.utm_medium,
          utm_campaign: lead.utm_campaign,
          assigned_to_id: lead.assigned_to_id,
          origin_lead_id: lead.id,
        },
      });

      // Update lead status to BOOKED (won state) — routed through the engine.
      await WorkflowEngine.transitionLead(tx, lead.id, 'BOOKED', { actor: user, entity: lead });

      await tx.leadActivity.create({
        data: {
          lead_id: lead.id,
          actor_id: user.employeeId,
          activity_type: 'LEAD_CONVERTED_TO_CUSTOMER',
          notes: `Lead converted to Customer ${customerCode}`,
        },
      });

      return customer;
    });
  }

  static async upsertFromLead(user: TokenPayload, leadId: number, tx: any) {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new AppError(404, 'Lead not found or access denied');
    }

    // 1. Check if it already exists (idempotency)
    let customer = await tx.customer.findUnique({ where: { origin_lead_id: lead.id } });
    if (customer) {
      return customer;
    }

    const customerCode = await this.generateNextCustomerCode(tx);
    const nameParts = lead.customer_name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    try {
      customer = await tx.customer.create({
        data: {
          customer_code: customerCode,
          company_id: user.companyId,
          branch_id: lead.branch_id,
          first_name: firstName,
          last_name: lastName,
          phone: lead.phone,
          email: lead.email,
          status: 'ACTIVE',
          source: lead.source,
          assigned_to_id: lead.assigned_to_id,
          origin_lead_id: lead.id,
        },
      });
      return customer;
    } catch (error: any) {
      // 2. Handle concurrent creation conflict via origin_lead_id @unique constraint
      if (error.code === 'P2002' && error.meta?.target?.includes('origin_lead_id')) {
        const existing = await tx.customer.findUnique({ where: { origin_lead_id: lead.id } });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }
}
