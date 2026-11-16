/**
 * The Upgrade page's mode is site-wide (shared-types UPGRADE_MODES: a payment
 * provider enabled, or "Allow tier requests"). Specs that need request mode
 * (readers) run side by side; specs that change the mode (writers: billing-pay
 * turns the test provider on, upgrade-modes flips both) run alone. The lock is
 * a row per holder in the stack's creator_tier_settings, taken with one atomic
 * INSERT … WHERE NOT EXISTS; each holder removes its own row.
 * Local stack only (the release specs that use it are local-only).
 */
import { expect, type TestInfo } from '@playwright/test';

const CONTROL = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';
const PREFIX = 'e2e_upgrade_lock:';
const WAIT_MS = 8 * 60_000;

async function sql<T = Record<string, unknown>>(statement: string): Promise<T[]> {
  const res = await fetch(`${CONTROL}/__stack/d1/al-ummah-now-search`, { method: 'POST', body: statement });
  const text = await res.text();
  expect(res.ok, `stack SQL: ${text}`).toBe(true);
  return ((JSON.parse(text) as { results?: T[] }).results ?? []) as T[];
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Takes the lock as a reader ('r': needs request mode) or a writer ('w': changes the mode); returns its release. */
export async function lockUpgradeMode(kind: 'r' | 'w', testInfo: TestInfo): Promise<() => Promise<void>> {
  testInfo.setTimeout(testInfo.timeout + WAIT_MS);
  const key = `${PREFIX}${process.env.E2E_RUN_ID ?? 'local'}:${testInfo.testId}:${testInfo.retry}`;
  const blocker = kind === 'w' ? `key LIKE ${q(`${PREFIX}%`)}` : `key LIKE ${q(`${PREFIX}%`)} AND value = 'w'`;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const got = await sql(
      `INSERT INTO creator_tier_settings (key, value, updated_by, updated_at)
       SELECT ${q(key)}, ${q(kind)}, 'e2e', ${q(new Date().toISOString())} WHERE NOT EXISTS (SELECT 1 FROM creator_tier_settings WHERE ${blocker})
       ON CONFLICT (key) DO NOTHING RETURNING key`,
    );
    if (got.length) break;
    if (Date.now() > deadline) throw new Error(`the Upgrade page mode lock (${kind}) was not free in ${WAIT_MS / 60_000} minutes`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return async () => {
    await sql(`DELETE FROM creator_tier_settings WHERE key = ${q(key)}`);
  };
}
