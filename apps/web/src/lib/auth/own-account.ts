/**
 * Session accounts are keyed by user id, and some ids reach the session
 * manager from the browser (account switcher, server actions). Looking one up
 * with a plain `accounts[userId]` would hand back Object.prototype for
 * '__proto__', and writing to that object pollutes every object in the
 * Worker (CodeQL js/prototype-polluting-assignment). Every lookup by a
 * caller-supplied id goes through ownAccount: only the map's own entries.
 */
export function isSafeAccountKey(userId: unknown): userId is string {
  return (
    typeof userId === 'string' &&
    userId.length > 0 &&
    userId !== '__proto__' &&
    userId !== 'constructor' &&
    userId !== 'prototype'
  );
}

/**
 * The account stored under `userId`, found by comparing the map's own keys,
 * never by `accounts[userId]`: no lookup can resolve to Object.prototype.
 */
export function ownAccount<T>(accounts: Record<string, T>, userId: unknown): T | null {
  if (!isSafeAccountKey(userId)) return null;
  for (const [id, account] of Object.entries(accounts)) {
    if (id === userId) return account ?? null;
  }
  return null;
}
