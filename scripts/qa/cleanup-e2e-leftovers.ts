/**
 * Removes E2E / release-suite leftovers from QA (issues #464, #465).
 *
 *   pnpm qa:cleanup                 # dry run: reads QA, writes the inventory, changes nothing
 *   pnpm qa:cleanup --apply         # deletes what the inventory marks "delete"
 *   pnpm qa:cleanup --apply --reconcile   # then runs the search / ownership reconcile passes
 *
 * Options: --out <file> (inventory JSON, default: $TMPDIR/qa-cleanup-<time>.json)
 *          --state <file> (what earlier runs read; read at the start, written after the read phase)
 *          --min-age-hours <n> (default 2: anything newer is kept, a running job may use it)
 *          --api-url <url> (only https://videos.api.qa.alummahnow.net is accepted)
 *
 * The selection rules live in ./e2e-leftovers.ts (unit-tested); "unsure" items are
 * reported and never deleted.
 *
 * A run is bounded and resumes where the last one stopped (./cleanup-inventory.ts): it lists every
 * key, reads only records the state does not have yet (by etag) until its time is up, deletes what
 * it knows enough about, and leaves the rest for the next run. It ends red only when it got nowhere.
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { parseJsonc } from '../release/jsonc.ts';
import { assertQaTarget, DEFAULT_MIN_AGE_MS, QA_TARGET } from './e2e-leftovers.ts';
import {
	type InventoryItem,
	type Listing,
	type Pending,
	type State,
	type Store,
	buildInventory,
	DEADLINES_MIN,
	mapUntil,
	parseState,
	pendingReads,
	push,
	prune,
	shorten,
	stalled,
	summarize,
	type ChannelEntry,
} from './cleanup-inventory.ts';
import R2Repository from '../../apps/api-videos/src/lib/r2Repo';
import { withSearchSync } from '../../apps/api-videos/src/lib/search/sync';
import { reconcileSearchIndex } from '../../apps/api-videos/src/lib/search/backfill';
import { reconcileOwnershipIndex } from '../../apps/api-videos/src/lib/search/ownership';
import { removeStoredComment, type StoredComment } from '../../apps/api-videos/src/lib/comments';
import { releaseHandle } from '../../apps/api-videos/src/lib/channelHandles';
import { pickNewMainChannel, removeChannelContent } from '../../apps/api-videos/src/lib/channelDeletion';

// Run with tsx, which loads this file (and api-videos) as CommonJS
const ROOT = resolve(__dirname, '../..');
const QA_CONFIG = join(ROOT, 'apps/api-videos/wrangler.qa.jsonc');
/** Bindings the cleanup needs, by binding name. */
const READ_CONCURRENCY = 8;
/** Kept low: each call is a local proxy connection, and too many exhaust the local ports. */
const WRITE_CONCURRENCY = 2;
const R2_BINDINGS = ['videos', 'channels', 'playlists', 'community_posts', 'channel_sections', 'channel_tabs', 'profiles', 'SCHEDULED_VIDEOS'] as const;

export type Env = Record<(typeof R2_BINDINGS)[number], R2Bucket> & { SEARCH_DB: D1Database };

interface Args {
	apply: boolean;
	reconcile: boolean;
	out: string;
	state: string | null;
	apiUrl: string;
	minAgeMs: number;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		apply: false,
		reconcile: false,
		out: join(tmpdir(), `qa-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
		state: null,
		apiUrl: `https://${QA_TARGET.apiHost}`,
		minAgeMs: DEFAULT_MIN_AGE_MS,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') args.apply = true;
		else if (a === '--reconcile') args.reconcile = true;
		else if (a === '--out') args.out = resolve(argv[++i] ?? '');
		else if (a === '--state') args.state = resolve(argv[++i] ?? '');
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
async function retry<T>(fn: () => Promise<T>, attempts = 5, until = Infinity, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await withTimeout(fn, timeoutMs);
		} catch (error) {
			if (i >= attempts || Date.now() >= until) throw error;
			await new Promise((r) => setTimeout(r, 500 * 2 ** i));
		}
	}
}

/** Every object under `prefix` (top level only with `flat`): key → etag. */
async function listObjects(bucket: R2Bucket, until: number, options: { prefix?: string; flat?: boolean } = {}): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	let cursor: string | undefined;
	do {
		if (Date.now() >= until) throw new Error(`listing a bucket did not finish in ${DEADLINES_MIN.list} minutes`);
		const page = await retry(() => bucket.list({ prefix: options.prefix, cursor, limit: 1000, ...(options.flat ? { delimiter: '/' } : {}) }), 5, until);
		for (const o of page.objects) out.set(o.key, o.etag);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

const only = (objects: Map<string, string>, keep: (key: string) => boolean) => new Map([...objects].filter(([key]) => keep(key)));

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	}));
	return out;
}

async function readJson<T>(bucket: R2Bucket, key: string, attempts = 5, until = Infinity): Promise<T | null> {
	const text = await retry(async () => (await bucket.get(key))?.text() ?? null, attempts, until);
	if (text === null) return null;
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

interface VideoRecord {
	id: string;
	comments?: StoredComment[];
}
interface ChannelRecord {
	id: string;
	isMain?: boolean;
}
interface ProfileRecord {
	id: string;
	channels?: string[];
}

export async function listEverything(env: Env, until: number): Promise<{ listing: Listing; keys: { schedule: string[]; tabs: string[] } }> {
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
			sections,
			handles,
		},
		keys: { schedule: [...schedule.keys()], tabs: [...tabs.keys()] },
	};
}

const BUCKET: Record<Store, keyof Env & string> = {
	videos: 'videos', channels: 'channels', profiles: 'profiles', playlists: 'playlists', posts: 'community_posts', sections: 'channel_sections', handles: 'channel_tabs',
};
/** This many reads failing in a row: the connection is gone, keep what was read. */
const MAX_READ_FAILURES = 40;

/** Reads what the state does not have yet, until the deadline. */
export async function readPending(env: Env, state: State, pending: Pending[], deadline: number) {
	return mapUntil(pending, READ_CONCURRENCY, async ({ store, key, etag }) => {
		try {
			const raw = await readJson<Record<string, unknown>>(env[BUCKET[store]] as R2Bucket, key, 3, deadline);
			(state.stores[store] as Record<string, unknown>)[key] = [etag, shorten(store, raw)];
			return true;
		} catch {
			return false;
		}
	}, { deadline, maxFailuresInRow: MAX_READ_FAILURES });
}

/** content_ownership / search_* rows that point at the records marked for deletion. */
async function indexRows(db: D1Database, items: InventoryItem[]): Promise<Record<string, number>> {
	const ids = (kind: InventoryItem['kind']) => items.filter((i) => i.kind === kind && i.action === 'delete').map((i) => i.id);
	const count = async (sql: string, list: string[]) => {
		let n = 0;
		for (let i = 0; i < list.length; i += 90) {
			const chunk = list.slice(i, i + 90);
			const row = await retry(() => db.prepare(sql.replace('(?)', `(${chunk.map(() => '?').join(',')})`)).bind(...chunk).first<{ n: number }>());
			n += row?.n ?? 0;
		}
		return n;
	};
	return {
		ownership_videos: await count(`SELECT count(*) AS n FROM content_ownership WHERE kind = 'video' AND id IN (?)`, ids('video')),
		ownership_channels: await count(`SELECT count(*) AS n FROM content_ownership WHERE kind = 'channel' AND id IN (?)`, ids('channel')),
		search_videos: await count('SELECT count(*) AS n FROM search_videos WHERE id IN (?)', ids('video')),
		search_channels: await count('SELECT count(*) AS n FROM search_channels WHERE id IN (?)', ids('channel')),
		search_posts: await count('SELECT count(*) AS n FROM search_posts WHERE id IN (?)', ids('post')),
	};
}

type Inventory = ReturnType<typeof buildInventory>;

export async function apply(env: Env, inv: Inventory, until: number) {
	const del = (kind: InventoryItem['kind']) => inv.items.filter((i) => i.kind === kind && i.action === 'delete');
	const videoRepo = new R2Repository<VideoRecord>(env.videos);
	const failures: string[] = [];
	const total = { planned: 0, done: 0, left: 0 };
	// Every step is idempotent (deletes, or writes recomputed from a fresh read), so retry it
	const guard = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
		try {
			await retry(fn, 5, until, WRITE_TIMEOUT_MS);
			return true;
		} catch (error) {
			failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	};
	const step = async <T>(what: string, items: T[], label: (item: T) => string, fn: (item: T) => Promise<unknown>): Promise<void> => {
		const r = await mapUntil(items, WRITE_CONCURRENCY, (item) => guard(label(item), () => fn(item)), { deadline: until });
		total.planned += items.length;
		total.done += r.done;
		total.left += r.left;
		say(`[cleanup] ${what}: ${r.done}/${items.length} done${r.failed ? `, ${r.failed} failed` : ''}${r.left ? `, ${r.left} left for the next run` : ''}`);
	};

	// 1. Probe comments on kept videos (CommentDelete: removeStoredComment, then one write per video)
	const commentsByVideo = new Map<string, string[]>();
	for (const c of del('comment')) push(commentsByVideo, c.parent!, c.id);
	await step('videos with probe comments', [...commentsByVideo], ([id]) => `comments of ${id}`, async ([videoId, ids]) => {
		const video = await readJson<VideoRecord>(env.videos, videoId, 1);
		if (!video) return;
		let comments = (video.comments ?? []) as StoredComment[];
		for (const id of ids) comments = removeStoredComment(comments, id).comments;
		await videoRepo.putObject(videoId, { ...video, comments });
	});

	// 2. Videos (VideoBulkDelete). Their schedule entries go in step 7.
	const videosGone = new Set<string>();
	await step('video records', del('video'), (v) => `video ${v.id}`, async (v) => {
		await videoRepo.deleteObject(v.id);
		videosGone.add(v.id);
	});

	// 3. Community posts: the comment objects, then the post object itself (as removeChannelContent
	//    does; the DeleteCommunityPost endpoint only marks it deleted, which is what left ~2,000
	//    records behind), then its id leaves the channel post index (DeleteCommunityPost).
	const postsGone = new Map<string, string[]>();
	await step('posts', del('post'), (p) => `post ${p.id}`, async (p) => {
		for (;;) {
			const page = await env.community_posts.list({ prefix: `comments/${p.id}/`, limit: 1000 });
			if (page.objects.length === 0) break;
			await env.community_posts.delete(page.objects.map((o) => o.key));
			if (!page.truncated) break;
		}
		await env.community_posts.delete(`posts/${p.parent}/${p.id}.json`);
		push(postsGone, p.parent!, p.id);
	});
	type PostIndex = { postIds: string[]; lastUpdated: string };
	const postIndexRepo = new R2Repository<PostIndex>(env.community_posts);
	// Not under the deadline: the posts of these are gone, and there is one write per channel
	await mapLimit([...postsGone], WRITE_CONCURRENCY, ([channelId, ids]) => guard(`post index of ${channelId}`, async () => {
		const gone = new Set(ids);
		await postIndexRepo.updateObject(`posts/${channelId}/index.json`, (index) => {
			if (!index.postIds?.some((id) => gone.has(id))) return false;
			index.postIds = index.postIds.filter((id) => !gone.has(id));
			index.lastUpdated = new Date().toISOString();
			return true;
		});
	}));

	// 4. Sections of kept channels (ChannelSectionDelete); deleted channels lose theirs in step 6
	await step('sections', del('section'), (s) => `section ${s.id}`, (s) => env.channel_sections.delete(s.id));

	// 5. Playlists (PlaylistDelete)
	const playlistRepo = new R2Repository<unknown>(env.playlists);
	await step('playlists', del('playlist'), (p) => `playlist ${p.id}`, (p) => playlistRepo.deleteObject(p.id));

	// 6. Channels (ChannelDelete), one owner at a time so main-channel updates never race. A channel
	//    goes only when every video of it is really gone (a step above may have stopped or failed).
	//    The owner's profile is updated afterwards, once (step 6b).
	const channelRepo = new R2Repository<ChannelRecord>(env.channels);
	const profileRepo = new R2Repository<ProfileRecord>(env.profiles);
	const deletable = del('channel').filter((c) => (inv.videosByChannel.get(c.id) ?? []).every((id) => videosGone.has(id)));
	const deleting = new Set(deletable.map((c) => c.id));
	const channelsGone = new Set<string>();
	const byOwner = new Map<string, ChannelEntry[]>();
	for (const c of inv.channels) if (c.userId) push(byOwner, c.userId, c);
	const owners = [...byOwner.values()].filter((list) => list.some((c) => deleting.has(c.id)));
	await step('owners of channels to delete', owners, (list) => `channels of ${list[0].userId}`, async (owned) => {
		const kept = owned.filter((c) => !deleting.has(c.id));
		for (const channel of owned.filter((c) => deleting.has(c.id) && !channelsGone.has(c.id))) {
			if (channel.isMain && kept.length > 0) {
				const next = pickNewMainChannel([...kept, channel] as never[], channel.id) as unknown as ChannelEntry | null;
				if (next && !next.isMain) {
					const fresh = await readJson<ChannelRecord>(env.channels, next.id, 1);
					if (fresh) await channelRepo.putObject(next.id, { ...fresh, isMain: true, dateModified: new Date().toISOString() } as ChannelRecord);
				}
			}
			await channelRepo.deleteObject(channel.id);
			await releaseHandle(env.channel_tabs, channel.handle, channel.id);
			await env.channel_tabs.delete(`channel-tabs/${channel.id}`);
			// The channel's videos are gone (above) and nothing kept points at it (blockChannelDeletion),
			// so skip the soft-delete scan of videos and playlists (maxObjects 0) and let it remove the
			// channel's posts and sections.
			await removeChannelContent(env, channel.id, 0);
			channelsGone.add(channel.id);
		}
	});
	say(`[cleanup] channels: ${channelsGone.size}/${del('channel').length} deleted`);

	// 6b. Profiles of test accounts: drop the ids of channels that are gone (ChannelDelete does this per channel)
	const stillThere = new Set(del('channel').map((c) => c.id).filter((id) => !channelsGone.has(id)));
	await step('profiles with dead channels', del('profile-ref'), (item) => `profile ${item.id}`, async (item) => {
		const gone = new Set(((item.detail?.channels as string[]) ?? []).filter((id) => !stillThere.has(id)));
		const profile = await readJson<ProfileRecord>(env.profiles, item.id, 1);
		if (!profile?.channels?.some((id) => gone.has(id))) return;
		await profileRepo.putObject(item.id, { ...profile, channels: profile.channels.filter((id) => !gone.has(id)) });
	});

	// 6c. Handles and tab configs of channels that are gone (ChannelDelete's releaseHandle and
	//     tabs delete, for deletes that stopped half-way). Runs after step 6, so the handles of
	//     channels deleted in this run are already released and these keys are the leftovers.
	const channelOf = (i: InventoryItem) => (i.kind === 'tabs' ? i.id.replace('channel-tabs/', '') : (i.parent ?? ''));
	const deadKeys = [...del('handle'), ...del('tabs')].filter((i) => !stillThere.has(channelOf(i)));
	await step('handles and tab configs of deleted channels', deadKeys, (i) => `channel-tabs ${i.id}`, (i) => env.channel_tabs.delete(i.id));

	// 7. Schedule entries of deleted or missing videos
	const planned = new Set(del('video').map((v) => v.id));
	const entries = del('schedule-entry').filter((e) => !planned.has(e.parent ?? '') || videosGone.has(e.parent ?? '')).map((e) => e.id);
	const batches = Array.from({ length: Math.ceil(entries.length / 500) }, (_, i) => entries.slice(i * 500, (i + 1) * 500));
	await step('schedule entry batches', batches, (b) => `schedule entries from ${b[0]}`, (b) => env.SCHEDULED_VIDEOS.delete(b));
	return { failures, ...total };
}

async function main(): Promise<void> {
	const started = Date.now();
	const until = (minutes: number) => started + minutes * 60_000;
	const args = parseArgs(process.argv.slice(2));
	const config = writeQaProxyConfig(args.apiUrl);
	const proxy = await getPlatformProxy<Env>({ configPath: config.path, remoteBindings: true });
	const pending: Promise<unknown>[] = [];
	const env = withSearchSync(proxy.env as unknown as Env, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	try {
		say('[cleanup] listing QA buckets…');
		const { listing, keys } = await listEverything(env, until(DEADLINES_MIN.list));
		const state = parseState(args.state && existsSync(args.state) ? readFileSync(args.state, 'utf8') : null);
		prune(state, listing);
		const toRead = pendingReads(state, listing);
		for (const [store, objects] of Object.entries(listing)) say(`  ${store.padEnd(10)} ${objects.size} listed, ${objects.size - Object.keys(state.stores[store as Store]).length} to read`);
		const read = await readPending(env, state, toRead, until(DEADLINES_MIN.read));
		if (args.state) writeFileSync(args.state, JSON.stringify(state));
		say(`[cleanup] read ${read.done}/${toRead.length} new or changed record(s)${read.failed ? `, ${read.failed} failed` : ''}${read.left + read.failed ? `; ${read.left + read.failed} left for the next run` : ''}`);

		const inv = buildInventory(state, listing, keys, { now: Date.now(), minAgeMs: args.minAgeMs });
		const summary = summarize(inv.items);
		const index = await indexRows(proxy.env.SEARCH_DB, inv.items);
		const unread = read.left + read.failed;
		writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry-run', unread, summary, indexRowsOfDeletedRecords: index, items: inv.items.filter((i) => i.action !== 'keep') }, null, 2));
		say(`[cleanup] inventory: ${args.out}`);
		for (const [kind, counts] of Object.entries(summary)) say(`  ${kind.padEnd(15)} delete ${counts.delete}  keep ${counts.keep}  unsure ${counts.unsure}  wait ${counts.wait}`);
		say(`  index rows of records to delete: ${JSON.stringify(index)}`);
		for (const u of inv.items.filter((i) => i.action === 'unsure')) say(`  unsure ${u.kind} ${u.id} ${JSON.stringify(u.title ?? '')} (${u.owner ?? ''}): ${u.reason}`);
		let result = { failures: [] as string[], planned: 0, done: 0, left: 0 };
		if (!args.apply) {
			say('[cleanup] dry run: nothing changed (pass --apply to delete)');
		} else {
			result = await apply(env, inv, until(DEADLINES_MIN.write));
			await withTimeout(() => Promise.allSettled(pending.splice(0)), WRITE_TIMEOUT_MS).catch(() => say('  some index writes were still running (the daily reconcile repairs them)'));
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
		const stuck = stalled({ toRead: toRead.length, read: read.done, toDelete: result.planned, deleted: result.done });
		if (stuck) {
			say(`[cleanup] no progress: ${stuck}`);
			process.exitCode = 1;
		}
	} finally {
		await withTimeout(() => Promise.allSettled(pending)).catch(() => undefined);
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
