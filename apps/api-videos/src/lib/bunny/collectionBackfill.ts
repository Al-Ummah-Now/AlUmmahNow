/**
 * Channel collection backfill (2026-11-12 owner request: in Bunny, each
 * channel's videos are grouped in the channel's collection).
 *
 * Puts every existing video into a collection in the video's own library
 * (lib/bunny/libraries.ts; production: 498994 and legacy 400189, QA and stage:
 * the shared test library), created or adopted per library exactly as an
 * upload does (lib/channelCollection.ts):
 *
 * - channel: the video's channel is a real channel → the channel's collection;
 * - user: a user-level upload (channelId is the owner, or no channel) → the
 *   owner's user collection;
 * - deletedChannel: its channel was deleted (or never existed) → the owner's
 *   user collection;
 * - ownerMissing: a user collection is needed but the owner has no profile →
 *   listed, never moved.
 *
 * After the last page, every library's Bunny videos that no record (and no
 * live stream) references are listed: list only, nothing is ever deleted.
 *
 * Runs as a chain of messages on PROCESSING_CHECK_QUEUE (kind
 * `bunny-collection-backfill`), one page of the videos bucket per message:
 *
 *   { kind, runId, page: 0, cursor: null, dryRun: true, limit: 25 }
 *
 * Dry run: reads R2 and Bunny (GET only) and counts what it would do; the
 * only write is the run's own state. Apply: creates/adopts collections (channel
 * JSON, conditional write) and sets each video's collection with Bunny's
 * update-video call. Idempotent: a video already in its collection is left.
 * Page 0 also checks each library's CDN host (signed thumbnail of one of its
 * videos), so the host and token key of every library are proven.
 *
 * Counted, not moved: records of a library this env does not know, videos
 * Bunny no longer has, owners without a profile.
 * State: global_settings `ops/bunny-collections/runs/<runId>.json` (+ latest.json).
 */
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { bunnyFileToken, tokenExpiry } from '../bunny-signing';
import { adoptLegacyCollection, ensureChannelCollection, storedCollectionId, userCollectionName, type CollectionChannel, type CollectionProfile } from '../channelCollection';
import { bunnyApi, bunnyClient, bunnyLibraries, pickLibrary, type BunnyLibrariesEnv, type BunnyLibrary, type LibraryHints } from './libraries';
import type { BunnyStreamClient } from './stream';

export const COLLECTION_BACKFILL_KIND = 'bunny-collection-backfill';
export const COLLECTION_BACKFILL_PREFIX = 'ops/bunny-collections/';
const PAGE_SIZE = 25;
const PAGE_DELAY_SECONDS = 5;
/** Bunny / R2 calls in flight per page */
const CONCURRENCY = 6;
const JSON_META = { httpMetadata: { contentType: 'application/json' } };

export interface CollectionBackfillMessage {
	kind: typeof COLLECTION_BACKFILL_KIND;
	runId: string;
	/** Video pages (default), then per library: the unreferenced-video scan, then the stray-collection scan */
	phase?: 'videos' | 'unreferenced' | 'collections';
	page: number;
	cursor: string | null;
	dryRun: boolean;
	limit?: number;
	/** phase 'unreferenced': the library scanned and its Bunny page (from 1) */
	libraryId?: number;
	bunnyPage?: number;
}

export type Placement = 'channel' | 'user' | 'deletedChannel';

export interface PlacementCounts {
	videos: number;
	alreadyPlaced: number;
	/** Dry run: would be moved; apply: moved */
	moved: number;
	missingInBunny: number;
	errors: number;
}

export interface LibraryCounts {
	channel: PlacementCounts;
	user: PlacementCounts;
	deletedChannel: PlacementCounts;
	/** Needs the owner's collection, but the owner has no profile (listed in ownerMissing) */
	ownerMissing: number;
}

export interface CollectionBackfillCounts {
	scanned: number;
	unknownLibrary: number;
	byLibrary: Record<string, LibraryCounts>;
	/** "channel:<id>:<lib>" / "user:<id>:<lib>": created (or would be), adopted from the legacy id (or would be) */
	collectionsCreated: string[];
	collectionsAdopted: string[];
	ownerMissing: Array<{ videoId: string; libraryId: number; userId?: string; channelId?: string }>;
}

export interface UnreferencedVideo {
	guid: string;
	title?: string;
	status?: number;
	storageSize?: number;
	dateUploaded?: string;
	collectionId?: string;
}

/** A collection named after a channel id (old POST /api/videos) */
export interface StrayCollection {
	guid: string;
	name: string;
	videoCount: number;
	/** The channel the name refers to still exists */
	channelExists: boolean;
	/** Apply: removed because the video pages emptied it */
	deleted?: boolean;
}

export interface StrayScan {
	scanned: number;
	items: StrayCollection[];
	pages: number[];
	done: boolean;
}

export interface UnreferencedScan {
	scanned: number;
	count: number;
	storageBytes: number;
	/** First 1000 */
	items: UnreferencedVideo[];
	pages: number[];
	done: boolean;
}

export interface LibraryCheck {
	host: string | null;
	videosInLibrary: number | null;
	collectionsInLibrary: number | null;
	/** HTTP status of a signed (when token auth is on) thumbnail of one of its videos; null when it has none */
	thumbnailStatus: number | null;
	error?: string;
}

export interface CollectionBackfillRun {
	runId: string;
	dryRun: boolean;
	status: 'running' | 'done' | 'failed';
	startedAt: string;
	updatedAt: string;
	finishedAt?: string;
	libraries?: Record<string, LibraryCheck>;
	pages: Record<string, CollectionBackfillCounts>;
	totals?: CollectionBackfillCounts;
	/** Bunny videos no record references, per library (list only) */
	unreferenced?: Record<string, UnreferencedScan>;
	/** Collections named after a channel id, per library; their videos were moved by the video pages, empty ones removed on apply */
	strayCollections?: Record<string, StrayScan>;
	lastError?: string;
	errors?: Array<{ id: string; error: string }>;
}

interface BackfillVideo extends LibraryHints {
	id: string;
	userId?: string;
	channelId?: string;
	isDeleted?: boolean;
}

interface BackfillProfile extends CollectionProfile {
	id?: string;
}

interface BackfillChannel extends CollectionChannel {
	id?: string;
	isDeleted?: boolean;
}

export interface CollectionBackfillEnv extends BunnyLibrariesEnv {
	videos: R2Bucket;
	channels: R2Bucket;
	profiles: R2Bucket;
	global_settings?: R2Bucket;
	PROCESSING_CHECK_QUEUE?: Queue;
	BUNNY_NAME_PREFIX?: string;
}

export function isCollectionBackfillMessage(body: unknown): body is CollectionBackfillMessage {
	const b = body as Partial<CollectionBackfillMessage> | null;
	return !!b && b.kind === COLLECTION_BACKFILL_KIND && typeof b.runId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.runId) && typeof b.page === 'number' && typeof b.dryRun === 'boolean';
}

function emptyCounts(): CollectionBackfillCounts {
	return { scanned: 0, unknownLibrary: 0, byLibrary: {}, collectionsCreated: [], collectionsAdopted: [], ownerMissing: [] };
}

const emptyPlacement = (): PlacementCounts => ({ videos: 0, alreadyPlaced: 0, moved: 0, missingInBunny: 0, errors: 0 });

function libCounts(counts: CollectionBackfillCounts, libraryId: number): LibraryCounts {
	const key = String(libraryId);
	return (counts.byLibrary[key] ??= { channel: emptyPlacement(), user: emptyPlacement(), deletedChannel: emptyPlacement(), ownerMissing: 0 });
}

/** Totals over every page (collections counted once per owner and library) */
export function sumCounts(pages: Record<string, CollectionBackfillCounts>): CollectionBackfillCounts {
	const total = emptyCounts();
	const created = new Set<string>();
	const adopted = new Set<string>();
	for (const page of Object.values(pages)) {
		total.scanned += page.scanned;
		total.unknownLibrary += page.unknownLibrary;
		for (const [lib, c] of Object.entries(page.byLibrary)) {
			const t = libCounts(total, Number(lib));
			for (const placement of ['channel', 'user', 'deletedChannel'] as const) {
				for (const k of Object.keys(t[placement]) as (keyof PlacementCounts)[]) t[placement][k] += c[placement][k];
			}
			t.ownerMissing += c.ownerMissing;
		}
		page.collectionsCreated.forEach((k) => created.add(k));
		page.collectionsAdopted.forEach((k) => adopted.add(k));
		total.ownerMissing.push(...page.ownerMissing);
	}
	total.collectionsCreated = [...created];
	total.collectionsAdopted = [...adopted];
	total.ownerMissing = total.ownerMissing.slice(0, 1000);
	return total;
}

/** Runs `task` over `items`, `limit` at a time; results in input order */
async function eachLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await task(items[i]);
			}
		}),
	);
	return out;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}


/** Bunny's current collection of a video; null when Bunny has no such video */
async function bunnyCollectionOf(client: BunnyStreamClient, libraryId: number, videoId: string): Promise<{ collectionId: string } | null> {
	try {
		const video = await client.getVideo(libraryId, videoId);
		return { collectionId: (video as { collectionId?: string | null }).collectionId || '' };
	} catch (error) {
		if (/status: 404/.test(errorText(error))) return null;
		throw error;
	}
}

/**
 * Proves a library's CDN host and token key: one of its videos' thumbnails,
 * signed like an API response. 200 = host and key belong to this library.
 */
export async function checkLibrary(library: BunnyLibrary): Promise<LibraryCheck> {
	const check: LibraryCheck = { host: library.host ?? null, videosInLibrary: null, collectionsInLibrary: null, thumbnailStatus: null };
	try {
		const { libraryId, apiKey } = bunnyApi(library);
		const headers = { AccessKey: apiKey, accept: 'application/json' };
		const videos = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos?page=1&itemsPerPage=5&orderBy=date`, { headers });
		if (!videos.ok) throw new Error(`list videos: HTTP ${videos.status}`);
		const body = (await videos.json()) as { items?: { guid: string; status?: number; thumbnailFileName?: string }[]; totalItems?: number };
		check.videosInLibrary = body.totalItems ?? null;
		const collections = await fetch(`https://video.bunnycdn.com/library/${libraryId}/collections?page=1&itemsPerPage=1`, { headers });
		if (collections.ok) check.collectionsInLibrary = ((await collections.json()) as { totalItems?: number }).totalItems ?? null;
		const sample = body.items?.find((v) => v.status === 4) ?? body.items?.[0];
		if (sample && library.host) {
			const path = `/${sample.guid}/${sample.thumbnailFileName || 'thumbnail.jpg'}`;
			let url = `https://${library.host}${path}`;
			if (library.tokenKey) {
				const expires = tokenExpiry();
				url += `?token=${await bunnyFileToken(library.tokenKey, path, expires)}&expires=${expires}`;
			}
			check.thumbnailStatus = (await fetch(url, { method: 'HEAD' })).status;
		}
	} catch (error) {
		check.error = errorText(error);
	}
	return check;
}

/** One page of the videos bucket. Throws on transient trouble (the queue retries the page). */
export async function runCollectionBackfillPage(
	env: CollectionBackfillEnv,
	message: Pick<CollectionBackfillMessage, 'cursor' | 'limit' | 'dryRun'>,
): Promise<{ counts: CollectionBackfillCounts; nextCursor: string | null; errors: Array<{ id: string; error: string }> }> {
	const limit = Math.min(Math.max(Math.floor(message.limit || PAGE_SIZE), 1), 50);
	const listing = await env.videos.list({ limit, ...(message.cursor ? { cursor: message.cursor } : {}) });
	const libraries = await bunnyLibraries(env);
	const videos = new R2Repository<BackfillVideo>(env.videos);
	const channels = new R2Repository<BackfillChannel>(env.channels);
	const counts = emptyCounts();
	const errors: Array<{ id: string; error: string }> = [];
	const clients = new Map<number, BunnyStreamClient>();
	const clientOf = (library: BunnyLibrary) => {
		let client = clients.get(library.libraryId);
		if (!client) {
			client = bunnyClient(env, library).client;
			clients.set(library.libraryId, client);
		}
		return client;
	};
	const channelCache = new Map<string, BackfillChannel | null>();
	const profileCache = new Map<string, BackfillProfile | null>();
	const profiles = new R2Repository<BackfillProfile>(env.profiles);
	/** "<kind>:<ownerId>:<libraryId>" → collection id (undefined in a dry run when it would be created) */
	const targets = new Map<string, string | undefined>();

	// Video records only (no livestream:, comment or other keyed objects), read in parallel
	const keys = listing.objects.map((o) => o.key).filter((key) => !key.includes(':') && !key.includes('/'));
	const records = await eachLimited(keys, CONCURRENCY, async (key) => {
		try {
			return await videos.getObject(key);
		} catch (error) {
			errors.push({ id: key, error: errorText(error) });
			return null;
		}
	});

	const channelOf = async (id: string) => {
		if (!channelCache.has(id)) channelCache.set(id, await channels.getObject(id));
		return channelCache.get(id) ?? null;
	};
	const profileOf = async (id: string) => {
		if (!profileCache.has(id)) profileCache.set(id, await profiles.getObject(id));
		return profileCache.get(id) ?? null;
	};

	/** The owner's (channel or user) collection in a library, created/adopted once per page */
	const resolveTarget = async (kind: 'channel' | 'user', ownerId: string, owner: CollectionChannel, library: BunnyLibrary): Promise<string | undefined> => {
		const { libraryId } = bunnyApi(library);
		const pair = `${kind}:${ownerId}:${libraryId}`;
		if (targets.has(pair)) return targets.get(pair);
		const client = clientOf(library);
		const repo = (kind === 'channel' ? channels : profiles) as R2Repository<CollectionChannel>;
		const name = kind === 'channel' ? owner.name || `Channel ${ownerId}` : userCollectionName(owner as CollectionProfile, ownerId);
		let target = storedCollectionId(owner, libraryId);
		if (!target) {
			const legacy = kind === 'channel' ? owner.bunnyCollectionId : undefined;
			if (message.dryRun) {
				// Read-only: would the legacy id be adopted, or a collection created?
				const held = legacy ? await client.getCollection(libraryId, legacy).then((col) => !!col?.guid).catch(() => false) : false;
				if (held) {
					target = legacy!;
					counts.collectionsAdopted.push(pair);
				} else counts.collectionsCreated.push(pair);
			} else {
				const adopted = legacy ? await adoptLegacyCollection(repo, client, libraryId, ownerId, owner) : undefined;
				if (adopted) {
					target = adopted;
					counts.collectionsAdopted.push(pair);
				} else {
					target = await ensureChannelCollection(repo, client, libraryId, ownerId, name);
					if (target) counts.collectionsCreated.push(pair);
				}
				// Later videos of the owner see the stored id
				if (kind === 'channel') channelCache.set(ownerId, await channels.getObject(ownerId));
				else profileCache.set(ownerId, await profiles.getObject(ownerId));
			}
		}
		targets.set(pair, target);
		return target;
	};

	// 1. Sequential: each video's library, placement and target collection
	const work: { video: BackfillVideo; library: BunnyLibrary; counts: PlacementCounts; target: string | undefined }[] = [];
	for (const video of records) {
		if (!video?.id) continue;
		counts.scanned++;
		const library = pickLibrary(libraries, video);
		if (!library || (!library.apiKey && !library.primary)) {
			counts.unknownLibrary++;
			continue;
		}
		const lc = libCounts(counts, library.libraryId);
		let placement: Placement = 'user';
		try {
			let channel: BackfillChannel | null = null;
			if (video.channelId && video.channelId !== video.userId) {
				channel = await channelOf(video.channelId);
				placement = channel && !channel.isDeleted ? 'channel' : 'deletedChannel';
			}
			const c = lc[placement];
			c.videos++;
			let target: string | undefined;
			if (placement === 'channel') {
				target = await resolveTarget('channel', video.channelId!, channel!, library);
			} else {
				const owner = video.userId ? await profileOf(video.userId) : null;
				if (!owner) {
					c.videos--;
					lc.ownerMissing++;
					counts.ownerMissing.push({ videoId: video.id, libraryId: library.libraryId, userId: video.userId, channelId: video.channelId });
					continue;
				}
				target = await resolveTarget('user', video.userId!, owner, library);
			}
			work.push({ video, library, counts: c, target });
		} catch (error) {
			lc[placement].errors++;
			errors.push({ id: video.id, error: errorText(error) });
		}
	}

	// 2. Parallel: Bunny's current collection of each video, moved when it differs
	await eachLimited(work, CONCURRENCY, async ({ video, library, counts: c, target }) => {
		try {
			const client = clientOf(library);
			const current = await bunnyCollectionOf(client, library.libraryId, video.id);
			if (!current) {
				c.missingInBunny++;
				return;
			}
			if (target && current.collectionId === target) {
				c.alreadyPlaced++;
				return;
			}
			c.moved++;
			if (!message.dryRun) {
				if (!target) throw new Error('no collection for the channel');
				await client.updateVideo(library.libraryId, video.id, { collectionId: target });
			}
		} catch (error) {
			c.errors++;
			errors.push({ id: video.id, error: errorText(error) });
		}
	});
	return { counts, nextCursor: listing.truncated ? listing.cursor ?? null : null, errors };
}

const UNREFERENCED_PAGE_SIZE = 100;

/**
 * One page of a library's Bunny videos: those that no video record (and no
 * live stream record) references. List only: nothing is deleted.
 */
export async function scanUnreferencedPage(
	env: CollectionBackfillEnv,
	library: BunnyLibrary,
	page: number,
): Promise<{ scanned: number; unreferenced: UnreferencedVideo[]; more: boolean }> {
	const { libraryId, apiKey } = bunnyApi(library);
	const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos?page=${page}&itemsPerPage=${UNREFERENCED_PAGE_SIZE}&orderBy=date`, {
		headers: { AccessKey: apiKey, accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`list videos ${libraryId} page ${page}: HTTP ${res.status}`);
	const body = (await res.json()) as { items?: Array<UnreferencedVideo & { guid: string }>; totalItems?: number };
	const items = body.items ?? [];
	// Live streams keep their Bunny video id inside the record (streamUrl)
	let liveText = '';
	let cursor: string | undefined;
	do {
		const listed = await env.videos.list({ prefix: 'livestream:', cursor, limit: 500 });
		for (const o of listed.objects) liveText += (await (await env.videos.get(o.key))?.text()) ?? '';
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
	const present = await eachLimited(items, CONCURRENCY, async (v) => !!(await env.videos.head(v.guid)) || liveText.includes(v.guid));
	const unreferenced = items
		.filter((_, i) => !present[i])
		.map((v) => ({ guid: v.guid, title: v.title, status: v.status, storageSize: v.storageSize, dateUploaded: v.dateUploaded, collectionId: v.collectionId || undefined }));
	return { scanned: items.length, unreferenced, more: items.length === UNREFERENCED_PAGE_SIZE && page * UNREFERENCED_PAGE_SIZE < (body.totalItems ?? Infinity) };
}

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A leading env tag such as "[stage] " (BunnyStreamClient.prefixed) */
const ENV_TAG = /^(?:\s*\[[^\]]{1,32}\]\s+)+/;

/**
 * One page of a library's collections: those named after a channel id (the old
 * POST /api/videos named its collection after the channel id and never stored
 * it). Apply removes those the video pages emptied; any still holding videos
 * (videos no record references) are kept and listed.
 */
export async function scanStrayCollectionsPage(
	env: CollectionBackfillEnv,
	library: BunnyLibrary,
	page: number,
	dryRun: boolean,
): Promise<{ scanned: number; stray: StrayCollection[]; more: boolean }> {
	const { libraryId, apiKey } = bunnyApi(library);
	const res = await fetch(`https://video.bunnycdn.com/library/${libraryId}/collections?page=${page}&itemsPerPage=${UNREFERENCED_PAGE_SIZE}`, {
		headers: { AccessKey: apiKey, accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`list collections ${libraryId} page ${page}: HTTP ${res.status}`);
	const body = (await res.json()) as { items?: Array<{ guid: string; name?: string; videoCount?: number }>; totalItems?: number };
	const items = body.items ?? [];
	const stray: StrayCollection[] = [];
	for (const c of items) {
		const bare = (c.name ?? '').replace(ENV_TAG, '').trim();
		if (!UUID_NAME.test(bare)) continue;
		const entry: StrayCollection = { guid: c.guid, name: c.name ?? '', videoCount: c.videoCount ?? 0, channelExists: !!(await env.channels.head(bare)) };
		if (!dryRun && entry.videoCount === 0) {
			await bunnyClient(env, library).client.deleteCollection(libraryId, c.guid);
			entry.deleted = true;
		}
		stray.push(entry);
	}
	// Deleting shifts later pages forward: the caller re-reads the same page until nothing more goes
	const removed = stray.filter((x) => x.deleted).length;
	return { scanned: items.length, stray, more: removed > 0 ? items.length > 0 : items.length === UNREFERENCED_PAGE_SIZE && page * UNREFERENCED_PAGE_SIZE < (body.totalItems ?? Infinity) };
}

export function runKey(runId: string): string {
	return `${COLLECTION_BACKFILL_PREFIX}runs/${runId}.json`;
}

export async function readCollectionBackfillRun(env: Pick<CollectionBackfillEnv, 'global_settings'>, runId: string): Promise<CollectionBackfillRun | null> {
	const object = await env.global_settings?.get(runKey(runId));
	return object ? ((await object.json()) as CollectionBackfillRun) : null;
}

async function writeRun(env: CollectionBackfillEnv, run: CollectionBackfillRun): Promise<void> {
	if (!env.global_settings) throw new Error('global_settings bucket is not bound');
	const body = JSON.stringify(run);
	await env.global_settings.put(runKey(run.runId), body, JSON_META);
	await env.global_settings.put(`${COLLECTION_BACKFILL_PREFIX}latest.json`, body, JSON_META);
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** A page whose videos keep failing is recorded (errors) and the run goes on after this many deliveries */
const RECORD_ERRORS_ON_ATTEMPT = 3;

/** Consumer for one backfill message (index.ts queue()). */
export async function handleCollectionBackfillMessage(env: CollectionBackfillEnv, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body;
	if (!isCollectionBackfillMessage(body)) {
		logger.error('[CollectionBackfill] Malformed message dropped', { body });
		msg.ack();
		return;
	}
	try {
		const at = now.toISOString();
		const run: CollectionBackfillRun = (await readCollectionBackfillRun(env, body.runId)) ?? {
			runId: body.runId,
			dryRun: body.dryRun,
			status: 'running',
			startedAt: at,
			updatedAt: at,
			pages: {},
		};
		if (run.status === 'done') {
			msg.ack();
			return;
		}
		const scanLibraries = (await bunnyLibraries(env)).filter((l) => l.primary || l.apiKey);
		const startScan = async (index: number) => {
			const next = scanLibraries[index];
			if (!next) return false;
			await env.PROCESSING_CHECK_QUEUE!.send(
				{ kind: COLLECTION_BACKFILL_KIND, runId: body.runId, phase: 'unreferenced', page: 0, cursor: null, dryRun: body.dryRun, libraryId: next.libraryId, bunnyPage: 1 } satisfies CollectionBackfillMessage,
				{ delaySeconds: PAGE_DELAY_SECONDS },
			);
			return true;
		};

		if (body.phase === 'unreferenced') {
			const index = scanLibraries.findIndex((l) => l.libraryId === body.libraryId);
			const library = scanLibraries[index];
			const bunnyPage = body.bunnyPage ?? 1;
			const scan = ((run.unreferenced ??= {})[String(body.libraryId)] ??= { scanned: 0, count: 0, storageBytes: 0, items: [], pages: [], done: false });
			if (!library || scan.pages.includes(bunnyPage)) {
				msg.ack();
				return;
			}
			const result = await scanUnreferencedPage(env, library, bunnyPage);
			scan.pages.push(bunnyPage);
			scan.scanned += result.scanned;
			scan.count += result.unreferenced.length;
			scan.storageBytes += result.unreferenced.reduce((n, v) => n + (v.storageSize ?? 0), 0);
			scan.items = [...scan.items, ...result.unreferenced].slice(0, 1000);
			if (result.more) {
				await env.PROCESSING_CHECK_QUEUE!.send({ ...body, bunnyPage: bunnyPage + 1 } satisfies CollectionBackfillMessage, { delaySeconds: PAGE_DELAY_SECONDS });
			} else {
				scan.done = true;
				await env.PROCESSING_CHECK_QUEUE!.send(
					{ ...body, phase: 'collections', bunnyPage: 1 } satisfies CollectionBackfillMessage,
					{ delaySeconds: PAGE_DELAY_SECONDS },
				);
			}
			run.updatedAt = at;
			await writeRun(env, run);
			logger.info('[CollectionBackfill] Unreferenced scan page done', { runId: body.runId, libraryId: body.libraryId, bunnyPage, unreferenced: result.unreferenced.length });
			msg.ack();
			return;
		}

		if (body.phase === 'collections') {
			const index = scanLibraries.findIndex((l) => l.libraryId === body.libraryId);
			const library = scanLibraries[index];
			const bunnyPage = body.bunnyPage ?? 1;
			const scan = ((run.strayCollections ??= {})[String(body.libraryId)] ??= { scanned: 0, items: [], pages: [], done: false });
			if (!library || scan.done) {
				msg.ack();
				return;
			}
			const result = await scanStrayCollectionsPage(env, library, bunnyPage, body.dryRun);
			scan.pages.push(bunnyPage);
			scan.scanned += result.scanned;
			scan.items = [...scan.items, ...result.stray.filter((x) => !scan.items.some((y) => y.guid === x.guid))].slice(0, 2000);
			// After deletions the same page holds the next collections
			const deletedHere = result.stray.some((x) => x.deleted);
			if (result.more) {
				await env.PROCESSING_CHECK_QUEUE!.send({ ...body, bunnyPage: deletedHere ? bunnyPage : bunnyPage + 1 } satisfies CollectionBackfillMessage, { delaySeconds: PAGE_DELAY_SECONDS });
			} else {
				scan.done = true;
				if (!(await startScan(index + 1))) {
					run.status = 'done';
					run.finishedAt = at;
				}
			}
			run.updatedAt = at;
			await writeRun(env, run);
			logger.info('[CollectionBackfill] Stray collection page done', { runId: body.runId, libraryId: body.libraryId, bunnyPage, stray: result.stray.length });
			msg.ack();
			return;
		}

		if (run.pages[String(body.page)]) {
			logger.info('[CollectionBackfill] Duplicate page delivery acknowledged', { runId: body.runId, page: body.page });
			msg.ack();
			return;
		}
		if (body.page === 0 && !run.libraries) {
			run.libraries = {};
			for (const library of scanLibraries) run.libraries[String(library.libraryId)] = await checkLibrary(library);
		}
		const result = await runCollectionBackfillPage(env, body);
		if (result.errors.length && msg.attempts < RECORD_ERRORS_ON_ATTEMPT) {
			throw new Error(`${result.errors.length} video(s) failed: ${result.errors.slice(0, 3).map((e) => `${e.id}: ${e.error}`).join('; ')}`);
		}
		if (result.nextCursor) {
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, page: body.page + 1, cursor: result.nextCursor } satisfies CollectionBackfillMessage, {
				delaySeconds: PAGE_DELAY_SECONDS,
			});
		} else if (!(await startScan(0))) {
			run.status = 'done';
			run.finishedAt = at;
		}
		run.pages[String(body.page)] = result.counts;
		if (result.errors.length) run.errors = [...(run.errors ?? []), ...result.errors].slice(-200);
		run.totals = sumCounts(run.pages);
		run.updatedAt = at;
		delete run.lastError;
		await writeRun(env, run);
		logger.info('[CollectionBackfill] Page done', { runId: body.runId, page: body.page, dryRun: body.dryRun, scanned: result.counts.scanned, done: run.status === 'done' });
		msg.ack();
	} catch (error) {
		const delaySeconds = Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1));
		logger.warn('[CollectionBackfill] Page failed; retrying', { runId: body.runId, page: body.page, attempts: msg.attempts, error: errorText(error) });
		try {
			const run = await readCollectionBackfillRun(env, body.runId);
			if (run) await writeRun(env, { ...run, lastError: errorText(error), updatedAt: now.toISOString() });
		} catch {
			// state is informational
		}
		msg.retry({ delaySeconds });
	}
}
