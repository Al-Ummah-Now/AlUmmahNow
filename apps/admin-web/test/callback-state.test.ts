import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { handleCallback, type CallbackClient } from '../src/lib/callback-handler';
import { encodeState, newStateNonce, pkceCookieValue, pkceVerifierFor, sameOriginRedirect, stateMatches } from '../src/lib/login-flow';

const APP = 'https://admin.qa.alummahnow.net';
const silent = { info: () => {}, warn: () => {}, error: () => {} };

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
const ACCESS = `${b64url({ alg: 'ES256' })}.${b64url({ exp: 9_999_999_999 })}.sig`;

function client(roles: string[] = ['admin']) {
  const calls: string[] = [];
  const impl: CallbackClient = {
    async exchange(code, _redirectUri, verifier) {
      calls.push(`exchange:${code}${verifier ? `:${verifier}` : ''}`);
      return { err: false, tokens: { access: ACCESS, refresh: 'user:r1' } };
    },
    async verify() {
      calls.push('verify');
      return { subject: { properties: { id: 'u1', email: 'admin@example.com', roles } } };
    },
  };
  return { impl, calls };
}

function request(query: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
  return new NextRequest(`${APP}/api/callback?${query}`, {
    headers: { host: 'admin.qa.alummahnow.net', ...(cookie ? { cookie } : {}) },
  });
}

function setCookies(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = header;
  }
  return out;
}

const NONCE = 'a'.repeat(32);
const STATE = encodeState(NONCE, '/moderation');

describe('admin callback: OAuth state bound to the browser', () => {
  const refusals: Array<[string, string, Record<string, string>]> = [
    ['missing state', 'code=c1', { admin_oauth_state: NONCE }],
    ['missing cookie', `code=c1&state=${encodeURIComponent(STATE)}`, {}],
    ['mismatched nonce', `code=c1&state=${encodeURIComponent(encodeState('b'.repeat(32), '/'))}`, { admin_oauth_state: NONCE }],
    ['malformed state', 'code=c1&state=x', { admin_oauth_state: 'x' }],
    ['forged error callback', `error=login_required`, { admin_oauth_state: NONCE }],
  ];
  for (const [name, query, cookies] of refusals) {
    it(`refuses a ${name}: no code exchange, no session cookie set or deleted, state cookie cleared`, async () => {
      const { impl, calls } = client();
      const res = await handleCallback(request(query, { ...cookies, admin_session: '{"keep":1}' }), {
        getClient: async () => impl,
        subjects: {},
        log: silent,
      });
      assert.deepEqual(calls, []);
      assert.equal(res.headers.get('location'), `${APP}/login?error=auth_failed`);
      const set = setCookies(res);
      assert.deepEqual(Object.keys(set).sort(), ['admin_oauth_pkce', 'admin_oauth_state']);
      assert.match(set.admin_oauth_state, /Max-Age=0/i);
      assert.match(set.admin_oauth_pkce, /Max-Age=0/i);
      assert.match(set.admin_oauth_state, /Path=\/api\/callback/i);
    });
  }

  it('a matching state proceeds: exchanges, sets the session, returns to the page, clears the state cookie', async () => {
    const { impl, calls } = client();
    const res = await handleCallback(request(`code=c1&state=${encodeURIComponent(STATE)}`, { admin_oauth_state: NONCE }), {
      getClient: async () => impl,
      subjects: {},
      log: silent,
    });
    assert.deepEqual(calls, ['exchange:c1', 'verify']);
    assert.equal(res.headers.get('location'), `${APP}/moderation`);
    const set = setCookies(res);
    assert.match(set.admin_oauth_state, /Max-Age=0/i);
    const session = JSON.parse(decodeURIComponent(set.admin_session.split(';')[0].slice('admin_session='.length)));
    assert.equal(session.refreshToken, 'user:r1');
    assert.match(set.admin_session, /HttpOnly/i);
  });

  it('PKCE: exchanges with the verifier bound to this state, never one of another state', async () => {
    const ok = client();
    await handleCallback(
      request(`code=c1&state=${encodeURIComponent(STATE)}`, { admin_oauth_state: NONCE, admin_oauth_pkce: pkceCookieValue(NONCE, 'ver-1') }),
      { getClient: async () => ok.impl, subjects: {}, log: silent },
    );
    assert.deepEqual(ok.calls, ['exchange:c1:ver-1', 'verify']);
    const other = client();
    await handleCallback(
      request(`code=c1&state=${encodeURIComponent(STATE)}`, { admin_oauth_state: NONCE, admin_oauth_pkce: pkceCookieValue('b'.repeat(32), 'ver-x') }),
      { getClient: async () => other.impl, subjects: {}, log: silent },
    );
    assert.deepEqual(other.calls, ['exchange:c1', 'verify']);
    assert.equal(pkceVerifierFor(STATE, pkceCookieValue(NONCE, 'v')), 'v');
    assert.equal(pkceVerifierFor(STATE, 'no-dot'), undefined);
  });

  it('a matching state with login_required shows the sign-in form, without an exchange', async () => {
    const { impl, calls } = client();
    const res = await handleCallback(request(`error=login_required&state=${encodeURIComponent(STATE)}`, { admin_oauth_state: NONCE }), {
      getClient: async () => impl,
      subjects: {},
      log: silent,
    });
    assert.deepEqual(calls, []);
    assert.equal(res.headers.get('location'), `${APP}/login?return=%2Fmoderation`);
  });

  it('a user without an admin role: access denied, previous admin session dropped', async () => {
    const { impl } = client([]);
    const res = await handleCallback(request(`code=c1&state=${encodeURIComponent(STATE)}`, { admin_oauth_state: NONCE }), {
      getClient: async () => impl,
      subjects: {},
      log: silent,
    });
    assert.equal(res.headers.get('location'), `${APP}/access-denied`);
    assert.match(setCookies(res).admin_session, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('nonces are unguessable and compared exactly', () => {
    const n = newStateNonce();
    assert.ok(n.length >= 32 && /^[A-Za-z0-9_-]+$/.test(n), n);
    assert.notEqual(n, newStateNonce());
    assert.equal(stateMatches(encodeState(n, '/'), n), true);
    assert.equal(stateMatches(encodeState(n, '/'), `${n}x`), false);
    assert.equal(stateMatches(null, n), false);
    assert.equal(stateMatches(encodeState(n, '/'), undefined), false);
  });
});

describe('sameOriginRedirect', () => {
  it('keeps same-origin paths and falls back to / for anything else', () => {
    assert.equal(sameOriginRedirect('/moderation?x=1', `${APP}/api/callback`).toString(), `${APP}/moderation?x=1`);
    for (const bad of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '\\\\evil.example']) {
      assert.equal(sameOriginRedirect(bad, `${APP}/api/callback`).toString(), `${APP}/`, bad);
    }
  });
});
