"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../utils/logger");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const qr_1 = require("../../utils/qr");
const time_1 = require("../../utils/time");
const shared_1 = require("../../shared");
const validate_1 = require("../../middleware/validate");
const router = (0, express_1.Router)();
const p = prisma_1.prisma;
// GET /api/v1/attendance/my-qr - Generate personal HMAC QR payload
router.get('/my-qr', auth_1.authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const employeeCode = req.user.employeeCode;
        const version = 1;
        const signedToken = (0, qr_1.generateQrHmac)(employeeId, employeeCode, version);
        // Get latest active QR record or create new
        let qrRecord = await p.employeeQrCode.findFirst({
            where: { employee_id: employeeId },
            orderBy: { generated_at: 'desc' },
        });
        if (!qrRecord) {
            qrRecord = await p.employeeQrCode.create({
                data: {
                    employee_id: employeeId,
                    qr_token: signedToken,
                },
            });
        }
        return res.status(200).json({
            employeeId,
            employeeCode,
            version,
            signedToken,
            qrData: JSON.stringify({ employeeId, employeeCode, version, signedToken }),
        });
    }
    catch (error) {
        logger_1.logger.error('QR fetch error:', error);
        return res.status(500).json({ error: 'Failed to generate QR token' });
    }
});
// GET /api/v1/attendance/employee-qr/:id - Generate/fetch HMAC QR payload for a specific employee (Admin/HR)
router.get('/employee-qr/:id', auth_1.authenticateToken, (0, auth_1.requireRole)([shared_1.Roles.MD, shared_1.Roles.HR_MANAGER, shared_1.Roles.ADMIN]), async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        if (isNaN(targetId))
            return res.status(400).json({ error: 'Invalid employee ID' });
        const employee = await p.employee.findUnique({ where: { id: targetId } });
        if (!employee)
            return res.status(404).json({ error: 'Employee not found' });
        const version = 1;
        const signedToken = (0, qr_1.generateQrHmac)(employee.id, employee.employee_code, version);
        let qrRecord = await p.employeeQrCode.findFirst({
            where: { employee_id: employee.id },
            orderBy: { generated_at: 'desc' },
        });
        if (!qrRecord) {
            qrRecord = await p.employeeQrCode.create({
                data: { employee_id: employee.id, qr_token: signedToken },
            });
        }
        return res.status(200).json({
            employeeId: employee.id,
            employeeCode: employee.employee_code,
            version,
            signedToken,
            qrData: JSON.stringify({
                employeeId: employee.id,
                employeeCode: employee.employee_code,
                version,
                signedToken,
            }),
        });
    }
    catch (error) {
        logger_1.logger.error('Admin QR fetch error:', error);
        return res.status(500).json({ error: 'Failed to generate QR token' });
    }
});
// GET /api/v1/attendance/my-status - Check today's check-in status
router.get('/my-status', auth_1.authenticateToken, async (req, res) => {
    try {
        const employeeId = req.user.employeeId;
        const { dateString } = (0, time_1.getISTComponents)(new Date());
        // Find attendance log for today IST
        const logs = await p.attendanceLog.findMany({
            where: { employee_id: employeeId },
            orderBy: { check_in_at: 'desc' },
            take: 5,
        });
        const todayLog = logs.find((l) => {
            if (!l.check_in_at)
                return false;
            return (0, time_1.getISTComponents)(new Date(l.check_in_at)).dateString === dateString;
        });
        return res.status(200).json({
            date: dateString,
            checkedIn: !!todayLog,
            status: todayLog ? todayLog.status : null,
            checkInAt: todayLog?.check_in_at || null,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to fetch attendance status' });
    }
});
// Helper to parse and verify payload
const parseAndVerifyQR = (req, qrPayload) => {
    let payload = qrPayload;
    if (typeof qrPayload === 'string') {
        try {
            payload = JSON.parse(qrPayload);
        }
        catch (e) { }
    }
    if (!payload || !payload.employeeId)
        return null;
    const isValid = (0, qr_1.verifyQrHmac)(payload.employeeId, payload.employeeCode, payload.version || 1, payload.signedToken || payload);
    return isValid ? payload : null;
};
// POST /api/v1/attendance/scan - Verify QR and Stamp Attendance (IST rules)
// Kiosk-only: must be authenticated with a type:'KIOSK' token.
// The token's embedded branchId is written to AttendanceLog.branch_id so the
// attendance record carries the physical scan location, not the employee's
// assigned branch.
router.post('/scan', auth_1.authenticateKioskToken, (0, validate_1.validateRequestBody)(shared_1.AttendanceQRPayloadSchema), async (req, res) => {
    const targetCompanyId = req.kiosk.companyId;
    const branchId = req.kiosk.branchId; // physical scan location
    try {
        const rawPayload = req.body.qrPayload || req.body.qr_token || req.body.payload;
        const payload = parseAndVerifyQR(req, rawPayload);
        if (!payload)
            return res.status(400).json({ error: 'Invalid or forged QR Code token' });
        const targetEmployeeId = payload.employeeId;
        // Load employee and verify Tenant Isolation & Status
        const scannedEmployee = await p.employee.findUnique({
            where: { id: targetEmployeeId },
        });
        if (!scannedEmployee)
            return res.status(404).json({ error: 'Employee not found' });
        if (scannedEmployee.company_id !== targetCompanyId) {
            return res.status(403).json({ error: 'Employee does not belong to your company' });
        }
        if (scannedEmployee.status !== 'ACTIVE' || !scannedEmployee.attendance_required) {
            return res.status(403).json({ error: 'Employee is not eligible for attendance' });
        }
        const now = new Date();
        const { dateString, timeString } = (0, time_1.getISTComponents)(now);
        if ((0, time_1.getISTDayOfWeek)(dateString) === 0) {
            return res.status(400).json({ error: 'Today is a holiday, attendance cannot be stamped' });
        }
        const holidayCheck = await p.companyHoliday.findFirst({
            where: { company_id: targetCompanyId, date: (0, time_1.toHolidayDateKey)(dateString) },
        });
        if (holidayCheck) {
            return res
                .status(400)
                .json({ error: 'Today is a company holiday, attendance cannot be stamped' });
        }
        // Concurrency Protection via Transaction
        const result = await p.$transaction(async (tx) => {
            const existingLogs = await tx.attendanceLog.findMany({
                where: { employee_id: targetEmployeeId },
                orderBy: { check_in_at: 'desc' },
                take: 5,
            });
            const activeCheckIn = existingLogs.find((l) => l.check_out_at === null);
            if (activeCheckIn)
                return { alreadyStamped: true, log: activeCheckIn };
            const alreadyCheckedInToday = existingLogs.find((l) => {
                if (!l.check_in_at)
                    return false;
                return (0, time_1.getISTComponents)(new Date(l.check_in_at)).dateString === dateString;
            });
            if (alreadyCheckedInToday)
                return { alreadyStamped: true, log: alreadyCheckedInToday };
            // Check for an approved late-checkin proposal covering today (IST)
            const istTodayStart = new Date(`${dateString}T00:00:00+05:30`);
            const istTodayEnd = new Date(`${dateString}T23:59:59+05:30`);
            const approvedProposal = await tx.attendanceProposal.findFirst({
                where: {
                    employee_id: targetEmployeeId,
                    type: 'LATE_CHECKIN',
                    status: 'APPROVED',
                    target_date: { gte: istTodayStart, lte: istTodayEnd },
                },
            });
            const hasApprovedProposal = !!approvedProposal;
            const calculatedStatus = (0, time_1.calculateAttendanceStatus)(now, hasApprovedProposal, scannedEmployee.employment_type || 'FULL_TIME');
            const newLog = await tx.attendanceLog.create({
                data: {
                    employee_id: targetEmployeeId,
                    check_in_at: now,
                    status: calculatedStatus,
                    source: 'QR_SCAN',
                    ...(branchId != null ? { branch_id: branchId } : {}), // populate only for kiosk scans
                },
            });
            return { alreadyStamped: false, log: newLog };
        }, { isolationLevel: 'Serializable' });
        if (result.alreadyStamped) {
            return res.status(200).json({
                message: 'Already logged in for today',
                alreadyStamped: true,
                status: result.log?.status,
                checkInAt: result.log?.check_in_at,
                timeIST: timeString,
                full_name: scannedEmployee.full_name,
            });
        }
        return res.status(200).json({
            message: `Login stamped successfully as ${result.log?.status}`,
            alreadyStamped: false,
            status: result.log?.status,
            checkInAt: result.log?.check_in_at,
            timeIST: timeString,
            full_name: scannedEmployee.full_name,
        });
    }
    catch (error) {
        if (error.code === 'P2034') {
            // Transaction conflict / deadlock. Another request won the race.
            // We can safely assume they are already logged in.
            return res.status(200).json({
                message: 'Already logged in (handled concurrent request)',
                alreadyStamped: true,
                status: 'PRESENT',
                timeIST: (0, time_1.getISTComponents)(new Date()).timeString,
            });
        }
        logger_1.logger.error('Scan attendance error:', error);
        return res.status(500).json({ error: 'Attendance scan verification failed' });
    }
});
// POST /api/v1/attendance/checkout - Stamp Checkout (IST rules)
router.post('/checkout', auth_1.authenticateKioskToken, (0, validate_1.validateRequestBody)(shared_1.AttendanceQRPayloadSchema), async (req, res) => {
    const targetCompanyId = req.kiosk.companyId;
    const branchId = req.kiosk.branchId;
    try {
        const rawPayload = req.body.qrPayload || req.body.qr_token || req.body.payload;
        const payload = parseAndVerifyQR(req, rawPayload);
        if (!payload)
            return res.status(400).json({ error: 'Invalid or forged QR Code token' });
        const targetEmployeeId = payload.employeeId;
        const scannedEmployee = await p.employee.findUnique({ where: { id: targetEmployeeId } });
        if (!scannedEmployee || scannedEmployee.company_id !== targetCompanyId) {
            return res.status(403).json({ error: 'Employee does not belong to your company' });
        }
        const now = new Date();
        const { dateString, timeString } = (0, time_1.getISTComponents)(now);
        if ((0, time_1.getISTDayOfWeek)(dateString) === 0) {
            return res.status(400).json({ error: 'Today is a holiday, attendance cannot be stamped' });
        }
        const holidayCheck = await p.companyHoliday.findFirst({
            where: { company_id: targetCompanyId, date: (0, time_1.toHolidayDateKey)(dateString) },
        });
        if (holidayCheck) {
            return res
                .status(400)
                .json({ error: 'Today is a company holiday, attendance cannot be stamped' });
        }
        if (timeString < '18:00:00') {
            // Check for approved early logout proposal
            const earlyProposal = await p.attendanceProposal.findFirst({
                where: {
                    employee_id: targetEmployeeId,
                    type: 'EARLY_CHECKOUT',
                    status: 'APPROVED',
                    target_date: {
                        gte: new Date(`${dateString}T00:00:00.000Z`),
                        lte: new Date(`${dateString}T23:59:59.999Z`),
                    },
                },
            });
            if (!earlyProposal) {
                return res
                    .status(400)
                    .json({ error: 'Logout is not allowed before 18:00 IST without an emergency request' });
            }
        }
        // Kiosk logout gate: employees with report_required=true must submit today's
        // daily report before checking out. Reuses the same lookup logic as GET /reports/today-status.
        if (scannedEmployee.report_required) {
            const todayReport = await p.dailyReport.findFirst({
                where: {
                    employee_id: targetEmployeeId,
                    submitted_at: {
                        gte: new Date(`${dateString}T00:00:00.000Z`),
                        lte: new Date(`${dateString}T23:59:59.999Z`),
                    },
                },
            });
            if (!todayReport) {
                return res.status(400).json({
                    error: "Please submit today's daily report before logging out. Go to your account, submit the report, then come back and scan out.",
                });
            }
        }
        const result = await p.$transaction(async (tx) => {
            // Find active check-in
            const activeLog = await tx.attendanceLog.findFirst({
                where: { employee_id: targetEmployeeId, check_out_at: null },
                orderBy: { check_in_at: 'desc' },
            });
            if (!activeLog)
                return { error: 'No active check-in found for today' };
            const checkInTime = new Date(activeLog.check_in_at).getTime();
            const diffMs = now.getTime() - checkInTime;
            const durationMinutes = Math.max(0, Math.round(diffMs / 60000));
            const updatedLog = await tx.attendanceLog.update({
                where: { id: activeLog.id },
                data: {
                    check_out_at: now,
                    working_duration_minutes: durationMinutes,
                    ...(branchId != null ? { branch_id: branchId } : {}), // populate only for kiosk scans
                },
            });
            return { log: updatedLog };
        }, { isolationLevel: 'Serializable' });
        if (result.error)
            return res.status(400).json({ error: result.error });
        return res.status(200).json({
            message: 'Logged out successfully',
            checkOutAt: result.log?.check_out_at,
            working_duration_minutes: result.log?.working_duration_minutes,
            timeIST: timeString,
            full_name: scannedEmployee.full_name,
        });
    }
    catch (error) {
        logger_1.logger.error('Logout error:', error);
        return res.status(500).json({ error: 'Attendance logout failed' });
    }
});
exports.default = router;
