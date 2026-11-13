/**
 * The video review queue for people (docs/specs/VIDEO-REVIEW.md §6): web (admin-web) and native
 * (the native admin app) use the same JSON API. Plain functions over D1, R2 and the api-videos
 * service so they are unit tested without the Workers runtime.
 *
 * Rules: content reviewers never see escalations (minors, extremism; VR7); an appeal is decided by
 * someone other than the person who rejected it (VR10); every decision, undo and NSFW reveal is
 * audited in moderation_actions; a decision is applied to the video by api-videos (the single
 * writer of its review state) before the row records it.
 */
import {
  REVIEW_UNDO_MINUTES,
  isReviewReasonCode,
  isSeniorReviewer,
  readVideoReviewSettings,
  type D1Database,
  type ReviewDecisionRequest,
  type ReviewSettingsBucket,
  type VideoReviewReasonCode,
} from '@al-ummah/shared-types';

export class ReviewError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 502, readonly code: string, message: string) {
    super(message);
  }
}

export interface ReviewEnv {
  REPORTS_DB: D1Database;
  global_settings?: unknown;
  /** MEDIA_PRIVATE (review/ prefix): frames for the strip, purged after retention */
  REVIEW_MEDIA?: { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; text(): Promise<string> } | null>; list(o: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>; delete(keys: string | string[]): Promise<void> };
  videos?: { get(key: string): Promise<{ json<T>(): Promise<T> } | null> };
  VIDEOS?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

export interface Reviewer {
  id: string;
  roles: readonly string[];
}

export interface ReviewRow {
  id: string;
  subject_type: string;
  subject_id: string;
  channel_id: string | null;
  owner_id: string | null;
  status: string;
  mode: string;
  timing: string;
  trigger: string | null;
  route: string | null;
  risk: number | null;
  nsfw: number;
  escalate: number;
  hold_cause: string | null;
  top_category: string | null;
  findings_count: number;
  partial: number;
  models: string | null;
  cost_usd: number;
  created_at: string;
  checked_at: string | null;
  sla_due_at: string | null;
  assigned_to: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision: string | null;
  reason_code: string | null;
  note: string | null;
  undo_until: string | null;
  appeal_of: string | null;
  appeal_message: string | null;
  media_purge_after: string | null;
}

export const PAGE_MAX = 50;
const ACTION_STATUSES = ['in_review', 'appealed'];

// ---------- queue ----------

function encodeCursor(a: string, id: string): string {
  return btoa(JSON.stringify([a, id])).replace(/=+$/, '');
}

function decodeCursor(cursor: string | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(atob(cursor));
    return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

export interface QueueQuery {
  tab: 'action_needed' | 'history' | 'checking' | 'shadow';
  cursor?: string;
  limit?: number;
  escalatedOnly?: boolean;
}

/**
 * - action_needed: held or appealed, oldest deadline first (escalations first for seniors)
 * - checking: automated checks that have not finished (a stalled one shows here)
 * - history: decided, newest first
 * - shadow: what shadow mode would have done (rollout report)
 */
export async function listQueue(db: D1Database, reviewer: Reviewer, q: QueueQuery): Promise<{ items: ReviewRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), PAGE_MAX);
  const senior = isSeniorReviewer(reviewer.roles);
  const after = decodeCursor(q.cursor);
  const where: string[] = [];
  const params: unknown[] = [];
  let order: string;
  let key: (r: ReviewRow) => string;
  if (q.tab === 'action_needed') {
    where.push(`status IN (${ACTION_STATUSES.map(() => '?').join(', ')})`);
    params.push(...ACTION_STATUSES);
    // The index (status, escalate DESC, sla_due_at): escalations are first within each status
    order = 'sla_due_at ASC, id ASC';
    key = (r) => r.sla_due_at ?? '';
    if (after) {
      where.push('(sla_due_at > ? OR (sla_due_at = ? AND id > ?))');
      params.push(after[0], after[0], after[1]);
    }
  } else if (q.tab === 'checking') {
    where.push("status = 'checking'");
    order = 'created_at ASC, id ASC';
    key = (r) => r.created_at;
    if (after) {
      where.push('(created_at > ? OR (created_at = ? AND id > ?))');
      params.push(after[0], after[0], after[1]);
    }
  } else {
    if (q.tab === 'shadow') where.push("status = 'shadow'");
    else where.push("decided_at IS NOT NULL");
    const col = q.tab === 'shadow' ? 'created_at' : 'decided_at';
    order = `${col} DESC, id DESC`;
    key = (r) => (q.tab === 'shadow' ? r.created_at : (r.decided_at ?? ''));
    if (after) {
      where.push(`(${col} < ? OR (${col} = ? AND id < ?))`);
      params.push(after[0], after[0], after[1]);
    }
  }
  if (!senior) where.push('escalate = 0');
  if (q.escalatedOnly) where.push('escalate = 1');
  const rows = await db
    .prepare(`SELECT * FROM content_reviews WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .bind(...params, limit + 1)
    .all<ReviewRow>();
  const items = (rows.results ?? []).slice(0, limit);
  const more = (rows.results ?? []).length > limit;
  return { items, nextCursor: more && items.length ? encodeCursor(key(items[items.length - 1]), items[items.length - 1].id) : null };
}

// ---------- one item ----------

export interface ReviewFindingRow {
  id: string;
  source: string;
  category: string;
  score: number;
  at_ms: number | null;
  end_ms: number | null;
  media_key: string | null;
  text: string | null;
  quran_ref: string | null;
  model: string;
  rationale: string | null;
}

interface VideoSummary {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  channelId?: string;
  userId?: string;
  duration?: number;
  thumbnailUrl?: string;
  review?: { status?: string; manifestKey?: string };
}

function assertMayOpen(row: ReviewRow, reviewer: Reviewer): void {
  if (row.escalate && !isSeniorReviewer(reviewer.roles)) throw new ReviewError(403, 'senior_only', 'Only a senior reviewer may open an escalated review');
}

export async function getReview(env: ReviewEnv, reviewer: Reviewer, id: string) {
  const row = await env.REPORTS_DB.prepare('SELECT * FROM content_reviews WHERE id = ?').bind(id).first<ReviewRow>();
  if (!row) throw new ReviewError(404, 'not_found', 'Review not found');
  assertMayOpen(row, reviewer);
  // An appeal shows the findings of the review it appeals
  const findingsOf = row.appeal_of ?? row.id;
  const findings = await env.REPORTS_DB.prepare('SELECT id, source, category, score, at_ms, end_ms, media_key, text, quran_ref, model, rationale FROM content_review_findings WHERE review_id = ? ORDER BY score DESC LIMIT 200')
    .bind(findingsOf)
    .all<ReviewFindingRow>();
  const history = await env.REPORTS_DB.prepare('SELECT id, status, decision, reason_code, decided_at, decided_by, created_at, appeal_of FROM content_reviews WHERE subject_type = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(row.subject_type, row.subject_id)
    .all();
  let video: VideoSummary | null = null;
  if (row.subject_type === 'video' && env.videos) {
    video = (await (await env.videos.get(row.subject_id))?.json<VideoSummary>()) ?? null;
  }
  return {
    review: row,
    findings: findings.results ?? [],
    history: history.results ?? [],
    subject: video ? { id: video.id, title: video.title ?? '', description: video.description ?? '', tags: video.tags ?? [], channelId: video.channelId, ownerId: video.userId, duration: video.duration, currentStatus: video.review?.status ?? null } : null,
    manifestKey: video?.review?.manifestKey ?? null,
  };
}

/** A media object of the review (frames, manifest), only under the subject's own review/ prefix. */
export async function reviewMedia(env: ReviewEnv, reviewer: Reviewer, id: string, key: string) {
  const row = await env.REPORTS_DB.prepare('SELECT id, subject_id, escalate FROM content_reviews WHERE id = ?').bind(id).first<Pick<ReviewRow, 'id' | 'subject_id' | 'escalate'>>();
  if (!row) throw new ReviewError(404, 'not_found', 'Review not found');
  assertMayOpen(row as ReviewRow, reviewer);
  if (!key.startsWith(`review/${row.subject_id}/`) || key.includes('..')) throw new ReviewError(403, 'outside_review', 'Not a file of this review');
  const object = await env.REVIEW_MEDIA?.get(key);
  if (!object) throw new ReviewError(404, 'media_gone', 'The review media was purged or never extracted');
  return object;
}

// ---------- decisions ----------

async function audit(db: D1Database, input: { reviewId: string; subjectId: string; action: string; actorId: string; reason?: string | null; details?: unknown }, now: string) {
  await db
    .prepare(`INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, reason, details_json, created_at) VALUES (?, NULL, 'video_review', ?, ?, 'user', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.subjectId, input.action, input.actorId, input.reason ?? null, JSON.stringify({ reviewId: input.reviewId, ...((input.details as object) ?? {}) }), now)
    .run();
}

async function secret(value: ReviewEnv['INTERNAL_API_KEY']): Promise<string> {
  return typeof value === 'string' ? value : ((await value?.get()) ?? '');
}

/** api-videos applies the decision to the video first (single writer). */
async function applyOnVideo(env: ReviewEnv, videoId: string, body: ReviewDecisionRequest): Promise<void> {
  if (!env.VIDEOS) throw new ReviewError(502, 'not_configured', 'The VIDEOS service binding is not configured');
  const res = await env.VIDEOS.fetch(`https://videos.internal/internal/review/${encodeURIComponent(videoId)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ReviewError(res.status === 409 ? 409 : res.status === 400 ? 400 : 502, 'videos_refused', payload?.error ?? `api-videos answered ${res.status}`);
}

/** Images (VR16): a post is published or kept back; an avatar or banner is swapped in or dropped. */
async function applyOnImage(env: ReviewEnv, row: ReviewRow, decision: 'approve' | 'reject', reviewerId: string, reasonCode?: string): Promise<void> {
  if (!env.VIDEOS) throw new ReviewError(502, 'not_configured', 'The VIDEOS service binding is not configured');
  const res = await env.VIDEOS.fetch('https://videos.internal/internal/review/images/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': await secret(env.INTERNAL_API_KEY) },
    body: JSON.stringify({ subject: row.subject_type, subjectId: row.subject_id, reviewId: row.id, result: decision, reviewerId, ...(reasonCode ? { reasonCode } : {}) }),
  });
  if (res.ok) return;
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ReviewError(res.status === 409 ? 409 : res.status === 400 ? 400 : 502, 'videos_refused', payload?.error ?? `api-videos answered ${res.status}`);
}

export interface DecisionInput {
  decision: 'approve' | 'reject' | 'escalate' | 'undo';
  reasonCode?: string;
  note?: string;
}

export async function decideReview(env: ReviewEnv, reviewer: Reviewer, id: string, input: DecisionInput, now = new Date()) {
  const db = env.REPORTS_DB;
  const row = await db.prepare('SELECT * FROM content_reviews WHERE id = ?').bind(id).first<ReviewRow>();
  if (!row) throw new ReviewError(404, 'not_found', 'Review not found');
  assertMayOpen(row, reviewer);
  const iso = now.toISOString();
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : undefined;

  if (input.decision === 'escalate') {
    if (!ACTION_STATUSES.includes(row.status)) throw new ReviewError(409, 'not_open', `This review is ${row.status}`);
    await db.prepare('UPDATE content_reviews SET escalate = 1, assigned_to = NULL, updated_at = ? WHERE id = ?').bind(iso, id).run();
    await audit(db, { reviewId: id, subjectId: row.subject_id, action: 'review_escalate', actorId: reviewer.id, reason: note }, iso);
    return { review: { ...row, escalate: 1 } };
  }

  if (input.decision === 'undo') {
    if (!row.decided_at || row.decided_by !== reviewer.id) throw new ReviewError(409, 'nothing_to_undo', 'Only your own decision can be undone');
    if (!row.undo_until || iso > row.undo_until) throw new ReviewError(409, 'undo_expired', `Decisions can be undone for ${REVIEW_UNDO_MINUTES} minutes`);
    if (row.subject_type !== 'video') throw new ReviewError(409, 'undo_video_only', 'An image decision cannot be undone; decide it again from History');
    await applyOnVideo(env, row.subject_id, { reviewId: id, decision: 'undo', reviewerId: reviewer.id, decidedAt: iso });
    const restored = row.appeal_of ? 'appealed' : 'in_review';
    await db.prepare('UPDATE content_reviews SET status = ?, decision = NULL, decided_at = NULL, decided_by = NULL, reason_code = NULL, note = NULL, undo_until = NULL, media_purge_after = NULL, updated_at = ? WHERE id = ?').bind(restored, iso, id).run();
    await audit(db, { reviewId: id, subjectId: row.subject_id, action: 'review_undo', actorId: reviewer.id }, iso);
    return { review: { ...row, status: restored, decision: null, decided_at: null } };
  }

  if (!['in_review', 'appealed', 'post_review', 'checking'].includes(row.status)) throw new ReviewError(409, 'not_open', `This review is ${row.status}`);
  if (input.decision === 'reject' && !isReviewReasonCode(input.reasonCode)) throw new ReviewError(400, 'reason_required', 'Pick a reason to reject');
  if (row.appeal_of) {
    // VR10: someone other than the person who rejected it decides the appeal
    const original = await db.prepare('SELECT decided_by FROM content_reviews WHERE id = ?').bind(row.appeal_of).first<{ decided_by: string | null }>();
    if (original?.decided_by === reviewer.id) throw new ReviewError(403, 'different_reviewer', 'An appeal is decided by a different reviewer');
  }
  if (row.subject_type === 'video') {
    await applyOnVideo(env, row.subject_id, { reviewId: id, decision: input.decision, reasonCode: input.reasonCode as VideoReviewReasonCode | undefined, note, reviewerId: reviewer.id, decidedAt: iso });
  } else {
    await applyOnImage(env, row, input.decision, reviewer.id, input.reasonCode);
  }
  const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
  const purge = new Date(now.getTime() + settings.mediaRetentionDays * 86_400_000).toISOString();
  const undoUntil = new Date(now.getTime() + REVIEW_UNDO_MINUTES * 60_000).toISOString();
  const status = input.decision === 'approve' ? 'approved' : 'rejected';
  await db
    .prepare('UPDATE content_reviews SET status = ?, decision = ?, reason_code = ?, note = ?, decided_at = ?, decided_by = ?, undo_until = ?, media_purge_after = ?, updated_at = ? WHERE id = ?')
    .bind(status, input.decision, input.decision === 'reject' ? input.reasonCode : null, note ?? null, iso, reviewer.id, undoUntil, purge, iso, id)
    .run();
  await audit(db, { reviewId: id, subjectId: row.subject_id, action: `review_${input.decision}`, actorId: reviewer.id, reason: input.reasonCode ?? null, details: { note: note ?? null } }, iso);
  return { review: { ...row, status, decision: input.decision, decided_at: iso, decided_by: reviewer.id, undo_until: undoUntil } };
}

export async function claimReview(db: D1Database, reviewer: Reviewer, id: string, now = new Date()) {
  const row = await db.prepare('SELECT * FROM content_reviews WHERE id = ?').bind(id).first<ReviewRow>();
  if (!row) throw new ReviewError(404, 'not_found', 'Review not found');
  assertMayOpen(row, reviewer);
  await db.prepare('UPDATE content_reviews SET assigned_to = ?, updated_at = ? WHERE id = ?').bind(reviewer.id, now.toISOString(), id).run();
  return { assignedTo: reviewer.id };
}

/** Reveal of a blurred NSFW item: audited (who, what, when). */
export async function recordReveal(db: D1Database, reviewer: Reviewer, id: string, target: string, now = new Date()) {
  const row = await db.prepare('SELECT * FROM content_reviews WHERE id = ?').bind(id).first<ReviewRow>();
  if (!row) throw new ReviewError(404, 'not_found', 'Review not found');
  assertMayOpen(row, reviewer);
  await audit(db, { reviewId: id, subjectId: row.subject_id, action: 'review_reveal', actorId: reviewer.id, details: { target: String(target).slice(0, 300) } }, now.toISOString());
  return { recorded: true };
}

// ---------- alerts, stats, retention ----------

export async function setAlerts(db: D1Database, reviewer: Reviewer, on: boolean, now = new Date()) {
  const iso = now.toISOString();
  if (!on) {
    await db.prepare('DELETE FROM review_alert_subscribers WHERE user_id = ?').bind(reviewer.id).run();
    return { alerts: false };
  }
  await db
    .prepare('INSERT INTO review_alert_subscribers (user_id, senior, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET senior = excluded.senior, updated_at = excluded.updated_at')
    .bind(reviewer.id, isSeniorReviewer(reviewer.roles) ? 1 : 0, iso, iso)
    .run();
  return { alerts: true };
}

export async function alertsOn(db: D1Database, reviewer: Reviewer): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS x FROM review_alert_subscribers WHERE user_id = ?').bind(reviewer.id).first());
}

export async function reviewStats(db: D1Database, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const counts = await db.prepare(`SELECT status, COUNT(*) AS n FROM content_reviews WHERE status IN ('checking', 'in_review', 'appealed') GROUP BY status`).all<{ status: string; n: number }>();
  const oldest = await db.prepare(`SELECT MIN(sla_due_at) AS t FROM content_reviews WHERE status IN ('in_review', 'appealed')`).first<{ t: string | null }>();
  // The live queue time creators see when flagged (VR6): median wait of the last 50 decisions
  const waits = await db
    .prepare(`SELECT (julianday(decided_at) - julianday(sla_due_at)) * 1440 AS m FROM content_reviews WHERE decided_at IS NOT NULL AND sla_due_at IS NOT NULL ORDER BY decided_at DESC LIMIT 50`)
    .all<{ m: number }>();
  const sorted = (waits.results ?? []).map((w) => Math.max(0, Number(w.m))).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const cost = await db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM ai_usage_daily WHERE day = ? AND feature = 'video_review'`).bind(day).first<{ usd: number }>();
  const shadow = await db
    .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN route = 'hold' THEN 1 ELSE 0 END) AS held, SUM(nsfw) AS nsfw FROM content_reviews WHERE status = 'shadow' AND created_at >= ?`)
    .bind(since)
    .first<{ n: number; held: number | null; nsfw: number | null }>();
  return {
    open: Object.fromEntries((counts.results ?? []).map((r) => [r.status, Number(r.n)])),
    oldestWaitingSince: oldest?.t ?? null,
    queueMinutes: median === null ? null : Math.round(median),
    todayCostUsd: Number(cost?.usd ?? 0),
    shadow14d: { checked: Number(shadow?.n ?? 0), wouldHold: Number(shadow?.held ?? 0), nsfw: Number(shadow?.nsfw ?? 0) },
  };
}

/** Retention (VR12): media and finding text 30 days after the decision; rows' findings after 12 months. */
export async function purgeReviewMedia(env: ReviewEnv, now = new Date(), limit = 50): Promise<{ purged: number }> {
  const iso = now.toISOString();
  const due = await env.REPORTS_DB.prepare(`SELECT id, subject_type, subject_id FROM content_reviews WHERE media_purge_after IS NOT NULL AND media_purge_after <= ? LIMIT ?`).bind(iso, limit).all<{ id: string; subject_type: string; subject_id: string }>();
  let purged = 0;
  for (const row of due.results ?? []) {
    if (row.subject_type === 'video' && env.REVIEW_MEDIA) {
      // The video's review media; a later review of it re-extracts from a new transcode
      let cursor: string | undefined;
      do {
        const page = await env.REVIEW_MEDIA.list({ prefix: `review/${row.subject_id}/`, cursor, limit: 1000 });
        if (page.objects.length) await env.REVIEW_MEDIA.delete(page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
    await env.REPORTS_DB.batch([
      env.REPORTS_DB.prepare('UPDATE content_review_findings SET text = NULL, media_key = NULL WHERE review_id = ?').bind(row.id),
      env.REPORTS_DB.prepare('UPDATE content_reviews SET media_purge_after = NULL, updated_at = ? WHERE id = ?').bind(iso, row.id),
    ]);
    purged++;
  }
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  await env.REPORTS_DB.prepare('DELETE FROM content_review_findings WHERE review_id IN (SELECT id FROM content_reviews WHERE created_at < ? LIMIT 500)').bind(yearAgo).run();
  return { purged };
}
