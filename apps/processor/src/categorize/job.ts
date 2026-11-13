/**
 * AI category suggestion job (MessageType.CategorySuggest).
 *
 * kill switch → read the subject (video JSON + captions from R2, or the draft's
 * text from the message) → same text already classified? reuse → budget → model
 * → record the suggestion → (videos) write it onto the video when the rules
 * allow (never over a person's choice) → update the search index.
 *
 * Idempotent: the input hash makes a repeat (queue retry, DLQ replay, backfill
 * re-run) reuse the stored answer, and the video write is a conditional write
 * that only touches `category`/`categorySource`. Fail safe: an AI failure never
 * touches the video. Transient errors are retried with backoff by the queue; the
 * last failure marks the row `failed` (flagged in admin with Retry) and the
 * message goes on to the DLQ (stored + alerted).
 */
import type { Logger } from '@al-ummah/logger';
import {
  CATEGORY_DRAFT_BUDGET_SHARE,
  CATEGORY_MODEL,
  CATEGORY_SYSTEM_PROMPT,
  CATEGORY_TEST_HOOK_MODEL,
  CATEGORIZE_CONFIG_KEY,
  buildCategoryText,
  categoryInputHash,
  categoryPatchForVideo,
  categoryUserMessage,
  findCategorySuggestionByHash,
  getCategorySuggestion,
  markCategorySuggestionPending,
  parseCategoryResponse,
  parseOptions,
  recordCategorySuggestionResult,
  resolveCategorizeConfig,
  syncSearchDocument,
  testHookScores,
  vttToText,
  type CategoryScore,
  type CategorySuggestPayload,
  type CategorySuggestionRow,
  type D1Database,
  type SearchDb,
} from '@al-ummah/shared-types';
import { runModel, type AiBinding, type AiContext } from '../moderation/ai';
import { reserveBudget, settleBudget } from '../moderation/budget';
import { neuronsFor } from '../moderation/pricing';
import { estimateTokens } from '../moderation/text';
import { CATEGORIZE_FEATURE } from '../moderation/usage';

/** The R2 calls the job needs (conditional put returns null when the etag moved on). */
export interface CasBucket {
  get(key: string): Promise<{ etag: string; uploaded?: Date; text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { onlyIf?: { etagMatches: string }; httpMetadata?: { contentType?: string } }): Promise<{ uploaded?: Date } | null | void>;
}

export interface CategorizeEnv {
  REPORTS_DB: D1Database;
  SEARCH_DB?: D1Database | undefined;
  videos?: CasBucket | undefined;
  subtitles?: CasBucket | undefined;
  AI?: AiBinding | undefined;
  AI_GATEWAY_ID?: string | undefined;
  AI_CATEGORIZE_ENABLED?: string | undefined;
  AI_CATEGORIZE_DAILY_NEURON_CAP?: string | undefined;
  /** "true" on QA and stage only: `[e2e-category:<value>]` in the text answers without a model call. */
  CATEGORY_AI_TEST_HOOK?: string | undefined;
}

export type CategorizeOutcome =
  | { status: 'done'; result: string; category?: string | null; applied?: boolean }
  | { status: 'retry'; error: string }
  | { status: 'failed'; error: string };

const REASONS = new Set(['draft', 'upload', 'edit', 'backfill', 'retry']);
const MAX_OUTPUT_TOKENS = 150;
const CAS_ATTEMPTS = 5;
/** Caption bytes read per track: the excerpt sent is a few thousand characters. */
const CAPTION_READ_CHARS = 20_000;

export function isCategorizePayload(value: unknown): value is CategorySuggestPayload {
  const p = value as CategorySuggestPayload | null;
  return !!p && typeof p === 'object' && typeof p.subjectId === 'string' && p.subjectId.length > 0 && p.subjectId.length <= 200
    && (p.subjectType === 'video' || p.subjectType === 'draft') && REASONS.has(p.reason);
}

/** Worst-case neurons of one suggestion (prompt + text in, the JSON answer out), with margin. */
export function estimateCategorizeNeurons(text: string): number {
  return neuronsFor(CATEGORY_MODEL, estimateTokens(CATEGORY_SYSTEM_PROMPT) + estimateTokens(text) + 30, MAX_OUTPUT_TOKENS) * 1.25;
}

async function loadConfig(env: CategorizeEnv) {
  const row = await env.REPORTS_DB.prepare('SELECT value FROM moderation_config WHERE key = ?').bind(CATEGORIZE_CONFIG_KEY).first<{ value: string }>();
  let stored: unknown;
  try {
    stored = row?.value ? JSON.parse(row.value) : undefined;
  } catch {
    stored = undefined;
  }
  return resolveCategorizeConfig(stored, { enabled: env.AI_CATEGORIZE_ENABLED, cap: env.AI_CATEGORIZE_DAILY_NEURON_CAP });
}

interface StoredVideo {
  id?: string;
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string | null;
  descriptionLocalized?: Record<string, string>;
  tags?: string[];
  category?: string | null;
  categorySource?: 'uploader' | 'ai' | 'admin' | null;
  subtitleLanguages?: string[];
  subtitles?: Array<{ language?: string; isDefault?: boolean; status?: string }>;
  isDeleted?: boolean;
  [key: string]: unknown;
}

async function readVideo(bucket: CasBucket, id: string): Promise<{ video: StoredVideo; etag: string } | null> {
  const object = await bucket.get(id);
  if (!object) return null;
  return { video: JSON.parse(await object.text()) as StoredVideo, etag: object.etag };
}

/** Caption text, Arabic and English tracks first (default track before others). */
async function readCaptions(bucket: CasBucket | undefined, video: StoredVideo, logger: Logger): Promise<string> {
  if (!bucket) return '';
  const tracks = (video.subtitles ?? []).filter((t) => t?.language && t.status !== 'error');
  const languages = [...new Set([
    ...tracks.filter((t) => t.isDefault).map((t) => t.language as string),
    ...['ar', 'en'].filter((l) => tracks.some((t) => t.language === l) || video.subtitleLanguages?.includes(l)),
  ])].slice(0, 2);
  const parts: string[] = [];
  for (const language of languages) {
    try {
      const object = await bucket.get(`${video.id}/${language}.vtt`);
      if (object) parts.push(vttToText((await object.text()).slice(0, CAPTION_READ_CHARS)));
    } catch (error) {
      logger.warn('[Categorize] Captions unreadable; classifying without them', { videoId: video.id, language, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return parts.join(' ');
}


/** The suggestion row of a video deleted for good (it names the uploader): removed, never recorded. */
async function forgetSuggestion(db: SearchDb, subjectId: string): Promise<void> {
  await db.prepare('DELETE FROM category_suggestions WHERE subject_id = ?').bind(subjectId).run();
}

/**
 * Write the suggestion onto the video when `categoryPatchForVideo` allows it, as a
 * conditional write on the fresh object, then refresh its search row.
 */
async function applyToVideo(
  env: CategorizeEnv,
  videoId: string,
  scores: CategoryScore[],
  mode: 'upload' | 'backfill',
  threshold: number,
  logger: Logger,
): Promise<{ applied: boolean; previousCategory: string | null; previousSource: string | null; missing?: boolean; gone?: boolean }> {
  const bucket = env.videos!;
  for (let attempt = 1; attempt <= CAS_ATTEMPTS; attempt++) {
    const current = await readVideo(bucket, videoId);
    if (!current || current.video.isDeleted) return { applied: false, previousCategory: null, previousSource: null, missing: true, gone: !current };
    const { video, etag } = current;
    const previousCategory = video.category ?? null;
    const previousSource = video.categorySource ?? null;
    const patch = categoryPatchForVideo(video, scores, mode, threshold);
    if (!patch) {
      const applied = video.categorySource === 'ai' && !!video.category && video.category === scores[0]?.category;
      return { applied, previousCategory, previousSource };
    }
    const next: StoredVideo = { ...video };
    if (patch.category) {
      next.category = patch.category;
      next.categorySource = 'ai';
    } else {
      delete next.category;
      delete next.categorySource;
    }
    const written = await bucket.put(videoId, JSON.stringify(next), { onlyIf: { etagMatches: etag }, httpMetadata: { contentType: 'application/json' } });
    if (written === null) {
      logger.debug('[Categorize] Video changed meanwhile; re-reading', { videoId, attempt });
      continue;
    }
    const version = (written as { uploaded?: Date } | undefined)?.uploaded?.getTime() ?? Date.now();
    if (env.SEARCH_DB) {
      try {
        await syncSearchDocument(env.SEARCH_DB as unknown as SearchDb, 'video', videoId, next, { version });
      } catch (error) {
        // The daily reconciliation sweep re-projects it; the category is already stored
        logger.warn('[Categorize] Search index update failed', { videoId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    logger.info('[Categorize] Category written onto video', { videoId, category: patch.category, previousCategory, previousSource, mode });
    return { applied: !!patch.category, previousCategory, previousSource };
  }
  throw new Error(`Video ${videoId} kept changing; category not written after ${CAS_ATTEMPTS} attempts`);
}

export async function handleCategorySuggest(
  payload: CategorySuggestPayload,
  env: CategorizeEnv,
  logger: Logger,
  opts: { lastAttempt: boolean; now?: number } = { lastAttempt: true },
): Promise<CategorizeOutcome> {
  const now = opts.now ?? Date.now();
  if (!env.SEARCH_DB) {
    logger.error('[Categorize] SEARCH_DB not bound; suggestion dropped', { subjectId: payload.subjectId });
    return { status: 'done', result: 'unconfigured' };
  }
  const db = env.SEARCH_DB as unknown as SearchDb;
  const { subjectId, subjectType } = payload;

  let row: CategorySuggestionRow | null = await getCategorySuggestion(db, subjectId);
  if (!row) {
    // Sent without a row (DLQ replay after a purge, an older producer): start one
    await markCategorySuggestionPending(db, { subjectId, subjectType, reason: payload.reason === 'retry' ? 'upload' : payload.reason, userId: payload.requestedBy, now });
    row = await getCategorySuggestion(db, subjectId);
  }
  const mode: 'upload' | 'backfill' = row?.reason === 'backfill' ? 'backfill' : 'upload';

  // ---- the text ----
  let text: string;
  if (subjectType === 'draft') {
    text = buildCategoryText(payload.text ?? {});
  } else {
    if (!env.videos) {
      logger.error('[Categorize] videos bucket not bound; suggestion dropped', { subjectId });
      return { status: 'done', result: 'unconfigured' };
    }
    const current = await readVideo(env.videos, subjectId);
    if (!current) {
      // Deleted for good (purged or erased): its suggestion row would only keep the uploader's id
      await forgetSuggestion(db, subjectId);
      return { status: 'done', result: 'missing' };
    }
    if (current.video.isDeleted) {
      await recordCategorySuggestionResult(db, subjectId, { status: 'empty', error: 'video_missing', now });
      return { status: 'done', result: 'missing' };
    }
    const transcript = await readCaptions(env.subtitles, current.video, logger);
    text = buildCategoryText({ ...current.video, transcript });
  }
  if (!text) {
    await recordCategorySuggestionResult(db, subjectId, { status: 'empty', now });
    return { status: 'done', result: 'empty' };
  }
  const inputHash = await categoryInputHash(text);
  const config = await loadConfig(env);

  // ---- the answer: stored, cached, test hook or model ----
  let scores: CategoryScore[] | null = null;
  let model: string | null = null;
  let source = 'model';
  if (row?.status === 'done' && row.input_hash === inputHash) {
    scores = parseOptions(row.options_json);
    model = row.model;
    source = 'stored';
  }
  if (!scores?.length) {
    const cached = await findCategorySuggestionByHash(db, inputHash);
    if (cached) {
      scores = parseOptions(cached.options_json);
      model = cached.model;
      source = 'cached';
    }
  }
  if (!scores?.length && env.CATEGORY_AI_TEST_HOOK === 'true') {
    const hooked = testHookScores(text);
    if (hooked) {
      scores = hooked;
      model = CATEGORY_TEST_HOOK_MODEL;
      source = 'test-hook';
    }
  }
  if (!scores?.length) {
    if (!config.enabled || !config.envEnabled || !env.AI) {
      await recordCategorySuggestionResult(db, subjectId, { status: 'disabled', inputHash, now });
      logger.info('[Categorize] AI suggestions are switched off; flagged for admin', { subjectId, enabled: config.enabled, envEnabled: config.envEnabled, hasAi: !!env.AI });
      return { status: 'done', result: 'disabled' };
    }
    const estimate = estimateCategorizeNeurons(text);
    // Form suggestions stop at their share of the cap, so typing in forms can never use up the budget uploads and the backfill need
    const cap = subjectType === 'draft' ? Math.floor(config.dailyNeuronCap * CATEGORY_DRAFT_BUDGET_SHARE) : config.dailyNeuronCap;
    if (!(await reserveBudget(env.REPORTS_DB, cap, estimate, now, CATEGORIZE_FEATURE))) {
      if (subjectType === 'draft') {
        await recordCategorySuggestionResult(db, subjectId, { status: 'budget', inputHash, error: 'draft_budget_share_reached', now });
        logger.warn('[Categorize] Form suggestions reached their share of the daily cap', { subjectId, cap });
        return { status: 'done', result: 'budget' };
      }
      await recordCategorySuggestionResult(db, subjectId, { status: 'budget', inputHash, error: 'daily_budget_reached', now });
      logger.warn('[Categorize] Daily neuron cap reached; flagged for admin, retried by the daily sweep', { alert: 'category_suggest_budget', subjectId, cap: config.dailyNeuronCap });
      return { status: 'done', result: 'budget' };
    }
    const ctx: AiContext = { ai: env.AI, db: env.REPORTS_DB, logger, gatewayId: env.AI_GATEWAY_ID || undefined, surface: `category_${subjectType}`, spent: 0, now, feature: CATEGORIZE_FEATURE };
    try {
      const result = await runModel(
        ctx,
        CATEGORY_MODEL,
        {
          messages: [
            { role: 'system', content: CATEGORY_SYSTEM_PROMPT },
            { role: 'user', content: categoryUserMessage(text) },
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
        },
        estimateTokens(CATEGORY_SYSTEM_PROMPT) + estimateTokens(text),
        (r) => estimateTokens(typeof (r as { response?: unknown })?.response === 'string' ? (r as { response: string }).response : JSON.stringify((r as { response?: unknown })?.response ?? '')),
      );
      scores = parseCategoryResponse(result);
      model = CATEGORY_MODEL;
    } catch (error) {
      await settleBudget(env.REPORTS_DB, estimate, ctx.spent, now, CATEGORIZE_FEATURE);
      const message = error instanceof Error ? error.message : String(error);
      if (!opts.lastAttempt) {
        await recordCategorySuggestionResult(db, subjectId, { status: 'pending', inputHash, error: message, attempt: true, now });
        logger.warn('[Categorize] Model call failed; will retry', { subjectId, error: message });
        return { status: 'retry', error: message };
      }
      await recordCategorySuggestionResult(db, subjectId, { status: 'failed', inputHash, error: message, attempt: true, now });
      logger.error('[Categorize] Suggestion failed on the last attempt; flagged for admin', { alert: 'category_suggest_failed', subjectId, subjectType, error: message });
      return { status: 'failed', error: message };
    }
    await settleBudget(env.REPORTS_DB, estimate, ctx.spent, now, CATEGORIZE_FEATURE);
  }

  // ---- apply (videos) and record ----
  let applied = false;
  let previousCategory: string | null = null;
  let previousSource: string | null = null;
  if (subjectType === 'video') {
    try {
      const outcome = await applyToVideo(env, subjectId, scores, mode, config.threshold, logger);
      if (outcome.missing) {
        if (outcome.gone) await forgetSuggestion(db, subjectId);
        else await recordCategorySuggestionResult(db, subjectId, { status: 'empty', error: 'video_missing', now });
        return { status: 'done', result: 'missing' };
      }
      ({ applied, previousCategory, previousSource } = outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!opts.lastAttempt) {
        await recordCategorySuggestionResult(db, subjectId, { status: 'pending', inputHash, scores, model, threshold: config.threshold, error: message, attempt: true, now });
        return { status: 'retry', error: message };
      }
      await recordCategorySuggestionResult(db, subjectId, { status: 'failed', inputHash, scores, model, threshold: config.threshold, error: message, attempt: true, now });
      logger.error('[Categorize] Writing the category failed on the last attempt; flagged for admin', { alert: 'category_suggest_failed', subjectId, error: message });
      return { status: 'failed', error: message };
    }
  }
  await recordCategorySuggestionResult(db, subjectId, {
    status: 'done',
    inputHash,
    scores,
    model,
    threshold: config.threshold,
    ...(subjectType === 'video' ? { applied, previousCategory, previousSource } : {}),
    now,
  });
  logger.info('[Categorize] Suggestion ready', { subjectId, subjectType, mode, source, model, category: scores[0]?.category, confidence: scores[0]?.confidence, applied });
  return { status: 'done', result: source, category: scores[0]?.category ?? null, applied };
}
