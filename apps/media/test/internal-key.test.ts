/**
 * /internal/jobs/:videoId exposes a transcode job's state (admin only): it needs INTERNAL_API_KEY,
 * compared in constant time (security audit). Missing, wrong, truncated or padded keys are refused,
 * and an unbound or empty key matches nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasInternalKey } from '../src/env';

const KEY = 'm'.repeat(40);
const req = (headers: Record<string, string | undefined>) => new Request('https://media.test/internal/jobs/x', { headers: Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => typeof e[1] === 'string')) });

describe('media hasInternalKey', () => {
	it('refuses a missing, wrong, truncated or padded key', async () => {
		for (const headers of [{}, { 'X-API-Key': '' }, { 'X-API-Key': 'wrong' }, { 'X-API-Key': KEY.slice(0, -1) }, { 'X-API-Key': `${KEY}x` }]) {
			assert.equal(await hasInternalKey(req(headers), KEY), false, JSON.stringify(headers));
		}
	});

	it('matches nothing when the key is unbound or empty', async () => {
		assert.equal(await hasInternalKey(req({ 'X-API-Key': '' }), undefined), false);
		assert.equal(await hasInternalKey(req({ 'X-API-Key': '' }), ''), false);
	});

	it('accepts the right key (string or Secrets Store binding)', async () => {
		assert.equal(await hasInternalKey(req({ 'X-API-Key': KEY }), KEY), true);
		assert.equal(await hasInternalKey(req({ 'X-API-Key': KEY }), { get: async () => KEY } as never), true);
	});
});
