/**
 * Email subscriptions on the public page (docs/status-page/README.md "Subscriptions").
 *
 *   POST /subscribe           { email, locale, website (honeypot) } → pending row + confirmation job
 *   POST /subscribe/confirm   { t } → active
 *   POST /unsubscribe?t=      deletes the row and its deliveries (also RFC 8058 one-click)
 *
 * The answer to a subscribe never says whether the address was already known. A pending
 * address gets at most one confirmation email per CONFIRM_COOLDOWN_MINUTES; an active one gets
 * none. Requests per IP are limited per hour (keyed hash, no IP stored). Mail is sent by
 * admin-api's queue consumer (STATUS_NOTIFY_QUEUE), never on the request path.
 */
import { STATUS_CONFIRM_DAYS, STATUS_NOTIFY_VERSION, type StatusNotifyJob } from '@al-ummah/shared-types';
import type { Locale } from './i18n';
import { logger } from './logger';

export const MAX_PER_IP_PER_HOUR = 5;
export const CONFIRM_COOLDOWN_MINUTES = 10;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

type Secret = string | { get(): Promise<string> } | undefined;

export interface SubscribeEnv {
  STATUS_DB: D1Database;
  STATUS_NOTIFY_QUEUE?: Queue<StatusNotifyJob>;
  INTERNAL_API_KEY?: Secret;
}

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length <= 254 && EMAIL.test(s) ? s : null;
}

/** A link token: 32 random bytes, base64url. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isToken = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(v);

async function resolve(secret: Secret): Promise<string> {
  if (typeof secret === 'string') return secret;
  try {
    return (await secret?.get()) ?? '';
  } catch {
    return '';
  }
}

async function ipKey(ip: string, secret: Secret): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode((await resolve(secret)) || 'status-subscribe'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ip || 'unknown')));
  return Array.from(sig.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Counts one request for this IP this hour; false when it is over the limit. */
export async function allowRequest(env: SubscribeEnv, ip: string, now: Date): Promise<boolean> {
  const hour = now.toISOString().slice(0, 13);
  const key = `${await ipKey(ip, env.INTERNAL_API_KEY)}:${hour}`;
  await env.STATUS_DB.prepare('INSERT INTO subscribe_limits (key, hour, count) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET count = count + 1').bind(key, hour).run();
  const row = await env.STATUS_DB.prepare('SELECT count FROM subscribe_limits WHERE key = ?').bind(key).first<{ count: number }>();
  return (row?.count ?? 0) <= MAX_PER_IP_PER_HOUR;
}

export type SubscribeOutcome = 'sent' | 'invalid' | 'limited' | 'unavailable';

interface SubscriberRow {
  id: string;
  status: 'pending' | 'active';
  confirm_sent_at: string | null;
}

async function enqueue(env: SubscribeEnv, job: StatusNotifyJob): Promise<boolean> {
  if (!env.STATUS_NOTIFY_QUEUE) {
    logger.error('[status] STATUS_NOTIFY_QUEUE is not bound');
    return false;
  }
  try {
    await env.STATUS_NOTIFY_QUEUE.send(job, { contentType: 'json' });
    return true;
  } catch (error) {
    logger.error('[status] Could not queue the confirmation email', { error });
    return false;
  }
}

/**
 * A subscribe form post. `sent` is the answer for every accepted address, new, pending or
 * already active, so the form never tells whether someone is subscribed.
 */
export async function subscribe(env: SubscribeEnv, input: { email: unknown; locale: unknown; honeypot: unknown; ip: string }, now = new Date()): Promise<SubscribeOutcome> {
  const email = normalizeEmail(input.email);
  if (!email) return 'invalid';
  if (!(await allowRequest(env, input.ip, now))) return 'limited';
  // A filled honeypot is a bot: answer as usual, store and send nothing
  if (typeof input.honeypot === 'string' && input.honeypot.trim()) return 'sent';
  const locale: Locale = input.locale === 'ar' ? 'ar' : 'en';
  const at = now.toISOString();
  const db = env.STATUS_DB;
  const existing = await db.prepare("SELECT id, status, confirm_sent_at FROM subscribers WHERE kind = 'email' AND address = ?").bind(email).first<SubscriberRow>();
  if (existing?.status === 'active') return 'sent';
  if (existing?.confirm_sent_at && Date.parse(existing.confirm_sent_at) > now.getTime() - CONFIRM_COOLDOWN_MINUTES * 60_000) return 'sent';

  let id = existing?.id;
  if (id) {
    // Still pending: the latest language wins, the link stays the same
    await db.prepare('UPDATE subscribers SET locale = ?, confirm_sent_at = ? WHERE id = ?').bind(locale, at, id).run();
  } else {
    id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO subscribers (id, kind, address, locale, status, token, created_at, confirm_sent_at) VALUES (?, 'email', ?, ?, 'pending', ?, ?, ?)")
      .bind(id, email, locale, newToken(), at, at)
      .run();
  }
  if (await enqueue(env, { v: STATUS_NOTIFY_VERSION, kind: 'status-confirm', subscriberId: id })) return 'sent';
  // Let the next try send it again at once
  await db.prepare('UPDATE subscribers SET confirm_sent_at = NULL WHERE id = ?').bind(id).run();
  return 'unavailable';
}

export type TokenState = 'pending' | 'active' | 'unknown';

/** What a confirm or unsubscribe link points at (nothing changes). */
export async function tokenState(db: D1Database, token: unknown): Promise<{ state: TokenState; locale: Locale }> {
  if (!isToken(token)) return { state: 'unknown', locale: 'en' };
  const row = await db.prepare("SELECT status, locale FROM subscribers WHERE kind = 'email' AND token = ?").bind(token).first<{ status: 'pending' | 'active'; locale: Locale }>();
  return row ? { state: row.status, locale: row.locale } : { state: 'unknown', locale: 'en' };
}

/** The confirm button: pending → active. Returns the state after it. */
export async function confirm(db: D1Database, token: unknown, now = new Date()): Promise<TokenState> {
  if (!isToken(token)) return 'unknown';
  const row = await db.prepare("SELECT id, status FROM subscribers WHERE kind = 'email' AND token = ?").bind(token).first<{ id: string; status: string }>();
  if (!row) return 'unknown';
  if (row.status === 'pending') await db.prepare("UPDATE subscribers SET status = 'active', confirmed_at = ? WHERE id = ?").bind(now.toISOString(), row.id).run();
  return 'active';
}

/** Deletes the subscription and every delivery record of it. True when there was one. */
export async function unsubscribe(db: D1Database, token: unknown): Promise<boolean> {
  if (!isToken(token)) return false;
  const row = await db.prepare("SELECT id FROM subscribers WHERE kind = 'email' AND token = ?").bind(token).first<{ id: string }>();
  if (!row) return false;
  await db.batch([db.prepare('DELETE FROM deliveries WHERE subscriber_id = ?').bind(row.id), db.prepare('DELETE FROM subscribers WHERE id = ?').bind(row.id)]);
  return true;
}

/**
 * Daily: drop confirmations nobody clicked within STATUS_CONFIRM_DAYS, old rate-limit rows and
 * notification records older than 30 days (with their deliveries).
 */
export function pruneSubscriptionStatements(db: D1Database, now: Date): D1PreparedStatement[] {
  const pendingBefore = new Date(now.getTime() - STATUS_CONFIRM_DAYS * 86_400_000).toISOString();
  const limitsBefore = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 13);
  const notesBefore = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return [
    db.prepare("DELETE FROM subscribers WHERE kind = 'email' AND status = 'pending' AND created_at < ?").bind(pendingBefore),
    db.prepare('DELETE FROM subscribe_limits WHERE hour < ?').bind(limitsBefore),
    db.prepare('DELETE FROM deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE created_at < ?)').bind(notesBefore),
    db.prepare('DELETE FROM notifications WHERE created_at < ?').bind(notesBefore),
  ];
}
