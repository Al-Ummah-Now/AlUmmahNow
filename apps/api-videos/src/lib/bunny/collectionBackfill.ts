/**
 * Channel collection backfill (2026-11-12 owner request: in Bunny, each
 * channel's videos are grouped in the channel's collection).
 *
 * Puts every existing video into its channel's collection in the video's own
 * library (lib/bunny/libraries.ts; production: 498994 and legacy 400189, QA
 * and stage: the shared test library). Collections are created or adopted
 * per library exactly as an upload does (lib/channelCollection.ts).
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
 * Skipped (counted): user-level uploads (no channel), records of a library
 * this env does not know, videos Bunny no longer has, deleted channels.
 * State: global_settings `ops/bunny-collections/runs/<runId>.json` (+ latest.json).
 */
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { bunnyFileToken, tokenExpiry } from '../bunny-signing';
import { adoptLegacyCollection, ensureChannelCollection, storedCollectionId, type CollectionChannel } from '../channelCollection';
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
	page: number;
	cursor: string | null;
	dryRun: boolean;
	limit?: number;
}

export interface LibraryCounts {
	videos: number;
	alreadyPlaced: number;
	/** Dry run: would be moved; apply: moved */
	moved: number;
	missingInBunny: number;
	errors: number;
}

export interface CollectionBackfillCounts {
	scanned: number;
	noChannel: number;
	channelMissing: number;
	unknownLibrary: number;
	byLibrary: Record<string, LibraryCounts>;
	/** channelId:libraryId pairs that need a collection: created (or would be), adopted from the legacy id (or would be) */
	collectionsCreated: string[];
	collectionsAdopted: string[];
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
	lastError?: string;
	errors?: Array<{ id: string; error: string }>;
}

interface BackfillVideo extends LibraryHints {
	id: string;
	userId?: string;
	channelId?: string;
	isDeleted?: boolean;
}

interface BackfillChannel extends CollectionChannel {
	id?: string;
	isDeleted?: boolean;
}

export interface CollectionBackfillEnv extends BunnyLibrariesEnv {
	videos: R2Bucket;
	channels: R2Bucket;
	global_settings?: R2Bucket;
	PROCESSING_CHECK_QUEUE?: Queue;
	BUNNY_NAME_PREFIX?: string;
}

export function isCollectionBackfillMessage(body: unknown): body is CollectionBackfillMessage {
	const b = body as Partial<CollectionBackfillMessage> | null;
	return !!b && b.kind === COLLECTION_BACKFILL_KIND && typeof b.runId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.runId) && typeof b.page === 'number' && typeof b.dryRun === 'boolean';
}

function emptyCounts(): CollectionBackfillCounts {
	return { scanned: 0, noChannel: 0, channelMissing: 0, unknownLibrary: 0, byLibrary: {}, collectionsCreated: [], collectionsAdopted: [] };
}

function libCounts(counts: CollectionBackfillCounts, libraryId: number): LibraryCounts {
	const key = String(libraryId);
	return (counts.byLibrary[key] ??= { videos: 0, alreadyPlaced: 0, moved: 0, missingInBunny: 0, errors: 0 });
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

/** Totals over every page (collections counted once per channel and library) */
export function sumCounts(pages: Record<string, CollectionBackfillCounts>): CollectionBackfillCounts {
	const total = emptyCounts();
	const created = new Set<string>();
	const adopted = new Set<string>();
	for (const page of Object.values(pages)) {
		total.scanned += page.scanned;
		total.noChannel += page.noChannel;
		total.channelMissing += page.channelMissing;
		total.unknownLibrary += page.unknownLibrary;
		for (const [lib, c] of Object.entries(page.byLibrary)) {
			const t = libCounts(total, Number(lib));
			t.videos += c.videos;
			t.alreadyPlaced += c.alreadyPlaced;
			t.moved += c.moved;
			t.missingInBunny += c.missingInBunny;
			t.errors += c.errors;
		}
		page.collectionsCreated.forEach((k) => created.add(k));
		page.collectionsAdopted.forEach((k) => adopted.add(k));
	}
	total.collectionsCreated = [...created];
	total.collectionsAdopted = [...adopted];
	return total;
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
	/** channelId:libraryId → collection id (undefined in a dry run when it would be created) */
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

	// 1. Sequential: each video's library and its channel's collection there
	//    (one create/adopt per channel and library, never raced)
	const work: { video: BackfillVideo; library: BunnyLibrary; counts: LibraryCounts; target: string | undefined }[] = [];
	for (const video of records) {
		if (!video?.id) continue;
		counts.scanned++;
		if (!video.channelId || video.channelId === video.userId) {
			counts.noChannel++;
			continue;
		}
		const library = pickLibrary(libraries, video);
		if (!library || (!library.apiKey && !library.primary)) {
			counts.unknownLibrary++;
			continue;
		}
		const c = libCounts(counts, library.libraryId);
		c.videos++;
		try {
			if (!channelCache.has(video.channelId)) channelCache.set(video.channelId, await channels.getObject(video.channelId));
			const channel = channelCache.get(video.channelId) ?? null;
			if (!channel || channel.isDeleted) {
				counts.channelMissing++;
				continue;
			}
			const client = clientOf(library);
			const { libraryId } = bunnyApi(library);
			const pair = `${video.channelId}:${libraryId}`;
			if (!targets.has(pair)) {
				let target = storedCollectionId(channel, libraryId);
				if (!target) {
					if (message.dryRun) {
						// Read-only: would the legacy id be adopted, or a collection created?
						const legacy = channel.bunnyCollectionId;
						const held = legacy ? await client.getCollection(libraryId, legacy).then((col) => !!col?.guid).catch(() => false) : false;
						if (held) {
							target = legacy!;
							counts.collectionsAdopted.push(pair);
						} else counts.collectionsCreated.push(pair);
					} else {
						const adopted = await adoptLegacyCollection(channels, client, libraryId, video.channelId, channel);
						if (adopted) {
							target = adopted;
							counts.collectionsAdopted.push(pair);
						} else {
							target = await ensureChannelCollection(channels, client, libraryId, video.channelId, channel.name || `Channel ${video.channelId}`);
							if (target) counts.collectionsCreated.push(pair);
						}
						// Later videos of the channel see the stored id
						channelCache.set(video.channelId, await channels.getObject(video.channelId));
					}
				}
				targets.set(pair, target);
			}
			work.push({ video, library, counts: c, target: targets.get(pair) });
		} catch (error) {
			c.errors++;
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
		if (run.status === 'done' || run.pages[String(body.page)]) {
			logger.info('[CollectionBackfill] Duplicate page delivery acknowledged', { runId: body.runId, page: body.page });
			msg.ack();
			return;
		}
		if (body.page === 0 && !run.libraries) {
			run.libraries = {};
			for (const library of await bunnyLibraries(env)) {
				if (!library.primary && !library.apiKey) continue;
				run.libraries[String(library.libraryId)] = await checkLibrary(library);
			}
		}
		const result = await runCollectionBackfillPage(env, body);
		if (result.errors.length && msg.attempts < RECORD_ERRORS_ON_ATTEMPT) {
			throw new Error(`${result.errors.length} video(s) failed: ${result.errors.slice(0, 3).map((e) => `${e.id}: ${e.error}`).join('; ')}`);
		}
		if (result.nextCursor) {
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, page: body.page + 1, cursor: result.nextCursor } satisfies CollectionBackfillMessage, {
				delaySeconds: PAGE_DELAY_SECONDS,
			});
		}
		run.pages[String(body.page)] = result.counts;
		if (result.errors.length) run.errors = [...(run.errors ?? []), ...result.errors].slice(-200);
		run.totals = sumCounts(run.pages);
		run.updatedAt = at;
		delete run.lastError;
		if (!result.nextCursor) {
			run.status = 'done';
			run.finishedAt = at;
		}
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
