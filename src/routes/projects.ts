// Composer for /api/v1/projects — split into single-responsibility route
// modules under ./projects/, mirroring routes/properties.ts's Phase 4.4 split.
// Every URL, method, and registration order is preserved so server.ts's
// `app.use('/api/v1/projects', projectRoutes)` needed no change.
import { Router } from 'express';
import coreRouter from './projects/core';
import unitsRouter from './projects/units';
import pricingRouter from './projects/pricing';
import amenitiesRouter from './projects/amenities';

const router = Router();

router.use('/', coreRouter);
router.use('/', unitsRouter);
router.use('/', pricingRouter);
router.use('/', amenitiesRouter);

export default router;
