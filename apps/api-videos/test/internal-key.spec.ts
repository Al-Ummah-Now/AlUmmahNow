/**
 * /internal/*, /test, /test-error and /api/i18n/sync mutate storage or expose internals: they need
 * X-API-Key == INTERNAL_API_KEY, compared in constant time (security audit). A missing, wrong,
 * truncated or padded key is a 401; an unbound or empty key matches nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';

const KEY = 'v'.repeat(40);
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const call = (path: string, headers: Record<string, string>, env: Record<string, unknown> = { INTERNAL_API_KEY: KEY }) =>
	worker.fetch(new Request(`https://videos.test${path}`, { headers }), env as never, ctx);

describe('api-videos internal key guard', () => {
	it('refuses a missing, wrong, truncated or padded key on every internal path', async () => {
		for (const path of ['/internal/search/stats', '/test', '/test-error']) {
			for (const headers of [{}, { 'X-API-Key': '' }, { 'X-API-Key': 'wrong' }, { 'X-API-Key': KEY.slice(0, -1) }, { 'X-API-Key': `${KEY}x` }]) {
				assert.equal((await call(path, headers)).status, 401, `${path} ${JSON.stringify(headers)}`);
			}
		}
	});

	it('matches nothing when INTERNAL_API_KEY is unbound or empty', async () => {
		assert.equal((await call('/internal/search/stats', { 'X-API-Key': '' }, {})).status, 401);
		assert.equal((await call('/internal/search/stats', { 'X-API-Key': 'x' }, {})).status, 401);
		assert.equal((await call('/internal/search/stats', { 'X-API-Key': '' }, { INTERNAL_API_KEY: { get: async () => '' } })).status, 401);
	});

	it('lets the right key past the guard (string or Secrets Store binding)', async () => {
		assert.notEqual((await call('/test-error', { 'X-API-Key': KEY })).status, 401);
		assert.notEqual((await call('/test-error', { 'X-API-Key': KEY }, { INTERNAL_API_KEY: { get: async () => KEY } })).status, 401);
	});
});
