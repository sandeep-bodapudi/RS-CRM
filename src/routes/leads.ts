import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { requireAuthz } from '../middleware/authz';
import {
  Roles,
  LeadCreateSchema,
  LeadStatusUpdateSchema,
  LeadReassignSchema,
  Permissions,
  AddPropertyInterestSchema,
} from '../shared';
import { validateRequestBody } from '../middleware/validate';
import { LeadService, AppError } from '../services/lead.service';
import { syncLeadPreferredLocations } from '../services/lead/shared';
import { OpportunityService } from '../services/opportunity.service';
import prisma from '../lib/prisma';

const router = Router();

// Helper to catch and route AppErrors to HTTP responses
const handleServiceError = (error: any, res: Response) => {
  if (error instanceof AppError || error.name === 'AppError' || error.statusCode) {
    return res
      .status(error.statusCode || 400)
      .json({ error: error.message, code: (error as any).code });
  }
  logger.error('Unhandled route error:', error);
  return res.status(500).json({ error: 'Internal Server Error' });
};

// GET /api/v1/leads - Fetch leads list (Role-aware)
router.get(
  '/',
  authenticateToken,
  requireAuthz(Permissions.LEADS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const leads = await LeadService.getLeads(req.user!, limit, offset);
      return res.status(200).json({ leads, pagination: { limit, offset } });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// GET /api/v1/leads/distribution-monitor - Telecaller load & intake monitor
router.get(
  '/distribution-monitor',
  authenticateToken,
  requireAuthz(Permissions.LEADS_DISTRIBUTION_MONITOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await LeadService.getDistributionMonitor(req.user!.companyId);
      return res.status(200).json(data);
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads - Telecaller creates new lead
router.post(
  '/',
  authenticateToken,
  requireAuthz(Permissions.LEADS_CREATE),
  validateRequestBody(LeadCreateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await LeadService.createLead(req.user!, req.body);
      return res.status(201).json({
        message: 'Lead created successfully',
        ...result,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/convert-to-customer
router.post(
  '/:id/convert-to-customer',
  authenticateToken,
  requireAuthz(Permissions.CUSTOMERS_CONVERT),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // We delegate to CustomerService to handle the transaction
      const { CustomerService } = await import('../services/customer.service');
      const result = await CustomerService.convertFromLead(req.user!, parseInt(req.params.id));
      return res.status(201).json({
        message: 'Lead converted to customer successfully',
        customer: result,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/bulk-upload - Bulk CSV/Excel importer (Digital Lead Operator / MD / Admin)
router.post(
  '/bulk-upload',
  authenticateToken,
  requireAuthz(Permissions.LEADS_BULK_UPLOAD),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { leads: rawLeads } = req.body;
      if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
        return res.status(400).json({ error: 'Array of lead rows required in body under "leads"' });
      }

      const result = await LeadService.bulkUploadLeads(req.user!, rawLeads);
      return res.status(200).json({
        message: `Successfully processed and auto-distributed ${result.successful_imports} leads`,
        count: result.successful_imports,
        // Previously dropped on the floor -- a partial failure (duplicates,
        // missing fields, etc.) was invisible to the uploader beyond a lower
        // count than expected, with no explanation of which rows or why.
        total_rows: result.total_rows,
        duplicates: result.duplicates,
        failed_rows: result.failed_rows,
        errors: result.errors,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/assign - Manual Re-assignment Override (Audited)
router.post(
  '/:id/assign',
  authenticateToken,
  requireAuthz(Permissions.LEADS_ASSIGN),
  validateRequestBody(LeadReassignSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const { assigned_to_id, reason } = req.body;

      const updated = await LeadService.reassignLead(req.user!, leadId, assigned_to_id, reason);

      return res.status(200).json({
        message: `Lead ${updated.lead_code} reassigned successfully`,
        lead: updated,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// PATCH /api/v1/leads/:id/status - Update lead status (through the workflow engine)
router.patch(
  '/:id/status',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  validateRequestBody(LeadStatusUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const {
        status,
        notes,
        exit_reason,
        exit_reason_detail,
        demo_scheduled_at,
        demo_handler_id,
        qualification,
      } = req.body;

      const updated = await LeadService.updateLeadStatus(req.user!, leadId, status, notes, {
        exit_reason,
        exit_reason_detail,
        demo_scheduled_at,
        demo_handler_id,
        qualification,
      });

      return res.status(200).json({
        message: `Lead ${updated.lead_code} status updated to ${status}`,
        lead: updated,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// PATCH /api/v1/leads/:id - Generic lead update (for qualification, budget, notes, etc.)
router.patch(
  '/:id',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const updateData = req.body;

      const existingLead = await LeadService.getLeadById(req.user!, leadId);
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Basic update using prisma
      const updated = await prisma.$transaction(
        async (tx: import('@prisma/client').Prisma.TransactionClient) => {
          const lead = await tx.lead.update({
            where: { id: leadId },
            data: {
              budget_min: updateData.budget_min !== undefined ? updateData.budget_min : undefined,
              budget_max: updateData.budget_max !== undefined ? updateData.budget_max : undefined,
              property_type_preference:
                updateData.property_type_preference !== undefined
                  ? updateData.property_type_preference
                  : undefined,
              // Full multi-location list (§ Phase 2) wins over the legacy single
              // field when both are sent — its first entry becomes the primary.
              preferred_location:
                updateData.preferred_locations && updateData.preferred_locations.length > 0
                  ? updateData.preferred_locations[0]
                  : updateData.preferred_location !== undefined
                    ? updateData.preferred_location
                    : undefined,
              notes: updateData.notes !== undefined ? updateData.notes : undefined,
            },
          });

          if (updateData.preferred_locations !== undefined) {
            await syncLeadPreferredLocations(tx, leadId, updateData.preferred_locations || []);
          }

          return lead;
        },
      );

      // Log activity for qualification update if provided
      if (updateData.budget_min !== undefined || updateData.property_type_preference) {
        await prisma.leadActivity.create({
          data: {
            lead_id: leadId,
            actor_id: req.user!.employeeId,
            activity_type: 'QUALIFIED',
            notes: 'Lead qualification details updated manually.',
          },
        });
      }

      return res.status(200).json({
        message: `Lead ${updated.lead_code} updated successfully`,
        lead: updated,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// GET /api/v1/leads/:id - Fetch single lead
router.get(
  '/:id',
  authenticateToken,
  requireAuthz(Permissions.LEADS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      if (isNaN(leadId)) {
        return res.status(400).json({ error: 'Invalid Lead ID' });
      }

      const lead = await LeadService.getLeadById(req.user!, leadId);
      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      // Authorization already passed at middleware level (role-based)
      // and getLeadById enforces tenant isolation.
      return res.status(200).json({ lead });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

router.get('/:id/matches', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const leadId = parseInt(req.params.id, 10);
    const matches = await LeadService.getMatches(req.user!, leadId);
    return res.status(200).json({ matches });
  } catch (error: any) {
    return handleServiceError(error, res);
  }
});

// GET /api/v1/leads/:id/opportunities
router.get(
  '/:id/opportunities',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      // Enforce Lead read authorization (ensure Lead belongs to company, etc)
      const existingLead = await LeadService.getLeadById(req.user!, leadId);
      if (!existingLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      const opportunities = await OpportunityService.getOpportunitiesByLead(req.user!, leadId);
      return res.status(200).json({ opportunities });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/whatsapp-proposal/:propertyId - Send WhatsApp Proposal Payload & Log Activity
router.post(
  '/:id/whatsapp-proposal/:propertyId',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const propertyId = parseInt(req.params.propertyId, 10);

      const result = await LeadService.sendWhatsAppProposal(req.user!, leadId, propertyId);

      return res.status(200).json({
        message: 'WhatsApp proposal generated',
        ...result,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/properties - Add a property interest
router.post(
  '/:id/properties',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  validateRequestBody(AddPropertyInterestSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const { property_id } = req.body;

      const interest = await LeadService.addPropertyInterest(req.user!, leadId, property_id);

      return res.status(201).json({
        message: 'Property interest added successfully',
        interest,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// DELETE /api/v1/leads/:id/properties/:propertyId - Remove a property interest
router.delete(
  '/:id/properties/:propertyId',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const propertyId = parseInt(req.params.propertyId, 10);

      const result = await LeadService.removePropertyInterest(req.user!, leadId, propertyId);

      return res.status(200).json(result);
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// GET /api/v1/leads/:id/properties - Get properties the lead is interested in
router.get(
  '/:id/properties',
  authenticateToken,
  requireAuthz(Permissions.LEADS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const interests = await LeadService.getPropertyInterests(req.user!, leadId);

      return res.status(200).json({ interests });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// GET /api/v1/leads/:id/tasks - Get tasks associated with the lead
router.get(
  '/:id/tasks',
  authenticateToken,
  requireAuthz(Permissions.LEADS_READ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const tasks = await LeadService.getLeadTasks(req.user!, leadId);

      return res.status(200).json({ tasks });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/recover-manual - Manually recover a dropped/cancelled lead (Same ID)
router.post(
  '/:id/recover-manual',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const recovered = await LeadService.recoverManualLead(req.user!, leadId);

      return res.status(200).json({
        message: 'Lead manually recovered successfully',
        lead: recovered,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

// POST /api/v1/leads/:id/recover-fresh - Start a fresh lead from a dropped/cancelled one (New ID)
router.post(
  '/:id/recover-fresh',
  authenticateToken,
  requireAuthz(Permissions.LEADS_UPDATE), // Or LEADS_CREATE, but practically they need access to the old lead
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const freshLead = await LeadService.recoverFreshLead(req.user!, leadId);

      return res.status(201).json({
        message: 'Fresh lead created successfully from history',
        lead: freshLead,
      });
    } catch (error: any) {
      return handleServiceError(error, res);
    }
  },
);

export default router;
