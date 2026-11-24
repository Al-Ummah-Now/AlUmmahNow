/**
 * Cost alert and weekly digest emails (COST-1, O24: only admins who opted in on the Costs page,
 * at the address on their own account, in the language they chose).
 *
 * - When the hourly alert tick opens an alert (budget level, projected overrun, spend spike), one
 *   job per subscriber of that kind goes on the contact mail queue (CONTACT_MAIL_QUEUE, which
 *   routes `kind: 'cost-alert'` jobs here); the weekly digest does the same on its hour.
 * - cost_alert_deliveries keeps one row per email (fingerprint × subscriber) with what it says, so
 *   an alert is emailed once and a Retry sends exactly the same email.
 * - Failures worth retrying back off like contact mail; a final failure marks the row failed and
 *   is flagged on the Errors page with Retry ("cost-alert-email" in lib/errors-actions.ts).
 */
import { COST_DIGEST_TIME_ZONE, formatDate, formatInteger, formatMoney, formatNumber, formatPercent, newErrorRef, scrubEvent, type CostAlertKind } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { envTag, sendContactEmail, type RenderedEmail } from './contact-email';
import { renderEmail, type EmailDoc } from './email/layout';
import { MAX_ATTEMPTS, type QueueMessageLike } from './contact-mail-queue';
import { logger } from './logger';
import type { CostAlert, CostAlertData } from './opsCost';
import type { CapacityMailPayload } from './d1Capacity';
import type { D1Database } from './types';

export const COST_MAIL_VERSION = 1;

export interface CostAlertMailJob {
  v: typeof COST_MAIL_VERSION;
  kind: 'cost-alert';
  fingerprint: string;
  userId: string;
}

export function isCostAlertMailJob(body: unknown): body is CostAlertMailJob {
  return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === 'cost-alert';
}

/** The weekly digest's numbers (built by the tick from the dashboard). */
export interface CostDigest {
  type: 'digest';
  week: string;
  mtd: number;
  cap: number | null;
  projected: number;
  lastWeek: number;
  weekBefore: number;
  products: { product: string; mtd: number }[];
  envs: Record<string, number>;
  movers: { label: string; env: string; change: number }[];
  openAlerts: number;
}

export type CostMailPayload = CostAlertData | CostDigest | CapacityMailPayload;

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

const PRODUCT_NAMES: Record<'en' | 'ar', Record<string, string>> = {
  en: { workers: 'Workers', d1: 'D1', kv: 'KV', r2: 'R2', queues: 'Queues', durable_objects: 'Durable Objects', containers: 'Containers', workers_ai: 'Workers AI', bunny: 'Bunny', resend: 'Resend', plan: 'Workers Paid plan' },
  ar: { workers: 'Workers', d1: 'D1', kv: 'KV', r2: 'R2', queues: 'الطوابير (Queues)', durable_objects: 'Durable Objects', containers: 'الحاويات (Containers)', workers_ai: 'Workers AI', bunny: 'Bunny', resend: 'Resend', plan: 'خطة Workers المدفوعة' },
};
const ENV_NAMES: Record<'en' | 'ar', Record<string, string>> = {
  en: { production: 'Production', stage: 'Stage', qa: 'QA', account: 'Account-wide' },
  ar: { production: 'الإنتاج', stage: 'المرحلة التجريبية', qa: 'بيئة الاختبار', account: 'على مستوى الحساب' },
};

const COPY = {
  en: {
    budgetSubject: (pct: string) => `Costs: ${pct} of the monthly budget used`,
    budgetHeading: (pct: string) => `${pct} of this month's budget is used`,
    projectedSubject: 'Costs: projected to go over the monthly budget',
    projectedHeading: 'This month is projected to go over budget',
    spikeSubject: (name: string) => `Costs: spending jumped on ${name}`,
    spikeHeading: 'Daily spending jumped',
    digestSubject: (week: string) => `Costs: weekly digest (week of ${week})`,
    digestHeading: 'Your weekly cost digest',
    capacitySubject: (what: string) => `Capacity: ${what} needs attention`,
    capacityHeading: 'A database is getting close to a Cloudflare limit',
    capacityMetric: {
      storage_pct: 'Size, share of the database limit',
      storage_days_to_70: 'Days until 70% of the database limit',
      busy_pct: 'Busy, share of each hour spent running queries',
      account_storage_pct: 'D1 storage, share of the account limit',
    },
    capacityWhat: 'Database',
    capacityAccount: 'All D1 databases on the account',
    capacityValue: 'Now',
    capacityThreshold: 'Alert at',
    capacityDays: (n: string) => `${n} days`,
    capacityNext: 'The Databases section of the Costs page shows every database and what to do next.',
    spent: 'Spent this month',
    budget: 'Monthly budget',
    budgetUnset: 'Not set',
    projected: 'Projected for the month',
    month: 'Month',
    what: 'What',
    environment: 'Environment',
    day: 'Day',
    cost: 'Cost that day',
    baseline: `Average day before`,
    lastWeek: (n: string) => `Last ${n} days`,
    weekBefore: (n: string) => `The ${n} days before`,
    openAlerts: 'Open cost alerts',
    byProduct: 'Biggest products this month',
    byEnv: 'By environment this month',
    movers: (n: string) => `Biggest changes over the last ${n} days`,
    envTotal: (env: string) => `${env} total`,
    estimate: 'Estimates at list prices; your bill may differ.',
    cta: 'Open Costs',
    settings: 'Change which cost emails you get on the Costs page.',
    reason: 'You received this email because you subscribed to cost alerts in the Al Ummah Now videos admin.',
    preheader: 'Platform costs against the monthly budget.',
    sign: 'Al Ummah Now',
  },
  ar: {
    budgetSubject: (pct: string) => `التكاليف: استُخدم ${pct} من ميزانية الشهر`,
    budgetHeading: (pct: string) => `استُخدم ${pct} من ميزانية هذا الشهر`,
    projectedSubject: 'التكاليف: يُتوقع تجاوز ميزانية الشهر',
    projectedHeading: 'يُتوقع أن يتجاوز هذا الشهر الميزانية',
    spikeSubject: (name: string) => `التكاليف: قفزة في الإنفاق على ${name}`,
    spikeHeading: 'قفز الإنفاق اليومي',
    digestSubject: (week: string) => `التكاليف: الملخص الأسبوعي (أسبوع ${week})`,
    digestHeading: 'ملخص التكاليف الأسبوعي',
    capacitySubject: (what: string) => `السعة: ${what} يحتاج إلى متابعة`,
    capacityHeading: 'قاعدة بيانات تقترب من أحد حدود Cloudflare',
    capacityMetric: {
      storage_pct: 'الحجم، نسبةً إلى حد قاعدة البيانات',
      storage_days_to_70: 'الأيام المتبقية حتى ٧٠٪ من حد قاعدة البيانات',
      busy_pct: 'الانشغال، نسبة كل ساعة في تنفيذ الاستعلامات',
      account_storage_pct: 'تخزين D1، نسبةً إلى حد الحساب',
    },
    capacityWhat: 'قاعدة البيانات',
    capacityAccount: 'كل قواعد بيانات D1 في الحساب',
    capacityValue: 'الآن',
    capacityThreshold: 'التنبيه عند',
    capacityDays: (n: string) => `${n} يومًا`,
    capacityNext: 'يعرض قسم قواعد البيانات في صفحة التكاليف كل قاعدة بيانات وما يجب فعله بعد ذلك.',
    spent: 'المُنفق هذا الشهر',
    budget: 'الميزانية الشهرية',
    budgetUnset: 'غير محددة',
    projected: 'المتوقع للشهر',
    month: 'الشهر',
    what: 'البند',
    environment: 'البيئة',
    day: 'اليوم',
    cost: 'تكلفة ذلك اليوم',
    baseline: 'متوسط اليوم قبلها',
    lastWeek: (n: string) => `آخر ${n} أيام`,
    weekBefore: (_n: string) => 'الأيام السبعة التي قبلها',
    openAlerts: 'تنبيهات التكلفة المفتوحة',
    byProduct: 'أكبر المنتجات هذا الشهر',
    byEnv: 'حسب البيئة هذا الشهر',
    movers: (n: string) => `أكبر التغيّرات في آخر ${n} أيام`,
    envTotal: (env: string) => `إجمالي ${env}`,
    estimate: 'تقديرات بأسعار القائمة؛ وقد تختلف فاتورتك.',
    cta: 'افتح صفحة التكاليف',
    settings: 'غيّر رسائل التكاليف التي تصلك من صفحة التكاليف.',
    reason: 'وصلتك هذه الرسالة لأنك اشتركت في تنبيهات التكاليف في لوحة إدارة المرئيات في الأمة الآن.',
    preheader: 'تكاليف المنصة مقارنةً بالميزانية الشهرية.',
    sign: 'الأمة الآن',
  },
} as const;

/** Dollars: "$12.69" / «١٢٫٦٩ دولار أمريكي». */
export function money(v: number, locale: 'en' | 'ar'): string {
  return formatMoney(locale === 'ar' ? 'ar' : 'en-US', v, 'USD');
}

/**
 * A month ("2026-11") or day ("2026-11-14") from the alert: as written in English, a written-out
 * date in Arabic («نوفمبر ٢٠٢٦», «١٤ نوفمبر ٢٠٢٦»).
 */
function isoLabel(iso: string, locale: 'en' | 'ar'): string {
  if (locale !== 'ar') return iso;
  if (/^\d{4}-\d{2}$/.test(iso)) return formatDate('ar', `${iso}-01T00:00:00Z`, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate('ar', `${iso}T00:00:00Z`, { dateStyle: 'long', timeZone: 'UTC' });
  return formatDate('ar', iso, { dateStyle: 'long', timeZone: 'UTC' });
}

/** The digest compares two windows of this many days. */
const WEEK_DAYS = 7;

const signed = (v: number, locale: 'en' | 'ar') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), locale)}`;

export interface CostEmailInput {
  to: string;
  locale: 'en' | 'ar';
  payload: CostMailPayload;
  adminUrl?: string;
  environment?: string;
}

/** One alert or digest email in exactly one language, on the shared branded layout. */
export function renderCostEmail(input: CostEmailInput): RenderedEmail {
  const l = input.locale;
  const s = COPY[l];
  const p = input.payload;
  const env = (e: string) => ENV_NAMES[l][e] ?? e;
  const product = (x: string) => PRODUCT_NAMES[l][x] ?? x;
  let subject: string;
  let heading: string;
  const blocks: EmailDoc['blocks'] = [];
  if (p.type === 'budget') {
    const pct = formatPercent(l, p.level);
    subject = s.budgetSubject(pct);
    heading = s.budgetHeading(pct);
    blocks.push({ kind: 'facts', rows: [[s.month, isoLabel(p.month, l)], [s.spent, money(p.mtd, l)], [s.budget, money(p.cap, l)], [s.projected, money(p.projected, l)]] });
  } else if (p.type === 'projected') {
    subject = s.projectedSubject;
    heading = s.projectedHeading;
    blocks.push({ kind: 'facts', rows: [[s.month, isoLabel(p.month, l)], [s.projected, money(p.projected, l)], [s.budget, money(p.cap, l)], [s.spent, money(p.mtd, l)]] });
    blocks.push({ kind: 'notice', text: s.projectedHeading, tone: 'warning' });
  } else if (p.type === 'spike') {
    const what = p.resource ? p.name : s.envTotal(env(p.env));
    subject = s.spikeSubject(what);
    heading = s.spikeHeading;
    blocks.push({ kind: 'facts', rows: [[s.what, what], [s.environment, env(p.env)], [s.day, isoLabel(p.day, l)], [s.cost, money(p.cost, l)], [s.baseline, money(p.baseline, l)]] });
  } else if (p.type === 'capacity') {
    const what = p.name || s.capacityAccount;
    const show = (v: number | null) =>
      v === null ? '—' : p.metric === 'storage_days_to_70' ? s.capacityDays(formatNumber(l, Math.round(v))) : formatPercent(l, v);
    subject = s.capacitySubject(what);
    heading = s.capacityHeading;
    blocks.push({
      kind: 'facts',
      rows: [
        [s.capacityWhat, what],
        ...(p.name ? ([[s.environment, env(p.env)]] as [string, string][]) : []),
        [s.capacityMetric[p.metric], show(p.value)],
        [s.capacityThreshold, show(p.threshold)],
      ],
    });
    blocks.push({ kind: 'p', text: s.capacityNext });
  } else {
    const days = formatNumber(l, WEEK_DAYS);
    subject = s.digestSubject(isoLabel(p.week, l));
    heading = s.digestHeading;
    blocks.push({ kind: 'facts', rows: [[s.spent, money(p.mtd, l)], [s.budget, p.cap === null ? s.budgetUnset : money(p.cap, l)], [s.projected, money(p.projected, l)], [s.lastWeek(days), money(p.lastWeek, l)], [s.weekBefore(days), money(p.weekBefore, l)], [s.openAlerts, formatInteger(l, p.openAlerts)]] });
    if (p.products.length) {
      blocks.push({ kind: 'p', text: s.byProduct });
      blocks.push({ kind: 'facts', rows: p.products.slice(0, 5).map((x) => [product(x.product), money(x.mtd, l)] as [string, string]) });
    }
    blocks.push({ kind: 'p', text: s.byEnv });
    blocks.push({ kind: 'facts', rows: Object.entries(p.envs).filter(([, v]) => v > 0).map(([k, v]) => [env(k), money(v, l)] as [string, string]) });
    if (p.movers.length) {
      blocks.push({ kind: 'p', text: s.movers(days) });
      blocks.push({ kind: 'facts', rows: p.movers.slice(0, 5).map((m) => [`${product(m.label)} · ${env(m.env)}`, signed(m.change, l)] as [string, string]) });
    }
  }
  if (p.type !== 'capacity') blocks.push({ kind: 'small', text: s.estimate });
  const url = input.adminUrl ? `${input.adminUrl.replace(/\/$/, '')}/costs${p.type === 'capacity' ? '#databases' : ''}` : null;
  const doc: EmailDoc = {
    locale: l,
    subject: `${envTag(input.environment)}${subject}`,
    preheader: s.preheader,
    heading,
    blocks,
    ...(url ? { cta: { label: s.cta, url } } : {}),
    after: [{ kind: 'small', text: s.settings }],
    signoff: s.sign,
    reason: s.reason,
  };
  const { subject: subj, html, text } = renderEmail(doc);
  return { to: input.to, subject: subj, html, text };
}

// ---------------------------------------------------------------------------------------------
// Queueing
// ---------------------------------------------------------------------------------------------

type QueueEnv = Pick<AdminBindings, 'CONTACT_MAIL_QUEUE'> & { COSTS_DB?: D1Database };

/**
 * Queues one email per subscriber of `kind` for this fingerprint, skipping anyone already queued
 * or sent it. Returns how many were queued. Never throws.
 */
export async function queueCostEmails(env: QueueEnv, kind: CostAlertKind, fingerprint: string, payload: CostMailPayload, now = new Date()): Promise<number> {
  const db = env.COSTS_DB;
  if (!db) return 0;
  try {
    const subs = (await db.prepare('SELECT user_id FROM cost_alert_subscriptions WHERE kind = ?').bind(kind).all<{ user_id: string }>()).results ?? [];
    const jobs: CostAlertMailJob[] = [];
    for (const sub of subs) {
      const r = await db
        .prepare("INSERT OR IGNORE INTO cost_alert_deliveries (fingerprint, user_id, status, kind, payload, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)")
        .bind(fingerprint, sub.user_id, kind, JSON.stringify(payload), now.toISOString(), now.toISOString())
        .run();
      if (Number((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0) jobs.push({ v: COST_MAIL_VERSION, kind: 'cost-alert', fingerprint, userId: sub.user_id });
    }
    if (!jobs.length) return 0;
    if (!env.CONTACT_MAIL_QUEUE) throw new Error('CONTACT_MAIL_QUEUE is not bound');
    await env.CONTACT_MAIL_QUEUE.sendBatch(jobs.map((body) => ({ body: body as never, contentType: 'json' as const })));
    return jobs.length;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('[CostMail] Could not queue cost emails', { fingerprint, kind, error: reason });
    await db
      .prepare("UPDATE cost_alert_deliveries SET status = 'failed', error = ?, updated_at = ? WHERE fingerprint = ? AND status = 'queued'")
      .bind(`could not queue: ${reason}`.slice(0, 300), now.toISOString(), fingerprint)
      .run()
      .catch(() => undefined);
    return 0;
  }
}

/** The alert tick's notify hook: emails each newly opened alert to its kind's subscribers. */
export function costAlertNotifier(env: QueueEnv): (fresh: CostAlert[]) => Promise<void> {
  return async (fresh) => {
    for (const a of fresh) await queueCostEmails(env, a.kind, a.key, a.data);
  };
}

/** Local weekday (0 = Sunday), hour and date in the digest time zone. */
export function localTime(at: Date, timeZone = COST_DIGEST_TIME_ZONE): { weekday: number; hour: number; date: string } {
  const parts = Object.fromEntries(
    // locale-format: machine (time-zone maths, never shown)
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  return { weekday, hour: Number(parts.hour) % 24, date: `${parts.year}-${parts.month}-${parts.day}` };
}

// ---------------------------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------------------------

export const costMailItemKey = (fingerprint: string, userId: string) => `cost-email:${fingerprint}:${userId}`.slice(0, 160);

/** Flags a final failure on the admin Errors page with Retry. Never throws. */
export async function flagCostMailFailure(env: AdminBindings, fingerprint: string, userId: string, reason: string): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: `Cost alert email not sent: ${reason}`,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: {
      key: costMailItemKey(fingerprint, userId),
      source: 'email',
      title: 'Cost alert email not sent',
      itemType: 'ops-cost',
      itemId: fingerprint,
      itemUrl: '/costs',
      retry: { kind: 'builtin', handler: 'cost-alert-email', args: { fingerprint, userId } },
      retryLabel: 'Resend email',
    },
  });
  if (!event) return;
  try {
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[CostMail] Could not flag the failure on the Errors page', { fingerprint, error: error instanceof Error ? error.message : String(error) });
  }
}

type Outcome = 'done' | 'retry' | 'failed';

async function mark(db: D1Database, fingerprint: string, userId: string, status: string, error: string | null, now: Date): Promise<void> {
  await db.prepare('UPDATE cost_alert_deliveries SET status = ?, error = ?, updated_at = ? WHERE fingerprint = ? AND user_id = ?').bind(status, error, now.toISOString(), fingerprint, userId).run();
}

/** Sends one cost email. Never throws; the caller acks or retries by the outcome. */
export async function processCostAlertMailJob(env: AdminBindings, msg: QueueMessageLike<CostAlertMailJob>, now = () => new Date()): Promise<Outcome> {
  const { fingerprint, userId } = msg.body;
  const db = env.COSTS_DB;
  if (!db || msg.body.v !== COST_MAIL_VERSION || !fingerprint || !userId) {
    logger.error('[CostMail] Malformed job or no COSTS_DB; dropped', { id: msg.id });
    return 'done';
  }
  const fail = async (reason: string): Promise<Outcome> => {
    logger.error('[CostMail] Delivery failed for good', { alert: 'cost_mail_failed', fingerprint, attempts: msg.attempts, reason });
    await mark(db, fingerprint, userId, 'failed', reason.slice(0, 300), now());
    await flagCostMailFailure(env, fingerprint, userId, reason);
    return 'failed';
  };
  try {
    const row = await db.prepare('SELECT status, kind, payload FROM cost_alert_deliveries WHERE fingerprint = ? AND user_id = ?').bind(fingerprint, userId).first<{ status: string; kind: string; payload: string }>();
    if (!row || ['sent', 'sunk', 'skipped'].includes(row.status)) return 'done';
    // Unsubscribed since it was queued: nothing to send
    const sub = await db.prepare('SELECT email, locale FROM cost_alert_subscriptions WHERE user_id = ? AND kind = ?').bind(userId, row.kind).first<{ email: string; locale: string }>();
    if (!sub) {
      await mark(db, fingerprint, userId, 'skipped', null, now());
      return 'done';
    }
    const email = renderCostEmail({ to: sub.email, locale: sub.locale === 'ar' ? 'ar' : 'en', payload: JSON.parse(row.payload) as CostMailPayload, adminUrl: env.ADMIN_WEB_URL, environment: env.ENVIRONMENT });
    const result = await sendContactEmail(env, email, { idempotencyKey: `cost-${await shortHash(`${fingerprint}|${userId}`)}` });
    if (result.status !== 'failed') {
      await mark(db, fingerprint, userId, result.status === 'sunk' ? 'sunk' : 'sent', null, now());
      return 'done';
    }
    if (result.retryable && msg.attempts < MAX_ATTEMPTS) {
      logger.warn('[CostMail] Send failed; will retry', { fingerprint, attempts: msg.attempts, error: result.error });
      return 'retry';
    }
    return await fail(result.error ?? 'send failed');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (msg.attempts < MAX_ATTEMPTS) return 'retry';
    try {
      return await fail(reason);
    } catch {
      return 'retry';
    }
  }
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
