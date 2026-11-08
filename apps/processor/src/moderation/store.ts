/** Writes moderation_signals and the moderation_actions audit log. */
import type { D1Database, ModerationDecision, ModerationScanPayload, ModerationSkipReason } from '@al-ummah/shared-types';
import { MODERATION_SURFACE_SUBJECT } from '@al-ummah/shared-types';

export const TRANSLATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignalInput {
  payload: ModerationScanPayload;
  language: string | null;
  scores: Record<string, number>;
  topCategory: string | null;
  topScore: number | null;
  models: string[];
  promptVersion: string;
  decision: ModerationDecision;
  skipReason?: ModerationSkipReason | undefined;
  priority: number;
  translation?: string | undefined;
  rationale?: string | undefined;
  note?: string | undefined;
}

const REVIEWABLE: ModerationDecision[] = ['would_flag', 'would_hide', 'flag', 'hide'];

export async function writeSignal(db: D1Database, input: SignalInput, now: number = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = new Date(now).toISOString();
  const reviewable = REVIEWABLE.includes(input.decision);
  // An AI failure is not a "safe" verdict: those items go to human review (fail safe).
  const needsReview = reviewable || input.skipReason === 'error';
  // Keep the reviewer translation only for items a reviewer will look at (no content copies otherwise).
  const translation = reviewable && input.translation ? input.translation : null;
  const { payload } = input;

  const statements = [
    db
      .prepare(
        `INSERT INTO moderation_signals (id, subject_type, subject_id, parent_id, surface, author_id, channel_id, language,
           categories_json, top_category, top_score, models, prompt_version, decision, skip_reason, priority,
           review_status, translation, translation_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        MODERATION_SURFACE_SUBJECT[payload.surface],
        payload.subjectId,
        payload.parentId ?? null,
        payload.surface,
        payload.authorId ?? null,
        payload.channelId ?? null,
        input.language,
        JSON.stringify(input.scores),
        input.topCategory,
        input.topScore,
        input.models.join(',') || null,
        input.promptVersion,
        input.decision,
        input.skipReason ?? null,
        input.priority,
        needsReview ? 'pending' : 'n/a',
        translation,
        translation ? new Date(now + TRANSLATION_TTL_MS).toISOString() : null,
        createdAt
      ),
  ];

  if (reviewable) {
    statements.push(
      db
        .prepare(
          `INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, model,
             prompt_version, category, score, reason, details_json, created_at)
           VALUES (?, ?, ?, ?, ?, 'ai', NULL, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          id,
          MODERATION_SURFACE_SUBJECT[payload.surface],
          payload.subjectId,
          input.decision,
          input.models.join(','),
          input.promptVersion,
          input.topCategory,
          input.topScore,
          input.rationale ?? null,
          JSON.stringify({ surface: payload.surface, event: payload.event, note: input.note ?? null, scores: input.scores }),
          createdAt
        )
    );
  }

  await db.batch(statements);
  return id;
}

/** Signals (and their AI audit rows) are kept 12 months for appeals and audits (spec §11). */
export const SIGNAL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * GDPR erasure (story 1.3): tombstone the author on the user's signals and drop their reviewer
 * translations (the only content-derived field). Appeals filed by the user are tombstoned too.
 */
export async function eraseUserModerationData(db: D1Database, userId: string, tombstone: string): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE moderation_signals SET author_id = ?, translation = NULL, translation_expires_at = NULL WHERE author_id = ?')
      .bind(tombstone, userId),
    db.prepare('UPDATE moderation_appeals SET user_id = ?, message = NULL WHERE user_id = ?').bind(tombstone, userId),
  ]);
}

/** Daily: clear translations past their 30 days, delete signals and AI audit rows past 12 months. */
export async function purgeExpiredModerationData(db: D1Database, now: number = Date.now()): Promise<void> {
  const nowIso = new Date(now).toISOString();
  const cutoff = new Date(now - SIGNAL_RETENTION_MS).toISOString();
  await db.batch([
    db
      .prepare('UPDATE moderation_signals SET translation = NULL, translation_expires_at = NULL WHERE translation_expires_at IS NOT NULL AND translation_expires_at < ?')
      .bind(nowIso),
    db.prepare("DELETE FROM moderation_actions WHERE actor_type = 'ai' AND created_at < ?").bind(cutoff),
    db.prepare('DELETE FROM moderation_signals WHERE created_at < ?').bind(cutoff),
  ]);
}
