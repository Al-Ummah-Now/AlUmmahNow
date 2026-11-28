/**
 * Web Push sender (#1287): browsers and installed web apps (provider 'webpush').
 *
 * - RFC 8292 VAPID: an ES256 JWT per push-service origin (aud), valid 12 hours and cached,
 *   sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 * - RFC 8291 + RFC 8188 aes128gcm: the payload is encrypted to the subscription's p256dh/auth
 *   keys with a fresh ECDH key pair and salt per message, as one record.
 *
 * The subscription is push_devices.token (the canonical JSON `{endpoint, keys}`); api-videos
 * already limits the endpoint to the real browser push services (isWebPushHost), so this
 * never POSTs anywhere else. The payload is the notification key + params (the web app's
 * service worker, /push-sw.js, renders it with the app's own strings in the device's locale),
 * or a review alert's rendered text.
 *
 * Secrets (Secrets Store): VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point) and
 * VAPID_PRIVATE_KEY (base64url, the 32-byte private scalar), the format `web-push
 * generate-vapid-keys` prints. Missing or placeholder → log-only.
 */
import { logger } from '../../lib/logger';
import type { AlertPush, PushMessage, PushProvider, PushResult, PushTarget } from '../provider';
import { base64url, bodyText, nowSeconds, pushEndpoint, readSecret, retryableStatus, signJwt, type FetchLike, type SecretBinding } from './common';
import { wnsTag } from './wns';

export interface WebPushEnv {
  VAPID_PUBLIC_KEY?: SecretBinding;
  VAPID_PRIVATE_KEY?: SecretBinding;
}

/** RFC 8292 `sub`: who the push service contacts about this sender. */
export const VAPID_SUBJECT = 'https://alummahnow.net';
/** JWTs are valid this long (push services refuse more than 24 h). */
const VAPID_JWT_TTL_SECONDS = 12 * 3600;
/** One aes128gcm record holds the whole message (push services accept at most 4096 bytes). */
const RECORD_SIZE = 4096;
/** Payloads above this go without their params; the service worker then shows the generic text. */
export const MAX_PLAINTEXT_BYTES = 3000;

const enc = new TextEncoder();

export function fromBase64url(value: string): Uint8Array {
  const b64 = value.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** A fresh ArrayBuffer of exactly these bytes (WebCrypto wants BufferSource without offsets). */
const buf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, length * 8));
}

export interface Subscription {
  endpoint: string;
  p256dh: Uint8Array;
  auth: Uint8Array;
}

/** push_devices.token → the subscription; null when it is not one (the row is then pruned). */
export function parseSubscription(token: string): Subscription | null {
  try {
    const s = JSON.parse(token) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (typeof s.endpoint !== 'string' || typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return null;
    const url = pushEndpoint(s.endpoint, 'webpush');
    if (!url) return null;
    const p256dh = fromBase64url(s.keys.p256dh);
    const auth = fromBase64url(s.keys.auth);
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
    return { endpoint: url.href, p256dh, auth };
  } catch {
    return null;
  }
}

/** Seams for tests: a fixed ephemeral key pair and salt (RFC 8291 §5 example). */
export interface EncryptOptions {
  salt?: Uint8Array;
  senderKeys?: CryptoKeyPair;
}

/**
 * RFC 8291 §3.4 + RFC 8188: the aes128gcm body for `plaintext`, encrypted to the user agent's
 * p256dh public key and auth secret. Header: salt(16) ‖ rs(4) ‖ idlen(1) ‖ sender public key(65).
 */
export async function encryptWebPush(plaintext: Uint8Array, p256dh: Uint8Array, authSecret: Uint8Array, options: EncryptOptions = {}): Promise<Uint8Array> {
  if (plaintext.length + 17 > RECORD_SIZE - 86) throw new Error('Web Push payload too large for one record');
  const senderKeys =
    options.senderKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const senderPublic = new Uint8Array((await crypto.subtle.exportKey('raw', senderKeys.publicKey)) as ArrayBuffer);
  const uaPublicKey = await crypto.subtle.importKey('raw', buf(p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey } as EcdhKeyDeriveParams, senderKeys.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" ‖ 0x00 ‖ ua_public ‖ as_public, 32)
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), p256dh, senderPublic), 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // The only (so the last) record: the plaintext, then the 0x02 delimiter, no padding
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(concat(plaintext, new Uint8Array([2])))));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

interface VapidKeys {
  privateKey: CryptoKey;
  /** base64url of the uncompressed public point: the `k=` parameter. */
  publicKey: string;
}

const jwtCache = new Map<string, { jwt: string; expiresAt: number }>();

export function resetVapidJwtCache(): void {
  jwtCache.clear();
}

/**
 * The private scalar as the 32 bytes a JWK `d` must be (RFC 7518 §6.2.2.1: full length, big-endian).
 * A valid key can arrive shorter or longer: tools that print the scalar as an integer drop its
 * leading zero bytes (Node's ECDH getPrivateKey(), about 1 key in 256 is 31 bytes), and ASN.1
 * INTEGER encodings add a 0x00 sign byte. Those are left-padded or trimmed; anything else (empty,
 * zero, longer than 32 significant bytes) is null. #1444: such a key used to be refused, which
 * left Web Push silently log-only.
 */
export function normalizePrivateScalar(raw: Uint8Array): Uint8Array | null {
  let start = 0;
  while (start < raw.length && raw[start] === 0) start++;
  const significant = raw.subarray(start);
  if (significant.length === 0 || significant.length > 32) return null;
  const d = new Uint8Array(32);
  d.set(significant, 32 - significant.length);
  return d;
}

/** The JWK of the VAPID key pair: x and y come from the public point, d is the private scalar. */
export async function importVapidKeys(publicKey: string, privateKey: string): Promise<VapidKeys> {
  const pub = fromBase64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point (65 bytes, base64url)');
  const d = normalizePrivateScalar(fromBase64url(privateKey));
  if (!d) throw new Error('VAPID_PRIVATE_KEY is not a P-256 private key (base64url, up to 32 bytes)');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33, 65)), d: base64url(d), ext: false };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { privateKey: key, publicKey: base64url(pub) };
}

/** What a review alert or clear looks like on the wire (the service worker shows or closes it). */
export function alertPayload(alert: AlertPush): Record<string, unknown> {
  if (alert.kind === 'clear') return { kind: 'review_clear', reviewId: alert.reviewId };
  return {
    kind: 'review_alert',
    reviewId: alert.reviewId,
    title: alert.title ?? '',
    body: alert.body ?? '',
    ...(alert.actionUrl ? { url: alert.actionUrl } : {}),
  };
}

/** A notification's payload: key + params for the service worker; params dropped if too big. */
export function notificationPayload(target: PushTarget, message: PushMessage): Uint8Array {
  const base = {
    kind: 'notification',
    notificationId: message.notificationId,
    key: message.notificationKey,
    ...(target.locale ? { lang: target.locale } : {}),
    ...(message.actionUrl ? { url: message.actionUrl } : {}),
  };
  const full = enc.encode(JSON.stringify({ ...base, params: message.params }));
  return full.length <= MAX_PLAINTEXT_BYTES ? full : enc.encode(JSON.stringify(base));
}

export class WebPushProvider implements PushProvider {
  readonly name = 'webpush';
  private keys: Promise<VapidKeys | null> | null = null;

  constructor(
    private readonly env: WebPushEnv,
    private readonly fallback: PushProvider,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly clock: () => number = Date.now,
  ) {}

  private vapidKeys(): Promise<VapidKeys | null> {
    this.keys ??= (async () => {
      const [pub, priv] = await Promise.all([readSecret(this.env.VAPID_PUBLIC_KEY), readSecret(this.env.VAPID_PRIVATE_KEY)]);
      if (!pub || !priv) return null;
      try {
        return await importVapidKeys(pub, priv);
      } catch (error) {
        logger.error('[Push] VAPID keys unreadable; Web Push stays log-only', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    })();
    return this.keys;
  }

  /** RFC 8292 §2: one JWT per push-service origin, reused until an hour before it expires. */
  private async vapidJwt(keys: VapidKeys, audience: string): Promise<string> {
    const now = this.clock();
    const cacheKey = `${keys.publicKey}|${audience}`;
    const cached = jwtCache.get(cacheKey);
    if (cached && cached.expiresAt - 3_600_000 > now) return cached.jwt;
    const exp = nowSeconds(now) + VAPID_JWT_TTL_SECONDS;
    const jwt = await signJwt({ typ: 'JWT', alg: 'ES256' }, { aud: audience, exp, sub: VAPID_SUBJECT }, (data) =>
      crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, data),
    );
    jwtCache.set(cacheKey, { jwt, expiresAt: exp * 1000 });
    return jwt;
  }

  private async post(
    target: PushTarget,
    payload: Uint8Array,
    headers: { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
  ): Promise<PushResult | 'not_configured'> {
    const keys = await this.vapidKeys();
    if (!keys) return 'not_configured';
    const sub = parseSubscription(target.token);
    if (!sub) return { ok: false, invalidToken: true, error: 'stored Web Push subscription is not valid' };
    const body = await encryptWebPush(payload, sub.p256dh, sub.auth);
    const jwt = await this.vapidJwt(keys, new URL(sub.endpoint).origin);
    const res = await this.fetchImpl(sub.endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(headers.ttl),
        urgency: headers.urgency,
        ...(headers.topic ? { topic: headers.topic } : {}),
      },
      body: buf(body),
    });
    if (res.ok) return { ok: true };
    const text = await bodyText(res);
    // 404/410: the subscription is gone (unsubscribed or expired); the device row is deleted.
    // 401/403: the push service refused our VAPID JWT (wrong key pair for this subscription)
    return { ok: false, invalidToken: res.status === 404 || res.status === 410, retryable: retryableStatus(res.status), error: `${res.status} ${text.slice(0, 200)}`.trim() };
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    const result = await this.post(target, notificationPayload(target, message), { ttl: 86400, urgency: 'normal' });
    return result === 'not_configured' ? this.fallback.send(target, message) : result;
  }

  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    // Topic (≤ 32 URL-safe characters) replaces a still-undelivered push for the same review
    const topic = await wnsTag(alert.reviewId);
    const result = await this.post(target, enc.encode(JSON.stringify(alertPayload(alert))), {
      ttl: alert.ttlSeconds,
      urgency: alert.kind === 'alert' ? 'high' : 'normal',
      topic,
    });
    return result === 'not_configured' ? this.fallback.sendAlert(target, alert) : result;
  }
}
