/**
 * The discovery ranking run (wiki E07 "Discovery ranking"): admin job
 * 'discovery.rank' on the admin-jobs queue (retry with backoff, DLQ, "failed —
 * Retry" in the videos admin, an Errors page item when it gives up).
 *
 * The hourly cron queues one (scheduleDiscoveryRank); an admin can run one now
 * (videos admin → Discovery). A run:
 *   1. reads every listed video from the search index (SEARCH_DB.search_videos,
 *      narrow columns, keyset pages by rowid: the whole library, no cap);
 *   2. reads qualified engagement: unique viewers per day (NOTIFICATIONS_DB
 *      discovery_viewers, written by the processor for views that may count),
 *      likes per day (liked_videos), comment authors per day (channel_comments,
 *      the video owner left out);
 *   3. builds every rail (./rank.ts) and rewrites only the rails whose content
 *      changed (discovery_rail_items, discovery_rails), so an idle library costs
 *      reads and almost no writes;
 *   4. trims viewer rows older than the longest window and keeps a run summary
 *      in search_meta ('discovery:last-run') for the admin.
 */
import { reportNeedsAction, resolveNeedsAction, type AdminJob, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { createJob, listJobs, type JobEnv, type JobOutcome } from '../admin/jobs';
import { logger } from '../logger';
import { SALT_KEY_PREFIX } from './viewer';
import {
	DAY_MS,
	POPULAR_PARAMS,
	buildFeatured,
	buildNew,
	buildPopular,
	buildTop,
	buildTrending,
	railHash,
	type BuildOptions,
	type Engagement,
	type EngagementDay,
	type Pin,
	type Rail,
	type RankInputs,
	type RankVideo,
} from './rank';

export const DISCOVERY_RANK_JOB = 'discovery.rank' as const;
/** Job target: one ranking for the whole site. */
export const DISCOVERY_TARGET = { kind: 'video', id: 'discovery-rails' } as const;
export const LAST_RUN_KEY = 'discovery:last-run';

/** Items kept per rail: home rails and their "see all" pages, and per category. */
export const RAIL_LIMIT = 240;
export const CATEGORY_RAIL_LIMIT = 120;
/** Rows per page when reading the index. */
export const READ_PAGE = 2000;
/** A scheduled run is skipped when the last one finished less than this long ago. */
export const MIN_RUN_INTERVAL_MS = 50 * 60 * 1000;

/** Languages that get their own (boosted) rails; everything else uses the unscoped one. */
export const RAIL_LANGUAGES = ['ar', 'en'] as const;

/** Rails the job writes; endpoints ask for these. */
export const RAIL_IDS = ['trending:day', 'trending:week', 'trending:month', 'popular', 'new', 'featured', 'top'] as const;
export type RailId = (typeof RAIL_IDS)[number];
/** Rails also built per category. */
export const CATEGORY_RAILS: readonly RailId[] = ['top', 'new', 'trending:week'];
/** Rails also built for one content language only (Explore's language filter on /api/trending) */
export const ONLY_LANGUAGE_RAILS: readonly RailId[] = ['trending:day', 'trending:week', 'trending:month'];

/** Admin pin targets (discovery_pins.rail) → the rails they apply to. */
export const PIN_RAILS = ['featured', 'trending', 'popular', 'new', 'explore'] as const;

/** Accounts whose uploads never rank: E2E run accounts and production throwaways (seedOwners: the exception). */
const TEST_OWNER = /(@e2e\.alummahnow\.net|@delivered\.resend\.dev)$/i;

export function isTestOwnerEmail(email: unknown): boolean {
	return typeof email === 'string' && TEST_OWNER.test(email.trim());
}

/**
 * The seed accounts whose videos rank anyway: exact addresses in RANK_SEED_OWNERS (QA and stage, whose
 * whole public library belongs to the seed's creator; without them every rail there is empty).
 * Empty, and refused, in production.
 */
export function seedOwners(env: Pick<DiscoveryEnv, 'ENVIRONMENT' | 'RANK_SEED_OWNERS'>): ReadonlySet<string> {
	if ((env.ENVIRONMENT ?? '').toLowerCase() === 'production') return new Set();
	const listed = (env.RANK_SEED_OWNERS ?? '').split(',').map((email) => email.trim().toLowerCase());
	// An address, never a domain or a pattern
	return new Set(listed.filter((email) => /^[^\s@*]+@[^\s@*]+$/.test(email)));
}

/** Whether videos of this owner stay off every rail. */
const neverRanks = (email: unknown, seeds: ReadonlySet<string>): boolean =>
	isTestOwnerEmail(email) && !seeds.has(String(email).trim().toLowerCase());

interface Statement {
	bind(...values: unknown[]): Statement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
	run(): Promise<unknown>;
}
interface Db {
	prepare(sql: string): Statement;
	batch(statements: Statement[]): Promise<unknown[]>;
}

export interface DiscoveryEnv extends JobEnv {
	NOTIFICATIONS_DB?: unknown;
	ENVIRONMENT?: string;
	/** Exact seed addresses whose videos rank outside production (seedOwners) */
	RANK_SEED_OWNERS?: string;
}

const db = (env: DiscoveryEnv) => env.SEARCH_DB as unknown as Db | undefined;
const counters = (env: DiscoveryEnv) => env.NOTIFICATIONS_DB as Db | undefined;

interface VideoRow {
	rid: number;
	id: string;
	channel_id: string | null;
	category: string | null;
	language: string | null;
	is_short: number;
	is_live: number;
	duration: number | null;
	created_at: number | null;
	added_at: string | null;
	thumb: number;
	t_ar: number;
	t_en: number;
	has_desc: number;
	captions: number;
	verified: number;
	owner_email: string | null;
	excluded: number;
}

const VIDEO_SQL = `SELECT v.rowid AS rid, v.id, v.channel_id, v.category, v.language, v.is_short, v.is_live, v.duration, v.created_at,
  json_extract(v.payload, '$.addedAt') AS added_at,
  (coalesce(json_extract(v.payload, '$.thumbnailUrl'), '') <> '') AS thumb,
  (json_extract(v.payload, '$.titleLocalized.ar') IS NOT NULL) AS t_ar,
  (json_extract(v.payload, '$.titleLocalized.en') IS NOT NULL) AS t_en,
  (coalesce(json_extract(v.payload, '$.description'), '') <> '') AS has_desc,
  coalesce(json_extract(v.payload, '$.hasCaptions'), 0) AS captions,
  coalesce(c.is_verified, 0) AS verified,
  u.email AS owner_email,
  (EXISTS (SELECT 1 FROM discovery_exclusions x WHERE (x.kind = 'video' AND x.target_id = v.id) OR (x.kind = 'channel' AND x.target_id = v.channel_id))) AS excluded
FROM search_videos v
LEFT JOIN search_channels c ON c.id = v.channel_id
LEFT JOIN content_ownership o ON o.kind = 'video' AND o.id = v.id
LEFT JOIN content_ownership u ON u.kind = 'profile' AND u.id = o.owner_id
WHERE v.visible = 1 AND v.rowid > ?
ORDER BY v.rowid
LIMIT ?`;

function timeOf(value: string | number | null | undefined): number | null {
	if (value === null || value === undefined || value === '') return null;
	const t = typeof value === 'number' ? value : Date.parse(value);
	return Number.isFinite(t) ? t : null;
}

/** Pure: one index row → the ranking's view of the video. */
export function toRankVideo(row: VideoRow, seeds: ReadonlySet<string> = new Set()): RankVideo {
	const publishedAt = timeOf(row.created_at);
	const language = row.language || null;
	// Both site languages: the title itself is in `language`, titleLocalized adds others
	const hasAr = row.t_ar === 1 || language === 'ar';
	const hasEn = row.t_en === 1 || language === 'en';
	return {
		id: row.id,
		channelId: row.channel_id || null,
		category: row.category || null,
		language,
		isShort: row.is_short === 1,
		isLive: row.is_live === 1,
		duration: Number(row.duration) || 0,
		addedAt: timeOf(row.added_at) ?? publishedAt,
		publishedAt,
		hasThumbnail: row.thumb === 1,
		bilingualTitle: hasAr && hasEn,
		hasDescription: row.has_desc === 1,
		hasCaptions: row.captions === 1 || row.captions === (true as unknown as number),
		channelVerified: row.verified === 1,
		excluded: row.excluded === 1 || neverRanks(row.owner_email, seeds),
	};
}

/** Every listed video, in keyset pages (no cap). */
export async function loadRankVideos(database: Db, seeds: ReadonlySet<string> = new Set(), pageSize = READ_PAGE): Promise<RankVideo[]> {
	const out: RankVideo[] = [];
	let after = 0;
	for (;;) {
		const { results = [] } = await database.prepare(VIDEO_SQL).bind(after, pageSize).all<VideoRow>();
		for (const row of results) out.push(toRankVideo(row, seeds));
		if (results.length < pageSize) break;
		after = Number(results[results.length - 1].rid);
	}
	return out;
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const ageOf = (day: string, now: number) => Math.max(0, Math.round((Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS));

/**
 * Qualified engagement per video over the popular window (the longest), as
 * days with an age. Views: unique qualified viewers (processor). Likes: one
 * per member. Comments: distinct authors, the video's owner left out.
 */
export async function loadEngagement(env: DiscoveryEnv, now: number): Promise<Map<string, Engagement>> {
	const since = now - POPULAR_PARAMS.days * DAY_MS;
	const sinceDay = utcDay(since);
	const byVideo = new Map<string, Map<number, EngagementDay>>();
	const bump = (videoId: string, age: number, field: 'viewers' | 'likes' | 'comments', n: number) => {
		let days = byVideo.get(videoId);
		if (!days) byVideo.set(videoId, (days = new Map()));
		let day = days.get(age);
		if (!day) days.set(age, (day = { age, viewers: 0, likes: 0, comments: 0 }));
		day[field] += Number(n) || 0;
	};
	const notif = counters(env);
	if (notif) {
		const viewers = await notif
			.prepare('SELECT video_id, day, COUNT(*) AS n FROM discovery_viewers WHERE day >= ? GROUP BY video_id, day')
			.bind(sinceDay)
			.all<{ video_id: string; day: string; n: number }>();
		for (const r of viewers.results ?? []) bump(r.video_id, ageOf(r.day, now), 'viewers', r.n);
		const likes = await notif
			.prepare(`SELECT video_id, date(liked_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM liked_videos WHERE liked_at >= ? GROUP BY video_id, day`)
			.bind(since)
			.all<{ video_id: string; day: string; n: number }>();
		for (const r of likes.results ?? []) bump(r.video_id, ageOf(r.day, now), 'likes', r.n);
	}
	const search = db(env);
	if (search) {
		const comments = await search
			.prepare(
				`SELECT cc.target_id AS video_id, substr(cc.created_at, 1, 10) AS day, COUNT(DISTINCT cc.author_user_id) AS n
				 FROM channel_comments cc
				 LEFT JOIN content_ownership o ON o.kind = 'video' AND o.id = cc.target_id
				 WHERE cc.target_kind = 'video' AND cc.status = 'published' AND cc.created_at >= ?
				   AND cc.author_user_id <> coalesce(o.owner_id, '')
				 GROUP BY cc.target_id, day`,
			)
			.bind(new Date(since).toISOString())
			.all<{ video_id: string; day: string; n: number }>();
		for (const r of comments.results ?? []) bump(r.video_id, ageOf(r.day, now), 'comments', r.n);
	}
	return new Map([...byVideo].map(([id, days]) => [id, [...days.values()]]));
}

export interface PinRow {
	rail: string;
	kind: 'video' | 'channel';
	target_id: string;
	position: number;
}

/** Active pins (inside their start/end window). */
export async function loadPins(database: Db, now: number): Promise<PinRow[]> {
	const { results = [] } = await database
		.prepare('SELECT rail, kind, target_id, position FROM discovery_pins WHERE (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?) ORDER BY rail, position, created_at')
		.bind(now, now)
		.all<PinRow>();
	return results;
}

/** Pure: the pins of one built rail (rail id + category scope). */
export function pinsFor(pins: readonly PinRow[], rail: RailId, category: string | null): Pin[] {
	const target = category ? `category:${category}` : rail === 'top' ? 'explore' : rail.startsWith('trending') ? 'trending' : rail;
	// A category's pins apply to its top and new lists, not to its trending list
	if (category && rail === 'trending:week') return [];
	return pins.filter((p) => p.rail === target).map((p) => ({ kind: p.kind, targetId: p.target_id, position: Number(p.position) || 1 }));
}

export interface BuiltRail {
	rail: RailId;
	scope: string;
	result: Rail;
}

function build(inputs: RankInputs, rail: RailId, options: BuildOptions): Rail {
	switch (rail) {
		case 'trending:day':
			return buildTrending(inputs, 'day', options);
		case 'trending:week':
			return buildTrending(inputs, 'week', options);
		case 'trending:month':
			return buildTrending(inputs, 'month', options);
		case 'popular':
			return buildPopular(inputs, options);
		case 'new':
			return buildNew(inputs, options);
		case 'featured':
			return buildFeatured(inputs, options);
		case 'top':
			return buildTop(inputs, options);
	}
}

/**
 * Pure: every rail of a run. Unscoped and per language for each rail id,
 * per category for CATEGORY_RAILS. Shorts stay out (they have their own shelf).
 */
export function buildAllRails(inputs: RankInputs, pins: readonly PinRow[]): BuiltRail[] {
	const out: BuiltRail[] = [];
	for (const rail of RAIL_IDS) {
		const base = { limit: RAIL_LIMIT, excludeShorts: true, pins: pinsFor(pins, rail, null) };
		out.push({ rail, scope: '', result: build(inputs, rail, base) });
		for (const language of RAIL_LANGUAGES) out.push({ rail, scope: `lang:${language}`, result: build(inputs, rail, { ...base, language }) });
	}
	// Explore's content-language filter: Trending of one language only (scope 'only:<lang>')
	for (const rail of ONLY_LANGUAGE_RAILS) {
		for (const language of RAIL_LANGUAGES) {
			out.push({ rail, scope: `only:${language}`, result: build(inputs, rail, { limit: CATEGORY_RAIL_LIMIT, excludeShorts: true, onlyLanguage: language, language, pins: pinsFor(pins, rail, null) }) });
		}
	}
	const categories = [...new Set(inputs.videos.map((v) => v.category).filter((c): c is string => !!c))].sort();
	for (const category of categories) {
		for (const rail of CATEGORY_RAILS) {
			out.push({ rail, scope: `cat:${category}`, result: build(inputs, rail, { limit: CATEGORY_RAIL_LIMIT, excludeShorts: true, category, pins: pinsFor(pins, rail, category) }) });
		}
	}
	return out;
}

/** Rows per bulk insert statement (one JSON parameter). */
const INSERT_CHUNK = 250;

export interface WriteResult {
	written: number;
	unchanged: number;
	removed: number;
}

/** Rewrite only rails whose content changed; drop rails no longer built (a category emptied). */
export async function writeRails(database: Db, rails: readonly BuiltRail[], now: number): Promise<WriteResult> {
	const { results: existing = [] } = await database.prepare('SELECT rail, scope, hash FROM discovery_rails').all<{ rail: string; scope: string; hash: string }>();
	const stored = new Map(existing.map((r) => [`${r.rail}\u0000${r.scope}`, r.hash]));
	const seen = new Set<string>();
	let written = 0;
	let unchanged = 0;
	for (const { rail, scope, result } of rails) {
		const key = `${rail}\u0000${scope}`;
		seen.add(key);
		const hash = railHash(result);
		if (stored.get(key) === hash) {
			unchanged += 1;
			continue;
		}
		const statements: Statement[] = [database.prepare('DELETE FROM discovery_rail_items WHERE rail = ? AND scope = ?').bind(rail, scope)];
		for (let i = 0; i < result.items.length; i += INSERT_CHUNK) {
			const rows = result.items.slice(i, i + INSERT_CHUNK).map((item, j) => [i + j + 1, item.id, item.score, item.reason]);
			statements.push(
				database
					.prepare(
						`INSERT INTO discovery_rail_items (rail, scope, position, video_id, score, reason)
						 SELECT ?, ?, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]')
						 FROM json_each(?) AS j`,
					)
					.bind(rail, scope, JSON.stringify(rows)),
			);
		}
		statements.push(
			database
				.prepare(
					`INSERT INTO discovery_rails (rail, scope, mode, label, items, signal_items, hash, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT (rail, scope) DO UPDATE SET mode = excluded.mode, label = excluded.label, items = excluded.items,
					   signal_items = excluded.signal_items, hash = excluded.hash, computed_at = excluded.computed_at`,
				)
				.bind(rail, scope, result.mode, result.label, result.items.length, result.signalItems, hash, now),
		);
		await database.batch(statements);
		written += 1;
	}
	let removed = 0;
	for (const r of existing) {
		if (seen.has(`${r.rail}\u0000${r.scope}`)) continue;
		await database.batch([
			database.prepare('DELETE FROM discovery_rail_items WHERE rail = ? AND scope = ?').bind(r.rail, r.scope),
			database.prepare('DELETE FROM discovery_rails WHERE rail = ? AND scope = ?').bind(r.rail, r.scope),
		]);
		removed += 1;
	}
	return { written, unchanged, removed };
}

export interface RunSummary {
	at: string;
	videos: number;
	eligible: number;
	excluded: number;
	engaged: number;
	rails: number;
	written: number;
	unchanged: number;
	removed: number;
	/** Mode of the main home rails right now (cold start shows 'new' / 'featured') */
	modes: Record<string, string>;
	ms: number;
}

/** One full ranking run. Throws on failure (the job is retried with backoff). */
export async function runDiscoveryRank(env: DiscoveryEnv, now = Date.now()): Promise<RunSummary> {
	const database = db(env);
	if (!database) throw new Error('SEARCH_DB is not bound');
	const started = Date.now();
	const [videos, engagement, pins] = await Promise.all([loadRankVideos(database, seedOwners(env)), loadEngagement(env, now), loadPins(database, now)]);
	const featuredChannels = new Set(pins.filter((p) => p.kind === 'channel').map((p) => p.target_id));
	const inputs: RankInputs = { videos, engagement, ctx: { now, featuredChannels } };
	const rails = buildAllRails(inputs, pins);
	const result = await writeRails(database, rails, now);

	// Viewer rows beyond the longest window are no longer needed (they hold a salted hash per day)
	const notif = counters(env);
	if (notif) {
		await notif.prepare('DELETE FROM discovery_viewers WHERE day < ?').bind(utcDay(now - (POPULAR_PARAMS.days + 1) * DAY_MS)).run();
	}
	// Yesterday's salt is kept for views that straddle midnight; older ones go, so no old hash can be rebuilt
	await database
		.prepare('DELETE FROM search_meta WHERE key >= ? AND key < ?')
		.bind(SALT_KEY_PREFIX, `${SALT_KEY_PREFIX}${utcDay(now - DAY_MS)}`)
		.run();

	const modes: Record<string, string> = {};
	for (const r of rails) if (r.scope === '') modes[r.rail] = `${r.result.mode}:${r.result.label}`;
	const summary: RunSummary = {
		at: new Date(now).toISOString(),
		videos: videos.length,
		eligible: videos.filter((v) => !v.excluded && v.hasThumbnail && v.duration > 0 && !v.isLive).length,
		excluded: videos.filter((v) => v.excluded).length,
		engaged: engagement.size,
		rails: rails.length,
		...result,
		modes,
		ms: Date.now() - started,
	};
	await database
		.prepare('INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
		.bind(LAST_RUN_KEY, JSON.stringify(summary), now)
		.run();
	logger.info('[Discovery] Ranking run', { ...summary, modes: undefined });
	return summary;
}

/** The admin job's handler (one delivery = one full run). */
export async function runDiscoveryRankJob(env: DiscoveryEnv, _job: AdminJob): Promise<JobOutcome> {
	const summary = await runDiscoveryRank(env);
	// A run that works again clears the Errors page item of one that gave up
	resolveNeedsAction(env as DiscoveryEnv & ErrorReporterEnv, undefined, DISCOVERY_NEEDS_ACTION_KEY);
	return { done: true, result: summary as unknown as Record<string, unknown> };
}

export async function readLastRun(env: DiscoveryEnv): Promise<RunSummary | null> {
	const row = await db(env)?.prepare('SELECT value FROM search_meta WHERE key = ?').bind(LAST_RUN_KEY).first<{ value: string }>();
	if (!row) return null;
	try {
		return JSON.parse(row.value) as RunSummary;
	} catch {
		return null;
	}
}

/** Recent ranking jobs, newest first. */
export function discoveryJobs(env: DiscoveryEnv, limit = 10): Promise<AdminJob[]> {
	return listJobs(env, { targetKind: DISCOVERY_TARGET.kind, targetId: DISCOVERY_TARGET.id, limit });
}

/**
 * Queue a run unless one is queued/running/retrying, or (scheduled runs) the
 * last one finished recently. Returns the job and whether it already existed.
 */
export async function startDiscoveryRank(env: DiscoveryEnv, actorId: string, options: { scheduled?: boolean; now?: number } = {}): Promise<{ job: AdminJob | null; existing: boolean }> {
	const jobs = await discoveryJobs(env, 5);
	const active = jobs.find((j) => j.status === 'queued' || j.status === 'running' || j.status === 'retrying');
	if (active) return { job: active, existing: true };
	if (options.scheduled) {
		const now = options.now ?? Date.now();
		const last = jobs.find((j) => j.status === 'succeeded');
		if (last?.finishedAt && now - Date.parse(last.finishedAt) < MIN_RUN_INTERVAL_MS) return { job: last, existing: true };
	}
	const job = await createJob(env, { kind: DISCOVERY_RANK_JOB, targetKind: DISCOVERY_TARGET.kind, targetId: DISCOVERY_TARGET.id, actorId });
	return { job, existing: false };
}

/** The Errors page item of a ranking run that gave up (one item, whatever the run). */
export const DISCOVERY_NEEDS_ACTION_KEY = 'discovery-rank';

/** A run gave up after its retries: flag the admin with a Retry that queues a new run. */
export function flagDiscoveryRankFailed(env: DiscoveryEnv & ErrorReporterEnv, job: Pick<AdminJob, 'id'>, error: string): void {
	reportNeedsAction('api-videos', env, undefined, {
		key: DISCOVERY_NEEDS_ACTION_KEY,
		source: 'admin-job',
		title: 'Discovery rails were not updated',
		message: `The ranking run failed after its retries: ${error.slice(0, 400)}. Home rails, Trending and Popular keep their last good order until a run succeeds.`,
		itemType: 'admin-job',
		itemId: job.id,
		itemUrl: '/discovery',
		retry: { kind: 'service', service: 'api-videos', path: '/internal/discovery/rank', body: {} },
		retryLabel: 'Run now',
		extra: { jobId: job.id },
	});
}
