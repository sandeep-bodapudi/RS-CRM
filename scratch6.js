const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

// mock env
process.env.JWT_ACCESS_SECRET = "a81241ca7b9a06771dd442b2157fabeb632503b582a11a39929a0b53ff7b327e";
process.env.JWT_REFRESH_SECRET = "6a4c890079dc811723a3b6777d17fde9d808e38948e1ac4964e0174fa6901e95";

const generateAccessToken = (payload) => {
  const finalPayload = {
    ...payload,
    tokenVersion: payload.tokenVersion ?? 1,
  };
  return jwt.sign(finalPayload, process.env.JWT_ACCESS_SECRET, { expiresIn: '24h' });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d', jwtid: crypto.randomUUID() });
};


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

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const familyToken = crypto.randomUUID();

    await prisma.authSession.create({
      data: {
        employee_id: employee.id,
        family_token: familyToken,
        refresh_token_hash: refreshTokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    console.log('ALL SUCCESS!');
    
  } catch (e) {
    console.error('ERROR OCCURRED:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
