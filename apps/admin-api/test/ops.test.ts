/**
 * /api/ops/* (Operations page, docs/admin/LIVE_OPS.md Part A): ops:read for
 * admins only, shapes of overview / series / resources, month projection,
 * threshold changes by super admins (audited), not-configured and not-ready answers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import opsRouter, { MONTHLY_CAP_USD, parseThresholdInput, projectMonth, THRESHOLD_AUDIT_PREFIX } from '../src/routers/ops.router';
import { budgetStatus, findSpikes, idleProjection, levelOf, syncCostAlerts, wantedAlerts, PLAN_BASE_USD, type AlertSink, type ResourceDay } from '../src/lib/opsCost';
import { hasPermission } from '../src/lib/roles';
import { sqliteD1 } from './d1-sqlite';

/** COSTS_DB with apps/cost-monitor's migrations (tests run from apps/admin-api). */
function costsD1(withTables = true): D1Database {
  const dir = join(process.cwd(), '..', 'cost-monitor', 'migrations');
  const db = new DatabaseSync(':memory:');
  if (withTables) for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const p = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
    const r = stmt.run(...p);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const st = (sql: string, args: unknown[] = []) => ({
    bind: (...n: unknown[]) => st(sql, n),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
  });
  return {
    prepare: (sql: string) => st(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((x) => x.run())),
  } as unknown as D1Database;
}

const hoursAgo = (h: number) => {
  const d = new Date(Date.now() - h * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function seed(db: D1Database) {
  const ins = (table: string, row: Record<string, unknown>) =>
    db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`).bind(...Object.values(row)).run();
  const base = { env: 'qa', updated_at: '2026-11-12T00:00:00Z' };
  await ins('ops_hourly', { ...base, hour: hoursAgo(2), resource_id: 'worker:videos-qa', kind: 'worker', name: 'videos-qa', requests: 1000, errors: 10, cpu_p50: 3000, cpu_p99: 90000 });
  await ins('ops_hourly', { ...base, hour: hoursAgo(30), resource_id: 'worker:videos-qa', kind: 'worker', name: 'videos-qa', requests: 500, errors: 0, cpu_p99: 50000 });
  await ins('ops_hourly', { ...base, hour: hoursAgo(2), resource_id: 'd1:al-ummah-now-reports-qa', kind: 'd1', name: 'al-ummah-now-reports-qa', latency_p99: 5.2, reads: 100 });
  await ins('ops_hourly', { ...base, hour: hoursAgo(2), resource_id: 'queue:al-ummah-now-videos-qa', kind: 'queue', name: 'al-ummah-now-videos-qa', backlog_max: 12 });
  await ins('ops_hourly', { ...base, hour: hoursAgo(2), resource_id: 'queue:al-ummah-now-dlq-qa', kind: 'queue', name: 'al-ummah-now-dlq-qa', backlog_max: 3 });
  await ins('ops_daily', { ...base, day: daysAgo(1), resource_id: 'worker:videos-qa', kind: 'worker', name: 'videos-qa', requests: 20000, cost_usd: 1.5 });
  await ins('ops_daily', { ...base, day: daysAgo(0), resource_id: 'worker:videos-qa', kind: 'worker', name: 'videos-qa', requests: 1500, cost_usd: 0.5 });
  await ins('ops_daily', { ...base, env: 'production', day: daysAgo(0), resource_id: 'worker:videos', kind: 'worker', name: 'videos', requests: 9, cost_usd: 2 });
  await ins('collector_runs', { id: 'r1', kind: 'hourly', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: 'ok' });
  await ins('ops_alerts', { key: 'ops:dlq-backlog:queue:al-ummah-now-dlq-qa', rule_id: 'dlq-backlog', resource_id: 'queue:al-ummah-now-dlq-qa', env: 'qa', value: 3, opened_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
}

function setup(roles: string[], costs: D1Database | null = costsD1()) {
  const env = { COSTS_DB: costs ?? undefined, REPORTS_DB: sqliteD1() };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/ops', opsRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return { req, env };
}
const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('ops permissions', () => {
  it('ops:read is for admins and super admins, ops:manage for super admins', () => {
    assert.equal(hasPermission(['Admin'], 'ops:read'), true);
    assert.equal(hasPermission(['Super Admin'], 'ops:read'), true);
    assert.equal(hasPermission(['Moderator'], 'ops:read'), false);
    assert.equal(hasPermission(['Admin'], 'ops:manage'), false);
    assert.equal(hasPermission(['Super Admin'], 'ops:manage'), true);
  });

  it('refuses moderators on every route', async () => {
    const { req } = setup(['moderator']);
    for (const path of ['/api/ops/overview', '/api/ops/series?kind=worker&metric=requests', '/api/ops/resources?kind=worker', '/api/ops/thresholds']) {
      assert.equal((await req(path)).status, 403, path);
    }
    assert.equal((await req('/api/ops/thresholds/dlq-backlog', put({ value: 5 }))).status, 403);
  });

  it('answers 503 when COSTS_DB is not bound or not migrated', async () => {
    assert.equal((await setup(['Admin'], null).req('/api/ops/overview')).status, 503);
    const r = await setup(['Admin'], costsD1(false)).req('/api/ops/overview?env=qa');
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { code: string }).code, 'not_ready');
  });
});

describe('/api/ops reads', () => {
  it('overview: 24h vs previous, worst queue, DLQ, cost vs the cap, freshness, alerts', async () => {
    const { req, env } = setup(['Admin']);
    await seed(env.COSTS_DB!);
    const r = await req('/api/ops/overview?env=qa');
    assert.equal(r.status, 200);
    const { result } = (await r.json()) as { result: any };
    assert.equal(result.env, 'qa');
    assert.deepEqual(result.envs, ['production', 'qa']);
    assert.equal(result.workers.requests, 1000);
    assert.equal(result.workers.requestsBefore, 500);
    assert.equal(result.workers.errorRate, 0.01);
    assert.equal(result.workers.errorRateBefore, 0);
    assert.equal(result.d1.latencyP99, 5.2);
    assert.deepEqual(result.queues.worst, { name: 'al-ummah-now-videos-qa', backlog: 12 });
    assert.equal(result.queues.dlqMessages, 3);
    assert.equal(result.cost.capUsd, MONTHLY_CAP_USD);
    assert.ok(result.cost.all.mtd >= result.cost.env.mtd);
    assert.equal(result.stale, false);
    assert.equal(result.alerts.length, 1);
  });

  it('rejects unknown env, kind, metric, range and resource', async () => {
    const { req } = setup(['Admin']);
    assert.equal((await req('/api/ops/overview?env=dev')).status, 400);
    assert.equal((await req('/api/ops/series?env=qa&kind=lambda&metric=requests')).status, 400);
    assert.equal((await req('/api/ops/series?env=qa&kind=worker&metric=requests;DROP')).status, 400);
    assert.equal((await req('/api/ops/series?env=qa&kind=worker&metric=requests&range=1y')).status, 400);
    assert.equal((await req("/api/ops/series?env=qa&kind=worker&metric=requests&resource=x'")).status, 400);
    assert.equal((await req('/api/ops/series?env=qa&kind=worker&metric=cost_usd&range=24h')).status, 400);
  });

  it('series: hourly points up to 7 days, daily beyond, per resource or totals', async () => {
    const { req, env } = setup(['Admin']);
    await seed(env.COSTS_DB!);
    const hourly = (await (await req('/api/ops/series?env=qa&kind=worker&metric=requests&range=7d')).json()) as { result: any };
    assert.equal(hourly.result.granularity, 'hour');
    assert.deepEqual(hourly.result.points.map((p: any) => p.value), [500, 1000]);
    const daily = (await (await req('/api/ops/series?env=qa&kind=worker&metric=cost_usd&range=30d&resource=worker:videos-qa')).json()) as { result: any };
    assert.equal(daily.result.granularity, 'day');
    assert.deepEqual(daily.result.points.map((p: any) => p.value), [1.5, 0.5]);
  });

  it('resources: latest numbers, a 7-day sparkline and month cost per resource', async () => {
    const { req, env } = setup(['Admin']);
    await seed(env.COSTS_DB!);
    const { result } = (await (await req('/api/ops/resources?env=qa&kind=worker')).json()) as { result: any };
    assert.equal(result.resources.length, 1);
    const r = result.resources[0];
    assert.equal(r.name, 'videos-qa');
    assert.equal(r.metrics.requests, 1500);
    assert.equal(r.spark.metric, 'requests');
    assert.equal(r.spark.values.length, 7);
    assert.deepEqual(r.spark.values.slice(-2), [20000, 1500]);
  });
});

describe('thresholds', () => {
  it('lists rules and open alerts', async () => {
    const { req, env } = setup(['Admin']);
    await seed(env.COSTS_DB!);
    const { result } = (await (await req('/api/ops/thresholds')).json()) as { result: any };
    assert.ok(result.rules.some((r: any) => r.id === 'worker-error-rate'));
    assert.equal(result.alerts.length, 1);
    assert.equal(result.canManage, false);
  });

  it('only super admins change them, audited before the change', async () => {
    assert.equal((await setup(['Admin']).req('/api/ops/thresholds/dlq-backlog', put({ value: 5 }))).status, 403);
    const { req, env } = setup(['Super Admin']);
    assert.equal((await req('/api/ops/thresholds/nope', put({ value: 5 }))).status, 404);
    assert.equal((await req('/api/ops/thresholds/dlq-backlog', put({ value: -1 }))).status, 400);
    const r = await req('/api/ops/thresholds/queue-backlog', put({ value: 5000, windowHours: 2 }));
    assert.equal(r.status, 200);
    const row = await env.COSTS_DB!.prepare("SELECT value, window_hours, updated_by FROM ops_thresholds WHERE id = 'queue-backlog'").first<any>();
    assert.deepEqual({ ...row }, { value: 5000, window_hours: 2, updated_by: 'admin-1' });
    const audit = (await env.REPORTS_DB.prepare('SELECT key, new_value FROM site_settings_log').all<any>()).results;
    assert.equal(audit[0].key, `${THRESHOLD_AUDIT_PREFIX}queue-backlog`);
    assert.equal(JSON.parse(audit[0].new_value).value, 5000);
  });

  it('validates the input', () => {
    assert.equal(typeof parseThresholdInput({}), 'string');
    assert.equal(typeof parseThresholdInput({ enabled: 'yes' }), 'string');
    assert.equal(typeof parseThresholdInput({ windowHours: 0 }), 'string');
    assert.deepEqual(parseThresholdInput({ value: 0, enabled: false }), { value: 0, enabled: false });
  });
});

describe('projectMonth', () => {
  it('projects linearly and from the trailing 7 full days', () => {
    const now = new Date('2026-11-11T00:00:00Z'); // 10 days elapsed of 30
    const daily = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, cost: i < 3 ? 1 : 2 }));
    const p = projectMonth(daily, now);
    assert.equal(p.mtd, 17);
    assert.equal(p.daysInMonth, 30);
    assert.equal(p.linear, 51);
    assert.equal(p.trailing, 17 + 2 * 20);
  });
});

describe('spend: budget, idle cost, jumps (lib/opsCost.ts)', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const day = (n: number) => new Date(Date.parse('2026-11-15T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
  const rd = (n: number, id: string, cost: number, env = 'qa'): ResourceDay => ({ day: day(n), env, resource_id: id, name: id.split(':')[1], kind: id.split(':')[0], cost });

  it('levels: warnings at 50% and 80%, over at 100%', () => {
    assert.deepEqual([0.49, 0.5, 0.79, 0.8, 1, 1.4].map(levelOf), ['ok', 'warn50', 'warn50', 'warn80', 'over', 'over']);
  });

  it('budget: every source plus the plan, month to date and projected to the end of the month', () => {
    const cloudflare = Array.from({ length: 15 }, (_, i) => ({ day: day(i), cost: 10 }));
    const b = budgetStatus({ cloudflare, bunny: [{ day: day(1), cost: 1 }], containers: [], ai: [{ day: day(2), cost: 0.5 }] }, now);
    assert.equal(b.capUsd, 500);
    assert.equal(b.month, '2026-11');
    // 15 days of $10 (1st..15th), $1 Bunny, $0.50 AI, the plan's 14.5/30 of $5
    assert.equal(b.parts.cloudflare.mtd, 150);
    assert.equal(b.parts.plan.projected, PLAN_BASE_USD);
    assert.equal(b.mtd, Math.round((150 + 1 + 0.5 + (5 * 14.5) / 30) * 100) / 100);
    // Trailing 7 full days of $10 for the 15.5 days left
    assert.equal(b.parts.cloudflare.projected, 305);
    assert.ok(b.projected > b.mtd);
    assert.equal(b.level, 'ok');
    assert.equal(b.projectedLevel, 'warn50');
  });

  it('idle: each driver at its quietest of the last 7 full days, a missing day is $0, plus the plan', () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => rd(i + 1, 'worker:videos-qa', 0.2 + i * 0.1)),
      rd(1, 'r2:al-ummah-now-messages-qa', 9), // a one-off drain: no floor
      ...Array.from({ length: 7 }, (_, i) => rd(i + 1, 'd1:al-ummah-now-reports', 0.05, 'production')),
    ];
    const idle = idleProjection(rows, { bunny: Array.from({ length: 7 }, (_, i) => ({ day: day(i + 1), cost: 0.1 })), containers: [], ai: [] }, now);
    assert.equal(idle.parts.cloudflare, Math.round((0.2 * 30 + 0.05 * 30) * 100) / 100);
    assert.equal(idle.parts.bunny, 3);
    assert.equal(idle.parts.plan, 5);
    assert.equal(idle.monthlyUsd, 6 + 1.5 + 3 + 5);
    assert.deepEqual(idle.byEnv, { qa: 6, production: 1.5 });
    assert.equal(idle.top[0].id, 'worker:videos-qa');
    assert.ok(!idle.top.some((t) => t.id.includes('messages')));
    assert.equal(idle.targetUsd, 50);
  });

  it('jumps: a driver or env total at 2x its 7-day average and enough dollars above it, yesterday or today', () => {
    const steady = Array.from({ length: 8 }, (_, i) => rd(i + 2, 'worker:videos-qa', 1));
    const spikes = findSpikes([...steady, rd(1, 'worker:videos-qa', 1), rd(0, 'r2:al-ummah-now-messages-qa', 6), rd(0, 'worker:tiny-qa', 0.4)], now);
    const keys = spikes.map((s) => s.key);
    assert.ok(keys.includes('ops-cost:spike:qa:r2:al-ummah-now-messages-qa'));
    assert.ok(keys.includes('ops-cost:spike:qa:total'));
    assert.ok(!keys.includes('ops-cost:spike:qa:worker:videos-qa'));
    // Under $0.50 above its baseline: not a jump, whatever the ratio
    assert.ok(!keys.includes('ops-cost:spike:qa:worker:tiny-qa'));
    assert.equal(spikes[0].key, 'ops-cost:spike:qa:r2:al-ummah-now-messages-qa');
    assert.equal(spikes[0].day, day(0));
  });

  it('alerts: budget levels crossed and a projected overrun, keyed by month; jumps keyed by env and driver', () => {
    const b = budgetStatus({ cloudflare: Array.from({ length: 15 }, (_, i) => ({ day: day(i), cost: 20 })), bunny: [], containers: [], ai: [] }, now);
    const keys = wantedAlerts(b, []).map((a) => a.key);
    assert.deepEqual(keys, ['ops-cost:budget:2026-11:50', 'ops-cost:projected:2026-11']);
    assert.deepEqual(wantedAlerts(null, []), []);
  });

  it('sync: reports a new alert once, resolves it when it clears; budget only on production', async () => {
    const db = costsD1();
    const ins = (row: Record<string, unknown>) =>
      db.prepare(`INSERT INTO ops_daily (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`).bind(...Object.values(row)).run();
    for (let i = 1; i <= 15; i++) await ins({ day: day(i), resource_id: 'worker:videos', kind: 'worker', env: 'production', name: 'videos', cost_usd: 20, updated_at: 'x' });
    const reported: string[] = [];
    const resolved: string[] = [];
    const sink: AlertSink = {
      report: async (events) => void reported.push(...events.map((e) => (e as { action: { key: string } }).action.key)),
      resolve: async (keys) => void resolved.push(...keys),
    };
    await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'qa' }, sink, now);
    assert.deepEqual(reported, []);
    await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' }, sink, now);
    assert.deepEqual(reported.sort(), ['ops-cost:budget:2026-11:50', 'ops-cost:projected:2026-11']);
    await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' }, sink, now);
    assert.equal(reported.length, 2);
    // Next month: last month's keys resolve
    await syncCostAlerts({ COSTS_DB: db, ENVIRONMENT: 'production' }, sink, new Date('2026-12-01T01:00:00Z'));
    assert.deepEqual(resolved.sort(), ['ops-cost:budget:2026-11:50', 'ops-cost:projected:2026-11']);
  });
});

describe('/api/ops/costs', () => {
  it('budget across sources, idle projection, 30-day trend per env and the top drivers', async () => {
    const { req, env } = setup(['Admin']);
    await seed(env.COSTS_DB!);
    const r = await req('/api/ops/costs');
    assert.equal(r.status, 200);
    const { result } = (await r.json()) as { result: any };
    assert.equal(result.budget.capUsd, 500);
    assert.deepEqual(result.budget.levels, [0.5, 0.8, 1]);
    assert.equal(result.trend.days.length, 30);
    assert.deepEqual(result.trend.series.map((s: any) => s.key), ['production', 'stage', 'qa', 'bunny', 'containers', 'ai']);
    assert.deepEqual(result.drivers.map((d: any) => d.id).sort(), ['worker:videos', 'worker:videos-qa']);
    assert.equal(result.drivers[0].daily.days.length, 14);
    assert.equal(typeof result.idle.monthlyUsd, 'number');
    assert.equal(result.idle.targetUsd, 50);
    const qa = (await (await req('/api/ops/costs?env=production')).json()) as { result: any };
    assert.deepEqual(qa.result.drivers.map((d: any) => d.id), ['worker:videos']);
    assert.equal((await req('/api/ops/costs?env=dev')).status, 400);
  });
});
