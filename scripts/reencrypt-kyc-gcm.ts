import { PrismaClient } from '@prisma/client';
import { decryptData, encryptData } from '../src/utils/crypto';

// Phase 1.4 (2026-09-06): one-time re-encryption pass for KYC/bank fields
// that were written under the old AES-256-CBC scheme (or, due to the
// employees.ts update-route bug fixed in the same task, sometimes written as
// plain, unencrypted text). crypto.ts's decryptData() already reads all three
// shapes transparently (current AES-256-GCM, legacy AES-256-CBC, and
// plaintext-shaped values), so this script is safe to run repeatedly and
// safe to interrupt partway through — rows already in the new format are
// left untouched, and every write is decrypt-old-then-encrypt-new, never a
// blind overwrite.
//
// Usage:
//   npx ts-node apps/api/scripts/reencrypt-kyc-gcm.ts --dry-run
//   CONFIRM_REENCRYPT=yes-reencrypt npx ts-node apps/api/scripts/reencrypt-kyc-gcm.ts
//
// Per docs/PENDING-PRODUCTION-CHANGES.md, this has only been run (as of
// 2026-09-06) against the local test_db — DATABASE_URL must be pointed at
// whichever database you intend to migrate; there is no test/prod guard
// baked into this script beyond the one below, because it is meant to run
// against production eventually too (deliberately, after the full
// implementation plan is signed off — see that file).

const isDryRun = process.argv.includes('--dry-run');

const EMPLOYEE_KYC_FIELDS = [
  'pan_number',
  'aadhaar_number',
  'bank_name',
  'bank_account_number',
  'bank_ifsc',
  'bank_branch',
] as const;

const CUSTOMER_KYC_FIELDS = ['pan_number', 'aadhaar_number'] as const;

// A value already in the current GCM format has exactly 3 ':'-separated
// parts (iv:authTag:ciphertext). Skip those — nothing to do.
function isAlreadyGcm(value: string): boolean {
  return value.split(':').length === 3;
}

async function main() {
  if (!isDryRun && process.env.CONFIRM_REENCRYPT !== 'yes-reencrypt') {
    console.error(
      'ABORT: Refusing to write without explicit confirmation.\n' +
        'Re-run with --dry-run to preview what would change, or set\n' +
        'CONFIRM_REENCRYPT=yes-reencrypt to actually re-encrypt rows.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let migrated = 0;
  let alreadyCurrent = 0;
  let failed = 0;

  try {
    const dbNameRows: any[] = await prisma.$queryRawUnsafe('SELECT DATABASE() as db');
    console.log(`Connected to database "${dbNameRows?.[0]?.db}". Dry run: ${isDryRun}`);

    // --- Employees ---
    const employees = await prisma.employee.findMany({
      select: { id: true, employee_code: true, ...Object.fromEntries(EMPLOYEE_KYC_FIELDS.map((f) => [f, true])) },
    });

    for (const emp of employees) {
      const update: Record<string, string> = {};
      for (const field of EMPLOYEE_KYC_FIELDS) {
        const raw = (emp as any)[field] as string | null;
        if (!raw) continue;
        if (isAlreadyGcm(raw)) {
          alreadyCurrent++;
          continue;
        }
        const plain = decryptData(raw);
        if (plain === null) {
          console.warn(`  ! Employee ${emp.employee_code} field ${field}: could not decrypt, left untouched.`);
          failed++;
          continue;
        }
        update[field] = encryptData(plain)!;
      }
      if (Object.keys(update).length > 0) {
        migrated += Object.keys(update).length;
        console.log(`  Employee ${emp.employee_code}: re-encrypting ${Object.keys(update).join(', ')}`);
        if (!isDryRun) {
          await prisma.employee.update({ where: { id: emp.id }, data: update });
        }
      }
    }

    // --- Customers ---
    const customers = await prisma.customer.findMany({
      select: { id: true, ...Object.fromEntries(CUSTOMER_KYC_FIELDS.map((f) => [f, true])) },
    });

    for (const cust of customers) {
      const update: Record<string, string> = {};
      for (const field of CUSTOMER_KYC_FIELDS) {
        const raw = (cust as any)[field] as string | null;
        if (!raw) continue;
        if (isAlreadyGcm(raw)) {
          alreadyCurrent++;
          continue;
        }
        const plain = decryptData(raw);
        if (plain === null) {
          console.warn(`  ! Customer ${cust.id} field ${field}: could not decrypt, left untouched.`);
          failed++;
          continue;
        }
        update[field] = encryptData(plain)!;
      }
      if (Object.keys(update).length > 0) {
        migrated += Object.keys(update).length;
        console.log(`  Customer ${cust.id}: re-encrypting ${Object.keys(update).join(', ')}`);
        if (!isDryRun) {
          await prisma.customer.update({ where: { id: cust.id }, data: update });
        }
      }
    }

    console.log(
      `\nDone. Fields re-encrypted: ${migrated}. Already on GCM: ${alreadyCurrent}. Failed to decrypt (left untouched): ${failed}.` +
        (isDryRun ? '\n(dry run — no writes were made)' : ''),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
