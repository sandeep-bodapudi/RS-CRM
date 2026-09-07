import { logger } from '../../utils/logger';
import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma';
import {
  authenticateToken,
  AuthenticatedRequest,
  requireRole,
  authenticateKioskToken,
  KioskAuthenticatedRequest,
} from '../../middleware/auth';
import { generateQrHmac, verifyQrHmac } from '../../utils/qr';
import {
  calculateAttendanceStatus,
  getISTComponents,
  getISTDayOfWeek,
  toHolidayDateKey,
} from '../../utils/time';
import { Roles, AttendanceQRPayloadSchema } from '../../shared';
import { validateRequestBody } from '../../middleware/validate';

const router = Router();

const p = prisma;

// Kiosk scanner type — not yet in @rrh-ems/shared; defined locally to avoid a circular dep.
export type ScannerType = 'KIOSK' | 'EMPLOYEE_DEVICE';

// GET /api/v1/attendance/my-qr - Generate personal HMAC QR payload
router.get('/my-qr', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = req.user!.employeeId;
    const employeeCode = req.user!.employeeCode;
    const version = 1;
    const signedToken = generateQrHmac(employeeId, employeeCode, version);

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
  } catch (error) {
    logger.error('QR fetch error:', error);
    return res.status(500).json({ error: 'Failed to generate QR token' });
  }
});

// GET /api/v1/attendance/employee-qr/:id - Generate/fetch HMAC QR payload for a specific employee (Admin/HR)
router.get(
  '/employee-qr/:id',
  authenticateToken,
  requireRole([Roles.MD, Roles.HR_MANAGER, Roles.ADMIN]),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const targetId = parseInt(req.params.id);
      if (isNaN(targetId)) return res.status(400).json({ error: 'Invalid employee ID' });

      const employee = await p.employee.findUnique({ where: { id: targetId } });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const version = 1;
      const signedToken = generateQrHmac(employee.id, employee.employee_code, version);

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
    } catch (error) {
      logger.error('Admin QR fetch error:', error);
      return res.status(500).json({ error: 'Failed to generate QR token' });
    }
  },
);

// GET /api/v1/attendance/my-status - Check today's check-in status
router.get('/my-status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employeeId = req.user!.employeeId;
    const { dateString } = getISTComponents(new Date());

    // Find attendance log for today IST
    const logs = await p.attendanceLog.findMany({
      where: { employee_id: employeeId },
      orderBy: { check_in_at: 'desc' },
      take: 5,
    });

    const todayLog = logs.find((l: any) => {
      if (!l.check_in_at) return false;
      return getISTComponents(new Date(l.check_in_at)).dateString === dateString;
    });

    return res.status(200).json({
      date: dateString,
      checkedIn: !!todayLog,
      status: todayLog ? todayLog.status : null,
      checkInAt: todayLog?.check_in_at || null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch attendance status' });
  }
});

// Helper to parse and verify payload
const parseAndVerifyQR = (req: AuthenticatedRequest, qrPayload: any) => {
  let payload = qrPayload;
  if (typeof qrPayload === 'string') {
    try {
      payload = JSON.parse(qrPayload);
    } catch (e) {}
  }

  if (!payload || !payload.employeeId) return null;

  const isValid = verifyQrHmac(
    payload.employeeId,
    payload.employeeCode,
    payload.version || 1,
    payload.signedToken || payload,
  );

  return isValid ? payload : null;
};

// POST /api/v1/attendance/scan - Verify QR and Stamp Attendance (IST rules)
// Kiosk-only: must be authenticated with a type:'KIOSK' token.
// The token's embedded branchId is written to AttendanceLog.branch_id so the
// attendance record carries the physical scan location, not the employee's
// assigned branch.
router.post(
  '/scan',
  authenticateKioskToken,
  validateRequestBody(AttendanceQRPayloadSchema),
  async (req: KioskAuthenticatedRequest, res: Response) => {
    const targetCompanyId = req.kiosk!.companyId;
    const branchId = req.kiosk!.branchId; // physical scan location

    try {
      const rawPayload = req.body.qrPayload || req.body.qr_token || req.body.payload;
      const payload = parseAndVerifyQR(req, rawPayload);
      if (!payload) return res.status(400).json({ error: 'Invalid or forged QR Code token' });

      const targetEmployeeId = payload.employeeId;

      // Load employee and verify Tenant Isolation & Status
      const scannedEmployee = await p.employee.findUnique({
        where: { id: targetEmployeeId },
      });

      if (!scannedEmployee) return res.status(404).json({ error: 'Employee not found' });
      if (scannedEmployee.company_id !== targetCompanyId) {
        return res.status(403).json({ error: 'Employee does not belong to your company' });
      }
      if (scannedEmployee.status !== 'ACTIVE' || !scannedEmployee.attendance_required) {
        return res.status(403).json({ error: 'Employee is not eligible for attendance' });
      }

      const now = new Date();
      const { dateString, timeString } = getISTComponents(now);

      if (getISTDayOfWeek(dateString) === 0) {
        return res.status(400).json({ error: 'Today is a holiday, attendance cannot be stamped' });
      }
      const holidayCheck = await p.companyHoliday.findFirst({
        where: { company_id: targetCompanyId, date: toHolidayDateKey(dateString) },
      });
      if (holidayCheck) {
        return res
          .status(400)
          .json({ error: 'Today is a company holiday, attendance cannot be stamped' });
      }

      // Concurrency Protection via Transaction
      const result = await p.$transaction(
        async (tx: import('@prisma/client').Prisma.TransactionClient) => {
          const existingLogs = await tx.attendanceLog.findMany({
            where: { employee_id: targetEmployeeId },
            orderBy: { check_in_at: 'desc' },
            take: 5,
          });

          const activeCheckIn = existingLogs.find((l: any) => l.check_out_at === null);
          if (activeCheckIn) return { alreadyStamped: true, log: activeCheckIn };

          const alreadyCheckedInToday = existingLogs.find((l: any) => {
            if (!l.check_in_at) return false;
            return getISTComponents(new Date(l.check_in_at)).dateString === dateString;
          });

          if (alreadyCheckedInToday) return { alreadyStamped: true, log: alreadyCheckedInToday };

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

          const calculatedStatus = calculateAttendanceStatus(
            now,
            hasApprovedProposal,
            scannedEmployee.employment_type || 'FULL_TIME',
          );
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
        },
        { isolationLevel: 'Serializable' },
      );

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
    } catch (error: any) {
      if (error.code === 'P2034') {
        // Transaction conflict / deadlock. Another request won the race.
        // We can safely assume they are already logged in.
        return res.status(200).json({
          message: 'Already logged in (handled concurrent request)',
          alreadyStamped: true,
          status: 'PRESENT',
          timeIST: getISTComponents(new Date()).timeString,
        });
      }
      logger.error('Scan attendance error:', error);
      return res.status(500).json({ error: 'Attendance scan verification failed' });
    }
  },
);

// POST /api/v1/attendance/checkout - Stamp Checkout (IST rules)
router.post(
  '/checkout',
  authenticateKioskToken,
  validateRequestBody(AttendanceQRPayloadSchema),
  async (req: KioskAuthenticatedRequest, res: Response) => {
    const targetCompanyId = req.kiosk!.companyId;
    const branchId = req.kiosk!.branchId;

    try {
      const rawPayload = req.body.qrPayload || req.body.qr_token || req.body.payload;
      const payload = parseAndVerifyQR(req, rawPayload);
      if (!payload) return res.status(400).json({ error: 'Invalid or forged QR Code token' });

      const targetEmployeeId = payload.employeeId;

      const scannedEmployee = await p.employee.findUnique({ where: { id: targetEmployeeId } });
      if (!scannedEmployee || scannedEmployee.company_id !== targetCompanyId) {
        return res.status(403).json({ error: 'Employee does not belong to your company' });
      }

      const now = new Date();
      const { dateString, timeString } = getISTComponents(now);

      if (getISTDayOfWeek(dateString) === 0) {
        return res.status(400).json({ error: 'Today is a holiday, attendance cannot be stamped' });
      }
      const holidayCheck = await p.companyHoliday.findFirst({
        where: { company_id: targetCompanyId, date: toHolidayDateKey(dateString) },
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
            error:
              "Please submit today's daily report before logging out. Go to your account, submit the report, then come back and scan out.",
          });
        }
      }

      const result = await p.$transaction(
        async (tx: import('@prisma/client').Prisma.TransactionClient) => {
          // Find active check-in
          const activeLog = await tx.attendanceLog.findFirst({
            where: { employee_id: targetEmployeeId, check_out_at: null },
            orderBy: { check_in_at: 'desc' },
          });

          if (!activeLog) return { error: 'No active check-in found for today' };

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
        },
        { isolationLevel: 'Serializable' },
      );

      if (result.error) return res.status(400).json({ error: result.error });

      return res.status(200).json({
        message: 'Logged out successfully',
        checkOutAt: result.log?.check_out_at,
        working_duration_minutes: result.log?.working_duration_minutes,
        timeIST: timeString,
        full_name: scannedEmployee.full_name,
      });
    } catch (error) {
      logger.error('Logout error:', error);
      return res.status(500).json({ error: 'Attendance logout failed' });
    }
  },
);

export default router;
