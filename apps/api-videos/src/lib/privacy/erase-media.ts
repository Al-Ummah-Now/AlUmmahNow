/**
 * What an account erasure leaves in the media stores, deleted by a job that cannot be lost
 * (admin job `user.erase-media`, videos admin → Jobs).
 *
 *   erase  → writes what a record's media is to the job (admin_jobs, D1) BEFORE it deletes the record;
 *            when that write fails the record stays, and the erase is called again
 *   job    → ERASE_DELAY later (so a case about it still finds everything), once the record is gone: R2 renditions, thumbnails, originals and audio, review frames and
 *            transcripts, subtitles, Bunny Stream, image files, live recordings, caption work, CDN copies,
 *            notifications. Idempotent, a page at a time, within a call budget per step
 *          → what fails is tried again for a day (RETRY_DELAYS), then the job fails: Jobs page
 *            (state, reason, Retry) and an Errors page item
 *          → SWEEP_DELAY later everything is checked once more (an encode that ended meanwhile)
 *
 * The job names no account: only ids of deleted records and file paths. A profile image's uploader stays
 * on its image_owners row until the file is gone, and the row goes with it (its target row at the end of the round).
 *
 * Only the account's own media is deleted, and everything is asked again when it is about to go:
 *   - nothing is deleted while its record still exists (an erase that stopped half-way), nor while a
 *     takedown case of it, or of its uploader, is open (the evidence copy comes first): each part is taken
 *     first, in the one statement a takedown's own row decides against (lib/privacy/erase-targets.ts);
 *   - a video's or stream's files are found by its id, a channel's post images by its own folder;
 *   - a profile's or channel's images only when the upload itself recorded (image_owners, isUploadRow)
 *     who uploaded them or for which channel. A record can name any image URL, and rows from before the
 *     marker or from the backfill were read from records, so neither proves anything: those files are
 *     kept and listed in the job, with an Errors page item for an admin to look at;
 *   - an image the account uploaded goes whoever else links it; one that another person uploaded and that
 *     their own profile or channel shows, or may show, stays, and so does what went to a channel that still exists.
 */
import { ERASED_USER_ID, MessageType, originalPrefix, REVIEW_MEDIA_PREFIX, reportNeedsAction, type AdminJob, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { createJob, getJob, type JobEnv, type JobOutcome } from '../admin/jobs';
import { eraseCaptionJobs, ownedPostImagePaths, postImageFolder, videoThumbnailFolder } from '../admin/purgeCopies';
import { bunnyClientForVideo, primaryBunnyClient, type LibraryHints } from '../bunny/libraries';
import { purgeBunnyEdge } from '../csam/contain';
import { imagePathOf, isUploadRow } from '../csam/imageOwners';
import { logger } from '../logger';
import { deleteImageFile, imageStorageConfigured, listImageFolder } from '../media/imageFiles';
import { bunnyRef } from '../media/providers/bunny';
import { forgetVideoMedia, purgeCdn, purgeVideoCdn } from '../media/r2-delivery';
import { PLAYLIST_ADD_PREFIX } from '../playlistUploadAdds';
import Queue from '../queue';
import { isOwnershipComplete } from '../search/ownership';
import { r2ThumbnailPrefix } from '../thumbnail/store';
import { endSession } from '../live/service';
import { deleteVideoSideRecords } from '../videoSideRecords';
import { closeTargets, endParts, endStaleParts, forgetAccounts, lastErased, otherDelivery, takePart, uploadersUnderTakedown, writeTarget, type EraseTarget } from './erase-targets';

export const ERASE_MEDIA_JOB = 'user.erase-media' as const;

type Json = Record<string, any>;
type Env = Json & JobEnv;

/** What the scheduler entry, upload claim and markers of a video are found by (lib/videoSideRecords.ts). */
type SideRecord = { scheduledPublishDate?: unknown; uploadFingerprint?: unknown; media?: unknown };

/** How far an image folder got, kept between steps and tries. */
interface FolderState {
	/** Files up to here are decided (deleted, kept, or waiting) */
	fileAt?: string;
	/** Files whose uploader is under a takedown: asked again on the next try */
	fileWaiting?: string[];
}

/**
 * When an item may go, by record (`self`, or the owner of an image): 'seen' while the record was still
 * there, else not before (its day starts again when the record is seen gone).
 */
type Arm = Record<string, string>;

/** `at`, `waiting`, `arm`: how far an item got, kept between steps and tries. */
export type MediaItem =
	| ({ t: 'video'; id: string; bunny?: { ref: string; library: LibraryHints }; side?: SideRecord; arm?: Arm } & FolderState)
	| { t: 'stream'; id: string; at?: string; side?: SideRecord; arm?: Arm }
	| ({ t: 'channel'; id: string; at?: string; waiting?: string[]; arm?: Arm } & FolderState)
	| { t: 'images'; paths: string[]; arm?: Arm }
	/** Files a part was deleting when it stopped: the files again, then their copies and rows. `own`: the account's own uploads */
	| { t: 'files'; kind: 'video' | 'channel' | 'user'; id: string; paths: string[]; own?: true }
	/** Nothing to delete: what stays, for the job's result */
	| { t: 'kept'; why: string };

/** The queue's own longest delay (seconds). */
const MAX_QUEUE_DELAY = 43_200;
/** Longest list one job carries; a longer erase starts another. */
const MAX_ITEMS = 200;
/** Items one statement writes down. */
const ADD_AT_ONCE = 25;
/** Image paths per item. */
const PATHS_PER_ITEM = 50;
/** Image files per takedown check and cache purge. */
const IMAGE_CHUNK = 10;
/** The first delete comes this long after the last record of the list went (seconds). */
export const ERASE_DELAY = 24 * 3600;
/** A run account's (test data, lib/e2e/runAccounts.ts): at once, tried again soon, no second look, and nothing of it is kept. */
export const RUN_ACCOUNT_DELAY = 5;
const RUN_ACCOUNT_RETRIES = [5, 5, 10, 15, 20, 30];
/** R2 objects one part deletes. */
const PART_KEYS = 500;
/** Outside calls (R2, D1, HTTP) one step makes; a Worker makes at most 1000, and what the last one of a step still needs fits in the rest. */
const STEP_CALLS = 400;
/** Caption jobs taken at once (each: cancel, list, delete, row). */
const CAPTION_JOBS = 10;
/** A step that used its calls goes on after this, not at once. */
const MORE_DELAY = 10;
/** Most channels of an uploader looked at for one image; with more, the image is kept. */
const MAX_SHOWN_CHANNELS = 200;
/** What an item's last part needs at most, beyond the pages and files counted one by one. */
const FINISH_CALLS = 60;
/** While another delivery may be at work. */
const OTHER_DELIVERY_SECONDS = 600;
/** Between tries of what failed or must wait: 5 min, 15 min, 1 h, 3 h, 8 h, 12 h. */
export const RETRY_DELAYS = [300, 900, 3600, 10_800, 28_800, 43_200];
/** The last look, for what an encode or upload under way wrote after the first. */
export const SWEEP_DELAY = 6 * 3600;

const imageUrl = (path: string) => `https://images.alummahnow.net${path.split('/').map(encodeURIComponent).join('/')}`;
const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const dbOf = (env: Env) => env.SEARCH_DB as unknown as D1Database | undefined;

/** A step's outside calls, counted as they are made. */
class Calls {
	used = 0;
	spend(n = 1): void {
		this.used += n;
	}
	/** Whether `n` more fit in this step. */
	has(n: number): boolean {
		return this.used + n <= STEP_CALLS;
	}
	/** For a lookup that can be left to the next step: counts it, or stops here. */
	take(n: number): void {
		// What was decided before it is still carried out in this step
		if (!this.has(n + IMAGE_CHUNK * FILE_CALLS + 30)) throw new OutOfCalls();
		this.spend(n);
	}
}
class OutOfCalls extends Error {}

/** Calls one image file takes: the file, its edge copy, its share of the checks. */
const FILE_CALLS = 3;

// ---------------------------------------------------------------------------
// Writing down what to erase (before the record goes)
// ---------------------------------------------------------------------------

const sideOf = (record: Json | undefined): SideRecord => Object.fromEntries((['scheduledPublishDate', 'uploadFingerprint', 'media'] as const).filter((field) => record?.[field]).map((field) => [field, record![field]]));

function videoItem(id: string, record: Json | undefined): MediaItem {
	const ref = record ? bunnyRef({ id, ...record } as never) : id;
	const library: LibraryHints = { bunnyLibraryId: record?.bunnyLibraryId ?? null, playUrl: record?.playUrl ?? null, thumbnailUrl: record?.thumbnailUrl ?? null };
	const side = sideOf(record);
	return { t: 'video', id, ...(ref ? { bunny: { ref, library } } : {}), ...(Object.keys(side).length ? { side } : {}) };
}

/** Image URLs a profile or channel record shows or waits to show. */
function namedImages(record: Json | null | undefined): string[] {
	const urls: unknown[] = [record?.avatarUrl, record?.coverUrl, record?.pendingImages?.avatarUrl?.url, record?.pendingImages?.coverUrl?.url];
	return [...new Set(urls.map((url) => imagePathOf(typeof url === 'string' ? url : null)).filter((p): p is string => !!p))];
}

interface OwnerRow { path: string; kind: string; owner_id: string | null; channel_id: string | null; created_at: string }
/** Written by the upload itself: the only row a file is deleted on. */
const proven = (row: OwnerRow) => isUploadRow(row.created_at);

/** An image a record names that the upload index does not give to it. */
const UNSURE = ': whose it is cannot be proven';
const unproven = (path: string): MediaItem => ({ t: 'kept', why: `image ${path}${UNSURE}` });

/** Its avatars and covers are found by their rows when the job runs (idx_image_owners_channel); what only its record names cannot be proven. */
async function channelItems(env: Env, channelId: string, channel: Json | null): Promise<MediaItem[]> {
	const items: MediaItem[] = [{ t: 'channel', id: channelId }];
	for (const path of namedImages(channel)) {
		const row = await dbOf(env)!.prepare('SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE path = ?').bind(path).first<OwnerRow>();
		if (!row || row.channel_id !== channelId) items.push(unproven(path));
	}
	return items;
}

/** Rows of one page of an account's images. */
const ROWS_PAGE = 200;
/** Channels the account uploaded images to that one erase looks at. */
const MAX_CHANNELS = 100;

/**
 * Every image the account uploaded, except those on a channel that still exists (its own are gone by
 * now), a page of rows at a time: it is written down before the next is read.
 */
async function* profileItems(env: Env, userId: string, profile: Json | null, spend: (n: number) => void): AsyncGenerator<MediaItem[]> {
	const db = dbOf(env)!;
	const rowsWhere = async function* (where: string, binds: unknown[]): AsyncGenerator<OwnerRow[]> {
		for (let at = ''; ; ) {
			spend(1);
			const { results } = await db.prepare(`SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE owner_id = ? AND ${where} AND path > ? ORDER BY path LIMIT ${ROWS_PAGE}`).bind(userId, ...binds, at).all<OwnerRow>();
			const rows = results ?? [];
			if (rows.length) yield rows;
			if (rows.length < ROWS_PAGE) return;
			at = rows[rows.length - 1].path;
		}
	};
	const named = new Set(namedImages(profile));
	const written = (items: MediaItem[]) => {
		// Each write may start a job (its row and its message)
		spend(2 * Math.ceil(items.length / ADD_AT_ONCE));
		return items;
	};
	const itemsOf = (rows: OwnerRow[]): MediaItem[] => {
		const items: MediaItem[] = [];
		const paths: string[] = [];
		for (const row of rows) {
			named.delete(row.path);
			if (proven(row)) paths.push(row.path);
			else items.push(unproven(row.path));
		}
		for (let i = 0; i < paths.length; i += PATHS_PER_ITEM) items.push({ t: 'images', paths: paths.slice(i, i + PATHS_PER_ITEM) });
		return written(items);
	};
	for await (const rows of rowsWhere('channel_id IS NULL', [])) yield itemsOf(rows);
	spend(1);
	const { results } = await db.prepare(`SELECT channel_id AS id, COUNT(*) AS n FROM image_owners WHERE owner_id = ? AND channel_id IS NOT NULL GROUP BY channel_id LIMIT ${MAX_CHANNELS + 1}`).bind(userId).all<{ id: string; n: number }>();
	const channels = results ?? [];
	let elsewhere = 0;
	for (const channel of channels.slice(0, MAX_CHANNELS)) {
		spend(1);
		if (await env.channels.head(channel.id)) elsewhere += Number(channel.n);
		else for await (const rows of rowsWhere('channel_id = ?', [channel.id])) yield itemsOf(rows);
	}
	const rest: MediaItem[] = [...named].map(unproven);
	if (elsewhere) rest.push({ t: 'kept', why: `${elsewhere} image(s) uploaded to channels that still exist` });
	if (channels.length > MAX_CHANNELS) rest.push({ t: 'kept', why: `images uploaded to more than ${MAX_CHANNELS} channels: the rest stay with them` });
	yield written(rest);
}

/** The media could not be written down: the record stays, and the erase is called again. */
export class EraseMediaUnavailable extends Error {
	constructor(reason: string) {
		super(`The media erasure could not be stored: ${reason}`);
		this.name = 'EraseMediaUnavailable';
	}
}

/** A target and its media, written down beside the items (lib/privacy/erase-targets.ts). */
interface Written extends EraseTarget {
	media: Json;
}

/** One erase pass's list: a job row that grows until it starts, then another. */
class Outbox {
	private job: { id: string; count: number } | null = null;
	constructor(
		private readonly env: Env,
		private readonly delay: number,
		private readonly run: boolean,
	) {}

	/** Resolves once the items and the target are stored. Throws when they could not be: the caller must not delete the record. */
	async add(items: MediaItem[], target?: Written): Promise<void> {
		try {
			for (let i = 0; i < items.length; i += ADD_AT_ONCE) await this.store(items.slice(i, i + ADD_AT_ONCE));
			if (!target) return;
			if (!items.length) await this.store([]);
			await writeTarget(dbOf(this.env)!, target, this.job!.id, target.media);
		} catch (error) {
			throw error instanceof EraseMediaUnavailable ? error : new EraseMediaUnavailable(error instanceof Error ? error.message : String(error));
		}
	}

	private async store(items: MediaItem[]): Promise<void> {
		const db = dbOf(this.env)!;
		const runAfter = new Date(Date.now() + this.delay * 1000).toISOString();
		if (this.job && this.job.count < MAX_ITEMS) {
			// Only before its first run: from then on its list is what is left to do
			const out = await db
				.prepare(`UPDATE admin_jobs SET params = json_insert(json_set(params, '$.runAfter', ?)${", '$.items[#]', json(?)".repeat(items.length)}), updated_at = ? WHERE id = ? AND status = 'queued' AND json_type(params, '$.started') IS NULL AND json_type(params, '$.items') = 'array'`)
				.bind(runAfter, ...items.map((item) => JSON.stringify(item)), new Date().toISOString(), this.job.id)
				.run();
			if (Number(out.meta?.changes ?? 0) === 1) {
				this.job.count += items.length;
				return;
			}
		}
		const job = await createJob(this.env, { kind: ERASE_MEDIA_JOB, targetKind: 'user', targetId: ERASED_USER_ID, actorId: 'system', params: { items, runAfter, delay: this.delay, ...(this.run ? { run: true } : {}) }, delaySeconds: Math.min(MAX_QUEUE_DELAY, this.delay) });
		if (job.status === 'failed') throw new EraseMediaUnavailable(job.lastError ?? 'the queue refused it');
		this.job = { id: job.id, count: items.length };
	}
}

/** What stands in for a deleted video record: what its media is found by (contain.ts, evidence.ts). */
const videoMedia = (id: string, record: Json | undefined): Json => {
	const ref = record ? bunnyRef({ id, ...record } as never) : id;
	return {
		id,
		channelId: record?.channelId ?? null,
		bunnyLibraryId: record?.bunnyLibraryId ?? null,
		playUrl: record?.playUrl ?? null,
		thumbnailUrl: record?.thumbnailUrl ?? null,
		...(record?.r2?.rev ? { r2: { status: record.r2.status, access: record.r2.access, rev: record.r2.rev } } : {}),
		...(ref ? { media: { providers: { bunny: { ref, libraryId: record?.media?.providers?.bunny?.libraryId } } } } : { bunnyRemoved: true }),
	};
};
/** A profile's or channel's: the images it shows. */
const shownMedia = (id: string, record: Json | null | undefined): Json => ({
	id,
	...Object.fromEntries((['avatarUrl', 'coverUrl'] as const).map((field) => [field, imagePathOf(record?.[field] ?? record?.pendingImages?.[field]?.url)] as const).filter(([, path]) => path).map(([field, path]) => [field, imageUrl(path!)])),
});

export interface MediaHooks {
	onVideoDeleted(videoId: string, record: unknown, key?: string): Promise<void>;
	onChannelDeleted(channelId: string, channel: unknown): Promise<void>;
	onProfileDeleted(userId: string, profile: unknown): Promise<void>;
	/** Its images are its channel's to erase (their folder): written down for a case only */
	onPostDeleted(channelId: string, postId: string, post: unknown): Promise<void>;
}

/**
 * The erase's hooks (lib/privacy/user-data.ts, run-user-erase.ts): each runs before its record is
 * deleted and throws when the media could not be written down, the job tables or their queue missing
 * included: the record stays, and the erase is called again. `budget`: the pass's, for what a channel or profile
 * reads and writes (too little left: the pass stops there, and the next one starts it with its whole budget).
 */
export function eraseMediaHooks(rawEnv: unknown, budget?: { spend(n: number): void }, opts: { runAccount?: boolean } = {}): MediaHooks {
	const env = rawEnv as Env;
	const outbox = new Outbox(env, opts.runAccount ? RUN_ACCOUNT_DELAY : ERASE_DELAY, opts.runAccount === true);
	const bound = () => {
		if (!dbOf(env) || !env.ADMIN_JOBS_QUEUE) throw new EraseMediaUnavailable('SEARCH_DB or ADMIN_JOBS_QUEUE is not bound');
	};
	return {
		onVideoDeleted: async (id, record, key) => {
			bound();
			const stream = key?.startsWith('livestream:');
			await outbox.add([stream ? { t: 'stream', id, ...(Object.keys(sideOf(record as Json)).length ? { side: sideOf(record as Json) } : {}) } : videoItem(id, record as Json)], { kind: 'video', id, media: stream ? { id, stream: true, channelId: (record as Json)?.channelId ?? null } : videoMedia(id, record as Json) });
		},
		onChannelDeleted: async (id, channel) => {
			bound();
			budget?.spend(9);
			await outbox.add(await channelItems(env, id, channel as Json), { kind: 'channel', id, media: shownMedia(id, channel as Json) });
		},
		onProfileDeleted: async (userId, profile) => {
			bound();
			let listed = false;
			for await (const items of profileItems(env, userId, profile as Json, (n) => budget?.spend(n))) {
				listed ||= items.some((item) => item.t === 'images');
				await outbox.add(items);
			}
			// Its images, shown or not any more, are found by it while they are there
			const media = shownMedia(userId, profile as Json);
			if (!listed && Object.keys(media).length === 1) return;
			budget?.spend(3);
			await outbox.add([], { kind: 'user', id: userId, media });
		},
		onPostDeleted: async (channelId, postId, post) => {
			const paths = ownedPostImagePaths(post as Json, channelId);
			if (!paths.length) return;
			bound();
			budget?.spend(3);
			await outbox.add([], { kind: 'post', id: `${channelId}/${postId}`, media: { id: postId, channelId, images: paths.map((path) => ({ url: imageUrl(path) })) } });
		},
	};
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface EraseMediaCounts {
	videos: number;
	streams: number;
	channels: number;
	/** R2 objects, image files and Bunny videos deleted */
	files: number;
	/** Caches that could not be told (no token): their copies run out by themselves */
	cachesNotPurged: string[];
	/** What was left, and why */
	kept: string[];
}
const newCounts = (): EraseMediaCounts => ({ videos: 0, streams: 0, channels: 0, files: 0, cachesNotPurged: [], kept: [] });

type Outcome = 'done' | 'more' | 'record' | 'takedown' | 'wait';
const nameOf = (item: MediaItem) => (item.t === 'kept' ? item.why : item.t === 'images' ? `images (${item.paths.length})` : item.t === 'files' ? `files of ${item.kind === 'user' ? 'an account' : `${item.kind} ${item.id}`} (${item.paths.length})` : `${item.t} ${item.id}`);
const noteCache = (counts: EraseMediaCounts, cache: string) => {
	if (!counts.cachesNotPurged.includes(cache)) counts.cachesNotPurged.push(cache);
};

/** What one step works with. */
interface Step {
	env: Env;
	db: D1Database;
	jobId: string;
	/** This delivery's own: its marks (lib/privacy/erase-targets.ts) */
	token: string;
	/** How long after a record went (seconds) */
	delay: number;
	counts: EraseMediaCounts;
	calls: Calls;
	/** Files being deleted, written to the job's row before they go: what a try that stops leaves to finish */
	unfinished: Array<Extract<MediaItem, { t: 'files' }>>;
}

/**
 * One part: taken in one statement (lib/privacy/erase-targets.ts), deleted, written down, and its mark
 * taken back whatever happens. False when a case is open or holds it. `run` says how much it deleted as it goes.
 */
async function part(s: Step, targets: EraseTarget[], run: (done: { deleted: number }) => Promise<void>): Promise<boolean> {
	s.calls.spend(2);
	if (!(await takePart(s.db, s.jobId, s.token, targets))) return false;
	const done = { deleted: 0 };
	let finished = false;
	try {
		await run(done);
		finished = true;
	} finally {
		await endParts(s.db, s.jobId, s.token, done.deleted ? 'deleted' : finished ? 'none' : 'stopped');
	}
	return true;
}

/** Whether a record's media may go: not while it is there, and not before its day is over, from when it was last written down, or seen gone. */
async function ready(s: Step, item: { arm?: Arm }, key: string, target: EraseTarget, exists: boolean): Promise<'record' | 'wait' | 'ok'> {
	if (exists) {
		(item.arm ??= {})[key] = 'seen';
		return 'record';
	}
	if (!s.delay) return 'ok';
	const day = s.delay * 1000;
	if (item.arm?.[key] === 'seen') item.arm[key] = new Date(Date.now() + day).toISOString();
	s.calls.spend();
	const last = Date.parse((await lastErased(s.db, target)) ?? '');
	const at = Math.max(Date.parse(item.arm?.[key] ?? '') || 0, Number.isFinite(last) ? last + day : 0);
	if (at <= Date.now()) return 'ok';
	(item.arm ??= {})[key] = new Date(at).toISOString();
	return 'wait';
}

/** Deletes what is under a prefix, a part at a time: what is deleted is not listed again. 'more' when the step's calls are used up first. */
async function deletePages(s: Step, bucket: R2Bucket | undefined, prefix: string, target: EraseTarget): Promise<'done' | 'more' | 'takedown'> {
	if (!bucket) return 'done';
	for (;;) {
		if (!s.calls.has(4)) return 'more';
		s.calls.spend();
		const page = await bucket.list({ prefix, limit: PART_KEYS });
		if (!page.objects.length) return 'done';
		const taken = await part(s, [target], async (done) => {
			s.calls.spend();
			await bucket.delete(page.objects.map((o) => o.key));
			done.deleted = page.objects.length;
		});
		if (!taken) return 'takedown';
		s.counts.files += page.objects.length;
		if (!page.truncated) return 'done';
	}
}

/** Image files' copies on the CDNs. */
async function purgeImages(env: Env, urls: string[], counts: EraseMediaCounts, calls: Calls): Promise<void> {
	if (!urls.length) return;
	calls.spend(Math.ceil(urls.length / 30));
	const cdn = await purgeCdn(env as never, { files: urls });
	if (cdn === 'failed') throw new Error('Cloudflare cache purge failed');
	calls.spend(env.BUNNY_API_KEY ? urls.length : 0);
	const edge = await purgeBunnyEdge(env as never, urls);
	if (edge === 'failed') throw new Error('Bunny edge purge failed');
	if (cdn === 'not_configured') noteCache(counts, 'cloudflare');
	if (edge === 'not_configured') noteCache(counts, 'bunny-edge');
}

/**
 * A part of image files: deleted, then their copies, then their rows. The list is on the job's row before
 * the first file goes, and the rows go last: whatever stops it, a later try finds them (item 'files').
 * False when a case of the target or of an uploader is open.
 */
async function deleteImages(s: Step, target: { kind: 'video' | 'channel' | 'user'; id: string }, paths: string[], uploaders: string[], own?: true): Promise<boolean> {
	const { env, db, counts, calls } = s;
	const targets: EraseTarget[] = [target, ...[...new Set(uploaders)].filter((id) => target.kind !== 'user' || id !== target.id).map((id) => ({ kind: 'user' as const, id }))];
	// The job names no account: whose an account's files are is on their rows
	const files = { t: 'files' as const, kind: target.kind, id: target.kind === 'user' ? '' : target.id, paths, ...(own ? { own } : {}) };
	const taken = await part(s, targets, async (done) => {
		s.unfinished.push(files);
		calls.spend();
		await db.prepare(`UPDATE admin_jobs SET params = json_set(params, '$.unfinished', json(?)) WHERE id = ?`).bind(JSON.stringify(s.unfinished), s.jobId).run();
		for (const path of paths) {
			calls.spend();
			if ((await deleteImageFile(env as never, path)) === 'deleted') {
				done.deleted++;
				counts.files++;
			}
		}
		await purgeImages(env, paths.map(imageUrl), counts, calls);
		calls.spend();
		await db.prepare('DELETE FROM image_owners WHERE path IN (SELECT value FROM json_each(?))').bind(JSON.stringify(paths)).run();
	});
	if (taken) s.unfinished.splice(s.unfinished.indexOf(files), 1);
	return taken;
}

async function rowsOf(env: Env, paths: string[], calls: Calls): Promise<Map<string, OwnerRow>> {
	calls.spend();
	const { results } = await dbOf(env)!
		.prepare('SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE path IN (SELECT value FROM json_each(?))')
		.bind(JSON.stringify(paths))
		.all<OwnerRow>();
	return new Map((results ?? []).map((row) => [row.path, row]));
}

/**
 * What a person's own profile and channels show now: an image they uploaded and still show is not this
 * erasure's. 'unknown' (too many channels, a record that cannot be parsed) keeps the image as well.
 */
class Shown {
	private readonly of = new Map<string, Promise<{ paths: Set<string>; all: boolean }>>();
	constructor(private readonly env: Env, private readonly calls: Calls) {}

	async by(row: OwnerRow | undefined): Promise<'shown' | 'unknown' | 'no'> {
		if (!row?.owner_id) return 'no';
		const owner = row.owner_id;
		let read = this.of.get(owner);
		if (!read) {
			read = this.read(owner);
			this.of.set(owner, read);
		}
		const { paths, all } = await read;
		return paths.has(row.path) ? 'shown' : all ? 'no' : 'unknown';
	}

	private async read(owner: string): Promise<{ paths: Set<string>; all: boolean }> {
		const { env, calls } = this;
		calls.take(2);
		// Not while the index is rebuilt: it could miss the channel that shows the image (the job tries again)
		if (!(await isOwnershipComplete(dbOf(env) as never, 'channel'))) throw new Error('the channel index is being rebuilt');
		const { results } = await dbOf(env)!.prepare(`SELECT id FROM content_ownership WHERE kind = 'channel' AND owner_id = ? LIMIT ${MAX_SHOWN_CHANNELS + 1}`).bind(owner).all<{ id: string }>();
		const ids = (results ?? []).map((r) => r.id);
		if (ids.length > MAX_SHOWN_CHANNELS) return { paths: new Set(), all: false };
		calls.take(ids.length + 1);
		const objects = await Promise.all([env.profiles.get(owner), ...ids.map((id) => env.channels.get(id))]);
		let all = true;
		const paths = new Set<string>();
		for (const object of objects as Array<{ json(): Promise<Json> } | null>) {
			const record = object ? await object.json().catch(() => undefined) : null;
			if (record === undefined) all = false;
			for (const path of namedImages(record)) paths.add(path);
		}
		return { paths, all };
	}
}

const keepNote = (counts: EraseMediaCounts, why: string) => {
	if (!counts.kept.includes(why)) counts.kept.push(why);
};
const NO_IMAGES = 'images: the image storage is not configured';

interface Decided {
	go: string[];
	/** Their uploader is under a takedown */
	waiting: string[];
	/** Uploaders of what goes */
	uploaders: string[];
	/** The last path decided (fewer than given when the step's calls ran out) */
	last?: string;
	stopped: boolean;
}

/** Decides file by file: goes, stays (another person's, shown or maybe shown elsewhere), or waits for a takedown of its uploader. */
async function decide({ env, counts, calls }: Step, paths: string[], rows: Map<string, OwnerRow>, shown: Shown, provenOnly: boolean): Promise<Decided> {
	const owners = [...new Set(paths.map((path) => rows.get(path)?.owner_id).filter((id): id is string => !!id))];
	if (owners.length) calls.spend();
	const held = await uploadersUnderTakedown(dbOf(env)!, owners);
	const out: Decided = { go: [], waiting: [], uploaders: [], stopped: false };
	for (const path of paths) {
		const row = rows.get(path);
		try {
			if (provenOnly && row && !proven(row)) keepNote(counts, `image ${path}${UNSURE}`);
			else if (row?.owner_id && held.has(row.owner_id)) out.waiting.push(path);
			else {
				const elsewhere = await shown.by(row);
				if (elsewhere === 'shown') keepNote(counts, `image ${path}: its uploader still shows it`);
				else if (elsewhere === 'unknown') keepNote(counts, `image ${path}: whether its uploader still shows it cannot be told`);
				else {
					out.go.push(path);
					if (row?.owner_id) out.uploaders.push(row.owner_id);
				}
			}
		} catch (error) {
			if (!(error instanceof OutOfCalls)) throw error;
			out.stopped = true;
			return out;
		}
		out.last = path;
	}
	return out;
}

/** Images the account uploaded. Each is proven again by its row, now; one without a row was deleted before. */
async function eraseOwnImages(s: Step, item: Extract<MediaItem, { t: 'images' }>): Promise<Outcome> {
	if (!imageStorageConfigured(s.env as never)) {
		keepNote(s.counts, NO_IMAGES);
		return 'done';
	}
	const waiting: string[] = [];
	try {
		const outcome = await eraseOwnPaths(s, item, waiting);
		return outcome;
	} finally {
		// What waits stays in the list, whatever ended this step
		item.paths = [...item.paths, ...waiting];
	}
}

async function eraseOwnPaths(s: Step, item: Extract<MediaItem, { t: 'images' }>, waiting: string[]): Promise<Outcome> {
	const { env, calls } = s;
	let wait: Outcome = 'done';
	const exists = new Map<string, boolean>();
	while (item.paths.length) {
		if (!calls.has(IMAGE_CHUNK * FILE_CALLS + 50)) return 'more';
		const chunk = item.paths.slice(0, IMAGE_CHUNK);
		const rows = await rowsOf(env, chunk, calls);
		// By whose they are: each is claimed on its own
		const groups = new Map<string, { kind: 'channel' | 'user'; id: string; paths: string[] }>();
		for (const path of chunk) {
			const row = rows.get(path);
			const [kind, id] = row?.channel_id ? (['channel', row.channel_id] as const) : (['user', row?.owner_id] as const);
			if (!row || !proven(row) || !id) continue;
			const key = `${kind}:${id}`;
			if (!groups.has(key)) groups.set(key, { kind, id, paths: [] });
			groups.get(key)!.paths.push(path);
		}
		const held: string[] = [];
		for (const [key, { kind, id, paths }] of groups) {
			if (!exists.has(key)) {
				calls.spend();
				exists.set(key, !!(await (kind === 'channel' ? env.channels : env.profiles).head(id)));
			}
			const uploaders = [...new Set(paths.map((path) => rows.get(path)!.owner_id).filter((o): o is string => !!o))];
			const when = await ready(s, item, key, { kind, id }, exists.get(key)!);
			const why: Outcome | null = when !== 'ok' ? when : (await deleteImages(s, { kind, id }, paths, uploaders, true)) ? null : 'takedown';
			if (why) {
				held.push(...paths);
				if (wait === 'done' || why === 'takedown' || (why === 'record' && wait === 'wait')) wait = why;
			}
		}
		waiting.push(...held);
		item.paths = item.paths.slice(IMAGE_CHUNK);
	}
	return wait;
}

/** A folder's files, a part at a time, each decided once (`state`). */
async function eraseImageFolder(s: Step, folder: string, state: FolderState, target: { kind: 'video' | 'channel'; id: string }): Promise<Outcome> {
	const { env, counts, calls } = s;
	if (!imageStorageConfigured(env as never)) {
		keepNote(counts, NO_IMAGES);
		return 'done';
	}
	const shown = new Shown(env, calls);
	/** Deletes what may go of a list; the rest of the list when the step's calls run out. */
	const take = async (paths: string[], onDecided: (d: Decided) => void): Promise<Outcome> => {
		for (let i = 0; i < paths.length; ) {
			if (!calls.has(IMAGE_CHUNK * FILE_CALLS + 50)) return 'more';
			const chunk = paths.slice(i, i + IMAGE_CHUNK);
			const decided = await decide(s, chunk, await rowsOf(env, chunk, calls), shown, false);
			if (decided.go.length && !(await deleteImages(s, target, decided.go, decided.uploaders))) return 'takedown';
			onDecided(decided);
			if (decided.stopped) return 'more';
			i += chunk.length;
		}
		return 'done';
	};
	// Those that waited for a takedown of their uploader
	const retry = [...(state.fileWaiting ?? [])];
	const still: string[] = [];
	let decidedTo = 0;
	const again = await take(retry, (d) => {
		still.push(...d.waiting);
		if (d.last) decidedTo = retry.indexOf(d.last) + 1;
		state.fileWaiting = [...still, ...retry.slice(decidedTo)];
	});
	state.fileWaiting ??= [];
	if (again !== 'done') return again;
	calls.spend();
	const files = (await listImageFolder(env as never, folder)).sort().filter((path) => path > (state.fileAt ?? ''));
	const outcome = await take(files, (d) => {
		state.fileWaiting!.push(...d.waiting);
		if (d.last) state.fileAt = d.last;
	});
	if (outcome !== 'done') return outcome;
	if (state.fileWaiting.length) return 'takedown';
	state.fileWaiting = undefined;
	return 'done';
}

/** A channel's avatars and covers, every one ever uploaded for it, whoever uploaded it; then its post images. */
async function eraseChannel(s: Step, item: Extract<MediaItem, { t: 'channel' }>): Promise<Outcome> {
	const { env, counts, calls } = s;
	const target = { kind: 'channel' as const, id: item.id };
	if (imageStorageConfigured(env as never)) {
		const shown = new Shown(env, calls);
		const some = async (rows: OwnerRow[]): Promise<{ outcome: Outcome; decided: Decided | null }> => {
			const decided = await decide(s, rows.map((r) => r.path), new Map(rows.map((r) => [r.path, r])), shown, true);
			if (decided.go.length && !(await deleteImages(s, target, decided.go, decided.uploaders))) return { outcome: 'takedown', decided: null };
			return { outcome: decided.stopped ? 'more' : 'done', decided };
		};
		// Those that waited for a takedown of their uploader
		let retry = item.waiting ?? [];
		const still: string[] = [];
		while (retry.length) {
			if (!calls.has(IMAGE_CHUNK * FILE_CALLS + 50)) {
				item.waiting = [...still, ...retry];
				return 'more';
			}
			const chunk = retry.slice(0, IMAGE_CHUNK);
			const rows = await rowsOf(env, chunk, calls);
			const { outcome, decided } = await some(chunk.map((path) => rows.get(path)).filter((row): row is OwnerRow => !!row));
			if (decided) {
				still.push(...decided.waiting);
				retry = decided.stopped ? retry.slice(decided.last ? retry.indexOf(decided.last) + 1 : 0) : retry.slice(IMAGE_CHUNK);
			}
			item.waiting = [...still, ...retry];
			if (outcome !== 'done') return outcome;
		}
		item.waiting = still;
		for (;;) {
			if (!calls.has(IMAGE_CHUNK * FILE_CALLS + 50)) return 'more';
			calls.spend();
			const { results } = await dbOf(env)!
				.prepare(`SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE channel_id = ? AND path > ? AND kind IN ('channel_avatar', 'channel_cover') ORDER BY path LIMIT ${IMAGE_CHUNK}`)
				.bind(item.id, item.at ?? '')
				.all<OwnerRow>();
			const rows = results ?? [];
			if (!rows.length) break;
			const { outcome, decided } = await some(rows);
			if (decided) {
				item.waiting.push(...decided.waiting);
				if (decided.last) item.at = decided.last;
			}
			if (outcome !== 'done') return outcome;
		}
	}
	const outcome = await eraseImageFolder(s, postImageFolder(item.id), item, target);
	if (outcome !== 'done') return outcome;
	if (item.waiting?.length) return 'takedown';
	counts.channels++;
	return 'done';
}

/** What a try that stopped left: the files again (gone ones are done), their copies, their rows. */
async function eraseFiles(s: Step, item: Extract<MediaItem, { t: 'files' }>): Promise<Outcome> {
	const { env, calls } = s;
	if (!calls.has(IMAGE_CHUNK * FILE_CALLS + 50)) return 'more';
	const rows = await rowsOf(env, item.paths, calls);
	if (item.own) {
		const uploaders = [...rows.values()].map((row) => row.owner_id).filter((id): id is string => !!id);
		// The rows go last: without them there is nothing left to finish
		const id = item.kind === 'user' ? uploaders[0] : item.id;
		if (!id) return 'done';
		return (await deleteImages(s, { kind: item.kind, id }, item.paths, uploaders, true)) ? 'done' : 'takedown';
	}
	const decided = await decide(s, item.paths, rows, new Shown(env, calls), false);
	const left = item.paths.slice(decided.last ? item.paths.indexOf(decided.last) + 1 : 0);
	if (decided.go.length && !(await deleteImages(s, item, decided.go, decided.uploaders))) return 'takedown';
	item.paths = [...decided.waiting, ...left];
	return left.length ? 'more' : decided.waiting.length ? 'takedown' : 'done';
}

async function deleteBunnyVideo(client: { deleteVideo(library: number, id: string): Promise<void> }, libraryId: number, ref: string): Promise<boolean> {
	try {
		await client.deleteVideo(libraryId, ref);
		return true;
	} catch (error) {
		// Already gone
		if (/status: 404/.test(error instanceof Error ? error.message : String(error))) return false;
		throw error;
	}
}

async function eraseVideo(s: Step, item: Extract<MediaItem, { t: 'video' }>): Promise<Outcome> {
	const { env, counts, calls } = s;
	const { id } = item;
	const target = { kind: 'video' as const, id };
	const prefixes: Array<[R2Bucket | undefined, string]> = [
		[env.MEDIA, `pub/${id}/`],
		[env.MEDIA, r2ThumbnailPrefix(id)],
		[env.MEDIA_PRIVATE, `priv/${id}/`],
		[env.MEDIA_PRIVATE, `staging/${id}/`],
		// Review frames, audio and transcripts, of its audio tracks too (wiki AUN-VIDEO-REVIEW, Privacy)
		[env.MEDIA_PRIVATE, `${REVIEW_MEDIA_PREFIX}${id}/`],
		[env.MEDIA_ORIGINALS, originalPrefix(id)],
		[env.MEDIA_ORIGINALS, `audio/${id}/`],
		[env.subtitles, `${id}/`],
		[env.global_settings, `${PLAYLIST_ADD_PREFIX}${id}/`],
	];
	for (const [bucket, prefix] of prefixes) {
		const outcome = await deletePages(s, bucket, prefix, target);
		if (outcome !== 'done') return outcome;
	}
	// A thumbnail that cannot go yet does not keep the video: the item is tried again for it
	let problem: unknown;
	const folder = await eraseImageFolder(s, videoThumbnailFolder(id), item, target).catch((error): Outcome => {
		problem = error ?? new Error('thumbnails not erased');
		return 'done';
	});
	if (folder !== 'done') return folder;
	for (let n = CAPTION_JOBS; n === CAPTION_JOBS; ) {
		if (!calls.has(CAPTION_JOBS * 5)) return 'more';
		const taken = await part(s, [target], async (done) => {
			calls.spend(CAPTION_JOBS * 5);
			n = await eraseCaptionJobs(env as never, id, { limit: CAPTION_JOBS });
			done.deleted = n;
		});
		if (!taken) return 'takedown';
	}
	if (!calls.has(FINISH_CALLS)) return 'more';
	const taken = await part(s, [target], (done) => finishVideo(s, item, done));
	if (!taken) return 'takedown';
	if (problem) throw problem;
	counts.videos++;
	return 'done';
}

/** The rest of a video: one bounded part. */
async function finishVideo(s: Step, item: Extract<MediaItem, { t: 'video' }>, done: { deleted: number }): Promise<void> {
	const { env, counts, calls } = s;
	const { id } = item;
	calls.spend(FINISH_CALLS);
	// What is stored first, and the CDN whatever became of it: neither waits for the other
	let problem: unknown;
	try {
		// Nothing is listed here: what came after the pages above is the second look's
		await forgetVideoMedia(env as never, id);
		if (item.bunny) {
			const { client, libraryId } = await bunnyClientForVideo(env as never, item.bunny.library);
			if (await deleteBunnyVideo(client, libraryId, item.bunny.ref)) {
				done.deleted++;
				counts.files++;
			}
		}
		await deleteVideoSideRecords(env as never, id, { ...(item.side ?? {}), id } as never, { folders: false });
		if (env.NOTIFICATIONS_DB) {
			await env.NOTIFICATIONS_DB.batch([
				env.NOTIFICATIONS_DB.prepare('DELETE FROM notifications WHERE entity_id = ?').bind(id),
				env.NOTIFICATIONS_DB.prepare('DELETE FROM liked_videos WHERE video_id = ?').bind(id),
			]);
		}
		// The processor's own copies and the search row; the pass that deleted the record may have stopped before it said so
		if (env.queue) await new Queue(env.queue as never).send(MessageType.VideoDelete, { videoId: id, userId: ERASED_USER_ID, reason: 'erasure-media', timestamp: new Date().toISOString() });
	} catch (error) {
		problem = error ?? new Error('not finished');
	}
	// Public renditions are served with no Worker: the CDN is told even when R2 holds nothing any more
	await purgeVideoCdn(env as never, id, { strict: true });
	if (env.MEDIA && env.MEDIA_PUBLIC_HOST) {
		const purged = await purgeCdn(env as never, { prefixes: [`${env.MEDIA_PUBLIC_HOST}/${r2ThumbnailPrefix(id)}`] });
		if (purged === 'failed') throw new Error('CDN purge of the thumbnails failed');
		if (purged === 'not_configured') noteCache(counts, 'cloudflare');
	}
	if (problem) throw problem;
}

/** Sessions one query reads. */
const SESSIONS_PAGE = 20;

/** A stream's review media and sessions: still open ones are ended, then the recordings go (self-hosted files, Bunny videos). */
async function eraseStream(s: Step, item: Extract<MediaItem, { t: 'stream' }>): Promise<Outcome> {
	const { env, counts, calls } = s;
	const { id } = item;
	const target = { kind: 'video' as const, id };
	for (const [bucket, prefix] of [[env.MEDIA_PRIVATE, `${REVIEW_MEDIA_PREFIX}${id}/`], [env.subtitles, `${id}/`], [env.global_settings, `${PLAYLIST_ADD_PREFIX}${id}/`]] as Array<[R2Bucket | undefined, string]>) {
		const outcome = await deletePages(s, bucket, prefix, target);
		if (outcome !== 'done') return outcome;
	}
	for (;;) {
		if (!calls.has(20)) return 'more';
		calls.spend();
		const { results } = await dbOf(env)!.prepare(`SELECT * FROM live_sessions WHERE stream_id = ? AND id > ? ORDER BY id LIMIT ${SESSIONS_PAGE}`).bind(id, item.at ?? '').all<Json>();
		const sessions = results ?? [];
		if (!sessions.length) break;
		for (const session of sessions) {
			if (!calls.has(20)) return 'more';
			if (!SAFE_ID.test(String(session.id))) throw new Error('Unexpected session id');
			if (session.status === 'provisioned' || session.status === 'live') {
				calls.spend(8);
				if (!(await part(s, [target], () => endSession(env as never, session as never, 'account_erased').then(() => undefined)))) return 'takedown';
			}
			if (session.provider === 'selfhosted') {
				const outcome = await deletePages(s, env.LIVE_MEDIA, `live/${session.id}/`, target);
				if (outcome !== 'done') return outcome;
			} else if (session.provider_ref) {
				const taken = await part(s, [target], async (done) => {
					calls.spend(3);
					const { client, libraryId } = await primaryBunnyClient(env as never);
					if (!(await deleteBunnyVideo(client, libraryId, String(session.provider_ref)))) return;
					done.deleted++;
					counts.files++;
				});
				if (!taken) return 'takedown';
			}
			item.at = String(session.id);
		}
	}
	if (!calls.has(FINISH_CALLS)) return 'more';
	const taken = await part(s, [target], async () => {
		calls.spend(10);
		await deleteVideoSideRecords(env as never, id, { ...(item.side ?? {}), id } as never, { folders: false });
	});
	if (!taken) return 'takedown';
	counts.streams++;
	return 'done';
}

async function eraseItem(s: Step, item: MediaItem): Promise<Outcome> {
	if (item.t === 'kept') {
		keepNote(s.counts, item.why);
		return 'done';
	}
	if (item.t === 'images') return eraseOwnImages(s, item);
	if (item.t === 'files') return eraseFiles(s, item);
	// Ids name prefixes and folders: anything else could reach another record's files
	if (!SAFE_ID.test(item.id)) throw new Error('Not an id this job may act on');
	s.calls.spend();
	const exists = !!(await (item.t === 'channel' ? s.env.channels : s.env.videos).head(item.t === 'stream' ? `livestream:${item.id}` : item.id));
	const when = await ready(s, item, 'self', { kind: item.t === 'channel' ? 'channel' : 'video', id: item.id }, exists);
	if (when !== 'ok') return when;
	return item.t === 'video' ? eraseVideo(s, item) : item.t === 'stream' ? eraseStream(s, item) : eraseChannel(s, item);
}

interface JobParams {
	items?: MediaItem[];
	/** Not before (Outbox) */
	runAfter?: string;
	/** How long after a record went (seconds) */
	delay?: number;
	/** A run account's media */
	run?: true;
	/** Not yet: their record went less than a day ago */
	waits?: MediaItem[];
	/** Parts that were being deleted when a delivery stopped for good (Step.unfinished) */
	unfinished?: MediaItem[];
	/** The job has run: its list takes no more (Outbox) */
	started?: true;
	/** Waiting or failed, with why, until the current round is over */
	left?: Array<{ item: MediaItem; why: string }>;
	/** Done in the first round: looked at once more */
	again?: MediaItem[];
	tries?: number;
	swept?: boolean;
	counts?: EraseMediaCounts;
}

/** One delivery of job user.erase-media. */
export async function runEraseMedia(rawEnv: unknown, job: AdminJob): Promise<JobOutcome> {
	const env = rawEnv as Env;
	// Its list may have grown after the consumer read it; from here on it cannot (the job runs)
	const p = ((dbOf(env) ? await getJob(env, job.id) : null)?.params ?? job.params) as JobParams;
	const wait = Math.ceil((Date.parse(p.runAfter ?? '') - Date.now()) / 1000);
	if (wait > 0) return { done: false, params: p as Record<string, unknown>, delaySeconds: Math.min(MAX_QUEUE_DELAY, wait) };
	// Another delivery may be at work: not beside it. One that never got to its end is nobody's after an hour:
	// its mark is taken back, and what it was deleting is first
	const token = crypto.randomUUID();
	if (await otherDelivery(dbOf(env)!, job.id, token)) return { later: OTHER_DELIVERY_SECONDS };
	await endStaleParts(dbOf(env)!, job.id);
	const items = [...(p.unfinished ?? []), ...(p.items ?? [])];
	const counts = { ...newCounts(), ...(p.counts ?? {}) };
	// The second look only adds what it still found
	const tally = p.swept ? newCounts() : counts;
	const left = [...(p.left ?? [])];
	const again = [...(p.again ?? [])];
	const waits = [...(p.waits ?? [])];
	let next = 0;
	const calls = new Calls();
	const step: Step = { env, db: dbOf(env)!, jobId: job.id, token, delay: Number(p.delay) || 0, counts: tally, calls, unfinished: [] };
	const more: MediaItem[] = [];
	while (next < items.length && (next === 0 || calls.has(FINISH_CALLS))) {
		// Its own copy: what it has done so far goes back into the list with it
		const item = structuredClone(items[next++]);
		try {
			const outcome = await eraseItem(step, item);
			if (outcome === 'more') more.push(item);
			else if (outcome === 'wait') waits.push(item);
			else if (outcome === 'done') {
				if (!p.swept && (item.t === 'video' || item.t === 'stream')) again.push(item.t === 'video' ? { ...item, fileAt: undefined, fileWaiting: undefined } : { ...item, at: undefined });
			} else left.push({ item, why: outcome === 'record' ? 'its record still exists' : 'a takedown case is open' });
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			logger.warn('[EraseMedia] Item not erased yet', { jobId: job.id, item: nameOf(item), error: why });
			left.push({ item, why: why.slice(0, 300) });
		}
	}
	// What a part was deleting when it failed: an item of its own, so nothing else has to find it again
	const listed = new Set(left.filter((l) => l.item.t === 'files').map((l) => JSON.stringify(l.item)));
	for (const files of step.unfinished) {
		if (!listed.has(JSON.stringify(files))) left.push({ item: files, why: 'a try stopped while deleting them' });
		listed.add(JSON.stringify(files));
	}
	if (p.swept) counts.files += tally.files;
	const rest = [...more, ...items.slice(next)];
	const result = { ...counts, ...(left.length ? { waiting: left.map((l) => `${nameOf(l.item)}: ${l.why}`) } : {}) } as Record<string, unknown>;
	if (rest.length) return { done: false, params: { ...p, unfinished: undefined, started: true, items: rest, left, waits, again, counts } as Record<string, unknown>, result, delaySeconds: MORE_DELAY };

	// The round is over
	const tries = p.tries ?? 0;
	const retries = p.run ? RUN_ACCOUNT_RETRIES : RETRY_DELAYS;
	if (left.length && tries < retries.length) {
		return { done: false, params: { ...p, unfinished: undefined, started: true, items: [...left.map((l) => l.item), ...waits], left: [], waits: [], again, counts, tries: tries + 1 } as Record<string, unknown>, result, delaySeconds: retries[tries], note: left.map((l) => `${nameOf(l.item)}: ${l.why}`).join('; ').slice(0, 1000) };
	}
	const stuck = left.filter((l) => l.why !== 'its record still exists');
	if (stuck.length) throw new Error(`Not erased: ${stuck.map((l) => `${nameOf(l.item)} (${l.why})`).join('; ')}`.slice(0, 1800));
	// An erase that stopped before the record: it writes its own list when it goes on
	for (const l of left) counts.kept.push(`${nameOf(l.item)}: ${l.why}`);
	if (waits.length) {
		const until = Math.min(...waits.flatMap((item) => Object.values(('arm' in item && item.arm) || {})).map((at) => Date.parse(at)).filter((at) => at > Date.now()));
		const seconds = Number.isFinite(until) ? Math.ceil((until - Date.now()) / 1000) : MORE_DELAY;
		return { done: false, params: { ...p, unfinished: undefined, started: true, items: waits, left: [], waits: [], again, counts } as Record<string, unknown>, result: { ...counts }, delaySeconds: Math.min(MAX_QUEUE_DELAY, Math.max(MORE_DELAY, seconds)), note: 'a record of it went less than a day ago' };
	}
	// No account is named for longer than its images take
	await forgetAccounts(dbOf(env)!, job.id);
	if (!p.swept && !p.run && again.length) {
		return { done: false, params: { started: true, delay: p.delay, items: again, counts, swept: true, tries: 0 } as Record<string, unknown>, result: { ...counts }, delaySeconds: SWEEP_DELAY, note: null };
	}
	// The row keeps what was done, not the list
	if (items.length) return { done: false, params: { started: true, run: p.run, counts, swept: true } as Record<string, unknown>, result: { ...counts } };
	await closeTargets(dbOf(env)!, job.id, { all: p.run === true });
	const unsure = counts.kept.filter((k) => k.endsWith(UNSURE));
	if (unsure.length) {
		reportNeedsAction('api-videos', env as ErrorReporterEnv, undefined, {
			key: `erase-media-kept:${job.id}`,
			source: 'admin-job',
			title: 'Images of an erased account to look at',
			message: `${unsure.length} image(s) stay: whose they are cannot be proven. ${unsure.join('; ')}`.slice(0, 1000),
			itemType: 'admin-job',
			itemId: job.id,
			itemUrl: '/jobs',
		});
	}
	return { done: true, result: { ...counts } };
}

/** The job gave up: an Errors page item that leads to the Jobs page (Retry). */
export async function onEraseMediaFailed(env: unknown, job: AdminJob, error: string): Promise<void> {
	// A part nobody is deleting any more (a delivery takes its own back; a failed job's mark counts for nobody)
	const db = dbOf(env as Env);
	if (db) await endStaleParts(db, job.id).catch((e) => logger.warn('[EraseMedia] Marks not taken back', { jobId: job.id, error: e instanceof Error ? e.message : String(e) }));
	reportNeedsAction('api-videos', env as ErrorReporterEnv, undefined, {
		key: `admin-job:${job.id}`,
		source: 'admin-job',
		title: 'Media of an erased account not deleted',
		message: error.slice(0, 500),
		itemType: 'admin-job',
		itemId: job.id,
		itemUrl: '/jobs',
	});
}
