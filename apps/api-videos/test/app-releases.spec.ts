/**
 * AUN-APP-UPDATES §3.2, §3.5, §3.6: the release index. Fixture feeds, manifests, key lists,
 * signatures, a private bucket and App Store answers; no network. Keys are generated per run.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appReleaseKeyId } from '@al-ummah/shared-types';
import { applyManifest, emptyReleases, entryKey, indexReleases, readReleases, rootKeys, tagsFromAtom, RELEASES_KEY } from '../src/lib/app-updates/releases';

class MemoryKV {
	values = new Map<string, string>();
	async get(key: string, opts?: { type?: string }) {
		const v = this.values.get(key);
		if (v === undefined) return null;
		return opts?.type === 'json' ? JSON.parse(v) : v;
	}
	async put(key: string, value: string) {
		this.values.set(key, value);
	}
	async delete(key: string) {
		this.values.delete(key);
	}
}

class MemoryBucket {
	constructor(private files: Record<string, Uint8Array | string>) {}
	async get(key: string) {
		const v = this.files[key];
		if (v === undefined) return null;
		const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
		return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
	}
}

const b64 = (bytes: ArrayBuffer) => Buffer.from(new Uint8Array(bytes)).toString('base64');
const enc = new TextEncoder();

async function keyPair() {
	const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
	return { pair, pub, keyId: await appReleaseKeyId(pub) };
}
type Key = Awaited<ReturnType<typeof keyPair>>;
async function signText(bytes: Uint8Array, ...ks: Key[]) {
	const signatures = [];
	for (const k of ks) signatures.push({ keyId: k.keyId, sig: b64(await crypto.subtle.sign({ name: 'Ed25519' }, k.pair.privateKey, bytes)) });
	return JSON.stringify({ signatures });
}

function atom(repo: string, tags: string[]) {
	return `<?xml version="1.0"?><feed>${tags.map((t) => `<entry><link rel="alternate" type="text/html" href="https://github.com/Al-Ummah-Now/${repo}/releases/tag/${t}"/></entry>`).join('')}</feed>`;
}

const TOOLS = 'AlUmmahNowTools';
function manifest(repo: string, tag: string, version: string, over: Record<string, unknown> = {}) {
	return {
		schema: 1,
		repo,
		tag,
		version,
		channel: 'stable',
		publishedAt: '2026-11-23T18:04:11Z',
		notes: { en: `Version ${version}.`, ar: `الإصدار ${version}.` },
		artifacts: [
			{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', url: `https://github.com/Al-Ummah-Now/${repo}/releases/download/${tag}/full.nupkg`, sha256: 'a'.repeat(64), size: 10 },
			{ app: 'tools', platform: 'macos', arch: 'arm64', kind: 'velopack-full', url: `https://github.com/Al-Ummah-Now/${repo}/releases/download/${tag}/mac.nupkg`, sha256: 'b'.repeat(64), size: 10 },
		],
		stores: [],
		yanked: [],
		...over,
	};
}

type Routes = Record<string, { status: number; body?: string | Uint8Array }>;
function fakeFetch(routes: Routes, calls: string[] = []): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		const r = routes[url];
		if (!r) return new Response('not found', { status: 404 });
		return new Response(r.body ?? '', { status: r.status });
	}) as typeof fetch;
}

const dl = (tag: string, file: string, repo = TOOLS) => `https://github.com/Al-Ummah-Now/${repo}/releases/download/${tag}/${file}`;
const feed = (repo = TOOLS) => `https://github.com/Al-Ummah-Now/${repo}/releases.atom`;
const lookup = (bundle: string, mac = false) => `https://itunes.apple.com/lookup?bundleId=${bundle}${mac ? '&entity=macSoftware' : ''}`;

describe('release index', () => {
	let root: Key;
	let release: Key;
	let next: Key;
	before(async () => {
		[root, release, next] = await Promise.all([keyPair(), keyPair(), keyPair()]);
	});
	const env = (kv: MemoryKV, extra: Record<string, unknown> = {}) => ({ APP_CONFIG: kv as unknown as KVNamespace, UPDATE_ROOT_KEYS: JSON.stringify({ [TOOLS]: [root.pub], AlUmmahNowDesktop: [root.pub] }), ...extra });
	const keyList = (serial: number, keys: Key[], revoked: string[] = [], yanked: string[] = [], repo = TOOLS) =>
		enc.encode(JSON.stringify({ schema: 1, repo, serial, keys: keys.map((x) => ({ keyId: x.keyId, publicKey: x.pub })), revoked, yanked }));
	async function keyRoutes(serial: number, keys: Key[], revoked: string[] = [], yanked: string[] = []): Promise<Routes> {
		const list = keyList(serial, keys, revoked, yanked);
		return { [dl('update-keys', 'update-keys.json')]: { status: 200, body: list }, [dl('update-keys', 'update-keys.json.sig')]: { status: 200, body: await signText(list, root) } };
	}
	async function signedRoutes(tag: string, version: string, ...ks: Key[]): Promise<Routes> {
		const bytes = enc.encode(JSON.stringify(manifest(TOOLS, tag, version)));
		return { [dl(tag, 'app-release.json')]: { status: 200, body: bytes }, [dl(tag, 'app-release.json.sig')]: { status: 200, body: await signText(bytes, ...ks) } };
	}

	it('reads tags from the Atom feed, newest first, only for its repo', () => {
		const xml = atom(TOOLS, ['v2026.11.23', 'v2026.11.22']) + atom('AlUmmahNowDesktop', ['v1.0.0']);
		assert.deepEqual(tagsFromAtom(xml, TOOLS), ['v2026.11.23', 'v2026.11.22']);
	});

	it('trusts only well-formed root keys of known repos', () => {
		assert.deepEqual(rootKeys(undefined), {});
		assert.deepEqual(rootKeys('nope'), {});
		const k = 'A'.repeat(43) + '=';
		assert.deepEqual(rootKeys(JSON.stringify({ AlUmmahNowTools: [k, 'short', 3], Other: [k] })), { AlUmmahNowTools: [k] });
	});

	it('keys set up: indexes a signed release per app and platform, and the App Store version', async () => {
		const kv = new MemoryKV();
		const calls: string[] = [];
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.23', 'v2026.11.22']) },
			...(await keyRoutes(1, [release])),
			...(await signedRoutes('v2026.11.23', '2026.11.23', release)),
			[lookup('net.alummahnow.viewer')]: { status: 200, body: JSON.stringify({ resultCount: 1, results: [{ bundleId: 'net.alummahnow.viewer', version: '1.2.0', trackId: 42, trackViewUrl: 'https://apps.apple.com/app/id42' }] }) },
			[lookup('net.alummahnow.viewer.mac', true)]: { status: 200, body: JSON.stringify({ resultCount: 0, results: [] }) },
			[lookup('net.alummahnow.studio')]: { status: 200, body: JSON.stringify({ resultCount: 0, results: [] }) },
		};
		const r = await indexReleases(env(kv), { fetchImpl: fakeFetch(routes, calls), now: () => new Date('2026-11-23T19:00:00Z') });
		assert.deepEqual(r.keyLists, [{ repo: TOOLS, serial: 1 }]);
		assert.deepEqual(r.added, [{ source: `github:${TOOLS}`, repo: TOOLS, tag: 'v2026.11.23', signed: true }]);
		assert.deepEqual(r.problems, []);
		const doc = await readReleases(kv as unknown as KVNamespace);
		const win = doc.entries[entryKey('tools', 'windows', 'stable')];
		assert.equal(win.version, '2026.11.23');
		assert.equal(win.signed, true);
		assert.equal(win.private, false);
		assert.equal(win.artifacts.length, 1);
		assert.equal(win.url, `https://github.com/Al-Ummah-Now/${TOOLS}/releases/tag/v2026.11.23`);
		assert.equal(doc.keys[TOOLS]?.serial, 1);
		assert.equal(doc.appStore['net.alummahnow.viewer'].version, '1.2.0');
		assert.equal(doc.appStore['net.alummahnow.studio'], undefined);
		assert.deepEqual(doc.seen[`github:${TOOLS}`], ['v2026.11.23', 'v2026.11.22'], 'a tag without a manifest is seen too');
		assert.equal(kv.values.has('releases:running'), false, 'the run marker is cleared');

		calls.length = 0;
		const again = await indexReleases(env(kv), { fetchImpl: fakeFetch(routes, calls) });
		assert.deepEqual(again.added, []);
		assert.deepEqual(again.keyLists, [], 'the same key list again changes nothing');
		assert.ok(!calls.some((u) => u.includes('app-release.json')));
	});

	it('keys set up: a missing, tampered or untrusted signature quarantines the release and reports it', async () => {
		const kv = new MemoryKV();
		const stranger = await keyPair();
		const good = await signedRoutes('v2026.11.24', '2026.11.24', release);
		const tampered = (good[dl('v2026.11.24', 'app-release.json')].body as Uint8Array).slice();
		tampered[tampered.length - 3] ^= 1;
		const unsignedBytes = enc.encode(JSON.stringify(manifest(TOOLS, 'v2026.11.23', '2026.11.23')));
		const problems: { tag: string; reason: string }[] = [];
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.25', 'v2026.11.24', 'v2026.11.23']) },
			...(await keyRoutes(1, [release])),
			[dl('v2026.11.24', 'app-release.json')]: { status: 200, body: tampered },
			[dl('v2026.11.24', 'app-release.json.sig')]: good[dl('v2026.11.24', 'app-release.json.sig')],
			[dl('v2026.11.23', 'app-release.json')]: { status: 200, body: unsignedBytes },
			...(await signedRoutes('v2026.11.25', '2026.11.25', stranger)),
		};
		const r = await indexReleases(env(kv), { fetchImpl: fakeFetch(routes), onProblem: (p) => problems.push(p) });
		assert.deepEqual(r.added, []);
		assert.deepEqual(
			problems.map((p) => `${p.tag}:${p.reason}`),
			['v2026.11.23:missing_signature', 'v2026.11.24:bad_signature', 'v2026.11.25:unknown_key'],
		);
		const doc = await readReleases(kv as unknown as KVNamespace);
		assert.deepEqual(doc.entries, {}, 'nothing quarantined is indexed');
		assert.equal(doc.quarantined.length, 3);
	});

	it('no keys yet: an unsigned release is kept as unsigned and reported to nobody', async () => {
		const kv = new MemoryKV();
		const problems: unknown[] = [];
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.23']) },
			[dl('v2026.11.23', 'app-release.json')]: { status: 200, body: enc.encode(JSON.stringify(manifest(TOOLS, 'v2026.11.23', '2026.11.23'))) },
		};
		const r = await indexReleases(env(kv), { fetchImpl: fakeFetch(routes), onProblem: (p) => problems.push(p) });
		assert.deepEqual(r.added, [{ source: `github:${TOOLS}`, repo: TOOLS, tag: 'v2026.11.23', signed: false }]);
		assert.deepEqual(problems, []);
		assert.equal((await readReleases(kv as unknown as KVNamespace)).entries[entryKey('tools', 'windows', 'stable')].signed, false);
	});

	it('no keys yet: an unsigned manifest naming another tag is quarantined', async () => {
		const kv = new MemoryKV();
		const problems: { reason: string }[] = [];
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.25']) },
			[dl('v2026.11.25', 'app-release.json')]: { status: 200, body: enc.encode(JSON.stringify(manifest(TOOLS, 'v2026.11.20', '2026.11.20'))) },
		};
		await indexReleases(env(kv), { fetchImpl: fakeFetch(routes), onProblem: (p) => problems.push(p) });
		assert.deepEqual(problems.map((p) => p.reason), ['wrong_tag']);
		assert.equal(kv.values.has(RELEASES_KEY), true);
		assert.deepEqual((await readReleases(kv as unknown as KVNamespace)).entries, {});
	});

	it('a key list signed by anything but the root key is refused and reported; the repo stays without keys', async () => {
		const kv = new MemoryKV();
		const list = keyList(1, [release]);
		const problems: { tag: string; reason: string }[] = [];
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, []) },
			[dl('update-keys', 'update-keys.json')]: { status: 200, body: list },
			[dl('update-keys', 'update-keys.json.sig')]: { status: 200, body: await signText(list, release) },
		};
		await indexReleases(env(kv), { fetchImpl: fakeFetch(routes), onProblem: (p) => problems.push(p) });
		assert.deepEqual(problems.map((p) => `${p.tag}:${p.reason}`), ['update-keys:key_list_unknown_key']);
		assert.equal((await readReleases(kv as unknown as KVNamespace)).keys[TOOLS], undefined);
	});

	it('rotation and revocation: a new list adds a key, revokes the old one and yanks a version', async () => {
		const kv = new MemoryKV();
		const run = async (routes: Routes) => indexReleases(env(kv), { fetchImpl: fakeFetch(routes) });
		await run({ [feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.23']) }, ...(await keyRoutes(1, [release])), ...(await signedRoutes('v2026.11.23', '2026.11.23', release)) });
		const problems: { tag: string; reason: string }[] = [];
		await indexReleases(env(kv), {
			fetchImpl: fakeFetch({
				[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.25', 'v2026.11.24', 'v2026.11.23']) },
				...(await keyRoutes(2, [next], [release.keyId], ['2026.11.23'])),
				...(await signedRoutes('v2026.11.24', '2026.11.24', release)),
				...(await signedRoutes('v2026.11.25', '2026.11.25', next)),
			}),
			onProblem: (p) => problems.push(p),
		});
		assert.deepEqual(problems.map((p) => `${p.tag}:${p.reason}`), ['v2026.11.24:unknown_key'], 'the revoked key no longer signs');
		const doc = await readReleases(kv as unknown as KVNamespace);
		assert.equal(doc.keys[TOOLS]?.serial, 2);
		assert.deepEqual(doc.keys[TOOLS]?.revoked, [release.keyId]);
		assert.equal(doc.entries[entryKey('tools', 'windows', 'stable')].version, '2026.11.25');
	});

	it('a yanked latest version leaves the index', async () => {
		const kv = new MemoryKV();
		await indexReleases(env(kv), {
			fetchImpl: fakeFetch({ [feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.23']) }, ...(await keyRoutes(1, [release])), ...(await signedRoutes('v2026.11.23', '2026.11.23', release)) }),
		});
		await indexReleases(env(kv), { fetchImpl: fakeFetch({ [feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.23']) }, ...(await keyRoutes(2, [release], [], ['2026.11.23'])) }) });
		assert.equal((await readReleases(kv as unknown as KVNamespace)).entries[entryKey('tools', 'windows', 'stable')], undefined);
	});

	it('staff-only admin releases come from the private bucket, with no public links', async () => {
		const kv = new MemoryKV();
		const DESK = 'AlUmmahNowDesktop';
		const tag = 'v1.4.0';
		const m = manifest(DESK, tag, '1.4.0', {
			artifacts: [{ app: 'admin', platform: 'windows', arch: 'x64', kind: 'msix', url: `r2://app-releases/${DESK}/${tag}/AlUmmahNow-Admin.msix`, sha256: 'c'.repeat(64), size: 10 }],
		});
		const bytes = enc.encode(JSON.stringify(m));
		const list = keyList(1, [release], [], [], DESK);
		const bucket = new MemoryBucket({
			[`app-releases/${DESK}/index.json`]: JSON.stringify({ tags: [tag] }),
			[`app-releases/${DESK}/update-keys.json`]: list,
			[`app-releases/${DESK}/update-keys.json.sig`]: await signText(list, root),
			[`app-releases/${DESK}/${tag}/app-release.json`]: bytes,
			[`app-releases/${DESK}/${tag}/app-release.json.sig`]: await signText(bytes, release),
		});
		const r = await indexReleases(env(kv, { ADMIN_RELEASES: bucket }), { fetchImpl: fakeFetch({}) });
		assert.deepEqual(r.added, [{ source: `admin:${DESK}`, repo: DESK, tag, signed: true }]);
		const e = (await readReleases(kv as unknown as KVNamespace)).entries[entryKey('admin', 'windows', 'stable')];
		assert.equal(e.private, true);
		assert.equal(e.url, null);
		assert.equal(e.manifestUrl, null);
	});

	it('only admin builds may point at the private bucket', async () => {
		const kv = new MemoryKV();
		const tag = 'v2026.11.23';
		const m = manifest(TOOLS, tag, '2026.11.23', { artifacts: [{ app: 'tools', platform: 'windows', kind: 'msi', url: `r2://app-releases/${TOOLS}/${tag}/x.msi`, sha256: 'a'.repeat(64), size: 1 }] });
		const problems: { reason: string }[] = [];
		await indexReleases(env(kv), {
			fetchImpl: fakeFetch({ [feed()]: { status: 200, body: atom(TOOLS, [tag]) }, [dl(tag, 'app-release.json')]: { status: 200, body: enc.encode(JSON.stringify(m)) } }),
			onProblem: (p) => problems.push(p),
		});
		assert.deepEqual(problems.map((p) => p.reason), ['bad_manifest']);
	});

	it('retries a manifest that could not be read, and survives a dead feed', async () => {
		const kv = new MemoryKV();
		const routes: Routes = {
			[feed()]: { status: 200, body: atom(TOOLS, ['v2026.11.26']) },
			[dl('v2026.11.26', 'app-release.json')]: { status: 502 },
			[feed('AlUmmahNowDesktop')]: { status: 500 },
		};
		const r = await indexReleases(env(kv), { fetchImpl: fakeFetch(routes) });
		assert.deepEqual(r.feedErrors.find((e) => e.source === 'github:AlUmmahNowDesktop'), { source: 'github:AlUmmahNowDesktop', status: 500 });
		assert.equal((await readReleases(kv as unknown as KVNamespace)).seen[`github:${TOOLS}`]?.includes('v2026.11.26') ?? false, false);
	});

	it('skips while another run is going', async () => {
		const kv = new MemoryKV();
		await kv.put('releases:running', 'x');
		const r = await indexReleases(env(kv), { fetchImpl: fakeFetch({}) });
		assert.equal(r.skipped, 'running');
	});

	it('a pair keeps its newest version; older releases only join the history', () => {
		const doc = emptyReleases();
		applyManifest(doc, manifest(TOOLS, 'v2026.11.23', '2026.11.23') as never, true);
		applyManifest(doc, manifest(TOOLS, 'v2026.11.22.2', '2026.11.22.2') as never, true);
		applyManifest(doc, manifest(TOOLS, 'v2026.11.24', '2026.11.24') as never, true);
		const e = doc.entries[entryKey('tools', 'windows', 'stable')];
		assert.equal(e.version, '2026.11.24');
		assert.deepEqual(e.history.map((h) => h.version), ['2026.11.24', '2026.11.23', '2026.11.22.2']);
	});
});
