/**
 * Credentials the super admin set on the videos admin Costs page (cost_credentials, sealed with
 * packages/shared-types cost-credentials.ts). The collector opens them in memory when a job runs;
 * they are never logged or stored anywhere else.
 *
 * Cloudflare: the admin's read-only token wins; until one is set, the deployment's own
 * CF_ANALYTICS_TOKEN binding (the release token's copy) keeps the data flowing. With neither, the
 * jobs skip quietly and the Costs page says "set a token" (COST-1: works with no token).
 */
import { openCostCredential, type CostCredentialRow, type CostProvider } from '@al-ummah/shared-types';
import { logger } from './logger';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface CredentialEnv {
  COSTS_DB: D1Database;
  INTERNAL_API_KEY?: SecretBinding;
  COST_CREDENTIALS_KEY?: SecretBinding;
  CF_ANALYTICS_TOKEN?: SecretBinding;
}

export async function secretValue(binding: SecretBinding): Promise<string> {
  if (typeof binding === 'string') return binding;
  try {
    return (await binding?.get()) ?? '';
  } catch {
    return '';
  }
}

/** The stored value for a provider, or null (not set, table not migrated yet, or unreadable). */
export async function storedCredential(env: CredentialEnv, provider: CostProvider): Promise<string | null> {
  let row: CostCredentialRow | null = null;
  try {
    row = await env.COSTS_DB.prepare('SELECT * FROM cost_credentials WHERE provider = ?').bind(provider).first<CostCredentialRow>();
  } catch (error) {
    if (!/no such table/i.test(String((error as Error)?.message))) throw error;
    return null;
  }
  if (!row) return null;
  const value = await openCostCredential(row, {
    INTERNAL_API_KEY: await secretValue(env.INTERNAL_API_KEY),
    COST_CREDENTIALS_KEY: await secretValue(env.COST_CREDENTIALS_KEY),
  });
  if (value === null) logger.warn('[ops] Stored credential cannot be opened; it has to be set again', { provider });
  return value;
}

export type TokenSource = 'admin' | 'release' | 'none';

export async function cloudflareToken(env: CredentialEnv): Promise<{ token: string; source: TokenSource }> {
  const stored = await storedCredential(env, 'cloudflare');
  if (stored) return { token: stored, source: 'admin' };
  const bound = await secretValue(env.CF_ANALYTICS_TOKEN);
  if (bound) return { token: bound, source: 'release' };
  return { token: '', source: 'none' };
}

/** What the Costs page shows about the collector (cost_settings 'collector'). Best effort. */
export async function recordCollectorState(db: D1Database, state: { tokenSource: TokenSource; job: string; status: string }, now: Date): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO cost_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind('collector', JSON.stringify({ ...state, at: now.toISOString() }), now.toISOString())
      .run();
  } catch (error) {
    logger.debug('[ops] Collector state not recorded', { error: String(error) });
  }
}
