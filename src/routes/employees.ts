// Phase 4.4 (2026-09-07): split from a single 991-line file into
// single-responsibility route modules under ./employees/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's mount needed no changes.
import { Router } from 'express';
import selfRouter from './employees/self';
import listRouter from './employees/list';
import createRouter from './employees/create';
import updateRouter from './employees/update';
import adminActionsRouter from './employees/admin-actions';
import lifecycleRouter from './employees/lifecycle';

const router = Router();

router.use('/', selfRouter);
router.use('/', listRouter);
router.use('/', createRouter);
router.use('/', updateRouter);
router.use('/', adminActionsRouter);
router.use('/', lifecycleRouter);

export default router;
