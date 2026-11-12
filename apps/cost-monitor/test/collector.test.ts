/**
 * Platform analytics collector (docs/admin/LIVE_OPS.md Part A): manifest scope,
 * normalization of the live response shape, one query per run, idempotent
 * upserts, daily rollup with cost, thresholds open → resolve, retention.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestIndex, manifestFor, parseEnvs, OPS_ENVS } from '../src/manifest';
import { OPS_QUERY, GRAPHQL_URL, queryVariables } from '../src/graphql';
import { normalize, hourOf } from '../src/normalize';
import { runDaily, runHourly, type CollectorEnv } from '../src/collect';
import { prune, rollupDay, upsertHourly } from '../src/store';
import { dayCost, PRICES } from '../src/pricing';
import { crosses, metricValue, type ThresholdRule } from '../src/thresholds';
import { sqliteD1 } from './d1-sqlite';

const FIXTURE = JSON.parse(readFileSync(join(process.cwd(), 'test', 'fixtures', 'ops-qa.json'), 'utf8'));
const qaIndex = () => new ManifestIndex(manifestFor(['qa']));

describe('manifest', () => {
  it('lists only al-ummah resources, per env, with the suffix rule', () => {
    for (const env of OPS_ENVS) {
      const list = manifestFor([env]);
      assert.ok(list.length > 30);
      for (const r of list) {
        assert.equal(r.env, env);
        assert.match(r.name, /^(al-ummah|videos|channels|profiles|playlists|community-posts|subtitles|watch-history|scheduled-videos|admin-backups)/);
        if (env === 'qa' && !['al-ummah-web-qa'].includes(r.name)) assert.match(r.name, /-qa$/);
        if (env === 'stage' && r.name !== 'al-ummah-now-stage') assert.match(r.name, /-stage$/);
        if (env === 'production') assert.doesNotMatch(r.name, /-(qa|stage)$/);
        if (r.kind === 'd1' || r.kind === 'queue') assert.match(r.cfId ?? '', /^[0-9a-f-]{32,36}$/);
      }
    }
    const dlqs = manifestFor(['qa']).filter((r) => r.dlq).map((r) => r.name).sort();
    assert.deepEqual(dlqs, ['al-ummah-now-dlq-qa', 'al-ummah-now-errors-dlq-qa', 'al-ummah-now-transcode-dlq-qa']);
  });

  it('parses COLLECT_ENVS and ignores unknown names', () => {
    assert.deepEqual(parseEnvs('qa'), ['qa']);
    assert.deepEqual(parseEnvs('production, stage,qa,dev'), ['production', 'stage', 'qa']);
    assert.deepEqual(parseEnvs(undefined), []);
  });
});

describe('query', () => {
  it('filters every dataset to the manifest with _in', () => {
    for (const field of ['scriptName_in: $w', 'databaseId_in: $d', 'bucketName_in: $b', 'queueId_in: $q']) assert.ok(OPS_QUERY.includes(field), field);
    const datasets = OPS_QUERY.match(/\w+: \w+AdaptiveGroups?\(|\w+: workersInvocationsAdaptive\(/g) ?? [];
    assert.equal(datasets.length, 7);
    assert.equal((OPS_QUERY.match(/filter: \{ datetime_geq/g) ?? []).length, 7);
    const v = queryVariables('acct', qaIndex(), new Date('2026-11-12T10:00:00Z'), new Date('2026-11-12T13:00:00Z'));
    assert.ok(v.w.includes('videos-qa') && !v.w.includes('videos'));
    assert.ok(v.q.includes('0c2bd068d6a7447aadcce2f4622ed706'));
  });
});

describe('normalize', () => {
  it('turns the live response into one row per resource-hour', () => {
    const { rows, dropped } = normalize(FIXTURE.data.viewer.accounts[0], qaIndex());
    assert.equal(dropped, 0);
    const api = rows.filter((r) => r.resource.id === 'worker:videos-qa');
    assert.ok(api.length >= 1);
    for (const r of api) {
      assert.match(r.hour, /^\d{4}-\d\d-\d\dT\d\d:00:00Z$/);
      assert.ok((r.values.requests ?? 0) > 0);
      assert.ok((r.values.cpu_p99 ?? 0) >= (r.values.cpu_p50 ?? 0));
    }
    const d1 = rows.find((r) => r.resource.kind === 'd1');
    assert.ok(d1 && d1.values.reads! > 0 && d1.values.latency_p99! > 0 && d1.values.stored_bytes! > 0);
    const queue = rows.find((r) => r.resource.id === 'queue:al-ummah-now-videos-qa' && r.values.backlog_avg !== undefined);
    assert.ok(queue && queue.values.backlog_max! >= queue.values.backlog_avg!);
    assert.ok(rows.some((r) => r.resource.kind === 'r2' && r.values.objects! > 0));
  });

  it('drops rows of resources outside the manifest (other projects on the account)', () => {
    const data = {
      workers: [{ dimensions: { scriptName: 'some-other-project', datetimeHour: '2026-11-12T10:00:00Z', status: 'success' }, sum: { requests: 5, errors: 0, subrequests: 0, cpuTimeUs: 1 }, quantiles: { cpuTimeP50: 1, cpuTimeP99: 2 } }],
      r2: [{ dimensions: { bucketName: 'videos', datetimeHour: '2026-11-12T10:00:00Z', actionType: 'GetObject' }, sum: { requests: 1, responseObjectSize: 1 } }],
    };
    const { rows, dropped } = normalize(data, qaIndex());
    assert.equal(rows.length, 0); // 'videos' is production's bucket, not QA's
    assert.equal(dropped, 2);
  });

  it('maps R2 actions to Class A / B and keeps deletes free', () => {
    const at = '2026-11-12T10:05:00Z';
    const g = (actionType: string, requests: number) => ({ dimensions: { bucketName: 'videos-qa', datetimeHour: at, actionType }, sum: { requests, responseObjectSize: 0 } });
    const { rows } = normalize({ r2: [g('PutObject', 3), g('GetObject', 10), g('DeleteObject', 4)] }, qaIndex());
    assert.equal(rows[0].hour, hourOf(at));
    assert.deepEqual([rows[0].values.writes, rows[0].values.reads, rows[0].values.requests], [3, 10, 17]);
  });
});

function collectorEnv(): CollectorEnv & { posted: unknown[]; graphql: number } {
  const env = {
    COSTS_DB: sqliteD1(),
    CF_ANALYTICS_TOKEN: { get: async () => 'test-token' },
    CLOUDFLARE_ACCOUNT_ID: '0e4b6e7f9faf280c3c9bf95995edc64f',
    COLLECT_ENVS: 'qa',
    ENVIRONMENT: 'qa',
    ERRORS_INGEST_URL: 'https://admin.api.qa.alummahnow.net/internal/errors',
    INTERNAL_API_KEY: 'k',
    posted: [] as unknown[],
    graphql: 0,
  };
  return env;
}

function fakeFetch(env: ReturnType<typeof collectorEnv>, body: unknown): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === GRAPHQL_URL) {
      env.graphql++;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
      return new Response(JSON.stringify(body), { status: 200 });
    }
    env.posted.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('hourly run', () => {
  it('makes one GraphQL request (≤ 10 per run), stores rows idempotently and records the run', async () => {
    const env = collectorEnv();
    const now = new Date('2026-11-12T16:10:00Z');
    const first = await runHourly(env, undefined, now, fakeFetch(env, FIXTURE));
    assert.equal(first.status, 'ok');
    assert.equal(env.graphql, 1);
    assert.ok(first.queries <= 10);
    assert.ok(first.rows > 5);
    const count = async () => (await env.COSTS_DB.prepare('SELECT COUNT(*) AS n FROM ops_hourly').first<{ n: number }>())!.n;
    const n = await count();
    await runHourly(env, undefined, now, fakeFetch(env, FIXTURE));
    assert.equal(await count(), n);
    const runs = (await env.COSTS_DB.prepare('SELECT status, queries FROM collector_runs').all<{ status: string; queries: number }>()).results;
    assert.deepEqual(runs.map((r) => r.status), ['ok', 'ok']);
    const daily = await env.COSTS_DB.prepare("SELECT COUNT(*) AS n FROM ops_daily WHERE day = '2026-11-12'").first<{ n: number }>();
    assert.ok(daily!.n > 0);
  });

  it('marks a run partial when a dataset fails, and failed without the token', async () => {
    const env = collectorEnv();
    const partial = await runHourly(env, undefined, new Date('2026-11-12T16:10:00Z'), fakeFetch(env, { ...FIXTURE, errors: [{ message: 'r2Storage: quota' }] }));
    assert.equal(partial.status, 'partial');
    const noToken = { ...collectorEnv(), CF_ANALYTICS_TOKEN: undefined };
    const failed = await runHourly(noToken, undefined, new Date(), fakeFetch(noToken as never, FIXTURE));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.queries, 0);
  });

  it('opens an Errors page item when a threshold is crossed, once, and resolves it on recovery', async () => {
    const env = collectorEnv();
    const hour = '2026-11-12T15:00:00Z';
    const worker = (errors: number) => ({
      data: { viewer: { accounts: [{ workers: [{ dimensions: { scriptName: 'videos-qa', datetimeHour: hour, status: 'success' }, sum: { requests: 1000, errors, subrequests: 0, cpuTimeUs: 0 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2000 } }] }] } },
    });
    const now = new Date('2026-11-12T16:10:00Z');
    await runHourly(env, undefined, now, fakeFetch(env, worker(100)));
    await flush();
    const opened = env.posted.flatMap((p: any) => p.events ?? []);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].app, 'cost-monitor');
    assert.equal(opened[0].kind, 'action');
    assert.equal(opened[0].action.key, 'ops:worker-error-rate:worker:videos-qa');
    assert.equal(opened[0].action.source, 'ops');
    // Still failing: no second item
    await runHourly(env, undefined, now, fakeFetch(env, worker(100)));
    await flush();
    assert.equal(env.posted.flatMap((p: any) => p.events ?? []).length, 1);
    // Recovered: resolved
    await runHourly(env, undefined, now, fakeFetch(env, worker(1)));
    await flush();
    const resolved = env.posted.flatMap((p: any) => p.resolved ?? []);
    assert.deepEqual(resolved, [{ key: 'ops:worker-error-rate:worker:videos-qa' }]);
    assert.equal((await env.COSTS_DB.prepare('SELECT COUNT(*) AS n FROM ops_alerts').first<{ n: number }>())!.n, 0);
  });
});

describe('thresholds', () => {
  const rule = (metric: ThresholdRule['metric'], kind: ThresholdRule['kind'], value: number): ThresholdRule => ({ id: 'r', kind, metric, op: '>', value, window_hours: 1 });
  const stats = (o: object) => ({ resource_id: 'x', kind: 'queue' as const, env: 'qa' as const, name: 'al-ummah-now-videos-qa', requests: null, errors: null, cpu_p99: null, latency_p99: null, backlog_max: null, ...o });
  it('judges error rates only with enough requests', () => {
    assert.equal(metricValue(rule('error_rate', 'worker', 0.02), stats({ kind: 'worker', requests: 50, errors: 50 })), null);
    assert.equal(metricValue(rule('error_rate', 'worker', 0.02), stats({ kind: 'worker', requests: 1000, errors: 50 })), 0.05);
  });
  it('splits backlog rules between DLQs and work queues', () => {
    assert.equal(metricValue(rule('dlq_backlog', 'queue', 0), stats({ backlog_max: 3 })), null);
    assert.equal(metricValue(rule('dlq_backlog', 'queue', 0), stats({ name: 'al-ummah-now-dlq-qa', backlog_max: 3 })), 3);
    assert.equal(metricValue(rule('backlog_max', 'queue', 1000), stats({ name: 'al-ummah-now-dlq-qa', backlog_max: 3000 })), null);
    assert.equal(crosses(rule('dlq_backlog', 'queue', 0), 1), true);
    assert.equal(crosses(rule('dlq_backlog', 'queue', 0), 0), false);
  });
});

describe('rollup, cost and retention', () => {
  it('sums a day, weights CPU by requests and estimates cost', async () => {
    const db = sqliteD1();
    const resource = manifestFor(['qa']).find((r) => r.id === 'worker:videos-qa')!;
    const now = new Date('2026-11-12T23:30:00Z');
    await upsertHourly(db, [
      { hour: '2026-11-12T01:00:00Z', resource, values: { requests: 1_000_000, errors: 10, cpu_p50: 1000, cpu_p99: 9000 } },
      { hour: '2026-11-12T02:00:00Z', resource, values: { requests: 3_000_000, errors: 30, cpu_p50: 3000, cpu_p99: 5000 } },
      { hour: '2026-11-13T00:00:00Z', resource, values: { requests: 99 } },
    ], now);
    assert.equal(await rollupDay(db, '2026-11-12', now), 1);
    const row = await db.prepare("SELECT * FROM ops_daily WHERE day = '2026-11-12'").first<any>();
    assert.equal(row.requests, 4_000_000);
    assert.equal(row.errors, 40);
    assert.equal(row.cpu_p50, 2500);
    assert.equal(row.cpu_p99, 9000);
    assert.equal(row.cost_usd, dayCost('worker', { requests: 4_000_000, cpu_p50: 2500 }));
    assert.ok(Math.abs(row.cost_usd - (4 * PRICES.workerRequestPerMillion + 10 * PRICES.workerCpuMsPerMillion)) < 1e-6);
  });

  it('keeps 13 months and prunes older rows', async () => {
    const db = sqliteD1();
    const resource = manifestFor(['qa'])[0];
    const now = new Date('2026-11-12T03:30:00Z');
    await upsertHourly(db, [
      { hour: '2025-10-01T00:00:00Z', resource, values: { requests: 1 } },
      { hour: '2025-10-20T00:00:00Z', resource, values: { requests: 1 } },
    ], now);
    await rollupDay(db, '2025-10-01', now);
    const { pruned } = await runDaily({ COSTS_DB: db } as CollectorEnv, now);
    assert.equal(pruned, 2);
    const left = (await db.prepare('SELECT hour FROM ops_hourly').all<{ hour: string }>()).results.map((r) => r.hour);
    assert.deepEqual(left, ['2025-10-20T00:00:00Z']);
    assert.equal(await prune(db, now), 0);
  });
});
