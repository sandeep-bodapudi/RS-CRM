import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { requireAuthz } from '../middleware/authz';
import { Permissions } from '../shared';
import { BookingService } from '../services/booking.service';

const router = Router();

// Zod schemas for validation
const CreateBookingSchema = z.object({
  customer_id: z.number().int().positive(),
  property_id: z.number().int().positive(),
  agreed_price: z.number().positive(),
  booking_amount: z.number().positive(),
  notes: z.string().optional(),
  assigned_employee_id: z.number().int().positive().optional(),
});

const UpdateBookingStatusSchema = z.object({
  status: z.enum(['TOKEN_RECEIVED', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
});

// ─── Booking Form Wizard Schema ────────────────────────────────────────────────
const NewCustomerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  phone: z.string().min(10),
  email: z.string().email().optional(),
});

const InitiateBookingSchema = z
  .object({
    // Customer — either existing id or new_customer inline
    customer_id: z.number().int().positive().optional(),
    new_customer: NewCustomerSchema.optional(),
    // Inventory
    property_id: z.number().int().positive().optional().nullable(),
    project_unit_id: z.number().int().positive().optional().nullable(),
    assigned_employee_id: z.number().int().positive().optional(),
    // Financial
    agreed_price: z.number().positive(),
    booking_amount: z.number().positive(),
    notes: z.string().optional(),
    // Form fields
    serial_no: z.string().optional(),
    plot_no: z.string().optional(),
    area_sqyd: z.number().positive().optional(),
    facing: z.string().optional(),
    price_per_sqyd: z.number().optional(),
    sale_price_per_sqyd: z.number().optional(),
    charges_per_sqyd: z.number().optional(),
    emi_months: z.number().int().min(1).optional(),
    emi_charges: z.number().optional(),
    total_cost: z.number().optional(),
    total_cost_words: z.string().optional(),
    receipt_no: z.string().optional(),
    receipt_date: z.string().optional(),
    booking_amount_words: z.string().optional(),
    referred_by: z.string().optional(),
    referred_by_code: z.string().optional(),
    // T&C
    tc_accepted_by_name: z.string().optional(),
    // Legacy mode
    is_legacy: z.boolean().optional(),
    legacy_booking_date: z.string().optional(),
    legacy_notes: z.string().optional(),
  })
  .refine((data) => data.customer_id || data.new_customer, {
    message: 'Either customer_id or new_customer must be provided',
  });

const BookingFormSubmitSchema = z.object({
  serial_no: z.string().optional(),
  plot_no: z.string().optional(),
  area_sqyd: z.number().positive().optional(),
  facing: z.string().optional(),
  price_per_sqyd: z.number().optional(),
  sale_price_per_sqyd: z.number().optional(),
  charges_per_sqyd: z.number().optional(),
  emi_months: z.number().int().min(1).optional(),
  emi_charges: z.number().optional(),
  total_cost: z.number().optional(),
  total_cost_words: z.string().optional(),
  receipt_no: z.string().optional(),
  receipt_date: z.string().optional(),
  booking_amount_words: z.string().optional(),
  referred_by: z.string().optional(),
  referred_by_code: z.string().optional(),
  tc_accepted_by_name: z.string().optional(),
  is_legacy: z.boolean().optional(),
  legacy_booking_date: z.string().optional(),
  legacy_notes: z.string().optional(),
});

const MDRejectSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters'),
});

// ─── Auth middleware on all routes ────────────────────────────────────────────
router.use(authenticateToken);

// ─── Standard booking CRUD ────────────────────────────────────────────────────

router.get('/', requireAuthz(Permissions.BOOKINGS_READ as any), async (req: any, res, next) => {
  try {
    const bookings = await BookingService.getBookings(req.user);
    res.json(bookings);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/pending-md-approval',
  requireAuthz(Permissions.BOOKINGS_MD_APPROVE as any),
  async (req: any, res, next) => {
    try {
      const bookings = await BookingService.getPendingMDApprovals(req.user);
      res.json(bookings);
    } catch (error) {
      next(error);
    }
  },
);

router.get('/:id', requireAuthz(Permissions.BOOKINGS_READ as any), async (req: any, res, next) => {
  try {
    const booking = await BookingService.getBookingById(req.user, parseInt(req.params.id, 10));
    res.json(booking);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/:id/handoff-status',
  requireAuthz(Permissions.BOOKINGS_READ as any),
  async (req: any, res, next) => {
    try {
      const handoff = await BookingService.getHandoffStatus(req.user, parseInt(req.params.id, 10));
      res.json(handoff);
    } catch (error) {
      next(error);
    }
  },
);

router.post('/', requireAuthz(Permissions.BOOKINGS_CREATE as any), async (req: any, res, next) => {
  try {
    const dto = CreateBookingSchema.parse(req.body);
    const booking = await BookingService.createBooking(req.user, dto);
    res.status(201).json(booking);
  } catch (error) {
    next(error);
  }
});

// ─── Booking Initiation Form endpoints (Phase 2026-09-08) ────────────────────

/**
 * POST /bookings/initiate
 * Digital Lead Operator submits the full 4-step booking initiation form.
 * Creates the booking + locks inventory in one transaction.
 */
router.post(
  '/initiate',
  requireAuthz(Permissions.BOOKINGS_FORM_SUBMIT as any),
  async (req: any, res, next) => {
    try {
      const dto = InitiateBookingSchema.parse(req.body);
      const booking = await BookingService.initiateBooking(req.user, dto as any);
      res.status(201).json(booking);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /bookings/:id/submit-form
 * Resubmit/update form data for a DRAFT or MD_REJECTED booking.
 */
router.post(
  '/:id/submit-form',
  requireAuthz(Permissions.BOOKINGS_FORM_SUBMIT as any),
  async (req: any, res, next) => {
    try {
      const formData = BookingFormSubmitSchema.parse(req.body);
      const booking = await BookingService.submitBookingForm(
        req.user,
        parseInt(req.params.id, 10),
        formData,
      );
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /bookings/:id/md-approve
 * MD approves a SUBMITTED booking form → triggers full confirmation flow.
 */
router.post(
  '/:id/md-approve',
  requireAuthz(Permissions.BOOKINGS_MD_APPROVE as any),
  async (req: any, res, next) => {
    try {
      const booking = await BookingService.mdApproveBooking(req.user, parseInt(req.params.id, 10));
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /bookings/:id/md-reject
 * MD rejects a SUBMITTED booking form with a mandatory reason.
 */
router.post(
  '/:id/md-reject',
  requireAuthz(Permissions.BOOKINGS_MD_APPROVE as any),
  async (req: any, res, next) => {
    try {
      const { reason } = MDRejectSchema.parse(req.body);
      const booking = await BookingService.mdRejectBooking(
        req.user,
        parseInt(req.params.id, 10),
        reason,
      );
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

// ─── Existing status management ───────────────────────────────────────────────

router.post(
  '/:id/confirm',
  requireAuthz(Permissions.BOOKINGS_CONFIRM as any),
  async (req: any, res, next) => {
    try {
      const booking = await BookingService.confirmBooking(req.user, parseInt(req.params.id, 10));
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:id/cancel',
  requireAuthz(Permissions.BOOKINGS_CANCEL as any),
  async (req: any, res, next) => {
    try {
      const reason = req.body.reason || 'Booking cancelled';
      const booking = await BookingService.cancelBooking(
        req.user,
        parseInt(req.params.id, 10),
        reason,
      );
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  '/:id/status',
  requireAuthz(Permissions.BOOKINGS_UPDATE as any),
  async (req: any, res, next) => {
    try {
      const { status } = UpdateBookingStatusSchema.parse(req.body);
      const booking = await BookingService.updateBookingStatus(
        req.user,
        parseInt(req.params.id, 10),
        status,
      );
      res.json(booking);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
