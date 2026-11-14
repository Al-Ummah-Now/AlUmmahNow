/**
 * /api/ops/* — platform analytics for the Operations page (docs/admin/LIVE_OPS.md
 * Part A). Reads only our rollups in COSTS_DB, written hourly by apps/cost-monitor;
 * the browser never calls Cloudflare. Behind authMiddleware + adminMiddleware
 * (src/index.ts); reads need `ops:read` (admins), threshold changes `ops:manage`
 * (super admins, audited in site_settings_log).
 *
 *   GET /overview?env=            tiles: 24h vs previous 24h, worst latency/backlog, MTD cost vs the cap, data age, open alerts
 *   GET /series?env&kind&metric&resource&range=24h|7d|30d|13m   points for the shared chart (hourly ≤ 7d, daily beyond)
 *   GET /resources?env&kind       one row per resource: today's numbers, a 7-day sparkline, month-to-date cost
 *   GET /costs?env=all|<env>      spend: $500 budget meter (all sources), projected idle cost, daily trend per env, top drivers
 *   GET /thresholds               rules and open alerts
 *   PUT /thresholds/:id           { value?, enabled?, windowHours? }
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';
import {
  BUDGET_USD,
  budgetStatus,
  costWindowStart,
  findSpikes,
  fullDays,
  idleProjection,
  loadExtraDays,
  loadResourceDays,
  projectMonth,
  sumByDay,
} from '../lib/opsCost';

export { projectMonth, type Projection } from '../lib/opsCost';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const OPS_ENVS = ['production', 'stage', 'qa'] as const;
export const OPS_KINDS = ['worker', 'd1', 'r2', 'queue', 'kv', 'do'] as const;
const KINDS_TEXT = OPS_KINDS.join(', ');
/** Columns a series may read (never interpolated from input without this list). */
export const OPS_METRICS = ['requests', 'errors', 'cpu_p50', 'cpu_p99', 'latency_p50', 'latency_p99', 'reads', 'writes', 'bytes', 'stored_bytes', 'objects', 'backlog_avg', 'backlog_max', 'gb_seconds', 'cost_usd'] as const;
type Metric = (typeof OPS_METRICS)[number];
/** Summed across resources for a total; the rest take the worst (max). */
const SUMMED = new Set<Metric>(['requests', 'errors', 'reads', 'writes', 'bytes', 'stored_bytes', 'objects', 'backlog_avg', 'gb_seconds', 'cost_usd']);
export const RANGES = { '24h': { hours: 24 }, '7d': { hours: 168 }, '30d': { days: 30 }, '13m': { days: 396 } } as const;
/** The owner's budget for everything: Cloudflare, Bunny, Workers AI (docs/admin/LIVE_OPS.md §A.4). */
export const MONTHLY_CAP_USD = BUDGET_USD;
/** Data older than this is shown as stale (the collector runs hourly). */
export const STALE_AFTER_MS = 2 * 3_600_000;
export const THRESHOLD_AUDIT_PREFIX = 'ops:threshold:';

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const roles = (c: C) => normalizeRoles(c.get('auth')?.roles);

class NotReady extends Error {}

app.use('*', async (c, next) => {
  if (!hasPermission(roles(c), 'ops:read')) {
    logger.warn('[Ops] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The ops:read permission is required' }, 403);
  }
  if (!c.env.COSTS_DB) return c.json({ success: false, code: 'not_configured', error: 'Platform analytics are not configured here' }, 503);
  return next();
});

app.onError((error, c) => {
  if (error instanceof NotReady || /no such table/i.test(String((error as Error)?.message))) {
    return c.json({ success: false, code: 'not_ready', error: 'Platform analytics have not been collected yet' }, 503);
  }
  logger.error('[Ops] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, error: string) => c.json({ success: false, code: 'bad_request', error }, 400);

function envParam(c: C): (typeof OPS_ENVS)[number] | null {
  const env = c.req.query('env') ?? 'production';
  return (OPS_ENVS as readonly string[]).includes(env) ? (env as (typeof OPS_ENVS)[number]) : null;
}

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');
const hourFloor = (d: Date) => {
  const h = new Date(d);
  h.setUTCMinutes(0, 0, 0);
  return h;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

app.get('/overview', async (c) => {
  const env = envParam(c);
  if (!env) return bad(c, 'env must be production, stage or qa');
  const db = c.env.COSTS_DB!;
  const now = new Date();
  const end = hourFloor(now);
  const from = new Date(end.getTime() - 48 * 3_600_000);
  const mid = new Date(end.getTime() - 24 * 3_600_000);
  const totals = (await db
    .prepare(
      `SELECT kind, CASE WHEN hour >= ? THEN 'now' ELSE 'before' END AS span,
         SUM(requests) AS requests, SUM(errors) AS errors, MAX(cpu_p99) AS cpu_p99, MAX(latency_p99) AS latency_p99
       FROM ops_hourly WHERE env = ? AND hour >= ? GROUP BY kind, span`,
    )
    .bind(iso(mid), env, iso(from))
    .all<{ kind: string; span: string; requests: number | null; errors: number | null; cpu_p99: number | null; latency_p99: number | null }>()).results ?? [];
  const pick = (kind: string, span: string) => totals.find((t) => t.kind === kind && t.span === span);
  const rate = (t?: { requests: number | null; errors: number | null }) => (t && num(t.requests) > 0 ? num(t.errors) / num(t.requests) : null);

  const latestHour = await db.prepare('SELECT MAX(hour) AS hour FROM ops_hourly WHERE env = ? AND kind = ?').bind(env, 'queue').first<{ hour: string | null }>();
  const queues = latestHour?.hour
    ? (await db
        .prepare("SELECT name, backlog_max FROM ops_hourly WHERE env = ? AND kind = 'queue' AND hour = ? ORDER BY backlog_max DESC")
        .bind(env, latestHour.hour)
        .all<{ name: string; backlog_max: number | null }>()).results ?? []
    : [];
  const isDlq = (n: string) => /-dlq(-qa|-stage)?$/.test(n);
  const worstQueue = queues.find((q) => !isDlq(q.name)) ?? null;
  const dlqMessages = queues.filter((q) => isDlq(q.name)).reduce((s, q) => s + num(q.backlog_max), 0);

  const monthAgo = new Date(now.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);
  const daily = (await db
    .prepare('SELECT day, env, SUM(cost_usd) AS cost FROM ops_daily WHERE day >= ? GROUP BY day, env')
    .bind(monthAgo)
    .all<{ day: string; env: string; cost: number | null }>()).results ?? [];
  const byDay = (filter: (e: string) => boolean) => {
    const m = new Map<string, number>();
    for (const r of daily) if (filter(r.env)) m.set(r.day, (m.get(r.day) ?? 0) + num(r.cost));
    return [...m].map(([day, cost]) => ({ day, cost }));
  };
  const lastRun = await db
    .prepare("SELECT finished_at, status FROM collector_runs WHERE kind = 'hourly' AND status IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 1")
    .first<{ finished_at: string | null; status: string }>();
  const alerts = (await db.prepare('SELECT key, rule_id, resource_id, value, opened_at FROM ops_alerts WHERE env = ? ORDER BY opened_at DESC').bind(env).all()).results ?? [];
  const envs = ((await db.prepare('SELECT DISTINCT env FROM ops_daily').all<{ env: string }>()).results ?? []).map((r) => r.env);

  return c.json({
    success: true,
    result: {
      env,
      envs: OPS_ENVS.filter((e) => envs.includes(e)),
      workers: {
        requests: num(pick('worker', 'now')?.requests),
        requestsBefore: num(pick('worker', 'before')?.requests),
        errorRate: rate(pick('worker', 'now')),
        errorRateBefore: rate(pick('worker', 'before')),
        cpuP99: pick('worker', 'now')?.cpu_p99 ?? null,
      },
      d1: { latencyP99: pick('d1', 'now')?.latency_p99 ?? null, latencyP99Before: pick('d1', 'before')?.latency_p99 ?? null },
      queues: { worst: worstQueue ? { name: worstQueue.name, backlog: num(worstQueue.backlog_max) } : null, dlqMessages, at: latestHour?.hour ?? null },
      cost: {
        env: projectMonth(byDay((e) => e === env), now),
        all: projectMonth(byDay(() => true), now),
        capUsd: MONTHLY_CAP_USD,
        estimated: true,
      },
      dataAsOf: lastRun?.finished_at ?? null,
      stale: !lastRun?.finished_at || now.getTime() - Date.parse(lastRun.finished_at) > STALE_AFTER_MS,
      alerts,
    },
  });
});

app.get('/series', async (c) => {
  const env = envParam(c);
  if (!env) return bad(c, 'env must be production, stage or qa');
  const kind = c.req.query('kind') ?? '';
  if (!(OPS_KINDS as readonly string[]).includes(kind)) return bad(c, `kind must be one of ${KINDS_TEXT}`);
  const metric = (c.req.query('metric') ?? '') as Metric;
  if (!(OPS_METRICS as readonly string[]).includes(metric)) return bad(c, `metric must be one of ${OPS_METRICS.join(', ')}`);
  const rangeKey = (c.req.query('range') ?? '24h') as keyof typeof RANGES;
  const range = RANGES[rangeKey];
  if (!range) return bad(c, 'range must be 24h, 7d, 30d or 13m');
  const resource = c.req.query('resource');
  if (resource !== undefined && !/^(worker|d1|r2|queue|kv|do):[A-Za-z0-9_.-]{1,100}(\/[A-Za-z0-9_]{1,80})?$/.test(resource)) return bad(c, 'resource must be <kind>:<name>');

  const hourly = 'hours' in range;
  if (hourly && metric === 'cost_usd') return bad(c, 'cost is daily: use range 30d or 13m');
  const now = new Date();
  const table = hourly ? 'ops_hourly' : 'ops_daily';
  const col = hourly ? 'hour' : 'day';
  const from = hourly ? iso(new Date(hourFloor(now).getTime() - range.hours * 3_600_000)) : new Date(now.getTime() - range.days * 86_400_000).toISOString().slice(0, 10);
  const agg = SUMMED.has(metric) ? 'SUM' : 'MAX';
  const where = resource ? 'AND resource_id = ?' : '';
  const binds: unknown[] = [env, kind, from, ...(resource ? [resource] : [])];
  const rows = (await c.env.COSTS_DB!
    .prepare(`SELECT ${col} AS t, ${agg}(${metric}) AS value FROM ${table} WHERE env = ? AND kind = ? AND ${col} >= ? ${where} GROUP BY ${col} ORDER BY ${col}`)
    .bind(...binds)
    .all<{ t: string; value: number | null }>()).results ?? [];
  return c.json({ success: true, result: { env, kind, metric, resource: resource ?? null, range: rangeKey, granularity: hourly ? 'hour' : 'day', from, points: rows } });
});

/** The metric a resource table sparkline shows, per kind. */
export const SPARK_METRIC: Record<(typeof OPS_KINDS)[number], Metric> = { worker: 'requests', d1: 'reads', r2: 'requests', queue: 'backlog_max', kv: 'reads', do: 'gb_seconds' };

app.get('/resources', async (c) => {
  const env = envParam(c);
  if (!env) return bad(c, 'env must be production, stage or qa');
  const kind = (c.req.query('kind') ?? '') as (typeof OPS_KINDS)[number];
  if (!(OPS_KINDS as readonly string[]).includes(kind)) return bad(c, `kind must be one of ${KINDS_TEXT}`);
  const now = new Date();
  const from = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const db = c.env.COSTS_DB!;
  const spark = SPARK_METRIC[kind];
  const days = (await db
    .prepare(`SELECT * FROM ops_daily WHERE env = ? AND kind = ? AND day >= ? ORDER BY day`)
    .bind(env, kind, from < monthStart ? from : monthStart)
    .all<Record<string, unknown> & { day: string; resource_id: string; name: string }>()).results ?? [];
  const byResource = new Map<string, typeof days>();
  for (const d of days) {
    const list = byResource.get(d.resource_id) ?? [];
    list.push(d);
    byResource.set(d.resource_id, list);
  }
  const dayList = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10));
  const resources = [...byResource.entries()].map(([id, list]) => {
    const latest = list[list.length - 1];
    const metrics: Partial<Record<Metric, number | null>> = {};
    for (const m of OPS_METRICS) metrics[m] = (latest[m] as number | null) ?? null;
    return {
      id,
      name: latest.name,
      day: latest.day,
      metrics,
      spark: { metric: spark, days: dayList, values: dayList.map((d) => (list.find((x) => x.day === d)?.[spark] as number | null) ?? null) },
      monthCostUsd: Math.round(list.filter((x) => x.day >= monthStart).reduce((s, x) => s + num(x.cost_usd), 0) * 100) / 100,
    };
  });
  resources.sort((a, b) => num(b.metrics[spark]) - num(a.metrics[spark]) || a.name.localeCompare(b.name));
  return c.json({ success: true, result: { env, kind, resources } });
});

/** Top drivers listed on the cost tab (by month-to-date cost). */
export const COST_DRIVERS = 25;

app.get('/costs', async (c) => {
  const envFilter = c.req.query('env') ?? 'all';
  if (envFilter !== 'all' && !(OPS_ENVS as readonly string[]).includes(envFilter)) return bad(c, 'env must be all, production, stage or qa');
  const now = new Date();
  const since = costWindowStart(now);
  const [resourceDays, extras] = await Promise.all([loadResourceDays(c.env, since), loadExtraDays(c.env, since)]);
  const budget = budgetStatus({ cloudflare: sumByDay(resourceDays), ...extras }, now);
  const idle = idleProjection(resourceDays, extras, now);
  const spikes = findSpikes(resourceDays, now);

  // Daily trend: 30 days, one value per env plus the non-Cloudflare sources
  const trendDays = [...fullDays(now, 29), now.toISOString().slice(0, 10)];
  const perEnv = new Map<string, Map<string, number>>();
  for (const r of resourceDays) {
    const m = perEnv.get(r.env) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + num(r.cost));
    perEnv.set(r.env, m);
  }
  const series = (m: Map<string, number> | undefined) => trendDays.map((d) => Math.round((m?.get(d) ?? 0) * 100) / 100);
  const fromList = (list: { day: string; cost: number }[]) => new Map(list.map((x) => [x.day, x.cost]));
  const trend = {
    days: trendDays,
    series: [
      ...OPS_ENVS.map((e) => ({ key: e, values: series(perEnv.get(e)) })),
      { key: 'bunny', values: series(fromList(extras.bunny)) },
      { key: 'containers', values: series(fromList(extras.containers)) },
      { key: 'ai', values: series(fromList(extras.ai)) },
    ],
  };

  // Drivers: each resource's month-to-date cost, its 14-day daily cost and the idle floor
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const sparkDays = trendDays.slice(-14);
  const drivers = new Map<string, { id: string; env: string; kind: string; name: string; mtd: number; byDay: Map<string, number> }>();
  for (const r of resourceDays) {
    if (envFilter !== 'all' && r.env !== envFilter) continue;
    const d = drivers.get(r.resource_id) ?? { id: r.resource_id, env: r.env, kind: r.kind, name: r.name, mtd: 0, byDay: new Map<string, number>() };
    if (r.day >= monthStart) d.mtd += num(r.cost);
    d.byDay.set(r.day, (d.byDay.get(r.day) ?? 0) + num(r.cost));
    drivers.set(r.resource_id, d);
  }
  const idleById = new Map(idle.top.map((t) => [t.id, t.monthlyUsd]));
  const top = [...drivers.values()]
    .sort((a, b) => b.mtd - a.mtd)
    .slice(0, COST_DRIVERS)
    .map((d) => ({
      id: d.id,
      env: d.env,
      kind: d.kind,
      name: d.name,
      mtdUsd: Math.round(d.mtd * 100) / 100,
      idleMonthlyUsd: idleById.get(d.id) ?? 0,
      spike: spikes.find((s) => s.resourceId === d.id) ?? null,
      daily: { days: sparkDays, values: sparkDays.map((day) => Math.round((d.byDay.get(day) ?? 0) * 1000) / 1000) },
    }));

  return c.json({
    success: true,
    result: { env: envFilter, budget, idle, trend, drivers: top, spikes, estimated: true, sources: { bunny: extras.bunny.length > 0, ai: extras.ai.length > 0 } },
  });
});

app.get('/thresholds', async (c) => {
  const db = c.env.COSTS_DB!;
  const rules = (await db.prepare('SELECT id, kind, metric, op, value, window_hours, enabled, updated_by, updated_at FROM ops_thresholds ORDER BY id').all()).results ?? [];
  const alerts = (await db.prepare('SELECT key, rule_id, resource_id, env, value, opened_at, last_seen_at FROM ops_alerts ORDER BY opened_at DESC').all()).results ?? [];
  return c.json({ success: true, result: { rules, alerts, canManage: hasPermission(roles(c), 'ops:manage') } });
});

export interface ThresholdInput {
  value?: number;
  enabled?: boolean;
  windowHours?: number;
}

/** Validates a threshold change; returns an error message or the clean input. */
export function parseThresholdInput(body: unknown): ThresholdInput | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out: ThresholdInput = {};
  if (b.value !== undefined) {
    if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0 || b.value > 1e12) return 'value must be a number ≥ 0';
    out.value = b.value;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return 'enabled must be true or false';
    out.enabled = b.enabled;
  }
  if (b.windowHours !== undefined) {
    if (!Number.isInteger(b.windowHours) || (b.windowHours as number) < 1 || (b.windowHours as number) > 72) return 'windowHours must be 1–72';
    out.windowHours = b.windowHours as number;
  }
  if (Object.keys(out).length === 0) return 'nothing to change';
  return out;
}

app.put('/thresholds/:id', async (c) => {
  if (!hasPermission(roles(c), 'ops:manage')) {
    return c.json({ success: false, code: 'forbidden', error: 'The ops:manage permission is required' }, 403);
  }
  const id = c.req.param('id');
  const parsed = parseThresholdInput(await c.req.json().catch(() => null));
  if (typeof parsed === 'string') return bad(c, parsed);
  const db = c.env.COSTS_DB!;
  const before = await db.prepare('SELECT id, value, enabled, window_hours FROM ops_thresholds WHERE id = ?').bind(id).first<{ id: string; value: number; enabled: number; window_hours: number }>();
  if (!before) return c.json({ success: false, code: 'not_found', error: 'No such threshold' }, 404);
  const after = {
    value: parsed.value ?? before.value,
    enabled: parsed.enabled === undefined ? before.enabled : parsed.enabled ? 1 : 0,
    window_hours: parsed.windowHours ?? before.window_hours,
  };
  const now = new Date().toISOString();
  // Audit first (same log as the other admin settings); the change follows
  await c.env.REPORTS_DB.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), `${THRESHOLD_AUDIT_PREFIX}${id}`, JSON.stringify({ value: before.value, enabled: before.enabled, window_hours: before.window_hours }), JSON.stringify(after), actorOf(c), now)
    .run();
  await db.prepare('UPDATE ops_thresholds SET value = ?, enabled = ?, window_hours = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(after.value, after.enabled, after.window_hours, actorOf(c), now, id)
    .run();
  return c.json({ success: true, result: { id, ...after } });
});

export default app;
