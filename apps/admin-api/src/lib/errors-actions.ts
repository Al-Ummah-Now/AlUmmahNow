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
import { ADMIN_JOB_PERMISSIONS, CHANNEL_MOVE_MAIL_EVENTS, type AdminContentPermission, type NeedsActionRetry, type NeedsActionStatus } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import type { Permission } from './roles';
import { deliveryStatus, recordDelivery, type MailKind } from './contact-store';
import { CONTACT_MAIL_VERSION, enqueueContactMail, type ContactMailJob } from './contact-mail-queue';
import { getWarning, recordWarningEmail } from './content/warnings';
import { enqueueWarningMail } from './warning-mail';
import { enqueueRejectionMail, rejectionMailJob } from './review/rejection-mail';
import { retryConfirm, retryNotification } from './status-notify';
import { enqueueTierChangeMail } from './tier-change-mail';
import { enqueueChannelMoveMail } from './channel-move-mail';
import { enqueueTierRequestMail, tierRequestMailJob, type DecidedRequest } from './tier-request-mail';
import { callVideos, VideosError } from './content/videosClient';
import { logger } from './logger';
import { enqueueDeviceRevocation } from './deviceTokenRevocation';
import { getIssue, getSubscriber, renewConfirmToken, requeueFailed, setDelivery } from './newsletter-store';
import { confirmJob, enqueueNewsletterMail, fanoutJob, sendJob } from './newsletter-mail';
import { COST_MAIL_VERSION } from './cost-alert-mail';
import { ThemeStore } from './themePackages';

export interface RetryOutcome {
  ok: boolean;
  /** Item status after the attempt: resolved when it worked, open when it did not */
  status: NeedsActionStatus;
  result: string;
}

type Fetcher = { fetch(input: string, init?: RequestInit): Promise<Response> };

/** Service name in a retry spec → the binding and the paths Retry may POST to. */
export const SERVICE_RETRIES: Record<string, { binding: keyof AdminBindings; paths: readonly string[] }> = {
  processor: { binding: 'PROCESSOR', paths: ['/dlq/replay', '/internal/quran/sync', '/internal/captions/claim', '/internal/search/transcript'] },
  scheduler: { binding: 'SCHEDULER', paths: ['/failed/retry'] },
  // A new upload that could not be added to its playlist (api-videos lib/playlistUploadAdds.ts);
  // a failed transcription job, run again free of charge (api-videos lib/captions/jobs.ts); a media
  // provider turned unhealthy: "Check now" runs a health pass (api-videos lib/media/health.ts); a
  // Studio comment index rebuild or the removed-comment purge that gave up is queued again (api-videos
  // lib/channelComments/jobs.ts); a Move from YouTube step that gave up runs again (api-videos
  // lib/youtube-import/jobs.ts); an R2 backfill item or a Bunny removal that failed runs again (api-videos
  // lib/media/backfill/); a stalled R2 transcode is retried now, or a Retry now / Cancel admin job that
  // gave up is queued again (api-videos lib/media/troubleshoot.ts).
  // An audio track that could not be prepared, or a multi-audio package that could not be written,
  // runs again (api-videos lib/audio-tracks/service.ts, wiki AUN-MULTI-AUDIO). A payments job that
  // gave up runs again (api-videos lib/billing/service.ts; Retry also needs the job's own billing
  // permission, endpoints/errors/ErrorsAdmin.ts). A discovery ranking run that gave up runs now
  // (api-videos lib/ranking/job.ts, wiki E07 Discovery ranking). A creator-support job that gave up runs again
  // (api-videos lib/support/jobs.ts, wiki AUN-MEMBERS; Retry needs support:manage).
  // An Admin Tools import's sidecars (captions, chapters, thumbnail) that could not be attached are
  // tried again (api-videos lib/admin/importAttach.ts, wiki TOOLS-ADMIN TA-6).
  // A social import sync that gave up runs again (api-videos lib/importSources/job.ts, wiki TOOLS-ADMIN
  // TA-9); its Retry also needs import_sources:manage (retrySitePermissions).
  // Never a CSAM path: those retry from the case page, super admins only (docs/specs/CSAM-RESPONSE.md)
  'api-videos': { binding: 'VIDEOS', paths: ['/internal/playlist-adds/retry', '/internal/captions/jobs/retry', '/internal/media/health/check', '/internal/channel-comments/retry', '/internal/youtube-import/retry', '/internal/account-events/retry', '/internal/media/backfill/items/retry', '/internal/media/backfill/removals/retry', '/internal/social/deliveries/retry', '/internal/media/troubleshoot/retry-now', '/internal/media/troubleshoot/jobs/retry', '/internal/audio-tracks/retry', '/internal/billing/jobs/retry', '/internal/support/jobs/retry', '/internal/discovery/rank', '/internal/community/cards/retry', '/internal/admin/import/attach/retry', '/internal/admin/import/sources/retry'] },
};

/**
 * Content permissions a Retry needs on top of errors:manage: a payments job runs its action
 * again, so it needs that action's own permission (a refund: billing:refund). A missing or
 * unknown kind needs every billing permission (deny by default); api-videos also refuses a
 * retry whose kind is not the job's own.
 */
/** Site permissions a Retry needs on top of errors:manage: a social import sync only for whoever manages sources (super admins). */
export function retrySitePermissions(spec: NeedsActionRetry | null): Permission[] {
  return spec?.kind === 'service' && spec.service === 'api-videos' && spec.path === '/internal/admin/import/sources/retry' ? ['import_sources:manage'] : [];
}

const ALL_BILLING: AdminContentPermission[] = ['billing:read', 'billing:manage', 'billing:refund', 'billing:providers'];
export function retryPermissions(spec: NeedsActionRetry | null): AdminContentPermission[] {
  // Creator support jobs (api-videos lib/support/jobs.ts, wiki AUN-MEMBERS §9.6): support:manage. They book money
  // that already moved; jobs that move money (payouts, refunds) also need the finance list, checked by api-videos.
  if (spec?.kind === 'service' && spec.service === 'api-videos' && spec.path === '/internal/support/jobs/retry') return ['support:manage'];
  if (!spec || spec.kind !== 'service' || spec.service !== 'api-videos' || spec.path !== '/internal/billing/jobs/retry') return [];
  const kind = (spec.body as { kind?: unknown } | undefined)?.kind;
  const known = typeof kind === 'string' && kind.startsWith('billing.') ? (ADMIN_JOB_PERMISSIONS as Readonly<Record<string, readonly AdminContentPermission[]>>)[kind] : undefined;
  return known ? [...known] : ALL_BILLING;
}

export const BUILTIN_RETRIES: Record<string, (env: AdminBindings, args: Record<string, string>, attempt: string) => Promise<RetryOutcome>> = {
  /** Builds the art of a custom theme version published before the art existed (lib/theme-art.ts). */
  'theme-art': async (env, args) => {
    const { id, version } = args;
    if (!id || !version || !/^[a-z][a-z0-9-]{1,39}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, status: 'open', result: 'Not a theme version' };
    const store = new ThemeStore(env.REPORTS_DB, env.theme_packages);
    if (!(await store.isLive(id))) return { ok: true, status: 'dismissed', result: 'The theme was deleted' };
    const out = await store.publishedCss(id, version);
    if (!out) return { ok: true, status: 'dismissed', result: 'The version no longer exists' };
    if (out.art === 'failed') return { ok: false, status: 'open', result: `Still failing: ${out.error ?? 'unknown error'}`.slice(0, 300) };
    return { ok: true, status: 'resolved', result: out.art === 'added' ? 'Art built' : 'The art was already built' };
  },
  /** Runs a revoked invite's erase again (#716, lib/invite-erase.ts); a new failure reopens the item. */
  'invite-videos-erase': async (env, args) => {
    const { getInvite } = await import('./invites');
    const { isDueRevokedInvite, settleRevokedInvites } = await import('./invite-erase');
    const row = args.id ? await getInvite(env.REPORTS_DB, args.id) : null;
    if (!row) return { ok: true, status: 'resolved', result: 'The invite is already purged' };
    if (!row.deleted_at) return { ok: false, status: 'dismissed', result: 'The invite was restored' };
    // Only what the hourly cleanup would purge: a Retry never erases ahead of the 30-day window
    if (!isDueRevokedInvite(row, new Date())) return { ok: false, status: 'dismissed', result: 'The invite is not due for its purge yet' };
    const out = await settleRevokedInvites(env as never, [row], { resolve: async () => undefined });
    if (out.failed.length) return { ok: false, status: 'open', result: `Not erased: ${out.failed[0].error}` };
    if (out.waiting.length) return { ok: false, status: 'open', result: 'Auth still holds the invite; erased once auth purges it' };
    return { ok: true, status: 'resolved', result: out.erased.length ? 'Videos data erased and the invite purged' : 'Nothing left on the videos side; the invite purged' };
  },
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
  /** Queues a "Sign out this device" revocation at auth again (#442); a new failure reopens the item. */
  'device-tokens': async (env, args) => {
    const { userId, installId } = args;
    if (!userId || !installId) return { ok: false, status: 'open', result: 'Not a device sign-out' };
    if (!(await enqueueDeviceRevocation(env, { userId, installId, actorId: args.actorId || 'errors-retry' }))) {
      return { ok: false, status: 'open', result: 'Could not queue the sign-out' };
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
  /**
   * Newsletter mail that failed for good: a sign-up's confirmation (a new link, while still
   * pending), or an issue (its failed deliveries queued again; the fan-out again when it never
   * finished, which skips subscribers who already have a delivery).
   */
  'newsletter-email': async (env, args) => {
    const id = args.id;
    if (!id || (args.kind !== 'confirm' && args.kind !== 'issue')) return { ok: false, status: 'open', result: 'Not a newsletter email' };
    const now = new Date();
    if (args.kind === 'confirm') {
      const sub = await getSubscriber(env.REPORTS_DB, id);
      if (!sub) return { ok: false, status: 'dismissed', result: 'Subscriber no longer exists' };
      if (sub.status !== 'pending') return { ok: true, status: 'resolved', result: `Nothing to send (${sub.status})` };
      const token = await renewConfirmToken(env.REPORTS_DB, id, now);
      if (!token) return { ok: true, status: 'resolved', result: 'Nothing to send' };
      if (!(await enqueueNewsletterMail(env, [confirmJob(id, token)]))) return { ok: false, status: 'open', result: 'Could not queue the email' };
      return { ok: true, status: 'resolved', result: 'Queued again' };
    }
    const issue = await getIssue(env.REPORTS_DB, id);
    if (!issue) return { ok: false, status: 'dismissed', result: 'Issue no longer exists' };
    if (issue.status === 'draft') return { ok: true, status: 'resolved', result: 'Nothing to send (draft)' };
    const failed = await requeueFailed(env.REPORTS_DB, id, now);
    const jobs = [...failed.map((sid) => sendJob(id, sid)), ...(issue.fanned_out_at ? [] : [fanoutJob(id)])];
    if (!jobs.length) return { ok: true, status: 'resolved', result: 'Nothing to resend' };
    if (!(await enqueueNewsletterMail(env, jobs))) {
      // Back to failed, so the next Retry finds them again
      for (const sid of failed) await setDelivery(env.REPORTS_DB, id, sid, 'failed', now, { error: 'could not queue the email' });
      return { ok: false, status: 'open', result: 'Could not queue the emails' };
    }
    return { ok: true, status: 'resolved', result: `Queued again (${failed.length} email${failed.length === 1 ? '' : 's'})` };
  },
  /** Status page subscriptions: queues a notification's failed deliveries (or its unfinished fan-out) again. */
  'status-notify': async (env, args) => {
    if (!args.id) return { ok: false, status: 'open', result: 'Not a status notification' };
    const out = await retryNotification(env, args.id);
    if (out === 'gone') return { ok: false, status: 'dismissed', result: 'Notification no longer exists' };
    if (!out) return { ok: false, status: 'open', result: 'Could not queue the deliveries' };
    return { ok: true, status: 'resolved', result: out.queued ? `Queued ${out.queued} again` : 'Nothing to send again' };
  },
  /** Status page subscriptions: queues a pending subscriber's confirmation email again. */
  'status-confirm': async (env, args) => {
    if (!args.id) return { ok: false, status: 'open', result: 'Not a status subscription' };
    const out = await retryConfirm(env, args.id);
    if (out === 'gone') return { ok: true, status: 'resolved', result: 'Nothing to send: confirmed or removed since' };
    if (!out) return { ok: false, status: 'open', result: 'Could not queue the email' };
    return { ok: true, status: 'resolved', result: 'Queued again' };
  },
  /** Sends a tier-change email again (lib/tier-change-mail.ts; a sent one is never sent twice). */
  'tier-change-delivery': async (env, args) => {
    if (!args.id) return { ok: false, status: 'open', result: 'Not a tier change' };
    if (!(await enqueueTierChangeMail(env, args.id))) return { ok: false, status: 'open', result: 'Could not queue the email' };
    return { ok: true, status: 'resolved', result: 'Queued again' };
  },
  /** Sends a channel move email again (lib/channel-move-mail.ts), if it still applies; a sent one is never sent twice. */
  'channel-move-mail': async (env, args) => {
    const event = CHANNEL_MOVE_MAIL_EVENTS.find((e) => e === args.event);
    if (!event || !args.id) return { ok: false, status: 'open', result: 'Not a channel move email' };
    if (!(await enqueueChannelMoveMail(env, event, args.id))) return { ok: false, status: 'open', result: 'Could not queue the email' };
    // Resolved when the email ends (channel-move-mail.ts settle), open again if it fails
    return { ok: true, status: 'retrying', result: 'Queued again' };
  },
  /** Delivers a tier request decision again (notice + email), if the request still has that decision. */
  'tier-request-delivery': async (env, args) => {
    const { id, decidedAt } = args;
    if (!id || !decidedAt) return { ok: false, status: 'open', result: 'Not a tier request' };
    let request: DecidedRequest;
    try {
      request = (await callVideos<{ request: DecidedRequest }>(env as never, `/tier-requests/${encodeURIComponent(id)}`)).request;
    } catch (error) {
      if (error instanceof VideosError && error.status === 404) return { ok: false, status: 'dismissed', result: 'Request no longer exists' };
      throw error;
    }
    if (request.decidedAt !== decidedAt) return { ok: true, status: 'resolved', result: 'Nothing to deliver: the request was decided again' };
    if (!(await enqueueTierRequestMail(env, tierRequestMailJob(id, decidedAt)))) return { ok: false, status: 'open', result: 'Could not queue the delivery' };
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
  /** Runs a cost-monitor job that gave up again (COST-1, apps/cost-monitor src/jobs.ts): queued on its own queue. */
  'cost-job': async (env, args) => {
    const kinds = ['hourly', 'daily', 'containers', 'bunny', 'resend'];
    if (!kinds.includes(args.job ?? '') || !args.at || Number.isNaN(Date.parse(args.at)) || (args.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.day))) {
      return { ok: false, status: 'dismissed', result: 'Not a cost job' };
    }
    if (!env.COST_JOBS_QUEUE) return { ok: false, status: 'open', result: 'The cost jobs queue is not bound here' };
    try {
      await env.COST_JOBS_QUEUE.send({ v: 1, job: args.job, at: args.at, ...(args.day ? { day: args.day } : {}) } as never, { contentType: 'json' });
      // The job resolves the item itself when it succeeds; a new failure flags it again
      return { ok: true, status: 'resolved', result: 'Queued again' };
    } catch {
      return { ok: false, status: 'open', result: 'Could not queue the job' };
    }
  },
  /** Queues a cost alert email that failed for good again (lib/cost-alert-mail.ts). */
  'cost-alert-email': async (env, args) => {
    const { fingerprint, userId } = args;
    if (!fingerprint || !userId || !env.COSTS_DB) return { ok: false, status: 'dismissed', result: 'Not a cost email' };
    const row = await env.COSTS_DB.prepare('SELECT status FROM cost_alert_deliveries WHERE fingerprint = ? AND user_id = ?').bind(fingerprint, userId).first<{ status: string }>();
    if (!row) return { ok: false, status: 'dismissed', result: 'The email no longer exists' };
    if (row.status !== 'failed') return { ok: true, status: 'resolved', result: `Nothing to resend (${row.status})` };
    await env.COSTS_DB.prepare("UPDATE cost_alert_deliveries SET status = 'queued', error = NULL, updated_at = ? WHERE fingerprint = ? AND user_id = ?").bind(new Date().toISOString(), fingerprint, userId).run();
    try {
      await env.CONTACT_MAIL_QUEUE!.send({ v: COST_MAIL_VERSION, kind: 'cost-alert', fingerprint, userId } as never, { contentType: 'json' });
      return { ok: true, status: 'resolved', result: 'Queued again' };
    } catch {
      await env.COSTS_DB.prepare("UPDATE cost_alert_deliveries SET status = 'failed', error = 'could not queue the email' WHERE fingerprint = ? AND user_id = ?").bind(fingerprint, userId).run();
      return { ok: false, status: 'open', result: 'Could not queue the email' };
    }
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
