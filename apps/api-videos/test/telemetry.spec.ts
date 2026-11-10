import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './helpers';
import { TelemetryEventsPost } from '../src/endpoints/telemetry/telemetryEvents';
import { MAX_EVENTS, TelemetryBatch, inSample, sampleRate, scrubText, toDataPoint } from '../src/lib/telemetry';

/**
 * Client telemetry ingest (Epic 9.8): schema validation, consent gate, size
 * limits, PII stripping, Analytics Engine row shape, sampling, rate limit.
 */

class MemoryDataset {
	points: AnalyticsEngineDataPoint[] = [];
	writeDataPoint(p: AnalyticsEngineDataPoint) {
		this.points.push(p);
	}
}

class Limiter {
	calls = 0;
	constructor(private max: number) {}
	async limit() {
		return { success: ++this.calls <= this.max };
	}
}

class MemoryKV {
	constructor(private values: Record<string, unknown> = {}) {}
	async get(key: string) {
		return this.values[key] ?? null;
	}
}

const base = { installId: 'inst-1234567890', app: 'viewer', platform: 'tvos', appVersion: '1.2.0', consent: { analytics: true } };
const qoe = { type: 'qoe', ts: 1_762_600_000_000, videoId: 'vid_1', startupMs: 850, rebufferRatio: 0.02, bitrateSwitches: 3 };

function send(body: unknown, env: Record<string, unknown>, raw?: string) {
	const app = buildApp((r) => r.post('/api/telemetry/events', TelemetryEventsPost));
	return app.request('/api/telemetry/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) }, env);
}

describe('telemetry schema', () => {
	it('accepts the three event types', () => {
		const ok = TelemetryBatch.safeParse({
			...base,
			events: [qoe, { type: 'crash_breadcrumb', errorCode: 'E_PLAYER', breadcrumbs: ['opened player'] }, { type: 'app_event', name: 'app_open' }],
		});
		assert.equal(ok.success, true, JSON.stringify(!ok.success && ok.error.issues));
	});

	it('rejects unknown types, unknown app event names, extra fields and out-of-range values', () => {
		for (const event of [
			{ type: 'pageview' },
			{ type: 'app_event', name: 'watched_video_about_x' },
			{ ...qoe, email: 'a@b.c' },
			{ ...qoe, rebufferRatio: 2 },
			{ type: 'qoe', fatalErrorCode: 'has spaces and words' },
		]) {
			assert.equal(TelemetryBatch.safeParse({ ...base, events: [event] }).success, false, JSON.stringify(event));
		}
		assert.equal(TelemetryBatch.safeParse({ ...base, userId: 'u1', events: [qoe] }).success, false, 'no user id in the envelope');
		assert.equal(TelemetryBatch.safeParse({ ...base, events: Array(MAX_EVENTS + 1).fill(qoe) }).success, false);
		assert.equal(TelemetryBatch.safeParse({ ...base, events: [] }).success, false);
	});
});

describe('scrubText', () => {
	it('strips emails, query strings, tokens, JWTs and long numbers, and truncates', () => {
		assert.equal(scrubText('login failed for someone@example.com'), 'login failed for [email]');
		assert.equal(scrubText('GET https://videos.api.alummahnow.net/api/v1/x?token=abc&u=1 500'), 'GET https://videos.api.alummahnow.net/api/v1/x 500');
		assert.equal(scrubText('Authorization: Bearer abc.def'), 'Authorization: Bearer [redacted]');
		assert.equal(scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'), 'jwt [jwt]');
		assert.equal(scrubText('phone 0501234567'), 'phone [number]');
		assert.equal(scrubText('x'.repeat(500)).length, 200);
	});
});

describe('row shape', () => {
	it('keeps fixed column positions and never stores the raw install id', () => {
		const batch = TelemetryBatch.parse({ ...base, events: [qoe, { type: 'crash_breadcrumb', errorCode: 'E1', breadcrumbs: ['a@b.co tapped', 'x'] }] });
		const q = toDataPoint(batch, batch.events[0], 'hash123');
		assert.deepEqual(q.indexes, ['qoe']);
		assert.deepEqual(q.blobs, ['qoe', 'viewer', 'tvos', '1.2.0', '', 'vid_1', 'hash123']);
		assert.deepEqual(q.doubles, [850, 0.02, 3, 1_762_600_000_000, 0]);
		const c = toDataPoint(batch, batch.events[1], 'hash123');
		assert.deepEqual(c.blobs, ['crash_breadcrumb', 'viewer', 'tvos', '1.2.0', 'E1', '', 'hash123', '[email] tapped | x']);
		assert.equal(c.doubles![4], 2);
		assert.ok(!JSON.stringify([q, c]).includes(base.installId));
	});
});

describe('sampling', () => {
	it('reads telemetry.sample.<type> from config, defaulting to everything', () => {
		assert.equal(sampleRate({}, 'qoe'), 1);
		assert.equal(sampleRate({ 'telemetry.sample.qoe': 0.1 }, 'qoe'), 0.1);
		assert.equal(sampleRate({ 'telemetry.sample.qoe': 7 }, 'qoe'), 1);
	});

	it('is stable per install and close to the rate', () => {
		assert.equal(inSample('a', 'qoe', 0.5), inSample('a', 'qoe', 0.5));
		let n = 0;
		for (let i = 0; i < 2000; i++) if (inSample(`install-${i}`, 'qoe', 0.1)) n++;
		assert.ok(n > 120 && n < 280, `${n} of 2000 at 10%`);
	});
});

describe('POST /api/telemetry/events', () => {
	it('writes consented events and answers 202', async () => {
		const ds = new MemoryDataset();
		const res = await send({ ...base, events: [qoe, { type: 'app_event', name: 'app_open' }] }, { CLIENT_TELEMETRY: ds });
		assert.equal(res.status, 202);
		assert.deepEqual(await res.json(), { accepted: 2, dropped: 0 });
		assert.equal(ds.points.length, 2);
	});

	it('drops everything without analytics consent (202, nothing written)', async () => {
		const ds = new MemoryDataset();
		const res = await send({ ...base, consent: { analytics: false }, events: [qoe] }, { CLIENT_TELEMETRY: ds });
		assert.equal(res.status, 202);
		assert.deepEqual(await res.json(), { accepted: 0, dropped: 1 });
		assert.equal(ds.points.length, 0);
	});

	it('rejects batches over 64 KB with 413 and invalid ones with 400', async () => {
		const ds = new MemoryDataset();
		const big = JSON.stringify({ ...base, events: [{ type: 'crash_breadcrumb', breadcrumbs: Array(20).fill('x'.repeat(2000)) }], pad: 'y'.repeat(70_000) });
		assert.equal((await send(null, { CLIENT_TELEMETRY: ds }, big)).status, 413);
		assert.equal((await send(null, { CLIENT_TELEMETRY: ds }, '{nope')).status, 400);
		assert.equal((await send({ ...base, events: [{ type: 'app_event', name: 'nope' }] }, { CLIENT_TELEMETRY: ds })).status, 400);
		assert.equal(ds.points.length, 0);
	});

	it('rate limits per install id', async () => {
		const env = { CLIENT_TELEMETRY: new MemoryDataset(), TELEMETRY_LIMITER: new Limiter(1) };
		assert.equal((await send({ ...base, events: [qoe] }, env)).status, 202);
		assert.equal((await send({ ...base, events: [qoe] }, env)).status, 429);
	});

	it('applies remote-config sampling', async () => {
		const ds = new MemoryDataset();
		const kv = new MemoryKV({ config: [{ key: 'telemetry.sample.qoe', value: 0 }] });
		const res = await send({ ...base, events: [qoe, { type: 'app_event', name: 'app_open' }] }, { CLIENT_TELEMETRY: ds, APP_CONFIG: kv });
		assert.deepEqual(await res.json(), { accepted: 1, dropped: 1 });
		assert.deepEqual(ds.points.map((p) => p.indexes![0]), ['app_event']);
	});

	it('accepts and drops when the dataset is not bound', async () => {
		const res = await send({ ...base, events: [qoe] }, {});
		assert.equal(res.status, 202);
		assert.deepEqual(await res.json(), { accepted: 0, dropped: 1 });
	});
});
