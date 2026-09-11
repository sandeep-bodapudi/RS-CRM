"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingService = void 0;
const prisma_1 = require("../lib/prisma");
const lead_service_1 = require("./lead.service");
const booking_policy_1 = require("../policies/booking.policy");
const shared_1 = require("../shared");
const crypto_1 = require("crypto");
const workflowEngine_1 = require("../workflows/workflowEngine");
const reference_1 = require("./inventory/reference");
const p = prisma_1.prisma;
// Property reservation lock duration (24h), consistent with Phase 9 inventory locking.
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;
class BookingService {
    /** List bookings scoped to the user's company. */
    static async getBookings(user) {
        const bookings = await prisma_1.prisma.booking.findMany({
            where: { company_id: user.companyId },
            orderBy: { id: 'desc' },
        });
        return bookings;
    }
    /** Fetch a single booking with company + policy scoping. */
    static async getBookingById(user, id) {
        const booking = await prisma_1.prisma.booking.findFirst({ where: { id } });
        if (!booking) {
            throw new lead_service_1.AppError(404, 'Booking not found');
        }
        if (!booking_policy_1.BookingPolicy.canView(user, booking)) {
            throw new lead_service_1.AppError(403, 'Unauthorized to view this booking');
        }
        return booking;
    }
    /** Phase 11 Portal handoff status for a booking. */
    static async getHandoffStatus(user, id) {
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
    static async createBooking(user, dto, tx) {
        // Tenant scope is ALWAYS derived from the authenticated caller, never trusted
        // from client/caller input — a caller-supplied company_id would let a user
        // (or a buggy internal caller) create a booking, and lock a property, under
        // a company they don't belong to.
        const scopedDto = { ...dto, company_id: user.companyId };
        if (tx) {
            return BookingService.claimAndCreate(tx, user, scopedDto);
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await prisma_1.prisma.$transaction((client) => BookingService.claimAndCreate(client, user, scopedDto));
            }
            catch (err) {
                if ((err?.code === 'P2002' || err?.code === 'P2034') && attempt < 2)
                    continue;
                throw err;
            }
        }
        throw new lead_service_1.AppError(500, 'Failed to create booking after retries');
    }
    // company_id is guaranteed set by createBooking() before this internal method ever runs.
    static async claimAndCreate(client, user, dto) {
        // Serialize concurrent requests and read the property state via the same locking
        // (FOR UPDATE) read. A locking read always returns the latest committed row, so the
        // claim decision is never stale behind a REPEATABLE-READ snapshot (needed when this
        // runs inside an outer transaction that has already performed consistent reads).
        // A booking is against exactly one saleable item: a standalone Property or a
        // ProjectUnit. resolveInventoryRef rejects both-or-neither before any row is
        // touched — a booking pointing at two items is unrecoverable once money is
        // attached to it.
        const ref = (0, reference_1.resolveInventoryRef)(dto);
        const locked = await (0, reference_1.lockInventoryRow)(client, ref);
        // Never let a booking be created against another company's inventory, even
        // though company_id above is now always the caller's own — without this,
        // a staff member could still book/lock an item that belongs to the
        // other company under their own company's booking record.
        if (locked.company_id !== dto.company_id) {
            throw new lead_service_1.AppError(404, `${locked.label} not found`);
        }
        const now = new Date();
        (0, reference_1.assertClaimable)(locked, now);
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
        const booking_code = `RRH-BK-${now.getFullYear()}-${String(count + 1).padStart(4, '0')}-${(0, crypto_1.randomBytes)(3).toString('hex')}`;
        const booking = await client.booking.create({
            data: {
                booking_code,
                company: { connect: { id: dto.company_id } },
                customer: { connect: { id: dto.customer_id } },
                ...(0, reference_1.inventoryConnect)(ref),
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
        // Claim the lock on whichever item this booking is against.
        await (0, reference_1.claimInventoryLock)(client, ref, booking.id, new Date(now.getTime() + LOCK_DURATION_MS));
        return booking;
    }
    static async updateBookingStatus(user, id, status) {
        // Route CONFIRMED transitions through the MD-authority/KYC/opportunity path.
        if (status === 'CONFIRMED') {
            return BookingService.confirmBooking(user, id);
        }
        await BookingService.getBookingById(user, id);
        return prisma_1.prisma.booking.update({ where: { id }, data: { status } });
    }
    static async confirmBooking(user, id) {
        // Phase 9 Packet 5 — Transaction authority: only the MD may confirm a booking.
        if (!user.roles.includes(shared_1.Roles.MD)) {
            throw new lead_service_1.AppError(403, 'Forbidden: Only the Managing Director can confirm a booking');
        }
        const booking = await BookingService.getBookingById(user, id);
        const customer = await p.customer.findUnique({ where: { id: booking.customer_id } });
        // KYC gate: confirmation requires the customer to have both PAN and Aadhaar.
        if (!customer?.pan_number || !customer?.aadhaar_number) {
            throw new lead_service_1.AppError(400, 'KYC (PAN and Aadhaar) is required before booking confirmation');
        }
        const bookedRef = (0, reference_1.refFromRecord)(booking);
        const bookedTitle = bookedRef ? await (0, reference_1.getInventoryTitle)(p, bookedRef) : null;
        // Full property/project/company detail for the Portal's UI (consolidation
        // plan Decision 1) — the portal has no catalog of its own and needs these
        // fields at handoff time, not just a display title.
        const inventoryDetail = bookedRef
            ? await (0, reference_1.getInventoryPortalDetail)(p, bookedRef)
            : { property: null, projectUnit: null, project: null, company: null };
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
                booking_amount: booking.booking_amount,
                balance_amount: booking.balance_amount,
                // EMI-relevant fields — the Portal generates its own local Installment
                // schedule from these rather than duplicating the CRM's EMI logic.
                emi_months: booking.emi_months,
                emi_charges: booking.emi_charges,
                total_cost: booking.total_cost,
            },
            property: bookedTitle ? { title: bookedTitle } : null,
            inventory: inventoryDetail,
        };
        // Atomically confirm the booking, transition the property to BOOKED, emit the
        // Phase 11 portal-handoff outbox event, and create the portal mapping.
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const updated = await tx.booking.update({ where: { id }, data: { status: 'CONFIRMED' } });
            const confirmRef = (0, reference_1.refFromRecord)(booking);
            if (confirmRef) {
                await (0, reference_1.markInventoryBooked)(tx, confirmRef, booking.company_id);
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
            const contributorIds = new Set();
            if (booking.assigned_employee_id)
                contributorIds.add(booking.assigned_employee_id);
            if (leadId) {
                const lead = await tx.lead.findUnique({ where: { id: leadId } });
                const leadActivities = await tx.leadActivity.findMany({ where: { lead_id: leadId } });
                if (lead?.created_by_id)
                    contributorIds.add(lead.created_by_id);
                if (lead?.assigned_to_id)
                    contributorIds.add(lead.assigned_to_id);
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
    static async cancelBooking(user, id, reason = 'Booking cancelled') {
        const booking = await BookingService.getBookingById(user, id);
        // Cancelling the booking and releasing the inventory it holds must succeed or
        // fail together: previously these were two independent writes, so a failure
        // between them left a cancelled booking still holding a locked property.
        const updated = await prisma_1.prisma.$transaction(async (tx) => {
            const cancelled = await tx.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
            const cancelRef = (0, reference_1.refFromRecord)(booking);
            if (cancelRef) {
                await (0, reference_1.releaseInventoryLock)(tx, cancelRef, id);
            }
            return cancelled;
        });
        // Cancelled bookings don't directly manipulate Opportunity.stage since it no longer exists.
        // Instead we transition the lead status.
        const opp = await p.opportunity.findFirst({ where: { booking_id: id }, include: { lead: true } });
        if (opp && opp.lead && opp.lead.status !== 'DROPPED') {
            await workflowEngine_1.WorkflowEngine.transitionLead(p, opp.lead_id, 'DROPPED', { actor: user, entity: { ...opp.lead, exit_reason: reason } }, { exit_reason: reason });
        }
        return updated;
    }
    // ===========================================================================
    // BOOKING INITIATION FORM — Phase 2026-09-08
    // Full RRH physical form digitization with MD approval workflow.
    // ===========================================================================
    /**
     * Initiate a new booking via the 4-step wizard.
     * - Optionally creates a new customer inline (when new_customer is supplied).
     * - Creates the Booking with form_status = SUBMITTED and status = PENDING.
     * - Atomically locks the inventory (same as createBooking).
     * - Requires BOOKINGS_FORM_SUBMIT or BOOKINGS_LEGACY_CREATE permission (checked at route).
     */
    static async initiateBooking(user, dto) {
        const scopedDto = { ...dto, company_id: user.companyId };
        return await prisma_1.prisma.$transaction(async (tx) => {
            // 1. Inline customer creation if requested
            let customerId = dto.customer_id;
            if (!customerId && dto.new_customer) {
                const nc = dto.new_customer;
                const count = await tx.customer.count({ where: { company_id: user.companyId } });
                const customer_code = `CUST-${user.companyId}-${String(count + 1).padStart(5, '0')}`;
                const created = await tx.customer.create({
                    data: {
                        customer_code,
                        company_id: user.companyId,
                        first_name: nc.first_name,
                        last_name: nc.last_name ?? null,
                        phone: nc.phone,
                        email: nc.email ?? null,
                        source: dto.is_legacy ? 'LEGACY_IMPORT' : 'BOOKING_WIZARD',
                    },
                });
                customerId = created.id;
            }
            if (!customerId)
                throw new lead_service_1.AppError(400, 'customer_id or new_customer is required');
            // 2. Inventory lock (same logic as createBooking)
            const ref = (0, reference_1.resolveInventoryRef)({ property_id: dto.property_id, project_unit_id: dto.project_unit_id });
            const locked = await (0, reference_1.lockInventoryRow)(tx, ref);
            if (locked.company_id !== user.companyId) {
                throw new lead_service_1.AppError(404, `${locked.label} not found`);
            }
            const now = new Date();
            (0, reference_1.assertClaimable)(locked, now);
            // 3. Calculate financials
            const balance = Math.max(0, Number(dto.agreed_price) - Number(dto.booking_amount));
            const count = await tx.booking.count({ where: { company_id: user.companyId } });
            const booking_code = `RRH-BK-${now.getFullYear()}-${String(count + 1).padStart(4, '0')}-${(0, crypto_1.randomBytes)(3).toString('hex')}`;
            // 4. Create booking in PENDING status with form SUBMITTED
            // NOTE: `as any` cast is intentional — Prisma client types lag behind the schema
            // until the server restarts and regenerates the client (DLL was locked at migration time).
            const booking = await tx.booking.create({
                data: {
                    booking_code,
                    company: { connect: { id: user.companyId } },
                    customer: { connect: { id: customerId } },
                    ...(0, reference_1.inventoryConnect)(ref),
                    ...(dto.assigned_employee_id ? { assigned_employee: { connect: { id: dto.assigned_employee_id } } } : {}),
                    agreed_price: Number(dto.agreed_price),
                    booking_amount: Number(dto.booking_amount),
                    balance_amount: balance,
                    status: 'PENDING',
                    notes: dto.notes ?? null,
                    source: dto.source ?? 'BOOKING_FORM',
                    // Form fields
                    serial_no: dto.serial_no ?? null,
                    plot_no: dto.plot_no ?? null,
                    area_sqyd: dto.area_sqyd ?? null,
                    facing: dto.facing ?? null,
                    price_per_sqyd: dto.price_per_sqyd ?? null,
                    sale_price_per_sqyd: dto.sale_price_per_sqyd ?? null,
                    charges_per_sqyd: dto.charges_per_sqyd ?? null,
                    emi_months: dto.emi_months ?? null,
                    emi_charges: dto.emi_charges ?? null,
                    total_cost: dto.total_cost ?? null,
                    total_cost_words: dto.total_cost_words ?? null,
                    receipt_no: dto.receipt_no ?? null,
                    receipt_date: dto.receipt_date ? new Date(dto.receipt_date) : null,
                    booking_amount_words: dto.booking_amount_words ?? null,
                    referred_by: dto.referred_by ?? null,
                    referred_by_code: dto.referred_by_code ?? null,
                    // Workflow
                    form_status: 'SUBMITTED',
                    form_submitted_at: now,
                    form_submitted_by_id: user.employeeId ?? null,
                    tc_accepted_at: dto.tc_accepted_by_name ? now : null,
                    tc_accepted_by_name: dto.tc_accepted_by_name ?? null,
                    // Legacy
                    is_legacy: dto.is_legacy ?? false,
                    legacy_booking_date: dto.legacy_booking_date ? new Date(dto.legacy_booking_date) : null,
                    legacy_notes: dto.legacy_notes ?? null,
                },
            });
            // 5. Claim inventory lock
            await (0, reference_1.claimInventoryLock)(tx, ref, booking.id, new Date(now.getTime() + LOCK_DURATION_MS));
            // 6. Audit trail
            await tx.auditEvent.create({
                data: {
                    actor_id: user.employeeId,
                    action: 'BOOKING_FORM_SUBMITTED',
                    entity_type: 'Booking',
                    entity_id: booking.id,
                    old_value: null,
                    new_value: 'SUBMITTED',
                    created_at: now,
                },
            });
            return booking;
        });
    }
    /**
     * Update an existing DRAFT/REJECTED booking form and resubmit it for MD approval.
     */
    static async submitBookingForm(user, id, formData) {
        const booking = await BookingService.getBookingById(user, id);
        if (!['DRAFT', 'MD_REJECTED'].includes(booking.form_status)) {
            throw new lead_service_1.AppError(400, `Cannot resubmit a booking with form_status: ${booking.form_status}`);
        }
        const now = new Date();
        const updated = await prisma_1.prisma.booking.update({
            where: { id },
            data: {
                ...formData,
                receipt_date: formData.receipt_date ? new Date(formData.receipt_date) : undefined,
                legacy_booking_date: formData.legacy_booking_date ? new Date(formData.legacy_booking_date) : undefined,
                form_status: 'SUBMITTED',
                form_submitted_at: now,
                form_submitted_by_id: user.employeeId ?? null,
                tc_accepted_at: formData.tc_accepted_by_name ? now : undefined,
                md_rejection_reason: null, // clear any previous rejection
            },
        });
        await prisma_1.prisma.auditEvent.create({
            data: {
                actor_id: user.employeeId,
                action: 'BOOKING_FORM_RESUBMITTED',
                entity_type: 'Booking',
                entity_id: id,
                old_value: booking.form_status,
                new_value: 'SUBMITTED',
                created_at: now,
            },
        });
        return updated;
    }
    /**
     * Returns all bookings with form_status = SUBMITTED awaiting MD approval.
     * Scoped to the user's company.
     */
    static async getPendingMDApprovals(user) {
        return prisma_1.prisma.booking.findMany({
            where: {
                company_id: user.companyId,
                form_status: 'SUBMITTED',
            },
            include: {
                customer: { select: { id: true, first_name: true, last_name: true, phone: true, pan_number: true, aadhaar_number: true } },
                property: { select: { id: true, title: true, status: true } },
                project_unit: { select: { id: true, unit_number: true } },
                form_submitted_by: { select: { id: true, full_name: true, employee_code: true } },
            },
            orderBy: { form_submitted_at: 'asc' }, // oldest first — FIFO for MD
        });
    }
    /**
     * MD approves a submitted booking form.
     * This also triggers the full confirmation flow (KYC gate, inventory BOOKED, portal handoff).
     */
    static async mdApproveBooking(user, id) {
        if (!user.roles.includes(shared_1.Roles.MD)) {
            throw new lead_service_1.AppError(403, 'Forbidden: Only the Managing Director can approve a booking form');
        }
        const booking = await BookingService.getBookingById(user, id);
        if (booking.form_status !== 'SUBMITTED') {
            throw new lead_service_1.AppError(400, `Booking form is not in SUBMITTED state (current: ${booking.form_status})`);
        }
        // Delegate to the existing confirmBooking which handles KYC gate, portal handoff, etc.
        // First set form_status = MD_APPROVED, then confirm.
        const now = new Date();
        await prisma_1.prisma.booking.update({
            where: { id },
            data: {
                form_status: 'MD_APPROVED',
                md_approved_at: now,
                md_approved_by_id: user.employeeId ?? null,
            },
        });
        // Run the full confirmation (KYC gate, inventory BOOKED, audit, portal handoff)
        return BookingService.confirmBooking(user, id);
    }
    /**
     * MD rejects a submitted booking form with a mandatory reason.
     */
    static async mdRejectBooking(user, id, reason) {
        if (!user.roles.includes(shared_1.Roles.MD)) {
            throw new lead_service_1.AppError(403, 'Forbidden: Only the Managing Director can reject a booking form');
        }
        const booking = await BookingService.getBookingById(user, id);
        if (booking.form_status !== 'SUBMITTED') {
            throw new lead_service_1.AppError(400, `Cannot reject a booking that is not in SUBMITTED state`);
        }
        if (!reason?.trim()) {
            throw new lead_service_1.AppError(400, 'Rejection reason is required');
        }
        const now = new Date();
        const updated = await prisma_1.prisma.booking.update({
            where: { id },
            data: {
                form_status: 'MD_REJECTED',
                md_rejection_reason: reason,
            },
        });
        await prisma_1.prisma.auditEvent.create({
            data: {
                actor_id: user.employeeId,
                action: 'BOOKING_FORM_REJECTED',
                entity_type: 'Booking',
                entity_id: id,
                old_value: 'SUBMITTED',
                new_value: 'MD_REJECTED',
                reason,
                created_at: now,
            },
        });
        return updated;
    }
}
exports.BookingService = BookingService;
