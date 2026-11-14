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
import { OPS_QUERY, GRAPHQL_URL, NO_MATCH, queryVariables } from '../src/graphql';
import { CF_API, discoverResources, loadDiscovered, storeDiscovered } from '../src/discover';
import { envOfName, isAlUmmahName, mergeResources } from '../src/manifest';
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
        // A bucket slice is named after its bucket, which follows the rule
        const named = r.slice?.bucket ?? r.name;
        if (env === 'qa' && !['al-ummah-web-qa'].includes(named)) assert.match(named, /-qa$/);
        if (env === 'stage' && named !== 'al-ummah-now-stage') assert.match(named, /-stage$/);
        if (env === 'production') assert.doesNotMatch(named, /-(qa|stage)$/);
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
    assert.equal(datasets.length, 11);
    // durableObjectsPeriodicGroups is not "Adaptive": every dataset has a datetime filter
    assert.equal((OPS_QUERY.match(/filter: \{ datetime_geq/g) ?? []).length, 12);
    for (const field of ['namespaceId_in: $k', 'namespaceId_in: $o']) assert.equal(OPS_QUERY.split(field).length - 1, 2, field);
    const v = queryVariables('acct', qaIndex(), new Date('2026-11-12T10:00:00Z'), new Date('2026-11-12T13:00:00Z'));
    assert.ok(v.w.includes('videos-qa') && !v.w.includes('videos'));
    assert.ok(v.q.includes('0c2bd068d6a7447aadcce2f4622ed706'));
    // The MP4 line reads only the media bucket's progressive MP4s (not the HLS rungs' init.mp4)
    assert.ok(OPS_QUERY.includes('bucketName_in: $m, objectName_like: "%/video.mp4"'));
    assert.deepEqual(v.m, ['al-ummah-now-media-qa']);
    assert.ok(!v.b.some((b) => b.includes('video.mp4')));
  });

  it('never sends an empty _in list (it would match the whole shared account)', () => {
    const v = queryVariables('acct', new ManifestIndex([]), new Date('2026-11-12T10:00:00Z'), new Date('2026-11-12T13:00:00Z'));
    for (const key of ['w', 'b', 'm', 'd', 'q', 'k', 'o'] as const) assert.deepEqual(v[key], [NO_MATCH], key);
  });
});

const LISTINGS: Record<string, unknown> = {
  'workers/scripts': [{ id: 'al-ummah-now-www-qa' }, { id: 'al-ummah-now-www' }, { id: 'someone-elses-worker-qa' }, { id: 'al-ummah-api-pr-12' }],
  'd1/database': [{ name: 'al-ummah-now-auth-qa', uuid: '11111111-2222-3333-4444-555555555555' }, { name: 'other-db-qa', uuid: 'x' }],
  'storage/kv/namespaces': [{ title: 'al-ummah-now-sessions-qa', id: 'kv0000000000000000000000000000aa' }, { title: 'other-kv-qa', id: 'kvx' }],
  'r2/buckets': { buckets: [{ name: 'videos-qa' }, { name: 'not-ours-qa' }] },
  queues: [{ queue_name: 'al-ummah-now-cms-dlq-qa', queue_id: 'q0000000000000000000000000000bb' }],
  'workers/durable_objects/namespaces': [
    { id: 'do000000000000000000000000000cc', script: 'al-ummah-now-comms-qa', class: 'ChatRoom' },
    { id: 'doforeign', script: 'other-app-qa', class: 'Room' },
  ],
};

function listingFetch(fail = false): (url: string) => Response | null {
  return (url) => {
    if (!url.startsWith(`${CF_API}/accounts/`)) return null;
    if (fail) return new Response(JSON.stringify({ success: false }), { status: 403 });
    const path = url.split('?')[0].replace(/^.*\/accounts\/[^/]+\//, '');
    const result = LISTINGS[path] ?? [];
    return new Response(JSON.stringify({ success: true, result, result_info: { total_pages: 1 } }), { status: 200 });
  };
}

describe('discovery', () => {
  it('keeps only al-ummah names of the collected envs, names DOs after their Worker', async () => {
    const list = listingFetch();
    const found = await discoverResources('t', 'acct', ['qa'], (async (u: string) => list(String(u))!) as typeof fetch);
    assert.deepEqual(found.map((r) => r.id).sort(), [
      'd1:al-ummah-now-auth-qa',
      'do:al-ummah-now-comms-qa/ChatRoom',
      'kv:al-ummah-now-sessions-qa',
      'queue:al-ummah-now-cms-dlq-qa',
      'r2:videos-qa',
      'worker:al-ummah-now-www-qa',
    ]);
    assert.equal(found.find((r) => r.kind === 'do')!.cfId, 'do000000000000000000000000000cc');
    assert.equal(found.find((r) => r.kind === 'queue')!.dlq, true);
    assert.equal(isAlUmmahName('someone-elses-worker-qa'), false);
    assert.equal(envOfName('al-ummah-api-pr-12'), null);
  });

  it('stores, reloads and expires what it saw; the static manifest wins on a duplicate', async () => {
    const db = sqliteD1();
    const list = listingFetch();
    const found = await discoverResources('t', 'acct', ['qa'], (async (u: string) => list(String(u))!) as typeof fetch);
    await storeDiscovered(db, found, new Date('2026-11-01T00:00:00Z'));
    const loaded = await loadDiscovered(db, ['qa']);
    assert.equal(loaded.resources.length, found.length);
    assert.equal(loaded.refreshedAt, '2026-11-01T00:00:00.000Z');
    const merged = mergeResources(manifestFor(['qa']), loaded.resources);
    assert.equal(merged.filter((r) => r.kind === 'r2' && r.name === 'videos-qa').length, 1);
    await storeDiscovered(db, [], new Date('2026-11-09T00:00:00Z'));
    assert.equal((await loadDiscovered(db, ['qa'])).resources.length, 0);
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

  it('shows the public MP4 Class B reads as their own line, taken out of the media bucket row', () => {
    const at = '2026-11-12T10:00:00Z';
    const g = (actionType: string, requests: number, bytes = 0) => ({ dimensions: { bucketName: 'al-ummah-now-media-qa', datetimeHour: at, actionType }, sum: { requests, responseObjectSize: bytes } });
    const { rows, dropped } = normalize({ r2: [g('GetObject', 100, 5000), g('PutObject', 4)], r2Mp4: [g('GetObject', 30, 3000), g('HeadObject', 2), g('PutObject', 1)] }, qaIndex());
    assert.equal(dropped, 0);
    const bucket = rows.find((r) => r.resource.id === 'r2:al-ummah-now-media-qa')!;
    const mp4 = rows.find((r) => r.resource.id === 'r2:al-ummah-now-media-qa/video.mp4')!;
    assert.equal(mp4.resource.kind, 'r2');
    assert.equal(mp4.resource.name, 'al-ummah-now-media-qa video.mp4');
    assert.deepEqual([mp4.values.reads, mp4.values.requests, mp4.values.bytes, mp4.values.writes], [32, 32, 3000, undefined]);
    // Totals unchanged: reads 100 = 68 + 32, writes stay with the bucket
    assert.deepEqual([bucket.values.reads, bucket.values.requests, bucket.values.bytes, bucket.values.writes], [68, 72, 2000, 4]);
    assert.equal(dayCost('r2', mp4.values) + dayCost('r2', bucket.values), dayCost('r2', { reads: 100, writes: 4 }));
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
    const listed = (env as { listing?: (u: string) => Response | null }).listing?.(url) ?? listingFetch()(url);
    if (listed) return listed;
    if (url === GRAPHQL_URL) {
      env.graphql++;
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
      return new Response(JSON.stringify(body), { status: 200 });
    }
    env.posted.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
}

/** Waits for the reporter's background posts (it runs outside the request; slow on a loaded machine). */
const flush = async (env?: { posted: unknown[] }, want = 0) => {
  const until = Date.now() + 2000;
  do await new Promise((r) => setTimeout(r, 20));
  while (env && env.posted.length < want && Date.now() < until);
};

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

  it('keeps collecting the static manifest when discovery fails (recorded), and discovers again next hour', async () => {
    const env = Object.assign(collectorEnv(), { listing: listingFetch(true) });
    const run = await runHourly(env, undefined, new Date('2026-11-12T16:10:00Z'), fakeFetch(env, FIXTURE));
    assert.equal(run.status, 'ok');
    assert.ok(run.rows > 5);
    const detail = JSON.parse((await env.COSTS_DB.prepare('SELECT detail FROM collector_runs').first<{ detail: string }>())!.detail);
    assert.match(detail.discovery, /HTTP 403/);
    env.listing = listingFetch();
    const next = await runHourly(env, undefined, new Date('2026-11-12T17:10:00Z'), fakeFetch(env, FIXTURE));
    assert.equal(next.status, 'ok');
    assert.ok((await loadDiscovered(env.COSTS_DB, ['qa'])).resources.some((r) => r.kind === 'kv'));
  });

  it('queries discovered KV namespaces and DO namespaces and stores their rows', async () => {
    const env = collectorEnv();
    let vars: Record<string, string[]> = {};
    const kvDo = {
      data: {
        viewer: {
          accounts: [{
            kv: [{ dimensions: { namespaceId: 'kv0000000000000000000000000000aa', datetimeHour: '2026-11-12T15:00:00Z', actionType: 'read' }, sum: { requests: 2_000_000 } },
              { dimensions: { namespaceId: 'kv0000000000000000000000000000aa', datetimeHour: '2026-11-12T15:00:00Z', actionType: 'write' }, sum: { requests: 100_000 } }],
            doPeriodic: [{ dimensions: { namespaceId: 'do000000000000000000000000000cc', datetimeHour: '2026-11-12T15:00:00Z' }, sum: { activeTime: 3_600_000_000, storageReadUnits: 10, storageWriteUnits: 5, inboundWebsocketMsgCount: 0 } }],
            doRequests: [{ dimensions: { namespaceId: 'do000000000000000000000000000cc', datetimeHour: '2026-11-12T15:00:00Z' }, sum: { requests: 40 } }],
          }],
        },
      },
    };
    const base = fakeFetch(env, kvDo);
    const spy = (async (input: string | URL, init?: RequestInit) => {
      if (String(input) === GRAPHQL_URL) vars = JSON.parse(String(init?.body)).variables;
      return base(input, init);
    }) as typeof fetch;
    await runHourly(env, undefined, new Date('2026-11-12T16:10:00Z'), spy);
    assert.deepEqual(vars.k, ['kv0000000000000000000000000000aa']);
    assert.deepEqual(vars.o, ['do000000000000000000000000000cc']);
    const rows = (await env.COSTS_DB.prepare("SELECT kind, reads, writes, gb_seconds FROM ops_hourly WHERE kind IN ('kv','do') ORDER BY kind").all<{ kind: string; reads: number; writes: number; gb_seconds: number | null }>()).results;
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { kind: 'do', reads: 10, writes: 5, gb_seconds: 450 },
      { kind: 'kv', reads: 2_000_000, writes: 100_000, gb_seconds: null },
    ]);
    const daily = (await env.COSTS_DB.prepare("SELECT kind, cost_usd FROM ops_daily WHERE kind IN ('kv','do') ORDER BY kind").all<{ kind: string; cost_usd: number }>()).results;
    // KV: 2M reads x $0.50 + 0.1M writes x $5 = $1.50; DO: 450 GB-s x $12.50/M + 40 requests + storage units ≈ $0.0056
    assert.equal(daily.find((d) => d.kind === 'kv')!.cost_usd, 1.5);
    assert.ok(Math.abs(daily.find((d) => d.kind === 'do')!.cost_usd - 0.005637) < 1e-5);
  });

  it('opens an Errors page item when a threshold is crossed, once, and resolves it on recovery', async () => {
    const env = collectorEnv();
    const hour = '2026-11-12T15:00:00Z';
    const worker = (errors: number) => ({
      data: { viewer: { accounts: [{ workers: [{ dimensions: { scriptName: 'videos-qa', datetimeHour: hour, status: 'success' }, sum: { requests: 1000, errors, subrequests: 0, cpuTimeUs: 0 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2000 } }] }] } },
    });
    const now = new Date('2026-11-12T16:10:00Z');
    await runHourly(env, undefined, now, fakeFetch(env, worker(100)));
    await flush(env, 1);
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
    await flush(env, 2);
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
