import { randomBytes } from 'node:crypto';

/**
 * Password of the E2E test users (test-{single,multi,none,scratch}-<n>@e2e.alummahnow.net).
 *
 * It comes from the E2E_USER_PASSWORD secret, never the repo: this repo is public and
 * the pinned users live on the shared QA auth server, so a committed value let anyone
 * sign in as them. CI fails fast without it. Locally an unset value is random per
 * process, which works for the fresh users a local run registers (not for reusing
 * E2E_REUSE_TIMESTAMP users across runs; export E2E_USER_PASSWORD for that).
 * Type it with fillSecret() (release/secret-fill.ts), never locator.fill().
 */
let cached: string | undefined;
export function e2eUserPassword(): string {
  if (cached) return cached;
  const value = process.env.E2E_USER_PASSWORD;
  if (value) return (cached = value);
  if (process.env.CI) throw new Error('E2E_USER_PASSWORD is not set: pass the E2E_USER_PASSWORD secret to this E2E step');
  return (cached = `Aa1!${randomBytes(12).toString('base64url')}`);
}
