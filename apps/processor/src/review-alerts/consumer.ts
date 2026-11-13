/**
 * Review alerts consumer (#1265, wiki AUN-ADMIN-NATIVE "Alerts and the 5-minute target").
 *
 * Queue `al-ummah-now-review-alerts[-stage|-qa]`, batch size 1, 1 s timeout, DLQ. Review runs in
 * production only (VIDEO_REVIEW_ALLOWED), so on QA and stage nothing sends here.
 *
 *   held      → row + alert the on-call reviewers who may see it, schedule escalate 1 and 2
 *   escalate  → unless claimed or decided: step 1 every eligible reviewer, step 2 seniors + owners
 *   opened    → measured
 *   claimed   → measured; silent "clear" to every other alerted device
 *   decided   → measured; silent "clear" to every alerted device
 *
 * Pushes go only to the staff Admin app (push_devices.app = 'admin'). Nobody is pushed twice for
 * one item: each step sends to the users not alerted yet. Push failures are counted, never
 * thrown (a queue retry would alert again); a D1 failure throws so the message retries.
 */
import {
  MessageType,
  isReviewAlertPayload,
  minutesLeft,
  reviewAlertRecipients,
  reviewAlertText,
  type ReviewAlertPayload,
  type ReviewAlertReason,
  type ReviewAlertSettings,
} from '@al-ummah/shared-types';
import type { Logger } from '@al-ummah/logger';
import type { AlUmmahMessage, D1Database } from '../types';
import type { AlertPush, PushApp, PushProviderName, PushProviders, PushTarget } from '../push/provider';
import { alertedUsers, getReviewAlert, readReviewAlertSettings, recordAlertStep, recordReviewerEvent, startReviewAlert, type ReviewAlertRow } from './store';

export interface ReviewAlertQueue {
  send(message: AlUmmahMessage, options?: { delaySeconds?: number }): Promise<void>;
}

export interface ReviewAlertEnv {
  REPORTS_DB: D1Database;
  NOTIFICATIONS_DB?: D1Database;
  /** The processor's own producer: escalations are delayed messages to the same queue. */
  REVIEW_ALERTS_QUEUE?: ReviewAlertQueue;
}

/** Where the Admin app opens an item. */
export const reviewItemUrl = (reviewId: string) => `/moderation/review/${encodeURIComponent(reviewId)}`;

/** Visible alerts are worth delivering for 10 minutes; a clear for an hour (a phone may be offline). */
const ALERT_TTL_SECONDS = 600;
const CLEAR_TTL_SECONDS = 3600;

interface AdminDeviceRow {
  install_id: string;
  user_id: string;
  app: PushApp;
  platform: string;
  provider: PushProviderName;
  token: string;
  locale: string | null;
}

export interface SendSummary {
  /** Users with at least one device that took the push. */
  reached: string[];
  devices: number;
  sent: number;
  failed: number;
  pruned: number;
}

/** Pushes to every Admin app install of `userIds`; prunes tokens the provider rejected. */
export async function pushToAdminDevices(
  db: D1Database,
  providers: PushProviders,
  userIds: string[],
  build: (locale: string | null) => AlertPush,
  logger: Logger,
): Promise<SendSummary> {
  const summary: SendSummary = { reached: [], devices: 0, sent: 0, failed: 0, pruned: 0 };
  if (userIds.length === 0) return summary;
  const { results } = await db
    .prepare(
      `SELECT install_id, user_id, app, platform, provider, token, locale FROM push_devices
       WHERE user_id IN (${userIds.map(() => '?').join(', ')}) AND app = 'admin'`,
    )
    .bind(...userIds)
    .all<AdminDeviceRow>();
  const devices = results ?? [];
  summary.devices = devices.length;
  const reached = new Set<string>();
  const invalid: AdminDeviceRow[] = [];
  await Promise.all(
    devices.map(async (row) => {
      const target: PushTarget = { installId: row.install_id, userId: row.user_id, app: row.app, platform: row.platform, provider: row.provider, token: row.token, locale: row.locale };
      try {
        const result = await providers[row.provider].sendAlert(target, build(row.locale));
        if (result.ok) {
          summary.sent++;
          reached.add(row.user_id);
          return;
        }
        summary.failed++;
        if (result.invalidToken) invalid.push(row);
        else logger.warn('[ReviewAlerts] Push failed', { provider: row.provider, installId: row.install_id, error: result.error });
      } catch (error) {
        summary.failed++;
        logger.warn('[ReviewAlerts] Push provider threw', { provider: row.provider, installId: row.install_id, error: String(error) });
      }
    }),
  );
  if (invalid.length > 0) {
    await db.batch(invalid.map((row) => db.prepare('DELETE FROM push_devices WHERE install_id = ? AND token = ?').bind(row.install_id, row.token)));
    summary.pruned = invalid.length;
  }
  summary.reached = [...reached].sort();
  return summary;
}

function alertFor(row: ReviewAlertRow, now: number): (locale: string | null) => AlertPush {
  const minutes = minutesLeft(row.deadline_at, now);
  return (locale) => ({
    kind: 'alert',
    reviewId: row.review_id,
    ...reviewAlertText(row.reason as ReviewAlertReason, minutes, locale),
    actionUrl: reviewItemUrl(row.review_id),
    ttlSeconds: ALERT_TTL_SECONDS,
  });
}

const clearFor = (reviewId: string) => (): AlertPush => ({ kind: 'clear', reviewId, ttlSeconds: CLEAR_TTL_SECONDS });

export interface ReviewAlertOutcome {
  event: ReviewAlertPayload['event'];
  reviewId: string;
  status: 'sent' | 'skipped' | 'recorded';
  reason?: string;
  recipients?: number;
  summary?: SendSummary;
}

async function alertStep(env: Required<Pick<ReviewAlertEnv, 'NOTIFICATIONS_DB'>> & ReviewAlertEnv, providers: PushProviders, row: ReviewAlertRow, settings: ReviewAlertSettings, step: 0 | 1 | 2, now: number, logger: Logger) {
  const already = new Set(alertedUsers(row));
  const recipients = reviewAlertRecipients(settings, { seniorOnly: row.senior_only === 1 }, step, now).filter((u) => !already.has(u));
  const summary = await pushToAdminDevices(env.NOTIFICATIONS_DB, providers, recipients, alertFor(row, now), logger);
  await recordAlertStep(env.NOTIFICATIONS_DB, row, step, summary.reached, now);
  return { recipients: recipients.length, summary };
}

export async function handleReviewAlert(env: ReviewAlertEnv, providers: PushProviders, p: ReviewAlertPayload, logger: Logger, now = Date.now()): Promise<ReviewAlertOutcome> {
  if (!env.NOTIFICATIONS_DB) {
    logger.warn('[ReviewAlerts] NOTIFICATIONS_DB not bound; alert dropped', { reviewId: p.reviewId, event: p.event });
    return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'no_store' };
  }
  const e = env as Required<Pick<ReviewAlertEnv, 'NOTIFICATIONS_DB'>> & ReviewAlertEnv;

  if (p.event === 'held') {
    const settings = await readReviewAlertSettings(env.REPORTS_DB);
    const row = await startReviewAlert(e.NOTIFICATIONS_DB, p);
    if (row.claimed_at !== null || row.decided_at !== null) return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'already_handled' };
    const { recipients, summary } = await alertStep(e, providers, row, settings, 0, now, logger);
    if (settings.enabled && env.REVIEW_ALERTS_QUEUE) {
      for (const [step, after] of [[1, settings.escalateAllAfterSeconds], [2, settings.escalateSeniorsAfterSeconds]] as const) {
        const payload: ReviewAlertPayload = { event: 'escalate', reviewId: p.reviewId, step, at: p.at };
        // Delay from the hold, not from now: a slow first send does not push the escalations back
        const delaySeconds = Math.max(0, Math.round((p.at + after * 1000 - now) / 1000));
        await env.REVIEW_ALERTS_QUEUE.send({ id: `review-alert-${p.reviewId}-${step}-${p.at}`, type: MessageType.ReviewAlert, timestamp: now, payload: payload as unknown as Record<string, unknown> }, { delaySeconds });
      }
    } else if (settings.enabled) {
      logger.warn('[ReviewAlerts] REVIEW_ALERTS_QUEUE not bound; escalations not scheduled', { reviewId: p.reviewId });
    }
    return { event: p.event, reviewId: p.reviewId, status: 'sent', recipients, summary };
  }

  if (p.event === 'escalate') {
    const row = await getReviewAlert(e.NOTIFICATIONS_DB, p.reviewId);
    if (!row) return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'unknown_item' };
    // A newer hold of the same review restarted the clock: this escalation belongs to the old one
    if (row.held_at !== p.at) return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'superseded' };
    if (row.claimed_at !== null || row.decided_at !== null) return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'already_handled' };
    const settings = await readReviewAlertSettings(env.REPORTS_DB);
    const { recipients, summary } = await alertStep(e, providers, row, settings, p.step!, now, logger);
    return { event: p.event, reviewId: p.reviewId, status: 'sent', recipients, summary };
  }

  const known = await recordReviewerEvent(e.NOTIFICATIONS_DB, p.event, p.reviewId, p.userId, p.at);
  if (!known) return { event: p.event, reviewId: p.reviewId, status: 'skipped', reason: 'unknown_item' };
  if (p.event === 'opened') return { event: p.event, reviewId: p.reviewId, status: 'recorded' };

  // claimed / decided: clear the alert on the devices that got it
  const row = await getReviewAlert(e.NOTIFICATIONS_DB, p.reviewId);
  const clearUsers = alertedUsers(row).filter((u) => p.event === 'decided' || u !== p.userId);
  const summary = await pushToAdminDevices(e.NOTIFICATIONS_DB, providers, clearUsers, clearFor(p.reviewId), logger);
  return { event: p.event, reviewId: p.reviewId, status: 'recorded', recipients: clearUsers.length, summary };
}

interface BatchMessage {
  body: AlUmmahMessage;
  ack?: () => void;
  retry?: (options?: { delaySeconds?: number }) => void;
}

/** One message per batch in the wrangler config, but any size works. */
export async function processReviewAlertBatch(batch: { messages: readonly BatchMessage[] }, env: ReviewAlertEnv, providers: PushProviders, logger: Logger): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;
    if (body?.type !== MessageType.ReviewAlert || !isReviewAlertPayload(body.payload)) {
      logger.warn('[ReviewAlerts] Malformed message dropped', { id: body?.id, type: body?.type });
      message.ack?.();
      continue;
    }
    try {
      const outcome = await handleReviewAlert(env, providers, body.payload, logger);
      logger.debug('[ReviewAlerts] Handled', { ...outcome, summary: outcome.summary ? { ...outcome.summary, reached: outcome.summary.reached.length } : undefined });
      message.ack?.();
    } catch (error) {
      logger.error('[ReviewAlerts] Store failed; retrying', { reviewId: body.payload.reviewId, event: body.payload.event, error: error instanceof Error ? error.message : String(error) });
      message.retry?.({ delaySeconds: 1 });
    }
  }
}
