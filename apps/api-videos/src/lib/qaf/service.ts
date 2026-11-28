import { z } from 'zod';
import type { QafSettings } from '@al-ummah/shared-types';
import { sha256Hex } from '../translate/inline';
import { logger } from '../logger';
import { openQafKey, sealQafKey, type QafSecretEnv } from './credentials';
import { qafContextResult, qafLookup, qafLookupResult, qafPassageQuery, qafSearch, qafSearchResult, qafSettingsPatch } from './schemas';

const QAF_BASE = 'https://api.qaf.ai/v1';
const MINUTE = 60;
const WEEK = 7 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const delay = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
export interface QafEnv extends QafSecretEnv { SEARCH_DB?: D1Database }

interface SettingsRow {
  ciphertext: string | null;
  key_version: string | null;
  user_minute: number;
  global_minute: number;
  user_week: number;
  global_week: number;
  week_until: number;
  minute_until: number;
  invalid_key: number;
}

export class QafError extends Error {
  constructor(readonly status: 400 | 404 | 429 | 503, readonly code: string, readonly retryAfter?: number) {
    super(code);
  }
}

const database = (env: QafEnv) => {
  if (!env.SEARCH_DB) throw new QafError(503, 'unavailable');
  return env.SEARCH_DB;
};

async function row(db: D1Database) {
  const settings = await db.prepare('SELECT * FROM qaf_settings WHERE id = 1').first<SettingsRow>();
  if (!settings) throw new QafError(503, 'unavailable');
  return settings;
}

async function keyOf(env: QafEnv, settings: SettingsRow) {
  if (!settings.ciphertext) return null;
  try {
    return await openQafKey(env, settings.ciphertext);
  } catch {
    return null;
  }
}

export async function readQafSettings(env: QafEnv): Promise<QafSettings> {
  const db = database(env);
  const settings = await row(db);
  const at = now();
  const connected = !!(await keyOf(env, settings));
  const used = await db.prepare('SELECT count(*) AS n FROM qaf_usage WHERE is_search = 1 AND at > ?').bind(at - WEEK).first<{ n: number }>();
  const weeklyResetAt = settings.week_until > at ? settings.week_until * 1000 : null;
  return {
    connected, weeklyRemaining: weeklyResetAt ? 0 : Math.max(0, settings.global_week - (used?.n ?? 0)),
    blocked: settings.invalid_key ? 'invalid_keys' : weeklyResetAt ? 'week' : null,
    weeklyResetAt,
    userMinute: settings.user_minute, globalMinute: settings.global_minute,
    userWeek: settings.user_week, globalWeek: settings.global_week,
  };
}

export async function saveQafSettings(env: QafEnv, input: z.input<typeof qafSettingsPatch>): Promise<QafSettings> {
  const body = qafSettingsPatch.safeParse(input);
  if (!body.success) throw new QafError(400, 'invalid_request');
  const { key, userMinute, globalMinute, userWeek, globalWeek } = body.data;
  const ciphertext = key ? await sealQafKey(env, key) : null;
  const changeKey = key === undefined ? 0 : 1;
  await database(env).prepare(`
    UPDATE qaf_settings SET
      ciphertext = CASE WHEN ?1 THEN ?2 ELSE ciphertext END,
      key_version = CASE WHEN ?1 THEN ?3 ELSE key_version END,
      week_until = CASE WHEN ?1 THEN 0 ELSE week_until END,
      minute_until = CASE WHEN ?1 THEN 0 ELSE minute_until END,
      invalid_key = CASE WHEN ?1 THEN 0 ELSE invalid_key END,
      user_minute = coalesce(?4, user_minute), global_minute = coalesce(?5, global_minute),
      user_week = coalesce(?6, user_week), global_week = coalesce(?7, global_week)
    WHERE id = 1
  `).bind(changeKey, ciphertext, ciphertext ? crypto.randomUUID() : null, userMinute ?? null, globalMinute ?? null, userWeek ?? null, globalWeek ?? null).run();
  return readQafSettings(env);
}

export async function qafAvailable(env: QafEnv) {
  return env.SEARCH_DB ? !!(await keyOf(env, await row(env.SEARCH_DB))) : false;
}

const unique = <T extends string | number>(values?: T[]) => values?.length ? [...new Set(values)].sort() : undefined;
const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');

export function normalizeQafSearch(input: z.input<typeof qafSearch>) {
  const search = qafSearch.parse(input);
  const filters = search.filters;
  return {
    ...search,
    query: normalize(search.query),
    excludeIds: unique(search.excludeIds),
    filters: filters && Object.keys(filters).length ? {
      authorIds: unique(filters.authorIds), bookIds: unique(filters.bookIds),
      deathYearAH: filters.deathYearAH, genres: unique(filters.genres),
    } : undefined,
  };
}

export type QafRequest =
  | { kind: 'search'; input: z.input<typeof qafSearch> }
  | { kind: 'context'; id: string; input: z.input<typeof qafPassageQuery> }
  | { kind: 'catalog'; input: z.input<typeof qafLookup> };

function buildRequest(request: QafRequest) {
  if (request.kind === 'search') {
    return { path: '/search', body: JSON.stringify(normalizeQafSearch(request.input)), result: qafSearchResult };
  }
  if (request.kind === 'context') {
    const { radius, locale } = qafPassageQuery.parse(request.input);
    const id = encodeURIComponent(z.uuid().parse(request.id));
    return { path: `/passages/${id}?${new URLSearchParams({ radius: String(radius), locale })}`, result: qafContextResult };
  }
  const { type, query, locale } = qafLookup.parse(request.input);
  return { path: `/catalog/lookup?${new URLSearchParams({ type, query, locale })}`, result: qafLookupResult };
}

function checkBlock(settings: SettingsRow, at: number, search: boolean) {
  if (settings.invalid_key) throw new QafError(503, 'invalid_keys');
  if (search && settings.week_until > at) throw new QafError(429, 'week', settings.week_until - at);
  if (settings.minute_until > at) throw new QafError(429, 'minute', settings.minute_until - at);
}

/** D1 serializes this insert with competing requests. Retries reserve another request,
 * and only the first attempt reserves a search in the rolling seven-day budget. */
async function reserve(db: D1Database, settings: SettingsRow, creator: string, search: boolean, first: boolean) {
  const at = now();
  const used = await db.prepare(`
    INSERT INTO qaf_usage (creator, at, is_search)
    SELECT ?1, ?2, ?3 FROM qaf_settings
    WHERE id = 1 AND key_version = ?4 AND invalid_key = 0 AND minute_until <= ?2
      AND (?5 = 0 OR week_until <= ?2)
      AND (SELECT count(*) FROM qaf_usage WHERE creator = ?1 AND at > ?6) < user_minute
      AND (SELECT count(*) FROM qaf_usage WHERE at > ?6) < global_minute
      AND (?3 = 0 OR (
        (SELECT count(*) FROM qaf_usage WHERE is_search = 1 AND creator = ?1 AND at > ?7) < user_week
        AND (SELECT count(*) FROM qaf_usage WHERE is_search = 1 AND at > ?7) < global_week
      ))
  `).bind(creator, at, Number(search && first), settings.key_version, Number(search), at - MINUTE, at - WEEK).run();
  if (used.meta.changes) return;
  const current = await row(db);
  if (current.key_version !== settings.key_version) throw new QafError(503, 'unavailable');
  checkBlock(current, at, search);
  if (search && first) {
    const cap = await db.prepare(`
      SELECT count(*) AS total, count(CASE WHEN creator = ?1 THEN 1 END) AS personal
      FROM qaf_usage WHERE is_search = 1 AND at > ?2
    `).bind(creator, at - WEEK).first<{ total: number; personal: number }>();
    if (cap && cap.total >= current.global_week) throw new QafError(429, 'week');
    if (cap && cap.personal >= current.user_week) throw new QafError(429, 'user_week');
  }
  throw new QafError(429, 'minute', 60);
}

interface Hooks {
  fetch?: typeof fetch;
  sleep?: (seconds: number) => Promise<unknown>;
  report?: (code: 'week' | 'invalid_keys', requestId: string | null) => void;
  recovered?: (code: 'week' | 'invalid_keys') => void;
}

export async function queryQaf(env: QafEnv, creator: string, request: QafRequest, hooks: Hooks = {}) {
  const { path, body, result } = buildRequest(request);
  const search = request.kind === 'search';
  const db = database(env);
  const settings = await row(db);
  const credential = await keyOf(env, settings);
  if (!credential) throw new QafError(503, 'not_configured');
  if (settings.invalid_key) throw new QafError(503, 'invalid_keys');
  const hash = body ? await sha256Hex(`qaf:v1:${body}`) : null;
  if (hash) {
    const hit = await db.prepare('SELECT response FROM qaf_search_cache WHERE hash = ? AND expires_at > ?')
      .bind(hash, now()).first<{ response: string }>();
    if (hit) return qafSearchResult.parse(JSON.parse(hit.response));
  }

  let retriedMinute = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await reserve(db, settings, creator, search, attempt === 0);
    if (attempt === 0) await prune(db, now()).catch(() => logger.warn('[Qaf] Could not prune expired records'));
    const res = await (hooks.fetch ?? fetch)(QAF_BASE + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${credential}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
    }).catch(() => null);
    const payload: unknown = await res?.json().catch(() => null);
    if (res?.ok) {
      const parsed = result.safeParse(payload);
      if (!parsed.success) throw new QafError(503, 'invalid_response');
      if (hash) {
        const json = JSON.stringify(parsed.data);
        if (json.length <= 250_000) {
          await db.prepare('INSERT OR REPLACE INTO qaf_search_cache (hash, expires_at, response) VALUES (?, ?, ?)')
            .bind(hash, now() + WEEK, json).run().catch(() => logger.warn('[Qaf] Cache write failed'));
        }
      }
      if (search && settings.week_until && settings.week_until <= now()) {
        const clear = await db.prepare('UPDATE qaf_settings SET week_until = 0 WHERE key_version = ? AND week_until = ?')
          .bind(settings.key_version, settings.week_until).run();
        if (clear.meta.changes) hooks.recovered?.('week');
      }
      return parsed.data;
    }

    const refusal = z.object({ data: z.object({ reason: z.string().optional() }).optional() }).safeParse(payload);
    const reason = refusal.data?.data?.reason;
    const retryHeader = Number(res?.headers.get('Retry-After'));
    const retryAfter = Number.isSafeInteger(retryHeader) && retryHeader > 0 ? retryHeader : 1;
    if (res?.status === 429 && reason === 'week') {
      const at = now();
      const wait = retryHeader > 0 ? Math.min(retryAfter, WEEK) : WEEK;
      const updated = await db.prepare('UPDATE qaf_settings SET week_until = ? WHERE key_version = ? AND week_until <= ?')
        .bind(at + wait, settings.key_version, at).run();
      if (updated.meta.changes) hooks.report?.('week', res.headers.get('X-Request-Id'));
      throw new QafError(429, 'week', wait);
    }
    if (res?.status === 401 || res?.status === 403 || (res?.status === 429 && reason === 'invalid_keys')) {
      const updated = await db.prepare('UPDATE qaf_settings SET invalid_key = 1 WHERE key_version = ? AND invalid_key = 0')
        .bind(settings.key_version).run();
      if (updated.meta.changes) hooks.report?.('invalid_keys', res.headers.get('X-Request-Id'));
      throw new QafError(503, 'invalid_keys');
    }
    if (res?.status === 429) {
      const seconds = Math.min(MINUTE, retryAfter);
      await db.prepare('UPDATE qaf_settings SET minute_until = max(minute_until, ?) WHERE key_version = ?')
        .bind(now() + seconds, settings.key_version).run();
      if (attempt === 2 || retriedMinute) throw new QafError(429, 'minute', seconds);
      retriedMinute = true;
      await (hooks.sleep ?? delay)(seconds);
      continue;
    }
    if (res?.status === 404) throw new QafError(404, 'not_found');
    if (res && res.status < 500) throw new QafError(400, reason === 'no_matching_books' ? reason : 'invalid_request');
    if (attempt < 2) await (hooks.sleep ?? delay)(0.25 * 2 ** attempt);
  }
  throw new QafError(503, 'unavailable');
}

async function prune(db: D1Database, at: number) {
  await db.prepare('DELETE FROM qaf_usage WHERE is_search = 0 AND at <= ?').bind(at - MINUTE).run();
  await db.prepare('DELETE FROM qaf_usage WHERE is_search = 1 AND at <= ?').bind(at - WEEK).run();
  await db.prepare('DELETE FROM qaf_search_cache WHERE expires_at <= ?').bind(at).run();
}
