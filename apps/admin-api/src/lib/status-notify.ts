/**
 * Status page subscriptions (docs/status-page/README.md "Subscriptions"): this Worker consumes
 * STATUS_NOTIFY_QUEUE (al-ummah-now-status-notify[-env]) and writes STATUS_DB (apps/status
 * migrations/0002_subscriptions.sql).
 *
 *   status-confirm   the double opt-in email of a pending email subscriber (queued by apps/status)
 *   status-fanout    one incident or maintenance post / update → a delivery row and a job per
 *                    active subscriber (queued by routers/status.router.ts through announce())
 *   status-deliver   one email (the subscriber's language, unsubscribe link + RFC 8058 headers)
 *                    or one signed webhook POST
 *
 * Retries: network errors, 429 and 5xx back off (30 s doubling, at most 15 min) up to
 * STATUS_MAX_ATTEMPTS; a 4xx from a webhook or a refused address fails at once. A final failure
 * marks the delivery failed, goes to the platform DLQ (ERRORS_DLQ) and flags one needs-action item
 * per notification on the admin Errors page, whose Retry ("status-notify" in lib/errors-actions.ts)
 * queues every failed delivery of it again. Idempotent: a delivery that is no longer queued is
 * never sent again, and Resend gets an Idempotency-Key per email.
 *
 * Only incidents with at least one public component are announced, with their public components.
 */
import {
  STATUS_COMPONENTS,
  STATUS_CONFIRM_DAYS,
  STATUS_LABELS,
  formatNumber,
  STATUS_NOTIFY_VERSION,
  STATUS_PAGE_URLS,
  STATUS_WEBHOOK_HEADERS,
  isPublicStatusComponent,
  isStatusNotifyJob,
  newErrorRef,
  scrubEvent,
  type IncidentImpact,
  type IncidentKind,
  type IncidentStatus,
  type StatusComponentId,
  type StatusNotifyEvent,
  type StatusNotifyJob,
  type StatusWebhookPayload,
} from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import type { D1Database } from './types';
import { envTag, sendContactEmail, type RenderedEmail } from './contact-email';
import { backoffSeconds, type QueueMessageLike } from './contact-mail-queue';
import { formatEmailDate, renderEmail, type EmailBlock, type EmailDoc } from './email/layout';
import { logger } from './logger';

/** Keep equal to max_retries + 1 of the status-notify consumer in wrangler*.jsonc. */
export const STATUS_MAX_ATTEMPTS = 6;
const WEBHOOK_TIMEOUT_MS = 10_000;
/** Queue sendBatch takes at most 100 messages. */
const BATCH = 100;

type Locale = 'en' | 'ar';
type Outcome = 'done' | 'retry' | 'failed';

export type StatusNotifyEnv = AdminBindings;

export function statusPageUrl(env: { ENVIRONMENT?: string; STATUS_PAGE_URL?: string }): string {
  if (env.STATUS_PAGE_URL) return env.STATUS_PAGE_URL.replace(/\/+$/, '');
  return env.ENVIRONMENT === 'qa' || env.ENVIRONMENT === 'stage' ? STATUS_PAGE_URLS[env.ENVIRONMENT] : STATUS_PAGE_URLS.production;
}

// ---------------------------------------------------------------- data

interface IncidentRow {
  id: string;
  kind: IncidentKind;
  title_en: string;
  title_ar: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  components: string;
  starts_at: string;
  ends_at: string | null;
  resolved_at: string | null;
  deleted_at: string | null;
}

interface UpdateRow {
  id: string;
  incident_id: string;
  status: IncidentStatus;
  body_en: string;
  body_ar: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  incident_id: string;
  event: StatusNotifyEvent;
  created_at: string;
  fanned_out_at: string | null;
  recipients: number | null;
}

interface SubscriberRow {
  id: string;
  kind: 'email' | 'webhook';
  address: string;
  locale: Locale;
  name: string | null;
  status: 'pending' | 'active';
  token: string | null;
  secret: string | null;
  confirm_sent_at: string | null;
}

export function publicComponents(json: string): StatusComponentId[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && isPublicStatusComponent(x)) as StatusComponentId[]) : [];
  } catch {
    return [];
  }
}

const loadIncident = (db: D1Database, id: string) =>
  db.prepare('SELECT id, kind, title_en, title_ar, status, impact, components, starts_at, ends_at, resolved_at, deleted_at FROM incidents WHERE id = ?').bind(id).first<IncidentRow>();
const loadUpdate = (db: D1Database, id: string) => db.prepare('SELECT id, incident_id, status, body_en, body_ar, created_at FROM incident_updates WHERE id = ?').bind(id).first<UpdateRow>();
const loadSubscriber = (db: D1Database, id: string) =>
  db.prepare('SELECT id, kind, address, locale, name, status, token, secret, confirm_sent_at FROM subscribers WHERE id = ?').bind(id).first<SubscriberRow>();
const loadNotification = (db: D1Database, id: string) => db.prepare('SELECT * FROM notifications WHERE id = ?').bind(id).first<NotificationRow>();

async function enqueue(env: StatusNotifyEnv, jobs: StatusNotifyJob[]): Promise<boolean> {
  if (!env.STATUS_NOTIFY_QUEUE) {
    logger.error('[StatusNotify] STATUS_NOTIFY_QUEUE is not bound');
    return false;
  }
  try {
    for (let i = 0; i < jobs.length; i += BATCH) await env.STATUS_NOTIFY_QUEUE.sendBatch(jobs.slice(i, i + BATCH).map((body) => ({ body, contentType: 'json' as const })));
    return true;
  } catch (error) {
    logger.error('[StatusNotify] Enqueue failed', { error: error instanceof Error ? error.message : String(error), jobs: jobs.length });
    return false;
  }
}

// ---------------------------------------------------------------- Errors page

/** Needs-action key of one notification's failed deliveries ("status-notify" retries them). */
export const notifyItemKey = (notificationId: string) => `status-notify:${notificationId}`.slice(0, 160);
/** Needs-action key of a confirmation email that failed ("status-confirm" retries it). */
export const confirmItemKey = (subscriberId: string) => `status-confirm:${subscriberId}`.slice(0, 160);

async function flag(env: StatusNotifyEnv, action: { key: string; title: string; message: string; handler: 'status-notify' | 'status-confirm'; id: string; itemId: string }): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: action.message,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: action.key,
      source: 'email',
      title: action.title,
      itemType: 'status-incident',
      itemId: action.itemId,
      itemUrl: '/status',
      retry: { kind: 'builtin', handler: action.handler, args: { id: action.id } },
      retryLabel: 'Send again',
    },
  });
  if (!event) return;
  try {
    // Imported lazily: the errors pipeline imports lib/errors-actions.ts, which imports this module
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[StatusNotify] Could not flag the failure on the Errors page', { key: action.key, error: error instanceof Error ? error.message : String(error) });
  }
}

async function toDlq(env: StatusNotifyEnv, id: string, reason: string, job: StatusNotifyJob): Promise<void> {
  try {
    await env.ERRORS_DLQ?.send({ id, type: 'status_notify', failureReason: reason.slice(0, 1000), job });
  } catch (error) {
    logger.error('[StatusNotify] Could not report to the DLQ', { id, error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------- announce (router)

/**
 * Records a notification for an incident post or update and queues its fan-out. Never throws:
 * the incident is already saved; a failure to queue is flagged on the Errors page with Retry.
 * Returns false when nothing was announced (no public component, or the queue refused it).
 */
export async function announce(env: StatusNotifyEnv, input: { incidentId: string; updateId: string; event: StatusNotifyEvent; components: readonly string[] }): Promise<boolean> {
  const db = env.STATUS_DB;
  if (!db || !input.components.some(isPublicStatusComponent)) return false;
  try {
    await db.prepare('INSERT OR IGNORE INTO notifications (id, incident_id, event, created_at) VALUES (?, ?, ?, ?)').bind(input.updateId, input.incidentId, input.event, new Date().toISOString()).run();
  } catch (error) {
    // Before migration 0002 is applied (or D1 failing): the incident stands, subscribers are not told
    logger.error('[StatusNotify] Could not record the notification', { incidentId: input.incidentId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
  if (await enqueue(env, [{ v: STATUS_NOTIFY_VERSION, kind: 'status-fanout', notificationId: input.updateId }])) return true;
  await flag(env, {
    key: notifyItemKey(input.updateId),
    title: 'Status update not sent to subscribers',
    message: `Status ${input.event} for incident ${input.incidentId} could not be queued for subscribers`,
    handler: 'status-notify',
    id: input.updateId,
    itemId: input.incidentId,
  });
  return false;
}

// ---------------------------------------------------------------- fan-out

async function fanout(env: StatusNotifyEnv, job: Extract<StatusNotifyJob, { kind: 'status-fanout' }>, now: Date): Promise<Outcome> {
  const db = env.STATUS_DB!;
  const n = await loadNotification(db, job.notificationId);
  if (!n || n.fanned_out_at) return 'done';
  const incident = await loadIncident(db, n.incident_id);
  const at = now.toISOString();
  if (!incident || incident.deleted_at || !publicComponents(incident.components).length) {
    await db.prepare('UPDATE notifications SET fanned_out_at = ?, recipients = 0 WHERE id = ?').bind(at, n.id).run();
    return 'done';
  }
  const subs = (await db.prepare("SELECT id FROM subscribers WHERE status = 'active' ORDER BY created_at").all<{ id: string }>()).results ?? [];
  for (let i = 0; i < subs.length; i += 50) {
    await db.batch(
      subs.slice(i, i + 50).map((s) => db.prepare("INSERT OR IGNORE INTO deliveries (notification_id, subscriber_id, status, attempts, updated_at) VALUES (?, ?, 'queued', 0, ?)").bind(n.id, s.id, at)),
    );
  }
  // Deliveries still queued (a retried fan-out queues them again; deliver() skips finished ones)
  const queued = (await db.prepare("SELECT subscriber_id FROM deliveries WHERE notification_id = ? AND status = 'queued'").bind(n.id).all<{ subscriber_id: string }>()).results ?? [];
  if (!(await enqueue(env, queued.map((d) => ({ v: STATUS_NOTIFY_VERSION, kind: 'status-deliver' as const, notificationId: n.id, subscriberId: d.subscriber_id }))))) {
    throw new Error('could not queue the deliveries');
  }
  await db.prepare('UPDATE notifications SET fanned_out_at = ?, recipients = ? WHERE id = ?').bind(at, subs.length, n.id).run();
  logger.debug('[StatusNotify] Fanned out', { notificationId: n.id, recipients: subs.length });
  return 'done';
}

// ---------------------------------------------------------------- email

const COPY = {
  en: {
    subject: (title: string, status: string) => `Status: ${title} (${status})`,
    status: 'Status',
    affected: 'Affected',
    window: 'Window',
    windowValue: (from: string, to: string) => `${from} to ${to}`,
    kind: { incident: 'Incident', maintenance: 'Scheduled maintenance' },
    view: 'View on the status page',
    unsubscribe: 'Unsubscribe',
    unsubscribeNote: 'To stop these emails, unsubscribe here:',
    reason: 'You received this email because you subscribed to Al Ummah Now status updates.',
    sign: 'Al Ummah Now',
    confirmSubject: 'Confirm your Al Ummah Now status updates',
    confirmHeading: 'Confirm your subscription',
    confirmPreheader: 'Confirm to get an email when an incident or maintenance is posted.',
    confirmBody: 'You asked to get Al Ummah Now status updates at this address: an email when an incident or scheduled maintenance is posted, and with each update until it is resolved.',
    confirmCta: 'Confirm subscription',
    confirmIgnore: (days: string) => `If you did not ask for this, ignore this email. We will not send anything else, and the address is deleted after ${days} days.`,
    confirmReason: 'You received this email because this address was entered on the Al Ummah Now status page.',
  },
  ar: {
    subject: (title: string, status: string) => `الحالة: ${title} (${status})`,
    status: 'الحالة',
    affected: 'الخدمات المتأثرة',
    window: 'الموعد',
    windowValue: (from: string, to: string) => `من ${from} إلى ${to}`,
    kind: { incident: 'حادثة', maintenance: 'صيانة مجدولة' },
    view: 'اعرضها على صفحة الحالة',
    unsubscribe: 'إلغاء الاشتراك',
    unsubscribeNote: 'لإيقاف هذه الرسائل، ألغِ اشتراكك من هنا:',
    reason: 'وصلتك هذه الرسالة لأنك مشترك في تحديثات حالة خدمات الأمة الآن.',
    sign: 'الأمة الآن',
    confirmSubject: 'أكّد اشتراكك في تحديثات حالة الأمة الآن',
    confirmHeading: 'أكّد اشتراكك',
    confirmPreheader: 'أكّد لتصلك رسالة حين تُنشر حادثة أو صيانة.',
    confirmBody: 'طلبتَ أن تصلك تحديثات حالة خدمات الأمة الآن على هذا البريد: رسالة حين تُنشر حادثة أو صيانة مجدولة، ومع كل تحديث لها حتى تُحلّ.',
    confirmCta: 'تأكيد الاشتراك',
    confirmIgnore: (days: string) => `إن لم تطلب ذلك فتجاهل هذه الرسالة. لن نرسل إليك شيئًا آخر، وسيُحذف البريد بعد ${days} أيام.`,
    confirmReason: 'وصلتك هذه الرسالة لأن هذا البريد أُدخل في صفحة حالة خدمات الأمة الآن.',
  },
} as const;

const lp = (locale: Locale) => (locale === 'ar' ? '/ar' : '');
const componentName = (id: string, locale: Locale) => STATUS_COMPONENTS.find((c) => c.id === id)?.[locale] ?? id;

export function unsubscribeUrl(base: string, locale: Locale, token: string): string {
  return `${base}${lp(locale)}/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** One incident post or update, in the subscriber's one language, on the shared branded layout. */
export function renderIncidentEmail(input: { to: string; locale: Locale; token: string; base: string; incident: IncidentRow; update: UpdateRow; environment?: string }): RenderedEmail {
  const { locale, incident: i, update: u, base } = input;
  const s = COPY[locale];
  const title = locale === 'ar' ? i.title_ar : i.title_en;
  const body = locale === 'ar' ? u.body_ar : u.body_en;
  const label = STATUS_LABELS[u.status]?.[locale] ?? u.status;
  const comps = publicComponents(i.components).map((c) => componentName(c, locale)).join(locale === 'ar' ? '، ' : ', ');
  const rows: [string, string][] = [
    [s.status, `${s.kind[i.kind]} · ${label}`],
    [s.affected, comps],
  ];
  if (i.kind === 'maintenance' && i.ends_at) rows.push([s.window, s.windowValue(formatEmailDate(i.starts_at, locale, true), formatEmailDate(i.ends_at, locale, true))]);
  const unsub = unsubscribeUrl(base, locale, input.token);
  const blocks: EmailBlock[] = [{ kind: 'facts', rows }, ...body.split(/\n{2,}/).map((text) => ({ kind: 'p' as const, text }))];
  const doc: EmailDoc = {
    locale,
    subject: `${envTag(input.environment)}${s.subject(title, label)}`.slice(0, 250),
    preheader: body.replace(/\s+/g, ' ').slice(0, 120),
    heading: title,
    blocks,
    cta: { label: s.view, url: `${base}${lp(locale)}/incidents/${encodeURIComponent(i.id)}` },
    after: [{ kind: 'small', text: s.unsubscribeNote }, { kind: 'link', label: s.unsubscribe, url: unsub }],
    signoff: s.sign,
    reason: s.reason,
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text, headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

/** The double opt-in email. */
export function renderConfirmEmail(input: { to: string; locale: Locale; token: string; base: string; environment?: string }): RenderedEmail {
  const s = COPY[input.locale];
  const doc: EmailDoc = {
    locale: input.locale,
    subject: `${envTag(input.environment)}${s.confirmSubject}`,
    preheader: s.confirmPreheader,
    heading: s.confirmHeading,
    blocks: [{ kind: 'p', text: s.confirmBody }],
    cta: { label: s.confirmCta, url: `${input.base}${lp(input.locale)}/subscribe/confirm?t=${encodeURIComponent(input.token)}` },
    after: [{ kind: 'small', text: s.confirmIgnore(formatNumber(input.locale, STATUS_CONFIRM_DAYS)) }],
    signoff: s.sign,
    reason: s.confirmReason,
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

// ---------------------------------------------------------------- webhooks

/**
 * An admin-entered webhook URL: https, no credentials, a public host name (no IP literal,
 * localhost or internal names). Returns the normalised URL or an error message.
 */
export function validateWebhookUrl(raw: unknown, environment?: string): { url: string } | { error: string } {
  if (typeof raw !== 'string' || raw.length > 500) return { error: 'url must be an https URL of at most 500 characters' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'url must be an https URL' };
  }
  if (u.protocol !== 'https:') return { error: 'url must use https' };
  if (u.port) return { error: 'url must use the default https port' };
  if (u.username || u.password) return { error: 'url must not contain a user name or password' };
  // A fully qualified name may end in dots (`localhost.`); strip them so the suffix rules see the real name
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return { error: 'url must use a public host name' };
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return { error: 'url must use a public host name' };
  // Reserved for testing (RFC 2606): the local stack's fake receiver lives under .test
  if (environment === 'production' && /\.(test|example|invalid)$/.test(host)) return { error: 'url must use a public host name' };
  u.hash = '';
  return { url: u.toString() };
}

/** A new signing secret: `whsec_` and 32 random bytes in hex. */
export function newWebhookSecret(): string {
  return `whsec_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function signWebhook(secret: string, timestamp: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`)));
  return `sha256=${Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function webhookPayload(notification: Pick<NotificationRow, 'id' | 'event'>, i: IncidentRow, u: UpdateRow, base: string, environment: string, now: Date): StatusWebhookPayload {
  return {
    type: `${i.kind}.${notification.event}`,
    id: notification.id,
    environment,
    sentAt: now.toISOString(),
    incident: {
      id: i.id,
      kind: i.kind,
      title: { en: i.title_en, ar: i.title_ar },
      status: i.status,
      impact: i.impact,
      components: publicComponents(i.components),
      startsAt: i.starts_at,
      endsAt: i.ends_at,
      resolvedAt: i.resolved_at,
      url: `${base}/incidents/${encodeURIComponent(i.id)}`,
    },
    update: { status: u.status, body: { en: u.body_en, ar: u.body_ar }, at: u.created_at },
  };
}

type SendResult = { status: 'sent' | 'sunk' | 'skipped' | 'queued' | 'failed'; error?: string; retryable?: boolean };

async function postWebhook(url: string, secret: string, payload: StatusWebhookPayload, fetchImpl: typeof fetch): Promise<SendResult> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.parse(payload.sentAt) / 1000));
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AlUmmahNow-Status-Webhook/1',
        [STATUS_WEBHOOK_HEADERS.event]: payload.type,
        [STATUS_WEBHOOK_HEADERS.delivery]: payload.id,
        [STATUS_WEBHOOK_HEADERS.timestamp]: timestamp,
        [STATUS_WEBHOOK_HEADERS.signature]: await signWebhook(secret, timestamp, body),
      },
      body,
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { status: 'sent' };
    return { status: 'failed', error: `webhook answered ${res.status}`, retryable: res.status === 408 || res.status === 429 || res.status >= 500 };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), retryable: true };
  }
}

// ---------------------------------------------------------------- deliver

async function deliver(env: StatusNotifyEnv, msg: QueueMessageLike<Extract<StatusNotifyJob, { kind: 'status-deliver' }>>, now: Date, fetchImpl: typeof fetch): Promise<Outcome> {
  const db = env.STATUS_DB!;
  const { notificationId, subscriberId } = msg.body;
  const row = await db.prepare('SELECT status FROM deliveries WHERE notification_id = ? AND subscriber_id = ?').bind(notificationId, subscriberId).first<{ status: string }>();
  if (!row || row.status !== 'queued') return 'done';
  const mark = (status: string, error: string | null = null) =>
    db.prepare('UPDATE deliveries SET status = ?, attempts = ?, error = ?, updated_at = ? WHERE notification_id = ? AND subscriber_id = ?').bind(status, msg.attempts, error, now.toISOString(), notificationId, subscriberId).run();

  const [sub, n] = await Promise.all([loadSubscriber(db, subscriberId), loadNotification(db, notificationId)]);
  const [incident, update] = n ? await Promise.all([loadIncident(db, n.incident_id), loadUpdate(db, notificationId)]) : [null, null];
  // Unsubscribed, or the incident was deleted since: nothing to send
  if (!sub || sub.status !== 'active' || !n || !incident || incident.deleted_at || !update || !publicComponents(incident.components).length) {
    await mark('skipped');
    return 'done';
  }
  const base = statusPageUrl(env);
  let result: SendResult;
  if (sub.kind === 'email') {
    if (!sub.token) {
      await mark('skipped', 'no unsubscribe token');
      return 'done';
    }
    const email = renderIncidentEmail({ to: sub.address, locale: sub.locale, token: sub.token, base, incident, update, environment: env.ENVIRONMENT });
    result = await sendContactEmail(env, email, { idempotencyKey: `status-${notificationId}-${subscriberId}`, fetchImpl });
  } else {
    const destination = validateWebhookUrl(sub.address, env.ENVIRONMENT);
    result = 'error' in destination
      ? { status: 'failed', error: destination.error }
      : await postWebhook(destination.url, sub.secret ?? '', webhookPayload(n, incident, update, base, env.ENVIRONMENT, now), fetchImpl);
  }
  if (result.status !== 'failed') {
    // sent, or sunk (an E2E address outside production); skipped/queued never come back from a send
    await mark(result.status === 'sunk' ? 'sunk' : 'sent');
    return 'done';
  }
  if (result.retryable && msg.attempts < STATUS_MAX_ATTEMPTS) {
    await mark('queued', result.error ?? null);
    logger.warn('[StatusNotify] Delivery failed; will retry', { notificationId, subscriberId, kind: sub.kind, attempts: msg.attempts, error: result.error });
    return 'retry';
  }
  const reason = result.error ?? 'send failed';
  await mark('failed', reason.slice(0, 300));
  logger.error('[StatusNotify] Delivery failed for good', { alert: 'status_notify_failed', notificationId, subscriberId, kind: sub.kind, attempts: msg.attempts, reason });
  await toDlq(env, `status-${notificationId}-${subscriberId}`, `Status ${sub.kind} delivery of ${notificationId} failed after ${msg.attempts} attempt(s): ${reason}`, msg.body);
  const failed = await db.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE notification_id = ? AND status = 'failed'").bind(notificationId).first<{ n: number }>();
  await flag(env, {
    key: notifyItemKey(notificationId),
    title: 'Status update not delivered to every subscriber',
    message: `Status update for "${incident.title_en}" not delivered to ${failed?.n ?? 1} subscriber(s); last error (${sub.kind}): ${reason}`,
    handler: 'status-notify',
    id: notificationId,
    itemId: incident.id,
  });
  return 'failed';
}

// ---------------------------------------------------------------- confirm

async function sendConfirm(env: StatusNotifyEnv, msg: QueueMessageLike<Extract<StatusNotifyJob, { kind: 'status-confirm' }>>, fetchImpl: typeof fetch): Promise<Outcome> {
  const db = env.STATUS_DB!;
  const sub = await loadSubscriber(db, msg.body.subscriberId);
  // Confirmed or gone since: nothing to send
  if (!sub || sub.kind !== 'email' || sub.status !== 'pending' || !sub.token) return 'done';
  const email = renderConfirmEmail({ to: sub.address, locale: sub.locale, token: sub.token, base: statusPageUrl(env), environment: env.ENVIRONMENT });
  const result = await sendContactEmail(env, email, { idempotencyKey: `status-confirm-${sub.id}-${sub.confirm_sent_at ?? ''}`, fetchImpl });
  if (result.status !== 'failed') return 'done';
  if (result.retryable && msg.attempts < STATUS_MAX_ATTEMPTS) {
    logger.warn('[StatusNotify] Confirmation email failed; will retry', { subscriberId: sub.id, attempts: msg.attempts, error: result.error });
    return 'retry';
  }
  const reason = result.error ?? 'send failed';
  logger.error('[StatusNotify] Confirmation email failed for good', { alert: 'status_confirm_failed', subscriberId: sub.id, attempts: msg.attempts, reason });
  await toDlq(env, `status-confirm-${sub.id}`, `Status subscription confirmation ${sub.id} failed after ${msg.attempts} attempt(s): ${reason}`, msg.body);
  await flag(env, { key: confirmItemKey(sub.id), title: 'Status subscription confirmation not sent', message: `Status subscription confirmation email not sent: ${reason}`, handler: 'status-confirm', id: sub.id, itemId: sub.id });
  return 'failed';
}

// ---------------------------------------------------------------- consumer

/** Runs one job. Never throws; the caller acks or retries by the outcome. */
export async function processStatusNotifyJob(env: StatusNotifyEnv, msg: QueueMessageLike<unknown>, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<Outcome> {
  const job = msg.body;
  if (!isStatusNotifyJob(job) || job.v !== STATUS_NOTIFY_VERSION) {
    logger.error('[StatusNotify] Malformed job dropped', { id: msg.id });
    return 'done';
  }
  if (!env.STATUS_DB) {
    logger.error('[StatusNotify] STATUS_DB is not bound');
    return msg.attempts < STATUS_MAX_ATTEMPTS ? 'retry' : 'failed';
  }
  try {
    if (job.kind === 'status-fanout') return await fanout(env, job, now);
    if (job.kind === 'status-confirm') return await sendConfirm(env, msg as QueueMessageLike<typeof job>, fetchImpl);
    return await deliver(env, msg as QueueMessageLike<typeof job>, now, fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < STATUS_MAX_ATTEMPTS) {
      logger.warn('[StatusNotify] Job errored; will retry', { kind: job.kind, attempts: msg.attempts, error: reason });
      return 'retry';
    }
    logger.error('[StatusNotify] Job failed for good', { alert: 'status_notify_failed', kind: job.kind, attempts: msg.attempts, error: reason });
    await toDlq(env, `status-${job.kind}-${'notificationId' in job ? job.notificationId : job.subscriberId}`, `Status ${job.kind} failed after ${msg.attempts} attempt(s): ${reason}`, job);
    if (job.kind === 'status-fanout') {
      await flag(env, { key: notifyItemKey(job.notificationId), title: 'Status update not sent to subscribers', message: `Status fan-out failed: ${reason}`, handler: 'status-notify', id: job.notificationId, itemId: job.notificationId });
    }
    return 'failed';
  }
}

/** Queue consumer for STATUS_NOTIFY_QUEUE. */
export async function statusNotifyConsumer(batch: { messages: readonly QueueMessageLike<unknown>[] }, env: StatusNotifyEnv): Promise<void> {
  const startedAt = Date.now();
  const outcomes: Record<string, number> = {};
  for (const msg of batch.messages) {
    const outcome = await processStatusNotifyJob(env, msg);
    const kind = (msg.body as { kind?: string } | undefined)?.kind ?? 'unknown';
    outcomes[`${kind}:${outcome}`] = (outcomes[`${kind}:${outcome}`] ?? 0) + 1;
    if (outcome === 'retry') msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
    else msg.ack();
  }
  logger.job({
    job: 'status-notify-batch',
    outcome: Object.keys(outcomes).some((k) => k.endsWith(':retry') || k.endsWith(':failed')) ? 'retry' : 'ok',
    messages: batch.messages.length,
    outcomes,
    durationMs: Date.now() - startedAt,
  });
}

// ---------------------------------------------------------------- retry (Errors page, admin)

/**
 * Queues a notification again: its fan-out when that never finished, else every failed delivery.
 * Returns how many jobs were queued, or null when the queue refused them.
 */
export async function retryNotification(env: StatusNotifyEnv, notificationId: string, now = new Date()): Promise<{ queued: number } | null | 'gone'> {
  const db = env.STATUS_DB;
  if (!db) return null;
  const n = await loadNotification(db, notificationId);
  if (!n) return 'gone';
  if (!n.fanned_out_at) return (await enqueue(env, [{ v: STATUS_NOTIFY_VERSION, kind: 'status-fanout', notificationId }])) ? { queued: 1 } : null;
  const failed = (await db.prepare("SELECT subscriber_id FROM deliveries WHERE notification_id = ? AND status = 'failed'").bind(notificationId).all<{ subscriber_id: string }>()).results ?? [];
  if (!failed.length) return { queued: 0 };
  await db.prepare("UPDATE deliveries SET status = 'queued', error = NULL, updated_at = ? WHERE notification_id = ? AND status = 'failed'").bind(now.toISOString(), notificationId).run();
  const ok = await enqueue(env, failed.map((d) => ({ v: STATUS_NOTIFY_VERSION, kind: 'status-deliver' as const, notificationId, subscriberId: d.subscriber_id })));
  if (!ok) {
    await db.prepare("UPDATE deliveries SET status = 'failed', error = 'could not queue', updated_at = ? WHERE notification_id = ? AND status = 'queued'").bind(now.toISOString(), notificationId).run();
    return null;
  }
  return { queued: failed.length };
}

/** Queues a pending subscriber's confirmation email again. */
export async function retryConfirm(env: StatusNotifyEnv, subscriberId: string): Promise<'queued' | 'gone' | null> {
  const db = env.STATUS_DB;
  if (!db) return null;
  const sub = await loadSubscriber(db, subscriberId);
  if (!sub || sub.status !== 'pending') return 'gone';
  return (await enqueue(env, [{ v: STATUS_NOTIFY_VERSION, kind: 'status-confirm', subscriberId }])) ? 'queued' : null;
}
