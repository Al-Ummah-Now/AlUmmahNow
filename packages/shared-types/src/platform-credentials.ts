/**
 * Platform credentials a Super Admin can replace from the videos admin (Platform settings →
 * Credentials) instead of pasting them in Cloudflare's Secrets Store.
 *
 * A replaced value is sealed and kept in the global-settings bucket (`credentials/<id>.json`), which
 * admin-api and api-videos both bind, as does the per-environment INTERNAL_API_KEY it is sealed with:
 *
 * - AES-256-GCM, a random 12-byte IV per value, the credential id as additional data (a ciphertext
 *   cannot be moved to another credential's file).
 * - The AES key is HKDF-SHA256 of INTERNAL_API_KEY with a fixed salt and info, so it is never stored.
 *   A file that no longer opens (INTERNAL_API_KEY rotated) reads as "set it again", and the Secrets
 *   Store binding is used meanwhile.
 * - Nothing returns the value: the admin sees where it comes from, its last four characters, who
 *   replaced it and when, and the last test.
 *
 * The Worker that uses a credential reads it through resolvePlatformCredential: the admin-set value
 * first, else the Secrets Store binding it always had. Each isolate keeps the answer for a minute,
 * so a replaced value reaches every Worker within a minute.
 */

export const PLATFORM_CREDENTIAL_IDS = ['cloudflare-media'] as const;
export type PlatformCredentialId = (typeof PLATFORM_CREDENTIAL_IDS)[number];

export const isPlatformCredentialId = (v: unknown): v is PlatformCredentialId =>
  typeof v === 'string' && (PLATFORM_CREDENTIAL_IDS as readonly string[]).includes(v);

/** The Cloudflare zone of alummahnow.net (media hosts of every environment live on it). */
export const ALUMMAHNOW_ZONE_ID = 'fada86a0f215bda23dbe19de7226b49f';
export const ALUMMAHNOW_ZONE_NAME = 'alummahnow.net';

/** Where a credential is read today, for the admin page and the audit. */
export interface PlatformCredentialSpec {
  id: PlatformCredentialId;
  /** Secrets Store entry it replaces (same name in every environment) */
  secretsStoreName: string;
  /** Worker bindings that read it */
  usedBy: { worker: string; binding: string }[];
}

export const PLATFORM_CREDENTIALS: Record<PlatformCredentialId, PlatformCredentialSpec> = {
  'cloudflare-media': {
    id: 'cloudflare-media',
    secretsStoreName: 'media-cdn-api-token',
    usedBy: [
      { worker: 'api-videos', binding: 'MEDIA_CDN_API_TOKEN' },
      { worker: 'api-videos', binding: 'MEDIA_ANALYTICS_TOKEN' },
      { worker: 'admin-api', binding: 'CF_ANALYTICS_TOKEN' },
    ],
  },
};

/** What a test of the Cloudflare token checks; each name has plain-words copy on the admin page. */
export const CLOUDFLARE_MEDIA_CHECKS = ['token', 'account_analytics', 'zone_analytics', 'cache_purge'] as const;
export type CloudflareMediaCheck = (typeof CLOUDFLARE_MEDIA_CHECKS)[number];

export interface PlatformCredentialTest {
  /** Every check passed */
  ok: boolean;
  /** 'ok' | 'invalid' | 'inactive' | 'missing_permissions' | 'unreachable' | 'unreadable' | 'none' */
  code: string;
  checks: { name: CloudflareMediaCheck; ok: boolean }[];
  at: string;
  by: string | null;
}

/** global-settings credentials/<id>.json */
export interface SealedPlatformCredential {
  ciphertext: string;
  iv: string;
  /** Which master sealed it ('ik1' = INTERNAL_API_KEY) */
  keyId: 'ik1';
  last4: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string | null;
}

/** global-settings credentials/<id>.test.json: the last test of the value in use, whichever its source */
export interface StoredCredentialTest extends PlatformCredentialTest {
  source: 'admin' | 'binding' | null;
  /** last4 of the admin-set value tested (null for the binding) */
  last4: string | null;
}

/** What the admin page sees (never the value). */
export interface PlatformCredentialView {
  id: PlatformCredentialId;
  secretsStoreName: string;
  usedBy: { worker: string; binding: string }[];
  /** Where the value in use comes from: set on the admin page, the Secrets Store binding, or none */
  source: 'admin' | 'binding' | null;
  present: boolean;
  /** Last four characters of the admin-set value (null for the binding: admin-api cannot read every copy) */
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  /** An admin-set value is stored but no longer opens (INTERNAL_API_KEY was rotated): set it again */
  unreadable: boolean;
  test: PlatformCredentialTest | null;
}

export const platformCredentialKey = (id: PlatformCredentialId) => `credentials/${id}.json`;
export const platformCredentialTestKey = (id: PlatformCredentialId) => `credentials/${id}.test.json`;

/**
 * Shape check of a Cloudflare API token before it is saved: 30-200 characters of letters, digits,
 * '-' and '_' (Cloudflare's tokens are 40). The value is never echoed.
 */
export function isCloudflareApiToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{30,200}$/.test(value.trim());
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

const SALT = new TextEncoder().encode('al-ummah-platform-credentials');
const INFO = new TextEncoder().encode('platform-credentials:aes-gcm:v1');

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(master: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(master), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealPlatformCredential(
  id: PlatformCredentialId,
  master: string,
  value: string,
  actor: { id: string; name: string | null },
  now: string,
): Promise<SealedPlatformCredential> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await deriveKey(master), new TextEncoder().encode(value));
  return { ciphertext: toB64(new Uint8Array(sealed)), iv: toB64(iv), keyId: 'ik1', last4: value.slice(-4), updatedAt: now, updatedBy: actor.id, updatedByName: actor.name };
}

/** The sealed value, or null when it cannot be opened (master rotated, damaged, another id's file). */
export async function openPlatformCredential(id: PlatformCredentialId, master: string, sealed: Pick<SealedPlatformCredential, 'ciphertext' | 'iv'>): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: new TextEncoder().encode(id) }, await deriveKey(master), fromB64(sealed.ciphertext));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading (both Workers)
// ---------------------------------------------------------------------------

/** The slice of an R2 bucket this module uses. */
export interface CredentialBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface CredentialEnv {
  global_settings?: CredentialBucket;
  /** Secrets Store binding (or a plain string locally) */
  INTERNAL_API_KEY?: unknown;
}

/** A Secrets Store binding's value (or a plain string's), '' when missing or unreadable. */
export async function secretBindingText(binding: unknown): Promise<string> {
  if (!binding) return '';
  if (typeof binding === 'string') return binding.trim();
  try {
    return (((await (binding as { get?: () => Promise<string> }).get?.()) ?? '') || '').trim();
  } catch {
    return '';
  }
}

/** The INTERNAL_API_KEY the values are sealed with, or null when it is missing or too short. */
export async function credentialMaster(env: CredentialEnv): Promise<string | null> {
  const master = await secretBindingText(env.INTERNAL_API_KEY);
  return master.length >= 16 ? master : null;
}

export async function readSealedPlatformCredential(env: CredentialEnv, id: PlatformCredentialId): Promise<SealedPlatformCredential | null> {
  try {
    const stored = await env.global_settings?.get(platformCredentialKey(id));
    if (!stored) return null;
    const raw = JSON.parse(await stored.text()) as Partial<SealedPlatformCredential>;
    if (typeof raw.ciphertext !== 'string' || typeof raw.iv !== 'string') return null;
    return {
      ciphertext: raw.ciphertext,
      iv: raw.iv,
      keyId: 'ik1',
      last4: typeof raw.last4 === 'string' ? raw.last4 : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
      updatedByName: typeof raw.updatedByName === 'string' ? raw.updatedByName : null,
    };
  } catch {
    return null;
  }
}

export interface ResolvedCredential {
  value: string;
  source: 'admin' | 'binding' | null;
  /** An admin-set value is stored but does not open */
  unreadable: boolean;
  sealed: SealedPlatformCredential | null;
}

/** The value in use, uncached: the admin-set one first, then the Secrets Store binding. */
export async function readPlatformCredential(env: CredentialEnv, id: PlatformCredentialId, binding: unknown): Promise<ResolvedCredential> {
  const sealed = await readSealedPlatformCredential(env, id);
  let unreadable = false;
  if (sealed) {
    const master = await credentialMaster(env);
    const value = master ? ((await openPlatformCredential(id, master, sealed)) ?? '').trim() : '';
    if (value) return { value, source: 'admin', unreadable: false, sealed };
    unreadable = true;
  }
  const bound = await secretBindingText(binding);
  return { value: bound, source: bound ? 'binding' : null, unreadable, sealed };
}

const CACHE_MS = 60_000;
/** The admin-set value per id ('' when none or unreadable); the binding is read every time, as before. */
const cache = new Map<string, { admin: string; at: number }>();

async function adminValue(env: CredentialEnv, id: PlatformCredentialId): Promise<string> {
  const sealed = await readSealedPlatformCredential(env, id);
  if (!sealed) return '';
  const master = await credentialMaster(env);
  return master ? ((await openPlatformCredential(id, master, sealed)) ?? '').trim() : '';
}

/**
 * The credential a Worker uses: the admin-set value, else its Secrets Store binding ('' when
 * neither). The admin-set lookup is kept a minute per isolate; never throws.
 */
export async function resolvePlatformCredential(env: CredentialEnv, id: PlatformCredentialId, binding: unknown, now = Date.now()): Promise<string> {
  let hit = cache.get(id);
  if (!hit || now - hit.at >= CACHE_MS) {
    hit = { admin: await adminValue(env, id).catch(() => ''), at: now };
    cache.set(id, hit);
  }
  return hit.admin || secretBindingText(binding);
}

/** Forget the cached value (admin-api after a replace, and tests). */
export function forgetPlatformCredential(id?: PlatformCredentialId): void {
  if (id) cache.delete(id);
  else cache.clear();
}
