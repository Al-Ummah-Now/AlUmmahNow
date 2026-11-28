/**
 * Web Push sender (#1287): RFC 8291 aes128gcm payloads and RFC 8292 VAPID.
 *
 * The browser side is played by node:crypto (a separate implementation from the sender's
 * WebCrypto code): it holds the subscription's private key and auth secret and decrypts what
 * the sender posts. Requests go to a recording fetch; nothing reaches a push service.
 */
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { LogOnlyPushProvider, type AlertPush, type PushMessage, type PushProvider, type PushResult, type PushTarget } from '../push/provider';
import { base64url } from '../push/senders/common';
import { wnsTag } from '../push/senders/wns';
import {
  MAX_PLAINTEXT_BYTES,
  VAPID_SUBJECT,
  WebPushProvider,
  encryptWebPush,
  fromBase64url,
  importVapidKeys,
  normalizePrivateScalar,
  parseSubscription,
  resetVapidJwtCache,
} from '../push/senders/webpush';

/** A browser's push subscription: its ECDH key pair and auth secret. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc:def';
  const token = JSON.stringify({ endpoint, keys: { p256dh: base64url(ecdh.getPublicKey()), auth: base64url(auth) } });
  /** RFC 8291 §3.4 / RFC 8188 on the receiving side. */
  function decrypt(body: Buffer): string {
    const salt = body.subarray(0, 16);
    const rs = body.readUInt32BE(16);
    const idlen = body[20]!;
    const senderPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    expect(rs).toBe(4096);
    expect(idlen).toBe(65);
    const secret = ecdh.computeSecret(senderPublic);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    // One final record: the delimiter 0x02 ends it (no padding)
    expect(plain[plain.length - 1]).toBe(2);
    return plain.subarray(0, plain.length - 1).toString('utf8');
  }
  return { token, endpoint, decrypt };
}

/** A VAPID key pair in the `web-push generate-vapid-keys` format. */
function vapidPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: base64url(ecdh.getPublicKey()), privateKey: base64url(ecdh.getPrivateKey()) };
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

function recorder(answer: (url: string) => { status: number; body?: string } = () => ({ status: 201 })) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    sent.push({ url, headers: init!.headers as Record<string, string>, body: Buffer.from(init!.body as ArrayBuffer) });
    const a = answer(url);
    return new Response(a.body ?? '', { status: a.status });
  };
  return { sent, fetchImpl };
}

class Counting implements PushProvider {
  readonly name = 'counting';
  sends = 0;
  alerts = 0;
  async send(): Promise<PushResult> {
    this.sends++;
    return { ok: true };
  }
  async sendAlert(): Promise<PushResult> {
    this.alerts++;
    return { ok: true };
  }
}

const target = (token: string, locale: string | null = 'ar'): PushTarget => ({ installId: 'web-1', userId: 'u1', app: 'viewer', platform: 'web', provider: 'webpush', token, locale });
const message: PushMessage = { notificationId: 'n1', notificationKey: 'newVideo', category: 'new_videos', params: { channelName: 'Channel', channelName_ar: 'القناة', videoTitle: 'Title' }, actionUrl: '/video/v1' };
const alert: AlertPush = { kind: 'alert', reviewId: 'rev-1', title: 'Review queue', body: 'Video held for review · NSFW · 9 min left', actionUrl: '/moderation/review/rev-1', ttlSeconds: 600 };

beforeEach(() => resetVapidJwtCache());

describe('RFC 8291 encryption', () => {
  it('a browser decrypts what the sender encrypts (fresh salt and key pair every time)', async () => {
    const b = browser();
    const sub = parseSubscription(b.token)!;
    const text = 'When I grow up, I want to be a watermelon — مرحبا';
    const one = Buffer.from(await encryptWebPush(new TextEncoder().encode(text), sub.p256dh, sub.auth));
    const two = Buffer.from(await encryptWebPush(new TextEncoder().encode(text), sub.p256dh, sub.auth));
    expect(b.decrypt(one)).toBe(text);
    expect(b.decrypt(two)).toBe(text);
    expect(one.subarray(0, 16).equals(two.subarray(0, 16))).toBe(false);
    expect(one.subarray(21, 86).equals(two.subarray(21, 86))).toBe(false);
  });

  it('a different browser cannot read it', async () => {
    const a = browser();
    const b = browser();
    const sub = parseSubscription(a.token)!;
    const body = Buffer.from(await encryptWebPush(new TextEncoder().encode('secret'), sub.p256dh, sub.auth));
    expect(() => b.decrypt(body)).toThrow();
  });

  it('refuses a payload that does not fit one 4096-byte record', async () => {
    const sub = parseSubscription(browser().token)!;
    await expect(encryptWebPush(new Uint8Array(4000), sub.p256dh, sub.auth)).rejects.toThrow('too large');
  });

  it('only a real subscription is accepted', () => {
    const good = JSON.parse(browser().token);
    expect(parseSubscription(JSON.stringify(good))).not.toBeNull();
    expect(parseSubscription('not json')).toBeNull();
    expect(parseSubscription(JSON.stringify({ ...good, endpoint: 'https://other.example.test/endpoint' }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ ...good, endpoint: 'http://fcm.googleapis.com/x' }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ ...good, keys: { ...good.keys, auth: base64url(new Uint8Array(8)) } }))).toBeNull();
    expect(parseSubscription(JSON.stringify({ ...good, keys: { ...good.keys, p256dh: base64url(new Uint8Array(65)) } }))).toBeNull();
  });
});

describe('VAPID', () => {
  it('signs an ES256 JWT for the push service origin and sends the public key with it', async () => {
    const keys = vapidPair();
    const b = browser();
    const now = 1_800_000_000_000;
    const { sent, fetchImpl } = recorder();
    const provider = new WebPushProvider({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: { get: async () => keys.privateKey } }, new LogOnlyPushProvider(), fetchImpl, () => now);
    expect(await provider.send(target(b.token), message)).toEqual({ ok: true });
    const auth = sent[0]!.headers.authorization!;
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt!.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: VAPID_SUBJECT });
    // The signature verifies with the public key (raw r ‖ s, as JWS wants)
    const pub = fromBase64url(keys.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33)) }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'))).toBe(true);
  });

  it('reuses the JWT per origin until an hour before it expires', async () => {
    const keys = vapidPair();
    const b = browser();
    let now = 1_800_000_000_000;
    const { sent, fetchImpl } = recorder();
    const provider = new WebPushProvider({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }, new LogOnlyPushProvider(), fetchImpl, () => now);
    await provider.send(target(b.token), message);
    now += 10 * 3600 * 1000;
    await provider.send(target(b.token), message);
    now += 2 * 3600 * 1000;
    await provider.send(target(b.token), message);
    const jwts = sent.map((s) => s.headers.authorization);
    expect(jwts[0]).toBe(jwts[1]);
    expect(jwts[2]).not.toBe(jwts[1]);
  });

  it('rejects keys in the wrong format', async () => {
    const keys = vapidPair();
    await expect(importVapidKeys(keys.publicKey, base64url(new Uint8Array(31)))).rejects.toThrow('VAPID_PRIVATE_KEY');
    await expect(importVapidKeys(keys.publicKey, '')).rejects.toThrow('VAPID_PRIVATE_KEY');
    await expect(importVapidKeys(keys.publicKey, base64url(new Uint8Array(33).fill(7)))).rejects.toThrow('VAPID_PRIVATE_KEY');
    await expect(importVapidKeys(base64url(new Uint8Array(65)), keys.privateKey)).rejects.toThrow('VAPID_PUBLIC_KEY');
  });

  // #1444: a valid key whose scalar starts with zero bytes arrives short (Node's getPrivateKey() and
  // other integer printers drop them; ~1 key in 256) or with an ASN.1 sign byte. Each form must sign
  // a JWT that verifies with the public key. Fixed scalars, so this never depends on luck.
  describe('private keys with leading zero bytes (#1444)', () => {
    const scalar = (zeros: number, fill: number) => Buffer.concat([Buffer.alloc(zeros), Buffer.alloc(32 - zeros, fill)]);
    const pairFor = (d: Buffer) => {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(d);
      return { publicKey: base64url(ecdh.getPublicKey()), d };
    };
    const cases: [string, Buffer, (d: Buffer) => Buffer][] = [
      ['one leading zero, sent as 31 bytes', scalar(1, 0x11), (d) => d.subarray(1)],
      ['one leading zero, sent as 32 bytes', scalar(1, 0x11), (d) => d],
      ['two leading zeros, sent as 30 bytes', scalar(2, 0x22), (d) => d.subarray(2)],
      ['a full scalar with an ASN.1 sign byte, 33 bytes', scalar(0, 0x81), (d) => Buffer.concat([Buffer.alloc(1), d])],
    ];

    it.each(cases)('%s: imported and its JWT verifies', async (_name, d, encode) => {
      const { publicKey } = pairFor(d);
      resetVapidJwtCache();
      const b = browser();
      const { sent, fetchImpl } = recorder();
      const provider = new WebPushProvider({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: base64url(encode(d)) }, new LogOnlyPushProvider(), fetchImpl, () => 1_800_000_000_000);
      expect(await provider.send(target(b.token), message)).toEqual({ ok: true });
      const [, jwt] = /^vapid t=([^,]+), k=/.exec(sent[0]!.headers.authorization!)!;
      const [h, c, sig] = jwt!.split('.');
      const pub = fromBase64url(publicKey);
      const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33)) }, format: 'jwk' });
      expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'))).toBe(true);
    });

    it('normalizePrivateScalar left-pads short scalars, trims sign bytes and refuses the rest', () => {
      const full = scalar(1, 0x11);
      expect(Buffer.from(normalizePrivateScalar(full.subarray(1))!)).toEqual(full);
      expect(Buffer.from(normalizePrivateScalar(Buffer.concat([Buffer.alloc(2), full]))!)).toEqual(full);
      expect(normalizePrivateScalar(new Uint8Array(0))).toBeNull();
      expect(normalizePrivateScalar(new Uint8Array(32))).toBeNull();
      expect(normalizePrivateScalar(new Uint8Array(33).fill(1))).toBeNull();
    });
  });
});

describe('WebPushProvider', () => {
  const keys = vapidPair();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };

  it('a notification carries the key, params and device language for the service worker', async () => {
    const b = browser();
    const { sent, fetchImpl } = recorder();
    await new WebPushProvider(env, new LogOnlyPushProvider(), fetchImpl).send(target(b.token), message);
    const req = sent[0]!;
    expect(req.url).toBe(b.endpoint);
    expect(req.headers).toMatchObject({ 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'normal' });
    expect(req.headers.topic).toBeUndefined();
    expect(JSON.parse(b.decrypt(req.body))).toEqual({ kind: 'notification', notificationId: 'n1', key: 'newVideo', lang: 'ar', url: '/video/v1', params: message.params });
  });

  it('params too large for one push are dropped (the worker shows the generic line)', async () => {
    const b = browser();
    const { sent, fetchImpl } = recorder();
    await new WebPushProvider(env, new LogOnlyPushProvider(), fetchImpl).send(target(b.token, null), { ...message, params: { videoTitle: 'x'.repeat(MAX_PLAINTEXT_BYTES) } });
    expect(JSON.parse(b.decrypt(sent[0]!.body))).toEqual({ kind: 'notification', notificationId: 'n1', key: 'newVideo', url: '/video/v1' });
  });

  it('a review alert is urgent, rendered, and collapses by topic; a clear names the review', async () => {
    const b = browser();
    const { sent, fetchImpl } = recorder();
    const provider = new WebPushProvider(env, new LogOnlyPushProvider(), fetchImpl);
    await provider.sendAlert(target(b.token), alert);
    await provider.sendAlert(target(b.token), { kind: 'clear', reviewId: 'rev-1', ttlSeconds: 3600 });
    expect(sent[0]!.headers).toMatchObject({ ttl: '600', urgency: 'high', topic: await wnsTag('rev-1') });
    expect(JSON.parse(b.decrypt(sent[0]!.body))).toEqual({ kind: 'review_alert', reviewId: 'rev-1', title: alert.title, body: alert.body, url: alert.actionUrl });
    expect(sent[1]!.headers).toMatchObject({ ttl: '3600', urgency: 'normal' });
    expect(JSON.parse(b.decrypt(sent[1]!.body))).toEqual({ kind: 'review_clear', reviewId: 'rev-1' });
  });

  it('gone subscriptions are pruned, busy services retried, a refused JWT is neither', async () => {
    const b = browser();
    for (const [status, invalidToken, retryable] of [[410, true, false], [404, true, false], [429, false, true], [503, false, true], [403, false, false], [413, false, false]] as const) {
      const { fetchImpl } = recorder(() => ({ status, body: 'nope' }));
      expect(await new WebPushProvider(env, new LogOnlyPushProvider(), fetchImpl).send(target(b.token), message)).toEqual({ ok: false, invalidToken, retryable, error: `${status} nope` });
    }
  });

  it('treats a push service redirect as a failed send', async () => {
    const b = browser();
    const fetcher = jest.fn(async () =>
      Response.redirect('https://push.example.test/other-subscription', 307));
    const provider = new WebPushProvider(env, new LogOnlyPushProvider(), fetcher);
    expect(await provider.send(target(b.token), message)).toMatchObject({ ok: false, invalidToken: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(b.endpoint, expect.objectContaining({ redirect: 'manual' }));
  });

  it('a stored token that is not a subscription is pruned without a request', async () => {
    const { sent, fetchImpl } = recorder();
    expect(await new WebPushProvider(env, new LogOnlyPushProvider(), fetchImpl).send(target('{"endpoint":"x"}'), message)).toMatchObject({ ok: false, invalidToken: true });
    expect(sent).toEqual([]);
  });

  it('missing, placeholder or unreadable keys keep it log-only (no request)', async () => {
    const b = browser();
    for (const e of [{}, { VAPID_PUBLIC_KEY: 'placeholder', VAPID_PRIVATE_KEY: 'placeholder' }, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: { get: async () => { throw new Error('no such secret'); } } }, { VAPID_PUBLIC_KEY: 'garbage', VAPID_PRIVATE_KEY: 'garbage' }]) {
      const fallback = new Counting();
      const { sent, fetchImpl } = recorder();
      const provider = new WebPushProvider(e, fallback, fetchImpl);
      expect(await provider.send(target(b.token), message)).toEqual({ ok: true });
      expect(await provider.sendAlert(target(b.token), alert)).toEqual({ ok: true });
      expect(fallback).toMatchObject({ sends: 1, alerts: 1 });
      expect(sent).toEqual([]);
    }
  });
});
