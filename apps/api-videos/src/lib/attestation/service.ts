/**
 * Native app attestation (AlUmmahNow#1274, NAT-REL): App Attest / Play Integrity turned into a
 * short-lived "native proof" the apps send in `X-AUN-Native-Proof` on writes. requireHuman accepts
 * a valid proof in place of a Turnstile token, and an admin may require one from listed native
 * clients (videos admin → Mobile apps → Attestation).
 *
 * Off until configured: the switches, Team ID, bundle ids, packages and Cloud project number come
 * from the Mobile apps settings (admin-api `/public/mobile-apps`, read once a minute per isolate);
 * Play Integrity also needs the worker secret PLAY_INTEGRITY_SERVICE_ACCOUNT.
 *
 * State lives in KV HUMAN_VERIFIED under its own prefixes (no new namespace):
 *   att:c:<challenge>   one-time challenge, 5 min
 *   att:k:<keyId>       an attested Apple key (public key, app id, counter), refreshed on use, 1 year
 *   att:p:<sha256>      a proof (only its hash is stored), 1 hour; pinned to the first account that uses it
 *
 * A proof is not a bearer pass on its own: requireHuman accepts it only from a signed-in token of a
 * registered native client, only while that platform's check is on, and only for the account that
 * first used it (acceptProof).
 */
import { parseMobileAppsSettings, publicAttestationConfig, type MobileAppsEnvironment, type MobileAppsSettings, type PublicAttestationConfig } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { verifyAppleAssertion, verifyAppleAttestation, type AttestedKey } from './apple';
import { verifyPlayIntegrity } from './android';
import { base64url, bytesFromBase64, hex, sha256 } from './encoding';

export const CHALLENGE_TTL_SECONDS = 300;
export const PROOF_TTL_SECONDS = 3600;
const KEY_TTL_SECONDS = 365 * 24 * 3600;
const SETTINGS_FRESH_MS = 60_000;
const SETTINGS_LAST_GOOD_MS = 10 * 60_000;

export interface AttestationEnv {
  ADMIN_API_URL?: string;
  ENVIRONMENT?: string;
  HUMAN_VERIFIED?: KVNamespace;
  /** Worker secret: the Google Cloud service account JSON key with the Play Integrity API */
  PLAY_INTEGRITY_SERVICE_ACCOUNT?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function settingsEnvironment(value: string | undefined): MobileAppsEnvironment {
  if (value === 'production') return 'production';
  if (value === 'stage' || value === 'staging') return 'stage';
  if (value === 'qa') return 'qa';
  return 'local';
}

let settingsCache: { at: number; settings: MobileAppsSettings } | null = null;

/** Forget the isolate's settings (tests). */
export function resetAttestationSettings(): void {
  settingsCache = null;
}

/** The Mobile apps settings; a failed read keeps the last good copy for 10 min, else the defaults (attestation off). */
export async function loadMobileAppsSettings(env: AttestationEnv, fetcher: Fetch = fetch, now = Date.now()): Promise<MobileAppsSettings> {
  const environment = settingsEnvironment(env.ENVIRONMENT);
  if (settingsCache && now - settingsCache.at < SETTINGS_FRESH_MS) return settingsCache.settings;
  const base = (env.ADMIN_API_URL ?? '').replace(/\/$/, '');
  if (base) {
    try {
      const response = await fetcher(`${base}/public/mobile-apps`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = (await response.json()) as { settings?: unknown };
        const settings = parseMobileAppsSettings(body.settings, environment);
        settingsCache = { at: now, settings };
        return settings;
      }
      logger.warn('[attestation] Mobile apps settings read failed', { status: response.status });
    } catch (error) {
      logger.warn('[attestation] Mobile apps settings read failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (settingsCache && now - settingsCache.at < SETTINGS_LAST_GOOD_MS) return settingsCache.settings;
  return parseMobileAppsSettings(null, environment);
}

export async function attestationConfig(env: AttestationEnv, fetcher?: Fetch): Promise<PublicAttestationConfig> {
  return publicAttestationConfig(await loadMobileAppsSettings(env, fetcher));
}

/** A one-time challenge (32 random bytes, base64url), kept 5 min. */
export async function issueChallenge(kv: KVNamespace, now = Date.now()): Promise<{ challenge: string; expiresAt: string }> {
  const challenge = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await kv.put(`att:c:${challenge}`, '1', { expirationTtl: CHALLENGE_TTL_SECONDS });
  return { challenge, expiresAt: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString() };
}

/** Uses up a challenge: true once, when it was issued and has not expired. */
export async function consumeChallenge(kv: KVNamespace, challenge: unknown): Promise<boolean> {
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const key = `att:c:${challenge}`;
  if (!(await kv.get(key))) return false;
  await kv.delete(key);
  return true;
}

async function proofKey(proof: string): Promise<string> {
  return `att:p:${hex(await sha256(proof))}`;
}

/** A new proof for an attested app; only its hash is stored. */
export async function issueProof(kv: KVNamespace, subject: { platform: 'apple' | 'android'; app: string }, now = Date.now()): Promise<{ proof: string; expiresAt: string }> {
  const proof = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await kv.put(await proofKey(proof), JSON.stringify({ ...subject, at: now }), { expirationTtl: PROOF_TTL_SECONDS });
  return { proof, expiresAt: new Date(now + PROOF_TTL_SECONDS * 1000).toISOString() };
}

interface StoredProof {
  platform: 'apple' | 'android';
  app: string;
  at: number;
  /** The account that first used it; any other account is refused. */
  user?: string;
}

async function readProof(kv: KVNamespace, proof: string): Promise<StoredProof | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) return null;
  try {
    return await kv.get<StoredProof>(await proofKey(proof), 'json');
  } catch (error) {
    logger.warn('[attestation] Proof lookup failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Whether the header carries a proof we issued in the last hour (no binding checks; see acceptProof). */
export async function validProof(kv: KVNamespace | undefined, proof: string | undefined | null): Promise<boolean> {
  if (!kv || !proof) return false;
  return (await readProof(kv, proof)) !== null;
}

/**
 * Whether `userId` may use this proof now: it was issued in the last hour, its platform's check is
 * still on, and it is unused or was first used by the same account. The first use pins the account.
 */
export async function acceptProof(kv: KVNamespace | undefined, settings: MobileAppsSettings, proof: string | undefined | null, userId: string, now = Date.now()): Promise<boolean> {
  if (!kv || !proof) return false;
  const stored = await readProof(kv, proof);
  if (!stored) return false;
  const enabled = stored.platform === 'apple' ? settings.apple.appAttest.enabled : settings.android.playIntegrity.enabled;
  if (!enabled) return false;
  if (stored.user) return stored.user === userId;
  const remaining = Math.floor(PROOF_TTL_SECONDS - (now - stored.at) / 1000);
  if (remaining < 60) return false;
  try {
    await kv.put(await proofKey(proof), JSON.stringify({ ...stored, user: userId }), { expirationTtl: remaining });
  } catch (error) {
    logger.warn('[attestation] Proof pin failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
  return true;
}

interface StoredKey {
  publicKey: string;
  appId: string;
  counter: number;
}

function appleAppId(settings: MobileAppsSettings, bundleId: unknown): string | null {
  if (typeof bundleId !== 'string') return null;
  if (!settings.apple.apps.some((a) => a.bundleId === bundleId)) return null;
  return `${settings.apple.teamId}.${bundleId}`;
}

export type AttestOutcome =
  | { ok: true; proof: string; expiresAt: string }
  | { ok: false; status: 400 | 403 | 404 | 503; code: string };

export async function registerAppleKey(
  env: AttestationEnv,
  settings: MobileAppsSettings,
  body: { keyId?: unknown; attestation?: unknown; challenge?: unknown; bundleId?: unknown },
  now = new Date()
): Promise<AttestOutcome> {
  const kv = env.HUMAN_VERIFIED!;
  const appId = appleAppId(settings, body.bundleId);
  if (!appId) return { ok: false, status: 403, code: 'unknown_app' };
  if (typeof body.keyId !== 'string' || typeof body.attestation !== 'string' || body.keyId.length > 100 || body.attestation.length > 20_000) {
    return { ok: false, status: 400, code: 'invalid_request' };
  }
  if (!(await consumeChallenge(kv, body.challenge))) return { ok: false, status: 403, code: 'bad_challenge' };
  const result = await verifyAppleAttestation({
    keyId: body.keyId,
    attestation: body.attestation,
    challenge: body.challenge as string,
    appId,
    environment: settings.apple.appAttest.environment,
    now,
  });
  if ('reason' in result) {
    logger.warn('[attestation] App Attest attestation refused', { reason: result.reason, appId });
    return { ok: false, status: 403, code: 'attestation_failed' };
  }
  const stored: StoredKey = { publicKey: base64url(result.key.publicKey), appId, counter: 0 };
  await kv.put(`att:k:${keyIdKey(body.keyId)}`, JSON.stringify(stored), { expirationTtl: KEY_TTL_SECONDS });
  return { ok: true, ...(await issueProof(kv, { platform: 'apple', app: appId }, now.getTime())) };
}

/** KV key part for a key id (base64 → base64url, so it is safe in a key). */
function keyIdKey(keyId: string): string {
  return base64url(bytesFromBase64(keyId));
}

export async function assertAppleKey(
  env: AttestationEnv,
  settings: MobileAppsSettings,
  body: { keyId?: unknown; assertion?: unknown; challenge?: unknown; bundleId?: unknown },
  now = new Date()
): Promise<AttestOutcome> {
  const kv = env.HUMAN_VERIFIED!;
  const appId = appleAppId(settings, body.bundleId);
  if (!appId) return { ok: false, status: 403, code: 'unknown_app' };
  if (typeof body.keyId !== 'string' || typeof body.assertion !== 'string' || body.keyId.length > 100 || body.assertion.length > 5_000) {
    return { ok: false, status: 400, code: 'invalid_request' };
  }
  let stored: StoredKey | null = null;
  try {
    stored = await kv.get<StoredKey>(`att:k:${keyIdKey(body.keyId)}`, 'json');
  } catch {
    stored = null;
  }
  if (!stored || stored.appId !== appId) return { ok: false, status: 404, code: 'unknown_key' };
  if (!(await consumeChallenge(kv, body.challenge))) return { ok: false, status: 403, code: 'bad_challenge' };
  const key: AttestedKey = { publicKey: bytesFromBase64(stored.publicKey), appId, counter: stored.counter };
  const result = await verifyAppleAssertion({ assertion: body.assertion, challenge: body.challenge as string, key });
  if ('reason' in result) {
    logger.warn('[attestation] App Attest assertion refused', { reason: result.reason, appId });
    return { ok: false, status: 403, code: 'attestation_failed' };
  }
  await kv.put(`att:k:${keyIdKey(body.keyId)}`, JSON.stringify({ ...stored, counter: result.counter }), { expirationTtl: KEY_TTL_SECONDS });
  return { ok: true, ...(await issueProof(kv, { platform: 'apple', app: appId }, now.getTime())) };
}

export async function verifyAndroid(
  env: AttestationEnv,
  settings: MobileAppsSettings,
  body: { token?: unknown; challenge?: unknown; packageName?: unknown },
  fetcher?: Fetch,
  now = Date.now()
): Promise<AttestOutcome> {
  const kv = env.HUMAN_VERIFIED!;
  if (typeof body.packageName !== 'string' || !settings.android.apps.some((a) => a.packageName === body.packageName)) {
    return { ok: false, status: 403, code: 'unknown_app' };
  }
  if (typeof body.token !== 'string' || body.token.length > 20_000) return { ok: false, status: 400, code: 'invalid_request' };
  if (!(await consumeChallenge(kv, body.challenge))) return { ok: false, status: 403, code: 'bad_challenge' };
  const result = await verifyPlayIntegrity({
    token: body.token,
    challenge: body.challenge as string,
    packageName: body.packageName,
    serviceAccountJson: env.PLAY_INTEGRITY_SERVICE_ACCOUNT,
    fetcher,
    now,
  });
  if ('reason' in result) {
    if (result.reason === 'not_configured' || result.reason === 'google_unavailable') {
      logger.error('[attestation] Play Integrity cannot be checked', { reason: result.reason });
      return { ok: false, status: 503, code: result.reason };
    }
    logger.warn('[attestation] Play Integrity verdict refused', { reason: result.reason, packageName: body.packageName });
    return { ok: false, status: 403, code: 'attestation_failed' };
  }
  return { ok: true, ...(await issueProof(kv, { platform: 'android', app: body.packageName }, now)) };
}
