/**
 * Newsletter tables (migrations/0028_newsletter.sql) on REPORTS_DB: subscribers, issues and
 * deliveries. Every change is a single conditional statement, so double clicks, retried queue
 * jobs and two admins at once never send twice or skip a state.
 */
import type { D1Database } from './types';
import { hashToken, newToken, NEWSLETTER_LIMITS, type IssueContent, type IssueStatus, type NewsletterLocale, type SubscriberStatus } from './newsletter';

export interface SubscriberRow {
  id: string;
  email: string;
  locale: NewsletterLocale;
  status: SubscriberStatus;
  confirm_status: string | null;
  confirm_error: string | null;
  unsubscribe_token: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export interface IssueRow extends IssueContent {
  id: string;
  status: IssueStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  sent_by: string | null;
  send_started_at: string | null;
  fanned_out_at: string | null;
  finished_at: string | null;
}

export interface DeliveryCounts {
  queued: number;
  sent: number;
  sunk: number;
  skipped: number;
  failed: number;
}

const iso = (d: Date) => d.toISOString();
/** Rows a write changed (D1 meta.changes). */
const changed = (res: { meta?: object }) => Number((res.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
const minutesBefore = (now: Date, m: number) => new Date(now.getTime() - m * 60_000).toISOString();

// ---------------------------------------------------------------- sign-up, confirm, unsubscribe

export type SignupOutcome =
  | { outcome: 'rate_limited' }
  /** Nothing to email: already confirmed, or a confirmation went out minutes ago */
  | { outcome: 'none' }
  | { outcome: 'send'; subscriberId: string; token: string };

/**
 * A sign-up from the www form. New or unsubscribed addresses become pending with a fresh
 * confirmation token (returned once, for the email; only its hash is stored).
 */
export async function requestSignup(
  db: D1Database,
  input: { email: string; locale: NewsletterLocale; ipHash: string; now: Date; perIpHour: number },
): Promise<SignupOutcome> {
  const { email, locale, ipHash, now } = input;
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE ip_hash = ? AND updated_at >= ?')
    .bind(ipHash, minutesBefore(now, 60))
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= input.perIpHour) return { outcome: 'rate_limited' };

  const token = newToken();
  const tokenHash = await hashToken(token);
  const expires = iso(new Date(now.getTime() + NEWSLETTER_LIMITS.confirmDays * 86_400_000));
  const existing = await db.prepare('SELECT id, status, confirm_sent_at FROM newsletter_subscribers WHERE email = ?').bind(email).first<{ id: string; status: SubscriberStatus; confirm_sent_at: string | null }>();
  if (!existing) {
    const id = crypto.randomUUID();
    const res = await db
      .prepare(
        `INSERT INTO newsletter_subscribers (id, email, locale, status, confirm_token_hash, confirm_expires_at, confirm_sent_at, confirm_status, unsubscribe_token, ip_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, 'queued', ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
      )
      .bind(id, email, locale, tokenHash, expires, iso(now), newToken(), ipHash, iso(now), iso(now))
      .run();
    // Lost a race with the same address: that request sends the email
    return changed(res) ? { outcome: 'send', subscriberId: id, token } : { outcome: 'none' };
  }
  if (existing.status === 'confirmed') return { outcome: 'none' };
  if (existing.status === 'pending' && existing.confirm_sent_at && existing.confirm_sent_at >= minutesBefore(now, NEWSLETTER_LIMITS.resendMinutes)) return { outcome: 'none' };
  const res = await db
    .prepare(
      `UPDATE newsletter_subscribers SET status = 'pending', locale = ?, confirm_token_hash = ?, confirm_expires_at = ?, confirm_sent_at = ?, confirm_status = 'queued', confirm_error = NULL, ip_hash = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(locale, tokenHash, expires, iso(now), ipHash, iso(now), existing.id, existing.status)
    .run();
  return changed(res) ? { outcome: 'send', subscriberId: existing.id, token } : { outcome: 'none' };
}

export type ConfirmOutcome = 'confirmed' | 'expired' | 'invalid';

/** Confirms the pending subscriber whose link this is. Clicking it again still says confirmed. */
export async function confirmSubscriber(db: D1Database, token: string, now: Date): Promise<ConfirmOutcome> {
  const row = await db
    .prepare('SELECT id, status, confirm_expires_at FROM newsletter_subscribers WHERE confirm_token_hash = ?')
    .bind(await hashToken(token))
    .first<{ id: string; status: SubscriberStatus; confirm_expires_at: string | null }>();
  if (!row || row.status === 'unsubscribed') return 'invalid';
  if (row.status === 'confirmed') return 'confirmed';
  if (!row.confirm_expires_at || row.confirm_expires_at < iso(now)) return 'expired';
  await db
    .prepare("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(iso(now), iso(now), row.id)
    .run();
  return 'confirmed';
}

/** Unsubscribes the address this link belongs to (any state; again is fine). */
export async function unsubscribeByToken(db: D1Database, token: string, now: Date): Promise<'unsubscribed' | 'invalid'> {
  const row = await db.prepare('SELECT id, status FROM newsletter_subscribers WHERE unsubscribe_token = ?').bind(token).first<{ id: string; status: SubscriberStatus }>();
  if (!row) return 'invalid';
  if (row.status !== 'unsubscribed') {
    await db
      .prepare("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token_hash = NULL, updated_at = ? WHERE id = ? AND status != 'unsubscribed'")
      .bind(iso(now), iso(now), row.id)
      .run();
  }
  return 'unsubscribed';
}

export async function getSubscriber(db: D1Database, id: string): Promise<SubscriberRow | null> {
  return db
    .prepare('SELECT id, email, locale, status, confirm_status, confirm_error, unsubscribe_token, created_at, updated_at, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE id = ?')
    .bind(id)
    .first<SubscriberRow>();
}

export async function setConfirmDelivery(db: D1Database, id: string, status: 'queued' | 'sent' | 'sunk' | 'failed', error: string | null = null): Promise<void> {
  await db.prepare('UPDATE newsletter_subscribers SET confirm_status = ?, confirm_error = ? WHERE id = ?').bind(status, error ? error.slice(0, 500) : null, id).run();
}

/** A new confirmation token for a still-pending subscriber (Retry on the Errors page), else null. */
export async function renewConfirmToken(db: D1Database, id: string, now: Date): Promise<string | null> {
  const token = newToken();
  const res = await db
    .prepare(
      "UPDATE newsletter_subscribers SET confirm_token_hash = ?, confirm_expires_at = ?, confirm_sent_at = ?, confirm_status = 'queued', confirm_error = NULL WHERE id = ? AND status = 'pending'",
    )
    .bind(await hashToken(token), iso(new Date(now.getTime() + NEWSLETTER_LIMITS.confirmDays * 86_400_000)), iso(now), id)
    .run();
  return changed(res) ? token : null;
}

// ---------------------------------------------------------------- admin: subscribers

export async function listSubscribers(
  db: D1Database,
  opts: { status?: SubscriberStatus; q?: string; limit: number; offset: number },
): Promise<{ items: SubscriberRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status) {
    where.push('status = ?');
    args.push(opts.status);
  }
  if (opts.q) {
    where.push("email LIKE ? ESCAPE '\\'");
    args.push(`%${opts.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, total] = await Promise.all([
    db
      .prepare(`SELECT id, email, locale, status, confirm_status, confirm_error, unsubscribe_token, created_at, updated_at, confirmed_at, unsubscribed_at FROM newsletter_subscribers ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...args, opts.limit, opts.offset)
      .all<SubscriberRow>(),
    db.prepare(`SELECT COUNT(*) AS n FROM newsletter_subscribers ${w}`).bind(...args).first<{ n: number }>(),
  ]);
  return { items: (rows.results ?? []) as SubscriberRow[], total: total?.n ?? 0 };
}

export async function subscriberCounts(db: D1Database): Promise<Record<SubscriberStatus, number>> {
  const rows = await db.prepare('SELECT status, COUNT(*) AS n FROM newsletter_subscribers GROUP BY status').all<{ status: SubscriberStatus; n: number }>();
  const out: Record<SubscriberStatus, number> = { pending: 0, confirmed: 0, unsubscribed: 0 };
  for (const r of (rows.results ?? []) as { status: SubscriberStatus; n: number }[]) out[r.status] = r.n;
  return out;
}

/** Erases a subscriber and their delivery rows (a privacy request). False when there was none. */
export async function deleteSubscriber(db: D1Database, id: string): Promise<SubscriberRow | null> {
  const row = await getSubscriber(db, id);
  if (!row) return null;
  await db.batch([db.prepare('DELETE FROM newsletter_deliveries WHERE subscriber_id = ?').bind(id), db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').bind(id)]);
  return row;
}

// ---------------------------------------------------------------- admin: issues

const ISSUE_COLS = 'id, subject_en, subject_ar, body_en, body_ar, status, created_by, created_at, updated_at, sent_by, send_started_at, fanned_out_at, finished_at';

export async function createIssue(db: D1Database, content: Partial<IssueContent>, actorId: string, now: Date): Promise<IssueRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO newsletter_issues (id, subject_en, subject_ar, body_en, body_ar, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .bind(id, content.subject_en ?? '', content.subject_ar ?? '', content.body_en ?? '', content.body_ar ?? '', actorId, iso(now), iso(now))
    .run();
  return (await getIssue(db, id))!;
}

export async function getIssue(db: D1Database, id: string): Promise<IssueRow | null> {
  return db.prepare(`SELECT ${ISSUE_COLS} FROM newsletter_issues WHERE id = ?`).bind(id).first<IssueRow>();
}

export async function deliveryCounts(db: D1Database, issueId: string): Promise<DeliveryCounts> {
  const rows = await db.prepare('SELECT status, COUNT(*) AS n FROM newsletter_deliveries WHERE issue_id = ? GROUP BY status').bind(issueId).all<{ status: keyof DeliveryCounts; n: number }>();
  const out: DeliveryCounts = { queued: 0, sent: 0, sunk: 0, skipped: 0, failed: 0 };
  for (const r of (rows.results ?? []) as { status: keyof DeliveryCounts; n: number }[]) if (r.status in out) out[r.status] = r.n;
  return out;
}

export async function listIssues(db: D1Database, opts: { limit: number; offset: number }): Promise<{ items: (IssueRow & { counts: DeliveryCounts })[]; total: number }> {
  const [rows, total] = await Promise.all([
    db.prepare(`SELECT ${ISSUE_COLS} FROM newsletter_issues ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(opts.limit, opts.offset).all<IssueRow>(),
    db.prepare('SELECT COUNT(*) AS n FROM newsletter_issues').first<{ n: number }>(),
  ]);
  const items = await Promise.all(((rows.results ?? []) as IssueRow[]).map(async (r) => ({ ...r, counts: r.status === 'draft' ? { queued: 0, sent: 0, sunk: 0, skipped: 0, failed: 0 } : await deliveryCounts(db, r.id) })));
  return { items, total: total?.n ?? 0 };
}

/** Edits a draft. Null when it is not a draft any more (or gone). */
export async function updateDraft(db: D1Database, id: string, content: Partial<IssueContent>, now: Date): Promise<IssueRow | null> {
  const fields = Object.keys(content) as (keyof IssueContent)[];
  if (fields.length) {
    const res = await db
      .prepare(`UPDATE newsletter_issues SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND status = 'draft'`)
      .bind(...fields.map((f) => content[f]), iso(now), id)
      .run();
    if (!changed(res)) return null;
  }
  const row = await getIssue(db, id);
  return row?.status === 'draft' ? row : null;
}

export async function deleteDraft(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM newsletter_issues WHERE id = ? AND status = 'draft'").bind(id).run();
  return !!changed(res);
}

/** draft → sending, once. */
export async function startSending(db: D1Database, id: string, actorId: string, now: Date): Promise<boolean> {
  const res = await db
    .prepare("UPDATE newsletter_issues SET status = 'sending', sent_by = ?, send_started_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(actorId, iso(now), iso(now), id)
    .run();
  return !!changed(res);
}

/** The fan-out job could not be queued: back to a draft, nothing went out. */
export async function revertToDraft(db: D1Database, id: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE newsletter_issues SET status = 'draft', sent_by = NULL, send_started_at = NULL, updated_at = ? WHERE id = ? AND status = 'sending' AND fanned_out_at IS NULL")
    .bind(iso(now), id)
    .run();
}

// ---------------------------------------------------------------- fan-out and deliveries

export const FANOUT_PAGE = 100;

/** The next page of confirmed subscribers after `after` (id order). */
export async function confirmedPage(db: D1Database, after: string, limit = FANOUT_PAGE): Promise<string[]> {
  const rows = await db.prepare("SELECT id FROM newsletter_subscribers WHERE status = 'confirmed' AND id > ? ORDER BY id LIMIT ?").bind(after, limit).all<{ id: string }>();
  return ((rows.results ?? []) as { id: string }[]).map((r) => r.id);
}

/** One queued delivery per subscriber (kept as they are when already there). */
export async function addDeliveries(db: D1Database, issueId: string, subscriberIds: string[], now: Date): Promise<void> {
  if (!subscriberIds.length) return;
  await db.batch(
    subscriberIds.map((sid) =>
      db.prepare("INSERT INTO newsletter_deliveries (issue_id, subscriber_id, status, updated_at) VALUES (?, ?, 'queued', ?) ON CONFLICT(issue_id, subscriber_id) DO NOTHING").bind(issueId, sid, iso(now)),
    ),
  );
}

export async function markFannedOut(db: D1Database, issueId: string, now: Date): Promise<void> {
  await db.prepare('UPDATE newsletter_issues SET fanned_out_at = COALESCE(fanned_out_at, ?), updated_at = ? WHERE id = ?').bind(iso(now), iso(now), issueId).run();
}

export async function deliveryStatusOf(db: D1Database, issueId: string, subscriberId: string): Promise<string | null> {
  const row = await db.prepare('SELECT status FROM newsletter_deliveries WHERE issue_id = ? AND subscriber_id = ?').bind(issueId, subscriberId).first<{ status: string }>();
  return row?.status ?? null;
}

export async function setDelivery(db: D1Database, issueId: string, subscriberId: string, status: keyof DeliveryCounts, now: Date, extra: { providerId?: string; error?: string } = {}): Promise<void> {
  await db
    .prepare('UPDATE newsletter_deliveries SET status = ?, provider_id = COALESCE(?, provider_id), error = ?, updated_at = ? WHERE issue_id = ? AND subscriber_id = ?')
    .bind(status, extra.providerId ?? null, extra.error ? extra.error.slice(0, 500) : null, iso(now), issueId, subscriberId)
    .run();
}

/** sending → sent once the fan-out finished and nothing is queued. */
export async function finishIfDone(db: D1Database, issueId: string, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE newsletter_issues SET status = 'sent', finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'sending' AND fanned_out_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries WHERE issue_id = ? AND status = 'queued')`,
    )
    .bind(iso(now), iso(now), issueId, issueId)
    .run();
}

/** Failed deliveries of an issue back to queued (Retry); returns their subscriber ids. */
export async function requeueFailed(db: D1Database, issueId: string, now: Date): Promise<string[]> {
  const rows = await db
    .prepare("UPDATE newsletter_deliveries SET status = 'queued', error = NULL, updated_at = ? WHERE issue_id = ? AND status = 'failed' RETURNING subscriber_id")
    .bind(iso(now), issueId)
    .all<{ subscriber_id: string }>();
  const ids = ((rows.results ?? []) as { subscriber_id: string }[]).map((r) => r.subscriber_id);
  if (ids.length) {
    await db.prepare("UPDATE newsletter_issues SET status = 'sending', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'sent'").bind(iso(now), issueId).run();
  }
  return ids;
}
