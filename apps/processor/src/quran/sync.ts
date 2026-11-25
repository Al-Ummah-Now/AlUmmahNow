/**
 * Quran Foundation Content Sync (AUN-CAPTIONS mode A, docs/specs/TRANSCRIPTION-TRANSLATION.md §5.5).
 *
 * Daily (cron) and on an admin's Retry, a QuranContentSync message on the videos queue:
 * 1. asks QF what changed in `quran_core:1` and `mushafs:4` (Uthmani Hafs: each word's Uthmani
 *    text, used to cut verses into words) since our sync token (bootstrap the first time, or when
 *    QF answers `resync_required`);
 * 2. on any change (or no copy yet) streams the snapshot and builds a new version of the text and
 *    the matcher's index under `quran/` in the private media bucket, then switches
 *    `quran/current.json` to it (readers never see half a version);
 * 3. with no change, only records the successful sync (QF terms: sync at least every 7 days).
 *
 * Retryable failures (429, 5xx, network) back off on the queue, then go to the DLQ (stored, flagged
 * on the Errors page with Replay). A failure no retry fixes (not configured, a verse failing the
 * check) flags the admin at once with a Retry button (`POST /internal/quran/sync`).
 * A copy not synced for 7 days is deleted by the daily check and never served.
 *
 * NOT FOR MACHINE LEARNING (QF Developer Terms, Must NOT item 4; QF 2026-11-22): the copy and the
 * matcher's index exist for captions and the review matcher. Never export them, or any QF text, as
 * training, fine-tuning or evaluation data for a machine-learning or AI model.
 */
import type { Logger } from '@al-ummah/logger';
import {
  MessageType,
  QURAN_CURRENT_KEY,
  QURAN_STALE_WARN_MS,
  QURAN_STATE_KEY,
  quranCopyFresh,
  quranIndexKey,
  quranTextKey,
  reportNeedsAction,
  resolveNeedsAction,
  type ErrorReporterEnv,
  type ExecutionContextLike,
  type QuranContentSyncPayload,
  type QuranCurrent,
} from '@al-ummah/shared-types';
import { QuranBuildError, QuranCoreCollector } from './build';
import { QfClient, QfError, type QfEnv } from './qf-client';
import { streamSnapshotRecords } from './snapshot-stream';

export interface QuranBucket {
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string | undefined; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

export interface QuranSyncEnv extends QfEnv, ErrorReporterEnv {
  /** The private media bucket (al-ummah-now-media-private[-stage/-qa]) */
  REVIEW_MEDIA?: QuranBucket;
  MESSAGE_QUEUE?: { send(message: unknown): Promise<unknown> };
}

export interface QuranSyncState {
  v: 1;
  syncToken?: string;
  /** The `resources` filter the token was given for: QF takes a token only with the same one */
  tokenResources?: string;
  syncedAt?: string;
  lastAttemptAt?: string;
  /** Newest first: the live version and the one before it (kept for readers mid-switch) */
  versions?: string[];
}

/** Resource groups, `;`-separated and percent-encoded in the query (QF Content Sync docs) */
const RESOURCES = 'quran_core:1%3Bmushafs:4';
const SNAPSHOT_PATH = '/api/v4/resources/snapshots/quran_core/1';
const MUSHAF_SNAPSHOT_PATH = '/api/v4/resources/snapshots/mushafs/4';
export const QURAN_SYNC_MAX_RETRIES = 3;
export const QURAN_SYNC_NEEDS_ACTION_KEY = 'quran-sync';
export const QURAN_STALE_NEEDS_ACTION_KEY = 'quran-stale';
/** The Errors page's Retry (bodies carry strings and numbers only; the route rebuilds by default) */
const RETRY = { kind: 'service' as const, service: 'processor', path: '/internal/quran/sync', body: {} };

interface Mutation {
  type?: string;
  resource_group?: string;
  resource_id?: number | string;
  snapshot_url?: string | null;
}
interface SyncPage {
  sync?: { has_more?: boolean; next_page_url?: string | null; next_sync_token?: string | null; mutations?: Mutation[] };
}

const json = (v: unknown) => JSON.stringify(v);
const versionId = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function readJson<T>(bucket: QuranBucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  return obj ? ((await obj.json<T>()) ?? null) : null;
}

/** `/api/v4/...` from a QF page link (relative, or absolute on the content host). */
function apiPath(link: string): string {
  if (link.startsWith('/api/v4/')) return link;
  const url = new URL(link, 'https://apis.quran.foundation');
  const path = url.pathname.replace(/^\/content(?=\/api\/v4\/)/, '');
  return `${path}${url.search}`;
}

const isCore = (m: Mutation) => m.resource_group === 'quran_core' && Number(m.resource_id) === 1;
const isMushaf = (m: Mutation) => m.resource_group === 'mushafs' && Number(m.resource_id) === 4;

/** Pages through QF's change feed; returns the relevant mutations and the final token. */
async function readChanges(client: QfClient, token: string | undefined): Promise<{ relevant: Mutation[]; nextToken: string | null }> {
  const first = token ? `/api/v4/resources/sync?sync_token=${encodeURIComponent(token)}&resources=${RESOURCES}&per_page=100` : `/api/v4/resources/sync?bootstrap=true&resources=${RESOURCES}&per_page=100`;
  const relevant: Mutation[] = [];
  let path: string | null = first;
  let nextToken: string | null = null;
  for (let pages = 0; path; pages++) {
    if (pages >= 500) throw new QfError('QF sync paging did not end after 500 pages', 0, true, 'paging');
    const page: SyncPage = await client.getJson<SyncPage>(path);
    const sync = page.sync ?? {};
    for (const m of sync.mutations ?? []) {
      if (m.type !== 'RESOURCE_UPDATE' && (isCore(m) || isMushaf(m))) relevant.push(m);
    }
    if (sync.has_more && sync.next_page_url) path = apiPath(sync.next_page_url);
    else {
      nextToken = sync.next_sync_token ?? null;
      path = null;
    }
  }
  return { relevant, nextToken };
}

/** Deletes every object of the given versions. */
async function deleteVersions(bucket: QuranBucket, versions: string[]): Promise<number> {
  let deleted = 0;
  for (const version of versions) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `quran/text/${version}/`, cursor, limit: 1000 });
      const keys = page.objects.map((o) => o.key);
      if (keys.length) await bucket.delete(keys);
      deleted += keys.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await bucket.delete(quranIndexKey(version));
    deleted++;
  }
  return deleted;
}

export interface QuranSyncResult {
  status: 'rebuilt' | 'unchanged';
  version: string;
  words?: number;
}

/** One sync run. Throws QfError (retryable or not) or QuranBuildError (never retryable). */
export async function runQuranSync(
  env: QuranSyncEnv,
  payload: QuranContentSyncPayload,
  deps: { logger: Logger; fetchImpl?: typeof fetch; now?: Date; complete?: boolean },
): Promise<QuranSyncResult> {
  const bucket = env.REVIEW_MEDIA;
  if (!bucket) throw new QfError('REVIEW_MEDIA (private media bucket) is not bound', 0, false, 'not_configured');
  const now = deps.now ?? new Date();
  const client = new QfClient(env, deps.fetchImpl);
  const state = (await readJson<QuranSyncState>(bucket, QURAN_STATE_KEY)) ?? { v: 1 };
  const current = await readJson<QuranCurrent>(bucket, QURAN_CURRENT_KEY);

  // A token from before the filter changed (mushafs:4, 2026-11-22) is refused with 422 every day: start over
  let bootstrap = payload.reason === 'bootstrap' || !state.syncToken || state.tokenResources !== RESOURCES;
  let changes: { relevant: Mutation[]; nextToken: string | null };
  try {
    changes = await readChanges(client, bootstrap ? undefined : state.syncToken);
  } catch (error) {
    // resync_required, or a token QF no longer takes (422: token_filter_mismatch, 410): a bootstrap needs no token
    const tokenRefused = error instanceof QfError && (error.code === 'resync_required' || error.status === 410 || error.status === 422);
    if (bootstrap || !tokenRefused) throw error;
    deps.logger.warn('[Quran] QF did not take the sync token: full resync', { status: error.status, code: error.code });
    bootstrap = true;
    changes = await readChanges(client, undefined);
  }
  const core = changes.relevant.filter(isCore);
  const removed = core.some((m) => m.type === 'RESOURCE_DELETE') && !core.some((m) => m.type === 'RESOURCE_CREATE');
  if (removed) throw new QuranBuildError('QF removed quran_core:1 (RESOURCE_DELETE)');

  const rebuild = !!payload.rebuild || bootstrap || changes.relevant.length > 0 || !current;
  const syncedAt = now.toISOString();
  let result: QuranSyncResult;
  if (rebuild) {
    const collector = new QuranCoreCollector();
    const read = async (path: string) => {
      const res = await client.get(path);
      if (!res.body) throw new QfError('QF snapshot had no body', res.status, true, 'empty');
      const { envelope } = await streamSnapshotRecords(res.body, (r) => collector.add(r));
      if (envelope.schema_version !== undefined && envelope.schema_version !== 1) throw new QuranBuildError(`Unsupported QF snapshot schema_version ${String(envelope.schema_version)}`);
    };
    await read(apiPath(core.find((m) => m.snapshot_url)?.snapshot_url ?? SNAPSHOT_PATH));
    const mushafRemoved = changes.relevant.some((m) => isMushaf(m) && m.type === 'RESOURCE_DELETE');
    if (!mushafRemoved) {
      try {
        await read(apiPath(changes.relevant.find((m) => isMushaf(m) && m.snapshot_url)?.snapshot_url ?? MUSHAF_SNAPSHOT_PATH));
      } catch (error) {
        // Not published here (404): verses are cut by their Imla'i words, as before. Throttling,
        // 5xx and a broken snapshot still fail the run and retry
        if (!(error instanceof QfError) || error.status !== 404) throw error;
        deps.logger.warn('[Quran] mushafs:4 snapshot not available; cutting verses by Imla\'i words', { status: error.status, code: error.code });
      }
    }
    const version = versionId(now);
    const built = collector.build(version, syncedAt, deps.complete === false ? { complete: false } : {});
    const put = { httpMetadata: { contentType: 'application/json; charset=utf-8' } };
    for (const file of built.surahs) await bucket.put(quranTextKey(version, file.surah), json(file), put);
    await bucket.put(quranIndexKey(version), json(built.index), put);
    const next: QuranCurrent = { v: 1, version, syncedAt, builtAt: syncedAt, surahs: built.surahs.length, words: built.index.locs.length };
    await bucket.put(QURAN_CURRENT_KEY, json(next), put);
    const keep = [version, ...(state.versions ?? []).filter((v) => v !== version)];
    const stale = keep.slice(2);
    if (stale.length) await deleteVersions(bucket, stale);
    state.versions = keep.slice(0, 2);
    result = { status: 'rebuilt', version, words: next.words };
    if (collector.counts.mushafWord && collector.counts.versesByImlaei) {
      deps.logger.warn('[Quran] Some verses were not cut by their mushaf words', { versesByMushaf: collector.counts.versesByMushaf, versesByImlaei: collector.counts.versesByImlaei });
    }
    deps.logger.info('[Quran] Copy rebuilt from QF', { version, surahs: next.surahs, words: next.words, changes: changes.relevant.length, bootstrap, counts: collector.counts });
  } else {
    await bucket.put(QURAN_CURRENT_KEY, json({ ...current!, syncedAt }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    result = { status: 'unchanged', version: current!.version };
  }
  // The token moves only after the copy is written: a failed build sees the same changes again
  // A bootstrap never keeps the old token: it may be the one QF refused
  const syncToken = changes.nextToken ?? (bootstrap ? undefined : state.syncToken);
  await bucket.put(QURAN_STATE_KEY, json({ ...state, v: 1, syncToken, tokenResources: RESOURCES, syncedAt, lastAttemptAt: syncedAt }));
  return result;
}

/**
 * Daily check before the sync: a copy not synced for 7 days is deleted (QF terms) and the admin is
 * flagged. Returns true when it deleted the copy.
 */
export async function enforceQuranFreshness(env: QuranSyncEnv, ctx: ExecutionContextLike | undefined, logger: Logger, now = Date.now()): Promise<boolean> {
  const bucket = env.REVIEW_MEDIA;
  if (!bucket) return false;
  const current = await readJson<QuranCurrent>(bucket, QURAN_CURRENT_KEY);
  if (!current) return false;
  if (quranCopyFresh(current, now)) {
    // Syncs run daily: a copy this old means they keep failing. Flag it while there is time to fix it
    const age = now - Date.parse(current.syncedAt);
    if (age > QURAN_STALE_WARN_MS) {
      const days = Math.floor(age / 86_400_000);
      logger.error('[Quran] Copy not synced for days', { days, syncedAt: current.syncedAt });
      reportNeedsAction('processor', env, ctx, {
        key: QURAN_STALE_NEEDS_ACTION_KEY,
        source: 'queue',
        title: `Quran text not synced with Quran Foundation for ${days} days`,
        message: `Last sync ${current.syncedAt}. QF terms allow 7 days: after that the copy is deleted and Quran captions show references only.`,
        itemType: 'quran-sync',
        retry: RETRY,
        retryLabel: 'Sync now',
      });
    }
    return false;
  }
  const state = (await readJson<QuranSyncState>(bucket, QURAN_STATE_KEY)) ?? { v: 1 };
  await bucket.delete(QURAN_CURRENT_KEY);
  await deleteVersions(bucket, [...new Set([current.version, ...(state.versions ?? [])])]);
  // A fresh bootstrap next time: the old token belongs to the deleted copy
  await bucket.put(QURAN_STATE_KEY, json({ v: 1, lastAttemptAt: state.lastAttemptAt }));
  logger.error('[Quran] Copy not synced for 7 days: deleted', { version: current.version, syncedAt: current.syncedAt });
  reportNeedsAction('processor', env, ctx, {
    key: QURAN_STALE_NEEDS_ACTION_KEY,
    source: 'queue',
    title: 'Quran text deleted: not synced with Quran Foundation for 7 days',
    message: `Last sync ${current.syncedAt}. Quran captions show references only until a sync succeeds.`,
    itemType: 'quran-sync',
    retry: RETRY,
    retryLabel: 'Sync now',
  });
  return true;
}

export function quranSyncMessage(payload: QuranContentSyncPayload, now = Date.now()) {
  return { id: crypto.randomUUID(), type: MessageType.QuranContentSync, payload, timestamp: now };
}

export function isQuranSyncMessage(message: { body?: { type?: unknown } | null }): boolean {
  return message.body?.type === MessageType.QuranContentSync;
}

export interface QuranQueueMessage {
  id?: string;
  body: { id?: string; type?: number; payload?: unknown };
  attempts?: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
}

/** Cloudflare Queues' longest retry delay (12 h). */
const QUEUE_MAX_DELAY_SECONDS = 43_200;

/**
 * The queue's retry delay: 1, 2, 4 … 30 min, and never sooner than QF's Retry-After (QF 2026-11-21:
 * on 429 back off and honour Retry-After), which the 30-minute cap does not cut short.
 */
export function quranRetryDelaySeconds(attempts: number, retryAfter?: number): number {
  const exp = Math.min(1800, 60 * 2 ** Math.max(0, attempts - 1));
  return Math.min(QUEUE_MAX_DELAY_SECONDS, Math.max(retryAfter ?? 0, exp));
}

function isPayload(p: unknown): p is QuranContentSyncPayload {
  const r = (p as { reason?: unknown } | null)?.reason;
  return r === 'cron' || r === 'admin' || r === 'bootstrap';
}

export async function processQuranSyncMessages(
  messages: QuranQueueMessage[],
  env: QuranSyncEnv,
  ctx: ExecutionContextLike | undefined,
  logger: Logger,
  deps: { fetchImpl?: typeof fetch; now?: Date; complete?: boolean } = {},
): Promise<void> {
  for (const message of messages) {
    const payload = message.body?.payload;
    if (!isPayload(payload)) {
      logger.warn('[Quran] Invalid sync message dropped', { id: message.body?.id });
      message.ack();
      continue;
    }
    const attempts = message.attempts ?? 1;
    const startedAt = Date.now();
    try {
      const result = await runQuranSync(env, payload, { logger, ...deps });
      resolveNeedsAction(env, ctx, [QURAN_SYNC_NEEDS_ACTION_KEY, QURAN_STALE_NEEDS_ACTION_KEY]);
      logger.job({ job: 'quran-sync', outcome: 'ok', status: result.status, version: result.version, reason: payload.reason, durationMs: Date.now() - startedAt });
      message.ack();
    } catch (error) {
      const retryable = error instanceof QfError ? error.retryable : !(error instanceof QuranBuildError);
      const reason = error instanceof Error ? error.message : String(error);
      if (retryable) {
        // Past the last retry the queue moves it to the DLQ: stored and flagged with Replay
        logger.error('[Quran] Sync failed; retrying', { attempts, reason });
        message.retry({ delaySeconds: quranRetryDelaySeconds(attempts, error instanceof QfError ? error.retryAfterSeconds : undefined) });
        continue;
      }
      logger.error('[Quran] Sync failed; a retry will not fix it', { attempts, reason });
      reportNeedsAction('processor', env, ctx, {
        key: QURAN_SYNC_NEEDS_ACTION_KEY,
        source: 'queue',
        title: 'Quran text sync failed',
        message: reason,
        itemType: 'quran-sync',
        retry: RETRY,
        retryLabel: 'Sync now',
        extra: { reason: payload.reason, code: (error instanceof QfError ? error.code : undefined) ?? 'build' },
      });
      message.ack();
    }
  }
}

/** Daily cron: the 7-day rule, then a sync message. Skipped where QF is not configured (local, previews). */
export async function runQuranDaily(env: QuranSyncEnv, ctx: ExecutionContextLike | undefined, logger: Logger, now = Date.now()): Promise<'queued' | 'skipped'> {
  try {
    await enforceQuranFreshness(env, ctx, logger, now);
  } catch (error) {
    logger.error('[Quran] Freshness check failed', error);
  }
  if (!env.QF_CLIENT_ID || !env.MESSAGE_QUEUE || !env.REVIEW_MEDIA) {
    logger.debug('[Quran] Content Sync not configured here; skipped');
    return 'skipped';
  }
  await env.MESSAGE_QUEUE.send(quranSyncMessage({ reason: 'cron' }, now));
  return 'queued';
}
