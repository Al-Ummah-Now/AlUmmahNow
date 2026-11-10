/**
 * Error groups in REPORTS_DB (migration 0009). Ingest folds each scrubbed
 * event into its group (by fingerprint), counts it per release and per hour,
 * tracks affected users, keeps a bounded set of raw samples and the
 * reference → group map, and reopens a resolved group when it recurs in a
 * newer release. The admin Errors page reads and updates groups here.
 */
import {
  culprit as culpritOf,
  fingerprint as fingerprintOf,
  hash64,
  normalizeRoute,
  parseStack,
  type ErrorEventInput,
  type ErrorStatus,
  type NeedsActionStatus,
  type StackFrame,
} from '@al-ummah/shared-types';
import type { D1Database, D1PreparedStatement } from './types';

export const ERROR_SAMPLE_LIMITS = {
  /** Samples always kept for a new group before sampling starts */
  alwaysKeep: 20,
  /** Probability a later background occurrence is stored as a sample */
  sampleRate: 0.1,
  /** Samples kept per group (oldest trimmed) */
  maxPerGroup: 50,
  /** Distinct users counted per group */
  maxUsers: 10_000,
} as const;

export const ERROR_RATE_LIMITS = {
  /** Events per client IP per minute through the apps' /api/errors routes */
  perIpMinute: 60,
  /** Events per group per minute stored in full (the rest only add to counts) */
  perGroupMinute: 120,
} as const;

export const ERROR_RETENTION_DAYS = 30;

export interface ErrorGroupRow {
  id: string;
  fingerprint: string;
  environment: string;
  app: string;
  kind: string;
  name: string | null;
  message: string;
  culprit: string | null;
  route: string | null;
  status: ErrorStatus;
  occurrences: number;
  users: number;
  samples: number;
  first_seen: string;
  last_seen: string;
  first_release: string | null;
  last_release: string | null;
  resolved_at: string | null;
  resolved_release: string | null;
  regressed_at: string | null;
  assignee_id: string | null;
  assignee_email: string | null;
  last_alert_at: string | null;
  test: number;
  updated_at: string;
}

export interface ErrorEventRow {
  id: string;
  group_id: string;
  ref: string;
  kind: string;
  occurred_at: string;
  received_at: string;
  count: number;
  release: string | null;
  worker_version: string | null;
  environment: string | null;
  route: string | null;
  method: string | null;
  status: number | null;
  locale: string | null;
  theme: string | null;
  browser: string | null;
  os: string | null;
  user_id: string | null;
  request_id: string | null;
  name: string | null;
  message: string;
  stack: string | null;
  symbolicated_stack: string | null;
  shown: number;
  extra_json: string | null;
}

export interface ErrorActivityRow {
  id: string;
  group_id: string;
  kind: 'created' | 'status' | 'assign' | 'note' | 'reopened' | 'alert' | 'retry' | 'item';
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface IngestContext {
  now: Date;
  /** Environment of this admin-api (events that do not name one get it) */
  environment: string;
  /** Keyed hash of the reporting client's IP + browser (client events), for anonymous user counts */
  clientKey?: string;
  browser?: string;
  os?: string;
  /** Original-source frames for an event, when its release's source maps are available */
  symbolicate?: (e: ErrorEventInput, frames: StackFrame[]) => Promise<StackFrame[] | null>;
  random?: () => number;
  /** False for browser-sourced batches: their retry specs are dropped. */
  trustedRetry?: boolean;
}

export interface IngestOutcome {
  accepted: number;
  rateLimited: number;
  /** Groups created by this batch (alert candidates) */
  created: ErrorGroupRow[];
  /** Groups whose occurrences this hour spiked (alert candidates) */
  spiking: ErrorGroupRow[];
  /** Groups reopened because they recurred in a newer release */
  reopened: string[];
}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const hourOf = (d: Date) => d.toISOString().slice(0, 13);
const minuteOf = (d: Date) => d.toISOString().slice(0, 16);

/**
 * Fixed-window counter: adds `by` to the bucket and returns the new count.
 * One statement, so concurrent requests cannot both pass under a limit.
 */
export async function bumpRate(db: D1Database, bucket: string, expiresAt: Date, by = 1): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO error_rate (bucket, count, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = count + excluded.count
       RETURNING count`,
    )
    .bind(bucket, by, expiresAt.toISOString())
    .first<{ count: number }>();
  return row?.count ?? by;
}

/**
 * Per-client limit of the browser routes (checked when a batch is received,
 * before it is queued). Returns how many of `n` events may go through.
 */
export async function allowClientEvents(db: D1Database, clientKey: string, n: number, now: Date): Promise<number> {
  const count = await bumpRate(db, `ip:${clientKey}:${minuteOf(now)}`, new Date(now.getTime() + 120_000), n);
  if (count <= ERROR_RATE_LIMITS.perIpMinute) return n;
  return Math.max(0, ERROR_RATE_LIMITS.perIpMinute - (count - n));
}

/** Group id: stable per environment + fingerprint, so concurrent first occurrences land in one row. */
export const groupIdFor = (environment: string, fingerprint: string) => `eg_${hash64(`${environment}\n${fingerprint}`)}`;

/** True when `release` was first seen after `than` (both of this app in this environment). */
async function isNewerRelease(db: D1Database, env: string, app: string, release: string, than: string | null, resolvedAt: string | null): Promise<boolean> {
  if (!release || release === than) return false;
  const rows = await db
    .prepare('SELECT release, first_seen FROM error_releases WHERE environment = ? AND app = ? AND release IN (?, ?)')
    .bind(env, app, release, than ?? '')
    .all<{ release: string; first_seen: string }>();
  const seen = new Map((rows.results ?? []).map((r) => [r.release, r.first_seen]));
  const mine = seen.get(release);
  if (!mine) return false;
  const theirs = than ? seen.get(than) : undefined;
  if (theirs) return mine > theirs;
  // Resolved without a known release: newer means first seen after the resolution
  return !!resolvedAt && mine > resolvedAt;
}

export async function ingestErrorEvents(db: D1Database, events: ErrorEventInput[], ctx: IngestContext): Promise<IngestOutcome> {
  const out: IngestOutcome = { accepted: 0, rateLimited: 0, created: [], spiking: [], reopened: [] };
  const now = ctx.now;
  const nowIso = now.toISOString();
  const random = ctx.random ?? Math.random;

  for (const original of events) {
    // Browser batches are untrusted: admin-api's own environment, and their item keys live in a
    // separate "browser:" namespace so they can never update an item a Worker reported
    const e =
      ctx.trustedRetry === false
        ? { ...original, environment: undefined, action: original.action ? { ...original.action, key: `browser:${original.action.key}`.slice(0, 160), retry: undefined } : undefined }
        : original;
    const environment = e.environment || ctx.environment;
    const occurredAt = e.occurredAt && Math.abs(Date.parse(e.occurredAt) - now.getTime()) < 86400_000 ? e.occurredAt : nowIso;
    const count = e.count ?? 1;
    const raw = parseStack(e.stack);
    const mapped = ctx.symbolicate && raw.length ? await ctx.symbolicate(e, raw).catch(() => null) : null;
    const frames = mapped ?? raw;
    // Needs-action items group by source + title (the message is the varying failure reason)
    const fp = e.action
      ? fingerprintOf({ app: e.app, name: `action:${e.action.source}`, message: e.action.title })
      : fingerprintOf({ app: e.app, name: e.name, message: e.message, route: e.route, frames });
    const gid = groupIdFor(environment, fp);
    const route = normalizeRoute(e.route) || null;

    const group = await db
      .prepare(
        `INSERT INTO error_groups (id, fingerprint, environment, app, kind, name, message, culprit, route, status, occurrences, users, samples,
                                   first_seen, last_seen, first_release, last_release, test, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, 0, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(environment, fingerprint) DO UPDATE SET
           occurrences = occurrences + excluded.occurrences,
           last_seen = MAX(last_seen, excluded.last_seen),
           last_release = COALESCE(excluded.last_release, last_release),
           first_release = COALESCE(first_release, excluded.first_release),
           message = excluded.message,
           kind = excluded.kind,
           culprit = COALESCE(excluded.culprit, culprit),
           test = MIN(test, excluded.test),
           updated_at = excluded.updated_at
         RETURNING *`,
      )
      .bind(gid, fp, environment, e.app, e.kind, e.name ?? null, e.action ? e.action.title : e.message, e.action ? `${e.action.source}${e.action.itemType ? ` · ${e.action.itemType}` : ''}` : culpritOf({ app: e.app, message: e.message, route: e.route, frames }) || null, route, count, occurredAt, occurredAt, e.release ?? null, e.release ?? null, e.test ? 1 : 0, nowIso)
      .first<ErrorGroupRow>();
    if (!group) continue;
    out.accepted += 1;
    const isNew = group.occurrences === count && group.samples === 0;

    const hour = hourOf(new Date(occurredAt));
    const writes: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO error_hourly (group_id, hour, occurrences) VALUES (?, ?, ?)
           ON CONFLICT(group_id, hour) DO UPDATE SET occurrences = occurrences + excluded.occurrences`,
        )
        .bind(gid, hour, count),
      db.prepare('INSERT OR IGNORE INTO error_refs (ref, group_id, event_id, created_at) VALUES (?, ?, NULL, ?)').bind(e.ref, gid, nowIso),
    ];
    if (e.release) {
      writes.push(
        db.prepare('INSERT OR IGNORE INTO error_releases (environment, app, release, first_seen) VALUES (?, ?, ?, ?)').bind(environment, e.app, e.release, nowIso),
        db
          .prepare(
            `INSERT INTO error_group_releases (group_id, release, occurrences, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(group_id, release) DO UPDATE SET occurrences = occurrences + excluded.occurrences, last_seen = MAX(last_seen, excluded.last_seen)`,
          )
          .bind(gid, e.release, count, occurredAt, occurredAt),
      );
    }
    if (isNew) {
      writes.push(
        db
          .prepare("INSERT INTO error_group_activity (id, group_id, kind, to_status, created_at) VALUES (?, ?, 'created', 'new', ?)")
          .bind(id('ega'), gid, nowIso),
      );
    }
    await db.batch(writes);

    // Affected users: the account, else the anonymous client key
    const userKey = e.userId ?? (ctx.clientKey ? `anon:${ctx.clientKey}` : null);
    if (userKey && group.users < ERROR_SAMPLE_LIMITS.maxUsers) {
      const added = await db.prepare('INSERT OR IGNORE INTO error_group_users (group_id, user_key) VALUES (?, ?)').bind(gid, userKey).run();
      if (((added.meta as { changes?: number } | undefined)?.changes ?? 0) > 0) {
        await db.prepare('UPDATE error_groups SET users = users + 1 WHERE id = ?').bind(gid).run();
        group.users += 1;
      }
    }

    // Recurred after being resolved, in a newer release: back to new
    if (group.status === 'resolved' && e.release && !e.test) {
      if (await isNewerRelease(db, environment, e.app, e.release, group.resolved_release, group.resolved_at)) {
        await db.batch([
          db.prepare("UPDATE error_groups SET status = 'new', regressed_at = ?, updated_at = ? WHERE id = ? AND status = 'resolved'").bind(nowIso, nowIso, gid),
          db
            .prepare("INSERT INTO error_group_activity (id, group_id, kind, from_status, to_status, body, created_at) VALUES (?, ?, 'reopened', 'resolved', 'new', ?, ?)")
            .bind(id('ega'), gid, `Recurred in release ${e.release}`, nowIso),
        ]);
        group.status = 'new';
        group.regressed_at = nowIso;
        out.reopened.push(gid);
      }
    }

    // Needs-action item: one row per key; a repeat updates it and reopens it if it was closed
    if (e.action) {
      const reopenedItem = await upsertActionItem(db, gid, environment, e, nowIso, ctx.trustedRetry !== false);
      if (reopenedItem && (group.status === 'resolved' || group.status === 'acknowledged') && !e.test) {
        await db.batch([
          db.prepare("UPDATE error_groups SET status = 'new', regressed_at = ?, updated_at = ? WHERE id = ?").bind(nowIso, nowIso, gid),
          db
            .prepare("INSERT INTO error_group_activity (id, group_id, kind, from_status, to_status, body, created_at) VALUES (?, ?, 'reopened', ?, 'new', ?, ?)")
            .bind(id('ega'), gid, group.status, `Needs action: ${e.action.title} (${e.action.key})`, nowIso),
        ]);
        out.reopened.push(gid);
        group.status = 'new';
      }
    }

    // Sample: always for what a user saw, for a new group's first ones, then sampled; never above the per-minute cap
    const groupMinute = await bumpRate(db, `grp:${gid}:${minuteOf(now)}`, new Date(now.getTime() + 120_000));
    const keep = groupMinute <= ERROR_RATE_LIMITS.perGroupMinute && (e.shown || group.samples < ERROR_SAMPLE_LIMITS.alwaysKeep || random() < ERROR_SAMPLE_LIMITS.sampleRate);
    if (keep) {
      const eventId = id('ev');
      const symbolicated = mapped ? formatSymbolicated(e, mapped) : null;
      await db.batch([
        db
          .prepare(
            `INSERT INTO error_events (id, group_id, ref, kind, occurred_at, received_at, count, release, worker_version, environment, route, method, status,
                                       locale, theme, browser, os, user_id, request_id, name, message, stack, symbolicated_stack, shown, extra_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            eventId, gid, e.ref, e.kind, occurredAt, nowIso, count, e.release ?? null, e.workerVersion ?? null, environment, e.route ?? null, e.method ?? null, e.status ?? null,
            e.locale ?? null, e.theme ?? null, ctx.browser || null, ctx.os || null, e.userId ?? null, e.requestId ?? null, e.name ?? null, e.message, e.stack ?? null,
            symbolicated, e.shown ? 1 : 0, e.extra ? JSON.stringify(e.extra) : null,
          ),
        db.prepare('UPDATE error_refs SET event_id = ? WHERE ref = ? AND group_id = ?').bind(eventId, e.ref, gid),
        db.prepare('UPDATE error_groups SET samples = samples + 1 WHERE id = ?').bind(gid),
      ]);
      group.samples += 1;
      if (group.samples > ERROR_SAMPLE_LIMITS.maxPerGroup) {
        await db.batch([
          db
            .prepare('DELETE FROM error_events WHERE group_id = ? AND id NOT IN (SELECT id FROM error_events WHERE group_id = ? ORDER BY occurred_at DESC LIMIT ?)')
            .bind(gid, gid, ERROR_SAMPLE_LIMITS.maxPerGroup),
          db.prepare('UPDATE error_groups SET samples = (SELECT COUNT(*) FROM error_events WHERE group_id = ?) WHERE id = ?').bind(gid, gid),
        ]);
      }
    }

    if (isNew) out.created.push(group);
    else if (!e.test && (await isSpiking(db, gid, hour))) out.spiking.push(group);
  }
  return out;
}

export interface ErrorActionRow {
  id: string;
  group_id: string;
  environment: string;
  item_key: string;
  app: string;
  source: string;
  title: string;
  detail: string | null;
  item_type: string | null;
  item_id: string | null;
  item_url: string | null;
  retry_json: string | null;
  retry_label: string | null;
  status: NeedsActionStatus;
  occurrences: number;
  attempts: number;
  last_attempt_at: string | null;
  last_attempt_result: string | null;
  last_attempt_by: string | null;
  last_ref: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

/**
 * Inserts or updates the item of a needs-action event. Returns true when the
 * item is new or came back after being resolved/dismissed (needs an admin again).
 */
async function upsertActionItem(db: D1Database, gid: string, environment: string, e: ErrorEventInput, nowIso: string, trustedRetry: boolean): Promise<boolean> {
  const a = e.action!;
  const retry = trustedRetry && a.retry ? JSON.stringify(a.retry) : null;
  const before = await db.prepare('SELECT status FROM error_actions WHERE environment = ? AND item_key = ?').bind(environment, a.key).first<{ status: NeedsActionStatus }>();
  await db
    .prepare(
      `INSERT INTO error_actions (id, group_id, environment, item_key, app, source, title, detail, item_type, item_id, item_url, retry_json, retry_label,
                                  status, occurrences, attempts, last_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, ?, ?, ?)
       ON CONFLICT(environment, item_key) DO UPDATE SET
         group_id = excluded.group_id, title = excluded.title, detail = excluded.detail,
         item_type = COALESCE(excluded.item_type, item_type), item_id = COALESCE(excluded.item_id, item_id),
         item_url = COALESCE(excluded.item_url, item_url), retry_json = COALESCE(excluded.retry_json, retry_json),
         retry_label = COALESCE(excluded.retry_label, retry_label),
         status = 'open', resolved_at = NULL, occurrences = occurrences + excluded.occurrences,
         last_ref = excluded.last_ref, updated_at = excluded.updated_at`,
    )
    .bind(
      id('act'), gid, environment, a.key, e.app, a.source, a.title, e.message === a.title ? null : e.message, a.itemType ?? null, a.itemId ?? null, a.itemUrl ?? null,
      retry, a.retryLabel ?? null, e.count ?? 1, e.ref, nowIso, nowIso,
    )
    .run();
  return !before || before.status === 'resolved' || before.status === 'dismissed';
}

/** Items a feature fixed itself (reported by key): resolved, with a timeline entry. */
export async function resolveActionItems(db: D1Database, environment: string, keys: string[], now: Date, by = 'reporter'): Promise<number> {
  let n = 0;
  const nowIso = now.toISOString();
  for (const key of keys.slice(0, 50)) {
    const row = await db
      .prepare("UPDATE error_actions SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE environment = ? AND item_key = ? AND status IN ('open', 'retrying') RETURNING group_id, title")
      .bind(nowIso, nowIso, environment, key)
      .first<{ group_id: string; title: string }>();
    if (!row) continue;
    n += 1;
    await db
      .prepare("INSERT INTO error_group_activity (id, group_id, kind, to_status, body, actor_id, created_at) VALUES (?, ?, 'item', 'resolved', ?, ?, ?)")
      .bind(id('ega'), row.group_id, `${row.title} (${key}) resolved`, by, nowIso)
      .run();
  }
  return n;
}

export async function listGroupActions(db: D1Database, groupId: string, includeClosed = true, limit = 100): Promise<ErrorActionRow[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM error_actions WHERE group_id = ? ${includeClosed ? '' : "AND status IN ('open', 'retrying')"}
       ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'retrying' THEN 1 ELSE 2 END, updated_at DESC LIMIT ?`,
    )
    .bind(groupId, limit)
    .all<ErrorActionRow>();
  return rows.results ?? [];
}

export async function getActionItem(db: D1Database, actionId: string): Promise<ErrorActionRow | null> {
  return db.prepare('SELECT * FROM error_actions WHERE id = ?').bind(actionId).first<ErrorActionRow>();
}

/** Records a retry attempt (or a dismissal) on an item and in the group's activity log. */
export async function recordActionAttempt(
  db: D1Database,
  item: ErrorActionRow,
  outcome: { status: NeedsActionStatus; result: string },
  actor: Actor,
  now: Date,
  kind: 'retry' | 'item' = 'retry',
): Promise<void> {
  const nowIso = now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE error_actions SET status = ?, attempts = attempts + ?, last_attempt_at = ?, last_attempt_result = ?, last_attempt_by = ?, updated_at = ?,
           resolved_at = CASE WHEN ? IN ('resolved', 'dismissed') THEN ? ELSE NULL END
         WHERE id = ?`,
      )
      .bind(outcome.status, kind === 'retry' ? 1 : 0, nowIso, outcome.result.slice(0, 500), actor.email || actor.id, nowIso, outcome.status, nowIso, item.id),
    db
      .prepare('INSERT INTO error_group_activity (id, group_id, kind, to_status, body, actor_id, actor_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id('ega'), item.group_id, kind, outcome.status, `${item.title} (${item.item_key}): ${outcome.result}`.slice(0, 1000), actor.id, actor.email, nowIso),
  ]);
}

/** Open needs-action items (nav badge). */
export async function openActionCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM error_actions a JOIN error_groups g ON g.id = a.group_id WHERE a.status IN ('open', 'retrying') AND g.test = 0").first<{ n: number }>();
  return row?.n ?? 0;
}

/** This hour has at least 50 occurrences and 10× the hourly average of the previous 24 hours. */
export async function isSpiking(db: D1Database, groupId: string, hour: string): Promise<boolean> {
  const since = hourOf(new Date(Date.parse(`${hour}:00:00Z`) - 24 * 3600_000));
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN hour = ? THEN occurrences END), 0) AS current,
              COALESCE(SUM(CASE WHEN hour < ? AND hour >= ? THEN occurrences END), 0) AS previous
       FROM error_hourly WHERE group_id = ? AND hour >= ?`,
    )
    .bind(hour, hour, since, groupId, since)
    .first<{ current: number; previous: number }>();
  if (!row) return false;
  return row.current >= 50 && row.current >= 10 * (row.previous / 24);
}

function formatSymbolicated(e: ErrorEventInput, frames: StackFrame[]): string {
  return [`${e.name || 'Error'}: ${e.message}`, ...frames.map((f) => `    at ${f.fn} (${f.file}${f.line ? `:${f.line}` : ''}${f.column ? `:${f.column}` : ''})`)].join('\n').slice(0, 8000);
}

// ---------------------------------------------------------------------------
// Admin reads and actions
// ---------------------------------------------------------------------------

export const ERROR_SORTS = ['last_seen', 'count', 'users', 'first_seen'] as const;
export type ErrorSort = (typeof ERROR_SORTS)[number];

export interface ErrorGroupFilters {
  app?: string;
  environment?: string;
  release?: string;
  status?: ErrorStatus;
  /** UTC days (YYYY-MM-DD): groups seen in the range */
  from?: string;
  to?: string;
  q?: string;
  assignee?: 'me' | 'unassigned';
  viewerId?: string;
  includeTest?: boolean;
  sort?: ErrorSort;
  /** Only groups with open needs-action items */
  needsAction?: boolean;
  limit: number;
  offset: number;
}

const SORT_SQL: Record<ErrorSort, string> = {
  last_seen: 'g.last_seen DESC',
  count: 'g.occurrences DESC, g.last_seen DESC',
  users: 'g.users DESC, g.last_seen DESC',
  first_seen: 'g.first_seen DESC',
};

export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export interface ErrorGroupListItem extends ErrorGroupRow {
  /** Open needs-action items in the group */
  open_actions: number;
  /** Occurrences per UTC day, oldest first, for the sparkline */
  daily: number[];
}

/** Days of the sparkline on the list. */
export const SPARK_DAYS = 14;

export async function listErrorGroups(db: D1Database, f: ErrorGroupFilters, now = new Date()): Promise<{ groups: ErrorGroupListItem[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.app) {
    where.push('g.app = ?');
    args.push(f.app);
  }
  if (f.environment) {
    where.push('g.environment = ?');
    args.push(f.environment);
  }
  if (f.status) {
    where.push('g.status = ?');
    args.push(f.status);
  }
  if (f.release) {
    where.push('EXISTS (SELECT 1 FROM error_group_releases r WHERE r.group_id = g.id AND r.release = ?)');
    args.push(f.release);
  }
  if (f.from) {
    where.push('g.last_seen >= ?');
    args.push(`${f.from}T00:00:00.000Z`);
  }
  if (f.to) {
    where.push('g.first_seen <= ?');
    args.push(`${f.to}T23:59:59.999Z`);
  }
  if (f.assignee === 'me' && f.viewerId) {
    where.push('g.assignee_id = ?');
    args.push(f.viewerId);
  } else if (f.assignee === 'unassigned') where.push('g.assignee_id IS NULL');
  if (!f.includeTest) where.push('g.test = 0');
  if (f.needsAction) where.push("EXISTS (SELECT 1 FROM error_actions a WHERE a.group_id = g.id AND a.status IN ('open', 'retrying'))");
  if (f.q) {
    const ref = /^ERR-[0-9A-Z]{4}-[0-9A-Z]{4}$/i.test(f.q.trim()) ? f.q.trim().toUpperCase() : null;
    const p = likePattern(f.q);
    where.push(
      `(g.message LIKE ? ESCAPE '\\' OR g.culprit LIKE ? ESCAPE '\\' OR g.route LIKE ? ESCAPE '\\' OR g.name LIKE ? ESCAPE '\\' OR g.id = ?${ref ? ' OR g.id IN (SELECT group_id FROM error_refs WHERE ref = ?)' : ''}
        OR g.id IN (SELECT group_id FROM error_events WHERE request_id = ?))`,
    );
    args.push(p, p, p, p, f.q.trim(), ...(ref ? [ref] : []), f.q.trim());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM error_groups g ${clause}`).bind(...args).first<{ n: number }>();
  const rows = await db
    .prepare(`SELECT g.*, (SELECT COUNT(*) FROM error_actions a WHERE a.group_id = g.id AND a.status IN ('open', 'retrying')) AS open_actions FROM error_groups g ${clause} ORDER BY ${SORT_SQL[f.sort ?? 'last_seen']} LIMIT ? OFFSET ?`)
    .bind(...args, f.limit, f.offset)
    .all<ErrorGroupRow & { open_actions: number }>();
  const groups = rows.results ?? [];
  const daily = await dailyCounts(db, groups.map((g) => g.id), SPARK_DAYS, now);
  return { groups: groups.map((g) => ({ ...g, daily: daily.get(g.id) ?? new Array(SPARK_DAYS).fill(0) })), total: total?.n ?? 0 };
}

/** Occurrences per UTC day for the last `days` days (oldest first), per group. */
export async function dailyCounts(db: D1Database, groupIds: string[], days: number, now = new Date()): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (groupIds.length === 0) return result;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86400_000).toISOString().slice(0, 10));
  const placeholders = groupIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT group_id, substr(hour, 1, 10) AS day, SUM(occurrences) AS n FROM error_hourly
       WHERE group_id IN (${placeholders}) AND hour >= ? GROUP BY group_id, day`,
    )
    .bind(...groupIds, start.toISOString().slice(0, 13))
    .all<{ group_id: string; day: string; n: number }>();
  for (const gid of groupIds) result.set(gid, new Array(days).fill(0));
  for (const r of rows.results ?? []) {
    const i = dayKeys.indexOf(r.day);
    if (i >= 0) result.get(r.group_id)![i] = r.n;
  }
  return result;
}

/** Occurrences per UTC hour for the last `hours` hours (oldest first). */
export async function hourlyCounts(db: D1Database, groupId: string, hours: number, now = new Date()): Promise<{ hour: string; occurrences: number }[]> {
  const startMs = Date.parse(`${hourOf(now)}:00:00Z`) - (hours - 1) * 3600_000;
  const rows = await db
    .prepare('SELECT hour, occurrences FROM error_hourly WHERE group_id = ? AND hour >= ? ORDER BY hour')
    .bind(groupId, hourOf(new Date(startMs)))
    .all<{ hour: string; occurrences: number }>();
  const byHour = new Map((rows.results ?? []).map((r) => [r.hour, r.occurrences]));
  return Array.from({ length: hours }, (_, i) => {
    const h = hourOf(new Date(startMs + i * 3600_000));
    return { hour: h, occurrences: byHour.get(h) ?? 0 };
  });
}

export async function getErrorGroup(db: D1Database, groupId: string): Promise<ErrorGroupRow | null> {
  return db.prepare('SELECT * FROM error_groups WHERE id = ?').bind(groupId).first<ErrorGroupRow>();
}

export async function listGroupEvents(db: D1Database, groupId: string, limit = 20): Promise<ErrorEventRow[]> {
  const rows = await db.prepare('SELECT * FROM error_events WHERE group_id = ? ORDER BY occurred_at DESC LIMIT ?').bind(groupId, limit).all<ErrorEventRow>();
  return rows.results ?? [];
}

export async function listGroupReleases(db: D1Database, groupId: string): Promise<{ release: string; occurrences: number; first_seen: string; last_seen: string }[]> {
  const rows = await db
    .prepare('SELECT release, occurrences, first_seen, last_seen FROM error_group_releases WHERE group_id = ? ORDER BY last_seen DESC LIMIT 50')
    .bind(groupId)
    .all<{ release: string; occurrences: number; first_seen: string; last_seen: string }>();
  return rows.results ?? [];
}

export async function listGroupActivity(db: D1Database, groupId: string): Promise<ErrorActivityRow[]> {
  const rows = await db.prepare('SELECT * FROM error_group_activity WHERE group_id = ? ORDER BY created_at, rowid LIMIT 500').bind(groupId).all<ErrorActivityRow>();
  return rows.results ?? [];
}

/** Group and event of a reference a user quoted. */
export async function findByRef(db: D1Database, ref: string): Promise<{ group_id: string; event_id: string | null } | null> {
  return db.prepare('SELECT group_id, event_id FROM error_refs WHERE ref = ?').bind(ref).first<{ group_id: string; event_id: string | null }>();
}

export async function errorCounts(db: D1Database): Promise<Record<ErrorStatus, number>> {
  const rows = await db.prepare('SELECT status, COUNT(*) AS n FROM error_groups WHERE test = 0 GROUP BY status').all<{ status: ErrorStatus; n: number }>();
  const counts: Record<ErrorStatus, number> = { new: 0, acknowledged: 0, resolved: 0, ignored: 0 };
  for (const r of rows.results ?? []) counts[r.status] = r.n;
  return counts;
}

/** Values for the filter menus. */
export async function errorFacets(db: D1Database): Promise<{ apps: string[]; environments: string[]; releases: string[] }> {
  const [apps, envs, releases] = await db.batch([
    db.prepare('SELECT DISTINCT app AS v FROM error_groups ORDER BY app'),
    db.prepare('SELECT DISTINCT environment AS v FROM error_groups ORDER BY environment'),
    db.prepare('SELECT release AS v FROM error_releases GROUP BY release ORDER BY MAX(first_seen) DESC LIMIT 50'),
  ]);
  const values = (r: unknown) => ((r as { results?: { v: string }[] }).results ?? []).map((x) => x.v);
  return { apps: values(apps), environments: values(envs), releases: values(releases) };
}

export interface Actor {
  id: string;
  email: string | null;
}

/**
 * Status change, recorded in the activity log. Resolving remembers the
 * newest release the group was seen in, so a recurrence in a later release
 * reopens it. Returns false when the group does not exist.
 */
export async function setErrorStatus(db: D1Database, groupId: string, status: ErrorStatus, actor: Actor, now: Date): Promise<boolean> {
  const group = await getErrorGroup(db, groupId);
  if (!group) return false;
  if (group.status === status) return true;
  const nowIso = now.toISOString();
  await db.batch([
    status === 'resolved'
      ? db.prepare('UPDATE error_groups SET status = ?, resolved_at = ?, resolved_release = last_release, updated_at = ? WHERE id = ?').bind(status, nowIso, nowIso, groupId)
      : db.prepare('UPDATE error_groups SET status = ?, resolved_at = NULL, resolved_release = NULL, updated_at = ? WHERE id = ?').bind(status, nowIso, groupId),
    db
      .prepare("INSERT INTO error_group_activity (id, group_id, kind, from_status, to_status, actor_id, actor_email, created_at) VALUES (?, ?, 'status', ?, ?, ?, ?, ?)")
      .bind(id('ega'), groupId, group.status, status, actor.id, actor.email, nowIso),
  ]);
  return true;
}

/** Assigns the group to the actor (null unassigns), recorded in the activity log. */
export async function setErrorAssignee(db: D1Database, groupId: string, assignee: Actor | null, actor: Actor, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const r = await db
    .prepare('UPDATE error_groups SET assignee_id = ?, assignee_email = ?, updated_at = ? WHERE id = ?')
    .bind(assignee?.id ?? null, assignee?.email ?? null, nowIso, groupId)
    .run();
  if (((r.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) return false;
  await db
    .prepare("INSERT INTO error_group_activity (id, group_id, kind, body, actor_id, actor_email, created_at) VALUES (?, ?, 'assign', ?, ?, ?, ?)")
    .bind(id('ega'), groupId, assignee ? assignee.email || assignee.id : null, actor.id, actor.email, nowIso)
    .run();
  return true;
}

export async function addErrorNote(db: D1Database, groupId: string, body: string, actor: Actor, now: Date): Promise<ErrorActivityRow | null> {
  if (!(await getErrorGroup(db, groupId))) return null;
  const row: ErrorActivityRow = {
    id: id('ega'),
    group_id: groupId,
    kind: 'note',
    from_status: null,
    to_status: null,
    body,
    actor_id: actor.id,
    actor_email: actor.email,
    created_at: now.toISOString(),
  };
  await db
    .prepare("INSERT INTO error_group_activity (id, group_id, kind, body, actor_id, actor_email, created_at) VALUES (?, ?, 'note', ?, ?, ?, ?)")
    .bind(row.id, groupId, body, actor.id, actor.email, row.created_at)
    .run();
  return row;
}

export async function recordAlert(db: D1Database, groupId: string, body: string, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  await db.batch([
    db.prepare('UPDATE error_groups SET last_alert_at = ? WHERE id = ?').bind(nowIso, groupId),
    db.prepare("INSERT INTO error_group_activity (id, group_id, kind, body, created_at) VALUES (?, ?, 'alert', ?, ?)").bind(id('ega'), groupId, body, nowIso),
  ]);
}

/**
 * Deletes everything a release E2E run created: groups whose every
 * occurrence was a test event and carry the given reference.
 */
export async function deleteTestGroupByRef(db: D1Database, ref: string): Promise<number> {
  const hit = await findByRef(db, ref);
  if (!hit) return 0;
  const group = await getErrorGroup(db, hit.group_id);
  if (!group || group.test !== 1) return 0;
  await deleteGroups(db, [group.id]);
  return 1;
}

async function deleteGroups(db: D1Database, ids: string[]): Promise<void> {
  for (const gid of ids) {
    await db.batch([
      db.prepare('DELETE FROM error_events WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_refs WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_group_users WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_group_releases WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_hourly WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_group_activity WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_actions WHERE group_id = ?').bind(gid),
      db.prepare('DELETE FROM error_groups WHERE id = ?').bind(gid),
    ]);
  }
}

/**
 * Retention (daily cron): samples, references, hourly counts and user keys
 * older than 30 days; expired rate counters; groups not seen for 90 days and
 * test groups older than a day.
 */
export async function pruneErrorData(db: D1Database, now: Date, days = ERROR_RETENTION_DAYS): Promise<{ events: number; groups: number }> {
  const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
  const results = await db.batch([
    db.prepare('DELETE FROM error_events WHERE received_at < ?').bind(cutoff),
    db.prepare('DELETE FROM error_refs WHERE created_at < ?').bind(cutoff),
    db.prepare('DELETE FROM error_hourly WHERE hour < ?').bind(cutoff.slice(0, 13)),
    db.prepare('DELETE FROM error_rate WHERE expires_at < ?').bind(now.toISOString()),
    db.prepare('DELETE FROM error_group_users WHERE group_id IN (SELECT id FROM error_groups WHERE last_seen < ?)').bind(cutoff),
    db.prepare('UPDATE error_groups SET samples = (SELECT COUNT(*) FROM error_events e WHERE e.group_id = error_groups.id) WHERE last_seen < ?').bind(cutoff),
  ]);
  const stale = await db
    .prepare('SELECT id FROM error_groups WHERE last_seen < ? OR (test = 1 AND last_seen < ?) LIMIT 500')
    .bind(new Date(now.getTime() - 90 * 86400_000).toISOString(), new Date(now.getTime() - 86400_000).toISOString())
    .all<{ id: string }>();
  const ids = (stale.results ?? []).map((r) => r.id);
  await deleteGroups(db, ids);
  return { events: (results[0] as { meta?: { changes?: number } }).meta?.changes ?? 0, groups: ids.length };
}
