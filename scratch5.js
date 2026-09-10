const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

async function run() {
  const employee_code = 'RRH-TST-004';
  const password = 'password123';
  try {
    const employee = await prisma.employee.findUnique({
      where: { employee_code },
      include: {
        company: true,
        branch: true,
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } }
            },
          },
        },
        permission_overrides: { include: { permission: true } },
      },
    });

    if (!employee || employee.status !== 'ACTIVE') {
      console.log('Invalid/Inactive');
      return;
    }

    const roleNames = employee.roles.map(r => r.role.name);
    const permissionsSet = new Set();
    employee.roles.forEach(r => {
      if (r.role.permissions) {
        r.role.permissions.forEach(rp => permissionsSet.add(rp.permission.name));
      }
    });
    if (employee.permission_overrides) {
      employee.permission_overrides.forEach(po => {
        if (po.is_granted) permissionsSet.add(po.permission.name);
        else permissionsSet.delete(po.permission.name);
      });
    }
    const permissions = Array.from(permissionsSet);

    const tokenPayload = {
      employeeId: employee.id,
      employeeCode: employee.employee_code,
      companyId: employee.company_id,
      branchId: employee.branch_id,
      roles: roleNames,
      permissions,
      tokenVersion: employee.token_version,
    };

    console.log('Payload generated successfully:', Object.keys(tokenPayload));
    
  } catch (e) {
    console.error('ERROR OCCURRED:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
