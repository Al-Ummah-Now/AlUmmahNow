/**
 * What an open child safety report sets off (migration 0053, child_safety_alerts):
 *
 * - an item on the admin Errors page (Needs action; emailed to the admin address in production). Never
 *   content, titles or who reported: only where to look.
 * - a sealed copy of the reported item's records in the CSAM evidence store (api-videos
 *   lib/csam/reportEvidence.ts), so it is still there if the reported person erases their account.
 *
 * The row is written in the same transaction as the report (here for guests, by the processor for signed-in
 * people) and worked off by deliverChildSafety: right after a guest report, and on the 5-minute cron until
 * done. A queue that is down therefore delays an alert and never loses it.
 *
 * One alert per item while it is open, and at most OWN_FLAGS_PER_HOUR Errors items an hour: the items above
 * that share the hour's one, so a flood cannot bury other alerts. The moderation page lists them all, first.
 */
import { newErrorRef, scrubEvent } from '@al-ummah/shared-types';
import type { AdminBindings } from '../../base/types';
import { callVideos, type VideosClientEnv } from '../content/videosClient';
import { logger } from '../logger';
import type { D1Database } from '../types';

export const OWN_FLAGS_PER_HOUR = 5;
/** Tries before a failing copy is flagged (it keeps being retried). */
export const EVIDENCE_FLAG_AFTER = 12;
const BATCH = 50;
const EVIDENCE_BATCH = 10;

export type ChildSafetyEnv = AdminBindings & VideosClientEnv;

/** Starts (or restarts, after a decision) the item's alert. Batched with the report's INSERT. */
export const childSafetyAlertStatement = (db: D1Database, entityType: string, entityId: string, at: string) =>
  db
    .prepare(
      `INSERT INTO child_safety_alerts (entity_type, entity_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET created_at = excluded.created_at, alerted_at = NULL, flag_key = NULL, own_flag = 0, evidence = NULL, evidence_attempts = 0, closed_at = NULL
       WHERE child_safety_alerts.closed_at IS NOT NULL`,
    )
    .bind(entityType, entityId, at);

interface AlertRow {
  entity_type: string;
  entity_id: string;
  evidence_attempts: number;
}

const itemUrl = (r: Pick<AlertRow, 'entity_type' | 'entity_id'>) => `/moderation?entity_type=${encodeURIComponent(r.entity_type)}&entity_id=${encodeURIComponent(r.entity_id)}`;

export async function flagAdmin(env: ChildSafetyEnv, input: { key: string; title: string; message: string; itemId: string; itemUrl: string }): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: input.message,
    environment: env.ENVIRONMENT,
    occurredAt: new Date().toISOString(),
    action: { key: input.key, source: 'other', title: input.title, itemType: 'report', itemId: input.itemId, itemUrl: input.itemUrl },
  });
  if (!event) throw new Error('The alert event was refused');
  const { ingestAndAlert } = await import('../../endpoints/errors/ErrorsIngest');
  await ingestAndAlert(env, [event]);
}

async function resolveFlags(env: ChildSafetyEnv, keys: string[], now = new Date()): Promise<void> {
  const { enqueueIngest } = await import('../../endpoints/errors/ErrorsIngest');
  await enqueueIngest(env, { v: 1, events: [], resolved: keys, trustedRetry: true, receivedAt: now.toISOString() });
}

const evidenceFlagKey = (entityType: string, entityId: string) => `child-safety-evidence:${entityType}:${entityId}`;

/** The shared Errors item of an hour is still about another open alert. */
const stillShared = async (db: D1Database, flagKey: string): Promise<boolean> => !!(await db.prepare('SELECT 1 AS x FROM child_safety_alerts WHERE flag_key = ? AND closed_at IS NULL LIMIT 1').bind(flagKey).first<{ x: number }>());

/**
 * Reports filed under a channel's @handle move to its id (reportMeta.ts), and their alert with them, in one
 * transaction. An open alert stays open: it opens the channel's own one again when that was closed, and joins it
 * when that is open. Alerted under the handle, it is raised again under the id (its link names the id, and so does
 * the key a decision resolves), and the handle's Errors item is resolved. The records are kept again, under the id.
 */
export async function moveAlert(env: ChildSafetyEnv, handle: string, id: string, also: ReturnType<D1Database['prepare']>[] = []): Promise<void> {
  const db = env.REPORTS_DB as unknown as D1Database;
  const before = await db.prepare("SELECT flag_key FROM child_safety_alerts WHERE entity_type = 'channel' AND entity_id = ?").bind(handle).first<{ flag_key: string | null }>();
  await db.batch([
    ...also,
    db
      .prepare(
        `INSERT INTO child_safety_alerts (entity_type, entity_id, created_at, alerted_at, evidence, closed_at)
         SELECT entity_type, ?, created_at, CASE WHEN closed_at IS NOT NULL THEN COALESCE(alerted_at, closed_at) END, CASE WHEN closed_at IS NOT NULL THEN evidence END, closed_at
         FROM child_safety_alerts WHERE entity_type = 'channel' AND entity_id = ?
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           created_at = MAX(child_safety_alerts.created_at, excluded.created_at),
           alerted_at = CASE WHEN child_safety_alerts.closed_at IS NOT NULL AND excluded.closed_at IS NULL THEN NULL ELSE child_safety_alerts.alerted_at END,
           flag_key = CASE WHEN child_safety_alerts.closed_at IS NOT NULL AND excluded.closed_at IS NULL THEN NULL ELSE child_safety_alerts.flag_key END,
           own_flag = CASE WHEN child_safety_alerts.closed_at IS NOT NULL AND excluded.closed_at IS NULL THEN 0 ELSE child_safety_alerts.own_flag END,
           evidence = CASE WHEN excluded.closed_at IS NULL THEN NULL ELSE child_safety_alerts.evidence END,
           evidence_attempts = CASE WHEN excluded.closed_at IS NULL THEN 0 ELSE child_safety_alerts.evidence_attempts END,
           closed_at = CASE WHEN child_safety_alerts.closed_at IS NULL OR excluded.closed_at IS NULL THEN NULL ELSE MAX(child_safety_alerts.closed_at, excluded.closed_at) END`,
      )
      .bind(id, handle),
    db.prepare("DELETE FROM child_safety_alerts WHERE entity_type = 'channel' AND entity_id = ?").bind(handle),
  ]);
  if (!before?.flag_key || (await stillShared(db, before.flag_key))) return;
  // The alert itself is safe: a stale Errors item is all that is left when this fails
  await resolveFlags(env, [before.flag_key]).catch((error) => logger.warn('[ChildSafety] The moved alert\'s Errors item could not be resolved', { error: error instanceof Error ? error.message : String(error) }));
}

/** Raises the alerts that are due. A failure leaves its rows due. */
export async function deliverAlerts(env: ChildSafetyEnv, now = new Date()): Promise<number> {
  const db = env.REPORTS_DB as unknown as D1Database;
  const { results: due = [] } = await db
    .prepare('SELECT entity_type, entity_id FROM child_safety_alerts INDEXED BY idx_child_safety_alerts_pending WHERE alerted_at IS NULL ORDER BY created_at LIMIT ?')
    .bind(BATCH)
    .all<AlertRow>();
  if (due.length === 0) return 0;
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM child_safety_alerts WHERE alerted_at > ? AND own_flag = 1')
    .bind(new Date(now.getTime() - 3_600_000).toISOString())
    .first<{ n: number }>();
  const room = Math.max(0, OWN_FLAGS_PER_HOUR - (Number(recent?.n) || 0));
  const done = (row: AlertRow, key: string, own: boolean) =>
    db
      .prepare('UPDATE child_safety_alerts SET alerted_at = ?, flag_key = ?, own_flag = ? WHERE entity_type = ? AND entity_id = ? AND alerted_at IS NULL')
      .bind(now.toISOString(), key, own ? 1 : 0, row.entity_type, row.entity_id);
  for (const row of due.slice(0, room)) {
    const key = `child-safety-report:${row.entity_type}:${row.entity_id}`;
    await flagAdmin(env, { key, title: 'Child safety report needs review', message: 'A child safety report is waiting in the moderation queue.', itemId: row.entity_id, itemUrl: itemUrl(row) });
    await done(row, key, true).run();
  }
  const rest = due.slice(room);
  if (rest.length > 0) {
    const key = `child-safety-reports:${now.toISOString().slice(0, 13)}`;
    await flagAdmin(env, { key, title: 'More child safety reports need review', message: 'More child safety reports are waiting in the moderation queue than are listed one by one here.', itemId: key, itemUrl: '/moderation?reason=child_safety' });
    await db.batch(rest.map((row) => done(row, key, false)));
  }
  return due.length;
}

/** Keeps the records of reported items that are not kept yet. */
export async function keepEvidence(env: ChildSafetyEnv): Promise<number> {
  const db = env.REPORTS_DB as unknown as D1Database;
  const { results: due = [] } = await db
    .prepare('SELECT entity_type, entity_id, evidence_attempts FROM child_safety_alerts WHERE evidence IS NULL ORDER BY evidence_attempts, created_at LIMIT ?')
    .bind(EVIDENCE_BATCH)
    .all<AlertRow>();
  let kept = 0;
  for (const row of due) {
    const settle = (evidence: string) => db.prepare('UPDATE child_safety_alerts SET evidence = ? WHERE entity_type = ? AND entity_id = ?').bind(evidence, row.entity_type, row.entity_id).run();
    // A channel named by a handle: kept under its id once that is known (reportMeta.ts), and never when nobody has it
    if (row.entity_id.startsWith('@')) {
      if (Number(row.evidence_attempts) >= 3) await settle('none');
      else await db.prepare('UPDATE child_safety_alerts SET evidence_attempts = evidence_attempts + 1 WHERE entity_type = ? AND entity_id = ?').bind(row.entity_type, row.entity_id).run();
      continue;
    }
    // A guest's word is enough for a message anyone can read; a signed-in reporter could read theirs
    const signedIn = await db
      .prepare("SELECT entity_title FROM reports WHERE entity_type = ? AND entity_id = ? AND reason = 'child_safety' AND reporter_id <> ? LIMIT 1")
      .bind(row.entity_type, row.entity_id, GUEST_REPORTER_ID)
      .first<{ entity_title: string | null }>();
    try {
      const out = await callVideos<{ kept: boolean }>(env, '/report-evidence', {
        base: '/internal/csam',
        method: 'POST',
        json: { entityType: row.entity_type, entityId: row.entity_id, publicOnly: !signedIn, reportedText: signedIn?.entity_title ?? null },
      });
      await settle(out.kept ? 'kept' : 'none');
      if (Number(row.evidence_attempts) >= EVIDENCE_FLAG_AFTER) await resolveFlags(env, [evidenceFlagKey(row.entity_type, row.entity_id)]).catch(() => undefined);
      if (out.kept) kept++;
    } catch (error) {
      const attempts = Number(row.evidence_attempts) + 1;
      logger.warn('[ChildSafety] The item could not be kept yet', { entityType: row.entity_type, attempts, error: error instanceof Error ? error.message : String(error) });
      await db.prepare('UPDATE child_safety_alerts SET evidence_attempts = ? WHERE entity_type = ? AND entity_id = ?').bind(attempts, row.entity_type, row.entity_id).run();
      if (attempts === EVIDENCE_FLAG_AFTER) {
        await flagAdmin(env, {
          key: evidenceFlagKey(row.entity_type, row.entity_id),
          title: 'A reported item could not be kept',
          message: 'The copy of a reported item is failing and still being retried. Open the report before the item changes.',
          itemId: row.entity_id,
          itemUrl: itemUrl(row),
        }).catch(() => undefined);
      }
    }
  }
  return kept;
}

/** Guest reports are stored under this reporter id: no person and no network identifier. */
export const GUEST_REPORTER_ID = 'guest';

/** Alerts first, then the copies. Never throws: what fails is still due. */
export async function deliverChildSafety(env: ChildSafetyEnv): Promise<void> {
  for (const [what, run] of [['alerts', () => deliverAlerts(env)], ['evidence', () => keepEvidence(env)]] as const) {
    try {
      await run();
    } catch (error) {
      logger.error('[ChildSafety] Not delivered yet; the next run retries', { what, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** After a decision: an item with no open child safety report left takes its Errors page item with it. */
export async function closeChildSafety(env: ChildSafetyEnv, entityType: string, entityId: string, now = new Date()): Promise<void> {
  const db = env.REPORTS_DB as unknown as D1Database;
  try {
    const alert = await db.prepare('SELECT flag_key, own_flag, evidence_attempts FROM child_safety_alerts WHERE entity_type = ? AND entity_id = ? AND closed_at IS NULL').bind(entityType, entityId).first<{ flag_key: string | null; own_flag: number; evidence_attempts: number }>();
    if (!alert) return;
    const closed = await db
      .prepare(
        `UPDATE child_safety_alerts SET closed_at = ?, alerted_at = COALESCE(alerted_at, ?) WHERE entity_type = ? AND entity_id = ? AND closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM reports WHERE entity_type = ? AND entity_id = ? AND reason = 'child_safety' AND status IN ('pending', 'reviewing'))`,
      )
      .bind(now.toISOString(), now.toISOString(), entityType, entityId, entityType, entityId)
      .run();
    if (Number((closed.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) return;
    const keys = Number(alert.evidence_attempts) >= EVIDENCE_FLAG_AFTER ? [evidenceFlagKey(entityType, entityId)] : [];
    if (alert.flag_key && (alert.own_flag || !(await stillShared(db, alert.flag_key)))) keys.push(alert.flag_key);
    if (keys.length > 0) await resolveFlags(env, keys, now);
  } catch (error) {
    logger.warn('[ChildSafety] The alert could not be closed', { entityType, error: error instanceof Error ? error.message : String(error) });
  }
}
