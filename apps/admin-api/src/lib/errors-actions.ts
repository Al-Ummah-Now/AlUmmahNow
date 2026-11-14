/**
 * Retry actions of "needs action" items (Errors page). Reporters describe
 * what Retry should do (NeedsActionRetry); only what is registered here can
 * run, so a report can never make admin-api call an arbitrary URL:
 *
 * - builtin handlers (BUILTIN_RETRIES): code in admin-api.
 * - service calls (SERVICE_RETRIES): POST with the internal API key to an
 *   allowlisted path of a Worker admin-api has a service binding to.
 *
 * To add one: register the handler or the service path here, bind the
 * service in wrangler (all environments), and report items with that retry
 * spec (docs/features/error-reporting.md).
 */
import type { NeedsActionRetry, NeedsActionStatus } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { deliveryStatus, recordDelivery, type MailKind } from './contact-store';
import { CONTACT_MAIL_VERSION, enqueueContactMail, type ContactMailJob } from './contact-mail-queue';
import { getWarning, recordWarningEmail } from './content/warnings';
import { enqueueWarningMail } from './warning-mail';
import { enqueueRejectionMail, rejectionMailJob } from './review/rejection-mail';
import { logger } from './logger';

export interface RetryOutcome {
  ok: boolean;
  /** Item status after the attempt: resolved when it worked, open when it did not */
  status: NeedsActionStatus;
  result: string;
}

type Fetcher = { fetch(input: string, init?: RequestInit): Promise<Response> };

/** Service name in a retry spec → the binding and the paths Retry may POST to. */
export const SERVICE_RETRIES: Record<string, { binding: keyof AdminBindings; paths: readonly string[] }> = {
  processor: { binding: 'PROCESSOR', paths: ['/dlq/replay', '/internal/quran/sync', '/internal/captions/claim'] },
  scheduler: { binding: 'SCHEDULER', paths: ['/failed/retry'] },
  // A new upload that could not be added to its playlist (api-videos lib/playlistUploadAdds.ts);
  // a failed transcription job, run again free of charge (api-videos lib/captions/jobs.ts); a media
  // provider turned unhealthy: "Check now" runs a health pass (api-videos lib/media/health.ts).
  // Never a CSAM path: those retry from the case page, super admins only (docs/specs/CSAM-RESPONSE.md)
  'api-videos': { binding: 'VIDEOS', paths: ['/internal/playlist-adds/retry', '/internal/captions/jobs/retry', '/internal/media/health/check'] },
};

export const BUILTIN_RETRIES: Record<string, (env: AdminBindings, args: Record<string, string>, attempt: string) => Promise<RetryOutcome>> = {
  /** Queues a Contact us email that failed for good again (as the inbox's Retry does); a new failure reopens the item. */
  'contact-email': async (env, args) => {
    const kind = args.kind as MailKind;
    const id = args.id;
    if (!id || !['notify', 'ack', 'reply'].includes(kind) || (kind === 'reply' && !args.noteId)) return { ok: false, status: 'open', result: 'Not a contact email' };
    const current = await deliveryStatus(env.REPORTS_DB, id, kind, args.noteId);
    if (current === undefined) return { ok: false, status: 'dismissed', result: 'Message no longer exists' };
    if (current !== 'failed') return { ok: true, status: 'resolved', result: `Nothing to resend (${current ?? 'pending'})` };
    const now = new Date();
    await recordDelivery(env.REPORTS_DB, { messageId: id, kind, noteId: args.noteId, status: 'queued', now });
    const job: ContactMailJob = { v: CONTACT_MAIL_VERSION, kind, messageId: id, ...(args.noteId ? { noteId: args.noteId } : {}) };
    if (!(await enqueueContactMail(env, [job]))) {
      await recordDelivery(env.REPORTS_DB, { messageId: id, kind, noteId: args.noteId, status: 'failed', error: 'could not queue the email', now });
      return { ok: false, status: 'open', result: 'Could not queue the email' };
    }
    return { ok: true, status: 'resolved', result: 'Queued again' };
  },
  /** Queues an account warning email that failed for good again; a new failure reopens the item. */
  /** Sends a "video not approved" email again, if the review is still that rejection (else nothing to send). */
  'review-rejection-email': async (env, args) => {
    const { id, decidedAt } = args;
    if (!id || !decidedAt) return { ok: false, status: 'open', result: 'Not a review email' };
    const row = await env.REPORTS_DB.prepare('SELECT status, decided_at FROM content_reviews WHERE id = ?').bind(id).first<{ status: string; decided_at: string | null }>();
    if (!row) return { ok: false, status: 'dismissed', result: 'Review no longer exists' };
    if (row.status !== 'rejected' || row.decided_at !== decidedAt) return { ok: true, status: 'resolved', result: 'Nothing to send: the review was decided again' };
    if (!(await enqueueRejectionMail(env, rejectionMailJob(id, decidedAt, args.locale === 'ar' ? 'ar' : 'en'), 0))) {
      return { ok: false, status: 'open', result: 'Could not queue the email' };
    }
    return { ok: true, status: 'resolved', result: 'Queued again' };
  },
  'warning-email': async (env, args) => {
    const id = args.id;
    if (!id) return { ok: false, status: 'open', result: 'Not a warning email' };
    const warning = await getWarning(env.REPORTS_DB, id);
    if (!warning) return { ok: false, status: 'dismissed', result: 'Warning no longer exists' };
    if (warning.email_status !== 'failed') return { ok: true, status: 'resolved', result: `Nothing to resend (${warning.email_status ?? 'pending'})` };
    await recordWarningEmail(env.REPORTS_DB, id, 'queued');
    if (!(await enqueueWarningMail(env, id))) {
      await recordWarningEmail(env.REPORTS_DB, id, 'failed', { error: 'could not queue the email' });
      return { ok: false, status: 'open', result: 'Could not queue the email' };
    }
    return { ok: true, status: 'resolved', result: 'Queued again' };
  },
};

async function resolveKey(binding: AdminBindings['INTERNAL_API_KEY']): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

/** Runs a retry spec. Never throws. */
export async function runRetry(env: AdminBindings, spec: NeedsActionRetry | null, attempt: string): Promise<RetryOutcome> {
  if (!spec) return { ok: false, status: 'open', result: 'This item has no retry action' };
  try {
    if (spec.kind === 'builtin') {
      const handler = BUILTIN_RETRIES[spec.handler];
      if (!handler) return { ok: false, status: 'open', result: `Unknown retry handler "${spec.handler}"` };
      return await handler(env, spec.args ?? {}, attempt);
    }
    const target = SERVICE_RETRIES[spec.service];
    if (!target || !target.paths.includes(spec.path)) return { ok: false, status: 'open', result: `Retry to ${spec.service}${spec.path} is not allowed` };
    const service = env[target.binding] as Fetcher | undefined;
    if (!service?.fetch) return { ok: false, status: 'open', result: `Service ${spec.service} is not bound to admin-api` };
    const key = await resolveKey(env.INTERNAL_API_KEY);
    const res = await service.fetch(`https://${spec.service}.internal${spec.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify(spec.body ?? {}),
    });
    const text = (await res.text().catch(() => '')).slice(0, 200);
    if (res.ok) return { ok: true, status: 'resolved', result: `${spec.service} ${spec.path}: ${res.status}` };
    // 404 from a replay: the stored item is gone, nothing more to retry
    if (res.status === 404) return { ok: false, status: 'dismissed', result: `${spec.service} ${spec.path}: not found` };
    return { ok: false, status: 'open', result: `${spec.service} ${spec.path}: ${res.status} ${text}`.trim() };
  } catch (error) {
    logger.error('[Errors] Retry failed', { spec: JSON.stringify(spec), error: String(error) });
    return { ok: false, status: 'open', result: `Retry failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function parseRetry(json: string | null): NeedsActionRetry | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as NeedsActionRetry;
  } catch {
    return null;
  }
}
