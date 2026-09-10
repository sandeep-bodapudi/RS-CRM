import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { Roles } from '../../shared';
import { AppError } from './errors';
import { generateNextLeadCode, calculateLeadScore, syncLeadPreferredLocations } from './shared';
import { findBestAssigneeForLead } from '../../utils/distributionService';

const p = prisma;

export async function createLead(
  user: TokenPayload,
  dto: any,
  opts?: { isPublicSubmission?: boolean },
) {
    // Public-website submissions have no real employee behind them. `user`
    // here is still a real TokenPayload (see routes/public.ts's use of
    // getOrCreateSystemEmployee) so every FK-required field (LeadActivity's
    // actor_id, etc.) has something valid to point at — but attribution
    // credit (created_by_id, below) must NOT go to that placeholder, and a
    // public submission can never be a DIRECT/channel-partner claim.
    const isPublicSubmission = opts?.isPublicSubmission === true;

    // ─────────────────────────────────────────────────────────────────────────
    // LEAD ATTRIBUTION IMMUTABILITY CONTRACT
    //
    // created_by_id  = IMMUTABLE — set once from the authenticated server-side
    //                  user identity. Represents permanent attribution credit.
    //                  The original introducer retains credit regardless of any
    //                  subsequent reassignment, qualification, site visit,
    //                  opportunity creation, conversion, or closure.
    //
    // assigned_to_id = MUTABLE — operational assignment, may change freely via
    //                  reassignLead(). Represents who is currently working the lead.
    //
    // DEFENSIVE STRIP: Although LeadCreateSchema (Zod) already excludes
    // created_by_id, we explicitly delete it here so that even if the schema
    // definition ever changes, no client-supplied value can override attribution.
    // ─────────────────────────────────────────────────────────────────────────
    delete dto.created_by_id;

    // 1. DUPLICATE DETECTION (Same Company Only)
    if (!dto.phone) {
      throw new AppError(400, 'Phone number is required for lead creation.');
    }
    const existingLead = await p.lead.findFirst({
      where: {
        company_id: user.companyId,
        OR: [
          { phone: dto.phone },
          ...(dto.email ? [{ email: dto.email }] : [])
        ]
      },
      include: {
        assigned_to: { select: { id: true, full_name: true, employee_code: true } },
        site_visits: {
          where: { status: { in: ['CANCELLED'] } },
          include: { property: { select: { title: true, status: true } } },
          orderBy: { created_at: 'desc' },
          take: 1
        }
      }
    });

    if (existingLead) {
      const isDropped = existingLead.status === 'DROPPED' || existingLead.status === 'CANCELLED';
      
      if (!isDropped) {
        // Active lead duplicate check (Task 6)
        // Append note and notify owner, return existing lead
        const sourceName = dto.source || 'MANUAL_ENTRY';
        await p.leadActivity.create({
          data: {
            lead_id: existingLead.id,
            actor_id: user.employeeId || existingLead.assigned_to_id || 1,
            activity_type: 'NOTE_ADDED',
            notes: `Duplicate entry attempt via ${sourceName}. Customer re-inquired.`
          }
        });

        if (existingLead.assigned_to_id) {
          await p.notification.create({
            data: {
              employee_id: existingLead.assigned_to_id,
              type: 'SYSTEM_ALERT',
              title: 'Active Lead Re-Inquiry',
              message: `Your active lead ${existingLead.lead_code} (${existingLead.customer_name}) submitted a new inquiry via ${sourceName}.`
            }
          });
        }
          return { lead: existingLead };
      } else {
        // Dropped/Cancelled lead duplicate check
        const isAutomatedChannel = dto.source !== 'MANUAL_ENTRY' && dto.source !== 'REFERRAL';
        
        if (isAutomatedChannel) {
          // Task 7: Automated channel -> auto-recover to POOL
          const recovered = await p.lead.update({
            where: { id: existingLead.id },
            data: {
              status: 'NEW',
              ownership_type: 'POOL',
              assigned_to_id: null,
              assigned_at: null,
              exit_reason: null,
              exited_from_status: null
            }
          });
          
          await p.leadActivity.create({
            data: {
              lead_id: existingLead.id,
              actor_id: user.employeeId || 1,
              activity_type: 'LEAD_RECOVERED',
              notes: `Lead automatically recovered to POOL due to new inquiry via ${dto.source}.`
            }
          });
          
          return { lead: recovered };
        } else {
          // Task 8: Manual intake -> throw 409 with history
          const historicalContext = {
            id: existingLead.id,
            lead_code: existingLead.lead_code,
            customer_name: existingLead.customer_name,
            exit_reason: existingLead.exit_reason,
            exited_from_status: existingLead.exited_from_status,
            budget_min: existingLead.budget_min,
            budget_max: existingLead.budget_max,
            preferred_location: existingLead.preferred_location,
            property_type_preference: existingLead.property_type_preference,
            previous_owner: existingLead.assigned_to?.full_name || 'Unassigned',
            previous_site_visit: existingLead.site_visits?.[0] ? {
              property_title: existingLead.site_visits[0].property?.title,
              property_status: existingLead.site_visits[0].property?.status
            } : null
          };

          // We stringify the JSON payload in the message so the frontend can parse it.
          // Or we can throw a custom object. AppError only takes string message.
          // In express error handler, if message is JSON parseable, it can be passed as JSON.
          throw new AppError(409, JSON.stringify({
            code: 'RECOVERABLE_LEAD',
            message: `Lead ${existingLead.lead_code} previously existed and was ${existingLead.status}.`,
            existingLead: historicalContext
          }));
        }
      }
    }

    const leadCode = await generateNextLeadCode();
    
    const isChannelPartner = !isPublicSubmission && user.roles.includes(Roles.CHANNEL_PARTNER_MANAGER);
    let assignedToId = null;
    let assignmentType = null;
    let status = 'NEW';
    let ownershipType = isPublicSubmission ? 'POOL' : (dto.ownership_type || 'POOL');
    let bestAssignee: any = null;

    if (isChannelPartner) {
      // Phase-19 audit #9: a CPM lead traces back to an external agent who
      // works for the partner company, not an internal employee -- capture
      // that contact so the lead's origin isn't just "some phone number".
      if (!dto.external_agent_name || !dto.external_agent_phone || !dto.external_agent_associate_id) {
        throw new AppError(400, 'External agent name, phone, and associate ID are required for Channel Partner leads.');
      }
    }

    if (!isPublicSubmission && (ownershipType === 'DIRECT' || isChannelPartner)) {
      assignedToId = user.employeeId;
      assignmentType = 'MANUAL_OVERRIDE';
      status = 'ASSIGNED';
      ownershipType = 'DIRECT';
    } else {
      // POOL: "Add to Pool" — immediately run the same performance-weighted
      // distribution used by bulk-upload and lead-recovery (see
      // utils/distributionService.ts), rather than leaving the lead for a
      // human to notice on the distribution-monitor dashboard. `bestAssignee`
      // was already threaded through to the activity/notification writes
      // below but was never actually populated — this was the missing wire.
      ownershipType = 'POOL';
      bestAssignee = await findBestAssigneeForLead(user.companyId);
      if (bestAssignee) {
        assignedToId = bestAssignee.employeeId;
        assignmentType = 'PERFORMANCE_WEIGHTED';
        status = 'ASSIGNED';
      }
    }

    // 2. DETERMINISTIC LEAD SCORING
    const leadScore = calculateLeadScore(dto);

    // 3. SLA BREACH CONFIGURATION (e.g. 2 hours from creation to first contact)
    const slaBreachAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // 4. REFERRAL ATTRIBUTION
    let validReferralEmployeeId = null;
    if (dto.source === 'REFERRAL' && dto.referral_employee_id) {
      const refEmp = await p.employee.findFirst({
        where: { id: dto.referral_employee_id, }
      });
      if (!refEmp) {
        throw new AppError(400, 'Invalid or cross-company referral employee.');
      }
      validReferralEmployeeId = refEmp.id;
    }

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      const lead = await tx.lead.create({
        data: {
          lead_code: leadCode,
          company_id: user.companyId,
          branch_id: user.branchId || null,
          customer_name: dto.customer_name,
          phone: dto.phone,
          email: dto.email || null,
          source: dto.source || 'MANUAL_ENTRY',
          status: status,
          assigned_to_id: assignedToId,
          assigned_at: assignedToId ? new Date() : null,
          assignment_type: assignmentType,
          property_type_preference: dto.property_type_preference || null,
          budget_min: dto.budget_min || null,
          budget_max: dto.budget_max || null,
          // Full multi-location list (§ Phase 2): when preferred_locations[] is
          // provided, its first entry becomes the primary scalar; otherwise
          // fall back to the legacy single preferred_location field.
          preferred_location: (dto.preferred_locations && dto.preferred_locations[0]) || dto.preferred_location || null,
          notes: dto.notes || null,
          enquiry_type: dto.enquiry_type || null,
          preferred_contact_time: dto.preferred_contact_time || null,
          property_ids: dto.property_ids || undefined,
          project_id: dto.project_id || null,
          created_by_id: isPublicSubmission ? null : user.employeeId,
          ownership_type: ownershipType,
          introduced_by_id: dto.introduced_by_id || null,
          campaign: dto.campaign || null,
          utm_source: dto.utm_source || null,
          utm_medium: dto.utm_medium || null,
          utm_campaign: dto.utm_campaign || null,
          lead_score: leadScore,
          sla_breach_at: slaBreachAt,
          referral_person_name: dto.source === 'REFERRAL' ? (dto.referral_person_name || null) : null,
          referral_employee_id: validReferralEmployeeId,
          external_agent_name: isChannelPartner ? dto.external_agent_name : null,
          external_agent_phone: isChannelPartner ? dto.external_agent_phone : null,
          external_agent_associate_id: isChannelPartner ? dto.external_agent_associate_id : null,
          external_agent_company: isChannelPartner ? (dto.external_agent_company || null) : null,
        },
      });

      if (dto.preferred_locations && dto.preferred_locations.length > 0) {
        await syncLeadPreferredLocations(tx, lead.id, dto.preferred_locations);
      }

      await tx.leadActivity.create({
        data: {
          lead_id: lead.id,
          actor_id: user.employeeId,
          activity_type: 'LEAD_CREATED',
          notes: `Lead ${lead.lead_code} registered via ${lead.source}`,
        },
      });

      if (bestAssignee) {
        await tx.leadActivity.create({
          data: {
            lead_id: lead.id,
            actor_id: user.employeeId,
            activity_type: 'ASSIGNED_TO_AGENT',
            notes: `Auto-distributed to ${bestAssignee.name} (${bestAssignee.employeeCode}) [Weight Score: ${bestAssignee.weight.toFixed(1)}]`,
          },
        });

        await tx.notification.create({
          data: {
            employee_id: bestAssignee.employeeId,
            type: 'TARGET_ASSIGNED',
            title: 'New Lead Auto-Assigned',
            message: `New Lead ${lead.customer_name} (${lead.phone}) has been assigned to you.`,
          },
        });
      }

      return { lead, assignedTo: bestAssignee };
    });
  }
