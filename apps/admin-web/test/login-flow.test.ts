import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  callbackErrorRedirect,
  encodeState,
  loginDecision,
  loginPath,
  parsePrompt,
  returnPathFromState,
  safeReturnPath,
  withLoginParams,
} from '../src/lib/login-flow';
import { parseAccounts, fetchAuthAccounts, signOutOneDecision, switchAuthAccount, removeAuthAccount } from '../src/lib/auth-accounts';

const AUTHORIZE =
  'https://auth.qa.alummahnow.net/authorize?client_id=c&redirect_uri=https%3A%2F%2Fadmin.qa.alummahnow.net%2Fapi%2Fcallback&response_type=code&state=abc';

describe('safeReturnPath', () => {
  it('keeps same-origin paths with their query', () => {
    assert.equal(safeReturnPath('/moderation/ai?status=pending'), '/moderation/ai?status=pending');
    assert.equal(safeReturnPath('/'), '/');
  });
  it('rejects hostile inputs, including ones that only normalise off-site (no open redirect)', () => {
    const hostile = [
      '//evil',
      '//evil.example/x',
      '/\\evil',
      '/\\/evil.com',
      '/.//evil.com',
      '/%2e//evil.com',
      '/%2E%2E//evil.com',
      '/%2f/evil.com',
      '/%5Cevil',
      '/%5c%5cevil.com',
      'https://evil',
      'https://evil.example/',
      '/\t/evil',
      '/\t//evil.com',
      '/%09/evil',
      '/%0a/evil',
      '/%0D%0ALocation:%20https://evil',
      '/\n//evil.com',
      '/x\u0000',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ];
    for (const bad of hostile) {
      const out = safeReturnPath(bad as string);
      assert.equal(out, null, `${JSON.stringify(bad)} -> ${out}`);
    }
  });
  it('whatever it returns stays on this origin', () => {
    for (const input of ['/a/../..//evil.com', '/./evil', '/a/./b', '/%7E/x']) {
      const out = safeReturnPath(input);
      if (out !== null) {
        assert.ok(!out.startsWith('//'), out);
        assert.equal(new URL(out, 'https://admin.example').origin, 'https://admin.example', out);
      }
    }
  });
  it('keeps normal paths with queries, including encoded query values', () => {
    assert.equal(safeReturnPath('/moderation/reports/r1?tab=ai&next=%2Fx'), '/moderation/reports/r1?tab=ai&next=%2Fx');
    assert.equal(safeReturnPath('/indices?q=a%20b'), '/indices?q=a%20b');
  });
  it('rejects the sign-in routes themselves (no loop)', () => {
    for (const loop of ['/login', '/login?prompt=none', '/api/callback?code=x', '/access-denied']) {
      assert.equal(safeReturnPath(loop), null, loop);
    }
  });
});

describe('loginPath', () => {
  it('builds /login with the return path and prompt', () => {
    assert.equal(loginPath('/dashboard'), '/login?return=%2Fdashboard');
    assert.equal(loginPath('/x?y=1', 'none'), '/login?return=%2Fx%3Fy%3D1&prompt=none');
    assert.equal(loginPath('/', 'login'), '/login?prompt=login');
    assert.equal(loginPath(null), '/login');
    assert.equal(loginPath('https://evil.example'), '/login');
  });
});

describe('loginDecision (/login)', () => {
  it('signed in, no prompt: carry on to the return path (or the dashboard)', () => {
    assert.deepEqual(loginDecision({ authenticated: true, returnTo: '/indices' }), { kind: 'continue', to: '/indices' });
    assert.deepEqual(loginDecision({ authenticated: true }), { kind: 'continue', to: '/dashboard' });
    assert.deepEqual(loginDecision({ authenticated: true, returnTo: '/' }), { kind: 'continue', to: '/dashboard' });
  });
  it('not signed in: authorize with NO prompt (the auth server signs an active account in silently)', () => {
    assert.deepEqual(loginDecision({ authenticated: false, returnTo: '/moderation' }), {
      kind: 'authorize',
      prompt: undefined,
      returnTo: '/moderation',
    });
  });
  it('an account change (prompt) always goes to the auth server, even when signed in', () => {
    assert.equal(loginDecision({ authenticated: true, prompt: 'none' }).kind, 'authorize');
    assert.equal(loginDecision({ authenticated: true, prompt: 'login' }).kind, 'authorize');
  });
  it('only none and login are accepted as prompts (never select_account on the normal path)', () => {
    assert.equal(parsePrompt('none'), 'none');
    assert.equal(parsePrompt('login'), 'login');
    assert.equal(parsePrompt('select_account'), undefined);
    assert.equal(parsePrompt(undefined), undefined);
  });
});

describe('authorize URL and state', () => {
  it('adds no prompt on the normal path and puts the nonce and return path in state', () => {
    const url = new URL(withLoginParams(AUTHORIZE, undefined, '/translations?lang=ar', 'n'.repeat(32)));
    assert.equal(url.searchParams.get('prompt'), null);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://admin.qa.alummahnow.net/api/callback');
    const state = url.searchParams.get('state')!;
    assert.ok(state.startsWith(`${'n'.repeat(32)}.`), state);
    assert.equal(returnPathFromState(state), '/translations?lang=ar');
  });
  it('adds prompt=none / prompt=login when asked', () => {
    assert.equal(new URL(withLoginParams(AUTHORIZE, 'none', '/', 'n'.repeat(32))).searchParams.get('prompt'), 'none');
    assert.equal(new URL(withLoginParams(AUTHORIZE, 'login', '/', 'n'.repeat(32))).searchParams.get('prompt'), 'login');
  });
  it('falls back to the dashboard for a missing, malformed or forged state', () => {
    assert.equal(returnPathFromState(null), '/dashboard');
    assert.equal(returnPathFromState('no-dot'), '/dashboard');
    assert.equal(returnPathFromState('x.!!!'), '/dashboard');
    const forged = `x.${Buffer.from('https://evil.example/').toString('base64url')}`;
    assert.equal(returnPathFromState(forged), '/dashboard');
    assert.equal(returnPathFromState(encodeState('n', '/')), '/dashboard');
  });
  it('round-trips non-ASCII paths', () => {
    assert.equal(returnPathFromState(encodeState('n', '/indices?q=مرحبا')), '/indices?q=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
  });
});

describe('callback errors', () => {
  it('a failed silent sign-in shows the sign-in form (plain /login), not an error page', () => {
    const state = encodeState('n', '/moderation');
    assert.equal(callbackErrorRedirect('login_required', state), '/login?return=%2Fmoderation');
    assert.equal(callbackErrorRedirect('interaction_required', null), '/login?return=%2Fdashboard');
  });
  it('other errors go to the error view', () => {
    assert.equal(callbackErrorRedirect('access_denied', null), '/login?error=auth_failed');
    assert.equal(callbackErrorRedirect('server_error', null), '/login?error=auth_failed');
  });
});

describe('account menu (auth server accounts)', () => {
  const ISSUER = 'https://auth.qa.alummahnow.net';

  it('parses the accounts list and drops malformed rows', () => {
    assert.deepEqual(
      parseAccounts({
        accounts: [
          { userId: 'a', email: 'a@x', name: 'A', isActive: true, lastUsed: 1 },
          { userId: 'b', email: 'b@x', isActive: false },
          { email: 'no-id@x' },
          null,
        ],
      }),
      [
        { userId: 'a', email: 'a@x', name: 'A', isActive: true },
        { userId: 'b', email: 'b@x', name: undefined, isActive: false },
      ],
    );
    assert.deepEqual(parseAccounts({}), []);
  });

  it('asks the auth server with credentials; 401 means no accounts, a network/CORS failure means unknown', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const ok = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ accounts: [{ userId: 'a', email: 'a@x', isActive: true }] }), { status: 200 });
    }) as typeof fetch;
    assert.equal((await fetchAuthAccounts(ISSUER, ok))?.length, 1);
    assert.equal(seen[0].url, `${ISSUER}/session/accounts`);
    assert.equal(seen[0].init?.credentials, 'include');

    const unauthorized = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    assert.deepEqual(await fetchAuthAccounts(ISSUER, unauthorized), []);
    const blocked = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    assert.equal(await fetchAuthAccounts(ISSUER, blocked), null);
  });

  it('switch POSTs the user id; sign-out-of-one DELETEs it', async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      return new Response('{"success":true}', { status: 200 });
    }) as typeof fetch;
    assert.equal(await switchAuthAccount(ISSUER, 'u/1', impl), true);
    assert.equal(await removeAuthAccount(ISSUER, 'u/1', impl), true);
    assert.deepEqual(seen, [
      { url: `${ISSUER}/session/switch`, method: 'POST', body: '{"userId":"u/1"}' },
      { url: `${ISSUER}/session/accounts/u%2F1`, method: 'DELETE', body: undefined },
    ]);
  });

  it('signing out of one account keeps the others; the last one out is single sign-out', () => {
    const two = [
      { userId: 'a', email: 'a@x', isActive: true },
      { userId: 'b', email: 'b@x', isActive: false },
    ];
    assert.equal(signOutOneDecision(two, 'a'), 'remove-and-reauth');
    assert.equal(signOutOneDecision([two[0]], 'a'), 'single-sign-out');
    assert.equal(signOutOneDecision(null, 'a'), 'single-sign-out');
  });
});
