import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cacheRule, mediaBucket, mediaHost, MP4_RATE_LIMIT, planCors, planRateLimit, planRumOff, RUM_OFF_RULE, ruleDiffers } from '../apply.ts';
import { CfApiError } from '../../release/cf-api.ts';
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
		// The API adds defaults of its own (e.g. edge_ttl.default, cache_key): still the same rule
		const echoed = { ...want, id: 'x', action_parameters: { ...want.action_parameters, cache_key: { ignore_query_strings_order: false }, edge_ttl: { ...want.action_parameters.edge_ttl, default: 0 } } };
		assert.equal(ruleDiffers(echoed, want), false);
		const changedTtl = { ...want, action_parameters: { ...want.action_parameters, edge_ttl: { mode: 'override_origin' } } };
		assert.equal(ruleDiffers(changedTtl as never, want), true);
	});
	it('plans CORS only when it differs', async () => {
		const cf = { accountId: 'a', request: async () => ({ rules: [] }) } as unknown as CfClient;
		assert.equal((await planCors(cf, 'qa')).length, 1);
	});
	it('limits only the public MP4, per IP, within the Free plan (10 per 10 s, block)', () => {
		assert.equal(MP4_RATE_LIMIT.expression, '(http.request.uri.path wildcard "/pub/*/video.mp4")');
		assert.equal(MP4_RATE_LIMIT.action, 'block');
		assert.deepEqual(MP4_RATE_LIMIT.ratelimit, { characteristics: ['ip.src', 'cf.colo.id'], period: 10, requests_per_period: 10, mitigation_timeout: 10 });
		// A changed limit is drift
		assert.equal(ruleDiffers({ ...MP4_RATE_LIMIT, id: 'x', ratelimit: { ...MP4_RATE_LIMIT.ratelimit, requests_per_period: 100 } }, MP4_RATE_LIMIT), true);
		assert.equal(ruleDiffers({ ...MP4_RATE_LIMIT, id: 'x' }, MP4_RATE_LIMIT), false);
	});
	it('plans the rate-limit rule: create the phase, add beside other rules, or nothing when it matches', async () => {
		const calls: string[] = [];
		const zone = (entry: unknown) =>
			(async (method: string, path: string) => {
				calls.push(`${method} ${path}`);
				if (entry instanceof Error) throw entry;
				return entry;
			}) as never;
		assert.match((await planRateLimit(zone(new CfApiError(404, 'none'))))[0].what, /create/);
		const other = { id: 'o', ref: 'someone-else', expression: 'x', action: 'block' };
		const add = await planRateLimit(zone({ id: 'rs', rules: [other] }));
		assert.match(add[0].what, /add/);
		assert.deepEqual(await planRateLimit(zone({ id: 'rs', rules: [other, { ...MP4_RATE_LIMIT, id: 'r1' }] })), []);
		await assert.rejects(planRateLimit(zone(new CfApiError(403, 'Authentication error'))));
		assert.ok(calls.every((c) => c === 'GET /rulesets/phases/http_ratelimit/entrypoint'));
	});

	it('turns Web Analytics off on every QA and stage host and for headless browsers, never on production', () => {
		assert.equal(RUM_OFF_RULE.action, 'set_config');
		assert.deepEqual(RUM_OFF_RULE.action_parameters, { disable_rum: true });
		const e = RUM_OFF_RULE.expression;
		assert.match(e, /http\.host in \{"qa\.alummahnow\.net" "stage\.alummahnow\.net"\}/);
		assert.match(e, /http\.host wildcard "\*\.qa\.alummahnow\.net"/);
		assert.match(e, /http\.host wildcard "\*\.stage\.alummahnow\.net"/);
		assert.match(e, /lower\(http\.user_agent\) contains "headless"/);
		// Nothing that could match a production host
		assert.doesNotMatch(e, /"\*\.alummahnow\.net"|"www\.alummahnow\.net"|"videos\.alummahnow\.net"/);
	});

	it('plans the rum rule in the config-settings phase: create, add beside others, update, or nothing', async () => {
		const calls: string[] = [];
		const zone = (entry: unknown) =>
			(async (method: string, path: string) => {
				calls.push(`${method} ${path}`);
				if (entry instanceof Error) throw entry;
				return entry;
			}) as never;
		assert.match((await planRumOff(zone(new CfApiError(404, 'none'))))[0].what, /create/);
		const other = { id: 'o', ref: 'someone-else', expression: 'x', action: 'set_config' };
		assert.match((await planRumOff(zone({ id: 'rs', rules: [other] })))[0].what, /add/);
		assert.match((await planRumOff(zone({ id: 'rs', rules: [{ ...RUM_OFF_RULE, id: 'r1', expression: 'old' }] })))[0].what, /update/);
		assert.deepEqual(await planRumOff(zone({ id: 'rs', rules: [other, { ...RUM_OFF_RULE, id: 'r1' }] })), []);
		await assert.rejects(planRumOff(zone(new CfApiError(403, 'Authentication error'))));
		assert.ok(calls.every((c) => c === 'GET /rulesets/phases/http_config_settings/entrypoint'));
	});
});
