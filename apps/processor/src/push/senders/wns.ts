/**
 * WNS sender (#414; wiki AUN-ADMIN-NATIVE AD7: Windows uses WNS).
 *
 * OAuth client credentials (package SID + client secret) at login.live.com for scope
 * notify.windows.com, cached until 5 minutes before expiry. The token's channel URI is the
 * device's push_devices.token, already limited to *.notify.windows.com at registration.
 *
 * Review alerts: a toast (scenario urgent, group `review`, tag = hash of the review id: WNS
 * tags are at most 16 characters). A clear is a raw notification the app handles by removing
 * the toast with that tag and group from the notification history.
 *
 * Secrets (Secrets Store): WNS_PACKAGE_SID, WNS_CLIENT_SECRET. Missing → log-only.
 */
import type { AlertPush, PushMessage, PushProvider, PushResult, PushTarget } from '../provider';
import { bodyText, readSecret, type FetchLike, type SecretBinding } from './common';

export interface WnsEnv {
  WNS_PACKAGE_SID?: SecretBinding;
  WNS_CLIENT_SECRET?: SecretBinding;
}

export const WNS_TOKEN_URL = 'https://login.live.com/accesstoken.srf';
export const WNS_REVIEW_GROUP = 'review';

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export function resetWnsTokenCache(): void {
  tokenCache.clear();
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const xmlEscape = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);

/** WNS tags are at most 16 characters: the first 16 hex digits of the review id's SHA-256. */
export async function wnsTag(reviewId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(reviewId)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function reviewToastXml(alert: AlertPush): string {
  const launch = xmlEscape(alert.actionUrl ?? '');
  const id = xmlEscape(alert.reviewId);
  return (
    `<toast launch="${launch}" scenario="urgent">` +
    `<visual><binding template="ToastGeneric"><text>${xmlEscape(alert.title ?? '')}</text><text>${xmlEscape(alert.body ?? '')}</text></binding></visual>` +
    `<actions><action content="${xmlEscape(alert.openLabel ?? 'Open')}" arguments="open:${id}" activationType="foreground"/><action content="${xmlEscape(alert.claimLabel ?? 'Claim')}" arguments="claim:${id}" activationType="foreground"/></actions>` +
    `</toast>`
  );
}

export class WnsPushProvider implements PushProvider {
  readonly name = 'wns';
  private creds: Promise<{ sid: string; secret: string } | null> | null = null;

  constructor(
    private readonly env: WnsEnv,
    private readonly fallback: PushProvider,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    private readonly clock: () => number = Date.now,
  ) {}

  private credentials() {
    this.creds ??= (async () => {
      const [sid, secret] = await Promise.all([readSecret(this.env.WNS_PACKAGE_SID), readSecret(this.env.WNS_CLIENT_SECRET)]);
      return sid && secret ? { sid: sid.trim(), secret: secret.trim() } : null;
    })();
    return this.creds;
  }

  private async accessToken(creds: { sid: string; secret: string }): Promise<string> {
    const now = this.clock();
    const cached = tokenCache.get(creds.sid);
    if (cached && cached.expiresAt - 300_000 > now) return cached.accessToken;
    const res = await this.fetchImpl(WNS_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.sid, client_secret: creds.secret, scope: 'notify.windows.com' }).toString(),
    });
    if (!res.ok) throw new Error(`WNS OAuth token refused (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('WNS OAuth answer has no access_token');
    tokenCache.set(creds.sid, { accessToken: body.access_token, expiresAt: now + (body.expires_in ?? 86400) * 1000 });
    return body.access_token;
  }

  private async post(target: PushTarget, headers: Record<string, string>, body: string): Promise<PushResult | 'not_configured'> {
    const creds = await this.credentials();
    if (!creds) return 'not_configured';
    let token: string;
    try {
      token = await this.accessToken(creds);
    } catch (error) {
      return { ok: false, invalidToken: false, error: error instanceof Error ? error.message : String(error) };
    }
    const res = await this.fetchImpl(target.token, { method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers }, body });
    if (res.ok) return { ok: true };
    if (res.status === 401) tokenCache.delete(creds.sid);
    // 404: the channel URI is not valid; 410: the channel expired. Either way the device must re-register
    return { ok: false, invalidToken: res.status === 404 || res.status === 410, error: `${res.status} ${(res.headers.get('x-wns-error-description') ?? (await bodyText(res))).slice(0, 200)}` };
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    // The app renders the text from its own strings: a raw notification with the key and params
    const result = await this.post(
      target,
      { 'x-wns-type': 'wns/raw', 'content-type': 'application/octet-stream', 'x-wns-ttl': '86400' },
      JSON.stringify({ kind: 'notification', notificationId: message.notificationId, key: message.notificationKey, params: message.params, ...(message.actionUrl ? { url: message.actionUrl } : {}) }),
    );
    return result === 'not_configured' ? this.fallback.send(target, message) : result;
  }

  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    const ttl = String(alert.ttlSeconds);
    const result =
      alert.kind === 'alert'
        ? await this.post(
            target,
            { 'x-wns-type': 'wns/toast', 'content-type': 'text/xml', 'x-wns-tag': await wnsTag(alert.reviewId), 'x-wns-group': WNS_REVIEW_GROUP, 'x-wns-ttl': ttl },
            reviewToastXml(alert),
          )
        : await this.post(
            target,
            { 'x-wns-type': 'wns/raw', 'content-type': 'application/octet-stream', 'x-wns-ttl': ttl },
            JSON.stringify({ kind: 'review_clear', reviewId: alert.reviewId, tag: await wnsTag(alert.reviewId), group: WNS_REVIEW_GROUP }),
          );
    return result === 'not_configured' ? this.fallback.sendAlert(target, alert) : result;
  }
}
