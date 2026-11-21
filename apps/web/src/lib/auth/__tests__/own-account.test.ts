/**
 * Session accounts are looked up by caller-supplied user ids: only the map's
 * own entries count, so '__proto__' can't return (and let callers write to)
 * Object.prototype (CodeQL js/prototype-polluting-assignment).
 */
import { isSafeAccountKey, ownAccount } from '../own-account';

describe('ownAccount', () => {
  const accounts: Record<string, { userId: string }> = { u1: { userId: 'u1' } };

  it('returns an account the session holds', () => {
    expect(ownAccount(accounts, 'u1')).toEqual({ userId: 'u1' });
  });

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'missing', ''])(
    'returns null for %p',
    (key) => {
      expect(ownAccount(accounts, key)).toBeNull();
    },
  );

  it('returns null for a non-string id', () => {
    expect(ownAccount(accounts, undefined)).toBeNull();
    expect(ownAccount(accounts, 1)).toBeNull();
  });

  it('refuses keys that name the prototype chain', () => {
    expect(isSafeAccountKey('user-123')).toBe(true);
    for (const key of ['__proto__', 'constructor', 'prototype', '']) expect(isSafeAccountKey(key)).toBe(false);
  });

  it('never resolves through the prototype, even when a cookie carries a __proto__ key', () => {
    const parsed = JSON.parse('{"__proto__":{"userId":"evil"},"u1":{"userId":"u1"}}') as Record<string, { userId: string }>;
    expect(ownAccount(parsed, '__proto__')).toBeNull();
    expect(ownAccount(parsed, 'u1')).toEqual({ userId: 'u1' });
    expect(ownAccount({} as Record<string, unknown>, 'toString')).toBeNull();
  });
});
