/**
 * Who the seed may reset a password for (and where). Pure and dependency-free so
 * scripts/qa/__tests__/seed-reset-guard.test.ts runs it under plain Node.
 *
 * When a seed account's login is refused but the account exists (its password
 * was rotated, e.g. STAGE_SEED_PASSWORD), the seed resets the password through
 * auth's forgot-password flow with a code from the auth server's E2E code sink,
 * so the account keeps its id, roles and data. That is only ever allowed for:
 *   - the QA and stage auth servers (never production, never anything else), and
 *   - the seed's own fixed accounts on the code sink domain (e2e.alummahnow.net):
 *     never an arbitrary user, never a real mailbox.
 */

export type SeedTarget = 'qa' | 'stage' | 'production' | 'unknown';

/** The code sink domain: mail to it is stored for the E2E sink, never delivered. */
export const RESET_EMAIL_DOMAIN = 'e2e.alummahnow.net';

/** Which environment an auth issuer URL belongs to. */
export function seedTargetOf(issuerUrl: string): SeedTarget {
  let host: string;
  try {
    host = new URL(issuerUrl).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
  if (host === 'auth.qa.alummahnow.net') return 'qa';
  if (host === 'auth.stage.alummahnow.net') return 'stage';
  if (host === 'auth.alummahnow.net') return 'production';
  return 'unknown';
}

/**
 * Why a password reset of `email` against `issuerUrl` is refused, or null when
 * it is allowed. `seedEmails` is the seed's own account list (SEED_ACCOUNTS).
 */
export function passwordResetRefusal(issuerUrl: string, email: string, seedEmails: readonly string[]): string | null {
  const target = seedTargetOf(issuerUrl);
  if (target !== 'qa' && target !== 'stage') return `password reset is only for the QA and stage auth servers (target: ${target})`;
  const normalized = email.trim().toLowerCase();
  if (!seedEmails.map((e) => e.trim().toLowerCase()).includes(normalized)) return 'password reset is only for the seed accounts';
  if (!normalized.endsWith(`@${RESET_EMAIL_DOMAIN}`)) return `password reset is only for seed accounts on the code sink domain (${RESET_EMAIL_DOMAIN})`;
  return null;
}
