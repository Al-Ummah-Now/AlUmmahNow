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
 * device that already got it. Instead, devices whose provider answered with a
 * transient failure (429, 5xx, network) are returned in `retry`; the caller
 * queues a delayed PushDispatch for just those installs (`devices`), and after
 * PUSH_RETRY_DELAYS_SECONDS runs out sends it to the DLQ, which flags it on the
 * admin Errors page with Replay (messageProcessor.processPushDispatch).
 */
import {
  MessageType,
  NOTIFICATION_KEY_CATEGORY,
  PUSH_DISPATCH_BATCH,
  type NotificationKey,
  type NotificationParams,
  type PushDispatchPayload,
  type PushRetryDevice,
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
  /** Devices that failed transiently: queue a retry for them. */
  retry: PushRetryDevice[];
  /** The last transient error per provider (for the retry's DLQ reason). */
  retryErrors: Partial<Record<PushProviderName, string>>;
}

const COLUMNS = 'install_id, user_id, app, platform, provider, token, locale, categories';
const appFilter = `app IN (${NOTIFICATION_APPS.map(() => '?').join(', ')})`;

/** The devices of the recipients, or (a retry) just the listed installs; each with its notification id. */
async function loadDevices(db: D1Database, payload: PushDispatchPayload): Promise<Array<{ row: DeviceRow; notificationId: string }>> {
  if (payload.devices?.length) {
    const wanted = payload.devices.slice(0, PUSH_DISPATCH_BATCH);
    const notificationFor = new Map(wanted.map((d) => [d.installId, d.notificationId]));
    const ids = [...notificationFor.keys()];
    const { results } = await db
      .prepare(`SELECT ${COLUMNS} FROM push_devices WHERE install_id IN (${ids.map(() => '?').join(', ')}) AND ${appFilter}`)
      .bind(...ids, ...NOTIFICATION_APPS)
      .all<DeviceRow>();
    return (results || []).map((row) => ({ row, notificationId: notificationFor.get(row.install_id)! }));
  }
  const recipients = payload.recipients.slice(0, PUSH_DISPATCH_BATCH);
  if (recipients.length === 0) return [];
  const notificationFor = new Map(recipients.map((r) => [r.userId, r.notificationId]));
  const userIds = [...notificationFor.keys()];
  const { results } = await db
    // Per app (#1264): the staff Admin app gets review alerts only
    .prepare(`SELECT ${COLUMNS} FROM push_devices WHERE user_id IN (${userIds.map(() => '?').join(', ')}) AND ${appFilter}`)
    .bind(...userIds, ...NOTIFICATION_APPS)
    .all<DeviceRow>();
  return (results || []).map((row) => ({ row, notificationId: notificationFor.get(row.user_id)! }));
}

export async function dispatchPush(db: D1Database, payload: PushDispatchPayload, providers: PushProviders): Promise<DispatchSummary> {
  const summary: DispatchSummary = { devices: 0, sent: 0, skipped: 0, failed: 0, pruned: 0, retry: [], retryErrors: {} };
  const category = NOTIFICATION_KEY_CATEGORY[payload.notificationKey];
  const devices = await loadDevices(db, payload);
  summary.devices = devices.length;
  if (devices.length === 0) return summary;

  const invalid: DeviceRow[] = [];
  await Promise.all(
    devices.map(async ({ row, notificationId }) => {
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
          notificationId,
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
        else {
          if (result.retryable) {
            summary.retry.push({ installId: row.install_id, notificationId });
            summary.retryErrors[row.provider] = result.error;
          }
          logger.warn('Push send failed', { provider: row.provider, installId: row.install_id, retryable: !!result.retryable, error: result.error });
        }
      } catch (error) {
        // A network failure (or a bug) reaching the push service: worth another try
        summary.failed++;
        summary.retry.push({ installId: row.install_id, notificationId });
        summary.retryErrors[row.provider] = String(error).slice(0, 200);
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
