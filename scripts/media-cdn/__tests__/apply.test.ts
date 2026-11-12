import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheRule, mediaBucket, mediaHost, planCors, ruleDiffers } from '../apply.ts';
import type { CfClient } from '../../release/cf-api.ts';

describe('media-cdn', () => {
	it('names hosts and buckets per env (al-ummah-* only)', () => {
		assert.equal(mediaHost('production'), 'media.alummahnow.net');
		assert.equal(mediaHost('qa'), 'media.qa.alummahnow.net');
		assert.equal(mediaBucket('stage'), 'al-ummah-now-media-stage');
		assert.equal(mediaBucket('production'), 'al-ummah-now-media');
	});
	it('scopes the Cache Rule to the env media host and takes TTLs from the objects', () => {
		const r = cacheRule('qa');
		assert.equal(r.expression, '(http.host eq "media.qa.alummahnow.net")');
		assert.equal(r.action_parameters.cache, true);
		assert.equal(r.action_parameters.edge_ttl.mode, 'respect_origin');
		assert.equal(r.ref, 'al-ummah-media-cache-qa');
	});
	it('sees no drift in a rule that matches, and drift in one an admin edited', () => {
		const want = cacheRule('qa');
		assert.equal(ruleDiffers({ ...want, id: 'x' }, want), false);
		assert.equal(ruleDiffers({ ...want, expression: '(http.host eq "other")' }, want), true);
		assert.equal(ruleDiffers(undefined, want), true);
	});
	it('plans CORS only when it differs', async () => {
		const cf = { accountId: 'a', request: async () => ({ rules: [] }) } as unknown as CfClient;
		assert.equal((await planCors(cf, 'qa')).length, 1);
	});
});
