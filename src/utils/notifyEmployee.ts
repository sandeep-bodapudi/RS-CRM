import { logger } from './logger';
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

import { prisma } from '../lib/prisma';
import webpush from 'web-push';

const p = prisma;

// VAPID keys — generate once with: npx web-push generate-vapid-keys
// Then put them in your .env file
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL        || 'mailto:admin@radharealhomes.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      throw err; // Fail strictly in production
    }
    // In test environment, ignore invalid VAPID keys gracefully
    logger.warn('[WebPush] Invalid VAPID credentials skipped in test environment.');
  }
}

export interface NotifyPayload {
  type: string;      // e.g. 'EXPENSE_REFUND_APPROVED', 'SALARY_CHANGED'
  title: string;
  message: string;
  link?: string;     // Optional deep-link for when user taps notification
}

export interface NotifyOptions {
  /** When true, skips the DB notification create (already created in a transaction). */
  skipDbNotification?: boolean;
}

/**
 * Notify one or more employees by their DB IDs.
 */
export async function notifyEmployee(
  employeeIds: number | number[],
  payload: NotifyPayload,
  options?: NotifyOptions
): Promise<void> {
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
      } catch (err) {
        logger.error(`[NotifyEmployee] Failed to create in-app notification for employee ${employeeId}:`, err);
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
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              pushPayload
            );
          } catch (pushErr: any) {
            // 410 Gone = subscription expired, clean it up
            if (pushErr.statusCode === 410) {
              await p.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            } else {
              logger.error(`[WebPush] Failed for subscription ${sub.id}:`, pushErr.message);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`[NotifyEmployee] Push subscription fetch failed for employee ${employeeId}:`, err);
    }
  }
}
