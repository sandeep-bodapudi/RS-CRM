import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { findBestAssigneeForLead } from '../../utils/distributionService';
import { AppError } from './errors';
import { generateNextLeadCode } from './shared';
import { notifyEmployee } from '../../utils/notifyEmployee';
import { logger } from '../../utils/logger';
const p = prisma;

export async function distributeUnassignedPoolLeads(companyId: number) {
    const unassignedLeads = await p.lead.findMany({
      where: {
        company_id: companyId,
        status: 'NEW',
        assigned_to_id: null,
        ownership_type: 'POOL',
      },
      orderBy: { created_at: 'asc' } // Oldest first
    });

    let assignedCount = 0;
    for (const lead of unassignedLeads) {
      const bestAssignee = await findBestAssigneeForLead(companyId);
      if (bestAssignee) {
        await p.$transaction(async (tx) => {
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              status: 'ASSIGNED',
              assigned_to_id: bestAssignee.employeeId,
              assigned_at: new Date(),
              assignment_type: 'PERFORMANCE_WEIGHTED',
            },
          });
          await tx.leadActivity.create({
            data: {
              lead_id: lead.id,
              actor_id: lead.created_by_id || 1,
              activity_type: 'ASSIGNED_TO_AGENT',
              notes: `Auto-distributed to ${bestAssignee.name} (${bestAssignee.employeeCode}) [Weight Score: ${bestAssignee.weight.toFixed(1)}]`,
            },
          });
        });
        assignedCount++;
      }
    }
    return assignedCount;
  }

export async function triggerLeadRecoveryForProperty(propertyId: number) {
    const { matchDroppedLeadsToProperty } = await import('../../utils/matchingEngine');
    const matchedLeadIds = await matchDroppedLeadsToProperty(propertyId);
    if (!matchedLeadIds.length) return;

    for (const leadId of matchedLeadIds) {
      const lead = await p.lead.findFirst({
        where: { id: leadId, status: 'DROPPED', exit_reason: 'NO_MATCHING_INVENTORY' },
        select: { id: true, company_id: true, assigned_to_id: true },
      });
      if (!lead) continue;

      // A dropped lead may have lost its assignee in the meantime (e.g. the
      // employee was deactivated) -- restoring status to ASSIGNED without an
      // assignee produced exactly that contradiction (an "Assigned" lead
      // sitting in the Unassigned Pool). Re-run the same distribution
      // algorithm every other recovery path already uses when there's no
      // assignee to fall back on.
      let assigneeId = lead.assigned_to_id;
      if (!assigneeId) {
        const bestAssignee = await findBestAssigneeForLead(lead.company_id);
        assigneeId = bestAssignee?.employeeId ?? null;
      }

      // Atomic guard: strictly require status = 'DROPPED' AND exit_reason = 'NO_MATCHING_INVENTORY'
      const updated = await p.lead.updateMany({
        where: {
          id: leadId,
          status: 'DROPPED',
          exit_reason: 'NO_MATCHING_INVENTORY'
        },
        data: {
          status: assigneeId ? 'ASSIGNED' : 'NEW',
          exit_reason: null,
          exited_from_status: null,
          ...(assigneeId && !lead.assigned_to_id
            ? { assigned_to_id: assigneeId, assigned_at: new Date(), assignment_type: 'PERFORMANCE_WEIGHTED' }
            : {}),
        }
      });

      if (updated.count > 0) {
        // Fetch lead to get assigned_to_id for notification
        const recoveredLead = await p.lead.findUnique({
          where: { id: leadId },
          select: { assigned_to_id: true, lead_code: true, customer_name: true }
        });

        if (recoveredLead && recoveredLead.assigned_to_id) {
          await p.notification.create({
            data: {
              employee_id: recoveredLead.assigned_to_id,
              type: 'SYSTEM_ALERT',
              title: 'Lead Recovered',
              message: `Lead ${recoveredLead.lead_code} (${recoveredLead.customer_name}) has been automatically recovered because new matching inventory became available.`,
            }
          });
          // Web push to recovered lead owner (outside transaction)
          notifyEmployee(recoveredLead.assigned_to_id, {
            type: 'SYSTEM_ALERT',
            title: 'Lead Recovered',
            message: `Lead ${recoveredLead.lead_code} (${recoveredLead.customer_name}) has been recovered — new inventory is available.`,
          }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Lead recovery notify:', err));

          await p.leadActivity.create({
            data: {
              lead_id: leadId,
              actor_id: recoveredLead.assigned_to_id, // Attributing to the owner
              activity_type: 'LEAD_RECOVERED',
              notes: `Lead automatically recovered due to new matching inventory (Property ID: ${propertyId}). Status set to ASSIGNED.`,
            }
          });
        }
      }
    }
  }

export async function recoverManualLead(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({ where: { id: leadId, } });
    if (!lead) throw new AppError(404, 'Lead not found');

    if (lead.status !== 'DROPPED' && lead.status !== 'CANCELLED') {
      throw new AppError(400, 'Only dropped or cancelled leads can be manually recovered.');
    }

    return await p.$transaction(async (tx) => {
      const recovered = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: 'CONTACTED',
          assigned_to_id: user.employeeId, // Assign to whoever is handling it
          assigned_at: new Date(),
          assignment_type: 'MANUAL_OVERRIDE',
          exit_reason: null,
          exited_from_status: null,
        }
      });

      await tx.leadActivity.create({
        data: {
          lead_id: leadId,
          actor_id: user.employeeId || 1,
          activity_type: 'LEAD_RECOVERED',
          notes: 'Lead manually recovered from Dropped/Cancelled state to Contacted.'
        }
      });

      await tx.leadActivity.create({
        data: {
          lead_id: leadId,
          actor_id: user.employeeId || 1,
          activity_type: 'CALL_LOGGED',
          notes: 'Initial contact logged upon manual recovery.'
        }
      });

      return recovered;
    });
  }

export async function recoverFreshLead(user: TokenPayload, leadId: number) {
    const lead = await p.lead.findFirst({ where: { id: leadId, } });
    if (!lead) throw new AppError(404, 'Lead not found');

    if (lead.status !== 'DROPPED' && lead.status !== 'CANCELLED') {
      throw new AppError(400, 'Only dropped or cancelled leads can be used to start a fresh lead.');
    }

    const leadCode = await generateNextLeadCode();

    return await p.$transaction(async (tx) => {
      const freshLead = await tx.lead.create({
        data: {
          lead_code: leadCode,
          company_id: lead.company_id,
          branch_id: lead.branch_id,
          customer_name: lead.customer_name,
          phone: lead.phone,
          email: lead.email,
          source: lead.source,
          status: 'CONTACTED',
          assigned_to_id: user.employeeId,
          assigned_at: new Date(),
          assignment_type: 'MANUAL_OVERRIDE',
          created_by_id: user.employeeId || 1,
          previous_lead_id: lead.id,
        }
      });

      await tx.leadActivity.create({
        data: {
          lead_id: freshLead.id,
          actor_id: user.employeeId || 1,
          activity_type: 'LEAD_RECOVERED',
          notes: `Started fresh lead from previous record (Lead ID: ${lead.lead_code}).`
        }
      });

      await tx.leadActivity.create({
        data: {
          lead_id: freshLead.id,
          actor_id: user.employeeId || 1,
          activity_type: 'CALL_LOGGED',
          notes: 'Initial contact logged for fresh start.'
        }
      });

      return freshLead;
    });
  }
