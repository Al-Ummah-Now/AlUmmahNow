/**
 * POST /internal/guest-reports: reports of people who are not signed in, from /[locale]/report.
 * Called only by the videos web app's /api/report (X-API-Key: INTERNAL_API_KEY).
 *
 * - Any well-formed report about a plausible target is accepted and answered the same way. Nothing is looked
 *   up, so the answer never says whether a private, held, draft or deleted item exists. Moderators see what
 *   it is, or that it is not there (lib/moderation/reportMeta.ts).
 * - Never merged: people on one network are not one person. The queue groups by item.
 * - Nothing about the reporter is stored: no name, email, address or identifier (reporter_id 'guest').
 * - Every attempt counts against the limits (lib/guest-report-limits.ts).
 * - A child safety report and its alert are written in one transaction (lib/moderation/childSafety.ts).
 */
import type { Context } from 'hono';
import type { ReportReason } from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { apiError } from '../../lib/api-error';
import { publishAdminLiveInBackground } from '../../lib/admin-live';
import { checkHuman, recordAbuse } from '../../lib/bot-guard';
import { safeEqual } from '../../lib/contact';
import { allowGuestReport, guestReportLimitsFor, networkPrefix } from '../../lib/guest-report-limits';
import { logger } from '../../lib/logger';
import { childSafetyAlertStatement, deliverChildSafety, GUEST_REPORTER_ID, type ChildSafetyEnv } from '../../lib/moderation/childSafety';
import type { D1Database } from '../../lib/types';

export const GUEST_REPORT_ENTITY_TYPES = ['video', 'channel', 'livestream', 'live_chat', 'comment', 'post'] as const;
export type GuestReportEntityType = (typeof GUEST_REPORT_ENTITY_TYPES)[number];

/** The page's reasons and the report reason each is stored as; `violence` is told apart in the text. */
const REASON_TO_DB: Readonly<Record<string, ReportReason>> = {
  child_safety: 'child_safety',
  harassment: 'harassment',
  spam: 'spam',
  violence: 'inappropriate',
  copyright: 'copyright',
  other: 'other',
};

const DETAILS_MAX = 4000;
/** More than any report takes (the details at four bytes a character, the rest and the human check's token). */
const BODY_MAX_BYTES = 32 * 1024;
/** An id of ours (UUIDs and slug-like keys); a channel may be named by its @handle. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HANDLE = /^@[A-Za-z0-9](?:[A-Za-z0-9._-]{1,28})[A-Za-z0-9]$/;

export interface GuestReport {
  entityType: GuestReportEntityType;
  entityId: string;
  parentId: string | null;
  reason: ReportReason;
  description: string | null;
}

/** The report a request body makes, or the fields that are wrong. Pure. */
export function parseGuestReport(raw: unknown): { value: GuestReport } | { errors: Record<string, string> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: { form: 'invalid' } };
  const input = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // The field people never see: a filled one is refused, not swallowed
  if (text(input.website)) return { errors: { website: 'invalid' } };
  const errors: Record<string, string> = {};

  const type = text(input.entityType).toLowerCase();
  const entityType = (type === 'live' ? 'livestream' : type) as GuestReportEntityType;
  if (!GUEST_REPORT_ENTITY_TYPES.includes(entityType)) errors.entityType = 'invalid';

  const entityId = text(input.entityId);
  if (!entityId) errors.entityId = 'required';
  else if (!ID.test(entityId) && !(entityType === 'channel' && HANDLE.test(entityId))) errors.entityId = 'invalid';
  const parent = text(input.entityParentId);

  const uiReason = text(input.reason).toLowerCase();
  const reason = Object.hasOwn(REASON_TO_DB, uiReason) ? REASON_TO_DB[uiReason] : undefined;
  if (!reason) errors.reason = 'invalid';

  const details = text(input.details);
  if (details.length > DETAILS_MAX) errors.details = 'too_long';
  if (Object.keys(errors).length > 0) return { errors };

  const description = [uiReason === 'violence' ? '[violence]' : '', details].filter(Boolean).join('\n') || null;
  return { value: { entityType, entityId, parentId: ID.test(parent) ? parent : null, reason: reason!, description } };
}

async function internalKey(env: AdminBindings): Promise<string> {
  const binding = env.INTERNAL_API_KEY;
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) || '';
  } catch {
    return '';
  }
}

interface EdgeLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

/** The body as text; null when it is longer than `max` bytes (read no further). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let out = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function guestReportSubmit(c: Context<{ Bindings: AdminBindings }>): Promise<Response> {
  const env = c.env;
  const key = await internalKey(env);
  if (!key || !safeEqual(c.req.header('X-API-Key') ?? '', key)) return apiError(c, 401, 'unauthorized');

  const ip = c.req.header('X-Client-IP') || null;
  const limited = () => {
    recordAbuse(env as never, 'videos.guest_report', 'rate_limited');
    return apiError(c, 429, 'rate_limited', undefined, { 'Retry-After': '3600' });
  };
  // At the edge first: a flood costs no database write and no human check
  const limiter = (env as { GUEST_REPORT_LIMITER?: EdgeLimiter }).GUEST_REPORT_LIMITER;
  if (limiter && !(await limiter.limit({ key: networkPrefix(ip).wide }).catch(() => ({ success: true }))).success) return limited();

  // Counted as it is read: a declared length is the sender's word
  const text = await readCapped(c.req.raw, BODY_MAX_BYTES).catch(() => '');
  if (text === null) return apiError(c, 413, 'payload_too_large');
  const raw = safeJson(text);
  if (raw === null) return apiError(c, 400, 'invalid_request');
  const parsed = parseGuestReport(raw);
  if ('errors' in parsed) return apiError(c, 400, 'validation_error', { errors: parsed.errors });
  const report = parsed.value;

  const token = (raw as { turnstileToken?: unknown }).turnstileToken;
  const human = await checkHuman(env as never, c.req.raw, typeof token === 'string' ? token : null, 'videos.guest_report', { ip: ip ?? undefined });
  if (!human.allowed) return apiError(c, 403, 'human_check_required', { siteKey: (env as { TURNSTILE_SITE_KEY?: string }).TURNSTILE_SITE_KEY });

  const db = env.REPORTS_DB as unknown as D1Database;
  const now = new Date();
  const childSafety = report.reason === 'child_safety';
  const allowed = await allowGuestReport(db, key, guestReportLimitsFor(env.ENVIRONMENT), { ip, entityType: report.entityType, entityId: report.entityId, childSafety }, now);
  if (!allowed) return limited();

  const at = now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO reports (id, entity_type, entity_id, entity_parent_id, reporter_id, reason, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .bind(crypto.randomUUID(), report.entityType, report.entityId, report.parentId, GUEST_REPORTER_ID, report.reason, report.description, at),
    ...(childSafety ? [childSafetyAlertStatement(db, report.entityType, report.entityId, at)] : []),
  ]);

  logger.info('[GuestReport] Filed', { entityType: report.entityType, reason: report.reason });
  publishAdminLiveInBackground(c, 'moderation', { kind: 'changed', key: 'reports', queue: 'reports' });
  if (childSafety) {
    const work = deliverChildSafety(env as ChildSafetyEnv);
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      await work; // no execution context (tests)
    }
  }
  return c.json({ success: true }, 201);
}
