/**
 * FCM HTTP v1 sender (#414; wiki AUN-ADMIN-NATIVE AD7: FCM for Android only).
 *
 * OAuth2 for a service account: an RS256 JWT assertion exchanged at oauth2.googleapis.com for
 * an access token (scope firebase.messaging), cached until 5 minutes before it expires.
 *
 * Review alerts: high priority, Android notification channel `review_queue`, tag and
 * collapse key = review id. A clear is a data-only message the app handles by cancelling the
 * notification with that tag.
 *
 * Secrets (Secrets Store): FCM_SERVICE_ACCOUNT (the service-account JSON), FCM_PROJECT_ID
 * (optional; the JSON's project_id otherwise). Missing → log-only.
 */
import { logger } from '../../lib/logger';
import type { AlertPush, PushMessage, PushProvider, PushResult, PushTarget } from '../provider';
import { bodyText, nowSeconds, pemToDer, readSecret, signJwt, type FetchLike, type SecretBinding } from './common';

export interface FcmEnv {
  FCM_SERVICE_ACCOUNT?: SecretBinding;
  FCM_PROJECT_ID?: SecretBinding;
}

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** The Android notification channel the Admin app creates (high importance). */
export const REVIEW_CHANNEL_ID = 'review_queue';

interface FcmCredentials {
  key: CryptoKey;
  clientEmail: string;
  projectId: string;
  tokenUri: string;
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export function resetFcmTokenCache(): void {
  tokenCache.clear();
}

export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  private creds: Promise<FcmCredentials | null> | null = null;

  constructor(
    private readonly env: FcmEnv,
    private readonly fallback: PushProvider,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly clock: () => number = Date.now,
  ) {}

  private credentials(): Promise<FcmCredentials | null> {
    this.creds ??= (async () => {
      const [json, projectOverride] = await Promise.all([readSecret(this.env.FCM_SERVICE_ACCOUNT), readSecret(this.env.FCM_PROJECT_ID)]);
      if (!json) return null;
      try {
        const sa = JSON.parse(json) as { client_email?: string; private_key?: string; project_id?: string; token_uri?: string };
        const projectId = projectOverride?.trim() || sa.project_id;
        if (!sa.client_email || !sa.private_key || !projectId) throw new Error('service account JSON lacks client_email, private_key or project_id');
        const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
        // Only Google's token endpoint: the JSON is ours, but never POST a signed assertion elsewhere
        const tokenUri = sa.token_uri === GOOGLE_TOKEN_URL ? sa.token_uri : GOOGLE_TOKEN_URL;
        return { key, clientEmail: sa.client_email, projectId, tokenUri };
      } catch (error) {
        logger.error('[Push] FCM service account unreadable; FCM stays log-only', { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    })();
    return this.creds;
  }

  private async accessToken(creds: FcmCredentials): Promise<string> {
    const now = this.clock();
    const cached = tokenCache.get(creds.clientEmail);
    if (cached && cached.expiresAt - 300_000 > now) return cached.accessToken;
    const iat = nowSeconds(now);
    const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' }, { iss: creds.clientEmail, scope: FCM_SCOPE, aud: creds.tokenUri, iat, exp: iat + 3600 }, (data) =>
      crypto.subtle.sign('RSASSA-PKCS1-v1_5', creds.key, data),
    );
    const res = await this.fetchImpl(creds.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!res.ok) throw new Error(`FCM OAuth token refused (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM OAuth answer has no access_token');
    tokenCache.set(creds.clientEmail, { accessToken: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  private async post(message: Record<string, unknown>): Promise<PushResult | 'not_configured'> {
    const creds = await this.credentials();
    if (!creds) return 'not_configured';
    let token: string;
    try {
      token = await this.accessToken(creds);
    } catch (error) {
      return { ok: false, invalidToken: false, error: error instanceof Error ? error.message : String(error) };
    }
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(creds.projectId)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return { ok: true };
    const text = await bodyText(res);
    if (res.status === 401) tokenCache.delete(creds.clientEmail);
    // UNREGISTERED (404) or a token FCM no longer knows: the device row is deleted
    const dead = res.status === 404 || /UNREGISTERED/.test(text) || (res.status === 400 && /registration token/i.test(text));
    return { ok: false, invalidToken: dead, error: `${res.status} ${text.slice(0, 200)}` };
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    const data: Record<string, string> = { notificationId: message.notificationId, key: message.notificationKey, params: JSON.stringify(message.params) };
    if (message.actionUrl) data.url = message.actionUrl;
    const result = await this.post({
      token: target.token,
      data,
      android: {
        priority: 'NORMAL',
        ttl: '86400s',
        notification: {
          body_loc_key: `notification_${message.notificationKey}`,
          body_loc_args: Object.values(message.params).map(String),
          tag: message.notificationId,
        },
      },
    });
    return result === 'not_configured' ? this.fallback.send(target, message) : result;
  }

  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    const ttl = `${alert.ttlSeconds}s`;
    const result =
      alert.kind === 'alert'
        ? await this.post({
            token: target.token,
            data: { kind: 'review_alert', reviewId: alert.reviewId, ...(alert.actionUrl ? { url: alert.actionUrl } : {}) },
            android: {
              priority: 'HIGH',
              ttl,
              collapse_key: alert.reviewId.slice(0, 64),
              notification: { channel_id: REVIEW_CHANNEL_ID, title: alert.title, body: alert.body, tag: alert.reviewId, notification_priority: 'PRIORITY_HIGH' },
            },
          })
        : await this.post({ token: target.token, data: { kind: 'review_clear', reviewId: alert.reviewId }, android: { priority: 'HIGH', ttl } });
    return result === 'not_configured' ? this.fallback.sendAlert(target, alert) : result;
  }
}
