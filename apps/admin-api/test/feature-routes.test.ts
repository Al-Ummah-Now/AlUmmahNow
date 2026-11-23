/**
 * The feature route map in admin-api (FEAT-2, wiki AUN-FEATURES §5.1): every route in a feature
 * area is mapped or exempt with a reason, mappings name real routes, and on the real app each
 * middleware-gated route answers 404 feature_off (envelope) while its switch is off.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_AREAS, FEATURE_ROUTES, FEATURE_ROUTE_EXEMPTIONS, middlewareFeatureRoutes, type FeatureApp } from '@al-ummah/shared-types';
import { app } from '../src/index';

const APP: FeatureApp = 'admin-api';
const served = () => app.routes.filter((r) => r.method !== 'ALL' && r.method !== 'OPTIONS');
const id = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe('feature route map (admin-api)', () => {
  it('every route in a feature area is mapped or exempt with a reason', () => {
    const mapped = new Set(FEATURE_ROUTES.filter((r) => r.app === APP).map(id));
    const exempt = new Set(FEATURE_ROUTE_EXEMPTIONS.filter((r) => r.app === APP && r.reason.trim()).map(id));
    const missing = served()
      .filter((r) => FEATURE_AREAS.some((a) => a.app === APP && r.path.startsWith(a.prefix)))
      .filter((r) => !mapped.has(id(r)) && !exempt.has(id(r)))
      .map(id);
    assert.deepEqual([...new Set(missing)], []);
  });

  it('every mapping and exemption names a route this worker serves', () => {
    const routes = new Set(served().map(id));
    assert.deepEqual([...FEATURE_ROUTES, ...FEATURE_ROUTE_EXEMPTIONS].filter((r) => r.app === APP && !routes.has(id(r))).map(id), []);
  });

  it('the real app refuses every middleware-gated route while its switch is off', async () => {
    for (const route of middlewareFeatureRoutes(APP)) {
      const path = route.path.replace(/:[A-Za-z]+/g, 'x1');
      const res = await app.request(path, { method: route.method, headers: { 'X-App-Locale': 'en' } }, { FEATURES_FORCE_OFF: 'all' } as never);
      assert.equal(res.status, 404, `${id(route)} answered ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.code, 'feature_off', id(route));
      assert.equal(body.feature, route.key);
      assert.equal(body.lang, 'en');
    }
  });
});
