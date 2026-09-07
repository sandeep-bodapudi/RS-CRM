// Phase 4.4 (2026-09-07): split from a single 1028-line file into
// single-responsibility route modules under ./attendance/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's mount needed no changes.
import { Router } from 'express';
import qrRouter from './attendance/qr';
import proposalsRouter from './attendance/proposals';
import reportsRouter from './attendance/reports';
import holidaysCalendarRouter from './attendance/holidays-calendar';

const router = Router();

router.use('/', qrRouter);
router.use('/', proposalsRouter);
router.use('/', reportsRouter);
router.use('/', holidaysCalendarRouter);

export default router;
