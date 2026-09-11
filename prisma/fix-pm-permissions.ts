import { PrismaClient } from '@prisma/client';
import { RolePermissionsMatrix } from '../src/shared/auth';

const prisma = new PrismaClient();

async function main() {
  console.log('Fixing permissions in the database...');

  // Ensure all permissions from auth.ts exist in the DB
  const allPermissions = new Set<string>();
  for (const role of Object.keys(RolePermissionsMatrix)) {
    const roleName = role as keyof typeof RolePermissionsMatrix;
    for (const perm of RolePermissionsMatrix[roleName]) {
      allPermissions.add(perm);
    }
  }

  for (const permName of Array.from(allPermissions)) {
    await prisma.permission.upsert({
      where: { name: permName },
      update: {},
      create: { name: permName, description: permName },
    });
  }

  // Assign permissions to roles
  for (const roleName of Object.keys(RolePermissionsMatrix)) {
    const permissions = RolePermissionsMatrix[roleName as keyof typeof RolePermissionsMatrix];

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      console.warn(`Role ${roleName} not found in DB. Skipping...`);
      continue;
    }

    // Assign all mapped permissions
    for (const permName of permissions) {
      const permission = await prisma.permission.findUnique({ where: { name: permName } });
      if (!permission) continue;

      await prisma.rolePermission.upsert({
        where: {
          role_id_permission_id: {
            role_id: role.id,
            permission_id: permission.id,
          },
        },
        update: {},
        create: {
          role_id: role.id,
          permission_id: permission.id,
        },
      });
    }
    console.log(`Updated permissions for role: ${roleName}`);
  }

  console.log('Done fixing permissions.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
