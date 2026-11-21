/**
 * Session accounts are keyed by user id, and some ids reach the session
 * manager from the browser (account switcher, server actions). Looking one up
 * with a plain `accounts[userId]` would hand back Object.prototype for
 * '__proto__', and writing to that object pollutes every object in the
 * Worker (CodeQL js/prototype-polluting-assignment). Every lookup by a
 * caller-supplied id goes through ownAccount: only the map's own entries.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeAccountKey(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.length > 0 && !UNSAFE_KEYS.has(userId);
}

export function ownAccount<T>(accounts: Record<string, T>, userId: unknown): T | null {
  if (!isSafeAccountKey(userId) || !Object.prototype.hasOwnProperty.call(accounts, userId)) return null;
  return accounts[userId] ?? null;
}
