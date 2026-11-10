import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { resetLogging } from '@al-ummah/logger';
import { loggingMiddleware, slowThresholdMs } from '../src/middleware/logging';
import { errorHandler } from '../src/middleware/error-handler';

/** Logging policy (docs/operations/logging.md): one summary line per request. */
type Entry = { level: string; msg: string; [k: string]: unknown };

describe('request summary logging', () => {
	const original = { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
	let lines: Entry[];

	beforeEach(() => {
		resetLogging();
		lines = [];
		for (const level of ['debug', 'info', 'warn', 'error'] as const) {
			console[level] = (entry: Entry) => void lines.push(entry);
		}
	});
	afterEach(() => {
		Object.assign(console, original);
		resetLogging();
	});

	function app() {
		const a = new Hono();
		a.onError(errorHandler);
		a.use('*', loggingMiddleware);
		a.get('/videos/:id', (c) => c.json({ id: c.req.param('id') }));
		a.get('/missing', (c) => c.json({ error: 'Video not found' }, 404));
		a.get('/down', (c) => c.json({ error: 'Bunny unavailable' }, 503));
		a.get('/boom', () => {
			throw new Error('database exploded');
		});
		return a;
	}
	const call = (path: string, ENVIRONMENT: string) =>
		app().request(path, { headers: { 'cf-ray': 'ray-1' } }, { ENVIRONMENT, LOG_LEVEL: undefined });

	it('stage: exactly one info line with route, status, duration and ray', async () => {
		await call('/videos/v1', 'stage');
		assert.equal(lines.length, 1);
		assert.equal(lines[0].level, 'info');
		assert.equal(lines[0].msg, 'request GET /videos/v1 200');
		assert.equal(lines[0].status, 200);
		assert.equal(lines[0].ray, 'ray-1');
		assert.equal(typeof lines[0].durationMs, 'number');
	});

	it('production: a healthy request and a 4xx write nothing', async () => {
		await call('/videos/v1', 'production');
		await call('/missing', 'production');
		assert.deepEqual(lines, []);
	});

	it('production: a 5xx response is one error line with the body message', async () => {
		await call('/down', 'production');
		assert.equal(lines.length, 1);
		assert.equal(lines[0].level, 'error');
		assert.equal(lines[0].status, 503);
		assert.equal(lines[0].data, undefined);
		assert.equal(lines[0].error, 'Bunny unavailable');
	});

	it('production: a thrown error is logged once, by the error handler, with its stack', async () => {
		const res = await call('/boom', 'production');
		assert.equal(res.status, 500);
		assert.equal(lines.length, 1);
		assert.equal(lines[0].level, 'error');
		const error = lines[0].error as { message: string; stack?: string };
		assert.equal(error.message, 'database exploded');
		assert.ok(error.stack?.includes('database exploded'));
	});

	it('upload data gets a 30 s slow threshold; other requests 1.5 s', () => {
		assert.equal(slowThresholdMs('PATCH', '/api/videos/tus/abc'), 30_000);
		assert.equal(slowThresholdMs('POST', '/api/videos/v1/thumbnail'), 30_000);
		assert.equal(slowThresholdMs('GET', '/api/videos/tus/abc'), 1500);
		assert.equal(slowThresholdMs('GET', '/api/videos/v1'), 1500);
	});
});
