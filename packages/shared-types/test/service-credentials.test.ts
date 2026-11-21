/**
 * DeepL key sealing, plan detection and the /v2/usage probe (AUN-CAPTIONS DEEPL-KEY). DeepL is
 * mocked: no test ever calls it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deeplApiBase,
  deeplCodeForStatus,
  deeplCostUsd,
  deeplPlanOf,
  deeplUsage,
  openSecretValue,
  openServiceCredential,
  resolveDeeplKey,
  sealServiceCredential,
  validateDeeplKey,
} from '../src/service-credentials.ts';

const MASTER = 'internal-api-key-for-tests-0123456789';
const PRO = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const FREE = `${PRO}:fx`;

describe('sealServiceCredential / openServiceCredential', () => {
  it('round-trips and shows only the last four characters', async () => {
    const sealed = await sealServiceCredential('deepl', `  ${PRO} `, MASTER);
    assert.equal(sealed.key_id, 'ik1');
    assert.equal(sealed.last4, '4a5b');
    assert.ok(!sealed.ciphertext.includes(PRO));
    assert.equal(await openServiceCredential({ provider: 'deepl', ...sealed }, MASTER), PRO);
  });

  it('a Free key shows its own last four, not the ":fx" suffix', async () => {
    assert.equal((await sealServiceCredential('deepl', FREE, MASTER)).last4, '4a5b');
  });

  it('a rotated master or another purpose cannot open it', async () => {
    const sealed = await sealServiceCredential('deepl', PRO, MASTER);
    assert.equal(await openServiceCredential({ provider: 'deepl', ...sealed }, 'another-internal-api-key-0000'), null);
    assert.equal(await openServiceCredential({ provider: 'deepl', ...sealed }, ''), null);
    // A cost credential's purpose is the bare provider name: a moved row does not open
    assert.equal(await openSecretValue('deepl', sealed, MASTER), null);
    assert.equal(await openServiceCredential({ provider: 'deepl', ...sealed, key_id: 'ck1' }, MASTER), null);
  });

  it('refuses to seal without a master secret', async () => {
    await assert.rejects(sealServiceCredential('deepl', PRO, 'short'), /INTERNAL_API_KEY/);
  });
});

describe('DeepL plans', () => {
  it('":fx" keys are API Free on api-free.deepl.com, the rest API Pro', () => {
    assert.equal(deeplPlanOf(FREE), 'free');
    assert.equal(deeplApiBase(FREE), 'https://api-free.deepl.com');
    assert.equal(deeplPlanOf(PRO), 'pro');
    assert.equal(deeplApiBase(PRO), 'https://api.deepl.com');
  });

  it('estimates the month: Free costs nothing, Pro is base + per million', () => {
    assert.equal(deeplCostUsd('free', 400_000), 0);
    assert.equal(deeplCostUsd(null, 400_000), 0);
    assert.equal(deeplCostUsd('pro', 0), 5.49);
    assert.equal(deeplCostUsd('pro', 2_000_000), 55.49);
  });

  it('validates the shape without echoing it', () => {
    assert.equal(validateDeeplKey(PRO), null);
    assert.equal(validateDeeplKey(FREE), null);
    assert.equal(validateDeeplKey(42), 'not_text');
    assert.equal(validateDeeplKey('short'), 'length');
    assert.equal(validateDeeplKey(`${PRO} x`), 'spaces');
    assert.equal(validateDeeplKey(`${PRO}:zz`), 'shape');
  });

  it('maps DeepL statuses', () => {
    assert.equal(deeplCodeForStatus(200), 'ok');
    assert.equal(deeplCodeForStatus(403), 'invalid');
    assert.equal(deeplCodeForStatus(456), 'quota');
    assert.equal(deeplCodeForStatus(429), 'rate_limited');
    assert.equal(deeplCodeForStatus(503), 'unavailable');
  });
});

describe('deeplUsage (mocked DeepL)', () => {
  const fake = (status: number, body: unknown, seen: string[] = []) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${String(input)} ${new Headers(init?.headers).get('authorization')}`);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

  it('reads characters used and the limit from the right host', async () => {
    const seen: string[] = [];
    const out = await deeplUsage(FREE, fake(200, { character_count: 1234, character_limit: 500000 }, seen));
    assert.deepEqual(out, { ok: true, code: 'ok', plan: 'free', characterCount: 1234, characterLimit: 500000, status: 200 });
    assert.deepEqual(seen, [`https://api-free.deepl.com/v2/usage DeepL-Auth-Key ${FREE}`]);
  });

  it('a used-up month is a quota failure', async () => {
    const out = await deeplUsage(PRO, fake(200, { character_count: 500000, character_limit: 500000 }));
    assert.equal(out.ok, false);
    assert.equal(out.code, 'quota');
  });

  it('a refused key and an unreachable DeepL', async () => {
    assert.equal((await deeplUsage(PRO, fake(403, {}))).code, 'invalid');
    const down = (async () => {
      throw new Error('network');
    }) as typeof fetch;
    assert.equal((await deeplUsage(PRO, down)).code, 'unreachable');
  });
});

describe('resolveDeeplKey', () => {
  const db = (row: unknown) => ({
    prepare: () => ({ bind: () => ({ first: async () => row }) }),
  });

  it('prefers the admin key, then the bound secret', async () => {
    const sealed = await sealServiceCredential('deepl', PRO, MASTER);
    const row = { provider: 'deepl', ...sealed };
    assert.deepEqual(await resolveDeeplKey({ SEARCH_DB: db(row) as never, INTERNAL_API_KEY: MASTER, AI_KEY_DEEPL: 'bound-key-xxxxxxxxxxxxxxxx' }), { key: PRO, source: 'admin' });
    assert.deepEqual(await resolveDeeplKey({ SEARCH_DB: db(null) as never, INTERNAL_API_KEY: MASTER, AI_KEY_DEEPL: { get: async () => 'bound-key-xxxxxxxxxxxxxxxx' } }), { key: 'bound-key-xxxxxxxxxxxxxxxx', source: 'binding' });
    // An unreadable admin key falls back to the binding; nothing at all is null
    assert.deepEqual(await resolveDeeplKey({ SEARCH_DB: db(row) as never, INTERNAL_API_KEY: 'rotated-internal-key-000000', AI_KEY_DEEPL: 'bound-key-xxxxxxxxxxxxxxxx' }), { key: 'bound-key-xxxxxxxxxxxxxxxx', source: 'binding' });
    assert.equal(await resolveDeeplKey({ SEARCH_DB: db(null) as never, INTERNAL_API_KEY: MASTER }), null);
  });

  it('a database without the table yet reads as not set', async () => {
    const missing = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1_ERROR: no such table: service_credentials'); } }) }) };
    assert.equal(await resolveDeeplKey({ SEARCH_DB: missing as never, INTERNAL_API_KEY: MASTER }), null);
  });
});
