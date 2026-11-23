/**
 * The feature route map (FEAT-2, wiki AUN-FEATURES §5.1): every route the worker registers under a
 * feature's area is mapped or exempt with a reason; every mapping names a real route; every switch
 * gates something; and on the real app every middleware-gated route answers 404 feature_off with
 * the envelope while its switch is off, before validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	FEATURE_AREAS,
	FEATURE_KEYS,
	FEATURE_KEYS_WITHOUT_ROUTES,
	FEATURE_ROUTES,
	FEATURE_ROUTE_EXEMPTIONS,
	middlewareFeatureRoutes,
	type FeatureApp,
} from '@al-ummah/shared-types';
import worker, { listServedRoutes } from '../src/index';

const APP: FeatureApp = 'api-videos';
const served = () => listServedRoutes().filter((r) => r.method !== 'ALL' && r.method !== 'OPTIONS');
const id = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe('feature route map (api-videos)', () => {
	it('every route in a feature area is mapped or exempt with a reason', () => {
		const mapped = new Set(FEATURE_ROUTES.filter((r) => r.app === APP).map(id));
		const exempt = new Set(FEATURE_ROUTE_EXEMPTIONS.filter((r) => r.app === APP && r.reason.trim()).map(id));
		const missing = served()
			.filter((r) => FEATURE_AREAS.some((a) => a.app === APP && r.path.startsWith(a.prefix)))
			.filter((r) => !mapped.has(id(r)) && !exempt.has(id(r)))
			.map(id);
		assert.deepEqual([...new Set(missing)], [], 'map these in FEATURE_ROUTES or exempt them with a reason (shared-types feature-routes.ts)');
	});

	it('every mapping and exemption names a route this worker serves', () => {
		const routes = new Set(served().map(id));
		const stale = [...FEATURE_ROUTES, ...FEATURE_ROUTE_EXEMPTIONS].filter((r) => r.app === APP && !routes.has(id(r))).map(id);
		assert.deepEqual(stale, []);
	});

	it('every switch gates at least one route, or says why not', () => {
		const gated = new Set(FEATURE_ROUTES.map((r) => r.key));
		const bare = FEATURE_KEYS.filter((k) => !gated.has(k) && !FEATURE_KEYS_WITHOUT_ROUTES[k]);
		assert.deepEqual(bare, []);
	});

	it('the real app refuses every middleware-gated route while its switch is off, before validation', async () => {
		const env = { FEATURES_FORCE_OFF: 'all', ENVIRONMENT: 'test' };
		const ctx = { waitUntil() {}, passThroughOnException() {} };
		for (const route of middlewareFeatureRoutes(APP)) {
			const path = route.path.replace(/:[A-Za-z]+/g, 'x1');
			// No body and no auth: the old shape of any client; the gate answers first
			const res = await worker.fetch(new Request(`https://videos.api.example${path}`, { method: route.method, headers: { 'X-App-Locale': 'ar' } }), env as never, ctx as never);
			assert.equal(res.status, 404, `${id(route)} answered ${res.status}`);
			const body = (await res.json()) as Record<string, unknown>;
			assert.equal(body.code, 'feature_off', id(route));
			assert.equal(body.feature, route.key, id(route));
			assert.equal(body.lang, 'ar');
			assert.ok(typeof body.message === 'string' && body.message.length > 0);
		}
	});

	it('the versioned path (/api/v1/...) is gated too', async () => {
		const res = await worker.fetch(new Request('https://videos.api.example/api/v1/live-streams', { method: 'POST' }), { FEATURES_FORCE_OFF: 'live' } as never, { waitUntil() {} } as never);
		assert.equal(res.status, 404);
		assert.equal(((await res.json()) as { feature?: string }).feature, 'live');
	});
});
