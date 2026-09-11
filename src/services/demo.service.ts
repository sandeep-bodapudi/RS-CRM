import { prisma } from '../../lib/prisma';
import { TokenPayload } from '../../utils/jwt';
import { AppError } from '../lead/errors';
import { notifyEmployee } from '../../utils/notifyEmployee';
import { logger } from '../../utils/logger';

const p = prisma;

export async function listDemos(user: TokenPayload, filters: { status?: string; handler_id?: string; leadId?: string }) {
  const whereCondition: any = {
    lead: { company_id: user.companyId },
  };

  if (filters.leadId) {
    whereCondition.lead_id = parseInt(filters.leadId, 10);
  }

  if (filters.status === 'PENDING') {
    whereCondition.accepted_at = null;
    whereCondition.lead.status = 'DEMO_SCHEDULED';
    // For PENDING demos (not yet accepted/declined), restrict to the handler only
    // to create a blind approval queue effect - other employees see only accepted demos.
    // Bypass this restriction when a specific leadId is requested (e.g. LeadDetailModal DEMOS tab).
    if (!filters.leadId) {
      whereCondition.handler_id = user.employeeId;
    }
  } else if (filters.status === 'ACCEPTED') {
    whereCondition.accepted_at = { not: null };
    whereCondition.lead.status = 'DEMO_SCHEDULED';
  } else if (filters.status === 'COMPLETED') {
    whereCondition.lead.status = 'DEMO_COMPLETED';
  }

  if (filters.handler_id) {
    whereCondition.handler_id = parseInt(filters.handler_id, 10);
  }

  const demos = await p.demo.findMany({
    where: whereCondition,
    include: {
      lead: {
        select: {
          id: true,
          lead_code: true,
          customer_name: true,
          phone: true,
          email: true,
          preferred_location: true,
          property_type_preference: true,
          budget_min: true,
          budget_max: true,
          assigned_to: { select: { id: true, full_name: true, employee_code: true } },
        },
      },
      handler: {
        select: { id: true, full_name: true, employee_code: true, phone: true },
      },
      interested_properties: {
        include: {
          property: { select: { id: true, property_code: true, title: true, location: true, final_price: true } },
        },
      },
    },
    orderBy: { scheduled_at: 'asc' },
  });

  // Blind approval: Hide customer PII for PENDING demos unless the viewer is the handler
  for (const demo of demos) {
    if (demo.lead && demo.handler_id !== user.employeeId) {
      delete (demo.lead as any).phone;
      delete (demo.lead as any).email;
    }
  }

  return demos;
}

export async function getDemo(user: TokenPayload, demoId: number) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: {
      lead: {
        select: {
          id: true,
          lead_code: true,
          customer_name: true,
          phone: true,
          email: true,
          preferred_location: true,
          property_type_preference: true,
          budget_min: true,
          budget_max: true,
          assigned_to: { select: { id: true, full_name: true, employee_code: true } },
        },
      },
      handler: {
        select: { id: true, full_name: true, employee_code: true, phone: true },
      },
      interested_properties: {
        include: {
          property: { select: { id: true, property_code: true, title: true, location: true, final_price: true } },
        },
      },
    },
  });

  if (!demo) throw { status: 404, message: 'Demo not found' };

  // Blind approval: Hide PII if not yet accepted and viewer isn't handler
  if (!demo.accepted_at && demo.handler_id !== user.employeeId) {
    delete (demo.lead as any).phone;
    delete (demo.lead as any).email;
  }

  return demo;
}

export async function acceptDemo(user: TokenPayload, demoId: number, notes?: string) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: { lead: true, handler: true },
  });
  if (!demo) throw { status: 404, message: 'Demo not found' };
  if (demo.accepted_at) throw { status: 409, message: 'Demo already accepted' };

  // Only the assigned handler or MD/Admin can accept
  if (demo.handler_id !== user.employeeId && !['MD', 'ADMIN'].includes(user.role)) {
    throw { status: 403, message: 'Only the assigned demo handler can accept this demo' };
  }

  const updated = await p.demo.update({
    where: { id: demoId },
    data: {
      accepted_at: new Date(),
      accepted_by: user.employeeId,
    },
    include: {
      lead: { select: { id: true, lead_code: true, customer_name: true } },
      handler: { select: { id: true, full_name: true } },
    },
  });

  // Notify the handler that their demo was accepted (self-acceptance already knows)
  await p.notification.create({
    data: {
      employee_id: demo.handler_id,
      type: 'DEMO_ACCEPTED',
      title: `Demo Accepted: ${demo.lead.customer_name}`,
      message: `Your demo for ${demo.lead.customer_name} (${demo.lead.lead_code}) is confirmed for ${new Date(demo.scheduled_at).toLocaleString()}.`,
    },
  });

  // Web push to handler
  notifyEmployee(demo.handler_id, {
    type: 'DEMO_ACCEPTED',
    title: `Demo Confirmed: ${demo.lead.customer_name}`,
    message: `Your demo is confirmed for ${new Date(demo.scheduled_at).toLocaleString()}. See details in the app.`,
  }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Demo accept:', err));

  // Notify telecaller that demo was accepted
  await p.notification.create({
    data: {
      employee_id: demo.lead.assigned_to_id || demo.lead.created_by_id || 1,
      type: 'SYSTEM_ALERT',
      title: `Demo Accepted: ${demo.lead.customer_name}`,
      message: `The demo handler has accepted the demo for ${demo.lead.customer_name}.`,
    },
  });

  return updated;
}

export async function declineDemo(user: TokenPayload, demoId: number, notes?: string) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: { lead: true, handler: true },
  });
  if (!demo) throw { status: 404, message: 'Demo not found' };
  if (demo.accepted_at) throw { status: 409, message: 'Demo already accepted' };

  if (demo.handler_id !== user.employeeId && !['MD', 'ADMIN'].includes(user.role)) {
    throw { status: 403, message: 'Only the assigned demo handler can decline this demo' };
  }

  const updated = await p.demo.update({
    where: { id: demoId },
    data: { status: 'DECLINED' },
    include: {
      lead: { select: { id: true, lead_code: true, customer_name: true } },
      handler: { select: { id: true, full_name: true } },
    },
  });

  await p.notification.create({
    data: {
      employee_id: demo.lead.assigned_to_id || demo.lead.created_by_id || 1,
      type: 'SYSTEM_ALERT',
      title: `Demo Declined: ${demo.lead.customer_name}`,
      message: `The demo for ${demo.lead.customer_name} was declined by the handler. ${notes ? 'Reason: ' + notes : ''}`,
    },
  });

  return updated;
}

export async function completeDemo(user: TokenPayload, demoId: number, notes?: string) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: { lead: true, handler: true },
  });
  if (!demo) throw { status: 404, message: 'Demo not found' };
  
  if (demo.handler_id !== user.employeeId && !['MD', 'ADMIN'].includes(user.role)) {
    throw { status: 403, message: 'Only the assigned demo handler can complete this demo' };
  }

  // Update lead status to DEMO_COMPLETED
  await p.lead.update({
    where: { id: demo.lead_id },
    data: { status: 'DEMO_COMPLETED' }
  });

  // Add notes to timeline
  await p.leadActivity.create({
    data: {
      lead_id: demo.lead_id,
      employee_id: user.employeeId,
      activity_type: 'DEMO_COMPLETED',
      notes: notes || 'Demo completed successfully.',
    }
  });

  return demo;
}

export async function cancelDemo(user: TokenPayload, demoId: number, notes?: string) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: { lead: true, handler: true },
  });
  if (!demo) throw { status: 404, message: 'Demo not found' };

  if (demo.handler_id !== user.employeeId && !['MD', 'ADMIN'].includes(user.role)) {
    throw { status: 403, message: 'Only the assigned demo handler can cancel this demo' };
  }

  // Delete the demo record
  await p.demo.delete({
    where: { id: demoId }
  });

  // Revert Lead status to QUALIFIED
  await p.lead.update({
    where: { id: demo.lead_id },
    data: { status: 'QUALIFIED' }
  });

  // Add notes to timeline
  await p.leadActivity.create({
    data: {
      lead_id: demo.lead_id,
      employee_id: user.employeeId,
      activity_type: 'STATUS_CHANGED',
      notes: `Demo cancelled by handler. ${notes ? 'Reason: ' + notes : ''}`,
    }
  });

  // Notify telecaller
  await p.notification.create({
    data: {
      employee_id: demo.lead.assigned_to_id || demo.lead.created_by_id || 1,
      type: 'SYSTEM_ALERT',
      title: `Demo Cancelled: ${demo.lead.customer_name}`,
      message: `The demo for ${demo.lead.customer_name} was cancelled by the handler.`,
    },
  });

  return demo;
}

// reassignDemo: route a PENDING demo to a different handler
export async function reassignDemo(user: TokenPayload, demoId: number, newHandlerId: number, reason?: string) {
  const demo = await p.demo.findFirst({
    where: { id: demoId, lead: { company_id: user.companyId } },
    include: { lead: true, handler: true },
  });
  if (!demo) throw { status: 404, message: 'Demo not found' };
  if (demo.status !== 'PENDING') throw { status: 409, message: 'Can only reassign PENDING demos' };

  const newHandler = await p.employee.findFirst({
    where: { id: newHandlerId, company_id: user.companyId },
  });
  if (!newHandler) throw { status: 404, message: 'Target handler not found' };

  // Update the demo handler
  await p.demo.update({
    where: { id: demoId },
    data: {
      handler_id: newHandlerId,
      status: 'PENDING', // stays pending for new handler
    },
  });

  // Activity log
  await p.leadActivity.create({
    data: {
      lead_id: demo.lead_id,
      employee_id: user.employeeId,
      activity_type: 'DEMO_REASSIGNED',
      notes: reason ? `Demo reassigned from ${demo.handler?.full_name || 'unknown'} to ${newHandler.full_name}. Reason: ${reason}` : `Demo reassigned from ${demo.handler?.full_name || 'unknown'} to ${newHandler.full_name}.`,
    },
  });

  // Notify new handler
  await p.notification.create({
    data: {
      employee_id: newHandlerId,
      type: 'DEMO_ASSIGNED',
      title: `Demo Assigned to You: ${demo.lead.customer_name}`,
      message: `A demo for ${demo.lead.customer_name} (${demo.lead.lead_code}) has been routed to you. Scheduled: ${new Date(demo.scheduled_at).toLocaleString()}.`,
    },
  });

  // Notify old handler
  if (demo.handler_id && demo.handler_id !== newHandlerId) {
    await p.notification.create({
      data: {
        employee_id: demo.handler_id,
        type: 'SYSTEM_ALERT',
        title: `Demo Reassigned: ${demo.lead.customer_name}`,
        message: `Your demo for ${demo.lead.customer_name} has been reassigned to ${newHandler.full_name}.`,
      },
    });
    // Web push to old handler
    notifyEmployee(demo.handler_id, {
      type: 'SYSTEM_ALERT',
      title: `Demo Reassigned: ${demo.lead.customer_name}`,
      message: `Your demo has been reassigned to ${newHandler.full_name}.`,
    }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Demo reassign old:', err));
  }

  // Web push to new handler
  notifyEmployee(newHandlerId, {
    type: 'DEMO_ASSIGNED',
    title: `Demo Assigned to You: ${demo.lead.customer_name}`,
    message: `A demo for ${demo.lead.customer_name} (${demo.lead.lead_code}) has been routed to you.`,
  }, { skipDbNotification: true }).catch(err => logger.error('[WebPush] Demo reassign new:', err));

  return await p.demo.findFirst({
    where: { id: demoId },
    include: { lead: true, handler: true },
  });
}

