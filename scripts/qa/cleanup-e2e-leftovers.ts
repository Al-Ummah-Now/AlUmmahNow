/**
 * Removes E2E / release-suite leftovers from QA (issues #464, #465).
 *
 *   pnpm qa:cleanup                 # dry run: reads QA, writes the inventory, changes nothing
 *   pnpm qa:cleanup --apply         # deletes what the inventory marks "delete"
 *   pnpm qa:cleanup --apply --reconcile   # then runs the search / ownership reconcile passes
 *
 * Options: --out <file> (inventory JSON, default: $TMPDIR/qa-cleanup-<time>.json)
 *          --min-age-hours <n> (default 2: anything newer is kept, a running job may use it)
 *          --api-url <url> (only https://videos.api.qa.alummahnow.net is accepted)
 *
 * The selection rules live in ./e2e-leftovers.ts (unit-tested); "unsure" items are
 * reported and never deleted.
 *
 * A run is bounded and resumes where the last one stopped (./cleanup-inventory.ts): it lists every
 * key, reads only records the state does not have yet (by etag) until its time is up, deletes what
 * it knows enough about, and leaves the rest for the next run. It ends red only when it got nowhere.
 * The state is a private R2 object on QA (STATE_KEY in the admin backups bucket), written only by
 * --apply; a dry run writes nothing at all. What a run prints or uploads has no title, name, handle,
 * text or address: this repo is public.
 *
 * An object is deleted only while it is the version that was judged: its etag is compared right
 * before the delete (R2 has no conditional delete, so a write in that last moment can still be lost).
 * Records that are kept are changed with conditional writes only (R2Repository.updateObject).
 *
 * How it deletes: the leftovers belong to hundreds of throwaway test accounts
 * that only a browser flow can sign in to, so instead of calling the API as each
 * owner, this runs api-videos' own delete code in-process against QA's real
 * bindings (wrangler getPlatformProxy with remote bindings from
 * apps/api-videos/wrangler.qa.jsonc). The R2 bindings are wrapped with
 * withSearchSync exactly as the Worker wraps them, so every delete also updates
 * content_ownership and the search tables (SEARCH_DB). The steps mirror the
 * endpoints: VideoBulkDelete (the video record), ScheduleDelete (its schedule
 * entry), CommentDelete (removeStoredComment), DeleteCommunityPost (the channel
 * post index; the post object itself is removed outright, as removeChannelContent
 * does), ChannelDelete (main-channel promotion, handle and tabs release, profile
 * update, removeChannelContent). No SQL is written by hand; --reconcile calls the
 * same reconcileSearchIndex / reconcileOwnershipIndex the daily cron runs.
 *
 * Not done here: the queue messages those endpoints send (VideoDelete,
 * ChannelDelete, CommentDelete, CommunityPostDeleted are only logged by the
 * processor), and Bunny media deletion: api-videos has no Bunny delete path, so
 * the inventory lists the Bunny video ids of the deleted records instead.
 *
 * Needs a wrangler login (or CLOUDFLARE_API_TOKEN) with R2 and D1 access to the
 * QA account.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { parseJsonc } from '../release/jsonc.ts';
import { assertQaTarget, DEFAULT_MIN_AGE_MS, QA_TARGET } from './e2e-leftovers.ts';
import {
	type ChannelEntry,
	type Inventory,
	type InventoryItem,
	type Listing,
	type Outcome,
	type Pending,
	type State,
	type Store,
	buildInventory,
	DEADLINES_MIN,
	emptyState,
	mapUntil,
	parseState,
	pendingReads,
	prune,
	publicItems,
	push,
	shorten,
	stalled,
	summarize,
} from './cleanup-inventory.ts';
import R2Repository from '../../apps/api-videos/src/lib/r2Repo';
import { withSearchSync } from '../../apps/api-videos/src/lib/search/sync';
import { reconcileSearchIndex } from '../../apps/api-videos/src/lib/search/backfill';
import { reconcileOwnershipIndex } from '../../apps/api-videos/src/lib/search/ownership';
import { removeStoredComment, type StoredComment } from '../../apps/api-videos/src/lib/comments';
import { releaseHandle } from '../../apps/api-videos/src/lib/channelHandles';
import { pickNewMainChannel, removeChannelPostsAndSections } from '../../apps/api-videos/src/lib/channelDeletion';

// Run with tsx, which loads this file (and api-videos) as CommonJS
const ROOT = resolve(__dirname, '../..');
const QA_CONFIG = join(ROOT, 'apps/api-videos/wrangler.qa.jsonc');
/** Bindings the cleanup needs, by binding name. */
const READ_CONCURRENCY = 8;
/** Kept low: each call is a local proxy connection, and too many exhaust the local ports. */
const WRITE_CONCURRENCY = 4;
const R2_BINDINGS = ['videos', 'channels', 'playlists', 'community_posts', 'channel_sections', 'channel_tabs', 'profiles', 'SCHEDULED_VIDEOS', 'ADMIN_BACKUPS'] as const;
/** What earlier runs read: a private object, no text in it (cleanup-inventory.ts). */
export const STATE_KEY = 'qa-cleanup/state.json';

export type Env = Record<(typeof R2_BINDINGS)[number], R2Bucket> & { SEARCH_DB: D1Database };

interface Args {
	apply: boolean;
	reconcile: boolean;
	out: string;
	apiUrl: string;
	minAgeMs: number;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		apply: false,
		reconcile: false,
		out: join(tmpdir(), `qa-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
		apiUrl: `https://${QA_TARGET.apiHost}`,
		minAgeMs: DEFAULT_MIN_AGE_MS,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') args.apply = true;
		else if (a === '--reconcile') args.reconcile = true;
		else if (a === '--out') args.out = resolve(argv[++i] ?? '');
		else if (a === '--api-url') args.apiUrl = argv[++i] ?? '';
		else if (a === '--min-age-hours') {
			const hours = Number(argv[++i]);
			if (!Number.isFinite(hours) || hours < 0) throw new Error('--min-age-hours needs a number >= 0');
			args.minAgeMs = hours * 60 * 60 * 1000;
		}
		else throw new Error(`unknown argument ${a}`);
	}
	if (args.reconcile && !args.apply) throw new Error('--reconcile only runs together with --apply');
	return args;
}

const say = (line: string) => process.stdout.write(`${line}\n`);

/** Temporary wrangler config with only the QA bindings the cleanup uses, all remote. */
function writeQaProxyConfig(apiUrl: string): { path: string; dispose: () => void } {
	const qa = parseJsonc(readFileSync(QA_CONFIG, 'utf8')) as {
		name: string;
		compatibility_date: string;
		r2_buckets: { binding: string; bucket_name: string }[];
		d1_databases: { binding: string; database_name: string; database_id: string }[];
	};
	const r2 = R2_BINDINGS.map((binding) => {
		const b = qa.r2_buckets.find((x) => x.binding === binding);
		if (!b) throw new Error(`${QA_CONFIG} has no R2 binding ${binding}`);
		return { binding, bucket_name: b.bucket_name, remote: true };
	});
	const search = qa.d1_databases.find((d) => d.binding === 'SEARCH_DB');
	if (!search) throw new Error(`${QA_CONFIG} has no SEARCH_DB binding`);
	assertQaTarget({ apiUrl, workerName: qa.name, resourceNames: [...r2.map((b) => b.bucket_name), search.database_name] });
	const dir = mkdtempSync(join(tmpdir(), 'qa-cleanup-'));
	const path = join(dir, 'wrangler.json');
	writeFileSync(path, JSON.stringify({
		name: `${qa.name}-cleanup`,
		compatibility_date: qa.compatibility_date,
		compatibility_flags: ['nodejs_compat'],
		r2_buckets: r2,
		d1_databases: [{ binding: 'SEARCH_DB', database_name: search.database_name, database_id: search.database_id, remote: true }],
	}));
	return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One call of the remote-binding proxy may take this long; a hung one must not hold the run. */
const CALL_TIMEOUT_MS = 30_000;
/** A delete step is several calls. */
const WRITE_TIMEOUT_MS = 120_000;

async function withTimeout<T>(fn: () => Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(ms / 1000)} s`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** The remote-binding proxy now and then fails a call with "internal error"; retry those, not past `until`. */
async function retry<T>(fn: () => Promise<T>, attempts = 5, until = Infinity, timeoutMs = CALL_TIMEOUT_MS, backoffMs = 1000): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await withTimeout(fn, timeoutMs);
		} catch (error) {
			if (i >= attempts || Date.now() >= until) throw error;
			await new Promise((r) => setTimeout(r, backoffMs * 2 ** (i - 1)));
		}
	}
}

/** Bucket calls made, retries included (printed at the end of the read phase). */
const calls = { list: 0, get: 0 };

/** Every object under `prefix` (top level only with `flat`): key → etag. */
async function listObjects(bucket: R2Bucket, until: number, options: { prefix?: string; flat?: boolean } = {}): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	let cursor: string | undefined;
	do {
		if (Date.now() >= until) throw new Error(`listing a bucket did not finish in ${DEADLINES_MIN.list} minutes`);
		const page = await retry(() => (calls.list++, bucket.list({ prefix: options.prefix, cursor, limit: 1000, ...(options.flat ? { delimiter: '/' } : {}) })), 5, until);
		for (const o of page.objects) out.set(o.key, o.etag);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

const only = (objects: Map<string, string>, keep: (key: string) => boolean) => new Map([...objects].filter(([key]) => keep(key)));

/** An object's etag and JSON (null when it is not JSON); null when it is gone. */
async function readObject(bucket: R2Bucket, key: string, attempts: number, until: number): Promise<{ etag: string; value: Record<string, unknown> | null } | null> {
	const read = await retry(async () => {
		calls.get++;
		const object = await bucket.get(key);
		return object ? { etag: object.etag, text: await object.text() } : null;
	}, attempts, until);
	if (!read) return null;
	try {
		return { etag: read.etag, value: JSON.parse(read.text) as Record<string, unknown> };
	} catch {
		return { etag: read.etag, value: null };
	}
}

interface VideoRecord {
	id: string;
	comments?: StoredComment[];
}
interface ChannelRecord {
	id: string;
	userId?: string;
	handle?: string;
	isMain?: boolean;
	isDeleted?: boolean;
	dateModified?: string;
}
interface ProfileRecord {
	id: string;
	channels?: string[];
}

export async function listEverything(env: Env, until: number): Promise<{ listing: Listing; keys: { schedule: Map<string, string>; tabs: Map<string, string> } }> {
	const flat = (key: string) => !key.includes('/');
	const [videos, channels, profiles, playlists, posts, sections, schedule, handles, tabs] = await Promise.all([
		listObjects(env.videos, until, { flat: true }),
		listObjects(env.channels, until, { flat: true }),
		listObjects(env.profiles, until, { flat: true }),
		listObjects(env.playlists, until),
		listObjects(env.community_posts, until, { prefix: 'posts/' }),
		listObjects(env.channel_sections, until),
		listObjects(env.SCHEDULED_VIDEOS, until),
		listObjects(env.channel_tabs, until, { prefix: 'channel-handles/' }),
		listObjects(env.channel_tabs, until, { prefix: 'channel-tabs/' }),
	]);
	return {
		listing: {
			videos: only(videos, (k) => flat(k) && !k.includes(':')),
			channels: only(channels, flat),
			profiles: only(profiles, flat),
			playlists: only(playlists, (k) => !k.startsWith('watch-later-')),
			posts: only(posts, (k) => /^posts\/[^/]+\/[^/]+\.json$/.test(k) && !k.endsWith('/index.json')),
			// `_order/<channel>` is a channel's section order, not a section
			sections: only(sections, (k) => !k.startsWith('_order/')),
			handles,
		},
		keys: { schedule, tabs },
	};
}

const BUCKET: Record<Store, Exclude<keyof Env, 'SEARCH_DB'>> = {
	videos: 'videos', channels: 'channels', profiles: 'profiles', playlists: 'playlists', posts: 'community_posts', sections: 'channel_sections', handles: 'channel_tabs',
};
/** This many reads failing in a row: the connection is gone, keep what was read. */
const MAX_READ_FAILURES = 40;

/** Reads what the state does not have yet, until the deadline. */
export async function readPending(env: Env, state: State, pending: Pending[], deadline: number) {
	return mapUntil(pending, READ_CONCURRENCY, async ({ store, key }) => {
		try {
			const read = await readObject(env[BUCKET[store]], key, 3, deadline);
			// The etag of what was read, which may be newer than the listing's
			if (read) (state.stores[store] as Record<string, unknown>)[key] = [read.etag, shorten(store, read.value)];
			return 'done';
		} catch {
			return 'failed';
		}
	}, { deadline, maxFailuresInRow: MAX_READ_FAILURES });
}

/** Deletes the object if it is still the version with this etag; gone already counts as done. */
async function deleteUnchanged(bucket: R2Bucket, key: string, etag: string | undefined): Promise<Outcome> {
	const head = await bucket.head(key);
	if (!head) return 'done';
	if (!etag || head.etag !== etag) return 'skipped';
	await bucket.delete(key);
	return 'done';
}

export interface ApplyOptions {
	/** Nothing new starts after these */
	channelsUntil: number;
	until: number;
	/** Waits for the index writes a delete queued (withSearchSync), so they are as bounded as the deletes */
	settle: () => Promise<unknown>;
	/** First pause between attempts (tests) */
	backoffMs?: number;
}

export async function apply(env: Env, inv: Inventory, options: ApplyOptions) {
	const { until } = options;
	const del = (kind: InventoryItem['kind']) => inv.items.filter((i) => i.kind === kind && i.action === 'delete');
	const failures: string[] = [];
	const total = { planned: 0, done: 0, skipped: 0, left: 0 };
	// Every step is idempotent (deletes of one version, or conditional writes recomputed from a fresh read), so retry it
	const guard = async (label: string, fn: () => Promise<Outcome>): Promise<Outcome> => {
		try {
			return await retry(async () => {
				const outcome = await fn();
				await options.settle();
				return outcome;
			}, 3, until, WRITE_TIMEOUT_MS, options.backoffMs);
		} catch (error) {
			failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			return 'failed';
		}
	};
	const step = async <T>(what: string, items: T[], label: (item: T) => string, fn: (item: T) => Promise<Outcome>, deadline = until): Promise<void> => {
		const r = await mapUntil(items, WRITE_CONCURRENCY, (item) => guard(label(item), () => fn(item)), { deadline });
		total.planned += items.length;
		total.done += r.done;
		total.skipped += r.skipped;
		total.left += r.left;
		say(`[cleanup] ${what}: ${r.done}/${items.length} done${r.skipped ? `, ${r.skipped} changed meanwhile` : ''}${r.failed ? `, ${r.failed} failed` : ''}${r.left ? `, ${r.left} left for the next run` : ''}`);
	};
	/** Deletes one judged version and remembers what is gone. */
	const remove = (bucket: R2Bucket, gone: Set<string>) => async (item: InventoryItem): Promise<Outcome> => {
		const outcome = await deleteUnchanged(bucket, item.key, item.etag);
		if (outcome === 'done') gone.add(item.id);
		return outcome;
	};
	const gone = { videos: new Set<string>(), playlists: new Set<string>(), posts: new Set<string>(), sections: new Set<string>() };

	// 1. Probe comments on kept videos (CommentDelete: removeStoredComment, one conditional write per video)
	const commentsByVideo = new Map<string, string[]>();
	for (const c of del('comment')) push(commentsByVideo, c.key, c.id);
	const videoRepo = new R2Repository<VideoRecord>(env.videos);
	await step('videos with probe comments', [...commentsByVideo], ([key]) => `comments of ${key}`, async ([key, ids]) => {
		await videoRepo.updateObject(key, (video) => {
			const before = JSON.stringify(video.comments ?? []);
			let comments = (video.comments ?? []) as StoredComment[];
			for (const id of ids) comments = removeStoredComment(comments, id).comments;
			if (JSON.stringify(comments) === before) return false;
			video.comments = comments;
			return true;
		});
		return 'done';
	});

	// 2. Videos (VideoBulkDelete). Their schedule entries go in step 7.
	await step('video records', del('video'), (v) => `video ${v.id}`, remove(env.videos, gone.videos));

	// 3. Community posts: the id leaves the channel post index (DeleteCommunityPost), then the comment
	//    objects go, then the post object itself (as removeChannelContent does; the endpoint only marks
	//    it deleted, which is what left ~2,000 records behind).
	const postIndexRepo = new R2Repository<{ postIds: string[]; lastUpdated: string }>(env.community_posts);
	await step('posts', del('post'), (p) => `post ${p.id}`, async (p) => {
		const head = await env.community_posts.head(p.key);
		if (head && head.etag !== p.etag) return 'skipped';
		await postIndexRepo.updateObject(`posts/${p.parent}/index.json`, (index) => {
			if (!index.postIds?.includes(p.id)) return false;
			index.postIds = index.postIds.filter((id) => id !== p.id);
			index.lastUpdated = new Date().toISOString();
			return true;
		});
		for (;;) {
			const page = await env.community_posts.list({ prefix: `comments/${p.id}/`, limit: 1000 });
			if (page.objects.length > 0) await env.community_posts.delete(page.objects.map((o) => o.key));
			if (!page.truncated) break;
		}
		return remove(env.community_posts, gone.posts)(p);
	});

	// 4. Sections (ChannelSectionDelete)
	await step('sections', del('section'), (s) => `section ${s.id}`, remove(env.channel_sections, gone.sections));

	// 5. Playlists (PlaylistDelete)
	await step('playlists', del('playlist'), (p) => `playlist ${p.id}`, remove(env.playlists, gone.playlists));

	// 6. Channels (ChannelDelete), one owner at a time so main-channel updates never race. A channel goes
	//    only when all that was on it is really gone (a step above may have stopped, failed or skipped)
	//    and nothing new is on it. The owner's profile is updated afterwards, once (step 6b).
	const channelRepo = new R2Repository<ChannelRecord>(env.channels);
	const profileRepo = new R2Repository<ProfileRecord>(env.profiles);
	const items = new Map(del('channel').map((c) => [c.id, c]));
	const emptied = (id: string) => {
		const on = inv.onChannel.get(id);
		return !on || (['videos', 'playlists', 'posts', 'sections'] as const).every((what) => on[what].every((x) => gone[what].has(x)));
	};
	const channelsGone = new Set<string>();
	const byOwner = new Map<string, ChannelEntry[]>();
	for (const c of inv.channels) push(byOwner, c.userId ?? `channel ${c.id}`, c);
	const work = [...byOwner.values()].flatMap((owned) => {
		// The main one last: none of the others has to become main on the way
		const ready = owned.filter((c) => items.has(c.id) && emptied(c.id)).sort((a, b) => Number(a.isMain ?? false) - Number(b.isMain ?? false));
		return ready.length > 0 ? [{ owned, ready }] : [];
	});
	const blockedCount = items.size - work.reduce((n, w) => n + w.ready.length, 0);
	if (blockedCount > 0) say(`[cleanup] ${blockedCount} channel(s) wait: something on them is still there`);
	const deleteChannel = async (channel: ChannelEntry, owned: ChannelEntry[]): Promise<Outcome> => {
		const item = items.get(channel.id)!;
		const stored = await env.channels.get(item.key);
		if (stored) {
			if (stored.etag !== item.etag) return 'skipped';
			if (await holdsSomething(env, channel.id)) return 'skipped';
			const record = await stored.json<ChannelRecord>();
			if (channel.isMain) {
				const rest = owned.filter((c) => c.id !== channel.id && !channelsGone.has(c.id));
				// One that stays, if there is one; else one that is still there for now
				const kept = rest.filter((c) => !items.has(c.id));
				const next = pickNewMainChannel((kept.some((c) => !c.isDeleted) ? kept : rest).map((c) => ({ ...c, userId: c.userId ?? '' })), channel.id);
				if (next) {
					await channelRepo.updateObject(next.id, (fresh) => {
						if (fresh.isMain || fresh.isDeleted || fresh.userId !== channel.userId) return false;
						fresh.isMain = true;
						fresh.dateModified = new Date().toISOString();
						return true;
					});
				}
			}
			const outcome = await deleteUnchanged(env.channels, item.key, item.etag);
			if (outcome !== 'done') return outcome;
			// Both check for themselves that they are this channel's
			await releaseHandle(env.channel_tabs, record.handle, channel.id);
		}
		await env.channel_tabs.delete(`channel-tabs/${channel.id}`);
		// What is left of them: the post index and the section order
		await removeChannelPostsAndSections(env, channel.id);
		channelsGone.add(channel.id);
		return 'done';
	};
	await step('owners of channels to delete', work, ({ ready }) => `channels with ${ready[0].id}`, async ({ owned, ready }) => {
		let outcome: Outcome = 'done';
		for (const channel of ready) {
			if (channelsGone.has(channel.id)) continue;
			if (Date.now() >= options.channelsUntil) break;
			if ((await deleteChannel(channel, owned)) === 'skipped') outcome = 'skipped';
		}
		return outcome;
	}, options.channelsUntil);
	say(`[cleanup] channels: ${channelsGone.size}/${items.size} deleted`);

	// 6b. Profiles of test accounts: drop the ids of channels that are gone (ChannelDelete does this per channel)
	const stillThere = new Set([...items.keys()].filter((id) => !channelsGone.has(id)));
	const refs = del('profile-ref').flatMap((item) => {
		const dead = (item.channels ?? []).filter((id) => !stillThere.has(id));
		return dead.length > 0 ? [{ item, dead }] : [];
	});
	await step('profiles with dead channels', refs, ({ item }) => `profile ${item.id}`, async ({ item, dead }) => {
		// Listed as missing: still so now?
		const missing = new Set<string>();
		for (const id of dead) if (channelsGone.has(id) || !(await env.channels.head(id))) missing.add(id);
		if (missing.size === 0) return 'skipped';
		await profileRepo.updateObject(item.key, (profile) => {
			if (!profile.channels?.some((id) => missing.has(id))) return false;
			profile.channels = profile.channels.filter((id) => !missing.has(id));
			return true;
		});
		return 'done';
	});

	// 6c. Handles and tab configs of channels that were gone before this run (ChannelDelete's
	//     releaseHandle and tabs delete, for deletes that stopped half-way). Step 6 did its own.
	const dead = [...del('handle'), ...del('tabs')].filter((i) => !stillThere.has(i.parent ?? '') && !channelsGone.has(i.parent ?? ''));
	await step('handles and tab configs of deleted channels', dead, (i) => `a ${i.kind} object of channel ${i.parent}`, async (i) => {
		if (!i.parent || (await env.channels.head(i.parent))) return 'skipped';
		return deleteUnchanged(env.channel_tabs, i.key, i.etag);
	});

	// 7. Schedule entries of deleted or missing videos
	const entries = del('schedule-entry');
	const planned = new Set(del('video').map((v) => v.id));
	await step('schedule entries', entries.filter((e) => !planned.has(e.parent ?? '') || gone.videos.has(e.parent ?? '')), (e) => `schedule entry of ${e.parent}`, async (e) => {
		if (!e.parent || (await env.videos.head(e.parent))) return 'skipped';
		return deleteUnchanged(env.SCHEDULED_VIDEOS, e.key, e.etag);
	});
	return { failures, ...total };
}

/** Whether anything is on a channel now: a video or playlist of the index, a post or a section (made while this run was reading). */
async function holdsSomething(env: Env, channelId: string): Promise<boolean> {
	for (const kind of ['video', 'playlist']) {
		const row = await env.SEARCH_DB.prepare('SELECT 1 AS n FROM content_ownership WHERE kind = ? AND channel_id = ? AND is_deleted = 0 LIMIT 1').bind(kind, channelId).first();
		if (row) return true;
	}
	const posts = await env.community_posts.list({ prefix: `posts/${channelId}/`, limit: 2 });
	if (posts.objects.some((o) => !o.key.endsWith('/index.json'))) return true;
	const sections = await env.channel_sections.list({ prefix: `${channelId}/`, limit: 1 });
	return sections.objects.length > 0;
}

async function readState(env: Env): Promise<State> {
	try {
		return parseState(await retry(async () => (await env.ADMIN_BACKUPS.get(STATE_KEY))?.text() ?? null, 3, Infinity, WRITE_TIMEOUT_MS));
	} catch (error) {
		say(`[cleanup] the state could not be read, everything is read again: ${error instanceof Error ? error.message : String(error)}`);
		return emptyState();
	}
}

async function main(): Promise<void> {
	const started = Date.now();
	const until = (minutes: number) => started + minutes * 60_000;
	const args = parseArgs(process.argv.slice(2));
	const config = writeQaProxyConfig(args.apiUrl);
	const proxy = await getPlatformProxy<Env>({ configPath: config.path, remoteBindings: true });
	const pending: Promise<unknown>[] = [];
	const settle = () => Promise.allSettled(pending.splice(0));
	const env = withSearchSync(proxy.env as unknown as Env, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	try {
		say('[cleanup] listing QA buckets…');
		const { listing, keys } = await listEverything(env, until(DEADLINES_MIN.list));
		const state = await readState(env);
		prune(state, listing);
		const toRead = pendingReads(state, listing);
		for (const [store, objects] of Object.entries(listing)) say(`  ${store.padEnd(10)} ${objects.size} listed, ${objects.size - Object.keys(state.stores[store as Store]).length} to read`);
		say(`[cleanup] listed in ${Math.round((Date.now() - started) / 1000)} s`);
		const read = await readPending(env, state, toRead, until(DEADLINES_MIN.read));
		if (args.apply) await retry(() => env.ADMIN_BACKUPS.put(STATE_KEY, JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } }), 5, Infinity, WRITE_TIMEOUT_MS);
		const unread = read.left + read.failed;
		say(`[cleanup] read ${read.done}/${toRead.length} new or changed record(s)${read.failed ? `, ${read.failed} failed` : ''}${unread ? `; ${unread} left for the next run` : ''}`);
		say(`[cleanup] R2 calls so far: ${calls.list} list, ${calls.get} get; ${Math.round((Date.now() - started) / 1000)} s`);

		const inv = buildInventory(state, listing, keys, { now: Date.now(), minAgeMs: args.minAgeMs });
		const summary = summarize(inv.items);
		writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry-run', unread, summary, items: publicItems(inv.items) }, null, 2));
		say(`[cleanup] inventory: ${args.out}`);
		for (const [kind, counts] of Object.entries(summary)) say(`  ${kind.padEnd(15)} delete ${counts.delete}  keep ${counts.keep}  unsure ${counts.unsure}  wait ${counts.wait}`);
		for (const u of publicItems(inv.items).filter((i) => i.action === 'unsure')) say(`  unsure ${u.kind} ${u.id} (${u.owner ?? 'no owner'}): ${u.reason}`);
		let result = { failures: [] as string[], planned: 0, done: 0, skipped: 0, left: 0 };
		if (!args.apply) {
			say('[cleanup] dry run: nothing changed (pass --apply to delete)');
		} else {
			result = await apply(env, inv, { channelsUntil: until(DEADLINES_MIN.channels), until: until(DEADLINES_MIN.write), settle });
			if (args.reconcile && Date.now() < until(DEADLINES_MIN.reconcile)) {
				// A bounded step of the passes the daily cron finishes; each resumes where the last stopped
				say('[cleanup] running a step of the search and ownership reconcile passes…');
				try {
					await withTimeout(async () => {
						say(`  search: ${JSON.stringify(await reconcileSearchIndex(proxy.env as never, { pagesPerEntity: 2 }))}`);
						say(`  ownership: ${JSON.stringify(await reconcileOwnershipIndex(proxy.env as never, { pagesPerKind: 2 }))}`);
					}, until(DEADLINES_MIN.reconcile) - Date.now());
				} catch (error) {
					say(`  reconcile stopped, the daily cron goes on: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			for (const f of result.failures) say(`  failed, the next run tries again: ${f}`);
			if (result.left) say(`[cleanup] ${result.left} leftover(s) not reached this time`);
		}
		const stuck = stalled({ toRead: toRead.length, read: read.done, toDelete: result.planned, deleted: result.done, skipped: result.skipped });
		if (stuck) {
			say(`[cleanup] no progress: ${stuck}`);
			process.exitCode = 1;
		}
	} finally {
		await withTimeout(settle).catch(() => undefined);
		await withTimeout(() => proxy.dispose()).catch(() => undefined);
		config.dispose();
	}
}

if (require.main === module) {
	main()
		.catch((error) => {
			process.stderr.write(`[cleanup] ${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		})
		// A call the proxy never answered would keep the process alive
		.finally(() => process.exit());
}
