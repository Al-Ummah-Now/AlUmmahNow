/**
 * Play Integrity verification (standard requests, https://developer.android.com/google/play/integrity/standard).
 *
 * The app asks Play for a token with requestHash = lowercase hex SHA-256 of the UTF-8 challenge it
 * got from us (NAT-REL contract). We decode it with Google (`decodeIntegrityToken`), signed in as
 * the owner's Google Cloud service account (worker secret PLAY_INTEGRITY_SERVICE_ACCOUNT, the
 * whole JSON key; unset → Play Integrity answers `not_configured`), and accept it when:
 *   - it was made for this package and this challenge, in the last 10 minutes,
 *   - Play recognises the app (installed from Play, our signing key),
 *   - the device meets device integrity.
 */
import { base64url, bytesFromBase64, hex, sha256 } from './encoding';

export type AndroidFailure =
  | 'not_configured'
  | 'google_unavailable'
  | 'bad_token'
  | 'wrong_package'
  | 'bad_request_hash'
  | 'stale'
  | 'unrecognized_app'
  | 'device_integrity';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const MAX_AGE_MS = 10 * 60_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let accessToken: { email: string; token: string; expiresAt: number } | null = null;

/** Forget the cached Google access token (tests). */
export function resetPlayIntegrityToken(): void {
  accessToken = null;
}

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string' || !parsed.private_key.includes('PRIVATE KEY')) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

async function googleAccessToken(account: ServiceAccount, fetcher: Fetch, now: number): Promise<string | null> {
  if (accessToken && accessToken.email === account.client_email && accessToken.expiresAt - 60_000 > now) return accessToken.token;
  const iat = Math.floor(now / 1000);
  const enc = (v: unknown) => base64url(new TextEncoder().encode(JSON.stringify(v)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    bytesFromBase64(account.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }).toString(),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  accessToken = { email: account.client_email, token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

interface IntegrityPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string | number };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
}

export interface PlayIntegrityInput {
  token: string;
  challenge: string;
  packageName: string;
  serviceAccountJson: string | undefined;
  fetcher?: Fetch;
  now?: number;
}

export async function verifyPlayIntegrity(input: PlayIntegrityInput): Promise<{ ok: true } | { ok: false; reason: AndroidFailure }> {
  const account = parseServiceAccount(input.serviceAccountJson);
  if (!account) return { ok: false, reason: 'not_configured' };
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now();
  let payload: IntegrityPayload | undefined;
  try {
    const token = await googleAccessToken(account, fetcher, now);
    if (!token) return { ok: false, reason: 'google_unavailable' };
    const response = await fetcher(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(input.packageName)}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrity_token: input.token }),
    });
    if (response.status === 400) return { ok: false, reason: 'bad_token' };
    if (!response.ok) return { ok: false, reason: 'google_unavailable' };
    payload = ((await response.json()) as { tokenPayloadExternal?: IntegrityPayload }).tokenPayloadExternal;
  } catch {
    return { ok: false, reason: 'google_unavailable' };
  }
  if (!payload) return { ok: false, reason: 'bad_token' };
  const details = payload.requestDetails ?? {};
  if (details.requestPackageName !== input.packageName) return { ok: false, reason: 'wrong_package' };
  if (details.requestHash !== hex(await sha256(input.challenge))) return { ok: false, reason: 'bad_request_hash' };
  const at = Number(details.timestampMillis);
  if (!Number.isFinite(at) || Math.abs(now - at) > MAX_AGE_MS) return { ok: false, reason: 'stale' };
  if (payload.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED' || payload.appIntegrity.packageName !== input.packageName) {
    return { ok: false, reason: 'unrecognized_app' };
  }
  const device = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!device.includes('MEETS_DEVICE_INTEGRITY') && !device.includes('MEETS_STRONG_INTEGRITY')) return { ok: false, reason: 'device_integrity' };
  return { ok: true };
}
