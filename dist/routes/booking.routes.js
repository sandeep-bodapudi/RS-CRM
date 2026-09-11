"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const authz_1 = require("../middleware/authz");
const shared_1 = require("../shared");
const booking_service_1 = require("../services/booking.service");
const router = (0, express_1.Router)();
// Zod schemas for validation
const CreateBookingSchema = zod_1.z.object({
    customer_id: zod_1.z.number().int().positive(),
    property_id: zod_1.z.number().int().positive(),
    agreed_price: zod_1.z.number().positive(),
    booking_amount: zod_1.z.number().positive(),
    notes: zod_1.z.string().optional(),
    assigned_employee_id: zod_1.z.number().int().positive().optional(),
});
const UpdateBookingStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['TOKEN_RECEIVED', 'CONFIRMED', 'CANCELLED', 'COMPLETED']),
});
// ─── Booking Form Wizard Schema ────────────────────────────────────────────────
const NewCustomerSchema = zod_1.z.object({
    first_name: zod_1.z.string().min(1),
    last_name: zod_1.z.string().optional(),
    phone: zod_1.z.string().min(10),
    email: zod_1.z.string().email().optional(),
});
const InitiateBookingSchema = zod_1.z.object({
    // Customer — either existing id or new_customer inline
    customer_id: zod_1.z.number().int().positive().optional(),
    new_customer: NewCustomerSchema.optional(),
    // Inventory
    property_id: zod_1.z.number().int().positive().optional().nullable(),
    project_unit_id: zod_1.z.number().int().positive().optional().nullable(),
    assigned_employee_id: zod_1.z.number().int().positive().optional(),
    // Financial
    agreed_price: zod_1.z.number().positive(),
    booking_amount: zod_1.z.number().positive(),
    notes: zod_1.z.string().optional(),
    // Form fields
    serial_no: zod_1.z.string().optional(),
    plot_no: zod_1.z.string().optional(),
    area_sqyd: zod_1.z.number().positive().optional(),
    facing: zod_1.z.string().optional(),
    price_per_sqyd: zod_1.z.number().optional(),
    sale_price_per_sqyd: zod_1.z.number().optional(),
    charges_per_sqyd: zod_1.z.number().optional(),
    emi_months: zod_1.z.number().int().min(1).optional(),
    emi_charges: zod_1.z.number().optional(),
    total_cost: zod_1.z.number().optional(),
    total_cost_words: zod_1.z.string().optional(),
    receipt_no: zod_1.z.string().optional(),
    receipt_date: zod_1.z.string().optional(),
    booking_amount_words: zod_1.z.string().optional(),
    referred_by: zod_1.z.string().optional(),
    referred_by_code: zod_1.z.string().optional(),
    // T&C
    tc_accepted_by_name: zod_1.z.string().optional(),
    // Legacy mode
    is_legacy: zod_1.z.boolean().optional(),
    legacy_booking_date: zod_1.z.string().optional(),
    legacy_notes: zod_1.z.string().optional(),
}).refine(data => data.customer_id || data.new_customer, {
    message: 'Either customer_id or new_customer must be provided',
});
const BookingFormSubmitSchema = zod_1.z.object({
    serial_no: zod_1.z.string().optional(),
    plot_no: zod_1.z.string().optional(),
    area_sqyd: zod_1.z.number().positive().optional(),
    facing: zod_1.z.string().optional(),
    price_per_sqyd: zod_1.z.number().optional(),
    sale_price_per_sqyd: zod_1.z.number().optional(),
    charges_per_sqyd: zod_1.z.number().optional(),
    emi_months: zod_1.z.number().int().min(1).optional(),
    emi_charges: zod_1.z.number().optional(),
    total_cost: zod_1.z.number().optional(),
    total_cost_words: zod_1.z.string().optional(),
    receipt_no: zod_1.z.string().optional(),
    receipt_date: zod_1.z.string().optional(),
    booking_amount_words: zod_1.z.string().optional(),
    referred_by: zod_1.z.string().optional(),
    referred_by_code: zod_1.z.string().optional(),
    tc_accepted_by_name: zod_1.z.string().optional(),
    is_legacy: zod_1.z.boolean().optional(),
    legacy_booking_date: zod_1.z.string().optional(),
    legacy_notes: zod_1.z.string().optional(),
});
const MDRejectSchema = zod_1.z.object({
    reason: zod_1.z.string().min(10, 'Rejection reason must be at least 10 characters'),
});
// ─── Auth middleware on all routes ────────────────────────────────────────────
router.use(auth_1.authenticateToken);
// ─── Standard booking CRUD ────────────────────────────────────────────────────
router.get('/', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_READ), async (req, res, next) => {
    try {
        const bookings = await booking_service_1.BookingService.getBookings(req.user);
        res.json(bookings);
    }
    catch (error) {
        next(error);
    }
});
router.get('/pending-md-approval', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_MD_APPROVE), async (req, res, next) => {
    try {
        const bookings = await booking_service_1.BookingService.getPendingMDApprovals(req.user);
        res.json(bookings);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_READ), async (req, res, next) => {
    try {
        const booking = await booking_service_1.BookingService.getBookingById(req.user, parseInt(req.params.id, 10));
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id/handoff-status', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_READ), async (req, res, next) => {
    try {
        const handoff = await booking_service_1.BookingService.getHandoffStatus(req.user, parseInt(req.params.id, 10));
        res.json(handoff);
    }
    catch (error) {
        next(error);
    }
});
router.post('/', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_CREATE), async (req, res, next) => {
    try {
        const dto = CreateBookingSchema.parse(req.body);
        const booking = await booking_service_1.BookingService.createBooking(req.user, dto);
        res.status(201).json(booking);
    }
    catch (error) {
        next(error);
    }
});
// ─── Booking Initiation Form endpoints (Phase 2026-09-08) ────────────────────
/**
 * POST /bookings/initiate
 * Digital Lead Operator submits the full 4-step booking initiation form.
 * Creates the booking + locks inventory in one transaction.
 */
router.post('/initiate', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_FORM_SUBMIT), async (req, res, next) => {
    try {
        const dto = InitiateBookingSchema.parse(req.body);
        const booking = await booking_service_1.BookingService.initiateBooking(req.user, dto);
        res.status(201).json(booking);
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /bookings/:id/submit-form
 * Resubmit/update form data for a DRAFT or MD_REJECTED booking.
 */
router.post('/:id/submit-form', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_FORM_SUBMIT), async (req, res, next) => {
    try {
        const formData = BookingFormSubmitSchema.parse(req.body);
        const booking = await booking_service_1.BookingService.submitBookingForm(req.user, parseInt(req.params.id, 10), formData);
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /bookings/:id/md-approve
 * MD approves a SUBMITTED booking form → triggers full confirmation flow.
 */
router.post('/:id/md-approve', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_MD_APPROVE), async (req, res, next) => {
    try {
        const booking = await booking_service_1.BookingService.mdApproveBooking(req.user, parseInt(req.params.id, 10));
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /bookings/:id/md-reject
 * MD rejects a SUBMITTED booking form with a mandatory reason.
 */
router.post('/:id/md-reject', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_MD_APPROVE), async (req, res, next) => {
    try {
        const { reason } = MDRejectSchema.parse(req.body);
        const booking = await booking_service_1.BookingService.mdRejectBooking(req.user, parseInt(req.params.id, 10), reason);
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
// ─── Existing status management ───────────────────────────────────────────────
router.post('/:id/confirm', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_CONFIRM), async (req, res, next) => {
    try {
        const booking = await booking_service_1.BookingService.confirmBooking(req.user, parseInt(req.params.id, 10));
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/cancel', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_CANCEL), async (req, res, next) => {
    try {
        const reason = req.body.reason || 'Booking cancelled';
        const booking = await booking_service_1.BookingService.cancelBooking(req.user, parseInt(req.params.id, 10), reason);
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id/status', (0, authz_1.requireAuthz)(shared_1.Permissions.BOOKINGS_UPDATE), async (req, res, next) => {
    try {
        const { status } = UpdateBookingStatusSchema.parse(req.body);
        const booking = await booking_service_1.BookingService.updateBookingStatus(req.user, parseInt(req.params.id, 10), status);
        res.json(booking);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
