"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyEmployee = void 0;
const logger_1 = require("./logger");
/**
 * notifyEmployee.ts
 *
 * Universal notification dispatcher. Call this from any route whenever
 * an employee's data changes or an action requires their attention.
 *
 * Simultaneously:
 *  1. Saves an in-app Notification record to the DB
 *  2. Sends a Web Push notification to all subscribed devices
 */
const prisma_1 = require("../lib/prisma");
const web_push_1 = __importDefault(require("web-push"));
const p = prisma_1.prisma;
// VAPID keys — generate once with: npx web-push generate-vapid-keys
// Then put them in your .env file
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@radharealhomes.com';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
        web_push_1.default.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
    }
    catch (err) {
        if (process.env.NODE_ENV !== 'test') {
            throw err; // Fail strictly in production
        }
        // In test environment, ignore invalid VAPID keys gracefully
        logger_1.logger.warn('[WebPush] Invalid VAPID credentials skipped in test environment.');
    }
}
/**
 * Notify one or more employees by their DB IDs.
 */
async function notifyEmployee(employeeIds, payload, options) {
    const ids = Array.isArray(employeeIds) ? employeeIds : [employeeIds];
    for (const employeeId of ids) {
        // 1. Create in-app notification record (unless skipped — already done in transaction)
        if (!options?.skipDbNotification) {
            try {
                await p.notification.create({
                    data: {
                        employee_id: employeeId,
                        type: payload.type,
                        title: payload.title,
                        message: payload.message,
                        is_read: false,
                    },
                });
            }
            catch (err) {
                logger_1.logger.error(`[NotifyEmployee] Failed to create in-app notification for employee ${employeeId}:`, err);
            }
        }
        // 2. Send Web Push to all subscribed devices
        try {
            const subscriptions = await p.pushSubscription.findMany({
                where: { employee_id: employeeId },
            });
            if (subscriptions.length > 0 && VAPID_PUBLIC && VAPID_PRIVATE) {
                const pushPayload = JSON.stringify({
                    title: payload.title,
                    body: payload.message,
                    link: payload.link || '/',
                    icon: '/logo.svg',
                    badge: '/logo.svg',
                });
                for (const sub of subscriptions) {
                    try {
                        await web_push_1.default.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, pushPayload);
                    }
                    catch (pushErr) {
                        // 410 Gone = subscription expired, clean it up
                        if (pushErr.statusCode === 410) {
                            await p.pushSubscription.delete({ where: { id: sub.id } }).catch(() => { });
                        }
                        else {
                            logger_1.logger.error(`[WebPush] Failed for subscription ${sub.id}:`, pushErr.message);
                        }
                    }
                }
            }
        }
        catch (err) {
            logger_1.logger.error(`[NotifyEmployee] Push subscription fetch failed for employee ${employeeId}:`, err);
        }
    }
}
exports.notifyEmployee = notifyEmployee;
