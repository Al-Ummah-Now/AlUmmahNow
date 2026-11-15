/**
 * "Sign out this device" (Admin app, staff push devices) also ends that install's
 * sign-in at Auth (AlUmmahNow#442, AlUmmahNowAuth#363): POST /internal/token-revocations
 * { user_id, install_id }. The install's refresh tokens are then refused at their next
 * use, and its access tokens expire within 15 minutes. A later sign-in on that install
 * works.
 *
 * The call runs on the auth-moderation-requests queue (same client and credentials as
 * moderation requests, which hold the tokens:revoke scope): retried with backoff, and a
 * final failure (or the DLQ) flags a needs-action item on the Errors page with Retry.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { AuthApiError, AuthModerationClient, audit, isPermanentAuthError } from './authModeration';
import { logger } from './logger';

export type DeviceRevocationMessage = { type: 'revoke-install'; userId: string; installId: string; actorId: string };

export type DeviceRevocationEnv = Pick<
  AdminBindings,
  'REPORTS_DB' | 'AUTH_REQUESTS_QUEUE' | 'Issuer' | 'AUTH_MODERATION_CLIENT_ID' | 'AUTH_MODERATION_CLIENT_SECRET' | 'ENVIRONMENT'
>;

export type DeviceRevocationOutcome = 'done' | 'retry' | 'failed';

/** First try + 6 retries (wrangler max_retries), as the other messages on this queue. */
export const MAX_ATTEMPTS = 7;

const errorText = (error: unknown) => (error instanceof AuthApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));

export const isDeviceRevocationMessage = (body: unknown): body is DeviceRevocationMessage =>
  !!body &&
  typeof body === 'object' &&
  (body as { type?: unknown }).type === 'revoke-install' &&
  typeof (body as { userId?: unknown }).userId === 'string' &&
  typeof (body as { installId?: unknown }).installId === 'string';

/** Needs-action item key of one install's revocation (errors-actions "device-tokens" retries it). */
export function deviceRevocationItemKey(msg: Pick<DeviceRevocationMessage, 'userId' | 'installId'>): string {
  return `device-tokens:${msg.userId}:${msg.installId}`.slice(0, 160);
}

/** Queues the revocation. When it cannot be queued, the failure is flagged at once. Never throws. */
export async function enqueueDeviceRevocation(env: DeviceRevocationEnv, msg: Omit<DeviceRevocationMessage, 'type'>): Promise<boolean> {
  const body: DeviceRevocationMessage = { type: 'revoke-install', ...msg };
  try {
    if (!env.AUTH_REQUESTS_QUEUE) throw new Error('The auth-moderation-requests queue is not configured (AUTH_REQUESTS_QUEUE)');
    await env.AUTH_REQUESTS_QUEUE.send(body, { contentType: 'json' });
    return true;
  } catch (error) {
    await flagFailure(env, body, `Could not queue: ${errorText(error)}`);
    return false;
  }
}

/** One attempt: done (revoked, or nothing to revoke), retry, or failed (flagged). */
export async function processDeviceRevocation(
  env: DeviceRevocationEnv,
  msg: DeviceRevocationMessage,
  attempt: number,
  client?: Pick<AuthModerationClient, 'revokeInstallTokens'>
): Promise<DeviceRevocationOutcome> {
  try {
    await (client ?? AuthModerationClient.fromEnv(env)).revokeInstallTokens(msg.userId, msg.installId);
    await audit(env.REPORTS_DB, { actorId: msg.actorId, action: 'staff_device_tokens_revoked', targetType: 'user', targetId: msg.userId, metadata: { installId: msg.installId, attempts: attempt } });
    await resolveItem(env, msg);
    return 'done';
  } catch (error) {
    // Auth has no such user in our tenant: nothing is signed in to revoke
    if (error instanceof AuthApiError && error.status === 404) {
      await audit(env.REPORTS_DB, { actorId: msg.actorId, action: 'staff_device_tokens_revoked', targetType: 'user', targetId: msg.userId, metadata: { installId: msg.installId, attempts: attempt, note: 'no such user at auth' } });
      await resolveItem(env, msg);
      return 'done';
    }
    if (isPermanentAuthError(error) || attempt >= MAX_ATTEMPTS) {
      await flagFailure(env, msg, errorText(error), attempt);
      return 'failed';
    }
    logger.warn('[DeviceSignOut] Revocation at auth failed; retrying', { userId: msg.userId, installId: msg.installId, attempt, error: errorText(error) });
    return 'retry';
  }
}

/** The DLQ: the handler kept failing. */
export async function deadLetterDeviceRevocation(env: DeviceRevocationEnv, msg: DeviceRevocationMessage): Promise<void> {
  await flagFailure(env, msg, 'Not revoked after every retry');
}

/**
 * Audits the failure and flags it on the Errors page (needs action, Retry queues the
 * revocation again). Never throws.
 */
async function flagFailure(env: DeviceRevocationEnv, msg: DeviceRevocationMessage, reason: string, attempts?: number): Promise<void> {
  logger.error('[DeviceSignOut] Could not end the device sign-in at auth', { userId: msg.userId, installId: msg.installId, reason });
  try {
    await audit(env.REPORTS_DB, {
      actorId: msg.actorId || 'queue',
      action: 'staff_device_tokens_revoke_failed',
      targetType: 'user',
      targetId: msg.userId,
      metadata: { installId: msg.installId, error: reason, ...(attempts ? { attempts } : {}), needsAttention: true },
    });
  } catch (error) {
    logger.error('[DeviceSignOut] Could not audit the failure', { error: errorText(error) });
  }
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Device sign-in not ended at auth: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: deviceRevocationItemKey(msg),
      source: 'auth',
      title: 'Signed-out device still signed in',
      itemType: 'user',
      itemId: msg.userId,
      retry: { kind: 'builtin', handler: 'device-tokens', args: { userId: msg.userId, installId: msg.installId, actorId: msg.actorId } },
      retryLabel: 'Sign the device out again',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env as AdminBindings, [event]);
  } catch (error) {
    logger.error('[DeviceSignOut] Could not flag the failure on the Errors page', { error: errorText(error) });
  }
}

/** Closes the Errors page item after a later success. Never throws. */
async function resolveItem(env: DeviceRevocationEnv, msg: DeviceRevocationMessage): Promise<void> {
  try {
    const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
    await enqueueIngest(env as AdminBindings, { v: 1, events: [], resolved: [deviceRevocationItemKey(msg)], trustedRetry: true, receivedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[DeviceSignOut] Could not resolve the Errors page item', { error: errorText(error) });
  }
}
