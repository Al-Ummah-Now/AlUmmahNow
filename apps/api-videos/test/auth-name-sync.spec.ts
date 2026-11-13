/**
 * Names saved in videos reach Auth (lib/auth-name-sync.ts): production 2026-11-13, the owner's
 * profile had first + last but Auth had no name, so every Auth-backed menu showed the email.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authNamePayload, bearerOf, namesChanged, syncNamesToAuth } from '../src/lib/auth-name-sync';

function recorder(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('auth name sync', () => {
  it('sends first + last with the user token to the issuer, empty display name as null', async () => {
    const { calls, fetcher } = recorder();
    const ok = await syncNamesToAuth('https://auth.example/', 'tok', { displayName: '', firstName: 'Mahmoud', lastName: 'Darwish' }, { fetcher });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://auth.example/account/name');
    assert.equal(calls[0].init.method, 'PUT');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
    assert.partialDeepStrictEqual(JSON.parse(calls[0].init.body as string), { displayName: null, firstName: 'Mahmoud', lastName: 'Darwish' });
  });

  it('a new profile sends only the names that are set, and nothing when none is', async () => {
    const { calls, fetcher } = recorder();
    await syncNamesToAuth('https://auth.example', 'tok', { firstName: 'Amina', firstNameLocalized: { ar: 'أمينة', en: ' ' } }, { clear: false, fetcher });
    assert.deepEqual(JSON.parse(calls[0].init.body as string), { firstName: 'Amina', firstNameLocalized: { ar: 'أمينة' } });
    assert.equal(await syncNamesToAuth('https://auth.example', 'tok', { displayName: '' }, { clear: false, fetcher }), false);
    assert.equal(calls.length, 1);
  });

  it('needs an issuer and a token; an Auth error is reported, not thrown', async () => {
    const { calls, fetcher } = recorder(500);
    assert.equal(await syncNamesToAuth(undefined, 'tok', { firstName: 'A' }, { fetcher }), false);
    assert.equal(await syncNamesToAuth('https://auth.example', null, { firstName: 'A' }, { fetcher }), false);
    assert.equal(calls.length, 0);
    assert.equal(await syncNamesToAuth('https://auth.example', 'tok', { firstName: 'A' }, { fetcher }), false);
  });

  it('detects name changes only', () => {
    assert.equal(namesChanged({ firstName: 'A' }, { firstName: 'A', bio: 'x' } as never), false);
    assert.equal(namesChanged({ firstName: 'A' }, { firstName: 'B' }), true);
    assert.equal(namesChanged(null, { lastName: 'Darwish' }), true);
    assert.equal(namesChanged({ displayName: '' }, { displayName: '  ' }), false);
  });

  it('reads the bearer token', () => {
    assert.equal(bearerOf('Bearer abc'), 'abc');
    assert.equal(bearerOf('Basic abc'), null);
    assert.equal(bearerOf(undefined), null);
    assert.equal(authNamePayload({}).displayName, null);
  });
});
