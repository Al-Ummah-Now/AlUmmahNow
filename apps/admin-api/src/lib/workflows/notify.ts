/**
 * Approval workflow notices by email (wiki AUN-WORKFLOWS §9, WF-4).
 *
 * Each committed step queues one job on the contact mail queue (CONTACT_MAIL_QUEUE; lib/contact-mail-queue.ts
 * routes `kind: 'workflow_notify'` here), which shares its retries with back-off and its DLQ. The job
 * emails each recipient once, in one language (the recipient's saved email language, else English),
 * in the shared branded layout, with one button: Review request (the admin page). It never approves
 * from the email (WF-D5). Resend gets an Idempotency-Key per request, event and recipient, so a retry
 * after a partial failure sends nobody a second copy.
 *
 * The address is the sign-in account's (GET /users/:id/account-email): someone without an account gets
 * no email, and the job retries while accounts cannot be read.
 *
 * Recipients: those the engine names (the proposer and the eligible approvers), plus the rule's extra
 * notify list. Each must still be allowed to read the request when the email goes out (its stored domain
 * and the staff and finance lists as they are then). Email is skipped when the rule turns email off; the
 * in-app count still shows it.
 */
import { currencyExponent, workflowFieldChanged, workflowFieldPeople, workflowFieldShown, type AccountEmailContact, type WorkflowField, type WorkflowRequestView } from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { callVideos, VideosError, type VideosClientEnv } from '../content/videosClient';
import { envTag, sendContactEmail } from '../contact-email';
import { renderEmail, type EmailBlock, type EmailDoc, type EmailLocale } from '../email/layout';
import { emailRow, inDirection, isolate } from '../email/direction';
import type { QueueMessageLike } from '../contact-mail-queue';
import { logger } from '../logger';
import { createWorkflowDirectory, ownerIdsFrom } from './directory';
import { getRequestView, WorkflowError } from './engine';
import { mayReadRequest } from './visibility';
import type { WorkflowEvent } from './types';
import type { D1Database } from '../types';


export const WORKFLOW_NOTIFY_VERSION = 1;

export interface WorkflowNotifyJob {
  v: typeof WORKFLOW_NOTIFY_VERSION;
  kind: 'workflow_notify';
  requestId: string;
  event: WorkflowEvent['kind'];
  actor: string;
  recipients: string[];
}

export function isWorkflowNotifyJob(body: unknown): body is WorkflowNotifyJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'workflow_notify';
}

type NotifyEnv = AdminBindings & VideosClientEnv & { ADMIN_WEB_URL?: string; ENVIRONMENT?: string; PLATFORM_OWNER_USER_IDS?: string };

/** Queues the notice for a committed step. Comments notify in-app only. Never throws. */
export async function enqueueWorkflowNotify(env: Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'>, e: WorkflowEvent): Promise<void> {
  if (e.kind === 'commented' || !e.recipients.length) return;
  if (!env.CONTACT_MAIL_QUEUE) {
    logger.error('[WorkflowNotify] CONTACT_MAIL_QUEUE is not bound', { requestId: e.requestId });
    return;
  }
  const job: WorkflowNotifyJob = { v: WORKFLOW_NOTIFY_VERSION, kind: 'workflow_notify', requestId: e.requestId, event: e.kind, actor: e.actor, recipients: e.recipients.slice(0, 100) };
  await env.CONTACT_MAIL_QUEUE.send(job as never, { contentType: 'json' }).catch((error: unknown) =>
    logger.error('[WorkflowNotify] Enqueue failed', { requestId: e.requestId, event: e.kind, error: String(error) }),
  );
}

const COPY = {
  en: {
    subject: {
      proposed: (t: string) => `Approval needed: ${t}`,
      approved: (t: string) => `Approved: ${t}`,
      applied: (t: string) => `Now in effect: ${t}`,
      rejected: (t: string) => `Rejected: ${t}`,
      withdrawn: (t: string) => `Withdrawn: ${t}`,
      expired: (t: string) => `Expired: ${t}`,
      stale: (t: string) => `Out of date: ${t}`,
      failed: (t: string) => `Couldn’t take effect: ${t}`,
    },
    intro: {
      proposed: (who: string) => `${who} asked for this change. It takes effect only after it is approved.`,
      approved: (who: string) => `${who} approved this change.`,
      applied: () => 'This change is now in effect.',
      rejected: (who: string) => `${who} rejected this change. Nothing was changed.`,
      withdrawn: (who: string) => `${who} withdrew this request. Nothing was changed.`,
      expired: () => 'Nobody approved this request in time, so it expired. Nothing was changed.',
      stale: () => 'What this request would change was changed another way first, so it can’t be approved. Propose it again with the current values if it is still needed.',
      failed: () => 'This change was approved but couldn’t take effect. It is on the Errors page with Retry.',
    },
    reason: 'Reason',
    rejection: 'Why it was rejected',
    changes: 'What changes',
    approvals: (n: number, of: number) => `Approvals: ${n} of ${of}`,
    expires: (d: string) => `Waiting until ${d} (UTC).`,
    cta: 'Review request',
    yes: 'Yes',
    no: 'No',
    none: '—',
    someone: 'Someone',
    deleted: 'Deleted account',
    andMore: (names: string, n: number) => `${names} and ${n} more`,
    system: 'Al Ummah Now',
    replaced: 'Replaced',
    footer: 'You received this email because you can approve, or asked for, changes in the Al Ummah Now admin.',
    sign: 'Al Ummah Now',
  },
  ar: {
    subject: {
      proposed: (t: string) => `موافقة مطلوبة: ${t}`,
      approved: (t: string) => `تمت الموافقة: ${t}`,
      applied: (t: string) => `أصبح نافذًا: ${t}`,
      rejected: (t: string) => `مرفوض: ${t}`,
      withdrawn: (t: string) => `مسحوب: ${t}`,
      expired: (t: string) => `انتهت صلاحيته: ${t}`,
      stale: (t: string) => `لم يعد صالحًا: ${t}`,
      failed: (t: string) => `تعذّر تنفيذه: ${t}`,
    },
    intro: {
      proposed: (who: string) => `طلب ${who} هذا التغيير. لا يصبح نافذًا إلا بعد الموافقة عليه.`,
      approved: (who: string) => `وافق ${who} على هذا التغيير.`,
      applied: () => 'أصبح هذا التغيير نافذًا الآن.',
      rejected: (who: string) => `رفض ${who} هذا التغيير. لم يتغيّر شيء.`,
      withdrawn: (who: string) => `سحب ${who} هذا الطلب. لم يتغيّر شيء.`,
      expired: () => 'لم يوافق أحد على هذا الطلب في الوقت المحدّد فانتهت صلاحيته. لم يتغيّر شيء.',
      stale: () => 'تغيّر ما يريد هذا الطلب تغييره بطريقة أخرى أولًا، فلا يمكن الموافقة عليه. اقترحه مرة أخرى بالقيم الحالية إن كان لا يزال مطلوبًا.',
      failed: () => 'تمت الموافقة على هذا التغيير لكن تعذّر تنفيذه. تجده في صفحة الأخطاء مع زر إعادة المحاولة.',
    },
    reason: 'السبب',
    rejection: 'سبب الرفض',
    changes: 'ما الذي يتغيّر',
    approvals: (n: number, of: number) => `الموافقات: ${arDigits(n)} من ${arDigits(of)}`,
    expires: (d: string) => `ينتظر حتى ${d} (بالتوقيت العالمي).`,
    cta: 'مراجعة الطلب',
    yes: 'نعم',
    no: 'لا',
    none: '—',
    someone: 'أحد المشرفين',
    deleted: 'حساب محذوف',
    andMore: (names: string, n: number) => `${names} و${arDigits(n)} غيرهم`,
    system: 'الأمة الآن',
    replaced: 'استُبدل',
    footer: 'وصلك هذا البريد لأنك تستطيع الموافقة على تغييرات في لوحة إدارة الأمة الآن أو لأنك طلبتها.',
    sign: 'الأمة الآن',
  },
} as const;

/** Eastern Arabic digits, never grouped (O35, O38). */
export function arDigits(v: number | string): string {
  return String(v).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/** One side of a change: a list in the email's direction, a single value in its own. */
const emailSide = (f: WorkflowField, v: unknown, locale: EmailLocale, names: Map<string, string>) =>
  Array.isArray(v) ? inDirection(locale, fieldValue(f, v, locale, names)) : isolate(fieldValue(f, v, locale, names));

/** How many people of a list an email names (each name is one lookup); the request page names them all. */
const EMAIL_PEOPLE = 5;

const dateText = (iso: string, locale: EmailLocale) => {
  const d = iso.slice(0, 16).replace('T', ' ');
  return locale === 'ar' ? arDigits(d) : d;
};

/** One field value as plain text in the email's language. */
export function fieldValue(f: WorkflowField, v: unknown, locale: EmailLocale, names: Map<string, string>): string {
  const c = COPY[locale];
  if (v === null || v === undefined || v === '') return c.none;
  if (f.kind === 'secret') return v === 'replaced' ? c.replaced : c.none;
  if (f.kind === 'bool') return v ? c.yes : c.no;
  if (f.kind === 'person') {
    if (!Array.isArray(v)) return names.get(String(v)) ?? c.someone;
    // Each name isolated (FSI…PDI), as admin-web's workflowValue does: a Latin name must not reorder an Arabic list
    const shown = v.slice(0, EMAIL_PEOPLE).map((id) => isolate(names.get(String(id)) ?? c.someone)).join(locale === 'ar' ? '، ' : ', ');
    return v.length > EMAIL_PEOPLE ? c.andMore(shown, v.length - EMAIL_PEOPLE) : shown;
  }
  const label = (x: unknown) => f.enumLabels?.[String(x)]?.[locale] ?? String(x);
  if (Array.isArray(v)) return v.map((x) => isolate(label(x))).join(locale === 'ar' ? '، ' : ', ');
  if (f.kind === 'enum') return label(v);
  if (f.kind === 'money' && typeof v === 'number') {
    // Minor units with the currency's own exponent (JPY 0, USD 2, KWD 3)
    const exp = f.currency ? currencyExponent(f.currency) : 2;
    const s = `${(v / 10 ** exp).toFixed(exp)} ${f.currency ?? ''}`.trim();
    return locale === 'ar' ? arDigits(s.replace('.', '٫')) : s;
  }
  // bps: basis points (290 = 2.9%); percent: the number itself (2.9 = 2.9%)
  if ((f.kind === 'bps' || f.kind === 'percent') && typeof v === 'number') {
    const pct = String(f.kind === 'bps' ? v / 100 : v);
    return locale === 'ar' ? `٪${arDigits(pct.replace('.', '٫'))}` : `${pct}%`;
  }
  if (f.kind === 'date') return dateText(String(v), locale);
  return locale === 'ar' ? arDigits(String(v)) : String(v);
}

export function renderWorkflowEmail(input: {
  to: string;
  locale: EmailLocale;
  event: Exclude<WorkflowEvent['kind'], 'commented'>;
  request: WorkflowRequestView;
  actorName: string;
  names: Map<string, string>;
  adminUrl?: string;
  environment?: string;
}) {
  const { locale, request: r, event } = input;
  const c = COPY[locale];
  const title = r.title[locale];
  const blocks: EmailBlock[] = [{ kind: 'p', text: c.intro[event](input.actorName) }];
  if (r.reason) blocks.push({ kind: 'quote', label: c.reason, text: r.reason });
  const rejection = event === 'rejected' ? [...r.steps].reverse().find((s) => s.kind === 'reject')?.note : null;
  if (rejection) blocks.push({ kind: 'quote', label: c.rejection, text: rejection });
  const changed = r.fields.filter(workflowFieldShown).slice(0, 12);
  if (changed.length) {
    blocks.push({ kind: 'p', text: c.changes });
    blocks.push({ kind: 'facts', rows: changed.map((f): [string, string] => {
      // Someone the change is about (nothing to compare): just who
      if (f.kind === 'person' && (f.before === null || !workflowFieldChanged(f))) return [f.label[locale], emailRow(locale, Array.isArray(f.after) ? fieldValue(f, f.after, locale, input.names) : isolate(fieldValue(f, f.after, locale, input.names)))];
      return [f.label[locale], emailRow(locale, `${emailSide(f, f.before, locale, input.names)}${locale === 'ar' ? ' ← ' : ' → '}${emailSide(f, f.after, locale, input.names)}`)];
    }) });
  }
  const after: EmailBlock[] = [];
  if (event === 'proposed' || event === 'approved') {
    after.push({ kind: 'small', text: c.approvals(r.approvalsCount, r.approvalsNeeded) });
    if (r.status === 'pending') after.push({ kind: 'small', text: c.expires(dateText(r.expiresAt, locale)) });
  }
  const doc: EmailDoc = {
    locale,
    subject: `${envTag(input.environment)}${c.subject[event](title)}`,
    preheader: c.intro[event](input.actorName),
    heading: title,
    blocks,
    cta: input.adminUrl ? { label: c.cta, url: `${input.adminUrl.replace(/\/$/, '')}/approvals/${encodeURIComponent(r.id)}` } : undefined,
    after,
    signoff: c.sign,
    reason: c.footer,
  };
  const { subject, html, text } = renderEmail(doc);
  return { to: input.to, subject, html, text };
}

async function contactOf(env: NotifyEnv, userId: string): Promise<AccountEmailContact | null> {
  try {
    return await callVideos<AccountEmailContact>(env, `/users/${encodeURIComponent(userId)}/account-email`);
  } catch (error) {
    if (error instanceof VideosError && error.status === 404) return null;
    throw error;
  }
}

/** Delivers one job. 'retry' on a transient failure (the queue backs off); 'done' otherwise. */
export async function processWorkflowNotifyJob(env: NotifyEnv, msg: QueueMessageLike<WorkflowNotifyJob>): Promise<'done' | 'retry'> {
  const job = msg.body;
  if (job.v !== WORKFLOW_NOTIFY_VERSION || !job.requestId || job.event === 'commented') return 'done';
  const db = env.SEARCH_DB as D1Database | undefined;
  const reportsDb = env.REPORTS_DB as D1Database | undefined;
  // Both say who may read the request
  if (!db || !reportsDb) return 'retry';
  try {
    const ctx = { db, directory: createWorkflowDirectory({ searchDb: db, reportsDb, ownerIds: ownerIdsFrom(env.PLATFORM_OWNER_USER_IDS) }), now: () => new Date() };
    let request: WorkflowRequestView;
    try {
      request = await getRequestView(ctx, job.requestId);
    } catch (error) {
      // Only a request that no longer exists ends the job; anything else (D1 unavailable) retries
      if (error instanceof WorkflowError && error.code === 'not_found') return 'done';
      throw error;
    }
    const ruleRow = await db.prepare('SELECT rule FROM workflow_requests WHERE id = ?').bind(job.requestId).first<{ rule: string }>();
    const rule = ruleRow ? (JSON.parse(ruleRow.rule) as { notify?: { email?: boolean; extra?: unknown[] } }) : null;
    if (rule?.notify?.email === false) return 'done';
    const extra = Array.isArray(rule?.notify?.extra) && rule!.notify!.extra!.length ? await ctx.directory.candidates(rule!.notify!.extra as never) : [];
    const recipients = [...new Set([...job.recipients, ...extra])].filter((u) => u !== job.actor && u !== 'system');

    const names = new Map<string, string>();
    const gone = new Set<string>();
    const people = new Set<string>([job.actor, ...workflowFieldPeople(request.fields, EMAIL_PEOPLE)]);
    for (const id of people) {
      if (id === 'system') continue;
      const contact = await contactOf(env, id).catch(() => undefined);
      if (contact?.displayName) names.set(id, contact.displayName);
      // No such account any more (a failed lookup is not that: it shows as "a team member")
      else if (contact === null) gone.add(id);
    }
    let sent = 0;
    for (const userId of recipients) {
      // Named when the step was made, or by the rule; what counts is who may read it now
      if (!mayReadRequest(await ctx.directory.facts(userId), request.domain)) continue;
      const contact = await contactOf(env, userId);
      const to = contact?.email?.trim();
      if (!contact || !to || !to.includes('@')) continue;
      const locale: EmailLocale = contact.locale === 'ar' ? 'ar' : 'en';
      const named = new Map([...names, ...[...gone].map((id): [string, string] => [id, COPY[locale].deleted])]);
      const actorName = job.actor === 'system' ? COPY[locale].system : (named.get(job.actor) ?? COPY[locale].someone);
      const email = renderWorkflowEmail({ to, locale, event: job.event, request, actorName, names: named, adminUrl: env.ADMIN_WEB_URL, environment: env.ENVIRONMENT });
      // One key per request, event, actor and recipient: a retried job never sends anyone a second copy
      const result = await sendContactEmail(env as never, email, { idempotencyKey: `workflow-${job.requestId}-${job.event}-${job.actor}-${userId}` });
      if (result.status === 'failed') {
        if (result.retryable) throw new Error(`send failed for ${job.requestId}: ${result.error ?? ''}`);
        logger.error('[WorkflowNotify] Email not sent', { requestId: job.requestId, event: job.event, error: result.error });
        continue;
      }
      sent++;
    }
    logger.debug('[WorkflowNotify] Delivered', { requestId: job.requestId, event: job.event, sent });
    return 'done';
  } catch (error) {
    logger.warn('[WorkflowNotify] Delivery failed, will retry', { requestId: job.requestId, event: job.event, attempts: msg.attempts, error: String(error) });
    return 'retry';
  }
}
