import { prisma } from '../lib/prisma';
import { TokenPayload } from '../utils/jwt';
import { KycPolicy } from '../policies/kyc.policy';
import { encryptData, decryptData } from '../utils/crypto';
import { KycStatus } from '../shared';

const p = prisma;

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** KYC outbox event type consumed by portalWorker (delivered to the portal). */
export const KYC_EVENT_TYPE = 'CUSTOMER_KYC_STATUS_CHANGED';

/**
 * Phase 11 Packet 3C - Customer KYC service.
 *
 * - CRM is the SOLE KYC verification authority.
 * - Raw PAN/Aadhaar are encrypted at rest (AES-256-GCM via encryptData, Phase 1.4).
 * - Only kyc_status + masked_pan ever cross the CRM → Portal boundary.
 */
export class KycService {
  /**
   * Masks a raw PAN for the outbound push, e.g. ABCDE1234F -> ABCDE****F.
   * The raw value never enters the outbound payload (Packet 3C §3.4).
   */
  static maskPan(pan: string | null | undefined): string | null {
    if (!pan) return null;
    if (pan.length <= 6) return `${pan.slice(0, 2)}****`;
    return `${pan.slice(0, 5)}****${pan.slice(-1)}`;
  }

  /**
   * CRM-internal KYC write/update path.
   * Encrypts PAN/Aadhaar, recomputes the derived kyc_status atomically, and
   * emits a CUSTOMER_KYC_STATUS_CHANGED outbox event on status change.
   */
  static async writeCustomerKyc(
    user: TokenPayload,
    customerId: number,
    dto: { pan_number?: string; aadhaar_number?: string },
  ) {
    const customer = await p.customer.findFirst({
      where: { id: customerId, company_id: user.companyId },
    });
    if (!customer) {
      throw new AppError(404, 'Customer not found or access denied');
    }
    if (!KycPolicy.canWrite(user, customer)) {
      throw new AppError(403, 'Forbidden: Cannot write customer KYC');
    }

    const encryptedPan = dto.pan_number !== undefined ? encryptData(dto.pan_number) : undefined;
    const encryptedAadhaar =
      dto.aadhaar_number !== undefined ? encryptData(dto.aadhaar_number) : undefined;

    return await p.$transaction(async (tx: import('@prisma/client').Prisma.TransactionClient) => {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          pan_number: encryptedPan !== undefined ? encryptedPan : customer.pan_number,
          aadhaar_number:
            encryptedAadhaar !== undefined ? encryptedAadhaar : customer.aadhaar_number,
        },
      });

      await tx.auditEvent.create({
        data: {
          actor_id: user.employeeId,
          action: 'CUSTOMER_KYC_WRITTEN',
          entity_type: 'Customer',
          entity_id: customerId,
          old_value: JSON.stringify({
            pan: !!customer.pan_number,
            aadhaar: !!customer.aadhaar_number,
          }),
          new_value: JSON.stringify({
            pan: encryptedPan !== undefined ? !!encryptedPan : !!customer.pan_number,
            aadhaar:
              encryptedAadhaar !== undefined ? !!encryptedAadhaar : !!customer.aadhaar_number,
          }),
        },
      });

      // Recompute derived status (values present but unverified -> PARTIAL) + emit outbox on change.
      return await this.recomputeAndNotifyTx(tx, customerId, user.companyId, user.employeeId);
    });
  }

  /**
   * KYC verification/status is owned by the customer portal and surfaces back
   * via IntegrationService.processKycCallback. The CRM no longer stores KYC
   * via the portal KYC callback (IntegrationService.processKycCallback).
   */
  static async recomputeAndNotifyTx(
    tx: any,
    customerId: number,
    companyId: number,
    actorId: number,
  ) {
    const cust = await tx.customer.findUnique({ where: { id: customerId } });
    if (!cust) return null;

    let newStatus = cust.kyc_status;

    // Simple logic: If either is present and status is not VERIFIED, it becomes PARTIAL.
    if ((cust.pan_number || cust.aadhaar_number) && cust.kyc_status !== 'VERIFIED') {
      newStatus = 'PARTIAL';
    }

    if (newStatus !== cust.kyc_status) {
      await tx.customer.update({
        where: { id: customerId },
        data: { kyc_status: newStatus },
      });
      cust.kyc_status = newStatus;
    }

    const maskedPan = this.maskPan(cust.pan_number ? decryptData(cust.pan_number) : null);

    await tx.integrationEvent.create({
      data: {
        event_type: KYC_EVENT_TYPE,
        crms_customer_id: customerId,
        company_id: companyId,
        payload: JSON.stringify({
          event_type: KYC_EVENT_TYPE,
          company_id: companyId,
          crms_customer_id: customerId,
          kyc_status: newStatus,
          masked_pan: maskedPan,
        }),
        status: 'CREATED',
      },
    });

    return cust;
  }
}
