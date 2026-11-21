/**
 * COST-GAPS: the billed meters the collector adds per resource-hour (Workers CPU as billed, KV lists
 * and deletes, Workers Logs events, Logpush requests), what the Workers listing says about logging,
 * and the list price of a Worker day with logs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_EVENTS_PER_REQUEST } from '@al-ummah/shared-types';
import { ManifestIndex, manifestFor, mergeResources, type Resource } from '../src/manifest';
import { loadDiscovered, storeDiscovered, workerLogging } from '../src/discover';
import { normalize } from '../src/normalize';
import { rollupDay, upsertHourly } from '../src/store';
import { dayCost, PRICES } from '../src/pricing';
import { sqliteD1 } from './d1-sqlite';

const HOUR = '2026-11-21T10:00:00Z';
const worker = (scriptName: string, requests: number, cpuTimeUs: number) => ({
  dimensions: { scriptName, datetimeHour: HOUR, status: 'success' },
  sum: { requests, errors: 0, subrequests: 0, cpuTimeUs },
  quantiles: { cpuTimeP50: 1000, cpuTimeP99: 5000 },
});

describe('Workers listing → logging flags', () => {
  it('reads logpush and the Workers Logs sampling rate, and leaves out what it does not say', () => {
    assert.deepEqual(workerLogging({ id: 'a', logpush: true, observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, head_sampling_rate: 0.25 } } }), { logpush: true, logsRate: 0.25 });
    assert.deepEqual(workerLogging({ id: 'a', observability: { enabled: true } }), { logsRate: 1 });
    assert.deepEqual(workerLogging({ id: 'a', logpush: false, observability: { enabled: false } }), { logpush: false, logsRate: 0 });
    assert.deepEqual(workerLogging({ id: 'a' }), {});
  });

  it('carries the listing flags onto a static manifest Worker, stored and reloaded', async () => {
    const base = manifestFor(['production']);
    const web = base.find((r) => r.name === 'al-ummah-now-production')!;
    assert.equal(web.logpush, true, 'web production has logpush in its wrangler config');
    const found: Resource[] = [{ ...web, logpush: false, logsRate: 0.5 }];
    const merged = mergeResources(base, found).find((r) => r.id === web.id)!;
    assert.equal(merged.logpush, false);
    assert.equal(merged.logsRate, 0.5);
    const db = sqliteD1();
    await storeDiscovered(db, found, new Date('2026-11-21T00:00:00Z'));
    const back = (await loadDiscovered(db, ['production'])).resources[0]!;
    assert.equal(back.logpush, false);
    assert.equal(back.logsRate, 0.5);
  });
});

describe('normalize → billed meters', () => {
  it('sums CPU as billed, estimates log events from the sampling rate and counts Logpush requests', () => {
    const resources = manifestFor(['production']).map((r) => (r.name === 'videos' ? { ...r, logsRate: 0.5 } : r));
    const index = new ManifestIndex(resources);
    const { rows } = normalize({ workers: [worker('al-ummah-now-production', 1000, 2_500_000), worker('videos', 400, 800_000)] }, index);
    const web = rows.find((r) => r.resource.name === 'al-ummah-now-production')!.values;
    const api = rows.find((r) => r.resource.name === 'videos')!.values;
    assert.equal(web.cpu_ms, 2500);
    assert.equal(web.logpush_requests, 1000);
    assert.equal(web.log_events, 1000 * LOG_EVENTS_PER_REQUEST);
    assert.equal(api.logpush_requests, undefined, 'videos has no Logpush');
    assert.equal(api.log_events, 400 * 0.5 * LOG_EVENTS_PER_REQUEST);
  });

  it('keeps KV lists and deletes apart from writes (each has its own allowance), still inside writes', () => {
    const ns = manifestFor(['qa']).find((r) => r.kind === 'kv');
    const kv: Resource = ns ?? { id: 'kv:al-ummah-now-sessions-qa', kind: 'kv', env: 'qa', name: 'al-ummah-now-sessions-qa', cfId: 'kv1' };
    const index = new ManifestIndex([kv]);
    const op = (actionType: string, requests: number) => ({ dimensions: { namespaceId: kv.cfId!, datetimeHour: HOUR, actionType }, sum: { requests } });
    const { rows } = normalize({ kv: [op('read', 50), op('write', 7), op('list', 3), op('delete', 2)] }, index);
    const v = rows[0]!.values;
    assert.equal(v.reads, 50);
    assert.equal(v.writes, 12);
    assert.equal(v.kv_lists, 3);
    assert.equal(v.kv_deletes, 2);
  });
});

describe('rollup and list price with the new meters', () => {
  it('rolls the meters up to the day and prices CPU as billed, logs and Logpush', async () => {
    const db = sqliteD1();
    const index = new ManifestIndex(manifestFor(['production']));
    const { rows } = normalize({ workers: [worker('al-ummah-now-production', 2_000_000, 40_000_000_000)] }, index);
    await upsertHourly(db, rows, new Date(HOUR));
    await rollupDay(db, '2026-11-21', new Date(HOUR));
    const day = (await db.prepare("SELECT * FROM ops_daily WHERE resource_id = 'worker:al-ummah-now-production'").first<Record<string, number>>())!;
    assert.equal(day.cpu_ms, 40_000_000);
    assert.equal(day.logpush_requests, 2_000_000);
    const expected =
      2 * PRICES.workerRequestPerMillion + 40 * PRICES.workerCpuMsPerMillion + 2 * LOG_EVENTS_PER_REQUEST * PRICES.logEventsPerMillion + 2 * PRICES.logpushRequestsPerMillion;
    assert.equal(day.cost_usd, Math.round(expected * 1e6) / 1e6);
  });

  it('falls back to requests × p50 for days collected before cpu_ms existed', () => {
    assert.equal(dayCost('worker', { requests: 1e6, cpu_p50: 2000 }), Math.round((0.3 + 2 * 0.02) * 1e6) / 1e6);
  });
});
