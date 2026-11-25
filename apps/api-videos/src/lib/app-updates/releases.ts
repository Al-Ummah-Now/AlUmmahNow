/**
 * The release index (wiki AUN-APP-UPDATES §3.2, §3.5, §3.6): which app version is out, per app,
 * platform and channel, built from the signed `app-release.json` each app repo publishes.
 *
 * Runs on the hourly cron and on the admin's Refresh now. Sources:
 * - each public repo's GitHub releases: the public Atom feed lists tags (no REST API quota, so it
 *   never competes with the shared GitHub token); manifests are release assets;
 * - staff-only admin releases: the private release bucket (ADMIN_RELEASES, read-only), never public.
 *
 * Fail closed. A repo whose root-signed key list (`update-keys.json`) has been seen is "keys set
 * up", for good: from then on every manifest must carry a valid signature under its current,
 * non-revoked keys, or it is quarantined (never indexed, never linked) and flags the admin Errors
 * page.
 *
 * Before a repo has a root key (wiki §5.5), its published unsigned releases feed a notice only: a version, never a
 * file, a link or the release's own notes. A tag whose release is a draft has no files yet and is looked at again.
 */
import {
	APP_RELEASE_MANIFEST_MAX_BYTES,
	APP_RELEASE_REPOS,
	AppReleaseManifestSchema,
	appReleaseTrustFrom,
	compareAppVersions,
	parseAppReleaseTag,
	verifyAppReleaseManifest,
	verifyAppUpdateKeyList,
	type AppConfigApp,
	type AppConfigPlatform,
	type AppReleaseArtifact,
	type AppReleaseManifest,
	type AppReleaseNotes,
	type AppReleaseRepo,
	type AppUpdateChannel,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export const RELEASES_KEY = 'releases';
const RUNNING_KEY = 'releases:running';
/** Tags remembered per source, so a tag is fetched once */
const SEEN_PER_SOURCE = 40;
/** Newest feed entries looked at per run */
const FEED_ENTRIES = 15;
const HISTORY = 5;
const QUARANTINE_KEPT = 20;
const FETCH_TIMEOUT_MS = 10_000;
const KEY_LIST_MAX_BYTES = 16 * 1024;
const SIG_MAX_BYTES = 4096;
const SUMS_MAX_BYTES = 64 * 1024;
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const LOOKUP_MAX_BYTES = 256 * 1024;
/** Bump to look at every tag again (2: tags whose release had no manifest were marked seen before) */
const INDEX_REV = 2;
/** Repos whose staff-only admin builds are published to the private bucket */
export const ADMIN_RELEASE_REPOS: readonly AppReleaseRepo[] = ['AlUmmahNowDesktop', 'AlUmmahNowApple'];

/** Production App Store apps whose live version Apple's public lookup reports (wiki §3.3). */
export const APP_STORE_BUNDLES: readonly { app: AppConfigApp; platforms: readonly AppConfigPlatform[]; bundleId: string; mac?: boolean }[] = [
	{ app: 'viewer', platforms: ['ios', 'ipados'], bundleId: 'net.alummahnow.viewer' },
	{ app: 'viewer', platforms: ['macos'], bundleId: 'net.alummahnow.viewer.mac', mac: true },
	{ app: 'studio', platforms: ['ios', 'ipados'], bundleId: 'net.alummahnow.studio' },
];

/** The App Store is asked once a day. */
export const APP_STORE_EVERY_MS = 24 * 3600_000 - 10 * 60_000;

export interface ReleaseHistoryItem {
	version: string;
	tag: string;
	publishedAt: string;
	signed: boolean;
}

export interface ReleaseEntry {
	app: AppConfigApp;
	platform: AppConfigPlatform;
	channel: AppUpdateChannel;
	repo: AppReleaseRepo;
	version: string;
	tag: string;
	publishedAt: string;
	notes: AppReleaseNotes;
	/** Verified under the repo's keys; false only while the repo has no keys yet */
	signed: boolean;
	/** From the private admin bucket: no public links */
	private: boolean;
	/** The release page (null for private releases) */
	url: string | null;
	manifestUrl: string | null;
	/** This pair's files */
	artifacts: AppReleaseArtifact[];
	/** Uploaded to a store by this tag (TestFlight, Play, Microsoft Store) */
	stores: string[];
	history: ReleaseHistoryItem[];
}

export interface AppStoreStatus {
	version: string;
	trackId: number;
	url: string;
	checkedAt: string;
}

/** A repo's accepted key list (wiki §3.5): the exact text and signature, served to apps as is. */
export interface RepoKeys {
	serial: number;
	list: string;
	sig: string;
	/** Every key id ever revoked and version ever yanked (key lists and signed manifests) */
	revoked: string[];
	yanked: string[];
	acceptedAt: string;
}

export interface QuarantinedRelease {
	source: string;
	repo: AppReleaseRepo;
	tag: string;
	reason: string;
	at: string;
}

export interface ReleasesDocument {
	updatedAt: string;
	/** `<app>/<platform>/<channel>` */
	entries: Record<string, ReleaseEntry>;
	/** bundle id → what users can install from the App Store now */
	appStore: Record<string, AppStoreStatus>;
	/** When the App Store was last asked (at most daily) */
	appStoreAskedAt?: string;
	/** Tags already looked at, newest first, per source (`github:<repo>`, `admin:<repo>`) */
	seen: Record<string, string[]>;
	/** Repos a root key was ever configured for: they never go back to the unsigned notice */
	rooted: AppReleaseRepo[];
	rev?: number;
	/** Present once a repo's key list was accepted: the repo is then "keys set up" for good */
	keys: Partial<Record<AppReleaseRepo, RepoKeys>>;
	/** Newest first */
	quarantined: QuarantinedRelease[];
}

export interface ReleasesEnv {
	APP_CONFIG?: KVNamespace;
	/** JSON `{ "<repo>": ["<base64 raw ed25519 root public key>"] }` (wiki §9 K-R); not secret */
	UPDATE_ROOT_KEYS?: string;
	/** The private admin release bucket, read-only (wiki §3.6) */
	ADMIN_RELEASES?: R2Bucket;
}

export interface IndexProblem {
	source: string;
	repo: AppReleaseRepo;
	tag: string;
	reason: string;
	detail?: string;
}

export interface IndexResult {
	added: { source: string; repo: AppReleaseRepo; tag: string; signed: boolean }[];
	problems: IndexProblem[];
	feedErrors: { source: string; status: number | string }[];
	keyLists: { repo: AppReleaseRepo; serial: number }[];
	appStoreChecked: number;
	skipped?: 'running' | 'no_kv';
}

export const entryKey = (app: string, platform: string, channel: string) => `${app}/${platform}/${channel}`;

export function emptyReleases(): ReleasesDocument {
	return { updatedAt: new Date(0).toISOString(), entries: {}, appStore: {}, seen: {}, keys: {}, rooted: [], quarantined: [] };
}

/** Never throws: a bad variable trusts no root key (no repo can then leave "no keys yet"). */
export function rootKeys(raw: string | undefined): Partial<Record<AppReleaseRepo, string[]>> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const out: Partial<Record<AppReleaseRepo, string[]>> = {};
		for (const repo of APP_RELEASE_REPOS) {
			const keys = parsed[repo];
			if (Array.isArray(keys)) out[repo] = keys.filter((k): k is string => typeof k === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(k)).slice(0, 2);
		}
		return out;
	} catch {
		logger.warn('[AppUpdates] UPDATE_ROOT_KEYS is not valid JSON; no root key trusted');
		return {};
	}
}

/**
 * Repos with no root key at all: their releases may feed the unsigned notice (wiki §5.5). Fails closed:
 * a variable that isn't a JSON object or names an unknown repo, or a repo with any value but an empty list, counts as
 * configured.
 */
export function noKeyRepos(doc: Pick<ReleasesDocument, 'keys' | 'rooted'>, raw: string | undefined): Set<AppReleaseRepo> {
	let configured: Record<string, unknown> = {};
	if (raw) {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
			configured = parsed as Record<string, unknown>;
			// A name that is no repo of ours is probably a typo of one that has a key
			if (Object.keys(configured).some((k) => !(APP_RELEASE_REPOS as readonly string[]).includes(k))) return new Set();
		} catch {
			return new Set();
		}
	}
	return new Set(
		APP_RELEASE_REPOS.filter((repo) => {
			const v = configured[repo];
			const none = v === undefined || (Array.isArray(v) && v.length === 0);
			return none && !doc.keys[repo] && !doc.rooted.includes(repo);
		}),
	);
}

/** Tags in a GitHub releases Atom feed, newest first. The fixed `update-keys` release is not a tag of an app. */
export function tagsFromAtom(xml: string, repo: AppReleaseRepo): string[] {
	const out: string[] = [];
	const re = new RegExp(`https://github\\.com/Al-Ummah-Now/${repo}/releases/tag/([^"<>\\s]+)`, 'g');
	for (const m of xml.matchAll(re)) {
		const tag = decodeURIComponent(m[1]);
		if (parseAppReleaseTag(tag) && !out.includes(tag)) out.push(tag);
		if (out.length >= FEED_ENTRIES) break;
	}
	return out;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'AlUmmahNow-release-index', Accept: '*/*' }, redirect: 'follow' });
	} finally {
		clearTimeout(timer);
	}
}

/** One place a repo's releases come from. `null`: not there (404). Throws on anything else, so the tag is retried. */
interface Source {
	id: string;
	repo: AppReleaseRepo;
	private: boolean;
	tags(): Promise<string[]>;
	file(tag: string, name: string, max: number): Promise<Uint8Array | null | 'too_large'>;
	keyFile(name: string, max: number): Promise<Uint8Array | null | 'too_large'>;
}

/** Reads at most `max` bytes: a bigger file is never held in memory. */
async function body(res: Response, max: number): Promise<Uint8Array | 'too_large'> {
	const reader = res.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return 'too_large';
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

function githubSource(fetchImpl: typeof fetch, repo: AppReleaseRepo): Source {
	const get = async (url: string, max: number) => {
		const res = await fetchWithTimeout(fetchImpl, url);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
		return body(res, max);
	};
	return {
		id: `github:${repo}`,
		repo,
		private: false,
		async tags() {
			const res = await fetchWithTimeout(fetchImpl, `https://github.com/Al-Ummah-Now/${repo}/releases.atom`);
			if (!res.ok) throw Object.assign(new Error(`feed HTTP ${res.status}`), { status: res.status });
			const xml = await body(res, FEED_MAX_BYTES);
			if (xml === 'too_large') throw Object.assign(new Error('feed too large'), { status: 'too_large' });
			return tagsFromAtom(decode(xml), repo);
		},
		file: (tag, name, max) => get(`https://github.com/Al-Ummah-Now/${repo}/releases/download/${encodeURIComponent(tag)}/${name}`, max),
		keyFile: (name, max) => get(`https://github.com/Al-Ummah-Now/${repo}/releases/download/update-keys/${name}`, max),
	};
}

function bucketSource(bucket: R2Bucket, repo: AppReleaseRepo): Source {
	const get = async (key: string, max: number) => {
		const obj = await bucket.get(key);
		if (!obj) return null;
		if (obj.size > max) return 'too_large' as const;
		return new Uint8Array(await obj.arrayBuffer());
	};
	return {
		id: `admin:${repo}`,
		repo,
		private: true,
		async tags() {
			const raw = await get(`app-releases/${repo}/index.json`, 64 * 1024);
			if (!raw || raw === 'too_large') return [];
			const parsed = JSON.parse(new TextDecoder().decode(raw)) as { tags?: unknown };
			return Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string' && parseAppReleaseTag(t) !== null).slice(0, FEED_ENTRIES) : [];
		},
		file: (tag, name, max) => get(`app-releases/${repo}/${tag}/${name}`, max),
		keyFile: (name, max) => get(`app-releases/${repo}/${name}`, max),
	};
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

type ManifestOutcome = { kind: 'missing' } | { kind: 'ok'; manifest: AppReleaseManifest; signed: boolean } | { kind: 'quarantined'; reason: string; detail?: string };

/** Fetch and check one tag's manifest under the repo's state (keys set up or not). */
export async function loadManifest(source: Source, tag: string, keys: RepoKeys | undefined): Promise<ManifestOutcome> {
	const bytes = await source.file(tag, 'app-release.json', APP_RELEASE_MANIFEST_MAX_BYTES);
	if (bytes === null) return { kind: 'missing' };
	if (bytes === 'too_large') return { kind: 'quarantined', reason: 'too_large' };
	const sig = await source.file(tag, 'app-release.json.sig', SIG_MAX_BYTES);
	if (keys) {
		if (sig === null) return { kind: 'quarantined', reason: 'missing_signature' };
		if (sig === 'too_large') return { kind: 'quarantined', reason: 'bad_signature_file' };
		const list = JSON.parse(keys.list) as Parameters<typeof appReleaseTrustFrom>[0];
		const trust = appReleaseTrustFrom(list, { revoked: keys.revoked, yanked: keys.yanked });
		const verified = await verifyAppReleaseManifest(bytes, decode(sig), trust, { repo: source.repo, tag });
		if (verified.ok === true) return { kind: 'ok', manifest: verified.manifest, signed: true };
		const failure = verified as Extract<typeof verified, { ok: false }>;
		return { kind: 'quarantined', reason: failure.reason, detail: failure.detail };
	}
	// No keys yet: the schema alone, for the admin page only (never offered to downloaded builds)
	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
	} catch {
		return { kind: 'quarantined', reason: 'bad_json' };
	}
	const parsed = AppReleaseManifestSchema.safeParse(json);
	if (!parsed.success) return { kind: 'quarantined', reason: 'bad_manifest', detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ') };
	if (parsed.data.repo !== source.repo) return { kind: 'quarantined', reason: 'wrong_repo' };
	if (parsed.data.tag !== tag) return { kind: 'quarantined', reason: 'wrong_tag' };
	return { kind: 'ok', manifest: parsed.data, signed: false };
}

/** A newer root-signed key list, if there is one. Throws on a fetch failure (retried next run). */
export async function loadKeyList(source: Source, roots: readonly string[], current: RepoKeys | undefined, now: Date): Promise<{ accepted?: RepoKeys; problem?: string }> {
	if (!roots.length) return {};
	const list = await source.keyFile('update-keys.json', KEY_LIST_MAX_BYTES);
	if (list === null) return {};
	if (list === 'too_large') return { problem: 'too_large' };
	const sig = await source.keyFile('update-keys.json.sig', SIG_MAX_BYTES);
	if (sig === null || sig === 'too_large') return { problem: 'bad_signature_file' };
	const verified = await verifyAppUpdateKeyList(list, decode(sig), roots, { repo: source.repo, storedSerial: current?.serial });
	if (verified.ok === false) {
		const reason = (verified as Extract<typeof verified, { ok: false }>).reason;
		// The same list again is the normal case, not a problem
		return reason === 'not_newer' ? {} : { problem: reason };
	}
	const accepted = (verified as Extract<typeof verified, { ok: true }>).list;
	const trust = appReleaseTrustFrom(accepted, { revoked: current?.revoked, yanked: current?.yanked });
	return { accepted: { serial: accepted.serial, list: decode(list), sig: decode(sig), revoked: trust.revoked, yanked: trust.yanked, acceptedAt: now.toISOString() } };
}

/** Removes a repo's unsigned releases: its root key is configured now. */
function dropUnsigned(doc: ReleasesDocument, repo: AppReleaseRepo): boolean {
	let changed = false;
	for (const [key, e] of Object.entries(doc.entries)) {
		if (e.repo === repo && !e.signed) {
			delete doc.entries[key];
			changed = true;
		}
	}
	return changed;
}

/** Pairs a manifest releases: every (app, platform) with a file or a store upload. */
function pairsOf(m: AppReleaseManifest): { app: AppConfigApp; platform: AppConfigPlatform }[] {
	const seen = new Map<string, { app: AppConfigApp; platform: AppConfigPlatform }>();
	for (const x of [...m.artifacts, ...m.stores]) seen.set(`${x.app}/${x.platform}`, { app: x.app, platform: x.platform });
	return [...seen.values()];
}

/** Folds one release into the document; a pair keeps its newest version. Returns whether anything changed. */
export function applyManifest(doc: ReleasesDocument, m: AppReleaseManifest, signed: boolean, isPrivate = false): boolean {
	let changed = false;
	const url = isPrivate ? null : `https://github.com/Al-Ummah-Now/${m.repo}/releases/tag/${m.tag}`;
	const manifestUrl = isPrivate ? null : `https://github.com/Al-Ummah-Now/${m.repo}/releases/download/${m.tag}/app-release.json`;
	for (const { app, platform } of pairsOf(m)) {
		const key = entryKey(app, platform, m.channel);
		const current = doc.entries[key];
		const item: ReleaseHistoryItem = { version: m.version, tag: m.tag, publishedAt: m.publishedAt, signed };
		if (current && current.history.some((h) => h.tag === m.tag)) continue;
		if (current && compareAppVersions(m.version, current.version) <= 0) {
			current.history = [...current.history, item].sort((a, b) => compareAppVersions(b.version, a.version)).slice(0, HISTORY);
			changed = true;
			continue;
		}
		doc.entries[key] = {
			app,
			platform,
			channel: m.channel,
			repo: m.repo,
			version: m.version,
			tag: m.tag,
			publishedAt: m.publishedAt,
			notes: m.notes,
			signed,
			private: isPrivate,
			url,
			manifestUrl,
			artifacts: m.artifacts.filter((a) => a.app === app && a.platform === platform),
			stores: m.stores.filter((s) => s.app === app && s.platform === platform).map((s) => s.source),
			history: [item, ...(current?.history ?? [])].slice(0, HISTORY),
		};
		changed = true;
	}
	return changed;
}

/** Drops every entry whose latest version its repo has yanked (no notice until a newer release). */
export function dropYanked(doc: ReleasesDocument): boolean {
	let changed = false;
	for (const [key, e] of Object.entries(doc.entries)) {
		const yanked = doc.keys[e.repo]?.yanked ?? [];
		if (yanked.some((v) => compareAppVersions(v, e.version) === 0)) {
			delete doc.entries[key];
			changed = true;
		}
	}
	return changed;
}

/** Apple's public lookup: the version users can install now. Null when the app is not on the store. */
export async function lookupAppStore(fetchImpl: typeof fetch, bundleId: string, mac: boolean): Promise<Omit<AppStoreStatus, 'checkedAt'> | null> {
	const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}${mac ? '&entity=macSoftware' : ''}`;
	const res = await fetchWithTimeout(fetchImpl, url);
	if (!res.ok) throw new Error(`App Store lookup ${bundleId}: HTTP ${res.status}`);
	const raw = await body(res, LOOKUP_MAX_BYTES);
	if (raw === 'too_large') throw new Error(`App Store lookup ${bundleId}: too large`);
	const json = JSON.parse(decode(raw)) as { results?: { version?: unknown; trackId?: unknown; trackViewUrl?: unknown; bundleId?: unknown }[] };
	const hit = json.results?.find((r) => r.bundleId === bundleId);
	if (!hit || typeof hit.version !== 'string' || typeof hit.trackId !== 'number') return null;
	const trackUrl = typeof hit.trackViewUrl === 'string' && hit.trackViewUrl.startsWith('https://apps.apple.com/') ? hit.trackViewUrl : `https://apps.apple.com/app/id${hit.trackId}`;
	return { version: hit.version, trackId: hit.trackId, url: trackUrl };
}

export async function readReleases(kv: KVNamespace | undefined): Promise<ReleasesDocument> {
	if (!kv) return emptyReleases();
	const raw = (await kv.get(RELEASES_KEY, { type: 'json' })) as Partial<ReleasesDocument> | null;
	if (!raw || typeof raw !== 'object') return emptyReleases();
	return {
		updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
		entries: raw.entries ?? {},
		appStore: raw.appStore ?? {},
		...(raw.appStoreAskedAt ? { appStoreAskedAt: raw.appStoreAskedAt } : {}),
		seen: raw.seen ?? {},
		keys: raw.keys ?? {},
		rooted: raw.rooted ?? [],
		rev: raw.rev,
		quarantined: raw.quarantined ?? [],
	};
}

export interface IndexOptions {
	fetchImpl?: typeof fetch;
	now?: () => Date;
	/** A quarantined release or a refused key list: one admin Errors item each */
	onProblem?: (p: IndexProblem) => void;
	/** Skip the "already running" marker */
	force?: boolean;
	/** The bundle ids set in the Mobile apps settings; the App Store is asked about these only (none: not at all) */
	appStoreBundles?: readonly string[];
}

/**
 * One indexing run. Never throws for one source's trouble: a feed or file that can't be read is
 * retried on the next run (the tag is not marked seen); a quarantined manifest is marked seen and
 * reported once.
 */
export async function indexReleases(env: ReleasesEnv, opts: IndexOptions = {}): Promise<IndexResult> {
	const result: IndexResult = { added: [], problems: [], feedErrors: [], keyLists: [], appStoreChecked: 0 };
	const kv = env.APP_CONFIG;
	if (!kv) return { ...result, skipped: 'no_kv' };
	const fetchImpl = opts.fetchImpl ?? fetch;
	const now = opts.now ?? (() => new Date());
	if (!opts.force && (await kv.get(RUNNING_KEY))) return { ...result, skipped: 'running' };
	await kv.put(RUNNING_KEY, now().toISOString(), { expirationTtl: 120 });
	try {
		const roots = rootKeys(env.UPDATE_ROOT_KEYS);
		const doc = await readReleases(kv);
		let changed = false;
		if (doc.rev !== INDEX_REV) {
			doc.seen = {};
			doc.rev = INDEX_REV;
			changed = true;
		}
		const keyless = noKeyRepos(doc, env.UPDATE_ROOT_KEYS);
		for (const repo of APP_RELEASE_REPOS) {
			if (keyless.has(repo)) continue;
			// A root key is configured: for good, and nothing unsigned of this repo is offered any more
			if (!doc.rooted.includes(repo)) {
				doc.rooted.push(repo);
				changed = true;
			}
			if (dropUnsigned(doc, repo)) changed = true;
		}
		const problem = (p: IndexProblem) => {
			result.problems.push(p);
			opts.onProblem?.(p);
		};
		const sources: Source[] = [
			...APP_RELEASE_REPOS.map((repo) => githubSource(fetchImpl, repo)),
			...(env.ADMIN_RELEASES ? ADMIN_RELEASE_REPOS.map((repo) => bucketSource(env.ADMIN_RELEASES as R2Bucket, repo)) : []),
		];
		for (const source of sources) {
			const repo = source.repo;
			// Key list first: a rotation or revocation applies to this run's manifests
			try {
				const k = await loadKeyList(source, roots[repo] ?? [], doc.keys[repo], now());
				if (k.accepted) {
					doc.keys[repo] = k.accepted;
					result.keyLists.push({ repo, serial: k.accepted.serial });
					changed = true;
				} else if (k.problem) {
					problem({ source: source.id, repo, tag: 'update-keys', reason: `key_list_${k.problem}` });
				}
			} catch (error) {
				logger.warn('[AppUpdates] Key list unreadable; retried next run', { source: source.id, error: error instanceof Error ? error.message : String(error) });
			}
			// Fail closed: once a root key is configured for a repo, nothing of it is indexed (and no tag is marked
			// seen) until a key list signed by that root key has been accepted. Unsigned indexing is only for repos
			// with no root key at all.
			if (!keyless.has(repo) && !doc.keys[repo]) {
				problem({ source: source.id, repo, tag: 'update-keys', reason: 'key_list_not_accepted' });
				continue;
			}
			let tags: string[];
			try {
				tags = await source.tags();
			} catch (error) {
				const status = (error as { status?: number | string }).status;
				result.feedErrors.push({ source: source.id, status: status ?? (error instanceof Error ? error.message : String(error)) });
				continue;
			}
			const seen = doc.seen[source.id] ?? [];
			// Oldest first, so a pair's newest release is applied last
			for (const tag of tags.filter((t) => !seen.includes(t)).reverse()) {
				let outcome: ManifestOutcome;
				let published = true;
				try {
					outcome = await loadManifest(source, tag, doc.keys[repo]);
					if (outcome.kind === 'missing' && !source.private) published = (await source.file(tag, 'SHA256SUMS.txt', SUMS_MAX_BYTES)) !== null;
				} catch (error) {
					logger.warn('[AppUpdates] Manifest unreadable; retried next run', { source: source.id, tag, error: error instanceof Error ? error.message : String(error) });
					continue;
				}
				// Neither a manifest nor checksums: a draft, or still being published. Looked at again next run.
				if (!published) continue;
				seen.unshift(tag);
				changed = true;
				if (outcome.kind === 'missing') continue;
				if (outcome.kind === 'quarantined') {
					const reason = outcome.reason;
					doc.quarantined = [{ source: source.id, repo, tag, reason, at: now().toISOString() }, ...doc.quarantined.filter((q) => q.source !== source.id || q.tag !== tag || q.reason !== reason)].slice(0, QUARANTINE_KEPT);
					problem({ source: source.id, repo, tag, reason: outcome.reason, detail: outcome.detail });
					continue;
				}
				// A signed manifest's own yanked list counts like the key list's
				if (outcome.signed && outcome.manifest.yanked.length && doc.keys[repo]) {
					doc.keys[repo]!.yanked = [...new Set([...doc.keys[repo]!.yanked, ...outcome.manifest.yanked])];
				}
				applyManifest(doc, outcome.manifest, outcome.signed, source.private);
				result.added.push({ source: source.id, repo, tag, signed: outcome.signed });
			}
			doc.seen[source.id] = seen.slice(0, SEEN_PER_SOURCE);
		}
		if (dropYanked(doc)) changed = true;
		// At most daily, and only for the bundles that are set up: Apple refuses more from a Worker (HTTP 403)
		const bundles = APP_STORE_BUNDLES.filter((b) => opts.appStoreBundles?.includes(b.bundleId));
		const askedAt = Date.parse(doc.appStoreAskedAt ?? '');
		const due = bundles.length > 0 && !(now().getTime() - askedAt < APP_STORE_EVERY_MS);
		if (due) {
			doc.appStoreAskedAt = now().toISOString();
			changed = true;
		}
		for (const b of due ? bundles : []) {
			try {
				const hit = await lookupAppStore(fetchImpl, b.bundleId, b.mac === true);
				result.appStoreChecked++;
				const before = doc.appStore[b.bundleId];
				if (hit) doc.appStore[b.bundleId] = { ...hit, checkedAt: now().toISOString() };
				else delete doc.appStore[b.bundleId];
				if (before?.version !== hit?.version) changed = true;
			} catch (error) {
				logger.warn('[AppUpdates] App Store lookup failed; kept the last answer', { bundleId: b.bundleId, error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (changed) {
			doc.updatedAt = now().toISOString();
			await kv.put(RELEASES_KEY, JSON.stringify(doc));
		}
		return result;
	} finally {
		await kv.delete(RUNNING_KEY);
	}
}

/** The App Store bundle of a pair, when it has one. */
export function appStoreBundleFor(app: AppConfigApp, platform: AppConfigPlatform): string | null {
	return APP_STORE_BUNDLES.find((b) => b.app === app && b.platforms.includes(platform))?.bundleId ?? null;
}
