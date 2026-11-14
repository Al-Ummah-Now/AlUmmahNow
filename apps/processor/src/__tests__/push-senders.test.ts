/**
 * Real push senders (#414) against a local mock push server: APNs (ES256 provider token,
 * HTTP/2 headers), FCM HTTP v1 (service-account OAuth), WNS (client credentials, toast).
 * Every request goes to 127.0.0.1; nothing reaches Apple, Google or Microsoft.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger } from '@al-ummah/logger';
import { LogOnlyPushProvider, resolvePushProviders, type AlertPush, type PushMessage, type PushProvider, type PushTarget } from '../push/provider';
import { ApnsPushProvider, APNS_TOKEN_RENEW_SECONDS, bundleIdFor, resetApnsTokenCache } from '../push/senders/apns';
import { FcmPushProvider, FCM_SCOPE, resetFcmTokenCache } from '../push/senders/fcm';
import { WnsPushProvider, resetWnsTokenCache, reviewToastXml, wnsTag, xmlEscape } from '../push/senders/wns';
import { isPlaceholder } from '../push/senders/common';
import { handleReviewAlert } from '../review-alerts/consumer';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

interface Seen {
  host: string;
  path: string;
  method: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Responder = (req: Seen) => { status: number; body?: unknown; headers?: Record<string, string> };

/** One local server standing in for every push host; the original host is the first path segment. */
class MockPushServer {
  seen: Seen[] = [];
  responders = new Map<string, Responder>();
  private server!: Server;
  port = 0;

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const [, host, ...rest] = (req.url ?? '').split('/');
        const seen: Seen = { host: host ?? '', path: `/${rest.join('/')}`, method: req.method ?? '', headers: req.headers, body };
        this.seen.push(seen);
        const responder = this.responders.get(seen.host);
        const answer = typeof responder === 'function' ? responder(seen) : { status: 200, body: {} };
        res.writeHead(answer.status, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
        res.end(answer.body === undefined ? '' : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  /** The senders' fetch, pointed at this server. */
  fetch = (input: string, init?: RequestInit) => {
    const u = new URL(input);
    return fetch(`http://127.0.0.1:${this.port}/${u.host}${u.pathname}${u.search}`, init);
  };
  on(host: string): Seen[] {
    return this.seen.filter((s) => s.host === host);
  }
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const pem = (der: ArrayBuffer, label = 'PRIVATE KEY') => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----\n`;

async function verifyJwt(jwt: string, key: CryptoKey, algorithm: AlgorithmIdentifier | EcdsaParams) {
  const [h, p, sig] = jwt.split('.');
  const ok = await crypto.subtle.verify(algorithm, key, b64urlDecode(sig!), new TextEncoder().encode(`${h}.${p}`));
  return { ok, header: JSON.parse(b64urlDecode(h!).toString()), claims: JSON.parse(b64urlDecode(p!).toString()) };
}

class Counting implements PushProvider {
  readonly name = 'fallback';
  sends = 0;
  alerts = 0;
  async send() {
    this.sends++;
    return { ok: true as const };
  }
  async sendAlert() {
    this.alerts++;
    return { ok: true as const };
  }
}

const APNS_TOKEN = 'ab'.repeat(32);
const target = (over: Partial<PushTarget> = {}): PushTarget => ({ installId: 'install-1', userId: 'u1', app: 'admin', platform: 'ios', provider: 'apns', token: APNS_TOKEN, locale: 'en', ...over });
const alert: AlertPush = { kind: 'alert', reviewId: 'rev-1', title: 'Review queue', body: 'Video held for review · NSFW · 4 min left', openLabel: 'Open', claimLabel: 'Claim', actionUrl: '/moderation/review/rev-1', ttlSeconds: 600 };
const clear: AlertPush = { kind: 'clear', reviewId: 'rev-1', ttlSeconds: 3600 };
const message: PushMessage = { notificationId: 'n-1', notificationKey: 'newVideo', category: 'new_videos', params: { title: 'x' }, actionUrl: '/watch/v1' };

const server = new MockPushServer();
beforeAll(() => server.start());
afterAll(() => server.stop());
beforeEach(() => {
  server.seen = [];
  server.responders.clear();
  resetApnsTokenCache();
  resetFcmTokenCache();
  resetWnsTokenCache();
});

describe('secrets', () => {
  it('missing, empty or placeholder secrets keep every provider log-only (no request)', async () => {
    expect(isPlaceholder('placeholder')).toBe(true);
    expect(isPlaceholder('PLACEHOLDER: owner supplies')).toBe(true);
    expect(isPlaceholder('real')).toBe(false);
    const fallback = new Counting();
    const env = { APNS_KEY_P8: { get: async () => 'placeholder' }, APNS_KEY_ID: 'K', APPLE_TEAM_ID: 'T', APNS_BUNDLE_IDS: '{}', FCM_SERVICE_ACCOUNT: '', WNS_PACKAGE_SID: { get: async () => { throw new Error('no such secret'); } }, WNS_CLIENT_SECRET: 'x' };
    for (const p of [new ApnsPushProvider(env, fallback, server.fetch), new FcmPushProvider(env, fallback, server.fetch), new WnsPushProvider(env, fallback, server.fetch)]) {
      expect(await p.sendAlert(target(), alert)).toEqual({ ok: true });
      expect(await p.send(target(), message)).toEqual({ ok: true });
    }
    expect(fallback).toMatchObject({ alerts: 3, sends: 3 });
    expect(server.seen).toEqual([]);
    const providers = resolvePushProviders();
    expect(Object.values(providers).every((p) => p instanceof LogOnlyPushProvider)).toBe(true);
  });
});

describe('APNs', () => {
  let keys: CryptoKeyPair;
  let env: Record<string, string>;
  beforeAll(async () => {
    keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  });
  beforeEach(async () => {
    env = {
      APNS_KEY_P8: pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
      APNS_KEY_ID: 'ABC123DEFG',
      APPLE_TEAM_ID: 'TEAM123456',
      APNS_BUNDLE_IDS: JSON.stringify({ viewer: 'net.alummahnow.app', studio: 'net.alummahnow.studio', admin: { ios: 'net.alummahnow.admin', ipados: 'net.alummahnow.admin', macos: 'net.alummahnow.admin.mac' } }),
    };
  });

  it('review alert: time-sensitive, topic = the app’s bundle id, collapse id = review id, ES256 provider token', async () => {
    const apns = new ApnsPushProvider(env, new Counting(), server.fetch, () => 1_800_000_000_000);
    expect(await apns.sendAlert(target(), alert)).toEqual({ ok: true });
    const [req] = server.on('api.push.apple.com');
    expect(req).toMatchObject({ method: 'POST', path: `/3/device/${APNS_TOKEN}` });
    expect(req!.headers).toMatchObject({ 'apns-topic': 'net.alummahnow.admin', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'rev-1', 'apns-expiration': String(1_800_000_000 + 600) });
    expect(JSON.parse(req!.body)).toEqual({
      aps: { alert: { title: 'Review queue', body: 'Video held for review · NSFW · 4 min left' }, sound: 'default', 'interruption-level': 'time-sensitive', 'thread-id': 'review-queue', category: 'REVIEW_ALERT' },
      reviewId: 'rev-1',
      url: '/moderation/review/rev-1',
    });
    const jwt = String(req!.headers.authorization).replace(/^bearer /, '');
    const v = await verifyJwt(jwt, keys.publicKey, { name: 'ECDSA', hash: 'SHA-256' });
    expect(v).toEqual({ ok: true, header: { alg: 'ES256', kid: 'ABC123DEFG' }, claims: { iss: 'TEAM123456', iat: 1_800_000_000 } });
  });

  it('per app and platform topics: macOS Admin, Studio, viewer; an app without a bundle id stays log-only', async () => {
    const fallback = new Counting();
    const apns = new ApnsPushProvider({ ...env, APNS_BUNDLE_IDS: JSON.stringify({ admin: { macos: 'net.alummahnow.admin.mac' }, studio: 'net.alummahnow.studio' }) }, fallback, server.fetch);
    await apns.sendAlert(target({ platform: 'macos' }), alert);
    await apns.send(target({ app: 'studio' }), message);
    await apns.send(target({ app: 'viewer' }), message);
    expect(server.on('api.push.apple.com').map((r) => r.headers['apns-topic'])).toEqual(['net.alummahnow.admin.mac', 'net.alummahnow.studio']);
    expect(fallback.sends).toBe(1);
    expect(bundleIdFor({ admin: { default: 'd' } }, { app: 'admin', platform: 'ipados' })).toBe('d');
  });

  it('clear: a silent background push at priority 5', async () => {
    const apns = new ApnsPushProvider(env, new Counting(), server.fetch);
    await apns.sendAlert(target(), clear);
    const [req] = server.on('api.push.apple.com');
    expect(req!.headers).toMatchObject({ 'apns-push-type': 'background', 'apns-priority': '5' });
    expect(req!.headers['apns-collapse-id']).toBeUndefined();
    expect(JSON.parse(req!.body)).toEqual({ aps: { 'content-available': 1 }, clear: 'rev-1' });
  });

  it('the provider token is cached, renewed after 40 min, and dropped when APNs refuses it', async () => {
    let now = 1_800_000_000_000;
    const apns = new ApnsPushProvider(env, new Counting(), server.fetch, () => now);
    const auth = () => server.on('api.push.apple.com').map((r) => r.headers.authorization);
    await apns.sendAlert(target(), alert);
    now += (APNS_TOKEN_RENEW_SECONDS - 1) * 1000;
    await apns.sendAlert(target(), alert);
    expect(new Set(auth()).size).toBe(1);
    now += 2000;
    await apns.sendAlert(target(), alert);
    expect(new Set(auth()).size).toBe(2);
    server.responders.set('api.push.apple.com', () => ({ status: 403, body: { reason: 'ExpiredProviderToken' } }));
    now += 1000;
    expect(await apns.sendAlert(target(), alert)).toEqual({ ok: false, invalidToken: false, error: '403 ExpiredProviderToken' });
    server.responders.clear();
    await apns.sendAlert(target(), alert);
    expect(new Set(auth()).size).toBe(3);
  });

  it('dead tokens are reported for pruning; a topic mismatch is not', async () => {
    const apns = new ApnsPushProvider(env, new Counting(), server.fetch);
    for (const [status, reason, invalid] of [[410, 'Unregistered', true], [400, 'BadDeviceToken', true], [400, 'DeviceTokenNotForTopic', false], [429, 'TooManyRequests', false]] as const) {
      server.responders.set('api.push.apple.com', () => ({ status, body: { reason } }));
      expect(await apns.sendAlert(target(), alert)).toEqual({ ok: false, invalidToken: invalid, error: `${status} ${reason}` });
    }
  });

  it('APNS_SANDBOX=true uses the development host', async () => {
    await new ApnsPushProvider({ ...env, APNS_SANDBOX: 'true' }, new Counting(), server.fetch).sendAlert(target(), alert);
    expect(server.seen.map((s) => s.host)).toEqual(['api.sandbox.push.apple.com']);
  });
});

describe('FCM HTTP v1', () => {
  let keys: CryptoKeyPair;
  let env: Record<string, string>;
  beforeAll(async () => {
    keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  });
  beforeEach(async () => {
    env = { FCM_SERVICE_ACCOUNT: JSON.stringify({ type: 'service_account', project_id: 'alummahnow-test', client_email: 'push@alummahnow-test.iam.gserviceaccount.com', private_key: pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey)), token_uri: 'https://evil.example/token' }) };
    server.responders.set('oauth2.googleapis.com', () => ({ status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } }));
  });

  it('exchanges a signed RS256 assertion once (only at Google), then sends a high-priority alert on the review_queue channel', async () => {
    const fcm = new FcmPushProvider(env, new Counting(), server.fetch);
    const t = target({ provider: 'fcm', platform: 'android', token: 'fcm-token' });
    expect(await fcm.sendAlert(t, alert)).toEqual({ ok: true });
    expect(await fcm.sendAlert(t, clear)).toEqual({ ok: true });
    const [tokenReq, ...rest] = server.seen;
    expect(tokenReq!.host).toBe('oauth2.googleapis.com');
    const form = new URLSearchParams(tokenReq!.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const v = await verifyJwt(form.get('assertion')!, keys.publicKey, 'RSASSA-PKCS1-v1_5');
    expect(v.ok).toBe(true);
    expect(v.claims).toMatchObject({ iss: 'push@alummahnow-test.iam.gserviceaccount.com', scope: FCM_SCOPE, aud: 'https://oauth2.googleapis.com/token' });
    expect(rest.map((r) => [r.host, r.path, r.headers.authorization])).toEqual([
      ['fcm.googleapis.com', '/v1/projects/alummahnow-test/messages:send', 'Bearer ya29.test'],
      ['fcm.googleapis.com', '/v1/projects/alummahnow-test/messages:send', 'Bearer ya29.test'],
    ]);
    expect(JSON.parse(rest[0]!.body)).toEqual({
      message: {
        token: 'fcm-token',
        data: { kind: 'review_alert', reviewId: 'rev-1', url: '/moderation/review/rev-1' },
        android: { priority: 'HIGH', ttl: '600s', collapse_key: 'rev-1', notification: { channel_id: 'review_queue', title: 'Review queue', body: 'Video held for review · NSFW · 4 min left', tag: 'rev-1', notification_priority: 'PRIORITY_HIGH' } },
      },
    });
    expect(JSON.parse(rest[1]!.body).message).toEqual({ token: 'fcm-token', data: { kind: 'review_clear', reviewId: 'rev-1' }, android: { priority: 'HIGH', ttl: '3600s' } });
  });

  it('UNREGISTERED tokens are pruned; FCM_PROJECT_ID overrides the JSON’s project', async () => {
    server.responders.set('fcm.googleapis.com', () => ({ status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }));
    const fcm = new FcmPushProvider({ ...env, FCM_PROJECT_ID: 'other-project' }, new Counting(), server.fetch);
    const res = await fcm.sendAlert(target({ provider: 'fcm', platform: 'android', token: 'gone' }), alert);
    expect(res).toMatchObject({ ok: false, invalidToken: true });
    expect(server.on('fcm.googleapis.com')[0]!.path).toBe('/v1/projects/other-project/messages:send');
  });

  it('an OAuth failure is a send failure, not a dead token', async () => {
    server.responders.set('oauth2.googleapis.com', () => ({ status: 400, body: { error: 'invalid_grant' } }));
    const res = await new FcmPushProvider(env, new Counting(), server.fetch).sendAlert(target({ provider: 'fcm', token: 't' }), alert);
    expect(res).toEqual({ ok: false, invalidToken: false, error: 'FCM OAuth token refused (400)' });
  });
});

describe('WNS', () => {
  const env = { WNS_PACKAGE_SID: 'ms-app://s-1-15-2-123', WNS_CLIENT_SECRET: 'secret' };
  const channel = 'https://db5p.notify.windows.com/w/?token=AwYAAAB';
  beforeEach(() => {
    server.responders.set('login.live.com', () => ({ status: 200, body: { access_token: 'EgAcAQMAAAAALYAAY', token_type: 'bearer', expires_in: 86400 } }));
  });

  it('client-credentials token, then a toast in the review group with a 16-character tag', async () => {
    const wns = new WnsPushProvider(env, new Counting(), server.fetch);
    const t = target({ provider: 'wns', platform: 'windows', token: channel });
    expect(await wns.sendAlert(t, { ...alert, title: 'A & <B>' })).toEqual({ ok: true });
    const [tokenReq, toast] = server.seen;
    expect(Object.fromEntries(new URLSearchParams(tokenReq!.body))).toEqual({ grant_type: 'client_credentials', client_id: env.WNS_PACKAGE_SID, client_secret: 'secret', scope: 'notify.windows.com' });
    expect(toast!.host).toBe('db5p.notify.windows.com');
    expect(toast!.headers).toMatchObject({ authorization: 'Bearer EgAcAQMAAAAALYAAY', 'x-wns-type': 'wns/toast', 'x-wns-group': 'review', 'x-wns-ttl': '600' });
    expect(String(toast!.headers['x-wns-tag'])).toHaveLength(16);
    expect(toast!.headers['x-wns-tag']).toBe(await wnsTag('rev-1'));
    expect(toast!.body).toContain('<text>A &amp; &lt;B&gt;</text>');
    expect(toast!.body).toContain('scenario="urgent"');
    expect(toast!.body).toContain('arguments="claim:rev-1"');
  });

  it('clear is a raw notification with the tag and group to remove', async () => {
    await new WnsPushProvider(env, new Counting(), server.fetch).sendAlert(target({ provider: 'wns', token: channel }), clear);
    const raw = server.on('db5p.notify.windows.com')[0]!;
    expect(raw.headers['x-wns-type']).toBe('wns/raw');
    expect(JSON.parse(raw.body)).toEqual({ kind: 'review_clear', reviewId: 'rev-1', tag: await wnsTag('rev-1'), group: 'review' });
  });

  it('410 and 404 channels are pruned', async () => {
    const wns = new WnsPushProvider(env, new Counting(), server.fetch);
    for (const [status, invalid] of [[410, true], [404, true], [406, false]] as const) {
      server.responders.set('db5p.notify.windows.com', () => ({ status, headers: { 'x-wns-error-description': 'x' } }));
      expect(await wns.sendAlert(target({ provider: 'wns', token: channel }), alert)).toMatchObject({ ok: false, invalidToken: invalid });
    }
  });

  it('toast XML escapes everything', () => {
    expect(xmlEscape(`"<'&>"`)).toBe('&quot;&lt;&apos;&amp;&gt;&quot;');
    expect(reviewToastXml({ ...alert, openLabel: 'فتح', claimLabel: 'استلام' })).toContain('content="استلام"');
  });
});

describe('end to end: a held item reaches an Admin iPhone through the APNs sender', () => {
  it('pushes the rendered alert to the mock APNs server and records the alert time', async () => {
    const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const db = createSqliteD1();
    const reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
    reports.raw
      .prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('review-alerts:settings', ?, 'a', 'now')")
      .run(JSON.stringify({ enabled: true, escalateAllAfterSeconds: 120, escalateSeniorsAfterSeconds: 240, owners: [], rota: [{ userId: 'rev', senior: true, timeZone: 'UTC', shifts: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }] }] }));
    db.raw.prepare("INSERT INTO push_devices (install_id, user_id, app, platform, provider, token, locale, created_at, updated_at) VALUES ('adm-1', 'rev', 'admin', 'ios', 'apns', ?, 'ar', 0, 0)").run(APNS_TOKEN);
    const env = {
      APNS_KEY_P8: pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
      APNS_KEY_ID: 'KEY',
      APPLE_TEAM_ID: 'TEAM',
      APNS_BUNDLE_IDS: JSON.stringify({ admin: 'net.alummahnow.admin' }),
    };
    const logOnly = new LogOnlyPushProvider();
    const providers = { apns: new ApnsPushProvider(env, logOnly, server.fetch), fcm: logOnly, wns: logOnly, webpush: logOnly };
    const at = Date.now();
    const out = await handleReviewAlert({ NOTIFICATIONS_DB: db, REPORTS_DB: reports }, providers, { event: 'held', reviewId: 'rev-9', reason: 'nsfw', deadlineAt: at + 5 * 60000, at }, createLogger('t', { logLevel: 'error' }), at);
    expect(out.summary).toMatchObject({ sent: 1, reached: ['rev'] });
    const body = JSON.parse(server.on('api.push.apple.com')[0]!.body);
    expect(body.aps.alert).toEqual({ title: 'طابور المراجعة', body: 'مرئي محجوز للمراجعة · محتوى غير لائق · بقي 5 د' });
    expect((db.raw.prepare("SELECT alerted_at FROM review_alerts WHERE review_id = 'rev-9'").get() as { alerted_at: number }).alerted_at).toBe(at);
  });
});
