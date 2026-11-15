/**
 * Native app attestation (lib/attestation, routers/attestation.router.ts, AlUmmahNow#1274, NAT-REL).
 *
 * App Attest: a chain built here (test root → intermediate → credential, the nonce extension, the
 * authData App Attest sends), so the whole verification runs without Apple; the real Apple root
 * refuses it. Play Integrity: Google's token and decode endpoints are faked. Then the proof flow
 * through the router and requireHuman. No network.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { defaultMobileAppsSettings, type MobileAppsSettings } from '@al-ummah/shared-types';
import { verifyAppleAssertion, verifyAppleAttestation } from '../src/lib/attestation/apple';
import { resetPlayIntegrityToken, verifyPlayIntegrity } from '../src/lib/attestation/android';
import { decodeCbor, hex, parseCertificate, sha256 } from '../src/lib/attestation/encoding';
import { acceptProof, consumeChallenge, issueChallenge, issueProof, resetAttestationSettings, validProof } from '../src/lib/attestation/service';
import attestationRouter from '../src/routers/attestation.router';
import { requireHuman } from '../src/middleware/bot-protection';

// ---------------------------------------------------------------------------
// DER + CBOR builders
// ---------------------------------------------------------------------------

const cat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
function tlv(tag: number, value: Uint8Array): Uint8Array {
	const n = value.length;
	const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
	return cat(new Uint8Array([tag, ...len]), value);
}
const seq = (...items: Uint8Array[]) => tlv(0x30, cat(...items));
const oid = (h: string) => tlv(0x06, fromHex(h));
const int = (bytes: Uint8Array) => {
	let v = bytes;
	while (v.length > 1 && v[0] === 0 && v[1] < 0x80) v = v.slice(1);
	return tlv(0x02, v[0] >= 0x80 ? cat(new Uint8Array([0]), v) : v);
};
const utc = (d: Date) => tlv(0x17, new TextEncoder().encode(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = (cn: string) => seq(tlv(0x31, seq(oid('550403'), tlv(0x0c, new TextEncoder().encode(cn)))));

const ECDSA_SHA256 = '2a8648ce3d040302';
const ECDSA_SHA384 = '2a8648ce3d040303';
const NONCE_OID = '2a864886f763640802';

type Pair = CryptoKeyPair;
const p384 = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']) as Promise<Pair>;
const p256 = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<Pair>;

function rawToDer(raw: Uint8Array): Uint8Array {
	const half = raw.length / 2;
	return seq(int(raw.slice(0, half)), int(raw.slice(half)));
}

async function cert(opts: { subject: string; issuer: string; key: Pair; signer: CryptoKey; signerCurve: 'P-256' | 'P-384'; nonce?: Uint8Array; notAfter?: Date }) {
	const spki = new Uint8Array(await crypto.subtle.exportKey('spki', opts.key.publicKey));
	const alg = seq(oid(opts.signerCurve === 'P-384' ? ECDSA_SHA384 : ECDSA_SHA256));
	const extensions = opts.nonce ? [tlv(0xa3, seq(seq(oid(NONCE_OID), tlv(0x04, seq(tlv(0xa1, tlv(0x04, opts.nonce)))))))] : [];
	const tbs = seq(
		tlv(0xa0, int(new Uint8Array([2]))),
		int(crypto.getRandomValues(new Uint8Array(8))),
		alg,
		name(opts.issuer),
		seq(utc(new Date('2024-01-01T00:00:00Z')), utc(opts.notAfter ?? new Date('2040-01-01T00:00:00Z'))),
		name(opts.subject),
		spki,
		...extensions
	);
	const hash = opts.signerCurve === 'P-384' ? 'SHA-384' : 'SHA-256';
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash }, opts.signer, tbs));
	return seq(tbs, alg, tlv(0x03, cat(new Uint8Array([0]), rawToDer(sig))));
}

function cbor(value: unknown): Uint8Array {
	const head = (major: number, n: number) => (n < 24 ? new Uint8Array([(major << 5) | n]) : n < 256 ? new Uint8Array([(major << 5) | 24, n]) : new Uint8Array([(major << 5) | 25, n >> 8, n & 255]));
	if (value instanceof Uint8Array) return cat(head(2, value.length), value);
	if (typeof value === 'string') {
		const b = new TextEncoder().encode(value);
		return cat(head(3, b.length), b);
	}
	if (typeof value === 'number') return head(0, value);
	if (Array.isArray(value)) return cat(head(4, value.length), ...value.map(cbor));
	const entries = Object.entries(value as Record<string, unknown>);
	return cat(head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const toPem = (der: Uint8Array) => `-----BEGIN CERTIFICATE-----\n${b64(der)}\n-----END CERTIFICATE-----`;
const counterBytes = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const AAGUID_PROD = cat(new TextEncoder().encode('appattest'), new Uint8Array(7));
const AAGUID_DEV = new TextEncoder().encode('appattestdevelop');

const APP_ID = 'ABCDE12345.net.alummahnow.studio';
const CHALLENGE = 'Q2hhbGxlbmdlLWZvci10ZXN0cy0xMjM0NTY3ODkwYWI'; // 43 chars, base64url

async function device(opts: { appId?: string; challenge?: string; aaguid?: Uint8Array; counter?: number } = {}) {
	const root = await p384();
	const intermediate = await p384();
	const credential = await p256();
	const point = new Uint8Array(await crypto.subtle.exportKey('raw', credential.publicKey));
	const keyId = await sha256(point);
	const authData = cat(
		await sha256(opts.appId ?? APP_ID),
		new Uint8Array([0x40]),
		counterBytes(opts.counter ?? 0),
		opts.aaguid ?? AAGUID_PROD,
		new Uint8Array([0, 32]),
		keyId
	);
	const nonce = await sha256(cat(authData, await sha256(opts.challenge ?? CHALLENGE)));
	const rootDer = await cert({ subject: 'Test Root', issuer: 'Test Root', key: root, signer: root.privateKey, signerCurve: 'P-384' });
	const intDer = await cert({ subject: 'Test Intermediate', issuer: 'Test Root', key: intermediate, signer: root.privateKey, signerCurve: 'P-384' });
	const credDer = await cert({ subject: 'credential', issuer: 'Test Intermediate', key: credential, signer: intermediate.privateKey, signerCurve: 'P-384', nonce });
	const attestation = b64(cbor({ fmt: 'apple-appattest', attStmt: { x5c: [credDer, intDer], receipt: new Uint8Array([1]) }, authData }));
	return { rootPem: toPem(rootDer), attestation, keyId: b64(keyId), credential };
}

async function assertion(credential: Pair, counter: number, challenge = CHALLENGE, appId = APP_ID) {
	const authenticatorData = cat(await sha256(appId), new Uint8Array([0]), counterBytes(counter));
	const nonce = await sha256(cat(authenticatorData, await sha256(challenge)));
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, credential.privateKey, nonce));
	return b64(cbor({ signature: rawToDer(sig), authenticatorData }));
}

// ---------------------------------------------------------------------------

describe('CBOR and X.509 parsing', () => {
	it('decodes maps, arrays, byte and text strings', () => {
		const value = decodeCbor(cbor({ a: [1, 'x', new Uint8Array([9])] })) as Map<string, unknown>;
		assert.deepEqual(value.get('a'), [1, 'x', new Uint8Array([9])]);
		assert.throws(() => decodeCbor(new Uint8Array([0x82, 0x01])));
	});

	it('reads the real Apple root: P-384, valid to 2045', async () => {
		const { APPLE_APP_ATTESTATION_ROOT_CA_PEM } = await import('../src/lib/attestation/apple-root');
		const root = parseCertificate(Buffer.from(APPLE_APP_ATTESTATION_ROOT_CA_PEM.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64'));
		assert.equal(root.curve, 'P-384');
		assert.equal(root.notAfter.toISOString(), '2045-03-15T00:00:00.000Z');
	});
});

describe('App Attest attestation', () => {
	const now = new Date('2026-11-14T00:00:00Z');

	it('accepts a well-formed attestation chained to the root', async () => {
		const d = await device();
		const result = await verifyAppleAttestation({ keyId: d.keyId, attestation: d.attestation, challenge: CHALLENGE, appId: APP_ID, environment: 'production', now, rootPem: d.rootPem });
		assert.equal(result.ok, true);
		if (result.ok) assert.equal(result.key.appId, APP_ID);
	});

	it("refuses a chain that is not Apple's", async () => {
		const d = await device();
		const result = await verifyAppleAttestation({ keyId: d.keyId, attestation: d.attestation, challenge: CHALLENGE, appId: APP_ID, environment: 'production', now });
		assert.deepEqual(result, { ok: false, reason: 'bad_chain' });
	});

	it('refuses another challenge, another app, another key id, the dev environment, a used key', async () => {
		const d = await device();
		const base = { keyId: d.keyId, attestation: d.attestation, challenge: CHALLENGE, appId: APP_ID, environment: 'production' as const, now, rootPem: d.rootPem };
		assert.deepEqual(await verifyAppleAttestation({ ...base, challenge: CHALLENGE.replace('Q', 'R') }), { ok: false, reason: 'bad_nonce' });
		assert.deepEqual(await verifyAppleAttestation({ ...base, appId: 'ABCDE12345.net.alummahnow.viewer' }), { ok: false, reason: 'wrong_app' });
		assert.deepEqual(await verifyAppleAttestation({ ...base, keyId: b64(new Uint8Array(32)) }), { ok: false, reason: 'bad_key_id' });
		assert.deepEqual(await verifyAppleAttestation({ ...base, environment: 'development' }), { ok: false, reason: 'wrong_environment' });
		const dev = await device({ aaguid: AAGUID_DEV });
		assert.equal((await verifyAppleAttestation({ ...base, keyId: dev.keyId, attestation: dev.attestation, rootPem: dev.rootPem, environment: 'development' })).ok, true);
		const used = await device({ counter: 3 });
		assert.deepEqual(await verifyAppleAttestation({ ...base, keyId: used.keyId, attestation: used.attestation, rootPem: used.rootPem }), { ok: false, reason: 'bad_counter' });
		assert.deepEqual(await verifyAppleAttestation({ ...base, attestation: 'not-cbor' }), { ok: false, reason: 'malformed' });
	});

	it('refuses expired certificates', async () => {
		const d = await device();
		const result = await verifyAppleAttestation({ keyId: d.keyId, attestation: d.attestation, challenge: CHALLENGE, appId: APP_ID, environment: 'production', now: new Date('2041-01-01T00:00:00Z'), rootPem: d.rootPem });
		assert.deepEqual(result, { ok: false, reason: 'expired_certificate' });
	});
});

describe('App Attest assertion', () => {
	it('accepts a signed assertion with a higher counter; refuses replays, tampering and other apps', async () => {
		const d = await device();
		const attested = await verifyAppleAttestation({ keyId: d.keyId, attestation: d.attestation, challenge: CHALLENGE, appId: APP_ID, environment: 'production', now: new Date('2026-11-14T00:00:00Z'), rootPem: d.rootPem });
		assert.ok(attested.ok);
		if (!attested.ok) return;
		const first = await verifyAppleAssertion({ assertion: await assertion(d.credential, 1), challenge: CHALLENGE, key: attested.key });
		assert.deepEqual(first, { ok: true, counter: 1 });
		const replay = await verifyAppleAssertion({ assertion: await assertion(d.credential, 1), challenge: CHALLENGE, key: { ...attested.key, counter: 1 } });
		assert.deepEqual(replay, { ok: false, reason: 'bad_counter' });
		const other = await verifyAppleAssertion({ assertion: await assertion(d.credential, 2), challenge: 'another', key: attested.key });
		assert.deepEqual(other, { ok: false, reason: 'bad_signature' });
		const wrongApp = await verifyAppleAssertion({ assertion: await assertion(d.credential, 2, CHALLENGE, 'X.y.z'), challenge: CHALLENGE, key: attested.key });
		assert.deepEqual(wrongApp, { ok: false, reason: 'wrong_app' });
	});
});

// ---------------------------------------------------------------------------

async function serviceAccount() {
	const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	return JSON.stringify({ client_email: 'integrity@project.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${b64(pkcs8)}\n-----END PRIVATE KEY-----\n` }); // secret-scan:allow (a key generated at test time)
}

function google(payload: (hash: string) => unknown) {
	const calls: string[] = [];
	const fetcher = async (url: string, init?: RequestInit) => {
		calls.push(url);
		if (url === 'https://oauth2.googleapis.com/token') {
			const assertionJwt = new URLSearchParams(String(init?.body)).get('assertion')!;
			assert.equal(assertionJwt.split('.').length, 3);
			return new Response(JSON.stringify({ access_token: 'g-token', expires_in: 3600 }));
		}
		assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer g-token');
		return new Response(JSON.stringify({ tokenPayloadExternal: payload(hex(await sha256(CHALLENGE))) }));
	};
	return { fetcher, calls };
}

const verdict = (hash: string, over: Record<string, unknown> = {}) => ({
	requestDetails: { requestPackageName: 'net.alummahnow.studio', requestHash: hash, timestampMillis: String(Date.parse('2026-11-14T00:00:00Z')) },
	appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'net.alummahnow.studio' },
	deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
	...over,
});

describe('Play Integrity', () => {
	beforeEach(() => resetPlayIntegrityToken());
	const now = Date.parse('2026-11-14T00:01:00Z');
	const base = { token: 'tok', challenge: CHALLENGE, packageName: 'net.alummahnow.studio', now };

	it('is not configured without the service account', async () => {
		assert.deepEqual(await verifyPlayIntegrity({ ...base, serviceAccountJson: undefined }), { ok: false, reason: 'not_configured' });
		assert.deepEqual(await verifyPlayIntegrity({ ...base, serviceAccountJson: '{"client_email":"x"}' }), { ok: false, reason: 'not_configured' });
	});

	it('accepts a recognised app on a device with integrity, for this challenge', async () => {
		const { fetcher, calls } = google((h) => verdict(h));
		assert.deepEqual(await verifyPlayIntegrity({ ...base, serviceAccountJson: await serviceAccount(), fetcher }), { ok: true });
		assert.equal(calls[1], 'https://playintegrity.googleapis.com/v1/net.alummahnow.studio:decodeIntegrityToken');
	});

	it('refuses another challenge, package, a stale token, an unrecognised app, a device without integrity', async () => {
		const account = await serviceAccount();
		const cases: [(h: string) => unknown, string][] = [
			[() => verdict('00'.repeat(32)), 'bad_request_hash'],
			[(h) => verdict(h, { requestDetails: { requestPackageName: 'other.app', requestHash: h, timestampMillis: String(now) } }), 'wrong_package'],
			[(h) => verdict(h, { requestDetails: { requestPackageName: 'net.alummahnow.studio', requestHash: h, timestampMillis: String(now - 3_600_000) } }), 'stale'],
			[(h) => verdict(h, { appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: 'net.alummahnow.studio' } }), 'unrecognized_app'],
			[(h) => verdict(h, { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }), 'device_integrity'],
		];
		for (const [payload, reason] of cases) {
			const { fetcher } = google(payload);
			assert.deepEqual(await verifyPlayIntegrity({ ...base, serviceAccountJson: account, fetcher }), { ok: false, reason });
		}
	});
});

// ---------------------------------------------------------------------------

function kv() {
	const store = new Map<string, string>();
	return {
		store,
		get: async (k: string, type?: string) => {
			const v = store.get(k) ?? null;
			return v !== null && type === 'json' ? JSON.parse(v) : v;
		},
		put: async (k: string, v: string) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
	} as unknown as KVNamespace & { store: Map<string, string> };
}

function adminApi(settings: MobileAppsSettings) {
	return async (url: string) => {
		assert.equal(url, 'https://admin.api.test/public/mobile-apps');
		return new Response(JSON.stringify({ settings }));
	};
}

describe('challenges and proofs', () => {
	it('a challenge works once; a proof is valid for its hour and only its hash is stored', async () => {
		const store = kv();
		const { challenge } = await issueChallenge(store);
		assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(await consumeChallenge(store, challenge), true);
		assert.equal(await consumeChallenge(store, challenge), false);
		assert.equal(await consumeChallenge(store, 'made-up'), false);
		const { proof } = await issueProof(store, { platform: 'android', app: 'net.alummahnow.studio' });
		assert.equal(await validProof(store, proof), true);
		assert.equal(await validProof(store, proof.replace(/.$/, proof.endsWith('A') ? 'B' : 'A')), false);
		assert.ok(![...store.store.keys()].some((k) => k.includes(proof)));
	});
});

describe('attestation endpoints', () => {
	const realFetch = globalThis.fetch;
	beforeEach(() => resetAttestationSettings());
	afterEach(() => {
		globalThis.fetch = realFetch;
		resetPlayIntegrityToken();
	});

	function server(settings: MobileAppsSettings, extra: Record<string, unknown> = {}) {
		const HUMAN_VERIFIED = kv();
		const env = { ADMIN_API_URL: 'https://admin.api.test', ENVIRONMENT: 'production', HUMAN_VERIFIED, ...extra };
		const a = new Hono();
		a.route('/api/apps/attestation', attestationRouter as never);
		return { call: (path: string, init: RequestInit = {}) => a.request(path, init, env), HUMAN_VERIFIED };
	}

	it('is off by default: config says so and the endpoints answer 404 attestation_off', async () => {
		const settings = defaultMobileAppsSettings('production');
		globalThis.fetch = adminApi(settings) as typeof fetch;
		const { call } = server(settings);
		const config = (await (await call('/api/apps/attestation/config')).json()) as { result: unknown };
		assert.deepEqual(config.result, { apple: { enabled: false }, android: { enabled: false, cloudProjectNumber: null } });
		for (const path of ['challenge', 'apple/register', 'apple/assert', 'android']) {
			const res = await call(`/api/apps/attestation/${path}`, { method: 'POST', body: '{}' });
			assert.equal(res.status, 404, path);
			assert.equal(((await res.json()) as { code: string }).code, 'attestation_off');
		}
	});

	it('Android: challenge → Play Integrity → proof; the challenge is single use', async () => {
		const settings = defaultMobileAppsSettings('production');
		settings.android.playIntegrity = { enabled: true, cloudProjectNumber: '123456789012' };
		const decode = google((h) => verdict(h, { requestDetails: { requestPackageName: 'net.alummahnow.studio', requestHash: h, timestampMillis: String(Date.now()) } }));
		const admin = adminApi(settings);
		globalThis.fetch = (async (url: string, init?: RequestInit) => (new URL(url).host === 'admin.api.test' ? admin(url) : decode.fetcher(url, init))) as typeof fetch;
		const { call, HUMAN_VERIFIED } = server(settings, { PLAY_INTEGRITY_SERVICE_ACCOUNT: await serviceAccount() });
		const config = (await (await call('/api/apps/attestation/config')).json()) as { result: { android: unknown } };
		assert.deepEqual(config.result.android, { enabled: true, cloudProjectNumber: '123456789012' });
		// The test fakes Google with a fixed challenge; put that one in the store as the server would
		await HUMAN_VERIFIED.put(`att:c:${CHALLENGE}`, '1');
		const body = JSON.stringify({ token: 'tok', challenge: CHALLENGE, packageName: 'net.alummahnow.studio' });
		const res = await call('/api/apps/attestation/android', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
		assert.equal(res.status, 200);
		const { result } = (await res.json()) as { result: { proof: string; expiresAt: string } };
		assert.equal(await validProof(HUMAN_VERIFIED, result.proof), true);
		const again = await call('/api/apps/attestation/android', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
		assert.equal(((await again.json()) as { code: string }).code, 'bad_challenge');
		const unknown = await call('/api/apps/attestation/android', { method: 'POST', body: JSON.stringify({ token: 't', challenge: CHALLENGE, packageName: 'com.other' }) });
		assert.equal(((await unknown.json()) as { code: string }).code, 'unknown_app');
	});

	it('Android without the service account secret: 503 not_configured, never a proof', async () => {
		const settings = defaultMobileAppsSettings('production');
		settings.android.playIntegrity = { enabled: true, cloudProjectNumber: '123456789012' };
		globalThis.fetch = adminApi(settings) as typeof fetch;
		const { call, HUMAN_VERIFIED } = server(settings);
		const { result } = (await (await call('/api/apps/attestation/challenge', { method: 'POST' })).json()) as { result: { challenge: string } };
		const res = await call('/api/apps/attestation/android', { method: 'POST', body: JSON.stringify({ token: 't', challenge: result.challenge, packageName: 'net.alummahnow.app' }) });
		assert.equal(res.status, 503);
		assert.ok(![...HUMAN_VERIFIED.store.keys()].some((k) => k.startsWith('att:p:')));
	});

	it('Apple: an unknown bundle, a key never attested, and an attestation not from Apple are refused', async () => {
		const settings = defaultMobileAppsSettings('production');
		settings.apple.teamId = 'ABCDE12345';
		settings.apple.appAttest.enabled = true;
		globalThis.fetch = adminApi(settings) as typeof fetch;
		const { call } = server(settings);
		const challenge = async () => ((await (await call('/api/apps/attestation/challenge', { method: 'POST' })).json()) as { result: { challenge: string } }).result.challenge;
		const d = await device();
		const post = (path: string, body: unknown) => call(`/api/apps/attestation/${path}`, { method: 'POST', body: JSON.stringify(body) });
		assert.equal(((await (await post('apple/register', { keyId: d.keyId, attestation: d.attestation, challenge: await challenge(), bundleId: 'com.other' })).json()) as { code: string }).code, 'unknown_app');
		const assertRes = await post('apple/assert', { keyId: d.keyId, assertion: 'x', challenge: await challenge(), bundleId: 'net.alummahnow.studio' });
		assert.equal(assertRes.status, 404);
		assert.equal(((await assertRes.json()) as { code: string }).code, 'unknown_key');
		const reg = await post('apple/register', { keyId: d.keyId, attestation: d.attestation, challenge: await challenge(), bundleId: 'net.alummahnow.studio' });
		assert.equal(reg.status, 403);
		assert.equal(((await reg.json()) as { code: string }).code, 'attestation_failed');
	});
});

describe('requireHuman with native proofs', () => {
	const realFetch = globalThis.fetch;
	beforeEach(() => resetAttestationSettings());
	afterEach(() => (globalThis.fetch = realFetch));

	const NATIVE = 'native-client-1';
	const jwt = (aud: string) => {
		const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
		return `${enc({ alg: 'ES256' })}.${enc({ aud })}.sig`;
	};

	function app(settings: MobileAppsSettings) {
		globalThis.fetch = adminApi(settings) as typeof fetch;
		const HUMAN_VERIFIED = kv();
		const env = { ADMIN_API_URL: 'https://admin.api.test', TURNSTILE_MODE: 'enforce', TURNSTILE_SITE_KEY: 'k', ENVIRONMENT: 'stage', NATIVE_CLIENT_IDS: NATIVE, HUMAN_VERIFIED };
		const a = new Hono();
		a.use('*', async (c, next) => {
			c.set('auth' as never, { userId: 'usr_1' } as never);
			await next();
		});
		a.use('/api/moderation/reports', requireHuman('videos.report', 'always'));
		a.post('/api/moderation/reports', (c) => c.json({ success: true }, 201));
		return { call: (headers: Record<string, string>) => a.request('/api/moderation/reports', { method: 'POST', headers }, env), HUMAN_VERIFIED };
	}

	function enforcedSettings(): MobileAppsSettings {
		const settings = defaultMobileAppsSettings('stage');
		settings.android.playIntegrity = { enabled: true, cloudProjectNumber: '123456789012' };
		settings.attestation.enforceClientIds = [NATIVE];
		return settings;
	}

	it('a proof is no pass for a web (non-native) request: Turnstile still applies', async () => {
		const { call, HUMAN_VERIFIED } = app(enforcedSettings());
		const { proof } = await issueProof(HUMAN_VERIFIED, { platform: 'android', app: 'net.alummahnow.studio' });
		const res = await call({ 'X-AUN-Native-Proof': proof });
		assert.equal(res.status, 403);
		assert.equal(((await res.json()) as { code: string }).code, 'human_check_required');
	});

	it('native clients keep the exemption until the admin requires a proof from them', async () => {
		assert.equal((await app(defaultMobileAppsSettings('stage')).call({ Authorization: `Bearer ${jwt(NATIVE)}` })).status, 201);
		resetAttestationSettings();
		const enforced = app(enforcedSettings());
		const res = await enforced.call({ Authorization: `Bearer ${jwt(NATIVE)}` });
		assert.equal(res.status, 403);
		assert.deepEqual(await res.json(), { success: false, code: 'native_proof_required', error: 'native_proof_required' });
		assert.equal((await enforced.call({ Authorization: `Bearer ${jwt(NATIVE)}`, 'X-AUN-Native-Proof': 'A'.repeat(43) })).status, 403);
		const { proof } = await issueProof(enforced.HUMAN_VERIFIED, { platform: 'android', app: 'net.alummahnow.studio' });
		assert.equal((await enforced.call({ Authorization: `Bearer ${jwt(NATIVE)}`, 'X-AUN-Native-Proof': proof })).status, 201);
		assert.equal((await enforced.call({ Authorization: `Bearer ${jwt(NATIVE)}`, 'X-AUN-Native-Proof': proof })).status, 201);
	});

	it('a proof is pinned to the first account that uses it and dies when its platform is turned off', async () => {
		const settings = enforcedSettings();
		const store = kv();
		const { proof } = await issueProof(store, { platform: 'android', app: 'net.alummahnow.studio' });
		assert.equal(await acceptProof(store, settings, proof, 'usr_1'), true);
		assert.equal(await acceptProof(store, settings, proof, 'usr_1'), true);
		assert.equal(await acceptProof(store, settings, proof, 'usr_2'), false);
		settings.android.playIntegrity.enabled = false;
		assert.equal(await acceptProof(store, settings, proof, 'usr_1'), false);
		const late = await issueProof(store, { platform: 'android', app: 'net.alummahnow.studio' }, Date.now() - 3590_000);
		settings.android.playIntegrity.enabled = true;
		assert.equal(await acceptProof(store, settings, late.proof, 'usr_3'), false);
	});
});
