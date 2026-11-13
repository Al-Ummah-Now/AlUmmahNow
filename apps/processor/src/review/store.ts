/**
 * Review rows in reports D1 (admin-api migrations 0024, 0025; docs/specs/VIDEO-REVIEW.md §4).
 * Plain functions over D1 so they are unit tested with node:sqlite.
 */
import type { D1Database, ReviewFinding, ReviewRouting, VideoReviewAppealPayload, VideoReviewScanPayload } from '@al-ummah/shared-types';

export const REVIEW_PROMPT_VERSION = 'video-review-v1';

/** Only flagged findings are stored: what a reviewer looks at. */
export const STORE_SCORE = 0.1;

export interface ReviewRow {
  id: string;
  status: string;
  route: string | null;
  checked_at: string | null;
  risk: number | null;
  nsfw: number;
  escalate: number;
  hold_cause: string | null;
}

export async function getReviewRow(db: D1Database, id: string): Promise<ReviewRow | null> {
  return db.prepare('SELECT id, status, route, checked_at, risk, nsfw, escalate, hold_cause FROM content_reviews WHERE id = ?').bind(id).first<ReviewRow>();
}

/** The row exists from the moment the check starts (the queue shows "checking" items that stall). */
export async function startReviewRow(db: D1Database, p: VideoReviewScanPayload, now: string, subjectType = 'video'): Promise<void> {
  await db
    .prepare(
      `INSERT INTO content_reviews (id, subject_type, subject_id, channel_id, owner_id, status, mode, timing, trigger, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(p.reviewId, subjectType, p.videoId, p.channelId ?? null, p.ownerId ?? null, p.mode === 'shadow' ? 'shadow' : 'checking', p.mode, p.timing, p.trigger, now, now)
    .run();
}

export interface FinishInput {
  routing: ReviewRouting;
  findings: ReviewFinding[];
  partial: boolean;
  models: string[];
  costUsd: number;
  mediaRetentionDays: number;
}

/** The row's status after the automated check (the video's own state is api-videos'). */
export function rowStatusAfter(p: VideoReviewScanPayload, routing: ReviewRouting): string {
  if (p.mode === 'shadow') return 'shadow';
  if (routing.route === 'approve') return p.timing === 'post' ? 'post_review' : 'approved';
  return 'in_review';
}

export async function finishReviewRow(db: D1Database, p: VideoReviewScanPayload, input: FinishInput, now: Date): Promise<void> {
  const iso = now.toISOString();
  const status = rowStatusAfter(p, input.routing);
  const decided = status === 'approved' || status === 'post_review' || status === 'shadow';
  const purge = decided ? new Date(now.getTime() + input.mediaRetentionDays * 86_400_000).toISOString() : null;
  const kept = input.findings.filter((f) => f.score >= STORE_SCORE).sort((a, b) => b.score - a.score).slice(0, 200);
  const statements = [
    db.prepare('DELETE FROM content_review_findings WHERE review_id = ?').bind(p.reviewId),
    ...kept.map((f) =>
      db
        .prepare(
          `INSERT INTO content_review_findings (id, review_id, source, category, score, at_ms, end_ms, media_key, text, quran_ref, model, rationale, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), p.reviewId, f.source, f.category, f.score, f.atMs ?? null, f.endMs ?? null, f.mediaKey ?? null, f.text ?? null, f.quranRef ?? null, f.model, f.rationale ?? null, iso),
    ),
    db
      .prepare(
        `UPDATE content_reviews SET status = ?, route = ?, risk = ?, nsfw = ?, escalate = ?, hold_cause = ?, top_category = ?, findings_count = ?,
           partial = ?, models = ?, prompt_version = ?, cost_usd = ?, checked_at = ?, sla_due_at = ?, media_purge_after = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        status,
        input.routing.route,
        input.routing.risk,
        input.routing.nsfw ? 1 : 0,
        input.routing.escalate ? 1 : 0,
        input.routing.holdCause ?? null,
        input.routing.reasons[0]?.category ?? null,
        kept.length,
        input.partial ? 1 : 0,
        input.models.join(','),
        REVIEW_PROMPT_VERSION,
        input.costUsd,
        iso,
        status === 'in_review' ? iso : null,
        purge,
        iso,
        p.reviewId,
      ),
  ];
  await db.batch(statements);
}

/** The creator's appeal: a new row pointing at the rejected one (VR10). */
export async function openAppealRow(db: D1Database, a: VideoReviewAppealPayload): Promise<void> {
  await db
    .prepare(
      `INSERT INTO content_reviews (id, subject_type, subject_id, channel_id, owner_id, status, mode, timing, trigger, hold_cause, appeal_of, appeal_message, sla_due_at, created_at, updated_at)
       SELECT ?, 'video', ?, ?, ?, 'appealed', mode, timing, 'appeal', 'appeal', ?, ?, ?, ?, ?
       FROM content_reviews WHERE id = ?
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(a.appealReviewId, a.videoId, a.channelId ?? null, a.ownerId ?? null, a.reviewId, a.message, a.at, a.at, a.at, a.reviewId)
    .run();
}

/** Who gets the instant alert; escalations go to seniors only (VR7). */
export async function alertRecipients(db: D1Database, escalated: boolean): Promise<string[]> {
  const rows = await db
    .prepare(escalated ? 'SELECT user_id FROM review_alert_subscribers WHERE senior = 1' : 'SELECT user_id FROM review_alert_subscribers')
    .all<{ user_id: string }>();
  return (rows.results ?? []).map((r) => r.user_id);
}
