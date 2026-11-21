/**
 * Service keys a super admin sets in the videos admin, sealed at rest (AUN-CAPTIONS DEEPL-KEY).
 * Today: the DeepL API key on Caption settings.
 *
 * Same scheme as the Costs page's Connections (cost-credentials.ts, which reuses these helpers):
 *
 * - admin-api seals the key with AES-256-GCM (random 12-byte IV, the purpose as additional data so
 *   a ciphertext cannot be moved to another row or table) and stores it in SEARCH_DB
 *   `service_credentials`. The AES key is HKDF-SHA256 of a master secret, never stored.
 * - The master is INTERNAL_API_KEY only (`key_id` 'ik1'): admin-api, api-videos and the processor
 *   all bind the same per-environment secret, and all three must open the row. (Cost credentials
 *   may use COST_CREDENTIALS_KEY because only admin-api and cost-monitor read them.)
 * - api-videos opens it to decide whether DeepL can be used; the processor opens it in memory for
 *   each translation job. Nothing ever returns, logs or audits the key: only its last four
 *   characters, the plan, who set it and when, and the last test.
 *
 * This file has no value imports so `node --experimental-strip-types` tests can load it directly.
 */
import type { D1Database } from './d1';

// ---------------------------------------------------------------------------------------------
// Sealing (shared with cost-credentials.ts)
// ---------------------------------------------------------------------------------------------

const SALT = new TextEncoder().encode('al-ummah-cost-credentials');
const INFO = new TextEncoder().encode('cost-credentials:aes-gcm:v1');

export interface SealedValue {
  ciphertext: string;
  iv: string;
  key_id: string;
}

export interface MasterSecret {
  id: string;
  secret: string;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Seals a value under a master secret; `aad` names what it is (bound into the ciphertext). */
export async function sealSecretValue(aad: string, value: string, master: MasterSecret): Promise<SealedValue> {
  const key = await deriveKey(master.secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(value.trim()));
  return { ciphertext: toB64(new Uint8Array(sealed)), iv: toB64(iv), key_id: master.id };
}

/** The sealed value, or null when it cannot be opened (no secret, rotated secret, tampered row, wrong aad). */
export async function openSecretValue(aad: string, row: Pick<SealedValue, 'ciphertext' | 'iv'>, secret: string | null): Promise<string | null> {
  if (!secret) return null;
  try {
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(row.iv), additionalData: new TextEncoder().encode(aad) }, key, fromB64(row.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** The last four characters shown back to the admin (shorter values show nothing). */
export function credentialLast4(value: string): string {
  const v = value.trim();
  return v.length >= 12 ? v.slice(-4) : '';
}

// ---------------------------------------------------------------------------------------------
// Service credentials (SEARCH_DB service_credentials)
// ---------------------------------------------------------------------------------------------

export const SERVICE_CREDENTIAL_PROVIDERS = ['deepl'] as const;
export type ServiceCredentialProvider = (typeof SERVICE_CREDENTIAL_PROVIDERS)[number];

/** Additional data of a service credential: never the same as a cost provider's. */
const serviceAad = (provider: ServiceCredentialProvider) => `service:${provider}`;

/** One row of service_credentials (SEARCH_DB, api-videos migrations/search 0069). */
export interface ServiceCredentialRow {
  provider: ServiceCredentialProvider;
  ciphertext: string;
  iv: string;
  key_id: string;
  last4: string;
  /** DeepL: 'free' (key ends in ':fx') or 'pro' */
  plan: string | null;
  updated_by: string;
  updated_by_name: string | null;
  updated_at: string;
  test_ok: number | null;
  test_code: string | null;
  /** JSON of the last test's numbers ({ characterCount, characterLimit }); never a key or body */
  test_detail: string | null;
  test_at: string | null;
}

/** INTERNAL_API_KEY, the only master service credentials use (see the header). */
export function serviceMasterSecret(internalApiKey: string | null | undefined): MasterSecret | null {
  return internalApiKey && internalApiKey.length >= 16 ? { id: 'ik1', secret: internalApiKey } : null;
}

export class ServiceCredentialError extends Error {}

export async function sealServiceCredential(provider: ServiceCredentialProvider, value: string, internalApiKey: string | null | undefined): Promise<SealedValue & { last4: string }> {
  const master = serviceMasterSecret(internalApiKey);
  if (!master) throw new ServiceCredentialError('No key to encrypt credentials with (INTERNAL_API_KEY is not bound)');
  return { ...(await sealSecretValue(serviceAad(provider), value, master)), last4: credentialLast4(value) };
}

export async function openServiceCredential(row: Pick<ServiceCredentialRow, 'provider' | 'ciphertext' | 'iv' | 'key_id'>, internalApiKey: string | null | undefined): Promise<string | null> {
  if (row.key_id !== 'ik1') return null;
  return openSecretValue(serviceAad(row.provider), row, serviceMasterSecret(internalApiKey)?.secret ?? null);
}

/** The row, or null (not set, or the table is not migrated yet on this database). */
export async function serviceCredentialRow(db: D1Database | undefined, provider: ServiceCredentialProvider): Promise<ServiceCredentialRow | null> {
  if (!db) return null;
  try {
    return (await db.prepare('SELECT * FROM service_credentials WHERE provider = ?').bind(provider).first<ServiceCredentialRow>()) ?? null;
  } catch (error) {
    if (/no such table/i.test(String((error as Error)?.message))) return null;
    throw error;
  }
}

type SecretBinding = string | { get(): Promise<string> } | { text(): Promise<string> } | null | undefined;

/** A Secrets Store binding (`.get()`), an older `.text()` binding or a plain string; '' when unreadable. */
export async function readSecretBinding(binding: SecretBinding): Promise<string> {
  if (!binding) return '';
  if (typeof binding === 'string') return binding;
  try {
    if ('get' in binding && typeof binding.get === 'function') return (await binding.get()) ?? '';
    if ('text' in binding && typeof binding.text === 'function') return (await binding.text()) ?? '';
  } catch {
    return '';
  }
  return '';
}

// ---------------------------------------------------------------------------------------------
// DeepL
// ---------------------------------------------------------------------------------------------

export type DeeplPlan = 'free' | 'pro';
export type DeeplKeySource = 'admin' | 'binding';

/** DeepL API Free keys end in ':fx' and live on api-free.deepl.com; every other key is API Pro. */
export const deeplPlanOf = (key: string): DeeplPlan => (key.trim().endsWith(':fx') ? 'free' : 'pro');
export const deeplApiBase = (key: string): string => (deeplPlanOf(key) === 'free' ? 'https://api-free.deepl.com' : 'https://api.deepl.com');

/**
 * DeepL list prices (USD, 2026-11): API Free has no charge up to 500,000 characters a month; API Pro
 * is a monthly base plus a price per million characters. The Costs page's estimate uses these.
 */
export const DEEPL_PRICING = {
  free: { monthlyUsd: 0, perMillionUsd: 0, includedCharacters: 500_000 },
  pro: { monthlyUsd: 5.49, perMillionUsd: 25 },
} as const;

/** Estimated DeepL cost of a month's characters on a plan (base included for Pro once a key is set). */
export function deeplCostUsd(plan: DeeplPlan | null, characters: number): number {
  if (plan !== 'pro') return 0;
  return Math.round((DEEPL_PRICING.pro.monthlyUsd + (Math.max(0, characters) / 1_000_000) * DEEPL_PRICING.pro.perMillionUsd) * 100) / 100;
}

/** Shape check before saving; returns an error code or null. The value is never echoed. */
export function validateDeeplKey(value: unknown): 'not_text' | 'length' | 'spaces' | 'shape' | null {
  if (typeof value !== 'string') return 'not_text';
  const v = value.trim();
  if (v.length < 20 || v.length > 200) return 'length';
  if (/\s/.test(v)) return 'spaces';
  if (!/^[A-Za-z0-9-]+(:fx)?$/.test(v)) return 'shape';
  return null;
}

/** What the admin sees about the DeepL key (never the value). */
export interface DeeplKeyView {
  set: boolean;
  last4: string | null;
  plan: DeeplPlan | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  test: DeeplTestView | null;
  /** The stored key no longer opens (INTERNAL_API_KEY rotated): it has to be set again. */
  unreadable?: boolean;
  /** Which key translation uses now: the admin's, else a bound AI_KEY_DEEPL secret, else none. */
  source: DeeplKeySource | null;
}

export interface DeeplTestView {
  ok: boolean;
  code: DeeplTestCode;
  characterCount: number | null;
  characterLimit: number | null;
  at: string;
}

export type DeeplTestCode = 'ok' | 'invalid' | 'quota' | 'rate_limited' | 'unavailable' | 'unreachable' | 'unreadable';

export interface DeeplUsageResult {
  ok: boolean;
  code: DeeplTestCode;
  plan: DeeplPlan;
  characterCount: number | null;
  characterLimit: number | null;
  /** HTTP status DeepL answered (0 when it could not be reached) */
  status: number;
}

/** DeepL's answer status → our code (403 wrong key, 456 the month's characters are used up). */
export function deeplCodeForStatus(status: number): DeeplTestCode {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'invalid';
  if (status === 456) return 'quota';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

/**
 * GET /v2/usage: free of charge, translates nothing. `ok` is false when the key is refused or the
 * month's character limit is reached (DeepL then refuses translations with 456).
 */
export async function deeplUsage(key: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<DeeplUsageResult> {
  const plan = deeplPlanOf(key);
  let res: Response;
  try {
    res = await fetchImpl(`${deeplApiBase(key)}/v2/usage`, { headers: { authorization: `DeepL-Auth-Key ${key.trim()}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, code: 'unreachable', plan, characterCount: null, characterLimit: null, status: 0 };
  }
  if (!res.ok) return { ok: false, code: deeplCodeForStatus(res.status), plan, characterCount: null, characterLimit: null, status: res.status };
  const body = (await res.json().catch(() => ({}))) as { character_count?: unknown; character_limit?: unknown };
  const characterCount = typeof body.character_count === 'number' ? body.character_count : null;
  const characterLimit = typeof body.character_limit === 'number' ? body.character_limit : null;
  const full = characterCount !== null && characterLimit !== null && characterLimit > 0 && characterCount >= characterLimit;
  return { ok: !full, code: full ? 'quota' : 'ok', plan, characterCount, characterLimit, status: res.status };
}

/** Needs-action key of DeepL failures (one item on the Errors page; its Retry tests the key again). */
export const DEEPL_NEEDS_ACTION_KEY = 'deepl-key';
/** admin-api builtin Retry handler (lib/errors-actions.ts) that tests the key DeepL refused. */
export const DEEPL_RETRY_HANDLER = 'deepl-key-test';

/**
 * The DeepL key translation uses: the admin's sealed key (SEARCH_DB service_credentials), else a
 * bound AI_KEY_DEEPL secret, else none. Opened in memory per call; never cached or logged.
 */
export async function resolveDeeplKey(env: { SEARCH_DB?: D1Database; INTERNAL_API_KEY?: SecretBinding; AI_KEY_DEEPL?: SecretBinding }): Promise<{ key: string; source: DeeplKeySource } | null> {
  const row = await serviceCredentialRow(env.SEARCH_DB, 'deepl').catch(() => null);
  if (row) {
    const key = await openServiceCredential(row, await readSecretBinding(env.INTERNAL_API_KEY));
    if (key) return { key, source: 'admin' };
  }
  const bound = (await readSecretBinding(env.AI_KEY_DEEPL)).trim();
  return bound ? { key: bound, source: 'binding' } : null;
}
