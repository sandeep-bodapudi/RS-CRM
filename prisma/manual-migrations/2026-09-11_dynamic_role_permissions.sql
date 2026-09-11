-- Dynamic Role-Permission assignments
-- Seeds the role_permission join table from the hardcoded RolePermissionsMatrix
-- so that permissions become editable from the AdminSuperHub → Permissions tab
-- without code changes. After running this migration, any role/permission pair
-- not present in the table defaults to the hardcoded matrix behaviour.

-- Clear existing (idempotent)
DELETE FROM role_permission;

-- Helper: resolve role_id and permission_id, insert if missing
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE
  -- MD = ALL_PERMISSIONS
  (r.name = 'Managing director' AND p.name IN (
    'employees.create','employees.read','employees.update','employees.delete',
    'employees.view_sensitive','employees.manage_default:all','employees.reset_password',
    'leads.create','leads.read','leads.update','leads.delete','leads.assign',
    'leads.bulk_upload','leads.distribution_monitor','leads.whatsapp_proposal',
    'customers.create','customers.read','customers.update','customers.delete',
    'customers.convert','customers.kyc_write',
    'properties.create','properties.read','properties.update','properties.delete',
    'properties.verify','properties.dm_polish','properties.md_approve',
    'site_visits.create','site_visits.read','site_visits.verify',
    'site_visits.assign_agent','site_visits.complete',
    'projects.create','projects.read','projects.update','projects.delete',
    'projects.submit_verify','projects.verify',
    'bookings.create','bookings.read','bookings.update','bookings.cancel','bookings.confirm',
    'payments.create','payments.read','payments.update','payments.cancel',
    'tasks.create','tasks.read','tasks.update','tasks.assign',
    'attendance.read_own','attendance.scan','attendance.late_proposal',
    'attendance.leave_proposal','attendance.proposals_queue','attendance.live_monitor',
    'reports.create','reports.read_own','reports.read_team','reports.targets.configure',
    'performance.read_own','performance.read_team','performance.history',
    'expenses.create','expenses.read_own','expenses.review','expenses.md_approve',
    'expenses.mark_refunded',
    'admin.system_metrics','admin.audit_logs','admin.security_alerts',
    'admin.emergency_lockdown','message_templates.manage',
    'public.properties.read','public.leads.create','ai.search',
    'documents.create','documents.read','documents.verify','documents.delete',
    'complaints.create','complaints.read','complaints.update','complaints.assign',
    'complaints.resolve','complaints.close'
  ))
  OR
  -- Admin = ALL_PERMISSIONS (matching MD)
  (r.name = 'Admin (Technical)' AND p.name IN (
    'employees.create','employees.read','employees.update','employees.delete',
    'employees.view_sensitive','employees.manage_default:all','employees.reset_password',
    'leads.create','leads.read','leads.update','leads.delete','leads.assign',
    'leads.bulk_upload','leads.distribution_monitor','leads.whatsapp_proposal',
    'customers.create','customers.read','customers.update','customers.delete',
    'customers.convert','customers.kyc_write',
    'properties.create','properties.read','properties.update','properties.delete',
    'properties.verify','properties.dm_polish','properties.md_approve',
    'site_visits.create','site_visits.read','site_visits.verify',
    'site_visits.assign_agent','site_visits.complete',
    'projects.create','projects.read','projects.update','projects.delete',
    'projects.submit_verify','projects.verify',
    'bookings.create','bookings.read','bookings.update','bookings.cancel','bookings.confirm',
    'payments.create','payments.read','payments.update','payments.cancel',
    'tasks.create','tasks.read','tasks.update','tasks.assign',
    'attendance.read_own','attendance.scan','attendance.late_proposal',
    'attendance.leave_proposal','attendance.proposals_queue','attendance.live_monitor',
    'reports.create','reports.read_own','reports.read_team','reports.targets.configure',
    'performance.read_own','performance.read_team','performance.history',
    'expenses.create','expenses.read_own','expenses.review','expenses.md_approve',
    'expenses.mark_refunded',
    'admin.system_metrics','admin.audit_logs','admin.security_alerts',
    'admin.emergency_lockdown','message_templates.manage',
    'public.properties.read','public.leads.create','ai.search',
    'documents.create','documents.read','documents.verify','documents.delete',
    'complaints.create','complaints.read','complaints.update','complaints.assign',
    'complaints.resolve','complaints.close'
  ));
