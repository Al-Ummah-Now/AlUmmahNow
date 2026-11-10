/**
 * Client probe: a visitor already signed in on another app (CMS, profile) is
 * signed in here silently (prompt=none); anonymous visitors and crawlers are
 * never bounced through the auth server, and a failed attempt never loops or
 * shows an error page.
 */
import {
  callbackErrorDestination,
  isProbeExcludedPath,
  loginRoutePath,
  parsePrompt,
  probeOutcome,
  safeReturnPath,
  shouldProbe,
  sameOriginUrl,
  successDestination,
} from '../silent-sign-in';

const AUTH = 'https://auth.qa.alummahnow.net';

describe('shouldProbe', () => {
  const base = { hasAppSession: false, flagSet: false, pathname: '/en/video/abc', authOrigin: AUTH };
  it('probes once per tab for a visitor without a session here', () => {
    expect(shouldProbe(base)).toBe(true);
  });
  it('never when already signed in here, already probed in this tab (loop guard), or without an auth URL', () => {
    expect(shouldProbe({ ...base, hasAppSession: true })).toBe(false);
    expect(shouldProbe({ ...base, flagSet: true })).toBe(false);
    expect(shouldProbe({ ...base, authOrigin: '' })).toBe(false);
  });
  it('never on the auth error page, embeds or API routes', () => {
    for (const p of ['/en/auth/error', '/ar/auth/error', '/embed/v/1', '/api/callback']) {
      expect(isProbeExcludedPath(p)).toBe(true);
      expect(shouldProbe({ ...base, pathname: p })).toBe(false);
    }
    expect(isProbeExcludedPath('/en')).toBe(false);
  });
});

describe('probeOutcome', () => {
  it('signs in only when the auth server has an active account', () => {
    expect(probeOutcome([{ userId: 'a', email: 'a@x', isActive: true }])).toBe('sign-in');
  });
  it('stays anonymous on 401 ([]), no active account, or no answer (CORS/network)', () => {
    expect(probeOutcome([])).toBe('stay-anonymous');
    expect(probeOutcome([{ userId: 'a', email: 'a@x', isActive: false }])).toBe('stay-anonymous');
    expect(probeOutcome(null)).toBe('stay-anonymous');
  });
});

describe('loginRoutePath', () => {
  it('starts a silent sign-in that comes back to the page', () => {
    const url = new URL(loginRoutePath('/ar/video/x?t=3', 'ar', 'none'), 'https://videos.example');
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('locale')).toBe('ar');
    expect(url.searchParams.get('return')).toBe('/ar/video/x?t=3');
  });
  it('without a prompt is a plain sign-in that comes back to the page', () => {
    const url = new URL(loginRoutePath('/en/video/x', 'en'), 'https://videos.example');
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.get('return')).toBe('/en/video/x');
  });
  it('drops an unsafe return path', () => {
    const url = new URL(loginRoutePath('//evil.example', 'en', 'none'), 'https://videos.example');
    expect(url.searchParams.get('return')).toBeNull();
  });
  it('accepts only none and login as prompts', () => {
    expect(parsePrompt('none')).toBe('none');
    expect(parsePrompt('login')).toBe('login');
    expect(parsePrompt('select_account')).toBeUndefined();
    expect(parsePrompt(null)).toBeUndefined();
  });
});

describe('safeReturnPath', () => {
  it('keeps same-origin pages and drops session_updated', () => {
    expect(safeReturnPath('/en/watch?v=1&session_updated=true')).toBe('/en/watch?v=1');
  });
  it.each([
    '//evil',
    '//evil.example',
    '/\\evil',
    '/\\/evil.com',
    '/.//evil.com',
    '/%2e//evil.com',
    '/%2E%2E//evil.com',
    '/%2f/evil.com',
    '/%5Cevil',
    '/%5c%5cevil.com',
    'https://evil',
    'https://evil.example',
    '/\t/evil',
    '/\t//evil.com',
    '/%09/evil',
    '/%0a/evil',
    '/%0D%0ALocation:%20https://evil',
    '/\n//evil.com',
    '/api/callback',
    'en',
    '',
  ])('rejects hostile input %j (including ones that only normalise off-site)', (bad) => {
    expect(safeReturnPath(bad)).toBeNull();
  });
  it('rejects null', () => {
    expect(safeReturnPath(null)).toBeNull();
  });
  it('whatever it returns stays on this origin', () => {
    for (const input of ['/a/../..//evil.com', '/./evil', '/a/./b']) {
      const out = safeReturnPath(input);
      if (out !== null) {
        expect(out.startsWith('//')).toBe(false);
        expect(new URL(out, 'https://videos.example').origin).toBe('https://videos.example');
      }
    }
  });
  it('keeps normal paths with queries, including encoded query values', () => {
    expect(safeReturnPath('/en/search?q=a%2Fb&page=2')).toBe('/en/search?q=a%2Fb&page=2');
    expect(safeReturnPath('/ar/video/x?t=3')).toBe('/ar/video/x?t=3');
  });
  it('sameOriginUrl falls back to the origin root for anything off-site', () => {
    expect(sameOriginUrl('/en/x?y=1', 'https://videos.example')).toBe('https://videos.example/en/x?y=1');
    for (const bad of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
      expect(sameOriginUrl(bad, 'https://videos.example')).toBe('https://videos.example/');
    }
  });
});

describe('callback destinations', () => {
  it('a failed silent attempt (login_required or anything else) goes back to the page, anonymous, no error page', () => {
    expect(callbackErrorDestination({ error: 'login_required', silent: true, returnPath: '/en/video/x', locale: 'en' })).toBe('/en/video/x');
    expect(callbackErrorDestination({ error: 'server_error', silent: true, returnPath: '/ar', locale: 'ar' })).toBe('/ar');
    expect(callbackErrorDestination({ error: null, silent: true, returnPath: null, locale: 'ar' })).toBe('/ar');
  });
  it('login_required without the silent cookie is not an error page either', () => {
    expect(callbackErrorDestination({ error: 'login_required', silent: false, returnPath: null, locale: 'en' })).toBe('/en');
  });
  it('an interactive sign-in error still shows the auth error page', () => {
    expect(callbackErrorDestination({ error: 'access_denied', silent: false, returnPath: '/en/x', locale: 'en' })).toBe('/en/auth/error');
  });
  it('success returns to the page with session_updated', () => {
    expect(successDestination('/en/video/x?t=3', 'en')).toBe('/en/video/x?t=3&session_updated=true');
    expect(successDestination(null, 'ar')).toBe('/ar?session_updated=true');
    expect(successDestination('https://evil.example', 'en')).toBe('/en?session_updated=true');
  });
});

describe('returnPathFromReferer (the header "Sign in" comes back to the page it started from)', () => {
  const { returnPathFromReferer } = jest.requireActual('../silent-sign-in') as typeof import('../silent-sign-in');
  const ORIGIN = 'https://videos.qa.alummahnow.net';

  it('returns the page path and query of a same-origin Referer', () => {
    expect(returnPathFromReferer(`${ORIGIN}/ar/library?tab=saved`, ORIGIN)).toBe('/ar/library?tab=saved');
    expect(returnPathFromReferer(`${ORIGIN}/en/dashboard/videos`, ORIGIN)).toBe('/en/dashboard/videos');
  });

  it('ignores another origin, API routes, hostile paths and a missing Referer', () => {
    expect(returnPathFromReferer('https://evil.example/en/library', ORIGIN)).toBeNull();
    expect(returnPathFromReferer(`${ORIGIN}/api/auth/login`, ORIGIN)).toBeNull();
    expect(returnPathFromReferer(`${ORIGIN}/%2F%2Fevil.example`, ORIGIN)).toBeNull();
    expect(returnPathFromReferer(null, ORIGIN)).toBeNull();
    expect(returnPathFromReferer('not a url', ORIGIN)).toBeNull();
  });
});
