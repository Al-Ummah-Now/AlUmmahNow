/**
 * D1 capacity alerts (wiki AUN-D1-SCALING, D1-1): the migration widens two CHECKs without losing
 * rows, the account-wide D1 total is summed without keeping names, and the four capacity metrics
 * (size, forecast, busy, account) open and resolve Errors page items.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CF_API, accountD1Storage } from '../src/discover';
import { runHourly, type CollectorEnv } from '../src/collect';
import { prune } from '../src/store';
import {
  ACCOUNT_KIND,
  DEFAULT_D1_LIMITS,
  alertTitle,
  daysTo70,
  evaluateThresholds,
  formatValue,
  loadD1Limits,
  metricValue,
  type ThresholdRule,
  type WindowStats,
} from '../src/thresholds';
import { GRAPHQL_URL } from '../src/graphql';
import { MIGRATIONS, sqliteD1 } from './d1-sqlite';

const GB = 1e9;
const rule = (o: Partial<ThresholdRule>): ThresholdRule => ({ id: 'r', kind: 'd1', metric: 'storage_pct', op: '>', value: 0.7, window_hours: 1, ...o });
const stats = (o: Partial<WindowStats>): WindowStats => ({
  resource_id: 'd1:al-ummah-now-notifications-qa', kind: 'd1', env: 'qa', name: 'al-ummah-now-notifications-qa',
  requests: null, errors: null, cpu_p99: null, latency_p99: null, backlog_max: null, ...o,
});

describe('migration 0004', () => {
  it('keeps every existing threshold and subscription row and accepts the new values', () => {
    const db = new DatabaseSync(':memory:');
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((x) => x < '0004')) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    db.exec("UPDATE ops_thresholds SET value = 0.05, updated_by = 'admin-1' WHERE id = 'worker-error-rate'");
    db.exec("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', 'budget', 'a@example.com', 'ar', '2026-11-20T00:00:00Z')");
    for (const f of files.filter((x) => x >= '0004')) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));

    const kept = db.prepare("SELECT value, updated_by FROM ops_thresholds WHERE id = 'worker-error-rate'").get() as { value: number; updated_by: string };
    assert.deepEqual({ ...kept }, { value: 0.05, updated_by: 'admin-1' });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ops_thresholds').get() as { n: number }).n, 9);
    const sub = db.prepare("SELECT kind, locale FROM cost_alert_subscriptions WHERE user_id = 'u1'").get() as { kind: string; locale: string };
    assert.deepEqual({ ...sub }, { kind: 'budget', locale: 'ar' });
    db.exec("INSERT INTO cost_alert_subscriptions (user_id, kind, email, locale, created_at) VALUES ('u1', 'capacity', 'a@example.com', 'en', '2026-11-24T00:00:00Z')");
    assert.throws(() => db.exec("INSERT INTO cost_alert_subscriptions (user_id, kind, email, created_at) VALUES ('u2', 'nope', 'b@example.com', 'x')"), /CHECK/);
    assert.throws(() => db.exec("INSERT INTO ops_thresholds (id, kind, metric, op, value, updated_at) VALUES ('x', 'd1', 'nope', '>', 1, 'x')"), /CHECK/);
    // The ops_* tables keep their env CHECK: the account total never goes there
    assert.throws(() => db.exec("INSERT INTO ops_hourly (hour, resource_id, kind, env, name, updated_at) VALUES ('h', 'x', 'd1', 'account', 'x', 'x')"), /CHECK/);
  });
});

describe('account-wide D1 storage', () => {
  it('sums every database on the account (other projects too) across pages and returns no names', async () => {
    const pages: Record<number, unknown[]> = {
      1: Array.from({ length: 100 }, (_, i) => ({ name: i % 2 ? `other-project-${i}` : `al-ummah-now-x-${i}`, uuid: `u${i}`, file_size: 1_000_000 })),
      2: [{ name: 'other', uuid: 'z', file_size: 500 }, { name: 'empty', uuid: 'y' }],
    };
    const seen: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      seen.push(url);
      assert.ok(url.startsWith(`${CF_API}/accounts/acct/d1/database`));
      const page = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify({ success: true, result: pages[page] ?? [], result_info: { total_pages: 2 } }), { status: 200 });
    }) as typeof fetch;
    const total = await accountD1Storage('t', 'acct', fetchImpl);
    assert.deepEqual(total, { bytes: 100_000_500, databases: 102 });
    assert.equal(seen.length, 2);
  });
});

describe('capacity metrics', () => {
  it('storage_pct and account_storage_pct are fractions of the limits, only on their own kind', () => {
    assert.equal(metricValue(rule({}), stats({ stored_bytes: 7.5 * GB })), 0.75);
    assert.equal(metricValue(rule({}), stats({ kind: 'r2', stored_bytes: 9 * GB })), null);
    const account = rule({ kind: ACCOUNT_KIND, metric: 'account_storage_pct' });
    assert.equal(metricValue(account, stats({ kind: ACCOUNT_KIND, env: 'account', stored_bytes: 800 * GB })), 0.8);
    assert.equal(metricValue(rule({}), stats({ stored_bytes: 5 * GB }), { maxDbBytes: 6 * GB, accountBytes: 1e12 }), 5 / 6);
  });

  it('busy_pct needs every hour of its window', () => {
    const busy = rule({ metric: 'busy_pct', window_hours: 3 });
    assert.equal(metricValue(busy, stats({ busy_min: 0.8, hours: 2 })), null);
    assert.equal(metricValue(busy, stats({ busy_min: 0.8, hours: 3 })), 0.8);
  });

  it('forecasts days to 70% from a growing trend, 0 when there, null when flat or too short', () => {
    const days = (n: number, start: number, perDay: number) =>
      Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10), bytes: start + i * perDay }));
    // 5 GB growing 0.1 GB a day: 7 GB in 20 days from the newest point (5 + 13 × 0.1 = 6.3 → 7 needs 7 more days)
    assert.equal(daysTo70(days(14, 5 * GB, 0.1 * GB), DEFAULT_D1_LIMITS.maxDbBytes), 7);
    assert.equal(daysTo70(days(14, 8 * GB, 0), DEFAULT_D1_LIMITS.maxDbBytes), 0);
    assert.equal(daysTo70(days(14, 1 * GB, 0), DEFAULT_D1_LIMITS.maxDbBytes), null);
    assert.equal(daysTo70(days(14, 6 * GB, -0.1 * GB), DEFAULT_D1_LIMITS.maxDbBytes), null);
    assert.equal(daysTo70(days(6, 1 * GB, 1 * GB), DEFAULT_D1_LIMITS.maxDbBytes), null);
  });

  it('reads the limits from cost_settings and falls back on bad values', async () => {
    const db = sqliteD1();
    assert.deepEqual(await loadD1Limits(db), DEFAULT_D1_LIMITS);
    await db.prepare("INSERT INTO cost_settings (key, value, updated_at) VALUES ('d1_limits', ?, 'x')").bind(JSON.stringify({ maxDbBytes: 20 * GB, accountBytes: -1 })).run();
    assert.deepEqual(await loadD1Limits(db), { maxDbBytes: 20 * GB, accountBytes: 1e12 });
  });

  it('titles and values read as capacity items', () => {
    assert.equal(alertTitle(rule({})), 'Capacity: D1 database size over threshold');
    assert.equal(alertTitle(rule({ metric: 'storage_days_to_70', op: '<' })), 'Capacity: D1 database reaches 70% of its size limit soon');
    assert.equal(formatValue(rule({}), 0.7234), '72.3%');
    assert.equal(formatValue(rule({ metric: 'storage_days_to_70' }), 41.6), '42 days');
  });
});

describe('capacity thresholds end to end', () => {
  const end = new Date('2026-11-24T16:00:00Z');
  const hour = (h: number) => new Date(end.getTime() - h * 3_600_000).toISOString().replace('.000Z', 'Z');
  const d1Row = (db: D1Database, h: number, o: { stored?: number; requests?: number; p50?: number }) =>
    db
      .prepare(`INSERT INTO ops_hourly (hour, resource_id, kind, env, name, requests, latency_p50, stored_bytes, updated_at)
        VALUES (?, 'd1:al-ummah-now-notifications-qa', 'd1', 'qa', 'al-ummah-now-notifications-qa', ?, ?, ?, 'x')
        ON CONFLICT (hour, resource_id) DO UPDATE SET requests = excluded.requests, latency_p50 = excluded.latency_p50, stored_bytes = excluded.stored_bytes`)
      .bind(hour(h), o.requests ?? 10, o.p50 ?? 0.2, o.stored ?? 1 * GB)
      .run();

  it('opens size, busy, forecast and account alerts once and resolves them on recovery', async () => {
    const db = sqliteD1();
    for (const h of [1, 2, 3]) await d1Row(db, h, { stored: 7.5 * GB, requests: 3_600_000, p50: 0.8 }); // busy 0.8 each hour
    for (let i = 0; i < 14; i++) {
      const day = new Date(Date.UTC(2026, 10, 10 + i)).toISOString().slice(0, 10);
      await db.prepare(`INSERT INTO ops_daily (day, resource_id, kind, env, name, stored_bytes, updated_at)
        VALUES (?, 'd1:al-ummah-now-reports-qa', 'd1', 'qa', 'al-ummah-now-reports-qa', ?, 'x')`).bind(day, 4 * GB + i * 0.1 * GB).run();
    }
    await db.prepare("INSERT INTO d1_account_storage (hour, bytes, databases, updated_at) VALUES (?, ?, 40, 'x')").bind(hour(1), 750 * GB).run();

    const opened = await evaluateThresholds(db, end, end);
    const keys = opened.filter((c) => c.state === 'open').map((c) => c.key).sort();
    assert.deepEqual(keys, [
      'ops:d1-account-storage-70:d1_account:all',
      'ops:d1-busy-70:d1:al-ummah-now-notifications-qa',
      'ops:d1-storage-70:d1:al-ummah-now-notifications-qa',
    ]);
    // The reports database grows 0.1 GB/day from 5.3 GB: 70% (7 GB) in 17 days, but it has no hourly row
    // in the window, so it is judged only once it reports again
    await db.prepare(`INSERT INTO ops_hourly (hour, resource_id, kind, env, name, stored_bytes, updated_at)
      VALUES (?, 'd1:al-ummah-now-reports-qa', 'd1', 'qa', 'al-ummah-now-reports-qa', ?, 'x')`).bind(hour(1), 5.3 * GB).run();
    const again = await evaluateThresholds(db, end, end);
    assert.deepEqual(again.map((c) => `${c.state} ${c.key}`), ['open ops:d1-storage-forecast:d1:al-ummah-now-reports-qa']);
    assert.equal(again[0].value, 17);

    // Recovery: smaller, idle, account below 70%
    for (const h of [1, 2, 3]) await d1Row(db, h, { stored: 2 * GB, requests: 10, p50: 0.2 });
    await db.prepare('UPDATE d1_account_storage SET bytes = ?').bind(100 * GB).run();
    const resolved = await evaluateThresholds(db, end, end);
    assert.deepEqual(resolved.filter((c) => c.state === 'resolved').map((c) => c.key).sort(), [
      'ops:d1-account-storage-70:d1_account:all',
      'ops:d1-busy-70:d1:al-ummah-now-notifications-qa',
      'ops:d1-storage-70:d1:al-ummah-now-notifications-qa',
    ]);
  });

  it('the hourly run stores the account total and links capacity items to the Costs page', async () => {
    const posted: any[] = [];
    const env: CollectorEnv = {
      COSTS_DB: sqliteD1(),
      CF_ANALYTICS_TOKEN: { get: async () => 'test-token' },
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      COLLECT_ENVS: 'qa',
      ENVIRONMENT: 'qa',
      ERRORS_INGEST_URL: 'https://admin.api.qa.alummahnow.net/internal/errors',
      INTERNAL_API_KEY: 'k',
    } as never;
    const now = new Date('2026-11-24T16:10:00Z');
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/d1/database')) {
        return new Response(JSON.stringify({ success: true, result: [{ name: 'al-ummah-now-x-qa', uuid: 'a', file_size: 800 * GB }, { name: 'someone-else', uuid: 'b', file_size: 1 * GB }], result_info: { total_pages: 1 } }));
      }
      if (url === GRAPHQL_URL) return new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } } }));
      if (url.startsWith(CF_API)) return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }));
      posted.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    const run = await runHourly(env, undefined, now, fetchImpl);
    assert.equal(run.status, 'ok');
    const row = await env.COSTS_DB.prepare('SELECT hour, bytes, databases FROM d1_account_storage').first<{ hour: string; bytes: number; databases: number }>();
    assert.deepEqual({ ...row }, { hour: '2026-11-24T15:00:00Z', bytes: 801 * GB, databases: 2 });
    const until = Date.now() + 2000;
    while (!posted.length && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    const item = posted.flatMap((p) => p.events ?? [])[0];
    assert.equal(item.action.key, 'ops:d1-account-storage-70:d1_account:all');
    assert.equal(item.action.itemUrl, '/costs#databases');
    assert.match(item.action.title, /^Capacity: /);
    assert.equal(JSON.stringify(await env.COSTS_DB.prepare('SELECT * FROM d1_account_storage').all()).includes('someone-else'), false);
  });

  it('prunes account totals older than 13 months', async () => {
    const db = sqliteD1();
    await db.prepare("INSERT INTO d1_account_storage (hour, bytes, databases, updated_at) VALUES ('2025-01-01T00:00:00Z', 1, 1, 'x'), ('2026-11-24T00:00:00Z', 1, 1, 'x')").run();
    await prune(db, new Date('2026-11-24T12:00:00Z'));
    const left = (await db.prepare('SELECT hour FROM d1_account_storage').all<{ hour: string }>()).results.map((r) => r.hour);
    assert.deepEqual(left, ['2026-11-24T00:00:00Z']);
  });
});
