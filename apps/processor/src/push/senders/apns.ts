/**
 * APNs sender (#414, wiki AUN-ADMIN-NATIVE AD7: direct APNs for iPhone, iPad and macOS).
 *
 * Token-based auth: an ES256 JWT signed with the team's .p8 key, cached and renewed every
 * 40 minutes (Apple accepts a token for 60 and refuses refreshes more often than every 20).
 * HTTP/2 only: a Worker's fetch reaches api.push.apple.com over HTTP/2 (spike 2026-11-13, in the PR that added this file:
 * 403 InvalidProviderToken with an apns-id from both hosts, ~70 ms), so no relay is needed.
 *
 *   apns-topic       the bundle id of the app that registered the token (push_devices.app + platform)
 *   apns-push-type   alert (visible) or background (silent clear)
 *   apns-collapse-id the review id: a later alert for the same item replaces the earlier one
 *   interruption-level time-sensitive for review alerts (Critical Alerts are not used)
 *
 * Secrets (Secrets Store): APNS_KEY_P8, APNS_KEY_ID, APPLE_TEAM_ID, APNS_BUNDLE_IDS (JSON
 * { "<app>": "<bundle id>" | { "<platform>": "<bundle id>" } }). Missing → log-only.
 */
import { logger } from '../../lib/logger';
import type { AlertPush, PushMessage, PushProvider, PushResult, PushTarget } from '../provider';
import { bodyText, nowSeconds, pemToDer, readSecret, signJwt, type FetchLike, type SecretBinding } from './common';

export interface ApnsEnv {
  APNS_KEY_P8?: SecretBinding;
  APNS_KEY_ID?: SecretBinding;
  APPLE_TEAM_ID?: SecretBinding;
  APNS_BUNDLE_IDS?: SecretBinding;
  /** "true": api.sandbox.push.apple.com (development builds). TestFlight and store builds use production. */
  APNS_SANDBOX?: string;
}

interface ApnsCredentials {
  key: CryptoKey;
  keyId: string;
  teamId: string;
  bundles: Record<string, string | Record<string, string>>;
}

/** Renew the provider token after 40 min (Apple: valid 60 min, at most one refresh per 20). */
export const APNS_TOKEN_RENEW_SECONDS = 40 * 60;

/** Per isolate: one token per key id, shared by every send. */
const tokenCache = new Map<string, { jwt: string; iat: number }>();

export function resetApnsTokenCache(): void {
  tokenCache.clear();
}

export async function apnsProviderToken(creds: Pick<ApnsCredentials, 'key' | 'keyId' | 'teamId'>, now = Date.now()): Promise<string> {
  const cached = tokenCache.get(creds.keyId);
  if (cached && nowSeconds(now) - cached.iat < APNS_TOKEN_RENEW_SECONDS) return cached.jwt;
  const iat = nowSeconds(now);
  const jwt = await signJwt({ alg: 'ES256', kid: creds.keyId }, { iss: creds.teamId, iat }, (data) =>
    crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, creds.key, data),
  );
  tokenCache.set(creds.keyId, { jwt, iat });
  return jwt;
}

export function bundleIdFor(bundles: ApnsCredentials['bundles'], target: Pick<PushTarget, 'app' | 'platform'>): string | null {
  const entry = bundles[target.app];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry[target.platform] ?? entry.default ?? null;
}

/** Reasons APNs gives for a token that will never work again: the device row is deleted. */
// DeviceTokenNotForTopic is left out: it means our bundle id config is wrong, not that the device is gone
const DEAD_TOKEN = new Set(['BadDeviceToken', 'Unregistered']);

export class ApnsPushProvider implements PushProvider {
  readonly name = 'apns';
  private creds: Promise<ApnsCredentials | null> | null = null;

  constructor(
    private readonly env: ApnsEnv,
    private readonly fallback: PushProvider,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly clock: () => number = Date.now,
  ) {}

  private host(): string {
    return this.env.APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  }

  private credentials(): Promise<ApnsCredentials | null> {
    this.creds ??= (async () => {
      const [p8, keyId, teamId, bundlesRaw] = await Promise.all([
        readSecret(this.env.APNS_KEY_P8),
        readSecret(this.env.APNS_KEY_ID),
        readSecret(this.env.APPLE_TEAM_ID),
        readSecret(this.env.APNS_BUNDLE_IDS),
      ]);
      if (!p8 || !keyId || !teamId || !bundlesRaw) return null;
      try {
        const key = await crypto.subtle.importKey('pkcs8', pemToDer(p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        return { key, keyId: keyId.trim(), teamId: teamId.trim(), bundles: JSON.parse(bundlesRaw) };
      } catch (error) {
        logger.error('[Push] APNs credentials unreadable; APNs stays log-only', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    })();
    return this.creds;
  }

  private async post(target: PushTarget, headers: Record<string, string>, payload: unknown): Promise<PushResult | 'not_configured'> {
    const creds = await this.credentials();
    if (!creds) return 'not_configured';
    const topic = bundleIdFor(creds.bundles, target);
    if (!topic) return 'not_configured';
    const jwt = await apnsProviderToken(creds, this.clock());
    const res = await this.fetchImpl(`${this.host()}/3/device/${encodeURIComponent(target.token)}`, {
      method: 'POST',
      headers: { authorization: `bearer ${jwt}`, 'apns-topic': topic, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true };
    const text = await bodyText(res);
    let reason = '';
    try {
      reason = String(JSON.parse(text).reason ?? '');
    } catch {
      reason = text;
    }
    // The cached provider token was refused: sign a fresh one next time
    if (res.status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken')) tokenCache.delete(creds.keyId);
    return { ok: false, invalidToken: res.status === 410 || DEAD_TOKEN.has(reason), error: `${res.status} ${reason}`.trim() };
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    const expiration = String(nowSeconds(this.clock()) + 24 * 3600);
    const result = await this.post(
      target,
      { 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': expiration, 'apns-collapse-id': message.notificationId.slice(0, 64) },
      {
        // Localised on the device from the app's own strings (loc-key + loc-args)
        aps: { alert: { 'loc-key': `notification.${message.notificationKey}`, 'loc-args': Object.values(message.params).map(String) }, 'thread-id': message.category, sound: 'default' },
        notificationId: message.notificationId,
        key: message.notificationKey,
        params: message.params,
        ...(message.actionUrl ? { url: message.actionUrl } : {}),
      },
    );
    return result === 'not_configured' ? this.fallback.send(target, message) : result;
  }

  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    const expiration = String(nowSeconds(this.clock()) + alert.ttlSeconds);
    const collapse = alert.reviewId.slice(0, 64);
    const result =
      alert.kind === 'alert'
        ? await this.post(
            target,
            { 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': expiration, 'apns-collapse-id': collapse },
            {
              aps: {
                alert: { title: alert.title, body: alert.body },
                sound: 'default',
                'interruption-level': 'time-sensitive',
                'thread-id': 'review-queue',
                category: 'REVIEW_ALERT',
              },
              reviewId: alert.reviewId,
              ...(alert.actionUrl ? { url: alert.actionUrl } : {}),
            },
          )
        : await this.post(
            target,
            // Silent: background pushes must use priority 5
            { 'apns-push-type': 'background', 'apns-priority': '5', 'apns-expiration': expiration },
            { aps: { 'content-available': 1 }, clear: alert.reviewId },
          );
    return result === 'not_configured' ? this.fallback.sendAlert(target, alert) : result;
  }
}
