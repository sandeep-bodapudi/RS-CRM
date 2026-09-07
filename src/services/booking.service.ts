import { prisma } from '../lib/prisma';
import { PrismaClient, Prisma } from '@prisma/client';
import { TokenPayload } from '../utils/jwt';
import { AppError } from './lead.service';
import { BookingPolicy } from '../policies/booking.policy';
import { Roles } from '../shared';
import { randomBytes } from 'crypto';
import { WorkflowEngine } from '../workflows/workflowEngine';

const p = prisma;

// Property reservation lock duration (24h), consistent with Phase 9 inventory locking.
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;

interface CreateBookingInput {
  customer_id: number;
  property_id: number;
  // Always overwritten from the authenticated caller's own company in
  // createBooking() below -- never trust a caller-supplied company_id here.
  company_id?: number;
  agreed_price: number;
  booking_amount: number;
  assigned_employee_id?: number;
  notes?: string;
  source?: string;
  campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export class BookingService {
  /** List bookings scoped to the user's company. */
  static async getBookings(user: TokenPayload) {
    const bookings = await prisma.booking.findMany({
      where: { company_id: user.companyId },
      orderBy: { id: 'desc' },
    });
    return bookings;
  }

  /** Fetch a single booking with company + policy scoping. */
  static async getBookingById(user: TokenPayload, id: number) {
    const booking = await prisma.booking.findFirst({ where: { id } });
    if (!booking) {
      throw new AppError(404, 'Booking not found');
    }
    if (!BookingPolicy.canView(user, booking)) {
      throw new AppError(403, 'Unauthorized to view this booking');
    }
    return booking;
  }

  /** Phase 11 Portal handoff status for a booking. */
  static async getHandoffStatus(user: TokenPayload, id: number) {
    const booking = await BookingService.getBookingById(user, id);
    const mapping = await p.bookingPortalMapping.findFirst({
      where: { crms_booking_id: id },
    });
    return {
      crms_booking_id: id,
      crms_customer_id: booking.customer_id,
      handoff_status: mapping ? mapping.handoff_status : 'CREATED',
      portal_customer_id: mapping?.portal_customer_id ?? null,
      portal_booking_id: mapping?.portal_booking_id ?? null,
    };
  }

  /**
   * Create a booking atomically with concurrency-safe property claiming.
   * - When `tx` is supplied (opportunity conversion), operates inside that transaction.
   * - Otherwise it opens its own transaction with a bounded P2002 retry.
   */
  static async createBooking(user: TokenPayload, dto: CreateBookingInput, tx?: Prisma.TransactionClient) {
    // Tenant scope is ALWAYS derived from the authenticated caller, never trusted
    // from client/caller input -- a caller-supplied company_id would let a user
    // (or a buggy internal caller) create a booking, and lock a property, under
    // a company they don't belong to.
    const scopedDto: CreateBookingInput & { company_id: number } = { ...dto, company_id: user.companyId };

    if (tx) {
      return BookingService.claimAndCreate(tx, user, scopedDto);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction((client) => BookingService.claimAndCreate(client, user, scopedDto));
      } catch (err: any) {
        if ((err?.code === 'P2002' || err?.code === 'P2034') && attempt < 2) continue;
        throw err;
      }
    }
    throw new AppError(500, 'Failed to create booking after retries');
  }

  // company_id is guaranteed set by createBooking() before this internal method ever runs.
  private static async claimAndCreate(client: Prisma.TransactionClient, user: TokenPayload, dto: CreateBookingInput & { company_id: number }) {
    // Serialize concurrent requests and read the property state via the same locking
    // (FOR UPDATE) read. A locking read always returns the latest committed row, so the
    // claim decision is never stale behind a REPEATABLE-READ snapshot (needed when this
    // runs inside an outer transaction that has already performed consistent reads).
    const rows = (await client.$queryRaw`
      SELECT id, status, locked_until, company_id FROM Property WHERE id = ${dto.property_id} FOR UPDATE
    `) as any[];
    if (!rows || rows.length === 0) throw new AppError(404, 'Property not found');

    const property = rows[0];

    // Never let a booking be created against another company's property, even
    // though company_id above is now always the caller's own -- without this,
    // a staff member could still book/lock a property that belongs to the
    // other company under their own company's booking record.
    if (property.company_id !== dto.company_id) {
      throw new AppError(404, 'Property not found');
    }

    const now = new Date();
    const lockUntil = property.locked_until ? new Date(property.locked_until) : null;

    if (property.status === 'LOCKED') {
      if (lockUntil && lockUntil >= now) {
        throw new AppError(409, 'Property is currently locked');
      }
      // Expired lock is reclaimable.
    } else if (property.status === 'BOOKED' || property.status === 'SOLD') {
      throw new AppError(409, 'Property has already been booked or sold');
    } else if (property.status !== 'LIVE') {
      throw new AppError(409, 'Property is not available for booking');
    }

    // Company-scope the customer. A non-existent customer is intentionally NOT
    // rejected here so the booking FK constraint surfaces a Prisma error (500),
    // matching the existing transaction rollback contract (lock is reverted).
    const customer = await client.customer.findUnique({ where: { id: dto.customer_id } });

    let assignedEmployeeId = dto.assigned_employee_id ?? user.employeeId ?? null;
    if (assignedEmployeeId) {
      const emp = await client.employee.findUnique({ where: { id: assignedEmployeeId } });
    }

    const balance = Math.max(0, Number(dto.agreed_price) - Number(dto.booking_amount));
    const count = await client.booking.count({ where: { company_id: dto.company_id } });
    const booking_code = `RRH-BK-${now.getFullYear()}-${String(count + 1).padStart(4, '0')}-${randomBytes(3).toString('hex')}`;

    const booking = await client.booking.create({
      data: {
        booking_code,
        company:   { connect: { id: dto.company_id } },
        customer:  { connect: { id: dto.customer_id } },
        property:  { connect: { id: dto.property_id } },
        ...(assignedEmployeeId ? { assigned_employee: { connect: { id: assignedEmployeeId } } } : {}),
        agreed_price: Number(dto.agreed_price),
        booking_amount: Number(dto.booking_amount),
        balance_amount: balance,
        status: 'PENDING',
        notes: dto.notes ?? null,
        // Phase 12-1: carry attribution forward from the Opportunity/Lead so it
        // survives the Opportunity -> Booking conversion.
        source: dto.source ?? null,
        campaign: dto.campaign ?? null,
        utm_source: dto.utm_source ?? null,
        utm_medium: dto.utm_medium ?? null,
        utm_campaign: dto.utm_campaign ?? null,
      },
    });

    // Claim the property lock.
    await client.property.update({
      where: { id: dto.property_id },
      data: {
        status: 'LOCKED',
        locked_until: new Date(now.getTime() + LOCK_DURATION_MS),
        locked_by_booking_id: booking.id,
      },
    });

    return booking;
  }

  static async updateBookingStatus(user: TokenPayload, id: number, status: string) {
    // Route CONFIRMED transitions through the MD-authority/KYC/opportunity path.
    if (status === 'CONFIRMED') {
      return BookingService.confirmBooking(user, id);
    }

    await BookingService.getBookingById(user, id);
    return prisma.booking.update({ where: { id }, data: { status } });
  }

  static async confirmBooking(user: TokenPayload, id: number) {
    // Phase 9 Packet 5 — Transaction authority: only the MD may confirm a booking.
    if (!user.roles.includes(Roles.MD)) {
      throw new AppError(403, 'Forbidden: Only the Managing Director can confirm a booking');
    }

    const booking = await BookingService.getBookingById(user, id);

    const customer = await p.customer.findUnique({ where: { id: booking.customer_id } });

    // KYC gate: confirmation requires the customer to have both PAN and Aadhaar.
    if (!customer?.pan_number || !customer?.aadhaar_number) {
      throw new AppError(400, 'KYC (PAN and Aadhaar) is required before booking confirmation');
    }

    const property = await p.property.findUnique({ where: { id: booking.property_id } });

    // Build a strict, approved-field-only outbound payload (no KYC/bank/password data).
    const payload = {
      company_id: booking.company_id,
      customer: customer
        ? {
            crms_customer_id: customer.id,
            customer_code: customer.customer_code,
            first_name: customer.first_name,
            phone: customer.phone,
          }
        : null,
      booking: {
        crms_booking_id: booking.id,
        booking_code: booking.booking_code,
        agreed_price: booking.agreed_price,
      },
      property: property ? { title: property.title } : null,
    };

    // Atomically confirm the booking, transition the property to BOOKED, emit the
    // Phase 11 portal-handoff outbox event, and create the portal mapping.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id }, data: { status: 'CONFIRMED' } });

      const propRow = await tx.property.findUnique({ where: { id: booking.property_id } });
      if (propRow && propRow.company_id === booking.company_id) {
        await tx.property.update({ where: { id: booking.property_id }, data: { status: 'BOOKED' } });
      }

      const existingEvent = await tx.integrationEvent.findFirst({
        where: { crms_booking_id: id, event_type: 'BOOKING_PORTAL_HANDOFF' },
      });
      if (!existingEvent) {
        await tx.integrationEvent.create({
          data: {
            event_type: 'BOOKING_PORTAL_HANDOFF',
            payload: JSON.stringify(payload),
            status: 'CREATED',
            company_id: booking.company_id,
            crms_booking_id: id,
          },
        });
      }

      const existingMapping = await tx.bookingPortalMapping.findFirst({
        where: { crms_booking_id: id },
      });
      if (!existingMapping) {
        await tx.bookingPortalMapping.create({
          data: {
            company_id: booking.company_id,
            crms_booking_id: id,
            crms_customer_id: booking.customer_id,
            handoff_status: 'CREATED',
          },
        });
      }

      // Update the associated Opportunity values (transactionally atomic with confirmation).
      const opp = await tx.opportunity.findFirst({ where: { booking_id: id } });
      if (opp) {
        await tx.opportunity.update({
          where: { id: opp.id },
          data: { 
            expected_value: booking.agreed_price,
            probability: 100 
          },
        });
        
        await tx.lead.update({
          where: { id: opp.lead_id },
          data: { status: 'BOOKED' }
        });
      }

      // Phase 9 Packet 5 — golden rule audit trail for the confirmation decision.
      await tx.auditEvent.create({
        data: {
          actor_id: user.employeeId,
          action: 'BOOKING_CONFIRMED',
          entity_type: 'Booking',
          entity_id: id,
          old_value: booking.status,
          new_value: 'CONFIRMED',
          created_at: new Date(),
        },
      });

      // Reward booking contributors with Performance Metric boost (+10pts per booking)
      const cust = await tx.customer.findUnique({ where: { id: booking.customer_id } });
      const leadId = cust?.origin_lead_id;

      const contributorIds = new Set<number>();
      if (booking.assigned_employee_id) contributorIds.add(booking.assigned_employee_id);

      if (leadId) {
        const lead = await tx.lead.findUnique({ where: { id: leadId } });
        const leadActivities = await tx.leadActivity.findMany({ where: { lead_id: leadId } });

        if (lead?.created_by_id) contributorIds.add(lead.created_by_id);
        if (lead?.assigned_to_id) contributorIds.add(lead.assigned_to_id);

        for (const act of leadActivities) {
          contributorIds.add(act.actor_id);
        }
      }

      for (const empId of contributorIds) {
        await tx.auditEvent.create({
          data: {
            actor_id: empId,
            action: 'PROPERTY_BOOKED_CONTRIBUTION',
            entity_type: 'Booking',
            entity_id: id,
            reason: 'Contributed to a Lead/Opportunity that converted to a CONFIRMED Booking.',
            created_at: new Date(),
          }
        });
      }

      return updated;
    });

    return result;
  }

  static async cancelBooking(user: TokenPayload, id: number, reason: string = 'Booking cancelled') {
    const booking = await BookingService.getBookingById(user, id);
    const updated = await prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    const prop = await p.property.findUnique({ where: { id: booking.property_id } });
    if (prop) {
      await p.property.update({
        where: { id: booking.property_id },
        data: { status: 'LIVE', locked_until: null, locked_by_booking_id: null },
      });
    }
    // Cancelled bookings don't directly manipulate Opportunity.stage since it no longer exists.
    // Instead we transition the lead status.
    const opp = await p.opportunity.findFirst({ where: { booking_id: id }, include: { lead: true } });
    if (opp && opp.lead && opp.lead.status !== 'DROPPED') {
      await WorkflowEngine.transition(
        p,
        opp.lead_id,
        'DROPPED',
        { actor: user, entity: { ...opp.lead, exit_reason: reason } },
        { exit_reason: reason }
      );
    }
    return updated;
  }
}
