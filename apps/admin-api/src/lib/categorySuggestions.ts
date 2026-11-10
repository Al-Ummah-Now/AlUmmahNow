/**
 * Admin review of AI category suggestions (packages/shared-types/src/category-suggestion.ts).
 *
 * Plain functions over SEARCH_DB (category_suggestions, search_videos),
 * REPORTS_DB (config, usage, audit) and the videos bucket, so they are unit
 * tested without the Workers runtime.
 *
 * Rules: video writes are conditional (only `category`/`categorySource` change,
 * so a concurrent edit or the legacy-channel migration is never undone); the
 * search index row is refreshed after each write; every change is audited in
 * moderation_actions with the admin's id; retries and the backfill only queue
 * jobs (the processor does the AI work, budget-capped).
 */
import {
  CATEGORIZE_CONFIG_KEY,
  MessageType,
  getCategorySuggestion,
  isVideoCategory,
  markCategorySuggestionPending,
  parseOptions,
  recordCategoryOutcome,
  resolveCategorizeConfig,
  syncSearchDocument,
  validateCategorizeConfigPatch,
  type CategorizeConfig,
  type CategorySuggestPayload,
  type CategorySuggestionRow,
  type SearchDb,
} from '@al-ummah/shared-types';
import { updateJson, type CasBucket } from './r2Cas';

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(col?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown>;
}
export interface ListableBucket extends CasBucket {
  list(options?: { cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}
export type Producer = { send(message: unknown): Promise<unknown>; sendBatch?(messages: Array<{ body: unknown }>): Promise<unknown> };

/** Review queues shown in admin. */
export type SuggestionView = 'review' | 'needs_category' | 'flagged' | 'reviewed' | 'all';
export const SUGGESTION_VIEWS: SuggestionView[] = ['review', 'needs_category', 'flagged', 'reviewed', 'all'];

/** A pending job untouched for this long is shown as flagged (stuck). */
export const STUCK_PENDING_MS = 60 * 60_000;
export const MAX_BULK = 100;

const VIEW_WHERE: Record<SuggestionView, string> = {
  // AI wrote the category (it counts for Explore); nobody has confirmed or changed it yet
  review: "s.status = 'done' AND s.applied = 1 AND s.outcome = 'pending'",
  // AI answered but wrote nothing (low confidence, or the uploader left it empty) and nobody chose one
  needs_category: "s.status = 'done' AND s.applied = 0 AND s.final_category IS NULL",
  // Needs an admin: failed, budget-capped, switched off, or stuck
  flagged: "(s.status IN ('failed', 'budget', 'disabled') OR (s.status = 'pending' AND s.updated_at < ?))",
  reviewed: "s.outcome IN ('accepted', 'changed')",
  all: '1 = 1',
};

export interface SuggestionListItem {
  videoId: string;
  status: string;
  reason: string;
  category: string | null;
  confidence: number | null;
  options: Array<{ category: string; confidence: number }>;
  model: string | null;
  applied: boolean;
  outcome: string;
  finalCategory: string | null;
  reviewedBy: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: number;
  video: { title: string | null; thumbnailUrl: string | null; channelName: string | null; channelId: string | null; isPublic: boolean | null; category: string | null; categorySource: string | null } | null;
}

interface ListRow extends CategorySuggestionRow {
  payload: string | null;
}

async function videoSummary(videos: CasBucket | undefined, id: string, payload: string | null): Promise<SuggestionListItem['video']> {
  // The search row exists for public ready videos; others are read from R2
  let raw: Record<string, unknown> | null = null;
  if (videos) {
    const object = await videos.get(id).catch(() => null);
    if (object) raw = JSON.parse(await object.text()) as Record<string, unknown>;
  }
  if (!raw && payload) {
    try {
      raw = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const channel = raw.channel as { name?: string } | string | undefined;
  return {
    title: str(raw.title),
    thumbnailUrl: str(raw.thumbnailUrl),
    channelName: str(raw.channelName) ?? (typeof channel === 'object' ? str(channel?.name) : str(channel)),
    channelId: str(raw.channelId),
    isPublic: typeof raw.isPublic === 'boolean' ? raw.isPublic : null,
    category: str(raw.category),
    categorySource: str(raw.categorySource) ?? (str(raw.category) ? 'uploader' : null),
  };
}

export async function listSuggestions(
  db: SearchDb,
  videos: CasBucket | undefined,
  filters: { view?: SuggestionView | undefined; category?: string | undefined; videoId?: string | undefined; limit?: number | undefined; offset?: number | undefined },
  now: number = Date.now(),
): Promise<{ items: SuggestionListItem[]; total: number; limit: number; offset: number }> {
  const view = filters.view && SUGGESTION_VIEWS.includes(filters.view) ? filters.view : 'review';
  const where = ["s.subject_type = 'video'", VIEW_WHERE[view]];
  const params: unknown[] = [];
  if (view === 'flagged') params.push(now - STUCK_PENDING_MS);
  if (filters.category && isVideoCategory(filters.category)) {
    where.push('s.category = ?');
    params.push(filters.category);
  }
  if (filters.videoId) {
    where.push('s.subject_id = ?');
    params.push(filters.videoId);
  }
  const clause = where.join(' AND ');
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  // Least confident first: those are the ones most worth a look
  const order = view === 'review' || view === 'needs_category' ? 's.confidence ASC, s.updated_at DESC' : 's.updated_at DESC';
  const { results } = await db
    .prepare(`SELECT s.*, v.payload AS payload FROM category_suggestions s LEFT JOIN search_videos v ON v.id = s.subject_id WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<ListRow>();
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM category_suggestions s WHERE ${clause}`).bind(...params).first<{ n: number }>();
  const items = await Promise.all(
    (results ?? []).map(async (row): Promise<SuggestionListItem> => ({
      videoId: row.subject_id,
      status: row.status,
      reason: row.reason,
      category: row.category,
      confidence: row.confidence,
      options: parseOptions(row.options_json),
      model: row.model,
      applied: row.applied === 1,
      outcome: row.outcome,
      finalCategory: row.final_category,
      reviewedBy: row.reviewed_by,
      attempts: row.attempts,
      lastError: row.last_error,
      updatedAt: row.updated_at,
      video: await videoSummary(videos, row.subject_id, row.payload),
    })),
  );
  return { items, total: Number(count?.n ?? 0), limit, offset };
}

export async function suggestionStats(db: SearchDb, now: number = Date.now()) {
  const counts: Record<string, number> = {};
  for (const view of SUGGESTION_VIEWS) {
    const params = view === 'flagged' ? [now - STUCK_PENDING_MS] : [];
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM category_suggestions s WHERE s.subject_type = 'video' AND ${VIEW_WHERE[view]}`).bind(...params).first<{ n: number }>();
    counts[view] = Number(row?.n ?? 0);
  }
  const byStatus = await db.prepare("SELECT status, COUNT(*) AS n FROM category_suggestions WHERE subject_type = 'video' GROUP BY status").all<{ status: string; n: number }>();
  // What Explore shows now: public ready videos per category, and how many of them the AI set
  const byCategory = await db
    .prepare(
      `SELECT v.category AS category, COUNT(*) AS videos, SUM(CASE WHEN s.applied = 1 AND s.outcome = 'pending' THEN 1 ELSE 0 END) AS aiUnreviewed
       FROM search_videos v LEFT JOIN category_suggestions s ON s.subject_id = v.id
       WHERE v.visible = 1 AND v.category IS NOT NULL GROUP BY v.category ORDER BY videos DESC`,
    )
    .all<{ category: string; videos: number; aiUnreviewed: number }>();
  const uncategorized = await db.prepare('SELECT COUNT(*) AS n FROM search_videos WHERE visible = 1 AND category IS NULL').first<{ n: number }>();
  return {
    views: counts,
    byStatus: Object.fromEntries((byStatus.results ?? []).map((r) => [r.status, Number(r.n)])),
    byCategory: (byCategory.results ?? []).map((r) => ({ category: r.category, videos: Number(r.videos), aiUnreviewed: Number(r.aiUnreviewed ?? 0) })),
    publicUncategorized: Number(uncategorized?.n ?? 0),
  };
}

// ---------- audit ----------

function audit(reports: D1Like, action: string, actorId: string, subjectId: string | null, details: unknown, now: number) {
  return reports
    .prepare(
      `INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, category, details_json, created_at)
       VALUES (?, NULL, ?, ?, ?, 'user', ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), subjectId ? 'video' : null, subjectId, action, actorId, (details as { category?: string } | null)?.category ?? null, JSON.stringify(details), new Date(now).toISOString())
    .run();
}

// ---------- accept / set ----------

interface StoredVideo {
  id?: string;
  category?: string;
  categorySource?: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface BulkResult {
  videoId: string;
  ok: boolean;
  error?: string;
  category?: string | null;
}

/**
 * Accept (keep the suggested category) or set a category on each video. The
 * category becomes the admin's (`categorySource: 'admin'`), so the AI never
 * replaces it; the search row is refreshed; the suggestion's outcome is recorded.
 */
export async function applyAdminCategory(
  env: { db: SearchDb; reports: D1Like; videos: CasBucket },
  videoIds: string[],
  action: { kind: 'accept' } | { kind: 'set'; category: string },
  actorId: string,
  now: number = Date.now(),
): Promise<BulkResult[]> {
  const ids = [...new Set(videoIds)].slice(0, MAX_BULK);
  const results: BulkResult[] = [];
  for (const videoId of ids) {
    try {
      let target: string | null = null;
      let refusal: string | null = null;
      let before: { category: string | null; categorySource: string | null } = { category: null, categorySource: null };
      if (action.kind === 'accept') {
        const row = await getCategorySuggestion(env.db, videoId);
        if (!row || row.status !== 'done' || !row.category) {
          results.push({ videoId, ok: false, error: 'no_suggestion' });
          continue;
        }
        target = row.category;
      } else {
        target = action.category;
      }
      const written = await updateJson<StoredVideo>(env.videos, videoId, (video) => {
        refusal = null;
        if (!video || video.isDeleted) {
          refusal = 'video_missing';
          return undefined;
        }
        before = { category: video.category ?? null, categorySource: video.categorySource ?? null };
        // Accepting is for an AI category still on the video: an owner who changed it since wins
        if (action.kind === 'accept' && (video.category !== target || (video.categorySource && video.categorySource !== 'ai'))) {
          if (video.category === target) return undefined;
          refusal = 'changed_since';
          return undefined;
        }
        if (video.category === target && video.categorySource === 'admin') return undefined;
        return { ...video, category: target!, categorySource: 'admin' };
      });
      if (refusal || !written) {
        results.push({ videoId, ok: false, error: refusal ?? 'video_missing' });
        continue;
      }
      if (written.written) await syncSearchDocument(env.db, 'video', videoId, written.value, { version: written.version ?? now });
      await recordCategoryOutcome(env.db, videoId, target, actorId, now);
      await audit(env.reports, action.kind === 'accept' ? 'category_accept' : 'category_set', actorId, videoId, { category: target, before }, now);
      results.push({ videoId, ok: true, category: target });
    } catch (error) {
      results.push({ videoId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

// ---------- retry / backfill (queue only) ----------

function message(payload: CategorySuggestPayload, now: number) {
  return { id: crypto.randomUUID(), type: MessageType.CategorySuggest, payload, timestamp: now };
}

async function sendAll(queue: Producer, payloads: CategorySuggestPayload[], now: number) {
  for (let i = 0; i < payloads.length; i += 100) {
    const chunk = payloads.slice(i, i + 100).map((p) => message(p, now));
    if (queue.sendBatch) await queue.sendBatch(chunk.map((body) => ({ body })));
    else for (const body of chunk) await queue.send(body);
  }
}

/** Re-queue flagged suggestions (keeps each one's reason, so a backfill stays a backfill). */
export async function retrySuggestions(env: { db: SearchDb; reports: D1Like; queue: Producer }, videoIds: string[], actorId: string, now: number = Date.now()): Promise<BulkResult[]> {
  const ids = [...new Set(videoIds)].slice(0, MAX_BULK);
  const results: BulkResult[] = [];
  const payloads: CategorySuggestPayload[] = [];
  for (const videoId of ids) {
    const row = await getCategorySuggestion(env.db, videoId);
    if (!row) {
      await markCategorySuggestionPending(env.db, { subjectId: videoId, subjectType: 'video', reason: 'retry', now });
    } else {
      await env.db
        .prepare("UPDATE category_suggestions SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE subject_id = ?")
        .bind(now, videoId)
        .run();
    }
    payloads.push({ subjectId: videoId, subjectType: 'video', reason: 'retry', requestedBy: actorId });
    results.push({ videoId, ok: true });
  }
  await sendAll(env.queue, payloads, now);
  if (ids.length) await audit(env.reports, 'category_retry', actorId, ids.length === 1 ? ids[0] : null, { videoIds: ids }, now);
  return results;
}

export interface BackfillPage {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  queued: number;
  alreadyHandled: number;
  withCategory: number;
  nextCursor: string | null;
  done: boolean;
}

/** Keys of the videos bucket that hold a video record (not likes/, index:, livestream: …). */
export function isVideoKey(key: string): boolean {
  return !!key && !key.includes('/') && !key.includes(':');
}

/**
 * One page of the one-off backfill over every video without a category
 * (public or not). Dry run counts only. A video that already has a suggestion
 * row is skipped, so re-running queues nothing twice; the processor's job is
 * idempotent too (same text, stored answer; never over a person's category).
 */
export async function backfillPage(
  env: { db: SearchDb; reports: D1Like; videos: ListableBucket; queue: Producer },
  opts: { dryRun: boolean; cursor?: string | undefined; limit?: number | undefined },
  actorId: string,
  now: number = Date.now(),
): Promise<BackfillPage> {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 200);
  const listed = await env.videos.list({ cursor: opts.cursor, limit });
  const page: BackfillPage = { dryRun: opts.dryRun, scanned: 0, candidates: 0, queued: 0, alreadyHandled: 0, withCategory: 0, nextCursor: listed.truncated ? listed.cursor ?? null : null, done: !listed.truncated };
  const toQueue: CategorySuggestPayload[] = [];
  for (const { key } of listed.objects) {
    if (!isVideoKey(key)) continue;
    const object = await env.videos.get(key);
    if (!object) continue;
    let video: StoredVideo;
    try {
      video = JSON.parse(await object.text()) as StoredVideo;
    } catch {
      continue;
    }
    if (video.id !== key || typeof video.title !== 'string' || video.isDeleted) continue;
    page.scanned++;
    if (video.category) {
      page.withCategory++;
      continue;
    }
    page.candidates++;
    if (opts.dryRun) {
      if (await getCategorySuggestion(env.db, key)) page.alreadyHandled++;
      continue;
    }
    const created = await markCategorySuggestionPending(
      env.db,
      { subjectId: key, subjectType: 'video', reason: 'backfill', userId: typeof video.userId === 'string' ? video.userId : null, channelId: typeof video.channelId === 'string' ? video.channelId : null, now },
      { onlyIfAbsent: true },
    );
    if (!created) {
      page.alreadyHandled++;
      continue;
    }
    toQueue.push({ subjectId: key, subjectType: 'video', reason: 'backfill', requestedBy: actorId });
  }
  if (toQueue.length) await sendAll(env.queue, toQueue, now);
  page.queued = toQueue.length;
  await audit(env.reports, opts.dryRun ? 'category_backfill_dry_run' : 'category_backfill', actorId, null, { ...page, cursor: opts.cursor ?? null }, now);
  return page;
}

// ---------- config + usage ----------

export async function readCategorizeConfig(reports: D1Like, env: { AI_CATEGORIZE_DAILY_NEURON_CAP?: string | undefined } = {}) {
  const row = await reports.prepare('SELECT value, updated_by, updated_at FROM moderation_config WHERE key = ?').bind(CATEGORIZE_CONFIG_KEY).first<{ value: string; updated_by: string | null; updated_at: string }>();
  let stored: unknown;
  try {
    stored = row?.value ? JSON.parse(row.value) : undefined;
  } catch {
    stored = undefined;
  }
  const { enabled, dailyNeuronCap, threshold } = resolveCategorizeConfig(stored, { cap: env.AI_CATEGORIZE_DAILY_NEURON_CAP });
  return { enabled, dailyNeuronCap, threshold, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
}

export async function writeCategorizeConfig(reports: D1Like, patch: Partial<CategorizeConfig>, actorId: string, now: number = Date.now()): Promise<string | null> {
  const error = validateCategorizeConfigPatch(patch);
  if (error) return error;
  const current = await reports.prepare('SELECT value FROM moderation_config WHERE key = ?').bind(CATEGORIZE_CONFIG_KEY).first<{ value: string }>();
  let stored: Record<string, unknown> = {};
  try {
    stored = current?.value ? (JSON.parse(current.value) as Record<string, unknown>) : {};
  } catch {
    stored = {};
  }
  const next = { ...stored, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  const iso = new Date(now).toISOString();
  await reports
    .prepare('INSERT INTO moderation_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(CATEGORIZE_CONFIG_KEY, JSON.stringify(next), actorId, iso)
    .run();
  await audit(reports, 'categorize_config_change', actorId, null, patch, now);
  return null;
}

export async function readCategorizeUsage(reports: D1Like, now: number = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const row = await reports
    .prepare("SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(neurons), 0) AS neurons, COALESCE(SUM(usd), 0) AS usd FROM ai_usage_daily WHERE feature = 'categorize' AND day = ?")
    .bind(today)
    .first<{ calls: number; neurons: number; usd: number }>();
  return { day: today, calls: Number(row?.calls ?? 0), neurons: Number(row?.neurons ?? 0), usd: Number(row?.usd ?? 0) };
}
