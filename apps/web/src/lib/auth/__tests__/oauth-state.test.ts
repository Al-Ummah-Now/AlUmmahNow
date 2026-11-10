import { newStateNonce, pkceCookieValue, pkceVerifierFor, stateCookieOptions, stateMatches, withState } from '../oauth-state';

describe('oauth state', () => {
  it('nonces are long, URL-safe and unique', () => {
    const n = newStateNonce();
    expect(n).toMatch(/^[a-f0-9]{64}$/);
    expect(newStateNonce()).not.toBe(n);
  });
  it('matches only the exact cookie value', () => {
    const n = newStateNonce();
    expect(stateMatches(n, n)).toBe(true);
    expect(stateMatches(n, `${n}0`)).toBe(false);
    expect(stateMatches(n, n.replace(/.$/, n.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(stateMatches(null, n)).toBe(false);
    expect(stateMatches(n, undefined)).toBe(false);
    expect(stateMatches('short', 'short')).toBe(false);
  });
  it('replaces the state of the authorize URL', () => {
    const url = new URL(withState('https://auth.example/authorize?client_id=c&state=old&redirect_uri=x', 'n'.repeat(32)));
    expect(url.searchParams.get('state')).toBe('n'.repeat(32));
    expect(url.searchParams.get('client_id')).toBe('c');
  });
  it('cookie: httpOnly, SameSite=Lax, 10 minutes, scoped to the callbacks', () => {
    expect(stateCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/callback', maxAge: 600 });
  });
});

describe('PKCE verifier cookie', () => {
  const nonce = 'a'.repeat(64);
  it('returns the verifier only for the state it was bound to', () => {
    const cookie = pkceCookieValue(nonce, 'verifier-1');
    expect(pkceVerifierFor(nonce, cookie)).toBe('verifier-1');
    expect(pkceVerifierFor('b'.repeat(64), cookie)).toBeUndefined();
    expect(pkceVerifierFor(nonce, undefined)).toBeUndefined();
    expect(pkceVerifierFor(null, cookie)).toBeUndefined();
    expect(pkceVerifierFor(nonce, 'no-dot')).toBeUndefined();
  });
});
