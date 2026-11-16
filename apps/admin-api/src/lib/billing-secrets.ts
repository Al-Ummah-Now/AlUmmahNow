/**
 * Payment provider credentials in Cloudflare Secrets Store (wiki AUN-SUBS).
 *
 * The admin types an API key or webhook secret on the Payments page; admin-api
 * writes it to the account's Secrets Store with the Cloudflare API and never
 * stores, logs or returns it. api-videos reads it through a Secrets Store
 * binding (PAY_<PROVIDER>_<FIELD>_<MODE>, docs/features/payments.md), so the
 * value only ever exists in the store and in the Worker that uses it.
 *
 * Needs PAYMENTS_SECRETS_TOKEN (a Cloudflare API token with Account Secrets
 * Store Edit, itself a Secrets Store binding) and PAYMENTS_SECRETS_STORE_ID.
 * Without them the page shows that credentials cannot be saved here.
 *
 * Clearing writes the value "unset" instead of deleting the secret: a Worker
 * whose binding names a deleted secret fails to deploy, and api-videos reads
 * "unset" as no credential.
 *
 * Local stack only (PAYMENTS_SECRETS_LOCAL_SHIM=1, set by scripts/local-stack/
 * stack.ts and refused by `pnpm check:config` in every deployed config): there is
 * no Secrets Store to write to, so a save is accepted and the value dropped on
 * the floor — the page records that a key is present (and its last 4) exactly
 * as it would after a real write. Nothing on the stack can charge with it: the
 * stack takes payments with the test provider only.
 */
import { paymentSecretName, type PaymentCredentialField, type PaymentMode, type PaymentProviderId } from '@al-ummah/shared-types';
import { logger } from './logger';

type SecretBinding = string | { get(): Promise<string> } | undefined;

export interface BillingSecretsEnv {
  ENVIRONMENT?: string;
  /** '1' on the local stack only: saves are accepted without a Secrets Store (see the header) */
  PAYMENTS_SECRETS_LOCAL_SHIM?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  PAYMENTS_SECRETS_STORE_ID?: string;
  PAYMENTS_SECRETS_TOKEN?: SecretBinding;
}

export const UNSET_VALUE = 'unset';
const API = 'https://api.cloudflare.com/client/v4';

export class SecretsStoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function token(env: BillingSecretsEnv): Promise<string> {
  const b = env.PAYMENTS_SECRETS_TOKEN;
  try {
    return ((typeof b === 'string' ? b : await b?.get()) ?? '').trim();
  } catch {
    return '';
  }
}

/** Credentials can be saved from the Payments page (the token and store are configured). */
const localShim = (env: BillingSecretsEnv) => env.PAYMENTS_SECRETS_LOCAL_SHIM === '1';

export async function credentialStorageReady(env: BillingSecretsEnv): Promise<boolean> {
  if (localShim(env)) return true;
  return !!(env.CLOUDFLARE_ACCOUNT_ID && env.PAYMENTS_SECRETS_STORE_ID && (await token(env)));
}

interface CfEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: { code?: number; message?: string }[];
}

async function cf<T>(env: BillingSecretsEnv, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const t = await token(env);
  if (!t || !env.CLOUDFLARE_ACCOUNT_ID || !env.PAYMENTS_SECRETS_STORE_ID) {
    throw new SecretsStoreError(409, 'credential_storage_unavailable', 'Credentials cannot be saved here yet: the Secrets Store token is not configured');
  }
  const url = `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/secrets_store/stores/${env.PAYMENTS_SECRETS_STORE_ID}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
  } catch (error) {
    throw new SecretsStoreError(502, 'secrets_store_unreachable', `Secrets Store did not answer: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await res.json().catch(() => ({}))) as CfEnvelope<T>;
  if (!res.ok || body.success === false) {
    // Cloudflare's error text names the problem (permission, bad name); it never echoes the value
    const reason = body.errors?.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${res.status}`;
    throw new SecretsStoreError(res.status === 403 || res.status === 401 ? 409 : 502, 'secrets_store_refused', `Secrets Store refused the change: ${reason}`);
  }
  return body.result as T;
}

/** Writes (or clears) one credential; returns the secret's name. The value is never logged. */
export async function writeCredential(
  env: BillingSecretsEnv,
  input: { provider: PaymentProviderId; field: PaymentCredentialField; mode: PaymentMode; value: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ name: string; created: boolean }> {
  const name = paymentSecretName(input.provider, input.field, input.mode, env.ENVIRONMENT);
  if (localShim(env)) {
    logger.debug('[Billing] Local stack: credential accepted without a Secrets Store (value not kept)', { name, cleared: input.value === null });
    return { name, created: false };
  }
  const value = input.value === null ? UNSET_VALUE : input.value;
  const found = await cf<{ id: string; name: string }[]>(env, `/secrets?search=${encodeURIComponent(name)}&per_page=50`, { method: 'GET' }, fetchImpl);
  const existing = (found ?? []).find((s) => s.name === name);
  if (existing) {
    await cf(env, `/secrets/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify({ value }) }, fetchImpl);
    logger.info('[Billing] Credential updated in Secrets Store', { name, cleared: input.value === null });
    return { name, created: false };
  }
  if (input.value === null) return { name, created: false };
  await cf(env, '/secrets', { method: 'POST', body: JSON.stringify([{ name, value, scopes: ['workers'], comment: 'Payments credential, written from the videos admin (wiki AUN-SUBS)' }]) }, fetchImpl);
  logger.info('[Billing] Credential created in Secrets Store', { name });
  return { name, created: true };
}
