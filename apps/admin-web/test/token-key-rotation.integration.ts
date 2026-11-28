/**
 * Signing-key rotation (AlUmmahNowAuth#13) through each app's OpenAuth client.
 * The shared JWKS cache and bounded refetch were added in OpenAuth ca77c93f0570.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient as getAdminApiClient } from '../../admin-api/src/lib/openauth-client';
import { getClient as getVideosApiClient } from '../../api-videos/src/lib/openauth-client';
import { getOpenAuthClient as getWebClient } from '../../web/src/lib/auth/openauth-client';
import { adminAuth } from '../src/lib/auth-client';

import { ISSUER, JWKS_REFETCH_COOLDOWN_MS, clientIds, issuer, key } from './openauth-issuer-fixture';

const apps = [
  { name: 'admin-web', clientId: clientIds.adminWeb, getClient: adminAuth((message) => assert.fail(message)).getAuthClient },
  { name: 'admin-api', clientId: clientIds.adminWeb, getClient: getAdminApiClient },
  { name: 'api-videos', clientId: clientIds.web, getClient: getVideosApiClient },
  { name: 'web', clientId: clientIds.web, getClient: () => getWebClient() },
];

for (const { name, clientId, getClient } of apps) {
  test(`${name} verifies a token from a newly published key on the same client`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const env = { Issuer: ISSUER, ClientId: clientId, AUD_MODE: 'enforce' };
    for (const [key, value] of Object.entries(env)) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      });
    }
    const oldKey = await key('kid-old', clientId);
    const newKey = await key('kid-new', clientId);
    const { subjects, state, fetch } = await issuer([oldKey.jwk]);
    t.mock.method(globalThis, 'fetch', fetch);
    const client = await getClient(env);
    const oldToken = await oldKey.sign();
    assert.ok(!(await client.verify(subjects, oldToken)).err);

    state.keys = [newKey.jwk, oldKey.jwk];
    const newToken = await newKey.sign();
    assert.ok((await client.verify(subjects, newToken)).err, 'still inside the cooldown');
    assert.equal(state.jwksFetches, 1);

    t.mock.timers.tick(JWKS_REFETCH_COOLDOWN_MS);
    const verified = await client.verify(subjects, newToken);
    assert.ok(!verified.err, 'verified with fresh keys');
    assert.equal(verified.subject.properties.id, 'usr_a');
    assert.equal(state.jwksFetches, 2);
    assert.equal(await getClient(env), client);
    assert.ok(!(await client.verify(subjects, oldToken)).err, 'previous key still verifies during overlap');
  });
}
