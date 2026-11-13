/**
 * Push fan-out (Epic 9.4).
 *
 * After notifications are stored (so the user's category settings already
 * applied), enqueuePush splits the recipients into PushDispatch messages of
 * PUSH_DISPATCH_BATCH, which keeps each queue invocation bounded however
 * large a channel's audience is. dispatchPush resolves each recipient's
 * devices, skips devices narrowed to other categories, sends through the
 * provider and deletes devices whose token the provider rejected.
 *
 * Sends are not retried by throwing: a queue retry would re-send to every
 * device that already got it. Failures are counted and logged.
 */
import {
  MessageType,
  NOTIFICATION_KEY_CATEGORY,
  PUSH_DISPATCH_BATCH,
  type NotificationKey,
  type NotificationParams,
  type PushDispatchPayload,
} from '@al-ummah/shared-types';
import type { AlUmmahMessage, D1Database, QueueEnvironment } from '../types';

/**
 * Messages per sendBatch call. The limit is 100 messages and 256 KB; a
 * dispatch message of 100 recipients is ~8 KB, so 25 stay well under it.
 */
export const SEND_BATCH = 25;
import type { StoredNotification } from '../lib/notifications-store';
import { logger } from '../lib/logger';
import { NOTIFICATION_APPS, type PushApp, type PushProviderName, type PushProviders, type PushTarget } from './provider';

export async function enqueuePush(
  env: Pick<QueueEnvironment, 'MESSAGE_QUEUE'>,
  rows: StoredNotification[],
  data: { notificationKey: NotificationKey; params?: NotificationParams | undefined; actionUrl?: string | undefined },
): Promise<number> {
  if (rows.length === 0) return 0;
  if (!env.MESSAGE_QUEUE) {
    logger.warn('MESSAGE_QUEUE not bound; push skipped', { recipients: rows.length });
    return 0;
  }
  const messages: AlUmmahMessage[] = [];
  for (let i = 0; i < rows.length; i += PUSH_DISPATCH_BATCH) {
    const payload: PushDispatchPayload = {
      recipients: rows.slice(i, i + PUSH_DISPATCH_BATCH).map((r) => ({ userId: r.user_id, notificationId: r.id })),
      notificationKey: data.notificationKey,
      ...(data.params ? { params: data.params } : {}),
      ...(data.actionUrl ? { actionUrl: data.actionUrl } : {}),
    };
    messages.push({
      id: `push-${payload.recipients[0]?.notificationId ?? i}`,
      type: MessageType.PushDispatch,
      timestamp: Date.now(),
      payload: payload as unknown as Record<string, unknown>,
    });
  }
  // One subrequest per SEND_BATCH messages (SCALABILITY-AUDIT PR-7), not one per message
  const queue = env.MESSAGE_QUEUE;
  if (queue.sendBatch) {
    for (let i = 0; i < messages.length; i += SEND_BATCH) {
      await queue.sendBatch(messages.slice(i, i + SEND_BATCH).map((body) => ({ body })));
    }
  } else {
    for (const m of messages) await queue.send(m);
  }
  return messages.length;
}


interface DeviceRow {
  install_id: string;
  user_id: string;
  app: PushApp;
  platform: string;
  provider: PushProviderName;
  token: string;
  locale: string | null;
  categories: string | null;
}

/** null = every category; otherwise the device's own list. */
export function deviceWants(categories: string | null, category: string): boolean {
  if (!categories) return true;
  try {
    const list = JSON.parse(categories);
    return !Array.isArray(list) || list.includes(category);
  } catch {
    return true;
  }
}

export interface DispatchSummary {
  devices: number;
  sent: number;
  skipped: number;
  failed: number;
  pruned: number;
}

export async function dispatchPush(db: D1Database, payload: PushDispatchPayload, providers: PushProviders): Promise<DispatchSummary> {
  const summary: DispatchSummary = { devices: 0, sent: 0, skipped: 0, failed: 0, pruned: 0 };
  const recipients = payload.recipients.slice(0, PUSH_DISPATCH_BATCH);
  if (recipients.length === 0) return summary;
  const notificationFor = new Map(recipients.map((r) => [r.userId, r.notificationId]));
  const category = NOTIFICATION_KEY_CATEGORY[payload.notificationKey];

  const userIds = [...notificationFor.keys()];
  const { results } = await db
    .prepare(
      // Per app (#1264): the staff Admin app gets review alerts only
      `SELECT install_id, user_id, app, platform, provider, token, locale, categories FROM push_devices
       WHERE user_id IN (${userIds.map(() => '?').join(', ')}) AND app IN (${NOTIFICATION_APPS.map(() => '?').join(', ')})`,
    )
    .bind(...userIds, ...NOTIFICATION_APPS)
    .all<DeviceRow>();
  const devices = results || [];
  summary.devices = devices.length;

  const invalid: DeviceRow[] = [];
  await Promise.all(
    devices.map(async (row) => {
      if (!deviceWants(row.categories, category)) {
        summary.skipped++;
        return;
      }
      const target: PushTarget = {
        installId: row.install_id,
        userId: row.user_id,
        app: row.app,
        platform: row.platform,
        provider: row.provider,
        token: row.token,
        locale: row.locale,
      };
      try {
        const result = await providers[row.provider].send(target, {
          notificationId: notificationFor.get(row.user_id)!,
          notificationKey: payload.notificationKey,
          category,
          params: payload.params || {},
          ...(payload.actionUrl ? { actionUrl: payload.actionUrl } : {}),
        });
        if (result.ok) {
          summary.sent++;
          return;
        }
        summary.failed++;
        if (result.invalidToken) invalid.push(row);
        else logger.warn('Push send failed', { provider: row.provider, installId: row.install_id, error: result.error });
      } catch (error) {
        summary.failed++;
        logger.warn('Push provider threw', { provider: row.provider, installId: row.install_id, error: String(error) });
      }
    }),
  );

  if (invalid.length > 0) {
    // Match the token too: the install may have re-registered a fresh one meanwhile
    await db.batch(
      invalid.map((row) =>
        db.prepare('DELETE FROM push_devices WHERE install_id = ? AND token = ?').bind(row.install_id, row.token),
      ),
    );
    summary.pruned = invalid.length;
  }
  return summary;
}
