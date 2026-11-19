/**
 * The no-retry upload specs (uploads, media-delivery, audio-tracks, upload-reuse) get one more
 * attempt only on a provider slowdown, and skip with #929 only when the provider was measurably
 * in trouble on both attempts (apps/web/e2e/release/provider-retry.ts). Everything else still
 * fails: these are the rules that keep real bugs red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SLOW_MS, classifyAnswer, decideAfterFailure, isProviderStatus, isProviderUploadFailure, isTimeout, type ProviderEvent } from '../../../apps/web/e2e/release/provider-rules.ts';

const API = 'videos.api.stage.alummahnow.net';
const BUNNY = 'video.bunnycdn.com';
const timeout = Object.assign(new Error('locator.click: Timeout 10000ms exceeded.'), { name: 'TimeoutError' });
const expectTimeout = new Error('expect(locator).toBeVisible() failed\n\nTimeout: 150000ms exceeded while waiting for the element');
const valueMismatch = new Error('the retry created a second TUS upload at Bunny\n\nExpected: 0\nReceived: 1');
const status4xx = new Error('PUT /api/profile/avatar: {"error":"forbidden"}\n\nExpected: 200\nReceived: 403');
const event = (kind: ProviderEvent['kind']): ProviderEvent => ({ at: 1, kind, detail: kind });

describe('provider trouble', () => {
	it('gateway and edge errors, Bunny 5xx and the TUS proxy 423 are the provider; our 500 and every 4xx are ours', () => {
		for (const status of [502, 503, 504, 520, 522, 524, 530]) assert.equal(isProviderStatus(API, '/api/videos/x', status), true, String(status));
		assert.equal(isProviderStatus(BUNNY, '/tusupload', 500), true);
		assert.equal(isProviderStatus(API, '/api/videos/tus/abc', 423), true);
		assert.equal(isProviderStatus(API, '/api/videos/x', 500), false, 'a 500 from our API is a bug');
		for (const status of [400, 401, 403, 404, 409, 410, 422, 429]) assert.equal(isProviderStatus(API, '/api/videos/x', status), false, String(status));
		assert.equal(isProviderStatus(API, '/api/videos/x', 423), false, 'a 423 elsewhere is a state error');
	});

	it('an answer slower than SLOW_MS is a slowdown; a prompt one is healthy', () => {
		assert.equal(classifyAnswer(API, '/en', 200, SLOW_MS + 1), 'slow');
		assert.equal(classifyAnswer(API, '/en', 200, 2_000), null);
		assert.equal(classifyAnswer(API, '/en', 503, 100), 'gateway');
		assert.equal(classifyAnswer(API, '/api/videos/x', 404, 100), null);
	});

	it('Playwright action, navigation and expect timeouts are timeouts; a value mismatch is not', () => {
		assert.equal(isTimeout(timeout), true);
		assert.equal(isTimeout(expectTimeout), true);
		assert.equal(isTimeout(new Error('page.goto: Timeout 30000ms exceeded.')), true);
		assert.equal(isTimeout(valueMismatch), false);
		assert.equal(isTimeout(status4xx), false);
		assert.equal(isTimeout(undefined), false);
	});
});

describe('after a failed attempt', () => {
	it('a value mismatch, a 4xx or a permission error fails at once, even while the provider is slow', () => {
		assert.equal(decideAfterFailure(1, valueMismatch, []), 'fail');
		assert.equal(decideAfterFailure(1, status4xx, [event('slow')]), 'fail');
		assert.equal(decideAfterFailure(2, valueMismatch, [event('slow')]), 'fail');
	});

	it('the first attempt is retried on a timeout, or on any failure while a provider answered a gateway error', () => {
		assert.equal(decideAfterFailure(1, timeout, []), 'retry');
		assert.equal(decideAfterFailure(1, expectTimeout, [event('slow')]), 'retry');
		assert.equal(decideAfterFailure(1, valueMismatch, [event('gateway')]), 'retry');
	});

	it('the second attempt skips (#929) only with provider trouble during it; a timeout while all answered promptly fails', () => {
		assert.equal(decideAfterFailure(2, timeout, [event('slow')]), 'skip');
		assert.equal(decideAfterFailure(2, timeout, [event('no-answer')]), 'skip');
		assert.equal(decideAfterFailure(2, valueMismatch, [event('gateway')]), 'skip');
		assert.equal(decideAfterFailure(2, timeout, []), 'fail', 'a timeout with every provider healthy is ours');
	});
});

describe('a TUS answer from the upload proxy', () => {
	it('Bunny trouble: the proxy\'s retry-later 503, gateway errors, the HEAD 423, Bunny losing a fresh upload', () => {
		assert.equal(isProviderUploadFailure(503, '{"error":"Upload service busy, retry","retryable":true}'), true);
		assert.equal(isProviderUploadFailure(502, ''), true);
		assert.equal(isProviderUploadFailure(423, ''), true);
		assert.equal(isProviderUploadFailure(404, '{"error":"Upload failed"}'), true);
		assert.equal(isProviderUploadFailure(410, '{"error":"Upload failed"}'), true);
	});

	it('ours: a missing session, a refused owner, a wrong content type, a 500', () => {
		assert.equal(isProviderUploadFailure(404, '{"error":"Upload not found"}'), false);
		assert.equal(isProviderUploadFailure(403, '{"error":"Unauthorized"}'), false);
		assert.equal(isProviderUploadFailure(415, '{"error":"Invalid Content-Type"}'), false);
		assert.equal(isProviderUploadFailure(500, '{"error":"Upload failed"}'), false);
		assert.equal(isProviderUploadFailure(409, '{"error":"Upload failed"}'), false);
	});
});
