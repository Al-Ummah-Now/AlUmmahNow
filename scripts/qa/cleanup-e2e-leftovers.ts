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
import {
	type Action,
	type ChannelLike,
	type Verdict,
	type VideoLike,
	accountKind,
	applyMinAge,
	assertQaTarget,
	DEFAULT_MIN_AGE_MS,
	blockChannelDeletion,
	classifyChannel,
	classifyPlaylist,
	classifyPost,
	classifyScheduleEntry,
	classifySection,
	classifyVideo,
	junkCommentIds,
	scheduleEntryVideoId,
	staleProfileChannels,
	QA_TARGET,
} from './e2e-leftovers.ts';
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
const WRITE_CONCURRENCY = 4;
const R2_BINDINGS = ['videos', 'channels', 'playlists', 'community_posts', 'channel_sections', 'channel_tabs', 'profiles', 'SCHEDULED_VIDEOS'] as const;

type Env = Record<(typeof R2_BINDINGS)[number], R2Bucket> & { SEARCH_DB: D1Database };

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

/** The remote-binding proxy now and then fails a call with "internal error"; retry those. */
async function retry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i >= attempts) throw error;
			await new Promise((r) => setTimeout(r, 500 * 2 ** i));
		}
	}
}

async function listKeys(bucket: R2Bucket, prefix?: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await retry(() => bucket.list({ prefix, cursor, limit: 1000 }));
		keys.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return keys;
}

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

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const text = await retry(async () => (await bucket.get(key))?.text() ?? null);
	if (text === null) return null;
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

interface VideoRecord extends VideoLike {
	isPublic?: boolean;
	isDeleted?: boolean;
	uploadStatus?: string;
	scheduledPublishStatus?: string;
	scheduledPublishDate?: string;
	dateCreated?: string;
	comments?: CommentRecord[];
}
type CommentRecord = StoredComment & { text?: string; dateCreated?: string };
interface ChannelRecord extends ChannelLike {
	handle?: string;
	dateCreated?: string;
	isDeleted?: boolean;
}
interface ProfileRecord {
	id: string;
	email?: string;
	channels?: string[];
}
interface PostRecord {
	id: string;
	channelId: string;
	content?: string;
	status?: string;
	userId?: string;
	createdAt?: string;
}

export interface InventoryItem {
	kind: 'video' | 'comment' | 'channel' | 'playlist' | 'post' | 'post-comment' | 'section' | 'schedule-entry' | 'profile-ref';
	id: string;
	title?: string;
	owner?: string;
	parent?: string;
	action: Action;
	reason: string;
	detail?: Record<string, unknown>;
}

/** Owner label for the inventory: test accounts by address, anyone else only by kind. */
function ownerLabel(email: string | undefined, userId: string | undefined): string {
	const kind = accountKind(email);
	if (kind === 'other') return `non-test account ${userId ?? ''}`.trim();
	return email ?? `unknown (${userId ?? 'no user id'})`;
}

async function buildInventory(env: Env, minAgeMs: number) {
	const now = Date.now();
	say('[cleanup] reading QA buckets…');
	const videoKeys = await listKeys(env.videos);
	const channelKeys = await listKeys(env.channels);
	const playlistKeys = await listKeys(env.playlists);
	const postKeys = await listKeys(env.community_posts);
	const sectionKeys = await listKeys(env.channel_sections);
	const scheduleKeys = await listKeys(env.SCHEDULED_VIDEOS);
	const profileKeys = await listKeys(env.profiles);
	const videos = (await mapLimit(videoKeys.filter((k) => !k.includes(':') && !k.includes('/')), READ_CONCURRENCY, (k) => readJson<VideoRecord>(env.videos, k)))
		.filter((v): v is VideoRecord => !!v?.id);
	const channels = (await mapLimit(channelKeys.filter((k) => !k.includes('/')), READ_CONCURRENCY, (k) => readJson<ChannelRecord>(env.channels, k)))
		.filter((c): c is ChannelRecord => !!c?.id);
	const playlists = (await mapLimit(playlistKeys.filter((k) => !k.startsWith('watch-later-')), READ_CONCURRENCY, (k) => readJson<{ id: string; title?: string; channelId?: string; userId?: string }>(env.playlists, k)))
		.filter((p): p is { id: string; title?: string; channelId?: string; userId?: string } => !!p?.id);
	const postObjectKeys = postKeys.filter((k) => /^posts\/[^/]+\/[^/]+\.json$/.test(k) && !k.endsWith('/index.json'));
	const posts = (await mapLimit(postObjectKeys, READ_CONCURRENCY, (k) => readJson<PostRecord>(env.community_posts, k))).filter((p): p is PostRecord => !!p?.id);
	const sections = await mapLimit(sectionKeys, 8, async (k) => ({ key: k, record: await readJson<{ title?: string }>(env.channel_sections, k) }));
	const profiles = (await mapLimit(profileKeys.filter((k) => !k.includes('/')), READ_CONCURRENCY, (k) => readJson<ProfileRecord>(env.profiles, k)))
		.filter((p): p is ProfileRecord => !!p?.id);
	say(`[cleanup] read ${videos.length} videos, ${channels.length} channels, ${playlists.length} playlists, ${posts.length} posts, ${sections.length} sections, ${scheduleKeys.length} schedule entries, ${profiles.length} profiles`);

	// Owner address of a user id: from the profile, else from one of the user's channels
	const emailByUser = new Map<string, string>();
	for (const p of profiles) if (p.email) emailByUser.set(p.id, p.email);
	for (const c of channels) if (c.userId && c.email && !emailByUser.has(c.userId)) emailByUser.set(c.userId, c.email);
	const ownerEmail = (userId: string | undefined) => (userId ? emailByUser.get(userId) : undefined);

	const items: InventoryItem[] = [];
	const videoAction = new Map<string, Action>();
	for (const v of videos) {
		const verdict = applyMinAge(classifyVideo(v, ownerEmail), v.dateCreated, now, minAgeMs);
		videoAction.set(v.id, verdict.action);
		items.push({
			kind: 'video', id: v.id, title: v.title, owner: ownerLabel(ownerEmail(v.userId), v.userId), parent: v.channelId, ...verdict,
			detail: { isPublic: v.isPublic ?? null, isDeleted: v.isDeleted ?? false, uploadStatus: v.uploadStatus ?? null, created: v.dateCreated ?? null },
		});
		if (verdict.action !== 'delete') {
			for (const cid of junkCommentIds(v)) {
				const c = findComment(v.comments, cid);
				const cv = applyMinAge({ action: 'delete', reason: 'test probe comment' }, c?.dateCreated, now, minAgeMs);
				items.push({ kind: 'comment', id: cid, title: c?.text, owner: ownerLabel(ownerEmail(c?.userId), c?.userId), parent: v.id, ...cv });
			}
		}
	}

	const remainingByChannel = new Map<string, Action[]>();
	for (const v of videos) {
		if (!v.channelId) continue;
		remainingByChannel.set(v.channelId, [...(remainingByChannel.get(v.channelId) ?? []), videoAction.get(v.id) ?? 'keep']);
	}
	const channelAction = new Map<string, Action>();
	for (const c of channels) {
		const verdict: Verdict = blockChannelDeletion(applyMinAge(classifyChannel(c), c.dateCreated, now, minAgeMs), remainingByChannel.get(c.id) ?? []);
		channelAction.set(c.id, verdict.action);
		items.push({ kind: 'channel', id: c.id, title: c.name, owner: ownerLabel(c.email, c.userId), ...verdict, detail: { isMain: c.isMain ?? false, handle: c.handle ?? null } });
	}
	for (const p of playlists) {
		items.push({ kind: 'playlist', id: p.id, title: p.title, owner: ownerLabel(ownerEmail(p.userId), p.userId), parent: p.channelId, ...classifyPlaylist(p, p.channelId ? channelAction.get(p.channelId) : undefined) });
	}
	const deletedPosts = new Set<string>();
	for (const p of posts) {
		const verdict = applyMinAge(classifyPost(p.content, channelAction.get(p.channelId)), p.createdAt, now, minAgeMs);
		if (verdict.action === 'delete') deletedPosts.add(p.id);
		items.push({ kind: 'post', id: p.id, title: p.content?.slice(0, 120), owner: ownerLabel(ownerEmail(p.userId), p.userId), parent: p.channelId, ...verdict, detail: { status: p.status ?? null } });
	}
	for (const k of postKeys) {
		const m = /^comments\/([^/]+)\//.exec(k);
		if (m && deletedPosts.has(m[1])) items.push({ kind: 'post-comment', id: k, parent: m[1], action: 'delete', reason: 'comment object of a deleted post' });
	}
	for (const s of sections) {
		const channelId = s.key.split('/')[0];
		items.push({ kind: 'section', id: s.key, title: s.record?.title, parent: channelId, ...classifySection(s.record?.title, channelAction.get(channelId)) });
	}
	for (const k of scheduleKeys) {
		const vid = scheduleEntryVideoId(k);
		const verdict = classifyScheduleEntry(k, vid ? (videoAction.get(vid) ?? 'missing') : 'keep');
		items.push({ kind: 'schedule-entry', id: k, parent: vid ?? undefined, ...verdict });
	}
	const existingChannels = new Set(channels.map((c) => c.id));
	const deletingChannels = new Set(channels.filter((c) => channelAction.get(c.id) === 'delete').map((c) => c.id));
	for (const p of profiles) {
		const stale = staleProfileChannels(p, existingChannels, deletingChannels);
		if (stale.length > 0) {
			items.push({ kind: 'profile-ref', id: p.id, owner: p.email, action: 'delete', reason: 'profile lists channels that are deleted', detail: { channels: stale } });
		}
	}
	return { items, videos, channels, posts };
}

function findComment(list: CommentRecord[] | undefined, id: string): CommentRecord | undefined {
	for (const c of list ?? []) {
		if (c.id === id) return c;
		const r = findComment(c.replies as CommentRecord[] | undefined, id);
		if (r) return r;
	}
	return undefined;
}

function summarize(items: InventoryItem[]): Record<string, Record<Action, number>> {
	const out: Record<string, Record<Action, number>> = {};
	for (const i of items) {
		out[i.kind] ??= { delete: 0, keep: 0, unsure: 0 };
		out[i.kind][i.action]++;
	}
	return out;
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

async function apply(env: Env, inv: Awaited<ReturnType<typeof buildInventory>>, items: InventoryItem[]) {
	const del = (kind: InventoryItem['kind']) => items.filter((i) => i.kind === kind && i.action === 'delete');
	const videoRepo = new R2Repository<VideoRecord>(env.videos);
	const failures: string[] = [];
	// Every step is idempotent (deletes, or writes recomputed from a fresh read), so retry it
	const guard = async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
		try {
			await retry(fn);
			return true;
		} catch (error) {
			failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}
	};
	const count = (results: boolean[]) => results.filter(Boolean).length;

	// 1. Probe comments on kept videos (CommentDelete: removeStoredComment, then one write per video)
	const commentsByVideo = new Map<string, string[]>();
	for (const c of del('comment')) commentsByVideo.set(c.parent!, [...(commentsByVideo.get(c.parent!) ?? []), c.id]);
	const commentVideosDone = count(await mapLimit([...commentsByVideo], WRITE_CONCURRENCY, ([videoId, ids]) => guard(`comments of ${videoId}`, async () => {
		const video = await readJson<VideoRecord>(env.videos, videoId);
		if (!video) return;
		let comments = (video.comments ?? []) as StoredComment[];
		for (const id of ids) comments = removeStoredComment(comments, id).comments;
		await videoRepo.putObject(videoId, { ...video, comments });
	})));
	say(`[cleanup] removed the probe comments from ${commentVideosDone}/${commentsByVideo.size} video(s) (${del('comment').length} comment(s))`);

	// 2. Videos (VideoBulkDelete). Their schedule entries go in step 7.
	const videosDone = count(await mapLimit(del('video'), WRITE_CONCURRENCY, (item) => guard(`video ${item.id}`, () => videoRepo.deleteObject(item.id))));
	say(`[cleanup] deleted ${videosDone}/${del('video').length} video record(s)`);

	// 3. Community posts: the post object is removed outright (as removeChannelContent does; the
	//    DeleteCommunityPost endpoint only marks it deleted, which is what left ~2,000 records
	//    behind), its id leaves the channel post index (DeleteCommunityPost), then the comment
	//    objects of those posts go too.
	const postsByChannel = new Map<string, string[]>();
	for (const p of del('post')) postsByChannel.set(p.parent!, [...(postsByChannel.get(p.parent!) ?? []), p.id]);
	const postsDone = count(await mapLimit(del('post'), WRITE_CONCURRENCY, (p) => guard(`post ${p.id}`, () => env.community_posts.delete(`posts/${p.parent}/${p.id}.json`))));
	type PostIndex = { postIds: string[]; lastUpdated: string };
	const postIndexRepo = new R2Repository<PostIndex>(env.community_posts);
	await mapLimit([...postsByChannel], WRITE_CONCURRENCY, ([channelId, ids]) => guard(`post index of ${channelId}`, async () => {
		const gone = new Set(ids);
		await postIndexRepo.updateObject(`posts/${channelId}/index.json`, (index) => {
			if (!index.postIds?.some((id) => gone.has(id))) return false;
			index.postIds = index.postIds.filter((id) => !gone.has(id));
			index.lastUpdated = new Date().toISOString();
			return true;
		});
	}));
	const commentKeys = del('post-comment').map((c) => c.id);
	let postCommentsDone = 0;
	for (let i = 0; i < commentKeys.length; i += 500) {
		const batch = commentKeys.slice(i, i + 500);
		if (await guard(`post comments batch ${i}`, () => env.community_posts.delete(batch))) postCommentsDone += batch.length;
	}
	say(`[cleanup] deleted ${postsDone}/${del('post').length} post(s) and ${postCommentsDone}/${commentKeys.length} post comment object(s)`);

	// 4. Sections of kept channels (ChannelSectionDelete); deleted channels lose theirs in step 6
	for (const s of del('section')) await guard(`section ${s.id}`, () => env.channel_sections.delete(s.id));

	// 5. Playlists (PlaylistDelete)
	const playlistRepo = new R2Repository<unknown>(env.playlists);
	for (const p of del('playlist')) await guard(`playlist ${p.id}`, () => playlistRepo.deleteObject(p.id));

	// 6. Channels (ChannelDelete), one owner at a time so main-channel updates never race.
	//    The owner's profile is updated afterwards, once (step 6b).
	const channelRepo = new R2Repository<ChannelRecord>(env.channels);
	const profileRepo = new R2Repository<ProfileRecord>(env.profiles);
	const deleting = new Set(del('channel').map((c) => c.id));
	const byOwner = new Map<string, ChannelRecord[]>();
	for (const c of inv.channels) if (c.userId) byOwner.set(c.userId, [...(byOwner.get(c.userId) ?? []), c]);
	const owners = [...byOwner].filter(([, list]) => list.some((c) => deleting.has(c.id)));
	let channelsDone = 0;
	await mapLimit(owners, WRITE_CONCURRENCY, async ([, owned]) => {
		const kept = owned.filter((c) => !deleting.has(c.id));
		for (const channel of owned.filter((c) => deleting.has(c.id))) {
			if (await guard(`channel ${channel.id}`, async () => {
				if (channel.isMain && kept.length > 0) {
					const next = pickNewMainChannel([...kept, channel] as never[], channel.id) as ChannelRecord | null;
					if (next && !next.isMain) {
						const fresh = await readJson<ChannelRecord>(env.channels, next.id);
						if (fresh) await channelRepo.putObject(next.id, { ...fresh, isMain: true, dateModified: new Date().toISOString() } as ChannelRecord);
					}
				}
				await channelRepo.deleteObject(channel.id);
				await releaseHandle(env.channel_tabs, channel.handle, channel.id);
				await env.channel_tabs.delete(`channel-tabs/${channel.id}`);
				// The channel's videos were hard-deleted in step 2 and nothing kept points at it
				// (blockChannelDeletion), so skip the soft-delete scan of videos and playlists
				// (maxObjects 0) and let it remove the channel's posts and sections.
				await removeChannelContent(env, channel.id, 0);
			})) channelsDone++;
		}
	});
	say(`[cleanup] deleted ${channelsDone}/${deleting.size} channel(s)`);

	// 6b. Profiles of test accounts: drop the ids of deleted channels (ChannelDelete does this per channel)
	const refsDone = count(await mapLimit(del('profile-ref'), WRITE_CONCURRENCY, (item) => guard(`profile ${item.id}`, async () => {
		const gone = new Set((item.detail?.channels as string[]) ?? []);
		const profile = await readJson<ProfileRecord>(env.profiles, item.id);
		if (!profile?.channels?.some((id) => gone.has(id))) return;
		await profileRepo.putObject(item.id, { ...profile, channels: profile.channels.filter((id) => !gone.has(id)) });
	})));
	say(`[cleanup] updated ${refsDone}/${del('profile-ref').length} profile(s)`);

	// 7. Schedule entries of deleted or missing videos
	const entries = del('schedule-entry').map((e) => e.id);
	let entriesDone = 0;
	for (let i = 0; i < entries.length; i += 500) {
		const batch = entries.slice(i, i + 500);
		if (await guard(`schedule batch ${i}`, () => env.SCHEDULED_VIDEOS.delete(batch))) entriesDone += batch.length;
	}
	say(`[cleanup] deleted ${entriesDone}/${entries.length} schedule entries`);
	return failures;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const config = writeQaProxyConfig(args.apiUrl);
	const proxy = await getPlatformProxy<Env>({ configPath: config.path, remoteBindings: true });
	const pending: Promise<unknown>[] = [];
	const env = withSearchSync(proxy.env as unknown as Env, { waitUntil: (p: Promise<unknown>) => void pending.push(p) });
	try {
		const inv = await buildInventory(env, args.minAgeMs);
		const summary = summarize(inv.items);
		const index = await indexRows(proxy.env.SEARCH_DB, inv.items);
		writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry-run', summary, indexRowsOfDeletedRecords: index, items: inv.items }, null, 2));
		say(`[cleanup] inventory: ${args.out}`);
		for (const [kind, counts] of Object.entries(summary)) say(`  ${kind.padEnd(15)} delete ${counts.delete}  keep ${counts.keep}  unsure ${counts.unsure}`);
		say(`  index rows of records to delete: ${JSON.stringify(index)}`);
		for (const u of inv.items.filter((i) => i.action === 'unsure')) say(`  unsure ${u.kind} ${u.id} ${JSON.stringify(u.title ?? '')} (${u.owner ?? ''}): ${u.reason}`);
		if (!args.apply) {
			say('[cleanup] dry run: nothing changed (pass --apply to delete)');
			return;
		}
		const failures = await apply(env, inv, inv.items);
		await Promise.allSettled(pending.splice(0));
		const after = await indexRows(proxy.env.SEARCH_DB, inv.items);
		say(`[cleanup] index rows of deleted records left: ${JSON.stringify(after)}`);
		if (args.reconcile) {
			say('[cleanup] running the search and ownership reconcile passes…');
			try {
				say(`  search: ${JSON.stringify(await reconcileSearchIndex(proxy.env as never, { pagesPerEntity: 100 }))}`);
				say(`  ownership: ${JSON.stringify(await reconcileOwnershipIndex(proxy.env as never, { pagesPerKind: 100 }))}`);
			} catch (error) {
				// The daily cron finishes the pass; a re-run of --apply --reconcile resumes it too
				say(`  reconcile stopped: ${error instanceof Error ? error.message : String(error)}`);
				process.exitCode = 1;
			}
		}
		if (failures.length > 0) {
			for (const f of failures) say(`  failed: ${f}`);
			process.exitCode = 1;
		}
	} finally {
		await Promise.allSettled(pending);
		await proxy.dispose();
		config.dispose();
	}
}

if (require.main === module) {
	main().catch((error) => {
		process.stderr.write(`[cleanup] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
