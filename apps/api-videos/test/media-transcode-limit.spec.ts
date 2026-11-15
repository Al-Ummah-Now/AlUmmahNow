/**
 * Concurrent R2 transcodes as a min–max range (Video providers → Cloudflare R2 settings): the setting
 * api-videos stores for apps/media's dispatcher, its rules under the container ceiling
 * (1 ≤ min ≤ max ≤ ceiling), the internal routes admin-api calls, and the live figures
 * ("N running · M waiting · range min–max").
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSCODE_LIMIT_KEY, TRANSCODER_USD_PER_SECOND } from '@al-ummah/shared-types';
import { clearTranscodeLimitCache, effectiveTranscodes, readTranscodeLimitView, saveTranscodeLimit, TranscodeLimitError } from '../src/lib/media/transcode-limit';
import { createMediaInternalRouter, readMediaLive } from '../src/endpoints/media/mediaInternal';
import { transcodeSlotsFull } from '../src/lib/media/r2-delivery';
import { PRICES } from '../src/lib/media/costs';

class Bucket {
	store = new Map<string, string>();
	gets = 0;
	async get(key: string) {
		this.gets++;
		const v = this.store.get(key);
		return v === undefined ? null : { json: async () => JSON.parse(v) };
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
}

const T = Date.parse('2026-11-15T12:00:00Z');
const env = (bucket = new Bucket(), ceiling = '10') => ({ global_settings: bucket as never, MEDIA_TRANSCODE_CEILING: ceiling });

describe('the transcode range setting', () => {
	beforeEach(() => clearTranscodeLimitCache());

	it('defaults to 4–4 (today\'s fixed 4) under a ceiling of 10, and to the ceiling where it is lower', async () => {
		const prod = await readTranscodeLimitView(env(), true, T);
		assert.deepEqual([prod.min, prod.max, prod.effective, prod.ceiling, prod.isDefault], [4, 4, { min: 4, max: 4 }, 10, true]);
		const qa = await readTranscodeLimitView(env(new Bucket(), '2'), true, T);
		assert.deepEqual([qa.min, qa.max, qa.effective, qa.ceiling], [4, 4, { min: 2, max: 2 }, 2]);
	});

	it('saves min and max where apps/media reads them, with who and when', async () => {
		const bucket = new Bucket();
		const e = env(bucket);
		const view = await saveTranscodeLimit(e, { min: 2, max: 8 }, 'admin-1', T);
		assert.deepEqual([view.min, view.max, view.effective, view.isDefault, view.updatedBy], [2, 8, { min: 2, max: 8 }, false, 'admin-1']);
		assert.deepEqual(JSON.parse(bucket.store.get(TRANSCODE_LIMIT_KEY)!), { min: 2, max: 8, updatedAt: new Date(T).toISOString(), updatedBy: 'admin-1' });
		assert.deepEqual(await effectiveTranscodes(e, T + 1000), { min: 2, max: 8 });
	});

	it('enforces 1 ≤ min ≤ max ≤ ceiling, names the field, and leaves the stored value alone', async () => {
		const bucket = new Bucket();
		const e = env(bucket);
		await saveTranscodeLimit(e, { min: 3, max: 3 }, 'a', T);
		const cases = [
			[{ min: 0, max: 4 }, 'below_minimum', 'min'],
			[{ min: 2, max: 0 }, 'below_minimum', 'max'],
			[{ min: 5, max: 4 }, 'min_above_max', 'min'],
			[{ min: 2, max: 11 }, 'above_ceiling', 'max'],
			[{ min: 2.5, max: 4 }, 'not_whole_number', 'min'],
			[{ min: 2, max: '4' }, 'not_whole_number', 'max'],
			[{ min: 2 }, 'not_whole_number', 'max'],
		] as const;
		for (const [range, problem, field] of cases) {
			await assert.rejects(saveTranscodeLimit(e, range, 'a', T), (err: unknown) => err instanceof TranscodeLimitError && err.problem === problem && err.field === field && err.ceiling === 10, JSON.stringify(range));
		}
		assert.deepEqual(JSON.parse(bucket.store.get(TRANSCODE_LIMIT_KEY)!), { min: 3, max: 3, updatedAt: new Date(T).toISOString(), updatedBy: 'a' });
	});

	it('reads the first version\'s single limit as min = max', async () => {
		const bucket = new Bucket();
		bucket.store.set(TRANSCODE_LIMIT_KEY, JSON.stringify({ limit: 6 }));
		const v = await readTranscodeLimitView(env(bucket), true, T);
		assert.deepEqual([v.min, v.max, v.isDefault], [6, 6, false]);
	});

	it('is cached 30 s, so the dispatcher and the page agree within a minute', async () => {
		const bucket = new Bucket();
		const e = env(bucket);
		await effectiveTranscodes(e, T);
		await effectiveTranscodes(e, T + 20_000);
		assert.equal(bucket.gets, 1);
		await effectiveTranscodes(e, T + 31_000);
		assert.equal(bucket.gets, 2);
	});

	it('shows the cost of one more slot, and the worst case with every slot up to max busy', async () => {
		assert.equal(TRANSCODER_USD_PER_SECOND, PRICES.containerInstanceSecond);
		const bucket = new Bucket();
		await saveTranscodeLimit(env(bucket), { min: 2, max: 10 }, 'a', T);
		const view = await readTranscodeLimitView(env(bucket), true, T);
		assert.equal(view.slotUsdPerHour, 0.4);
		assert.equal(view.slotUsdPerMonth, 288.75);
		assert.equal(view.maxUsdPerHour, 4.01);
	});
});

describe('internal routes (admin-api calls them)', () => {
	beforeEach(() => clearTranscodeLimitCache());
	const app = createMediaInternalRouter();

	it('GET returns the view; PUT saves the range and returns it', async () => {
		const e = env();
		const got = (await (await app.request('/transcode-limit', {}, e as never)).json()) as { result: { min: number; max: number; ceiling: number } };
		assert.deepEqual([got.result.min, got.result.max, got.result.ceiling], [4, 4, 10]);
		const res = await app.request('/transcode-limit', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ min: 2, max: 6, actorId: 'admin-1' }) }, e as never);
		assert.equal(res.status, 200);
		const put = (await res.json()) as { result: { min: number; max: number; updatedBy: string } };
		assert.deepEqual([put.result.min, put.result.max, put.result.updatedBy], [2, 6, 'admin-1']);
	});

	it('PUT out of range is a 400 naming the problem, the field and the ceiling', async () => {
		const res = await app.request('/transcode-limit', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ min: 2, max: 12, actorId: 'a' }) }, env() as never);
		assert.equal(res.status, 400);
		const body = (await res.json()) as { code: string; field: string; ceiling: number };
		assert.deepEqual([body.code, body.field, body.ceiling], ['above_ceiling', 'max', 10]);
	});
});

describe('live figures and the busy check use the range', () => {
	beforeEach(() => clearTranscodeLimitCache());
	const db = (transcoding: number) => ({
		prepare: (sql: string) => ({
			first: async () => (sql.includes('COUNT(*)') ? { n: transcoding } : { transcoding, queued: 5, oldest_queued_at: null }),
		}),
	});

	it('"N running · M waiting · range min–max" with the ceiling', async () => {
		const bucket = new Bucket();
		bucket.store.set(TRANSCODE_LIMIT_KEY, JSON.stringify({ min: 2, max: 6, updatedAt: null, updatedBy: null }));
		const live = await readMediaLive({ SEARCH_DB: db(3), global_settings: bucket, MEDIA_TRANSCODE_CEILING: '10' } as never, T);
		assert.deepEqual([live.transcoding, live.queued, live.rangeMin, live.rangeMax, live.ceiling], [3, 5, 2, 6, 10]);
	});

	it('busy once `min` are transcoding (above it slots open one at a time, so waiting is expected)', async () => {
		const bucket = new Bucket();
		bucket.store.set(TRANSCODE_LIMIT_KEY, JSON.stringify({ min: 2, max: 6 }));
		assert.equal(await transcodeSlotsFull({ SEARCH_DB: db(1), global_settings: bucket, MEDIA_TRANSCODE_CEILING: '10' } as never, T), false);
		assert.equal(await transcodeSlotsFull({ SEARCH_DB: db(2), global_settings: bucket, MEDIA_TRANSCODE_CEILING: '10' } as never, T), true);
	});
});
