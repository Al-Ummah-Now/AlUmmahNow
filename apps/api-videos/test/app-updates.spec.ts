/**
 * AUN-APP-UPDATES: version precedence and the signed release manifest (wiki §2.1, §3.1, §13).
 * Keys are generated per run; no real key is in the repo.
 */
import { before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { APP_CONFIG_SEMVER, appReleaseKeyId, appReleaseTrustFrom, compareAppVersions, verifyAppReleaseManifest, verifyAppUpdateKeyList, type AppReleaseTrust } from '@al-ummah/shared-types';

const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64');
const enc = new TextEncoder();

async function keyPair() {
	const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { pair, pub, keyId: await appReleaseKeyId(pub) };
}

type Key = Awaited<ReturnType<typeof keyPair>>;
async function sign(bytes: Uint8Array, ...ks: Key[]) {
	const signatures = [];
	for (const k of ks) signatures.push({ keyId: k.keyId, sig: b64(await crypto.subtle.sign({ name: 'Ed25519' }, k.pair.privateKey, bytes)) });
	return JSON.stringify({ signatures });
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
		yanked: [],
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
	let k: Key;
	let other: Key;
	let trust: AppReleaseTrust;
	before(async () => {
		k = await keyPair();
		other = await keyPair();
		trust = { keys: [other.pub, k.pub] };
	});
	const bytesOf = (m: unknown) => enc.encode(JSON.stringify(m));

	it('accepts a correctly signed manifest', async () => {
		const bytes = bytesOf(manifest());
		const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trust, { repo: 'AlUmmahNowTools', tag: TAG, channels: ['stable'], newerThan: '2026.11.22' });
		assert.equal(r.ok, true);
		if (r.ok) {
			assert.equal(r.manifest.version, '2026.11.23');
			assert.equal(r.keyId, k.keyId);
		}
	});

	it('refuses a tampered manifest (one byte changed after signing)', async () => {
		const bytes = bytesOf(manifest());
		const sig = await sign(bytes, k);
		const tampered = bytes.slice();
		const at = new TextDecoder().decode(bytes).indexOf('"aaaa');
		tampered[at + 1] = 'b'.charCodeAt(0); // first character of the sha256
		assert.deepEqual(await verifyAppReleaseManifest(tampered, sig, trust, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'bad_signature' });
	});

	it('refuses a key the app does not trust, and a forged signature under a trusted key id', async () => {
		const bytes = bytesOf(manifest());
		assert.deepEqual(await verifyAppReleaseManifest(bytes, await sign(bytes, k), { keys: [other.pub] }, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'unknown_key' });
		const forged = JSON.parse(await sign(bytes, other));
		forged.signatures[0].keyId = k.keyId;
		assert.deepEqual(await verifyAppReleaseManifest(bytes, JSON.stringify(forged), { keys: [k.pub] }, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'bad_signature' });
	});

	it('refuses a revoked key; a manifest dual-signed with a revoked and a good key passes on the good one', async () => {
		const bytes = bytesOf(manifest());
		const revoked = { keys: [k.pub, other.pub], revoked: [k.keyId] };
		assert.deepEqual(await verifyAppReleaseManifest(bytes, await sign(bytes, k), revoked, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'unknown_key' });
		const both = await verifyAppReleaseManifest(bytes, await sign(bytes, k, other), revoked, { repo: 'AlUmmahNowTools' });
		assert.equal(both.ok && both.keyId, other.keyId);
	});

	it('refuses a malformed or missing signature file', async () => {
		const bytes = bytesOf(manifest());
		for (const s of ['', 'null', '{}', '{"signatures":[]}', '{"keyId":"zz","sig":"x"}', 'not json']) {
			assert.deepEqual(await verifyAppReleaseManifest(bytes, s, trust, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'bad_signature_file' }, s);
		}
	});

	it('refuses another repo, tag or channel, a downgrade, a replay below the floor, and a yanked version', async () => {
		const bytes = bytesOf(manifest());
		const sig = await sign(bytes, k);
		const t = { keys: [k.pub] };
		const reason = async (trustArg: AppReleaseTrust, expect: Parameters<typeof verifyAppReleaseManifest>[3]) => {
			const r = await verifyAppReleaseManifest(bytes, sig, trustArg, expect);
			return r.ok ? 'ok' : r.reason;
		};
		assert.equal(await reason(t, { repo: 'AlUmmahNowDesktop' }), 'wrong_repo');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', tag: 'v2026.11.24' }), 'wrong_tag');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', channels: ['beta'] }), 'wrong_channel');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', channels: ['beta', 'stable'] }), 'ok');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.23' }), 'not_newer');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.23.1' }), 'not_newer');
		// Installed 2026.11.20; the app has already verified 2026.11.24, so the older 2026.11.23 is a replay
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.20', floor: '2026.11.24' }), 'below_floor');
		assert.equal(await reason(t, { repo: 'AlUmmahNowTools', newerThan: '2026.11.20', floor: '2026.11.23' }), 'ok');
		assert.equal(await reason({ keys: [k.pub], yanked: ['2026.11.23.0'] }, { repo: 'AlUmmahNowTools' }), 'yanked');
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
			const bytes = bytesOf(m);
			const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trust, { repo: 'AlUmmahNowTools' });
			assert.equal(r.ok ? 'ok' : r.reason, 'bad_manifest', url);
		}
	});

	it('requires English and Arabic notes', async () => {
		const bytes = bytesOf(manifest({ notes: { en: 'Only English.' } }));
		const r = await verifyAppReleaseManifest(bytes, await sign(bytes, k), trust, { repo: 'AlUmmahNowTools' });
		assert.equal(r.ok ? 'ok' : r.reason, 'bad_manifest');
	});

	it('refuses an oversized manifest before checking anything else', async () => {
		const bytes = new Uint8Array(256 * 1024 + 1);
		assert.deepEqual(await verifyAppReleaseManifest(bytes, '', trust, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'too_large' });
	});
});

describe('key lists: rotation and revocation (AUN-APP-UPDATES §3.5)', () => {
	let root: Key;
	let oldKey: Key;
	let newKey: Key;
	let attacker: Key;
	before(async () => {
		[root, oldKey, newKey, attacker] = await Promise.all([keyPair(), keyPair(), keyPair(), keyPair()]);
	});
	const list = (serial: number, keys: Key[], revoked: string[] = [], yanked: string[] = []) =>
		enc.encode(JSON.stringify({ schema: 1, repo: 'AlUmmahNowTools', serial, keys: keys.map((x) => ({ keyId: x.keyId, publicKey: x.pub })), revoked, yanked }));

	it('accepts a root-signed list with a higher serial only', async () => {
		const bytes = list(2, [oldKey]);
		const ok = await verifyAppUpdateKeyList(bytes, await sign(bytes, root), [root.pub], { repo: 'AlUmmahNowTools', storedSerial: 1 });
		assert.equal(ok.ok, true);
		const replay = await verifyAppUpdateKeyList(bytes, await sign(bytes, root), [root.pub], { repo: 'AlUmmahNowTools', storedSerial: 2 });
		assert.deepEqual(replay, { ok: false, reason: 'not_newer' });
	});

	it('a stolen release key cannot sign a key list', async () => {
		const bytes = list(9, [attacker]);
		assert.deepEqual(await verifyAppUpdateKeyList(bytes, await sign(bytes, oldKey), [root.pub], { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'unknown_key' });
	});

	it('refuses a list whose key ids do not match their keys, or for another repo', async () => {
		const bad = JSON.parse(new TextDecoder().decode(list(3, [newKey])));
		bad.keys[0].keyId = oldKey.keyId;
		const bytes = enc.encode(JSON.stringify(bad));
		const r = await verifyAppUpdateKeyList(bytes, await sign(bytes, root), [root.pub], { repo: 'AlUmmahNowTools' });
		assert.equal(r.ok ? 'ok' : r.reason, 'bad_list');
		const other = list(3, [newKey]);
		assert.equal((await verifyAppUpdateKeyList(other, await sign(other, root), [root.pub], { repo: 'AlUmmahNowDesktop' })).ok, false);
	});

	it('skip-safe rotation: a build that only knew the old key accepts a release signed only with the new key', async () => {
		// The old build carries the root key and serial 1 (old key only). It skipped every release since.
		const rotated = list(2, [newKey]);
		const accepted = await verifyAppUpdateKeyList(rotated, await sign(rotated, root), [root.pub], { repo: 'AlUmmahNowTools', storedSerial: 1 });
		assert.ok(accepted.ok);
		const trust = appReleaseTrustFrom((accepted as { list: never }).list);
		const m = enc.encode(JSON.stringify(manifest()));
		const r = await verifyAppReleaseManifest(m, await sign(m, newKey), trust, { repo: 'AlUmmahNowTools', newerThan: '2026.11.01' });
		assert.equal(r.ok, true);
	});

	it('revocation is remembered: a later list that omits it does not bring the key back', async () => {
		const revoking = list(5, [newKey], [oldKey.keyId], ['2026.11.22']);
		const r1 = await verifyAppUpdateKeyList(revoking, await sign(revoking, root), [root.pub], { repo: 'AlUmmahNowTools', storedSerial: 4 });
		const t1 = appReleaseTrustFrom((r1 as { list: never }).list);
		const later = list(6, [newKey, oldKey]);
		const r2 = await verifyAppUpdateKeyList(later, await sign(later, root), [root.pub], { repo: 'AlUmmahNowTools', storedSerial: 5 });
		const t2 = appReleaseTrustFrom((r2 as { list: never }).list, t1);
		assert.deepEqual(t2.revoked, [oldKey.keyId]);
		assert.deepEqual(t2.keys, [newKey.pub]);
		assert.deepEqual(t2.yanked, ['2026.11.22']);
		const m = enc.encode(JSON.stringify(manifest()));
		assert.deepEqual(await verifyAppReleaseManifest(m, await sign(m, oldKey), t2, { repo: 'AlUmmahNowTools' }), { ok: false, reason: 'unknown_key' });
	});
});

describe('shared vectors with aun-core (AlUmmahNowCore spec/app-updates, copied verbatim)', () => {
	const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/app-updates/${name}`, import.meta.url), 'utf8'));

	it('the version table', () => {
		const v = fixture('versions.json');
		for (const [a, b, want] of v.cases as [string, string, number][]) assert.equal(compareAppVersions(a, b), want, `${a} vs ${b}`);
		for (const ok of v.valid as string[]) assert.ok(APP_CONFIG_SEMVER.test(ok), ok);
		for (const bad of v.invalid as string[]) assert.ok(!APP_CONFIG_SEMVER.test(bad), bad);
	});

	it('the signed key list and manifest verify; changes are refused', async () => {
		const v = fixture('signed-vector.json');
		const list = await verifyAppUpdateKeyList(enc.encode(v.keyList), v.keyListSig, [v.rootPublicKey], { repo: 'AlUmmahNowTools' });
		assert.equal(list.ok, true);
		const trust = appReleaseTrustFrom((list as { list: never }).list);
		const ok = await verifyAppReleaseManifest(enc.encode(v.manifest), v.manifestSig, trust, { repo: 'AlUmmahNowTools', tag: 'v2026.11.23', channels: ['stable'], newerThan: '2026.11.22' });
		assert.equal(ok.ok, true);
		const tampered = await verifyAppReleaseManifest(enc.encode(v.manifest.replace('Faster', 'Slower')), v.manifestSig, trust, { repo: 'AlUmmahNowTools' });
		assert.equal(tampered.ok ? 'ok' : tampered.reason, 'bad_signature');
		const byRoot = await verifyAppReleaseManifest(enc.encode(v.manifest), v.manifestSigByRoot, trust, { repo: 'AlUmmahNowTools' });
		assert.equal(byRoot.ok ? 'ok' : byRoot.reason, 'unknown_key');
	});
});
