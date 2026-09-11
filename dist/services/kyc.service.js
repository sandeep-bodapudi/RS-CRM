"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KycService = exports.KYC_EVENT_TYPE = exports.AppError = void 0;
const prisma_1 = require("../lib/prisma");
const kyc_policy_1 = require("../policies/kyc.policy");
const crypto_1 = require("../utils/crypto");
const p = prisma_1.prisma;
class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
/** KYC outbox event type consumed by portalWorker (delivered to the portal). */
exports.KYC_EVENT_TYPE = 'CUSTOMER_KYC_STATUS_CHANGED';
/**
 * Phase 11 Packet 3C - Customer KYC service.
 *
 * - CRM is the SOLE KYC verification authority.
 * - Raw PAN/Aadhaar are encrypted at rest (AES-256-GCM via encryptData, Phase 1.4).
 * - Only kyc_status + masked_pan ever cross the CRM → Portal boundary.
 */
class KycService {
    /**
     * Masks a raw PAN for the outbound push, e.g. ABCDE1234F -> ABCDE****F.
     * The raw value never enters the outbound payload (Packet 3C §3.4).
     */
    static maskPan(pan) {
        if (!pan)
            return null;
        if (pan.length <= 6)
            return `${pan.slice(0, 2)}****`;
        return `${pan.slice(0, 5)}****${pan.slice(-1)}`;
    }
    /**
     * CRM-internal KYC write/update path.
     * Encrypts PAN/Aadhaar, recomputes the derived kyc_status atomically, and
     * emits a CUSTOMER_KYC_STATUS_CHANGED outbox event on status change.
     */
    static async writeCustomerKyc(user, customerId, dto) {
        const customer = await p.customer.findFirst({
            where: { id: customerId, company_id: user.companyId },
        });
        if (!customer) {
            throw new AppError(404, 'Customer not found or access denied');
        }
        if (!kyc_policy_1.KycPolicy.canWrite(user, customer)) {
            throw new AppError(403, 'Forbidden: Cannot write customer KYC');
        }
        const encryptedPan = dto.pan_number !== undefined ? (0, crypto_1.encryptData)(dto.pan_number) : undefined;
        const encryptedAadhaar = dto.aadhaar_number !== undefined ? (0, crypto_1.encryptData)(dto.aadhaar_number) : undefined;
        return await p.$transaction(async (tx) => {
            await tx.customer.update({
                where: { id: customerId },
                data: {
                    pan_number: encryptedPan !== undefined ? encryptedPan : customer.pan_number,
                    aadhaar_number: encryptedAadhaar !== undefined ? encryptedAadhaar : customer.aadhaar_number,
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
                        aadhaar: encryptedAadhaar !== undefined ? !!encryptedAadhaar : !!customer.aadhaar_number,
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
    static async recomputeAndNotifyTx(tx, customerId, companyId, actorId) {
        const cust = await tx.customer.findUnique({ where: { id: customerId } });
        if (!cust)
            return null;
        let newStatus = cust.kyc_status;
        // Simple logic: If either is present and status is not VERIFIED, it becomes PARTIAL.
        if ((cust.pan_number || cust.aadhaar_number) && cust.kyc_status !== 'VERIFIED') {
            newStatus = 'PARTIAL';
        }
        if (newStatus !== cust.kyc_status) {
            await tx.customer.update({
                where: { id: customerId },
                data: { kyc_status: newStatus }
            });
            cust.kyc_status = newStatus;
        }
        const maskedPan = this.maskPan(cust.pan_number ? (0, crypto_1.decryptData)(cust.pan_number) : null);
        await tx.integrationEvent.create({
            data: {
                event_type: exports.KYC_EVENT_TYPE,
                crms_customer_id: customerId,
                company_id: companyId,
                payload: JSON.stringify({
                    event_type: exports.KYC_EVENT_TYPE,
                    company_id: companyId,
                    crms_customer_id: customerId,
                    kyc_status: newStatus,
                    masked_pan: maskedPan
                }),
                status: 'CREATED'
            }
        });
        return cust;
    }
}
exports.KycService = KycService;
