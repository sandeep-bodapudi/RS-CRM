const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const roleName = 'Channel partner manager';
  const role = await p.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName, is_system: false, is_invisible: false },
  });
  console.log('role:', JSON.stringify(role));

  // Mirror seed.ts's RolePermissionsMatrix for this role exactly.
  const permNames = [
    'leads.create', 'leads.read', 'leads.update',
    'customers.read', 'customers.update',
    'site_visits.create', 'site_visits.read', 'site_visits.complete',
    'projects.read', 'properties.read',
    'reports.read_own', 'attendance.read_own', 'attendance.scan',
    'performance.read_own', 'tasks.read', 'tasks.update',
  ];
  let created = 0;
  for (const permName of permNames) {
    const perm = await p.permission.findUnique({ where: { name: permName } });
    if (!perm) { console.warn('permission not found:', permName); continue; }
    const existing = await p.rolePermission.findFirst({ where: { role_id: role.id, permission_id: perm.id } });
    if (!existing) {
      await p.rolePermission.create({ data: { role_id: role.id, permission_id: perm.id } });
      created++;
    }
  }
  console.log('RolePermission rows created:', created);
  await p.$disconnect();
})();
