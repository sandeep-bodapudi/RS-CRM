// Phase 4.4 (2026-09-07): split from a single 722-line file into
// single-responsibility route modules under ./properties/, composed here at
// the same base path ('/') so every URL, method, and registration order is
// unchanged — server.ts's `app.use('/api/v1/properties', propertyRoutes)`
// needed no changes.
import { Router } from 'express';
import crudRouter from './properties/crud';
import workflowRouter from './properties/workflow';
import publicationsRouter from './properties/publications';
import imagesRouter from './properties/images';
import pricingRouter from './properties/pricing';

const router = Router();

router.use('/', crudRouter);
router.use('/', workflowRouter);
router.use('/', publicationsRouter);
router.use('/', imagesRouter);
router.use('/', pricingRouter);

export default router;
