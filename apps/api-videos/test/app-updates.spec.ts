/**
 * AUN-APP-UPDATES: version precedence and the signed release manifest (wiki §2.1, §3.1, §13).
 * Keys are generated per run; no real key is in the repo.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APP_CONFIG_SEMVER, appReleaseKeyId, compareAppVersions, verifyAppReleaseManifest, type AppReleaseTrustedKeys } from '@al-ummah/shared-types';

const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64');
const enc = new TextEncoder();

async function keyPair() {
	const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { pair, pub, keyId: await appReleaseKeyId(pub) };
}

async function sign(bytes: Uint8Array, k: Awaited<ReturnType<typeof keyPair>>) {
	const sig = await crypto.subtle.sign({ name: 'Ed25519' }, k.pair.privateKey, bytes);
	return JSON.stringify({ keyId: k.keyId, sig: b64(sig) });
}

const TAG = 'v2026.11.23';
const PREFIX = `https://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/${TAG}/`;
function manifest(over: Record<string, unknown> = {}) {
	return {
		schema: 1,
		repo: 'AlUmmahNowTools',
		tag: TAG,
		version: '2026.11.23',
		channel: 'stable',
		publishedAt: '2026-11-23T18:04:11Z',
		notes: { en: 'Faster folder scans.', ar: 'فحص أسرع للمجلدات.' },
		artifacts: [{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', url: `${PREFIX}AlUmmahNow.Tools-2026.11.23-win-full.nupkg`, sha256: 'a'.repeat(64), size: 81234567 }],
		stores: [],
		...over,
	};
}

describe('compareAppVersions (AUN-APP-UPDATES §2.1)', () => {
	const cases: [string, string, number][] = [
		['1.10.0', '1.9.9', 1],
		['1.2.3', '1.2.3', 0],
		['2026.11.22', '2026.11.22.0', 0],
		['2026.11.22', '2026.11.22.2', -1],
		['2026.11.22.10', '2026.11.22.9', 1],
		['2026.11.23', '2026.11.22.9', 1],
		['1.5.0-preview.2', '1.5.0', -1],
		['1.5.0-preview.2', '1.5.0-preview.10', -1],
		['1.5.0-alpha', '1.5.0-alpha.1', -1],
		['1.5.0-alpha.1', '1.5.0-alpha.beta', -1],
		['1.5.0-beta', '1.5.0-alpha', 1],
		['1.5.0+build.7', '1.5.0', 0],
		['1.5.0-rc.1+b', '1.5.0-rc.1', 0],
	];
	for (const [a, b, want] of cases) {
		it(`${a} vs ${b} = ${want}`, () => {
			assert.equal(compareAppVersions(a, b), want);
			assert.equal(compareAppVersions(b, a), -want || 0);
		});
	}
	it('accepts 3 or 4 numeric parts, refuses the rest', () => {
		for (const v of ['1.2.3', '2026.11.22.2', '1.2.3-preview.1', '1.2.3+abc', '1.2.3-rc.1+abc']) assert.ok(APP_CONFIG_SEMVER.test(v), v);
		for (const v of ['1.2', '1.2.3.4.5', '1.2.3-', '1.2.3-a..b', 'v1.2.3', '1.2.3 ']) assert.ok(!APP_CONFIG_SEMVER.test(v), v);
		assert.throws(() => compareAppVersions('1.2', '1.0.0'));
	});
});

describe('verifyAppReleaseManifest (AUN-APP-UPDATES §3.1, §5.3)', () => {
	let k: Awaited<ReturnType<typeof keyPair>>;
	let other: Awaited<ReturnType<typeof keyPair>>;
	let trusted: AppReleaseTrustedKeys;
	before(async () => {
		k = await keyPair();
		other = await keyPair();
		trusted = { AlUmmahNowTools: [other.pub, k.pub] };
	});

	it('accepts a correctly signed manifest', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trusted, { repo: 'AlUmmahNowTools', tag: TAG, newerThan: '2026.11.22' });
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.manifest.version, '2026.11.23');
			assert.equal(r.keyId, k.keyId);
		}
	});

	it('refuses a tampered manifest (one byte changed after signing)', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		const sig = await sign(bytes, k);
		const tampered = bytes.slice();
		const at = new TextDecoder().decode(bytes).indexOf('"a');
		tampered[at + 1] = 'b'.charCodeAt(0); // first character of the sha256
		const r = await verifyAppReleaseManifest(tampered, sig, trusted, { repo: 'AlUmmahNowTools' });
		assert.deepEqual(r, { ok: false, reason: 'bad_signature' });
	});

	it('refuses a key the app does not trust', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), { AlUmmahNowTools: [other.pub] }, { repo: 'AlUmmahNowTools' });
		assert.deepEqual(r, { ok: false, reason: 'unknown_key' });
		const r2 = await verifyAppReleaseManifest(bytes, await sign(bytes, k), { AlUmmahNowDesktop: [k.pub] }, { repo: 'AlUmmahNowTools' });
		assert.deepEqual(r2, { ok: false, reason: 'unknown_key' });
	});

	it('refuses a signature made by another key under a trusted key id', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		const forged = JSON.parse(await sign(bytes, other));
		forged.keyId = k.keyId;
		const r = await verifyAppReleaseManifest(bytes, JSON.stringify(forged), { AlUmmahNowTools: [k.pub] }, { repo: 'AlUmmahNowTools' });
		assert.deepEqual(r, { ok: false, reason: 'bad_signature' });
	});

	it('refuses a malformed or missing signature file', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		for (const s of ['', 'null', '{}', '{"keyId":"zz","sig":"x"}', 'not json']) {
			assert.deepEqual(await verifyAppReleaseManifest(bytes, s, trusted, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'bad_signature_file' }, s);
		}
	});

	it('refuses another repo, another tag, and older or equal versions (replay, downgrade)', async () => {
		const bytes = enc.encode(JSON.stringify(manifest()));
		const sig = await sign(bytes, k);
		const t = { AlUmmahNowDesktop: [k.pub], AlUmmahNowTools: [k.pub] };
		assert.deepEqual(await verifyAppReleaseManifest(bytes, sig, t, { repo: 'AlUmmahNowDesktop' }), { ok: false, reason: 'wrong_repo' });
		assert.deepEqual(await verifyAppReleaseManifest(bytes, sig, t, { repo: 'AlUmmahNowTools', tag: 'v2026.11.24' }), { ok: false, reason: 'wrong_tag' });
		assert.deepEqual(await verifyAppReleaseManifest(bytes, sig, t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.23' }), { ok: false, reason: 'not_newer' });
		assert.deepEqual(await verifyAppReleaseManifest(bytes, sig, t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.23.1' }), { ok: false, reason: 'not_newer' });
	});

	it('refuses a signed manifest that points at another host, repo or release, or over HTTP', async () => {
		for (const url of [
			'https://evil.example/AlUmmahNow.Tools-full.nupkg',
			'http://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/v2026.11.23/x.nupkg',
			'https://github.com/Al-Ummah-Now/AlUmmahNowDesktop/releases/download/v2026.11.23/x.nupkg',
			'https://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/v2026.11.01/x.nupkg',
			'https://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/v2026.11.23x/x.nupkg',
		]) {
			const m = manifest();
			(m.artifacts as { url: string }[])[0].url = url;
			const bytes = enc.encode(JSON.stringify(m));
			const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trusted, { repo: 'AlUmmahNowTools' });
			assert.equal(r.ok, false, url);
			if (!r.ok) assert.equal(r.reason, 'bad_manifest', url);
		}
	});

	it('requires English and Arabic notes', async () => {
		const bytes = enc.encode(JSON.stringify(manifest({ notes: { en: 'Only English.' } })));
		const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trusted, { repo: 'AlUmmahNowTools' });
		assert.equal(r.ok ? 'ok' : r.reason, 'bad_manifest');
	});

	it('refuses an oversized manifest before checking anything else', async () => {
		const bytes = new Uint8Array(256 * 1024 + 1);
		assert.deepEqual(await verifyAppReleaseManifest(bytes, '', trusted, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'too_large' });
	});
});
